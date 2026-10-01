#!/usr/bin/env node
/**
 * verify-author.mjs — prove a coach's trial path end to end, from the Worker on.
 *
 *   npm run verify-author -- --code 1044 --email you@yourdomain.com           # dry: the plan
 *   npm run verify-author -- --code 1044 --email you@yourdomain.com --write   # run it
 *   ...add --keep to leave the test contact in place for inspection
 *
 * --write:
 *   1. refuses unless the per-run address (you+verify-<code>-<stamp>@...) is new to GHL
 *   2. POSTs a synthetic order to /shopify/order with X-Coach-Token (Flow's path)
 *   3. waits out GHL's ~20 s search-index lag to find the contact, then reads
 *      it BY ID, which is authoritative
 *   4. checks both tags, all ten fields and the KV trial record against the registry
 *   5. deletes the contact, confirms it is gone, and removes the trial: and
 *      shop: KV records — so nothing is left entitled
 *
 * 🚨 It sends a REAL welcome email to that address, and if the author's grant
 * workflow is live, a real Course360 invite. That is the point — check the inbox —
 * and it is why the address must be one you own.
 *
 * It does NOT exercise Shopify Flow or Zipify. See LIMITS_NOTICE.
 *
 * Plan: ../ghl-shopify subscription/plans/21-onboarding-automation.md §C
 */

import { execFileSync } from 'node:child_process';
import { loadConfig, HERE } from './lib-config.mjs';
import { recordVerify } from './lib-registry.mjs';
import { __test } from './coach-router.worker.js';
import {
  testEmail, emailProblems, orderPayload, coachProblems, checkContact, checkTrialRecord, formatTable, LIMITS_NOTICE, LIMITS_NOTICE_ORDER,
} from './lib-verify-author.mjs';
import { connectShopify, shopifyConfig, placeTestOrder, cancelTestOrder, DELIVERED_TAG } from './lib-shopify.mjs';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const valOf = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined;
};

const WRITE = has('--write');
const KEEP = has('--keep');
// A real $0 Shopify order instead of a direct POST: exercises Flow B too.
const SHOP = has('--shopify-order');
const FLOW_SOURCE = 'shopify_flow_manual';
const GHL_API = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const BINDING = 'COACH_KV';
const IS_WIN = process.platform === 'win32';
// Flow adds its own latency on top of GHL's ~20 s search lag.
const SEARCH_TIMEOUT_MS = SHOP ? 300_000 : 120_000;
const POLL_MS = 5_000;
const EMAIL_GRACE_MS = 60_000;

const die = (msg) => {
  console.error(`\n${msg}\n`);
  process.exit(1);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ inputs --- */

const code = valOf('--code');
if (!code) die('Missing --code.\n\n  npm run verify-author -- --code 1044 [--email you@yourdomain.com]');

let config;
try {
  config = loadConfig();
} catch (err) {
  die(err.message);
}
const { shared, coaches } = config;
// --email wins; otherwise the saved test inbox (npm run author -- config --verifyEmail ...).
const baseEmail = valOf('--email') || shared.verifyEmail;
const coach = coaches.find((c) => c.code === String(code));
const workerUrl = String(shared.workerUrl || '').replace(/\/+$/, '');

const problems = [...coachProblems(coach), ...emailProblems(baseEmail)];
for (const [k, v] of [['workerUrl', workerUrl], ['flowSharedSecret', shared.flowSharedSecret], ['ghlApiToken', shared.ghlApiToken], ['ghlLocationId', shared.ghlLocationId]]) {
  if (!v) problems.push(`coaches.json shared.${k} is required`);
}
if (SHOP) {
  const sc = shopifyConfig(shared);
  if (sc.missing.length) problems.push(`--shopify-order needs ${sc.missing.join(', ')} in coaches.json (plans/21 §D)`);
  if (coach && !coach.shopifyVariantId) problems.push(`coach ${coach.code} has no shopifyVariantId — npm run author -- status --code ${coach.code} prints the set command`);
}
if (problems.length) {
  console.error('\nREFUSING — nothing was sent:\n');
  for (const p of problems) console.error(`  x ${p}`);
  die('');
}

const now = new Date();
const email = testEmail(baseEmail, coach.code, now);
const payload = orderPayload({ coach, email, now });

/* -------------------------------------------------------------- clients ------ */

async function ghl(path, { method = 'GET', body = null, allow4xx = false } = {}) {
  const res = await fetch(`${GHL_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${shared.ghlApiToken}`,
      Version: GHL_VERSION,
      accept: 'application/json',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (allow4xx && res.status >= 400 && res.status < 500) return { __status: res.status };
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 200);
    throw new Error(`GHL ${res.status} on ${method} ${path.split('?')[0]}: ${detail}`);
  }
  return res.json().catch(() => ({}));
}

