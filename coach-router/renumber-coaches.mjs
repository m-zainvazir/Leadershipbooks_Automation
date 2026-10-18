#!/usr/bin/env node
/**
 * renumber-coaches.mjs — give authors new codes without breaking anything live.
 *
 *   node renumber-coaches.mjs --map 1042=1001,1043=1002,1044=1003            # dry: the plan
 *   node renumber-coaches.mjs --map 1042=1001,1043=1002,1044=1003 --write    # coaches.json + local state
 *   npm run push                                                              # the Worker learns the new codes
 *   node renumber-coaches.mjs --prune-kv [--write]                            # remove the old coach:<code> entries
 *
 * WHY THIS IS SAFE. The old code lives on in places nothing here rewrites: KV
 * trial records, SMS sessions, activation tokens, access leases, the coach
 * pages' COACH_CODE, and the coach_code field on GHL contacts. So every
 * renumbered coach keeps its old codes in `formerCodes`, and the Worker (since
 * 2026-10-02) finds the coach by either. The leases and the entitlement map are
 * rewritten with the new codes by the next reconcile on their own.
 *
 * Order matters, and `--write` prints it:
 *   1. the Worker must already understand formerCodes (deployed first)
 *   2. --write here: coaches.json (backed up, seed-validated, restored on refusal)
 *      and onboarding-state.local.json (sign-offs and test results move to the new code)
 *   3. npm run push: secrets FIRST in practice (sync-secrets puts the key under
 *      VF_KEY_<new>), then seed — see the printed order
 *   4. --prune-kv --write: deletes coach:<old>, only where coach:<new> is already live
 *
 * Decided 2026-10-02 (Muhammad): 1042 -> 1001, 1043 -> 1002, 1044 -> 1003, new authors from 1004.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { loadConfig, HERE } from './lib-config.mjs';
import { saveRegistry, STATE_FILE } from './lib-registry.mjs';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const valOf = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined;
};
const WRITE = has('--write');
const die = (msg) => {
  console.error(`\n${msg}\n`);
  process.exit(1);
};
const IS_WIN = process.platform === 'win32';
const wrangler = (args) => execFileSync(IS_WIN ? 'npx.cmd' : 'npx', ['wrangler', ...args], { cwd: HERE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: IS_WIN });
const kv = ['--binding=COACH_KV', '--remote', '--preview=false'];

let config;
try {
  config = loadConfig();
} catch (err) {
  die(err.message);
}
const { coaches } = config;

/** "1042=1001,1043=1002" -> [['1042','1001'], ...], every rule checked before anything is written. */
export function planRenumber(coachList, mapText) {
  const pairs = String(mapText || '').split(',').map((x) => x.trim()).filter(Boolean).map((x) => x.split('=').map((y) => y.trim()));
  const problems = [];
  if (!pairs.length) problems.push('give --map old=new,old=new');
  const olds = new Set();
  const news = new Set();
  for (const [o, n] of pairs) {
    if (!/^\d{4}$/.test(o || '') || !/^\d{4}$/.test(n || '')) { problems.push(`"${o}=${n}": both codes must be four digits`); continue; }
    if (!coachList.some((c) => c.code === o)) problems.push(`${o} is not a current code`);
    if (olds.has(o)) problems.push(`${o} appears twice`);
    if (news.has(n)) problems.push(`${n} is given to two authors`);
    olds.add(o);
    news.add(n);
  }
  for (const n of news) {
    const holder = coachList.find((c) => c.code === n && !olds.has(c.code));
    if (holder) problems.push(`${n} already belongs to ${holder.displayName || holder.name}`);
    const was = coachList.find((c) => (c.formerCodes || []).map(String).includes(n));
    if (was) problems.push(`${n} is a former code of ${was.displayName || was.name} — old codes still lead to them`);
  }
  return { pairs, problems };
}

/* --------------------------------------------------------------- prune KV --- */

if (has('--prune-kv')) {
  // Only an old entry whose replacement is already in KV is removed. The Worker
  // ignores a superseded entry anyway; this just keeps KV tidy.
  const targets = coaches.flatMap((c) => (c.formerCodes || []).map((old) => ({ old: String(old), now: c.code, name: c.displayName || c.name })));
  if (!targets.length) die('No coach has formerCodes — nothing to prune.');
  console.log(`\nOld coach entries in KV${WRITE ? '' : '   (DRY RUN)'}\n`);
  let bad = 0;
  for (const t of targets) {
    let live = false;
    let stale = false;
    try { live = !!JSON.parse(wrangler(['kv', 'key', 'get', `coach:${t.now}`, ...kv])); } catch { live = false; }
    try { stale = !!JSON.parse(wrangler(['kv', 'key', 'get', `coach:${t.old}`, ...kv])); } catch { stale = false; }
    if (!stale) { console.log(`  · coach:${t.old}  already gone (${t.name} is coach:${t.now})`); continue; }
    if (!live) { console.log(`  ✗ coach:${t.old}  KEPT — coach:${t.now} is not in KV yet. Run npm run push first.`); bad++; continue; }
    if (WRITE) wrangler(['kv', 'key', 'delete', `coach:${t.old}`, ...kv]);
    console.log(`  ✓ coach:${t.old}  ${WRITE ? 'deleted' : 'would be deleted'} — ${t.name} is coach:${t.now}`);
  }
  console.log(WRITE ? '' : '\nDry run. Re-run with --write to delete.\n');
  process.exit(bad ? 1 : 0);
}

/* --------------------------------------------------------------- renumber --- */

const { pairs, problems } = planRenumber(coaches, valOf('--map'));
console.log(`\nRenumber${WRITE ? '' : '   (DRY RUN — nothing written)'}\n`);
for (const [o, n] of pairs) {
  const c = coaches.find((x) => x.code === o);
  if (c) console.log(`  ${o} -> ${n}   ${c.displayName || c.name}   (keeps ${o} as a former code)`);
}
if (problems.length) die(`REFUSING — nothing written:\n  x ${problems.join('\n  x ')}`);
if (!WRITE) {
  console.log('\nDry run only. Re-run with --write.\n');
  process.exit(0);
}

const map = new Map(pairs);
const { backup, warnings } = saveRegistry((doc) => {
  for (const c of doc.coaches) {
    const n = map.get(String(c.code));
    if (!n) continue;
    c.formerCodes = [...new Set([...(Array.isArray(c.formerCodes) ? c.formerCodes.map(String) : []), String(c.code)])];
    c.code = n;
  }
}, { label: 'renumber' });
console.log(`\n  coaches.json renumbered   (backup: ${backup})`);
for (const w of warnings) console.log(`    ${w}`);

// Sign-offs and the last verify-author result follow the author to the new code.
if (existsSync(STATE_FILE)) {
  const state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  copyFileSync(STATE_FILE, `${STATE_FILE}.bak-renumber`);
  for (const [o, n] of map) {
    if (state[o] && !state[n]) { state[n] = state[o]; delete state[o]; }
  }
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  console.log('  onboarding-state.local.json: sign-offs and test results moved to the new codes');
}

console.log(`
Next, in this order:
  1. npm run secrets                              the Voiceflow key under the new VF_KEY_<code> names
  2. npm run seed                                 the new coach:<code> entries (old ones are ignored from now on)
  3. node renumber-coaches.mjs --prune-kv --write remove the old coach:<code> entries
  4. npm run subs -- --sync                       rewrite the leases with the new codes now, not in 15 minutes
  5. npm run author                               every author, checked live
Coach pages keep working with their old COACH_CODE. Re-paste them (dashboard Onboard → Coach page, or npm run pipeline -- page --code <new> --copy) when convenient.
`);
