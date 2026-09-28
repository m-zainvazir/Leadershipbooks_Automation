# Phase task checklist

Execution detail for [`01-plan-and-decisions.md`](01-plan-and-decisions.md) — that document holds
the *why*; this one holds the *what*, task by task. Line references are into
`../coach-router.worker.js` unless stated.

Non-technical walkthrough of the same work: [`03-plain-english-overview.md`](03-plain-english-overview.md).

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

## Phase 1 — Transcript capture ✅ DONE 2026-08-26 — no code required

**Outcome: Voiceflow already records every conversation automatically.** Nothing was built, and
nothing needed to be. Conversations live only in Voiceflow, which satisfies the constraint exactly.

### What the spike established

- ✅ Transcripts are generated automatically for every conversation — no save call, no setting
- ✅ **91 transcripts already exist**, going back to 2026-07-12, including real `phone:+1…` traffic
  from SMS and voice and `web_…` traffic from the old proxy pages
- ✅ They work on the **draft** version (`version: "draft"`) — the unpublished-project worry (§2) was unfounded
- ✅ A probe conversation appeared as a transcript **immediately**
- ✅ **Retention is 6 months** — `expiresAt` is consistently `createdAt` + 6 months
- ✅ **Deleting conversation state does NOT delete the transcript.** Verified: the probe's state was
  deleted and its transcript survived. State and transcript are separate things.

### The API, for later phases

- `POST https://realtime-api.voiceflow.com/v1/stable/transcript/search?projectID=<id>`
- **Auth: the raw Dialog Manager key in `Authorization`, with NO `Bearer` prefix.**
  `Bearer <key>` returns `401`; the bare key returns `200`. Easy to lose an afternoon to.
- Body: `{ take, skip, startDate, endDate, version: "draft"|"published", sessionID, filters }`
- Record fields: `id, userID, endedAt, createdAt, updatedAt, expiresAt, projectID, sessionID,
  properties, evaluations, recordingURL, version, environmentAlias`
- The old `PUT /v2/transcripts` returns a `503` nginx page — superseded by the July 2025 system.
  So does `GET /v2/projects/<id>`. The old `GET /v2/transcripts/<projectID>` still answers `200 []`,
  which is misleading: it reports the *old* store, not the current one.

### Consequences

- Phase 1's `ctx` threading, `captureTurn()`, and `tx:` keys are all **cancelled** — not needed
- Phase 6's "export before delete" is **cancelled** — there is nothing to export to, and nothing is
  lost by not exporting: deleting state leaves the transcript intact until Voiceflow expires it
- ⚠ Open: is Voiceflow's own 6-month expiry an acceptable ceiling? We do not control it.

---

## Phase 2 — Entitlement store & reconcile ✅ DONE 2026-08-26

Deployed and verified against live GHL. **Populates only — `entitlementMode` is still `off`, so
nothing is denied to anyone.**

### Built

- ✅ `[triggers] crons = ["*/15 * * * *"]` + `scheduled()` export beside `fetch`
- ✅ `ghlSearchByTag()` — `POST /contacts/search` on tags, `searchAfter` pagination, 50-page cap
- ✅ `normalizePhone()` — E.164 or null, **refuses ambiguous input** (7-digit, 9-digit, 11-digit not
  starting with 1) rather than guessing; a wrong guess would hand one person's access to another's handset
- ✅ `reconcileEntitlements()` — grants, lazy renewal, opportunistic phone binding, revocation
- ✅ `revokeSubscriber()` — writes `arch:`, deletes `sub:`, clears both sessions, **keeps `bind:`**
- ✅ `loadRuntimeConfig()` — reads the KV `config` key, 30s in-isolate cache (mode flags only)
- ✅ `POST /admin/reconcile` — on-demand run, `?dry=1`, `?force=1`, gated by the fail-closed HEALTH_TOKEN
- ✅ `/health` gained a `sync` block behind the token (pulled forward from Phase 7 — Phase 2 is not
  verifiable without it)