const findByEmail = async (e) => {
  const data = await ghl('/contacts/search', {
    method: 'POST',
    body: { locationId: shared.ghlLocationId, pageLimit: 1, filters: [{ field: 'email', operator: 'eq', value: e }] },
  });
  return Array.isArray(data.contacts) && data.contacts.length ? data.contacts[0] : null;
};

function wrangler(args) {
  return execFileSync(IS_WIN ? 'npx.cmd' : 'npx', ['wrangler', ...args, `--binding=${BINDING}`, '--remote', '--preview=false'], {
    cwd: HERE,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: IS_WIN,
  });
}
const kvGet = (key) => {
  try {
    return JSON.parse(wrangler(['kv', 'key', 'get', key]));
  } catch {
    return null; // wrangler exits non-zero on "Value not found"
  }
};
const kvDelete = (key) => {
  try {
    wrangler(['kv', 'key', 'delete', key]);
    return true;
  } catch {
    return false;
  }
};

/* ------------------------------------------------------------------- plan ---- */

console.log(`\nverify-author — coach ${coach.code} ${coach.displayName || coach.name}${WRITE ? '' : '   (DRY RUN — nothing sent)'}\n`);
if (SHOP) {
  console.log(`  path            a REAL $0 Shopify order (100% discount), tagged ${DELIVERED_TAG} -> Flow B -> Worker -> GHL`);
  console.log(`  order           variant ${coach.shopifyVariantId} on ${shared.shopifyShop} — CANCELLED afterwards, always`);
} else {
  console.log(`  endpoint        POST ${workerUrl}/shopify/order   (X-Coach-Token, as Shopify Flow sends)`);
  console.log(`  order           ${payload.order_id}   product ${coach.shopifyProductId}`);
}
console.log(`  test address    ${email}`);
console.log(`  afterwards      ${KEEP ? 'KEEP the contact (--keep): it stays tagged and ENTITLED until you delete it' : 'delete the contact and its trial:/shop: KV records'}`);
console.log(`\n  ⚠ This sends the real welcome email to ${email}${coach.courseLessonUrl ? ' and, if the grant workflow is live, a Course360 invite' : ''}.`);

if (!WRITE) {
  console.log('\nDry run only. Re-run with --write to send it.\n');
  process.exit(0);
}

/* -------------------------------------------------------------------- run ---- */

// The contact this run deletes must be one this run created. Checked before
// sending, so a clash costs nothing.
if (await findByEmail(email)) die(`${email} already exists in GHL — refusing, because this tool deletes the contact it verifies.`);

const rows = [];
let endpointOk = false;
let orderNumber = payload.order_number;
let shopKey = `shop:${payload.order_id}`;
let shopOrder = null;
let gql = null;

if (SHOP) {
  console.log('\n  placing the $0 order…');
  try {
    const conn = await connectShopify(shared);
    if (conn.lacking.length) throw new Error(`the Shopify app is missing scopes: ${conn.lacking.join(', ')}`);
    gql = conn.gql;
    shopOrder = await placeTestOrder(gql, { variantId: coach.shopifyVariantId, email });
    orderNumber = shopOrder.orderName;
    // The Worker keys idempotency on the bare order number (normalizeOrderId).
    shopKey = `shop:${shopOrder.orderId}`;
    const tagged = shopOrder.tags.map((x) => String(x).toLowerCase()).includes(DELIVERED_TAG);
    rows.push({ check: 'order placed, tagged for Flow B', expected: DELIVERED_TAG, actual: `${shopOrder.orderName} tags [${shopOrder.tags.join(', ')}]`, status: tagged ? 'PASS' : 'FAIL' });
    endpointOk = tagged;
  } catch (err) {
    rows.push({ check: 'order placed, tagged for Flow B', expected: 'an order', actual: err.message, status: 'FAIL' });
  }
} else {
  console.log('\n  sending the order…');
  const res = await fetch(`${workerUrl}/shopify/order`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Coach-Token': shared.flowSharedSecret },
    body: JSON.stringify(payload),
  });
  const out = await res.json().catch(() => ({}));
  endpointOk = res.status === 200 && out.ok === true && out.matched === 1 && Array.isArray(out.codes) && out.codes.includes(coach.code);
  rows.push({ check: 'endpoint response', expected: `200 matched 1 [${coach.code}]`, actual: `${res.status} ${JSON.stringify(out)}`, status: endpointOk ? 'PASS' : 'FAIL' });
}

