# Coach Router — handoff / state of play

**Last updated:** 2026-08-26
**Purpose:** everything a fresh session needs to pick this up. Read alongside
`README-coach-router.md` (the deployment runbook) — this file records *what is actually done*,
*what was decided and why*, and *what is still open*.

**No secrets in this file.** All credentials live in `coaches.json` (gitignored) and as
Cloudflare Worker secrets. See "Configuration" below for names only.

---

## 1. What this is

Leadership Books runs a set of "Book Coach AI" agents — one Voiceflow project per author, each
with its own global prompt, playbooks and knowledge base built from that author's books. The
coaching architecture is shared; the personality is not. Every coach must sound unmistakably
like its own author.

This repo is **one multi-tenant Cloudflare Worker** acting as the single front door for three
channels — web, SMS and telephone — with **one public phone number for all coaches**. Callers
identify a coach by code or by the author's name, and the Worker routes to that author's
Voiceflow agent.

It replaces the old per-coach proxy Workers.

### Endpoints

| Endpoint | Purpose |
|---|---|
| `POST /api/vf-interact` | Web pages. Returns `{ userID, traces }` — raw trace array so pages keep rendering their own cards/buttons. |
| `POST /api/heygen-token` | HeyGen streaming token per coach. (HeyGen currently inactive.) |
| `POST /twilio/sms` | Twilio "a message comes in". |
| `POST /twilio/voice` | Twilio "a call comes in" — greeting + code capture. |
| `POST /twilio/voice/route` | Caller submitted a code / spoke a name. |
| `POST /twilio/voice/turn` | Inline voice conversation loop. |
| `POST /twilio/voice/wait` | **Added 2026-08-21.** Collects a Voiceflow reply slower than Twilio's 15s webhook timeout. |
| `GET /health` | Ops. Public summary; per-coach detail requires a token. |

---

## 2. Live state

> **2026-09-19 — the commercial layer feeding this Worker is complete and proven.** Trials start,
> expire, convert and revoke. Config now live: `allowTestSubscriptions: false`,
> `autoLinkGhlPhone: false` (**activation is by texted code only**), `cronStaleAfterMinutes: 90`,
> `versionID: "main"`, decline copy set. The Worker also publishes a `centitle:` entitlement map and
> writes session records frugally. **356 tests.** See
> `../ghl-shopify subscription/plans/00-master-plan.md`.

| Thing | Value |
|---|---|
| Worker URL | `https://coach-router.bookcoachai.workers.dev` |
| Public Twilio number | `+18542545009` (parent Leadership Books account) |
| Cloudflare account | `Muhammadzain@leadershipbooks.net's Account` |
| workers.dev subdomain | `bookcoachai` (account-wide; changing it breaks every URL) |
| KV binding | `COACH_KV` — production + preview namespaces, IDs in `wrangler.toml` |
| Website | `https://www.book-coach.ai` (GoHighLevel) |
| Members area | `https://login.leadershipbookspublishers.com` (Course360) — in `ALLOWED_ORIGIN` |
| `/health` | returns `ok: true`, and **503 when the entitlement sync goes stale** |
| Cron | `*/15 * * * *` — subscriber reconcile + retention sweep |
| Logs | **Persisted.** `[observability]` is on, so log lines are browsable for a few days under Workers & Pages → coach-router → Logs. `npx wrangler tail` is for live watching only. |
| **Entitlement mode** | **`enforce`** (SMS + voice) — only subscribers with a linked handset get through. `webGateMode` still `warn`: the coach page is ungated. |
| `autoLinkGhlPhone` | **`false`** since 2026-09-17. A phone number on a GHL contact or subscription no longer links a handset — **activation is by texted code only.** Reversible with `npm run seed`. |
| `allowTestSubscriptions` | **`false`** since 2026-09-17. A Stripe test-mode subscription no longer grants a real coach. ✅ **Verified working 2026-09-19**: a live test-mode subscription reading `status: active, liveMode: false` was correctly ignored — the reconcile reported `active subs 0` while the contact stayed entitled via its tag. |
| `cronStaleAfterMinutes` | **`90`** since 2026-09-17. `/health` returns 503 once the reconcile has been silent past this — a cron-liveness alarm, separate from the 24h lease-staleness one. |

### Coaches in KV (production and preview)

| Code | Name | Voiceflow project | Version |
|---|---|---|---|
| `1042` | Micheal Stickler | `6a52da46bc446f70628c598c` | `6a52da46bc446f70628c598d` |

✅ **PUBLISHED 2026-09-19, and the Worker is pinned to it.** The environment alias is **`main`** —
**not** `production`. Both `production` and `development` still return
`400 Unable to resolve … alias`; `main` returns `200`. `coaches.json` carries `versionID: "main"`.

**Proved distinct from the draft** by probing both: `main` renders *"today's coaching"* with a
straight apostrophe, the draft `6a52da46bc446f70628c598d` renders *"today’s"* with a curly one. The
draft has diverged since publication, so the two are genuinely separate snapshots.

> 🚨 **Consequence: canvas edits no longer reach customers until published.** That is the point, and
> it is also the new way to be confused — edit, test, see nothing change live, assume a breakage.

**Historical:** the version used to be a DRAFT. `versionID: "production"` returned
`Unable to resolve production version alias`, so the project had never been published and the
draft ID was the only one that worked.

> **Consequence: there is no staging.** Every edit on the Voiceflow canvas is instantly live to
> anyone texting, calling or on the web. Before real subscribers, publish and switch that coach
> to `production` — and note that is a `coaches.json` edit **plus** `npm run seed`, because the
> Worker reads `versionID` from KV, not from the file.

### Worker secrets (5, names only)

