# Phase 5 — the $59 conversion path

**Created:** 2026-09-17
**Owner:** M for every GHL screen, C for the two Worker lines.
**Status:** steps 1 and 4 need finishing, 3 is closed, 5/6/7 are specced here and buildable.

> **What this phase is.** Phase 2 starts trials. Phase 4 (paused) ends them. **Phase 5 is the only
> part of the system that takes money.** Everything else is plumbing around it.

| Step | What | State |
|---|---|---|
| 1 | The $59 funnel page | 🟡 **exists and is wired, but is functionally blank — see §6** |
| 2 | *(build the funnel if missing)* | n/a — it exists |
| 3 | Phone field required on the order form | ✅ **CLOSED 2026-09-17 — not supported by GHL. See §2.** |
| 4 | `Book Coach — Coach Subscription Started` | 🟡 built + published, **has never fired** |
| 5 | Cancellation workflow | ⬜ **unblocked 2026-09-17** — the trigger exists. §3 |
| 6 | Capture the real ACTIVE status string | ⬜ §4 — now a 30-second API call, not a wait |
| 7 | Self-serve cancellation | ✅ **DONE 2026-09-17.** Portal live and Active, link in the three trial emails and the post-purchase email. The funnel's own terms line keeps the **email** route by choice (Muhammad) — a stated, honourable cancellation method, which is what a recurring charge requires. ⬜ One open item: verify GHL sees a portal cancellation |

---

## 1. Verified state, 2026-09-16/17

Read from the live systems, not from a screen.

| Check | Result |
|---|---|
| Funnel page | `200`, product `6a9185da778550cdf732a700` + price `6a9185e6e5d7f1bbc622c940`, recurring/Monthly, Stripe connected |
| Funnel **visible copy** | headline, price and product description are **all absent** — see §6 |
| GHL subscriptions in the location | 11 — `canceled` ×9, `incomplete_expired` ×2. **No `active` ever observed.** |
| The one coach subscription ever created | `6a96ce723af8e3c14a9a5916`, `$59`, `incomplete_expired`, **`liveMode: true`** |
| Its order `6a96ce6e8660770420b15330` | still `pending` / `unpaid` |
| Contacts with `coach_status` = `active` / `trial` / `expired` | **0 / 0 / 0** — verified with a filter proven against a field with 170 hits |
| `allowTestSubscriptions` | ✅ **`false` since 2026-09-17**, seeded to production KV |
| `declineSms` / `declineVoice` | ✅ **set since 2026-09-17** (275 / 198 chars), seeded |

**The system is at a clean zero.** No contact holds any `coach_status` value at all. Two
consequences: step 4 has demonstrably never fired, and whenever phase 4 ships its first expiry run
starts with an empty population rather than a backlog.

---

## 2. Step 3 — phone required: CLOSED, not skipped

**GHL's two-step order form cannot make the phone field required.** Confirmed twice: in the builder
UI (Muhammad, 2026-09-17) and independently in the live page's own config block, which exposes

```
showPhone, showShipping, showCompanyName, enableCountryPicker,
fullNameValidation, enableAutoCompleteAddress
```

— a validation toggle for **full name only**. There is no `phoneValidation` and no `phoneRequired`.

### DECISION 2026-09-17 — activation is by code ONLY

**Muhammad's call, and it overrides what this section previously argued.** A handset must be linked
by the subscriber **texting an activation code**, and by nothing else. Supplying a phone number on a
form must not, by itself, grant a working phone.

### What that requires — it is not a docs change

The Worker currently does the opposite. `coach-router.worker.js:1789`, in the reconcile:

```js
// Opportunistic: a contact that already carries a usable phone needs no token.
const fromGhl = normalizePhone(info.phone);
if (fromGhl && !phones.has(fromGhl)) {
  phones.add(fromGhl);
  await env.COACH_KV.put(`bind:${fromGhl}`, JSON.stringify({ contactId, ..., via: 'ghl-phone' }));
```

