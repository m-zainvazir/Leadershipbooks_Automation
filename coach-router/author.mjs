#!/usr/bin/env node
/**
 * author.mjs — the author record. One command for everything after onboard.
 *
 *   npm run author                                   every author x every checklist step (0-16)
 *   npm run author -- status --code 1044 [--deep]    one author, row by row, with the fix
 *   npm run author -- set --code 1044 --shopifyProductId 123 --courseLessonUrl https://...
 *   npm run author -- page --code 1044               the coach page CONFIG block to paste
 *   npm run author -- zipify --code 1044 --from 1043 the Zipify find-and-replace list
 *   npm run author -- shopify --code 1044 --sku BC978... --grams 450 [--price 29.95] [--write]
 *                    [--image-file "C:\…\cover.jpg" | --image-url https://…]
 *                                                    create the bundle (needs the Admin token),
 *                                                    with its product image uploaded full size
 *   npm run author -- shopify-image --code 1044 (--image-file … | --image-url …) [--product collection] [--write]
 *                                                    add the image to a product that already exists
 *   npm run author -- shopify-collection --code 1044 [--price 97.00] [--image-file … | --image-url …] [--write]
 *   npm run author -- course360 --code 1044 [--course <id or link>] [--write]
 *                                                    step Course360 after you Duplicate the master course in GHL:
 *                                                    title, description, coach link, the Free Published Offer (the picture: by hand in GHL)
 *   npm run author -- shopify-listings [--write]       give every bundle and collection product what selling
 *                                                    abroad needs (category, description, weight, origin) — mostly only what is missing
 *                                                    the optional Course Collection product (no coach access)
 *
 * --code takes the code, the slug, the name or a unique part of it (lib-find.mjs);
 * --author is the same. `--from` (zipify) takes the same.
 *
 * `status` and the table READ every system and write nothing. `--deep` also
 * compares KV field by field against coaches.json (slower: one wrangler call).
 * `set` is the only write, through lib-registry's backup + seed + restore path,
 * so nobody hand-edits coaches.json.
 *
 * Plan: ../ghl-shopify subscription/plans/21-onboarding-automation.md §E
 */

import { loadConfig, bearer, runtimeConfig } from './lib-config.mjs';
import { saveRegistry, readState } from './lib-registry.mjs';
import {
  STEPS, RECORD_FIELDS, parseRecordValue, authorStatus, stepSummary, coachPageConfig, coachPageGaps, zipifyReplacements, slugOf,
} from './lib-author.mjs';
import { connectShopify, shopifyConfig, createBundle, bundleProblems, bundleTitle, BUNDLE_COLLECTION, loadProductImage, describeImage, productMedia, addProductImage, directImageUrl,
  createCollectionProduct, collectionProblems, collectionTitle, COLLECTION_PRICE,
  bundleDescription, collectionDescription, listingFixes, fixListing } from './lib-shopify.mjs';
import { emailProblems } from './lib-verify-author.mjs';
import { makeReaders } from './lib-readers.mjs';
import { findCoach, coachFromArgs } from './lib-find.mjs';
import { COURSES_VERSION, DEFAULT_COURSE_MASTER, courseIdFrom, listAll, readShape, findCourse, planCourse360, runWrites } from './lib-course360.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'all';
const has = (f) => argv.includes(f);
const valOf = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined;
};
const valsOf = (f) => argv.flatMap((a, i) => (a === f && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? [argv[i + 1]] : []));
const die = (msg) => {
  console.error(`\n${msg}\n`);
  process.exit(1);
};
// Node on Windows can abort with "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)"
// (exit 127) when process.exit runs while a just-used fetch connection is still closing —
// a successful dry run would then read as failed. The Shopify commands exit through these,
// which give the connections a moment to close first.
const settle = () => new Promise((r) => setTimeout(r, 300));
const finish = async (code) => { await settle(); process.exit(code); };
const dieSoon = async (msg) => { console.error(`\n${msg}\n`); await settle(); process.exit(1); };

let config;
try {
  config = loadConfig();
} catch (err) {
  die(err.message);
}
const { shared, coaches } = config;
const workerUrl = String(shared.workerUrl || '').replace(/\/+$/, '');
// --code 1043, --code freddy-davis, --code freddy, --author freddy: all the same author.
const pick = () => {
  const { coach, problem } = coachFromArgs(coaches, valOf);
  if (problem) die(`${cmd}: ${problem}`);
  return coach;
};

/* ---------------------------------------------------------------- readers --- */

// Every live read lives in lib-readers.mjs, shared with npm run pipeline and the
// dashboard so every view of an author agrees. Read-only by construction.
const readers = makeReaders(shared);
const { health } = readers;

/**
 * One harmless Voiceflow read per coach — the state of a made-up user, over the
 * version-in-path URL the Worker uses. Proves the key + version pair without a
 * billable launch and without touching anyone's conversation.
 */