`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `VF_KEY_1042`, `HEALTH_TOKEN`, `GHL_API_TOKEN`

`HEYGEN_API_KEY` is deliberately unset — HeyGen is inactive.

### KV keyspace

| Key | Holds | TTL |
|---|---|---|
| `coach:<CODE>` | Coach config; gained `ghlTag` | none |
| `config` | Runtime knobs — `entitlementMode`, `leaseHours`, retention, decline copy | none |
| `syncmeta` | `lastRunAt`, `lastOk`, counts — drives the /health alarm | none |
| `sess:<channel>:<phone>` | Which coach and when. **No message text.** Written frugally since 2026-09-19 — see `touchSession`: rewritten only on a content change or past half the TTL, not on every message. Carries a `touched` timestamp for that purpose. | 12h sliding |
| `pend:<CallSid>` | **The one place a reply is held**: a slow voice answer, deleted on read | 300s |
| `sub:<E.164>` | `{ contactId, codes[], expires }` — the hot path, one read per turn | none (lease in body) |
| `bind:<E.164>` | `{ contactId }` — handset↔contact. **Survives churn** | none |
| `contact:<contactId>` | `{ phones[] }` — reverse index the reconcile walks | none |
| `centitle:<contactId>` | **Published entitlement** — `{ codes[], updatedAt }`, written by the reconcile and read by `/api/bind/mint` and `/api/web/session`. Added 2026-09-17 so a **paying subscriber with no tag** is visible to those paths. Written only when the codes change. | none |
| `tok:<TOKEN>` | Activation code, single use | 15 min |
| `arch:<E.164>` | Pending state deletion. **No TTL — the record IS the queue** | none |

**Conversations live in Voiceflow, not here.** The only exception is `pend:`, which parks one voice
reply for up to 300s so a slow answer does not drop the call, and deletes it the moment it is spoken.
That is the §6.11 fix, and it is load-bearing.

### Voiceflow transcripts — already handled, no code

Voiceflow records **every** conversation automatically. 91 transcripts existed before anyone looked,
back to 2026-07-12, on the **draft** version. Retention is **6 months** (`expiresAt` = `createdAt`
+ 6mo) and we do not control it. Deleting conversation *state* does **not** delete the transcript —
verified.

---

## 3. Architecture decisions — including ones that CHANGED

The original brief settled the overall shape. Three things changed on 2026-08-21 as facts came
in. **These are decided; don't re-litigate.**

### Unchanged from the brief

- **A single multi-tenant Worker fronts all three channels.** Voiceflow alone can't do it — a
  phone number in Voiceflow binds to one agent, so one number serving many personalities
  requires code-based switching in front of it.
- **GoHighLevel stays out of the conversational path.** Its inbound webhook has no synchronous
  JSON response, so it can't reply to Twilio inside the request cycle a messaging webhook
  requires; every turn would burn a premium workflow execution costing more than the message
  itself; and it has no real-time voice path. GHL keeps hosting the site, owning the contact
  record, and storing transcripts.
- **Voice routes through the Worker, not around it** — that's what makes "one number" real and
  lets the Worker set the Voiceflow `userID` so SMS and phone share a session.
- **Registry in KV** (`coach:<CODE>`), so adding a coach needs no redeploy. API keys are Worker
  secrets named by `keyVar`; they never enter KV.
- **`userID` is `phone:<E.164>`** on both SMS and voice; web uses `web:<uuid>`.

### CHANGED — no subaccount, use the parent account

The brief called for a Twilio subaccount so GHL/LeadConnector could never import the coach
number and rewrite its webhooks. Ruled out by two facts:

1. The **A2P 10DLC brand and campaign are already approved on the parent account.**
2. **No further phone numbers can be purchased.** A subaccount needs its own number.

Trading an approved A2P registration for weeks of re-approval, to gain isolation alone, isn't
worth it. So the existing (previously unused) parent-account number is the coach line.

**The webhook-rewrite risk is now handled by keeping Twilio disconnected from GHL** — which has
been done. **If anyone reconnects it, re-check this number's webhooks immediately.** That is the
single point of failure this decision accepts. `node sync-secrets.mjs --verify-twilio` reports
which kind of account the credentials belong to.

### CHANGED — `dial` voice mode is unavailable; everything is `inline`

`dial` mode bridges the caller to a second, hidden Twilio number attached natively to that
coach's Voiceflow agent, which gives Voiceflow ownership of STT/TTS/barge-in. It needs one
number per coach, so with no purchases possible it is off the table.

What `inline` costs, on the record:

- **~2–3 seconds of dead air per turn, and no barge-in** — the caller can't interrupt.
- **Polly speaks, not the Voiceflow voice.** If a coach's project uses a standard Amazon Polly
  voice, set the identical voice in that coach's `ttsVoice` and they match exactly, for free.
  If it uses a cloned or premium voice of the author, Polly sounds like a stranger — and with
  no `dial` fallback the only remaining route to the author's real voice is an **audio relay**
  (`tts: true` on the interact config, Worker hosts the returned audio and `<Play>`s it). That
  adds Voiceflow TTS billing and more latency to an already slow path. **Not built.**
  *Open question: what voice does project 1042 actually use?*
- **Upside:** `inline` is the mode that *guarantees* cross-channel continuity, because the
  Worker sets the `phone:<E.164>` userID itself. In `dial` mode that was never guaranteed.

### CHANGED — the phone number is the parent account's, and was idle

Confirmed nothing live was running on `+18542545009` before it was pointed at the Worker.

---

## 4. Runbook progress

| Step | Status |
|---|---|
| 1 — A2P 10DLC registration | **Done.** Brand + campaign approved on the parent account. |
| 2.1–2.4 — Voiceflow prompt changes | Reported done by the user; not verifiable from this repo. |
| 2.5 — record the right version ID | **Done and verified** against the live runtime (draft ID; see §2). |
| 3 — KV setup | **Done.** Both namespaces seeded; round-trip verified. |
| 3.1 — verify version IDs | **Done.** `node verify-voiceflow.mjs` passes and returns Stickler's own greeting. |
| 4 — Secrets | **Done.** 5 secrets pushed; Twilio credentials verified against Twilio's API. |
| 5 — Deploy + `/health` | **Done.** `ok: true`, `keyResolved: true`, `twilioValidation: enabled`. |
| 6 — Twilio webhooks | **Both confirmed live.** Voice by a real inbound call; **SMS proven 2026-08-28** when a colleague in the US texted an activation code in and the coach replied. The Messaging Service trap in §7 turned out not to apply. |
| 7 — Per-coach dial numbers | **N/A**, permanently — see §3. |
| 8 — Repoint web pages | **Not started.** Pages still talk to the old per-coach proxy Workers. Phase 5 of §10 ships with this. |
| 9 — GHL transcripts webhook | **Not needed.** Voiceflow already records every conversation itself — see §2. |
| 10 — Subscriber entitlement | **Phases 0-4, 6, 7 done; running in `warn`.** See §10. |

---

## 5. Repo layout

| File | What it is |
|---|---|
| **`coaches.json`** | **Single source of truth.** Codes, names, aliases, Voiceflow IDs, API keys, shared credentials. **Gitignored.** Paste a value once, here, and nowhere else. |
| `coaches.example.json` | Committed blank template. |
| `lib-config.mjs` | Reads `coaches.json`. **Enforces the KV/secret split via an allowlist.** |
| `coach-router.worker.js` | The Worker. |
| `wrangler.toml` | Bindings and non-secret vars. Secrets appear only as commented commands. |
| `seed-coaches.mjs` | `coaches.json` → KV (non-secret fields only). |
| `sync-secrets.mjs` | `coaches.json` → Worker secrets. Also `--dev-vars`, `--check`, `--verify-twilio`. |
| `verify-voiceflow.mjs` | Proves each project/version/key triple resolves on the live runtime. |
| `simulate-twilio.mjs` | Sends correctly-signed Twilio webhooks — test everything with no phone. **Also fails on the catch-all error TwiML**, which a status check alone cannot see. |
| `sync-subscribers.mjs` | Entitlement status, on-demand reconcile, KV inspection. Calls the Worker rather than reimplementing the reconcile, so the two cannot drift. |
| `ms-coach-router` | **The live coach page** (`book-coach.ai/michael-stickler`), as published in GHL. Holds the activation UI: CSS in `<style>`, one `<div id="activate">` under the Buy buttons, and its script in a second `<script>` block. Edit here, then re-paste into GHL. |
| `coach-page-snippet.html` | Header/tracking-code snippet for the coach page: picks up a `?s=` web session token and attaches it to Worker calls. Installed. Dormant until the chat is repointed to the Worker. |
| `members-activation.html` | **Superseded.** The original lesson-page block, before the editor's sanitiser forced the UI into the coach page. Kept for reference only — do not install. |
| `verify.test.mjs` | **196** unit tests over the pure helpers in the Worker and `lib-config.mjs`. |
| `README-coach-router.md` | Deployment runbook. |
| `TEST-CHECKLIST.md` | Pre-launch acceptance tests. |
| `plans/` | The entitlement plan: reasoning, task checklist, and a plain-English version for the client. |

### Configuration flow

```
                 ┌──> seed-coaches.mjs  ──> KV              non-secret fields only
