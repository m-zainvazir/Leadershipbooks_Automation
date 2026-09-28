# coach-memory-sms — build log

**Started:** 2026-09-25 · **Plan:** [10-shared-memory-across-channels.md](10-shared-memory-across-channels.md)
**What:** web, SMS and voice share one Voiceflow conversation per member (`ghl_<contactId>`),
switchable globally and per coach.

This file is updated as the work happens. Newest log entries at the bottom.

---

## Status

| Step | State |
|---|---|
| Backups | ✅ done |
| Config switch (`lib-config.mjs`, Worker fallback, `coaches.json`) | ✅ done — ships **off** |
| `vfUserFor` / `sharedMemoryOn` / `vfIsLive` helpers | ✅ done |
| SMS: shared ID + resume instead of relaunch | ✅ done |
| Voice: shared ID in session + "Welcome back" | ✅ done |
| RESET wipes the shared Voiceflow state | ✅ done |
| Archive sweep deletes the shared conversation too | ✅ done |
| Worker web endpoint (`webUserID`) agrees | ✅ done |
| Tests | ✅ 614 passed, 0 failed (70 new) |
| `npm run seed` dry run | ✅ validates, shows `sharedMemory "off"` |
| **Fix #1 — Voiceflow key out of `freddy-v2`** (page → Worker) | ✅ done |
| **Fix #2 — `channel` stuck on `sms`** | ✅ done (by #1: every web turn sets `channel: web`) |
| End-to-end simulation (real page code + real Worker) | ✅ 17/17 |
| **Worker deployed** | ✅ **LIVE** 2026-09-25 — version `119545c9-cc52-4b82-b272-0fb832968ee7`, `/health` ok |
| **`sharedMemory: "on"` globally, seeded** | ✅ **LIVE** — all coaches, and every future coach, with no per-coach override |
| Stickler's page (`ms-coach-router-visible+meet`) moved behind the Worker + history on load | ✅ done locally, simulation 17/17 |
| **New pages pasted into the live sites** | ❌ **you do it** — `freddy-v2` and `ms-coach-router-visible+meet` |
| Old Voiceflow keys rotated | ❌ **you do it, after pasting** |
| Live test with a real US handset | ❌ not yet |

---

## How to switch it (the one thing you'll actually do)

All in `coaches.json`, then `npm run seed`. **No redeploy** — the Worker reads it from KV
within ~60 seconds.

**Everyone on / off** — `shared.config`:

```json
"sharedMemory": "on"      // or "off"
```

**One coach only** — add to that coach's entry (overrides the global switch):

```json
{ "code": "1043", "name": "Freddy Davis", "sharedMemory": true, ... }
```

| global `sharedMemory` | coach `sharedMemory` | Result for that coach |
|---|---|---|
| `"off"` | *(absent)* | separate SMS/voice conversation (old behaviour) |
| `"on"` | *(absent)* | shared with web |
| `"off"` | `true` | shared with web |
| `"on"` | `false` | separate |

Must be a real `true`/`false` on a coach (not `"true"`), and `"on"`/`"off"` globally —
`npm run seed` refuses anything else.

---

## What the member experiences (switch on)

| They do | Before | Now |
|---|---|---|
| Chat on the web, then text the line | Coach greets them as a stranger | Coach answers their text, knowing the web chat |
| Text their activation code after chatting on the web | Fresh greeting | "You're connected with {coach}. Picking up where we left off — what's on your mind?" |
| Call after chatting (web or SMS) | Fresh greeting | "Welcome back. We can pick up where we left off. What's on your mind?" |
| Text after 12h of silence | Greeting (their message was dropped) | Their message is answered, in context |
| Text on SMS, then open the web page | SMS not shown | SMS turns appear in the web history |
| Text `RESET` | Launch fresh | Wipes the shared conversation, then launch fresh — **the web view clears too** |
| Never chatted anywhere | Greeting | Greeting (unchanged) |

---

## What changed, file by file

### `lib-config.mjs`
- `KV_FIELDS` += `sharedMemory` (per-coach override reaches KV).
- `CONFIG_DEFAULTS.sharedMemory = 'off'`.
- `configProblems`: global must be `"on"` / `"off"`.
- `coachProblems`: per-coach must be boolean — a string `"false"` would read as on.