async function probeVoiceflow(list) {
  const user = `author-check-${Date.now()}`;
  const out = [];
  for (const c of list) {
    const version = c.versionID || 'production';
    let status = 'no key';
    if (c.apiKey) {
      const r = await fetch(`https://general-runtime.voiceflow.com/state/${encodeURIComponent(version)}/user/${user}`, {
        headers: { Authorization: c.apiKey, versionID: version },
      }).catch((e) => ({ status: e.message }));
      status = r.status;
    }
    out.push({ code: c.code, name: c.displayName || c.name, version, source: c.keySource || 'none', status, ok: status === 200 });
  }
  return out;
}

const state = readState();
const ctx = () => ({
  cfg: runtimeConfig(shared),
  ...readers,
  lastVerify: (code) => state[code] && state[code].lastVerify,
});

const ICON = { DONE: '✓', TODO: '·', FAIL: '✗', WARN: '!', MANUAL: '?' };

/* --------------------------------------------------------------- commands --- */

if (cmd === 'all') {
  console.log(`\nAuthors — every checklist step (further-automation-v1.md), read live    ✓ done  ✗ wrong  ! cosmetic  · to do  ? can't be read\n`);
  const head = STEPS.map(([n]) => String(n).padStart(2)).join(' ');
  console.log(`  ${'code'.padEnd(6)}${'author'.padEnd(20)}${head}   next`);
  for (const coach of coaches) {
    const rows = await authorStatus(coach, ctx(), { all: coaches });
    const sum = stepSummary(rows);
    const cells = STEPS.map(([n]) => ` ${ICON[sum[n]]}`).join(' ');
    const next = rows.find((r) => r.status === 'FAIL') || rows.find((r) => r.status === 'TODO');
    console.log(`  ${coach.code.padEnd(6)}${String(coach.displayName || coach.name).slice(0, 19).padEnd(20)}${cells}   ${next ? `${next.step}: ${next.check}` : 'ready'}`);
  }
  console.log(`\n  ${STEPS.map(([n, name]) => `${n} ${name}`).join(' · ')}`);
  console.log(`\n  Detail: npm run author -- status --code <code>\n`);
  process.exit(0);
}

if (cmd === 'status') {
  const coach = pick();
  const rows = await authorStatus(coach, ctx(), { all: coaches, deep: has('--deep') });
  console.log(`\n${coach.code} ${coach.displayName || coach.name} — ${coach.bookTitle || ''}\n`);
  let last = -1;
  for (const r of rows) {
    const step = r.step !== last ? `${String(r.step).padStart(2)} ${(STEPS.find(([n]) => n === r.step) || [])[1]}` : '';
    last = r.step;
    console.log(`  ${step.padEnd(19)} ${ICON[r.status]} ${r.check}${r.detail ? `  — ${r.detail}` : ''}`);
    if (r.fix && r.status !== 'DONE') console.log(`  ${''.padEnd(19)}     → ${r.fix}`);
  }
  const counts = rows.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] || 0) + 1 }), {});
  console.log(`\n  ${counts.DONE || 0} done · ${counts.FAIL || 0} wrong · ${counts.WARN || 0} cosmetic · ${counts.TODO || 0} to do · ${counts.MANUAL || 0} to confirm by hand\n`);
  process.exit(counts.FAIL ? 1 : 0);
}

if (cmd === 'set') {
  const coach = pick();
  const changes = {};
  const problems = [];
  for (const field of Object.keys(RECORD_FIELDS)) {
    const raw = field === 'books' ? valsOf('--books') : valOf(`--${field}`);
    if (raw === undefined || (Array.isArray(raw) && !raw.length)) continue;
    const [value, problem] = parseRecordValue(field, raw);
    if (problem) problems.push(problem);
    else changes[field] = value;
  }
  const unknown = argv.filter((a, i) => a.startsWith('--') && a !== '--code' && a !== '--author' && !(`${a.slice(2)}` in RECORD_FIELDS) && argv[i - 1] !== '--code' && argv[i - 1] !== '--author');
  for (const u of unknown) problems.push(`unknown field ${u}. Settable:\n    ${Object.entries(RECORD_FIELDS).map(([k, v]) => `--${k.padEnd(18)} ${v}`).join('\n    ')}`);
  if (problems.length) die(`Nothing written:\n  x ${problems.join('\n  x ')}`);
  if (!Object.keys(changes).length) die(`Nothing to set. Settable:\n    ${Object.entries(RECORD_FIELDS).map(([k, v]) => `--${k.padEnd(18)} ${v}`).join('\n    ')}`);

  try {
    const { backup, warnings } = saveRegistry((doc) => {
      const e = doc.coaches.find((c) => String(c.code) === coach.code);
      Object.assign(e, changes);
    }, { label: `set-${coach.code}`, code: coach.code });
    console.log(`\n  ${coach.code}: set ${Object.keys(changes).join(', ')}   (backup: ${backup})`);
    for (const [k, v] of Object.entries(changes)) console.log(`    ${k.padEnd(18)} ${JSON.stringify(v)}`);
    console.log(`  seed validation clean${warnings.length ? `, ${warnings.length} warning(s):` : ''}`);
    for (const w of warnings) console.log(`    ${w}`);
    console.log('\n  Not pushed. npm run push when ready.\n');
  } catch (err) {
    die(err.message);
  }
  process.exit(0);
}

