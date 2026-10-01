#!/usr/bin/env node
/**
 * seed-coaches.mjs — write the coach registry from coaches.json into Cloudflare KV.
 *
 *   node seed-coaches.mjs                    # dry run: validate + print, write nothing
 *   node seed-coaches.mjs --write            # write to the production namespace
 *   node seed-coaches.mjs --write --preview  # write to the preview namespace
 *   node seed-coaches.mjs --list             # show what is currently in KV
 *
 * Source of truth is coaches.json. Values are entered there once; this script
 * writes the non-secret subset to KV and sync-secrets.mjs pushes the API keys
 * to Worker secrets.
 *
 * KV values are built by registryValue() in lib-config.mjs from an allowlist, so
 * a credential in coaches.json cannot reach KV even if a new field is added.
 *
 * Refuses to write while any value is still a TODO_ placeholder.
 */

import { writeFileSync, unlinkSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadConfig,
  registryValue,
  assertNoSecrets,
  isPlaceholder,
  isUsable,
  runtimeConfig,
  configProblems,
  coachProblems,
  HERE,
} from './lib-config.mjs';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);

const WRITE = has('--write');
const PREVIEW = has('--preview');
const BINDING = 'COACH_KV';
const ALLOWED_MODES = new Set(['inline', 'dial']);

// On Windows the npx executable is npx.cmd, which Node refuses to spawn without
// a shell (CVE-2024-27980 hardening). shell:true does NOT quote arguments, so
// every arg passed through here must be free of spaces and shell metacharacters
// — hence the registry JSON goes via a temp file and --path, never as an argv.
const IS_WIN = process.platform === 'win32';

function wrangler(args) {
  return execFileSync(IS_WIN ? 'npx.cmd' : 'npx', ['wrangler', ...args], {
    cwd: HERE,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    shell: IS_WIN,
  });
}

// wrangler 4 refuses to guess when a binding has both `id` and `preview_id`:
// --preview picks the preview namespace, --preview=false the production one.
// Both are remote namespaces, so --remote applies either way (without it
// wrangler reads and writes a local simulated store instead).
function nsFlags() {
  return PREVIEW ? ['--remote', '--preview'] : ['--remote', '--preview=false'];
}

/* ------------------------------------------------------------------ --list ---- */

if (has('--list')) {
  const out = wrangler(['kv', 'key', 'list', `--binding=${BINDING}`, ...nsFlags()]);
  const keys = JSON.parse(out).filter((k) => k.name.startsWith('coach:'));
  console.log(`\n${keys.length} coach entr${keys.length === 1 ? 'y' : 'ies'} in ${PREVIEW ? 'PREVIEW' : 'production'} KV:\n`);
  for (const k of keys) {
    const v = wrangler(['kv', 'key', 'get', k.name, `--binding=${BINDING}`, ...nsFlags()]);
    const c = JSON.parse(v);
    const mode = c.voiceMode || 'inline';
    console.log(
      `  ${k.name.slice(6).padEnd(8)} ${String(c.name).padEnd(28)} ${mode.padEnd(7)} ${c.keyVar}` +
        (mode === 'dial' ? `  -> ${c.dialNumber}` : '') +
        `  tag=${c.ghlTag || '(none)'}`
    );
  }

  // Missing rather than fatal: `config` only exists once this script has run
  // since the runtime knobs were introduced.
  try {
    const raw = wrangler(['kv', 'key', 'get', 'config', `--binding=${BINDING}`, ...nsFlags()]);
    console.log(`\n  config: ${JSON.stringify(JSON.parse(raw))}`);
  } catch {
    console.log('\n  config: (not set — run this script with --write)');
  }
  console.log('');
  process.exit(0);
}

/* ---------------------------------------------------------------- validate ---- */

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(`\n${err.message}`);
  process.exit(1);
}

const { coaches, shared } = config;

// HeyGen is optional. While shared.heygenApiKey is blank, per-coach avatar IDs
// are irrelevant and warning about them on every run is just noise.
const heygenInUse = isUsable(shared.heygenApiKey);

if (!coaches.length) {
  console.error(`\nNo entries in the "coaches" array in coaches.json. See coaches.example.json.\n`);
  process.exit(1);
}

const problems = [];
const seenCodes = new Map();