### `coach-router.worker.js`
- `CONFIG_FALLBACK.sharedMemory = 'off'`.
- **New helpers** (section 7, beside the Voiceflow calls):
  - `sharedMemoryOn(cfg, coach)` — coach boolean wins, else global.
  - `vfUserFor(cfg, coach, phone, contactId)` — `ghl_<contactId>` or `phone:<phone>`.
    No contactId → always `phone:`, so a stranger can never be merged in.
  - `isSharedUser(id)`.
  - `vfIsLive(env, coach, userID)` — `GET /state/user/<id>`, true if `stack` non-empty.
    Any error → false → normal launch.
- **`handleSms`**
  - The fixed `phone:` ID is gone. The ID is picked per coach **after** the entitlement
    gate, from the lease's `contactId` (already read — no extra KV cost).
  - Activation code: ID from the redeemed token's `contactId`.
  - `RESET`: if the ID is shared, `DELETE` the Voiceflow state before launching.
  - No-session path passes the member's message along so a live conversation answers it.
  - Pinned turn moved into a small `smsTurn()` helper (same code as before).
- **`startCoachOverSms(env, from, userID, coach, { text })`** — if shared **and** live:
  answer `text` if there is one, else reply "Picking up where we left off". Otherwise launch
  exactly as before. The state check runs only here — at conversation start, never per message.
- **Voice**
  - `voiceSessionFor(cfg, coach, from, entitlement)` builds the session with `vfUser`.
    Both call-start paths (straight-through and the name/code route) use it.
  - `voiceInlineStart(..., userID)` — live shared conversation → "Welcome back", no launch.
  - `handleVoiceTurn` uses `session.vfUser` (old sessions without it → `phone:`).
- **Archive**
  - `revokeSubscriber` records `sharedUserID` when the switch was on for that coach.
  - `sweepArchives` deletes `userID` **and** `sharedUserID`.
  - `deleteVoiceflowState` treats **404 as success** (two phones on one contact queue the
    same shared ID twice).
- **`webUserID`** — a verified session is always `ghl_<contactId>` (see the Fix #1 log entry;
  the first version tied this to the switch). A client still can't claim it: an
  unauthenticated `ghl_c1` becomes `web:ghl_c1` (tested).
- `__test` exports the new helpers plus `handleSms` / `handleVoiceEntry`.

### `coaches.json`
- `shared.config.sharedMemory: "off"` added so the switch is visible. No behaviour change.

### `verify.test.mjs` — 59 new checks
ID choice (on/off/override/no contact) · `vfIsLive` incl. errors · SMS: live → text turn, not
live → launch, off → old behaviour byte-for-byte (no state GET), overrides both ways, pinned
turn has no per-message GET, activation live/not live, RESET deletes before launch, RESET off
deletes nothing, non-subscriber never reaches Voiceflow · Voice: session `vfUser`, live →
welcome back, not live → launch, off → phone · Archive: both IDs deleted, off records none,
404 clears · web endpoint on/off and no client spoofing · config validation.

### Cost
- Per message: **zero** extra KV reads/writes, **zero** extra Voiceflow calls.
- Per conversation start: **one** extra Voiceflow `GET` (only when the switch is on).

---

## ⚠ Things you should know before switching it on

1. ~~The web page's Voiceflow key is public.~~ **Fixed in `freddy-v2`** — see "Fix #1" below.
   **Rotate the old key** (`VF.DM.6a7abba2…`) in Voiceflow once the new page is live: it has
   been in public page source and still works until it's revoked.

2. ~~The `channel` variable sticks.~~ **Fixed** — the Worker's `/api/vf-interact` sets
   `channel: web` on every web turn (verified in the simulation: web → SMS → web reads
   `(web)` again).

3. **Stickler: his page has no memory at all yet.** The local copy
   `ms-coach-router-visible+meet` still calls Voiceflow directly (its own key in the source,
   version `6a52da46bc446f70628c598d`) and picks a **random ID on every page load**, so it
   never remembers anyone, on the web or across channels. Leave `sharedMemory` off for 1042
   until his page gets the same update as `freddy-v2` (same edit, `COACH_CODE: "1042"`).