if (cmd === 'page') {
  const coach = pick();
  console.log(`\n// Paste over the whole \`const CONFIG = { ... };\` block of a clone of`);
  console.log(`// https://www.book-coach.ai/freddy-davis, published at https://www.book-coach.ai/${slugOf(coach)}\n`);
  console.log(coachPageConfig(coach, { workerUrl }));
  const gaps = coachPageGaps(coach);
  if (gaps.length) {
    console.log(`\n// Still empty — fill with npm run author -- set --code ${coach.code} ...:`);
    for (const g of gaps) console.log(`//   ${g}`);
  }
  const live = (await health().catch(() => ({ coaches: [] }))).coaches.some((c) => c.code === coach.code);
  if (!live) console.log(`\n// ⚠ coach ${coach.code} is not pushed yet — this page answers nothing until: npm run push`);
  console.log(`\n// Verify: npm run author -- status --code ${coach.code}\n`);
  process.exit(0);
}

if (cmd === 'zipify') {
  const coach = pick();
  const fromCode = valOf('--from');
  if (!fromCode) die('zipify needs --from <author>: the author whose page you are cloning (code, slug or name)');
  const found = findCoach(coaches, fromCode);
  if (found.problem) die(`zipify --from: ${found.problem}`);
  const from = found.coach;
  const pairs = zipifyReplacements(from, coach);
  console.log(`\nZipify clone: ${from.displayName || from.name} -> ${coach.displayName || coach.name}`);
  console.log(`Source page: ${from.bookLandingUrl || '(not recorded — set --bookLandingUrl on the source author)'}\n`);
  console.log('Find and replace IN THIS ORDER:\n');
  pairs.forEach((p, i) => console.log(`  ${String(i + 1).padStart(2)}. ${JSON.stringify(p.find)}\n      -> ${JSON.stringify(p.replace)}${p.why ? `    (${p.why})` : ''}`));
  const missing = ['bookTitle', 'shopifyProductId', 'shopifyVariantId'].filter((k) => !coach[k]);
  if (missing.length) console.log(`\n  ⚠ ${coach.code} has no ${missing.join(', ')} yet — those replacements are missing.`);
  // Since 2026-10-12: Zipify's own Product block (it replaced the plain button to the cart link).
  console.log(`\nAdd to Cart: Zipify's Product block, set to this author's bundle:`);
  console.log(`  Product: ${coach.bookTitle ? bundleTitle(coach) : '(no bookTitle yet)'}`);
  console.log(`  (its plain cart link, if ever needed: https://leadershipbooks.com/cart/${coach.shopifyVariantId || '<VARIANT_ID>'}:1)`);
  console.log(`\nThen rewrite the pitch (runbook §9b — ~70% of the page is about the book).`);
  console.log(`Then: npm run author -- set --code ${coach.code} --bookLandingUrl <url>   and   npm run author -- status --code ${coach.code}\n`);
  process.exit(0);
}

