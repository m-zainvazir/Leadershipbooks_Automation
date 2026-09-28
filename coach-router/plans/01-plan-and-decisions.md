# Plan — subscriber entitlement, menu removal, transcript capture

**Status (2026-08-28):** Phases 0-4, 6 and 7 done. Phase 5 half done — the gate is built, but the
coach page still calls Voiceflow directly, so it protects nothing yet. Both gates in **`warn`**:
checked and logged, nobody refused. Tests 46 -> 242. **Proven end to end with a real subscriber in
the US** — activation, texting, calling, and cross-channel memory.
**Written:** 2026-08-25. **Task-level checklist:** [`02-phase-record.md`](02-phase-record.md).
**Non-technical walkthrough:** [`03-plain-english-overview.md`](03-plain-english-overview.md) — for talking the client through it.
**Read with:** `../HANDOFF.md` (state of play) and `../README-coach-router.md` (runbook).

---

## 1. The problem

The Worker has no access control. Today any caller reaches any coach:

| Where | Line | Issue |
|---|---|---|
| `resolveCoach()` | `:369` | Matches the **entire** registry — code, display name, alias, fuzzy containment. |
| SMS pinned branch | `:649-652` | Any recognised code/alias switches coaches. Deleting the menu does not close this. |
| `buildMenu()` | `:404` | Lists every code + name. Called at `:623`, `:630`, `:643`, `:787`. |
| Voice 3rd attempt | `:787` | **Speaks every coach's name and code aloud.** Worst leak in the file. |
| `speechHints()` | `:734` | Ships every code, name and alias to Twilio's recogniser. |
| `/api/vf-interact` | `:1154` | Takes `code` straight from the request body. **No entitlement check at all.** |
| everywhere | — | 4-digit codes = 10,000 combinations, and **no rate limiting** anywhere. |

Removing the menu is obscurity. The requirement — only subscribers reach their author, and access ends when the subscription does — needs entitlement. Entitlement gives menu removal for free.

## 2. Decisions taken

- **Source of truth is GHL (Course360).** One sub-account, all authors.
- **The Worker mirrors GHL; it does not reason about billing.** Expiry, cancel-request, failed payment, refund and manual removal all collapse into one signal: does the contact currently hold the coach's tag. "Access until period end" vs "cut immediately" is therefore a GHL setting, not a code change.
- **One tag per author**, named for humans, mapped in `coaches.json` via `ghlTag`. Coach 1042 → `bookcoach-micheal-stickler-active`. No `ghlTag` means no automated entitlement for that coach — fails closed.
- **No GHL webhook.** The Webhook action is a GHL premium action billed per execution. Reconcile-first makes it unnecessary: the cron *is* the mechanism, the webhook was only an accelerator. Zero GHL premium actions. Activation lag = cron interval (Cloudflare minimum 1 min; 5 min proposed).
- **Leases, not permanent grants.** Every `sub:` record carries `expires`; the cron renews it. If sync breaks, access **decays** (loud, obvious) instead of persisting (silent revenue leak).
- **Transcripts: capture, then export before delete.** Auto-delete at retention is restored. Reminder notifications are the fallback only if export proves impossible.
- **Retention and reminder offsets live in KV config**, editable via `npm run push` with no redeploy.
- **A staff tag** (e.g. `bookcoach-staff-all`) grants every coach, for internal testing without fake subscriptions.

### Verified against the live GHL API on 2026-08-25

| Probe | Result |
|---|---|
| `GET /contacts/?locationId=…` | `200` — token and location valid; PIT accepted |
| `POST /contacts/search` filtered on `tags` | `200`, returns `contacts,total` — **tag reconcile is viable and paginatable** |
| `GET /payments/subscriptions` | `422`, not `401/403` — scope likely granted, query shape wrong. Usable fallback. |
| Tagged contact record | `total: 1`, correct tag, **`phone` empty — email only** |
| Fields available | includes `id`, `email`, `tags`, `customFields`, `dateUpdated`, `dnd`, `dndSettings`, `searchAfter` |

