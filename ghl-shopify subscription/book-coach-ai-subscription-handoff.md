# Book Coach AI — Offer & Trial Automation: Project Handoff

**Status:** design complete, build ~5% done
**Last updated:** 2026-09-10
**Purpose:** hand off to Claude Code. Everything decided, specced, and still open is below.

> ### ⚠ READ `plans/00-master-plan.md` FIRST (added 2026-09-11)
> This document is the **offer and trial design**, and it is still the authority on that.
> It is **not** the build plan any more. It was written without knowledge of the live
> `../coach-router` Worker, which already enforces coach access on SMS and voice.
> `plans/00-master-plan.md` joins the two, records what is actually built, and carries the
> current phase order. Where the two disagree, the master plan wins.
>
> Corrected in place below: §4 (`coach_status` does not enforce access), §7a (what actually
> grants access), §8 (the Worker hardening is mostly built). §2 and §6 assume carrier-driven
> delivery; **delivery is marked by hand today** — see §6.

---

## 1. What this project is

Leadership Books sells a physical book bundled with access to a "Book Coach AI" —
a Voiceflow-based conversational coach modeled on the book's author, fronted by a
HeyGen avatar. This project builds the **commercial and access-control layer** around
one specific coach:

- **Book / product:** *Life Without Reservation* by Michael L. Stickler
- **Product name on store:** "Life Without Reservation + Your Personal AI Coach"
- **Brand:** Book Coach AI by Leadership Books
- **Landing page:** `leadershipbooks.com/pages/life-without-reservation-ai-coach`
- **Page builder:** Zipify Pages (on Shopify)
- **Store:** Shopify, account "Leadership Books"

The coach itself already exists (Voiceflow + Cloudflare Worker + hosted HTML page).
This project is about **selling it, starting a trial, and enforcing access.**

---

## 2. The offer (final)

| Stage | What happens | Price |
|---|---|---|
| Purchase | Customer buys the physical book on Shopify | **$29.95 one-time** |
| Delivery | Shopify marks the order delivered → 10-day coach trial begins | included |
| Trial | 10 days of full AI coach access | included |
| Day 7 | Continuation offer presented (while access is still live) | — |
| Day 10 | Trial ends; access revoked unless they subscribed | — |
| Optional | Monthly coach subscription | **$59/month** |

**Critical property:** there is **no auto-conversion**. The $29.95 Shopify checkout is a
one-time physical-product purchase and leaves no card on file that Stripe can bill later.
Day 10 is an **opt-in re-purchase**, not a trial converting.

### Decisions made and why

**Opt-in at day 10, not card-captured-upfront.**
Considered capturing a card at purchase and auto-converting. Rejected because:
- Shopify's physical checkout can't store a card for a later GHL/Stripe subscription, so
  it would require a *second* checkout immediately after the first — before the book has
  even shipped, i.e. before any value is delivered.
- Trial start is delivery-based, not purchase-based, so the subscription's `trial_end`
  would need to be pushed forward by Stripe API calls when the delivered webhook fires.
  GHL's UI can't do this; it would live in Zapier or the Worker, half-managed outside the
  system of record.
- Audience (aspiring authors, faith-oriented, older skew, buying a physical book) responds
  better to "no automatic charges" than to surprise renewals; disputes and refund requests
  are the failure mode here, not quiet churn.
- **It's the reversible choice.** Every component below is identical either way.
  Card-capture can be bolted on later without rebuilding anything.

**Trial clock starts on delivery date.** One date, written once, everything reads it.
(Alternative considered: start on first coach login — kinder to travelers, more complex.)

**Shipping: Shopify Shipping with tracking.** This makes the carrier `DELIVERED`
event reliable, so the automatic path carries most orders and the manual tag is a
safety valve rather than the primary route.

### Conversion tactics agreed (untested — treat as hypotheses, not facts)
1. Present the $59 offer at **day 7**, not day 10 — while the coach is still in their hands.
2. Make it **one click**: pass name/email into the GHL payment page as URL params from the
   workflow so they only enter card details. Put the link in emails *and* inside the coach UI.
3. Give the window a reason to matter — e.g. **lock in $49/month if they continue before the
   trial ends.** Manufactures the urgency auto-conversion gets for free, honestly.

---

## 3. System flow

