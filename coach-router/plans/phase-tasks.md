# Phase task checklist

Execution detail for [`subscriber-entitlement.md`](subscriber-entitlement.md). That document holds
the *why*; this one holds the *what*, task by task. Line references are into
`../coach-router.worker.js` unless stated.

**Legend:** ☐ to do · ✅ done · ⚠ decision needed from Muhammad · 🔬 spike (answer unknown today)

---

## Phase 0 — Groundwork: config plumbing ✅ DONE 2026-08-25

- ✅ `ghlTag` added to `KV_FIELDS` (`lib-config.mjs`)
- ✅ `GHL_API_TOKEN` → `SHARED_SECRETS`, `GHL_LOCATION_ID` → `SHARED_VARS`
- ✅ `assertNoSecrets` extended for `pit-` tokens and the `ghlApiToken` field name, with a length
  floor so an ordinary word (`Pit Crew`) cannot trip it
- ✅ `CONFIG_DEFAULTS`, `runtimeConfig()`, `configProblems()` added
- ✅ `ghlTag` lowercased and trimmed on load — GHL stores tags lowercase, so a capitalised tag
  would match zero contacts and fail silently
- ✅ `coaches.json`: tag set on 1042, `shared.config` block added
- ✅ `seed-coaches.mjs`: validates tag + config, writes the `config` KV key, `--list` shows both
- ✅ `wrangler.toml`: `GHL_LOCATION_ID` var, `GHL_API_TOKEN` documented in the secrets block
- ✅ `coaches.example.json` + README field reference updated
- ✅ Tests 46 → 61
- ✅ Pushed to production; `/health` `ok:true`, `problemCount:0`

---

## Phase 1 — Transcript capture

**Why first:** nothing is recorded today. `vfInteract` (`:465`) sends no transcript config, and GHL
step 9 is unbuilt, so Voiceflow state is the only copy of every conversation. Capture can only ever
record *forward* from the day it ships, so everything downstream waits on it.

### 1a. Spike 🔬

- ☐ Determine whether Voiceflow persists a transcript for a `userID` against a **draft** version ID
  (the project is unpublished — HANDOFF §2)
- ☐ Test the Transcripts API: does saving require a `sessionID` the Dialog API does not currently send?
- ☐ Check whether the interact `config` object accepts a transcript-related flag
- ☐ Budget: 2-3 billable Voiceflow requests
- ☐ **Decision gate:** Voiceflow-native retention vs Worker-side capture

### 1b. If Voiceflow-native

- ☐ Add the transcript save call after each interact, inside `ctx.waitUntil()`
- ☐ Implement `exportTranscript(env, coach, userID)` → normalised JSON
- ☐ Confirm a saved transcript is retrievable by `userID` weeks later

### 1c. If Worker-side (fallback)

- ☐ **One KV key per turn**, `tx:<userID>:<ISO-timestamp>` — deliberately *not* one growing key.
  KV has no append, so a single key needs read-modify-write, which races when SMS and voice
  overlap on the same `userID`. Write-only keys cannot race.
- ☐ Value shape: `{ ts, channel, role, text, coachCode }`
- ☐ `exportTranscript()` = KV list by prefix + get each + sort by timestamp
- ☐ Note the cost: one extra KV write per turn (well inside free-tier limits at this volume)

### 1d. Common to both

- ☐ **Thread `ctx` into `handleSms` and `handleVfInteract`** — router `:1314` and `:1327`.
  `handleVoiceTurn` already receives it; the other two do not.
- ☐ Write `captureTurn(env, ctx, coach, userID, channel, userText, replyText)`
- ☐ Wire every call site: `handleSms` (`:661`), `startCoachOverSms` (`:688`),
  `voiceInlineStart`, `handleVoiceTurn`, `handleVfInteract`
- ☐ **`handleVoiceWait` (`:1036`) especially** — it speaks a reply generated during a *previous*
  request. Miss it and every slow voice answer goes unrecorded.
- ☐ All capture through `ctx.waitUntil()`. Voice already races an 8s soft deadline against
  Twilio's 15s ceiling (HANDOFF §6.11) — nothing here may add to that path.