### The finding that shaped the design

**The one tagged contact has no phone number.** GHL is a course/membership product; email-only signup is normal. Keying entitlement on GHL's `phone` field would admit **nobody**, and would do so silently.

So **the members-area binding token is the primary enrolment mechanism, not a fallback.** It is also stronger: an inbound SMS proves handset possession, where a CRM phone field only records what someone once typed. Entitlement therefore keys on **GHL contact ID**; GHL's phone field, where populated, is an opportunistic fast path that skips the token.

Incidental wins from the field list: `dateUpdated` enables incremental reconcile at scale; `dnd`/`dndSettings` let us respect DND on outbound SMS; `searchAfter` is the pagination cursor.

## 3. Target architecture

### KV keyspace

| Key | New? | TTL | Contents |
|---|---|---|---|
| `coach:<CODE>` | existing | none | Registry entry. Gains `ghlTag`. |
| `sess:<channel>:<phone>` | existing | 12h sliding | Conversation session. |
| `pend:<CallSid>` | existing | 300s | Slow voice reply parked by `/voice/turn`. |
| `sub:<E.164>` | **new** | none (lease in body) | **Hot path.** `{ contactId, codes[], expires, updatedAt }` — one KV read per inbound turn. |
| `bind:<E.164>` | **new** | none | `{ contactId, boundAt }`. Durable handset↔contact proof. Survives churn, so resubscribe needs no re-bind. |
| `contact:<contactId>` | **new** | none | `{ phones[] }`. Reverse index the reconcile walks. |
| `tok:<TOKEN>` | **new** | 15 min | `{ contactId, mintedAt }`. Single-use binding token. |
| `arch:<E.164>` | **new** | **none** | `{ userID, contactId, codes[], revokedAt, dueAt, remindersSent[], transcriptExported }`. No TTL — the record *is* the deletion queue. |
| `tx:<userID>` | **new** | none | Transcript capture (shape decided in Phase 1). |
| `config` | **new** | none | One object: `entitlementMode`, `leaseHours`, `archiveRetentionDays`, `archiveReminderDays`, `archiveAutoDelete`. Single key, not `config:*` — one read gets every knob and updates stay atomic. |
| `syncmeta` | **new** | none | `{ lastRunAt, lastOk, counts }` — drives the `/health` alarm. |

`bind:` and `sub:` are deliberately separate: binding is durable identity, entitlement is a renewable lease. Losing a subscription clears `sub:` and leaves `bind:` intact.

### Flow

```
GHL (tags)  --cron 5min-->  reconcile  -->  sub:<phone> lease renewed / revoked
                                                |
members area --mint--> tok:<TOKEN> --SMS redeem--> bind:<phone> + sub:<phone>
                                                |
inbound SMS / call  -->  one read of sub:<phone>  -->  entitled? scoped to codes[]
                                                |
revoke --> arch:<phone> --> export transcript --> (retention) --> delete VF state
```

## 4. Phases

Ordering is dependency-driven, not cosmetic. **Phase 1 must precede Phase 6** — deletion is only safe once there is something to export, and capture only records forward from the day it ships. **Phase 3 must precede Phase 4** — enforcing before anyone can bind locks out every subscriber, including you.

---

### Phase 0 — Groundwork: config plumbing  ✅ DONE 2026-08-25

**Size:** S (~60 lines, no runtime behaviour change)

Wire GHL into the config flow the repo already has, so `npm run push` carries it.

- `lib-config.mjs:28` — add `ghlTag` to `KV_FIELDS`.
- `lib-config.mjs:42` — add `GHL_API_TOKEN: 'ghlApiToken'` to `SHARED_SECRETS`.
- `lib-config.mjs:51` — add `GHL_LOCATION_ID: 'ghlLocationId'` to `SHARED_VARS`.
- `lib-config.mjs:133` — extend `assertNoSecrets` to catch `pit-` tokens.
- `coaches.json` — set `ghlTag` on coach 1042 (currently `null`).
- `seed-coaches.mjs` — seed the `config` key from `shared.config`, so retention and mode are editable without a redeploy.
- `sync-secrets.mjs --check` — cover the new var.