```
SHOPIFY                          GOHIGHLEVEL                    COACH APP
-------                          -----------                    ---------
Buys book ($29.95)
      |
      v
Fulfilled + tracking
      |
      v
Marked DELIVERED  ----webhook--> Trial starts (10-day clock)
                                       |
                                       v
                                 Access granted  --------->  Coach unlocked
                                       |                     (token checked
                                       v                      per session)
                                 Day 7 + day 9 emails
                                       |
                                       v
                                 Day 10 decision
                                    /        \
                          Subscribes          No action
                                 |                |
                                 v                v
                        Access continues    Access revoked
```

---

## 4. Component 1 — GHL custom fields

**Status: DONE** (both created)

Location: sub-account → Settings (gear, bottom of left sidebar) → Custom Fields
Folder: `Book Coach AI`

| Field name | Key | Type | Object | Values |
|---|---|---|---|---|
| Coach Status | `coach_status` | Single line | Contact | `trial`, `active`, `expired` |
| Coach Trial Started | `coach_trial_started` | Date picker | Contact | date |

**Rules:**
- **No default value, no placeholder on `coach_status`.** The idempotency guard checks
  whether it is *blank* to decide if a trial already started. A pre-filled value breaks it.
- Key is entered WITHOUT the `contact.` prefix (GHL rejects the period). The `contact.`
  form is only used when referencing the field in workflows/merge tags.
- ⚠ **CORRECTED 2026-09-10: `coach_status` is NOT what enforces access.** This doc was written
  without knowledge of the live `coach-router` Worker. That Worker grants entitlement on a
  **GHL contact tag** (`bookcoach-micheal-stickler-active`) or an active GHL subscription —
  it never reads `coach_status`. See §7a.
  `coach_status` remains the **workflow's own state machine**: it drives the idempotency guard
  and the day 7/9/10 branching. It is bookkeeping, not entitlement. The two must be kept in
  step by hand — set `trial` *and* add the tag; set `expired` *and* remove the tag.
- `coach_trial_started` is for reporting/support only — never used in logic.
- Optional improvement: if anyone besides the owner will hand-edit `coach_status`, convert it
  to **Dropdown (Single)** with the three values, to prevent "Trial" vs "trial" silently
  breaking every condition. Workflows read either type identically.

---

## 5. Component 2 — the delivery trigger (RESOLVED — Option A chosen)

**Status: DONE.** Option A (premium Inbound Webhook) was selected — the trigger was
selectable in the workflow builder, which confirms Premium Triggers & Actions are enabled
at agency level. Options B and C below are retained as fallbacks only.

**Live webhook URL** (workflow trigger, sub-account `tjdqrnOqMAMheHIt6pQD`):
```
<GHL_TRIAL_WEBHOOK_URL>
```
Test-fired 2026-09-10 with the §6 payload plus `sku`, `tracking_number` and
`shopify_customer_id`; GHL returned `{"status":"Success: test request received"}`.
Re-fire with `test-ghl-webhook.ps1` (in this directory) whenever the payload gains a key —
GHL cannot map a field it has never received.

### The blocker (historical — kept for context)
GHL's **Inbound Webhook** is a **premium trigger**, billed ~**$0.01 per execution**.
Once Premium Triggers & Actions are enabled at *agency* level, each sub-account gets
**100 free executions**. Access is not gated by plan tier — any agency plan can enable it.

At this volume the cost is trivial (200 deliveries/month = $2/month). **The real blocker is
whether Premium Triggers & Actions are switched on in Agency settings.** If this sub-account
sits under someone else's agency, that's a request, not a setting.

### Option A — pay for the premium trigger (RECOMMENDED if enablement is possible)
Simplest. Gives the payload as mappable variables, which is what makes the field-mapping
step work. ~10 minutes of setup.

### Option B — free: Shopify Flow → GHL v2 API → Contact Tag trigger
Create a Private Integration token (Settings → Private Integrations, `contacts.write` scope).
Shopify Flow's HTTP action calls:

```
POST https://services.leadconnectorhq.com/contacts/upsert
Authorization: Bearer YOUR_PRIVATE_INTEGRATION_TOKEN
Version: 2021-07-28
Content-Type: application/json

{
  "locationId": "YOUR_LOCATION_ID",
  "email": "reader@example.com",
  "firstName": "Jane",
  "lastName": "Doe",
  "tags": ["book-delivered"]
}
```

Then trigger the workflow on **Contact Tag** added = `book-delivered` (a standard, free
trigger). This tag-as-trigger pattern is the established community workaround for
avoiding inbound webhook charges.