- ✅ `sync-subscribers.mjs` + `npm run subs` / `subs:sync`
- ✅ Tests 77 → **110**

### The two guards, both proven by test

- **An API failure changes nothing.** A `401`/`403`/timeout aborts before a single write, because an
  empty result set is indistinguishable from "everyone churned". Verified: after a 401 the existing
  subscriber record is byte-identical and `revoked` is 0.
- **The majority guard.** A run that would revoke more than half of the subscribers refuses and
  reports instead. Verified: 9-of-10 refused, 3-of-3 allowed through as ordinary churn, `force`
  overrides. The floor of 3 stops it firing on tiny subscriber counts.

### Write cost, against the free plan's 1,000/day

| | Cost |
|---|---|
| Lease renewal | ~1 write per subscriber per day (only rewritten once more than half spent) |
| `syncmeta` | ≤24/day (on change, or hourly heartbeat) |
| **100 subscribers** | **~124 writes/day** |
| The 5-minute cron originally specified | 28,800/day — would have failed at ~3 subscribers |

Reads are ~200/run × 96 runs = ~19k/day against a 100k ceiling. Lists are 96/day against 1,000.

### Verified live

```
tags: 1  contacts: 1  granted: 0  renewed: 0  revoked: 0  writes: 0  ok: true
```

`contacts: 1` is the tagged contact; `granted: 0` because that contact has no phone number. That is
the expected result and it confirms the whole chain — auth, tag search, parsing, and the decision not
to grant. Nobody becomes reachable until Phase 3 links a handset.

### Known limitation

`/admin/reconcile` runs inside the request, so a very large contact list could hit the Worker's CPU
ceiling. Irrelevant at current scale; if the list grows, the endpoint should hand off to `waitUntil`
and return immediately.

---
## Phase 3 — Binding: token mint and redeem ✅ DONE 2026-08-26

### Built

- ✅ 6-character Crockford base32 token (no `I`, `L`, `O`, `U`); 256/32 divides evenly so no modulo bias
- ✅ `tok:<TOKEN>` in KV, 15-minute TTL, single use
- ✅ `POST /api/bind/mint` — body `{ contactId, email }`, CORS-gated, rate-limited 5/hour per contact
- ✅ `redeemBindToken()` wired into the existing `/twilio/sms` path
- ✅ `codesForTags()` — tags to coach codes, staff tag grants everything
- ✅ `ghlGetContact()` — treats **any 4xx as not-found**; GHL answers a bad ID with `400`, not `404`,
  so a typo'd contact ID would otherwise reach a member as a server error

### Security properties, each verified against live GHL

- **No account enumeration.** A wrong email on a real contact and a completely made-up contact ID
  return the *identical* `403`, so the endpoint cannot be used to discover whether an account exists.
- **Single use.** A second handset texting an already-redeemed code gets no binding.
- **Shape gate plus existence gate.** A six-character message only counts as a code if a matching
  token actually exists, so ordinary messages fall through untouched.
- **Bad origin refused** — `403` from the CORS gate.

### The rebind case

Moving a handset between accounts **removes it from the old contact's index**. Without that the
reconcile would keep re-granting through the previous contact and one phone would answer to two
subscriptions. Covered by test.

Decision taken (was ⚠, now settled): a handset already linked elsewhere **rebinds and logs**, rather
than refusing. Forgiving for a new phone or a shared household, and the inbound SMS still proves
possession. Reversible if it causes trouble.

### Verified end to end with no phone

`simulate-twilio.mjs` signs webhooks exactly as Twilio does, so the whole flow was exercised without
a handset, roaming, or A2P: minted a token against the real tagged contact, "texted" it in, and the
coach launched with Micheal's own greeting. Replay was refused. The reconcile then reported
`unchanged: 1` at **0 writes**, confirming the frugal path in production.

### ⚠ Still needed from Muhammad

