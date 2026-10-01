/**
 * coach-router.worker.js
 * ---------------------------------------------------------------------------
 * Leadership Books — multi-tenant Book Coach AI router.
 *
 * One Cloudflare Worker is the front door for all three channels:
 *   web  -> POST /api/vf-interact      (raw Voiceflow trace array, page renders cards)
 *   web  -> POST /api/heygen-token     (HeyGen streaming token, per coach)
 *   sms  -> POST /twilio/sms
 *   call -> POST /twilio/voice, /twilio/voice/route, /twilio/voice/turn,
 *                /twilio/voice/wait  (collects a reply slower than Twilio's 15s)
 *   ops  -> GET  /health
 *
 * This Worker replaces the per-coach proxy Workers.
 *
 * Coach registry lives in KV (`coach:<CODE>`) so a coach can be added without a
 * redeploy. API keys NEVER live in KV — the registry only names the Worker
 * secret that holds the key (`keyVar`).
 *
 * Sessions live in KV (`sess:<channel>:<phone>`), 12h sliding TTL.
 * Voiceflow userID is `phone:<E.164>` on both SMS and voice so a subscriber who
 * texts and then calls continues the same Voiceflow state. With sharedMemory on
 * (config or per coach) a linked handset uses `ghl_<contactId>` instead — the
 * web coach page's ID — so web, SMS and voice are one conversation.
 * ---------------------------------------------------------------------------
 */

/* =========================================================================
 * 1. Constants
 * ========================================================================= */

const VF_RUNTIME = 'https://general-runtime.voiceflow.com';
const HEYGEN_TOKEN_URL = 'https://api.heygen.com/v1/streaming.create_token';

// GoHighLevel (Course360) — read only by the cron reconcile, never on a request.
const GHL_API = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const GHL_PAGE_LIMIT = 100;
const GHL_MAX_PAGES = 200; // runaway guard: 20,000 tagged contacts per run.
// Was 50 (5,000) when the reconcile searched ONE TAG AT A TIME. The combined
// multi-tag search shares one budget across every coach, so the old ceiling
// would have started truncating at a few thousand subscribers spread over a
// handful of authors. Exhausting it now throws rather than truncating.

// Runtime knobs live in the KV key `config` (seeded by seed-coaches.mjs) so they
// can change without a redeploy. These are the values used if that key is
// missing — they must stay in step with CONFIG_DEFAULTS in lib-config.mjs.
const CONFIG_FALLBACK = {
  entitlementMode: 'off',
  leaseHours: 48,
  archiveRetentionDays: 30,
  archiveReminderDays: [15, 5],
  archiveAutoDelete: true,
  staffTag: '',
  declineSms: '',
  declineVoice: '',
  webGateMode: 'off',
  webSessionHours: 2,
  allowTestSubscriptions: true,
  autoLinkGhlPhone: false,
  cronStaleAfterMinutes: 90,
  sharedMemory: 'off',
};
const CONFIG_CACHE_MS = 30 * 1000;

// Write-frugality. Cloudflare's free plan allows 1,000 KV writes a day, so the
// reconcile must not write on every run for every subscriber: at a 15-minute
// cron that would be 96 writes per subscriber per day and the plan would be
// exhausted at roughly three subscribers. Instead a lease is only rewritten
// once it is more than half spent (~1 write/subscriber/day at a 48h lease), and
// syncmeta only when something changed or the heartbeat is stale.
const LEASE_RENEW_FRACTION = 0.5;
const SYNCMETA_HEARTBEAT_MS = 60 * 60 * 1000;
const SYNCMETA_HEARTBEAT_MIN = SYNCMETA_HEARTBEAT_MS / 60000;

// A partial or malformed GHL response must never be able to cut off the whole
// book. Above this count, a run that would revoke a majority refuses instead.
const REVOKE_GUARD_FLOOR = 3;
const REVOKE_GUARD_FRACTION = 0.5;

const SESSION_TTL_SECONDS = 12 * 60 * 60; // 12 hours of inactivity
const REGISTRY_CACHE_MS = 60 * 1000;      // in-isolate registry cache TTL
const SMS_MAX_CHARS = 900;

// Twilio abandons a TwiML webhook at 15s and plays its own error message, which
// ends the call. Answer well inside that, then hold the caller while a slow
// Voiceflow reply finishes in the background.
const VOICE_SOFT_DEADLINE_MS = 8000;
const VOICE_WAIT_MAX_POLLS = 6;           // ~2s per poll before giving up
const VOICE_SLOW = Symbol('voice-reply-too-slow');

// Twilio signature validation applies to every /twilio/* path.
const TWILIO_PREFIX = '/twilio/';

// RESET restarts the conversation with the same coach. There is deliberately
// no MENU/SWITCH/COACHES: with entitlement there is nothing to switch to, and
// those words existed only to print the coach list.
const CMD_RESET = new Set(['RESET', 'RESTART']);
const CMD_STOP = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'QUIT', 'END']);
const CMD_HELP = new Set(['HELP', 'INFO']);

/**
 * Worker-level crisis safety net. This does NOT replace the Crisis Care Guide
 * playbook inside each Voiceflow project — it covers the one gap the playbook
 * cannot reach: a person in crisis who texts or calls BEFORE they have picked a
 * coach, and would otherwise be handed a code menu.
 * Once a coach is pinned, the message is forwarded to Voiceflow as normal and
 * the project's own Crisis Care Guide owns the response.
 */
const CRISIS_PATTERNS = [
  /\bkill (?:myself|me)\b/i,
  /\bkilling myself\b/i,
  /\bsuicid/i,
  /\bend (?:my|it all|my own) life\b/i,
  /\bwant to die\b/i,
  /\bdon'?t want to (?:live|be alive|be here)\b/i,
  /\bhurt(?:ing)? myself\b/i,
  /\bharm(?:ing)? myself\b/i,
  /\bcut(?:ting)? myself\b/i,
  /\bself[- ]harm/i,
  /\boverdose\b/i,
  /\bbeing (?:abused|beaten|hurt)\b/i,
  /\bhe(?:'s| is) (?:hitting|beating) me\b/i,
  /\bshe(?:'s| is) (?:hitting|beating) me\b/i,
  /\bnot safe (?:at home|right now)\b/i,
];

/* =========================================================================
 * 2. Small utilities
 * ========================================================================= */

const enc = new TextEncoder();

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extraHeaders },
  });
}