It reads the phone from the contact (`:1750`) or from the subscription's `contactPhone` (`:1767`)
and writes the binding itself. **This is live behaviour built 2026-08-25/26, not a proposal.**
Deleting the paragraphs that describe it would leave the system doing it silently. It has to be
switched off in code.

**Recommended shape:** a config flag `autoLinkGhlPhone`, defaulting **`false`**, rather than
deleting the block. That matches the codebase's own rule — *"the mode lives in KV, not
`wrangler.toml`"* — so it is one deploy and thereafter reversible with `npm run seed`.

### ⛔ The blocker: do NOT switch it off first

`handleBindMint` (`:2115`) issues activation codes on **tags only**:

```js
const codes = await codesForTags(env, contact.tags);
if (!codes.length) throw new HttpError(403, 'That account does not have an active coach subscription.');
```

A **trial** user holds the tag and can mint a code. A **cold $59 buyer holds no tag** — step 4 adds
none, deliberately — so they get a `403`. Today the auto-link masks that whenever they supplied a
phone. **Remove the auto-link on its own and every cold subscriber pays $59 and cannot activate
SMS or voice at all.** This is master plan §3's known gap, widened from *"only bites phone-less
buyers"* to *"bites every cold buyer."*

### The order this must be done in

| # | Step | State |
|---|---|---|
| 1 | **Build the cancellation workflow** (§3) | ✅ **built, published and live** 2026-09-17 (Muhammad) |
| 2 | **Add `Add Tag` to the purchase workflow** (step 4) | ✅ **live** 2026-09-17 (Muhammad) |
| 3 | **Then** set `autoLinkGhlPhone: false` and deploy | ✅ **shipped** 2026-09-17 — worker version `98875553`, 323 tests |

**All three are done, in that order.** Activation is now by texted code only, and no cold buyer is
stranded, because the purchase workflow tags them and the published entitlement map covers them
even if it did not.

**Step 2 was previously forbidden and is now safe, and step 1 is exactly why.** Master plan §3 and
`05-phase-4-trial-expiry.md` §4 both ruled out tagging on purchase, on one stated ground: *"if a
workflow adds the tag on purchase and cancellation cannot reliably remove it, a cancelled subscriber
keeps access forever."* **That ground disappeared on 2026-09-17** when the GHL `Subscription`
trigger was confirmed. Build the remover first, then the adder.

> **Existing bindings survive.** Turning the auto-link off does not delete any `bind:<phone>` record
> already written, so nobody currently working loses access — including the colleague's two
> handsets, which were linked this way.

### The phone field itself

Keep it, optional, as it is. With the auto-link gone it no longer links anything; it is ordinary
contact data, and GHL cannot make it required anyway (above). No work either way.

---

## 3. Step 5 — the cancellation workflow

**UNBLOCKED 2026-09-17.** The master plan §7 and `coach-router/plans/06` both doubted GHL had a
reliable cancellation trigger. It does.

### The trigger exists

GHL ships a **`Subscription`** workflow trigger with a **Status** filter and a **Global Products**
filter. Its status values, verbatim from GHL's docs:

`Active` · `Canceled` · `Expired` · `Incomplete Expired` · `Incomplete` · `Overdue` · `Scheduled` · `Trial` · `Unpaid`

### The workflow

**`Book Coach — Coach Subscription Cancelled`**

| | |
|---|---|
| **Trigger** | `Subscription` |
| **Filter 1** | Global Products = **`Michael Stickler - Coach Access`** (`6a9185da778550cdf732a700`) |
| **Filter 2** | Status = **`Canceled`** |
| **Action 1** | `Update contact field` → `coach_status` = `expired` |
| **Action 2** | `Remove Tag` → `bookcoach-micheal-stickler-active` |

**Both filters are mandatory.** Without the product filter it fires on every subscription in a
location that sells five other people's courses, and starts stripping coach tags off strangers.

