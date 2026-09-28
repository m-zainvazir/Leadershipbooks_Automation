# Phase 2 — Shopify Flows

**Written:** 2026-09-12. **Corrected against the live Shopify Flow reference 2026-09-13.**
**Parent:** [`00-master-plan.md`](00-master-plan.md) phase 2.

**Context that shapes everything here:** fulfilment is via **IngramSpark, entirely manual**, with no
API credentials available. Shopify almost certainly never sees a fulfilment or a carrier
`DELIVERED` event.

> **Corrections made 2026-09-13.** The 2026-09-12 draft specified a trigger that does not exist and
> an action this store may not be entitled to. Both were found by reading Shopify's live Flow
> reference rather than assuming. See §0 and §3.

---

## 0. Both gates cleared — 2026-09-13

| Gate | Answer | Consequence |
|---|---|---|
| **A** — is `Send HTTP request` available? | **Grow plan** | ✅ Available. Grow, Advanced and Plus all carry it; only Basic and Starter do not. Build as specced. §6 is not needed. |
| **B** — payment capture | **Automatic** | ✅ Flow A triggers on **`Order paid`**. Unpaid, authorise-only and fraud-held orders never start a trial, for free. Condition 5 in §2 does not apply. |

> **If payment capture is ever switched to manual, Flow A breaks silently.** `Order paid` does not
> fire for authorised-but-uncaptured orders, so the trigger would simply stop firing and no trial
> would ever start — with no error anywhere. The manual-capture variant is kept in §2 for that day.

---

## 1. The design inverts — read this before building

The original design (handoff doc §6) had three flows in a clear hierarchy:

| | Original intent | Reality with manual IngramSpark |
|---|---|---|
| Flow 2 — carrier `DELIVERED` | **primary**, carries most orders | ❌ **impossible.** No tracking in Shopify, no event, ever |
| Flow 1 — manual `delivered-manual` tag | safety valve | the only *accurate* signal — but only if a human applies it |
| Flow 3 — time-based backstop | rarely fires | ⚠ **likely the path that actually carries most orders** |

Below, the surviving two are renamed **Flow A** (the timer, primary) and **Flow B** (the manual
accelerator), because "Flow 1 / Flow 3" encoded the old, wrong hierarchy in the names.

**The uncomfortable question: does anyone actually know when a book arrives?** IngramSpark ships
direct to the reader. If nobody sees a delivery confirmation, `delivered-manual` never gets applied,
and Flow B fires for nobody. A trial that only starts when someone remembers to tag an order is a
trial that mostly doesn't start — and the customer paid.

**So build Flow A as the primary path and Flow B as an accelerator**, not the other way round.
Flow B still matters: when you *do* know a book landed, it starts the trial immediately instead of
making the reader wait out the timer.

### 1.1 How the two flows relate — they are not alternatives

**Both flows start on every order, always, in parallel.** Nothing "switches" between them. What stops
them double-firing is the **`coach-started`** tag, not `delivered-manual`.

| | **Flow A** — the timer | **Flow B** — the accelerator |
|---|---|---|
| Job | guarantees *every* buyer eventually gets a trial | starts it early when you **know** the book arrived |
| Trigger | `Order paid` | `Order created` |
| Fires | 21 days after payment, by itself | only when a human clicks **Run workflow** |
| Human needed | none | yes — tag **and** run |
| `source` | `shopify_flow_backstop` | `shopify_flow_manual` |

Flow A **guesses** the delivery date. Flow B lets you **replace the guess with the truth** on the
orders where you actually know it. That is the whole relationship.

#### The three scenarios

| | Day 0 | Day 6 | Day 21 | Trial starts |
|---|---|---|---|---|
| **Nobody touches the order** | B auto-runs → no `delivered-manual` → **False**, dies. A starts waiting | — | A checks: nothing started yet → **fires**, adds `coach-started` | **day 21**, `backstop` |
| **Tagged *and* run on day 6** | same as above | you tag + **Run workflow** → B **fires**, adds `coach-started` | A's wait ends, sees `coach-started` → **False**, dies quietly | **day 6**, `manual` |
| 🚨 **Tagged, but not run** | same as above | **nothing happens** | A fires as normal | **day 21** — the tag did nothing |

