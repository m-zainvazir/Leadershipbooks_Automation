# Phase 2 build runbook — click by click

**Written:** 2026-09-15. **Parent:** [`03-shopify-flows.md`](03-shopify-flows.md) — that file is the
*why*; this one is the keystrokes. **Owner:** Muhammad, in the Shopify admin.

**Order of work: Flow B first, then Flow A.** Flow B is the only one testable on demand, so it
proves the HTTP action, the payload, the GHL branch and the Worker join today. Flow A is the same
machinery with a wait in front of it.

> **Rule for the whole of this document:** where it says *pick from the picker*, pick from the
> picker. A hand-typed variable path that is wrong does not error — it sends an **empty string**,
> and you get a GHL contact with no email and nothing to tell you why.

---

## 0. Before you start

### 0.1 Is Flow installed?

**Apps** → search `Flow` → it should already be there. If not, install **Shopify Flow** from the App
Store. It is free. Nothing below exists without it.

### 0.2 Is step 1 done?

Both GHL custom fields (`coach_trial_source`, `shopify_order_number`) created and mapped into the
existing `Update contact field` action — [`03-shopify-flows.md`](03-shopify-flows.md) §4.3. If not,
do that first. Building the flows before the fields means your first real orders are untraceable.

### 0.3 Values you will paste

Keep this block open in another window.

| What | Value |
|---|---|
| Webhook URL | `<GHL_TRIAL_WEBHOOK_URL>` |
| Product ID (bare) | `10434147320122` |
| Product GID | `gid://shopify/Product/10434147320122` |
| Variant ID | `54042631733562` |
| Lock tag | `coach-started` |
| Trigger tag (Flow B) | `delivered-manual` |
| Header | `Content-Type` : `application/json` |

---

## 1. Flow B — the manual accelerator · BUILD THIS FIRST

### Step 1 — Create it

1. **Apps → Flow** → **Create workflow**
2. Click the workflow title (it says **New Workflow**) and rename it:
   **`Book Coach — Trial Start (manual delivery)`**

### Step 2 — Trigger

3. Click **Select a trigger**
4. Search `Order created` → choose the **Shopify** one → **Order created**

> **Check:** the trigger card now reads *Order created*. If it reads *Order paid*, you picked Flow
> A's trigger — change it.

### Step 3 — The condition

5. Click the **+** below the trigger → **Condition**
6. Set the criteria group to **ALL** (all criteria must be true)

Add three criteria. **The real labels, as confirmed on screen 2026-09-15:**

**Criterion 1 — it is actually the coach bundle**

7. Variable: **`At least one of order / line items`**
8. The `Id` row auto-fills as **`lineItems_item.variant.product.id`** — note it resolves through
   **variant**, not straight to product. Operator: **`Is at least one of`**.
9. **Click `Select products`** and pick *Life Without Reservation + Your Personal AI Coach* from the
   list. **Do not paste the ID by hand.** The picker writes
   `gid://shopify/Product/10434147320122` for you, which sidesteps the GID-vs-`legacyResourceId`
   trap entirely.
10. Leave it as `At least one of`, never `All of` — `All of` would require every line on the order to
    be the bundle, so a reader who also bought a mug gets nothing.

**Criterion 2 — the trial has not already started**

11. **`Add criteria`** (the bottom one, not *"for lineItems_item list item"*) → set the joiner to
    **`AND`**
12. Variable: **`None of order / tags`** ← **`None of`, not `At least one of`.** This is the single
    easiest criterion in the build to get backwards.
13. `Tags item` row: operator **`Equal to`**, value `coach-started`

**Criterion 3 — the order is flagged as delivered**

14. **`Add criteria`** → joiner **`AND`**
15. Variable: **`At least one of order / tags`**
16. `Tags item` row: operator **`Equal to`**, value `delivered-manual`

> ### ⚠ Criterion 2 is the one to get right, and the canvas card lags behind the editor
>
> **What correct looks like in the Configuration panel:** the variable dropdown reads
> **`None of order / tags`**, and beneath it `Tags item` → `Equal to` → `coach-started`.
> Criterion 3 is the opposite: **`At least one of order / tags`** → `Equal to` → `delivered-manual`.
>
> **What correct looks like on the canvas card:** `Tags is not any of coach-started`.
> If it reads `Tags is equal to coach-started`, that is the `At least one of` rendering.
>
> **But the card lags.** It has been observed still showing the old text *after* the editor showed
> the new operator **and after the "Saved" indicator appeared.** So the two disagreeing does not by
> itself prove anything.
>
> **The decisive check is: reload the page, then read the card.** A fresh load renders the committed
> state. `is not any of` → correct and saved. `is equal to` after a reload → genuinely inverted.
>
> ### What getting criterion 2 backwards actually does
>
> `At least one of tags = coach-started` requires the lock tag to **already be present** — but
> `coach-started` is only ever added **by these flows**. So:
>
> - **Flow B would fire for nobody, ever.** Every manual delivery silently does nothing.
> - **Flow A would fire only on orders Flow B had already handled** — never on the backstop path it
>   exists for — so every untagged customer gets nothing and every tagged one gets two welcome
>   emails.
>
> Nothing errors. Both workflows run green and take the False branch forever.