### Verify

- ☐ Send an SMS, place a call, load a web page — all three produce a retrievable transcript
- ☐ Confirm `/twilio/voice/turn` timings are unchanged in the Worker logs
- ☐ Requires a real `wrangler deploy` — the first phase that touches the Worker

---

## Phase 2 — Entitlement store & reconcile

**Populates only. Enforces nothing.** Safe to run in production with `entitlementMode: off`.

### 2a. Cron plumbing

- ☐ `wrangler.toml`: `[triggers] crons = ["*/5 * * * *"]`
- ☐ Add a `scheduled(event, env, ctx)` export beside `fetch` (`:1298`) — purely additive
- ☐ Confirm cron triggers are available on the current Cloudflare plan

### 2b. GHL client (no dependencies, inside the Worker)

- ☐ `ghlSearchByTag(env, tag, cursor)` → `POST /contacts/search`, filter `tags contains <tag>`
- ☐ Headers: `Authorization: Bearer`, `Version: 2021-07-28`, `Accept: application/json`
- ☐ Paginate with `searchAfter`, with a hard page cap as a runaway guard
- ☐ **Fail safe on API error.** A `401`/`403`/timeout must never be read as "everyone churned".
  Only revoke when the fetch actually succeeded; otherwise log, set `syncmeta.lastOk = false`,
  and change nothing.

### 2c. Reconcile algorithm

- ☐ Load the registry; collect every coach with a `ghlTag`, plus the staff tag
- ☐ For each tag → set of `contactId`s → build `contactId → codes[]`
- ☐ For each entitled contact: read `contact:<id>` → phones → renew `sub:<phone>` with
  `expires = now + leaseHours`
- ☐ Detect revocations by listing the `sub:` prefix and diffing against the entitled set
- ☐ Revoke = delete `sub:`, **keep `bind:`**, create `arch:`, clear `sess:sms:` and `sess:voice:`
  so a live conversation cannot outlive the subscription
- ☐ Opportunistic path: where a GHL contact *does* carry a phone, normalise to E.164 and treat as
  bound without a token (writes `bind:` + `contact:` index)
- ☐ Write `syncmeta` every run, success or failure
- ☐ Idempotent — running it twice back to back changes nothing the second time

### 2d. The mass-revocation guard

- ☐ **If a single run would revoke more than ~50% of active subscribers, refuse and alarm.**
  A partial or malformed API response should never be able to cut off the whole book. Requires an
  explicit override flag to proceed.

### 2e. Supporting code

- ☐ `normalizePhone(raw, defaultCountry = 'US')` → E.164 or `null`. Pure, unit-tested.
- ☐ `sync-subscribers.mjs` — the same reconcile offline via wrangler, `--dry-run`, `--prune`,
  `--verbose`. Windows temp-file pattern (HANDOFF §9).

### Verify

- ☐ Tag yourself → `sub:` appears within one cron interval. Untag → it goes.
- ☐ Deliberately break the token → confirm the lease **decays** and no mass revocation fires

---

## Phase 3 — Binding: token mint and redeem

**Must land before Phase 4.** Enforcing before anyone can bind locks out every subscriber, you included.

### 3a. Token

- ☐ 6 characters, Crockford base32 (no `I`, `L`, `O`, `U`), from `crypto.getRandomValues`
- ☐ `tok:<TOKEN>` in KV, 15-minute TTL, `{ contactId, codes, mintedAt }`
- ☐ Single use — deleted on redemption

### 3b. `POST /api/bind/mint`

- ☐ Called from the members-area page; CORS-gated to the GHL origin (add it to `ALLOWED_ORIGIN`)
- ☐ Body `{ contactId, email }` — both available as GHL merge fields on a logged-in page
- ☐ Verify against the GHL API: contact exists, **email matches** (case-insensitive), and the
  contact currently holds a coach tag
- ☐ Rate-limit per `contactId` (`rl:mint:<id>`, ~5/hour) and log every mint
- ☐ Respond `{ token, expiresIn, smsTo }`

