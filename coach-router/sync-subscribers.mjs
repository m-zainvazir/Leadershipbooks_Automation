#!/usr/bin/env node
/**
 * sync-subscribers.mjs — inspect and drive subscriber entitlement.
 *
 *   node sync-subscribers.mjs                 # status: last sync, counts, mode
 *   node sync-subscribers.mjs --dry           # reconcile, report, write nothing
 *   node sync-subscribers.mjs --sync          # reconcile for real
 *   node sync-subscribers.mjs --sync --force  # ...overriding the mass-revoke guard
 *   node sync-subscribers.mjs --list          # what is actually in KV
 *   node sync-subscribers.mjs --list --preview
 *
 * The reconcile itself lives in the Worker and runs on a cron. This script does
 * NOT reimplement it — it calls POST /admin/reconcile, so there is exactly one
 * implementation and no chance of the two drifting. That endpoint is gated by
 * HEALTH_TOKEN and fails closed.
 *
 * --force overrides the guard that refuses to revoke a majority of subscribers
 * in one run. That guard exists because a partial GHL response is
 * indistinguishable from mass churn. Only force when you know the churn is real.
 *
 * CONFIG: worker URL and health token come from coaches.json. Keys are never
 * printed or passed as an argument.
 */

import { execFileSync } from 'node:child_process';
import { loadConfig, HERE } from './lib-config.mjs';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);

const DRY = has('--dry');
const SYNC = has('--sync');
const FORCE = has('--force');
const LIST = has('--list');
const PREVIEW = has('--preview');
const BINDING = 'COACH_KV';
const IS_WIN = process.platform === 'win32';

const { shared } = loadConfig();
const token = shared.healthToken || '';
const base = String(shared.workerUrl || '').replace(/\/+$/, '');

function requireConfig() {
  const missing = [];
  if (!base) missing.push('shared.workerUrl');
  if (!token) missing.push('shared.healthToken');
  if (missing.length) {
    console.error(`\nMissing in coaches.json: ${missing.join(', ')}\n`);
    process.exit(1);
  }
}

function wrangler(args) {
  return execFileSync(IS_WIN ? 'npx.cmd' : 'npx', ['wrangler', ...args], {
    cwd: HERE,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    shell: IS_WIN,
  });
}

const nsFlags = () => (PREVIEW ? ['--remote', '--preview'] : ['--remote', '--preview=false']);

/* --------------------------------------------------------------- --list ---- */

if (LIST) {
  const out = wrangler(['kv', 'key', 'list', `--binding=${BINDING}`, ...nsFlags()]);
  const keys = JSON.parse(out).map((k) => k.name);
  const group = (p) => keys.filter((k) => k.startsWith(p)).sort();

  const subs = group('sub:');
  const binds = group('bind:');
  const archs = group('arch:');

  console.log(`\n${PREVIEW ? 'PREVIEW' : 'production'} KV\n`);
  console.log(`  entitled (sub:)  ${subs.length}`);
  for (const k of subs) {
    const v = JSON.parse(wrangler(['kv', 'key', 'get', k, `--binding=${BINDING}`, ...nsFlags()]));
    const left = Math.round((new Date(v.expires).getTime() - Date.now()) / 3600000);
    console.log(`    ${k.slice(4).padEnd(16)} codes=${(v.codes || []).join(',') || '(none)'}  lease ${left}h left  contact=${v.contactId}`);
  }

  console.log(`\n  linked handsets (bind:)  ${binds.length}`);
  for (const k of binds) console.log(`    ${k.slice(5)}`);

  console.log(`\n  archived (arch:)  ${archs.length}`);
  for (const k of archs) {
    const v = JSON.parse(wrangler(['kv', 'key', 'get', k, `--binding=${BINDING}`, ...nsFlags()]));
    const due = Math.round((new Date(v.dueAt).getTime() - Date.now()) / 86400000);
    console.log(`    ${k.slice(5).padEnd(16)} revoked ${String(v.revokedAt).slice(0, 10)}  deletes in ${due}d  stateDeleted=${v.stateDeleted}`);
  }
  console.log('');
  process.exit(0);
}