#### 🚨 Adding the tag does not start anything by itself

There is no `Order tags added` trigger in Shopify Flow (§3). The tag is only a **condition**; the
**Run workflow** click is what fires it. So the operating procedure is **two actions, never one**:

> Tag the order `delivered-manual` → **More actions → Automate with Flow → Run workflow**

Tag it and walk away and the reader simply waits out the 21 days, with an order that *looks* handled.

> **Why the 2026-09-15 test seemed to contradict this:** the test order was tagged as a **draft
> order** and then converted, so `delivered-manual` was already present at `Order created` and Flow B
> fired automatically with no click. Real customer orders get tagged days later, when that trigger
> has long since passed. **Pre-tagging a draft is a good way to test and a bad model of production.**

### Which way to err on timing

Starting the clock **before** the book arrives is the harmful direction — the reader burns trial
days on a coach for a book they cannot read, then the trial ends around when the parcel lands.
Starting it late costs only delay.

IngramSpark print-on-demand is roughly 1–3 business days to print plus 3–10 to ship. **21 days from
order** is the safe backstop. Tighten it later once you have real delivery data; do not start there.

Flow's `Wait` action caps at **90 days total per workflow** (and 40 wait steps), so 21 days is
comfortably inside the limit. **Verified 2026-09-13.**

### One copy change this forces

The welcome email currently opens *"Your book has arrived — so your Book Coach AI is now live."*
On the Flow A path that claim may simply be **false**, and it invites "no it hasn't" replies.

Change it to something true on both paths:

> **Your Book Coach AI is now live.**

Same warmth, no claim you cannot back. `source` still records which path fired — but see §4.3,
nothing currently stores it.

---

## 2. Flow A — the timer (BUILD FIRST)

Name it **`Book Coach — Trial Start (21-day backstop)`**.

| | |
|---|---|
| **Trigger** | **`Order paid`** — settled by Gate B. **Not** `Order created` (fires before capture), **not** `Order fulfilled` (with manual IngramSpark, orders may never be marked fulfilled, and a trigger that never fires is worse than no flow). |
| **Action 1** | **Wait** — 21 days |
| **Condition** | all four checks below |
| **Action 2** | **Send HTTP request** (§4), `source: shopify_flow_backstop` |
| **Action 3** | **Add order tags** → `coach-started` |

### 2.1 Build it, step by step

> **Click-by-click, with a verification after every step:**
> [`04-phase-2-build-runbook.md`](04-phase-2-build-runbook.md). The summary below is the shape;
> the runbook is the keystrokes.

1. **Automations → Flow → Create workflow.** If Flow is not installed, install it from the App
   Store first — it is free.
2. **Select trigger → Shopify → `Order paid`.**
3. **+ → Action → Wait.** ✅ **This is 21 DAYS as of 2026-09-17** (Muhammad). Set **5 minutes** for now. *(You will change it to 21 days at step 9.
   Building with 21 days means your first end-to-end test finishes in October.)*
4. **+ → Condition.** Add the four criteria in §2.2. Set the group to **ALL**, not ANY.
5. On the condition's **True** branch: **+ → Action → Send HTTP request.** Configure per §4.
6. Still on **True**, after the HTTP action: **+ → Action → Add order tags** → `coach-started`.
7. Leave the **False** branch empty. That emptiness is the guard, exactly as the `None` branch
   is in the GHL workflow.
8. **Turn on.** Then run one real order end to end (§7) and confirm it works at 5 minutes.
9. **Only then**: edit the Wait to **21 days** and save. Re-check that the workflow is still **on**
   after the edit.

> **Order matters at steps 5 and 6.** The HTTP request comes *before* the tag. If the tag were
> applied first and the request then failed, the order would be permanently marked `coach-started`
> with no trial behind it — the silent failure this whole design is built to avoid.

### 2.2 The condition, in full

All four must hold:

| # | Check | Why |
|---|---|---|
| 1 | order tags **do not contain** `coach-started` | Flow B may already have started this trial |
| 2 | order **contains product** `10434147320122` | see §3.1 — not optional |
| 3 | order **`cancelledAt` is empty** | ⚠ **new.** A cancelled order must not start a trial |
| 4 | order **`displayFinancialStatus` is not** `REFUNDED` / `PARTIALLY_REFUNDED` / `VOIDED` | ⚠ **new.** Nor must a refunded one |

