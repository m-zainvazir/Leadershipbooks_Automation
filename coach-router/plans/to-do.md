# To-do — outstanding work

Live list. Everything not yet done, who it belongs to, and what happens if it is left.
Last reviewed 2026-08-28.

> ## Status 2026-09-19 — the commercial layer that feeds this is COMPLETE
>
> The `ghl-shopify subscription` project is built and proven end to end: trials start, expire,
> convert and revoke. Changes landed on this side during that work:
> **`allowTestSubscriptions: false`** · **`declineSms`/`declineVoice` set** ·
> **`autoLinkGhlPhone: false`** (activation is by texted code only) ·
> **`centitle:` entitlement map published** so a paying subscriber with no tag can still activate ·
> **`cronStaleAfterMinutes` alarm** on `/health` · **`touchSession`** frugal session writes ·
> **`versionID: "main"`** (Voiceflow published; staging is real). **356 tests.**
>
> 🔴 **The one thing left that belongs to this repo's domain: a real SMS from a tagged handset.**
> Blocked on a US number. The Worker half was proven in August, but activation went **code-only**
> on 09-17, so that proof no longer covers the path customers now take.

**Where things stand:** the product works end to end and **SMS/voice access is now enforced** — only
subscribers with a linked handset get through. A real subscriber in the US activated from inside the
course, texted, called, and the coach remembered both. Runbook steps 1-7 and 9 are done; step 8 is
not. Entitlement phases 0-4, 6 and 7 are done; phase 5 is half done.

**The one door still open is the web chat** (`webGateMode: warn`), because the coach page bypasses the
Worker entirely — item 1.

---

## 1. Repoint the coach chat at the Worker  — DEFERRED BY REQUEST

**Whose:** mine. **Deferred 2026-08-28 at Muhammad's request — do not start without asking.**

> ✅ **Its prerequisite is now cleared.** Moving `webGateMode` past `warn` required the entitlement
> map so paying subscribers would not lose the web coach on the day it hardened. That shipped
> 2026-09-17 (`centitle:`, master plan §3). **Only the page repoint itself is left.**

### What it is

The chat box on `book-coach.ai/michael-stickler` talks to **Voiceflow directly**. To do that it has
to carry the Voiceflow API key, and that key is written in the page where anyone can read it:

```
ms-coach-router, the CONFIG block:   VF_API_KEY: "VF.DM.…"
ms-coach-router, vfInteract():       fetch('https://general-runtime.voiceflow.com/…')
```

Repointing means the chat calls the Worker instead, and the Worker holds the key privately. The
visitor sees no difference.

### Why it matters

- **Anyone viewing page source can take that key.** Voiceflow credits are a hard stop with no
  mid-cycle top-up, so a stranger can run them down and silence *every* coach.
- The web gate built in phase 5 (`/api/web/session`, session tokens, entitlement scoping) currently
  **protects nothing**, because the page never reaches the Worker.
- `webGateMode` cannot move past `warn` until this is done.
- This is runbook step 8, the only incomplete item from the original project.

### The work

- Rewrite `vfInteract()` in `ms-coach-router` to POST `/api/vf-interact` with the session token
- Delete `VF_API_KEY` and `VF_VERSION_ID` from the page's `CONFIG`
- Re-paste into GHL, then set `webGateMode: enforce`

### Sequence — getting this wrong takes the coach offline

1. Repoint the page (above)
2. **Then** rotate the key in Voiceflow
3. **Then** update `vfKey` in `coaches.json` and run `npm run secrets`

Rotating before step 1 breaks the live page immediately.

---

## 2. Voiceflow credit alarm — BLOCKED

**Whose:** mine to build, but blocked on an answer from Voiceflow.

Credits are a hard stop: when the workspace allowance is gone the coaches simply stop replying, and
there is no mid-cycle top-up. Voice burns them fastest. Nothing currently warns you.

**Blocked because** I could not find a documented endpoint that reports the remaining balance, and I
would rather leave a visible gap than ship a check that looks like coverage and is not.

**ACTION — Muhammad:** send Voiceflow support exactly this:

> *Is there an API endpoint that returns our remaining workspace credits, or our usage for the
> current billing period? We want to alert ourselves before credits run out.*

Paste their answer back and I will build whichever path it allows.

- **If yes** → the cron reads it every 15 minutes; below a threshold, `/health` starts reporting a
  problem, and the uptime monitor emails you. Roughly an hour's work.
- **If no** → fallback is to count turns in the Worker and warn against an allowance you enter by
  hand. An estimate, not a balance, but it fires before silence rather than after. Only becomes
  accurate once item 1 is done, since web turns bypass the Worker today.