function twiml(xml, status = 200) {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n${xml}`, {
    status,
    headers: { 'content-type': 'text/xml; charset=utf-8' },
  });
}

function xmlEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** Constant-time-ish string compare, to avoid leaking signature bytes by timing. */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function isE164(n) {
  return typeof n === 'string' && /^\+[1-9]\d{6,14}$/.test(n);
}

function uuid() {
  return crypto.randomUUID();
}

/**
 * Best-effort phone normalisation to E.164, or null.
 *
 * GHL stores whatever was typed into the contact form — "(854) 254-5009",
 * "854.254.5009", "18542545009". The Worker keys entitlement on the E.164 form
 * Twilio delivers, so anything that cannot be reconciled to that is no match.
 * Deliberately conservative: a number we cannot be confident about returns null
 * rather than a guess, because a wrong guess grants one person's access to
 * another's handset.
 */
function normalizePhone(raw, defaultCc = '1') {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;

  const hadPlus = s.startsWith('+');
  const digits = s.replace(/\D/g, '');
  if (!digits) return null;

  // An explicit + means the country code is already there; trust it as given.
  if (hadPlus) return isE164('+' + digits) ? '+' + digits : null;

  // No +. Only the unambiguous North American shapes are accepted: 10 digits
  // (no country code) or 11 beginning with 1. Anything else could be a national
  // number from any country and guessing would be worse than declining.
  let out;
  if (digits.length === 10) out = '+' + defaultCc + digits;
  else if (digits.length === 11 && digits.startsWith('1')) out = '+' + digits;
  else return null;

  return isE164(out) ? out : null;
}

/* =========================================================================
 * 3. Text shaping — markdown stripping, SMS capping, voice sanitising
 * ========================================================================= */

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>()]+|[a-z0-9-]+\.(?:com|org|net|io|co|info|us|app|ai)(?:\/[^\s<>()]*)?/gi;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

/** Remove markdown so SMS reads as plain text. Keeps bare URLs intact. */
function stripMarkdown(text) {
  return String(text || '')
    // [label](url) -> "label: url"  (SMS has no buttons; the URL must survive)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1: $2')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')          // images
    .replace(/^#{1,6}\s*/gm, '')                    // headings
    .replace(/^\s*>\s?/gm, '')                      // blockquotes
    .replace(/(\*\*|__)(.*?)\1/g, '$2')             // bold
    .replace(/(\*|_)(?!\s)(.*?)(?<!\s)\1/g, '$2')   // italics
    .replace(/~~(.*?)~~/g, '$1')                    // strikethrough
    .replace(/`{3}[\s\S]*?`{3}/g, '')               // fenced code
    .replace(/`([^`]+)`/g, '$1')                    // inline code
    .replace(/^\s*[-*+]\s+/gm, '- ')                // bullets -> plain hyphen
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/**
 * Transliterate to the GSM-7 alphabet, because encoding is a billing decision.
 *
 * A single character outside GSM-7 — one em-dash, one curly apostrophe, one
 * emoji — forces the WHOLE message to UCS-2, which cuts the segment size from
 * 153 characters to 67. A 243-character reply then costs 4 segments instead of
 * 2. LLMs emit em-dashes and smart quotes constantly, so a prompt rule asking
 * them not to is not a control; this is.
 *
 * Accented Latin characters (é, ü, à…) ARE in GSM-7 and are deliberately left
 * alone. Anything unmapped and non-ASCII is dropped rather than passed through,
 * since one survivor defeats the whole exercise.
 */
const GSM7_SUBSTITUTIONS = [
  [/[‐-―−]/g, '-'],        // hyphens, en/em dashes, minus
  [/[‘’‚‛′]/g, "'"], // curly single quotes, prime
  [/[“”„‟″]/g, '"'], // curly double quotes
  [/…/g, '...'],                      // ellipsis
  [/[•‣◦·]/g, '-'],    // bullets
  [/→/g, '->'], [/←/g, '<-'],
  [/[     ]/g, ' '], // exotic spaces
  [/™/g, '(tm)'], [/®/g, '(r)'], [/©/g, '(c)'],
  [/½/g, '1/2'], [/¼/g, '1/4'], [/¾/g, '3/4'],
  [/[​-‍﻿]/g, ''],          // zero-width joiners
];

// GSM-7 basic character set plus the extension table.
const GSM7_CHARS =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà' +
  '^{}\\[~]|€\f';

function toGsm7(text) {
  let out = String(text || '');
  for (const [re, rep] of GSM7_SUBSTITUTIONS) out = out.replace(re, rep);

  let kept = '';
  for (const ch of out) {
    if (GSM7_CHARS.includes(ch)) { kept += ch; continue; }

    // A Latin letter carrying a diacritic GSM-7 doesn't have (ï, á, ô, ć…) is
    // folded to its base letter, not dropped: "naive" still reads, whereas
    // dropping the ï gives "nave", which is a different word. Only the handful
    // of accented forms actually in the alphabet (é, ü, à…) survive untouched,
    // and they were already kept above.
    const folded = ch.normalize('NFD').replace(/\p{M}/gu, '');
    if (folded && [...folded].every((c) => GSM7_CHARS.includes(c))) { kept += folded; continue; }

    // Anything left is emoji, CJK, or a symbol with no sensible ASCII form.
  }
  return kept.replace(/[ \t]{2,}/g, ' ').trim();
}

/**
 * Hard cap outbound SMS, breaking on a sentence or word boundary where possible.
 * Transliterates first: the substitutions change the length, and the cap has to
 * apply to what actually goes on the wire.
 */
function capSms(text, max = SMS_MAX_CHARS) {
  const t = toGsm7(text);
  if (t.length <= max) return t;
  const window = t.slice(0, max - 3);
  const sentenceEnd = Math.max(window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '));
  if (sentenceEnd > max * 0.6) return window.slice(0, sentenceEnd + 1).trim();
  const wordEnd = window.lastIndexOf(' ');
  // "..." not "…" — the ellipsis character would itself force UCS-2.
  return (wordEnd > max * 0.6 ? window.slice(0, wordEnd) : window).trim() + '...';
}

/**
 * Make text safe to speak aloud.
 * - Strips URLs and email addresses entirely (never spoken — spec + Klett bug).
 * - Down-cases all-caps words so TTS doesn't spell them out letter by letter.
 * - Returns the stripped links so the caller can be offered a text message.
 */
function sanitizeForSpeech(text) {
  const links = [];
  let out = stripMarkdown(text);

  // Email first: URL_RE's bare-domain branch would otherwise eat the domain half
  // of an address and leave a spoken "at" behind.
  out = out.replace(EMAIL_RE, (m) => { links.push(m); return ''; });
  out = out.replace(URL_RE, (m) => { links.push(m); return ''; });
  out = out.replace(/\S*@\S*/g, ''); // belt and braces: no bare @ ever reaches TTS

  // ALLCAPS -> Titlecase (leave 2-letter words like "AM"/"PM"/"OK" alone).
  out = out.replace(/\b[A-Z]{3,}\b/g, (w) => w.charAt(0) + w.slice(1).toLowerCase());

  out = out
    .replace(/[#*_`~|<>]/g, ' ')
    .replace(/\s*:\s*(?=[.,]|$)/gm, '')  // dangling "Label:" left by a stripped URL
    .replace(/\(\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,!?])/g, '$1')
    .trim();

  return { speech: out, links };
}

/* =========================================================================
 * 4. Voiceflow trace flattening
 * ========================================================================= */

/**
 * Flatten a Voiceflow trace array to plain text for SMS/voice.
 * Cards and buttons degrade to text (label + URL) so the Resource and Referral
 * Concierge keeps working on SMS with no Voiceflow-side change.
 * The web endpoint does NOT use this — it returns raw traces.
 */
function flattenTraces(traces) {
  const parts = [];
  const links = [];

  const pushLink = (label, url) => {
    if (!url) return;
    links.push({ label: label || url, url });
  };

  for (const t of Array.isArray(traces) ? traces : []) {
    const type = t && t.type;
    const p = (t && t.payload) || {};

    if (type === 'text' || type === 'speak') {
      const msg = p.message || slateToText(p.slate);
      if (msg) parts.push(stripMarkdown(msg));
      continue;
    }

    if (type === 'card' || type === 'carousel') {
      const cards = type === 'carousel' ? (p.cards || []) : [p];
      for (const c of cards) {
        const title = c.title || '';
        const desc = c.description?.text || c.description || '';
        if (title || desc) parts.push([title, desc].filter(Boolean).join(' — '));
        for (const b of c.buttons || []) {
          const url = b?.request?.payload?.actions?.find?.((a) => a.type === 'open_url')?.payload?.url
            || b?.request?.payload?.url
            || b?.url;
          pushLink(b?.name || b?.request?.payload?.label, url);
        }
      }
      continue;
    }

    if (type === 'choice') {
      for (const b of p.buttons || []) {
        const url = b?.request?.payload?.actions?.find?.((a) => a.type === 'open_url')?.payload?.url;
        if (url) pushLink(b?.name, url);
      }
      continue;
    }

    if (type === 'visual' && p.image) {
      pushLink('Image', p.image);
    }
  }

  return { text: parts.filter(Boolean).join('\n\n').trim(), links };
}

/** Minimal Voiceflow slate -> text, for projects that emit slate rather than message. */
function slateToText(slate) {
  if (!slate || !Array.isArray(slate.content)) return '';
  const walk = (nodes) => nodes.map((n) => {
    if (typeof n.text === 'string') return n.text;
    if (Array.isArray(n.children)) return walk(n.children);
    return '';
  }).join('');
  return walk(slate.content);
}

/* =========================================================================
 * 5. Coach registry (KV-backed, cached per isolate)
 * ========================================================================= */

let _registryCache = { at: 0, byCode: null };

/**
 * Load every `coach:*` entry from KV into a Map keyed by uppercase code.
 * Cached in-isolate for REGISTRY_CACHE_MS so a turn isn't a KV read.
 */
async function loadRegistry(env, { force = false } = {}) {
  const now = Date.now();
  if (!force && _registryCache.byCode && now - _registryCache.at < REGISTRY_CACHE_MS) {
    return _registryCache.byCode;
  }

  const byCode = new Map();
  let cursor;
  do {
    const page = await env.COACH_KV.list({ prefix: 'coach:', cursor });
    for (const k of page.keys) {
      const code = k.name.slice('coach:'.length).toUpperCase();
      const raw = await env.COACH_KV.get(k.name, 'json');
      if (raw && typeof raw === 'object') byCode.set(code, { code, ...raw });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  _registryCache = { at: now, byCode };
  return byCode;
}

async function getCoach(env, code) {
  if (!code) return null;
  const reg = await loadRegistry(env);
  return reg.get(String(code).trim().toUpperCase()) || null;
}

/**
 * Resolve free text to a coach: exact code, or a case-insensitive alias /
 * display-name match. Used by SMS and by voice speech results.
 */
async function resolveCoach(env, input) {
  if (!input) return null;
  const reg = await loadRegistry(env);
  const raw = String(input).trim();

  const digits = raw.replace(/\D/g, '');
  if (digits && reg.has(digits)) return reg.get(digits);
  if (reg.has(raw.toUpperCase())) return reg.get(raw.toUpperCase());

  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  const needle = norm(raw);
  if (!needle) return null;

  let best = null;
  for (const coach of reg.values()) {
    const candidates = [coach.name, ...(coach.aliases || [])].map(norm).filter(Boolean);
    for (const c of candidates) {
      if (c === needle) return coach;
      // Speech results are noisy ("i'd like doctor smith please") — allow containment,
      // but only for candidates long enough that containment is meaningful.
      if (c.length >= 5 && needle.includes(c)) {
        if (!best || c.length > best.matchLen) best = { coach, matchLen: c.length };
      }
    }
  }
  return best ? best.coach : null;
}

/** Resolve a coach's Voiceflow Dialog API key from Worker secrets via keyVar. */
function coachApiKey(env, coach) {
  if (!coach || !coach.keyVar) return null;
  const v = env[coach.keyVar];
  return typeof v === 'string' && v.length ? v : null;
}

/* =========================================================================
 * 6. Sessions (KV)
 * ========================================================================= */

const sessKey = (channel, phone) => `sess:${channel}:${phone}`;

async function getSession(env, channel, phone) {
  if (!phone) return null;
  return (await env.COACH_KV.get(sessKey(channel, phone), 'json')) || null;
}

async function putSession(env, channel, phone, data) {
  await env.COACH_KV.put(sessKey(channel, phone), JSON.stringify(data), {
    expirationTtl: SESSION_TTL_SECONDS,
  });
}

/**
 * Refresh a session ONLY when it is worth a write.
 *
 * `putSession` was previously called on every inbound turn purely to slide the
 * 12h TTL, writing an almost always identical value. On the free plan KV allows
 * 1,000 writes/day, and this was the dominant consumer — roughly one write per
 * message, i.e. ~50 SMS conversations a day before writes start failing, and
 * they fail hard rather than degrading.
 *
 * This applies the same frugality the entitlement lease already uses: rewrite
 * only when the content actually changed, or when the existing record is more
 * than half its TTL old. A 20-message conversation now costs 1 write instead
 * of 20.
 *
 * TRADE, stated rather than hidden: because a skipped turn does not slide the
 * TTL, a session now expires between SESSION_TTL/2 and SESSION_TTL after the
 * last message, rather than exactly SESSION_TTL after it. The session holds
 * only "which coach, and when" — an expired one costs a coach re-resolution on
 * the next message, which with a single coach is invisible.
 */
const SESSION_REFRESH_AFTER_MS = (SESSION_TTL_SECONDS * 1000) / 2;

async function touchSession(env, channel, phone, data, existing) {
  const stripped = (o) => {
    const c = { ...(o || {}) };
    delete c.touched;
    return JSON.stringify(c);
  };
  const unchanged = existing && stripped(existing) === stripped(data);
  const age = existing && existing.touched
    ? Date.now() - new Date(existing.touched).getTime()
    : Infinity;

  if (unchanged && age < SESSION_REFRESH_AFTER_MS) return false; // cost nothing

  await putSession(env, channel, phone, { ...data, touched: new Date().toISOString() });
  return true;
}

async function clearSession(env, channel, phone) {
  await env.COACH_KV.delete(sessKey(channel, phone));
}

/* =========================================================================
 * 7. Voiceflow Dialog API
 * ========================================================================= */

/**
 * A Voiceflow state URL with the version ID IN THE PATH.
 *
 * Voiceflow stops issuing per-project keys after 16 Nov 2026; the replacement
 * personal key must be told which project to act on, and the version in the
 * path is how. Verified 2026-09-30: today's project keys accept this form too
 * (200 for all three coaches, on both the 24-hex ids and the `main` alias), so
 * the switch is safe before the personal key exists.
 */
function vfStatePath(coach, userID, suffix = '') {
  const version = (coach && coach.versionID) || 'production';
  return `${VF_RUNTIME}/state/${encodeURIComponent(version)}/user/${encodeURIComponent(userID)}${suffix}`;
}

function vfHeaders(apiKey, coach) {
  return {
    Authorization: apiKey,
    'content-type': 'application/json',
    accept: 'application/json',
    versionID: coach.versionID || 'production',
  };
}

/**
 * POST an action to the Voiceflow Dialog API and return the trace array.
 * `userID` is `phone:<E.164>` for SMS/voice, `web:<uuid>` for the web pages.
 */
async function vfInteract(env, coach, userID, action, { config } = {}) {
  const apiKey = coachApiKey(env, coach);
  if (!apiKey) {
    throw new HttpError(500, `Secret ${coach.keyVar || '(keyVar missing)'} is not set for coach ${coach.code}`);
  }

  const res = await fetch(vfStatePath(coach, userID, '/interact'), {
    method: 'POST',
    headers: vfHeaders(apiKey, coach),
    body: JSON.stringify({
      action,
      config: config || { tts: false, stripSSML: true, stopAll: true, excludeTypes: ['block', 'debug', 'flow'] },
    }),
  });

  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 400);
    // "version does not exist" almost always means a draft version ID was used
    // where the environment/published ID belongs, or vice versa.
    throw new HttpError(502, `Voiceflow ${res.status} for coach ${coach.code}: ${detail}`);
  }

  const body = await res.json().catch(() => []);
  return Array.isArray(body) ? body : [];
}

/* -------------------------------------------------------------------------
 * Shared memory across channels (plans/10-shared-memory-across-channels.md)
 *
 * Voiceflow remembers a conversation per userID. The web coach page uses
 * `ghl_<contactId>`; SMS and voice used `phone:<E.164>`, so the same member had
 * two unrelated conversations. With sharedMemory on, a handset linked to a
 * contact uses the web page's ID and the coach continues one conversation.
 *
 * The underscore is deliberate: it is exactly what the web page builds
 * (`'ghl_' + cid`). The Worker's older `ghl:` spelling would be a third,
 * separate conversation.
 * ------------------------------------------------------------------------- */

/** coach.sharedMemory (true/false) wins; otherwise the global config switch. */
function sharedMemoryOn(cfg, coach) {
  if (coach && typeof coach.sharedMemory === 'boolean') return coach.sharedMemory;
  return !!cfg && cfg.sharedMemory === 'on';
}

/**
 * The Voiceflow userID for a handset talking to `coach`. No contactId (mode
 * off/warn, or an unlinked phone) always falls back to `phone:`, so switching
 * the feature on can never merge a stranger into someone's conversation.
 */
function vfUserFor(cfg, coach, phone, contactId) {
  return sharedMemoryOn(cfg, coach) && contactId ? `ghl_${contactId}` : `phone:${phone}`;
}

const isSharedUser = (userID) => typeof userID === 'string' && userID.startsWith('ghl_');

/**
 * True when Voiceflow holds a conversation in progress for this userID — the
 * same test the web page's bootCoach uses (a non-empty `stack`). Called only at
 * conversation start, never per message. Any failure reads as "not live", which
 * falls back to today's behaviour: a fresh launch.
 */
async function vfIsLive(env, coach, userID) {
  const apiKey = coachApiKey(env, coach);
  if (!apiKey) return false;
  try {
    const res = await fetch(vfStatePath(coach, userID), {
      headers: { Authorization: apiKey, versionID: coach.versionID || 'production' },
    });
    if (!res.ok) return false;
    const state = await res.json().catch(() => null);
    return !!(state && Array.isArray(state.stack) && state.stack.length);
  } catch {
    return false;
  }
}

/** Set Voiceflow variables (channel, phone, coach name…) before/independently of a turn. */
async function vfSetVariables(env, coach, userID, variables) {
  if (!variables || !Object.keys(variables).length) return;
  const apiKey = coachApiKey(env, coach);
  if (!apiKey) return;
  await fetch(vfStatePath(coach, userID, '/variables'), {
    method: 'PATCH',
    headers: vfHeaders(apiKey, coach),
    body: JSON.stringify(variables),
  }).catch(() => {});
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/* =========================================================================
 * 8. Twilio request signature validation
 * ========================================================================= */

/**
 * Validate X-Twilio-Signature: base64( HMAC-SHA1( authToken,
 *   fullRequestUrl + concat(sorted paramName + paramValue) ) ).
 * Returns the parsed form params on success; throws HttpError(403) otherwise.
 */
async function validateTwilio(request, env, rawBody) {
  const params = new URLSearchParams(rawBody);

  if (String(env.SKIP_TWILIO_VALIDATION || '') === 'true') {
    // Local testing escape hatch ONLY. wrangler.toml keeps this unset in production
    // and /health reports it, so a bypass left on is visible.
    return params;
  }

  const token = env.TWILIO_AUTH_TOKEN;
  if (!token) throw new HttpError(500, 'TWILIO_AUTH_TOKEN secret is not set');

  const signature = request.headers.get('X-Twilio-Signature');
  if (!signature) throw new HttpError(403, 'Missing X-Twilio-Signature');

  const url = twilioRequestUrl(request, env);

  const keys = [...params.keys()].sort();
  let payload = url;
  for (const k of keys) {
    for (const v of params.getAll(k)) payload += k + v;
  }

  const key = await crypto.subtle.importKey(
    'raw', enc.encode(token), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  const expected = bytesToBase64(new Uint8Array(mac));

  if (!safeEqual(expected, signature)) throw new HttpError(403, 'Twilio signature mismatch');
  return params;
}

/**
 * The URL Twilio signed. Cloudflare gives the right URL in the common case, but
 * if the Worker sits behind a proxy or a custom domain that rewrites host or
 * scheme, set PUBLIC_BASE_URL and we rebuild it — signature failures on
 * /twilio/* are almost always this.
 */
function twilioRequestUrl(request, env) {
  const incoming = new URL(request.url);
  if (!env.PUBLIC_BASE_URL) return incoming.toString();
  const base = new URL(env.PUBLIC_BASE_URL);
  base.pathname = incoming.pathname;
  base.search = incoming.search;
  return base.toString();
}

/* =========================================================================
 * 9. CORS (web endpoints only)
 * ========================================================================= */

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const list = allowedOrigins(env);
  const ok = list.includes('*') || list.includes(origin);
  if (!ok) return null;
  return {
    'Access-Control-Allow-Origin': list.includes('*') ? '*' : origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

/* =========================================================================
 * 10. Crisis safety net
 * ========================================================================= */

function looksLikeCrisis(text) {
  const t = String(text || '');
  return CRISIS_PATTERNS.some((re) => re.test(t));
}

function crisisSmsText(env) {
  return env.CRISIS_SMS_TEXT
    || 'I hear you, and I\'m glad you reached out. I\'m an AI coach, so I\'m not the right help for this moment — but people are standing by right now who are. In the US you can call or text 988 to reach the Suicide and Crisis Lifeline, any hour of any day. If you are in immediate danger, please call 911. You matter, and you do not have to carry this alone.';
}

function crisisSpeechText(env) {
  return env.CRISIS_VOICE_TEXT
    || 'I hear you, and I am glad you called. I am an AI coach, so I am not the right help for this moment, but there are people standing by right now who are. Stay on the line and I will connect you.';
}

/* =========================================================================
 * 11. SMS channel
 * ========================================================================= */

async function handleSms(request, env) {
  const rawBody = await request.text();
  const params = await validateTwilio(request, env, rawBody);

  const from = params.get('From') || '';
  const bodyText = (params.get('Body') || '').trim();
  const upper = bodyText.toUpperCase().replace(/[^\w]/g, '');

  // --- STOP / UNSUBSCRIBE: clear and stay silent. Twilio's own opt-out
  // handling sends the compliance reply; we must not add a second message.
  if (CMD_STOP.has(upper)) {
    await clearSession(env, 'sms', from);
    return twiml('<Response></Response>');
  }

  const reg = await loadRegistry(env);

  // --- Activation code from the members area. After STOP so a code can never
  // shadow a compliance keyword, but before the entitlement gate, because
  // redeeming one is how a person becomes entitled in the first place.
  // Anything that is not a live token falls straight through, so an ordinary
  // six-character message is never mistaken for one.
  const redeemed = await redeemBindToken(env, from, bodyText);
  if (redeemed) {
    const coach = redeemed.codes.length ? reg.get(String(redeemed.codes[0]).toUpperCase()) : null;
    if (coach) {
      const userID = vfUserFor(await loadRuntimeConfig(env), coach, from, redeemed.contactId);
      return startCoachOverSms(env, from, userID, coach);
    }
    return smsReply("You're activated, but I couldn't reach your coach just then. Please send a message in a moment.");
  }

  const decision = await entitlementDecision(env, from, 'sms');

  // --- The crisis net runs BEFORE any refusal. It exists for exactly the
  // person who has no coach yet, and a subscription check must never be the
  // reason someone in trouble is turned away with a marketing line.
  if (!decision.allow && looksLikeCrisis(bodyText)) return smsReply(crisisSmsText(env));
  if (!decision.allow) {
    await clearSession(env, 'sms', from);
    return smsReply(declineSmsText(decision.cfg));
  }

  const codes = decision.entitlement ? decision.entitlement.codes : null;
  // Chosen AFTER the gate: only an entitled, linked handset can ever reach a
  // member's shared conversation. The lease already carries the contactId, so
  // this costs no extra read.
  const contactId = decision.entitlement ? decision.entitlement.contactId : null;
  const userFor = (c) => vfUserFor(decision.cfg, c, from, contactId);

  if (CMD_HELP.has(upper)) {
    const own = codes ? await resolveEntitledCoach(env, '', codes) : null;
    return smsReply(
      own
        ? `You're texting ${own.name}, your Book Coach AI. Reply RESET to start the conversation over, or STOP to opt out.`
        : `You're texting the Book Coach AI line. Reply RESET to start over, or STOP to opt out.`,
    );
  }

  // --- RESET restarts the conversation with the same coach. It no longer means
  // "switch", because there is nothing to switch to.
  if (CMD_RESET.has(upper)) {
    await clearSession(env, 'sms', from);
    const own = codes ? await resolveEntitledCoach(env, '', codes) : null;
    if (own) {
      const userID = userFor(own);
      // A launch alone restarts the flow but can leave the conversation's
      // memory behind. With a shared conversation "start over" must mean it,
      // so wipe the state first — as the web page's restart button does. This
      // clears the web view too, which is correct: it is one conversation.
      if (isSharedUser(userID)) {
        await deleteVoiceflowState(env, own, userID).catch((err) => console.error('sms reset state', err && err.message));
      }
      return startCoachOverSms(env, from, userID, own);
    }
    return smsReply('Starting fresh. Send a message whenever you are ready.');
  }

  let session = await getSession(env, 'sms', from);

  // --- No pinned coach yet.
  if (!session || !session.code || !reg.has(String(session.code).toUpperCase())) {
    if (looksLikeCrisis(bodyText)) return smsReply(crisisSmsText(env));

    // Scoped to what this caller is entitled to. With one entitlement the
    // message is not consulted at all, so there is nothing to guess at.
    const coach = codes
      ? await resolveEntitledCoach(env, bodyText, codes)
      : await resolveCoach(env, bodyText); // mode "off"/"warn": unscoped, as before

    if (!coach) {
      return smsReply(
        codes
          ? 'I could not tell which coach you meant. Reply with the author name on your subscription.'
          : declineSmsText(decision.cfg),
      );
    }
    // The message goes along: if a conversation is already live (on the web,
    // or an SMS session that simply expired) it is answered, not dropped.
    return startCoachOverSms(env, from, userFor(coach), coach, { text: bodyText });
  }

  // --- Pinned. Switching is only possible between coaches the caller holds.
  const switchTo = codes ? await resolveEntitledCoach(env, bodyText, codes) : await resolveCoach(env, bodyText);
  if (switchTo && switchTo.code !== session.code && codes && codes.length > 1) {
    return startCoachOverSms(env, from, userFor(switchTo), switchTo);
  }

  const coach = reg.get(String(session.code).toUpperCase());

  // Slide the TTL, but only when that costs something worth paying — see
  // touchSession. This is the hot path: one write per message here is what
  // capped the free plan at ~50 conversations a day.
  await touchSession(env, 'sms', from, { ...session, code: coach.code }, session);

  return smsTurn(env, coach, userFor(coach), bodyText);
}

/** One ordinary SMS turn: send the text, return the coach's reply as TwiML. */
async function smsTurn(env, coach, userID, bodyText) {
  let traces;
  try {
    traces = await vfInteract(env, coach, userID, { type: 'text', payload: bodyText });
  } catch (err) {
    console.error('sms vfInteract', err && err.message);
    return smsReply('Sorry — I had trouble reaching your coach just then. Please send that again in a moment.');
  }

  const { text, links } = flattenTraces(traces);
  let out = text || 'I\'m here. Could you say a little more?';
  if (links.length) {
    // Cards degrade to text: label + bare URL on its own line.
    out += '\n\n' + links.slice(0, 3).map((l) => `${l.label}:\n${l.url}`).join('\n\n');
  }
  return smsReply(out);
}

/**
 * Start (or resume) an SMS conversation with `coach`.
 *
 * With a shared userID, a conversation that is already live is continued, not
 * relaunched — a launch restarts the flow. `text` is the member's message when
 * there is one to answer; without it (activation, coach switch) they get a
 * short "picking up where we left off" instead of a greeting.
 */
async function startCoachOverSms(env, from, userID, coach, { text: firstText = '' } = {}) {
  await putSession(env, 'sms', from, { code: coach.code, started: new Date().toISOString() });

  await vfSetVariables(env, coach, userID, {
    channel: 'sms',
    coach_code: coach.code,
    coach_name: coach.name,
    user_phone: from,
  });

  if (isSharedUser(userID) && (await vfIsLive(env, coach, userID))) {
    if (firstText) return smsTurn(env, coach, userID, firstText);
    return smsReply(`You're connected with ${coach.name}. Picking up where we left off — what's on your mind?`);
  }

  let traces = [];
  try {
    traces = await vfInteract(env, coach, userID, {
      type: 'launch',
      payload: { channel: 'sms', coach_code: coach.code, user_phone: from },
    });
  } catch (err) {
    console.error('sms launch', err && err.message);
    return smsReply(`You're now connected with ${coach.name}. Say hello whenever you're ready.`);
  }

  const { text, links } = flattenTraces(traces);
  let out = text || `You're now connected with ${coach.name}. What's on your mind?`;
  if (links.length) out += '\n\n' + links.slice(0, 2).map((l) => `${l.label}:\n${l.url}`).join('\n\n');
  return smsReply(out);
}

function smsReply(text) {
  const body = capSms(stripMarkdown(text));
  return twiml(`<Response><Message>${xmlEscape(body)}</Message></Response>`);
}

/* =========================================================================
 * 12. Voice channel
 * ========================================================================= */

function ttsVoiceFor(env, coach) {
  return (coach && coach.ttsVoice) || env.DEFAULT_TTS_VOICE || 'Polly.Matthew-Neural';
}

function gatherAttrs(action, { input = 'speech dtmf', hints = '', numDigits = null } = {}) {
  const parts = [
    `input="${input}"`,
    `action="${xmlEscape(action)}"`,
    'method="POST"',
    'speechTimeout="auto"',
    'timeout="6"',
    'language="en-US"',
    'speechModel="phone_call"',
    'actionOnEmptyResult="true"',
  ];
  if (numDigits) parts.push(`numDigits="${numDigits}"`);
  if (hints) parts.push(`hints="${xmlEscape(hints)}"`);
  return parts.join(' ');
}

/**
 * Speech hints, scoped to what the caller may reach.
 *
 * Passing every coach's name and aliases to the recogniser was how "say any
 * author's name" worked at all. With `codes` supplied only those coaches are
 * hinted; without it (mode "off") the old behaviour is unchanged.
 */
function speechHints(reg, codes = null) {
  const allowed = Array.isArray(codes) && codes.length ? new Set(codes.map((c) => String(c).toUpperCase())) : null;
  const words = new Set();
  for (const c of reg.values()) {
    if (allowed && !allowed.has(String(c.code).toUpperCase())) continue;
    words.add(String(c.code));
    if (c.name) words.add(c.name);
    for (const a of c.aliases || []) words.add(a);
  }
  return [...words].join(', ').slice(0, 900); // Twilio caps hints length
}

/** POST /twilio/voice — greeting and code capture. */
async function handleVoiceEntry(request, env) {
  const rawBody = await request.text();
  const params = await validateTwilio(request, env, rawBody);

  const from = params.get('From') || '';
  const reg = await loadRegistry(env);
  const voice = ttsVoiceFor(env, null);

  const decision = await entitlementDecision(env, from, 'voice');

  if (!decision.allow) {
    // No enumeration. The old third-attempt branch read every coach's name and
    // code aloud, which was the worst disclosure in the file.
    return twiml(
      `<Response><Say voice="${xmlEscape(voice)}">${xmlEscape(declineVoiceText(decision.cfg))}</Say><Hangup/></Response>`,
    );
  }

  // --- Entitled to exactly one coach: connect straight through. No greeting,
  // no code prompt, nothing to mishear. This removes two turns from every call
  // and with them the repeated speech-recognition failures in HANDOFF §7.
  const codes = decision.entitlement ? decision.entitlement.codes : null;
  if (codes && codes.length === 1) {
    const coach = await resolveEntitledCoach(env, '', codes);
    if (coach) {
      const sess = voiceSessionFor(decision.cfg, coach, from, decision.entitlement);
      await putSession(env, 'voice', from, sess);
      if ((coach.voiceMode || 'inline') === 'dial') return voiceDial(env, coach, params);
      return voiceInlineStart(env, coach, from, sess.vfUser);
    }
  }

  const greeting = env.VOICE_GREETING
    || 'Welcome to the Leadership Books coach line. To reach your coach, say the author\'s name, or enter your four digit access code on the keypad.';

  return twiml(
    `<Response>` +
      `<Gather ${gatherAttrs('/twilio/voice/route', { hints: speechHints(reg, codes) })}>` +
        `<Say voice="${xmlEscape(voice)}">${xmlEscape(greeting)}</Say>` +
      `</Gather>` +
      `<Redirect method="POST">/twilio/voice/route</Redirect>` +
    `</Response>`,
  );
}

/** POST /twilio/voice/route — caller submitted a code or spoke a name. */
async function handleVoiceRoute(request, env) {
  const rawBody = await request.text();
  const params = await validateTwilio(request, env, rawBody);

  const from = params.get('From') || '';
  const digits = (params.get('Digits') || '').trim();
  const speech = (params.get('SpeechResult') || '').trim();
  const attempt = Number(new URL(request.url).searchParams.get('attempt') || '0');

  const reg = await loadRegistry(env);
  const voice = ttsVoiceFor(env, null);

  // Crisis phrasing at the code prompt: never make someone in crisis navigate a menu.
  if (!digits && looksLikeCrisis(speech)) {
    return voiceCrisisResponse(env, voice);
  }

  const decision = await entitlementDecision(env, from, 'voice');
  if (!decision.allow) {
    return twiml(
      `<Response><Say voice="${xmlEscape(voice)}">${xmlEscape(declineVoiceText(decision.cfg))}</Say><Hangup/></Response>`,
    );
  }
  const codes = decision.entitlement ? decision.entitlement.codes : null;

  const coach = codes
    ? (await resolveEntitledCoach(env, digits, codes)) || (await resolveEntitledCoach(env, speech, codes))
    : (await resolveCoach(env, digits)) || (await resolveCoach(env, speech));

  if (!coach) {
    // No input, or unrecognised: re-prompt rather than hang up. The old
    // third-attempt branch spoke the whole coach list aloud; it now says
    // nothing about who else exists.
    if (attempt >= 2) {
      return twiml(
        `<Response>` +
          `<Say voice="${xmlEscape(voice)}">I'm still not catching that. Please try calling again in a moment. Goodbye.</Say>` +
          `<Hangup/>` +
        `</Response>`,
      );
    }
    const again = attempt === 0
      ? 'Sorry, I didn\'t catch that. Please say the author\'s name, or enter your four digit code.'
      : 'Let\'s try once more. Enter your four digit access code on the keypad now.';
    return twiml(
      `<Response>` +
        `<Gather ${gatherAttrs(`/twilio/voice/route?attempt=${attempt + 1}`, { hints: speechHints(reg, codes) })}>` +
          `<Say voice="${xmlEscape(voice)}">${xmlEscape(again)}</Say>` +
        `</Gather>` +
        `<Redirect method="POST">/twilio/voice/route?attempt=${attempt + 1}</Redirect>` +
      `</Response>`,
    );
  }

  const sess = voiceSessionFor(decision.cfg, coach, from, decision.entitlement);
  await putSession(env, 'voice', from, sess);

  if ((coach.voiceMode || 'inline') === 'dial') return voiceDial(env, coach, params);
  return voiceInlineStart(env, coach, from, sess.vfUser);
}

/**
 * dial mode — bridge the caller to the coach's hidden Twilio number, which is
 * natively attached to that coach's Voiceflow agent. Voiceflow then owns STT,
 * TTS, barge-in, latency, recording and transcripts.
 */
function voiceDial(env, coach, params) {
  const voice = ttsVoiceFor(env, coach);
  const from = params.get('From') || '';

  if (!isE164(coach.dialNumber)) {
    console.error(`coach ${coach.code} is voiceMode=dial but dialNumber is missing/invalid`);
    return twiml(
      `<Response><Say voice="${xmlEscape(voice)}">${xmlEscape(coach.name)} isn't available by phone just yet. Please try the website or text this number instead. Goodbye.</Say><Hangup/></Response>`,
    );
  }

  // Twilio allows the inbound caller's number as callerId when forwarding, which
  // keeps the caller's identity in the Voiceflow transcript. Carriers do
  // sometimes deliver an unusable From (blocked/anonymous), which would fail the
  // dial — fall back to our own public number in that case.
  const callerId = isE164(from) ? from : (env.PUBLIC_TWILIO_NUMBER || '');
  const callerIdAttr = isE164(callerId) ? ` callerId="${xmlEscape(callerId)}"` : '';

  return twiml(
    `<Response>` +
      `<Say voice="${xmlEscape(voice)}">Connecting you with ${xmlEscape(coach.name)} now.</Say>` +
      `<Dial answerOnBridge="true" timeout="25"${callerIdAttr}>` +
        `<Number>${xmlEscape(coach.dialNumber)}</Number>` +
      `</Dial>` +
      `<Say voice="${xmlEscape(voice)}">I wasn't able to reach your coach. Please try again shortly. Goodbye.</Say>` +
      `<Hangup/>` +
    `</Response>`,
  );
}

/**
 * The voice session record. `vfUser` is decided once, here, while the
 * entitlement (and so the contactId) is in hand — the turn loop then reads it
 * rather than re-checking the lease on every utterance.
 */
function voiceSessionFor(cfg, coach, from, entitlement) {
  return {
    code: coach.code,
    started: new Date().toISOString(),
    vfUser: vfUserFor(cfg, coach, from, entitlement ? entitlement.contactId : null),
  };
}

/**
 * inline mode — launch the Voiceflow conversation and speak the greeting, or,
 * with a shared conversation already live, welcome them back without a launch
 * (a launch restarts the flow).
 */
async function voiceInlineStart(env, coach, from, userID = `phone:${from}`) {
  const voice = ttsVoiceFor(env, coach);

  await vfSetVariables(env, coach, userID, {
    channel: 'voice',
    coach_code: coach.code,
    coach_name: coach.name,
    user_phone: from,
  });

  let text = '';
  if (isSharedUser(userID) && (await vfIsLive(env, coach, userID))) {
    text = `Welcome back. We can pick up where we left off. What's on your mind?`;
  } else {
    let traces = [];
    try {
      traces = await vfInteract(env, coach, userID, {
        type: 'launch',
        payload: { channel: 'voice', coach_code: coach.code, user_phone: from },
      });
    } catch (err) {
      console.error('voice launch', err && err.message);
    }
    text = flattenTraces(traces).text;
  }

  const { speech } = sanitizeForSpeech(text || `You're connected with ${coach.name}. What's on your mind today?`);

  return twiml(
    `<Response>` +
      `<Gather ${gatherAttrs('/twilio/voice/turn', { input: 'speech dtmf' })}>` +
        `<Say voice="${xmlEscape(voice)}">${xmlEscape(speech)}</Say>` +
      `</Gather>` +
      `<Redirect method="POST">/twilio/voice/turn</Redirect>` +
    `</Response>`,
  );
}

/** POST /twilio/voice/turn — inline conversation loop. */
async function handleVoiceTurn(request, env, ctx) {
  const rawBody = await request.text();
  const params = await validateTwilio(request, env, rawBody);

  const from = params.get('From') || '';
  const speech = (params.get('SpeechResult') || '').trim();
  const digits = (params.get('Digits') || '').trim();
  const url = new URL(request.url);
  const silent = Number(url.searchParams.get('silent') || '0');

  const session = await getSession(env, 'voice', from);
  const coach = session ? await getCoach(env, session.code) : null;

  if (!coach) {
    // Session expired mid-call, or the Worker restarted: send them back to the front door.
    return twiml('<Response><Redirect method="POST">/twilio/voice</Redirect></Response>');
  }

  const voice = ttsVoiceFor(env, coach);
  // Decided at call start (voiceSessionFor). Sessions written before this
  // change have no vfUser and keep the old per-phone conversation.
  const userID = session.vfUser || `phone:${from}`;

  // 0 on the keypad returns to the coach menu at any point.
  if (digits === '0') {
    await clearSession(env, 'voice', from);
    return twiml('<Response><Redirect method="POST">/twilio/voice</Redirect></Response>');
  }

  const utterance = speech || digits;

  if (!utterance) {
    if (silent >= 2) {
      return twiml(
        `<Response><Say voice="${xmlEscape(voice)}">It sounds like you may have stepped away. Call back any time. Goodbye.</Say><Hangup/></Response>`,
      );
    }
    return twiml(
      `<Response>` +
        `<Gather ${gatherAttrs(`/twilio/voice/turn?silent=${silent + 1}`)}>` +
          `<Say voice="${xmlEscape(voice)}">I'm still here whenever you're ready.</Say>` +
        `</Gather>` +
        `<Redirect method="POST">/twilio/voice/turn?silent=${silent + 1}</Redirect>` +
      `</Response>`,
    );
  }

  // Caller asking for the link we refused to read aloud.
  if (/\b(text|send|message)\b.*\b(link|it|that|resource|website)\b/i.test(utterance) && session.pendingLinks?.length) {
    const sent = await sendSmsViaTwilio(env, from, `Here's what we talked about:\n\n${session.pendingLinks.slice(0, 3).map((l) => `${l.label}:\n${l.url}`).join('\n\n')}`);
    await putSession(env, 'voice', from, { ...session, pendingLinks: [] });
    const line = sent
      ? 'Sent — check your messages. Where would you like to pick up?'
      : 'I wasn\'t able to send that text just now, but I can walk you through it here instead.';
    return twiml(
      `<Response>` +
        `<Gather ${gatherAttrs('/twilio/voice/turn')}>` +
          `<Say voice="${xmlEscape(voice)}">${xmlEscape(line)}</Say>` +
        `</Gather>` +
        `<Redirect method="POST">/twilio/voice/turn</Redirect>` +
      `</Response>`,
    );
  }

  // Twilio abandons a webhook at 15s and plays its own error message, ending the
  // call. An LLM coaching reply can take longer than that. So race the Voiceflow
  // request against a soft deadline: if it wins, answer now; if it doesn't, keep
  // it alive with ctx.waitUntil(), park the result in KV, and hold the caller on
  // /twilio/voice/wait. The request is never aborted, so the turn is not lost.
  const pending = vfInteract(env, coach, userID, { type: 'text', payload: utterance });

  let traces;
  try {
    traces = await Promise.race([
      pending,
      new Promise((resolve) => setTimeout(() => resolve(VOICE_SLOW), VOICE_SOFT_DEADLINE_MS)),
    ]);
  } catch (err) {
    console.error('voice turn vfInteract', err && err.message);
    return twiml(
      `<Response>` +
        `<Gather ${gatherAttrs('/twilio/voice/turn')}>` +
          `<Say voice="${xmlEscape(voice)}">Sorry, I lost that for a second. Could you say it again?</Say>` +
        `</Gather>` +
        `<Redirect method="POST">/twilio/voice/turn</Redirect>` +
      `</Response>`,
    );
  }

  if (traces === VOICE_SLOW) {
    const callSid = params.get('CallSid') || '';
    const key = `pend:${callSid}`;
    // Finish the request after this response is sent, then park the result.
    ctx.waitUntil(
      pending
        .then((t) => env.COACH_KV.put(key, JSON.stringify({ traces: t }), { expirationTtl: 300 }))
        .catch((err) => {
          console.error('voice turn parked vfInteract', err && err.message);
          return env.COACH_KV.put(key, JSON.stringify({ error: true }), { expirationTtl: 300 });
        }),
    );
    return twiml(
      `<Response>` +
        `<Say voice="${xmlEscape(voice)}">Let me think about that.</Say>` +
        `<Pause length="1"/>` +
        `<Redirect method="POST">/twilio/voice/wait?n=1</Redirect>` +
      `</Response>`,
    );
  }

  return await speakTraces(env, coach, from, session, traces);
}

/**
 * Turn a Voiceflow trace array into the spoken TwiML for one voice turn.
 * Shared by handleVoiceTurn and handleVoiceWait so a reply that arrived late
 * is delivered identically to one that arrived in time.
 */
async function speakTraces(env, coach, from, session, traces) {
  const voice = ttsVoiceFor(env, coach);
  const { text, links } = flattenTraces(traces);
  const { speech: safeSpeech, links: strippedLinks } = sanitizeForSpeech(text);

  const allLinks = [...links, ...strippedLinks.map((u) => ({ label: 'Link', url: u }))];
  let spoken = safeSpeech || 'I\'m listening.';
  if (allLinks.length) {
    // Never speak a URL — offer to text it instead.
    spoken += ' I can text you that link if you\'d like — just say, text me the link.';
    await putSession(env, 'voice', from, { ...session, pendingLinks: allLinks.slice(0, 3) });
  } else {
    await touchSession(env, 'voice', from, session, session); // frugal TTL slide
  }

  return twiml(
    `<Response>` +
      `<Gather ${gatherAttrs('/twilio/voice/turn')}>` +
        `<Say voice="${xmlEscape(voice)}">${xmlEscape(spoken)}</Say>` +
      `</Gather>` +
      `<Redirect method="POST">/twilio/voice/turn</Redirect>` +
    `</Response>`,
  );
}

/**
 * POST /twilio/voice/wait — poll for a Voiceflow reply that outran Twilio's
 * 15-second webhook timeout.
 *
 * Twilio abandons a webhook at 15s and plays its own error message, which ends
 * the call. A coaching answer from an LLM can legitimately take longer than
 * that. So handleVoiceTurn hands the still-running request to ctx.waitUntil(),
 * which lets it finish after the response is sent, and parks the result in KV.
 * This endpoint then collects it, holding the caller with short pauses.
 */
async function handleVoiceWait(request, env) {
  const rawBody = await request.text();
  const params = await validateTwilio(request, env, rawBody);

  const from = params.get('From') || '';
  const callSid = params.get('CallSid') || '';
  const url = new URL(request.url);
  const attempt = Number(url.searchParams.get('n') || '1');

  const session = await getSession(env, 'voice', from);
  const coach = session ? await getCoach(env, session.code) : null;
  if (!coach) return twiml('<Response><Redirect method="POST">/twilio/voice</Redirect></Response>');

  const voice = ttsVoiceFor(env, coach);
  const key = `pend:${callSid}`;
  const parked = await env.COACH_KV.get(key, 'json');

  if (parked) {
    await env.COACH_KV.delete(key);
    if (parked.error) {
      return twiml(
        `<Response>` +
          `<Gather ${gatherAttrs('/twilio/voice/turn')}>` +
            `<Say voice="${xmlEscape(voice)}">Sorry, I lost that for a second. Could you say it again?</Say>` +
          `</Gather>` +
          `<Redirect method="POST">/twilio/voice/turn</Redirect>` +
        `</Response>`,
      );
    }
    return await speakTraces(env, coach, from, session, parked.traces || []);
  }

  // Each poll is its own request, so the 15s ceiling applies per poll, never
  // cumulatively. Roughly 2s per attempt.
  if (attempt < VOICE_WAIT_MAX_POLLS) {
    const filler = attempt === 1 ? '<Say voice="' + xmlEscape(voice) + '">Still with you.</Say>' : '';
    return twiml(
      `<Response>` +
        filler +
        `<Pause length="2"/>` +
        `<Redirect method="POST">/twilio/voice/wait?n=${attempt + 1}</Redirect>` +
      `</Response>`,
    );
  }

  return twiml(
    `<Response>` +
      `<Gather ${gatherAttrs('/twilio/voice/turn')}>` +
        `<Say voice="${xmlEscape(voice)}">Sorry, that one got away from me. Could you say it again?</Say>` +
      `</Gather>` +
      `<Redirect method="POST">/twilio/voice/turn</Redirect>` +
    `</Response>`,
  );
}

/** Crisis on voice: warm handoff, not a link. */
function voiceCrisisResponse(env, voice) {
  const line = crisisSpeechText(env);
  const transfer = env.CRISIS_TRANSFER_NUMBER;

  if (isE164(transfer)) {
    return twiml(
      `<Response>` +
        `<Say voice="${xmlEscape(voice)}">${xmlEscape(line)}</Say>` +
        `<Dial answerOnBridge="true" timeout="30"${env.PUBLIC_TWILIO_NUMBER ? ` callerId="${xmlEscape(env.PUBLIC_TWILIO_NUMBER)}"` : ''}>` +
          `<Number>${xmlEscape(transfer)}</Number>` +
        `</Dial>` +
        `<Say voice="${xmlEscape(voice)}">If we get disconnected, please call or text 9 8 8 to reach the Suicide and Crisis Lifeline. If you are in immediate danger, call 9 1 1.</Say>` +
        `<Hangup/>` +
      `</Response>`,
    );
  }

  return twiml(
    `<Response>` +
      `<Say voice="${xmlEscape(voice)}">${xmlEscape(line)}</Say>` +
      `<Say voice="${xmlEscape(voice)}">Please call or text 9 8 8 to reach the Suicide and Crisis Lifeline. That's 9 8 8. Someone is there right now. If you are in immediate danger, call 9 1 1.</Say>` +
      `<Pause length="1"/>` +
      `<Say voice="${xmlEscape(voice)}">I'll say that once more. 9 8 8.</Say>` +
      `<Hangup/>` +
    `</Response>`,
  );
}

/** Outbound SMS via the Twilio REST API (used for "text me the link"). */
async function sendSmsViaTwilio(env, to, body) {
  const sid = env.TWILIO_ACCOUNT_SID;
  const token = env.TWILIO_AUTH_TOKEN;
  const from = env.PUBLIC_TWILIO_NUMBER;
  if (!sid || !token || !isE164(from) || !isE164(to)) return false;

  const form = new URLSearchParams({ To: to, From: from, Body: capSms(body) });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + btoa(`${sid}:${token}`),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  }).catch(() => null);

  return !!(res && res.ok);
}

/* =========================================================================
 * 13. Web endpoints
 * ========================================================================= */

/**
 * The coach and Voiceflow userID for a web request — shared by every web
 * endpoint so they can never disagree about whose conversation this is.
 * With a verified session the coach comes from the caller's entitlement, not
 * from whatever `code` the request asked for.
 */
async function webCoachAndUser(env, body, path) {
  const gate = await webGateDecision(env, body, path);
  const coach = gate.session
    ? await getCoach(env, pickEntitledCode(gate.session, body.code))
    : await getCoach(env, body.code);
  if (!coach) throw new HttpError(404, `Unknown coach code: ${body.code}`);
  const userID = await webUserID(env, gate.session, body.userID);
  return { coach, userID };
}

/**
 * POST /api/vf-interact
 * Body: { code, sessionToken?, userID?, action, variables?, tts? }
 * Returns { userID, traces } — raw traces, so the page keeps rendering cards
 * and open_url buttons itself. `tts: true` asks Voiceflow for the project's own
 * voice audio, which the coach page plays.
 */
async function handleVfInteract(request, env, cors) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Invalid JSON body');

  const { coach, userID } = await webCoachAndUser(env, body, '/api/vf-interact');

  const variables = { channel: 'web', coach_code: coach.code, coach_name: coach.name, ...(body.variables || {}) };
  await vfSetVariables(env, coach, userID, variables);

  const action = body.action && typeof body.action === 'object'
    ? body.action
    : { type: 'launch' };

  // The page's own voice mode needs Voiceflow's TTS audio; everything else
  // keeps vfInteract's text-only default.
  const traces = await vfInteract(env, coach, userID, action, body.tts === true ? { config: { tts: true } } : {});
  return json({ userID, traces }, 200, cors || {});
}

/**
 * POST /api/vf-state
 * Body: { code, sessionToken?, userID?, op: "get" | "reset" }
 *
 * What the coach page used to do straight against Voiceflow with its API key in
 * the page source: read the conversation so far on load, and wipe it on
 * "start over". Behind the Worker the key stays secret and the userID comes
 * from the verified session, so nobody can read a member's conversation — which
 * with shared memory includes their texts and calls — by knowing their contactId.
 *
 * `get` returns only the two memory variables the page renders history from,
 * never the rest of the state (phone number, internal flags).
 */
async function handleVfState(request, env, cors) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Invalid JSON body');

  const { coach, userID } = await webCoachAndUser(env, body, '/api/vf-state');

  if (body.op === 'reset') {
    await deleteVoiceflowState(env, coach, userID);
    return json({ userID, reset: true }, 200, cors || {});
  }

  const apiKey = coachApiKey(env, coach);
  if (!apiKey) throw new HttpError(500, `Secret ${coach.keyVar || '(keyVar missing)'} is not set for coach ${coach.code}`);
  const res = await fetch(vfStatePath(coach, userID), {
    headers: { Authorization: apiKey, versionID: coach.versionID || 'production' },
  });
  const state = res.ok ? await res.json().catch(() => null) : null;
  const vars = (state && state.variables) || {};
  return json(
    {
      userID,
      live: !!(state && Array.isArray(state.stack) && state.stack.length),
      memory: { _memory_: vars._memory_ ?? null, vf_memory: vars.vf_memory ?? null },
    },
    200,
    cors || {},
  );
}

/**
 * POST /api/heygen-token
 * Body: { code }
 * Returns { token, avatarID, voiceID }.
 */
async function handleHeygenToken(request, env, cors) {
  const body = await request.json().catch(() => ({}));
  const gate = await webGateDecision(env, body, '/api/heygen-token');
  const coach = gate.session
    ? await getCoach(env, pickEntitledCode(gate.session, body && body.code))
    : await getCoach(env, body && body.code);
  if (!coach) throw new HttpError(404, `Unknown coach code: ${body && body.code}`);

  const apiKey = env.HEYGEN_API_KEY;
  if (!apiKey) throw new HttpError(500, 'HEYGEN_API_KEY secret is not set');

  const res = await fetch(HEYGEN_TOKEN_URL, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
    body: '{}',
  });

  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    throw new HttpError(502, `HeyGen ${res.status}: ${detail}`);
  }

  const data = await res.json().catch(() => ({}));
  return json({
    token: data?.data?.token || null,
    avatarID: coach.heygenAvatarID || null,
    voiceID: coach.heygenVoiceID || null,
  }, 200, cors || {});
}

/* =========================================================================
 * 14. /health
 * ========================================================================= */

/**
 * Constant-time string compare, so a wrong token can't be narrowed down by
 * timing the response. Length is compared first and leaks only the length.
 */
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Per-coach health detail is gated because it lists every coach `code` — and a
 * code is the access credential a subscriber texts to reach a coach. On a public
 * workers.dev URL an ungated /health lets anyone enumerate them.
 *
 * Fails closed: with no HEALTH_TOKEN set, nobody gets the detail.
 *
 * The header is the preferred way to pass it. The query parameter exists for
 * checking from a browser address bar, but URLs get written to request logs —
 * so prefer the header anywhere that matters.
 */
function healthDetailAllowed(request, env) {
  const expected = env.HEALTH_TOKEN || '';
  if (!expected) return false;
  const given =
    request.headers.get('x-health-token') ||
    new URL(request.url).searchParams.get('token') ||
    '';
  return timingSafeEqual(given, expected);
}

async function handleHealth(request, env) {
  const reg = await loadRegistry(env, { force: true });
  const coaches = [...reg.values()]
    .sort((a, b) => String(a.code).localeCompare(String(b.code)))
    .map((c) => ({
      code: c.code,
      name: c.name || null,
      versionID: c.versionID || 'production',
      voiceMode: c.voiceMode || 'inline',
      keyVar: c.keyVar || null,
      keyResolved: !!coachApiKey(env, c),
      dialNumberSet: c.voiceMode === 'dial' ? isE164(c.dialNumber) : null,
      heygenAvatarIDSet: !!c.heygenAvatarID,
    }));

  const problems = [];
  for (const c of coaches) {
    if (!c.keyResolved) problems.push(`${c.code}: secret ${c.keyVar || '(keyVar missing)'} did not resolve`);
    if (c.dialNumberSet === false) problems.push(`${c.code}: voiceMode=dial but dialNumber missing/invalid`);
  }
  if (String(env.SKIP_TWILIO_VALIDATION || '') === 'true') {
    problems.push('SKIP_TWILIO_VALIDATION is TRUE — Twilio signature checking is OFF. Never leave this on in production.');
  }
  if (!env.TWILIO_AUTH_TOKEN) problems.push('TWILIO_AUTH_TOKEN secret is not set');
  if (!isE164(env.PUBLIC_TWILIO_NUMBER || '')) problems.push('PUBLIC_TWILIO_NUMBER var is missing or not E.164');

  // HeyGen is optional. The registry itself says whether it's in use: a coach
  // can only start an avatar if it has a heygenAvatarID. With none configured,
  // a missing key is the expected state, not a fault — treating it as one made
  // ok:true unreachable for an SMS/voice-only deployment.
  const heygenInUse = coaches.some((c) => c.heygenAvatarIDSet);
  if (heygenInUse && !env.HEYGEN_API_KEY) {
    problems.push('HEYGEN_API_KEY secret is not set, but coaches have heygenAvatarID configured');
  }

  // Entitlement sync state. Computed BEFORE `status` and `summary`, because a
  // stale or failed sync is a real problem and has to be able to make /health
  // report 503 — external monitoring reads the status code, not the body.
  // The detail is behind the token because it counts subscribers.
  let sync = null;
  try {
    const meta = await env.COACH_KV.get('syncmeta', 'json');
    const cfg = await loadRuntimeConfig(env);
    const mode = cfg.entitlementMode || 'off';
    const leaseHours = Math.max(1, Number(cfg.leaseHours) || 48);

    if (!meta) {
      sync = { lastRunAt: null, lastOk: null, note: 'reconcile has not run yet', entitlementMode: mode };
    } else {
      const ageMs = Date.now() - new Date(meta.lastRunAt).getTime();
      const ageHours = ageMs / 3600000;
      // Half the lease: late enough not to fire on a transient blip, early
      // enough that there is still time to fix it before the first subscriber
      // loses access. This is the alarm the lease design depends on — leases
      // decay silently, so a dead sync is invisible without it.
      const staleAfterHours = leaseHours / 2;
      const stale = ageHours > staleAfterHours;

      // Cron liveness is a DIFFERENT question from lease staleness, and the
      // threshold above cannot answer it: at half a 48h lease it stays green
      // for a full day after the cron dies. Expiry and revocation both ride
      // this cron, so a day of silence is a day of nothing happening.
      //
      // ⚠ But `ageMinutes` is NOT "time since the cron ran". `syncmeta` is
      // written frugally — once an hour when nothing changed — so lastRunAt
      // legitimately lags a HEALTHY cron by up to SYNCMETA_HEARTBEAT_MIN.
      // The threshold must therefore sit above that heartbeat, or this alarm
      // fires constantly on a working system. lib-config enforces the floor.
      const cronStaleAfterMinutes = Math.max(
        SYNCMETA_HEARTBEAT_MIN + 1,
        Number(cfg.cronStaleAfterMinutes) || 90,
      );
      const ageMinutes = Math.round(ageMs / 60000);
      const cronSilent = ageMinutes > cronStaleAfterMinutes;

      sync = {
        lastRunAt: meta.lastRunAt,
        lastOk: meta.lastOk,
        ageMinutes,
        staleAfterHours,
        cronStaleAfterMinutes,
        // Said out loud so nobody reads ageMinutes as cron liveness again.
        ageMeaning: `time since syncmeta was last WRITTEN; it is rewritten only when counts change or every ${SYNCMETA_HEARTBEAT_MIN}min, so it lags a healthy cron`,
        counts: meta.counts,
        errors: meta.errors || [],
        entitlementMode: mode,
      };

      // Only a problem when entitlement is actually being applied. With the
      // mode off, a dead sync locks nobody out and should not page anyone.
      if (mode !== 'off') {
        if (stale) {
          problems.push(
            `entitlement sync is ${ageHours.toFixed(1)}h stale (leases last ${leaseHours}h) — ` +
              `subscribers start losing access once a lease is not renewed`,
          );
        }
        // Fires long before `stale` does. Deliberately separate: this one says
        // "the cron has stopped", which is actionable now, where staleness says
        // "subscribers are about to lose access", which is already too late.
        if (cronSilent && !stale) {
          problems.push(
            `no reconcile in ${ageMinutes}min (alarm at ${cronStaleAfterMinutes}min) — ` +
              `the cron may have stopped. Revocation and trial expiry both ride it. ` +
              `Note syncmeta is only rewritten every ${SYNCMETA_HEARTBEAT_MIN}min when nothing changes.`,
          );
        }
        if (meta.lastOk === false) {
          problems.push(`the last entitlement sync failed: ${(meta.errors || []).join(' | ') || 'no detail'}`);
        }
        if ((meta.counts || {}).refusedRevoke) {
          problems.push(
            `the reconcile refused to revoke ${meta.counts.refusedRevoke} subscriber(s) — ` +
              `check whether that churn is real, then re-run with force`,
          );
        }
      }
    }
  } catch {
    sync = { error: 'could not read syncmeta' };
  }

  const status = problems.length ? 503 : 200;
  const summary = {
    ok: problems.length === 0,
    coachCount: coaches.length,
    twilioValidation: String(env.SKIP_TWILIO_VALIDATION || '') === 'true' ? 'DISABLED' : 'enabled',
    // Stated explicitly so a skipped check is visible rather than silent.
    heygen: heygenInUse ? (env.HEYGEN_API_KEY ? 'in use, key set' : 'in use, KEY MISSING') : 'not in use (no coach has heygenAvatarID)',
  };

  // Unauthenticated callers get enough to monitor with (ok, count, and whether
  // signature validation is on) but nothing that identifies a coach or a code.
  if (!healthDetailAllowed(request, env)) {
    return json({ ...summary, problemCount: problems.length, detail: 'restricted' }, status);
  }

  return json({ ...summary, sync, coaches, problems }, status);
}

/* =========================================================================
 * 15. Subscriber entitlement — GoHighLevel reconcile
 *
 * Runs on a cron, never on a request. GHL is the source of truth: whichever
 * contacts currently hold a coach's `ghlTag` are the people entitled to that
 * coach. The Worker does not reason about billing — expiry, cancellation,
 * failed payment, refund and manual removal all reduce to "does the tag exist
 * right now", so how access ends is a GHL setting rather than a code change.
 *
 * Entitlement keys on the GHL contact ID, not on a phone number, because GHL
 * contacts frequently have no phone at all (Course360 signup is email-only).
 * A handset is linked to a contact by the binding token in Phase 3; where a
 * contact does happen to carry a usable phone, that is taken as an
 * opportunistic shortcut.
 * ========================================================================= */

let _configCache = { at: 0, value: null };

async function loadRuntimeConfig(env, { force = false } = {}) {
  const now = Date.now();
  if (!force && _configCache.value && now - _configCache.at < CONFIG_CACHE_MS) return _configCache.value;
  const stored = (await env.COACH_KV.get('config', 'json')) || {};
  const value = { ...CONFIG_FALLBACK, ...stored };
  _configCache = { at: now, value };
  return value;
}

/** Every contact carrying `tag`. Throws on any API failure — see reconcile. */
async function ghlSearchByTags(env, tags) {
  const token = env.GHL_API_TOKEN;
  const locationId = env.GHL_LOCATION_ID;
  if (!token || !locationId) throw new Error('GHL is not configured (GHL_API_TOKEN / GHL_LOCATION_ID)');

  const wanted = [...new Set((tags || []).map((t) => String(t).trim().toLowerCase()).filter(Boolean))];
  if (!wanted.length) return [];

  const out = [];
  let cursor = null;
  let exhausted = true;

  for (let page = 0; page < GHL_MAX_PAGES; page++) {
    const body = {
      locationId,
      pageLimit: GHL_PAGE_LIMIT,
      // An ARRAY here is an OR across the tags, verified against the live API
      // on 2026-09-22: two tags held by 3 and 2 contacts returned 3 (the union);
      // an intersection would have returned 2. This is what makes the reconcile
      // cost one call instead of one per coach.
      filters: [{ field: 'tags', operator: 'contains', value: wanted }],
    };
    if (cursor) body.searchAfter = cursor;

    const res = await fetch(`${GHL_API}/contacts/search`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Version: GHL_VERSION,
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 200);
      throw new Error(`GHL ${res.status} searching ${wanted.length} tag(s): ${detail}`);
    }

    const data = await res.json().catch(() => ({}));
    const batch = Array.isArray(data.contacts) ? data.contacts : [];
    for (const c of batch) {
      if (!c || !c.id) continue;
      out.push({
        id: c.id,
        phone: c.phone || '',
        email: c.email || '',
        // Carried, not discarded. With one combined query this is the ONLY way
        // to know which coach a given contact is entitled to.
        tags: Array.isArray(c.tags) ? c.tags : [],
      });
    }
    if (batch.length < GHL_PAGE_LIMIT) break;
    cursor = batch[batch.length - 1]?.searchAfter;
    if (!cursor) break;
    if (page === GHL_MAX_PAGES - 1) exhausted = false;
  }

  // A truncated list is indistinguishable from mass churn, and the reconcile
  // would act on it by revoking everyone who fell off the end. Throwing aborts
  // before a single write, which is this system's standing posture for any GHL
  // failure. The previous per-tag version truncated SILENTLY.
  if (!exhausted) {
    throw new Error(
      `GHL returned more than ${GHL_MAX_PAGES * GHL_PAGE_LIMIT} tagged contacts - ` +
        `refusing to reconcile on a truncated list. Raise GHL_MAX_PAGES.`,
    );
  }

  return out;
}

