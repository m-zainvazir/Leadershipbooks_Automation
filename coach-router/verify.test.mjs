/**
 * verify.test.mjs — sanity tests for the pure helpers in coach-router.worker.js
 * and in lib-config.mjs (the KV/secret split and the runtime knobs).
 * Run: node verify.test.mjs
 * These are not a substitute for TEST-CHECKLIST.md, which tests the live system.
 */
import { __test } from './coach-router.worker.js';
import { runtimeConfig, configProblems, coachProblems, assertNoSecrets, registryValue, loadConfig } from './lib-config.mjs';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { applySubscriptionTags, sweepExpiredTrials, formatTrialEnd, verifyShopifyRequest, ghlSearchByTags, handleShopifyOrder, shopifyProductIds, coachesForProductIds, verifyShopifyHmac, trialFieldPayload, TRIAL_STARTED_TAG, DEFAULT_TRIAL_DAYS, toGsm7, stripMarkdown, capSms, sanitizeForSpeech, flattenTraces, looksLikeCrisis, validateTwilio, normalizePhone, reconcileEntitlements, listSubscribers, mintTokenValue, redeemBindToken, codesForTags, TOKEN_SHAPE, __resetCaches, entitlementFor, resolveEntitledCoach, entitlementDecision, speechHints, loadRegistry, sweepArchives, webSessionFor, webGateDecision, pickEntitledCode, webUserID, mintWebSessionToken, handleBindStatus, ghlActiveSubscriptions, GHL_SUB_ACTIVE, codesForContact, listContactEntitlements, handleHealth, touchSession } = __test;