let contact = null;
if (endpointOk) {
  // The search index lags ~20 s behind a create (plans/20 §9d). Poll it only
  // to learn the id; every assertion below reads the contact by id.
  const until = Date.now() + SEARCH_TIMEOUT_MS;
  let found = null;
  while (!found && Date.now() < until) {
    await sleep(POLL_MS);
    found = await findByEmail(email);
    process.stdout.write('.');
  }
  process.stdout.write('\n');
  if (found) {
    // The grant runs in the Worker's waitUntil; give the tag PUT a moment.
    for (let i = 0; i < 6; i++) {
      contact = (await ghl(`/contacts/${encodeURIComponent(found.id)}`)).contact;
      if (contact && (contact.tags || []).includes(coach.ghlTag)) break;
      await sleep(POLL_MS);
    }
  }
  if (!contact) rows.push({ check: 'contact created', expected: email, actual: `(not found after ${SEARCH_TIMEOUT_MS / 1000}s)`, status: 'FAIL' });
}

if (contact) {
  rows.push({ check: 'contact created', expected: email, actual: contact.id, status: 'PASS' });
  rows.push(...checkContact(contact, coach, { orderNumber, now, formatTrialEnd: __test.formatTrialEnd, source: SHOP ? FLOW_SOURCE : undefined }));
  rows.push(checkTrialRecord(kvGet(`trial:${contact.id}:${coach.code}`), coach, contact.id));
}

/* ---------------------------------------------------------------- cleanup ---- */

// 🚨 ALWAYS cancel a real test order, pass or fail, --keep or not. Flow A also
// fired (Order paid) and is waiting 21 days; its guard only stops a CANCELLED
// order. Uncancelled, it re-creates this contact with a live trial in 3 weeks.
if (shopOrder) {
  try {
    await cancelTestOrder(gql, shopOrder.orderGid);
    rows.push({ check: 'cleanup: test order cancelled (stops Flow A)', expected: 'cancelled', actual: shopOrder.orderName, status: 'PASS' });
  } catch (err) {
    rows.push({ check: 'cleanup: test order cancelled (stops Flow A)', expected: 'cancelled', actual: `${err.message} — CANCEL ${shopOrder.orderName} BY HAND NOW`, status: 'FAIL' });
  }
}

// Give GHL time to SEND before the contact disappears: the welcome email and
// the Course360 grant are workflow actions on this contact, and a contact
// deleted first gets neither — which would look like a broken email.
if (contact && !KEEP && !has('--no-wait')) {
  console.log(`\n  waiting ${EMAIL_GRACE_MS / 1000}s so GHL sends the welcome email before cleanup (--no-wait skips)…`);
  await sleep(EMAIL_GRACE_MS);
}

// Left in place a test contact is tagged, so the next reconcile grants it a
// renewing lease, and it counts as a customer in every census (runbook §12).
if (contact && !KEEP) {
  const createdThisRun = Date.parse(contact.dateAdded) >= now.getTime() - 60_000 && String(contact.email).toLowerCase() === email;
  if (!createdThisRun) {
    rows.push({ check: 'cleanup', expected: 'a contact this run created', actual: `${contact.id} predates the run — NOT deleted`, status: 'FAIL' });
  } else {
    await ghl(`/contacts/${encodeURIComponent(contact.id)}`, { method: 'DELETE' });
    const gone = await ghl(`/contacts/${encodeURIComponent(contact.id)}`, { allow4xx: true });
    // GHL answers a deleted id with 400, not 404.
    rows.push({ check: 'cleanup: contact deleted', expected: '4xx on read-back', actual: gone.__status ? String(gone.__status) : 'still readable', status: gone.__status ? 'PASS' : 'FAIL' });
    const kvOk = kvDelete(`trial:${contact.id}:${coach.code}`) && kvDelete(shopKey);
    rows.push({ check: 'cleanup: trial:/shop: KV records', expected: 'deleted', actual: kvOk ? 'deleted' : 'delete failed — the sweep removes trial: as an orphan', status: kvOk ? 'PASS' : 'WARN' });
  }
}

/* ----------------------------------------------------------------- report ---- */

const failed = rows.filter((r) => r.status === 'FAIL').length;
const warned = rows.filter((r) => r.status === 'WARN').length;
console.log(`\n${formatTable(rows)}\n`);
console.log(`  ${failed ? `FAILED — ${failed} check(s)` : 'PASSED'}${warned ? `, ${warned} warning(s) (registry values not filled in yet)` : ''}`);
console.log(`\n  Now check ${email}: the welcome email should name ${coach.displayName || coach.name} and link to their lesson.`);
console.log(`\n  ${SHOP ? LIMITS_NOTICE_ORDER : LIMITS_NOTICE}\n`);
// Feeds the "Tested" column of `npm run author`. Local and gitignored.
recordVerify(coach.code, { at: new Date().toISOString(), passed: !failed, warnings: warned, via: SHOP ? 'shopify-order' : 'endpoint' });
process.exit(failed ? 1 : 0);