> **Also note:** each list criterion has its own **`Add criteria ... for <list> list item`** button
> *inside* the box, separate from the **`Add criteria`** button at the bottom. The inner one adds a
> second test against the *same* list element; the bottom one adds an independent criterion. For
> this build you want the **bottom** one every time.

### Step 4 — The HTTP request, on the True branch

17. On the **True** branch, click **+** → **Action** → search `Send HTTP request` → select it
18. **HTTP method:** `POST`
19. **URL:** the webhook URL from §0.3
20. **Headers:** key `Content-Type`, value `application/json`
21. **Body:** paste this, then fix each `{{ }}` using the picker (step 22)

```json
{
  "event": "book_delivered",
  "source": "shopify_flow_manual",
  "email": "{{order.email}}",
  "first_name": "{{order.billingAddress.firstName}}",
  "last_name": "{{order.billingAddress.lastName}}",
  "phone": "{{order.phone}}",
  "shopify_order_id": "{{order.id}}",
  "shopify_order_number": "{{order.name}}",
  "delivered_at": "{{order.createdAt}}"
}
```

22. **Verify every path against the picker.** Click into the Body field and use the variable
    inserter to confirm each of `order.email`, `order.billingAddress.firstName`,
    `order.billingAddress.lastName`, `order.phone`, `order.id`, `order.name`, `order.createdAt`
    actually exists on this trigger. If a path is not offered, take the nearest one the picker does
    offer and correct this runbook.
23. **`source` stays the literal string `shopify_flow_manual`.** It is the only thing that will tell
    you which path started a trial.
24. **On client error (4XX response):** **Retry**
25. **On server error (5XX or 429 response):** **Retry**

> **Why Retry and not Fail.** A retried delivery reaches a GHL workflow whose `coach_status is
> empty` guard makes the second run a no-op. *Fail* or *Ignore* means one GHL blip silently costs a
> customer their entire trial, with nothing but a run-log line to say so.

### Step 5 — The lock tag, after the request

26. Still on the **True** branch, click **+** *below the HTTP action* → **Action** →
    **Add order tags**
27. **Tags:** `coach-started` (type it, press Enter)

> **The order of steps 17 and 26 is load-bearing.** The request goes first. If the tag were applied
> first and the request then failed, the order would be permanently marked as started with no trial
> behind it — the exact silent failure this design exists to prevent.

28. Leave the **False** branch **completely empty**. That emptiness is the guard, the same way the
    `None` branch is in the GHL workflow.

### Step 6 — Turn it on

29. Click **Turn on workflow**

> **Check:** the workflow header reads **On**. A workflow that is off cannot be run manually either.

### Step 7 — Test it, end to end

30. Place a real order for the bundle — **$29.95**, product `10434147320122`
31. Open the order → **add the tag `delivered-manual`** → **Save**
32. **More actions → Automate with Flow** → select `Book Coach — Trial Start (manual delivery)` →
    **Run workflow**
33. **Apps → Flow → Activity** → open the run.
    - Did it take the **True** branch?
    - Open the HTTP step: **did it return 2xx, and what body did it actually send?** The run log
      shows the real body. **This is the moment an empty `email` becomes visible** — check it before
      anything else.
34. **GHL → Automation → `Book Coach — Delivery → Trial Start` → Execution logs** — did it run the
    full `Fresh - start trial` branch?
35. **GHL → Contacts** — find the new contact. Confirm:
    - `coach_status` = `trial`
    - `coach_trial_started` = today
    - `coach_trial_source` = `shopify_flow_manual`
    - tag `bookcoach-micheal-stickler-active` present *(allow ~12s after the field update — Add Tag
      lands late, and polling too soon reads as failure)*
36. Welcome email arrived?
37. From `../coach-router`: `npm run subs -- --sync` then `npm run subs -- --list`. Is the contact
    entitled? *(KV is eventually consistent — allow ~60s before deciding something is broken.)*
38. **Run the workflow a second time** on the same order → it must take the **False** branch and do
    nothing. That is the Shopify-side lock proving itself.