4. **`dial` voice mode is unaffected.** A coach with `voiceMode: "dial"` hands the call to
   Voiceflow's own Twilio integration, which picks its own user ID. Both current coaches are
   `inline`, so this doesn't apply today.

5. **Old SMS conversations don't move.** Anything under `phone:<number>` stays there. Switching
   the feature **off** brings that conversation straight back. (No real SMS traffic since
   2026-08-26, so there's nothing to lose.)

6. **Not fixed here: the SMS 11200 timeout.** SMS still has no soft deadline like voice's 8s.
   This change adds one `GET` only at conversation start, but a slow Voiceflow still risks
   Twilio's 15s limit on any SMS turn.

7. **Pre-existing, unchanged:** a subscriber with two coaches only has their *first* coach's
   conversation deleted by the archive sweep (`rec.codes[0]`).

---

## Rollout — the order matters

> **Status 2026-09-25:** steps 1–3 done and switched on for **all** coaches (not just Freddy —
> steps 6/8 superseded). Remaining: paste both pages (4), rotate both old keys (5), real
> handset test (7). Details in the log entry "MADE LIVE".

1. `cd coach-router` → `npm run check && npm test` — expect `614 passed, 0 failed`.
2. **`npm run deploy`** — safe with the switch off. The current live page keeps working
   (it still talks to Voiceflow directly until step 4).
3. **`npm run seed`** — pushes the `"off"` config (a no-op in effect).
4. **Paste the new `freddy-v2` into Freddy's live coach page** (book-coach.ai). Only **after**
   step 2: the new page needs `/api/vf-state`, which doesn't exist until the deploy.
   Check: open the course lesson → the coach greets you / shows your past chat, and the
   browser console has no errors.
5. **Rotate the old Voiceflow key** for Freddy's project (it was public).
   The Worker's own key (`VF_KEY_1043` secret) is untouched by this.
6. Add `"sharedMemory": true` to **Freddy (1043)** in `coaches.json` → `npm run seed`.
7. Test as a member: chat on the web page → text the line from the linked US handset →
   the coach should know the web chat → reload the web page, the SMS turns show →
   call → "Welcome back".
8. Stickler (1042) only after his page gets the same update (item 3 above).

**Rollback:** set it `"off"` (or `false` on the coach) → `npm run seed`. For a code rollback,
copy the `.bak-20260925-memory` files back and `npm run deploy`.

---

## Log

### 2026-09-25 — backups

`coach-router` has no git history of its own, so originals were copied first:

```
coach-router.worker.js.bak-20260925-memory
lib-config.mjs.bak-20260925-memory
verify.test.mjs.bak-20260925-memory
coaches.json.bak-20260925-memory
seed-coaches.mjs.bak-20260925-memory   (not edited in the end - seed needed no change)
```

### 2026-09-25 — config switch
`sharedMemory` added to `CONFIG_DEFAULTS` (`"off"`), `KV_FIELDS`, both validators, and the
Worker's `CONFIG_FALLBACK`. `seed-coaches.mjs` needed no change — it prints and pushes
whatever `runtimeConfig` returns.

### 2026-09-25 — Worker
Helpers, SMS, voice, RESET, archive, `webUserID` as listed above. One design choice worth
recording: **SMS recomputes the ID each message** (pure function over the lease it already
reads), while **voice stores it in the session** at call start (the turn loop doesn't read the
lease, and a KV read per utterance would sit inside the 8s deadline).

### 2026-09-25 — tests
First run: 602/1 — the failure was the test, not the code (`sanitizeForSpeech` title-cases
`GREETING` → `Greeting` so Polly doesn't spell it). Made it case-insensitive.
Final: **603 passed, 0 failed.** `npm run seed` dry run validates.

### 2026-09-25 — coaches.json
Added `"sharedMemory": "off"` under `shared.config`. **Not deployed, not seeded.**

### 2026-09-25 — Fix #1 and #2: `freddy-v2` goes through the Worker

**Why:** the page carried Freddy's Voiceflow API key in its source. With shared memory, that key
plus a member's contactId (visible in the lesson iframe URL) would read their texts and calls.

**Worker (`coach-router.worker.js`):**
- `webCoachAndUser()` — one place that turns a web request into `{ coach, userID }`; used by
  both web endpoints so they can't disagree.
- **New `POST /api/vf-state`** `{ code, sessionToken, op: "get" | "reset" }`.
  `get` returns only `{ userID, live, memory: { _memory_, vf_memory } }` — never the rest of the
  state (e.g. `user_phone`). `reset` deletes the member's state.
- `/api/vf-interact` accepts `tts: true` so the page keeps Voiceflow's own voice audio. It
  already set `channel: 'web'` on every turn, which is what fixes #2.
- **`webUserID` changed:** a verified session is now always `ghl_<contactId>` — the ID the page
  has always built for itself, so **existing web conversations carry over**. The old
  `phone:` / `ghl:` choice is gone; no live page ever called `/api/vf-interact`, so nothing
  depended on it. Existing tests updated to match.
- Unverified callers are unchanged: whatever ID they send is namespaced to `web:…`, so naming
  `ghl_c1` gets you `web:ghl_c1`, never the member (tested).

**Page (`ghl-shopify subscription\freddy-v2`, backup `freddy-v2.bak-20260925-memory`):**
- `CONFIG`: `VF_API_KEY`, `VF_VERSION_ID`, `VF_PROJECT_ID` **removed**; `COACH_CODE: "1043"`
  and `WORKER_URL` added. No Voiceflow URL or key left anywhere in the file (grepped).
- `MEMBER` — `cid` + `em` read at load, before the activation script strips them from the URL.
- `getSessionToken()` — `POST /api/web/session` with `cid` + `em`; the Worker checks the email
  matches and the contact holds the coach. Token cached in memory + `sessionStorage` for its
  lifetime (renewed 5 min early). A 403 (not entitled) stops asking for that page load.
- `workerPost()` — every coach call: chat (`vfInteract`), history (`fetchState`),
  "start over" (restart button). Everything else on the page (rendering, audio, buttons,
  activation box) is untouched.
- `VF_USER_ID` is now only the per-browser fallback for visitors without a session. It is
  **no longer `ghl_<cid>`**: found in simulation — if a member's session failed, the fallback
  `web:ghl_<cid>` was a conversation anyone typing their contactId would share.

**Verified:**
- All three `<script>` blocks pass `node --check`.
- Worker tests: **614 passed, 0 failed.**
- End-to-end simulation (`scratchpad/sim-shared-memory.mjs`): the page's **real** functions,
  extracted from the file, run against the **real** Worker with fake Voiceflow/GHL —
  web chat → SMS from the linked phone continues it → reload shows the SMS turn and `channel`
  is `web` again → a stranger naming the member's ID gets nothing → the member's `cid` with the
  wrong email gets nothing → "start over" wipes it → one session token per page load. **17/17.**

**Costs to know:**
- Each page open by a member now makes one `/api/web/session` call = **1 GHL API read + 2 KV
  writes** (reused for 2h within the tab). On the free plan's 1,000 writes/day that's roughly
  400–500 member page opens a day before it matters.
- Page load does one extra round trip (the session) before the history shows.

**Other copy:** `AA_LeadershipBooks\freddy-v2` is still the old version (it was identical).
Replace it with this one if that's the copy you paste from.

### 2026-09-25 — deploy
`npm run deploy` was **blocked by Claude Code's permission check** (production deploy). Not run.
`npm run seed` not run either (production KV write). Both left for you — see Rollout.

### 2026-09-25 — MADE LIVE, for every coach (on your instruction)

**Decision:** one global switch, no per-coach overrides — so every present coach and every coach
added later behaves the same. `coaches.json` → `shared.config.sharedMemory: "on"`.

1. Tests: 614 passed, 0 failed.
2. **Deployed.** `npm run deploy` fails here because `wrangler` isn't installed in the
   project (`'wrangler' is not recognized`) — used `npx wrangler deploy` instead.
   Version **`119545c9-cc52-4b82-b272-0fb832968ee7`**. `/api/vf-state` now exists (403 without
   an allowed Origin, as designed); `/health` → `ok: true, coachCount: 2, problemCount: 0`.
3. **Seeded** (`node seed-coaches.mjs --write`): wrote `coach:1042`, `coach:1043`, `config`.
   Read back from production KV: `config.sharedMemory = "on"`, no override on `coach:1043`.
   Secrets unchanged — no `sync-secrets` needed.
4. **Stickler's page** `coach-router\ms-coach-router-visible+meet` (backup
   `.bak-20260925-memory`) — same change as `freddy-v2`, `COACH_CODE: "1042"`. It also had
   **no history on load** (random ID per page load, `launch` every time); it now has
   `fetchState` / `memoryToMessages` / `bootCoach` copied from `freddy-v2`. It has no
   restart button, so none added. Key and Voiceflow URLs gone (grepped), 3/3 scripts pass
   `node --check`, simulation with the global switch and no override: **17/17**.

**What is live right now, before you paste the pages:**

| | SMS / calls | Web |
|---|---|---|
| Freddy | shared ID `ghl_<contactId>` | old page still talks to Voiceflow directly **as `ghl_<cid>`** — so web ↔ SMS continuity **already works**, but the key is still exposed until you paste |
| Stickler | shared ID `ghl_<contactId>` | old page uses a random ID per load — **no web memory and no continuity** until you paste; SMS ↔ calls continuity works |
| Future coaches | shared automatically | whatever page they get — see "New coaches" below |

**Stickler — one behaviour change to know:** his old page ran Voiceflow version
`6a52da46bc446f70628c598d` directly. Through the Worker it runs `coaches.json`'s
`versionID: "main"` — the same version his SMS and calls already use. If `…598d` held
unpublished changes the web had been using, publish them in Voiceflow.

### New coaches — what "automatic" covers

- **Worker side (SMS, calls, archive, RESET): automatic.** A new entry in `coaches.json` with no
  `sharedMemory` field inherits `"on"`.
- **Web side: needs the new page.** Build each new coach page from the updated `freddy-v2`
  (not from an older copy with `VF_API_KEY` in it). Per coach, change only the author details
  and **`COACH_CODE`** to the new code. No Voiceflow key goes in the page.
- To exempt a coach later: `"sharedMemory": false` on its entry → `npm run seed`.

### 2026-09-25 — `freddy-v2`: choose Worker or direct in CONFIG

You asked for the Voiceflow fields back in the config, with the choice of going through the
Worker or straight to Voiceflow.

```js
CONNECTION: "worker",   // "worker" (recommended) | "direct"

// used when "worker"
COACH_CODE: "1043",
WORKER_URL: "https://coach-router.bookcoachai.workers.dev",

// used when "direct"
VF_API_KEY: "",         // empty on purpose - paste only if you switch to "direct"
VF_VERSION_ID: "6a3339b6eb283c59b70cfa53",
VF_PROJECT_ID: "6a3339b6eb283c59b70cfa52"
```

- **`VF_API_KEY` ships empty.** Whatever is in that field is readable in the page source in
  either mode, even when unused. The old key was not put back (it's due to be rotated).
- **Direct mode** is the old behaviour, plus two things so it still works with shared memory:
  the member's ID is `ghl_<cid>` (the ID SMS/calls use), and the page sets `channel: web`
  once per page load (the Worker does that in Worker mode). Anyone without a `cid` gets a
  per-browser ID. Empty key in direct mode → console error, coach can't connect.
- Anything other than `"direct"` (including missing) means the Worker. Case-insensitive.
- One code path per operation: `vfInteract`, `fetchState`, `coachReset` each branch on the
  mode; everything else on the page is unchanged.
- **Risk of direct mode, stated in the config comment:** with shared memory on, the page key +
  a member's contactId (it's in the lesson iframe URL) reads their web chat **and** their texts
  and calls. Testing / private links only.

Verified: 3/3 scripts `node --check`; Worker-mode simulation **17/17**; new direct-mode
simulation **16/16** (page key only, no Worker calls, channel set once, SMS via the real Worker
continues the direct web chat, reload shows it, reset deletes it, mode parsing).
Stickler's page does **not** have the option yet.
