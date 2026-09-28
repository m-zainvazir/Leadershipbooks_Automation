#!/usr/bin/env node
/**
 * author.mjs — the author record. One command for everything after onboard.
 *
 *   npm run author                                   every author x every runbook step
 *   npm run author -- status --code 1044 [--deep]    one author, row by row, with the fix
 *   npm run author -- set --code 1044 --shopifyProductId 123 --courseLessonUrl https://...
 *   npm run author -- page --code 1044               the coach page CONFIG block to paste
 *   npm run author -- zipify --code 1044 --from 1043 the Zipify find-and-replace list
 *   npm run author -- shopify --code 1044 --sku BC978... --grams 450 [--price 29.95] [--write]
 *                                                    create the bundle (needs the Admin token)
 *
 * `status` and the table READ every system and write nothing. `--deep` also
 * compares KV field by field against coaches.json (slower: one wrangler call).
 * `set` is the only write, through lib-registry's backup + seed + restore path,
 * so nobody hand-edits coaches.json.
 *
 * Plan: ../ghl-shopify subscription/plans/21-onboarding-automation.md §E
 */

import { execFileSync } from 'node:child_process';
import { loadConfig, HERE } from './lib-config.mjs';
import { saveRegistry, readState } from './lib-registry.mjs';
import {
  STEPS, RECORD_FIELDS, parseRecordValue, authorStatus, stepSummary, coachPageConfig, coachPageGaps, zipifyReplacements, slugOf,
} from './lib-author.mjs';
import { connectShopify, shopifyConfig, createBundle, bundleProblems, bundleTitle, BUNDLE_COLLECTION } from './lib-shopify.mjs';

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

let config;
try {
  config = loadConfig();
} catch (err) {
  die(err.message);
}
const { shared, coaches } = config;
const workerUrl = String(shared.workerUrl || '').replace(/\/+$/, '');
const pick = () => {
  const code = valOf('--code');
  if (!code) die(`${cmd} needs --code <code>. Coaches: ${coaches.map((c) => `${c.code} ${c.displayName || c.name}`).join(', ')}`);
  const c = coaches.find((x) => x.code === String(code));
  if (!c) die(`no coach ${code} in coaches.json`);
  return c;
};

/* ---------------------------------------------------------------- readers --- */

async function fetchText(url) {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20000) });
  return { status: res.status, text: res.ok ? await res.text() : '' };
}

let catalogCache = null;
/** Every product in Shopify's public catalogue. No token needed. */
async function catalog() {
  if (catalogCache) return catalogCache;
  const map = new Map();
  for (let page = 1; page <= 40; page++) {
    const r = await fetch(`https://leadershipbooks.com/products.json?limit=250&page=${page}`, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`Shopify products.json ${r.status}`);
    const { products = [] } = await r.json();
    for (const p of products) map.set(String(p.id), p);
    if (products.length < 250) break;
  }
  return (catalogCache = map);
}

async function ghl(path, { method = 'GET', body = null } = {}) {
  // Read-only by construction: the only POST is contacts/search.
  if (method !== 'GET' && path !== '/contacts/search') throw new Error(`author refuses to ${method} ${path}`);
  const res = await fetch(`https://services.leadconnectorhq.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${shared.ghlApiToken}`,
      Version: '2021-07-28',
      accept: 'application/json',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`GHL ${res.status} on ${path.split('?')[0]}`);
  return res.json();
}

let healthCache = null;
async function health() {
  if (healthCache) return healthCache;
  const r = await fetch(`${workerUrl}/health`, { headers: { 'x-health-token': shared.healthToken || '' } });
  if (!r.ok) throw new Error(`/health ${r.status}`);
  return (healthCache = await r.json());
}

function kvGet(key) {
  const IS_WIN = process.platform === 'win32';
  try {
    return JSON.parse(execFileSync(IS_WIN ? 'npx.cmd' : 'npx', ['wrangler', 'kv', 'key', 'get', key, '--binding=COACH_KV', '--remote', '--preview=false'], {
      cwd: HERE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: IS_WIN,
    }));
  } catch {
    return null;
  }
}

const state = readState();
const ctx = () => ({
  fetchText, catalog, ghl, health, kvGet, locationId: shared.ghlLocationId,
  lastVerify: (code) => state[code] && state[code].lastVerify,
});

const ICON = { DONE: '✓', TODO: '·', FAIL: '✗', WARN: '!', MANUAL: '?' };

/* --------------------------------------------------------------- commands --- */