/**
 * Subscription statuses that count as paying.
 *
 * CAUTION, sharpened 2026-09-17: this used to say "GHL proxies Stripe, so these
 * are Stripe's names". That is only half true. GHL's own Subscription workflow
 * trigger filters on Active / Canceled / Expired / Incomplete Expired /
 * Incomplete / Overdue / Scheduled / Trial / Unpaid -- and `Expired` and
 * `Scheduled` are not Stripe statuses at all, while `Trial` and `Overdue` are
 * GHL's names for Stripe's `trialing` and `past_due`. Yet the API returns
 * Stripe-shaped `canceled` / `incomplete_expired`. The UI and API vocabularies
 * are demonstrably not the same set, so if the API ever answers `trial` rather
 * than `trialing` we silently refuse a paying customer and /health stays green.
 * See ghl-shopify subscription/plans/07-phase-5-conversion-path.md section 4.
 *
 * CAUTION: at the time of writing every subscription in the location was
 * `canceled` or `incomplete_expired`, so an ACTIVE one has never been observed.
 * These two are inferred from Stripe's conventions. Confirm against the first
 * real subscription. `past_due` and `unpaid` are deliberately excluded — a
 * failed payment should not keep a coach.
 */
const GHL_SUB_ACTIVE = new Set(['active', 'trialing']);

