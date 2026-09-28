# 10 — Shared memory across web, SMS and voice

**Created:** 2026-09-25 · **Status:** built and tested, **not deployed** — see
[coach-memory-sms.md](coach-memory-sms.md) for what was built, how to switch it, and caveats.
**Goal:** a member who talks to their coach on the web page, then texts or calls
`+1 854 254 5009`, continues the *same* conversation — and back again.
Switchable globally and per coach from `coaches.json`.

---

## The idea in one line

Voiceflow already remembers every conversation, keyed by **userID**. The web page
uses `ghl_<contactId>`; the Worker uses `phone:<E.164>`. **Make the Worker use
`ghl_<contactId>` for linked phones**, and don't `launch` over a live
conversation. Nothing new is stored anywhere — Voiceflow does the remembering.

## What exists today (read from the code)

| Where | userID | Source |
|---|---|---|
| Web page (`freddy-v2`, direct to Voiceflow) | `ghl_<cid>` | `freddy-v2:604` |
| SMS | `phone:<from>` | `coach-router.worker.js:728` |
| Voice start / turn | `phone:<from>` | `:1043`, `:1096` |
| Worker web proxy (`webUserID`) | `phone:<…>` or `ghl:<id>` (colon) | `:2905` |
| Archive deletion record | `phone:<phone>` | `revokeSubscriber`, `:1779` |

- Same Voiceflow project: `freddy-v2` and coach `1043` both use version
  `6a3339b6eb283c59b70cfa53`, so state is shared the moment the IDs match.
- The Worker already knows the contact: the `sub:<phone>` lease (read on every
  message anyway) carries `contactId`, and `redeemBindToken` returns it. **No
  extra KV reads or writes.**
- The web page already does the "don't relaunch" check (`bootCoach`, `freddy-v2:804`):
  if `GET /state/user/<id>` has a non-empty `stack`, show history and skip `launch`.
  SMS/voice currently *always* launch at conversation start, which restarts the flow.

---

## The switch

`coaches.json`:

```jsonc
"shared": { "config": { "sharedMemory": "off" } },   // "on" | "off" — global default
"coaches": [
  { "code": "1043", "sharedMemory": true,  ... },      // optional per-coach override
  { "code": "1042", "sharedMemory": false, ... }
]
```

Rule: `coach.sharedMemory` if set, otherwise `config.sharedMemory === "on"`.
Push with `npm run seed` — no redeploy needed to flip it.

Needs two allowlist entries in `lib-config.mjs`: `sharedMemory` in `CONFIG_DEFAULTS`
(default `"off"`, validated in `configProblems`) and in `KV_FIELDS`. Mirror the default
in the Worker's `CONFIG_FALLBACK`.

Turning it **off** simply goes back to `phone:` IDs — the old SMS conversation is
still there. Fully reversible.

---

## Code changes (Worker)

### 1. One helper that picks the ID

```js
function vfUserFor(cfg, coach, phone, contactId) {
  const on = typeof coach.sharedMemory === 'boolean' ? coach.sharedMemory : cfg.sharedMemory === 'on';
  return on && contactId ? `ghl_${contactId}` : `phone:${phone}`;
}
```

`ghl_` with an **underscore**, exactly as the web page builds it. No contactId
(mode `off`/`warn`, unlinked phone) → falls back to `phone:` as today.

### 2. Decide once per conversation, remember it in the session

- `startCoachOverSms` / `voiceInlineStart` compute the userID and store it in the
  `sess:` record they already write (`{ code, started, vfUser }`). No new write.
- Every later turn reads `session.vfUser` (fallback `phone:<from>` for sessions
  created before this change).
- contactId comes from `decision.entitlement.contactId` (the lease), or from the
  `redeemBindToken` result on activation.

### 3. Resume instead of relaunch

New helper `vfIsLive(env, coach, userID)` → `GET /state/user/<id>`, true when
`stack` is non-empty (same test as the web page). Called **only at conversation
start**, never per message.

| Moment | Live state → | No state → |
|---|---|---|
| SMS after activation code | reply "You're linked — picking up where we left off. What's on your mind?" | `launch` (as today) |
| SMS, session expired, ordinary message | send the message as a normal `text` turn | `launch` (as today) |
| Voice call start | say "Welcome back." then `Gather` | `launch` (as today) |
| RESET | unchanged — clears Voiceflow state and launches fresh (see below) |

RESET must now `DELETE /state/user/<id>` before launching, like the web page's
restart button — otherwise "start over" wouldn't. (That also wipes the web view,
which is correct: it's one conversation.)

### 4. Keep cleanup pointed at the right conversation

- `revokeSubscriber`: write `userID: vfUserFor(...)` into the `arch:` record
  (the lease has the contactId). Otherwise the 30-day deletion removes the old
  `phone:` state and leaves the real one.
- Two phones on one contact → two `arch:` records with the same userID. Confirm
  `deleteVoiceflowState` treats a 404 as success.
- `webUserID` (Worker web proxy): return `ghl_<contactId>` when enabled, so both
  web paths agree. Low priority — the live page talks to Voiceflow directly.

---

## Not changing

- Entitlement, activation, the SMS order of checks, the crisis net. The userID is
  chosen *after* the gate, so a non-subscriber never touches a member's memory.
- Per-message cost: zero extra KV ops, zero extra Voiceflow calls. One extra
  Voiceflow GET per *conversation start*.
- Old `phone:` conversations are not migrated (no real traffic since 2026-08-26).

## Worth knowing

- Memory is per coach automatically — each author is a separate Voiceflow project.
- A phone moved to another contact gets the new contact's memory, not the old
  owner's. Safer than today's `phone:` keying.
- Each author's web page must use the **same Voiceflow project/version** as their
  `coaches.json` entry, or they won't share. True for Freddy; check Stickler (`"main"`).
- Messages written on the web may contain formatting; `flattenTraces` /
  `sanitizeForSpeech` already handle SMS and voice output.
- SMS still has no soft-deadline guard (the `11200` issue). This adds one GET
  only at conversation start, but it's another reason to fix that first.

## Test

1. `verify.test.mjs`: `vfUserFor` on/off/override/no-contactId; resume vs launch;
   RESET deletes state; `arch:` carries the `ghl_` ID.
2. `simulate-twilio.mjs`: web chat as `ghl_<cid>` → SMS from a bound phone →
   coach references the web conversation → reload the web page, SMS turns show.
3. Flip `sharedMemory` off, `npm run seed`, confirm SMS is back on `phone:`.

## Rollout

Build with default `"off"` → deploy → set `"sharedMemory": true` on coach `1043`
only → test with Freddy → then turn it on globally.