### Why `Canceled` only, and not `Overdue` or `Unpaid`

The master plan says "on cancelled / payment failed". **Build cancelled only for v1.**

`Overdue` is Stripe's `past_due` — a *transient* state during the retry window, which GHL retries on
a schedule. Revoking there cuts off a customer whose card will succeed on the second attempt, which
is the "cut off a payer" failure the whole guard design exists to avoid. The Worker already agrees:
`GHL_SUB_ACTIVE` deliberately excludes `past_due` and `unpaid` from *granting*, but nothing in the
Worker actively *revokes* on them either — it simply stops renewing, and the 48h lease decays.
**That decay is the correct handling of a failed payment.** Leave it alone.

### What this workflow does and does not change

This is worth being precise about, because it is easy to overclaim.

| Customer | Before this workflow | After |
|---|---|---|
| **Subscribed, never had a trial** (no tag) | Worker stops seeing an active sub → lease decays → revoked within ~15 min | identical |
| **Trial → subscribed → cancels** (holds the tag) | **tag persists forever → access forever** | tag removed → revoked within ~15 min |

**It closes exactly one hole: the tag-holder who cancels.** That is the hole
`05-phase-4-trial-expiry.md` §4 names as the one phase 4 does not close. It is also, once phase 4
ships, the *majority* path — every converting customer arrives holding a trial tag.

### ⚠ The open question this introduces — HALF-ANSWERED 2026-09-17