- The members-area snippet: where it goes on the Course360 page, and the wording. The endpoint is
  live and ready for it.
- `ALLOWED_ORIGIN` must include the Course360 members domain before the page can call `/api/bind/mint`.
  Currently only `book-coach.ai` and `www.book-coach.ai` are allowed.

---

## Phase 4 — Enforcement & menu removal ✅ DONE 2026-08-26 — running in `warn`

### The menu is gone

- ✅ `buildMenu()` and `spellCode()` deleted, with all four call sites
- ✅ `CMD_MENU` (`MENU`/`SWITCH`/`CHANGE`/`COACHES`) replaced by `CMD_RESET` (`RESET`/`RESTART`),
  which restarts the conversation with the *same* coach
- ✅ The `"(Reply MENU to switch coaches.)"` footer removed from every launch
- ✅ `HELP` names only the caller's own coach
- ✅ The voice third-attempt branch no longer reads the coach list aloud — the worst disclosure in the file
- ✅ `speechHints()` scoped to the caller's entitled codes

**Note:** the menu is removed unconditionally, in every mode. `entitlementMode` governs only whether
entitlement is *checked* — it does not bring the menu back.

### Enforcement

- ✅ `entitlementFor()` — **deliberately not cached**; the registry's 60s cache is right for coach
  config and would add 60s to every revocation
- ✅ `entitlementDecision()` — the single mode-aware decision point for both channels
- ✅ `resolveEntitledCoach()` — with one entitled code the message is **not consulted at all**, so no
  string a caller can send routes anywhere but their own coach
- ✅ Voice: an entitled caller with one coach **skips the greeting and code capture entirely** and is
  connected straight through — two turns removed, and with them the repeated speech-recognition
  failures in HANDOFF §7
- ✅ Decline copy in KV config (`declineSms`, `declineVoice`), editable without a redeploy

### Verified live in `enforce`, then set back to `warn`

| Case | Result |
|---|---|
| Unentitled, ordinary message | Declined, no coach named |
| **Unentitled, crisis text** | **988 crisis response, not the decline** — the ordering holds |
| Unentitled, `STOP` | Silent, as A2P requires |
| **Unentitled, texts `1042`** | **Declined.** The code is no longer a credential. |
| Entitled handset | Coach answered normally |
| Entitled caller, voice | Straight to the coach, no greeting |
| Unentitled caller, voice | Declined and hung up, no names |

### A bug this caught, and a hole in the test suite

`handleVoiceEntry` discarded `validateTwilio`'s return value, so adding a `params.get('From')` threw
and every inbound call got the catch-all apology. **The simulator suite reported `ok`** — it asserted
HTTP 200, and the Worker deliberately answers a failed `/twilio/*` request with 200 and apologetic
TwiML so callers never hear Twilio's own error. Status alone therefore cannot tell a working reply
from a crash.

Fixed both: the bug, and the suite now fails any Twilio response containing the catch-all apology.
Also added a check that no reply ever contains a coach name or code — the assertion that would catch
the menu coming back.

### Rollout

Now in **`warn`**: identical to `off` for every caller, but it logs each contact that *would* have
been refused. Leave it here for a few days and read the logs — that is how a subscriber whose phone
was never linked gets found before they complain. Flipping to `enforce` is a config push, not a
redeploy.

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

## Phase 6 — Archive & retention ✅ DONE 2026-08-26

Decision taken: **option (a)**. 30 days after churn the person's Voiceflow conversation *state* is
deleted, so a returning subscriber starts fresh. No export (there is nowhere to export to, and
nothing is lost — the transcript survives). No reminders.

### Built

- ✅ `sweepArchives()` — runs on the same cron as the reconcile
- ✅ `deleteVoiceflowState()` — `DELETE /state/user/<userID>`; deletes *state*, not the transcript
- ✅ A re-granted phone has its pending deletion cancelled, so returning inside the window resumes
- ✅ `arch:` records still carry **no KV expiry** — the record is the queue

