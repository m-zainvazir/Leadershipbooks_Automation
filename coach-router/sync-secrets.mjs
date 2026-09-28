#!/usr/bin/env node
/**
 * sync-secrets.mjs — push the keys in coaches.json to Cloudflare Worker secrets.
 *
 *   node sync-secrets.mjs                # dry run: list what would be pushed
 *   node sync-secrets.mjs --write        # push to the deployed Worker
 *   node sync-secrets.mjs --dev-vars     # write .dev.vars for `wrangler dev`
 *   node sync-secrets.mjs --check        # compare coaches.json vs wrangler.toml vars
 *   node sync-secrets.mjs --verify-twilio  # prove the SID/token pair works, and
 *                                         # say whether it's a subaccount
 *
 * Pushes, in one `wrangler secret bulk` call:
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, HEYGEN_API_KEY   (shared)
 *   VF_KEY_<CODE>  for every coach with a vfKey set          (per coach)
 *
 * Secret VALUES are never printed, never passed as a command-line argument, and
 * the temp file they travel in is deleted in a finally block. Only names and
 * character counts are ever shown.
 *
 * `wrangler secret put` requires an already-deployed Worker. Run this after the
 * first `wrangler deploy`; before that, use --dev-vars for local work.
 */

import { writeFileSync, rmSync, mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig, SHARED_SECRETS, SHARED_VARS, isUsable, HERE } from './lib-config.mjs';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);

const WRITE = has('--write');
const DEV_VARS = has('--dev-vars');
const CHECK = has('--check');
const VERIFY_TWILIO = has('--verify-twilio');
const IS_WIN = process.platform === 'win32';

function wrangler(args) {
  return execFileSync(IS_WIN ? 'npx.cmd' : 'npx', ['wrangler', ...args], {
    cwd: HERE,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    shell: IS_WIN,
  });
}

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(`\n${err.message}`);
  process.exit(1);
}
const { shared, coaches } = config;

/* ------------------------------------------------------------------ collect --- */

const secrets = {};
for (const [secretName, field] of Object.entries(SHARED_SECRETS)) {
  if (isUsable(shared[field])) secrets[secretName] = shared[field].trim();
}
for (const coach of coaches) {
  if (isUsable(coach.apiKey)) secrets[coach.keyVar] = coach.apiKey.trim();
}

const missing = [
  ...Object.keys(SHARED_SECRETS).filter((n) => !secrets[n]),
  ...coaches.filter((c) => !secrets[c.keyVar]).map((c) => c.keyVar),
];

/* ----------------------------------------------------------- verify-twilio --- */

// Returns the process exit code rather than calling process.exit(): on Windows,
// exiting while fetch's sockets are still closing prints a libuv assertion after
// the report, which reads like a crash and isn't one.
async function verifyTwilio() {
  // The auth token must belong to the account that OWNS the phone number Twilio
  // calls the webhook from — inbound signatures are HMAC'd with that token. The
  // parent account's token on a subaccount's number fails every /twilio/*
  // request with a 403 that looks exactly like a bug in the Worker. So prove the
  // pair works, and say which kind of account it is.
  const sid = shared.twilioAccountSid || '';
  const token = shared.twilioAuthToken || '';

  console.log('\nTwilio credentials\n');
  if (!isUsable(sid) || !isUsable(token)) {
    console.log('  Not set yet — fill twilioAccountSid and twilioAuthToken in coaches.json.\n');
    return 1;
  }
  if (!/^AC[0-9a-f]{32}$/i.test(sid)) {
    console.log(`  x accountSid "${sid.slice(0, 6)}…" is not the right shape — it should be "AC" followed by 32 hex characters.`);
    console.log(`    (An "SK…" value is an API Key, not an Account SID. This needs the Account SID.)\n`);
    return 1;
  }

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
    headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64') },
  });

  if (res.status === 401) {
    console.log(`  x HTTP 401 — the auth token does not match this Account SID.`);
    console.log(`    Copy both from the SAME account page in the Twilio console.\n`);
    return 1;
  }
  if (!res.ok) {
    console.log(`  x HTTP ${res.status}: ${(await res.text()).slice(0, 200)}\n`);
    return 1;
  }

  const acct = await res.json();
  const owner = acct.owner_account_sid || acct.ownerAccountSid || null;
  const isSub = owner && owner !== acct.sid;

  console.log(`  ok  credentials valid`);
  console.log(`      friendlyName  ${acct.friendly_name || '(none)'}`);
  console.log(`      status        ${acct.status || '(unknown)'}`);
  console.log(`      type          ${isSub ? 'SUBACCOUNT' : 'parent / standalone account'}`);
  if (isSub) console.log(`      parent        ${owner}`);

  if (!isSub) {
    console.log(`
  i This is a parent account, not a subaccount — which is the DELIBERATE choice
    for this deployment. The approved A2P brand and campaign live on the parent,
    and isolating the coach number in a subaccount would require buying a new
    number there plus re-registering A2P.

    The risk a subaccount would have removed is that GoHighLevel/LeadConnector
    can import this account's numbers and rewrite their webhooks, killing the
    router with no error anywhere. That is handled instead by keeping the Twilio
    integration disconnected from GHL. If anyone reconnects it, re-check this
    number's webhooks first — see README step 6.`);
  }
  console.log('');
  return 0;
}