---

## 3. Turn enforcement on — ✅ DONE 2026-08-28

`entitlementMode: enforce` is **live**. SMS and voice are gated. `webGateMode` remains `warn`, so the
coach page is still open — see item 1.

### What grants access now

Both must be true:

1. The GHL contact holds `bookcoach-micheal-stickler-active`
2. **That phone number is linked to that contact**

Neither alone is enough. A tagged contact with no linked phone gets nothing; a linked phone whose
contact loses the tag is cut off at the next reconcile, within ~15 minutes.

**Two ways a phone gets linked:**

- The subscriber texts an activation code (only issued to a tagged contact)
- **Automatically, if the GHL contact already has a phone number on it** — no code needed. This is how
  the colleague was linked. **Practical consequence: if you put a real phone number on the contact
  when you tag them, the subscriber never has to touch the activation box.** It only matters for
  email-only contacts, which is most Course360 signups.

> ✅ **REMOVED 2026-09-17 — the second route is gone.** `autoLinkGhlPhone: false` is deployed and
> seeded. **Activation is by texted code only**; a phone on a contact or a subscription record links
> nothing. Kept as a config flag rather than deleted, so `npm run seed` reverses it with no redeploy.
>
> Its two prerequisites were done first, in order: the GHL cancellation workflow, then `Add Tag` on
> the purchase workflow. Without them a cold $59 subscriber would hold no tag, be refused by
> `handleBindMint`, and have no way to activate at all.
>
> Existing `bind:` records were untouched — nobody already linked lost access, including the
> colleague's two handsets.

Access is a renewable 48h lease, so a broken sync makes access decay rather than persist.

### Verified at the moment of flipping

| From a number never in GHL | Result |
|---|---|
| `Micheal Stickler` | Refused |
| `1042` | Refused |
| Phone call | Refused and hung up, no coach named |
| Crisis language | 988 safety response — still bypasses the refusal |
| `STOP` | Silent |

| Colleague, linked | Result |
|---|---|
| Text | Coach replies |
| Call | Straight through, no greeting, no code |

Before the flip, the same stranger texting `Micheal Stickler` got a **full coaching session** — the
author's name is on the public website, so the activation code was effectively optional. That is what
this switch closed.

### Rollback

`entitlementMode: warn` in `coaches.json`, then `npm run seed`. Live within 30 seconds.

### Consequences to remember

- **Muhammad is locked out of SMS/voice.** Contact `LUgsYcYM6TcsZ8UwYmUg` has no phone, and a
  Pakistani number is no use without roaming — international delivery on a US 10DLC campaign is
  unreliable anyway. Live testing therefore depends on the US colleague. A US number on his contact
  purely for testing would fix it.
- **`[entitlement]` log lines are now real refusals**, not hypotheticals. If a subscriber reports that
  it stopped working, that log names the reason in one line: Cloudflare → Workers & Pages →
  coach-router → Logs.

---
## 4. Rotate the Voiceflow API key

**Whose:** Muhammad's. **After item 1, never before.** See the sequence above.

The current key has been readable in public page source for as long as the page has been live, so it
should be treated as compromised regardless of whether anything has happened yet.

---

## 5. Cloudflare Workers Paid — $5/month — 🟢 LARGELY DEFUSED 2026-09-19

> ✅ **The dominant write has been made frugal.** `putSession` was called on **every inbound
> message** purely to slide the 12h TTL, writing an almost always identical value — that was the
> ~50-conversations-a-day ceiling.
>
> `touchSession` now rewrites only when the content actually changed **or** the record is past half
> its TTL — the same frugality the entitlement lease already uses. Measured by test:
> **20 messages in one conversation cost 1 write, not 20.** Deployed `b9456fdb`, 356 tests.
>
> **The trade, stated rather than hidden:** a skipped turn does not slide the TTL, so a session now
> expires between 6 and 12 hours after the last message rather than exactly 12. The record holds only
> "which coach, and when" — an expired one costs a coach re-resolution on the next message, which
> with a single coach is invisible.
>
> **Workers Paid is no longer on the critical path**, though it remains the right answer at real
> volume. Reassess if daily writes approach the 1,000 ceiling.

**Whose:** Muhammad's decision.

The free plan allows **1,000 KV writes a day**. The Worker writes a session record on every inbound
message, so that is roughly **50 SMS conversations a day** before writes start failing — and they
fail hard rather than degrading.