39. **Text `+1 854 254 5009` from the phone on the order** → the coach replies with no activation
    code.

> **Step 39 is the one that proves both systems are joined.** Everything before it only proves the
> commercial layer talked to itself. If the order carried no phone, this step is expected to fail —
> that reader uses the activation code instead.

40. Refund yourself. Then confirm the trial does **not** restart.

---

## 2. Flow A — the 21-day timer

Only build this once Flow B has passed §1 step 33 — the HTTP action and body are identical, and
there is no point debugging them inside a flow you cannot test on demand.

### Step 1 — Create it

1. **Apps → Flow** → **Create workflow**
2. Rename it **`Book Coach — Trial Start (21-day backstop)`**

### Step 2 — Trigger

3. **Select a trigger** → search `Order paid` → **Shopify → Order paid**

> **`Order paid`, not `Order created`** — settled by Gate B, because payment capture on this store
> is automatic. It means unpaid, authorise-only and fraud-held orders never start a trial, for free.
>
> ⚠ **If payment capture is ever switched to manual, this trigger stops firing and trials silently
> stop starting.** Nothing errors. See [`03-shopify-flows.md`](03-shopify-flows.md) §0.

### Step 3 — The Wait — set it to 5 minutes for now

4. **+** → **Action** → **Wait**
5. Set **5 minutes**

> **Deliberately not 21 days yet.** Building with 21 days means your first end-to-end test finishes
> in October. You will change this at step 14, after the flow has proven itself.

### Step 4 — The condition, after the wait

6. **+** (below the Wait) → **Condition**, group set to **ALL**

| # | Variable | Operator | Value |
|---|---|---|---|
| 1 | `Order → tags` | does not include | `coach-started` |
| 2 | `Order → line items` → **At least one of** → `product → id` | is equal to | `gid://shopify/Product/10434147320122` |
| 3 | `Order → cancelledAt` | **is empty or does not exist** | — |
| 4 | `Order → displayFinancialStatus` | is not equal to | `REFUNDED` |
| 5 | `Order → displayFinancialStatus` | is not equal to | `PARTIALLY_REFUNDED` |
| 6 | `Order → displayFinancialStatus` | is not equal to | `VOIDED` |

7. Build criteria 1 and 2 exactly as in §1 step 3 — the `At least one of` trap is identical.
8. Criteria 3–6 are new and they matter: **without them, a buyer who cancels or refunds on day 2
   gets a welcome email and a coach trial on day 21, for a book they returned.**

> **The condition sits *after* the Wait on purpose.** Flow refreshes workflow data when a wait ends,
> so these criteria read the order as it is on day 21 — not as it was at checkout. That is what lets
> criterion 1 notice that Flow B already started this trial, and criteria 3–6 notice a refund.

### Step 5 — Actions, on the True branch

9. **True** branch → **+** → **Action** → **Send HTTP request**
10. Configure **exactly as §1 step 4**, with **one difference**:
    **`"source": "shopify_flow_backstop"`**

> ### 🚨 Check the HTTP method. It defaults to GET.
>
> **Found on the real Flow A build, 2026-09-15:** the action was configured as
> **`Send HTTP GET request`**. A **GET carries no body**, so GHL would have received an empty
> payload — no email, no name, no phone, no `source`. Either nothing is created, or a contact with
> no email is — and an emailless contact permanently breaks the dedupe guard for that person.
>
> The canvas card does show the method (*"Send HTTP **GET** request to…"*), so this one **is**
> reviewable from the summary. Read it on both flows.
>
> This would have failed 21 days after the first real order, on the path that carries most
> customers, with a green run log and nothing to point at.
11. **On client error (4XX):** Retry. **On server error (5XX or 429):** Retry.
12. **+** below the HTTP action → **Action** → **Add order tags** → `coach-started`
13. Leave the **False** branch empty.

### Step 6 — Turn on, test, then lengthen the wait

14. **Turn on workflow**
15. Place a real order for the bundle. Wait 5 minutes. Do **not** tag it `delivered-manual` — this
    is the backstop path, and it must work with no human involvement at all.
16. Run through §1 steps 33–37, expecting `coach_trial_source` = **`shopify_flow_backstop`**.
17. **Only once that passes:** edit the Wait to **21 days**, save, and **re-check the workflow is
    still On** after the edit.

### Step 7 — Prove the two flows do not double-fire

18. Place one more order. Tag it `delivered-manual` and run **Flow B** on it.
19. Confirm the order now carries `coach-started`.
20. Flow A is still waiting on that same order. When its wait expires it must take the **False**
    branch. *(With a 21-day wait you cannot watch this happen — so do this test while Flow A is
    still at 5 minutes, before step 17.)*