**Deliverable:** GHL token reaches a Worker secret, location ID reaches a var, tag reaches KV. Nothing in the request path changes.
**Verify:** `node seed-coaches.mjs` dry run clean; `node sync-secrets.mjs` lists the new secret by name and length only; `/health` unchanged; 46 tests still pass.
**Risk:** none.

---

### Phase 1 — Transcript capture

**Size:** M. **Ship early — it can only record forward.**

Today nothing is recorded. `vfInteract` (`:465`) sends `config: { tts:false, stripSSML:true, stopAll:true, excludeTypes:[…] }` — no transcript save. Voiceflow holds *state* (variables + canvas position), not a readable log. **This is a live data-loss exposure independent of churn.**

- **Spike first:** determine whether Voiceflow will persist a transcript for a `userID` on a **draft** version ID (the project is unpublished — HANDOFF §2). Time-boxed.
- If yes → have Voiceflow retain, and implement export-by-`userID`.
- If no → the Worker captures itself: append `{ ts, channel, role, text }` per turn to `tx:<userID>`.
- **Never on the critical path.** Voice already races an 8s soft deadline against Twilio's 15s ceiling (HANDOFF §6.11). All capture goes through `ctx.waitUntil()`.
- **Refactor needed:** `handleSms` and `handleVfInteract` do not currently receive `ctx` — thread it from the router at `:1314` and `:1327`. `handleVoiceTurn` already has it.
- Covers all three channels.

**Deliverable:** every turn recorded; an export function usable by Phase 6.
**Verify:** send an SMS, place a call, load a web page — confirm all three land, and confirm voice turn timings are unchanged in the Worker logs.
**Risk:** medium — adds a write per turn. Mitigated by `waitUntil` and by never blocking the response.

---

### Phase 2 — Entitlement store & reconcile

**Size:** L. **Populates only — enforces nothing.**

- `scheduled()` handler + `[triggers] crons` in `wrangler.toml`. Purely additive; the `fetch` export at `:1298` is untouched.
- `reconcile()`: for each coach with a `ghlTag` → `POST /contacts/search` filtered on tags, paginated via `searchAfter` → the set of entitled `contactId`s.
- For each entitled contact → `contact:<contactId>` → bound phones → renew `sub:<phone>` lease (`expires = now + leaseHours`, default 48h).
- Contacts that no longer hold the tag → revoke: delete `sub:`, keep `bind:`, create `arch:`.
- Opportunistic path: where a GHL contact *does* carry a phone, normalise to E.164 and treat as bound without a token.
- Write `syncmeta` every run.
- `sync-subscribers.mjs` — one-shot backfill and manual reconcile, `--dry-run` and `--prune`, following existing script conventions (temp-file wrangler pattern, Windows-safe — HANDOFF §9).

**Deliverable:** KV converges on GHL within one cron interval, in both directions.
**Verify:** tag and untag your own contact; watch `sub:` appear and disappear. Break the token deliberately and confirm the lease decays rather than persisting.
**Risk:** medium. Pagination and rate limits are the unknowns. Full reconcile is fine at current scale; `dateUpdated` is the incremental path when contact count grows.

---

### Phase 3 — Binding: token mint and redeem

**Size:** M

The members area is the authenticated surface — Course360 has already logged the member in. Use it to transfer that identity to a handset.

- `POST /api/bind/mint` — the members page posts `contactId` **and** `email` (both available as GHL merge fields). The Worker requires: the contact exists, the email matches, **and the contact currently holds a coach tag**. Then mints `tok:<TOKEN>`, 15-minute TTL, single use.
- Token format: 6 characters, Crockford base32 (no ambiguous glyphs), uppercase — easy to read aloud and to text.
- Redemption rides the existing `/twilio/sms` path: member texts the token → verify → write `bind:` + `sub:` → launch the coach.
- Rate-limit mints per `contactId`; log every mint and redemption.