coaches.json ────┤                                          (allowlisted in lib-config.mjs)
(gitignored)     └──> sync-secrets.mjs  ──> Worker secrets   API keys only
```

`coaches.json` is never deployed and never read by the Worker. At runtime the Worker reads
non-secret config from KV and keys from Worker secrets. The allowlist in `registryValue()` means
a credential in `coaches.json` **cannot** reach KV even if a new field is added later — verified
by test.

### Commands

```bash
npm run check                       # syntax-check every script
npm test                            # 196 unit tests
node seed-coaches.mjs               # dry run: validate coaches.json
node seed-coaches.mjs --write       # -> production KV
node seed-coaches.mjs --write --preview
node seed-coaches.mjs --list
node sync-secrets.mjs               # dry run: secret names + lengths, never values
node sync-secrets.mjs --write       # one `wrangler secret bulk` call
node sync-secrets.mjs --verify-twilio
node sync-secrets.mjs --check       # wrangler.toml vars vs coaches.json
node sync-secrets.mjs --dev-vars    # generate .dev.vars for `wrangler dev`
node verify-voiceflow.mjs           # one billable launch per coach
node verify-voiceflow.mjs --version production   # try a candidate ID, file unchanged
node simulate-twilio.mjs suite      # signed-webhook checks
node simulate-twilio.mjs sms --body "K7M2QP" --from "+18885550100"   # redeem a code, no phone needed
node simulate-twilio.mjs voice-convo --speech "..."   # follows redirects like Twilio
npm run subs                        # entitlement status: last sync, counts, mode
npm run subs -- --dry               # preview a reconcile, write nothing
npm run subs -- --sync              # reconcile now, do not wait for the cron
npm run subs -- --sync --force      # ...overriding the mass-revocation guard
npm run subs -- --list              # sub: / bind: / arch: in KV
npx wrangler tail                   # live log stream, while a test is running
npx wrangler deploy                 # required after any worker/wrangler.toml change
npx wrangler deploy
npm run push                        # seed + secrets in one go
```

Changing a runtime knob (`entitlementMode`, retention, decline copy): edit `shared.config` in
`coaches.json`, then `npm run seed`. Live within 30s. **No redeploy** — which is the rollback path
for enforcement, and matters because there is no staging.

Adding a coach: add an object to the `coaches` array in `coaches.json`, then `npm run push`.
Live within 60s (in-isolate registry cache); no redeploy.

---

## 6. Work completed 2026-08-21

### Tooling / config

1. **Single source of truth.** Was: `coaches.seed.json` (non-secret) + secrets typed separately
   into `wrangler secret put`. Now one gitignored `coaches.json` holding everything, with
   `lib-config.mjs` routing non-secret fields to KV and keys to Worker secrets. Went through an
   `.env`-style intermediate; JSON won because `code` is a **value**, so renaming a code is one
   edit rather than six key names, and arrays/nesting come free.
2. **`seed-coaches.mjs` — two blocking bugs fixed.**
   - `execFileSync('npx', …)` → ENOENT on Windows; the executable is `npx.cmd`, which Node
     won't spawn without a shell. Now platform-aware. Because `shell:true` does **not** escape
     arguments, the registry JSON now travels via a temp file and `--path` instead of argv.
   - wrangler 4 refuses to guess the namespace when a binding has both `id` and `preview_id`.
     Now explicit: `--preview=false` for production, `--preview` for preview. The old preview
     branch was also missing `--remote`, so it would have written to a local simulated store.
3. **`sync-secrets.mjs`** — pushes all keys in one `wrangler secret bulk` call. Values travel
   in a temp file deleted in a `finally`, never on a command line; only names and character
   counts are printed. `--verify-twilio` calls Twilio's API to prove the SID/token pair works
   **and reports whether it's a parent or subaccount** — catching the exact trap that would
   otherwise appear as unexplained 403s. `--check` reports drift between `wrangler.toml` vars
   and `coaches.json`.
4. **`verify-voiceflow.mjs`** — mirrors the Worker exactly (same host, headers, launch action,
   config), so a pass means the Worker's first turn will work. Prints the returned greeting,
   which catches the failure a status code can't: valid key, valid version, **wrong author**.
   Deletes its probe conversation afterwards.
5. **`simulate-twilio.mjs`** — signs webhooks exactly as Twilio does, so the whole SMS and voice
   flow is testable with no phone, no real texts and no A2P dependency. `voice-convo` follows
   `<Redirect>` and honours `<Pause>`, replaying a full call.
6. **`.gitignore` added** — there was none, so `coaches.json`, `.dev.vars` and `.wrangler/`
   (which holds a simulated KV store) were all on track to be committed.
7. Removed the libuv assertion that printed after `fetch`-using scripts on Windows
   (`process.exit()` while sockets close → use `process.exitCode`).

### Worker changes

8. **`/health` hardened.** It listed every coach's `code` — and a code is the credential a
   subscriber texts. On a public workers.dev URL that let anyone enumerate them. Now the public
   response is `{ok, coachCount, twilioValidation, heygen, problemCount}` and per-coach detail
   requires `HEALTH_TOKEN` via an `x-health-token` header (or `?token=`, supported for browser
   checks but discouraged since URLs are logged). **Fails closed** — no token set means nobody
   gets detail. Constant-time comparison; unit-tested across 7 cases including the empty-vs-empty
   case a naive `===` would pass. Still returns 503 on problems regardless of auth, so external
   monitoring works without the token.
9. **HeyGen check made conditional.** `HEYGEN_API_KEY` is now only required when a coach
   actually has a `heygenAvatarID`. Previously it was an unconditional problem, which made
   `ok: true` unreachable for an SMS/voice-only deployment. `/health` states which way it read
   that, so a skipped check is visible rather than silent.
10. **GSM-7 transliteration — a cost fix.** A single character outside GSM-7 (one em-dash, one
    curly apostrophe, one emoji) forces the whole SMS to UCS-2, cutting the segment size from
    153 characters to 67. A measured 243-character reply cost **4 segments instead of 2**; LLMs
    emit em-dashes constantly, so this was systematic, not occasional. `toGsm7()` now runs
    inside `capSms()`, the single funnel for both the TwiML reply and the REST outbound path.
    Measured after: a 346-character reply is **3 segments where UCS-2 would be 6** — roughly
    halves outbound SMS cost, without depending on the model behaving.
    - Accented Latin actually in GSM-7 (é, ü, à…) is kept verbatim.
    - Diacritics **not** in GSM-7 are **folded to the base letter, not dropped** — a test caught
      that dropping turned "naïve" into "nave", a different word.
    - The truncation marker changed from `…` to `...`, since the ellipsis character itself
      forced UCS-2.
11. **Voice 502 fixed — the big one.** A real call died with
    `Got HTTP 502 … /twilio/voice/turn`, at **15,011 ms** against Twilio's hard 15-second
    webhook timeout. `vfInteract` had no deadline, and an LLM coaching reply can legitimately
    take longer, so Twilio abandoned the webhook, played its own error and ended the call.
    The fix does not try to make Voiceflow faster — it stops Twilio waiting on it:
    - The turn races Voiceflow against an **8-second soft deadline**.
    - Wins → answer immediately, as before.
    - Doesn't win → the still-running request is handed to **`ctx.waitUntil()`** so it continues
      after the response is sent (rather than being aborted), the result is parked in KV under
      `pend:<CallSid>` (300s TTL), and the caller hears "Let me think about that." then a
      redirect to the new `/twilio/voice/wait`.
    - `/voice/wait` collects the parked answer and speaks it; if not ready it holds with a 2s
      pause and polls, up to 6 times, then apologises and re-prompts.
    - **The answer is never discarded.** An abort-and-apologise fix would have made the caller
      repeat themselves and likely time out again on the same question.
    - Verified live: hop 1 `/voice/turn` 8183 ms → holder; hop 2 `/voice/wait` 1695 ms → full
      answer. Every request lands far inside the ceiling, and the ceiling applies **per poll**,
      not cumulatively.

Test counts **as of 2026-08-21**: 46 unit tests, 12 simulation checks. Both suites have grown since — see §5 and §10 for the current numbers.

---

## 7. Open items

### Needs a decision or an answer

- **RESOLVED 2026-08-28 — the SMS webhook works.** A real inbound text from a US handset reached
  `/twilio/sms` and the coach replied. Left below for the record, since the trap is real for any
  future number.
- ~~**SMS webhook may not be configured.**~~ A live call proved the voice webhook works; nothing has
  proved the SMS one. **The trap:** a 10DLC number belongs to a Messaging Service, and inbound
  routing then follows the **Service's** Integration setting — the per-number "A message comes
  in" field is ignored unless that Integration is *Defer to sender's webhook*. Set
  **Messaging → Services → (service) → Integration → Send a webhook** to
  `…/twilio/sms`, HTTP POST. Check **Monitor → Logs → Messaging** to confirm.

  > ⚠ **CORRECTED 2026-09-21 — that is not the live mechanism.** Read from the Twilio API:
  > all three Messaging Services have an **empty `inbound_request_url`** and
  > **`use_inbound_webhook_on_number: true`**, and `+18542545009` itself carries
  > `sms_url → https://coach-router.bookcoachai.workers.dev/twilio/sms`.
  > **Routing is number-level and it is correct.** Do not "fix" it by setting a Service-level
  > webhook — that would change working behaviour on the strength of a stale note.
  > *(A2P campaign `C7VWV40` is VERIFIED and known-accepted — see
  > `../ghl-shopify subscription/plans/11-parking-lot.md`.)*