> ✅ **Stripe's half is settled.** The customer portal is configured **`Cancel at end of billing
> period`** (confirmed on the Stripe portal settings screen, 2026-09-17), with cancellation reasons
> collected. A portal cancellation therefore leaves the subscription `active` until the paid period
> ends, and only then flips it to `canceled`. **No decision needed — Stripe already does the
> customer-friendly thing.**
>
> 🚨 **GHL's half is not, and the risk is now sharper than before.** Stripe will tell the cancelling
> customer *"you keep access until [date]"*. If GHL mirrors that as `Canceled` **immediately**
> rather than at period end, the workflow below removes the tag that day and the customer is cut off
> weeks early while holding Stripe's confirmation. Verify on the first real cancellation — read the
> GHL subscription status straight after; `active` means it lines up, `canceled` means the tag
> removal has to be delayed.

**Does GHL report `Canceled` at cancellation, or at period end?**

Stripe distinguishes cancel-immediately from `cancel_at_period_end`. If GHL reports `Canceled` the
moment the customer clicks cancel, this workflow **revokes someone who has paid through the end of
the month.**

**This is not a new risk — it is an existing one made consistent.** The Worker already behaves this
way for subscription-only customers, because `canceled` is not in `GHL_SUB_ACTIVE`. The workflow
makes tag-holders match. Whether "access ends at cancellation" or "access ends at period end" is
the right *policy* is a business decision, not a technical one, and nobody has made it.

**Cheapest way to answer it:** at step 6 (§4), when a real subscription exists, cancel it with
`cancel_at_period_end` and read `status` from the API immediately. If it still says `active`, GHL
reports at period end and there is no problem at all.

---

## 3b. 🚨 The cold-buyer hole — found 2026-09-17

**A $59 subscriber who never had a trial cannot activate SMS or voice.** They pay for "text or call
your coach" and get web chat only.

### Why

`Book Coach — Coach Subscription Started` does two things: `coach_status = active` and `Add Tag`.
**No course grant, and no email.**

But the activation box lives on the coach page and is `hidden` unless the page receives
`?cid=…&em=…` — and those **only** arrive when the page is iframed from inside the Course360
lesson. Phase 1 action 5b grants that course offer to **trial** users. Nothing grants it to a
purchaser.

| | Trial → converts | Cold buyer |
|---|---|---|
| Tag | ✅ from phase 1, persists | ✅ from the purchase workflow |
| Course offer | ✅ phase 1 action 5b | ❌ **never granted** |
| Route to the activation box | ✅ | ❌ **none** |
| SMS / voice | ✅ | ❌ **cannot activate** |
| Web chat | ✅ | ✅ only because `webGateMode` is still `warn` |

> **Adding the tag fixed the minting *permission* and not the route to the minting *UI*.** That
> distinction is the whole bug, and it is easy to miss because `handleBindMint` would happily issue
> them a code — they just have no way to ask for one.

### Who it hits

**Not trial-converts** — they hold the course offer already, and they are everyone arriving through
the day-7/9/10 emails. It hits anyone who reaches the funnel **directly**. Rare today. Not rare once
the landing page or any ad points at it.

### The fix — two actions on the workflow that already exists

| # | Action | Value |
|---|---|---|
| 1 | **`Grant Offer`** | `AI Coach Final — Micheal Stickler — Life Without Reservation` — the same offer phase 1 action 5b uses |
| 2 | **`Send Email`** | a post-purchase welcome — the three activation steps, the number, and the Stripe portal link |

**Action 2 matters on its own.** Today someone starts paying $59/month and **receives nothing from
us at all.** No confirmation, no instructions, no idea the activation step exists.

### ✅ CLOSED 2026-09-18 — both actions are live

`Grant Offer` (2026-09-17) and the post-purchase email (2026-09-18) are both on
`Book Coach — Coach Subscription Started`. A cold $59 buyer now receives the course offer, a route
to the activation box, and an email telling them what to do.

⚠ **Never executed.** All three actions on that workflow — `Add Tag`, `Grant Offer`, `Send Email` —
are untested. [`09-live-transaction-test.md`](09-live-transaction-test.md) step 2 proves them.

### Original record — action 1 done, action 2 written, 2026-09-17

`Grant Offer` was added to the purchase workflow on 2026-09-17 (Muhammad). A cold buyer now receives
the Course360 offer and therefore has a route to the activation box.

### The post-purchase email — copy, ready to drop in

**Goes in `Book Coach — Coach Subscription Started` as a `Send Email` action.**

It has to serve **two audiences at once**: a trial-convert who has been texting their coach for a
week, and a cold buyer who has never activated. The "you can stop reading here" exit is what keeps
the setup steps from reading as *"you have done something wrong"* to the first group.

**Placement: LAST, after `Grant Offer`.** The order is load-bearing — `Grant Offer` is what
triggers Course360's `Welcome!` magic-link email, and step 1 below tells the customer to look for
it. Send this first and a new subscriber goes hunting for an email that does not exist yet.

```
Book Coach — Coach Subscription Started
  1. Update contact field  ->  coach_status = active
  2. Add Tag               ->  bookcoach-micheal-stickler-active
  3. Grant Offer           ->  AI Coach Final — Micheal Stickler — Life Without Reservation
  4. Send Email            ->  this
```

**Subject:** `You're in — your coach is yours`
**Preheader:** `$59/month, starting today. Here's everything you need.`

```
Hi {{contact.first_name}},

You're subscribed - $59/month, starting today. Your coach stays on from here.

Already been texting your coach? Nothing changes. You can stop reading here.

New? Two minutes to set up:

1. Open the separate email titled "Welcome!" from Leadership Books and use
   the login link inside (check spam)
2. In your course, open the coach lesson and press "Get my activation code"
3. Text that code to +1 854 254 5009

After that, just text or call that number like you would a person.

Manage your card or cancel any time:
https://billing.stripe.com/p/login/00g7vegVZ5dH8h2fYY
You'll keep access until the end of the period you've paid for.

Outside the US? The text line is US-only - use the coach on the web from
inside your course.

Best Regards,
Muhammad Zain Vazir
AI Project Manager, BookCoach AI
Leadership Books, Inc.
```

~110 words, structurally identical to the day-0 email in
[`01-phase-1-grant-path.md`](01-phase-1-grant-path.md).

**The Stripe portal link stays.** It is the cancellation route, not a course link, and a recurring
charge needs one stated next to it.

