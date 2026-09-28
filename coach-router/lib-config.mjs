/**
 * lib-config.mjs — reads coaches.json, the single source of truth.
 *
 * coaches.json is gitignored and never deployed. It holds everything: codes,
 * names, aliases, Voiceflow IDs, API keys, shared Twilio/HeyGen credentials.
 * Every script reads it through here, so a value is only ever typed once.
 *
 * The KV/secret split is enforced HERE rather than by the caller:
 *
 *   registryValue(coach)  ->  the exact object written to KV, built from an
 *                             ALLOWLIST, so a field added to coaches.json can
 *                             never leak a credential into KV by accident.
 *   coach.apiKey          ->  the Voiceflow key. Pushed to a Worker secret by
 *                             sync-secrets.mjs; never returned by registryValue.
 *
 * At runtime the Worker reads non-secret config from KV and keys from Worker
 * secrets. It never sees this file.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const CONFIG_FILE = resolve(HERE, 'coaches.json');

/** Fields that may be written to KV. Anything else is dropped. */
const KV_FIELDS = [
  'name',
  // The customer-facing spelling, which is deliberately NOT always `name`.
  // `name` is the internal match key (the author spells his own first name
  // "Micheal"); `displayName` is what appears in copy. Normalising one to the
  // other breaks either entitlement or the emails, so both are stored.
  'displayName',
  // The book this coach is derived from. Populates the `coach_book_title`
  // GHL field, which the day-9 and day-10 emails read.
  'bookTitle',
  'aliases',
  'projectID',
  'versionID',
  'keyVar',
  'heygenAvatarID',
  'heygenVoiceID',
  'voiceMode',
  'dialNumber',
  'ttsVoice',
  'ghlTag',
  // The GHL recurring product a subscription must reference to grant this
  // coach. Read by the reconcile; `ghlTag` remains the manual override.
  'ghlProductId',
  // Where to send someone who wants to subscribe. Not used by the Worker's
  // request path - stored here so it lives in one place, not per page.
  'landingPageUrl',
  // The Shopify bundle product whose purchase starts a trial for this coach.
  // The mapping key for POST /shopify/order. Chosen over the handle or the URL
  // because it is what Shopify actually sends, and it survives a rename.
  'shopifyProductId',
  // The Course360 lesson holding this coach's iframe. Populates the
  // `coach_link` GHL field, which every trial email links to.
  'courseLessonUrl',
  // How long this coach's trial runs. Per-coach so a different book can have a
  // different length without a code change. Defaults to 10 where unset.
  'trialDays',
  // true/false overrides config.sharedMemory for this coach only. Absent means
  // "follow the global switch". See plans/10-shared-memory-across-channels.md.
  'sharedMemory',
];

/** Worker secret name -> key in coaches.json "shared". */
export const SHARED_SECRETS = {
  TWILIO_ACCOUNT_SID: 'twilioAccountSid',
  TWILIO_AUTH_TOKEN: 'twilioAuthToken',
  HEYGEN_API_KEY: 'heygenApiKey',
  // Gates the per-coach detail on GET /health, which lists coach codes.
  HEALTH_TOKEN: 'healthToken',
  // GoHighLevel (Course360) Private Integration Token. Read only by the cron
  // reconcile, never on the request path.
  GHL_API_TOKEN: 'ghlApiToken',
  // Signs Shopify's order webhooks. POST /shopify/order creates GHL contacts
  // and applies entitlement tags, so an unverified version would let anyone
  // forge a subscriber. Same role TWILIO_AUTH_TOKEN plays for /twilio/*.
  SHOPIFY_WEBHOOK_SECRET: 'shopifyWebhookSecret',
  // Shopify Flow's Send HTTP request action cannot produce an HMAC, so the Flow
  // presents this shared secret in an X-Coach-Token header instead. Stored as a
  // Flow Secret on the Shopify side so it never shows on the canvas.
  FLOW_SHARED_SECRET: 'flowSharedSecret',
};

/** wrangler.toml [vars] name -> key in coaches.json "shared". Not secrets. */
export const SHARED_VARS = {
  PUBLIC_TWILIO_NUMBER: 'publicTwilioNumber',
  ALLOWED_ORIGIN: 'allowedOrigin',
  GHL_LOCATION_ID: 'ghlLocationId',
};

