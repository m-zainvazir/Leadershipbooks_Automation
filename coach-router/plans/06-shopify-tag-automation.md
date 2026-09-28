# Plan — automating the coach tag on purchase

**Status:** **DECIDED 2026-08-28 — Option A.** Recurring monthly subscription, sold through GHL.
Not started. Written 2026-08-28, revised twice the same day.
**Read with:** [`to-do.md`](to-do.md) and `../HANDOFF.md` §10.

Originally scoped as "Shopify webhook". It turned out not to involve Shopify at all. **Read the
DECIDED block and §3a; §3 and §4 are the reasoning and the rejected alternative.**

---

## 1. The gap this closes

Access works end to end, but one step in the middle is manual:

```
someone buys  ->  [ Muhammad adds the GHL contact and tag by hand ]  ->  reconcile grants
                                                                          access within 15 min
                                                                       ->  subscriber texts / calls
```

Right now exactly two contacts carry `bookcoach-micheal-stickler-active`, both applied by hand.
Every other member who opens the coach lesson is told they have no active subscription.

**Target:** the tag appears on its own when someone pays.

---

## DECIDED — 2026-08-28

| Question | Answer |
|---|---|
| One-off or recurring? | **Recurring monthly subscription.** |
| Where is it sold? | **GHL (Option A).** Not Shopify. |
| Options B and C | **Rejected.** §4 kept for reference only. |

Recurring matters: it means every revocation path already built — the lease decay, the archive
record, the retention sweep, the majority guard — **now actually fires.** With a one-off purchase they
would have sat idle forever.

### And a better implementation than the one first proposed

The original Option A assumed two GHL workflows: one adding the tag on purchase, one removing it on
cancellation. **That is no longer necessary.** Probing showed the Worker can read GHL subscriptions
directly, so it can see who is currently paying without any workflow at all. See §3a.

---
## 2. What was verified, 2026-08-28

### `contacts.write` — RESOLVED, the scope is granted

Muhammad enabled it. Confirmed with two probes that cannot create anything:

```
PUT  /contacts/probe-does-not-exist-xyz   -> 400 "Contact with id … not found"
POST /contacts/  {locationId, email:"not-a-valid-email"}  -> 422 "email must be an email"
```

Both reached the handler, so the token is authorised. Validation errors, not auth errors.

**A trap worth recording.** The first re-probe looked like a failure:

```
POST /contacts/ {}   ->  403 "The token does not have access to this location."
```

That is *not* a scope error — it is GHL failing to resolve a location because `locationId` was
missing from the body. The genuine scope error reads *"The token is not authorized for this scope."*
**Match on the message, not the status code**, or a granted scope reads as denied.

### Where the pages actually live — confirmed, not assumed

| Domain | Platform | Evidence |
|---|---|---|
| `leadershipbooks.com` | **Shopify** | sets `_shopify_y`, `_shopify_essential`, `_shopify_analytics`; `/products/<handle>.js` returns Shopify product JSON |
| `book-coach.ai` | **GHL** | `via: 1.1 google` |

So the product pages are Shopify, the coach pages are GHL, and checkout happens on Shopify —
**which Muhammad does not control.** That constraint drives §3.

To check any other page: `curl -I <url>` and look for Shopify cookies; `via: 1.1 google` means GHL.

### The product is a ONE-TIME purchase, not a subscription

From `https://leadershipbooks.com/products/invisible-to-viral-book-personal-coach.js`:

| Field | Value |
|---|---|
| title | Invisible to Viral™ Book + Personal Coach |
| product id | `10363021623610` |
| handle | `invisible-to-viral-book-personal-coach` |
| sku | `BC9781951648435` |
| `selling_plan_groups` | **0** |
| `requires_selling_plan` | **false** |

No selling plans means no Shopify subscription. A buyer pays once.

**This contradicts the premise the access system was built on** — *"once they lose the subscription,
their access is lost."* If purchase is one-off, nothing ever ends: the tag is never removed and the
lease renews forever. Every revocation path (archive, retention sweep, majority guard) sits idle.

"Buy the book, keep the coach" is a perfectly good model. But it should be a decision, not a
by-product of how a Shopify product happens to be configured.

### Orders usually carry a phone number — a real win, whichever route is chosen

A Shopify order payload normally includes `phone`, `billing_address.phone` or
`shipping_address.phone`. A GHL order form can ask for one directly.

The Worker already has an opportunistic path: a tagged GHL contact **with** a phone is linked
automatically by the reconcile, **with no activation code**.