- **Advanced Opt-Out** should be enabled on the Messaging Service so Twilio sends the STOP/HELP
  compliance replies. The Worker deliberately stays silent on STOP so the subscriber doesn't get
  two messages.
- **What TTS voice does Voiceflow project 1042 use?** Decides whether `ttsVoice` can be matched
  for free or whether the author's real voice needs the audio relay (§3).
- **RESOLVED — the members-area origin is known.** `https://login.leadershipbookspublishers.com`
  is in `ALLOWED_ORIGIN` and verified: it reaches `/api/bind/mint`, an unknown origin gets 403.
  The coach *page* origin below is still unconfirmed.
- **`ALLOWED_ORIGIN` for the coach pages is still a best guess.** Set to `https://www.book-coach.ai,https://book-coach.ai`
  (exact, case-sensitive match on the `Origin` header; `www.` and bare are different origins).
  Not yet confirmed against a real request. Once a coach page is live: F12 → Network → send a
  message → the `vf-interact` request → Request Headers → `Origin:`. If the chat panel is
  iframed from another host, **the iframe's origin** is what gets sent. If it shows
  `Origin: null` (a `srcdoc` or `data:` iframe), no domain will ever match and it needs handling.
  Shortcut: the old per-coach proxy Workers already have the verified value in their CORS config.