/**
 * Load coaches.json. Returns { shared, coaches }.
 *
 * Defaults are applied here (versionID, voiceMode, aliases) so an entry can be
 * as short as code + name + projectID + vfKey. Validation is the caller's job,
 * so a dry run can report every problem at once.
 */
export function loadConfig({ file = CONFIG_FILE, allowMissing = false } = {}) {
  if (!existsSync(file)) {
    if (allowMissing) return { shared: {}, coaches: [], missing: true };
    throw new Error(
      `${file} not found.\n\n` + `Create it by copying the template, then fill it in:\n` + `  cp coaches.example.json coaches.json\n`
    );
  }

  let parsed;
  const text = readFileSync(file, 'utf8');
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    // Hand-edited JSON: point at the actual line rather than a byte offset.
    const at = /position (\d+)/.exec(err.message);
    let where = '';
    if (at) {
      const upto = text.slice(0, Number(at[1]));
      const line = upto.split('\n').length;
      where = `\n  at line ${line}: ${text.split('\n')[line - 1]?.trim() || ''}`;
    }
    throw new Error(
      `coaches.json is not valid JSON — ${err.message}${where}\n\n` +
        `  Common causes: a trailing comma after the last item, a missing comma\n` +
        `  between two entries, or a quote left off a value.\n`
    );
  }

  const shared = parsed.shared || {};
  const list = Array.isArray(parsed.coaches) ? parsed.coaches : [];

  const coaches = list.map((c, i) => {
    const code = String(c.code ?? '').trim();
    const keyVar = `VF_KEY_${code}`;
    return {
      aliases: [],
      versionID: 'production',
      voiceMode: 'inline',
      ...c,
      code,
      index: i,
      // Derived, not authored: the Worker looks up this secret name at runtime.
      keyVar,
      // A real environment variable wins, so CI can inject without the file.
      apiKey: process.env[keyVar] || c.vfKey || '',
      // GHL stores tags lowercased, so a tag typed here with capitals would
      // never match what the contacts/search filter returns. Normalise rather
      // than warn — the failure it prevents is silent (zero contacts matched).
      ghlTag: String(c.ghlTag || '').trim().toLowerCase() || undefined,
      // Shopify ids are long numerics. JSON lets them be authored as numbers,
      // which would then never === the string Shopify sends in the webhook.
      // Normalise to a string here so the mapping cannot fail on a type.
      shopifyProductId:
        c.shopifyProductId === undefined || c.shopifyProductId === null || c.shopifyProductId === ''
          ? undefined
          : String(c.shopifyProductId).trim(),
    };
  });

  return { shared, coaches, missing: false };
}

/**
 * The object written to `coach:<CODE>` in KV. Allowlisted, so credentials
 * cannot travel with it. Empty optional fields are omitted rather than stored
 * as "" — the Worker already treats absent as unset.
 */
export function registryValue(coach) {
  const out = {};
  for (const f of KV_FIELDS) {
    const v = coach[f];
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v) && !v.length) continue;
    out[f] = v;
  }
  return out;
}

/** Belt and braces on the write path: nothing secret-looking reaches KV. */
export function assertNoSecrets(value) {
  const json = JSON.stringify(value);
  // `pit-` is matched with a length floor so an ordinary word could never trip
  // it — a GHL Private Integration Token is `pit-` plus a UUID.
  if (/VF\.DM|"vfKey"|"apiKey"|"ghlApiToken"|"shopifyWebhookSecret"|"flowSharedSecret"|sk-|AC[0-9a-f]{32}|pit-[0-9a-f-]{30,}/i.test(json)) {
    throw new Error(`Refusing to write a value that looks like it contains a credential: ${json.slice(0, 120)}`);
  }
}

/**
 * Runtime knobs the Worker reads from the KV key `config` rather than from
 * wrangler.toml [vars], so changing one is `npm run push` — no redeploy. That
 * matters because there is no staging: every deploy is live (HANDOFF.md §2).
 *
 * Defaults live here. Override any of them in coaches.json under
 * `shared.config`; anything not named here is dropped, same as KV_FIELDS.
 */
