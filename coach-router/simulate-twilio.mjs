#!/usr/bin/env node
/**
 * simulate-twilio.mjs — send correctly-signed Twilio webhooks to the deployed
 * Worker, so the SMS and voice flows can be tested without a real phone, a real
 * text, or A2P approval.
 *
 *   node simulate-twilio.mjs sms  --body "1042"
 *   node simulate-twilio.mjs sms  --body "hello"  --from "+18885550100"
 *   node simulate-twilio.mjs voice
 *   node simulate-twilio.mjs voice-route --digits 1042
 *   node simulate-twilio.mjs sms  --no-signature      # expect 403
 *   node simulate-twilio.mjs sms  --bad-signature     # expect 403
 *   node simulate-twilio.mjs suite                    # run the standard checks
 *
 * The signature is built exactly as Twilio builds it, and as the Worker checks
 * it (worker section 8):
 *
 *   base64( HMAC-SHA1( authToken, fullRequestUrl + concat(sortedName + value) ) )
 *
 * CAUTION: replies come back as TwiML and are NOT delivered to a phone — except
 * the "text me the link" path, which calls Twilio's REST API and does send a real
 * message. Don't drive the simulator down that path with a real phone number.
 *
 * Sessions created here are real KV entries keyed by the --from number. Use the
 * default obviously-fake number and clean up with --clear-session when done.
 */

import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { loadConfig, HERE } from './lib-config.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0] || 'suite';
const has = (f) => argv.includes(f);
const valOf = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const { shared } = loadConfig();
const BASE = (valOf('--base', shared.workerUrl) || '').replace(/\/+$/, '');
const TOKEN = shared.twilioAuthToken || '';
const SID = shared.twilioAccountSid || '';
const TO = shared.publicTwilioNumber || '+10000000000';
// Obviously synthetic, so a stray session is recognisable in KV.
const FROM = valOf('--from', '+18885550100');

if (!BASE) {
  console.error('\nNo Worker URL. Add "workerUrl" to the shared block of coaches.json, or pass --base.\n');
  process.exit(1);
}
if (!TOKEN || !SID) {
  console.error('\nNeed twilioAccountSid and twilioAuthToken in coaches.json to sign requests.\n');
  process.exit(1);
}

/** Twilio's signature: HMAC-SHA1 over the URL plus each sorted name+value. */
function sign(url, params) {
  let payload = url;
  for (const k of Object.keys(params).sort()) payload += k + params[k];
  return createHmac('sha1', TOKEN).update(payload, 'utf8').digest('base64');
}

async function post(path, params, { noSignature = false, badSignature = false } = {}) {
  const url = `${BASE}${path}`;
  const headers = { 'content-type': 'application/x-www-form-urlencoded' };
  if (!noSignature) headers['X-Twilio-Signature'] = badSignature ? 'AAAAinvalidsignatureAAAA=' : sign(url, params);

  const res = await fetch(url, { method: 'POST', headers, body: new URLSearchParams(params).toString() });
  return { status: res.status, body: await res.text() };
}

const smsParams = (body) => ({
  AccountSid: SID,
  MessageSid: 'SM' + '0'.repeat(30) + '01',
  From: FROM,
  To: TO,
  Body: body,
  NumMedia: '0',
});

const voiceParams = (extra = {}) => ({
  AccountSid: SID,
  CallSid: 'CA' + '0'.repeat(30) + '01',
  From: FROM,
  To: TO,
  Direction: 'inbound',
  CallStatus: 'ringing',
  ...extra,
});