### Design points, each covered by test

- **A Voiceflow failure keeps the queue entry.** The record is only removed after Voiceflow confirms
  the delete, so a 500 means a retry next run rather than silently dropped work.
- **No `dueAt` means never due**, not immediately due. A malformed record is not a licence to delete.
- **`archiveAutoDelete: false` holds everything** and reports it as held, not as done.
- **A record naming an unknown coach is retired**, not retried forever.
- **The sweep runs even when the reconcile failed** — it only needs KV, so a GHL outage is no reason
  to stop honouring a deletion date.

### The full round trip is tested

subscribe -> churn -> return. Entitlement appears, is revoked with an archive record while the
binding survives, then on return the entitlement is restored and the pending deletion is cancelled.

### `archiveReminderDays` is deliberately unused

Kept in config but not acted on. Reminders were dropped once it turned out nothing is lost at the
30-day boundary. The setting remains for the day someone wants warning ahead of Voiceflow's own
6-month transcript expiry, which is the only point data actually goes.

---

## Phase 7 — Ops & alarms ✅ DONE 2026-08-26

### Built

- ✅ `/health` reports `sync`: `lastRunAt`, `lastOk`, `ageMinutes`, `staleAfterHours`, counts,
  `entitlementMode`, and the archive numbers
- ✅ **The stale-sync alarm.** Fires at `leaseHours / 2` (24h by default): late enough not to trip on
  a blip, early enough that there is still time to fix it before the first lease lapses. This is the
  alarm the whole lease design rests on — leases decay silently, so without it a dead sync is
  invisible until subscribers start being refused.
- ✅ Alarms also on `lastOk: false` and on any `refusedRevoke` (the majority guard having tripped
  needs a human to decide whether the churn was real)
- ✅ These push into `problems`, so `/health` returns **503** and `ok: false` — external monitoring
  reads the status code, not the body

### A bug caught while building it

The `sync` block was originally computed *after* `status` and `summary.ok`, so the alarm would have
populated `problems` while `/health` still answered `200 ok: true` — an alarm that could never fire.
Moved above both.

### Alarms only when the mode is not `off`

With entitlement off, a dead sync locks nobody out and should not page anyone. Deliberate.

### Still open

- ⚠ **Voiceflow credit alarm** (HANDOFF §7) remains unbuilt. I could not find a documented endpoint
  that reports remaining workspace credits, and I would rather leave this visibly open than invent a
  check that looks like coverage and is not. Credits are a hard stop with no mid-cycle top-up, and
  voice burns them fastest — worth asking Voiceflow support whether the balance is queryable.

---

## Remaining

### Phase 5 — Web channel  ☐

`ALLOWED_ORIGIN` now includes `https://login.leadershipbookspublishers.com`, so the members page can
call the mint endpoint. The rest of Phase 5 — putting a signed token on `/api/vf-interact` — still
ships with HANDOFF §4 step 8 (repointing the web pages), which is unstarted.

### Needs a person, not code

- ~~The activation block must be live before `enforce`.~~ **Done 2026-08-26.** It ended up in the
  **coach page**, not the lesson — the Course360 editor strips `<script>` and `<button>`, so nothing
  executable survives there. The lesson only passes the member through on the iframe URL. Verified end
  to end: code issued in-course, texted in, handset linked, coach replied, page then shows
  "Phone linked". See HANDOFF §10 for the flow.
- **The tag is now the blocker.** Only one contact holds `bookcoach-micheal-stickler-active`, applied
  by hand. Until Course360 adds and removes it automatically on course assignment, every other member
  gets "no active coach subscription".
- **Confirm Twilio's Messaging Service inbound webhook points at `/twilio/sms`.** Needs one real SMS
  from any handset. The simulator posts straight to the Worker, bypassing Twilio, so it cannot prove
  delivery. Pre-existing gap from §7.