Two test subscribers is nowhere near it. A launch is. The entitlement system itself is frugal
(~1 write per subscriber per day); the ceiling is the message traffic, and it predates this work.

⚠️ **A 2026-09-17 note here claimed the cron had missed four consecutive runs. That was wrong, and
the retraction is worth keeping** — the same mistake is easy to repeat. The evidence was
`lastRunAt 03:01:16Z` read at `04:04Z` on a `*/15` schedule. But **`syncmeta` is written frugally**:
when counts have not changed it is rewritten only once an hour (`SYNCMETA_HEARTBEAT_MS`). So
`lastRunAt` lags a **healthy** cron by up to 60 minutes, and `03:01:16 + 60min = 04:01:16` — a cron
firing at ~04:01 would correctly write nothing and leave the value at 03:01 until 04:16.

**`sync.ageMinutes` measures time since `syncmeta` was last WRITTEN, not time since the cron ran.**
There is no evidence the cron ever stalled, and nothing here argues for the paid plan.

✅ **`/health` can now answer the question properly** (2026-09-17): a `cronStaleAfterMinutes` knob,
default **90**, returning 503 once the reconcile has been silent past it — above the 60-minute
heartbeat, with the floor enforced in `lib-config` so nobody tightens it into a permanent false
alarm. `/health` also now reports an `ageMeaning` string saying what `ageMinutes` measures.

---

## 6. Twilio Advanced Opt-Out

**Whose:** Muhammad's, in the Twilio console.

Enable it on the Messaging Service so Twilio sends the STOP/HELP compliance replies. The Worker
deliberately stays silent on STOP so the subscriber does not receive two messages.

---

## 7. Voiceflow authoring — not code

**Whose:** Muhammad / the author. Nothing here is fixable from the Worker.

Observations from real conversations:

- The coach speaks about Michael in the **third person** — *"Michael addresses this in Chapter 9"* —
  which cuts against the premise that each coach sounds like its author
- Says **"Welcome back"** to first-time contacts (authored copy, confirmed on a first-ever user)
- **Filler stacking** — *"That's a great question… Such a rich question."* On a call that is dead air
- SMS replies run ~346 characters against the ~300 target in the channel rules

Worth asking the colleague who tested whether any of it stood out to them.

---

## 8. Publish the Voiceflow project — 🟡 ATTEMPTED 2026-09-19, NOT YET EFFECTIVE

> **Publish was pressed on 2026-09-19, and the runtime still does not see it.** Probed directly:
> `versionID: production` → **`400 Unable to resolve production version alias`**, identical to
> before. The draft `6a52da46bc446f70628c598d` still answers `200`.
>
> **Consequence: there is still no staging.** Every canvas edit remains instantly live.
>
> **Check which environment was published to** — if it is not Main, `production` will not resolve.
> Then step 2 below still applies. **Or better:** if Voiceflow shows an explicit published version
> ID, pin that instead of the alias — a known version beats a moving pointer.

**Whose:** Muhammad's.

The project has never been published, so the coach runs on a **draft** version. There is therefore
**no staging**: every edit on the Voiceflow canvas is instantly live to anyone texting or calling.

Publishing and switching `versionID` to `production` fixes that. Note it is a `coaches.json` edit
**plus** `npm run seed`, because the Worker reads the version from KV, not from the file.

---

## 9. Stale pre-launch documents

**Whose:** mine, quick.

`TEST-CHECKLIST.md` still tests the coach menu, which no longer exists — 11 references, including
`MENU` clearing the session, the "(Reply MENU to switch coaches.)" footer, and "gibberish from a
fresh number -> coach menu". `README-coach-router.md` has 2 more.

Anyone running that checklist before launch would report failures that are in fact the system
working correctly, and might "fix" the menu back in. Worth an hour to rewrite against how it
actually behaves now: activation code, entitlement, no menu.

---
## 10. Automate entitlement from the subscription — Worker side ✅ DONE, funnel outstanding

**Plan:** [`06-shopify-tag-automation.md`](06-shopify-tag-automation.md)
**Your step-by-step:** [`07-ghl-funnel-setup.md`](07-ghl-funnel-setup.md)

Decided: recurring **$59/month**, sold through **GHL**. Shopify not involved.

### Done 2026-08-28

- ✅ GHL product created and verified: `Michael Stickler - Coach Access`,
  id `6a9185da778550cdf732a700`, recurring **$59 USD monthly**, no end date, hidden from the
  public storefront