/**
 * Every currently-paying subscription in the location.
 *
 * Pagination is `limit`/`offset` with a plain numeric `totalCount` (verified).
 * Throws on any API failure — see reconcileEntitlements, which must not treat a
 * failed read as 'nobody is subscribed'.
 */
async function ghlActiveSubscriptions(env, { allowTest = true } = {}) {
  const token = env.GHL_API_TOKEN;
  const locationId = env.GHL_LOCATION_ID;
  if (!token || !locationId) throw new Error('GHL is not configured (GHL_API_TOKEN / GHL_LOCATION_ID)');

  const out = [];
  const limit = GHL_PAGE_LIMIT;

  for (let page = 0; page < GHL_MAX_PAGES; page++) {
    const url =
      `${GHL_API}/payments/subscriptions?altId=${encodeURIComponent(locationId)}` +
      `&altType=location&limit=${limit}&offset=${page * limit}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Version: GHL_VERSION, accept: 'application/json' },
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 200);
      throw new Error(`GHL ${res.status} listing subscriptions: ${detail}`);
    }

    const data = await res.json().catch(() => ({}));
    const batch = Array.isArray(data.data) ? data.data : [];

    for (const sub of batch) {
      const status = String(sub.status || '').toLowerCase();
      if (!GHL_SUB_ACTIVE.has(status)) continue;
      const productId = sub.recurringProduct && sub.recurringProduct.product && sub.recurringProduct.product._id;
      if (!sub.contactId || !productId) continue;

      // A Stripe test-mode subscription is a real record here. Honouring them
      // makes it possible to test the whole chain without spending money, but a
      // test payment must not grant real access once there are real customers.
      //
      // CORRECTED 2026-09-17: this used to read "9 of the 10 in this location
      // are test", which implied setting allowTestSubscriptions=false would cost
      // us our ability to test. It does not. Those 9 test-mode records all
      // belong to OTHER products (Where's My Husband?, The Truth Mirage, Not A
      // Mistake) and are discarded below anyway, because they are not in
      // productCodes. Every coach-product subscription ever created is
      // liveMode:true. allowTestSubscriptions has been false since 2026-09-17.
      const live = sub.liveMode !== false;
      if (!live && !allowTest) continue;

      out.push({ contactId: sub.contactId, productId, phone: sub.contactPhone || '', status, live });
    }

    if (batch.length < limit) break;
  }

  return out;
}
/** Phones linked to a GHL contact, from the reverse index written at bind time. */
async function phonesForContact(env, contactId) {
  const rec = await env.COACH_KV.get(`contact:${contactId}`, 'json');
  return rec && Array.isArray(rec.phones) ? rec.phones : [];
}

/**
 * Revoke one handset. The binding survives deliberately — losing a subscription
 * should not force someone to re-link their phone if they come back. The live
 * session is cleared so a conversation in flight cannot outlive the payment.
 */
async function revokeSubscriber(env, phone, sub, cfg) {
  const nowIso = new Date().toISOString();
  const dueAt = new Date(Date.now() + (cfg.archiveRetentionDays || 30) * 86400000).toISOString();

  // With shared memory the member's conversation lives under `ghl_<contactId>`,
  // not `phone:`. Recorded now, while the switch's position is known, so the
  // sweep deletes the conversation that was actually in use.
  const contactId = sub && sub.contactId ? sub.contactId : null;
  const code = sub && Array.isArray(sub.codes) && sub.codes.length ? String(sub.codes[0]).toUpperCase() : null;
  const coach = code ? (await loadRegistry(env)).get(code) : null;
  const shared = coach ? vfUserFor(cfg, coach, phone, contactId) : null;

  await env.COACH_KV.put(
    `arch:${phone}`,
    JSON.stringify({
      userID: `phone:${phone}`,
      sharedUserID: isSharedUser(shared) ? shared : null,
      contactId,
      codes: (sub && sub.codes) || [],
      revokedAt: nowIso,
      dueAt,
      stateDeleted: false,
    }),
  );
  await env.COACH_KV.delete(`sub:${phone}`);
  await clearSession(env, 'sms', phone);
  await clearSession(env, 'voice', phone);
}

/** List every `sub:` record. Returns [{ phone, value }]. */
async function listSubscribers(env) {
  const out = [];
  let cursor;
  do {
    const page = await env.COACH_KV.list({ prefix: 'sub:', cursor });
    for (const k of page.keys) {
      const value = await env.COACH_KV.get(k.name, 'json');
      out.push({ phone: k.name.slice('sub:'.length), value: value || null });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}

/** Every published `centitle:` record — the contact IDs the last run entitled. */
async function listContactEntitlements(env) {
  const out = [];
  let cursor;
  do {
    const page = await env.COACH_KV.list({ prefix: 'centitle:', cursor });
    for (const k of page.keys) out.push(k.name.slice('centitle:'.length));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}

/**
 * Bring KV into line with GHL. Populates only — nothing here denies anyone;
 * enforcement is gated separately by `entitlementMode`.
 *
 * Throws only on a configuration error. A GHL API failure aborts the run with
 * `ok: false` and changes NOTHING, because an empty or partial result set is
 * indistinguishable from "everyone churned" and acting on it would cut off
 * every subscriber at once.
 */
async function reconcileEntitlements(env, { dryRun = false, force = false } = {}) {
  const cfg = await loadRuntimeConfig(env, { force: true });
  const reg = await loadRegistry(env, { force: true });

  const report = {
    ok: false,
    dryRun,
    tags: 0,
    products: 0,
    subscriptions: 0,
    subscriptionsTest: 0,
    contacts: 0,
    granted: 0,
    renewed: 0,
    unchanged: 0,
    revoked: 0,
    refusedRevoke: 0,
    entitlementsPublished: 0,
    entitlementsRemoved: 0,
    refusedEntitlementRemoval: 0,
    writes: 0,
    errors: [],
  };

  // tag -> the codes it grants
  const tagCodes = new Map();
  for (const coach of reg.values()) {
    if (!coach.ghlTag) continue;
    if (!tagCodes.has(coach.ghlTag)) tagCodes.set(coach.ghlTag, new Set());
    tagCodes.get(coach.ghlTag).add(coach.code);
  }
  const staffTag = String(cfg.staffTag || '').trim().toLowerCase();
  if (staffTag) tagCodes.set(staffTag, new Set([...reg.values()].map((c) => c.code)));
  report.tags = tagCodes.size;

  // GHL recurring product -> the codes it grants. This is the automatic path:
  // whoever is currently paying for that product is entitled, with no tag and no
  // workflow involved. `ghlTag` remains the manual override for staff and comps.
  const productCodes = new Map();
  for (const coach of reg.values()) {
    if (!coach.ghlProductId) continue;
    if (!productCodes.has(coach.ghlProductId)) productCodes.set(coach.ghlProductId, new Set());
    productCodes.get(coach.ghlProductId).add(coach.code);
  }
  report.products = productCodes.size;

  if (!tagCodes.size && !productCodes.size) {
    report.errors.push('no coach has a ghlTag or a ghlProductId — nothing to reconcile, and nobody can be entitled');
    return report;
  }

  // --- 1. Pull the truth. Any failure aborts before a single write. ---------
  // contactId -> { codes, phone, fromTag, fromSub }
  //
  // `fromTag` / `fromSub` record HOW each code was earned, which is what makes
  // §15c possible: a code in fromSub but not in fromTag is a paying subscriber
  // who does not yet hold the coach tag, and therefore has no route to the
  // course. Tracking it here costs nothing; deriving it later would need a
  // second GHL read.
  const entitled = new Map();
  const blank = () => ({ codes: new Set(), phone: '', fromTag: new Set(), fromSub: new Set() });
  try {
    // ONE combined query for every coach tag, not one per coach. At N authors
    // the old loop made N sequential GHL calls every 15 minutes, and the free
    // plan allows 50 subrequests per request - so it would have stopped working
    // somewhere around 45 coaches, by silently ceasing to update entitlement.
    if (tagCodes.size) {
      const contacts = await ghlSearchByTags(env, [...tagCodes.keys()]);
      report.contactsScanned = contacts.length;

      // The combined query depends on each contact carrying its own `tags`.
      // If GHL ever stops returning that field, every contact would map to no
      // codes at all - which reads as "everyone churned" and would revoke the
      // entire subscriber base. The majority guard would catch a big wipe, but
      // it would let a small one through, and it would report the wrong cause.
      // So: contacts came back, none was recognised -> abort before any write.
      if (contacts.length && !contacts.some((c) => c.tags && c.tags.length)) {
        throw new Error(
          `GHL returned ${contacts.length} contact(s) but none carried a tags field - ` +
            `refusing to reconcile, because this is indistinguishable from total churn`,
        );
      }

      for (const c of contacts) {
        // Map the contact's OWN tags back to codes. A contact the filter
        // returned that holds no registry tag contributes nothing - so if the
        // query ever over-matches, it cannot over-grant.
        for (const raw of c.tags) {
          const codes = tagCodes.get(String(raw).trim().toLowerCase());
          if (!codes) continue;
          if (!entitled.has(c.id)) entitled.set(c.id, blank());
          const e = entitled.get(c.id);
          for (const code of codes) { e.codes.add(code); e.fromTag.add(code); }
          if (!e.phone && c.phone) e.phone = c.phone;
        }
      }
    }

    // Paying subscribers. Merged into the same map, so a contact entitled by
    // both a subscription and a tag simply gets the union of their codes.
    if (productCodes.size) {
      const allowTest = cfg.allowTestSubscriptions !== false;
      const subs = await ghlActiveSubscriptions(env, { allowTest });
      report.subscriptions = subs.length;
      report.subscriptionsTest = subs.filter((x) => x.live === false).length;
      for (const sub of subs) {
        const codes = productCodes.get(sub.productId);
        if (!codes) continue; // a subscription to something that is not a coach
        if (!entitled.has(sub.contactId)) entitled.set(sub.contactId, blank());
        const e = entitled.get(sub.contactId);
        for (const code of codes) { e.codes.add(code); e.fromSub.add(code); }
        if (!e.phone && sub.phone) e.phone = sub.phone;
      }
    }
  } catch (err) {
    // BOTH sources are inside this try on purpose. If either read fails, the
    // whole run aborts: a successful tag read plus a failed subscription read
    // would otherwise look like "every subscription-only member churned".
    report.errors.push(String((err && err.message) || err));
    return report; // ok stays false; nothing written
  }
  report.contacts = entitled.size;

  // --- 1b. Close the cold-buyer hole, generically --------------------------
  if (!dryRun) {
    try {
      const applied = await applySubscriptionTags(env, cfg, entitled);
      report.subTagsApplied = applied.tagged;
      report.subStatusSet = applied.statusSet;
      if (applied.errors.length) report.errors = [...(report.errors || []), ...applied.errors];
    } catch (err) {
      report.errors = [...(report.errors || []), 'subscription tagging: ' + String((err && err.message) || err)];
    }
  }

  // --- 2. Grant and renew --------------------------------------------------
  const now = Date.now();
  const leaseMs = Math.max(1, Number(cfg.leaseHours) || 48) * 3600 * 1000;
  const renewWhenRemainingUnder = leaseMs * LEASE_RENEW_FRACTION;
  const stillEntitled = new Set(); // sub: keys that survive this run

  for (const [contactId, info] of entitled) {
    const codes = [...info.codes].sort();

    // Publish what this run already computed, so the per-request paths
    // (handleBindMint, handleWebSession) can read entitlement instead of
    // re-deriving it from tags alone. A paying subscriber with no tag is
    // entitled here and was invisible to those paths before.
    //
    // Written only when the codes CHANGE. Rewriting every contact every 15
    // minutes would cost 96 writes per contact per day and exhaust the free
    // plan's 1,000/day at about ten contacts — the same trap the lease
    // renewal avoids. A read is cheap; a write is the scarce resource.
    const prevEnt = await env.COACH_KV.get(`centitle:${contactId}`, 'json');
    const sameEnt =
      prevEnt && JSON.stringify((prevEnt.codes || []).slice().sort()) === JSON.stringify(codes);
    if (!sameEnt) {
      if (!dryRun) {
        await env.COACH_KV.put(
          `centitle:${contactId}`,
          JSON.stringify({ codes, updatedAt: new Date(now).toISOString() }),
        );
        report.writes++;
      }
      report.entitlementsPublished++;
    }

    const phones = new Set(await phonesForContact(env, contactId));

    // Opportunistic auto-link: a contact carrying a usable phone gets bound
    // without an activation code.
    //
    // OFF BY DEFAULT since 2026-09-17 (`autoLinkGhlPhone: false`). Decision:
    // activation is by texted CODE ONLY — supplying a phone on a form must not
    // grant a working handset. Kept behind a flag rather than deleted so it is
    // reversible with `npm run seed` and no redeploy.
    //
    // ⛔ Re-enabling is not the way to fix "a paying customer cannot activate".
    // handleBindMint() mints on entitlement, and a cold subscriber now gets
    // theirs from the purchase workflow's Add Tag plus the published
    // `centitle:` map below. If someone cannot activate, check those.
    const fromGhl = cfg.autoLinkGhlPhone ? normalizePhone(info.phone) : '';
    if (fromGhl && !phones.has(fromGhl)) {
      phones.add(fromGhl);
      if (!dryRun) {
        await env.COACH_KV.put(`contact:${contactId}`, JSON.stringify({ phones: [...phones] }));
        await env.COACH_KV.put(`bind:${fromGhl}`, JSON.stringify({ contactId, boundAt: new Date().toISOString(), via: 'ghl-phone' }));
        report.writes += 2;
      }
    }

    for (const phone of phones) {
      stillEntitled.add(phone);
      const existing = await env.COACH_KV.get(`sub:${phone}`, 'json');
      const sameCodes = existing && JSON.stringify((existing.codes || []).slice().sort()) === JSON.stringify(codes);
      const remaining = existing && existing.expires ? new Date(existing.expires).getTime() - now : -1;

      // The frugal branch: an unchanged, still-fresh lease costs nothing.
      if (existing && sameCodes && remaining > renewWhenRemainingUnder) {
        report.unchanged++;
        continue;
      }

      if (!dryRun) {
        await env.COACH_KV.put(
          `sub:${phone}`,
          JSON.stringify({
            contactId,
            codes,
            expires: new Date(now + leaseMs).toISOString(),
            updatedAt: new Date(now).toISOString(),
          }),
        );
        report.writes++;
      }
      if (existing) report.renewed++;
      else report.granted++;

      // Back inside the retention window: cancel the pending state deletion so
      // a returning subscriber keeps their conversation.
      if (!dryRun && !existing) await env.COACH_KV.delete(`arch:${phone}`);
    }
  }

  // --- 3. Revoke, behind the guard ----------------------------------------
  const allSubs = await listSubscribers(env);
  const candidates = allSubs.filter((s) => !stillEntitled.has(s.phone));

  const majority = candidates.length > REVOKE_GUARD_FLOOR && candidates.length > allSubs.length * REVOKE_GUARD_FRACTION;
  if (majority && !force) {
    report.refusedRevoke = candidates.length;
    report.errors.push(
      `refused to revoke ${candidates.length} of ${allSubs.length} subscribers in one run — ` +
        `this looks like a bad GHL response rather than real churn. Re-run with force to override.`,
    );
  } else {
    for (const cand of candidates) {
      if (!dryRun) {
        await revokeSubscriber(env, cand.phone, cand.value, cfg);
        report.writes += 1; // the arch: put; deletes are counted separately by KV
      }
      report.revoked++;
    }

  }

  // --- 4. Retire published entitlements, behind their OWN guard ------------
  //
  // This needs a separate majority check from the one above, and the reason is
  // easy to miss: the lease guard is computed over `sub:` records, and since
  // `autoLinkGhlPhone` went to false most entitled contacts have NO lease —
  // they are entitled but have not linked a handset yet. So the lease guard is
  // frequently looking at an empty or tiny population and would wave through a
  // wipe of the entitlement map on the strength of one bad GHL read. Guard the
  // map against its own previous size instead.
  const prevEntitlements = await listContactEntitlements(env);
  const staleEntitlements = prevEntitlements.filter((id) => !entitled.has(id));
  const entMajority =
    staleEntitlements.length > REVOKE_GUARD_FLOOR &&
    staleEntitlements.length > prevEntitlements.length * REVOKE_GUARD_FRACTION;

  if (entMajority && !force) {
    report.refusedEntitlementRemoval = staleEntitlements.length;
    report.errors.push(
      `refused to retire ${staleEntitlements.length} of ${prevEntitlements.length} published ` +
        `entitlements in one run — this looks like a bad GHL response rather than real churn. ` +
        `Re-run with force to override.`,
    );
  } else {
    for (const contactId of staleEntitlements) {
      if (!dryRun) await env.COACH_KV.delete(`centitle:${contactId}`);
      report.entitlementsRemoved++;
    }
  }

  report.ok = true;
  return report;
}

/**
 * Delete a subscriber's Voiceflow conversation state.
 *
 * State and transcript are different things: this makes the coach forget the
 * person, so a returning subscriber starts fresh. It does NOT touch the
 * transcript, which Voiceflow keeps under its own 6-month expiry. Verified.
 */
async function deleteVoiceflowState(env, coach, userID) {
  const apiKey = coachApiKey(env, coach);
  if (!apiKey) throw new Error(`no API key for coach ${coach.code}`);

  const res = await fetch(vfStatePath(coach, userID), {
    method: 'DELETE',
    headers: { Authorization: apiKey, versionID: coach.versionID || 'production' },
  });
  // 404 = nothing there, which is the goal. Two handsets on one contact queue
  // the same shared userID twice; the second delete must not read as failure.
  if (!res.ok && res.status !== 404) throw new Error(`Voiceflow ${res.status} deleting state for ${coach.code}`);
}

/**
 * Retention sweep. Runs on the same cron as the reconcile.
 *
 * `arch:` records carry no KV expiry on purpose — the record IS the queue, so
 * letting it lapse would erase the list of what still needs cleaning up.
 *
 * The record is only removed after Voiceflow confirms the delete. A failure
 * leaves it in place to be retried on the next run rather than silently
 * dropping the work.
 *
 * `archiveReminderDays` is intentionally unused: reminders were dropped once it
 * turned out nothing is lost at the retention boundary (the transcript
 * survives). The setting is kept for the day someone wants notifying ahead of
 * Voiceflow's own 6-month expiry, which is the only point data really goes.
 */
async function sweepArchives(env, cfg) {
  const report = { archives: 0, due: 0, deleted: 0, held: 0, errors: [] };
  const now = Date.now();
  const reg = await loadRegistry(env);

  let cursor;
  do {
    const page = await env.COACH_KV.list({ prefix: 'arch:', cursor });
    for (const k of page.keys) {
      const rec = await env.COACH_KV.get(k.name, 'json');
      if (!rec) {
        await env.COACH_KV.delete(k.name); // unreadable: nothing to act on
        continue;
      }
      report.archives++;

      const dueAt = rec.dueAt ? new Date(rec.dueAt).getTime() : Infinity;
      if (!Number.isFinite(dueAt) || dueAt > now) continue;
      report.due++;

      if (!cfg.archiveAutoDelete) {
        report.held++; // deliberately switched off
        continue;
      }

      const coach = (rec.codes || []).length ? reg.get(String(rec.codes[0]).toUpperCase()) : null;
      // The per-phone conversation, plus the shared one when sharedMemory was
      // on at revocation (see revokeSubscriber).
      const userIDs = [rec.userID, rec.sharedUserID].filter(Boolean);

      if (!coach || !userIDs.length) {
        // Nothing to delete — drop the record so it stops being counted.
        await env.COACH_KV.delete(k.name);
        report.deleted++;
        continue;
      }

      try {
        for (const userID of userIDs) await deleteVoiceflowState(env, coach, userID);
        await env.COACH_KV.delete(k.name);
        report.deleted++;
        console.log(`[archive] deleted Voiceflow state for ${userIDs.join(', ')} (coach ${coach.code})`);
      } catch (err) {
        // Keep the record: better a retry next run than losing the queue entry.
        report.errors.push(String((err && err.message) || err));
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  return report;
}

/**
 * Cron entry point. Records the outcome in `syncmeta`, which is what /health
 * reads to tell whether the sync is alive — the lease design depends on a
 * broken sync being visible, since access silently decays without it.
 *
 * syncmeta is only written when something changed or the heartbeat is stale,
 * to stay inside the free plan's 1,000 writes a day.
 */
async function runReconcile(env, opts = {}) {
  let report;
  try {
    report = await reconcileEntitlements(env, opts);
  } catch (err) {
    report = { ok: false, errors: [String((err && err.message) || err)] };
  }

  // The retention sweep runs even when the reconcile failed: it depends only on
  // KV, so a GHL outage is no reason to stop honouring a deletion date.
  if (!opts.dryRun) {
    try {
      const cfg = await loadRuntimeConfig(env);
      const sweep = await sweepArchives(env, cfg);
      report.archives = sweep.archives;
      report.archivesDue = sweep.due;
      report.archivesDeleted = sweep.deleted;
      report.archivesHeld = sweep.held;
      if (sweep.errors.length) report.errors = [...(report.errors || []), ...sweep.errors];
    } catch (err) {
      report.errors = [...(report.errors || []), 'archive sweep: ' + String((err && err.message) || err)];
    }

    // Trial expiry. Unlike the archive sweep this DOES depend on GHL, so a GHL
    // outage must leave every trial in place rather than half-expire a
    // population - the records stay and the next run retries.
    try {
      const cfg = await loadRuntimeConfig(env);
      const trials = await sweepExpiredTrials(env, cfg, opts);
      report.trialsTracked = trials.trials;
      report.trialsDue = trials.due;
      report.trialsExpired = trials.expired;
      report.trialsDeferred = trials.deferred;
      report.trialOrphans = trials.orphans;
      report.trialExpiryMode = trials.mode;
      if (trials.errors.length) report.errors = [...(report.errors || []), ...trials.errors];
    } catch (err) {
      report.errors = [...(report.errors || []), 'trial sweep: ' + String((err && err.message) || err)];
    }
  }

  const counts = {
    trialsTracked: report.trialsTracked || 0,
    trialsExpired: report.trialsExpired || 0,
    contacts: report.contacts || 0,
    granted: report.granted || 0,
    renewed: report.renewed || 0,
    revoked: report.revoked || 0,
    refusedRevoke: report.refusedRevoke || 0,
    entitlements: report.entitlementsPublished || 0,
    entitlementsRemoved: report.entitlementsRemoved || 0,
    refusedEntitlementRemoval: report.refusedEntitlementRemoval || 0,
    archives: report.archives || 0,
    archivesDeleted: report.archivesDeleted || 0,
  };
  const nowIso = new Date().toISOString();

  const prev = await env.COACH_KV.get('syncmeta', 'json');
  const changed =
    !prev ||
    prev.lastOk !== report.ok ||
    JSON.stringify(prev.counts) !== JSON.stringify(counts) ||
    Date.now() - new Date(prev.lastRunAt || 0).getTime() > SYNCMETA_HEARTBEAT_MS;

  if (changed && !opts.dryRun) {
    await env.COACH_KV.put(
      'syncmeta',
      JSON.stringify({ lastRunAt: nowIso, lastOk: report.ok, counts, errors: (report.errors || []).slice(0, 3) }),
    );
  }

  if (!report.ok) console.error('[reconcile] failed:', (report.errors || []).join(' | '));
  else console.log(`[reconcile] ${JSON.stringify(counts)} writes=${report.writes || 0}`);

  return report;
}


/* =========================================================================
 * 15c. Tag paying subscribers - so the purchase path needs no GHL workflow
 *
 * A subscription already grants entitlement: the reconcile matches
 * `ghlProductId` and the subscriber can text, call and open the web coach.
 * What a subscription did NOT give them is the COURSE - because the course is
 * granted by a workflow that triggers on the coach tag, and nothing applied it.
 *
 * That gap used to be filled by a per-author `Coach Subscription Started`
 * workflow with a hardcoded product filter and a hardcoded Add Tag. Two more
 * author-specific workflows per author, forever.
 *
 * Applying the tag here removes the need for that workflow entirely. The same
 * per-author grant workflow that serves trials then serves purchases too, and
 * adding an author stops requiring any new purchase-side configuration.
 *
 * It is idempotent WITHOUT any extra state: once the tag is applied, the very
 * next reconcile finds that contact in the tag search, so the code lands in
 * `fromTag` and this does nothing. A manually removed tag is re-applied, which
 * is correct - the subscription is the source of truth.
 * ========================================================================= */

async function applySubscriptionTags(env, cfg, entitled) {
  const out = { tagged: 0, statusSet: 0, errors: [] };
  const mode = String((cfg && cfg.tagOnSubscription) || 'off').toLowerCase();
  if (mode === 'off') return out;

  const reg = await loadRegistry(env);
  const byCode = new Map([...reg.values()].map((c) => [String(c.code).toUpperCase(), c]));

  for (const [contactId, info] of entitled) {
    // Codes earned by paying, that the contact does not already hold a tag for.
    const missing = [...info.fromSub].filter((code) => !info.fromTag.has(code));
    if (!missing.length) continue;

    const tags = missing
      .map((code) => byCode.get(String(code).toUpperCase()))
      .filter((c) => c && c.ghlTag)
      .map((c) => c.ghlTag);
    if (!tags.length) continue;

    if (mode === 'dry') {
      out.tagged += tags.length;
      console.log(`[subtag] would tag ${contactId} with ${tags.join(',')}`);
      continue;
    }

    try {
      await ghlAddTags(env, contactId, tags);
      out.tagged += tags.length;

      // Without this the day-7 and day-9 emails keep selling the subscription
      // to someone who already bought it: those steps are guarded on
      // `Coach Status is trial`, and a converting trial user stays `trial`
      // until something says otherwise. Written once - the next run sees the
      // tag and never reaches here again.
      await ghlRequest(env, `/contacts/${encodeURIComponent(contactId)}`, {
        method: 'PUT',
        body: { customFields: [{ key: 'coach_status', field_value: 'active' }] },
      });
      out.statusSet += 1;

      console.log(`[subtag] tagged ${contactId} with ${tags.join(',')} from an active subscription`);
    } catch (err) {
      // Logged, not thrown: a failure here must not abort the reconcile and
      // cost every other subscriber their lease renewal. The next run retries,
      // because the contact still has no tag.
      const msg = `subtag ${contactId}: ${(err && err.message) || err}`;
      out.errors.push(msg);
      console.error(`[subtag] FAILED ${msg}`);
    }
  }

  return out;
}

/** Add one or more tags to a contact, leaving existing tags untouched. */
async function ghlAddTags(env, contactId, tags) {
  const token = env.GHL_API_TOKEN;
  if (!token) throw new HttpError(500, 'GHL_API_TOKEN is not set');
  const res = await fetch(`${GHL_API}/contacts/${encodeURIComponent(contactId)}/tags`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Version: GHL_VERSION,
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ tags }),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 200);
    throw new Error(`GHL ${res.status} adding tags: ${detail}`);
  }
  const data = await res.json().catch(() => ({}));
  return Array.isArray(data.tags) ? data.tags : [];
}

/* =========================================================================
 * 15b. Trial expiry sweep - the Worker ends trials, not GHL
 *
 * Day 10 used to be a GHL workflow action holding the literal string
 * `bookcoach-micheal-stickler-active`. That is correct for exactly one author.
 * For any other author it removes the WRONG TAG, so their trial starts and
 * never ends - the "free coach forever" failure this project spent two weeks
 * fixing, reintroduced by scale.
 *
 * GHL cannot template a tag (proven 2026-09-12), so a GHL-owned day 10 needs an
 * N-way branch whose only job is picking a string, and a forgotten branch fails
 * SILENTLY. Here the tag is written and removed by the same component, from the
 * same registry, and GHL never names a coach-specific string at all.
 *
 * Runs on the cron that already carries revocation, so expiry lands within the
 * same 15 minutes everything else does.
 * ========================================================================= */

/** How many `trial:` records to hold in memory per page of the KV listing. */
const TRIAL_SWEEP_PAGE = 1000;

/**
 * Most trials one run will end. A circuit breaker, NOT a rate limit: the
 * remainder simply expire on the next cron 15 minutes later.
 *
 * It exists to bound the damage of a pathological state (a clock fault, a bad
 * migration) rather than to second-guess the data - and to bound KV writes,
 * since each expiry costs a delete and the free plan allows 1,000 a day.
 */
const TRIAL_SWEEP_MAX_PER_RUN = 100;

/**
 * End every trial whose time is up.
 *
 * Modes, from `config.trialExpiryMode`:
 *   off  - do nothing at all (the shipped default; nothing changes silently)
 *   dry  - report what would expire, write nothing
 *   on   - expire them
 */
async function sweepExpiredTrials(env, cfg, opts = {}) {
  const mode = String((cfg && cfg.trialExpiryMode) || 'off').toLowerCase();
  const report = {
    mode, trials: 0, due: 0, expired: 0, tagsRemoved: 0,
    statusSet: 0, orphans: 0, deferred: 0, errors: [],
  };
  if (mode === 'off') return report;

  const dryRun = opts.dryRun || mode === 'dry';
  const now = Date.now();

  // --- 1. read every trial record ----------------------------------------
  const records = [];
  let cursor;
  do {
    const page = await env.COACH_KV.list({ prefix: 'trial:', cursor, limit: TRIAL_SWEEP_PAGE });
    for (const k of page.keys) {
      const rec = await env.COACH_KV.get(k.name, 'json');
      if (!rec || !rec.contactId || !rec.code) {
        // A malformed record can never expire anyone. Count it rather than
        // deleting it: silent deletion of state nobody understands is worse.
        report.orphans += 1;
        continue;
      }
      records.push({ key: k.name, ...rec });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  report.trials = records.length;
  const due = records.filter((r) => {
    const t = Date.parse(r.expiresAt);
    return Number.isFinite(t) && t <= now;
  });
  report.due = due.length;
  if (!due.length) return report;

  // --- 2. the circuit breaker, and why it is NOT a majority guard ---------
  //
  // The reconcile refuses a run that would revoke more than half its
  // subscribers, because there an empty GHL response is indistinguishable from
  // "everyone churned" - the danger is an external system LYING.
  //
  // That reasoning does not transfer, and copying it here would have been a
  // bug. Trial expiry is driven by a local KV record carrying a date this
  // Worker itself computed at grant time. Nothing external can lie about it.
  // Worse, a majority guard would FIRE ON THE NORMAL CASE: everyone who buys
  // on launch day expires on the same day, so 100% of the population coming due
  // at once is exactly what a healthy system looks like - and the guard would
  // refuse it, ending nobody's trial and quietly giving them all a free coach.
  //
  // So: no majority guard. A per-run cap instead, which bounds a runaway
  // without ever refusing legitimate work - the overflow expires 15 minutes
  // later on the next cron.
  const batch = due.slice(0, TRIAL_SWEEP_MAX_PER_RUN);
  report.deferred = due.length - batch.length;
  if (report.deferred) {
    console.warn(`[trial] ${due.length} due, capping at ${TRIAL_SWEEP_MAX_PER_RUN}; ${report.deferred} deferred to the next run`);
  }

  if (dryRun) return report;

  // --- 3. expire them ------------------------------------------------------
  const reg = await loadRegistry(env);
  const knownCoachTags = new Set(
    [...reg.values()].map((c) => c.ghlTag).filter(Boolean).map((t) => String(t).toLowerCase()),
  );

  for (const rec of batch) {
    const coach = reg.get(String(rec.code).toUpperCase());
    if (!coach || !coach.ghlTag) {
      // The coach left the registry. Nothing to revoke, and keeping the record
      // would mean retrying forever.
      report.orphans += 1;
      await env.COACH_KV.delete(rec.key);
      continue;
    }

    try {
      const outcome = await ghlRemoveTag(env, rec.contactId, coach.ghlTag);

      if (outcome.missing) {
        // Contact deleted in GHL. The reconcile already revoked its lease; the
        // record is just stale bookkeeping.
        report.orphans += 1;
        await env.COACH_KV.delete(rec.key);
        continue;
      }

      report.tagsRemoved += 1;

      // Only the LAST trial to end flips coach_status. A reader still mid-trial
      // on another author must not read `expired`, or the day-7 and day-9
      // guards on that trial stop matching and their sequence dies silently.
      const stillHeld = (outcome.tags || [])
        .map((t) => String(t).toLowerCase())
        .filter((t) => knownCoachTags.has(t));

      if (!stillHeld.length) {
        await ghlRequest(env, `/contacts/${encodeURIComponent(rec.contactId)}`, {
          method: 'PUT',
          body: { customFields: [{ key: 'coach_status', field_value: 'expired' }] },
        });
        report.statusSet += 1;
      }

      await env.COACH_KV.delete(rec.key);
      report.expired += 1;
      console.log(`[trial] expired ${rec.code} for ${rec.contactId} (started ${rec.startedAt})`);
    } catch (err) {
      // Leave the record in place so the next run retries. Losing it would
      // leave the reader entitled with nothing scheduled to take it away.
      const msg = `trial ${rec.code}/${rec.contactId}: ${(err && err.message) || err}`;
      report.errors.push(msg);
      console.error(`[trial] FAILED ${msg}`);
    }
  }

  return report;
}

/**
 * Remove ONE tag from a contact, leaving every other tag untouched.
 *
 * Uses GHL's targeted endpoint rather than a whole-contact PUT with a rebuilt
 * tags array: a PUT would race with anything else touching that contact and
 * could silently drop a tag applied a second earlier. Verified live
 * 2026-09-23 - the response returns the REMAINING tags, which is what decides
 * whether coach_status flips.
 */
async function ghlRemoveTag(env, contactId, tag) {
  const token = env.GHL_API_TOKEN;
  if (!token) throw new HttpError(500, 'GHL_API_TOKEN is not set');

  const res = await fetch(`${GHL_API}/contacts/${encodeURIComponent(contactId)}/tags`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
      Version: GHL_VERSION,
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ tags: [tag] }),
  });

  // GHL answers an unknown contact id with 400, not 404 - a long-standing trap
  // in this codebase. Any 4xx here means "there is no such contact", which is
  // not an error worth retrying.
  if (res.status >= 400 && res.status < 500) return { missing: true, tags: [] };
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 200);
    throw new Error(`GHL ${res.status} removing tag: ${detail}`);
  }

  const data = await res.json().catch(() => ({}));
  return { missing: false, tags: Array.isArray(data.tags) ? data.tags : [] };
}

/* =========================================================================
 * 16. Handset binding — linking a GHL contact to a phone number
 *
 * GHL contacts are usually email-only (Course360 signup does not ask for a
 * phone), so there is nothing to match an inbound text against. The members
 * area is already authenticated by GHL, so it is used to hand the member a
 * short-lived code; texting that code proves they hold the handset, which is
 * stronger evidence than a phone number typed into a form.
 * ========================================================================= */

// Crockford base32 without I, L, O and U — no glyph pairs a person can confuse
// reading a code off a screen. 256 / 32 divides evenly, so no modulo bias.
const TOKEN_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TOKEN_LENGTH = 6;
const TOKEN_SHAPE = /^[0-9A-HJKMNP-TVWXYZ]{6}$/;
const TOKEN_TTL_SECONDS = 15 * 60;
const MINT_RATE_LIMIT = 5;
const MINT_RATE_WINDOW_SECONDS = 60 * 60;

function mintTokenValue() {
  const bytes = new Uint8Array(TOKEN_LENGTH);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += TOKEN_ALPHABET[b % TOKEN_ALPHABET.length];
  return out;
}

/**
 * One GHL contact, or null when there is no such contact.
 *
 * A malformed or unknown ID comes back 400 rather than 404, so any 4xx is read
 * as "not found". Only a 5xx is treated as a real failure — otherwise a typo'd
 * contact ID would surface to a member as a server error.
 */
async function ghlGetContact(env, contactId) {
  const token = env.GHL_API_TOKEN;
  if (!token) throw new HttpError(500, 'GHL_API_TOKEN is not set');

  const res = await fetch(`${GHL_API}/contacts/${encodeURIComponent(contactId)}`, {
    headers: { Authorization: `Bearer ${token}`, Version: GHL_VERSION, accept: 'application/json' },
  });
  if (res.status >= 400 && res.status < 500) return null;
  if (!res.ok) throw new HttpError(502, `GHL ${res.status} fetching contact`);

  const data = await res.json().catch(() => ({}));
  return (data && data.contact) || null;
}

/**
 * Which coach codes a contact is entitled to, right now.
 *
 * The union of two sources, and it needs both:
 *
 *  - `centitle:<contactId>`, published by the reconcile. This is what a PAYING
 *    subscriber's entitlement comes from. Before it existed, these endpoints
 *    read tags only, so a customer with an active subscription and no tag was
 *    refused an activation code and a web session while being billed.
 *  - the contact's tags, read live. Still authoritative for trials, staff,
 *    comps and manual grants, and it covers the window between a tag being
 *    applied and the next reconcile publishing it — up to ~15 minutes.
 *
 * Union rather than fallback: either source alone is a legitimate grant, and
 * preferring one would silently drop the other.
 */
/**
 * An email that travelled through a page URL, restored.
 *
 * The Course360 lesson builds the coach page URL as
 * `?cid={{contact.id}}&em={{contact.email}}` and does NOT encode the email, so
 * a `+` arrives bare - and a bare `+` in a query string reads as a SPACE.
 * `me+books@gmail.com` became `me books@gmail.com`, matched no contact, and
 * the reader was refused an activation code forever. Found 2026-10-01 on a
 * verify-author run (address `zain.botsify+verify-...`).
 *
 * An email address can never contain a space, so turning spaces back into
 * `+` is lossless - and fixing it here fixes every author's page at once.
 */
function emailFromPage(raw) {
  return String(raw || '').trim().toLowerCase().replace(/ /g, '+');
}

async function codesForContact(env, contactId, tags) {
  let published = [];
  if (contactId) {
    const rec = await env.COACH_KV.get(`centitle:${contactId}`, 'json');
    if (rec && Array.isArray(rec.codes)) published = rec.codes;
  }
  const fromTags = await codesForTags(env, tags);
  return [...new Set([...published, ...fromTags])].sort();
}

/** Which coach codes a set of GHL tags grants. */
async function codesForTags(env, tags) {
  const cfg = await loadRuntimeConfig(env);
  const reg = await loadRegistry(env);
  const held = new Set((Array.isArray(tags) ? tags : []).map((t) => String(t).trim().toLowerCase()));

  const staffTag = String(cfg.staffTag || '').trim().toLowerCase();
  if (staffTag && held.has(staffTag)) return [...reg.values()].map((c) => c.code).sort();

  const codes = [];
  for (const coach of reg.values()) {
    if (coach.ghlTag && held.has(coach.ghlTag)) codes.push(coach.code);
  }
  return codes.sort();
}

/**
 * POST /api/bind/mint — body { contactId, email }.
 * Both values are available as merge fields on a logged-in Course360 page.
 */
async function handleBindMint(request, env, cors) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Invalid JSON body');

  const contactId = String(body.contactId || '').trim();
  const email = emailFromPage(body.email);
  if (!contactId || !email) throw new HttpError(400, 'contactId and email are both required');

  const rlKey = `rl:mint:${contactId}`;
  const used = Number(await env.COACH_KV.get(rlKey)) || 0;
  if (used >= MINT_RATE_LIMIT) {
    throw new HttpError(429, 'Too many activation codes requested. Please try again later.');
  }

  const contact = await ghlGetContact(env, contactId);

  // Deliberately one message for both "no such contact" and "email does not
  // match": otherwise this endpoint would confirm whether a contact ID exists.
  if (!contact || String(contact.email || '').trim().toLowerCase() !== email) {
    console.warn(`[bind] mint refused for contact ${contactId} (no match)`);
    throw new HttpError(403, 'We could not verify that account.');
  }

  const codes = await codesForContact(env, contactId, contact.tags);
  if (!codes.length) throw new HttpError(403, 'That account does not have an active coach subscription.');

  const token = mintTokenValue();
  await env.COACH_KV.put(
    `tok:${token}`,
    JSON.stringify({ contactId, codes, mintedAt: new Date().toISOString() }),
    { expirationTtl: TOKEN_TTL_SECONDS },
  );
  await env.COACH_KV.put(rlKey, String(used + 1), { expirationTtl: MINT_RATE_WINDOW_SECONDS });

  console.log(`[bind] minted for contact ${contactId} codes=${codes.join(',')}`);
  return json(
    { token, expiresInSeconds: TOKEN_TTL_SECONDS, smsTo: env.PUBLIC_TWILIO_NUMBER || null },
    200,
    cors || {},
  );
}

/**
 * POST /api/bind/status — body { contactId, email }.
 *
 * Lets the coach page show "phone already linked" instead of offering a code to
 * someone who does not need one. Verified exactly like a code request, so it
 * cannot be used to probe whether an account exists.
 *
 * Deliberately performs NO KV WRITES: this runs on every page load, and the
 * free plan's scarce resource is writes, not reads. It is therefore also not
 * rate-limited — a counter would itself cost a write per load. The GHL lookup
 * is the natural throttle.
 */
async function handleBindStatus(request, env, cors) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Invalid JSON body');

  const contactId = String(body.contactId || '').trim();
  const email = emailFromPage(body.email);
  if (!contactId || !email) throw new HttpError(400, 'contactId and email are both required');

  const contact = await ghlGetContact(env, contactId);
  if (!contact || String(contact.email || '').trim().toLowerCase() !== email) {
    throw new HttpError(403, 'We could not verify that account.');
  }

  const codes = await codesForTags(env, contact.tags);
  const rec = await env.COACH_KV.get(`contact:${contactId}`, 'json');
  const phones = rec && Array.isArray(rec.phones) ? rec.phones : [];

  // Only the last four digits leave the Worker: enough for someone to recognise
  // their own handset, useless to anybody else.
  const masked = phones.map((ph) => '•••• ' + String(ph).slice(-4));

  return json(
    {
      linked: phones.length > 0,
      phones: masked,
      subscribed: codes.length > 0,
      smsTo: env.PUBLIC_TWILIO_NUMBER || null,
    },
    200,
    cors || {},
  );
}

/**
 * If an inbound text is a live activation code, link the handset and return
 * what it was linked to. Returns null for anything else, so ordinary messages
 * that happen to be six characters fall through untouched — the shape has to
 * match AND the token has to exist.
 */
async function redeemBindToken(env, from, bodyText) {
  const candidate = String(bodyText || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (!TOKEN_SHAPE.test(candidate)) return null;

  const rec = await env.COACH_KV.get(`tok:${candidate}`, 'json');
  if (!rec || !rec.contactId) return null;

  const contactId = rec.contactId;
  const prior = await env.COACH_KV.get(`bind:${from}`, 'json');

  // A handset moving between accounts must be unlinked from the old one first.
  // Leaving it attached would let the reconcile keep re-granting access through
  // the previous contact, so one phone would answer to two subscriptions.
  if (prior && prior.contactId && prior.contactId !== contactId) {
    const oldRec = await env.COACH_KV.get(`contact:${prior.contactId}`, 'json');
    const remaining = ((oldRec && oldRec.phones) || []).filter((p) => p !== from);
    await env.COACH_KV.put(`contact:${prior.contactId}`, JSON.stringify({ phones: remaining }));
    console.log(`[bind] ${from} moved from contact ${prior.contactId} to ${contactId}`);
  }

  const nowIso = new Date().toISOString();
  await env.COACH_KV.put(`bind:${from}`, JSON.stringify({ contactId, boundAt: nowIso, via: 'token' }));

  const own = await env.COACH_KV.get(`contact:${contactId}`, 'json');
  const phones = new Set((own && own.phones) || []);
  phones.add(from);
  await env.COACH_KV.put(`contact:${contactId}`, JSON.stringify({ phones: [...phones] }));

  const cfg = await loadRuntimeConfig(env);
  const leaseMs = Math.max(1, Number(cfg.leaseHours) || 48) * 3600 * 1000;
  await env.COACH_KV.put(
    `sub:${from}`,
    JSON.stringify({
      contactId,
      codes: rec.codes || [],
      expires: new Date(Date.now() + leaseMs).toISOString(),
      updatedAt: nowIso,
    }),
  );

  await env.COACH_KV.delete(`tok:${candidate}`); // single use
  // Coming back inside the archive window cancels the pending state deletion.
  await env.COACH_KV.delete(`arch:${from}`);

  console.log(`[bind] ${from} linked to contact ${contactId} codes=${(rec.codes || []).join(',')}`);
  return { contactId, codes: rec.codes || [] };
}

/* =========================================================================
 * 16b. Web coach page gate
 *
 * The coach page (book-coach.ai/<author>) is a separate site iframed into the
 * Course360 lesson, so it has no GHL contact context of its own and cannot
 * identify the viewer. The lesson page around it can: it mints a short-lived
 * session token and hands it to the iframe.
 *
 * `webGateMode` is separate from `entitlementMode` because the page has to be
 * updated to send that token before the gate can be enforced, and that is a
 * different day's work from SMS and voice.
 * ========================================================================= */

const WEB_TOKEN_SHAPE = /^[a-f0-9]{32}$/i;

function mintWebSessionToken() {
  return crypto.randomUUID().replace(/-/g, '');
}

/**
 * POST /api/web/session — body { contactId, email }.
 * Called by the Course360 lesson page, which GHL renders for a known member.
 */
async function handleWebSession(request, env, cors) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Invalid JSON body');

  const contactId = String(body.contactId || '').trim();
  const email = emailFromPage(body.email);
  if (!contactId || !email) throw new HttpError(400, 'contactId and email are both required');

  const rlKey = `rl:web:${contactId}`;
  const used = Number(await env.COACH_KV.get(rlKey)) || 0;
  if (used >= MINT_RATE_LIMIT * 4) throw new HttpError(429, 'Too many session requests. Please try again later.');

  const contact = await ghlGetContact(env, contactId);
  // Same single message for both failures, so this cannot be used to discover
  // whether a contact exists.
  if (!contact || String(contact.email || '').trim().toLowerCase() !== email) {
    console.warn(`[webgate] session refused for contact ${contactId} (no match)`);
    throw new HttpError(403, 'We could not verify that account.');
  }

  const codes = await codesForContact(env, contactId, contact.tags);
  if (!codes.length) throw new HttpError(403, 'That account does not have an active coach subscription.');

  const cfg = await loadRuntimeConfig(env);
  const ttl = Math.max(1, Number(cfg.webSessionHours) || 2) * 3600;
  const token = mintWebSessionToken();

  await env.COACH_KV.put(
    `wtok:${token}`,
    JSON.stringify({ contactId, codes, createdAt: new Date().toISOString() }),
    { expirationTtl: ttl },
  );
  await env.COACH_KV.put(rlKey, String(used + 1), { expirationTtl: MINT_RATE_WINDOW_SECONDS });

  console.log(`[webgate] session for contact ${contactId} codes=${codes.join(',')}`);
  return json({ token, expiresInSeconds: ttl, codes }, 200, cors || {});
}

/** A verified web session, or null. */
async function webSessionFor(env, token) {
  if (typeof token !== 'string') return null;
  const t = token.trim();
  if (!WEB_TOKEN_SHAPE.test(t)) return null;
  const rec = await env.COACH_KV.get(`wtok:${t}`, 'json');
  if (!rec || !Array.isArray(rec.codes) || !rec.codes.length) return null;
  return rec;
}

/** Mode-aware gate for the web endpoints. Mirrors entitlementDecision. */
async function webGateDecision(env, body, path) {
  const cfg = await loadRuntimeConfig(env);
  const mode = cfg.webGateMode || 'off';
  const session = await webSessionFor(env, (body && (body.sessionToken || body.session)) || '');

  if (session || mode === 'off') return { session, mode };

  console.warn(`[webgate] ${mode}: ${path} called without a valid session token`);
  if (mode === 'enforce') {
    throw new HttpError(403, 'Please open your coach from inside your course so we can verify your subscription.');
  }
  return { session: null, mode };
}

/** The requested code if the caller is entitled to it, else their own. */
function pickEntitledCode(session, requested) {
  const allowed = new Set(session.codes.map((c) => String(c).toUpperCase()));
  const wanted = String(requested || '').toUpperCase();
  return allowed.has(wanted) ? wanted : session.codes[0];
}

/**
 * The Voiceflow userID for a web turn.
 *
 * SECURITY: a client-supplied `phone:` identity is never honoured. It used to
 * be — the intent was to merge a web visitor into their SMS history — but it
 * meant anyone who knew a subscriber's number could pass it and resume that
 * person's private conversation. Phone identity is now derived only from a
 * verified session, never from the request body.
 */
async function webUserID(env, session, requested) {
  // A verified member is always `ghl_<contactId>` — the ID the coach page built
  // for itself before it moved behind the Worker, so existing web history
  // carries straight over. Whether SMS and voice JOIN this conversation is the
  // sharedMemory switch (vfUserFor); the web side never changes with it.
  // (Replaces the older `phone:` / `ghl:` choice, which no live page ever used.)
  if (session && session.contactId) return `ghl_${session.contactId}`;

  const raw = typeof requested === 'string' ? requested.trim() : '';
  if (!raw) return `web:${uuid()}`;
  // Anything a client sends is namespaced into `web:`; it can never claim a
  // `phone:` or `ghl:` identity.
  return raw.startsWith('web:') ? raw : `web:${raw.replace(/^(phone|ghl):/, '')}`;
}

/* =========================================================================
 * 16b-bis. Coach page config - GET /api/coach-page?slug=<slug>
 *
 * plans/21 §A. A coach page used to carry its own CONFIG block, hand-edited
 * per author — and on 2026-09-22 six of seven pages had forgotten
 * showActivation, and on 2026-09-28 Freddy's still linked to Stickler's page.
 * With this, a page asks "who is /<slug>?" and the registry answers, so a new
 * author's page is a clone with nothing to edit, and showActivation is decided
 * here rather than remembered there.
 *
 * Public by design — it is exactly what the page already shows. So it returns
 * ONLY display fields: no project/version ids, no GHL ids, and never a key.
 * ========================================================================= */

const SLUG_SHAPE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COACH_PAGE_MAX_AGE = 300; // a registry change reaches pages within 5 min

/** The display config for one coach. An allowlist: nothing else can leak. */
function coachPageConfig(coach) {
  const name = coach.displayName || coach.name || '';
  const label = coach.coachLabel || coach.bookTitle || '';
  const books = (Array.isArray(coach.books) ? coach.books : [])
    .filter((b) => b && b.title && /^https:\/\//.test(String(b.url || '')))
    .map((b) => ({ title: String(b.title), url: String(b.url) }));
  const initials = coach.authorInitials ||
    name.split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase()).filter((_, i, a) => i === 0 || i === a.length - 1).join('');
  return {
    code: String(coach.code),
    authorName: name,
    bookTitle: label,
    pageTitle: `${name} - ${label}`,
    authorInitials: initials,
    authorPhotoURL: /^https:\/\//.test(String(coach.authorPhotoURL || '')) ? coach.authorPhotoURL : '',
    authorURL: /^https:\/\//.test(String(coach.authorURL || '')) ? coach.authorURL : '',
    // Every registered coach is sold with a trial, so every page needs the
    // activation box. Decided here so it can no longer be forgotten there.
    showActivation: true,
    showBooks: books.length > 0,
    showCourses: false,
    books,
    courses: [],
  };
}

async function handleCoachPage(request, env, cors) {
  const slug = String(new URL(request.url).searchParams.get('slug') || '').trim().toLowerCase();
  if (!SLUG_SHAPE.test(slug)) return json({ error: 'slug is required, e.g. ?slug=freddy-davis' }, 400, cors);
  const reg = await loadRegistry(env);
  const coach = [...reg.values()].find((c) => String(c.slug || '').toLowerCase() === slug);
  if (!coach) return json({ error: 'Unknown coach page', slug }, 404, cors);
  return json(coachPageConfig(coach), 200, { ...cors, 'Cache-Control': `public, max-age=${COACH_PAGE_MAX_AGE}` });
}

/* =========================================================================
 * 16c. Shopify order intake - POST /shopify/order
 *
 * The piece that makes this system multi-author. A trial used to start because
 * a GHL workflow contained the literal string `bookcoach-micheal-stickler-active`
 * in an Add Tag action. That cannot scale, for one proven reason: GHL accepts
 * merge-field syntax in Add Tag and NEVER interpolates it - setting the tag to
 * `{{contact.coach_tag}}` tags the contact with that literal string, runs green,
 * and grants nobody anything (proven live 2026-09-12).
 *
 * So the tag cannot come from GHL. It comes from here: Shopify says which
 * PRODUCT was bought, the registry says which COACH that product belongs to,
 * and the Worker applies that coach's tag. Adding an author becomes one object
 * in coaches.json - no workflow edit, no Flow edit.
 *
 * GHL keeps only what it is good at: five emails on a timer, fired by the
 * generic `coach-trial-started` tag, which is identical for every author.
 * ========================================================================= */

/** Shopify retries on any non-2xx and can deliver the same order twice. */
const SHOP_SEEN_TTL_SECONDS = 60 * 60 * 24 * 30;

/** Used when a coach sets no `trialDays`. Matches the shipped 10-day offer. */
const DEFAULT_TRIAL_DAYS = 10;

/** The tag the ONE GHL trial workflow triggers on. Never coach-specific. */
const TRIAL_STARTED_TAG = 'coach-trial-started';

/**
 * Verify Shopify's webhook signature: HMAC-SHA256 of the RAW body, base64,
 * in `X-Shopify-Hmac-Sha256`.
 *
 * This endpoint creates GHL contacts and applies entitlement tags, so an
 * unverified version would let anyone forge themselves a coach. Same role
 * validateTwilio plays for /twilio/*, and the same failure posture: no secret
 * configured means nothing is accepted, rather than everything.
 */
async function verifyShopifyHmac(env, rawBody, signature) {
  const secret = env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret) throw new HttpError(500, 'SHOPIFY_WEBHOOK_SECRET is not set');
  if (!signature) throw new HttpError(403, 'Missing X-Shopify-Hmac-Sha256');

  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody));
  const expected = bytesToBase64(new Uint8Array(mac));
  if (!timingSafeEqual(signature, expected)) throw new HttpError(403, 'Bad Shopify signature');
  return true;
}

/**
 * Two callers, two ways to prove who they are.
 *
 * 1. Shopify's NATIVE order webhook signs the raw body (HMAC-SHA256, base64).
 * 2. Shopify FLOW's `Send HTTP request` action CANNOT sign anything - it has no
 *    HMAC facility - so it presents a shared secret in a header instead, drawn
 *    from a Flow Secret so the value is never visible on the canvas.
 *
 * Flow is the production path (it owns the 21-day wait); the native webhook is
 * the test rig. Both must work, so this accepts either and nothing else.
 *
 * Header lookup is case-insensitive by spec, which matters: Flow rewrites header
 * names to Capitalised-Form, so `x-coach-token` arrives as `X-Coach-Token`.
 */
async function verifyShopifyRequest(env, rawBody, request) {
  const presented = request.headers.get('X-Coach-Token');
  if (presented) {
    const expected = env.FLOW_SHARED_SECRET;
    if (!expected) throw new HttpError(500, 'FLOW_SHARED_SECRET is not set');
    if (!timingSafeEqual(presented, expected)) throw new HttpError(403, 'Bad X-Coach-Token');
    return 'flow';
  }

  const sig = request.headers.get('X-Shopify-Hmac-Sha256');
  if (sig) {
    await verifyShopifyHmac(env, rawBody, sig);
    return 'shopify-hmac';
  }

  // Named explicitly: an unauthenticated call here would create GHL contacts and
  // grant entitlement, so the refusal should say what a legitimate caller sends.
  throw new HttpError(403, 'Unauthenticated: send X-Coach-Token (Flow) or X-Shopify-Hmac-Sha256 (native webhook)');
}

/**
 * Every product id in the order, as strings.
 *
 * Deliberately accepts BOTH shapes, because which one Shopify Flow's
 * `Send HTTP request` can actually build is an open question and the answer
 * must not gate the build:
 *
 *   line_items: [{ product_id: "123" }]      the native webhook shape
 *   product_ids: "123,456"                   a delimited list Flow can always make
 *
 * A GID (`gid://shopify/Product/123`) is reduced to its numeric tail, because
 * that is what Flow's order fields hand out and it would otherwise silently
 * match nothing.
 */
function shopifyProductIds(body) {
  const out = [];
  const push = (v) => {
    if (v === undefined || v === null) return;
    const s = String(v).trim();
    if (!s) return;
    const gid = /^gid:\/\/shopify\/Product\/(\d+)$/.exec(s);
    out.push(gid ? gid[1] : s);
  };

  if (Array.isArray(body && body.line_items)) {
    for (const li of body.line_items) if (li) push(li.product_id ?? li.productId ?? li.id);
  }
  const flat = body && (body.product_ids ?? body.productIds);
  if (typeof flat === 'string') for (const part of flat.split(/[,\s|]+/)) push(part);
  else if (Array.isArray(flat)) for (const part of flat) push(part);

  return [...new Set(out)];
}

/** `gid://shopify/Order/123` and `123` are one order: keep the number. */
function normalizeOrderId(raw) {
  const s = String(raw ?? '').trim();
  const gid = /^gid:\/\/shopify\/Order\/(\d+)$/i.exec(s);
  return gid ? gid[1] : s;
}

/** Product id -> coach entries. Built from the registry, so it never drifts. */
async function coachesForProductIds(env, productIds) {
  const reg = await loadRegistry(env);
  const byProduct = new Map();
  for (const coach of reg.values()) {
    if (coach.shopifyProductId) byProduct.set(String(coach.shopifyProductId), coach);
  }
  const hits = [];
  for (const pid of productIds) {
    const coach = byProduct.get(pid);
    if (coach && !hits.some((c) => c.code === coach.code)) hits.push(coach);
  }
  return hits;
}

/** Shared GHL request shape. Throws on anything that is not 2xx. */
async function ghlRequest(env, path, { method = 'GET', body = null } = {}) {
  const token = env.GHL_API_TOKEN;
  if (!token) throw new HttpError(500, 'GHL_API_TOKEN is not set');
  const res = await fetch(`${GHL_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Version: GHL_VERSION,
      accept: 'application/json',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 200);
    throw new HttpError(502, `GHL ${res.status} on ${method} ${path}: ${detail}`);
  }
  return res.json().catch(() => ({}));
}

/** The contact with this email, or null. Email is GHL's dedupe key. */
async function ghlFindContactByEmail(env, email) {
  const locationId = env.GHL_LOCATION_ID;
  if (!locationId) throw new HttpError(500, 'GHL_LOCATION_ID is not set');
  const data = await ghlRequest(env, '/contacts/search', {
    method: 'POST',
    body: {
      locationId,
      pageLimit: 1,
      filters: [{ field: 'email', operator: 'eq', value: String(email).trim().toLowerCase() }],
    },
  });
  const list = Array.isArray(data.contacts) ? data.contacts : [];
  return list.length ? list[0] : null;
}

/**
 * Custom fields are written by KEY, not by id.
 *
 * Verified against the live API 2026-09-22: `{ key, field_value }` is accepted
 * and lands. Ids are per-location and would have to be re-discovered for every
 * GHL account this is deployed into; keys are stable, readable in a diff, and
 * identical to what the email merge tags already use.
 */
const TRIAL_END_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * The trial end date as a customer reads it: "2 October 2026".
 *
 * Deliberately NOT an ISO string and NOT a GHL date-picker field. This value's
 * only job is to be pasted into a sentence in an email, and `2026-10-02` makes
 * a reader do arithmetic while `10/02/2026` is ambiguous outside the US.
 * Day-Month-Year in full words is unambiguous everywhere.
 */
const formatTrialEnd = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getUTCDate()} ${TRIAL_END_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

const trialFieldPayload = (coach, { source, orderNumber, startedAt, endsAt }) => {
  const f = [
    { key: 'coach_status', field_value: 'trial' },
    { key: 'coach_trial_started', field_value: startedAt },
    // Written so the welcome email can state the exact last day rather than
    // "10 days from today", which is the support ticket this prevents.
    { key: 'coach_trial_ends', field_value: endsAt ? formatTrialEnd(endsAt) : '' },
    { key: 'coach_code', field_value: String(coach.code) },
    { key: 'coach_name', field_value: coach.displayName || coach.name || '' },
    { key: 'coach_book_title', field_value: coach.bookTitle || '' },
    { key: 'coach_link', field_value: coach.courseLessonUrl || '' },
    { key: 'coach_landing_url', field_value: coach.landingPageUrl || '' },
  ];
  if (source) f.push({ key: 'coach_trial_source', field_value: String(source) });
  if (orderNumber) f.push({ key: 'shopify_order_number', field_value: String(orderNumber) });
  // An empty merge field renders as a GAP in a customer email rather than an
  // error, so never write "" over a value that might already be correct.
  return f.filter((x) => x.field_value !== '');
};

/**
 * POST /shopify/order
 *
 * Returns 200 as soon as the decision is made. The GHL writes run in
 * ctx.waitUntil(), because Shopify's webhook timeout is short and a slow GHL
 * must never become a retry storm that grants twice.
 */
async function handleShopifyOrder(request, env, ctx) {
  const rawBody = await request.text();
  const via = await verifyShopifyRequest(env, rawBody, request);

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Invalid JSON body');

  // Three spellings accepted on purpose. `shopify_order_id` / `shopify_order_number`
  // are this project's own payload convention, already live in both Shopify
  // Flows and in test-ghl-webhook.ps1; `id` / `name` are what Shopify's native
  // webhook sends. Rejecting either would be a silent 400 on every order.
  // Reduced to the bare number: Shopify's native webhook sends `18918362284346`
  // and Flow sends `gid://shopify/Order/18918362284346` for the SAME order.
  // Seen on order #4238 (2026-10-01) arriving both ways, 2.5 min apart, and
  // passing the idempotency check twice because the keys differed.
  const orderId = normalizeOrderId(body.order_id ?? body.shopify_order_id ?? body.id);
  const orderNumber = String(body.order_number ?? body.shopify_order_number ?? body.name ?? '').trim();
  const email = String(body.email ?? '').trim().toLowerCase();
  const source = String(body.source ?? 'shopify').trim();

  if (!orderId) throw new HttpError(400, 'order_id is required - it is the idempotency key');

  // --- idempotency, before anything can be granted ------------------------
  const seenKey = `shop:${orderId}`;
  if (await env.COACH_KV.get(seenKey)) {
    console.log(`[shopify] order ${orderId} already seen - ignoring`);
    return json({ ok: true, duplicate: true, matched: 0 });
  }

  // --- which coaches, if any ----------------------------------------------
  const productIds = shopifyProductIds(body);
  const coaches = await coachesForProductIds(env, productIds);

  // Most orders this store takes are ordinary books, and under the multi-author
  // design every one of them reaches this endpoint. No match is the COMMON
  // case, not an error: nothing is written and nothing is raised.
  if (!coaches.length) {
    console.log(`[shopify] order ${orderId} (${via}): no coach product among [${productIds.join(',')}]`);
    return json({ ok: true, matched: 0 });
  }

  if (!email) {
    // A coach bundle with no email cannot be granted to anyone, and silently
    // dropping it would lose a paying customer. Loud, and Shopify will retry.
    throw new HttpError(400, `order ${orderId} matched a coach product but carried no email`);
  }

  // Stored as JSON like every other value in this keyspace, so a future reader
  // can use get(key, 'json') without discovering this one is a bare string.
  await env.COACH_KV.put(
    seenKey,
    JSON.stringify({ seenAt: new Date().toISOString(), orderNumber }),
    { expirationTtl: SHOP_SEEN_TTL_SECONDS },
  );

  const work = grantTrialsForOrder(env, {
    coaches, email, orderId, orderNumber, source,
    firstName: String(body.first_name ?? '').trim(),
    lastName: String(body.last_name ?? '').trim(),
    phone: String(body.phone ?? '').trim(),
  });

  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(work);
  else await work;

  return json({ ok: true, matched: coaches.length, codes: coaches.map((c) => c.code) });
}

/**
 * Upsert the contact, then start a trial for each matched coach.
 *
 * ORDER IS LOAD-BEARING: the `trial:` record is written BEFORE the tag. If this
 * dies between the two, the reader has an expiry record and no tag - which
 * expires harmlessly. The other order leaves a reader entitled with no expiry
 * record: invisible to the sweep, with access forever.
 */
async function grantTrialsForOrder(env, opts) {
  const { coaches, email, orderId, orderNumber, source, firstName, lastName, phone } = opts;
  const locationId = env.GHL_LOCATION_ID;

  try {
    let contact = await ghlFindContactByEmail(env, email);

    if (!contact) {
      const created = await ghlRequest(env, '/contacts/', {
        method: 'POST',
        body: {
          locationId, email,
          ...(firstName ? { firstName } : {}),
          ...(lastName ? { lastName } : {}),
          ...(isE164(phone) ? { phone } : {}),
        },
      });
      contact = created.contact || created;
      console.log(`[shopify] order ${orderId}: created contact ${contact && contact.id}`);
    }

    const contactId = contact && contact.id;
    if (!contactId) throw new HttpError(502, 'GHL returned no contact id');

    const held = new Set(
      (Array.isArray(contact.tags) ? contact.tags : []).map((t) => String(t).toLowerCase()),
    );
    const startedAt = new Date().toISOString().slice(0, 10);
    const granted = [];
    let firstExpiresAt = '';

    for (const coach of coaches) {
      // The per-coach equivalent of the `coach_status is empty` guard. A second
      // order for the same author must not reset that reader's clock.
      const trialKey = `trial:${contactId}:${coach.code}`;
      if (await env.COACH_KV.get(trialKey)) {
        console.log(`[shopify] order ${orderId}: ${contactId} already has a trial for ${coach.code}`);
        continue;
      }
      if (coach.ghlTag && held.has(coach.ghlTag)) {
        console.log(`[shopify] order ${orderId}: ${contactId} already holds ${coach.ghlTag}`);
        continue;
      }

      const days = Number.isInteger(coach.trialDays) ? coach.trialDays : DEFAULT_TRIAL_DAYS;
      const expiresAt = new Date(Date.now() + days * 86400000).toISOString();
      await env.COACH_KV.put(
        trialKey,
        JSON.stringify({ contactId, code: coach.code, startedAt, expiresAt, source, orderId, orderNumber }),
      );
      granted.push(coach);
      // The contact fields describe ONE trial (granted[0]), so the displayed end
      // date must be that same coach's, not the last one looped over.
      if (granted.length === 1) firstExpiresAt = expiresAt;
    }

    if (!granted.length) {
      console.log(`[shopify] order ${orderId}: nothing to grant for ${contactId}`);
      return;
    }

    // One PUT: the coach tags, the workflow trigger tag, and the fields the
    // generic emails read. Fewer calls is fewer ways to half-succeed.
    const tags = [...held];
    for (const c of granted) if (c.ghlTag && !tags.includes(c.ghlTag)) tags.push(c.ghlTag);
    if (!tags.includes(TRIAL_STARTED_TAG)) tags.push(TRIAL_STARTED_TAG);

    await ghlRequest(env, `/contacts/${encodeURIComponent(contactId)}`, {
      method: 'PUT',
      body: {
        tags,
        customFields: trialFieldPayload(granted[0], { source, orderNumber, startedAt, endsAt: firstExpiresAt }),
      },
    });

    console.log(
      `[shopify] order ${orderId}: granted ${granted.map((c) => c.code).join(',')} to ${contactId}`,
    );
  } catch (err) {
    // Logged loudly rather than thrown: this runs inside waitUntil, where a
    // throw reaches nobody. /health does not cover it, so the log IS the alarm.
    console.error(`[shopify] order ${orderId} FAILED: ${err && err.message}`);
  }
}

/* =========================================================================
 * 17. Entitlement gate
 *
 * `entitlementMode` in the KV `config` key decides what happens:
 *   off     — no enforcement at all. Note this does NOT bring the coach menu
 *             back: the menu is removed unconditionally, and the mode governs
 *             only whether entitlement is checked.
 *   warn    — checked and logged, but nobody is turned away. Run here for a few
 *             days and read the logs: it names every subscriber who WOULD have
 *             been refused, which is how a phone that was never linked gets
 *             found before it becomes a support ticket.
 *   enforce — checked and enforced
 *
 * The mode lives in KV rather than wrangler.toml so rolling back is a config
 * push rather than a redeploy. There is no staging (HANDOFF §2), so that
 * distinction matters.
 * ========================================================================= */

const DEFAULT_DECLINE_SMS =
  'This line is for Book Coach AI subscribers. If you have a subscription, ' +
  'open your members area and follow the activation steps to link this phone. ' +
  'Visit book-coach.ai to subscribe.';

const DEFAULT_DECLINE_VOICE =
  'This line is for Book Coach AI subscribers. If you have a subscription, ' +
  'please open your members area to link your phone. Otherwise, visit book coach dot A I. Goodbye.';

/**
 * What this phone number is allowed to reach, or null.
 *
 * Deliberately NOT cached in-isolate. The registry cache at REGISTRY_CACHE_MS
 * is right for coach config, which barely changes; applying the same to
 * entitlement would add that long again to every revocation.
 */
async function entitlementFor(env, phone) {
  if (!phone) return null;
  const rec = await env.COACH_KV.get(`sub:${phone}`, 'json');
  if (!rec || !Array.isArray(rec.codes) || !rec.codes.length) return null;

  // An expired lease means the reconcile has stopped renewing it — either the
  // subscription ended or the GHL sync is broken. Both are "no access", and
  // the /health lastSyncAge alarm is what distinguishes them.
  if (rec.expires && new Date(rec.expires).getTime() < Date.now()) return null;

  return { contactId: rec.contactId || null, codes: rec.codes };
}

/**
 * Resolve free text to a coach the caller is actually entitled to.
 *
 * This, not the removal of the menu, is what stops anyone reaching any coach:
 * with one entitled code the input is not consulted at all, so knowing another
 * author's code or saying their name cannot route anywhere.
 */
async function resolveEntitledCoach(env, input, codes) {
  if (!Array.isArray(codes) || !codes.length) return null;
  const reg = await loadRegistry(env);

  if (codes.length === 1) return reg.get(String(codes[0]).toUpperCase()) || null;

  const allowed = new Set(codes.map((c) => String(c).toUpperCase()));
  const candidate = await resolveCoach(env, input);
  if (candidate && allowed.has(String(candidate.code).toUpperCase())) return candidate;
  return null;
}

const declineSmsText = (cfg) => (cfg && cfg.declineSms) || DEFAULT_DECLINE_SMS;
const declineVoiceText = (cfg) => (cfg && cfg.declineVoice) || DEFAULT_DECLINE_VOICE;

/**
 * The single decision point for both channels.
 * Returns { allow, entitlement, mode } — `allow` is already mode-aware, so a
 * caller never has to remember which mode is in force.
 */
async function entitlementDecision(env, phone, channel) {
  const cfg = await loadRuntimeConfig(env);
  const mode = cfg.entitlementMode || 'off';

  if (mode === 'off') return { allow: true, entitlement: null, mode, cfg };

  const entitlement = await entitlementFor(env, phone);
  if (entitlement) return { allow: true, entitlement, mode, cfg };

  // The log line warn mode exists to produce.
  console.warn(`[entitlement] ${mode}: ${channel} from ${phone} has no active entitlement`);
  return { allow: mode === 'warn', entitlement: null, mode, cfg };
}

/* =========================================================================
 * 18. Router
 * ========================================================================= */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    try {
      if (request.method === 'OPTIONS') {
        const cors = corsHeaders(request, env);
        if (!cors) {
          // Name the origin that was refused. Without this a CORS rejection is
          // invisible from the browser side — the failed response cannot carry
          // ACAO, so the page only ever sees a generic network error.
          console.warn(`[cors] preflight refused for origin: ${JSON.stringify(request.headers.get('Origin'))} path=${path}`);
        }
        return new Response(null, { status: cors ? 204 : 403, headers: cors || {} });
      }

      if (path === '/health' && request.method === 'GET') return handleHealth(request, env);

      // Run the reconcile on demand instead of waiting for the cron. Gated by
      // the same fail-closed HEALTH_TOKEN check as /health detail, so with no
      // token set nobody can reach it. `dry=1` reports without writing;
      // `force=1` overrides the mass-revocation guard and is therefore
      // destructive — it exists for the case where a large churn is genuine.
      if (path === '/admin/reconcile') {
        if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
        if (!healthDetailAllowed(request, env)) return json({ error: 'Forbidden' }, 403);
        const report = await runReconcile(env, {
          dryRun: url.searchParams.get('dry') === '1',
          force: url.searchParams.get('force') === '1',
        });
        return json(report, report.ok ? 200 : 502);
      }

      // --- Shopify order webhook -------------------------------------------
      // Signed with its own secret, so it needs no CORS and no health token.
      if (path === '/shopify/order') {
        if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
        return await handleShopifyOrder(request, env, ctx);
      }

      // --- Twilio webhooks -------------------------------------------------
      if (path.startsWith(TWILIO_PREFIX)) {
        if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
        if (path === '/twilio/sms') return await handleSms(request, env);
        if (path === '/twilio/voice') return await handleVoiceEntry(request, env);
        if (path === '/twilio/voice/route') return await handleVoiceRoute(request, env);
        if (path === '/twilio/voice/turn') return await handleVoiceTurn(request, env, ctx);
        if (path === '/twilio/voice/wait') return await handleVoiceWait(request, env);
        return new Response('Not Found', { status: 404 });
      }

      // --- Coach page config (GET, public display fields only) --------------
      if (path === '/api/coach-page') {
        if (request.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
        const cors = corsHeaders(request, env);
        if (!cors) return json({ error: 'Origin not allowed', origin: request.headers.get('Origin') || null }, 403);
        return await handleCoachPage(request, env, cors);
      }

      // --- Web endpoints ---------------------------------------------------
      if (
        path === '/api/vf-interact' ||
        path === '/api/vf-state' ||
        path === '/api/heygen-token' ||
        path === '/api/bind/mint' ||
        path === '/api/web/session' ||
        path === '/api/bind/status'
      ) {
        if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
        const cors = corsHeaders(request, env);
        if (!cors) {
          const seen = request.headers.get('Origin');
          console.warn(`[cors] refused origin: ${JSON.stringify(seen)} path=${path}`);
          // Echo it back: it is the caller's own origin, so no disclosure, and
          // it turns an opaque failure into a self-explaining one.
          return json({ error: 'Origin not allowed', origin: seen || null }, 403);
        }
        if (path === '/api/vf-interact') return await handleVfInteract(request, env, cors);
        if (path === '/api/vf-state') return await handleVfState(request, env, cors);
        if (path === '/api/bind/mint') return await handleBindMint(request, env, cors);
        if (path === '/api/bind/status') return await handleBindStatus(request, env, cors);
        if (path === '/api/web/session') return await handleWebSession(request, env, cors);
        return await handleHeygenToken(request, env, cors);
      }

      return new Response('Not Found', { status: 404 });
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      console.error(`[${status}] ${path}: ${err && err.message}`);

      // A Twilio webhook must always get valid TwiML, even on failure, or the
      // caller hears Twilio's generic error message.
      if (path.startsWith(TWILIO_PREFIX) && status !== 403) {
        if (path === '/twilio/sms') {
          return smsReply('Sorry — something went wrong on our end. Please try again in a moment.');
        }
        return twiml(
          `<Response><Say voice="${xmlEscape(env.DEFAULT_TTS_VOICE || 'Polly.Matthew-Neural')}">Sorry, something went wrong on our end. Please try your call again shortly. Goodbye.</Say><Hangup/></Response>`,
        );
      }

      // Error responses on the browser-facing endpoints MUST carry the CORS
      // headers too. Without them the browser cannot read the body and reports
      // a generic "CORS header missing" instead of the actual message — so a
      // rate limit or a failed verification looks like a network outage.
      const errCors = path.startsWith('/api/') ? corsHeaders(request, env) : null;
      return json({ error: err && err.message ? err.message : 'Internal error' }, status, errCors || {});
    }
  },

  /**
   * Cron. Reconciles subscriber entitlement against GoHighLevel.
   * Populates KV only — nothing here denies anyone. Enforcement is gated
   * separately by `entitlementMode` in the KV `config` key.
   */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runReconcile(env));
  },
};