> **⚠ UNVERIFIED — TEST BEFORE TRUSTING:** unknown whether `/contacts/upsert` **merges** or
> **replaces** the `tags` array. Test: add two junk tags to a test contact, fire the upsert
> with only `book-delivered`, check whether the junk survived. If it replaces, this option
> silently wipes tags on repeat buyers — worse than a $2 bill.

### Option C — free and robust: Shopify Flow → existing Cloudflare Worker → GHL API
Add a route to the Worker that already exists for this coach. Worker does the proper
two-step: upsert to get contact ID, then `POST /contacts/{id}/tags` to add without
replacing. Workflow still triggers on the free Contact Tag trigger.

**Advantages:** no tag-replacement risk, full control, a log you own when a delivery signal
goes missing, and the Worker has to be touched anyway for entitlement checks (§8).
**Cost:** ~40 lines of code.

---

## 6. Component 3 — Shopify Flow (3 flows)

Location: Shopify admin → Automations → Flow

All three post the **same payload** to the same destination and end by adding the order tag
`coach-started`. That tag is the **idempotency lock on the Shopify side** and is why all
three can coexist without double-starting a trial.

### Payload (flat JSON — GHL's mapper handles flat far more predictably than nested)
```json
{
  "event": "book_delivered",
  "source": "shopify_flow_delivered",
  "email": "reader@example.com",
  "first_name": "Jane",
  "last_name": "Doe",
  "phone": "+15551234567",
  "shopify_order_id": "5432109876543",
  "shopify_order_number": "#1042",
  "delivered_at": "2026-09-08T14:22:00Z"
}
```

`source` is the field people skip and later wish they had — it reveals whether a trial
started from the carrier signal, a manual tag, or the backstop. **Check `source` on new
contacts for the first week after launch** to catch silently failing delivered events.