export const CONFIG_DEFAULTS = {
  // off     — ignore entitlement entirely (current behaviour)
  // warn    — check, log what would have been denied, admit anyway
  // enforce — check and deny
  entitlementMode: 'off',
  // Hours a `sub:` lease stays valid without the reconcile renewing it. If the
  // GHL sync breaks, access decays after this instead of persisting forever.
  leaseHours: 48,
  // Days a revoked subscriber's conversation is kept before deletion.
  archiveRetentionDays: 30,
  // Days-before-deletion at which to send a reminder. Empty array = none.
  archiveReminderDays: [15, 5],
  // Master switch for the destructive half of the archive sweep.
  archiveAutoDelete: true,
  // Whether the reconcile applies a coach's tag to a contact entitled by an
  // ACTIVE SUBSCRIPTION that does not already hold it.
  //
  //   off - do nothing (the shipped default)
  //   dry - report who would be tagged, write nothing
  //   on  - apply the tag and set coach_status = active
  //
  // This is what lets the per-author `Coach Subscription Started` workflow be
  // deleted: the course-grant workflow triggers on the coach tag, so applying
  // it here serves purchases and trials through one mechanism.
  tagOnSubscription: 'off',
  // Whether the Worker ends trials whose time is up.
  //
  //   off - do nothing (the shipped default)
  //   dry - report what would expire, write nothing
  //   on  - remove the coach tag and set coach_status = expired
  //
  // Ships OFF because turning it on is the moment trials start ENDING. Before
  // that, day 10 is a GHL workflow action holding one author's literal tag -
  // correct for that author, and a silent no-op for every other.
  trialExpiryMode: 'off',
  // GHL tag granting every coach, for internal testing without a real
  // subscription. Empty disables it.
  staffTag: '',
  // What a non-subscriber is told. Blank uses the Worker's built-in wording.
  // Must never name another coach - that is what the removed menu did.
  declineSms: '',
  declineVoice: '',
  // The web coach page gate, same three positions as entitlementMode. Separate
  // because the web page has to be updated to send a session token before it
  // can be enforced, and that is a different day's work from SMS and voice.
  webGateMode: 'off',
  // How long a web session token is good for. It is an opaque bearer token
  // living in an iframe URL, so short enough to limit a leak, long enough not
  // to expire mid-conversation.
  webSessionHours: 2,
  // Stripe test-mode subscriptions appear in GHL's API exactly like live ones.
  // Honouring them lets the whole chain be tested without spending money.
  // SET THIS TO false AT LAUNCH: a test payment must not grant real access.
  allowTestSubscriptions: true,
  // Whether the reconcile may link a handset from a phone number it finds on
  // the GHL contact or subscription, with no activation code.
  //
  // DECIDED 2026-09-17: false. Activation is by texted code ONLY — supplying a
  // phone on a form must not grant a working handset. Kept as a flag rather
  // than deleted so it is reversible with `npm run seed`, no redeploy.
  autoLinkGhlPhone: false,
  // How long /health tolerates silence from the cron before calling it dead.
  //
  // This CANNOT be tightened to the cron interval, and the reason is easy to
  // get wrong: `syncmeta` is written frugally — when nothing changed, only once
  // an hour (SYNCMETA_HEARTBEAT_MS). So `lastRunAt` legitimately lags a HEALTHY
  // cron by up to an hour, and `ageMinutes` measures "time since syncmeta was
  // last written", NOT "time since the cron last ran". Anything at or below the
  // heartbeat produces constant false alarms on a working system.
  //
  // 90 = the 60-minute heartbeat plus a 30-minute margin. A genuinely dead cron
  // is caught within ~90 minutes, which is ample against a 48h lease.
  cronStaleAfterMinutes: 90,
  // Whether SMS and voice share one Voiceflow conversation with the web page.
  //
  //   off - SMS/voice use `phone:<E.164>`, separate from the web (the old behaviour)
  //   on  - a linked handset uses `ghl_<contactId>`, the same userID the web
  //         page builds, so the coach continues one conversation everywhere
  //
  // A coach's own `sharedMemory: true|false` in coaches.json overrides this.
  // Reversible: switching off returns to the `phone:` conversation, untouched.
  sharedMemory: 'off',
};

export const ENTITLEMENT_MODES = new Set(['off', 'warn', 'enforce']);

/** The object written to the `config` key in KV: defaults, then shared.config. */
export function runtimeConfig(shared = {}) {
  const out = { ...CONFIG_DEFAULTS };
  const over = (shared && shared.config) || {};
  for (const k of Object.keys(CONFIG_DEFAULTS)) {
    if (over[k] !== undefined) out[k] = over[k];
  }
  return out;
}