if (cmd === 'all') {
  console.log(`\nAuthors — every runbook step, read live    ✓ done  ✗ wrong  ! cosmetic  · to do  ? can't be read\n`);
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
  let last = 0;
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
  const unknown = argv.filter((a, i) => a.startsWith('--') && a !== '--code' && !(`${a.slice(2)}` in RECORD_FIELDS) && argv[i - 1] !== '--code');
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
  if (!fromCode) die('zipify needs --from <code>: the author whose page you are cloning');
  const from = coaches.find((c) => c.code === String(fromCode));
  if (!from) die(`no coach ${fromCode}`);
  const pairs = zipifyReplacements(from, coach);
  console.log(`\nZipify clone: ${from.displayName || from.name} -> ${coach.displayName || coach.name}`);
  console.log(`Source page: ${from.bookLandingUrl || '(not recorded — set --bookLandingUrl on the source author)'}\n`);
  console.log('Find and replace IN THIS ORDER:\n');
  pairs.forEach((p, i) => console.log(`  ${String(i + 1).padStart(2)}. ${JSON.stringify(p.find)}\n      -> ${JSON.stringify(p.replace)}${p.why ? `    (${p.why})` : ''}`));
  const missing = ['bookTitle', 'shopifyProductId', 'shopifyVariantId'].filter((k) => !coach[k]);
  if (missing.length) console.log(`\n  ⚠ ${coach.code} has no ${missing.join(', ')} yet — those replacements are missing.`);
  console.log(`\nAdd to Cart: a plain Button element, NOT Zipify's Product Button (runbook §9c):`);
  console.log(`  Label: ADD TO CART`);
  console.log(`  Link : https://leadershipbooks.com/cart/${coach.shopifyVariantId || '<VARIANT_ID>'}:1`);
  console.log(`\nThen rewrite the pitch (runbook §9b — ~70% of the page is about the book).`);
  console.log(`Then: npm run author -- set --code ${coach.code} --bookLandingUrl <url>   and   npm run author -- status --code ${coach.code}\n`);
  process.exit(0);
}

if (cmd === 'shopify') {
  // Runbook step 3. Dry by default; --write creates the product.
  const coach = pick();
  const opts = { coach, price: valOf('--price') || '29.95', sku: valOf('--sku'), grams: valOf('--grams') };
  const problems = bundleProblems(opts);
  const sc = shopifyConfig(shared);
  if (sc.missing.length) {
    problems.push(`Shopify not configured — missing ${sc.missing.join(', ')}. See plans/21 §D: a Dev Dashboard app ` +
      '(Create app manually) with write_products, write_publications, write_draft_orders, write_orders, installed on the store');
  }
  console.log(`\nShopify bundle for ${coach.code} ${coach.displayName || coach.name}${has('--write') ? '' : '   (DRY RUN)'}\n`);
  console.log(`  title    ${bundleTitle(coach)}`);
  console.log(`  price    $${opts.price}   sku ${opts.sku || '(missing)'}   weight ${opts.grams || '(missing)'} g   ships: yes`);
  console.log(`  then     publish to Online Store, add to the ${BUNDLE_COLLECTION} collection, record the ids`);
  if (problems.length) die(`REFUSING — nothing created:\n  x ${problems.join('\n  x ')}`);
  if (!has('--write')) {
    console.log('\nDry run only. Re-run with --write.\n');
    process.exit(0);
  }
  let made;
  try {
    const { gql, lacking } = await connectShopify(shared);
    if (lacking.length) throw new Error(`the Shopify app is missing scopes: ${lacking.join(', ')} — add them in the Dev Dashboard, release a new version, reinstall`);
    made = await createBundle(gql, opts);
  } catch (err) {
    die(`STOPPED: ${err.message}\n  Already in Shopify: ${JSON.stringify(err.created || {})}\n  coaches.json was NOT changed.`);
  }
  console.log(`\n  created  product ${made.productId}  variant ${made.variantId}  /products/${made.handle}`);
  const { backup, warnings } = saveRegistry((doc) => {
    Object.assign(doc.coaches.find((c) => String(c.code) === coach.code), { shopifyProductId: made.productId, shopifyVariantId: made.variantId });
  }, { label: `shopify-${coach.code}`, code: coach.code });
  console.log(`  recorded shopifyProductId + shopifyVariantId   (backup: ${backup})`);
  for (const w of warnings) console.log(`    ${w}`);
  console.log(`\n  Zipify cart link: https://leadershipbooks.com/cart/${made.variantId}:1\n  Not pushed. npm run push when ready.\n`);
  process.exit(0);
}

die(`unknown command "${cmd}". Use: (none) | status | set | page | zipify | shopify`);