**Threat note.** `contactId` is the weak point — anyone who learns another member's ID could bind
their own handset to it. The email match raises the bar with no new infrastructure. The strong
version is an HMAC injected into the page, which needs a GHL custom-code action (premium) —
deferred, recorded as the upgrade path.

### 3c. Redemption (rides the existing `/twilio/sms` path)

- ☐ Before the entitlement check: if the body matches the token shape and `tok:` exists → bind
- ☐ Write `bind:<phone>`, append the phone to `contact:<contactId>`, write `sub:<phone>`
- ☐ Delete the token, then launch the coach immediately so the first text lands in conversation
- ☐ Edge cases: already used · expired · ⚠ phone already bound to a *different* contact
  (recommend rebind + log — new handset, or a shared household) · one contact, several phones (allow)

### 3d. Members-area snippet

- ☐ Deliver a small HTML/JS block for them to paste into the Course360 members page
- ☐ ⚠ Where exactly does it go, and what should the copy say?

### Verify

- ☐ Mint via `curl`, redeem via `simulate-twilio.mjs` — no real handset needed

---

## Phase 4 — Enforcement & menu removal

**Highest-risk phase.** This is the one that can lock out paying subscribers, instantly, because
there is no staging.

### 4a. Core

- ☐ `readConfig(env)` — brief in-isolate cache (~30s) for mode flags only
- ☐ `entitlementFor(env, phone)` → `{ contactId, codes }` or `null`, honouring `expires`
- ☐ **Never cache entitlement** the way the registry is cached at `:337` — a 60s cache adds 60s
  to every revocation
- ☐ `scopedResolveCoach(env, input, codes)` — resolve only within the caller's codes.
  **This, not the menu deletion, is what stops "say any author's name" from working.**
- ☐ Single-code fast path: `codes.length === 1` → skip resolution entirely

### 4b. Mode behaviour

- ☐ `off` — byte-identical to today
- ☐ `warn` — compute entitlement, log what *would* have been denied, admit anyway
- ☐ `enforce` — deny

### 4c. Order that must not change

- ☐ `STOP` (`:614`) → `HELP` → crisis net (`:639`, `:778`) → token redemption → entitlement → coach
- ☐ STOP is A2P compliance. The crisis net exists precisely for someone contacting you *before*
  having a coach; an entitlement check must never shadow it.

### 4d. Menu removal

- ☐ Delete `buildMenu()` (`:404`) and `spellCode()` (`:412`, used only by the menu)
- ☐ Remove all four call sites: `:623`, `:630`, `:643`, `:787`
- ☐ `CMD_MENU` (`:47`) — drop `MENU`/`SWITCH`/`CHANGE`/`COACHES`; repoint `RESET` to
  "restart with the same coach"
- ☐ `HELP` (`:621`) — must still answer (A2P), naming only *their* coach
- ☐ Drop the `"(Reply MENU to switch coaches.)"` footer (`:700`)
- ☐ `speechHints()` (`:734`) — scope to the caller's own coach, or drop

### 4e. Voice

- ☐ Entitled to exactly one coach → **skip the greeting and code capture entirely**, straight to
  `voiceInlineStart`. Removes two turns and, with them, the three-attempt speech-recognition
  failure in HANDOFF §7.
- ☐ Unentitled → generic decline, **no enumeration**, then hang up
- ☐ `VOICE_GREETING` now only reached on the unbound/redemption path

### 4f. Copy ⚠

- ☐ SMS decline wording
- ☐ Voice decline wording
- ☐ Rewritten `HELP` text

### Verify

- ☐ New `simulate-twilio.mjs` cases before deploying
- ☐ **Run `warn` for several days and read the logs.** That is how the phone-matching gap gets
  found before it becomes a support problem.
- ☐ Then `enforce` — a KV push, not a redeploy, so rollback is fast

---

## Phase 5 — Web channel

Ships **with** HANDOFF §4 step 8 (repoint the pages), which is unstarted. Design now, deploy then.