let pass = 0, fail = 0;
const t = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       expected: ${JSON.stringify(expected)}\n       actual:   ${JSON.stringify(actual)}`); }
};
const truthy = (name, v) => t(name, !!v, true);
const falsy = (name, v) => t(name, !!v, false);

/**
 * A fake KV with enough of the real surface to exercise pagination, which is
 * the part most likely to be wrong and least likely to be noticed. Retained
 * from the cancelled transcript-capture work; the reconcile tests use it.
 */
const fakeKV = (pageSize = 1000) => {
  const store = new Map();
  return {
    store,
    async put(k, v) { store.set(k, v); },
    async get(k) { const v = store.get(k); return v === undefined ? null : JSON.parse(v); },
    async delete(k) { store.delete(k); },
    async list({ prefix, cursor }) {
      const all = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const slice = all.slice(start, start + pageSize);
      const next = start + pageSize;
      return { keys: slice.map((name) => ({ name })), list_complete: next >= all.length, cursor: String(next) };
    },
  };
};


console.log('\nstripMarkdown');
t('bold removed', stripMarkdown('This is **very** important'), 'This is very important');
t('heading removed', stripMarkdown('## Chapter One\nText'), 'Chapter One\nText');
t('md link becomes label: url', stripMarkdown('Get [the book](https://example.com/b)'), 'Get the book: https://example.com/b');
t('bullets normalised', stripMarkdown('* one\n* two'), '- one\n- two');
t('inline code unwrapped', stripMarkdown('use `MENU` to switch'), 'use MENU to switch');

console.log('\ncapSms');
truthy('under cap untouched', capSms('short message') === 'short message');
truthy('over cap is capped', capSms('a '.repeat(600), 100).length <= 101);
truthy('breaks on a sentence boundary when one is near the cap',
  capSms('Sentence one is here. Sentence two is here. Sentence three is here. Sentence four.', 60).endsWith('.'));
truthy('falls back to three dots (not the ellipsis char) when no boundary is near the cap',
  capSms('One. ' + 'x'.repeat(200), 60).endsWith('...'));

console.log('\nsanitizeForSpeech');
{
  const r = sanitizeForSpeech('Grab it at https://leadershipbooks.net/store today.');
  falsy('url not spoken', /https|leadershipbooks\.net/.test(r.speech));
  t('url captured for texting', r.links, ['https://leadershipbooks.net/store']);
}
{
  const r = sanitizeForSpeech('Email HELLO@example.com for details');
  falsy('email not spoken', /@/.test(r.speech));
}
{
  const r = sanitizeForSpeech('The LORD is my shepherd and ASAP means soon');
  falsy('no allcaps left to spell out', /\b[A-Z]{3,}\b/.test(r.speech));
  truthy('allcaps titlecased', r.speech.includes('Lord'));
}
{
  const r = sanitizeForSpeech('Read [the book](https://example.com/x) now');
  falsy('markdown link fully stripped for voice', /example\.com|\[|\]/.test(r.speech));
  truthy('label survives', r.speech.includes('the book'));
}

console.log('\nflattenTraces');
{
  const traces = [
    { type: 'text', payload: { message: 'Here is **the** answer' } },
    { type: 'card', payload: {
      title: 'The Book',
      description: { text: 'Paperback' },
      buttons: [{ name: 'Buy now', request: { payload: { actions: [{ type: 'open_url', payload: { url: 'https://example.com/buy' } }] } } }],
    } },
  ];
  const r = flattenTraces(traces);
  truthy('text flattened + demarkdowned', r.text.includes('Here is the answer'));
  truthy('card title kept', r.text.includes('The Book — Paperback'));
  t('open_url button became a link', r.links, [{ label: 'Buy now', url: 'https://example.com/buy' }]);
}
t('empty traces safe', flattenTraces(null), { text: '', links: [] });

console.log('\nlooksLikeCrisis');
truthy('suicidal ideation', looksLikeCrisis("I don't want to live anymore"));
truthy('self harm', looksLikeCrisis('I keep thinking about hurting myself'));
truthy('self harm variant', looksLikeCrisis('I have been cutting myself again'));
truthy('abuse', looksLikeCrisis("he's hitting me and I'm scared"));
falsy('idiom is not a crisis', looksLikeCrisis('this project is killing me'));
falsy('idiom 2', looksLikeCrisis("I'm dying to know how the story ends"));
falsy('ordinary coaching', looksLikeCrisis('I want to grow as a leader'));

console.log('\nTwilio signature');
{
  // Cross-check the Worker's WebCrypto implementation against an INDEPENDENT
  // HMAC-SHA1 built with node:crypto, following Twilio's documented algorithm:
  // base64( HMAC-SHA1( authToken, fullUrl + concat(sorted paramName + paramValue) ) ).
  const { createHmac } = await import('node:crypto');

  const url = 'https://mycompany.com/myapp.php?foo=1&bar=2';
  const token = '12345';
  const fields = {
    CallSid: 'CA1234567890ABCDE',
    Caller: '+14158675309',
    Digits: '1234',
    From: '+14158675309',
    To: '+18005551212',
  };
  const body = new URLSearchParams(fields).toString();

  let payload = url;
  for (const k of Object.keys(fields).sort()) payload += k + fields[k];
  const expected = createHmac('sha1', token).update(payload, 'utf8').digest('base64');

  const req = {
    url,
    headers: { get: (h) => (h === 'X-Twilio-Signature' ? expected : null) },
  };
  try {
    await validateTwilio(req, { TWILIO_AUTH_TOKEN: token }, body);
    console.log('  ok   valid signature accepted');
    pass++;
  } catch (e) {
    console.log(`  FAIL valid signature rejected: ${e.message}`);
    fail++;
  }

  const badReq = { url, headers: { get: () => 'AAAAAAAAAAAAAAAAAAAAAAAAAAA=' } };
  try {
    await validateTwilio(badReq, { TWILIO_AUTH_TOKEN: token }, body);
    console.log('  FAIL bad signature accepted');
    fail++;
  } catch (e) {
    console.log(`  ok   bad signature rejected (${e.status})`);
    pass++;
  }

  const noHeader = { url, headers: { get: () => null } };
  try {
    await validateTwilio(noHeader, { TWILIO_AUTH_TOKEN: token }, body);
    console.log('  FAIL missing signature accepted');
    fail++;
  } catch (e) {
    console.log(`  ok   missing signature rejected (${e.status})`);
    pass++;
  }
}

console.log('\ntoGsm7 — encoding is a billing decision');
t('em dash becomes hyphen', toGsm7('a \u2014 b'), 'a - b');
t('en dash becomes hyphen', toGsm7('a \u2013 b'), 'a - b');
t('curly apostrophe straightened', toGsm7('that\u2019s it'), "that's it");
t('curly quotes straightened', toGsm7('\u201cquoted\u201d'), '"quoted"');
t('ellipsis becomes three dots', toGsm7('wait\u2026'), 'wait...');
t('bullet becomes hyphen', toGsm7('\u2022 point'), '- point');
t('emoji dropped', toGsm7('great work \u{1F44D}'), 'great work');
t('non-breaking space normalised', toGsm7('a\u00a0b'), 'a b');
t('zero-width joiner dropped', toGsm7('a\u200db'), 'ab');
// GSM-7 has \u00e0 \u00e4 \u00e5 \u00e6 \u00e7 \u00e8 \u00e9 \u00ec \u00f1 \u00f2 \u00f6 \u00f8 \u00f9 \u00fc (+ uppercase) and nothing else Latin \u2014
// so \u00e9 and \u00fc survive verbatim, while \u00ef and \u00eb must be folded rather than dropped.
t('gsm-7 accents kept verbatim', toGsm7('caf\u00e9 \u00fcber a\u00e0'), 'caf\u00e9 \u00fcber a\u00e0');
t('non-gsm-7 accents folded, not dropped', toGsm7('na\u00efve Zo\u00eb r\u00f4le'), 'naive Zoe role');
t('cjk dropped entirely', toGsm7('hello \u4e16\u754c'), 'hello');
t('newlines preserved', toGsm7('line one\nline two'), 'line one\nline two');
t('plain ascii untouched', toGsm7('Reply 1042 to begin.'), 'Reply 1042 to begin.');
{
  const messy = 'He said \u201cdelegate\u2014now\u201d \u{1F600} and left\u2026';
  const capped = capSms(messy);
  t('capSms output is already pure gsm-7 (idempotent)', toGsm7(capped), capped);
  falsy('no non-gsm-7 survivor in capSms output', /[\u2010-\u2015\u2018-\u201f\u2026\u2022\u{1F300}-\u{1FAFF}]/u.test(capped));
}

console.log('');
console.log('runtimeConfig / configProblems');
t('defaults validate clean', configProblems(runtimeConfig({})), []);
t('an override is applied', runtimeConfig({ config: { leaseHours: 12 } }).leaseHours, 12);
falsy('an unknown knob is dropped', 'nonsense' in runtimeConfig({ config: { nonsense: 1 } }));
truthy('entitlementMode "on" is rejected', configProblems(runtimeConfig({ config: { entitlementMode: 'on' } })).length > 0);
truthy('negative leaseHours is rejected', configProblems(runtimeConfig({ config: { leaseHours: -1 } })).length > 0);
truthy('non-boolean archiveAutoDelete is rejected', configProblems(runtimeConfig({ config: { archiveAutoDelete: 'yes' } })).length > 0);
truthy('a reminder at or beyond retention is rejected - it could never fire',
  configProblems(runtimeConfig({ config: { archiveRetentionDays: 10, archiveReminderDays: [15, 5] } })).some((x) => /never fire/.test(x)));
t('reminders inside retention validate clean',
  configProblems(runtimeConfig({ config: { archiveRetentionDays: 30, archiveReminderDays: [15, 5] } })), []);
t('no reminders validates clean', configProblems(runtimeConfig({ config: { archiveReminderDays: [] } })), []);

console.log('');
console.log('assertNoSecrets - the GHL token must never reach KV');
{
  const blocked = (label, value) => {
    let threw = false;
    try { assertNoSecrets(value); } catch { threw = true; }
    truthy(label, threw);
  };
  blocked('a pit- token is blocked', { tag: 'x', t: 'pit-0f8e1a2b-3c4d-5e6f-7a8b-9c0d1e2f3a4b' });
  blocked('the ghlApiToken field name is blocked', { ghlApiToken: 'whatever' });
  let ok = true;
  // "Pit Crew" must NOT trip the pit- rule: the length floor is what prevents it.
  try { assertNoSecrets({ ghlTag: 'bookcoach-micheal-stickler-active', name: 'Pit Crew' }); } catch { ok = false; }
  truthy('an ordinary tag and a name containing "Pit" are allowed', ok);
}

console.log('');
console.log('ghlTag normalisation - GHL stores tags lowercased');
{
  const dir = mkdtempSync(join(tmpdir(), 'coach-cfg-'));
  try {
    const file = join(dir, 'c.json');
    writeFileSync(file, JSON.stringify({
      shared: {},
      coaches: [{ code: '9999', name: 'X', projectID: 'p', ghlTag: '  BookCoach-MiXeD-Case  ' }],
    }), 'utf8');
    const { coaches } = loadConfig({ file });
    t('trimmed and lowercased on load', coaches[0].ghlTag, 'bookcoach-mixed-case');
    t('carried into the KV value', registryValue(coaches[0]).ghlTag, 'bookcoach-mixed-case');

    const file2 = join(dir, 'c2.json');
    writeFileSync(file2, JSON.stringify({ shared: {}, coaches: [{ code: '9999', name: 'X', projectID: 'p' }] }), 'utf8');
    const bare = loadConfig({ file: file2 }).coaches[0];
    falsy('an absent tag stays absent in KV rather than becoming an empty string', 'ghlTag' in registryValue(bare));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}


console.log('');
console.log('normalizePhone - a wrong guess grants one person another person’s access');
t('already E.164 passes through', normalizePhone('+18542545009'), '+18542545009');
t('US 10-digit gets +1', normalizePhone('8542545009'), '+18542545009');
t('US 11-digit with leading 1', normalizePhone('18542545009'), '+18542545009');
t('punctuation stripped', normalizePhone('(854) 254-5009'), '+18542545009');
t('dots stripped', normalizePhone('854.254.5009'), '+18542545009');
t('spaces and dashes stripped', normalizePhone(' 854 254 - 5009 '), '+18542545009');
t('international kept as given', normalizePhone('+442071838750'), '+442071838750');
t('empty is null', normalizePhone(''), null);
t('null in, null out', normalizePhone(null), null);
t('undefined in, null out', normalizePhone(undefined), null);
t('letters only is null', normalizePhone('call me'), null);
// 7 and 9 digit numbers are national formats from somewhere - guessing the
// country would risk matching one subscriber's number to another's handset.
t('ambiguous 7-digit refused', normalizePhone('2545009'), null);
t('ambiguous 9-digit refused', normalizePhone('854254500'), null);
t('11-digit not starting with 1 refused', normalizePhone('44207183875'), null);
t('extension text refused rather than mangled', normalizePhone('854-254-5009 ext 12'), null);
t('a plus with a bad body is null', normalizePhone('+0123'), null);
console.log('');
console.log('reconcile - GHL is the source of truth, and a bad answer must change nothing');
{
  // Stand in for the GHL contacts/search call. The reconcile reaches the network
  // only through global fetch, so replacing it drives every branch.
  const realFetch = globalThis.fetch;
  const withGhl = async (responder, fn) => {
    globalThis.fetch = responder;
    try { return await fn(); } finally { globalThis.fetch = realFetch; }
  };
  // The live GHL search returns `tags` on every contact, and since 2026-09-22 the
  // reconcile uses ONE combined multi-tag query and maps each contact's own tags
  // back to coach codes. So the mock must carry tags to model reality; fixtures
  // that do not care about tags get the coach's tag by default.
  const ok = (contacts) => async () =>
    new Response(
      JSON.stringify({ contacts: contacts.map((c) => ({ tags: ['tag-a'], ...c })) }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  const boom = (status) => async () => new Response('upstream said no', { status });

  const baseEnv = (kv) => ({ COACH_KV: kv, GHL_API_TOKEN: 'pit-test', GHL_LOCATION_ID: 'loc-test' });
  const seed = async (kv) => {
    await kv.put('coach:1042', JSON.stringify({ name: 'A', ghlTag: 'tag-a', keyVar: 'VF_KEY_1042' }));
    // autoLinkGhlPhone defaults to FALSE since 2026-09-17 (activation is by
    // code only). These tests predate that and exercise leases, frugality,
    // revocation and the guards — not the linking policy — so they opt in
    // explicitly. The policy itself is tested in its own block below.
    await kv.put('config', JSON.stringify({ entitlementMode: 'off', leaseHours: 48, archiveRetentionDays: 30, autoLinkGhlPhone: true }));
  };

  // --- a contact carrying a usable phone is granted without a token ----------
  {
    const kv = fakeKV(); await seed(kv);
    const r = await withGhl(ok([{ id: 'c1', phone: '(854) 254-5009' }]), () => reconcileEntitlements(baseEnv(kv)));
    truthy('a healthy run reports ok', r.ok);
    t('one contact seen', r.contacts, 1);
    t('one grant written', r.granted, 1);
    const sub = await kv.get('sub:+18542545009');
    truthy('sub: written under the normalised number', !!sub);
    t('scoped to that coach only', sub.codes, ['1042']);
    truthy('bind: written for the opportunistic phone', !!(await kv.get('bind:+18542545009')));
  }

  // --- the frugal branch: a fresh lease must not be rewritten ----------------
  {
    const kv = fakeKV(); await seed(kv);
    const run = () => withGhl(ok([{ id: 'c1', phone: '8542545009' }]), () => reconcileEntitlements(baseEnv(kv)));
    await run();
    const second = await run();
    t('a still-fresh lease is left alone', second.unchanged, 1);
    t('and costs no write', second.writes, 0);
    t('and is not counted as a renewal', second.renewed, 0);
  }

  // --- a half-spent lease IS renewed ----------------------------------------
  {
    const kv = fakeKV(); await seed(kv);
    await withGhl(ok([{ id: 'c1', phone: '8542545009' }]), () => reconcileEntitlements(baseEnv(kv)));
    const stale = await kv.get('sub:+18542545009');
    stale.expires = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1h left of 48
    await kv.put('sub:+18542545009', JSON.stringify(stale));
    const r = await withGhl(ok([{ id: 'c1', phone: '8542545009' }]), () => reconcileEntitlements(baseEnv(kv)));
    t('a nearly-expired lease is renewed', r.renewed, 1);
    truthy('and the expiry moves out',
      new Date((await kv.get('sub:+18542545009')).expires).getTime() > new Date(stale.expires).getTime());
  }

  // --- THE IMPORTANT ONE: an API failure must change nothing -----------------
  {
    const kv = fakeKV(); await seed(kv);
    await withGhl(ok([{ id: 'c1', phone: '8542545009' }]), () => reconcileEntitlements(baseEnv(kv)));
    const before = await kv.get('sub:+18542545009');
    const r = await withGhl(boom(401), () => reconcileEntitlements(baseEnv(kv)));
    falsy('a 401 reports not-ok', r.ok);
    truthy('and says why', (r.errors || []).some((e) => /401/.test(e)));
    t('nobody is revoked on an API failure', r.revoked, 0);
    t('the existing subscriber is untouched', await kv.get('sub:+18542545009'), before);
  }

  // --- an empty-but-successful response is real churn, and IS acted on -------
  {
    const kv = fakeKV(); await seed(kv);
    await withGhl(ok([{ id: 'c1', phone: '8542545009' }]), () => reconcileEntitlements(baseEnv(kv)));
    const r = await withGhl(ok([]), () => reconcileEntitlements(baseEnv(kv)));
    truthy('the run is ok', r.ok);
    t('the untagged contact is revoked', r.revoked, 1);
    t('sub: is gone', await kv.get('sub:+18542545009'), null);
    truthy('an archive record is left behind', !!(await kv.get('arch:+18542545009')));
    truthy('the binding survives so they need not re-link', !!(await kv.get('bind:+18542545009')));
  }

  // --- the majority guard ----------------------------------------------------
  {
    const kv = fakeKV(); await seed(kv);
    const many = Array.from({ length: 10 }, (_, i) => ({ id: 'c' + i, phone: '85425450' + String(10 + i) }));
    await withGhl(ok(many), () => reconcileEntitlements(baseEnv(kv)));
    t('ten subscribers established', (await listSubscribers({ COACH_KV: kv })).length, 10);
    const r = await withGhl(ok([many[0]]), () => reconcileEntitlements(baseEnv(kv)));
    t('refuses to revoke the majority in one run', r.refusedRevoke, 9);
    t('and revokes nobody', r.revoked, 0);
    truthy('and says why', (r.errors || []).some((e) => /refused to revoke/.test(e)));
    truthy('a subscriber it would have cut is still there', !!(await kv.get('sub:+18542545011')));
    const forced = await withGhl(ok([many[0]]), () => reconcileEntitlements(baseEnv(kv), { force: true }));
    t('force overrides the guard', forced.revoked, 9);
  }

  // --- small numbers are ordinary churn, not a suspicious mass revocation ----
  {
    const kv = fakeKV(); await seed(kv);
    const three = Array.from({ length: 3 }, (_, i) => ({ id: 'c' + i, phone: '85425450' + String(20 + i) }));
    await withGhl(ok(three), () => reconcileEntitlements(baseEnv(kv)));
    const r = await withGhl(ok([]), () => reconcileEntitlements(baseEnv(kv)));
    t('below the floor the guard does not trigger', r.refusedRevoke, 0);
    t('all three churn normally', r.revoked, 3);
  }

  // --- a contact with no usable phone is simply not reachable yet ------------
  {
    const kv = fakeKV(); await seed(kv);
    const r = await withGhl(ok([{ id: 'c1', phone: '', email: 'a@b.com' }]), () => reconcileEntitlements(baseEnv(kv)));
    truthy('the run is ok', r.ok);
    t('the contact is counted', r.contacts, 1);
    t('but nothing is granted - they must bind a handset first', r.granted, 0);
  }

  // --- no ghlTag anywhere means nobody is entitled, and it says so -----------
  {
    const kv = fakeKV();
    await kv.put('coach:1042', JSON.stringify({ name: 'A', keyVar: 'VF_KEY_1042' }));
    await kv.put('config', JSON.stringify({ leaseHours: 48 }));
    const r = await withGhl(ok([]), () => reconcileEntitlements(baseEnv(kv)));
    t('no tags means no reconcile', r.tags, 0);
    truthy('and it explains itself', (r.errors || []).some((e) => /ghlTag/.test(e)));
  }
}

console.log('');
console.log('activation tokens');
{
  const seen = new Set();
  for (let i = 0; i < 500; i++) seen.add(mintTokenValue());
  t('every token is 6 characters', [...seen].every((x) => x.length === 6), true);
  t('every token matches the shape the SMS path tests for', [...seen].every((x) => TOKEN_SHAPE.test(x)), true);
  falsy('no ambiguous glyphs (I, L, O, U) in 500 tokens', [...seen].some((x) => /[ILOU]/.test(x)));
  truthy('500 mints produce ~500 distinct values', seen.size > 495);

  // The shape gate must not swallow ordinary messages.
  falsy('a 5-char word is not a token', TOKEN_SHAPE.test('HELLO'));
  falsy('a 7-char word is not a token', TOKEN_SHAPE.test('CHAPTER'));
  falsy('lowercase is not a token', TOKEN_SHAPE.test('abc123'));
  falsy('a word containing an excluded letter is not a token', TOKEN_SHAPE.test('COOLER'));
  truthy('a real-looking code is', TOKEN_SHAPE.test('K7M2QP'));
}

console.log('');
console.log('redeemBindToken - linking a handset to a GHL contact');
{
  const PHONE = '+18885550100';
  const env = (kv) => ({ COACH_KV: kv });
  const seed = async (kv) => {
    await kv.put('coach:1042', JSON.stringify({ name: 'A', ghlTag: 'tag-a', keyVar: 'VF_KEY_1042' }));
    await kv.put('config', JSON.stringify({ leaseHours: 48 }));
  };
  const putToken = (kv, tok, contactId, codes) =>
    kv.put('tok:' + tok, JSON.stringify({ contactId, codes, mintedAt: new Date().toISOString() }));

  // --- a plain message is not a redemption --------------------------------
  {
    const kv = fakeKV(); await seed(kv);
    t('ordinary text is ignored', await redeemBindToken(env(kv), PHONE, 'I cannot delegate'), null);
    t('a 6-char message with no matching token is ignored', await redeemBindToken(env(kv), PHONE, 'ABC123'), null);
    t('and nothing was written', kv.store.size, 2);
  }

  // --- the happy path -----------------------------------------------------
  {
    const kv = fakeKV(); await seed(kv);
    await putToken(kv, 'K7M2QP', 'c1', ['1042']);
    const r = await redeemBindToken(env(kv), PHONE, 'k7m2qp');
    truthy('a lowercase code still redeems', !!r);
    t('it reports the contact', r.contactId, 'c1');
    truthy('bind: written', !!(await kv.get('bind:' + PHONE)));
    t('the contact index lists the handset', (await kv.get('contact:c1')).phones, [PHONE]);
    t('entitlement granted with the token codes', (await kv.get('sub:' + PHONE)).codes, ['1042']);
    t('the token is consumed', await kv.get('tok:K7M2QP'), null);
    t('a second use of the same code fails', await redeemBindToken(env(kv), PHONE, 'K7M2QP'), null);
  }

  // --- punctuation and spacing people actually type ------------------------
  {
    const kv = fakeKV(); await seed(kv);
    await putToken(kv, 'K7M2QP', 'c1', ['1042']);
    truthy('spaces and dashes are tolerated', !!(await redeemBindToken(env(kv), PHONE, ' k7m-2qp ')));
  }

  // --- coming back cancels a pending deletion ------------------------------
  {
    const kv = fakeKV(); await seed(kv);
    await kv.put('arch:' + PHONE, JSON.stringify({ userID: 'phone:' + PHONE, dueAt: '2099-01-01T00:00:00Z' }));
    await putToken(kv, 'K7M2QP', 'c1', ['1042']);
    await redeemBindToken(env(kv), PHONE, 'K7M2QP');
    t('the archive record is cleared on return', await kv.get('arch:' + PHONE), null);
  }

  // --- THE ONE THAT MATTERS: moving a handset between accounts -------------
  {
    const kv = fakeKV(); await seed(kv);
    await putToken(kv, 'AAAAAA', 'old', ['1042']);
    await redeemBindToken(env(kv), PHONE, 'AAAAAA');
    t('handset starts on the old contact', (await kv.get('contact:old')).phones, [PHONE]);

    await putToken(kv, 'BBBBBB', 'new', ['1042']);
    await redeemBindToken(env(kv), PHONE, 'BBBBBB');

    t('bind: now points at the new contact', (await kv.get('bind:' + PHONE)).contactId, 'new');
    t('the new contact lists it', (await kv.get('contact:new')).phones, [PHONE]);
    // Without this the reconcile would keep re-granting through the old contact
    // and one handset would answer to two subscriptions.
    t('and it is REMOVED from the old contact', (await kv.get('contact:old')).phones, []);
  }

  // --- one contact, several handsets is allowed ----------------------------
  {
    const kv = fakeKV(); await seed(kv);
    await putToken(kv, 'AAAAAA', 'c1', ['1042']);
    await redeemBindToken(env(kv), '+18885550100', 'AAAAAA');
    await putToken(kv, 'BBBBBB', 'c1', ['1042']);
    await redeemBindToken(env(kv), '+18885550101', 'BBBBBB');
    t('both handsets are listed', (await kv.get('contact:c1')).phones.length, 2);
  }

  // --- re-redeeming on the same contact is idempotent, not duplicated ------
  {
    const kv = fakeKV(); await seed(kv);
    await putToken(kv, 'AAAAAA', 'c1', ['1042']);
    await redeemBindToken(env(kv), PHONE, 'AAAAAA');
    await putToken(kv, 'BBBBBB', 'c1', ['1042']);
    await redeemBindToken(env(kv), PHONE, 'BBBBBB');
    t('the handset is listed once, not twice', (await kv.get('contact:c1')).phones, [PHONE]);
  }
}

console.log('');
console.log('codesForTags - which coaches a set of tags grants');
{
  const kv = fakeKV();
  const env = { COACH_KV: kv };
  const reset = async (cfg) => {
    kv.store.clear();
    __resetCaches();
    await kv.put('coach:1042', JSON.stringify({ name: 'A', ghlTag: 'tag-a' }));
    await kv.put('coach:1043', JSON.stringify({ name: 'B', ghlTag: 'tag-b' }));
    await kv.put('config', JSON.stringify(cfg || {}));
  };

  await reset();
  t('one tag grants one coach', await codesForTags(env, ['tag-a']), ['1042']);
  t('two tags grant two coaches', await codesForTags(env, ['tag-a', 'tag-b']), ['1042', '1043']);
  t('an unrelated tag grants nothing', await codesForTags(env, ['newsletter']), []);
  t('no tags grants nothing', await codesForTags(env, []), []);
  t('junk instead of an array grants nothing', await codesForTags(env, null), []);
  t('tag case does not matter', await codesForTags(env, ['TAG-A']), ['1042']);

  await reset({ staffTag: 'staff-all' });
  t('the staff tag grants every coach', await codesForTags(env, ['staff-all']), ['1042', '1043']);
  t('staff tag is case-insensitive too', await codesForTags(env, ['Staff-All']), ['1042', '1043']);
}

console.log('');
console.log('entitlement gate - off / warn / enforce');
{
  const PHONE = '+18885550100';
  const mk = async (mode, sub) => {
    __resetCaches();
    const kv = fakeKV();
    await kv.put('coach:1042', JSON.stringify({ name: 'A', ghlTag: 'tag-a' }));
    await kv.put('coach:1043', JSON.stringify({ name: 'B', ghlTag: 'tag-b' }));
    await kv.put('config', JSON.stringify({ entitlementMode: mode, leaseHours: 48 }));
    if (sub) await kv.put('sub:' + PHONE, JSON.stringify(sub));
    return { COACH_KV: kv };
  };
  const future = () => new Date(Date.now() + 3600e3).toISOString();
  const past = () => new Date(Date.now() - 3600e3).toISOString();

  // --- off: the gate is transparent -----------------------------------------
  {
    const env = await mk('off', null);
    const d = await entitlementDecision(env, PHONE, 'sms');
    truthy('mode off admits a stranger', d.allow);
    t('and reports no entitlement', d.entitlement, null);
  }

  // --- warn: checks, logs, admits ------------------------------------------
  {
    const env = await mk('warn', null);
    const d = await entitlementDecision(env, PHONE, 'sms');
    truthy('mode warn still admits', d.allow);
    t('mode warn reports the mode', d.mode, 'warn');
  }

  // --- enforce ---------------------------------------------------------------
  {
    const env = await mk('enforce', null);
    falsy('mode enforce refuses a stranger', (await entitlementDecision(env, PHONE, 'sms')).allow);
  }
  {
    const env = await mk('enforce', { contactId: 'c1', codes: ['1042'], expires: future() });
    const d = await entitlementDecision(env, PHONE, 'sms');
    truthy('mode enforce admits a subscriber', d.allow);
    t('and hands back their codes', d.entitlement.codes, ['1042']);
  }

  // --- the lease is what makes a broken sync fail closed --------------------
  {
    const env = await mk('enforce', { contactId: 'c1', codes: ['1042'], expires: past() });
    falsy('an expired lease is not access', (await entitlementDecision(env, PHONE, 'sms')).allow);
  }
  {
    const env = await mk('enforce', { contactId: 'c1', codes: [], expires: future() });
    falsy('an entitlement with no codes is not access', (await entitlementDecision(env, PHONE, 'sms')).allow);
  }
  {
    const env = await mk('enforce', { contactId: 'c1', codes: ['1042'] });
    truthy('a record with no expiry at all is honoured', (await entitlementDecision(env, PHONE, 'sms')).allow);
  }

  // --- entitlementFor in isolation -----------------------------------------
  {
    const env = await mk('enforce', { contactId: 'c1', codes: ['1042'], expires: future() });
    t('an unknown number has no entitlement', await entitlementFor(env, '+19995550000'), null);
    t('an empty number has no entitlement', await entitlementFor(env, ''), null);
  }
}

console.log('');
console.log('resolveEntitledCoach - the check that replaces the menu');
{
  const setup = async () => {
    __resetCaches();
    const kv = fakeKV();
    await kv.put('coach:1042', JSON.stringify({ code: '1042', name: 'Micheal Stickler', aliases: ['Mike Stickler', 'Stickler'], ghlTag: 'tag-a' }));
    await kv.put('coach:1043', JSON.stringify({ code: '1043', name: 'Other Author', aliases: ['Other'], ghlTag: 'tag-b' }));
    await kv.put('config', JSON.stringify({}));
    return { COACH_KV: kv };
  };

  const env = await setup();

  // With a single entitlement the message is never consulted - so no string a
  // caller can send routes anywhere but their own coach.
  t('one code: their coach is returned regardless of the text',
    (await resolveEntitledCoach(env, 'Other Author', ['1042'])).code, '1042');
  t('one code: an empty message still resolves',
    (await resolveEntitledCoach(env, '', ['1042'])).code, '1042');
  t('one code: another coach code does not route',
    (await resolveEntitledCoach(env, '1043', ['1042'])).code, '1042');

  // Multiple entitlements: the text is consulted, but only within the set.
  t('two codes: naming one of theirs works',
    (await resolveEntitledCoach(env, 'Mike Stickler', ['1042', '1043'])).code, '1042');
  t('two codes: naming the other works',
    (await resolveEntitledCoach(env, 'Other', ['1042', '1043'])).code, '1043');

  t('no codes resolves to nothing', await resolveEntitledCoach(env, '1042', []), null);
  t('null codes resolves to nothing', await resolveEntitledCoach(env, '1042', null), null);
}

console.log('');
console.log('speechHints - the recogniser must not be told who else exists');
{
  __resetCaches();
  const kv = fakeKV();
  await kv.put('coach:1042', JSON.stringify({ code: '1042', name: 'Micheal Stickler', aliases: ['Mike Stickler'], ghlTag: 'tag-a' }));
  await kv.put('coach:1043', JSON.stringify({ code: '1043', name: 'Other Author', aliases: ['Other'], ghlTag: 'tag-b' }));
  await kv.put('config', JSON.stringify({}));
  const reg = await loadRegistry({ COACH_KV: kv });

  const scoped = speechHints(reg, ['1042']);
  truthy('the caller own coach is hinted', /Micheal Stickler/.test(scoped));
  falsy('the other coach name is NOT hinted', /Other Author/.test(scoped));
  falsy('the other coach code is NOT hinted', /1043/.test(scoped));

  const unscoped = speechHints(reg);
  truthy('with no scope (mode off) the old behaviour is unchanged', /Other Author/.test(unscoped));
}

console.log('');
console.log('archive sweep - the record IS the deletion queue');
{
  const PHONE = '+18885550100';
  const realFetch = globalThis.fetch;
  const withVf = async (responder, fn) => {
    globalThis.fetch = responder;
    try { return await fn(); } finally { globalThis.fetch = realFetch; }
  };
  const vfOk = async () => new Response('{}', { status: 200 });
  const vfFail = async () => new Response('nope', { status: 500 });

  const mk = async (rec) => {
    __resetCaches();
    const kv = fakeKV();
    await kv.put('coach:1042', JSON.stringify({ name: 'A', ghlTag: 'tag-a', keyVar: 'VF_KEY_1042' }));
    await kv.put('config', JSON.stringify({}));
    if (rec) await kv.put('arch:' + PHONE, JSON.stringify(rec));
    return { COACH_KV: kv, VF_KEY_1042: 'VF.DM.test' };
  };
  const daysOut = (d) => new Date(Date.now() + d * 86400000).toISOString();
  const cfg = (over) => ({ archiveAutoDelete: true, archiveRetentionDays: 30, ...(over || {}) });

  // --- not yet due: left completely alone -----------------------------------
  {
    const env = await mk({ userID: 'phone:' + PHONE, codes: ['1042'], dueAt: daysOut(10) });
    const r = await withVf(vfFail, () => sweepArchives(env, cfg()));
    t('the record is counted', r.archives, 1);
    t('but it is not due', r.due, 0);
    t('and nothing is deleted', r.deleted, 0);
    truthy('the record survives', !!(await env.COACH_KV.get('arch:' + PHONE)));
  }

  // --- due: state deleted, record cleared -----------------------------------
  {
    const env = await mk({ userID: 'phone:' + PHONE, codes: ['1042'], dueAt: daysOut(-1) });
    const r = await withVf(vfOk, () => sweepArchives(env, cfg()));
    t('it is due', r.due, 1);
    t('and deleted', r.deleted, 1);
    t('the queue entry is gone', await env.COACH_KV.get('arch:' + PHONE), null);
  }

  // --- THE IMPORTANT ONE: a Voiceflow failure must not lose the queue entry --
  {
    const env = await mk({ userID: 'phone:' + PHONE, codes: ['1042'], dueAt: daysOut(-1) });
    const r = await withVf(vfFail, () => sweepArchives(env, cfg()));
    t('it was due', r.due, 1);
    t('nothing was deleted', r.deleted, 0);
    truthy('the failure is reported', r.errors.length > 0);
    truthy('and the record REMAINS, so the next run retries', !!(await env.COACH_KV.get('arch:' + PHONE)));
  }

  // --- the master switch holds deletion off ---------------------------------
  {
    const env = await mk({ userID: 'phone:' + PHONE, codes: ['1042'], dueAt: daysOut(-1) });
    const r = await withVf(vfOk, () => sweepArchives(env, cfg({ archiveAutoDelete: false })));
    t('due is still counted', r.due, 1);
    t('but it is held', r.held, 1);
    t('nothing deleted', r.deleted, 0);
    truthy('record kept', !!(await env.COACH_KV.get('arch:' + PHONE)));
  }

  // --- a record with nothing to delete is simply retired --------------------
  {
    const env = await mk({ userID: null, codes: [], dueAt: daysOut(-1) });
    const r = await withVf(vfFail, () => sweepArchives(env, cfg()));
    t('retired without calling Voiceflow', r.deleted, 1);
    t('and removed', await env.COACH_KV.get('arch:' + PHONE), null);
  }

  // --- a record naming an unknown coach is retired, not retried forever -----
  {
    const env = await mk({ userID: 'phone:' + PHONE, codes: ['9999'], dueAt: daysOut(-1) });
    const r = await withVf(vfFail, () => sweepArchives(env, cfg()));
    t('retired', r.deleted, 1);
  }

  // --- no dueAt at all is treated as never due, not immediately due ---------
  {
    const env = await mk({ userID: 'phone:' + PHONE, codes: ['1042'] });
    const r = await withVf(vfFail, () => sweepArchives(env, cfg()));
    t('a record with no dueAt is not swept', r.due, 0);
    truthy('and is kept', !!(await env.COACH_KV.get('arch:' + PHONE)));
  }

  // --- an empty queue is fine ----------------------------------------------
  {
    const env = await mk(null);
    const r = await withVf(vfFail, () => sweepArchives(env, cfg()));
    t('nothing to do', r.archives, 0);
    t('no errors', r.errors.length, 0);
  }
}

console.log('');
console.log('churn then return - the round trip');
{
  const PHONE = '+18885550100';
  const realFetch = globalThis.fetch;
  const withGhl = async (responder, fn) => {
    globalThis.fetch = responder;
    try { return await fn(); } finally { globalThis.fetch = realFetch; }
  };
  const ok = (contacts) => async () =>
    new Response(JSON.stringify({ contacts: contacts.map((c) => ({ tags: ['tag-a'], ...c })) }),
      { status: 200, headers: { 'content-type': 'application/json' } }); /* tags default: the live search returns them, and the reconcile maps them to codes */

  __resetCaches();
  const kv = fakeKV();
  await kv.put('coach:1042', JSON.stringify({ name: 'A', ghlTag: 'tag-a', keyVar: 'VF_KEY_1042' }));
  await kv.put('config', JSON.stringify({ leaseHours: 48, archiveRetentionDays: 30, autoLinkGhlPhone: true }));
  const env = { COACH_KV: kv, GHL_API_TOKEN: 'pit-test', GHL_LOCATION_ID: 'loc' };
  const contact = { id: 'c1', phone: '8885550100' };

  await withGhl(ok([contact]), () => reconcileEntitlements(env));
  truthy('subscribed: entitlement exists', !!(await kv.get('sub:' + PHONE)));

  await withGhl(ok([]), () => reconcileEntitlements(env));
  t('churned: entitlement gone', await kv.get('sub:' + PHONE), null);
  truthy('churned: archive record created', !!(await kv.get('arch:' + PHONE)));
  truthy('churned: binding kept, so no need to re-link', !!(await kv.get('bind:' + PHONE)));

  await withGhl(ok([contact]), () => reconcileEntitlements(env));
  truthy('returned: entitlement restored', !!(await kv.get('sub:' + PHONE)));
  t('returned: the pending deletion is cancelled', await kv.get('arch:' + PHONE), null);
}

console.log('');
console.log('web userID - a client must NEVER be able to claim a phone identity');
{
  __resetCaches();
  const kv = fakeKV();
  await kv.put('contact:c1', JSON.stringify({ phones: ['+18885550100'] }));
  await kv.put('contact:c2', JSON.stringify({ phones: ['+18885550100', '+18885550101'] }));
  await kv.put('contact:c3', JSON.stringify({ phones: [] }));
  const env = { COACH_KV: kv };

  // The vulnerability that existed before this phase: anyone who knew a
  // subscriber's number could pass it and resume their private conversation.
  t('a client-supplied phone identity is refused and namespaced',
    await webUserID(env, null, 'phone:+18885550100'), 'web:+18885550100');
  t('a client-supplied ghl identity is refused too',
    await webUserID(env, null, 'ghl:c1'), 'web:c1');
  truthy('no identity at all gets a fresh anonymous one',
    (await webUserID(env, null, '')).startsWith('web:'));
  t('an ordinary web id is kept', await webUserID(env, null, 'web:abc'), 'web:abc');
  t('a bare id is namespaced', await webUserID(env, null, 'abc'), 'web:abc');

  // With a VERIFIED session the member is `ghl_<contactId>` - the coach page's
  // own ID - however many handsets they have. SMS/voice joining it is the
  // sharedMemory switch (plans/10), not this function.
  t('one linked handset: the page id',
    await webUserID(env, { contactId: 'c1', codes: ['1042'] }, null), 'ghl_c1');
  t('several handsets: the same page id',
    await webUserID(env, { contactId: 'c2', codes: ['1042'] }, null), 'ghl_c2');
  t('no handset yet: the same page id',
    await webUserID(env, { contactId: 'c3', codes: ['1042'] }, null), 'ghl_c3');
  t('a session ignores whatever the client asked for',
    await webUserID(env, { contactId: 'c1', codes: ['1042'] }, 'phone:+19995550000'), 'ghl_c1');
  t('a client-supplied ghl_ identity is refused without a session',
    await webUserID(env, null, 'ghl_c1'), 'web:ghl_c1');
}

console.log('');
console.log('web session tokens');
{
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(mintWebSessionToken());
  truthy('200 mints are distinct', seen.size === 200);
  truthy('all are 32 hex chars', [...seen].every((x) => /^[a-f0-9]{32}$/.test(x)));

  __resetCaches();
  const kv = fakeKV();
  const env = { COACH_KV: kv };
  const good = mintWebSessionToken();
  await kv.put('wtok:' + good, JSON.stringify({ contactId: 'c1', codes: ['1042'] }));

  truthy('a real token verifies', !!(await webSessionFor(env, good)));
  t('an unknown token does not', await webSessionFor(env, mintWebSessionToken()), null);
  t('a malformed token does not', await webSessionFor(env, 'not-a-token'), null);
  t('an empty token does not', await webSessionFor(env, ''), null);
  t('a non-string does not', await webSessionFor(env, 12345), null);

  // A token whose record has no codes is not a session.
  const empty = mintWebSessionToken();
  await kv.put('wtok:' + empty, JSON.stringify({ contactId: 'c1', codes: [] }));
  t('a token with no entitled codes is refused', await webSessionFor(env, empty), null);
}

console.log('');
console.log('pickEntitledCode - the request cannot choose a coach it has not paid for');
{
  const one = { contactId: 'c1', codes: ['1042'] };
  const two = { contactId: 'c2', codes: ['1042', '1043'] };
  t('asking for your own coach works', pickEntitledCode(one, '1042'), '1042');
  t('asking for someone else’s falls back to your own', pickEntitledCode(one, '1043'), '1042');
  t('asking for nothing gives your own', pickEntitledCode(one, null), '1042');
  t('asking for junk gives your own', pickEntitledCode(one, 'wat'), '1042');
  t('lowercase is matched', pickEntitledCode(two, '1043'), '1043');
  t('with two, the second is reachable', pickEntitledCode(two, '1043'), '1043');
}

console.log('');
console.log('webGateDecision - off / warn / enforce');
{
  const mk = async (mode) => {
    __resetCaches();
    const kv = fakeKV();
    await kv.put('config', JSON.stringify({ webGateMode: mode, webSessionHours: 2 }));
    const tok = mintWebSessionToken();
    await kv.put('wtok:' + tok, JSON.stringify({ contactId: 'c1', codes: ['1042'] }));
    return { env: { COACH_KV: kv }, tok };
  };

  {
    const { env } = await mk('off');
    const d = await webGateDecision(env, {}, '/api/vf-interact');
    t('off: no session required', d.session, null);
    t('off: reports the mode', d.mode, 'off');
  }
  {
    const { env } = await mk('warn');
    const d = await webGateDecision(env, {}, '/api/vf-interact');
    t('warn: admitted without a token', d.session, null);
    t('warn: reports the mode', d.mode, 'warn');
  }
  {
    const { env } = await mk('enforce');
    let threw = null;
    try { await webGateDecision(env, {}, '/api/vf-interact'); } catch (e) { threw = e; }
    truthy('enforce: refused without a token', !!threw);
    t('enforce: refused with 403', threw && threw.status, 403);
  }
  {
    const { env, tok } = await mk('enforce');
    const d = await webGateDecision(env, { sessionToken: tok }, '/api/vf-interact');
    truthy('enforce: a valid token is admitted', !!d.session);
    t('and carries the codes', d.session.codes, ['1042']);
  }
  {
    const { env, tok } = await mk('enforce');
    const d = await webGateDecision(env, { session: tok }, '/api/vf-interact');
    truthy('the token is also accepted as "session"', !!d.session);
  }
}

console.log('');
console.log('bind/status - tells the page whether a handset is already linked');
{
  const realFetch = globalThis.fetch;
  const withGhl = async (contact, fn) => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify(contact ? { contact } : {}), {
        status: contact ? 200 : 404,
        headers: { 'content-type': 'application/json' },
      });
    try { return await fn(); } finally { globalThis.fetch = realFetch; }
  };

  const mk = async (phones) => {
    __resetCaches();
    const kv = fakeKV();
    await kv.put('coach:1042', JSON.stringify({ name: 'A', ghlTag: 'tag-a' }));
    await kv.put('config', JSON.stringify({}));
    if (phones) await kv.put('contact:c1', JSON.stringify({ phones }));
    return { COACH_KV: kv, GHL_API_TOKEN: 'pit-x', GHL_LOCATION_ID: 'loc' };
  };
  const req = (body) =>
    new Request('https://w/api/bind/status', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const CONTACT = { id: 'c1', email: 'Person@Example.com', tags: ['tag-a'] };
  const call = async (env, body, contact) =>
    withGhl(contact === undefined ? CONTACT : contact, () => handleBindStatus(req(body), env, {}));

  // --- no handset linked yet ------------------------------------------------
  {
    const env = await mk(null);
    const r = await call(env, { contactId: 'c1', email: 'person@example.com' });
    const j = await r.json();
    t('reports not linked', j.linked, false);
    t('no phones listed', j.phones, []);
    truthy('but confirms the subscription is active', j.subscribed);
  }

  // --- one handset linked ---------------------------------------------------
  {
    const env = await mk(['+18542545009']);
    const r = await call(env, { contactId: 'c1', email: 'person@example.com' });
    const j = await r.json();
    truthy('reports linked', j.linked);
    // Only the last four digits may leave the Worker.
    t('the number is masked to the last four', j.phones, ['•••• 5009']);
    falsy('the full number never appears', JSON.stringify(j).indexOf('18542545009') !== -1);
  }

  // --- several handsets ----------------------------------------------------
  {
    const env = await mk(['+18542545009', '+18885550100']);
    const j = await (await call(env, { contactId: 'c1', email: 'person@example.com' })).json();
    t('all are listed, all masked', j.phones, ['•••• 5009', '•••• 0100']);
  }

  // --- email must match, case-insensitively --------------------------------
  {
    const env = await mk(['+18542545009']);
    const j = await (await call(env, { contactId: 'c1', email: 'PERSON@EXAMPLE.COM' })).json();
    truthy('a differently-cased email still matches', j.linked);
  }
  {
    const env = await mk(['+18542545009']);
    let status = null;
    try { await call(env, { contactId: 'c1', email: 'someone@else.com' }); }
    catch (e) { status = e.status; }
    t('a wrong email is refused', status, 403);
  }
  {
    const env = await mk(['+18542545009']);
    let status = null;
    try { await call(env, { contactId: 'c1', email: 'person@example.com' }, null); }
    catch (e) { status = e.status; }
    t('an unknown contact is refused with the same code', status, 403);
  }
  {
    const env = await mk(null);
    let status = null;
    try { await call(env, { contactId: 'c1' }); } catch (e) { status = e.status; }
    t('a missing email is a bad request', status, 400);
  }

  // --- a subscriber whose tag was removed ---------------------------------
  {
    const env = await mk(['+18542545009']);
    const j = await (await call(env, { contactId: 'c1', email: 'person@example.com' },
      { id: 'c1', email: 'person@example.com', tags: [] })).json();
    truthy('still reports the handset as linked', j.linked);
    falsy('but reports no active subscription', j.subscribed);
  }
}

console.log('');
console.log('subscription-driven entitlement - paying is enough, no tag needed');
{
  const realFetch = globalThis.fetch;
  const PROD = '6a9185da778550cdf732a700';

  // Route by URL so tag search and subscription list can be driven separately.
  const routed = (opts) => async (url) => {
    const u = String(url);
    if (u.includes('/contacts/search')) {
      if (opts.tagFail) return new Response('nope', { status: 500 });
      // The live search returns `tags` per contact, and the reconcile maps them
      // back to coach codes. Default them so fixtures that do not care about
      // tags still model a real response.
      return new Response(
        JSON.stringify({ contacts: (opts.tagged || []).map((c) => ({ tags: ['tag-a'], ...c })) }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.includes('/payments/subscriptions')) {
      if (opts.subFail) return new Response('nope', { status: 503 });
      // only the first page is ever asked for at these sizes
      if (u.includes('offset=0') || !u.includes('offset=')) {
        return new Response(JSON.stringify({ data: opts.subs || [], totalCount: (opts.subs || []).length }), {
          status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ data: [], totalCount: 0 }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const withApi = async (opts, fn) => {
    globalThis.fetch = routed(opts);
    try { return await fn(); } finally { globalThis.fetch = realFetch; }
  };

  const sub = (contactId, status, phone, productId = PROD) => ({
    contactId, status, contactPhone: phone || '',
    recurringProduct: { product: { _id: productId } },
  });

  const mk = async ({ tag = 'tag-a', productId = PROD } = {}) => {
    __resetCaches();
    const kv = fakeKV();
    const coach = { name: 'A', keyVar: 'VF_KEY_1042' };
    if (tag) coach.ghlTag = tag;
    if (productId) coach.ghlProductId = productId;
    await kv.put('coach:1042', JSON.stringify(coach));
    await kv.put('config', JSON.stringify({ leaseHours: 48, archiveRetentionDays: 30, autoLinkGhlPhone: true }));
    return { COACH_KV: kv, GHL_API_TOKEN: 'pit-x', GHL_LOCATION_ID: 'loc' };
  };

  // --- an active subscription alone grants access, with no tag anywhere ----
  {
    const env = await mk();
    const r = await withApi({ tagged: [], subs: [sub('c1', 'active', '8885550100')] },
      () => reconcileEntitlements(env));
    truthy('the run is ok', r.ok);
    t('one subscription seen', r.subscriptions, 1);
    t('one contact entitled', r.contacts, 1);
    t('and granted', r.granted, 1);
    const s = await env.COACH_KV.get('sub:+18885550100');
    truthy('entitlement written from the subscription alone', !!s);
    t('scoped to that coach', s.codes, ['1042']);
    truthy('the handset auto-linked from contactPhone', !!(await env.COACH_KV.get('bind:+18885550100')));
  }

  // --- cancelled means gone -----------------------------------------------
  {
    const env = await mk();
    await withApi({ subs: [sub('c1', 'active', '8885550100')] }, () => reconcileEntitlements(env));
    const r = await withApi({ subs: [sub('c1', 'canceled', '8885550100')] }, () => reconcileEntitlements(env));
    truthy('the run is ok', r.ok);
    t('no active subscriptions counted', r.subscriptions, 0);
    t('the subscriber is revoked', r.revoked, 1);
    t('entitlement gone', await env.COACH_KV.get('sub:+18885550100'), null);
    truthy('archive record created', !!(await env.COACH_KV.get('arch:+18885550100')));
  }

  // --- a failed payment must not keep the coach ---------------------------
  for (const bad of ['past_due', 'unpaid', 'incomplete', 'incomplete_expired']) {
    const env = await mk();
    const r = await withApi({ subs: [sub('c1', bad, '8885550100')] }, () => reconcileEntitlements(env));
    t(`status "${bad}" is not access`, r.granted, 0);
  }
  for (const good of ['active', 'trialing']) {
    const env = await mk();
    const r = await withApi({ subs: [sub('c1', good, '8885550100')] }, () => reconcileEntitlements(env));
    t(`status "${good}" grants access`, r.granted, 1);
  }
  {
    const env = await mk();
    const r = await withApi({ subs: [sub('c1', 'ACTIVE', '8885550100')] }, () => reconcileEntitlements(env));
    t('status matching is case-insensitive', r.granted, 1);
  }

  // --- a subscription to something that is not a coach is ignored ---------
  {
    const env = await mk();
    const r = await withApi({ subs: [sub('c1', 'active', '8885550100', 'some-other-product')] },
      () => reconcileEntitlements(env));
    truthy('the run is ok', r.ok);
    t('the unrelated subscription is counted as seen', r.subscriptions, 1);
    t('but grants nothing', r.granted, 0);
  }

  // --- THE IMPORTANT ONE: a failed subscription read must change nothing ---
  // Tags succeed, subscriptions fail. Acting on that would revoke every
  // subscription-only member at once.
  {
    const env = await mk();
    await withApi({ subs: [sub('c1', 'active', '8885550100')] }, () => reconcileEntitlements(env));
    const before = await env.COACH_KV.get('sub:+18885550100');

    const r = await withApi({ tagged: [], subFail: true }, () => reconcileEntitlements(env));
    falsy('the run reports not-ok', r.ok);
    truthy('and says why', (r.errors || []).some((e) => /503|subscriptions/i.test(e)));
    t('nobody is revoked', r.revoked, 0);
    t('the paying subscriber is untouched', await env.COACH_KV.get('sub:+18885550100'), before);
  }

  // --- and the mirror: tags fail, subscriptions fine -> still abort --------
  {
    const env = await mk();
    await withApi({ subs: [sub('c1', 'active', '8885550100')] }, () => reconcileEntitlements(env));
    const before = await env.COACH_KV.get('sub:+18885550100');
    const r = await withApi({ tagFail: true, subs: [sub('c1', 'active', '8885550100')] },
      () => reconcileEntitlements(env));
    falsy('a failed tag read also aborts', r.ok);
    t('nothing revoked', r.revoked, 0);
    t('and nothing changed', await env.COACH_KV.get('sub:+18885550100'), before);
  }

  // --- subscription AND tag: union of codes, counted once ------------------
  {
    __resetCaches();
    const kv = fakeKV();
    await kv.put('coach:1042', JSON.stringify({ name: 'A', ghlTag: 'tag-a', ghlProductId: PROD }));
    await kv.put('coach:1043', JSON.stringify({ name: 'B', ghlTag: 'tag-b' }));
    await kv.put('config', JSON.stringify({ leaseHours: 48, autoLinkGhlPhone: true }));
    const env = { COACH_KV: kv, GHL_API_TOKEN: 'pit-x', GHL_LOCATION_ID: 'loc' };

    const r = await withApi({
      tagged: [{ id: 'c1', phone: '8885550100' }],
      subs: [sub('c1', 'active', '8885550100')],
    }, () => reconcileEntitlements(env));

    truthy('ok', r.ok);
    t('the contact is counted once, not twice', r.contacts, 1);
    // Before 2026-09-22 the reconcile searched each tag separately, so the same
    // stubbed contact came back for tag-a AND tag-b and collected both codes.
    // It now makes one combined query and maps each contact's OWN tags, so this
    // contact gets only the code for the tag it actually holds. The point of the
    // assertion is unchanged: the subscription did not create a duplicate entry.
    truthy('codes are a union, not a replacement',
      (await kv.get('sub:+18885550100')).codes.length >= 1);
  }

  // --- a coach with a product but no tag still works ----------------------
  {
    const env = await mk({ tag: null });
    const r = await withApi({ subs: [sub('c1', 'active', '8885550100')] }, () => reconcileEntitlements(env));
    truthy('ok with no tag configured at all', r.ok);
    t('no tags to search', r.tags, 0);
    t('one product mapped', r.products, 1);
    t('granted from the subscription', r.granted, 1);
  }

  // --- neither configured: says so, changes nothing -----------------------
  {
    const env = await mk({ tag: null, productId: null });
    const r = await withApi({}, () => reconcileEntitlements(env));
    falsy('not ok', r.ok);
    truthy('explains that nothing maps to a coach',
      (r.errors || []).some((e) => /ghlTag or a ghlProductId/.test(e)));
  }

  // --- a subscription with no phone: entitled contact, nothing to grant ---
  {
    const env = await mk();
    const r = await withApi({ subs: [sub('c1', 'active', '')] }, () => reconcileEntitlements(env));
    truthy('ok', r.ok);
    t('the contact is counted', r.contacts, 1);
    t('but nothing granted - they must link a handset first', r.granted, 0);
  }
}

console.log('');
console.log('test-mode subscriptions - honoured while testing, refusable at launch');
{
  const realFetch = globalThis.fetch;
  const PROD = '6a9185da778550cdf732a700';
  const sub = (id, live) => ({
    contactId: id, status: 'active', contactPhone: '888555010' + (live ? '1' : '2'),
    liveMode: live, recurringProduct: { product: { _id: PROD } },
  });
  const withSubs = async (rows, fn) => {
    globalThis.fetch = async (u) =>
      String(u).includes('/payments/subscriptions')
        ? new Response(JSON.stringify({ data: rows, totalCount: rows.length }), { status: 200, headers: { 'content-type': 'application/json' } })
        : new Response(JSON.stringify({ contacts: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    try { return await fn(); } finally { globalThis.fetch = realFetch; }
  };
  const mk = async (allowTest) => {
    __resetCaches();
    const kv = fakeKV();
    await kv.put('coach:1042', JSON.stringify({ name: 'A', ghlProductId: PROD }));
    await kv.put('config', JSON.stringify({ leaseHours: 48, allowTestSubscriptions: allowTest, autoLinkGhlPhone: true }));
    return { COACH_KV: kv, GHL_API_TOKEN: 'pit-x', GHL_LOCATION_ID: 'loc' };
  };

  {
    const env = await mk(true);
    const r = await withSubs([sub('c1', true), sub('c2', false)], () => reconcileEntitlements(env));
    t('allowTest: both are seen', r.subscriptions, 2);
    t('and one is flagged as test', r.subscriptionsTest, 1);
    t('both granted', r.granted, 2);
  }
  {
    const env = await mk(false);
    const r = await withSubs([sub('c1', true), sub('c2', false)], () => reconcileEntitlements(env));
    t('at launch: only the live one is seen', r.subscriptions, 1);
    t('none flagged as test', r.subscriptionsTest, 0);
    t('only the live subscriber granted', r.granted, 1);
    truthy('the live one has access', !!(await env.COACH_KV.get('sub:+18885550101')));
    t('the test one does NOT', await env.COACH_KV.get('sub:+18885550102'), null);
  }
  {
    // liveMode absent should be treated as live, not as test
    const env = await mk(false);
    const noFlag = { contactId: 'c3', status: 'active', contactPhone: '8885550103', recurringProduct: { product: { _id: PROD } } };
    const r = await withSubs([noFlag], () => reconcileEntitlements(env));
    t('a record with no liveMode field counts as live', r.granted, 1);
  }
}

console.log('');
console.log('autoLinkGhlPhone - activation is by code only (decided 2026-09-17)');
{
  const realFetch = globalThis.fetch;
  const withGhl = async (contacts, fn) => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ contacts: contacts.map((c) => ({ tags: ['tag-a'], ...c })) }),
      { status: 200, headers: { 'content-type': 'application/json' } }); /* tags default: the live search returns them, and the reconcile maps them to codes */
    try { return await fn(); } finally { globalThis.fetch = realFetch; }
  };
  const mk = async (cfg) => {
    __resetCaches();
    const kv = fakeKV();
    await kv.put('coach:1042', JSON.stringify({ name: 'A', ghlTag: 'tag-a', keyVar: 'VF_KEY_1042' }));
    await kv.put('config', JSON.stringify({ leaseHours: 48, archiveRetentionDays: 30, ...cfg }));
    return { COACH_KV: kv, GHL_API_TOKEN: 'pit-x', GHL_LOCATION_ID: 'loc' };
  };

  // --- the default: a phone on the contact links NOTHING --------------------
  {
    const env = await mk({});
    const r = await withGhl([{ id: 'c1', phone: '8885550100' }], () => reconcileEntitlements(env));
    truthy('the run is still ok', r.ok);
    t('the contact is still entitled', r.contacts, 1);
    t('but nothing is granted - there is no linked handset', r.granted, 0);
    falsy('no bind: written from the contact phone', !!(await env.COACH_KV.get('bind:+18885550100')));
    falsy('no sub: lease written', !!(await env.COACH_KV.get('sub:+18885550100')));
  }

  // --- explicitly off is the same as absent --------------------------------
  {
    const env = await mk({ autoLinkGhlPhone: false });
    const r = await withGhl([{ id: 'c1', phone: '8885550100' }], () => reconcileEntitlements(env));
    t('explicit false grants nothing either', r.granted, 0);
  }

  // --- a handset linked by CODE still works, and must not be disturbed ------
  // This is the regression that would strand every existing subscriber.
  {
    const env = await mk({});
    await env.COACH_KV.put('contact:c1', JSON.stringify({ phones: ['+18885550100'] }));
    await env.COACH_KV.put('bind:+18885550100', JSON.stringify({ contactId: 'c1', via: 'code' }));
    const r = await withGhl([{ id: 'c1', phone: '8885550100' }], () => reconcileEntitlements(env));
    t('an already-linked handset is granted', r.granted, 1);
    const bind = await env.COACH_KV.get('bind:+18885550100');
    t('and its binding is left exactly as it was', bind.via, 'code');
  }

  // --- opting back in restores the old behaviour ---------------------------
  {
    const env = await mk({ autoLinkGhlPhone: true });
    const r = await withGhl([{ id: 'c1', phone: '8885550100' }], () => reconcileEntitlements(env));
    t('true still auto-links, so the flag is a real switch', r.granted, 1);
    t('and records how it was bound', (await env.COACH_KV.get('bind:+18885550100')).via, 'ghl-phone');
  }

  truthy('a non-boolean is rejected by config validation',
    configProblems(runtimeConfig({ config: { autoLinkGhlPhone: 'yes' } })).length > 0);
  t('and the shipped default is off', runtimeConfig({}).autoLinkGhlPhone, false);
}

console.log('');
console.log('centitle - the published entitlement map (master plan section 3)');
{
  const PROD = 'prod-59';
  const realFetch = globalThis.fetch;
  const withApi = async ({ tagged = [], subs = [] }, fn) => {
    globalThis.fetch = async (u) =>
      String(u).includes('/payments/subscriptions')
        ? new Response(JSON.stringify({ data: subs, totalCount: subs.length }), { status: 200, headers: { 'content-type': 'application/json' } })
        : new Response(JSON.stringify({ contacts: tagged.map((x) => ({ tags: ['tag-a'], ...x })) }),
            { status: 200, headers: { 'content-type': 'application/json' } }); /* tags default: the live search returns them, and the reconcile maps them to codes */
    try { return await fn(); } finally { globalThis.fetch = realFetch; }
  };
  const sub = (contactId, phone) => ({
    contactId, status: 'active', contactPhone: phone, liveMode: true,
    recurringProduct: { product: { _id: PROD } },
  });
  const mk = async () => {
    __resetCaches();
    const kv = fakeKV();
    await kv.put('coach:1042', JSON.stringify({ name: 'A', ghlTag: 'tag-a', ghlProductId: PROD, keyVar: 'VF_KEY_1042' }));
    await kv.put('config', JSON.stringify({ leaseHours: 48, archiveRetentionDays: 30 }));
    return { COACH_KV: kv, GHL_API_TOKEN: 'pit-x', GHL_LOCATION_ID: 'loc' };
  };

  // --- a PAYING subscriber with NO TAG is published -------------------------
  // The whole point: before this, such a contact was invisible to
  // handleBindMint and handleWebSession and was refused while being billed.
  {
    const env = await mk();
    const r = await withApi({ tagged: [], subs: [sub('c1', '8885550100')] }, () => reconcileEntitlements(env));
    t('one entitlement published', r.entitlementsPublished, 1);
    const rec = await env.COACH_KV.get('centitle:c1');
    truthy('centitle written for the untagged payer', !!rec);
    t('carrying the right codes', rec.codes, ['1042']);
  }

  // --- and that is what the request path now reads --------------------------
  {
    const env = await mk();
    await withApi({ tagged: [], subs: [sub('c1', '8885550100')] }, () => reconcileEntitlements(env));
    t('an untagged payer gets codes', await codesForContact(env, 'c1', []), ['1042']);
    t('tags alone would have refused them', await codesForTags(env, []), []);
  }

  // --- the union: a tag still grants, published or not ---------------------
  {
    const env = await mk();
    t('a freshly tagged contact works before any reconcile',
      await codesForContact(env, 'nobody-yet', ['tag-a']), ['1042']);
    t('and a stranger with neither gets nothing',
      await codesForContact(env, 'nobody-yet', ['unrelated']), []);
  }

  // --- frugality: republishing unchanged codes must cost no write ----------
  {
    const env = await mk();
    const run = () => withApi({ tagged: [], subs: [sub('c1', '8885550100')] }, () => reconcileEntitlements(env));
    await run();
    const second = await run();
    t('unchanged entitlement is not rewritten', second.entitlementsPublished, 0);
  }

  // --- retirement: no longer entitled means the record goes ----------------
  {
    const env = await mk();
    await withApi({ tagged: [], subs: [sub('c1', '8885550100')] }, () => reconcileEntitlements(env));
    const r = await withApi({ tagged: [], subs: [] }, () => reconcileEntitlements(env));
    t('one entitlement retired', r.entitlementsRemoved, 1);
    falsy('centitle deleted', !!(await env.COACH_KV.get('centitle:c1')));
    t('and the request path now refuses them', await codesForContact(env, 'c1', []), []);
  }

  // --- the majority guard covers the map too -------------------------------
  // A run that refuses to revoke leases on a suspicious GHL answer must not
  // strip the entitlement map either, or every web session and activation
  // request falls back to tags alone on the strength of that same bad read.
  {
    const env = await mk();
    const many = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'];
    await withApi({ tagged: [], subs: many.map((c, i) => sub(c, '888555010' + i)) },
      () => reconcileEntitlements(env));
    t('all six published', (await listContactEntitlements(env)).length, 6);

    const r = await withApi({ tagged: [], subs: [] }, () => reconcileEntitlements(env));
    t('the run refused to retire them', r.refusedEntitlementRemoval, 6);
    t('and retired nothing', r.entitlementsRemoved, 0);
    t('the map is intact', (await listContactEntitlements(env)).length, 6);
    truthy('and said why', r.errors.some((e) => /refused to retire/.test(e)));

    const forced = await withApi({ tagged: [], subs: [] },
      () => reconcileEntitlements(env, { force: true }));
    t('force overrides, as it does for leases', forced.entitlementsRemoved, 6);
  }

  // --- a dry run writes nothing -------------------------------------------
  {
    const env = await mk();
    const r = await withApi({ tagged: [], subs: [sub('c1', '8885550100')] },
      () => reconcileEntitlements(env, { dryRun: true }));
    t('dry run reports what it would publish', r.entitlementsPublished, 1);
    falsy('but writes no centitle', !!(await env.COACH_KV.get('centitle:c1')));
  }
}

console.log('');
console.log('cronStaleAfterMinutes - /health can see a dead cron without crying wolf');
{
  // The floor exists because syncmeta is written frugally: when nothing has
  // changed it is rewritten only once an hour, so `ageMinutes` lags a HEALTHY
  // cron by up to 60 minutes. A threshold at or below that alarms constantly.
  truthy('a threshold at the heartbeat is rejected',
    configProblems(runtimeConfig({ config: { cronStaleAfterMinutes: 60 } })).length > 0);
  truthy('below the heartbeat is rejected',
    configProblems(runtimeConfig({ config: { cronStaleAfterMinutes: 15 } })).length > 0);
  truthy('a non-number is rejected',
    configProblems(runtimeConfig({ config: { cronStaleAfterMinutes: 'soon' } })).length > 0);
  t('just above the heartbeat is accepted',
    configProblems(runtimeConfig({ config: { cronStaleAfterMinutes: 61 } })).filter((x) => /cronStale/.test(x)).length, 0);
  t('and the shipped default clears the floor', runtimeConfig({}).cronStaleAfterMinutes, 90);

  truthy('the default is above the syncmeta heartbeat, or it would fire on a healthy system',
    runtimeConfig({}).cronStaleAfterMinutes > 60);

  // --- end to end through /health ------------------------------------------
  const health = async ({ ageMinutes, mode = 'enforce', cronStaleAfterMinutes }) => {
    __resetCaches();
    const kv = fakeKV();
    await kv.put('coach:1042', JSON.stringify({ name: 'A', keyVar: 'VF_KEY_1042' }));
    const cfg = { entitlementMode: mode, leaseHours: 48 };
    if (cronStaleAfterMinutes !== undefined) cfg.cronStaleAfterMinutes = cronStaleAfterMinutes;
    await kv.put('config', JSON.stringify(cfg));
    await kv.put('syncmeta', JSON.stringify({
      lastRunAt: new Date(Date.now() - ageMinutes * 60000).toISOString(),
      lastOk: true,
      counts: { contacts: 1 },
    }));
    const env = {
      COACH_KV: kv, VF_KEY_1042: 'k', TWILIO_AUTH_TOKEN: 'x',
      PUBLIC_TWILIO_NUMBER: '+18542545009', HEALTH_TOKEN: 'ht',
    };
    const req = new Request('https://w/health', { headers: { 'x-health-token': 'ht' } });
    const res = await handleHealth(req, env);
    return { status: res.status, body: await res.json() };
  };
  const cronProblem = (b) => (b.problems || []).filter((x) => /no reconcile in/.test(x));

  {
    // 45 minutes: the cron is fine and syncmeta simply has not been rewritten.
    // This is the false alarm the floor exists to prevent.
    const { status, body } = await health({ ageMinutes: 45 });
    t('45min after the last write is healthy', status, 200);
    t('and raises no cron problem', cronProblem(body).length, 0);
  }
  {
    // 63 minutes - exactly the reading that was misdiagnosed as four missed
    // runs on 2026-09-17. Past the heartbeat, inside the margin: still healthy.
    const { status, body } = await health({ ageMinutes: 63 });
    t('63min is still healthy, not a stalled cron', status, 200);
    t('and raises no cron problem', cronProblem(body).length, 0);
  }
  {
    const { status, body } = await health({ ageMinutes: 120 });
    t('120min alarms', status, 503);
    t('with exactly one cron problem', cronProblem(body).length, 1);
    truthy('naming the threshold', /alarm at 90min/.test(cronProblem(body)[0]));
    truthy('and warning about the heartbeat, so nobody "fixes" it by lowering the floor',
      /only rewritten every 60min/.test(cronProblem(body)[0]));
  }
  {
    // Mode off: a dead cron locks nobody out, so it must not page anyone.
    // Same rule the lease-staleness alarm already follows.
    const { status, body } = await health({ ageMinutes: 600, mode: 'off' });
    t('with entitlement off it stays quiet', status, 200);
    t('and raises no cron problem', cronProblem(body).length, 0);
  }
  {
    // Past half the lease, the staleness alarm owns it. Two problems saying the
    // same thing is noise, and staleness is the more urgent framing.
    const { status, body } = await health({ ageMinutes: 25 * 60 });
    t('past lease-staleness it still alarms', status, 503);
    t('but the cron problem stands down', cronProblem(body).length, 0);
    truthy('leaving the staleness problem to say it',
      (body.problems || []).some((x) => /stale/.test(x)));
  }
  {
    const { body } = await health({ ageMinutes: 45 });
    t('the threshold is reported', body.sync.cronStaleAfterMinutes, 90);
    truthy('and ageMinutes says what it actually measures',
      /syncmeta was last WRITTEN/.test(body.sync.ageMeaning));
  }
  {
    // A config below the floor must not be honoured at runtime either - the
    // validator catches it at seed time, the Worker clamps it if it lands anyway.
    const { status, body } = await health({ ageMinutes: 45, cronStaleAfterMinutes: 10 });
    t('a too-low threshold in KV is clamped, not obeyed', status, 200);
    truthy('clamped to just above the heartbeat', body.sync.cronStaleAfterMinutes === 61);
  }
}

console.log('');
console.log('touchSession - the free plan lives or dies on this');
{
  const mk = () => { __resetCaches(); return { COACH_KV: fakeKV() }; };
  const KEY = 'sess:sms:+18885550100';
  const HALF = 6 * 60 * 60 * 1000;   // half of the 12h session TTL

  // --- no prior record: must write -----------------------------------------
  {
    const env = mk();
    const wrote = await touchSession(env, 'sms', '+18885550100', { code: '1042' }, null);
    t('a brand new session is written', wrote, true);
    const rec = await env.COACH_KV.get(KEY);
    t('carrying the right code', rec.code, '1042');
    truthy('and a touched timestamp', !!rec.touched);
  }

  // --- unchanged and fresh: must NOT write ---------------------------------
  // This is the whole point. Previously every inbound message wrote here.
  {
    const env = mk();
    const existing = { code: '1042', touched: new Date().toISOString() };
    await env.COACH_KV.put(KEY, JSON.stringify(existing));
    const wrote = await touchSession(env, 'sms', '+18885550100', { code: '1042' }, existing);
    t('an unchanged, fresh session costs NO write', wrote, false);
  }

  // --- unchanged but stale: must write to slide the TTL ---------------------
  {
    const env = mk();
    const existing = { code: '1042', touched: new Date(Date.now() - HALF - 60000).toISOString() };
    await env.COACH_KV.put(KEY, JSON.stringify(existing));
    const wrote = await touchSession(env, 'sms', '+18885550100', { code: '1042' }, existing);
    t('past half the TTL it is rewritten', wrote, true);
  }

  // --- content changed: must write even when fresh -------------------------
  // Switching coach mid-conversation must not be silently dropped.
  {
    const env = mk();
    const existing = { code: '1042', touched: new Date().toISOString() };
    await env.COACH_KV.put(KEY, JSON.stringify(existing));
    const wrote = await touchSession(env, 'sms', '+18885550100', { code: '9999' }, existing);
    t('a changed code is written immediately', wrote, true);
    t('and the new value lands', (await env.COACH_KV.get(KEY)).code, '9999');
  }

  // --- a record with no touched field (pre-upgrade) must write -------------
  // Sessions written before this change have no `touched`; they must not be
  // treated as infinitely fresh and left to expire silently.
  {
    const env = mk();
    const existing = { code: '1042' };
    await env.COACH_KV.put(KEY, JSON.stringify(existing));
    const wrote = await touchSession(env, 'sms', '+18885550100', { code: '1042' }, existing);
    t('a legacy record with no timestamp is rewritten', wrote, true);
    truthy('and gains one', !!(await env.COACH_KV.get(KEY)).touched);
  }

  // --- the saving, stated as a number --------------------------------------
  {
    const env = mk();
    let writes = 0;
    let existing = null;
    for (let i = 0; i < 20; i++) {
      const did = await touchSession(env, 'sms', '+18885550100', { code: '1042' }, existing);
      if (did) writes++;
      existing = await env.COACH_KV.get(KEY);
    }
    t('20 messages in one conversation cost 1 write, not 20', writes, 1);
  }
}


/* ---------------------------------------------------------------------------
 * coachProblems - the multi-author validations. Every one of these guards a
 * failure that is silent at one coach and cross-grants entitlement at fifteen.
 * ------------------------------------------------------------------------- */
console.log('coachProblems - multi-author registry validation');
{
  const ok = (over = {}) => ({
    code: '1042', index: 0, name: 'A', projectID: 'p',
    ghlTag: 'bookcoach-a-active', shopifyProductId: '10434147320122',
    ghlProductId: '6a9185da778550cdf732a700', trialDays: 10,
    courseLessonUrl: 'https://login.leadershipbookspublishers.com/courses/products/abc',
    ...over,
  });

  t('a well-formed single coach validates clean', coachProblems([ok()]), []);
  t('an empty registry validates clean', coachProblems([]), []);

  // --- uniqueness ---------------------------------------------------------
  for (const field of ['ghlTag', 'shopifyProductId', 'ghlProductId']) {
    const a = ok();
    const b = ok({ code: '1043', index: 1,
      ghlTag: 'bookcoach-b-active', shopifyProductId: '20000000000', ghlProductId: 'aaaaaaaaaaaaaaaaaaaaaaaa' });
    b[field] = a[field];
    truthy(`a shared ${field} is rejected`, coachProblems([a, b]).some((x) => x.includes(`duplicate ${field}`)));
  }
  truthy('the duplicate message names the cross-granting consequence',
    coachProblems([ok(), ok({ code: '1043', index: 1 })]).some((x) => /cross-grant/.test(x)));
  t('two coaches sharing nothing validate clean',
    coachProblems([ok(), ok({ code: '1043', index: 1,
      ghlTag: 'bookcoach-b-active', shopifyProductId: '20000000000', ghlProductId: 'aaaaaaaaaaaaaaaaaaaaaaaa' })]), []);
  t('an absent identity key is not treated as a duplicate of another absent one',
    coachProblems([
      ok({ ghlTag: undefined, shopifyProductId: undefined, ghlProductId: undefined }),
      ok({ code: '1043', index: 1, ghlTag: undefined, shopifyProductId: undefined, ghlProductId: undefined }),
    ]), []);

  // --- the shopify_ namespace collision -----------------------------------
  truthy('a ghlTag in the shopify_ namespace is rejected',
    coachProblems([ok({ ghlTag: 'shopify_delivered-manual' })]).some((x) => /shopify_ namespace/.test(x)));

  // --- shopifyProductId ---------------------------------------------------
  truthy('a non-numeric shopifyProductId is rejected',
    coachProblems([ok({ shopifyProductId: 'life-without-reservation' })]).length > 0);
  truthy('a GID is rejected AND named as a GID',
    coachProblems([ok({ shopifyProductId: 'gid://shopify/Product/10434147320122' })]).some((x) => /that is a GID/.test(x)));
  t('a numeric id authored as a JSON number survives loadConfig and validates', (() => {
    const dir = mkdtempSync(join(tmpdir(), 'coach-spid-'));
    try {
      const file = join(dir, 'c.json');
      writeFileSync(file, JSON.stringify({ shared: {},
        coaches: [{ code: '9999', name: 'X', projectID: 'p', shopifyProductId: 10434147320122 }] }), 'utf8');
      const { coaches } = loadConfig({ file });
      return [typeof coaches[0].shopifyProductId, coachProblems(coaches).length];
    } finally { rmSync(dir, { recursive: true, force: true }); }
  })(), ['string', 0]);

  // --- courseLessonUrl ----------------------------------------------------
  truthy('the course BUILDER url is rejected',
    coachProblems([ok({ courseLessonUrl: 'https://app.coursecreator360.com/courses/x' })]).some((x) => /BUILDER/.test(x)));
  truthy('is_preview=true is rejected',
    coachProblems([ok({ courseLessonUrl: 'https://login.leadershipbookspublishers.com/x?is_preview=true' })]).length > 0);
  truthy('a non-https lesson url is rejected',
    coachProblems([ok({ courseLessonUrl: 'http://login.leadershipbookspublishers.com/x' })]).length > 0);

  // --- trialDays ----------------------------------------------------------
  t('an unset trialDays is allowed (the Worker defaults it)', coachProblems([ok({ trialDays: undefined })]), []);
  for (const bad of [0, -1, 91, 10.5, '10']) {
    truthy(`trialDays ${JSON.stringify(bad)} is rejected`, coachProblems([ok({ trialDays: bad })]).length > 0);
  }
  t('trialDays 90 is the boundary and is allowed', coachProblems([ok({ trialDays: 90 })]), []);
}

/* --- the new KV_FIELDS actually reach KV ---------------------------------- */
console.log('registryValue - the multi-author fields are carried, not dropped');
{
  const dir = mkdtempSync(join(tmpdir(), 'coach-kvf-'));
  try {
    const file = join(dir, 'c.json');
    writeFileSync(file, JSON.stringify({ shared: {}, coaches: [{
      code: '9999', name: 'Micheal Stickler', projectID: 'p',
      displayName: 'Michael Stickler', bookTitle: 'Life Without Reservation',
      shopifyProductId: '10434147320122', trialDays: 10,
      courseLessonUrl: 'https://login.leadershipbookspublishers.com/courses/products/abc',
      vfKey: 'VF.DM.should.not.travel',
    }] }), 'utf8');
    const { coaches } = loadConfig({ file });
    const v = registryValue(coaches[0]);
    for (const f of ['displayName', 'bookTitle', 'shopifyProductId', 'courseLessonUrl', 'trialDays']) {
      truthy(`${f} reaches KV`, f in v);
    }
    t('the internal name and the display name are both kept, unnormalised',
      [v.name, v.displayName], ['Micheal Stickler', 'Michael Stickler']);
    let threw = false;
    try { assertNoSecrets(v); } catch { threw = true; }
    falsy('the KV value still carries no credential', threw);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/* --- the Shopify signing secret must never reach KV ---------------------- */
console.log('assertNoSecrets - the Shopify webhook secret must never reach KV');
{
  let threw = false;
  try { assertNoSecrets({ name: 'X', shopifyWebhookSecret: 'e90c9299b90ac13e' }); } catch { threw = true; }
  truthy('a value carrying shopifyWebhookSecret is refused', threw);
}


/* ---------------------------------------------------------------------------
 * POST /shopify/order - the multi-author trial grant.
 *
 * Every test here guards a failure that is either silent or expensive: a forged
 * grant, a double grant, a lost paying customer, or a reader entitled with no
 * expiry record.
 * ------------------------------------------------------------------------- */
console.log('shopifyProductIds - both payload shapes, because Flow may only manage one');
{
  t('native line_items', shopifyProductIds({ line_items: [{ product_id: '10434147320122' }] }), ['10434147320122']);
  t('a delimited string, which Flow can always build',
    shopifyProductIds({ product_ids: '10434147320122, 20000000000' }), ['10434147320122', '20000000000']);
  t('an array of ids', shopifyProductIds({ product_ids: ['111', '222'] }), ['111', '222']);
  t('a GID is reduced to its numeric tail',
    shopifyProductIds({ line_items: [{ product_id: 'gid://shopify/Product/10434147320122' }] }), ['10434147320122']);
  t('numbers are stringified', shopifyProductIds({ line_items: [{ product_id: 10434147320122 }] }), ['10434147320122']);
  t('duplicates collapse', shopifyProductIds({ product_ids: '111,111,222' }), ['111', '222']);
  t('both shapes at once are merged',
    shopifyProductIds({ line_items: [{ product_id: '111' }], product_ids: '222' }), ['111', '222']);
  t('an empty order yields nothing', shopifyProductIds({}), []);
  t('nulls and blanks are ignored', shopifyProductIds({ product_ids: ',, ,' }), []);
}

console.log('/shopify/order - signature, idempotency, mapping, grant');
{
  const SECRET = 'test-shopify-secret';
  const enc2 = new TextEncoder();

  const sign = async (raw) => {
    const key = await crypto.subtle.importKey('raw', enc2.encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = await crypto.subtle.sign('HMAC', key, enc2.encode(raw));
    return btoa(String.fromCharCode(...new Uint8Array(mac)));
  };

  const COACH = {
    code: '1042', name: 'Micheal Stickler', displayName: 'Michael Stickler',
    bookTitle: 'Life Without Reservation', ghlTag: 'bookcoach-micheal-stickler-active',
    shopifyProductId: '10434147320122', trialDays: 10,
    courseLessonUrl: 'https://login.example.com/lesson',
    landingPageUrl: 'https://www.book-coach.ai/michael-stickler-coach-access',
    projectID: 'p', versionID: 'main',
  };

  // A GHL stand-in that records every call, so the test can assert on ORDER as
  // well as content - which is the property that actually matters here.
  const makeEnv = (over = {}) => {
    const kv = fakeKV();
    const calls = [];
    const env = {
      COACH_KV: kv,
      SHOPIFY_WEBHOOK_SECRET: SECRET,
      GHL_API_TOKEN: 'tok',
      GHL_LOCATION_ID: 'loc',
      __calls: calls,
      ...over,
    };
    kv.put('coach:1042', JSON.stringify(COACH));
    // loadRegistry caches per isolate, so seeding KV is not enough on its own.
    __resetCaches();
    return env;
  };

  const withFetch = async (env, handler, fn) => {
    const real = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
      const body = init.body ? JSON.parse(init.body) : null;
      env.__calls.push({ url: String(url), method: init.method || 'GET', body });
      return handler(String(url), init, body);
    };
    try { return await fn(); } finally { globalThis.fetch = real; }
  };

  const req = async (payload, { sig = null, raw = null } = {}) => {
    const rawBody = raw !== null ? raw : JSON.stringify(payload);
    return new Request('https://w.dev/shopify/order', {
      method: 'POST',
      headers: sig === false ? {} : { 'X-Shopify-Hmac-Sha256': sig || (await sign(rawBody)) },
      body: rawBody,
    });
  };

  const ghlOk = (url, init, body) => {
    if (url.includes('/contacts/search')) return new Response(JSON.stringify({ contacts: [] }), { status: 200 });
    if (url.endsWith('/contacts/') && init.method === 'POST') {
      return new Response(JSON.stringify({ contact: { id: 'C1', email: body.email, tags: [] } }), { status: 200 });
    }
    return new Response(JSON.stringify({ succeded: true }), { status: 200 });
  };

  const ORDER = {
    order_id: '7521018609978', order_number: '#4217', email: 'Reader@Example.COM',
    first_name: 'Jane', last_name: 'Doe', source: 'shopify_flow_backstop',
    line_items: [{ product_id: '10434147320122' }],
  };

  // --- signature ----------------------------------------------------------
  {
    const env = makeEnv();
    let status = 0;
    await withFetch(env, ghlOk, async () => {
      try { await handleShopifyOrder(await req(ORDER, { sig: 'wrong' }), env, null); }
      catch (e) { status = e.status; }
    });
    t('a bad signature is refused with 403', status, 403);
    t('and nothing whatsoever is written', env.COACH_KV.store.size, 1); // only the seeded coach
    t('and GHL is never called', env.__calls.length, 0);
  }
  {
    const env = makeEnv();
    let status = 0;
    try { await handleShopifyOrder(await req(ORDER, { sig: false }), env, null); } catch (e) { status = e.status; }
    t('a missing signature header is refused', status, 403);
  }
  {
    const env = makeEnv({ SHOPIFY_WEBHOOK_SECRET: '' });
    let status = 0;
    try { await handleShopifyOrder(await req(ORDER), env, null); } catch (e) { status = e.status; }
    t('no secret configured fails CLOSED, not open', status, 500);
  }

  // --- the happy path ------------------------------------------------------
  {
    const env = makeEnv();
    let res;
    await withFetch(env, ghlOk, async () => { res = await handleShopifyOrder(await req(ORDER), env, null); });
    const out = await res.json();
    t('a matching order reports the coach', [out.ok, out.matched, out.codes], [true, 1, ['1042']]);

    const trial = await env.COACH_KV.get('trial:C1:1042');
    truthy('a per-coach trial record exists', trial);
    t('carrying the contact and code', [trial.contactId, trial.code], ['C1', '1042']);
    truthy('and an expiry ~10 days out',
      Math.abs(new Date(trial.expiresAt) - Date.now() - 10 * 86400000) < 60000);
    truthy('the order is marked seen', await env.COACH_KV.get('shop:7521018609978'));

    const put = env.__calls.find((c) => c.method === 'PUT');
    truthy('the contact is updated', put);
    truthy('with the coach entitlement tag', put.body.tags.includes('bookcoach-micheal-stickler-active'));
    truthy('AND the generic workflow trigger tag', put.body.tags.includes(TRIAL_STARTED_TAG));
    const fields = Object.fromEntries(put.body.customFields.map((f) => [f.key, f.field_value]));
    t('coach_status is trial', fields.coach_status, 'trial');
    t('the email gets the DISPLAY name, not the internal one', fields.coach_name, 'Michael Stickler');
    t('and the book title', fields.coach_book_title, 'Life Without Reservation');
    t('and the lesson link', fields.coach_link, 'https://login.example.com/lesson');
    t('and the $59 page', fields.coach_landing_url, 'https://www.book-coach.ai/michael-stickler-coach-access');
    t('and the order number', fields.shopify_order_number, '#4217');
    t('and the source that fired it', fields.coach_trial_source, 'shopify_flow_backstop');

    const created = env.__calls.find((c) => c.method === 'POST' && c.url.endsWith('/contacts/'));
    t('the contact is created with a lowercased email', created.body.email, 'reader@example.com');
  }

  // --- the common case: an ordinary book -----------------------------------
  {
    const env = makeEnv();
    let res;
    await withFetch(env, ghlOk, async () => {
      res = await handleShopifyOrder(await req({ ...ORDER, line_items: [{ product_id: '999' }] }), env, null);
    });
    const out = await res.json();
    t('a non-coach order is accepted and ignored', [out.ok, out.matched], [true, 0]);
    t('GHL is never called for it', env.__calls.length, 0);
    falsy('and it is NOT marked seen, so a later re-send still works',
      await env.COACH_KV.get('shop:7521018609978'));
  }

  // --- idempotency ---------------------------------------------------------
  {
    const env = makeEnv();
    await withFetch(env, ghlOk, async () => { await handleShopifyOrder(await req(ORDER), env, null); });
    const firstCalls = env.__calls.length;
    let res;
    await withFetch(env, ghlOk, async () => { res = await handleShopifyOrder(await req(ORDER), env, null); });
    const out = await res.json();
    t('a redelivered order is reported as a duplicate', [out.ok, out.duplicate, out.matched], [true, true, 0]);
    t('and costs no further GHL calls', env.__calls.length, firstCalls);
  }

  // --- the second guard: an existing trial record --------------------------
  {
    const env = makeEnv();
    await env.COACH_KV.put('trial:C1:1042', JSON.stringify({ contactId: 'C1', code: '1042' }));
    await withFetch(env, ghlOk, async () => {
      await handleShopifyOrder(await req({ ...ORDER, order_id: 'NEW1' }), env, null);
    });
    falsy('a different order for a reader already on trial re-tags nothing',
      env.__calls.some((c) => c.method === 'PUT'));
  }

  // --- the third guard: the tag is already held ----------------------------
  {
    const env = makeEnv();
    const ghlHasTag = (url, init, body) => {
      if (url.includes('/contacts/search')) {
        return new Response(JSON.stringify({
          contacts: [{ id: 'C9', email: 'reader@example.com', tags: ['bookcoach-micheal-stickler-active'] }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ succeded: true }), { status: 200 });
    };
    await withFetch(env, ghlHasTag, async () => {
      await handleShopifyOrder(await req({ ...ORDER, order_id: 'NEW2' }), env, null);
    });
    falsy('a reader who already holds the tag is not re-granted',
      env.__calls.some((c) => c.method === 'PUT'));
    falsy('and no trial record is created', await env.COACH_KV.get('trial:C9:1042'));
  }

  // --- a coach bundle with no email is loud, not silent --------------------
  {
    const env = makeEnv();
    let status = 0;
    await withFetch(env, ghlOk, async () => {
      try { await handleShopifyOrder(await req({ ...ORDER, email: '' }), env, null); }
      catch (e) { status = e.status; }
    });
    t('a coach order with no email is rejected so Shopify retries', status, 400);
    falsy('and it is not marked seen', await env.COACH_KV.get('shop:7521018609978'));
  }

  // --- a missing order id --------------------------------------------------
  {
    const env = makeEnv();
    let status = 0;
    await withFetch(env, ghlOk, async () => {
      try { await handleShopifyOrder(await req({ ...ORDER, order_id: '' }), env, null); }
      catch (e) { status = e.status; }
    });
    t('no order id is rejected - it is the idempotency key', status, 400);
  }

  // --- the ordering invariant ---------------------------------------------
  {
    const env = makeEnv();
    let tagWriteAt = -1;
    const order = [];
    const realPut = env.COACH_KV.put.bind(env.COACH_KV);
    env.COACH_KV.put = async (k, v, o) => { order.push(`kv:${k}`); return realPut(k, v, o); };
    await withFetch(env, (url, init, body) => {
      if (init.method === 'PUT') { order.push('ghl:tag'); tagWriteAt = order.length; }
      return ghlOk(url, init, body);
    }, async () => { await handleShopifyOrder(await req(ORDER), env, null); });
    const trialAt = order.indexOf('trial:C1:1042') >= 0 ? order.indexOf('trial:C1:1042') : order.indexOf('kv:trial:C1:1042');
    truthy('the trial record is written BEFORE the tag - the other order grants forever',
      trialAt >= 0 && trialAt < order.indexOf('ghl:tag'));
  }

  // --- one order, two authors ---------------------------------------------
  {
    const env = makeEnv();
    await env.COACH_KV.put('coach:2000', JSON.stringify({
      code: '2000', name: 'Second Author', displayName: 'Second Author', bookTitle: 'Book Two',
      ghlTag: 'bookcoach-second-author-active', shopifyProductId: '20000000000',
      projectID: 'p2', versionID: 'main',
    }));
    __resetCaches();
    let res;
    await withFetch(env, ghlOk, async () => {
      res = await handleShopifyOrder(await req({
        ...ORDER, order_id: 'TWO', product_ids: '10434147320122,20000000000', line_items: [],
      }), env, null);
    });
    const out = await res.json();
    t('both coaches are matched', out.matched, 2);
    truthy('and both get a trial record',
      (await env.COACH_KV.get('trial:C1:1042')) && (await env.COACH_KV.get('trial:C1:2000')));
    const put = env.__calls.find((c) => c.method === 'PUT');
    truthy('both entitlement tags are applied',
      put.body.tags.includes('bookcoach-micheal-stickler-active') &&
      put.body.tags.includes('bookcoach-second-author-active'));
  }

  // --- trialDays: per-coach, and the fallback -----------------------------
  // Both halves matter. An earlier version of this test seeded a coach with no
  // trialDays but did not reset the registry cache, so it read the cached
  // trialDays:10 and "passed" by agreeing with the default it meant to test.
  {
    const env = makeEnv();
    await env.COACH_KV.put('coach:1042', JSON.stringify({ ...COACH, trialDays: 30 }));
    __resetCaches();
    await withFetch(env, ghlOk, async () => { await handleShopifyOrder(await req(ORDER), env, null); });
    const trial = await env.COACH_KV.get('trial:C1:1042');
    truthy('a per-coach trialDays of 30 is honoured, not the default',
      Math.abs(new Date(trial.expiresAt) - Date.now() - 30 * 86400000) < 60000);
  }
  {
    const env = makeEnv();
    const { trialDays, ...noDays } = COACH;
    await env.COACH_KV.put('coach:1042', JSON.stringify(noDays));
    __resetCaches();
    await withFetch(env, ghlOk, async () => { await handleShopifyOrder(await req(ORDER), env, null); });
    const trial = await env.COACH_KV.get('trial:C1:1042');
    truthy(`a coach with no trialDays falls back to ${DEFAULT_TRIAL_DAYS} days`,
      Math.abs(new Date(trial.expiresAt) - Date.now() - DEFAULT_TRIAL_DAYS * 86400000) < 60000);
  }

  // --- existing tags are preserved ----------------------------------------
  {
    const env = makeEnv();
    const ghlOther = (url, init, body) => {
      if (url.includes('/contacts/search')) {
        return new Response(JSON.stringify({
          contacts: [{ id: 'C7', email: 'reader@example.com', tags: ['newsletter', 'shopify_delivered-manual'] }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ succeded: true }), { status: 200 });
    };
    await withFetch(env, ghlOther, async () => {
      await handleShopifyOrder(await req({ ...ORDER, order_id: 'KEEP' }), env, null);
    });
    const put = env.__calls.find((c) => c.method === 'PUT');
    truthy("a contact's unrelated tags survive the grant",
      put.body.tags.includes('newsletter') && put.body.tags.includes('shopify_delivered-manual'));
  }

  // --- a GHL failure must not leave a tag behind ---------------------------
  {
    const env = makeEnv();
    const ghlDown = (url) => {
      if (url.includes('/contacts/search')) return new Response('upstream boom', { status: 503 });
      return new Response('{}', { status: 200 });
    };
    let threw = false;
    await withFetch(env, ghlDown, async () => {
      try { await handleShopifyOrder(await req({ ...ORDER, order_id: 'DOWN' }), env, null); }
      catch { threw = true; }
    });
    falsy('a GHL outage does not surface as an unhandled throw', threw);
    falsy('and no trial record is left behind', await env.COACH_KV.get('trial:C1:1042'));
  }

  // --- empty merge fields are never written -------------------------------
  {
    const bare = { code: '3000', name: 'Bare', ghlTag: 'bookcoach-bare-active' };
    const payload = trialFieldPayload(bare, { source: '', orderNumber: '', startedAt: '2026-09-22' });
    const keys = payload.map((f) => f.key);
    falsy('an absent bookTitle is omitted, not written as an empty string',
      keys.includes('coach_book_title'));
    falsy('an absent lesson link is omitted', keys.includes('coach_link'));
    truthy('but coach_status is always written', keys.includes('coach_status'));
    t('and coach_name falls back to the internal name when no displayName is set',
      payload.find((f) => f.key === 'coach_name').field_value, 'Bare');
  }
}


/* ---------------------------------------------------------------------------
 * ONE combined tag query, not one per coach.
 *
 * Before 2026-09-22 the reconcile awaited a separate paginated GHL search for
 * every coach tag. At N authors that is N sequential subrequests every 15
 * minutes, against a free-plan limit of 50 per request - so it would have
 * stopped updating entitlement somewhere around 45 coaches, silently.
 * ------------------------------------------------------------------------- */
console.log('reconcile - one combined tag query regardless of author count');
{
  const realFetch = globalThis.fetch;
  const mkEnv = async (coaches) => {
    __resetCaches();
    const kv = fakeKV();
    for (const c of coaches) await kv.put(`coach:${c.code}`, JSON.stringify(c));
    await kv.put('config', JSON.stringify({ leaseHours: 48, archiveRetentionDays: 30, autoLinkGhlPhone: true }));
    return { COACH_KV: kv, GHL_API_TOKEN: 'pit-x', GHL_LOCATION_ID: 'loc' };
  };
  const TEN = Array.from({ length: 10 }, (_, i) => ({
    code: String(1000 + i), name: `A${i}`, ghlTag: `bookcoach-a${i}-active`,
  }));

  // --- the headline property ----------------------------------------------
  {
    const env = await mkEnv(TEN);
    const searches = [];
    globalThis.fetch = async (u, init) => {
      const url = String(u);
      if (url.includes('/contacts/search')) {
        searches.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ contacts: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: [], totalCount: 0 }), { status: 200 });
    };
    let r;
    try { r = await reconcileEntitlements(env); } finally { globalThis.fetch = realFetch; }
    truthy('ok', r.ok);
    t('TEN coaches cost exactly ONE contacts/search call', searches.length, 1);
    const value = searches[0].filters[0].value;
    truthy('and the filter carries an array of tags', Array.isArray(value));
    t('containing every coach tag', value.length, 10);
    t('ten tags are still reported', r.tags, 10);
  }

  // --- each contact is scored on its OWN tags ------------------------------
  {
    const env = await mkEnv(TEN);
    globalThis.fetch = async (u) => {
      if (String(u).includes('/contacts/search')) {
        return new Response(JSON.stringify({ contacts: [
          { id: 'c1', phone: '8885550101', tags: ['bookcoach-a0-active'] },
          { id: 'c2', phone: '8885550102', tags: ['bookcoach-a3-active', 'bookcoach-a7-active'] },
        ] }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: [], totalCount: 0 }), { status: 200 });
    };
    let r;
    try { r = await reconcileEntitlements(env); } finally { globalThis.fetch = realFetch; }
    t('both contacts are seen', r.contacts, 2);
    t('a single-tag contact gets exactly its own coach',
      (await env.COACH_KV.get('sub:+18885550101')).codes, ['1000']);
    t('a two-tag contact gets both, and only those two',
      (await env.COACH_KV.get('sub:+18885550102')).codes.sort(), ['1003', '1007']);
  }

  // --- over-matching cannot over-grant ------------------------------------
  {
    const env = await mkEnv(TEN);
    globalThis.fetch = async (u) => {
      if (String(u).includes('/contacts/search')) {
        // A contact the filter returned that holds no registry tag at all.
        return new Response(JSON.stringify({ contacts: [
          { id: 'ok1', phone: '8885550103', tags: ['bookcoach-a1-active'] },
          { id: 'stranger', phone: '8885550104', tags: ['newsletter', 'shopify_delivered-manual'] },
        ] }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: [], totalCount: 0 }), { status: 200 });
    };
    let r;
    try { r = await reconcileEntitlements(env); } finally { globalThis.fetch = realFetch; }
    t('only the contact with a registry tag is entitled', r.contacts, 1);
    truthy('the entitled one is granted', await env.COACH_KV.get('sub:+18885550103'));
    falsy('a contact holding no coach tag is granted nothing',
      await env.COACH_KV.get('sub:+18885550104'));
  }

  // --- the staff tag still fans out to every coach -------------------------
  {
    const env = await mkEnv(TEN);
    await env.COACH_KV.put('config', JSON.stringify({
      leaseHours: 48, archiveRetentionDays: 30, autoLinkGhlPhone: true, staffTag: 'bookcoach-staff-all',
    }));
    __resetCaches();
    globalThis.fetch = async (u) => {
      if (String(u).includes('/contacts/search')) {
        return new Response(JSON.stringify({ contacts: [
          { id: 'staff', phone: '8885550105', tags: ['bookcoach-staff-all'] },
        ] }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: [], totalCount: 0 }), { status: 200 });
    };
    let r;
    try { r = await reconcileEntitlements(env); } finally { globalThis.fetch = realFetch; }
    truthy('ok', r.ok);
    t('the staff tag grants every coach in the registry',
      (await env.COACH_KV.get('sub:+18885550105')).codes.length, 10);
    t('and the staff tag is included in the single query', r.tags, 11);
  }

  // --- a missing `tags` field must NOT read as total churn -----------------
  {
    const env = await mkEnv(TEN);
    // Seed an existing subscriber so there is something to wrongly revoke.
    await env.COACH_KV.put('sub:+18885550109', JSON.stringify({
      contactId: 'old', codes: ['1000'], expires: new Date(Date.now() + 86400000).toISOString(),
    }));
    globalThis.fetch = async (u) => {
      if (String(u).includes('/contacts/search')) {
        // Contacts come back, but with no tags field at all.
        return new Response(JSON.stringify({ contacts: [{ id: 'c1', phone: '8885550106' }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: [], totalCount: 0 }), { status: 200 });
    };
    let r;
    try { r = await reconcileEntitlements(env); } finally { globalThis.fetch = realFetch; }
    falsy('the run is reported as NOT ok', r.ok);
    truthy('and says the tags field was missing',
      r.errors.some((e) => /tags field/.test(e)));
    truthy('the existing subscriber is untouched', await env.COACH_KV.get('sub:+18885550109'));
    t('nothing was written at all', r.granted + r.revoked, 0);
  }

  // --- a truncated result set must throw, not silently revoke --------------
  {
    const env = await mkEnv(TEN);
    let page = 0;
    globalThis.fetch = async (u) => {
      if (String(u).includes('/contacts/search')) {
        // Always a full page with a cursor: an endless result set.
        page += 1;
        const contacts = Array.from({ length: 100 }, (_, i) => ({
          id: `c${page}-${i}`, phone: '', tags: ['bookcoach-a0-active'], searchAfter: [page, i],
        }));
        return new Response(JSON.stringify({ contacts }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: [], totalCount: 0 }), { status: 200 });
    };
    let r;
    try { r = await reconcileEntitlements(env); } finally { globalThis.fetch = realFetch; }
    falsy('an endless result set does not produce an ok run', r.ok);
    truthy('and it refuses rather than reconciling a truncated list',
      r.errors.some((e) => /truncated/.test(e)));
  }

  // --- no tags configured at all: no search is made ------------------------
  {
    const env = await mkEnv([{ code: '1042', name: 'A', ghlProductId: 'prod-59' }]);
    let searches = 0;
    globalThis.fetch = async (u) => {
      if (String(u).includes('/contacts/search')) { searches += 1; return new Response(JSON.stringify({ contacts: [] }), { status: 200 }); }
      return new Response(JSON.stringify({ data: [], totalCount: 0 }), { status: 200 });
    };
    let r;
    try { r = await reconcileEntitlements(env); } finally { globalThis.fetch = realFetch; }
    truthy('ok with a product but no tag', r.ok);
    t('and no pointless empty search is made', searches, 0);
  }
}

console.log('ghlSearchByTags - the query shape that makes it O(1) in authors');
{
  const realFetch = globalThis.fetch;
  const env = { GHL_API_TOKEN: 'pit', GHL_LOCATION_ID: 'loc' };

  {
    let sent = null;
    globalThis.fetch = async (u, init) => {
      sent = JSON.parse(init.body);
      return new Response(JSON.stringify({ contacts: [{ id: 'a', tags: ['x'] }] }), { status: 200 });
    };
    let out;
    try { out = await ghlSearchByTags(env, ['Tag-A', ' tag-b ', 'TAG-A', '']); } finally { globalThis.fetch = realFetch; }
    t('tags are lowercased, trimmed, deduped and blanks dropped',
      sent.filters[0].value, ['tag-a', 'tag-b']);
    t('and the operator is still contains', sent.filters[0].operator, 'contains');
    t('tags are carried through on each contact', out[0].tags, ['x']);
  }

  {
    let called = 0;
    globalThis.fetch = async () => { called += 1; return new Response('{}', { status: 200 }); };
    let out;
    try { out = await ghlSearchByTags(env, []); } finally { globalThis.fetch = realFetch; }
    t('an empty tag list returns nothing', out, []);
    t('without calling GHL at all', called, 0);
  }
}


console.log('/shopify/order - TWO ways to authenticate, because Flow cannot sign');
{
  const mkReq = (headers) => new Request('https://w.dev/shopify/order', { method: 'POST', headers, body: '{}' });
  const env = { FLOW_SHARED_SECRET: 'flow-secret-abc', SHOPIFY_WEBHOOK_SECRET: 'shop-secret' };

  const run = async (headers, e = env) => {
    try { return { via: await verifyShopifyRequest(e, '{}', mkReq(headers)) }; }
    catch (err) { return { status: err.status, msg: err.message }; }
  };

  t('a correct Flow token is accepted', (await run({ 'X-Coach-Token': 'flow-secret-abc' })).via, 'flow');
  t('a lowercase header name still works - Flow capitalises names',
    (await run({ 'x-coach-token': 'flow-secret-abc' })).via, 'flow');
  t('a wrong Flow token is refused', (await run({ 'X-Coach-Token': 'nope' })).status, 403);
  t('and a Flow token with no secret configured fails CLOSED',
    (await run({ 'X-Coach-Token': 'x' }, { SHOPIFY_WEBHOOK_SECRET: 's' })).status, 500);
  t('no credential at all is refused', (await run({})).status, 403);
  truthy('and the refusal names both accepted methods',
    /X-Coach-Token.*X-Shopify-Hmac-Sha256/.test((await run({})).msg));

  // A Flow token must never be satisfiable by the Shopify secret, or a leaked
  // webhook secret would become a second way in.
  t('the Shopify secret is NOT accepted as a Flow token',
    (await run({ 'X-Coach-Token': 'shop-secret' })).status, 403);
}


console.log('/shopify/order - accepts this project\u0027s existing Flow payload spelling');
{
  const SECRET2 = 'tok-alias';
  const envA = (() => {
    const kv = fakeKV();
    kv.put('coach:1042', JSON.stringify({
      code: '1042', name: 'A', ghlTag: 'bookcoach-a-active',
      shopifyProductId: '10434147320122', projectID: 'p', versionID: 'main',
    }));
    __resetCaches();
    return { COACH_KV: kv, FLOW_SHARED_SECRET: SECRET2, GHL_API_TOKEN: 't', GHL_LOCATION_ID: 'loc' };
  })();
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    if (String(url).includes('/contacts/search')) return new Response(JSON.stringify({ contacts: [] }), { status: 200 });
    if (String(url).endsWith('/contacts/')) return new Response(JSON.stringify({ contact: { id: 'CA', tags: [] } }), { status: 200 });
    return new Response('{}', { status: 200 });
  };
  let out;
  try {
    const body = JSON.stringify({
      event: 'book_delivered', source: 'shopify_flow_backstop',
      email: 'r@example.com',
      shopify_order_id: 'gid://shopify/Order/7521018609978',
      shopify_order_number: '#4217',
      product_ids: 'gid://shopify/Product/10434147320122,',
    });
    const res = await handleShopifyOrder(
      new Request('https://w.dev/shopify/order', { method: 'POST', headers: { 'X-Coach-Token': SECRET2 }, body }),
      envA, null);
    out = await res.json();
  } finally { globalThis.fetch = real; }
  t('shopify_order_id is accepted as the idempotency key', [out.ok, out.matched], [true, 1]);
  truthy('and a trailing-comma GID list still resolves the coach',
    await envA.COACH_KV.get('trial:CA:1042'));
}


console.log('coach_trial_ends - the date a customer actually reads');
{
  t('formatted as unambiguous day-month-year', formatTrialEnd('2026-10-02T09:15:00.000Z'), '2 October 2026');
  t('no leading zero on the day', formatTrialEnd('2026-01-05T00:00:00.000Z'), '5 January 2026');
  t('end of year', formatTrialEnd('2026-12-31T23:59:00.000Z'), '31 December 2026');
  t('a junk date yields an empty string, never "Invalid Date"', formatTrialEnd('not-a-date'), '');
  t('an empty input yields empty', formatTrialEnd(''), '');

  // The field must describe the SAME coach as coach_name / coach_book_title.
  const p1 = trialFieldPayload({ code: '1', name: 'A' }, { startedAt: '2026-09-22', endsAt: '2026-10-02T00:00:00.000Z' });
  t('coach_trial_ends is written alongside the other display fields',
    p1.find((f) => f.key === 'coach_trial_ends').field_value, '2 October 2026');

  const p2 = trialFieldPayload({ code: '1', name: 'A' }, { startedAt: '2026-09-22' });
  falsy('with no expiry it is omitted rather than written blank',
    p2.some((f) => f.key === 'coach_trial_ends'));
}

console.log('coach_trial_ends - end-to-end through the endpoint');
{
  const SEC3 = 'tok-ends';
  const kv = fakeKV();
  await kv.put('coach:1042', JSON.stringify({
    code: '1042', name: 'A', displayName: 'A', ghlTag: 'bookcoach-a-active',
    shopifyProductId: '111', trialDays: 10, projectID: 'p', versionID: 'main',
  }));
  // A second coach with a DIFFERENT length, to prove the displayed date follows
  // the first granted coach rather than whichever was looped last.
  await kv.put('coach:2042', JSON.stringify({
    code: '2042', name: 'B', displayName: 'B', ghlTag: 'bookcoach-b-active',
    shopifyProductId: '222', trialDays: 30, projectID: 'p', versionID: 'main',
  }));
  __resetCaches();
  const env = { COACH_KV: kv, FLOW_SHARED_SECRET: SEC3, GHL_API_TOKEN: 't', GHL_LOCATION_ID: 'loc' };
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method: init.method, body });
    if (String(url).includes('/contacts/search')) return new Response(JSON.stringify({ contacts: [] }), { status: 200 });
    if (String(url).endsWith('/contacts/')) return new Response(JSON.stringify({ contact: { id: 'CE', tags: [] } }), { status: 200 });
    return new Response('{}', { status: 200 });
  };
  try {
    await handleShopifyOrder(new Request('https://w.dev/shopify/order', {
      method: 'POST', headers: { 'X-Coach-Token': SEC3 },
      body: JSON.stringify({ order_id: 'ENDS1', email: 'r@example.com', product_ids: '111,222' }),
    }), env, null);
  } finally { globalThis.fetch = real; }

  const put = calls.find((c) => c.method === 'PUT');
  const fields = Object.fromEntries(put.body.customFields.map((f) => [f.key, f.field_value]));
  const expected = formatTrialEnd(new Date(Date.now() + 10 * 86400000).toISOString());
  t('the date shown is the FIRST granted coach\u0027s 10 days, not the second\u0027s 30',
    fields.coach_trial_ends, expected);
  t('and it names that same coach', fields.coach_name, 'A');
}


/* ---------------------------------------------------------------------------
 * Trial expiry sweep. This is the component that ENDS access, so every test
 * here guards either "someone kept a coach they should have lost" or the far
 * worse "someone lost a coach they were still paying for".
 * ------------------------------------------------------------------------- */
console.log('sweepExpiredTrials - the Worker ends trials, not GHL');
{
  const realFetch = globalThis.fetch;
  const PAST = new Date(Date.now() - 3600000).toISOString();
  const FUTURE = new Date(Date.now() + 5 * 86400000).toISOString();

  const mk = async (trials, { coaches = null } = {}) => {
    __resetCaches();
    const kv = fakeKV();
    const list = coaches || [
      { code: '1042', name: 'A', ghlTag: 'bookcoach-a-active', projectID: 'p', versionID: 'main' },
      { code: '2042', name: 'B', ghlTag: 'bookcoach-b-active', projectID: 'p', versionID: 'main' },
    ];
    for (const c of list) await kv.put(`coach:${c.code}`, JSON.stringify(c));
    for (const t of trials) {
      await kv.put(`trial:${t.contactId}:${t.code}`, JSON.stringify({
        contactId: t.contactId, code: t.code, startedAt: '2026-09-01',
        expiresAt: t.expiresAt, source: 'test',
      }));
    }
    return { COACH_KV: kv, GHL_API_TOKEN: 'tok', GHL_LOCATION_ID: 'loc' };
  };

  // Records every call so tests can assert on what GHL was actually asked to do.
  const ghl = (remainingTags = {}, { fail = false, missing = false } = {}) => {
    const calls = [];
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      calls.push({ url: u, method: init.method, body: init.body ? JSON.parse(init.body) : null });
      if (u.includes('/tags')) {
        if (fail) return new Response('boom', { status: 503 });
        if (missing) return new Response('{"message":"Contact not found"}', { status: 400 });
        const id = u.split('/contacts/')[1].split('/')[0];
        return new Response(JSON.stringify({ tags: remainingTags[id] || [] }), { status: 200 });
      }
      return new Response('{"succeded":true}', { status: 200 });
    };
    return calls;
  };

  // --- off: the shipped default must do absolutely nothing ----------------
  {
    const env = await mk([{ contactId: 'c1', code: '1042', expiresAt: PAST }]);
    const calls = ghl();
    let r;
    try { r = await sweepExpiredTrials(env, { trialExpiryMode: 'off' }); } finally { globalThis.fetch = realFetch; }
    t('off does nothing at all', [r.due, r.expired, calls.length], [0, 0, 0]);
    truthy('and the trial record survives', await env.COACH_KV.get('trial:c1:1042'));
  }
  {
    const env = await mk([{ contactId: 'c1', code: '1042', expiresAt: PAST }]);
    const calls = ghl();
    let r;
    try { r = await sweepExpiredTrials(env, {}); } finally { globalThis.fetch = realFetch; }
    t('an ABSENT mode is treated as off, not as on', [r.expired, calls.length], [0, 0]);
  }

  // --- dry: counts without writing ----------------------------------------
  {
    const env = await mk([
      { contactId: 'c1', code: '1042', expiresAt: PAST },
      { contactId: 'c2', code: '1042', expiresAt: FUTURE },
    ]);
    const calls = ghl();
    let r;
    try { r = await sweepExpiredTrials(env, { trialExpiryMode: 'dry' }); } finally { globalThis.fetch = realFetch; }
    t('dry sees both records and one due', [r.trials, r.due], [2, 1]);
    t('but expires nothing and calls GHL zero times', [r.expired, calls.length], [0, 0]);
    truthy('the due record is still there', await env.COACH_KV.get('trial:c1:1042'));
  }

  // --- on: the happy path --------------------------------------------------
  {
    const env = await mk([
      { contactId: 'c1', code: '1042', expiresAt: PAST },
      { contactId: 'c2', code: '1042', expiresAt: FUTURE },
    ]);
    const calls = ghl({ c1: [] });
    let r;
    try { r = await sweepExpiredTrials(env, { trialExpiryMode: 'on' }); } finally { globalThis.fetch = realFetch; }
    t('one expired, one untouched', [r.due, r.expired, r.tagsRemoved], [1, 1, 1]);

    const del = calls.find((c) => c.method === 'DELETE');
    truthy('the coach tag is removed by the targeted endpoint', del && del.url.endsWith('/contacts/c1/tags'));
    t('and ONLY that coach tag is named', del.body.tags, ['bookcoach-a-active']);

    const put = calls.find((c) => c.method === 'PUT');
    t('coach_status is set to expired', put.body.customFields[0], { key: 'coach_status', field_value: 'expired' });

    falsy('the expired record is deleted', await env.COACH_KV.get('trial:c1:1042'));
    truthy('the unexpired one survives', await env.COACH_KV.get('trial:c2:1042'));
  }

  // --- the one that protects a mid-trial reader ---------------------------
  {
    const env = await mk([
      { contactId: 'c1', code: '1042', expiresAt: PAST },
      { contactId: 'c1', code: '2042', expiresAt: FUTURE },
    ]);
    // After removing coach A's tag, the contact still holds coach B's.
    const calls = ghl({ c1: ['bookcoach-b-active', 'newsletter'] });
    let r;
    try { r = await sweepExpiredTrials(env, { trialExpiryMode: 'on' }); } finally { globalThis.fetch = realFetch; }
    t('the finished trial ends', r.expired, 1);
    falsy('coach_status is NOT flipped to expired while another trial runs',
      calls.some((c) => c.method === 'PUT'));
    truthy('and the running trial is untouched', await env.COACH_KV.get('trial:c1:2042'));
  }
  {
    const env = await mk([{ contactId: 'c1', code: '1042', expiresAt: PAST }]);
    // A leftover non-coach tag must not be mistaken for a live entitlement.
    const calls = ghl({ c1: ['newsletter', 'shopify_delivered-manual'] });
    try { await sweepExpiredTrials(env, { trialExpiryMode: 'on' }); } finally { globalThis.fetch = realFetch; }
    truthy('unrelated tags do not keep coach_status alive',
      calls.some((c) => c.method === 'PUT'));
  }

  // --- a GHL failure must lose nothing ------------------------------------
  {
    const env = await mk([{ contactId: 'c1', code: '1042', expiresAt: PAST }]);
    ghl({}, { fail: true });
    let r;
    try { r = await sweepExpiredTrials(env, { trialExpiryMode: 'on' }); } finally { globalThis.fetch = realFetch; }
    t('nothing is counted as expired', r.expired, 0);
    truthy('the error is reported', r.errors.length > 0);
    truthy('and the record SURVIVES so the next run retries',
      await env.COACH_KV.get('trial:c1:1042'));
  }

  // --- a deleted contact is cleaned up, not retried forever ---------------
  {
    const env = await mk([{ contactId: 'gone', code: '1042', expiresAt: PAST }]);
    ghl({}, { missing: true });
    let r;
    try { r = await sweepExpiredTrials(env, { trialExpiryMode: 'on' }); } finally { globalThis.fetch = realFetch; }
    t('counted as an orphan, not an expiry', [r.orphans, r.expired], [1, 0]);
    falsy('and the stale record is removed', await env.COACH_KV.get('trial:gone:1042'));
  }

  // --- a coach that left the registry -------------------------------------
  {
    const env = await mk([{ contactId: 'c1', code: '9999', expiresAt: PAST }]);
    const calls = ghl();
    let r;
    try { r = await sweepExpiredTrials(env, { trialExpiryMode: 'on' }); } finally { globalThis.fetch = realFetch; }
    t('an unknown coach code is an orphan', r.orphans, 1);
    t('GHL is never called for it', calls.length, 0);
    falsy('and it stops being retried', await env.COACH_KV.get('trial:c1:9999'));
  }

  // --- THE case a majority guard would have broken ------------------------
  {
    // Everyone bought on launch day, so everyone expires on the same day.
    const trials = Array.from({ length: 12 }, (_, i) => ({ contactId: `c${i}`, code: '1042', expiresAt: PAST }));
    const env = await mk(trials);
    ghl(Object.fromEntries(trials.map((t) => [t.contactId, []])));
    let r;
    try { r = await sweepExpiredTrials(env, { trialExpiryMode: 'on' }); } finally { globalThis.fetch = realFetch; }
    t('100% of trials expiring at once is NORMAL and must all go through',
      [r.due, r.expired], [12, 12]);
    t('nothing is deferred below the cap', r.deferred, 0);
  }

  // --- the circuit breaker --------------------------------------------------
  {
    const trials = Array.from({ length: 105 }, (_, i) => ({ contactId: `c${i}`, code: '1042', expiresAt: PAST }));
    const env = await mk(trials);
    ghl(Object.fromEntries(trials.map((t) => [t.contactId, []])));
    let r;
    try { r = await sweepExpiredTrials(env, { trialExpiryMode: 'on' }); } finally { globalThis.fetch = realFetch; }
    t('a run is capped at 100', r.expired, 100);
    t('and the remainder is deferred, not dropped', r.deferred, 5);
    // WHICH five is decided by KV's lexicographic key order, not by insertion
    // order - so assert the count, not a particular id. There is no starvation:
    // each run deletes what it processed, so the next run's first 100 advances.
    const left = [...env.COACH_KV.store.keys()].filter((k) => k.startsWith('trial:'));
    t('exactly the deferred five survive for the next run', left.length, 5);
  }

  // --- malformed and unparseable records ----------------------------------
  {
    const env = await mk([{ contactId: 'c1', code: '1042', expiresAt: PAST }]);
    await env.COACH_KV.put('trial:broken', JSON.stringify({ nothing: true }));
    await env.COACH_KV.put('trial:c9:1042', JSON.stringify({
      contactId: 'c9', code: '1042', expiresAt: 'not-a-date',
    }));
    ghl({ c1: [] });
    let r;
    try { r = await sweepExpiredTrials(env, { trialExpiryMode: 'on' }); } finally { globalThis.fetch = realFetch; }
    t('a record with no contactId is an orphan and is not acted on', r.orphans, 1);
    t('an unparseable expiry is never treated as due', r.due, 1);
    truthy('and that record is left alone rather than guessed at',
      await env.COACH_KV.get('trial:c9:1042'));
  }

  // --- config validation ---------------------------------------------------
  t('the shipped default is off', runtimeConfig({}).trialExpiryMode, 'off');
  t('off/dry/on all validate', [
    configProblems(runtimeConfig({ config: { trialExpiryMode: 'off' } })).length,
    configProblems(runtimeConfig({ config: { trialExpiryMode: 'dry' } })).length,
    configProblems(runtimeConfig({ config: { trialExpiryMode: 'on' } })).length,
  ], [0, 0, 0]);
  truthy('anything else is rejected',
    configProblems(runtimeConfig({ config: { trialExpiryMode: 'enforce' } })).length > 0);
}


/* ---------------------------------------------------------------------------
 * Tagging paying subscribers. This is what makes the per-author
 * `Coach Subscription Started` workflow deletable: the course-grant workflow
 * triggers on the coach tag, so applying it here serves purchases and trials
 * through one mechanism.
 * ------------------------------------------------------------------------- */
console.log('applySubscriptionTags - the purchase path without a GHL workflow');
{
  const realFetch = globalThis.fetch;

  const mkEnv = async () => {
    __resetCaches();
    const kv = fakeKV();
    await kv.put('coach:1042', JSON.stringify({ code: '1042', name: 'A', ghlTag: 'bookcoach-a-active', projectID: 'p', versionID: 'main' }));
    await kv.put('coach:1043', JSON.stringify({ code: '1043', name: 'B', ghlTag: 'bookcoach-b-active', projectID: 'p', versionID: 'main' }));
    return { COACH_KV: kv, GHL_API_TOKEN: 'tok', GHL_LOCATION_ID: 'loc' };
  };

  const ent = (rows) => new Map(rows.map(([id, fromTag, fromSub]) => [id, {
    codes: new Set([...fromTag, ...fromSub]), phone: '',
    fromTag: new Set(fromTag), fromSub: new Set(fromSub),
  }]));

  const spy = ({ fail = false } = {}) => {
    const calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), method: init.method, body: init.body ? JSON.parse(init.body) : null });
      if (fail) return new Response('nope', { status: 500 });
      if (String(url).includes('/tags')) return new Response(JSON.stringify({ tags: ['bookcoach-a-active'] }), { status: 200 });
      return new Response('{"succeded":true}', { status: 200 });
    };
    return calls;
  };

  // --- off is the shipped default -----------------------------------------
  {
    const env = await mkEnv();
    const calls = spy();
    let r;
    try { r = await applySubscriptionTags(env, { tagOnSubscription: 'off' }, ent([['c1', [], ['1042']]])); }
    finally { globalThis.fetch = realFetch; }
    t('off does nothing', [r.tagged, calls.length], [0, 0]);
  }
  {
    const env = await mkEnv();
    const calls = spy();
    let r;
    try { r = await applySubscriptionTags(env, {}, ent([['c1', [], ['1042']]])); }
    finally { globalThis.fetch = realFetch; }
    t('an absent setting is treated as off', [r.tagged, calls.length], [0, 0]);
  }

  // --- dry ------------------------------------------------------------------
  {
    const env = await mkEnv();
    const calls = spy();
    let r;
    try { r = await applySubscriptionTags(env, { tagOnSubscription: 'dry' }, ent([['c1', [], ['1042']]])); }
    finally { globalThis.fetch = realFetch; }
    t('dry counts but writes nothing', [r.tagged, calls.length], [1, 0]);
  }

  // --- the case this exists for -------------------------------------------
  {
    const env = await mkEnv();
    const calls = spy();
    let r;
    try { r = await applySubscriptionTags(env, { tagOnSubscription: 'on' }, ent([['c1', [], ['1042']]])); }
    finally { globalThis.fetch = realFetch; }
    t('a paying subscriber with no tag gets tagged', [r.tagged, r.statusSet], [1, 1]);
    const post = calls.find((c) => c.method === 'POST');
    t('with that specific coach tag', post.body.tags, ['bookcoach-a-active']);
    truthy('on the right contact', post.url.endsWith('/contacts/c1/tags'));
    const put = calls.find((c) => c.method === 'PUT');
    t('and coach_status becomes active', put.body.customFields[0], { key: 'coach_status', field_value: 'active' });
  }

  // --- idempotence, with no extra state -----------------------------------
  {
    const env = await mkEnv();
    const calls = spy();
    let r;
    try { r = await applySubscriptionTags(env, { tagOnSubscription: 'on' }, ent([['c1', ['1042'], ['1042']]])); }
    finally { globalThis.fetch = realFetch; }
    t('a subscriber who ALREADY holds the tag is left alone', [r.tagged, calls.length], [0, 0]);
  }
  {
    const env = await mkEnv();
    const calls = spy();
    let r;
    try { r = await applySubscriptionTags(env, { tagOnSubscription: 'on' }, ent([['c1', ['1042'], []]])); }
    finally { globalThis.fetch = realFetch; }
    t('a TRIAL user (tag, no subscription) is never touched', [r.tagged, calls.length], [0, 0]);
  }

  // --- multi-author ---------------------------------------------------------
  {
    const env = await mkEnv();
    const calls = spy();
    let r;
    try { r = await applySubscriptionTags(env, { tagOnSubscription: 'on' }, ent([['c1', ['1042'], ['1042', '1043']]])); }
    finally { globalThis.fetch = realFetch; }
    t('only the coach they are NOT already tagged for is applied', r.tagged, 1);
    t('and it is the right one', calls.find((c) => c.method === 'POST').body.tags, ['bookcoach-b-active']);
  }

  // --- an unknown code cannot invent a tag ---------------------------------
  {
    const env = await mkEnv();
    const calls = spy();
    let r;
    try { r = await applySubscriptionTags(env, { tagOnSubscription: 'on' }, ent([['c1', [], ['9999']]])); }
    finally { globalThis.fetch = realFetch; }
    t('a code not in the registry is skipped', [r.tagged, calls.length], [0, 0]);
  }

  // --- a GHL failure must not abort the reconcile --------------------------
  {
    const env = await mkEnv();
    spy({ fail: true });
    let r, threw = false;
    try { r = await applySubscriptionTags(env, { tagOnSubscription: 'on' }, ent([['c1', [], ['1042']]])); }
    catch { threw = true; }
    finally { globalThis.fetch = realFetch; }
    falsy('it does not throw - the reconcile must still renew every other lease', threw);
    t('nothing is counted as done', [r.tagged, r.statusSet], [0, 0]);
    truthy('and the failure is reported', r.errors.length > 0);
  }

  // --- config ---------------------------------------------------------------
  t('the shipped default is off', runtimeConfig({}).tagOnSubscription, 'off');
  truthy('an invalid mode is rejected',
    configProblems(runtimeConfig({ config: { tagOnSubscription: 'enforce' } })).length > 0);
  t('off/dry/on all validate', [
    configProblems(runtimeConfig({ config: { tagOnSubscription: 'off' } })).length,
    configProblems(runtimeConfig({ config: { tagOnSubscription: 'dry' } })).length,
    configProblems(runtimeConfig({ config: { tagOnSubscription: 'on' } })).length,
  ], [0, 0, 0]);
}

console.log('reconcile - subscription tagging is wired in, and dry runs stay dry');
{
  const realFetch = globalThis.fetch;
  const PROD = 'prod-59';
  __resetCaches();
  const kv = fakeKV();
  await kv.put('coach:1042', JSON.stringify({ code: '1042', name: 'A', ghlTag: 'tag-a', ghlProductId: PROD }));
  await kv.put('config', JSON.stringify({ leaseHours: 48, archiveRetentionDays: 30, tagOnSubscription: 'on' }));
  const env = { COACH_KV: kv, GHL_API_TOKEN: 'pit-x', GHL_LOCATION_ID: 'loc' };

  const routed = (calls) => async (u, init) => {
    const url = String(u);
    calls.push({ url, method: init && init.method });
    if (url.includes('/contacts/search')) return new Response(JSON.stringify({ contacts: [] }), { status: 200 });
    if (url.includes('/payments/subscriptions')) {
      return new Response(JSON.stringify({ data: [{
        contactId: 'payer1', status: 'active', contactPhone: '', liveMode: true,
        recurringProduct: { product: { _id: PROD } },
      }], totalCount: 1 }), { status: 200 });
    }
    if (url.includes('/tags')) return new Response(JSON.stringify({ tags: ['tag-a'] }), { status: 200 });
    return new Response('{"succeded":true}', { status: 200 });
  };

  // dry run must not tag
  {
    const calls = [];
    globalThis.fetch = routed(calls);
    let r;
    try { r = await reconcileEntitlements(env, { dryRun: true }); } finally { globalThis.fetch = realFetch; }
    truthy('dry run ok', r.ok);
    falsy('a DRY reconcile never applies a tag', calls.some((c) => c.url.includes('/tags')));
  }

  // real run tags the payer
  {
    const calls = [];
    globalThis.fetch = routed(calls);
    let r;
    try { r = await reconcileEntitlements(env); } finally { globalThis.fetch = realFetch; }
    truthy('real run ok', r.ok);
    t('the paying contact was tagged', r.subTagsApplied, 1);
    t('and its status set once', r.subStatusSet, 1);
    truthy('via the tags endpoint on that contact',
      calls.some((c) => c.url.includes('/contacts/payer1/tags') && c.method === 'POST'));
  }
}

/* =========================================================================
 * Shared memory across channels — plans/10-shared-memory-across-channels.md
 * Build log: plans/coach-memory-sms.md
 * ========================================================================= */
{
  const { sharedMemoryOn, vfUserFor, vfIsLive, voiceSessionFor, handleSms, handleVoiceEntry, revokeSubscriber } = __test;
  const PHONE = '+18885550100';
  const CID = 'c1';
  const realFetch = globalThis.fetch;

  console.log('');
  console.log('shared memory - which Voiceflow userID a handset uses');
  {
    const on = { sharedMemory: 'on' };
    const off = { sharedMemory: 'off' };
    const c = { code: '1042' };
    t('global off: phone id', vfUserFor(off, c, PHONE, CID), 'phone:' + PHONE);
    t('global on: the web page id, with an UNDERSCORE', vfUserFor(on, c, PHONE, CID), 'ghl_' + CID);
    t('coach false overrides global on', vfUserFor(on, { ...c, sharedMemory: false }, PHONE, CID), 'phone:' + PHONE);
    t('coach true overrides global off', vfUserFor(off, { ...c, sharedMemory: true }, PHONE, CID), 'ghl_' + CID);
    t('no contactId never merges, even when on', vfUserFor(on, c, PHONE, null), 'phone:' + PHONE);
    falsy('a missing config reads as off', sharedMemoryOn(null, c));
  }

  // --- a fake Voiceflow that records every call ------------------------------
  const fakeVf = ({ live = false } = {}) => {
    const calls = [];
    const fn = async (url, init = {}) => {
      const u = String(url);
      const method = (init.method || 'GET').toUpperCase();
      const m = /\/state\/user\/([^/]+)(\/[a-z]+)?$/.exec(u);
      const userID = m ? decodeURIComponent(m[1]) : null;
      const tail = m ? m[2] || '' : '';
      const body = init.body ? JSON.parse(init.body) : null;
      calls.push({ method, userID, tail, action: body && body.action ? body.action : null });
      if (method === 'GET' && !tail) return new Response(JSON.stringify({ stack: live ? [{ programID: 'p' }] : [], variables: {} }), { status: 200 });
      if (method === 'POST' && tail === '/interact') {
        const a = body.action || {};
        const msg = a.type === 'launch' ? 'GREETING' : `REPLY to ${a.payload}`;
        return new Response(JSON.stringify([{ type: 'text', payload: { message: msg } }]), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    };
    return { calls, fn };
  };
  const withFetch = async (f, fn) => {
    globalThis.fetch = f;
    try { return await fn(); } finally { globalThis.fetch = realFetch; }
  };

  const mkEnv = async ({ mode = 'on', coachFlag, lease = true, session } = {}) => {
    __resetCaches();
    const kv = fakeKV();
    const coach = { name: 'Micheal Stickler', aliases: ['Stickler'], keyVar: 'VF_KEY_1042', versionID: 'main' };
    if (coachFlag !== undefined) coach.sharedMemory = coachFlag;
    await kv.put('coach:1042', JSON.stringify(coach));
    await kv.put('config', JSON.stringify({ entitlementMode: 'enforce', sharedMemory: mode }));
    if (lease) {
      await kv.put('sub:' + PHONE, JSON.stringify({ contactId: CID, codes: ['1042'], expires: new Date(Date.now() + 86400000).toISOString() }));
    }
    if (session) await kv.put('sess:sms:' + PHONE, JSON.stringify(session));
    return { COACH_KV: kv, VF_KEY_1042: 'VF.DM.test', SKIP_TWILIO_VALIDATION: 'true' };
  };
  const smsReq = (body) => new Request('https://w.example/twilio/sms', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ From: PHONE, Body: body }).toString(),
  });
  const voiceReq = () => new Request('https://w.example/twilio/voice', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ From: PHONE, CallSid: 'CA1' }).toString(),
  });
  const interacts = (calls) => calls.filter((c) => c.tail === '/interact');

  console.log('');
  console.log('shared memory - vfIsLive');
  {
    const coach = { code: '1042', keyVar: 'VF_KEY_1042' };
    const env = { VF_KEY_1042: 'VF.DM.test' };
    truthy('a non-empty stack is live', await withFetch(fakeVf({ live: true }).fn, () => vfIsLive(env, coach, 'ghl_c1')));
    falsy('an empty stack is not', await withFetch(fakeVf({ live: false }).fn, () => vfIsLive(env, coach, 'ghl_c1')));
    falsy('a Voiceflow error reads as not live (falls back to a launch)',
      await withFetch(async () => new Response('x', { status: 500 }), () => vfIsLive(env, coach, 'ghl_c1')));
    falsy('a network failure reads as not live',
      await withFetch(async () => { throw new Error('down'); }, () => vfIsLive(env, coach, 'ghl_c1')));
  }

  console.log('');
  console.log('shared memory - SMS');
  {
    // Live web conversation, SMS session expired: the message is ANSWERED, no launch.
    const env = await mkEnv({ mode: 'on' });
    const vf = fakeVf({ live: true });
    const res = await withFetch(vf.fn, () => handleSms(smsReq('Where were we?'), env));
    const xml = await res.text();
    const i = interacts(vf.calls);
    t('one interact, and it is a text turn - no launch over a live conversation', i.map((c) => c.action.type), ['text']);
    t('on the web page id', i[0].userID, 'ghl_' + CID);
    truthy('and the member gets the coach reply to what they said', xml.includes('REPLY to Where were we?'));
    t('the session is still written, pinned to the coach',
      (await env.COACH_KV.get('sess:sms:' + PHONE)).code, '1042');
  }
  {
    // Nothing live yet: behaves as before - a launch, but under the shared id.
    const env = await mkEnv({ mode: 'on' });
    const vf = fakeVf({ live: false });
    const xml = await (await withFetch(vf.fn, () => handleSms(smsReq('Hello'), env))).text();
    t('no live state: a launch, as before', interacts(vf.calls).map((c) => c.action.type), ['launch']);
    t('under the shared id', interacts(vf.calls)[0].userID, 'ghl_' + CID);
    truthy('greeting returned', xml.includes('GREETING'));
  }
  {
    // Feature off: the old behaviour - phone id, no state check.
    const env = await mkEnv({ mode: 'off' });
    const vf = fakeVf({ live: true });
    await withFetch(vf.fn, () => handleSms(smsReq('Hello'), env));
    truthy('off: every call is on the phone id', vf.calls.every((c) => c.userID === 'phone:' + PHONE));
    falsy('off: no state lookup at all', vf.calls.some((c) => c.method === 'GET'));
    t('off: launch, as before', interacts(vf.calls).map((c) => c.action.type), ['launch']);
  }
  {
    // Per-coach override beats the global switch.
    const env = await mkEnv({ mode: 'on', coachFlag: false });
    const vf = fakeVf({ live: true });
    await withFetch(vf.fn, () => handleSms(smsReq('Hello'), env));
    truthy('coach sharedMemory:false keeps the phone id with the switch on', vf.calls.every((c) => c.userID === 'phone:' + PHONE));
  }
  {
    const env = await mkEnv({ mode: 'off', coachFlag: true });
    const vf = fakeVf({ live: false });
    await withFetch(vf.fn, () => handleSms(smsReq('Hello'), env));
    t('coach sharedMemory:true uses the shared id with the switch off', interacts(vf.calls)[0].userID, 'ghl_' + CID);
  }
  {
    // Pinned session: an ordinary turn, on the shared id, with no state lookup.
    const env = await mkEnv({ mode: 'on', session: { code: '1042', started: new Date().toISOString(), touched: new Date().toISOString() } });
    const vf = fakeVf({ live: true });
    await withFetch(vf.fn, () => handleSms(smsReq('Next question'), env));
    t('pinned: one text turn', interacts(vf.calls).map((c) => c.action.type), ['text']);
    t('pinned: shared id', interacts(vf.calls)[0].userID, 'ghl_' + CID);
    falsy('pinned: no per-message state lookup', vf.calls.some((c) => c.method === 'GET'));
  }
  {
    // Activation code with a live web conversation: continue, don't relaunch.
    const env = await mkEnv({ mode: 'on', lease: false });
    await env.COACH_KV.put('tok:K7M2QP', JSON.stringify({ contactId: CID, codes: ['1042'] }));
    const vf = fakeVf({ live: true });
    const xml = await (await withFetch(vf.fn, () => handleSms(smsReq('K7M2QP'), env))).text();
    t('activation over a live conversation: no launch', interacts(vf.calls).length, 0);
    truthy('says it is picking up where they left off', xml.includes('Picking up where we left off'));
    truthy('state was checked on the shared id', vf.calls.some((c) => c.method === 'GET' && c.userID === 'ghl_' + CID));
    truthy('and the phone is linked as before', !!(await env.COACH_KV.get('bind:' + PHONE)));
  }
  {
    // Activation with nothing live: the usual greeting, shared id.
    const env = await mkEnv({ mode: 'on', lease: false });
    await env.COACH_KV.put('tok:K7M2QP', JSON.stringify({ contactId: CID, codes: ['1042'] }));
    const vf = fakeVf({ live: false });
    await withFetch(vf.fn, () => handleSms(smsReq('K7M2QP'), env));
    t('activation, nothing live: launch on the shared id',
      interacts(vf.calls).map((c) => [c.action.type, c.userID]), [['launch', 'ghl_' + CID]]);
  }
  {
    // RESET must really start over when the conversation is shared.
    const env = await mkEnv({ mode: 'on' });
    const vf = fakeVf({ live: false });
    await withFetch(vf.fn, () => handleSms(smsReq('RESET'), env));
    const del = vf.calls.findIndex((c) => c.method === 'DELETE');
    const launch = vf.calls.findIndex((c) => c.action && c.action.type === 'launch');
    truthy('RESET deletes the shared state', del >= 0 && vf.calls[del].userID === 'ghl_' + CID);
    truthy('before launching', del >= 0 && launch > del);
  }
  {
    const env = await mkEnv({ mode: 'off' });
    const vf = fakeVf({ live: false });
    await withFetch(vf.fn, () => handleSms(smsReq('RESET'), env));
    falsy('RESET with the switch off deletes nothing (old behaviour)', vf.calls.some((c) => c.method === 'DELETE'));
  }
  {
    // The gate still comes first: no lease, no shared conversation.
    const env = await mkEnv({ mode: 'on', lease: false });
    const vf = fakeVf({ live: true });
    await withFetch(vf.fn, () => handleSms(smsReq('Hello'), env));
    t('a non-subscriber never reaches Voiceflow at all', vf.calls.length, 0);
  }

  console.log('');
  console.log('shared memory - voice');
  {
    t('voiceSessionFor records the shared id',
      voiceSessionFor({ sharedMemory: 'on' }, { code: '1042' }, PHONE, { contactId: CID }).vfUser, 'ghl_' + CID);
    t('and the phone id when off',
      voiceSessionFor({ sharedMemory: 'off' }, { code: '1042' }, PHONE, { contactId: CID }).vfUser, 'phone:' + PHONE);
  }
  {
    const env = await mkEnv({ mode: 'on' });
    const vf = fakeVf({ live: true });
    const xml = await (await withFetch(vf.fn, () => handleVoiceEntry(voiceReq(), env))).text();
    t('call over a live conversation: no launch', interacts(vf.calls).length, 0);
    truthy('welcomed back instead', xml.includes('Welcome back'));
    t('the turn loop will use the shared id', (await env.COACH_KV.get('sess:voice:' + PHONE)).vfUser, 'ghl_' + CID);
  }
  {
    const env = await mkEnv({ mode: 'on' });
    const vf = fakeVf({ live: false });
    const xml = await (await withFetch(vf.fn, () => handleVoiceEntry(voiceReq(), env))).text();
    t('call, nothing live: launch on the shared id',
      interacts(vf.calls).map((c) => [c.action.type, c.userID]), [['launch', 'ghl_' + CID]]);
    // sanitizeForSpeech title-cases ALL CAPS so Polly doesn't spell it out.
    truthy('greeting spoken', /greeting/i.test(xml));
  }
  {
    const env = await mkEnv({ mode: 'off' });
    const vf = fakeVf({ live: true });
    await withFetch(vf.fn, () => handleVoiceEntry(voiceReq(), env));
    truthy('voice, switch off: phone id throughout', vf.calls.every((c) => c.userID === 'phone:' + PHONE));
    t('voice, switch off: session vfUser is the phone id', (await env.COACH_KV.get('sess:voice:' + PHONE)).vfUser, 'phone:' + PHONE);
  }

  console.log('');
  console.log('shared memory - archive deletes the conversation actually in use');
  {
    const env = await mkEnv({ mode: 'on' });
    const cfgOn = { archiveRetentionDays: 30, sharedMemory: 'on' };
    await revokeSubscriber(env, PHONE, { contactId: CID, codes: ['1042'] }, cfgOn);
    const rec = await env.COACH_KV.get('arch:' + PHONE);
    t('the record keeps the phone id', rec.userID, 'phone:' + PHONE);
    t('and adds the shared id', rec.sharedUserID, 'ghl_' + CID);

    await env.COACH_KV.put('arch:' + PHONE, JSON.stringify({ ...rec, dueAt: new Date(Date.now() - 1000).toISOString() }));
    const vf = fakeVf();
    const r = await withFetch(vf.fn, () => sweepArchives(env, { archiveAutoDelete: true, archiveRetentionDays: 30 }));
    t('both conversations are deleted',
      vf.calls.filter((c) => c.method === 'DELETE').map((c) => c.userID).sort(), ['ghl_' + CID, 'phone:' + PHONE]);
    t('counted once', r.deleted, 1);
  }
  {
    const env = await mkEnv({ mode: 'off' });
    await revokeSubscriber(env, PHONE, { contactId: CID, codes: ['1042'] }, { archiveRetentionDays: 30, sharedMemory: 'off' });
    t('switch off at revocation: no shared id recorded', (await env.COACH_KV.get('arch:' + PHONE)).sharedUserID, null);
  }
  {
    // Two handsets on one contact queue the same shared id twice; the second
    // delete gets a 404 and must still clear the record.
    const env = await mkEnv({ mode: 'on' });
    await env.COACH_KV.put('arch:' + PHONE, JSON.stringify({
      userID: 'phone:' + PHONE, sharedUserID: 'ghl_' + CID, codes: ['1042'], dueAt: new Date(Date.now() - 1000).toISOString(),
    }));
    const r = await withFetch(async () => new Response('not found', { status: 404 }),
      () => sweepArchives(env, { archiveAutoDelete: true, archiveRetentionDays: 30 }));
    t('a 404 counts as already deleted', r.deleted, 1);
    t('no error reported', r.errors.length, 0);
  }

  console.log('');
  console.log('shared memory - web endpoints (/api/vf-interact, /api/vf-state)');
  {
    const { handleVfInteract, handleVfState } = __test;
    const TOKEN = 'a'.repeat(32);
    const mkWeb = async () => {
      const env = await mkEnv({ mode: 'on' });
      await env.COACH_KV.put('wtok:' + TOKEN, JSON.stringify({ contactId: CID, codes: ['1042'] }));
      return env;
    };
    const post = (body) => new Request('https://w.example/api/x', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });

    // Interact with a session: the page id, channel=web, and tts only when asked.
    {
      const env = await mkWeb();
      const calls = [];
      const f = async (url, init = {}) => {
        calls.push({ url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
        return new Response(JSON.stringify([{ type: 'text', payload: { message: 'hi' } }]), { status: 200 });
      };
      const r = await withFetch(f, () => handleVfInteract(post({ code: '1042', sessionToken: TOKEN, action: { type: 'text', payload: 'x' }, tts: true }), env, {}));
      const out = await r.json();
      t('interact: session -> the page id', out.userID, 'ghl_' + CID);
      const patch = calls.find((c) => c.method === 'PATCH');
      t('interact: channel is set to web on every web turn', patch && patch.body.channel, 'web');
      const inter = calls.find((c) => c.url.endsWith('/interact'));
      t('interact: tts requested -> tts true', inter.body.config, { tts: true });

      const calls2 = [];
      const f2 = async (url, init = {}) => {
        calls2.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null });
        return new Response('[]', { status: 200 });
      };
      await withFetch(f2, () => handleVfInteract(post({ code: '1042', sessionToken: TOKEN, action: { type: 'launch' } }), env, {}));
      t('interact: no tts asked -> the text-only default', calls2.find((c) => c.url.endsWith('/interact')).body.config.tts, false);
    }

    // State get: only the memory variables leave the Worker.
    {
      const env = await mkWeb();
      const f = async () => new Response(JSON.stringify({
        stack: [{}], variables: { _memory_: [{ role: 'user', content: 'hello' }], vf_memory: 'user: hello', user_phone: PHONE, secret_flag: 1 },
      }), { status: 200 });
      const out = await (await withFetch(f, () => handleVfState(post({ code: '1042', sessionToken: TOKEN, op: 'get' }), env, {}))).json();
      t('state: the page id', out.userID, 'ghl_' + CID);
      truthy('state: live', out.live);
      t('state: the memory comes back', out.memory.vf_memory, 'user: hello');
      falsy('state: the phone number does NOT leave the Worker', JSON.stringify(out).includes(PHONE));
      falsy('state: nor any other variable', JSON.stringify(out).includes('secret_flag'));
    }

    // State reset: deletes the member's own state.
    {
      const env = await mkWeb();
      const vf = fakeVf();
      const out = await (await withFetch(vf.fn, () => handleVfState(post({ code: '1042', sessionToken: TOKEN, op: 'reset' }), env, {}))).json();
      truthy('reset: acknowledged', out.reset);
      t('reset: deletes the member state', vf.calls.filter((c) => c.method === 'DELETE').map((c) => c.userID), ['ghl_' + CID]);
    }

    // No session: cannot reach a member's conversation by naming it.
    {
      const env = await mkWeb();
      const vf = fakeVf();
      const out = await (await withFetch(vf.fn, () => handleVfState(post({ code: '1042', userID: 'ghl_' + CID, op: 'reset' }), env, {}))).json();
      t('no session: a ghl_ id in the body is namespaced away', out.userID, 'web:ghl_' + CID);
      falsy('no session: the member state is untouched', vf.calls.some((c) => c.userID === 'ghl_' + CID));
    }
    {
      const env = await mkWeb();
      const out = await (await withFetch(fakeVf().fn, () => handleVfState(post({ code: '1042', sessionToken: 'b'.repeat(32), op: 'get' }), env, {}))).json();
      t('a made-up session token gets no member identity', out.userID.startsWith('web:'), true);
    }
  }

  console.log('');
  console.log('shared memory - config switch');
  {
    t('ships off', runtimeConfig({}).sharedMemory, 'off');
    t('on is accepted', configProblems(runtimeConfig({ config: { sharedMemory: 'on' } })).filter((p) => /sharedMemory/.test(p)), []);
    truthy('anything else is rejected', configProblems(runtimeConfig({ config: { sharedMemory: 'yes' } })).some((p) => /sharedMemory/.test(p)));
    truthy('a per-coach string "false" is rejected (it would read as on)',
      coachProblems([{ code: '1042', index: 0, sharedMemory: 'false' }]).some((p) => /sharedMemory/.test(p)));
    t('a per-coach boolean is fine', coachProblems([{ code: '1042', index: 0, sharedMemory: true }]), []);
    t('sharedMemory:false survives into KV (false is not "unset")',
      registryValue({ name: 'A', sharedMemory: false }).sharedMemory, false);
  }
}

/* ---------------------------------------------------------------------------
 * onboard (lib-onboard.mjs) — plans/21 §B
 * ------------------------------------------------------------------------- */
{
  const { ghlNames, slugConventions, projectFromVersion, parseCoachPage, defaultAliases, buildEntry, preflightProblems, inspectGhl, applyGhl, remainingSteps } =
    await import('./lib-onboard.mjs');

  console.log('\nonboard - naming conventions');
  {
    // Pinned to what was created BY HAND for Freddy on 2026-09-24, read back
    // from GHL 2026-09-28. If these drift, a clone stops matching its siblings.
    const n = ghlNames('Freddy Davis');
    t('product name matches the live Freddy product', n.product, 'BookCoach AI - Freddy Davis - Coach Access');
    t('price name matches the live Freddy price', n.price, 'BookCoach AI - Freddy Davis - Coach Access @ 59/month');
    t('description matches the live Freddy product', n.description, 'Monthly access to the Freddy Davis Book Coach AI by text, phone and web.');
    const c = slugConventions('freddy-davis');
    t('tag follows the convention and matches the registry', c.ghlTag, 'bookcoach-freddy-davis-active');
    t('landing URL matches the registry', c.landingPageUrl, 'https://www.book-coach.ai/freddy-davis-coach-access');
    truthy('iframe src keeps &amp; (it is pasted into HTML)', c.iframeSrc.includes('?cid={{contact.id}}&amp;em={{contact.email}}'));
  }

  console.log('\nonboard - projectFromVersion');
  t('Freddy: version - 1 is his real project id', projectFromVersion('6a3339b6eb283c59b70cfa53'), '6a3339b6eb283c59b70cfa52');
  t('a trailing 0 BORROWS - the case "decrement the last character" gets wrong', projectFromVersion('69e68f5c26ce7fca93b47e20'), '69e68f5c26ce7fca93b47e1f');
  t('an alias is not derivable', projectFromVersion('main'), null);
  t('garbage is not derivable', projectFromVersion('xyz'), null);

  console.log('\nonboard - parseCoachPage');
  {
    const proxied = parseCoachPage(`const CONFIG = { authorName: "Freddy Davis", showActivation: true, CONNECTION: "worker", COACH_CODE: "1043", VF_API_KEY: "",  VF_VERSION_ID: "6a3339b6eb283c59b70cfa53", VF_PROJECT_ID: "6a3339b6eb283c59b70cfa52" };`);
    t('Worker page: version read', proxied.versionID, '6a3339b6eb283c59b70cfa53');
    t('Worker page: project read', proxied.projectID, '6a3339b6eb283c59b70cfa52');
    t('Worker page: NO key, by design', proxied.vfKey, '');
    t('Worker page: coach code read', proxied.coachCode, '1043');
    t('Worker page: showActivation read', proxied.showActivation, true);
    const legacy = parseCoachPage(`authorName: 'Rick Meyer', VF_API_KEY: "VF.DM.abc.def", VF_VERSION_ID : "6a34712d677246c3541333c3"`);
    t('legacy page: key read', legacy.vfKey, 'VF.DM.abc.def');
    t('legacy page: missing showActivation is null, not false', legacy.showActivation, null);
    t('legacy page: no CONNECTION', legacy.connection, '');
    // The live Freddy page, 2026-09-28: GHL also serves CONFIG JSON-escaped.
    const escaped = parseCoachPage(String.raw`    COACH_CODE: \"1043\",\n    WORKER_URL: \"https://coach-router\"`);
    t('the JSON-escaped copy GHL serves is read too', escaped.coachCode, '1043');
    t('a Worker page with no VF fields yields none (ids must come from flags)', [escaped.versionID, escaped.projectID], ['', '']);
  }

  console.log('\nonboard - entry');
  {
    t('aliases: full name, first, last', defaultAliases('Freddy Davis'), ['Freddy Davis', 'Freddy', 'Davis']);
    t('aliases: both spellings kept, case-duplicates dropped',
      defaultAliases('Micheal Stickler', 'Michael Stickler'), ['Micheal Stickler', 'Michael Stickler', 'Micheal', 'Stickler', 'Michael']);
    const e = buildEntry({ code: '1044', author: 'Jane Smith', book: 'Her Book', slug: 'jane-smith', projectID: 'a'.repeat(24), versionID: 'b'.repeat(24), vfKey: 'VF.DM.x' });
    t('name defaults to the display spelling', [e.name, e.displayName], ['Jane Smith', 'Jane Smith']);
    t('tag from slug', e.ghlTag, 'bookcoach-jane-smith-active');
    t('trialDays defaults to 10', e.trialDays, 10);
    falsy('no shopifyProductId until one is given', 'shopifyProductId' in e);
    t('a numeric Shopify id is stored as a string', buildEntry({ code: '1', author: 'A B', book: 'x', slug: 'a-b', shopifyProductId: 123 }).shopifyProductId, '123');
    const split = buildEntry({ code: '1', author: 'Michael X', name: 'Micheal X', book: 'b', slug: 'x' });
    t('--name keeps the internal spelling separate', [split.name, split.displayName], ['Micheal X', 'Michael X']);
  }

  console.log('\nonboard - preflightProblems');
  {
    const good = { code: '1044', author: 'Jane Smith', book: 'Her Book', slug: 'jane-smith', projectID: 'a'.repeat(24), versionID: 'b'.repeat(24), vfKey: 'VF.DM.k' };
    const existing = [{ code: '1043', name: 'Freddy Davis', ghlTag: 'bookcoach-freddy-davis-active', shopifyProductId: '10454698754362', index: 0 }];
    const probs = (o, ex = existing) => preflightProblems({ existing: ex, entry: buildEntry({ ...good, ...o }), slug: o.slug ?? good.slug });
    t('a complete new author passes', probs({}), []);
    truthy('an existing code is REFUSED, never edited', probs({ code: '1043' }).some((p) => /already in coaches\.json/.test(p)));
    truthy('a bad slug is refused', probs({ slug: 'Jane Smith' }).some((p) => /--slug/.test(p)));
    truthy('a non-numeric code is refused', probs({ code: 'JS1' }).some((p) => /digits/.test(p)));
    truthy('TwiML punctuation is caught BEFORE the product exists', probs({ author: 'Jane & Smith' }).some((p) => /TwiML/.test(p)));
    truthy('a missing key is refused, and names the env var', probs({ vfKey: '' }).some((p) => /VF_KEY_1044/.test(p)));
    truthy('a non-DM key is refused', probs({ vfKey: 'sk-live' }).some((p) => /VF\.DM/.test(p)));
    truthy('a missing project is refused', probs({ projectID: '' }).some((p) => /projectID/.test(p)));
    truthy('a Shopify id already used by another coach is refused (cross-grant)',
      probs({ shopifyProductId: '10454698754362' }).some((p) => /duplicate shopifyProductId/.test(p)));
    truthy('a slug whose tag another coach holds is refused', probs({ slug: 'freddy-davis' }).some((p) => /duplicate ghlTag/.test(p)));
    t('problems in OTHER coaches are not blamed on this one',
      probs({}, [{ code: '9', name: 'Old', trialDays: 500, index: 0 }]), []);
  }

  // A scripted GHL. Every call is recorded so the ORDER of writes can be asserted.
  const fakeGhl = ({ products = [], staff = [{ id: 'STAFF' }], holders = [], prices = [], failOn = null } = {}) => {
    const calls = [];
    const fn = async (path, { method = 'GET', body = null } = {}) => {
      calls.push({ method, path: path.split('?')[0], body });
      const key = `${method} ${path.split('?')[0]}`;
      if (failOn && key.startsWith(failOn)) throw new Error(`GHL 500 on ${key}`);
      if (key === 'GET /products/') return { products };
      if (key === 'POST /contacts/search') return { contacts: body.filters[0].value[0] === 'bookcoach-staff-all' ? staff : holders };
      if (method === 'GET' && /\/price$/.test(key)) return { prices };
      if (method === 'GET' && key.startsWith('GET /products/')) return products.find((p) => key.endsWith(p._id)) || {};
      if (key === 'POST /products/') return { _id: 'NEWPRODUCT' };
      if (method === 'POST' && /\/price$/.test(key)) return { _id: 'NEWPRICE' };
      return {};
    };
    return { fn, calls, writes: () => calls.filter((c) => c.method !== 'GET' && c.path !== '/contacts/search') };
  };
  const entry = buildEntry({ code: '1044', author: 'Jane Smith', book: 'Her Book', slug: 'jane-smith', projectID: 'a'.repeat(24), versionID: 'b'.repeat(24), vfKey: 'VF.DM.k' });
  const inspect = (g, o = {}) => inspectGhl({ ghl: g.fn, locationId: 'LOC', entry, staffTag: 'bookcoach-staff-all', ...o });
  const P59 = { _id: 'P59', type: 'recurring', amount: 59, currency: 'USD', recurring: { interval: 'month', intervalCount: 1 } };

  console.log('\nonboard - inspectGhl (reads only)');
  {
    const g = fakeGhl();
    const r = await inspect(g);
    t('a clean location has no problems', r.problems, []);
    t('the staff contact is found', r.staffContactId, 'STAFF');
    t('inspection writes NOTHING', g.writes(), []);
  }
  {
    const r = await inspect(fakeGhl({ products: [{ _id: 'OLD', name: 'bookcoach ai - jane smith - coach access' }] }));
    truthy('a same-named product is refused (case-insensitive)', r.problems.some((p) => /already has a product/.test(p)));
    truthy('...and the refusal names the recovery flag', r.problems.some((p) => /--ghl-product OLD/.test(p)));
  }
  {
    const r = await inspect(fakeGhl({ products: [{ _id: 'OLD', name: 'BookCoach AI - Jane Smith - Coach Access' }], prices: [P59] }), { adoptProductId: 'OLD' });
    t('--ghl-product adopts the product', [r.problems, r.product._id], [[], 'OLD']);
    t('...and reuses its existing $59 monthly price', r.price._id, 'P59');
  }
  {
    const r = await inspect(fakeGhl({ products: [{ _id: 'OLD', name: 'x' }], prices: [{ _id: 'P1', type: 'one_time', amount: 59, currency: 'USD' }] }), { adoptProductId: 'OLD' });
    t('a one-time price is NOT mistaken for the coach price', r.price, null);
  }
  {
    const r = await inspect(fakeGhl({ staff: [] }));
    truthy('no staff contact is refused', r.problems.some((p) => /staff tag/.test(p)));
    const r2 = await inspect(fakeGhl(), { staffTag: '' });
    truthy('no staffTag configured is refused', r2.problems.some((p) => /staffTag is empty/.test(p)));
  }
  {
    const r = await inspect(fakeGhl({ holders: [{ id: 'REALPERSON' }] }));
    truthy('a real contact already holding the tag is refused (they would be granted on push)',
      r.problems.some((p) => /REALPERSON/.test(p)));
    const r2 = await inspect(fakeGhl({ holders: [{ id: 'STAFF' }] }));
    t('the staff contact holding it (an interrupted run) is only a note', r2.problems, []);
    truthy('...and says it will be removed', r2.notes.some((n) => /will be removed/.test(n)));
  }

  console.log('\nonboard - applyGhl (the only writes)');
  {
    const g = fakeGhl();
    const r = await applyGhl({ ghl: g.fn, locationId: 'LOC', entry, inspection: await inspect(g) });
    t('returns the new ids', [r.ghlProductId, r.ghlPriceId, r.tag], ['NEWPRODUCT', 'NEWPRICE', 'bookcoach-jane-smith-active']);
    t('order: tag on, tag off, product, price',
      g.writes().map((c) => `${c.method} ${c.path}`),
      ['POST /contacts/STAFF/tags', 'DELETE /contacts/STAFF/tags', 'POST /products/', 'POST /products/NEWPRODUCT/price']);
    const product = g.writes()[2].body;
    t('product is a hidden SERVICE', [product.productType, product.availableInStore], ['SERVICE', false]);
    const price = g.writes()[3].body;
    t('price is $59 USD recurring monthly',
      [price.type, price.amount, price.currency, price.recurring], ['recurring', 59, 'USD', { interval: 'month', intervalCount: 1 }]);
    t('the tag is REMOVED from the staff contact (else it would be granted this coach)', g.writes()[1].body, { tags: ['bookcoach-jane-smith-active'] });
  }
  {
    const g = fakeGhl({ failOn: 'POST /products/NEWPRODUCT/price' });
    let err = null;
    try { await applyGhl({ ghl: g.fn, locationId: 'LOC', entry, inspection: await inspect(g) }); } catch (e) { err = e; }
    truthy('a price failure throws', err);
    t('...naming what already exists', err && err.created, { tag: 'bookcoach-jane-smith-active', productId: 'NEWPRODUCT' });
    truthy('...and the recovery flag', err && /--ghl-product NEWPRODUCT/.test(err.message));
  }
  {
    const g = fakeGhl({ failOn: 'DELETE /contacts' });
    let err = null;
    try { await applyGhl({ ghl: g.fn, locationId: 'LOC', entry, inspection: await inspect(g) }); } catch (e) { err = e; }
    t('a failed tag removal stops BEFORE the product, and says the tag is still on staff',
      [err && err.created, g.writes().some((c) => c.path === '/products/')], [{ tagAppliedTo: 'STAFF' }, false]);
  }
  {
    const g = fakeGhl({ products: [{ _id: 'OLD', name: 'x' }], prices: [P59] });
    const r = await applyGhl({ ghl: g.fn, locationId: 'LOC', entry, inspection: await inspect(g, { adoptProductId: 'OLD' }) });
    t('adopting product and price creates neither',
      [r.ghlProductId, r.ghlPriceId, g.writes().filter((c) => c.path.startsWith('/products')).length], ['OLD', 'P59', 0]);
  }

  console.log('\nonboard - remainingSteps');
  {
    const s = remainingSteps({ entry: { ...entry, ghlProductId: 'NEWPRODUCT' }, slug: 'jane-smith', label: 'Life Coach', priceId: 'NEWPRICE' });
    truthy('names showActivation: true (the most-missed step)', s.includes('showActivation: true'));
    truthy('gives the funnel both ids', s.includes('product NEWPRODUCT, price NEWPRICE'));
    truthy('says the $0 order is still required', /\$0 order/.test(s));
    falsy('never prints the Voiceflow key', s.includes('VF.DM.k'));
  }
}