**Checks 3 and 4 were missing from the 2026-09-12 draft.** Without them a buyer who cancels or
refunds on day 2 receives a welcome email and a coach trial on day 21, for a book they returned.

**Building check 2 in the picker.** Flow's condition builder walks the GraphQL Order object, so the
product check is a **list** criterion, not a plain equality:

```
Order → line items → [At least one of] → product → id     equals  gid://shopify/Product/10434147320122
                                     └ or → legacyResourceId  equals  10434147320122
```

Flow's list operators are **`At least one of`**, **`None of`** and **`All of`** — pick
**`At least one of`**. `All of` would demand that *every* line on the order be the bundle, so a
reader who also bought a mug would get no trial. **`product.id` is a GID**
(`gid://shopify/Product/10434147320122`); `legacyResourceId` is the bare `10434147320122` that
matches the Shopify admin URL. Take whichever the picker actually offers and paste the matching
form — mixing them produces a condition that is never true, silently.

> **Manual-capture variant — not needed today.** If capture is ever switched to manual, change the
> trigger to `Order created` and add a fifth check: `displayFinancialStatus` **is** `PAID`. That
> restores what `Order paid` gives you for free. See §0.

### 2.3 Why the condition sits after the wait

Shopify Flow **refreshes workflow data when a wait ends** — the condition reads the order as it is on
day 21, not as it was at checkout. So an order that Flow B already started (and tagged
`coach-started`) drops out here, and so does one cancelled or refunded in the meantime.
*(Verified against Shopify's Wait reference, 2026-09-13. This is the single assumption the whole
idempotency design rests on, which is why it is written down rather than assumed.)*

> ⚠ **One documented consequence of that refresh:** if a workflow contains a `Get`, `Sum` or `Count`
> action **before** a `Wait`, its result is **not** available after the wait. Flow A uses none of
> those. If you ever add one, it must be repeated after the wait.

---

## 3. Flow B — the manual accelerator

