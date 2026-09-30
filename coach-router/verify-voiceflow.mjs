#!/usr/bin/env node
/**
 * verify-voiceflow.mjs — prove each coach's projectID/versionID/API key triple
 * actually works, before a real subscriber finds out that it doesn't.
 *
 * This is the check for the "version does not exist" trap: Voiceflow exposes a
 * draft version ID, a main-environment ID and a published version ID, they look
 * identical, and nothing in this repo can tell them apart. Only the runtime can.
 *
 *   node verify-voiceflow.mjs                 # verify every coach in coaches.json
 *   node verify-voiceflow.mjs --code 1042     # just one
 *   node verify-voiceflow.mjs --from-kv       # verify what is actually IN KV
 *   node verify-voiceflow.mjs --dry           # show what would be called, call nothing
 *   node verify-voiceflow.mjs --version production   # try a candidate ID, file unchanged
 *   node verify-voiceflow.mjs --keep-state    # don't delete the probe conversation
 *
 * It mirrors coach-router.worker.js exactly — same runtime host, same headers,
 * same launch action, same config — so a pass here means the Worker's first turn
 * will work, and a failure here is the failure the Worker would have hit.
 *
 * COST: one Voiceflow request per coach (a launch is billable). A rounding
 * error, but it is not zero. Use --dry to see the plan without spending.
 *
 * CONFIG: everything comes from coaches.json — codes, IDs and keys alike. An
 * environment variable of the same name (VF_KEY_<CODE>) overrides the file, so
 * CI can inject without one existing. Keys are never printed or passed as an
 * argument.
 */

import { execFileSync } from 'node:child_process';
import { loadConfig, HERE } from './lib-config.mjs';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const valOf = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

// Kept identical to the Worker's constants and request shape.
const VF_RUNTIME = 'https://general-runtime.voiceflow.com';
const VF_CONFIG = { tts: false, stripSSML: true, stopAll: true, excludeTypes: ['block', 'debug', 'flow'] };

const DRY = has('--dry');
const FROM_KV = has('--from-kv');
const KEEP = has('--keep-state');
const ONLY = valOf('--code', null);
// Try a candidate versionID without editing coaches.json. Nothing is written
// anywhere, so this is the cheap way to find out which of Voiceflow's three
// version IDs is the right one before committing it to the file and to KV.
const VERSION_OVERRIDE = valOf('--version', null);
const BINDING = 'COACH_KV';
const IS_WIN = process.platform === 'win32';

/* ------------------------------------------------------------ registry loading */

function wrangler(args) {
  return execFileSync(IS_WIN ? 'npx.cmd' : 'npx', ['wrangler', ...args], {
    cwd: HERE,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    shell: IS_WIN,
  });
}

function fromKV() {
  const list = JSON.parse(wrangler(['kv', 'key', 'list', `--binding=${BINDING}`, '--remote', '--preview=false']));
  const coaches = [];
  for (const k of list.filter((k) => k.name.startsWith('coach:'))) {
    const raw = wrangler(['kv', 'key', 'get', k.name, `--binding=${BINDING}`, '--remote', '--preview=false']);
    coaches.push({ code: k.name.slice(6), ...JSON.parse(raw) });
  }
  return coaches;
}

function fromConfigFile() {
  return loadConfig().coaches;
}

/**
 * KV holds no keys by design, so a --from-kv run still needs coaches.json for
 * the key. Match on code and carry it over.
 */
function withKeys(kvCoaches) {
  const local = new Map(loadConfig({ allowMissing: true }).coaches.map((c) => [String(c.code), c]));
  return kvCoaches.map((c) => ({
    ...c,
    keyVar: c.keyVar || `VF_KEY_${c.code}`,
    apiKey: process.env[c.keyVar || `VF_KEY_${c.code}`] || local.get(String(c.code))?.apiKey || '',
  }));
}

/* ----------------------------------------------------------------------- probe */

async function probe(coach, apiKey) {
  // A userID distinct per coach and obviously synthetic, so a stray probe
  // conversation is recognisable in the Voiceflow transcript list.
  const userID = `verify-preflight-${coach.code}`;
  const headers = {
    Authorization: apiKey,
    'content-type': 'application/json',
    accept: 'application/json',
    versionID: coach.versionID || 'production',
  };

  const res = await fetch(`${VF_RUNTIME}/state/${encodeURIComponent(coach.versionID || 'production')}/user/${encodeURIComponent(userID)}/interact`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      action: { type: 'launch', payload: { channel: 'sms', coach_code: coach.code } },
      config: VF_CONFIG,
    }),
  });

  const text = await res.text();
  let traces = [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) traces = parsed;
  } catch {
    /* non-JSON body: reported raw below */
  }

  if (!KEEP && res.ok) {
    // Leave no probe state behind, so the first real subscriber on this coach
    // gets a genuine first turn rather than resuming the preflight.
    await fetch(`${VF_RUNTIME}/state/${encodeURIComponent(coach.versionID || 'production')}/user/${encodeURIComponent(userID)}`, { method: 'DELETE', headers })
      .catch(() => {});
  }

  return { ok: res.ok, status: res.status, body: text, traces, userID };
}

