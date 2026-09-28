# Guide — build the GHL funnel that sells coach access

Step-by-step, for Muhammad. Nothing here needs a terminal.
Written 2026-08-28. Companion to [`06-shopify-tag-automation.md`](06-shopify-tag-automation.md).

---

## What already exists

I created these in your GHL — you do not need to make them again:

| | |
|---|---|
| **Product** | `Michael Stickler - Coach Access` |
| Product id | `6a9185da778550cdf732a700` |
| **Price** | recurring, **$59.00 USD**, every 1 month, no end date |
| Price id | `6a9185e6e5d7f1bbc622c940` |
| In storefront | **No** — deliberately hidden from the public book store |

The Worker already knows that product id. **The moment someone's subscription to it goes active,
they get coach access within 15 minutes — automatically.** No tag, no workflow, nothing to maintain.

Your only job is a page people can buy it on.

---

## Step 1 — check Stripe is connected

**Payments → Integrations.**

Stripe should already show as connected — your location has ten historical subscriptions that were
charged through it. If it does not, connect it before going further, or the order form has nothing to
charge with.

## Step 2 — create the funnel

**Sites → Funnels → New Funnel.**

Name it something you will recognise later, e.g. `Michael Stickler Coach Access`.

You need **two steps** in it:

1. **Order Form** — where they pay
2. **Thank You** — where they land afterwards

## Step 3 — the order form

Open step 1 and add an **Order Form** element.

**Select the product:** `Michael Stickler - Coach Access` at $59/month.

**The fields.** This is the part that matters most:

| Field | Required? | Why |
|---|---|---|
| Email | yes | It is how GHL identifies them, and how the activation box verifies them |
| First / Last name | yes | ordinary |
| **Phone** | **yes — ask for it** | **This is the important one, see below** |

### Why the phone field earns its place

If a phone number reaches the GHL contact, the Worker links that handset **automatically**. The buyer
can text or call their coach immediately and **never sees an activation code at all.**

Without a phone, they have to log into the course, find the activation box, press a button and text a
6-character code before anything works.

So: **ask for the phone, and make it required.** It converts a four-step activation into none.

Ask for it in **full international form** if you can — `+1 555 123 4567`. The Worker only accepts
numbers it can be confident about: a US 10-digit or 11-digit number, or anything starting with `+`.
An ambiguous number is deliberately refused rather than guessed, because a wrong guess would hand one
person's coach to someone else's phone.

## Step 4 — the thank-you page

Keep it simple, but say what happens next. Suggested copy:

> **You're in.**
> Your coach is ready now. Text or call **+1 854 254 5009** any time — we have already linked the
> phone number you gave us.
> You can also chat with your coach inside your course.

If you did **not** make the phone field required, change that to point them at the course and the
activation box instead, or people will text from a number we do not know and be turned away.

## Step 5 — publish, and send me the URL

Publish the funnel and send me the order-form URL. I will put it in `coaches.json` as
`landingPageUrl`, which is currently blank.

## Step 6 — the real test

1. Buy it yourself, or have your US colleague buy it. **Use a real card** — Stripe test mode will not
   produce a live subscription, and a live subscription is the thing we need to see.
2. Tell me, and I will confirm three things:
   - GHL shows the subscription as **active** — and I will confirm the exact status string, which I
     have **never been able to observe** because all ten of your existing subscriptions are cancelled
   - The Worker granted access within 15 minutes
   - The handset linked automatically from the phone on the order
3. Then **cancel it** and we watch access disappear. That is the half nobody usually tests, and it is
   the entire reason this system exists.
4. Refund the card afterwards if you like.

---

## What you do NOT need to build

- **No tag automation.** The Worker reads payment status directly. The tag
  (`bookcoach-micheal-stickler-active`) still works and stays as a manual override for staff, comps
  and testing — but nothing has to apply it on purchase.
- **No workflows at all.** Not for granting, not for cancelling.
- **No Shopify.** Decided against — see the plan.
- **No webhook.** Nothing to configure, no secret to share.

---

## Optional, but worth considering — grant the course too

GHL prices have a `membershipOffers` field. Attaching the coach course offer to this price means
**buying also grants Course360 course access**, with no manual step.

Mine is currently empty, so today a buyer gets the coach but **not** automatic course access. That
matters less than it sounds — if they gave a phone, they never need the course to reach their coach.
But if you want the course granted on purchase too, attach the offer to the price in the GHL UI, or
tell me the offer name and I will look at doing it by API.

---

## If something goes wrong

Send me what you saw and I will check the live state. Two things I can inspect without you doing
anything: whether GHL reports the subscription as active, and whether the Worker granted access.

The most likely snags, in order:

1. **The status string is not `active` or `trialing`.** I am inferring those from Stripe's
   conventions because your location has no active subscription to look at. If GHL uses something
   else, access will not be granted — a one-line fix once I can see a real one.
2. **The phone was not captured, or not in a form the Worker accepts.** Then they fall back to the
   activation code in the course, which still works.
3. **A different email at checkout than the one they log into the course with.** The subscription
   route does not care — it keys on the contact the payment created. But the activation box in the
   course would then be looking at a different contact.