So if the phone reaches the contact, the buyer can text or call their coach without ever seeing the
activation box. **That inverts the design in a good way** — the box becomes the fallback for buyers
who left no phone, rather than the route everyone must walk. Worth building for deliberately.

---

## 3. Where to trigger the tag from — three options

### Option A — sell the coach subscription through GHL, not Shopify ⭐ RECOMMENDED

GHL has its own payments (via Stripe) and can sell recurring products. The landing page becomes a GHL
funnel with an order form.

**Why this is strongest here:**

- **Muhammad controls all of it.** No waiting on whoever manages Shopify.
- **No code at all.** The order form *is* a GHL form, so the contact is created automatically. No
  webhook, no `contacts.write`, no Worker changes, nothing to deploy.
- **Cancellation works natively** — a GHL workflow removes the tag when the subscription ends. That is
  the one thing currently missing, and the whole reason the revocation machinery exists.
- **One system of record.** The coach subscription is a *service* that already lives entirely in GHL:
  the course, the login, the contact, the tag. Selling it on Shopify means two systems that must be
  reconciled forever — which is precisely the complexity §4 exists to bridge.

**Trade-off:** money flows through GHL/Stripe rather than the Shopify store. A business decision, not
a technical one, and worth raising with whoever owns the P&L.

**Rough steps** (verify exact menu names in the live version):

1. Connect Stripe — **Payments → Integrations**
2. **Payments → Products** → new product, **recurring** monthly price
3. **Sites → Funnels** → new funnel with an **Order Form** step, add that product
4. **Automation → Workflows** → trigger on order/payment → **Add Tag**
   `bookcoach-micheal-stickler-active`
5. Second workflow → trigger on subscription cancelled or payment failed → **Remove Tag**

### Option B — Shopify Subscriptions + the webhook in §4

Shopify's own free **Shopify Subscriptions** app adds selling plans to a product (requires Shopify
Payments). Third-party alternatives: Appstle, Seal, Recharge.

Then §4 applies: `orders/paid` → the Worker → GHL contact + tag.

**Choose this if** the business requires all sales to stay on the Shopify store.

**Cost:** needs the Shopify owner for the app, the selling plan, the webhook and the signing secret.
More moving parts, more people, and nothing can move without them.

### Option C — hybrid: one-time on Shopify, renewals tracked in GHL

Avoid. Two systems of record for one entitlement, and nothing reconciles them.

### The recommendation

1. **First, prove the chain with no money at all.** A plain **GHL form** on a funnel — name, email,
   phone — with a workflow that adds the tag on submit. Ten minutes, no Stripe, no Shopify, no
   approvals. It tests the entire path that matters:

   ```
   form submitted -> contact created -> tag added -> access granted within 15 min -> they text/call
   ```

   Once that works, the only open question is *what triggers the tag* — a form, a GHL payment, or a
   Shopify webhook. Those are interchangeable endings to a chain already proven.

   **Put a phone field on the form.** If a phone reaches the contact, the buyer is linked
   automatically and never needs the activation code.

2. **For the real thing: Option A.** It is where the course, login and contact already live, and the
   only option where cancellation works without new code.

3. **Only if the business requires Shopify checkout: Option B**, using §4.

`contacts.write` is now enabled, so Option B is unblocked whenever wanted. **But Option A does not
need it** — and the simplest system is the one with the fewest moving parts.

---

## 3a. How Option A will actually be built — subscription-driven

### What the probe found, 2026-08-28

`GET /payments/subscriptions?altId=<locationId>&altType=location` returns **200**.
(The earlier `422` was simply the wrong parameters — it wanted `altId`/`altType`, not `locationId`.)

Ten subscriptions already exist in this location at $24.25/month, all now `canceled` or
`incomplete_expired` — historical, from a different product. Crucially:

| Field | Value / meaning |
|---|---|
| `status` | `canceled`, `incomplete_expired` seen. Stripe conventions, so `active` / `trialing` are the entitled states. |
| `contactId`, `contactEmail`, `contactPhone` | all present — **`contactPhone` means the handset can auto-link** |
| `recurringProduct.product._id` | the GHL product id — **this is the mapping key to a coach** |
| `recurringProduct.price.recurring` | `{ interval: "month", intervalCount: 1 }` |
| `paymentProviderType` | `stripe` — **Stripe is already connected** |
| `subscriptionStartDate`, `subscriptionEndDate` | present |

### The design

**The reconcile reads payment status, not tags.** Each run it asks GHL for the location's
subscriptions, keeps those whose `status` is active, maps `recurringProduct.product._id` to a coach,
and grants. Anything that stops being active is revoked on the next run — within 15 minutes.