/**
 * Pure helpers exported for unit testing only. Not part of the Worker's runtime
 * surface — nothing routes here.
 */
export const __test = {
  coachPageConfig,
  handleCoachPage,
  applySubscriptionTags,
  ghlAddTags,
  sweepExpiredTrials,
  ghlRemoveTag,
  formatTrialEnd,
  verifyShopifyRequest,
  ghlSearchByTags,
  handleShopifyOrder,
  shopifyProductIds,
  coachesForProductIds,
  verifyShopifyHmac,
  trialFieldPayload,
  TRIAL_STARTED_TAG,
  DEFAULT_TRIAL_DAYS,
  normalizePhone,
  touchSession,
  codesForContact,
  listContactEntitlements,
  handleHealth,
  toGsm7,
  stripMarkdown,
  capSms,
  sanitizeForSpeech,
  flattenTraces,
  looksLikeCrisis,
  isE164,
  xmlEscape,
  validateTwilio,
  reconcileEntitlements,
  listSubscribers,
  ghlActiveSubscriptions,
  GHL_SUB_ACTIVE,
  entitlementFor,
  resolveEntitledCoach,
  entitlementDecision,
  speechHints,
  loadRegistry,
  sweepArchives,
  webSessionFor,
  webGateDecision,
  pickEntitledCode,
  webUserID,
  mintWebSessionToken,
  handleBindStatus,
  mintTokenValue,
  redeemBindToken,
  codesForTags,
  TOKEN_SHAPE,
  // Tests only. The registry and config caches are module-level and live for
  // 60s/30s, which is right in production and wrong across test cases.
  __resetCaches: () => {
    _registryCache = { at: 0, byCode: null };
    _configCache = { at: 0, value: null };
  },
  revokeSubscriber,
  loadRuntimeConfig,
  // Shared memory across channels (plans/10-shared-memory-across-channels.md)
  sharedMemoryOn,
  vfUserFor,
  vfIsLive,
  voiceSessionFor,
  handleSms,
  handleVoiceEntry,
  handleVfInteract,
  handleVfState,
};