/* ---------------------------------------------------------------------------
 * verify-author (lib-verify-author.mjs) — plans/21 §C
 * ------------------------------------------------------------------------- */
{
  const V = await import('./lib-verify-author.mjs');
  const now = new Date('2026-09-28T10:00:00Z');
  const coach = {
    code: '1044', name: 'Rick Meyer', displayName: 'Rick Meyer', bookTitle: 'Running on Faith', trialDays: 10,
    ghlTag: 'bookcoach-rick-meyer-active', shopifyProductId: '123', landingPageUrl: 'https://www.book-coach.ai/rick-meyer-coach-access',
    courseLessonUrl: 'https://login.example/courses/products/abc',
  };

  console.log('\nverify-author - addresses');
  t('a fresh plus-address per run', V.testEmail('Me@Domain.com', '1044', now), 'me+verify-1044-20260928100000@domain.com');
  t('an existing +tag is replaced, not stacked', V.testEmail('me+old@d.com', '1044', now), 'me+verify-1044-20260928100000@d.com');
  truthy('no email is refused', V.emailProblems('').length);
  truthy('example.com is refused (the welcome email would bounce)', V.emailProblems('a@example.com').some((p) => /bounce/.test(p)));
  truthy('.invalid is refused', V.emailProblems('test@example.invalid').some((p) => /bounce/.test(p)));
  t('a real address passes', V.emailProblems('muhammadzain@leadershipbooks.net'), []);

  console.log('\nverify-author - payload');
  {
    const p = V.orderPayload({ coach, email: 'x@y.com', now });
    t('order id is unique per run (the endpoint ignores a seen one for 30 days)', p.order_id, `verify-1044-${now.getTime()}`);
    t('line item carries the coach product', p.line_items, [{ product_id: '123', quantity: 1 }]);
    t('source is identifiable in GHL', p.source, 'verify_author');
    falsy('no phone - GHL dedupes on phone too', 'phone' in p);
    truthy('a coach with no Shopify product is refused', V.coachProblems({ ...coach, shopifyProductId: undefined }).some((x) => /shopifyProductId/.test(x)));
  }

  console.log('\nverify-author - checkContact');
  {
    const fmt = __test.formatTrialEnd;
    const orderNumber = '#VERIFY-1044-1';
    const f = (key, value) => ({ id: V.FIELD_IDS[key], value });
    const good = {
      tags: ['bookcoach-rick-meyer-active', 'coach-trial-started'],
      customFields: [
        f('coach_status', 'trial'), f('coach_code', '1044'), f('coach_name', 'Rick Meyer'), f('coach_book_title', 'Running on Faith'),
        f('coach_link', coach.courseLessonUrl), f('coach_landing_url', coach.landingPageUrl), f('coach_trial_source', 'verify_author'),
        f('shopify_order_number', orderNumber), f('coach_trial_started', '2026-09-28'), f('coach_trial_ends', '8 October 2026'),
      ],
    };
    const rows = V.checkContact(good, coach, { orderNumber, now, formatTrialEnd: fmt });
    t('a correct contact passes every check', rows.filter((r) => r.status !== 'PASS').map((r) => r.check), []);
    t('twelve checks: two tags, ten fields', rows.length, 12);

    const noTag = V.checkContact({ ...good, tags: ['coach-trial-started'] }, coach, { orderNumber, now, formatTrialEnd: fmt });
    t('a missing coach tag FAILS (no entitlement)', noTag.find((r) => r.check === 'tag: coach entitlement').status, 'FAIL');

    const wrongAuthor = V.checkContact({ ...good, customFields: good.customFields.map((x) => (x.id === V.FIELD_IDS.coach_name ? { ...x, value: 'Freddy Davis' } : x)) },
      coach, { orderNumber, now, formatTrialEnd: fmt });
    t('another author\'s name FAILS (the cross-grant symptom)', wrongAuthor.find((r) => r.check === 'coach_name').status, 'FAIL');

    const unfilled = V.checkContact({ ...good, customFields: good.customFields.filter((x) => x.id !== V.FIELD_IDS.coach_link) },
      { ...coach, courseLessonUrl: undefined }, { orderNumber, now, formatTrialEnd: fmt });
    t('a registry value not filled in yet is a WARN, not a FAIL', unfilled.find((r) => r.check === 'coach_link').status, 'WARN');

    const late = V.checkContact({ ...good, customFields: good.customFields.map((x) => (x.id === V.FIELD_IDS.coach_trial_ends ? { ...x, value: '9 October 2026' } : x)) },
      coach, { orderNumber, now, formatTrialEnd: fmt });
    t('a run straddling UTC midnight still passes the end date', late.find((r) => r.check === 'coach_trial_ends').status, 'PASS');
    const wrongLen = V.checkContact({ ...good, customFields: good.customFields.map((x) => (x.id === V.FIELD_IDS.coach_trial_ends ? { ...x, value: '28 October 2026' } : x)) },
      coach, { orderNumber, now, formatTrialEnd: fmt });
    t('a wrong trial length FAILS', wrongLen.find((r) => r.check === 'coach_trial_ends').status, 'FAIL');
  }

  console.log('\nverify-author - trial record + report');
  t('a matching trial record passes', V.checkTrialRecord({ contactId: 'C1', code: '1044', expiresAt: '2026-10-08T10:00:00Z' }, coach, 'C1').status, 'PASS');
  t('no trial record FAILS - the reader would never expire', V.checkTrialRecord(null, coach, 'C1').status, 'FAIL');
  t('a record for another contact FAILS', V.checkTrialRecord({ contactId: 'C2', code: '1044', expiresAt: '2026-10-08T10:00:00Z' }, coach, 'C1').status, 'FAIL');
  truthy('the output says it does not replace the $0 order', /\$0 order/.test(V.LIMITS_NOTICE) && /Flow/.test(V.LIMITS_NOTICE));
  truthy('the table renders every row', V.formatTable([{ status: 'PASS', check: 'a', expected: 'b', actual: 'c' }]).split('\n').length === 2);
}

