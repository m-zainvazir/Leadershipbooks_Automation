#!/usr/bin/env node
/**
 * onboard.mjs — create the GHL side of a new author and its coaches.json entry.
 *
 *   npm run onboard -- --code 1044 --author "Jane Smith" --book "Her Book" --slug jane-smith
 *   npm run onboard -- ...same... --write
 *
 * DRY BY DEFAULT, like every other script here. A dry run makes GHL READS only
 * (duplicate product, staff contact, current tag holders) and writes nothing.
 * `--write` then:
 *
 *   1. creates the coach tag (applied to the staff test contact, then removed —
 *      the token cannot create tags directly; 401 on /locations/<id>/tags)
 *   2. creates the $59 SERVICE product and its recurring monthly price, named
 *      per plans/20 §7b-bis
 *   3. backs up coaches.json and appends the new entry with the product id
 *   4. runs the seed validation (dry) and restores the backup if it fails
 *   5. prints the manual steps still left, with this author's exact values
 *
 * It does NOT push to KV. Review the entry, then `npm run push`.
 *
 * Options:
 *   --name "Micheal X"     internal spelling if it differs from --author (the
 *                          customer spelling). Defaults to --author.
 *   --label "Worldview Coach"   the coach label for the page and Course360
 *   --aliases "A B,A,B"    comma-separated; defaults to full name, first, last
 *   --version <id|main>    Voiceflow versionID. Read from the live page if absent
 *   --project <id>         Voiceflow projectID. Read from the page, or derived
 *                          from a 24-hex --version (draft = project + 1)
 *   --shopify-product <n>  if the Shopify bundle already exists
 *   --lesson-url <url>     if the Course360 lesson already exists
 *   --trial-days <n>       default 10
 *   --ghl-product <id>     adopt an existing product instead of creating one —
 *                          the recovery path after a failed price step
 *
 * The Voiceflow key comes from the environment as VF_KEY_<CODE>, or from a
 * legacy page that still carries it. Never an argument, never printed.
 *
 * Plan: ../ghl-shopify subscription/plans/21-onboarding-automation.md §B
 */

import { loadConfig, runtimeConfig, bearer } from './lib-config.mjs';
import { saveRegistry } from './lib-registry.mjs';
import {
  buildEntry,
  preflightProblems,
  inspectGhl,
  applyGhl,
  parseCoachPage,
  projectFromVersion,
  slugConventions,
  ghlNames,
  remainingSteps,
} from './lib-onboard.mjs';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const valOf = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined;
};

const WRITE = has('--write');
const GHL_API = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

const die = (msg) => {
  console.error(`\n${msg}\n`);
  process.exit(1);
};

/* ------------------------------------------------------------------ inputs --- */

const code = valOf('--code');
const author = valOf('--author');
const book = valOf('--book');
const slug = valOf('--slug');
const missing = [['--code', code], ['--author', author], ['--book', book], ['--slug', slug]].filter(([, v]) => !v).map(([f]) => f);
if (missing.length) {
  die(`Missing ${missing.join(', ')}.\n\n  npm run onboard -- --code 1044 --author "Jane Smith" --book "Her Book" --slug jane-smith`);
}

const trialDaysRaw = valOf('--trial-days');
const trialDays = trialDaysRaw === undefined ? 10 : Number(trialDaysRaw);

let config;
try {
  config = loadConfig();
} catch (err) {
  die(err.message);
}
const { shared, coaches: existing } = config;
if (!shared.ghlApiToken || !shared.ghlLocationId) die('coaches.json shared.ghlApiToken and shared.ghlLocationId are required.');
const staffTag = runtimeConfig(shared).staffTag;

/* --------------------------------------------------------------- voiceflow --- */

// The live page is a fallback source, read only when a value is missing. A
// Worker-proxied page has no key in it by design (plans/21 §A).
const pageUrl = slugConventions(slug).pageUrl;
let page = null;
let pageStatus = 'not read';
async function readPage() {
  try {
    const res = await fetch(pageUrl);
    pageStatus = String(res.status);
    if (res.ok) page = parseCoachPage(await res.text());
  } catch (err) {
    pageStatus = `unreachable (${err.message})`;
  }
}

const envKey = process.env[`VF_KEY_${code}`] || '';
let versionID = valOf('--version');
let projectID = valOf('--project');
if (!versionID || !projectID || !envKey) await readPage();

let versionFrom = versionID ? '--version' : '';
if (!versionID && page && page.versionID) { versionID = page.versionID; versionFrom = 'page'; }
let projectFrom = projectID ? '--project' : '';
if (!projectID && page && page.projectID) { projectID = page.projectID; projectFrom = 'page'; }
if (!projectID && versionID && projectFromVersion(versionID)) { projectID = projectFromVersion(versionID); projectFrom = 'derived from versionID - 1'; }
// The shared personal key (shared.vfApiKey) serves every coach, so a new
// author needs no key of its own. A per-coach key is only the legacy fallback.
const personalKey = bearer(shared.vfApiKey);
const vfKey = personalKey ? '' : envKey || (page && page.vfKey) || '';
const keyFrom = personalKey ? 'shared personal key (all coaches)' : envKey ? `env VF_KEY_${code}` : vfKey ? 'page source (legacy direct page)' : '';

/* ---------------------------------------------------------------- preflight --- */