> ⚠ **Step 1 names the `Welcome!` email and carries NO course URL — settled 2026-09-18.**
> An earlier draft gave the plain course URL, on the reasoning that *"a trial-convert already has a
> password."* **That ignored the group this email exists for.** A cold buyer has no password either,
> and logged-out that URL is a `Sign in | Platform` page — the same dead end removed from the day-0
> email.
>
> **The URL is not needed at all here.** `Grant Offer` fires immediately before this email, so
> Course360's `Welcome!` magic link has *just* arrived for exactly the people who need it. Anyone
> who does not need it takes the "you can stop reading here" exit.
>
> **Rule for both emails: point at the `Welcome!` email, never at a bare course URL.**

> **Why the period-end promise is safe *here* and nowhere else.** Stripe's portal is configured
> `Cancel at end of billing period`, and this email reaches **only people who have actually paid**,
> so they hold a real Stripe subscription that behaves that way. The same sentence must **not** go
> on the funnel page or in the trial emails until GHL's mirroring is verified — see §3's open
> question.

> ⚠ **`webGateMode: enforce` (phase 6) makes this fatal rather than partial.** Today a cold buyer at
> least keeps web chat. The day the web gate hardens, they lose that too and have **no working
> channel whatsoever** while being billed. Fix this before phase 6, not after.

---

## 4. Step 6 — capture the ACTIVE status string

**The Worker refuses anyone whose subscription status it does not recognise.** `GHL_SUB_ACTIVE` is
`{'active', 'trialing'}`. ✅ **`active` was OBSERVED on 2026-09-19** (test-mode purchase through the
live funnel; a declined card gave `incomplete`), so the inference was right and **no code change is
needed**. `trialing` is still unobserved and still inferred. *(This line previously said both were
"never observed" — stale after 2026-09-19.)*

### The new reason this is riskier than it looked

`coach-router.worker.js:1576` says *"GHL proxies Stripe, so these are Stripe's names."* That is
**only half true**, and today's doc read is what exposed it:

- `Expired` and `Scheduled` are **not Stripe statuses at all** — they are GHL's own.
- `Trial` and `Overdue` are GHL's labels for Stripe's `trialing` and `past_due`.
- But the API handed back `canceled` and `incomplete_expired` — **Stripe-shaped, lowercase,
  snake_case.**

So GHL's UI vocabulary and its API vocabulary are demonstrably not the same set. The concrete
hazard: **if the API ever returns `trial` rather than `trialing`, the Worker silently refuses a
paying customer**, and `/health` stays green because nothing is wrong with the sync.

### How to capture it — 30 seconds, after the first real purchase

```bash
curl -s "https://services.leadconnectorhq.com/payments/subscriptions?altId=tjdqrnOqMAMheHIt6pQD&altType=location&limit=100" \
  -H "Authorization: Bearer $GHL_TOKEN" -H 'Version: 2021-07-28' \
| python -c "import json,sys; [print(s['status'], s['liveMode'], s['amount'], (s.get('recurringProduct') or {}).get('product',{}).get('name')) for s in json.load(sys.stdin)['data']]"
```

Look for the `$59` / `Michael Stickler - Coach Access` row and **write the exact string down here.**

### The one-word hardening, available now

Adding `'trial'` alongside `'trialing'` costs nothing, preserves fail-closed behaviour, and removes
the single most likely mismatch. It does **not** remove the need to observe the real string.

> **Do not be tempted to invert the set** into a deny-list of non-paying statuses. It would fail
> *open* — an unknown string would grant access — and the Worker's whole posture is fail-closed.

---

## 5. Step 7 — self-serve cancellation

**Required before launch.** Without it every cancellation is a support email, and the ones that do
not get answered become chargebacks.

### Three routes