/* ----------------------------------------------------------- reconcile ---- */

requireConfig();

if (SYNC || DRY) {
  const qs = [DRY ? 'dry=1' : null, FORCE ? 'force=1' : null].filter(Boolean).join('&');
  const url = `${base}/admin/reconcile${qs ? `?${qs}` : ''}`;

  if (FORCE && !DRY) {
    console.log('\n  --force: the mass-revocation guard is OFF for this run.\n');
  }

  const res = await fetch(url, { method: 'POST', headers: { 'x-health-token': token } });
  const body = await res.json().catch(() => ({}));

  console.log(`\n${DRY ? 'Dry run' : 'Reconcile'} — HTTP ${res.status}\n`);
  console.log(`  tags seen          ${body.tags ?? '?'}`);
  console.log(`  coach products     ${body.products ?? '?'}`);
  console.log(`  active subs        ${body.subscriptions ?? '?'}   (paying right now)`);
  console.log(`  entitled contacts  ${body.contacts ?? '?'}`);
  console.log(`  granted            ${body.granted ?? 0}`);
  console.log(`  renewed            ${body.renewed ?? 0}`);
  console.log(`  unchanged          ${body.unchanged ?? 0}   (cost no write)`);
  console.log(`  revoked            ${body.revoked ?? 0}`);
  if (body.refusedRevoke) console.log(`  REFUSED to revoke  ${body.refusedRevoke}   <- guard tripped`);
  console.log(`  entitlements published  ${body.entitlementsPublished ?? 0}   (centitle: map)`);
  console.log(`  entitlements retired    ${body.entitlementsRemoved ?? 0}`);
  if (body.refusedEntitlementRemoval)
    console.log(`  REFUSED to retire  ${body.refusedEntitlementRemoval}   <- guard tripped`);
  console.log(`  KV writes          ${body.writes ?? 0}`);

  if ((body.errors || []).length) {
    console.log('\n  problems:');
    for (const e of body.errors) console.log(`    x ${e}`);
  }

  if (body.contacts && !body.granted && !body.renewed && !body.unchanged) {
    console.log(
      `\n  Note: ${body.contacts} contact(s) are entitled but none has a linked handset,\n` +
        `  so nobody can text or call yet. A handset links either by texting the\n` +
        `  activation code, or automatically if the contact carries a phone number.`
    );
  }
  if (body.products && body.subscriptions === 0) {
    console.log(
      `\n  Note: no ACTIVE subscriptions. Access is coming from tags only, which is\n` +
        `  expected until the first real purchase through the GHL funnel.`
    );
  }

  console.log('');
  process.exitCode = body.ok ? 0 : 1;
} else {
  const res = await fetch(`${base}/health`, { headers: { 'x-health-token': token } });
  const j = await res.json().catch(() => ({}));
  const s = j.sync || {};

  console.log(`\nWorker  ${base}`);
  console.log(`  health           ${j.ok ? 'ok' : 'PROBLEMS'}  (${(j.problems || []).length} problem(s))`);
  console.log(`  entitlement mode ${s.entitlementMode ?? '?'}`);

  if (!s.lastRunAt) {
    console.log(`  last sync        never — the cron has not run yet`);
  } else {
    console.log(`  last sync        ${s.lastRunAt}  (${s.ageMinutes}m ago)  ${s.lastOk ? 'ok' : 'FAILED'}`);
    console.log(`  counts           ${JSON.stringify(s.counts || {})}`);
    if ((s.errors || []).length) for (const e of s.errors) console.log(`    x ${e}`);
  }

  console.log(`\n  --dry to preview a reconcile, --sync to run one, --list to inspect KV\n`);
}