- ✅ `ghlProductId` + `landingPageUrl` in `coaches.json`, `KV_FIELDS`, seeder validation, live in KV
- ✅ `ghlActiveSubscriptions()` — `limit`/`offset` pagination, active statuses only
- ✅ Reconcile grants on **active subscription OR tag**; both reads inside one try, so if *either*
  fails the whole run aborts rather than revoking everyone the other source did not cover
- ✅ `contactPhone` from a subscription auto-links the handset — **buyers never need the code**
- ✅ Tests 242 → **283**
- ✅ Verified live: `products: 1, subscriptions: 0, ok: true` — reads real GHL, correctly finds no
  active subscriptions yet

### Left for Muhammad

~~Build the funnel + order form~~ — **DONE. `07-ghl-funnel-setup.md` is stale; do not follow it.**
The funnel is live at `https://www.book-coach.ai/michael-stickler-coach-access`, wired to the right
product and price, and `landingPageUrl` is already set in `coaches.json`.

⚠ **"Make the phone field required" is NOT POSSIBLE — corrected 2026-09-17.** GHL's two-step order
form exposes a required-toggle for full name only (`fullNameValidation`); there is no
`phoneValidation` / `phoneRequired`. Confirmed in the builder UI and in the live page's own config.

**The field stays, optional** — but per the 2026-09-17 decision in item 3 it will stop linking
anything: activation is to be **code only**, and the reconcile's `via: 'ghl-phone'` auto-link is
being switched off. The field becomes ordinary contact data. GHL cannot make it required in any
case.

~~⚠ **The funnel page is wired but functionally blank**~~ — ✅ **FIXED 2026-09-17, re-verified live
2026-09-19.** The page now returns 200 carrying a headline, `$59` (×3), `recurring`/`Monthly`, and
the correct product `6a9185da778550cdf732a700` / price `6a9185e6e5d7f1bbc622c940`; shipping is off.
See `ghl-shopify subscription/plans/07-phase-5-conversion-path.md` section 6.

### One thing still unverifiable

✅ **RESOLVED 2026-09-19 — the string is `active`.** Observed from a test-mode purchase through the
live funnel: `status: "active", liveMode: false, amount: 59`. **`GHL_SUB_ACTIVE = {'active',
'trialing'}` matches, so the inference was correct and NO code change is needed.** A **declined**
card was also observed producing `status: "incomplete"`, correctly excluded. The `trial` vs
`trialing` risk noted below remains theoretical — GHL's trigger UI labels it `Trial`, but the API
has now been seen using Stripe-shaped lowercase strings for every status observed.

Historical record below.

⚠ Every subscription in the location is `canceled`/`incomplete_expired`, so **the string GHL uses for
an ACTIVE subscription has never been observed.** Still true on 2026-09-17: 11 subscriptions,
`canceled` x9 + `incomplete_expired` x2. `active` and `trialing` are inferred from Stripe.
Confirm on the first real purchase. Until then the tag path still grants access, so nothing breaks.

**Sharpened 2026-09-17.** GHL's own `Subscription` workflow trigger filters on Active / Canceled /
Expired / Incomplete Expired / Incomplete / Overdue / Scheduled / Trial / Unpaid. `Expired` and
`Scheduled` are **not Stripe statuses**, and `Trial` / `Overdue` are GHL's names for `trialing` /
`past_due` -- yet the API returns Stripe-shaped strings. **GHL's UI and API vocabularies are not the
same set.** If the API ever answers `trial`, `GHL_SUB_ACTIVE` refuses a paying customer silently.
A one-word hardening (add `'trial'`) is available and preserves fail-closed behaviour; it does not
remove the need to observe the real string.

---
## 11. Small things

- **Unlink the colleague's two handsets** when testing is finished — *holding off until Muhammad says
  so.* Both are bound to contact `9xr1rjXSV6Re5ijqmQSz`.
- **A staff tag** (`bookcoach-staff-all`) would grant every coach for internal testing without a real
  subscription. Create it in GHL and tell me, and I will set `staffTag` in config.
- **Point an uptime monitor** at `https://coach-router.bookcoachai.workers.dev/health`. It returns
  503 when the sync goes stale or fails. Safe to poll publicly — no coach names, no codes.

---

## Not to-do — settled, do not re-open

- **No GHL webhook.** It is a premium action billed per execution, and the cron reconcile makes it
  redundant.
- **No transcript capture to build.** Voiceflow records every conversation automatically, keeps them
  6 months, and they never leave Voiceflow.
- **No `dial` voice mode.** It needs one phone number per coach and no more can be purchased.
- **No Twilio subaccount.** The A2P registration is already approved on the parent account.