### Voiceflow-side observations (not Worker bugs)

- **The greeting says "Welcome back" to first-time contacts.** Authored copy, not a state
  artifact — confirmed on a first-ever probe user ID.
- **The coach speaks about the author in the third person**: *"Michael addresses this directly in
  Chapter 9 of Life Without Reservation."* That cuts against the premise that each coach sounds
  unmistakably like its author.
- **SMS replies run ~346 characters** against the ~300 target in the channel-rules block — close
  but not held.
- **Filler stacking**: *"That's a great question… Such a rich question."* On voice that costs the
  caller real seconds.
- **Speech recognition needed three attempts** to capture the code on one real call. Hints are in
  place (`1042, Micheal Stickler, Michael Stickler, Mike Stickler, Stickler`). Levers if it
  persists: `numDigits` on the keypad path, and `speechTimeout`.

### Cosmetic / low priority

- The display name is spelled **"Micheal Stickler"**. Possibly a typo; it is both shown in SMS
  and spoken aloud by Polly. Left as-is deliberately — it's the client's name to spell. Alias
  variants (`Michael`, `Mike`) were added for speech recognition.
- `npx wrangler` pulls whatever version is newest (4.124 → 4.125 mid-session). Since the
  `--preview=false` requirement is itself version-dependent behaviour, pinning wrangler would
  make seeding reproducible.

### Resolved since 2026-08-21

- **Transcripts.** Voiceflow records everything automatically; nothing needed building, and
  conversations never leave Voiceflow. See §2.
- **No monitoring on `/health`.** It now returns **503** when the entitlement sync goes stale
  (at half the lease, 24h by default), when the last sync failed, or when the mass-revocation guard
  tripped. Point any uptime checker at it.

### Guardrails not yet in place

- **Voiceflow credits are a hard stop** — when the workspace allotment is exhausted, agents stop
  responding and there is no mid-cycle top-up. **No usage alarm has been set.** Voice burns
  credits fastest.
- Nothing external is *watching* `/health` yet, though it now reports 503 on a stale or failed sync.

---

## 8. Cost model

Verify against Twilio's and Voiceflow's current pricing rather than trusting these.