**Threat note.** `contactId` is the weak point — someone who learns another member's ID could bind their own handset to it. Requiring the matching email raises the bar with no extra infrastructure. The strong version is an HMAC injected into the page, which needs a GHL **custom-code action** (premium) — deferred, and recorded here as the upgrade path.

**Deliverable:** a member goes from logged-in to connected without anyone knowing their phone number in advance.
**Verify:** mint via `curl`, redeem via `simulate-twilio.mjs` — no real handset needed.
**Risk:** medium, concentrated in the mint authentication above.

---

### Phase 4 — Enforcement & menu removal

**Size:** L. **The user-visible change.**

- `entitlementFor(env, phone)` → `{ contactId, codes[] }` or `null`. One KV read. **Do not cache in-isolate** the way the registry is cached at `:337` — a 60s cache adds 60s to every revocation.
- `ENTITLEMENT_MODE`: `off | warn | enforce`, read from KV config so it flips **without a redeploy**. `warn` logs every contact that *would* have been denied.
- **Scope `resolveCoach()` (`:369`) to the caller's entitled codes.** This is the single most important change — it, not the menu deletion, is what stops "say any author's name" from working.
- **Order that must not change:** `STOP` (`:614`) first, crisis net (`:639`, `:778`) second, entitlement third. STOP is A2P compliance; the crisis net exists precisely for someone who contacts you before having a coach, and an entitlement check must never shadow it.
- Delete `buildMenu()` (`:404`) and `spellCode()` (`:412`, used only by the menu), and all four call sites.
- `CMD_MENU` (`:47`) — drop `MENU`/`SWITCH`/`CHANGE`/`COACHES`; repoint `RESET` to "restart with the same coach".
- `HELP` (`:621`) — must still answer (A2P), naming only *their* coach.
- Drop the `"(Reply MENU to switch coaches.)"` footer (`:700`).
- Voice, entitled to exactly one coach: **skip the greeting and code capture entirely** — straight to the coach. Removes two turns and, with them, the three-attempt speech-recognition failure in HANDOFF §7.
- Voice, unentitled: generic decline, **no enumeration**.
- `speechHints()` (`:734`) — scoped to the caller's own coach, or dropped.
- `VOICE_GREETING` — now only reached on the unbound/redemption path.
- Multi-code (staff tag) is the only case that still prompts.

**Deliverable:** no menu, no enumeration, and only entitled callers reach a coach.
**Verify:** run `warn` for several days first and read the logs for subscribers who *would* have been locked out — that is how the phone-matching gap gets found before it matters. Then `enforce`.
**Risk:** **highest in the plan.** This is the phase that can lock out paying subscribers. `warn` mode and the staff tag are the mitigations.

---

### Phase 5 — Web channel

**Size:** M

`/api/vf-interact` (`:1154`) trusts `body.code`. CORS is the only gate, and CORS is browser-enforced — `curl -H "Origin: https://www.book-coach.ai"` walks past it.

- Require a short-lived signed token, minted by the same members-area flow as Phase 3.
- Merge web into phone identity when a `bind:` exists, so `userID` continuity holds across all three channels.
- Keep CORS as defence-in-depth.

Coupled to HANDOFF §4 step 8 (repoint the web pages), which is unstarted — so this ships **with** the repoint rather than being retrofitted. Design now, deploy then.

---

### Phase 6 — Archive, export, retention

**Size:** M. **Depends on Phase 1.**

- On revoke: write `arch:<E.164>`, **no TTL**, with `dueAt = revokedAt + archiveRetentionDays` (default 30).
- Cron sweep, idempotent:
  1. Export the transcript to durable storage; set `transcriptExported`.
  2. If reminders are enabled, notify at T-15 and T-5, recorded in `remindersSent` so an hourly cron does not send 24 times a day. **Sender: Twilio SMS to an ops number** — infrastructure already paid for, no GHL premium action, no new vendor.
  3. At `dueAt`: delete the Voiceflow state for `userID`, then drop the `arch:` record.