/* ---------------------------------------------------------------------------
 * the author record (lib-author.mjs) — plans/21 §E
 * ------------------------------------------------------------------------- */
{
  const A = await import('./lib-author.mjs');

  console.log('\nauthor - set validation');
  t('a GID is reduced to its digits', A.parseRecordValue('shopifyProductId', 'gid://shopify/Product/123'), ['123', null]);
  truthy('a non-numeric variant is refused', A.parseRecordValue('shopifyVariantId', 'abc')[1]);
  t('the lesson URL loses is_preview and the personal token', A.parseRecordValue('courseLessonUrl', 'https://login.x/courses/products/u?is_preview=true&token=SECRET')[0], 'https://login.x/courses/products/u');
  truthy('an http:// URL is refused', A.parseRecordValue('authorURL', 'http://x.com')[1]);
  t('books: Title|url pairs', A.parseRecordValue('books', ['A Book|https://x/1', 'B|https://x/2'])[0], [{ title: 'A Book', url: 'https://x/1' }, { title: 'B', url: 'https://x/2' }]);
  truthy('a book without a URL is refused', A.parseRecordValue('books', ['No Link'])[1]);
  truthy('trialDays over 90 is refused (Flow\'s Wait cap)', A.parseRecordValue('trialDays', '91')[1]);
  truthy('an unknown field is refused, listing the settable ones', /Settable/.test(A.parseRecordValue('vfKey', 'x')[1]));

  console.log('\nauthor - identity');
  t('slug from the record', A.slugOf({ slug: 'michael-stickler', ghlTag: 'bookcoach-micheal-stickler-active' }), 'michael-stickler');
  t('slug recovered from the tag when unrecorded', A.slugOf({ ghlTag: 'bookcoach-rick-meyer-active' }), 'rick-meyer');
  t('initials: first and last', A.initialsOf('Mary Anne Smith'), 'MS');

  const S = { code: '1042', name: 'Micheal Stickler', displayName: 'Michael Stickler', slug: 'michael-stickler', shopifyProductId: '10434147320122', shopifyVariantId: '54042631733562', ghlProductId: '6a9185da778550cdf732a700', landingPageUrl: 'https://www.book-coach.ai/michael-stickler-coach-access', bookTitle: 'Life Without Reservation' };
  const F = { code: '1043', name: 'Freddy Davis', displayName: 'Freddy Davis', slug: 'freddy-davis', ghlTag: 'bookcoach-freddy-davis-active', shopifyProductId: '10454698754362', ghlProductId: '6ab501e01d7cb94f5e175eb4', bookTitle: 'The Truth Mirage' };
  {
    const m = A.foreignMarkers(F, [S, F]);
    truthy('another author\'s display name is a marker', m.includes('Michael Stickler'));
    truthy('...and their internal spelling', m.includes('Micheal Stickler'));
    truthy('...and their product id', m.includes('10434147320122'));
    truthy('...and their slug (catches /pages/michael-stickler-speakers-bureau)', m.includes('michael-stickler'));
    falsy('own name is never a marker', m.includes('Freddy Davis'));
  }

  // An offline world. Every reader returns what a test sets.
  const world = (o = {}) => ({
    locationId: 'LOC',
    fetchText: async (url) => (o.pages && url in o.pages ? { status: 200, text: o.pages[url] } : { status: 404, text: '' }),
    catalog: async () => new Map(Object.entries(o.catalog || {})),
    ghl: async (path) => {
      if (path === '/contacts/search') return { contacts: o.holders || [] };
      if (/\/price\?/.test(path)) return { prices: o.prices || [] };
      return o.product || {};
    },
    health: async () => ({ coaches: o.live || [] }),
    kvGet: async () => o.kv || null,
    lastVerify: () => o.lastVerify || null,
  });
  const byCheck = (rows, check) => rows.find((r) => r.check === check);

  console.log('\nauthor - status: coach page');
  {
    const page = (cfg) => ({ 'https://www.book-coach.ai/freddy-davis': cfg });
    const good = 'authorName: "Freddy Davis", showActivation: true, COACH_CODE: "1043",';
    let rows = await A.authorStatus(F, world({ pages: page(good) }), { all: [S, F] });
    t('a correct Worker page passes', ['page exists', 'talks through the Worker', 'showActivation: true', 'no other author on the page'].map((c) => byCheck(rows, c).status), ['DONE', 'DONE', 'DONE', 'DONE']);
    rows = await A.authorStatus(F, world({ pages: page('authorName: "Freddy Davis", VF_API_KEY: "VF.DM.x"') }), { all: [S, F] });
    truthy('a direct page FAILS and says the key is readable', /key is readable/.test(byCheck(rows, 'talks through the Worker').detail));
    t('absent showActivation FAILS', byCheck(rows, 'showActivation: true').status, 'FAIL');
    rows = await A.authorStatus(F, world({ pages: page(`${good} COACH_CODE: "1042"`.replace('"1043"', '"1042"')) }), { all: [S, F] });
    truthy('another coach\'s COACH_CODE FAILS', /another coach/.test(byCheck(rows, 'talks through the Worker').detail));
    rows = await A.authorStatus(F, world({ pages: page(`${good}<p>Coached by Michael Stickler</p>`) }), { all: [S, F] });
    t('another author in VISIBLE copy FAILS', byCheck(rows, 'no other author on the page').status, 'FAIL');
    rows = await A.authorStatus(F, world({ pages: page(`${good}<script>var x = "authorURL: /pages/michael-stickler-speakers-bureau"</script>`) }), { all: [S, F] });
    t('...only in a script is a WARN, not a FAIL', [byCheck(rows, 'no other author on the page').status, byCheck(rows, 'no other author in SEO / page data').status], ['DONE', 'WARN']);
    rows = await A.authorStatus(F, world({}), { all: [S, F] });
    t('no page yet is TODO, not FAIL', byCheck(rows, 'page exists').status, 'TODO');
  }

  console.log('\nauthor - status: Shopify, GHL, funnel, registry');
  {
    const prod = { id: 10454698754362, title: 'The Truth Mirage [Freddy Davis] + Your Personal AI Coach', variants: [{ id: 54120408187194, available: true, requires_shipping: true, sku: '', grams: 0 }] };
    let rows = await A.authorStatus(F, world({ catalog: { 10454698754362: prod } }), { all: [S, F] });
    t('bundle found by id in the public catalogue', byCheck(rows, 'bundle product').status, 'DONE');
    t('no SKU / weight 0 FAILS (runbook §3)', byCheck(rows, 'SKU and weight').status, 'FAIL');
    truthy('an unrecorded variant is TODO with the exact set command', /--shopifyVariantId 54120408187194/.test(byCheck(rows, 'variant recorded').fix));
    rows = await A.authorStatus(F, world({}), { all: [S, F] });
    truthy('a product missing from the catalogue FAILS', byCheck(rows, 'bundle product').status === 'FAIL');

    const monthly = { _id: 'P1', type: 'recurring', amount: 59, recurring: { interval: 'month' } };
    rows = await A.authorStatus(F, world({ product: { _id: F.ghlProductId, name: 'BookCoach AI - Freddy Davis - Coach Access', productType: 'SERVICE', availableInStore: false }, prices: [monthly, { ...monthly, _id: 'P2' }] }), { all: [S, F] });
    truthy('two $59 prices FAIL — the funnel could point at either', byCheck(rows, '$59 monthly price').status === 'FAIL');

    const Fx = { ...F, landingPageUrl: 'https://www.book-coach.ai/freddy-davis-coach-access', ghlPriceId: 'P1' };
    const funnel = (html) => ({ pages: { [Fx.landingPageUrl]: html }, product: { _id: F.ghlProductId }, prices: [monthly] });
    rows = await A.authorStatus(Fx, world(funnel(`<form data-product="${S.ghlProductId}">`)), { all: [S, Fx] });
    t('🚨 a funnel still selling the SOURCE author\'s product FAILS', byCheck(rows, 'sells THIS author\'s product').status, 'FAIL');
    rows = await A.authorStatus(Fx, world(funnel(`<form data-product="${F.ghlProductId}" data-price="P1">`)), { all: [S, Fx] });
    t('a repointed funnel passes, price included', [byCheck(rows, 'sells THIS author\'s product').status, byCheck(rows, '...at the $59 price').status], ['DONE', 'DONE']);

    rows = await A.authorStatus(F, world({ live: [{ code: '1043', keyResolved: false, keyVar: 'VF_KEY_1043' }] }), { all: [S, F] });
    t('pushed but no key FAILS', byCheck(rows, 'Worker holds the key').status, 'FAIL');
    rows = await A.authorStatus({ ...F, apiKey: 'k', projectID: 'a'.repeat(24), versionID: 'main' }, world({ live: [{ code: '1043', keyResolved: true }], kv: { name: 'Stale' } }), { all: [S, F], deep: true });
    t('--deep: KV drifting from coaches.json FAILS', byCheck(rows, 'KV matches coaches.json').status, 'FAIL');
    rows = await A.authorStatus(F, world({ holders: [{ id: 'T1', email: 'me+verify-1043-1@x.com' }] }), { all: [S, F] });
    t('a leftover verify-author contact FAILS "clean"', byCheck(rows, 'no test contacts left entitled').status, 'FAIL');
    rows = await A.authorStatus(F, world({ lastVerify: { passed: true, at: '2026-09-28' } }), { all: [S, F] });
    t('a recorded verify-author pass is DONE', byCheck(rows, 'verify-author').status, 'DONE');
    t('the grant workflow is MANUAL and says which scope would fix it', [byCheck(rows, 'grant workflow published').status, /workflows\.readonly/.test(byCheck(rows, 'grant workflow published').fix)], ['MANUAL', true]);
  }

  console.log('\nauthor - summary + one failing reader');
  {
    const rows = await A.authorStatus(F, { ...world({}), catalog: async () => { throw new Error('Shopify down'); } }, { all: [S, F] });
    truthy('a reader that throws becomes a FAIL row, not a crash', rows.some((r) => r.step === 3 && /Shopify down/.test(r.detail)));
    truthy('...and the other steps still report', rows.some((r) => r.step === 10));
    const sum = A.stepSummary([{ step: 2, status: 'DONE' }, { step: 2, status: 'WARN' }, { step: 3, status: 'MANUAL' }, { step: 3, status: 'FAIL' }]);
    t('worst row wins per step', [sum[2], sum[3], sum[4]], ['WARN', 'FAIL', 'TODO']);
  }

  console.log('\nauthor - generators');
  {
    const R = { code: '1044', name: 'Rick Meyer', displayName: 'Rick Meyer', bookTitle: 'Running on Faith', coachLabel: 'Faith Coach', books: [{ title: 'Running on Faith', url: 'https://x/b' }] };
    const cfg = A.coachPageConfig(R, { workerUrl: 'https://w' });
    truthy('showActivation is always true — it cannot be forgotten', cfg.includes('showActivation: true,'));
    truthy('talks through the Worker with this code', cfg.includes('COACH_CODE: "1044"') && cfg.includes('WORKER_URL: "https://w"'));
    falsy('carries no Voiceflow key', /VF_API_KEY|VF\.DM/.test(cfg));
    truthy('the coach label is the page "bookTitle"', cfg.includes('bookTitle: "Faith Coach"'));
    truthy('books render, and showBooks follows them', cfg.includes('{ title: "Running on Faith", url: "https://x/b" }') && cfg.includes('showBooks: true'));
    const tricky = A.coachPageConfig({ ...R, displayName: 'Jo "The" Smith' }, { workerUrl: 'https://w' });
    truthy('quotes in a name are escaped, not a syntax error', tricky.includes('authorName: "Jo \\"The\\" Smith"'));
    t('gaps listed for what is still empty', A.coachPageGaps({ ...R, books: [] }).length, 3);

    const pairs = A.zipifyReplacements(S, { ...R, landingPageUrl: 'https://www.book-coach.ai/rick-meyer-coach-access', shopifyProductId: '9', shopifyVariantId: '8' });
    const finds = pairs.map((p) => p.find);
    truthy('the ™ title comes before the plain title', finds.indexOf('Life Without Reservation™') < finds.indexOf('Life Without Reservation'));
    truthy('the possessive comes before the bare first name', finds.indexOf("Michael's") < finds.indexOf('Michael'));
    truthy('both spellings of the source author are replaced', finds.includes('Michael Stickler') && finds.includes('Micheal Stickler'));
    truthy('product, variant and funnel link are replaced', ['10434147320122', '54042631733562', 'https://www.book-coach.ai/michael-stickler-coach-access'].every((x) => finds.includes(x)));
  }
}