> If both fire, the reader gets two welcome emails. The GHL `coach_status is empty` guard should
> still stop the second trial from starting, so this is the second of two locks, not the only one —
> but a doubled email is visible to the customer and worth catching here.

---

## 2.5 🚨 Troubleshooting: "LOCATION does not have enough funds"

**Seen live on the first real test, 2026-09-15 (order #4217).** Flow's run log showed:

```
This step has errors
Ran into transient error: {"status":422,"response_body":"{\"status\":\"Error: Billing failure\",
\"message\":\"An issue occurred while performing the Billing of this Premium Action:
LOCATION does not have enough funds\"}","verb":"POST", ...
```

### What it is

**The GHL Inbound Webhook is a *Premium Trigger*.** It is metered and billed per execution at
about **$0.01**, drawn from the **sub-account's wallet**. Each sub-account gets **100 free lifetime
executions**; after that, an unfunded wallet means GHL **refuses the request with a 422** and the
workflow never runs.

Every `test-ghl-webhook.ps1` fire since 2026-09-10 spent one of those 100. They are gone.

### The fix

**GHL → the sub-account → Settings → Billing** → add a payment method, fund the wallet, and
**turn on auto-recharge**. Nothing in Shopify needs changing.

### You probably do not need to re-run

The run status reads **Retrying**, not Failed. Flow retries a 4XX for **up to 24 hours** — which is
exactly what the `On client error (4XX response): Retry` setting in §1 step 24 buys. **Fund the
wallet inside that window and the run completes by itself**, the trial starts, and no order is
wasted. Had that dropdown been left on *Fail*, this order would have been spent for nothing.

### ⚠ This is a standing operational dependency, not a one-off

**The entire commercial layer enters through a metered GHL premium trigger.** If the wallet empties:

- every new trial start returns 422
- Flow retries for 24 hours, then gives up
- after that, **a paying customer silently gets nothing**, and the only trace is a Flow run log
  nobody is watching

So auto-recharge is not optional, and a low-balance alarm belongs on the ops list — master plan
phase 9.

> **Note for anyone reading `../../coach-router/plans/to-do.md`:** its *"Zero GHL premium actions"*
> line is true of the **coach-router** side only — the cron reconcile deliberately avoids the
> outbound Webhook action. The **commercial layer** depends on a premium *trigger* by design
> (master plan §2, build step 2, "Option A, Inbound Webhook"). Both statements are correct about
> their own system.

---

## 3. After both are on

- **Check `coach_trial_source` on new contacts daily for the first three weeks.** It is the only
  signal saying which path fired, and the only way to notice one silently failing.
- **Delete any test contacts.** Left in place they are tagged, so the next reconcile grants them a
  real lease.
- **Blank `coach_status` before re-testing an existing contact.** Left set, the guard correctly
  stops every run — which on screen is indistinguishable from a broken workflow.
- Still open, and not solved by any of this: **nobody owns applying `delivered-manual`.** Until
  someone does, Flow B fires for nobody and 21 days is the real trial start for every customer.

---

## 4. Corrections to fold back

If any label in this runbook does not match what you see on screen, **say so and I will correct it
here.** Menu names move between Shopify releases — look for the nearest equivalent rather than
assuming the wrong screen.

### Already corrected, and why each mattered

| Corrected | Was | Why it mattered |
|---|---|---|
| Branch names | THEN / OTHERWISE | Actually **True / False** |
| List operators | ANY / ALL | Actually **`At least one of` / `None of` / `All of`** |
| Product path | `product → id` | Actually **`lineItems_item.variant.product.id`** — through *variant*. And **`Select products`** writes the GID for you, so the GID-vs-`legacyResourceId` trap never arises |
| 🚨 HTTP method | assumed POST once set | **Defaults to GET**, and a GET sends no body. Caught on the real Flow A build |
| Condition summary card | first called "lossy" | It **does** show the qualifier (`is not any of` vs `is equal to`), but it **lags the editor, even past the "Saved" indicator**. Reload the page before trusting it either way |

**The pattern to remember:** every defect found in this build so far — the GET method, the inverted
criterion, the unsaved GHL canvas in phase 1 — looks *finished* from the outside and is wrong
underneath. None produced an error, a warning, or a failed run. The workflow goes green and the
customer gets nothing.

**So review both ways round.** Read the canvas card (it is accurate, and it is where the GET and the
`is equal to` are visible at a glance) **and** open the action to see the fields the card omits
(body, headers, retry settings). And **check the header badge**: a workflow reading **Draft** is not
running at all, and cannot even be triggered manually.