> ### 🛑 The 2026-09-12 draft was unbuildable
>
> It specified a trigger named **`Order tags added`**. **No such trigger exists in Shopify Flow.**
> The complete list of order triggers is: `Order canceled`, `Order created`, `Order deleted`,
> `Order fulfilled`, `Order paid`, `Order risk analyzed`, `Order transaction created`. Tag-change
> triggers exist for **customers only** (`Customer tags added` / `Customer tags removed`).
> *(Verified against Shopify's live trigger reference, 2026-09-13.)*
>
> A third-party app (Flow Companion) adds an `Order tags added` trigger. **Do not take that
> dependency** for something achievable natively.

### As built — trigger on the order, fire it by hand

Name it **`Book Coach — Trial Start (manual delivery)`**.

| | |
|---|---|
| **Trigger** | **`Order created`** — see the note on noise below |
| **Condition** | tags **contain** `delivered-manual` **AND** tags **do not contain** `coach-started` **AND** order **contains product** `10434147320122` |
| **Action 1** | **Send HTTP request** (§4), `source: shopify_flow_manual` |
| **Action 2** | **Add order tags** → `coach-started` |

**Build it:** same shape as §2.1 with no Wait — trigger, one ALL condition, then HTTP request, then
the tag, in that order, `OTHERWISE` left empty. Build the product criterion exactly as §2.2
describes; the `At least one of` trap is identical here.

> **Why `Order created` and not `Order paid`?** Flow B is fired by hand, weeks after the order. Both
> triggers work for a manual run. `Order created` is chosen because it is the widest net — if an
> order somehow never reached `paid` but the book was genuinely delivered, you can still start the
> trial. The human pressing the button is the judgement here, not the trigger.

**How a human fires it:**

1. IngramSpark shows the book delivered.
2. Find the order in Shopify → **add the tag `delivered-manual`** → Save.
3. **More actions → Automate with Flow** → select this workflow → **Run workflow**.
4. Optionally **View results in Flow** to confirm it ran the True branch.

Running a workflow manually works *even though the triggering event has already happened* — that is
its documented purpose. The workflow must be **activated** first, and the Flow app installed. Flow
allows a manual run on up to **50 orders** at a time, so a batch of deliveries can be done in one pass.

> **Why keep the tag at all, if the manual run is what fires it?** Two reasons. The tag is the audit
> record — the order itself says why a trial started and when. And it is the safety catch: if
> someone hits *Run workflow* on the wrong order, the first condition fails and nothing happens.

**Expected noise:** because Flow B triggers on `Order created`, it also runs automatically on every
new order, stops at the condition, and leaves a "stopped at condition" line in the run log. Harmless,
and worth knowing so it is not mistaken for a fault.

### 3.1 The product condition is not optional

Without it, tagging *any* order `delivered-manual` starts a coach trial for a customer who bought an
unrelated book. Harmless with one coach and actively wrong with fifteen.

**Key on product ID `10434147320122`, not SKU.** Verified live 2026-09-13: the bundle variant still
has `sku: null`, and this catalogue already has a duplicate-SKU collision (`Life Without
Reservation` paperback and `Life Without Reservation Study Guide` both carry `9781951648213`).

### 3.2 The alternative, if the two-step feels wrong

**Trigger `Customer tags added`, condition tag = `coach-delivered-lwr`.** One human action instead
of two, no run-log noise, and it fires the instant the tag lands. The trigger exposes the added
tags, the customer, and the shop.

**What it costs:** the order is not in scope, so you lose the product condition, the
`coach-started` order-tag lock, and `shopify_order_id` / `shopify_order_number` from the payload.
The GHL `coach_status is empty` guard still stops duplicates, so idempotency survives — it is just
one layer thinner instead of two.

**Not recommended for one coach.** Worth revisiting at fifteen, where a tag *per book*
(`coach-delivered-<slug>`) is the thing that scales and the product condition becomes redundant.

---

## 4. The `Send HTTP request` action

| Field | Value |
|---|---|
| Method | `POST` |
| URL | `<GHL_TRIAL_WEBHOOK_URL>` |
| Header | `Content-Type: application/json` |
| **On 4XX** | **Retry for up to 24 hours** |
| **On 5XX / 429** | **Retry for up to 24 hours** |

Flow waits up to **30 seconds** for a response and treats **2XX or 3XX as success**. Retry is safe
here: a retried delivery reaches a GHL workflow whose `coach_status is empty` guard makes the second
run a no-op. Choosing *fail* or *ignore* instead means a single GHL blip silently costs a customer
their trial, with nothing but a run-log line to say so.

### 4.1 Body template

```json
{
  "event": "book_delivered",
  "source": "shopify_flow_backstop",
  "email": "{{order.email}}",
  "first_name": "{{order.billingAddress.firstName}}",
  "last_name": "{{order.billingAddress.lastName}}",
  "phone": "{{order.phone}}",
  "shopify_order_id": "{{order.id}}",
  "shopify_order_number": "{{order.name}}",
  "delivered_at": "{{order.createdAt}}"
}
```

> ⚠ **Build every value from Flow's variable picker, never typed from this file.** The object graph
> differs per trigger, and a wrong path fails **silently with an empty field** — you get a contact
> with no email and no way to tell why. This template is a shape to aim at, not a spec.

### 4.2 Field choices, and why they changed

**`order.email`, not `order.customer.email`.** ⚠ **Corrected 2026-09-13.** `order.customer` is
**null** on a guest checkout where customer accounts are off, and after a GDPR erasure request.
`email` sits on the order itself and is what the buyer typed at checkout. This one matters more than
the rest: **email is GHL's dedupe key**, so an empty one produces an un-deduplicable contact and
permanently breaks the "one trial per contact" guard for that person. Verify in the picker that both
exist, then take `order.email`.

**Names from the address, not the customer.** `order.billingAddress.firstName` / `lastName` are
populated on every paid order; `order.customer.firstName` inherits the same null problem as the
email. Fall back to `order.shippingAddress` if billing is absent.

**Phone may be empty, and it is worth chasing.** Try `order.phone`, then
`order.shippingAddress.phone`, then `order.billingAddress.phone`, then `order.customer.phone`.
Whichever is populated is the one worth sending — **a phone on the GHL contact auto-links the
reader's handset and skips activation entirely** (`../coach-router/plans/to-do.md` §3). A required
checkout phone field was considered and declined 2026-09-12, so this is the only route to one.

**`order.id` is a GID**, like `gid://shopify/Order/5432109876543`, not a bare number. Harmless — it
is only stored for support — but do not expect it to match Shopify admin's numeric ID. `order.name`
(`#1042`) is the human-facing one.

**`delivered_at` on the Flow A path is the order date**, not a delivery date. It is reporting-only
(`coach_trial_started` is what the GHL workflow writes), so this is acceptable — but do not later
build logic on it believing it means delivery.

### 4.3 ⚠ Nothing currently stores `source`

The master plan says *"check `source` on new contacts daily for the first three weeks after launch —
it is the only signal telling you which path fired"*. **That instruction cannot be followed today.**
`source` is sent in the payload and GHL discards it; the same is true of `shopify_order_number`.

**Do this while you are in GHL building phase 2, not later:**

| Field | Key | Type | Why |
|---|---|---|---|
| Coach Trial Source | `coach_trial_source` | Text | Which path started this trial. Without it, a silently-failing flow is invisible. |
| Shopify Order Number | `shopify_order_number` | Text | Support: ties a contact to an order in one look. |

**No re-fire of `test-ghl-webhook.ps1` is needed for these two.** Checked 2026-09-13: the script
already sends `source`, `shopify_order_id` and `shopify_order_number` (plus `sku`,
`tracking_number`, `shopify_customer_id`), so GHL has already learned them from the 2026-09-10 run.
The missing piece is only the *storage* — the custom fields, and the mapping.

**Steps, in GHL:**

1. **Settings → Custom Fields → Add Field** — object *Contact*, type *Text*, twice:
   name `Coach Trial Source`, key `coach_trial_source`; name `Shopify Order Number`, key
   `shopify_order_number`.
2. **Automation → `Book Coach — Delivery → Trial Start`** → open the existing
   `Update contact field` action inside the `Fresh - start trial` branch — the one already writing
   `coach_status` and `coach_trial_started`.
3. Add two more field rows to that **same action**. Do not add a second action; a second one is
   another place for the branch to half-run.
4. Map each to the inbound-webhook value from the trigger’s field list, **not** typed by hand:
   `coach_trial_source` ← `source`, `shopify_order_number` ← `shopify_order_number`.
5. **Save.** Then publish. *(Trap 1: the canvas and the published version are separate. An action
   that appears to do nothing is usually an unsaved canvas, not a misconfiguration.)*
6. Blank `coach_status` on the test contact, re-fire `test-ghl-webhook.ps1`, and confirm both new
   fields land. Then delete the test contact — left in place it is tagged, and the next reconcile
   grants it a real lease.

Remember: **the `contact.` prefix goes in merge tags and workflow references, never in the custom
field Key box.**

> The script defaults to `-Source test`. Pass `-Source shopify_flow_manual` to rehearse what a real
> Flow B run will write.

### 4.4 Flow's HTTP action gives no feedback beyond its run log

Check **the flow's run log** before assuming GHL is at fault. A 2xx there means GHL received it;
after that, the GHL workflow's Execution logs take over. The response is available to later steps as
`sendHttpRequest`, but GHL's inbound webhook returns nothing useful, so there is nothing to branch on.

---

## 5. Flow 2 — carrier `DELIVERED` · DEFERRED INDEFINITELY

Requires Shopify Shipping (or any integration) writing tracking onto the order from a supported
carrier. With manual IngramSpark fulfilment there is no such data, so **this flow cannot work and
should not be built.**

Revisit only if fulfilment moves into Shopify with tracking — see master plan phase 8, route 2. At
that point: clone Flow B, change the trigger to `Fulfillment event created` with status `DELIVERED`,
and set `source: shopify_flow_delivered`. It would then become the primary path and Flow A's wait
could shorten considerably.

---

## 6. If Gate A fails — the Basic/Starter route · ✅ NOT NEEDED (store is on Grow)

**Resolved 2026-09-13: the store is on Grow, so `Send HTTP request` is available and none of this
is required.** Kept because it is the route if the plan is ever downgraded — and because it is the
same design multi-coach will eventually want anyway (`02-multi-coach-scaling.md` §3).

**No `Send HTTP request` means no flow in this document can be built.** The route is the one
`02-multi-coach-scaling.md` §3 already chose for multi-coach anyway, arrived at early:

1. A plain **Shopify webhook** (Settings → Notifications → Webhooks) on `orders/paid` →
   `POST https://coach-router.bookcoachai.workers.dev/shopify/order`. Free on every plan,
   HMAC-signed by Shopify.
2. The Worker verifies the HMAC, dedupes on order ID, maps the Shopify product → coach from
   `coaches.json`, and either calls the same GHL webhook or tags the contact directly.

**What it costs:** the 21-day timer has to live somewhere. Shopify webhooks fire immediately and
cannot wait. Either the Worker schedules it (a KV record the existing 15-minute cron sweeps — cheap,
since the cron already runs) or the GHL workflow carries the wait instead of Shopify.

**What it buys:** adding a coach becomes one object in `coaches.json` plus `npm run push`, with no
Shopify or GHL edit at all. On any plan.

**Owner:** coach-router side, not a UI task. **Do not start it until Gate A is actually checked** —
it is real work, and unnecessary if the plan is Grow or above.

---

## 7. Testing

**Flow B is the only one testable on demand — that is its other virtue.**

1. Place a real order for the bundle (**$29.95**, product `10434147320122`)
2. Add the `delivered-manual` tag to the order by hand
3. **More actions → Automate with Flow → Flow B → Run workflow**
4. Check the **Flow run log** — did the HTTP request return 2xx?
5. Check **GHL Execution logs** — did the workflow run the full branch?
6. Check the contact — `coach_status: trial`, tag `bookcoach-micheal-stickler-active`, and (if §4.3
   is done) `coach_trial_source: shopify_flow_manual`
7. `npm run subs -- --sync` then `--list` from `../../coach-router` — is the contact entitled?
8. **Run the workflow a second time** → nothing should change. Condition 2 (`coach-started`) stops it.
9. **Text `+1 854 254 5009` from the phone on the order** → coach replies with no activation code
10. Refund yourself — then confirm the trial does *not* restart

**Step 9 is the one that proves both systems are joined.** Everything before it only proves the
commercial layer talked to itself.

**Before re-testing against an existing contact, blank `coach_status` in GHL.** Left set, the guard
correctly stops every run — which on screen is indistinguishable from a broken workflow.

**Flow A cannot be tested on demand.** Two partial substitutes:

- Build it with a **5-minute** wait, run one order through end to end, then change the wait to 21
  days before activating for real. This exercises everything except the duration.
- Run Flow A manually on an order from **More actions → Automate with Flow** — it still waits, so
  this only proves the trigger and the payload, not the timing.

**Check `coach_trial_source` on new contacts daily for the first three weeks after launch.** It is
the only signal saying which path fired, and the only way to notice one silently failing.

---

## 8. Open

- [x] ~~**Gate A — what plan is this store on?**~~ **Grow**, 2026-09-13. `Send HTTP request` available.
- [x] ~~**Gate B — automatic or manual payment capture?**~~ **Automatic**, 2026-09-13. Flow A uses
      `Order paid`. ⚠ If capture is ever switched to manual, `Order paid` stops firing and trials
      silently stop starting — see §0.
- [ ] **Is Shopify Flow installed?** Free from the App Store, but nothing below exists without it.
- [ ] **Who applies `delivered-manual`, and how do they learn a book arrived?** If the answer is
      "nobody reliably", Flow A is not a backstop — it is the product, and 21 days is the real
      trial start for every customer. Worth being honest about that in the landing page copy.
- [ ] **Is 21 days right?** No delivery data exists yet. Revisit after ~20 real orders.
- [ ] Create `coach_trial_source` and `shopify_order_number` custom fields (§4.3).
- [ ] Add a SKU (`BC9781951648213`) to the bundle, and fix the Study Guide's duplicate SKU.
- [ ] Set the bundle variant's `weight` — verified still `0` on 2026-09-13, which breaks
      carrier-calculated rates.