/** Pull the spoken/written text out of a trace array, the way the Worker does. */
function traceText(traces) {
  return traces
    .filter((t) => t && (t.type === 'text' || t.type === 'speak'))
    .map((t) => (t.payload && (t.payload.message || t.payload.text)) || '')
    .filter(Boolean);
}

/* ------------------------------------------------------------------------ main */

let coaches;
try {
  coaches = FROM_KV ? withKeys(fromKV()) : fromConfigFile();
} catch (err) {
  console.error(`\nCould not read the registry: ${err.message}`);
  process.exit(1);
}

if (ONLY) coaches = coaches.filter((c) => String(c.code) === String(ONLY));
if (!coaches.length) {
  console.error(ONLY ? `No coach with code "${ONLY}".` : 'No coaches found.');
  process.exit(1);
}

console.log(`\nVerifying ${coaches.length} coach(es) against ${VF_RUNTIME}`);
console.log(`source: ${FROM_KV ? 'KV (production namespace), keys from coaches.json' : 'coaches.json'}\n`);

let failures = 0;
let skipped = 0;

for (const coach of coaches) {
  const version = VERSION_OVERRIDE || coach.versionID || 'production';
  if (VERSION_OVERRIDE) coach.versionID = VERSION_OVERRIDE;
  console.log(`coach:${coach.code}  ${coach.name || '(no name)'}`);
  console.log(`  projectID  ${coach.projectID || '(unset)'}`);
  console.log(`  versionID  ${version}${VERSION_OVERRIDE ? '   (--version override, coaches.json unchanged)' : ''}`);

  const apiKey = coach.apiKey;
  if (!apiKey || /^TODO_/.test(apiKey)) {
    console.log(`  SKIP       no key — set "vfKey" for code ${coach.code} in coaches.json\n`);
    skipped++;
    continue;
  }
  console.log(`  key        ${coach.keyVar} found (${apiKey.length} chars)`);

  if (DRY) {
    console.log(`  DRY        would POST ${VF_RUNTIME}/state/${coach.versionID || 'production'}/user/verify-preflight-${coach.code}/interact`);
    console.log(`             with header versionID: ${version}\n`);
    continue;
  }

  let result;
  try {
    result = await probe(coach, apiKey);
  } catch (err) {
    console.log(`  FAIL       network error: ${err.message}\n`);
    failures++;
    continue;
  }

  if (!result.ok) {
    console.log(`  FAIL       HTTP ${result.status}`);
    console.log(`             ${result.body.slice(0, 300).replace(/\s+/g, ' ')}`);
    if (/version/i.test(result.body)) {
      console.log(`             -> versionID "${version}" is wrong for this key. In Voiceflow,`);
      console.log(`                the draft version ID, the main environment ID and the`);
      console.log(`                published version ID are three different values. Use the`);
      console.log(`                published one, or the literal string "production".`);
    } else if (result.status === 401 || result.status === 403) {
      console.log(`             -> ${coach.keyVar} is not a valid Dialog API key for this project.`);
    }
    console.log('');
    failures++;
    continue;
  }

  const lines = traceText(result.traces);
  console.log(`  OK         HTTP 200, ${result.traces.length} trace(s)`);
  if (!lines.length) {
    console.log(`  WARN       launch produced no text — check the agent actually starts on launch`);
  }
  for (const l of lines.slice(0, 2)) {
    console.log(`             "${l.slice(0, 140).replace(/\s+/g, ' ')}${l.length > 140 ? '…' : ''}"`);
  }
  console.log(`             ^ confirm this is ${coach.name || 'the right author'} speaking, not another coach\n`);
}

const verb = DRY ? 'planned' : 'verified';
console.log(`${coaches.length - failures - skipped} ${verb}, ${failures} failed, ${skipped} skipped\n`);
// Set the code rather than calling process.exit(): on Windows, exiting while
// the fetch keep-alive handles are still closing prints a libuv assertion
// warning after the report, which reads like a crash and isn't one.
process.exitCode = failures ? 1 : 0;