| | Route | Effort | Risk |
|---|---|---|---|
| **A** | **Stripe customer portal link** — recommended | one Stripe setting + one link | needs Stripe dashboard access |
| B | GHL-native subscription management | unknown — unverified this location has it | unknown |
| C | A cancellation *request* form → GHL workflow → internal task | low | still manual; just a tidier inbox |

### Why A

The subscriptions are **real Stripe subscriptions on connected account `acct_1Ah4NXC7G7kTQrjQ`**
(`paymentProviderType: "stripe"`, `subscriptionId: "sub_1UArQyC7G7kTQrjQ3f754SUg"` — both read live).
Stripe's no-code customer portal is a dashboard setting plus a link; the customer authenticates by
email and cancels themselves.

**And it composes with §3 for free:** a portal cancellation sets the Stripe subscription to
canceled → GHL's subscription record follows → the `Subscription` trigger fires → `coach_status` =
`expired` and the tag comes off. One setting closes the loop end to end with no new moving parts.

### Where the link goes

1. The **welcome email** (phase 1 copy, `01-phase-1-grant-path.md`)
2. The **day-7 and day-9 emails** (phase 4 copy, `05-phase-4-trial-expiry.md` §7)
3. The **member page**, next to the activation box

> ⚠ **Blocked on access, not on work.** The Stripe dashboard belongs to Muhammad's boss.
> **The question to ask:** *"Can you enable the Stripe customer portal on the connected account and
> send me the portal link?"* Until that is answered, route C is the stopgap — and a stopgap is
> required, because launching with neither is what generates chargebacks.

---

## 6. Step 1 — the funnel page is wired, but functionally blank

**The plans record step 1 as ✅ with "a copy pass owed." That understates it.** Fetched and
stripped of markup on 2026-09-16, the *entire* visible text of step 1 is:

> You may place an order below · Shipping · **Where Should We Ship It?** · Your info ·
> **Upgrade Your Order & Save!** · *[full 200-country picker]* · Go To Step #2

### What is wrong

| Problem | Why it costs money |
|---|---|
| **No headline** | the page never says what is being sold |
| **No price on step 1** | `$59` appears only at step 2, as the line item `Michael Stickler - Coach Access @ 59/month` — no dollar sign |
| **The word "coach" appears zero times** | this is the coach sales page |
| **No description, no benefits, no proof** | nothing argues for the purchase |
| **"Where Should We Ship It?"** ×2 | a shipping address on a **digital subscription** — street, city, state, zip, country |
| **"Upgrade Your Order & Save!"** ×2 | a bump header with nothing behind it |
| **"Go To Step #2"** as the CTA | template default |

### Why this is phase 5's problem and not a nice-to-have

**This is the only page in the system that takes money.** Phase 4's day-7 and day-9 emails are
written and are built to send people here. Shipping phase 4 against this page converts a trial into
a bounce.

### The minimum that makes it sellable

1. **Headline + subhead** naming the coach and the offer
2. **`$59/month` visible on step 1**, next to the CTA — not only at step 2
3. **Turn the shipping section off** (`showShipping`) — nothing is shipped
4. **Retitle the bump** or remove it
5. **CTA** → `Continue` / `Get My Coach`, not `Go To Step #2`
6. **Phone placeholder** → `Phone Number (so your coach can text you)` — §2
7. **A recurring-terms line** adjacent to the button: what is charged, how often, how to cancel —
   this is what card networks expect on a subscription, and it is also §5's link finding a home

> **Already fine, do not change:** the product and price wiring
> (`6a9185da778550cdf732a700` / `6a9185e6e5d7f1bbc622c940`), Stripe, recurring/Monthly, and the
> one-click prefill `?full_name=…&email=…`, verified in a browser 2026-09-16.

---

## 7. Verification — what proves each step