> **⚠ CORRECTED 2026-09-11 — delivery is marked BY HAND today.** The premise below (and in §2,
> *"Shipping: Shopify Shipping with tracking… the automatic path carries most orders and the
> manual tag is a safety valve"*) is inverted in the current configuration. **Flow 1 is the
> whole system**, Flow 2 is a later upgrade, and Flow 3's backstop now guards against a *human
> forgetting to tag an order* rather than a carrier going quiet — which is the likelier failure.
> This also means an operational SOP is required: someone must know a package arrived and add the
> tag. Name that person, or trials silently never start. See `plans/00-master-plan.md` phase 2.

### Flow 1 — manual tag (BUILD FIRST)
- **Trigger:** order tags added → tag = `delivered-manual`
- **Condition:** order tags do NOT contain `coach-started`
- **Actions:** Send HTTP Request (payload above, `source: shopify_flow_manual`) → add order tag `coach-started`
- **Why first:** it's the only flow you can trigger on demand, so it's how you test everything downstream.

### Flow 2 — carrier delivered (the primary path)
- **Trigger:** fulfillment event created
- **Conditions:** event status = `DELIVERED`; order contains the book SKU; order tags do NOT contain `coach-started`
- **Actions:** same HTTP request (`source: shopify_flow_delivered`) → add tag `coach-started`

### Flow 3 — backstop (do not skip)
- **Trigger:** order fulfilled
- **Action:** Wait 14 days
- **Condition:** order tags do NOT contain `coach-started`
- **Actions:** same HTTP request (`source: shopify_flow_backstop`) → add tag `coach-started`
- **Why:** if tracking goes quiet, a paying customer would otherwise wait forever for a
  trial that never starts. Nobody who paid should be stuck on a carrier API.

> **⚠ Build request bodies using Flow's variable picker, NOT typed from this doc.** The
> object graph differs by trigger — in Flow 2 the customer email is something like
> `{{fulfillmentEvent.fulfillment.order.customer.email}}`, but read it off the picker.
> A wrong path fails silently with an empty field.

> Flow's HTTP action gives no feedback beyond the run log. Check the run log before
> assuming GHL is at fault.

---

## 7. Component 4 — GHL workflow

**Trigger:** Inbound Webhook (Option A) or Contact Tag `book-delivered` (Options B/C)

### Setup order matters
1. Create workflow, set trigger, **save as draft**, copy the webhook URL.
2. **Send one test POST before building any actions** — GHL can only map fields it has
   actually received. Confirm `email`, `first_name`, `source` etc. appear in the field list.

```bash
curl -X POST 'YOUR_GHL_WEBHOOK_URL' \
  -H 'Content-Type: application/json' \
  -d '{"event":"book_delivered","source":"test","email":"test@example.com","first_name":"Test","last_name":"Reader","phone":"+15551234567","shopify_order_id":"0000000000","shopify_order_number":"#TEST","delivered_at":"2026-09-08T14:22:00Z"}'
```

### Actions, in order
1. Create-or-update contact, keyed on `email` from the payload
2. **If/else: stop if `coach_status` is not empty** ← idempotency guard, do not omit
3. Set `coach_status` = `trial`
4. Set `coach_trial_started` = today
5. Grant the membership offer holding the coach page
6. Send welcome email containing the coach link
7. Wait 7 days → send $59/month offer email (with prefilled one-click payment link)
8. Wait 2 days → reminder email
9. Day 10: if/else → unless a subscription was recorded, set `coach_status` = `expired`
   and remove the membership offer

**Settings:** turn workflow **re-entry OFF**. Wait steps + re-entry = duplicated timers.

### Build status (2026-09-10)

Workflow name: **Book Coach — Delivery → Trial Start**. Actions 1–4 built and verified.

- Action 1 `Create contact` — maps `email` (dedupe key), `first_name`, `last_name`, `phone`.
  Deliberately does NOT write `coach_status`, so an existing contact's value survives the
  upsert and the guard below stays meaningful.
- Action 2 `Trial guard` — If/Else, branch `Fresh - start trial` on `Coach Status is empty`;
  the `None` branch is intentionally empty, which is what ends the run for repeats.
- Actions 3+4 — one `Update contact field` writing `coach_status` = `trial` and
  `coach_trial_started` = today.

**Verified 2026-09-10 by firing `test-ghl-webhook.ps1` twice against the published workflow:**
run 1 took `Fresh - start trial` → `Update contact field`; run 2 took `None` and wrote
nothing. This proves both the guard and email-based dedupe without spending an order.

**To re-test after any change:** blank the `coach_status` field on the test contact by hand,
then re-fire the script. Leaving it set means every future run correctly stops at the guard,
which looks identical to a broken workflow.

Actions 5 (grant membership offer) and 6 (welcome email with coach link) are both blocked on
the same §11 open question: **which membership surface holds the coach page.** There is
nothing to grant and no link to send until that is decided.

### Deliberate simplification
**No trial-end date is stored.** Date math across Shopify Liquid and GHL is where these
builds break. GHL's Wait step measures the 10 days; entitlement is a single field with
three states. The Worker only ever asks "is this contact allowed right now."

---

## 7a. RECONCILIATION with the live coach-router Worker (added 2026-09-10)

**This doc was written without knowledge of `D:\Projects\LeadershipBooks\coach-router`, which is
already built, deployed and enforcing.** Read `coach-router/HANDOFF.md` §10 and
`coach-router/plans/to-do.md` before building actions 5–9. Same GHL sub-account:
`ghlLocationId` = `tjdqrnOqMAMheHIt6pQD`.

### What actually grants coach access

The Worker's cron reconciles every 15 minutes and entitles a contact holding **either**:

1. the tag **`bookcoach-micheal-stickler-active`** (`ghlTag` in `coaches.json`), or
2. an **active GHL subscription** for product `6a9185da778550cdf732a700`
   (`Michael Stickler - Coach Access`, $59/mo recurring, Stripe connected)

Access is a renewable 48h lease. Removing the tag revokes within ~15 minutes.

### Therefore actions 5, 6 and 9 change

| Doc says | Actually build |
|---|---|
| 5. "Grant the membership offer" | **Add Tag** `bookcoach-micheal-stickler-active` (entitlement) **+** grant the Course360 course (the lesson holds the coach iframe). Two actions, both free/native. |
| 9. "Remove the membership offer" | **Remove Tag** `bookcoach-micheal-stickler-active`. |

**Day 10 branch — prefer the tag path, not the subscription path.** `plans/06` flags that the exact
string GHL uses for an ACTIVE subscription **has never been observed** (every subscription in the
location is `canceled`/`incomplete_expired`); `active`/`trialing` are inferred from Stripe. So do not
branch on subscription status. Instead: on a successful $59 purchase, a second workflow sets
`coach_status` = `active` and **leaves the tag on**. The day-10 branch then expires only when
`coach_status` is still `trial`. Cancellation removes the tag in its own workflow.

### Already done — do not rebuild

- Build-order step 11 ("Create $59/month GHL product + payment page") — **the product exists.**
  Only the funnel/order form is outstanding; step-by-step in `coach-router/plans/07-ghl-funnel-setup.md`.
  **Put a required phone field on it** (see below).
- `landingPageUrl` is `https://www.book-coach.ai/michael-stickler-coach-access`.

### Why mapping `phone` in action 1 matters more than this doc knew

A tagged contact that **already has a phone number** has its handset linked automatically by the
reconcile — **no activation code**. Shopify orders normally carry a phone, so book buyers skip
activation entirely. Make sure Shopify Flow actually populates `phone`; it inverts the activation
box from mandatory route to fallback.

### Decisions in coach-router that this doc contradicts

1. **`HANDOFF.md` §10 lists "No GHL webhook — premium action billed per execution" under *do not
   re-litigate*.** The Inbound Webhook trigger built on 2026-09-10 breaks that. Cost is ~$2/month at
   200 deliveries, and it is built and tested, so it stands — but `plans/06` §4 designed a free
   alternative (`POST /shopify/order` on the Worker, HMAC-verified, idempotent on order ID) that is
   arguably the better engineering. Recorded so the choice is visible, not accidental.
2. **`plans/06` is stamped "DECIDED 2026-08-28 — Option A, sold through GHL, NOT Shopify",** with
   Shopify explicitly rejected. This doc revives Shopify. The two reconcile only if Shopify sells the
   *physical book* and GHL sells the *$59 coach* — a third model neither document fully describes.
   **Needs an explicit owner decision.**

---

## 8. Component 5 — Cloudflare Worker (MOSTLY ALREADY BUILT — see 7a)

> **⚠ CORRECTED 2026-09-10.** This section was written as though the Worker hardening were
> unbuilt. It is largely done and live since 2026-08-28: `entitlementMode: enforce` (SMS and voice
> gated), tag/subscription-sourced entitlement, 48h leases, a majority-revocation guard, `/health`
> returning 503 on stale sync, and the members activation UI. Fix levels 1 and 2 below (origin
> locking, signed short-lived tokens) are **built**: `/api/web/session` mints tokens and
> `/api/vf-interact` + `/api/heygen-token` honour them.
>
> **One hole remains, and it is the whole ballgame for this project.** `webGateMode` is `warn` and
> **the live coach page never calls the Worker** — it still calls `general-runtime.voiceflow.com`
> directly with `VF_API_KEY` in plain page source. So the web chat is open to the public and the
> trial gates nothing there, while anyone reading page source can drain the Voiceflow credits and
> take every coach offline. This is `coach-router/plans/to-do.md` **item 1**, currently
> **"DEFERRED at Muhammad's request — do not start without asking."**
>
> **The 10-day trial is enforceable on SMS and voice today, and unenforceable on the web until
> item 1 ships.** Sequence matters: repoint the page FIRST, then rotate the Voiceflow key, then
> `npm run secrets`. Rotating first takes the coach offline.

### Existing architecture (per the book-coach-ai-builder skill — reuse, don't re-derive)
- Standalone HTML page hosted **outside** GHL (GHL blog posts strip `<script>` tags),
  embedded via a GHL **Custom Code / Custom HTML element with an `<iframe>`**
- Cloudflare Worker as token proxy so API keys never touch the client page
- Frontend: `@heygen/streaming-avatar` via esm.sh + chat panel calling the proxy

**Files per coach:**
1. `[coach-name].html` — production page
2. `[coach-name]-proxy.worker.js` — endpoints `POST /api/heygen-token`, `POST /api/vf-interact`
3. `wrangler.toml` — vars `HEYGEN_AVATAR_ID`, `HEYGEN_VOICE_ID`, `VF_PROJECT_VERSION`,
   `ALLOWED_ORIGIN`; secrets `HEYGEN_API_KEY`, `VF_DM_API_KEY`
4. `README-[coach-name]-GHL.md` — deploy steps + GHL iframe snippet

### 🚨 THE SECURITY GAP — this is the most important open item
**GHL membership gating only protects the GHL wrapper page.** The hosted HTML page URL and
the Worker's `/api/vf-interact` and `/api/heygen-token` endpoints remain **publicly
reachable**. Consequences:
- A cancelled or expired subscriber with the direct link keeps the coach **forever**
- So does anyone they forward it to
- **HeyGen streaming minutes are a cost exposure**, not just an access one — an
  unauthenticated avatar endpoint can be run up by anyone

**Without fixing this, the 10-day trial is decorative.**

### Fix, in ascending order of robustness
1. **Floor:** lock `ALLOWED_ORIGIN` to the membership domain; reject requests whose
   `Origin`/`Referer` doesn't match. Stops casual sharing, not a determined user.
2. **Target:** GHL membership page hands the iframe a **short-lived signed token**
   (contact ID + expiry, HMAC'd with a Worker secret). Worker verifies signature and
   expiry before proxying to Voiceflow or minting a HeyGen token. ~1 hour expiry means a
   leaked link dies quickly.
3. **Best:** Worker checks `coach_status` against the GHL API at session start, so
   cancellation cuts access immediately rather than at token expiry.

**Sequencing:** build the Worker hardening **last** — access is only worth enforcing once
the `coach_status` states actually exist.

---

## 9. Landing page copy — LIVE AND WRONG, fix soon

### The current price block (live now, from earlier in this project)
```html
<style>
.lwr-price-row{display:flex;align-items:baseline;flex-wrap:wrap;gap:10px;}
.lwr-was{font-size:24px;color:inherit;opacity:.45;text-decoration:line-through;}
.lwr-now{font-size:42px;font-weight:700;color:inherit;line-height:1.1;}
.lwr-term{font-size:18px;color:inherit;opacity:.85;}
.lwr-renew{font-size:16px;color:inherit;opacity:.9;margin-top:8px;}
@media (max-width:767px){.lwr-now{font-size:34px;}.lwr-was{font-size:20px;}.lwr-term{font-size:16px;}}
</style>
<div style="font-family:inherit;margin-top:18px;">
  <div class="lwr-price-row">
    <span class="lwr-was">$59</span>
    <span class="lwr-now">$29.95</span>
    <span class="lwr-term">first 10 days</span>
  </div>
  <div class="lwr-renew">Then $59/month. Cancel anytime.</div>
</div>
```

**Why colors use `inherit` + `opacity` rather than hex:** the section sits on a light grey
background and the theme body copy is a dark desaturated navy, not black. Fixed mid-greys
(`#8a8a8a`, `#555`) went muddy and read as a different hue family. `inherit` borrows the
theme color at whatever the section background is.

> ⚠ **CORRECTED 2026-09-17 — the premise below is half-stale.** It reasons from *"under the final
> model nothing auto-bills"*, which was true when written and is **not** true now: phase 5 exists
> and the $59/month subscription **does** auto-bill. The conclusion survives, because the *book*
> still never auto-renews and the $59 is a separate opt-in purchase weeks later — but do not
> rewrite from the old premise. **Paste-ready replacement copy:**
> [`plans/08-funnel-and-landing-copy.md`](plans/08-funnel-and-landing-copy.md) §2.

### Problems to fix
1. **"Then $59/month. Cancel anytime." implies automatic billing that does not happen at this
   step.** Shopify charges $29.95 once and nothing auto-renews; the $59 is a separate, opt-in
   purchase through GHL. This is a promise not being kept, in the direction that generates
   disputes — and it throws away a selling point.
2. **Button says "SUBSCRIBE NOW"** — nobody subscribes at this step. Should read
   **"Get the book"** or **"Start for $29.95"**.
3. **"Your purchase includes"** block above the price still describes a one-time buy with
   no mention of the trial or its 10-day window.
4. The 10-day period should appear **twice** before the button (in the includes list and by
   the price) so "I didn't realize" is hard to claim.

### Suggested replacement copy
> ~~$59~~ **$29.95** — your book, plus 10 days with your AI coach
> Your trial starts the day your book arrives. Continue for $59/month only if you want to.
> No automatic charges.

### Zipify mechanics (for reference)
- The `$59.00` element originally on the page was a **dynamic Price block bound to the
  Shopify variant price** — you cannot type into it. It was deleted (via the `•••` menu)
  and replaced with a **Custom Code element**.
- **Keep the parent product block in place** — the Add to Cart button lives inside it.
- Check the mobile view via the device icons in the top toolbar; the media query handles
  most wrapping, but "first 10 days" dropping to its own line is fine.

---

## 10. Build order

| # | Task | Status |
|---|---|---|
| 1 | Create GHL custom fields | ✅ DONE |
| 2 | Resolve premium-trigger decision (§5 Option A / B / C) | ✅ DONE — Option A |
| 3 | Create GHL workflow, save draft, copy URL | ✅ DONE — URL in §5 |
| 4 | Send test POST so GHL learns the fields | ✅ DONE 2026-09-10 |
| 5 | Build workflow actions 1–6 (grant path) | 🟡 actions 1–4 DONE + tested; 5–6 blocked on §11 membership-surface question |
| 6 | Build Shopify Flow 1 (manual tag) | ⬜ ← NEXT (unblocked — only needs the §5 webhook URL) |
| 7 | End-to-end test with a real order | ⬜ |
| 8 | Clone into Flows 2 and 3 | ⬜ |
| 9 | Add day 7 / 9 / 10 sequence (workflow actions 7–9) | ⬜ |
| 10 | Fix landing page copy (§9) | ⬜ — live and wrong, do early |
| 11 | Create $59/month GHL product + payment page | ⬜ |
| 12 | Harden the Worker (§8) | ⬜ — do last, but do it |

Steps 3–5 are one sitting, ~1 hour. Step 6 is the fiddly one.

### The end-to-end test (step 7), precisely
1. Place a real order for the book, fulfill it
2. Add the `delivered-manual` tag to the order by hand
3. Confirm: contact appears in GHL, `coach_status` = `trial`, welcome email arrives,
   coach page opens
4. **Add the tag a second time** → confirm nothing changes (proves the idempotency guard)
5. Refund yourself

---

## 11. Open questions

- [ ] Are Premium Triggers & Actions enabled at agency level? Who owns the agency account?
- [ ] Shopify plan (confirms Flow availability — Flow is free on Basic and up)
- [ ] Is Stripe already connected in GHL Payments?
- [ ] Which membership surface holds the coach page — GHL course/offer, or a members-only
      funnel page? (Determines how the signed token gets passed into the iframe.)
- [ ] Who owns the Cloudflare Worker repo — can env secrets and routes be added?
- [ ] Michael Stickler's HeyGen avatar ID supplied?
- [ ] Is the Voiceflow coach published, or still demoing on a draft version ID?
- [ ] How will subscribers cancel? Needs a self-serve route (Stripe customer portal link in
      the welcome email + member page, or a GHL form firing the revoke workflow). Without
      one, every cancellation is a support email and chargebacks rise.
- [ ] Refund / return handling: what happens to coach access if the book is returned?

---

## 12. Gotchas

**Idempotency has two locks, both required.** Shopify side: the `coach-started` order tag.
GHL side: the if/else on `coach_status` being blank. Delivered webhooks can fire more than
once; without both, a duplicate resets someone's clock.

**Shopify only knows a package "arrived" if a carrier tells it.** Delivery status populates
from tracking on a supported carrier. Ship without tracking and there is no delivered event,
ever. This is why Flow 3 exists.

**Deleting the Zipify product block deletes the Add to Cart button.** Replace the price
element inside it; don't remove the block.

**The `contact.` prefix** goes in merge tags and workflow references, never in the custom
field Key box (GHL rejects the period).

**Volatility warning:** GHL and Shopify both move menu items and rename things between
releases. This doc reflects information current to roughly May 2026 plus web-verified
premium-action pricing as of Sept 2026. If a label doesn't match, look for the nearest
equivalent rather than assuming the wrong screen.

---

## 13. Related context

- **monday.com tracker:** board "Book Coach AI — Project Tracker" (`18424730976`) — one item
  per author; move the Stage column and update Notes + Last Updated when this ships.
- **Skill:** `book-coach-ai-builder` covers the Voiceflow coach build standard, KB ingestion
  rules, card/button gotchas, and the GHL avatar page architecture. Read it before touching
  the coach itself or the Worker.
- **Connected MCP servers available:** Shopify, Stripe, monday.com, Voice Flow, Slack,
  Google Drive, Microsoft 365, Airtable, Dropbox, Zapier, Firecrawl, Tavily, Fathom.

---

## 14. Sources checked (Sept 2026)

- GHL premium trigger pricing / 100 free executions:
  `help.gohighlevel.com/support/solutions/articles/48001237383`
- Premium actions billing model: `hlgrowthpartner.com/post/gohighlevel-premium-workflow-actions-costs-2026`
- Tag-as-trigger workaround: `ideas.gohighlevel.com/automations/p/make-inbound-webhooks-free`
- Private Integration tokens: `marketplace.gohighlevel.com/docs/`