const aliasesArg = valOf('--aliases');
const entry = buildEntry({
  code, author, book, slug, trialDays,
  name: valOf('--name'),
  coachLabel: valOf('--label'),
  aliases: aliasesArg ? aliasesArg.split(',').map((s) => s.trim()).filter(Boolean) : null,
  projectID, versionID, vfKey,
  shopifyProductId: valOf('--shopify-product'),
  courseLessonUrl: valOf('--lesson-url'),
});
const label = valOf('--label');

const problems = preflightProblems({ existing, entry, slug, personalKey });

/** GHL client. Throws on anything that is not 2xx, naming the call. */
async function ghl(path, { method = 'GET', body = null } = {}) {
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
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 200);
    throw new Error(`GHL ${res.status} on ${method} ${path.split('?')[0]}: ${detail}`);
  }
  return res.json().catch(() => ({}));
}

// GHL is only read once the registry rules pass — a bad slug costs nothing.
let inspection = null;
if (!problems.length) {
  try {
    inspection = await inspectGhl({
      ghl, locationId: shared.ghlLocationId, entry, staffTag, adoptProductId: valOf('--ghl-product'),
    });
    problems.push(...inspection.problems);
  } catch (err) {
    problems.push(`reading GHL failed, so nothing was checked: ${err.message}`);
  }
}

/* ------------------------------------------------------------------- report --- */

const names = ghlNames(entry.displayName);
console.log(`\nOnboard coach ${entry.code} — ${entry.displayName}${WRITE ? '' : '   (DRY RUN — GHL reads only)'}\n`);
console.log(`  name / display  ${entry.name} / ${entry.displayName}`);
console.log(`  book            ${entry.bookTitle}`);
console.log(`  aliases         ${entry.aliases.join(', ')}`);
console.log(`  coach page      ${pageUrl}  (${pageStatus})`);
if (page) {
  // A Worker page names a COACH_CODE and carries no Voiceflow ids at all; a
  // legacy page talks to Voiceflow itself and so carries the key.
  const kind = page.coachCode ? `Worker page, COACH_CODE ${page.coachCode}` : page.vfKey ? 'legacy DIRECT page — key in source' : 'unrecognised';
  console.log(`                  ${kind}   showActivation: ${page.showActivation}`);
}
console.log(`  versionID       ${entry.versionID || '(unknown)'}${versionFrom ? `  [${versionFrom}]` : ''}`);
console.log(`  projectID       ${entry.projectID || '(unknown)'}${projectFrom ? `  [${projectFrom}]` : ''}`);
console.log(`  Voiceflow key   ${personalKey || vfKey ? `present  [${keyFrom}]` : 'MISSING'}`);
console.log(`  ghlTag          ${entry.ghlTag}`);
console.log(`  GHL product     ${inspection && inspection.product ? `adopt ${inspection.product._id}` : `create "${names.product}"`}`);
console.log(`  GHL price       ${inspection && inspection.price ? `adopt ${inspection.price._id}` : `create "${names.price}" — $59 USD, monthly`}`);
// The day-7/9/10 emails link here. Written now by convention, so it must exist
// before this author's first trial reaches day 7.
const landingStatus = await fetch(entry.landingPageUrl, { method: 'HEAD' }).then((r) => r.status, () => 'unreachable');
console.log(`  landingPageUrl  ${entry.landingPageUrl}  (${landingStatus === 200 ? 'live' : `${landingStatus} — build the funnel page before the first trial reaches day 7`})`);
console.log(`  shopifyPid      ${entry.shopifyProductId || '(later — Shopify step)'}`);
console.log(`  lesson          ${entry.courseLessonUrl || '(later — Course360 step)'}`);
console.log(`  trialDays       ${entry.trialDays}`);
for (const n of (inspection && inspection.notes) || []) console.log(`  note            ${n}`);
console.log('');

if (problems.length) {
  console.error('REFUSING — nothing was written:\n');
  for (const p of problems) console.error(`  x ${p}`);
  die('Fix the above and re-run.');
}

if (!WRITE) {
  console.log('Dry run only. Nothing written. Re-run with --write to create the GHL objects and the entry.\n');
  process.exit(0);
}

/* -------------------------------------------------------------------- write --- */

let made;
try {
  made = await applyGhl({ ghl, locationId: shared.ghlLocationId, entry, inspection });
} catch (err) {
  console.error(`\nSTOPPED: ${err.message}`);
  console.error(`\n  Already in GHL: ${JSON.stringify(err.created || {})}`);
  die('coaches.json was NOT changed.');
}
console.log(`  created tag      ${made.tag}`);
console.log(`  GHL product      ${made.ghlProductId}`);
console.log(`  GHL price        ${made.ghlPriceId}`);

entry.ghlProductId = made.ghlProductId;
entry.ghlPriceId = made.ghlPriceId;

// Backup, append, validate — and restore the backup if seed refuses.
try {
  const { backup, warnings } = saveRegistry((doc) => { doc.coaches.push(entry); }, { label: `onboard-${entry.code}`, code: entry.code });
  console.log(`  coaches.json     entry ${entry.code} appended  (backup: ${backup})`);
  console.log(`  seed validation  clean${warnings.length ? ` — ${warnings.length} warning(s) for ${entry.code}, expected until the manual steps are done:` : ''}`);
  for (const w of warnings) console.log(`                 ${w}`);
} catch (err) {
  die(`${err.message}\n\nThe GHL product ${made.ghlProductId} and price ${made.ghlPriceId} exist; fix the problem and re-run with --ghl-product ${made.ghlProductId}.`);
}

console.log(`\n${remainingSteps({ entry, slug, label, priceId: made.ghlPriceId })}\n`);
console.log('Not pushed. Review the entry in coaches.json, then: npm run push\n');