- `ARCHIVE_AUTO_DELETE` flag, so deletion can be held off without a rewrite.
- Resubscribe before `dueAt` → cancel the pending deletion, restore `sub:`, warm resume. After → fresh start.
- `archives.mjs --list --due`.

**Deliverable:** churn is reversible for 30 configurable days, then irreversible and clean, with the conversation preserved.
**Verify:** set retention to minutes in preview KV and watch a full lifecycle.
**Risk:** low-medium. The record carries no TTL specifically so the deletion queue cannot erase itself — that was a real trap in an earlier draft of this plan.

---

### Phase 7 — Ops, tests, rollout

**Size:** M

- `/health` gains, behind the existing `HEALTH_TOKEN`: subscriber count, `lastSyncAge`, pending archive count, `entitlementMode`. `lastSyncAge` is the alarm the lease design depends on — without it, a broken sync is invisible until everyone is locked out.
- Unit tests for the new pure helpers: `normalizePhone`, lease expiry, token format and checksum, retention arithmetic, scoped resolution. All pure, all cheap. Add to the existing 46.
- `simulate-twilio.mjs`: unentitled decline, token redemption, entitled straight-through voice, staff multi-coach prompt.
- Fixture-based reconcile tests — no live GHL calls in the test suite.
- **Voiceflow credit alarm** — still unset (HANDOFF §7). Fold in here: credits are a hard stop with no mid-cycle top-up, and voice burns them fastest.

## 5. Cross-cutting constraints

- **No staging.** The coach runs an unpublished draft version (HANDOFF §2), so every change is live to anyone texting or calling. This is why `ENTITLEMENT_MODE` lives in KV — the rollback is a `npm run push`, not a redeploy.
- **KV is eventually consistent** (up to ~60s globally). Consequences: revocation is not instantaneous, and single-use token enforcement is best-effort against an attacker racing colos. Both are acceptable here. Strict semantics would need Durable Objects — out of scope, noted.
- **Twilio's 15s webhook ceiling.** Nothing in this plan may add latency to `/twilio/voice/turn`. All new writes go through `ctx.waitUntil()`.
- **Do not cache entitlement in-isolate.** The registry's 60s cache (`:337`) is right for coach config and wrong for access control.
- **Unentitled inbound SMS still costs money.** Every declined message is billed. If abuse appears, add a denial counter.
- **A2P compliance is not optional.** STOP and HELP must work regardless of entitlement.
- **Windows.** Any new script shelling out to wrangler must follow the temp-file pattern in `seed-coaches.mjs` — Node cannot spawn `npx` without `.cmd` plus a shell, and `shell:true` does not escape arguments (HANDOFF §9).

## 6. Open questions

- Does Voiceflow persist transcripts for a **draft** version ID? Decides Phase 1's implementation. The spike answers it.
- Correct parameters for `GET /payments/subscriptions` (the `422`). Only needed if tag-driven revocation turns out not to be automatable in GHL.
- Can Course360's access grant and removal drive the tag automatically? If removal cannot, reconcile switches to the subscriptions endpoint. **Does not block Phases 0-1.**
- What TTS voice does project 1042 use? Pre-existing open item (HANDOFF §7), unchanged by this plan.

## 7. Rollout sequence

1. Phase 0 → push. No behaviour change.
2. Phase 1 → deploy. Capture starts accumulating immediately; everything downstream depends on it having run for a while.
3. Phase 2 → deploy with `ENTITLEMENT_MODE=off`. Watch `syncmeta` and KV converge for a few days.
4. Phase 3 → deploy. Bind yourself, then a test contact. Confirm redemption end to end.
5. Phase 4 → `warn`. **Read the logs.** Then `enforce`.
6. Phases 5-7 in any order once 4 is stable.

Phases 0-2 are safe to build now. Phase 4 is the one to slow down on.