/** TwiML is verbose; show the parts that carry the actual behaviour. */
function summarise(body) {
  const out = [];
  for (const m of body.matchAll(/<(Message|Say|Play|Redirect|Hangup|Dial|Gather)([^>]*)>([\s\S]*?)<\/\1>|<(Hangup|Redirect)\s*\/>/g)) {
    const tag = m[1] || m[4];
    const inner = (m[3] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    out.push(`    <${tag}> ${inner.slice(0, 240)}${inner.length > 240 ? '…' : ''}`);
  }
  if (!out.length) out.push(`    (no TwiML verbs) ${body.slice(0, 200).replace(/\s+/g, ' ')}`);
  return out.join('\n');
}

// The Worker answers a failed /twilio/* request with 200 and apologetic TwiML,
// deliberately, so a caller never hears Twilio's own error. That means a status
// check alone cannot tell a working reply from a crash — so look for the
// apology too, or a thrown exception passes for a pass.
const CRASHED = /something went wrong on our end/i;

function report(label, { status, body }, expect) {
  let pass = expect === undefined ? null : (typeof expect === 'number' ? status === expect : expect(status, body));
  let note = '';
  if (pass !== false && CRASHED.test(body)) {
    pass = false;
    note = '  <- the Worker returned its catch-all error, so something threw';
  }
  const mark = pass === null ? '   ' : pass ? 'ok ' : 'FAIL';
  console.log(`${mark} ${label}  [HTTP ${status}]${note}`);
  if (body.trim()) console.log(summarise(body));
  console.log('');
  return pass !== false;
}

/**
 * Delete the simulated session so a run starts from "unknown sender".
 * Non-fatal: if the key isn't there, or wrangler declines, the suite continues —
 * losing a clean slate is worth reporting, not worth aborting over.
 */
function clearSession() {
  const key = `sess:sms:${FROM}`;
  try {
    execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['wrangler', 'kv', 'key', 'delete', key, '--binding=COACH_KV', '--remote', '--preview=false'],
      { cwd: HERE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
    console.log(`cleared ${key}\n`);
  } catch {
    console.log(`(no existing session at ${key})\n`);
  }
}

console.log(`\nTarget: ${BASE}`);
console.log(`Simulated caller: ${FROM}  ->  ${TO}\n`);

let failures = 0;
const check = (...a) => { if (!report(...a)) failures++; };

if (cmd === 'sms') {
  const body = valOf('--body', 'hello');
  check(`SMS "${body}"`, await post('/twilio/sms', smsParams(body), {
    noSignature: has('--no-signature'), badSignature: has('--bad-signature'),
  }));
} else if (cmd === 'voice') {
  check('inbound call', await post('/twilio/voice', voiceParams()));
} else if (cmd === 'voice-route') {
  const digits = valOf('--digits', '');
  const speech = valOf('--speech', '');
  check(`code entry digits="${digits}" speech="${speech}"`,
    await post('/twilio/voice/route', voiceParams({ Digits: digits, SpeechResult: speech })));
} else if (cmd === 'voice-turn') {
  check(`turn speech="${valOf('--speech', 'how do I delegate better')}"`,
    await post('/twilio/voice/turn', voiceParams({ SpeechResult: valOf('--speech', 'how do I delegate better') })));
} else if (cmd === 'voice-wait') {
  check(`wait poll n=${valOf('--n', '1')}`,
    await post(`/twilio/voice/wait?n=${valOf('--n', '1')}`, voiceParams()));
} else if (cmd === 'voice-convo') {
  // Follow <Redirect> exactly as Twilio does, honouring <Pause length>, so a
  // slow reply that gets parked and collected is exercised end to end.
  let path = '/twilio/voice/turn';
  let params = voiceParams({ SpeechResult: valOf('--speech', 'how do I delegate better') });
  for (let hop = 1; hop <= 10; hop++) {
    const t0 = Date.now();
    const res = await post(path, params);
    console.log(`hop ${hop}: POST ${path}  [HTTP ${res.status}, ${Date.now() - t0}ms]`);
    console.log(summarise(res.body));
    if (res.status !== 200) { failures++; break; }
    if (/<Gather/.test(res.body)) { console.log('reached a Gather — the caller would now speak again.\n'); break; }
    const redirect = /<Redirect[^>]*>([^<]+)<\/Redirect>/.exec(res.body);
    if (!redirect) { console.log('no redirect and no gather — end of flow.\n'); break; }
    const pause = /<Pause length="(\d+)"/.exec(res.body);
    if (pause) await new Promise((r) => setTimeout(r, Number(pause[1]) * 1000));
    path = redirect[1].trim();
    params = voiceParams(); // a redirect carries no speech
    console.log('');
  }
} else if (cmd === 'clear-session') {
  clearSession();
} else if (cmd === 'suite') {
  console.log('--- signature validation -------------------------------------\n');
  check('no signature must be rejected', await post('/twilio/sms', smsParams('hi'), { noSignature: true }), 403);
  check('bad signature must be rejected', await post('/twilio/sms', smsParams('hi'), { badSignature: true }), 403);

  console.log('--- SMS flow -------------------------------------------------\n');
  clearSession();
  // Must hold in EVERY entitlement mode: an unrecognised sender is never shown
  // who the coaches are. This is the check that would catch the menu coming back.
  const noLeak = (status, body) =>
    status === 200 && !/Micheal|Stickler|1042/i.test(body);
  check('an unrecognised sender is given no coach list', await post('/twilio/sms', smsParams('hello')), noLeak);

  // These depend on the live entitlementMode: in "enforce" an unbound number is
  // refused, which is the point, so they are only meaningful in off/warn.
  check('a coaching turn', await post('/twilio/sms', smsParams('I am struggling to delegate.')), 200);
  check('RESET restarts with the same coach', await post('/twilio/sms', smsParams('RESET')), 200);
  check('HELP names only their own coach', await post('/twilio/sms', smsParams('HELP')),
    (status, body) => status === 200 && !/1042/.test(body));
  check('STOP replies with nothing', await post('/twilio/sms', smsParams('STOP')), 200);

  console.log('--- voice flow -----------------------------------------------\n');
  check('inbound call greeting + gather', await post('/twilio/voice', voiceParams()), 200);
  check('wrong code re-prompts, does not hang up',
    await post('/twilio/voice/route', voiceParams({ Digits: '9999' })), 200);
  check('a failed voice attempt never reads the coach list aloud',
    await post('/twilio/voice/route', voiceParams({ Digits: '9999' }) , {}),
    (status, body) => status === 200 && !/Micheal|Stickler/i.test(body));
  check('correct code connects',
    await post('/twilio/voice/route', voiceParams({ Digits: '1042' })), 200);
  check('spoken name routes',
    await post('/twilio/voice/route', voiceParams({ SpeechResult: 'Mike Stickler' })), 200);

  clearSession();
  console.log(failures ? `${failures} check(s) FAILED\n` : 'all checks passed\n');
} else {
  console.error(`Unknown command "${cmd}". See the header of this file.\n`);
  process.exit(1);
}

process.exitCode = failures ? 1 : 0;