- ☐ Mint a short-lived web session token from the same members-area flow as Phase 3
- ☐ `/api/vf-interact` (`:1154`) requires it; ignore `body.code` unless it is in the token's codes
- ☐ `userID`: if a `bind:` exists → `phone:<E.164>` so continuity holds across all three channels;
  otherwise `web:<uuid>`
- ☐ Keep CORS as defence-in-depth — it is not access control (`curl -H "Origin: …"` walks past it)
- ☐ ⚠ `ALLOWED_ORIGIN` is still a guess (HANDOFF §7). Confirm the real value from a live page:
  F12 → Network → the `vf-interact` request → `Origin:`.

---

## Phase 6 — Archive, export, retention

⚠ **Reshaped by the Phase 1 finding — awaiting a decision before building.** There is no export
step any more. Deleting conversation *state* makes the coach forget the person (so a returning
subscriber starts fresh) while the *transcript* survives in Voiceflow until its own 6-month expiry.
Nothing is lost at 30 days, so the reminder-before-deletion idea no longer protects anything at
that point — the only moment data actually disappears is Voiceflow's 6-month expiry, which we do
not control and cannot extend from here.

- ☐ On revoke (from Phase 2): write `arch:<E.164>`, **no TTL**, `dueAt = revokedAt + archiveRetentionDays`
- ☐ Sweep runs in the same cron, idempotent:
  - ☐ Export the transcript if `!transcriptExported`, then set the flag
  - ☐ Reminders at each `archiveReminderDays` offset, recorded in `remindersSent[]` so an hourly
    cron does not send 24 times a day. Sender: **Twilio SMS to an ops number** — already paid for,
    no GHL premium action, no new vendor. ⚠ which number?
  - ☐ At `dueAt`, if `archiveAutoDelete`: delete the Voiceflow state for `userID`, then the
    `arch:` record, then the `tx:` keys
- ☐ Resubscribe before `dueAt` → reconcile cancels the pending deletion, restores `sub:`, warm resume
- ☐ `archives.mjs --list --due --restore <phone>`
- ☐ Confirm the Voiceflow delete call (`verify-voiceflow.mjs` already deletes its probe conversation)

**Verify:** set retention to minutes against **preview** KV and watch a full lifecycle.

**Note:** the `arch:` record carries no TTL on purpose — it *is* the deletion queue. An earlier
draft of this plan had it expiring, which would have erased the list of what still needed cleaning.

---

## Phase 7 — Ops, tests, rollout

- ☐ `/health` additions behind the existing `HEALTH_TOKEN`: `subscriberCount`, `lastSyncAge`,
  `lastSyncOk`, `pendingArchives`, `entitlementMode`, `ghlConfigured`
- ☐ **Alarm on `lastSyncAge`.** This is the alarm the whole lease design depends on — without it a
  broken sync is invisible until everyone is locked out. Suggested: warn after 3 missed runs,
  report a problem once `lastSyncAge > leaseHours / 2`, i.e. while there is still time to fix it
  before access starts decaying.
- ☐ Unit tests: `normalizePhone`, token generate/validate, lease expiry, retention and reminder
  due-date arithmetic, scoped resolution, the mass-revocation guard
- ☐ `simulate-twilio.mjs`: unentitled decline · token redemption · entitled straight-through voice ·
  staff multi-coach prompt
- ☐ Fixture-based reconcile tests — no live GHL calls in the suite
- ☐ **Voiceflow credit alarm** (HANDOFF §7, still unset). Credits are a hard stop with no
  mid-cycle top-up, and voice burns them fastest.

---

## Decisions still needed ⚠

| # | Question | Blocks |
|---|---|---|
| 1 | Can Course360's access grant *and removal* drive the tag automatically? | Phase 2 (falls back to the subscriptions endpoint) |
| 2 | Where does the members-area snippet go, and what does it say? | Phase 3d |
| 3 | SMS and voice decline copy | Phase 4f |
| 4 | Ops number for archive reminders | Phase 6 |
| 5 | Real `ALLOWED_ORIGIN` value | Phase 5 |
| 6 | Phone already bound to a different contact — rebind or refuse? | Phase 3c |

None of these block Phase 1.