/** Validate a runtimeConfig object. Returns problem strings; empty means good. */
/** Positions for the trial expiry sweep. Deliberately NOT the entitlement set:
 *  "warn" would imply admitting someone, which makes no sense for expiry. */
const TRIAL_EXPIRY_MODES = new Set(['off', 'dry', 'on']);

export function configProblems(cfg) {
  const p = [];
  if (!ENTITLEMENT_MODES.has(cfg.entitlementMode)) {
    p.push(`config.entitlementMode "${cfg.entitlementMode}" must be one of: ${[...ENTITLEMENT_MODES].join(', ')}`);
  }
  for (const k of ['leaseHours', 'archiveRetentionDays']) {
    if (!Number.isFinite(cfg[k]) || cfg[k] <= 0) p.push(`config.${k} must be a positive number`);
  }
  if (typeof cfg.allowTestSubscriptions !== 'boolean') {
    p.push('config.allowTestSubscriptions must be true or false');
  }
  if (typeof cfg.autoLinkGhlPhone !== 'boolean') {
    p.push('config.autoLinkGhlPhone must be true or false');
  }
  // The floor is not style — at or below the syncmeta heartbeat this alarm
  // fires on a perfectly healthy system, every time nothing has changed.
  if (!Number.isFinite(cfg.cronStaleAfterMinutes) || cfg.cronStaleAfterMinutes <= 60) {
    p.push(
      'config.cronStaleAfterMinutes must be a number greater than 60 — `syncmeta` is only ' +
        'rewritten once an hour when nothing changes, so a lower value alarms on a healthy cron',
    );
  }
  if (typeof cfg.archiveAutoDelete !== 'boolean') {
    p.push('config.archiveAutoDelete must be true or false');
  }
  if (!ENTITLEMENT_MODES.has(cfg.webGateMode)) {
    p.push(`config.webGateMode "${cfg.webGateMode}" must be one of: ${[...ENTITLEMENT_MODES].join(', ')}`);
  }
  if (!Number.isFinite(cfg.webSessionHours) || cfg.webSessionHours <= 0) {
    p.push('config.webSessionHours must be a positive number');
  }
  for (const k of ['staffTag', 'declineSms', 'declineVoice']) {
    if (typeof cfg[k] !== 'string') p.push(`config.${k} must be a string (use "" for the default)`);
  }
  if (!TRIAL_EXPIRY_MODES.has(cfg.tagOnSubscription)) {
    p.push(`config.tagOnSubscription "${cfg.tagOnSubscription}" must be one of: ${[...TRIAL_EXPIRY_MODES].join(', ')}`);
  }
  if (!TRIAL_EXPIRY_MODES.has(cfg.trialExpiryMode)) {
    p.push(`config.trialExpiryMode "${cfg.trialExpiryMode}" must be one of: ${[...TRIAL_EXPIRY_MODES].join(', ')}`);
  }
  if (cfg.sharedMemory !== 'on' && cfg.sharedMemory !== 'off') {
    p.push(`config.sharedMemory "${cfg.sharedMemory}" must be "on" or "off"`);
  }
  if (cfg.staffTag && /[,\s]/.test(cfg.staffTag)) {
    p.push('config.staffTag must not contain spaces or commas - the GHL tag filter cannot match it');
  }
  if (!Array.isArray(cfg.archiveReminderDays) || cfg.archiveReminderDays.some((d) => !Number.isFinite(d) || d < 0)) {
    p.push('config.archiveReminderDays must be an array of non-negative numbers');
  } else if (Number.isFinite(cfg.archiveRetentionDays) && cfg.archiveReminderDays.some((d) => d >= cfg.archiveRetentionDays)) {
    // A reminder at or beyond the retention window can never fire: the record
    // is deleted on the same sweep that would have sent it.
    p.push(
      `config.archiveReminderDays must all be less than archiveRetentionDays (${cfg.archiveRetentionDays}) — ` +
        `a reminder at or beyond retention would never fire`
    );
  }
  return p;
}

/**
 * Cross-coach and multi-author field validation.
 *
 * Separate from the per-coach checks in seed-coaches.mjs because these are the
 * ones that only exist once there is more than one author, and because a pure
 * function can be tested. seed-coaches.mjs keeps the warnings; everything
 * returned here is fatal and refuses the write.
 *
 * The uniqueness checks are the point of this function. At one coach a shared
 * `ghlTag` or `shopifyProductId` is unthinkable; at fifteen it is one
 * copy-paste away, and the result is that buying one author's book silently
 * grants a different author's coach.
 */