```
GHL subscription active  --cron 15min-->  reconcile  -->  entitled
GHL subscription cancelled  ------------>  reconcile  -->  revoked, session cleared, archive record
```

**Why this beats the workflow-and-tag approach:**

- **No workflows to build or maintain.** Muhammad creates the product and sells it. Nothing else.
- **No dependency on GHL having a cancellation trigger** — the risk that would have undermined Option
  A. Payment status is read directly instead of being relayed.
- **The source of truth is the actual payment.** A tag is a copy of the truth that can drift; a
  subscription record *is* the truth.
- **Failed payments are covered for free.** `past_due` / `unpaid` are simply not active.
- **`contactPhone` comes with the subscription**, so a buyer who gave a phone is linked automatically
  and never needs the activation code.

**Trade-off:** it couples the Worker to GHL's payments schema, which is less documented than tags and
could change. Mitigated by keeping the tag path alive:

### Tags stay, as the manual override

A contact is entitled if **either**:

1. an **active subscription** maps to that coach — the automatic path for paying customers, or
2. the coach's **`ghlTag`** is on the contact — the manual path for staff, comps, testing, and anyone
   who needs access without a payment record

Nothing already built is thrown away, and the tag becomes a deliberate override rather than the sole
mechanism.

### Config, per coach in `coaches.json`

```json
{
  "code": "1042",
  "name": "Micheal Stickler",
  "ghlTag": "bookcoach-micheal-stickler-active",
  "ghlProductId": "<the GHL recurring product id for this coach>",
  "landingPageUrl": "<the GHL funnel url>"
}
```

`landingPageUrl` now points at the **GHL funnel**, not the Shopify product page.

### To verify when the first real subscription exists

Every active subscription in this location is currently cancelled, so **the exact string for an active
status has not been observed.** `active` and `trialing` are inferred from Stripe's conventions. Confirm
against the first live subscription before switching enforcement to depend on it — until then the tag
path still grants access, so nothing breaks either way.

### Build order

| Step | Work | Whose |
|---|---|---|
| 1 | Connect Stripe (looks already done), create the recurring monthly product for the coach | Muhammad |
| 2 | Build the GHL funnel + order form, **with a phone field** | Muhammad |
| 3 | Send me the **GHL product id** and the funnel URL | Muhammad |
| 4 | `ghlProductId` + `landingPageUrl` into `coaches.json`, `KV_FIELDS`, seeder validation | mine |
| 5 | `ghlActiveSubscriptions()` — paginated, `altId`/`altType`, active statuses only | mine |
| 6 | Reconcile grants on subscription **or** tag; same guards, same lease | mine |
| 7 | Unit tests: active/cancelled/past_due, product mapping, no-match, API failure changes nothing | mine |
| 8 | One real test subscription, then cancel it and watch access go | both |

Steps 4-7 can be built before Muhammad finishes 1-3, using fixtures.

---
## 4. Option B in detail — the Shopify webhook design (REJECTED, kept for reference)

Kept in full: still correct if Option B is chosen.

### Why the Worker rather than Zapier or GHL's native integration

- **Zapier / Make** — a monthly cost and another dependency for ~80 lines of work.
- **GHL's native Shopify integration + a workflow** — plausible, but the Webhook action is a GHL
  *premium* action billed per execution, and per-product conditions are uncertain. GHL premium actions
  were rejected for the same reason in HANDOFF §10.
- **The Worker** — free, already deployed, already holds the GHL token, already has the HMAC and
  config machinery. One more endpoint.

### The endpoint

`POST /shopify/order`

1. **Verify the signature.** Shopify signs the raw body with HMAC-SHA256 (base64) in
   `X-Shopify-Hmac-Sha256`. Reject anything unsigned or mismatched, exactly as `/twilio/*` does. This
   endpoint creates GHL contacts, so an open version would let anyone forge subscribers.
2. **Idempotency.** Shopify retries on any non-2xx and can deliver twice. Key on the order ID:
   `shop:<orderId>` in KV with a TTL. Already seen -> return 200, do nothing.
3. **Map products to coaches.** For each line item, look up `shopifyProductId` across the registry.
   No match -> ignore that line (most orders are ordinary books).
4. **Find or create the GHL contact** by email:
   - exists -> add the tag (and the phone, if the contact has none and the order does)
   - does not exist -> create with email, name, phone and tag
5. **Return 200 fast.** Shopify's webhook timeout is short; GHL calls go in `ctx.waitUntil()` so a slow
   GHL never causes a retry storm.

### Config, per coach in `coaches.json`