/* ----------------------------------------------------------------- dispatch --- */

if (VERIFY_TWILIO) {
  process.exitCode = await verifyTwilio();
} else if (CHECK) {
  // wrangler.toml holds the non-secret vars; coaches.json keeps a copy so there
  // is one place to look. Drift between them is a real deployment hazard, so
  // report it rather than silently trusting either side.
  const tomlPath = resolve(HERE, 'wrangler.toml');
  const toml = existsSync(tomlPath) ? readFileSync(tomlPath, 'utf8') : '';
  const tomlVar = (name) => {
    const m = new RegExp(`^\\s*${name}\\s*=\\s*"([^"]*)"`, 'm').exec(toml);
    return m ? m[1] : null;
  };

  console.log('\nwrangler.toml [vars] vs coaches.json "shared"\n');
  let drift = 0;
  for (const [name, field] of Object.entries(SHARED_VARS)) {
    const inToml = tomlVar(name);
    const inJson = shared[field] || '';
    const tomlBad = !inToml || /^TODO_/.test(inToml);
    const jsonBad = !isUsable(inJson);
    let verdict;
    if (tomlBad && jsonBad) verdict = 'both unset';
    else if (tomlBad) verdict = `MISSING in wrangler.toml (coaches.json has "${inJson}")`;
    else if (jsonBad) verdict = `only in wrangler.toml ("${inToml}")`;
    else if (inToml !== inJson) verdict = `DRIFT: toml="${inToml}" json="${inJson}"`;
    else verdict = 'match';
    if (verdict !== 'match') drift++;
    console.log(`  ${name.padEnd(22)} ${verdict}`);
  }
  console.log(
    drift
      ? `\n${drift} item(s) to reconcile. These vars are read from wrangler.toml at runtime,\n` +
          `so wrangler.toml is what actually matters — coaches.json is the note to self.\n`
      : '\nIn step.\n'
  );
} else if (DEV_VARS) {
  const path = resolve(HERE, '.dev.vars');
  const body =
    `# GENERATED by sync-secrets.mjs --dev-vars. Gitignored. Do not edit by hand —\n` +
    `# edit coaches.json and regenerate, or the two will drift.\n` +
    `# Used by \`wrangler dev\` and by verify-voiceflow.mjs.\n\n` +
    Object.entries(secrets)
      .map(([k, v]) => `${k}="${v}"`)
      .join('\n') +
    `\n\n# Local testing only — makes every /twilio/* endpoint publicly callable.\n` +
    `# Uncomment ONLY for \`wrangler dev\`; /health reports it whenever it is on.\n` +
    `# SKIP_TWILIO_VALIDATION="true"\n`;

  writeFileSync(path, body, 'utf8');
  console.log(`\nWrote .dev.vars with ${Object.keys(secrets).length} secret(s):`);
  for (const name of Object.keys(secrets)) console.log(`  ${name}`);
  if (missing.length) console.log(`\nStill empty in coaches.json: ${missing.join(', ')}`);
  console.log('');
} else {
  reportAndPush();
}

/* ------------------------------------------------------------------- report --- */

function reportAndPush() {
console.log(`\n${Object.keys(secrets).length} secret(s) ready to push:\n`);
for (const [name, value] of Object.entries(secrets)) {
  console.log(`  ${name.padEnd(24)} ${value.length} chars`);
}
if (missing.length) {
  console.log(`\n${missing.length} not set in coaches.json (skipped, not an error):\n`);
  for (const name of missing) console.log(`  ${name}`);
}

if (!Object.keys(secrets).length) {
  console.log(`\nNothing to push — fill in coaches.json first.\n`);
  process.exit(1);
}

if (!WRITE) {
  console.log(`\nDry run only. Nothing pushed. Re-run with --write.\n`);
  process.exit(0);
}

/* -------------------------------------------------------------------- write --- */

// `secret bulk` takes a JSON file, so no secret ever appears in a command line
// or in this process's argv (visible to other processes on the machine).
const staging = mkdtempSync(join(tmpdir(), 'coach-secrets-'));
const bulkFile = join(staging, 'secrets.json');
try {
  writeFileSync(bulkFile, JSON.stringify(secrets), 'utf8');
  wrangler(['secret', 'bulk', bulkFile]);
  console.log(`\nPushed ${Object.keys(secrets).length} secret(s).`);
} catch (err) {
  console.error(
    `\nPush failed. The usual causes:\n` +
      `  - the Worker has never been deployed (run npx wrangler deploy first)\n` +
      `  - not logged in (npx wrangler login)\n`
  );
  process.exit(1);
} finally {
  rmSync(staging, { recursive: true, force: true });
}

console.log(`
Confirm every key resolved:
  curl -s https://coach-router.<subdomain>.workers.dev/health
`);
}