if (cmd === 'check') {
  // Read-only proof of every credential the tools and the Worker depend on.
  // Nothing is written anywhere: each GHL scope is exercised by one GET/search.
  const L = encodeURIComponent(shared.ghlLocationId || '');
  const anyProduct = (coaches.find((c) => c.ghlProductId) || {}).ghlProductId;
  const probes = [
    ['contacts.readonly', 'POST', '/contacts/search', { locationId: shared.ghlLocationId, pageLimit: 1 }],
    ['products.readonly', 'GET', `/products/?locationId=${L}&limit=1`],
    ['products/prices.readonly', 'GET', anyProduct ? `/products/${anyProduct}/price?locationId=${L}` : null],
    ['payments/subscriptions.readonly', 'GET', `/payments/subscriptions?altId=${L}&altType=location&limit=1`, null, 'the Worker\'s subscriber sync — REQUIRED'],
    ['workflows.readonly', 'GET', `/workflows/?locationId=${L}`, null, 'grant-workflow check'],
    ['locations/tags.readonly', 'GET', `/locations/${L}/tags`, null, 'tag checks'],
    ['locations/customFields.readonly', 'GET', `/locations/${L}/customFields`, null, 'field names'],
    ['courses.readonly', 'GET', `/courses/products?locationId=${L}&limit=1`, null, 'step Course360', COURSES_VERSION],
  ];
  const probeToken = async (token) => {
    const out = [];
    for (const [scope, method, path, body, why, version] of probes) {
      if (!path) { out.push([scope, 'skip', 'no product recorded to read']); continue; }
      const res = await fetch(`https://services.leadconnectorhq.com${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, Version: version || '2021-07-28', accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      out.push([scope, res.ok ? 'ok' : String(res.status), why || '']);
    }
    return out;
  };
  const report = {};
  for (const key of ['ghlApiToken', 'ghlApiTokenNew']) {
    if (!shared[key]) { console.log(`\n  GHL ${key}: (empty)`); continue; }
    report[key] = await probeToken(shared[key]);
    console.log(`\n  GHL ${key}${key === 'ghlApiToken' ? '  (live — the Worker uses this)' : '  (candidate)'}`);
    for (const [scope, st, why] of report[key]) console.log(`    ${st === 'ok' ? '✓' : st === 'skip' ? '·' : '✗'} ${scope.padEnd(34)} ${st === 'ok' ? '' : st}${why ? `   ${why}` : ''}`);
  }
  console.log('    (write scopes — contacts, products, prices, tags, courses — are not probed: that would mean writing)');

  // Voiceflow: which key each coach resolves to, and whether it answers.
  const vf = await probeVoiceflow(coaches);
  console.log(`\n  Voiceflow  (shared personal key: ${bearer(shared.vfApiKey) ? 'set' : 'NOT SET — coaches still use their own project keys'})`);
  for (const r of vf) console.log(`    ${r.ok ? '✓' : '✗'} ${r.code} ${String(r.name).padEnd(18)} ${r.source.padEnd(9)} @ ${r.version}  ${r.ok ? '' : r.status}`);
  if (vf.some((r) => /^[a-z]+$/i.test(r.version))) {
    console.log('    ⚠ a versionID is an alias (main/production) — the personal-key format expects the 24-character version ID');
  }

  const sc = shopifyConfig(shared);
  if (sc.missing.length) {
    console.log(`\n  Shopify: not configured — missing ${sc.missing.join(', ')}`);
  } else {
    try {
      const conn = await connectShopify(shared);
      const { shop } = await conn.gql('{ shop { name myshopifyDomain } }');
      console.log(`\n  Shopify: ✓ connected to "${shop.name}" (${shop.myshopifyDomain}) via ${conn.via}`);
      console.log(conn.lacking.length ? `    ✗ missing scopes: ${conn.lacking.join(', ')}` : '    ✓ all four scopes granted');
    } catch (err) {
      console.log(`\n  Shopify: ✗ ${err.message}`);
    }
  }

  const cand = report.ghlApiTokenNew;
  if (cand) {
    const subsOk = cand.find(([s]) => s === 'payments/subscriptions.readonly')[1] === 'ok';
    const allOk = cand.every(([, st]) => st === 'ok' || st === 'skip');
    console.log(subsOk
      ? `\n  → the new GHL token can run the subscriber sync${allOk ? ' and every check' : ''}. Switch with: npm run author -- promote-ghl-token`
      : '\n  → the new GHL token CANNOT read subscriptions. Do not promote it: the Worker would stop recognising payers.');
  }
  console.log('');
  process.exit(0);
}

if (cmd === 'drop-project-keys') {
  // The last step of the personal-key move: remove every per-coach project key.
  // Refused unless the shared personal key answers for EVERY coach, because
  // after this there is no older key to fall back to.
  if (!bearer(shared.vfApiKey)) die('shared.vfApiKey is empty — paste the personal key first, then npm run author -- check');
  const vf = await probeVoiceflow(coaches);
  const bad = vf.filter((r) => !r.ok || r.source !== 'personal');
  if (bad.length) die(`REFUSING — the personal key does not answer for: ${bad.map((r) => `${r.code} (${r.source} ${r.status})`).join(', ')}. Nothing changed.`);
  const had = coaches.filter((c) => c.vfKey).map((c) => c.code);
  if (!had.length) die('No per-coach project keys left — nothing to do.');
  const { backup } = saveRegistry((doc) => { for (const c of doc.coaches) delete c.vfKey; }, { label: 'drop-project-keys' });
  console.log(`\n  Removed the project key from ${had.join(', ')} — every coach now uses the shared personal key (backup: ${backup}).`);
  console.log('  Next: npm run push   (the Worker switches), then npm run verify:vf\n');
  process.exit(0);
}

if (cmd === 'promote-ghl-token') {
  // Swap the candidate in, keep the old one beside it for rollback. The Worker
  // only changes on `npm run secrets`, which is deliberately a separate step.
  if (!shared.ghlApiTokenNew) die('shared.ghlApiTokenNew is empty — paste the new token there first, then npm run author -- check');
  const res = await fetch(`https://services.leadconnectorhq.com/payments/subscriptions?altId=${encodeURIComponent(shared.ghlLocationId)}&altType=location&limit=1`, {
    headers: { Authorization: `Bearer ${shared.ghlApiTokenNew}`, Version: '2021-07-28', accept: 'application/json' },
  });
  if (!res.ok) die(`REFUSING: the new token gets ${res.status} on /payments/subscriptions. Promoted, it would break the subscriber sync.`);
  const { backup } = saveRegistry((doc) => {
    doc.shared.ghlApiTokenOld = doc.shared.ghlApiToken;
    doc.shared.ghlApiToken = doc.shared.ghlApiTokenNew;
    delete doc.shared.ghlApiTokenNew;
  }, { label: 'promote-ghl-token' });
  console.log(`\n  ghlApiToken now holds the new token; the old one is kept as ghlApiTokenOld (backup: ${backup}).`);
  console.log('  Next: npm run secrets   (the Worker switches), then npm run subs -- --dry   (the sync still works)\n');
  process.exit(0);
}

if (cmd === 'config') {
  // Shared settings the tools read. Kept in coaches.json (gitignored), never in
  // code: the test inbox is a personal address and the repo is public.
  const SETTABLE = { verifyEmail: 'the inbox verify-author sends its test welcome emails to' };
  const changes = {};
  for (const k of Object.keys(SETTABLE)) {
    const v = valOf(`--${k}`);
    if (v === undefined) continue;
    const probs = k === 'verifyEmail' ? emailProblems(v) : [];
    if (probs.length) die(`Nothing written:\n  x ${probs.join('\n  x ')}`);
    changes[k] = v.trim().toLowerCase();
  }
  if (!Object.keys(changes).length) {
    console.log('\n  Shared settings (coaches.json "shared"):\n');
    for (const [k, why] of Object.entries(SETTABLE)) console.log(`    --${k.padEnd(14)} ${JSON.stringify(shared[k] || '')}   ${why}`);
    console.log('\n  Change one: npm run author -- config --verifyEmail you@example.org\n');
    process.exit(0);
  }
  try {
    const { backup } = saveRegistry((doc) => { Object.assign(doc.shared, changes); }, { label: 'config' });
    for (const [k, v] of Object.entries(changes)) console.log(`\n  ${k} = ${v}   (backup: ${backup})`);
    console.log('');
  } catch (err) {
    die(err.message);
  }
  process.exit(0);
}

if (cmd === 'shopify') {
  // Checklist step Shopify bundle. Dry by default; --write creates the product.
  const coach = pick();
  const opts = { coach, price: valOf('--price') || '29.95', sku: valOf('--sku'), grams: valOf('--grams') };
  const problems = bundleProblems(opts);
  // The product image — a file on this computer or a link; read and checked in the dry run too.
  const img = await loadProductImage({ file: valOf('--image-file'), url: valOf('--image-url') });
  problems.push(...img.problems);
  opts.image = img.image;
  const sc = shopifyConfig(shared);
  if (sc.missing.length) {
    problems.push(`Shopify not configured — missing ${sc.missing.join(', ')}. See plans/21 §D: a Dev Dashboard app ` +
      '(Create app manually) with write_products, write_publications, write_draft_orders, write_orders, installed on the store');
  }
  console.log(`\nShopify bundle for ${coach.code} ${coach.displayName || coach.name}${has('--write') ? '' : '   (DRY RUN)'}\n`);
  console.log(`  title    ${bundleTitle(coach)}`);
  console.log(`  price    $${opts.price}   sku ${opts.sku || '(missing)'}   weight ${opts.grams || '(missing)'} g   ships: yes`);
  console.log(`  image    ${opts.image ? describeImage(opts.image) : img.problems.length ? '(refused — see below)' : '(none — add one in Shopify later)'}`);
  if (opts.image) console.log(`           from ${opts.image.source}`);
  for (const n of img.notes) console.log(`           note: ${n}`);
  console.log(`  then     publish to Online Store, add to the ${BUNDLE_COLLECTION} collection, record the ids`);
  if (problems.length) await dieSoon(`REFUSING — nothing created:\n  x ${problems.join('\n  x ')}`);
  if (!has('--write')) {
    console.log('\nDry run only. Re-run with --write.\n');
    await finish(0);
  }
  let made;
  try {
    const { gql, lacking } = await connectShopify(shared);
    if (lacking.length) throw new Error(`the Shopify app is missing scopes: ${lacking.join(', ')} — add them in the Dev Dashboard, release a new version, reinstall`);
    made = await createBundle(gql, opts);
  } catch (err) {
    await dieSoon(`STOPPED: ${err.message}\n  Already in Shopify: ${JSON.stringify(err.created || {})}\n  coaches.json was NOT changed.`);
  }
  console.log(`\n  created  product ${made.productId}  variant ${made.variantId}  /products/${made.handle}`);
  if (made.image) {
    const im = made.image;
    console.log(im.status === 'READY'
      ? `  image    ✓ on the product, ${im.width} × ${im.height}`
      : `  image    ⚠ ${im.status}${im.errors && im.errors.length ? `: ${im.errors.join('; ')}` : ''} — the product is fine; check its picture in Shopify → Products, and add it there by hand if it is missing`);
  }
  const { backup, warnings } = saveRegistry((doc) => {
    Object.assign(doc.coaches.find((c) => String(c.code) === coach.code), { shopifyProductId: made.productId, shopifyVariantId: made.variantId });
  }, { label: `shopify-${coach.code}`, code: coach.code });
  console.log(`  recorded shopifyProductId + shopifyVariantId   (backup: ${backup})`);
  for (const w of warnings) console.log(`    ${w}`);
  console.log(`\n  Zipify cart link: https://leadershipbooks.com/cart/${made.variantId}:1\n  Not pushed. npm run push when ready.\n`);
  await finish(0);
}

if (cmd === 'shopify-image') {
  // A product that already exists: add its image, nothing else. Dry by default.
  // --product collection: the Course Collection product instead of the bundle.
  const coach = pick();
  const which = valOf('--product') || 'bundle';
  if (!['bundle', 'collection'].includes(which)) await dieSoon(`--product is bundle or collection, not "${which}"`);
  const field = which === 'collection' ? 'collectionProductId' : 'shopifyProductId';
  const productId = coach[field];
  const img = await loadProductImage({ file: valOf('--image-file'), url: valOf('--image-url') });
  const problems = [...img.problems];
  if (!productId) problems.push(`${coach.code} has no ${field} yet — create the ${which === 'collection' ? 'collection product (author shopify-collection)' : 'bundle (author shopify)'} with the image instead`);
  if (!img.image && !img.problems.length) problems.push('give the image: --image-file "C:\\…\\cover.jpg" or --image-url https://…');
  const sc = shopifyConfig(shared);
  if (sc.missing.length) problems.push(`Shopify not configured — missing ${sc.missing.join(', ')}`);
  console.log(`\nProduct image for ${coach.code} ${coach.displayName || coach.name}${has('--write') ? '' : '   (DRY RUN)'}\n`);
  console.log(`  image    ${img.image ? describeImage(img.image) : '(refused — see below)'}`);
  if (img.image) console.log(`           from ${img.image.source}`);
  for (const n of img.notes) console.log(`           note: ${n}`);
  if (problems.length) await dieSoon(`REFUSING — nothing uploaded:\n  x ${problems.join('\n  x ')}`);
  let gql;
  try {
    const conn = await connectShopify(shared);
    if (conn.lacking.length) throw new Error(`the Shopify app is missing scopes: ${conn.lacking.join(', ')}`);
    gql = conn.gql;
    const now = await productMedia(gql, productId);
    if (!now) throw new Error(`product ${productId} is not in Shopify — check the product id saved for this author`);
    console.log(`  product  ${productId}  "${now.title}"  — has ${now.mediaIds.length} image(s) now`);
    console.log(now.mediaIds.length
      ? '  then     this one is ADDED after them (nothing is removed). To make it the main picture, drag it first in Shopify → Products'
      : '  then     it becomes the product\'s main picture');
  } catch (err) {
    await dieSoon(`STOPPED: ${err.message}\n  Nothing was uploaded.`);
  }
  if (!has('--write')) {
    console.log('\nDry run only. Re-run with --write.\n');
    await finish(0);
  }
  let im;
  try {
    im = await addProductImage(gql, { productId, image: img.image });
  } catch (err) {
    await dieSoon(`STOPPED: ${err.message}`);
  }
  console.log(im.status === 'READY'
    ? `\n  image    ✓ on the product, ${im.width} × ${im.height}\n`
    : `\n  image    ⚠ ${im.status}${im.errors && im.errors.length ? `: ${im.errors.join('; ')}` : ''} — check the product's pictures in Shopify → Products\n`);
  await finish(im.status === 'FAILED' ? 1 : 0);
}

if (cmd === 'shopify-collection') {
  // Checklist step "Course Collection + Bundle Image" (optional). Dry by default; --write creates it.
  // 🚨 Recorded as collectionProductId, NEVER shopifyProductId: an order for it starts no trial.
  const coach = pick();
  const opts = { coach, price: valOf('--price') || COLLECTION_PRICE };
  const problems = collectionProblems(opts);
  const img = await loadProductImage({ file: valOf('--image-file'), url: valOf('--image-url') });
  problems.push(...img.problems);
  opts.image = img.image;
  const sc = shopifyConfig(shared);
  if (sc.missing.length) problems.push(`Shopify not configured — missing ${sc.missing.join(', ')}`);
  console.log(`\nCourse Collection product for ${coach.code} ${coach.displayName || coach.name}${has('--write') ? '' : '   (DRY RUN)'}\n`);
  console.log(`  title    ${coach.bookTitle ? collectionTitle(coach) : '(no bookTitle)'}`);
  console.log(`  price    $${opts.price}   inventory: not tracked   shipping address: not asked   description: none`);
  console.log(`  image    ${opts.image ? describeImage(opts.image) : img.problems.length ? '(refused — see below)' : '(none — add one later with shopify-image --product collection)'}`);
  if (opts.image) console.log(`           from ${opts.image.source}`);
  for (const n of img.notes) console.log(`           note: ${n}`);
  console.log('  then     publish to Online Store, record the ids — NOT in coach-bundles: buying it gives no coach access');
  if (problems.length) await dieSoon(`REFUSING — nothing created:\n  x ${problems.join('\n  x ')}`);
  if (!has('--write')) {
    console.log('\nDry run only. Re-run with --write.\n');
    await finish(0);
  }
  let made;
  try {
    const { gql, lacking } = await connectShopify(shared);
    if (lacking.length) throw new Error(`the Shopify app is missing scopes: ${lacking.join(', ')}`);
    made = await createCollectionProduct(gql, opts);
  } catch (err) {
    await dieSoon(`STOPPED: ${err.message}\n  Already in Shopify: ${JSON.stringify(err.created || {})}\n  coaches.json was NOT changed.`);
  }
  console.log(`\n  created  product ${made.productId}  variant ${made.variantId}  /products/${made.handle}`);
  if (made.image) {
    const im = made.image;
    console.log(im.status === 'READY'
      ? `  image    ✓ on the product, ${im.width} × ${im.height}`
      : `  image    ⚠ ${im.status}${im.errors && im.errors.length ? `: ${im.errors.join('; ')}` : ''} — the product is fine; check its picture in Shopify → Products`);
  }
  const { backup, warnings } = saveRegistry((doc) => {
    Object.assign(doc.coaches.find((c) => String(c.code) === coach.code), { collectionProductId: made.productId, collectionVariantId: made.variantId });
  }, { label: `collection-${coach.code}`, code: coach.code });
  console.log(`  recorded collectionProductId + collectionVariantId   (backup: ${backup})`);
  for (const w of warnings) console.log(`    ${w}`);
  console.log(`\n  Collection cart link: https://leadershipbooks.com/cart/${made.variantId}:1\n`);
  await finish(0);
}

if (cmd === 'shopify-listings') {
  // Shopify blocks a product in every other country ("188 restrictions") until it has a
  // category, a description, and — if it ships — a weight and an origin (proven on Reinhard's bundle 2026-10-12).
  // Every author's bundle and every course collection product; mostly only what is missing. Dry by default.
  const sc = shopifyConfig(shared);
  if (sc.missing.length) await dieSoon(`Shopify not configured — missing ${sc.missing.join(', ')}`);
  const FIELDS = 'id title category { id } descriptionHtml variants(first: 5) { nodes { id price inventoryItem { requiresShipping countryCodeOfOrigin measurement { weight { value } } } } }';
  let gql;
  try {
    const conn = await connectShopify(shared);
    if (conn.lacking.length) throw new Error(`the Shopify app is missing scopes: ${conn.lacking.join(', ')}`);
    gql = conn.gql;
  } catch (err) {
    await dieSoon(`STOPPED: ${err.message}`);
  }
  const targets = new Map(); // product gid -> { product, description, why }
  for (const c of coaches) {
    for (const [field, kind] of [['shopifyProductId', 'bundle'], ['collectionProductId', 'collection']]) {
      if (!c[field]) continue;
      const gid = `gid://shopify/Product/${c[field]}`;
      const p = (await gql(`query($id: ID!) { product(id: $id) { ${FIELDS} } }`, { id: gid })).product;
      if (p) targets.set(gid, { product: p, description: kind === 'bundle' ? bundleDescription(c) : collectionDescription(c), why: `${c.code} ${kind}` });
    }
  }
  // Course collections made by hand are not in coaches.json: found by their title.
  const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const found = (await gql(`{ products(first: 50, query: "title:*Collection*") { nodes { ${FIELDS} } } }`)).products.nodes;
  for (const p of found) {
    // Only titles that END in Collection — not books like 'A Collection of Essays'.
    if (targets.has(p.id) || !/collection( bundle)?\s*$/i.test(p.title)) continue;
    const book = p.title.replace(/\s*-?\s*Collection( Bundle)?\s*$/i, '').trim();
    const owner = coaches.find((c) => c.bookTitle && norm(book) === norm(c.bookTitle));
    targets.set(p.id, { product: p, description: collectionDescription({ bookTitle: book, displayName: owner ? owner.displayName || owner.name : '' }), why: owner ? `${owner.code} collection (by title)` : 'collection (by title)' });
  }
  console.log(`\nWhat selling abroad needs — category, description, weight, origin${has('--write') ? '' : '   (DRY RUN)'}\n`);
  let todo = 0;
  for (const [gid, t] of targets) {
    const { change, missing, notes } = listingFixes(t.product, t.description);
    if (missing.length) todo++;
    console.log(`  ${missing.length ? '→' : '✓'} ${t.product.title}   [${t.why}]`);
    if (missing.length) console.log(`      adds: ${missing.join(' + ')}`);
    if (change.product.descriptionHtml) console.log(`      description: ${change.product.descriptionHtml.replace(/<[^>]+>/g, '').slice(0, 150)}`);
    for (const n of notes) console.log(`      ⚠ ${n}`);
    if (has('--write') && missing.length) {
      try {
        await fixListing(gql, gid, change);
        console.log('      ✓ done');
      } catch (err) {
        console.log(`      ✗ ${err.message}`);
      }
    }
  }
  console.log(todo
    ? (has('--write') ? `\n  ${todo} product(s) updated. Shopify reviews them again — seconds, at most ~24 h — then Restrictions should read 0.\n` : `\n  ${todo} product(s) would change. Re-run with --write.\n`)
    : '\n  Nothing missing.\n');
  await finish(0);
}

if (cmd === 'course360') {
  // Step Course360 through HighLevel's Courses API — dashboard plans/03. Dry by default.
  // A person Duplicates the master course in GHL (videos can be copied nowhere else);
  // this finds the copy and does the rest. Reads everything first; writes only with --write.
  const coach = pick();
  const write = has('--write');
  const slug = slugOf(coach);
  const masterId = courseIdFrom(valOf('--master') || '') || DEFAULT_COURSE_MASTER;
  const api = async (method, path, body) => {
    const url = `https://services.leadconnectorhq.com${path}${path.includes('?') ? '&' : '?'}locationId=${encodeURIComponent(shared.ghlLocationId || '')}`;
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${shared.ghlApiToken}`, Version: COURSES_VERSION, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30000),
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = '';
      try { const j = JSON.parse(text); msg = (j.error && j.error.message) || j.message || ''; } catch { /* not JSON */ }
      throw new Error(`GHL ${res.status} on ${method} ${path.split('?')[0]}${msg ? ` — ${msg}` : ''}${res.status === 401 ? ' (the token needs the courses.readonly and courses.write permissions)' : ''}`);
    }
    return text ? JSON.parse(text) : {};
  };
  const get = (p) => api('GET', p);
  const shapes = new Map();
  const shapeOf = (id) => { if (!shapes.has(id)) shapes.set(id, readShape(get, id)); return shapes.get(id); };

  // No picture: GHL shows a course picture only from its own course storage, which only its
  // course screen uploads to — a Media Storage address shows broken (Rick's course, 2026-10-13).
  if (valOf('--image-file') || valOf('--image-url')) {
    await dieSoon('REFUSING — nothing written:\n  x a course picture cannot be set by a program: GHL shows it only when it is uploaded on the course\'s own screen\n    (GHL → Memberships → Courses → the course → ⋮ → Edit → its image). Run this without the picture, then add it there.');
  }

  console.log(`\nCourse360 for ${coach.code} ${coach.displayName || coach.name}${write ? '' : '   (DRY RUN)'}\n`);
  let plan;
  try {
    const [courses, offers] = await Promise.all([listAll(get, 'products'), listAll(get, 'offers')]);
    const master = courses.find((c) => c.id === masterId);
    if (!master) throw new Error(`the master course ${masterId} is not in Course360 — give another with --master`);
    const masterShape = await shapeOf(masterId);
    const found = await findCourse({ coach, coaches, courses, offers, given: valOf('--course'), masterId, masterShape, shapeOf });
    if (found.problem) throw new Error(found.problem);
    plan = planCourse360({ coach, slug, course: found.course, shape: await shapeOf(found.course.id), masterShape, offers });
    console.log(`  master   "${master.title}"`);
    console.log(`  course   "${found.course.title}"  (${found.course.id}) — found by ${found.how}`);
  } catch (err) {
    await dieSoon(`STOPPED: ${err.message}\n  Nothing was written.`);
  }
  for (const d of plan.done) console.log(`  ok       ${d}`);
  for (const w of plan.writes) console.log(`  ${write ? 'doing' : 'will'}     ${w.say}`);
  const rec = Object.entries(plan.record).filter(([k, v]) => coach[k] !== v);
  const recLine = (list) => list.map(([k, v]) => `${k} = ${v}`).join(', ');
  const newOffer = !plan.offerId && plan.writes.some((w) => w.key === 'offer');
  if (rec.length || newOffer) console.log(`  save     coaches.json: ${[recLine(rec), newOffer && 'courseOfferId = (the new Offer\'s id)'].filter(Boolean).join(', ')}`);
  if (plan.problems.length) await dieSoon(`REFUSING — nothing written:\n  x ${plan.problems.join('\n  x ')}`);
  if (!plan.writes.length && !rec.length) {
    console.log('\n  Nothing to do — the course, its coach lesson and its Offer are already right.\n');
    await finish(0);
  }
  console.log('\n  Then check by hand: the intro lessons\' videos play (no program can see them).');
  if (!write) {
    console.log('\nDry run only. Re-run with --write.\n');
    await finish(0);
  }

  console.log('');
  const result = await runWrites((w) => api(w.method, w.path, w.body), plan.writes, { log: (l) => console.log(l) });
  // Save what is known even after a failure — the ids make the next run finish the job.
  const changes = Object.fromEntries([...rec, ...Object.entries(result.created)].filter(([k, v]) => v && coach[k] !== v));
  if (Object.keys(changes).length) {
    try {
      const { backup } = saveRegistry((doc) => Object.assign(doc.coaches.find((c) => String(c.code) === coach.code), changes), { label: `course360-${coach.code}`, code: coach.code });
      console.log(`  ✓ saved to coaches.json: ${recLine(Object.entries(changes))}   (backup: ${backup})`);
    } catch (err) {
      console.error(`  ✗ coaches.json NOT saved: ${err.message}\n    Save by hand: npm run author -- set --code ${coach.code} ${Object.entries(changes).map(([k, v]) => `--${k} ${v}`).join(' ')}`);
      await finish(1);
    }
  }
  if (!result.ok) {
    await dieSoon(`STOPPED at: ${result.failed.say}\n  ${result.error}\n  Not done yet:\n    - ${result.left.map((w) => w.say).join('\n    - ')}\n  Run the same command again to finish — it only does what is still missing.`);
  }
  console.log('\n  Done. Now open the course in GHL and check the intro videos play.\n');
  await finish(0);
}

die(`unknown command "${cmd}". Use: (none) | status | set | config | check | promote-ghl-token | drop-project-keys | page | zipify | shopify | shopify-image | shopify-collection | shopify-listings | course360`);