| Step | Proof | Not proof |
|---|---|---|
| 4 | a contact reads `coach_status` = `active` after a real purchase | the workflow showing green — it has never fired |
| 4, negative | a **declined card** leaves `coach_status` unchanged | a successful purchase alone |
| 5 | cancel → within ~15 min the tag is gone **and** `npm run subs -- --list` shows no lease | the workflow running; the tag is what the Worker reads |
| 6 | the exact string, pasted into §4 of this file | Stripe's docs |
| 7 | a cancellation completed without anyone emailing support | the portal link existing |
| 1 | the page names the coach, the price and the terms above the fold | a `200` |

```bash
# the census — who holds the tag, with custom fields inline
curl -s -X POST 'https://services.leadconnectorhq.com/contacts/search' \
  -H "Authorization: Bearer $GHL_TOKEN" -H 'Version: 2021-07-28' -H 'Content-Type: application/json' \
  -d '{"locationId":"tjdqrnOqMAMheHIt6pQD","pageLimit":100,
       "filters":[{"field":"tags","operator":"eq","value":"bookcoach-micheal-stickler-active"}]}'
```

**Never use `GET /contacts/?limit=100`** — it returns 100 of 8,893 and silently misses older
contacts.

---

## 8. Traps specific to this phase

- **Four product IDs look plausible; one is right.** Tell them apart by **type** — the one you want
  is the only `SERVICE`.

  | ID | What | Type |
  |---|---|---|
  | `6a9185da778550cdf732a700` | **Michael Stickler - Coach Access, $59/mo** ✅ | SERVICE |
  | `6a9978eea94350eafc0958c3` | BookCoachAI - Monthly (Standard), $59/mo — **live decoy, sells nothing** | DIGITAL |
  | `6aa3c2dab5682f0951fdb237` | the book, $29.95 | PHYSICAL |
  | `6a91a8e137462c1ae1d83206` | **`lineItemDetails.productId` on the subscription record** — a *different* ID on the same record the Worker matches by `recurringProduct.product._id`. Reading the wrong field finds nothing. | — |

- **`Order Submitted`, never `Order Form Submission`.** The latter fires on the form event
  regardless of payment, so a declined card would grant permanent, unexpirable access. Verified
  against GHL's docs 2026-09-16.
- **GHL's `Add Tag` does not interpolate merge fields.** It tags with the literal string
  `{{contact.coach_tag}}`, runs green, and grants nobody anything.
- **`coach_status` is bookkeeping; the tag is entitlement.** Only the tag is read by the Worker.
  Every workflow here must move both together.
- **The GHL Inbound Webhook is a premium trigger** (~$0.01/execution). An empty wallet answers
  **422** and no trial starts, with no error outside a Flow run log.
- **The cron is the delivery mechanism for everything here** — revocation and, once phase 4 ships,
  trial expiry. `/health` gained a **`cronStaleAfterMinutes`** alarm on 2026-09-17 (default 90,
  returns 503) so a stopped cron is now visible long before the 24h lease-staleness alarm.
- ⚠ **`sync.ageMinutes` is NOT "time since the cron ran".** `syncmeta` is written frugally — only
  once an hour when counts have not changed — so it lags a **healthy** cron by up to 60 minutes.
  Reading it as cron liveness produced a false "four missed runs" diagnosis on 2026-09-17. Any
  cron alarm built on it must sit **above** that heartbeat; `lib-config` now enforces the floor, and
  `/health` carries an `ageMeaning` field saying what the number actually measures.

---

## 9. Open, and deliberately left open

- [ ] **Does GHL report `Canceled` at cancellation or at period end?** §3. Decides whether §3
      revokes people who have paid through the month.
- [ ] **The real ACTIVE status string.** §4. Blocks nothing until the first purchase; blocks
      everything after it.
- [ ] **Stripe portal access.** §5. Blocked on Muhammad's boss.
- [ ] **Is the `Expired` / `Scheduled` vocabulary reachable through the API at all**, or only in the
      trigger's filter UI? §4.
- [ ] **One trial per contact ever, or one per book purchased?** Inherited from master plan §4 and
      still unanswered; phase 5 is where a repeat buyer first meets it.