**Fixed:** public Twilio number ~$1.15/mo. Cloudflare Worker + KV effectively free at this
volume (the registry is cached in-isolate for 60s, so a turn isn't a KV read).

**Per use:** SMS ~$0.008/segment + ~$0.003 10DLC carrier surcharge. Voiceflow chat turn
≈ 1 credit ≈ $0.005 plus LLM passthrough. Voice in `inline` mode ~$0.0085/min plus Gather ASR
plus TTS ~$0.0032/100 chars for neural voices.

**Targets:** a 20-message SMS session ≈ $0.30–0.40. Price any subscription off **call minutes,
not texts**.

The GSM-7 fix (§6.10) roughly halves the outbound SMS half of that.

`dial` mode would have been ~$0.0225/min carrier + ~$0.05/min Voiceflow phone hosting
(10 credits/min) — about 10× `inline` — and is unavailable anyway. Twilio ConversationRelay
(~$0.07/min on top of voice) was considered and rejected in the original brief: Voiceflow
already implements that relay behind its native telephony.

---

## 9. Known traps

- **Never import this number into GHL/LeadConnector.** It silently rewrites the webhooks and the
  router goes dark with no error anywhere. With no subaccount isolating it, keeping Twilio
  disconnected from GHL is the only thing preventing this.
- **The Messaging Service overrides the number-level SMS webhook.** See §7.
- **Voiceflow's draft version ID, main environment ID and published version ID are three
  different values that look identical.** Mixing them produces `version does not exist`. Verify
  with `node verify-voiceflow.mjs`.
- **`SKIP_TWILIO_VALIDATION=true` makes every `/twilio/*` endpoint publicly callable.** It is
  absent from the production vars block and `/health` reports `twilioValidation: "DISABLED"`
  whenever it's on.
- **Twilio signs the exact URL it requested.** If a custom domain or proxy ever fronts the
  Worker, set `PUBLIC_BASE_URL` in `wrangler.toml` or every `/twilio/*` request 403s.
- **Coach codes and names must avoid `&` and unusual punctuation** — breaks TwiML and Voiceflow
  tool names. The seeder validates this.
- **A launch is a billable Voiceflow request.** A rounding error, but don't design around it
  being free.
- **Windows:** Node can't spawn `npx` without `.cmd` + a shell, and `shell:true` doesn't escape
  arguments. Any new script shelling out to wrangler must follow the temp-file pattern used in
  `seed-coaches.mjs`.

### Added while building §10

- **The Voiceflow transcripts API takes the RAW key, with no `Bearer` prefix.**
  `Authorization: Bearer <VF.DM…>` returns `401`; the bare key returns `200`. Easy afternoon to lose.
- **The OLD transcripts endpoints lie rather than fail.** `GET /v2/transcripts/<projectID>` still
  answers `200 []` — an empty *superseded* store. `PUT /v2/transcripts` and `GET /v2/projects/<id>`
  return a `503` nginx page. The live API is
  `POST https://realtime-api.voiceflow.com/v1/stable/transcript/search?projectID=…`.
- **GHL answers an unknown contact ID with `400`, not `404`.** Treat any 4xx as not-found, or a
  typo'd ID reaches a member as a server error.
- **KV is eventually consistent — plan on ~60s.** Three times during this work a change looked like
  a bug for a minute and then corrected itself. Before debugging a KV read, wait a minute and re-check.
- **A failed `/twilio/*` request returns `200` with apologetic TwiML**, deliberately, so callers never
  hear Twilio's own error. **A status-code check therefore cannot tell a working reply from a crash** —
  exactly how a thrown exception in `handleVoiceEntry` passed the suite. The simulator now also fails
  on the apology text.
- **`/health` builds `status` and `summary.ok` early.** Anything pushed to `problems` after that point
  is reported in the body but never changes the status code — an alarm that cannot fire. Push before.
- **`sync.ageMinutes` is NOT "time since the cron ran".** `syncmeta` is written frugally — only once
  an hour when counts have not changed (`SYNCMETA_HEARTBEAT_MS`) — so `lastRunAt` lags a **healthy**
  cron by up to 60 minutes. On 2026-09-17 this was misread as four consecutive missed runs on a
  `*/15` schedule; the data was fully consistent with everything working. Any cron alarm must sit
  **above** that heartbeat, which is why `cronStaleAfterMinutes` defaults to 90 and `lib-config`
  refuses anything at or below 60. `/health` reports an `ageMeaning` field for this reason.
- **The Course360 lesson editor strips BOTH `<script>` and `<button>`.** A `<button>` renders as
  unclickable text with the heading and border intact; a `<script>` leaves an empty box. Both look
  installed. **This is why the activation UI lives in the coach page, not in the lesson** — the lesson
  contributes nothing but the iframe. A header-script-plus-MutationObserver variant was explored and
  abandoned; if you find references to `members-lesson-block.html` or `members-header-script.html`,
  they are from that dead end and no such files exist.
- **GHL strips leading indentation from pasted code.** When patching the published page, match on
  content, never on whitespace — anchors with leading spaces silently fail to find anything.
- **Error responses on `/api/*` MUST carry the CORS headers.** Without them a browser cannot read the
  body and reports "CORS header missing / Status code 403", so a rate limit or a failed verification
  is indistinguishable from a network outage. This cost real time chasing browsers, extensions and
  blocklists when the actual cause was a 429 the page was never allowed to read.
- **`/api/bind/status` performs no KV writes on purpose.** It runs on every lesson load, and writes
  are the scarce resource on the free plan (1,000/day). It is therefore also not rate-limited — a
  counter would itself cost a write per load. The GHL lookup is the throttle.
- **Getting a code is not the same as linking a phone.** The handset is linked when the code is
  *texted in*, not when it is displayed. So `/api/bind/status` still reports `linked:false` right after
  a member presses the button, and the page correctly keeps showing it. Mistaking this for a bug is
  easy — test the link with `simulate-twilio.mjs sms --body <CODE>`.
- **Rebinding a handset must unlink it from the previous contact.** Leaving it in the old
  `contact:<id>.phones` lets the reconcile keep re-granting through the old subscription, so one phone
  answers to two accounts.

---

## 10. Subscriber entitlement — built 2026-08-25/26

**Outstanding work: [`plans/to-do.md`](plans/to-do.md)** — the live list of what is left and whose
it is.

**Full detail — `plans/`, in reading order:**

| File | What it is |
|---|---|
| [`to-do.md`](plans/to-do.md) | **Live list of outstanding work**, and whose it is. Start here. |
| [`01-plan-and-decisions.md`](plans/01-plan-and-decisions.md) | The reasoning, the decisions, and what was verified against the live APIs. |
| [`02-phase-record.md`](plans/02-phase-record.md) | What was actually built, phase by phase, with the traps found on the way. |
| [`03-plain-english-overview.md`](plans/03-plain-english-overview.md) | The same work with no jargon — for talking the client through it. |
| [`04-live-test-plan.md`](plans/04-live-test-plan.md) | The live test with a colleague, plus the Leadership Books side of the work. |
| [`05-colleague-checklist.txt`](plans/05-colleague-checklist.txt) | **The test to hand a tester.** Plain text, browser and phone only, no terminal. |
| [`06-shopify-tag-automation.md`](plans/06-shopify-tag-automation.md) | Plan for granting the coach tag automatically on a Shopify purchase. Blocked on a GHL scope and a one-time-vs-recurring decision. |
| [`07-ghl-funnel-setup.md`](plans/07-ghl-funnel-setup.md) | Step-by-step for building the GHL funnel that sells coach access. No terminal needed. |

Coaches are now subscription-gated from GoHighLevel (Course360). The coach menu is gone. **Phases
0-4, 6 and 7 are done and deployed; only Phase 5 (web channel) remains.** Entitlement runs in
**`warn`**: every caller is checked and logged, nobody is refused. Tests 46 -> 196.

| Phase | State |
|---|---|
| 0 — Config plumbing | ✅ GHL token/location/tag through `coaches.json`; `config` key in KV |
| 1 — Transcript capture | ✅ **No code needed** — Voiceflow already records everything |
| 2 — Entitlement store & reconcile | ✅ Cron, tag-sourced, lease-based |
| 3 — Handset binding | ✅ Members-area code, texted once, links phone to GHL contact |
| 4 — Enforcement & menu removal | ✅ Menu deleted; running in `warn` |
| 5 — Web channel | ☐ Ships with runbook step 8 (repoint the pages) |
| 6 — Archive & retention | ✅ 30-day state deletion, no export, no reminders |
| 7 — Ops & alarms | ✅ `/health` 503 on a stale or failed sync |

### Where this stands, 2026-08-26

| | |
|---|---|
| Built and deployed | Phases 0-4, 6, 7, plus the activation UI |
| Half done | Phase 5 — gate built, but the coach page still bypasses the Worker (see Still open) |
| Not built, deliberately | Voiceflow credit alarm — no endpoint found that reports the balance |
| Enforcement | **`entitlementMode: enforce`** since 2026-08-28 — SMS and voice gated. `webGateMode: warn` — the web chat is still open (item 1 of the to-do). |
| Tests | 242 |
| Subscribers in KV | 0 (test numbers removed) |

**The single blocker to a real launch is not code.** Only one GHL contact holds
`bookcoach-micheal-stickler-active`, applied by hand. Until Course360 adds it on course grant and
removes it on revoke, every other member gets "no active coach subscription". Everything else is
waiting on that.

**Verified end to end on 2026-08-26:** code issued from inside the course lesson → texted in →
handset linked to the GHL contact → coach answered in character → follow-up message needed no code →
page then showed the "Phone linked" state. The only untested link is a *real* inbound SMS through
Twilio's Messaging Service, which the simulator cannot prove — see the live test plan in
[`plans/04-live-test-plan.md`](plans/04-live-test-plan.md).

### Monitoring, without watching a terminal

- **`/health` is the alarm.** It returns **503** when the entitlement sync is stale (past half the
  lease, 24h), when the last sync failed, or when the mass-revocation guard tripped. Point any uptime
  checker at `https://coach-router.bookcoachai.workers.dev/health` — the public response is safe to
  poll and names no coach. That is what tells you something is wrong.
- **Logs are persisted** (`[observability]`): Workers & Pages → coach-router → Logs, searchable for a
  few days. This is where `[entitlement] warn:` lines and `[cors] refused` lines land — use it to
  answer "why was that member refused?" after the fact.
- **`npm run subs`** prints last sync, counts and mode any time.
- `npx wrangler tail` is only for watching live during a test.
### How it works, end to end

1. Every 15 minutes the Worker asks GHL which contacts hold each coach's `ghlTag` and brings KV into
   line. It never reasons about billing: expiry, cancellation, failed payment, refund and manual
   removal all reduce to "does the tag exist right now". **How access ends is a GHL setting, not a
   code change.**
2. A logged-in member opens the members area, gets a 6-character code, texts it once. That inbound
   SMS proves they hold the handset, so the phone is linked to their GHL contact permanently.
3. Inbound texts and calls cost **one KV read** to check entitlement, scoped to that person's coach.
4. Losing the tag revokes access, clears the live session, and keeps the phone link so returning
   needs no re-activation. 30 days later the Voiceflow conversation state is deleted.

### How the activation UI actually works (as built, 2026-08-26)

The Course360 lesson editor strips `<script>` and `<button>`, so **nothing executable can live in the
lesson.** The lesson contributes exactly one thing: the coach iframe, with the member passed through
on its URL.

```
lesson iframe src:  .../michael-stickler?cid={{contact.id}}&em={{contact.email}}
        |
        v
coach page (ms-coach-router) reads cid+em, strips them from the visible URL,
        |          asks POST /api/bind/status  -> linked?  show "Phone linked"
        |                                      -> not?     show the button
        v
button  -> POST /api/bind/mint  -> 6-char code, 15 min, single use
        v
member texts it -> /twilio/sms links the handset to the GHL contact -> coach replies
```

- `cid`/`em` in the iframe URL is a deliberate trade: the sanitiser rules out the cleaner options, and
  the coach page removes them from the address bar on load. The member's own ID and email, on their
  own page.
- The box is `hidden` unless `cid`/`em` are present, so a member of the public who finds
  `book-coach.ai/michael-stickler` never sees it.
- Only the last four digits of a linked number are ever returned by `/api/bind/status`.
### Decisions — do not re-litigate

- **No GHL webhook.** The Webhook action is a GHL premium action billed per execution. Reconcile-first
  made it redundant: the cron *is* the mechanism. Zero GHL premium actions.
- **Entitlement keys on the GHL contact ID, not the phone number.** GHL contacts are email-only —
  the first tagged contact had no phone at all. Keying on phone would have admitted **nobody**, and
  silently. This is why the binding code exists rather than being a fallback.
- **Leases, not permanent grants.** Every `sub:` carries an expiry the cron renews. If the sync breaks,
  access **decays** — loud and obvious — rather than persisting silently and giving churned members a
  free coach forever.
- **The mode lives in KV, not `wrangler.toml`.** Rolling back enforcement is `npm run seed`, not a
  redeploy. That matters because there is no staging (§2).
- **One tag per author**, mapped in `coaches.json` as `ghlTag`. No tag means nobody can reach that
  coach — fails closed. Adding an author: create the tag, add `ghlTag`, `npm run push`. No redeploy.
- **The menu is removed unconditionally, in every mode.** `entitlementMode` governs only whether
  entitlement is *checked*; it does not bring the menu back.

### Write cost — the free plan allows 1,000 KV writes/day

A lease is only rewritten once it is more than half spent, so the steady cost is about **one write
per subscriber per day**, plus at most 24/day for `syncmeta`. Roughly **124/day at 100 subscribers**.

The 5-minute cron first specified would have cost 28,800/day and **failed at about three
subscribers**. That is why the cron is 15 minutes and renewal is lazy.

> **The real ceiling is older than this work.** The Worker writes a session record on *every* inbound
> message, so 1,000 writes/day is roughly **50 SMS conversations a day** before writes start failing —
> and they fail hard, they do not degrade. Workers Paid is $5/month for 1M writes/day. Worth taking.

### The two guards that stop a bad day becoming a disaster

- **A GHL API failure changes nothing.** A 401, 403 or timeout aborts before a single write, because
  an empty result set is indistinguishable from "everyone churned". Verified by test: after a 401 the
  existing subscriber record is byte-identical.
- **The majority guard.** A run that would revoke more than half the subscribers refuses and alarms
  instead. Verified: 9-of-10 refused, 3-of-3 allowed as ordinary churn (floor of 3 so it does not fire
  on tiny counts), `--force` overrides.

### Safety ordering that must not be reordered

`STOP` → activation code → **crisis net** → entitlement → coach.

Verified live in `enforce`: an unentitled number sending crisis language gets the **988 response, not
the decline**. STOP stays silent. And an unentitled number texting `1042` is refused — **the coach
code is no longer a credential**, which is what §6.8 hardened `/health` to protect.

### What gated `enforce` (both now cleared — enforcement went live 2026-08-28)

1. ~~The activation UI must be live.~~ **Done 2026-08-26.** It lives in the coach page under the Buy
   buttons, and the lesson iframe passes the member through as
   `?cid={{contact.id}}&em={{contact.email}}` — confirmed working end to end: code issued in-course,
   texted in, handset linked, coach answered, and the page then shows the "Phone linked" state.
   **The remaining blocker is the tag: only one contact holds `bookcoach-micheal-stickler-active`,**
   applied by hand. Until Course360 applies and removes it automatically on course assignment, every
   other member gets "no active coach subscription".
2. **Confirm Twilio's Messaging Service inbound webhook points at `/twilio/sms`** (§7). Needs one real
   SMS from any handset; the simulator bypasses Twilio and cannot prove delivery.

Then: `entitlementMode` → `enforce` in `coaches.json`, `npm run seed`. Rollback is the same edit back.

### Still open

- **Phase 5 is HALF done, and this is the largest remaining hole.** The gate is built and works:
  `/api/web/session` mints a token, `/api/vf-interact` and `/api/heygen-token` honour it, and a client
  can no longer claim a `phone:` identity. **But the live coach page never calls the Worker** — it
  still calls `general-runtime.voiceflow.com` directly with `VF_API_KEY` in plain page source
  (`ms-coach-router`, the `CONFIG` block and `vfInteract()`). So:
  - anyone viewing source can take the key and drain the Voiceflow credits, which takes every coach
    offline with no mid-cycle top-up;
  - the web gate protects nothing on the page members actually use;
  - `webGateMode` cannot be moved past `warn` until the page is repointed.

  **The fix is one contained change**: rewrite `vfInteract()` to POST to `/api/vf-interact` with the
  session token instead of calling Voiceflow, and delete `VF_API_KEY` from the page. Sequence matters
  — repoint FIRST, then rotate the key, then `npm run secrets`. Rotating first takes the coach down.
  This is runbook step 8.
- **Voiceflow credit alarm** — deliberately not built. No documented endpoint reports remaining
  workspace credits, and a check that looks like coverage without being it is worse than a known gap.
  Worth asking Voiceflow support whether the balance is queryable.
- **`archiveReminderDays`** exists in config but is intentionally unused; nothing is lost at the
  30-day boundary. Kept for the day someone wants warning before Voiceflow's own 6-month expiry.