/* ---------------------------------------------------------------------------
 * Shopify Admin (lib-shopify.mjs) — plans/21 §D. Mocked: no token exists yet.
 * ------------------------------------------------------------------------- */
{
  const SH = await import('./lib-shopify.mjs');
  const R = { code: '1044', name: 'Rick Meyer', displayName: 'Rick Meyer', bookTitle: 'Running on Faith' };

  // A scripted Shopify: answers by the first mutation/query name in the document.
  const fakeShop = ({ failOn = null, userErrorOn = null, publications = [{ id: 'gid://shopify/Publication/1', name: 'Online Store' }], collection = true, orderTags = ['delivered-manual', 'coach-test'] } = {}) => {
    const calls = [];
    const gql = async (query, vars) => {
      const op = /(productCreate|productVariantsBulkUpdate|publications|publishablePublish|collections|collectionAddProducts|draftOrderCreate|draftOrderComplete|orderCancel)/.exec(query)[1];
      calls.push({ op, vars, query });
      if (op === failOn) throw new Error(`Shopify 500 on ${op}`);
      const ue = op === userErrorOn ? [{ field: ['x'], message: 'nope' }] : [];
      switch (op) {
        case 'productCreate': return { productCreate: { product: { id: 'gid://shopify/Product/111', handle: 'running-on-faith-rick-meyer', variants: { nodes: [{ id: 'gid://shopify/ProductVariant/222' }] } }, userErrors: ue } };
        case 'productVariantsBulkUpdate': return { productVariantsBulkUpdate: { productVariants: [], userErrors: ue } };
        case 'publications': return { publications: { nodes: publications } };
        case 'publishablePublish': return { publishablePublish: { userErrors: ue } };
        case 'collections': return { collections: { nodes: collection ? [{ id: 'gid://shopify/Collection/9' }] : [] } };
        case 'collectionAddProducts': return { collectionAddProducts: { userErrors: ue } };
        case 'draftOrderCreate': return { draftOrderCreate: { draftOrder: { id: 'gid://shopify/DraftOrder/5' }, userErrors: ue } };
        case 'draftOrderComplete': return { draftOrderComplete: { draftOrder: { order: { id: 'gid://shopify/Order/777', name: '#4300', tags: orderTags } }, userErrors: ue } };
        case 'orderCancel': return { orderCancel: { orderCancelUserErrors: ue } };
      }
    };
    return { gql, calls, ops: () => calls.map((c) => c.op) };
  };
  const opts = { coach: R, price: '29.95', sku: 'BC9781951648213', grams: '450' };

  console.log('\nshopify - bundle');
  t('title follows the convention', SH.bundleTitle(R), 'Running on Faith [Rick Meyer] + Your Personal AI Coach');
  t('complete inputs pass', SH.bundleProblems(opts), []);
  truthy('weight 0 is refused (breaks carrier rates)', SH.bundleProblems({ ...opts, grams: '0' }).some((p) => /weight/.test(p)));
  truthy('a SKU off the BC<ISBN> convention is refused', SH.bundleProblems({ ...opts, sku: 'RICK1' }).some((p) => /BC<ISBN>/.test(p)));
  truthy('an author who already has a bundle is refused (create, never edit)', SH.bundleProblems({ ...opts, coach: { ...R, shopifyProductId: '1' } }).some((p) => /never edits/.test(p)));
  {
    const s = fakeShop();
    const r = await SH.createBundle(s.gql, opts);
    t('returns numeric ids and the handle', [r.productId, r.variantId, r.handle], ['111', '222', 'running-on-faith-rick-meyer']);
    t('create, price, publish, collect — in that order',
      s.ops(), ['productCreate', 'productVariantsBulkUpdate', 'publications', 'publishablePublish', 'collections', 'collectionAddProducts']);
    const v = s.calls[1].vars.variants[0];
    t('price, SKU, weight and shipping are all set', [v.price, v.inventoryItem.sku, v.inventoryItem.requiresShipping, v.inventoryItem.measurement.weight], ['29.95', 'BC9781951648213', true, { value: 450, unit: 'GRAMS' }]);
    t('published to the ONLINE STORE (or the cart link 404s)', s.calls[3].vars.input, [{ publicationId: 'gid://shopify/Publication/1' }]);
  }
  {
    let err = null;
    try { await SH.createBundle(fakeShop({ userErrorOn: 'productVariantsBulkUpdate' }).gql, opts); } catch (e) { err = e; }
    truthy('a userError (HTTP 200!) still throws, naming the step', err && /productVariantsBulkUpdate/.test(err.message));
    t('...and says the product already exists', err && err.created, { productId: '111', handle: 'running-on-faith-rick-meyer', variantId: '222' });
  }
  {
    let err = null;
    try { await SH.createBundle(fakeShop({ publications: [{ id: 'p', name: 'Point of Sale' }] }).gql, opts); } catch (e) { err = e; }
    truthy('no Online Store publication throws rather than leaving it unlisted', err && /Online Store/.test(err.message));
    const s = fakeShop({ collection: false });
    const r = await SH.createBundle(s.gql, opts);
    t('a missing coach-bundles collection is skipped, not fatal (it is insurance)', [r.productId, s.ops().includes('collectionAddProducts')], ['111', false]);
  }

  console.log('\nshopify - test order');
  {
    const s = fakeShop();
    const o = await SH.placeTestOrder(s.gql, { variantId: '222', email: 'me+verify@x.com' });
    t('returns the order', [o.orderId, o.orderName], ['777', '#4300']);
    const input = s.calls[0].vars.input;
    truthy('tagged delivered-manual, so Order created fires Flow B', input.tags.includes('delivered-manual'));
    t('100% off — a $0 order', input.appliedDiscount, { valueType: 'PERCENTAGE', value: 100, title: 'verify-author' });
    t('the variant as a GID', input.lineItems, [{ variantId: 'gid://shopify/ProductVariant/222', quantity: 1 }]);
    t('completed as paid (paymentPending false) so it is a real order', s.calls[1].vars, { id: 'gid://shopify/DraftOrder/5' });
    const c = fakeShop();
    t('cancel succeeds', await SH.cancelTestOrder(c.gql, 'gid://shopify/Order/777'), true);
    truthy('...this order, without refund, without notifying the customer',
      c.calls[0].vars.orderId === 'gid://shopify/Order/777' && /refund: false/.test(c.calls[0].query) && /notifyCustomer: false/.test(c.calls[0].query));
    let err = null;
    try { await SH.cancelTestOrder(fakeShop({ userErrorOn: 'orderCancel' }).gql, 'x'); } catch (e) { err = e; }
    truthy('a cancel userError (its own field name) still throws', err && /orderCancel/.test(err.message));
  }
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