```json
{
  "code": "1042",
  "name": "Micheal Stickler",
  "ghlTag": "bookcoach-micheal-stickler-active",
  "shopifyProductId": "10363021623610",
  "landingPageUrl": "https://leadershipbooks.com/products/invisible-to-viral-book-personal-coach"
}
```

- **`shopifyProductId`** is the mapping key. Chosen over the URL or handle because it is what Shopify
  actually sends, and it survives the product being renamed or the page moved.
- **`landingPageUrl`** is stored for reference and future use. **Be honest: the Worker does not need it
  to function.** It is here so it lives in one place instead of hardcoded per page.
- Both go in `KV_FIELDS`; changing either is `npm run push`, no redeploy.
- A coach with no `shopifyProductId` is never granted by purchase. Fails closed, like `ghlTag`.

### Removing access on refund

If a refund or cancellation should remove the coach: subscribe to `refunds/create` and
`orders/cancelled`, same mapping, then remove the tag. The reconcile revokes within 15 minutes,
exactly as a manual tag removal does today.

Listed separately because whether it applies depends on §5 question 1.

### What could go wrong, and the guard for each

| Risk | Guard |
|---|---|
| Forged webhook creating fake subscribers | HMAC-SHA256 verification, reject on mismatch |
| Shopify retry granting twice | `shop:<orderId>` idempotency key |
| Slow GHL causing retry storms | Return 200 immediately, GHL work in `waitUntil()` |
| Buyer's email differs from their Course360 login | They can still activate by code, but the tag lands on the wrong contact. See §5 |
| A wrong `shopifyProductId` silently granting nothing | `seed-coaches.mjs` validates the format; `--list` shows it |
| One order containing several coaches | Loop every line item, add every matching tag |
| Ordinary book purchases hitting the endpoint | No product match -> ignored, logged, 200 |

---

## 5. Open questions

1. **Is coach access one-off or recurring?** The Shopify product says one-off. **This decides whether
   any revocation path is ever used**, and it is the single most important answer.
2. **Should a refund remove access?** Cheap to add, pointless if unwanted.
3. **Does purchase also grant Course360 course access automatically**, or is that manual too? It
   matters because the activation box lives *inside* the course — a buyer with the tag but no course
   access cannot reach the box. Though if their phone came through on the order, they would not need
   it. The two paths interact.
4. **Option B only — Shopify admin access.** Can the webhook be created and the signing secret read
   (Settings → Notifications → Webhooks, or a custom app)? Muhammad does not manage Shopify.
5. **Option B only — is `leadershipbooks.com` the only store?** One shared signing secret is simpler.

---

## 6. Build order

### If Option A (recommended) — no code

| Step | Work | Whose |
|---|---|---|
| 1 | GHL form + funnel + workflow that adds the tag; include a phone field | Muhammad |
| 2 | Submit it as a test contact, confirm the tag lands | Muhammad |
| 3 | Confirm access within 15 min — `npm run subs -- --list` | mine |
| 4 | Add Stripe + a recurring product when ready for real money | Muhammad |
| 5 | Second workflow: cancellation/failed payment removes the tag | Muhammad |

### If Option B — the Worker route

| Step | Work | Blocked by |
|---|---|---|
| 1 | ~~Add `contacts.write`~~ | ✅ done |
| 2 | `shopifyProductId` + `landingPageUrl` into `coaches.json`, `KV_FIELDS`, seeder validation | — |
| 3 | `SHOPIFY_WEBHOOK_SECRET` into `SHARED_SECRETS` | Muhammad supplies it |
| 4 | HMAC-SHA256 verification helper + unit tests | — |
| 5 | `ghlUpsertContact()` and `ghlAddTag()` | — |
| 6 | `POST /shopify/order` with idempotency, mapping, `waitUntil` | steps 3-5 |
| 7 | Unit tests: signature, replay, no-match, multi-coach, missing phone | — |
| 8 | Point a Shopify test order at it and watch the log | Muhammad |
| 9 | Optionally `refunds/create` + `orders/cancelled` | question 2 |

Roughly 80-120 lines plus tests. Steps 2, 4, 5 and 7 can be done before anything is unblocked.

---

## 7. What Muhammad has to do

1. ~~Add `contacts.write`~~ — **done.**
2. **Decide between Option A and Option B**, and answer §5 question 1 (one-off or recurring).
3. **Build the throwaway GHL form** to prove the chain, whichever option wins. Ten minutes, and it
   de-risks everything downstream.
4. **Option B only:** create the Shopify webhook and supply the signing secret — into `coaches.json`,
   not into chat.
5. **Confirm the real product ID** for Micheal Stickler when his page exists. The one here is the
   dummy for a different author.