for (const coach of coaches) {
  const code = coach.code;
  const where = code ? `coach "${code}"` : `coaches[${coach.index}]`;

  if (!code) {
    problems.push(`${where}: "code" is missing — it becomes the KV key and the access code`);
  } else if (!/^[A-Za-z0-9]+$/.test(code)) {
    problems.push(`${where}: code must be alphanumeric, no spaces or punctuation`);
  } else if (seenCodes.has(code)) {
    problems.push(`${where}: duplicate code — also used by coaches[${seenCodes.get(code)}]. The second would silently overwrite the first in KV.`);
  }
  if (code) seenCodes.set(code, coach.index);

  if (code && !/^\d+$/.test(code)) {
    console.warn(`  ! ${where}: non-numeric code cannot be entered on a phone keypad — voice callers will have to say the author's name.`);
  }

  for (const f of ['name', 'projectID', 'versionID']) {
    if (!coach[f]) problems.push(`${where}: "${f}" is empty`);
    else if (isPlaceholder(coach[f])) problems.push(`${where}: "${f}" is still a placeholder`);
  }

  const mode = coach.voiceMode || 'inline';
  if (!ALLOWED_MODES.has(mode)) {
    problems.push(`${where}: voiceMode "${mode}" must be "inline" or "dial"`);
  }
  if (mode === 'dial' && !/^\+[1-9]\d{6,14}$/.test(coach.dialNumber || '')) {
    problems.push(`${where}: voiceMode is "dial" but dialNumber is missing or not E.164`);
  }
  if (/[&<>"']/.test(coach.name || '')) {
    problems.push(`${where}: name contains punctuation that breaks TwiML — remove & < > " '`);
  }
  if (!Array.isArray(coach.aliases)) {
    problems.push(`${where}: "aliases" must be an array of strings, e.g. ["first last", "last"]`);
  } else if (!coach.aliases.length) {
    console.warn(`  ! ${where}: no aliases — voice callers will only be able to route by keying the code.`);
  }
  if (heygenInUse && !coach.heygenAvatarID) {
    console.warn(`  ! ${where}: no heygenAvatarID — the web avatar page will not start for this coach.`);
  }
  // A Voiceflow PERSONAL key names the project by the version ID in the path,
  // and rejects an alias there (verified 2026-09-30: `main` -> 400, the 24-char
  // ids -> 200). Pushing in that state would take this coach offline.
  // Refused only when WRITING (npm run push): it is the push that would take the
  // coach offline. A local edit of coaches.json - which runs this as a dry
  // check - is warned, not blocked, or no other change could be saved at all.
  if (coach.keySource === 'personal' && !/^[0-9a-f]{24}$/i.test(String(coach.versionID || ''))) {
    const msg =
      `${where}: versionID "${coach.versionID}" is an alias, and the shared personal key needs the ` +
      `24-character version ID (Voiceflow answers 400 for an alias). Set the real id before pushing.`;
    if (WRITE) problems.push(msg);
    else console.warn(`  ! ${msg}`);
  }
  if (!coach.apiKey) {
    console.warn(`  ! ${where}: no vfKey — KV can still be seeded, but the coach cannot answer until the secret exists (node sync-secrets.mjs --write).`);
  }
  // A GHL product id is a 24-char hex ObjectId. A wrong one grants nothing and
  // says nothing, so check the shape rather than discovering it in production.
  if (coach.ghlProductId && !/^[0-9a-f]{24}$/i.test(String(coach.ghlProductId))) {
    problems.push(`${where}: ghlProductId "${coach.ghlProductId}" does not look like a GHL id (24 hex characters)`);
  }
  if (coach.landingPageUrl && !/^https:\/\//.test(String(coach.landingPageUrl))) {
    problems.push(`${where}: landingPageUrl must start with https://`);
  }
  if (!coach.ghlProductId && coach.ghlTag) {
    console.warn(`  ! ${where}: no ghlProductId — entitlement for this coach depends entirely on the tag being applied by hand.`);
  }
  if (coach.ghlTag === undefined) {
    console.warn(`  ! ${where}: no ghlTag — no GHL tag maps to this coach, so nobody can ever be entitled to it (fails closed).`);
  } else if (/[,\s]/.test(coach.ghlTag)) {
    problems.push(`${where}: ghlTag "${coach.ghlTag}" must not contain spaces or commas — the GHL contacts/search tag filter cannot match it`);
  } else if (!/^bookcoach-[a-z0-9-]+-active$/.test(coach.ghlTag)) {
    // A convention, not a requirement: the Worker matches whatever is here.
    // Worth a warning because a predictable namespace is what makes a tag
    // census readable at fifteen authors.
    console.warn(`  ! ${where}: ghlTag "${coach.ghlTag}" does not follow the bookcoach-<author>-active convention.`);
  }
  if (coach.shopifyProductId === undefined) {
    console.warn(`  ! ${where}: no shopifyProductId — no Shopify purchase can ever start a trial for this coach (fails closed).`);
  }
  if (!coach.bookTitle) {
    console.warn(`  ! ${where}: no bookTitle — the day-9 and day-10 emails have nothing to put in {{contact.coach_book_title}} and will render a gap.`);
  }
  // With the shared My Coaches course on, an author needs no course of their own.
  const shared_ = runtimeConfig(shared);
  if (!coach.courseLessonUrl && !(shared_.myCoaches === 'on' && shared_.myCoachesUrl)) {
    console.warn(`  ! ${where}: no courseLessonUrl — trial emails have no route to an activation code, which is the whole onboarding path.`);
  }
}

// Runtime knobs go to KV as the `config` key so they can be changed without a
// redeploy. Validated here for the same reason coach entries are: a dry run
// should report every problem at once.
const cfg = runtimeConfig(shared);
problems.push(...configProblems(cfg));

// Cross-coach identity collisions. Fatal: the failure is silent cross-granting.
problems.push(...coachProblems(coaches));

/* ------------------------------------------------------------------- report --- */

console.log(`\n${coaches.length} coach entr${coaches.length === 1 ? 'y' : 'ies'} read from coaches.json\n`);
for (const coach of coaches) {
  const value = registryValue(coach);
  console.log(`  coach:${coach.code}`);
  console.log(`    name       ${value.name}`);
  console.log(`    projectID  ${value.projectID || '(unset)'}`);
  console.log(`    versionID  ${value.versionID}`);
  console.log(`    keyVar     ${value.keyVar}  (secret ${coach.apiKey ? 'present in coaches.json' : 'MISSING'})`);
  console.log(`    voiceMode  ${value.voiceMode}${value.voiceMode === 'dial' ? `  -> ${value.dialNumber}` : ''}`);
  console.log(`    aliases    ${(value.aliases || []).join(', ') || '(none)'}`);
  console.log(`    ghlTag     ${value.ghlTag || '(none — no entitlement possible)'}`);
  console.log(`    ghlProduct ${value.ghlProductId || '(none — tag only)'}`);
  console.log(`    shopifyPid ${value.shopifyProductId || '(none — no purchase can start a trial)'}`);
  console.log(`    landing    ${value.landingPageUrl || '(not set)'}`);
  console.log(`    lesson     ${value.courseLessonUrl || '(not set — no route to an activation code)'}`);
  console.log(`    display    ${value.displayName || `(falls back to name: ${value.name})`}`);
  console.log(`    book       ${value.bookTitle || '(not set)'}`);
  console.log(`    trialDays  ${value.trialDays === undefined ? '10 (default)' : value.trialDays}`);
  console.log('');
}

console.log('  config  (KV key "config" — runtime knobs, changeable without a redeploy)');
for (const [k, v] of Object.entries(cfg)) {
  console.log(`    ${k.padEnd(22)} ${JSON.stringify(v)}`);
}
console.log('');

if (problems.length) {
  console.error('REFUSING TO WRITE — fix these in coaches.json first:\n');
  for (const p of problems) console.error(`  x ${p}`);
  console.error('');
  process.exit(1);
}

if (!WRITE) {
  console.log('Dry run only. Nothing written. Re-run with --write to seed KV.\n');
  process.exit(0);
}

/* -------------------------------------------------------------------- write --- */

// Values go to KV via --path rather than as a command-line argument: the JSON
// contains spaces and quotes, which no cross-platform argv quoting survives.
const staging = mkdtempSync(join(tmpdir(), 'coach-seed-'));
try {
  for (const coach of coaches) {
    const key = `coach:${String(coach.code).toUpperCase()}`;
    const value = registryValue(coach);
    assertNoSecrets(value);

    const valueFile = join(staging, `${coach.code}.json`);
    writeFileSync(valueFile, JSON.stringify(value), 'utf8');
    wrangler(['kv', 'key', 'put', key, `--path=${valueFile}`, `--binding=${BINDING}`, ...nsFlags()]);
    unlinkSync(valueFile);
    console.log(`  wrote ${key} to ${PREVIEW ? 'PREVIEW' : 'production'}`);
  }

  assertNoSecrets(cfg);
  const cfgFile = join(staging, '_config.json');
  writeFileSync(cfgFile, JSON.stringify(cfg), 'utf8');
  wrangler(['kv', 'key', 'put', 'config', `--path=${cfgFile}`, `--binding=${BINDING}`, ...nsFlags()]);
  unlinkSync(cfgFile);
  console.log(`  wrote config to ${PREVIEW ? 'PREVIEW' : 'production'}`);
} finally {
  rmSync(staging, { recursive: true, force: true });
}

console.log(`
Next:
  node sync-secrets.mjs --write     push the API keys to Worker secrets
  node verify-voiceflow.mjs         confirm each version ID actually resolves
`);