export function coachProblems(coaches = []) {
  const p = [];
  const seen = { ghlTag: new Map(), shopifyProductId: new Map(), ghlProductId: new Map() };

  for (const coach of coaches) {
    const where = coach.code ? `coach "${coach.code}"` : `coaches[${coach.index}]`;

    // --- uniqueness: two coaches must never share an identity key ----------
    for (const field of ['ghlTag', 'shopifyProductId', 'ghlProductId']) {
      const raw = coach[field];
      if (raw === undefined || raw === null || raw === '') continue;
      const key = String(raw).trim().toLowerCase();
      const prior = seen[field].get(key);
      if (prior !== undefined) {
        p.push(
          `${where}: duplicate ${field} "${raw}" — also used by coaches[${prior}]. ` +
            `Two coaches sharing this cross-grant entitlement: a buyer of one gets the other.`,
        );
      } else {
        seen[field].set(key, coach.index);
      }
    }

    // --- the tag namespace is not ours alone -------------------------------
    // GHL mirrors Shopify ORDER tags onto contacts as `shopify_<tag>` — a live
    // integration nothing in this project wrote. A coach tag in that namespace
    // would hand entitlement to an order tag.
    if (coach.ghlTag && /^shopify_/.test(coach.ghlTag)) {
      p.push(
        `${where}: ghlTag "${coach.ghlTag}" is in the shopify_ namespace, which GHL populates ` +
          `from Shopify order tags. Entitlement would be granted by an order tag. Rename it.`,
      );
    }

    // --- shopifyProductId must be what Shopify actually sends --------------
    if (coach.shopifyProductId !== undefined && !/^\d+$/.test(coach.shopifyProductId)) {
      const looksLikeGid = /^gid:\/\//.test(coach.shopifyProductId);
      p.push(
        `${where}: shopifyProductId "${coach.shopifyProductId}" must be digits only` +
          (looksLikeGid
            ? ' — that is a GID. Use the numeric id from the end of it, or no order will ever match.'
            : ' — a non-numeric id matches no line item, so no purchase starts a trial.'),
      );
    }

    // --- courseLessonUrl: the member URL, not the builder URL --------------
    if (coach.courseLessonUrl !== undefined && coach.courseLessonUrl !== '') {
      const url = String(coach.courseLessonUrl);
      if (!/^https:\/\//.test(url)) {
        p.push(`${where}: courseLessonUrl must start with https://`);
      }
      if (/app\.coursecreator360\.com/.test(url)) {
        p.push(
          `${where}: courseLessonUrl points at app.coursecreator360.com, which is the course ` +
            `BUILDER and returns 404 for members. Use the login.* member URL.`,
        );
      }
      if (/is_preview=true/.test(url)) {
        p.push(`${where}: courseLessonUrl carries is_preview=true — strip it, or members see a preview shell`);
      }
    }

    // --- sharedMemory: a real boolean, or absent ---------------------------
    // "on"/"off" strings are the GLOBAL switch's spelling; accepting them here
    // would make "false" (a truthy string) silently mean on.
    if (coach.sharedMemory !== undefined && typeof coach.sharedMemory !== 'boolean') {
      p.push(`${where}: sharedMemory must be true or false (or left out to follow config.sharedMemory)`);
    }

    // --- trialDays ---------------------------------------------------------
    if (coach.trialDays !== undefined) {
      const d = coach.trialDays;
      if (!Number.isInteger(d) || d < 1 || d > 90) {
        p.push(
          `${where}: trialDays "${d}" must be a whole number of days between 1 and 90 ` +
            `(Shopify Flow's Wait caps at 90 days per workflow)`,
        );
      }
    }
  }

  return p;
}

/** True when a value is still an unfilled template placeholder. */
export const isPlaceholder = (v) =>
  typeof v === 'string' && (/^TODO_/.test(v.trim()) || /^(TODO|CHANGEME|xxx+)$/i.test(v.trim()));

/** True when a string is filled in and not a placeholder. */
export const isUsable = (v) => typeof v === 'string' && v.trim() !== '' && !isPlaceholder(v);
