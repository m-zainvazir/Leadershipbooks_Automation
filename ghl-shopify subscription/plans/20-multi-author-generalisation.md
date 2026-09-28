# Plan 20 — one system, many authors

**Created:** 2026-09-21 · **Owners:** C (Worker + registry), M (GHL / Shopify / Zipify / Course360)
**Parent:** [`00-master-plan.md`](00-master-plan.md) · **Supersedes as the build plan:**
[`02-multi-coach-scaling.md`](02-multi-coach-scaling.md) §2–§6
**Scope:** the whole commercial journey — Zipify landing page → order → trial start → day 7/9/10 →
expiry — made variable per author.

> **`02-multi-coach-scaling.md` is not replaced, it is executed.** It made the two decisions this
> plan depends on and proved the one that matters with a live test. Read its §3 and §4a before
> building anything here. Where this plan differs from it, the difference is called out and
> justified — there are three, all in §2.3, §6 and §4.8.

---

## 0. What this plan is, and what it is not

**It is:** the design and build order for turning a system that works for exactly one author into
one that takes an author as an argument.

**It is not:** a rewrite. The commercial layer is proven end to end for Micheal Stickler — book
sells, trial starts, day 7/9/10 fire, trial expires, purchase converts, cancellation revokes. Every
one of those is proven by a real run. **Nothing in this plan changes what happens to a reader.** It
changes only *where the author-specific values come from*.

**The one-sentence version:** stop writing the author's name into fifteen places, and start reading
it out of `coaches.json`.

### The constraint that shapes everything

**Read this before proposing any alternative.** GHL accepts merge-field syntax in `Add Tag` and
never interpolates it. Proven live 2026-09-12: setting the tag to `{{contact.coach_tag}}` produced
a contact carrying the **literal string** `"{{contact.coach_tag}}"` as a real tag. No error, no
warning, workflow green, nobody granted anything. Full evidence:
[`02-multi-coach-scaling.md`](02-multi-coach-scaling.md) §3.

That single fact rules out the obvious design — one GHL workflow that tags whichever coach the
payload names — and it is why the Worker ends up owning the tag. Everything in §2 follows from it.

---

## 1. Separate what multiplies from what only looks like it does

Restated from `02` §1 with the 2026-09-21 numbers, because the verdicts have changed now that the
Stickler build is finished and we know what each step actually cost.

| Per author | Real cost, once | Recurring cost | Verdict |
|---|---|---|---|
| Voiceflow project + knowledge base | days | — | **Unavoidable. It is the product.** |
| Book cover, testimonials, page copy | hours | — | Unavoidable — marketing input, not engineering |
| Zipify landing page | ~30 min from a template | — | Cheap, templated (§4.1) |
| Coach page on `book-coach.ai` | ~10 min | — | Cheap, templated |
| Shopify bundle product | ~10 min | — | Unavoidable — it is the thing sold |
| GHL tag | ~30 s | — | Trivial |
| GHL $59 product + price | ~2 min | — | Cheap. **Required** — it is the `ghlProductId` match key |
| `coaches.json` entry | ~2 min | — | **Already solved.** `npm run push`, live in ~60 s, no deploy |
| Course360 course + Offer | ~5 min | — | ⚠ **Eliminated entirely by §4.6.** Do not build fifteen |
| **GHL trial workflow** | ~1 h | **every future copy change × N** | 🚨 **The real cost. §4.5 removes it.** |
| **Shopify Flow** | ~30 min | **every future logic change × N** | 🚨 **The real cost. §4.3 removes it.** |

The top eight are **create-once** costs. Fifteen of them is a long afternoon, and no amount of
engineering makes writing fifteen Voiceflow projects cheaper.

The bottom three are **maintenance** costs, and they are the only things worth engineering away.
Fifteen copies of one workflow means every future change to the welcome email, the trial length, the
day-7 price or the expiry logic is fifteen edits — and the failure mode is not an error, it is
**silent drift**, where author #9 keeps sending last quarter's price because someone missed one.

> **The test for every decision in this plan:** does adding author #16 require editing anything
> other than `coaches.json`, one Zipify page, one Shopify product, one GHL product and one Voiceflow
> project? If yes, it is not done.

---

## 2. The two decisions that drive everything else

### 2.1 GHL cannot template a tag — settled, do not re-test

See §0. Proven 2026-09-12. The same limitation applies to **`Remove Tag`**, which matters in §4.8
and which nobody has had reason to test because there has only ever been one tag to remove.

> ⚠ **Assume `Remove Tag` behaves identically until proven otherwise.** It is the same field widget
> in the same builder. If a future session tests it and finds merge fields *do* work there, that
> changes §4.8's cost comparison but not its recommendation — and the result must be written down
> either way, because an untested assumption in this position is exactly what cost four days on the
> Flow A wait.

### 2.2 Therefore the Worker owns the tag — and that is a feature

`02` §3 chose "Fallback A — the Worker does the tagging" for this reason. That decision stands, and
a year of building has made it look better rather than worse:

- The Worker **already holds the registry** — mapping a Shopify product to a coach is what
  `coaches.json` exists for.
- It **already holds the GHL token** with contacts scope, and already writes contacts on the
  reconcile path.
- It **already has HMAC verification** for `/twilio/*`, so a signed Shopify webhook is the same
  pattern, not a new one.
- It **already has idempotency and guard machinery** — the majority guard, the abort-before-write
  rule, the lease model.
- It **retires the premium GHL Inbound Webhook** (~$0.01/execution, and the thing that silently
  took the whole system down on 2026-09-15 when the wallet emptied). A Contact Tag trigger is free.

> **One thing to clear up before anyone objects.** `coach-router/plans/06-shopify-tag-automation.md`
> §4 describes this exact endpoint and is stamped **"Option B — REJECTED"**. That rejection was
> about **where the $59 coach subscription is sold** — decided 2026-08-28 as GHL, not Shopify — and
> it is still correct. It was never a rejection of using a Shopify webhook to **start a trial from a
> book order**, which is a different event entirely. `02` §3 adopted the design for that purpose.
> **Read `plans/06` §4 as the spec it is, not as a dead end.**

### 2.3 The change from `02`: the Worker owns tag *removal* too

`02` §3 left this open — *"Day-10 revoke then also belongs to the Worker: the workflow removes
`coach-trial-started` and calls the Worker, or the Worker reads `coach_status` itself. Decide when
building."*

**Decided here: the Worker owns expiry.** Reasoning and the cost of the alternative are in §4.8.
The short version is that §2.1 applies symmetrically — if GHL cannot template `Add Tag` it almost
certainly cannot template `Remove Tag`, so a GHL-owned day 10 needs an N-way branch whose only job
is to pick a tag. Putting both ends in the Worker means the tag is written and removed by the same
component, from the same registry, and GHL never names a coach-specific string at all.

**The seam stays exactly as thin as the master plan promises.** It just moves: System B (GHL) owns
*copy and timing*; System A (the Worker) owns *entitlement state*. One tag still joins them.

---

## 3. Target architecture

```
  ZIPIFY (leadershipbooks.com)              one page per author, from one template
  /pages/<book-slug>-ai-coach               varies: title, author, cover, product id
        |  Add to Cart -> Shopify bundle product for THAT author
        v
  SHOPIFY                                   one bundle product per author
        |
        |  Flow A (Order paid -> wait 21d -> guard)        <-- ONE flow, no product condition
        |  Flow B (Order created + delivered-manual)       <-- ONE flow, no product condition
        |
        |  POST, HMAC-signed, whole order payload
        v
  +--------------------------------------------------------------+
  |  WORKER   POST /shopify/order                    NEW, §4.4    |
  |                                                              |
  |  1. verify HMAC          2. idempotent on order id           |
  |  3. map line items -> coaches via coaches.json               |
  |  4. upsert GHL contact   5. write per-coach trial record      |
  |  6. add  <coach>.ghlTag  +  coach-trial-started              |
  +--------------------------------------------------------------+
        |                                          |
        |  tag: coach-trial-started                |  tag: bookcoach-<author>-active
        v                                          v
  GHL WORKFLOW  (ONE, generic)              +--------------------------+
  trigger: Contact Tag added                |  ENTITLEMENT             |
  - welcome email    {{coach_name}}          |  read by the 15-min cron |
  - wait 7d -> day 7 email                  |  -> 48h renewable lease  |
  - wait 2d -> day 9 email                  |  -> web / SMS / voice    |
  - wait 1d -> day 10 email  ONLY           +--------------------------+
  - removes  coach-trial-started                        ^
    (never a coach tag)                                 |
                                                        |
  WORKER CRON  */15                                     |
  sweeps  trial:<contactId>:<code>  past expiry  -------+
  removes that coach's ghlTag, sets coach_status         §4.8
```

**What changed versus today, in one line each:**

| Today | Target |
|---|---|
| Flow conditions name product `10434147320122` | Flows forward every order; the Worker decides |
| GHL Inbound Webhook (premium, wallet-dependent) | Contact Tag trigger (free) |
| `Add Tag` is the literal `bookcoach-micheal-stickler-active` | Worker adds it from the registry |
| Day 10 `Remove Tag` is that same literal | Worker cron removes it from the registry |
| Emails name Michael Stickler and his book | Emails read `{{contact.coach_name}}` etc. |
| One Course360 course + Offer per author | One "My Coaches" page, one Offer, for everyone |
| `coach_status` is one scalar per contact | Per-coach `trial:` records in KV; `coach_status` becomes a display field |

---

## 4. The journey, step by step, made variable

### 4.1 Zipify landing page — owner M

One page per author, cloned from a template. **This is unavoidable and cheap**; the point is to make
the variable set explicit so a clone is a fill-in-the-blanks job rather than a hunt.

| Variable | Stickler's value | Where it comes from |
|---|---|---|
| Book title | `Life Without Reservation` | the book |
| Author display name | `Michael Stickler` | ⚠ note the spelling — see the trap below |
| Book cover image | Shopify CDN asset | the book |
| Page slug | `life-without-reservation-ai-coach` | convention: `<book-slug>-ai-coach` |
| **Shopify product id** | `10434147320122` | the bundle product (§4.2) |
| **Shopify variant id** | `54042631733562` | the bundle product (§4.2) |
| Price | `$29.95` | per-book decision |
| Coach continuation price | `$59/month` | shared today; keep shared until there is a reason not to |
| $59 funnel URL | `…/michael-stickler-coach-access` | `coaches.json` `landingPageUrl` (§4.9) |

**Template rules, so clones do not inherit defects:**

1. 🚨 **Clone from a designated clean master, never from a live author's page.** Both live-page
   defects found on 2026-09-17 — a payment button selling the decoy product, and the page promising
   *Invisible to Viral* while checking out *Life Without Reservation* — were **inheritance bugs**
   from a half-copied predecessor. Cloning a page that has an author's name in twelve places is how
   you get author #3's page selling author #1's book.
2. **Nominate the master and freeze it.** Once the Stickler page is fully clean (the
   `AI Publishing Coach` ×12 rename is still parked — [`11-parking-lot.md`](11-parking-lot.md)),
   duplicate it once as `_TEMPLATE — coach bundle landing`, strip every author value to a visible
   placeholder like `{{BOOK_TITLE}}`, and clone *that* forever.
3. **Placeholders must be ugly on purpose.** A leftover `{{BOOK_TITLE}}` is a caught bug; a leftover
   "Life Without Reservation" on author #7's page is a shipped one.

> **Verify by:** for every new page, `curl -s <url> | grep -c "<previous author's surname>"` must
> return `0`, and `grep -o '10434147320122\|<new product id>'` must show **only** the new id. This
> is the check that would have caught both 09-17 defects on the day they were published.

> ⚠ **The `Micheal` / `Michael` split is deliberate and must survive.** `coaches.json` carries
> `"name": "Micheal Stickler"` (as the author spells it) and the customer-facing pages say
> `Michael`. Both are live match keys in their own systems. **Do not normalise them.** For every new
> author, record the internal spelling and the display spelling separately in the registry — see
> §5's `displayName`.

### 4.2 Shopify — owner M

One bundle product per author. **No Flow changes, ever** (that is §4.3's whole point).

| Field | Rule |
|---|---|
| Title | `<Book Title> + Your Personal AI Coach` |
| Price | per book; Stickler is $29.95 |
| `requires_shipping` | **`true`** — it is a physical book |
| **SKU** | set it. Convention `BC<ISBN>`, e.g. `BC9781951648213` |
| **Weight** | set it. Stickler's is `0`, which breaks carrier-calculated rates |
| Collection | 🆕 **add to a collection named `coach-bundles`** |
| Storefront visibility | published |

**The `coach-bundles` collection is insurance, not the mechanism.** §4.3 forwards every order to the
Worker and lets the registry decide, so no Flow condition needs it. Keep the collection anyway: it
is the human-readable answer to "which products start a trial", it is one click per product, and it
is the fallback if §4.3's gate fails (§10, gate 1).

> ⚠ **`sku: null` and `weight: 0` are cosmetic today only because every condition keys on product
> id** ([`11-parking-lot.md`](11-parking-lot.md)). At N authors, a catalogue where half the bundles
> have SKUs and half do not is how someone eventually writes a SKU-based rule and it half-works.
> Set both from author #2 onward, and backfill Stickler when convenient.

### 4.3 Shopify Flow — owner M — **two flows total, for all authors**

**The generalisation:** delete the product condition. Forward every order. Let the Worker decide.

This is the single highest-leverage change in the plan, because it means **the Shopify → author
mapping exists in exactly one place** — which is precisely what `02` §5 demanded and what a set of
per-author Flow conditions would violate.

#### Flow A — the 21-day backstop (one, for all authors)

| Step | Config | Change from today |
|---|---|---|
| Trigger | `Order paid` | unchanged |
| Action 1 | **Wait 21 days** | unchanged — ✅ confirmed 21 days, 2026-09-17 |
| Condition | `cancelledAt` is empty **AND** `displayFinancialStatus` not in `REFUNDED` / `PARTIALLY_REFUNDED` / `VOIDED` **AND** order tags do not contain `coach-started` | 🆕 **the product check is gone** |
| Action 2 | `Send HTTP request` → `POST <worker>/shopify/order`, `source: shopify_flow_backstop` | 🆕 new URL, full order payload |
| Action 3 | `Add order tags` → `coach-started` | unchanged |

#### Flow B — the manual accelerator (one, for all authors)

| Step | Config | Change from today |
|---|---|---|
| Trigger | `Order created` | unchanged |
| Condition | order tags contain `delivered-manual` **AND** do not contain `coach-started` | 🆕 **the product check is gone** |
| Action 1 | `Send HTTP request` → same endpoint, `source: shopify_flow_manual` | 🆕 |
| Action 2 | `Add order tags` → `coach-started` | unchanged |

**Fired by hand from the order:** More actions → Automate with Flow → Run workflow. There is no
`Order tags added` trigger in Shopify Flow — verified 2026-09-13, and the full trigger list is in
[`03-shopify-flows.md`](03-shopify-flows.md).

#### Why forwarding non-coach orders is safe

The location takes **3,463 orders**, of which 99 of the newest 100 are ordinary Shopify book sales
(master plan §2). So Flow A will now call the Worker on essentially every order the business takes.

That is fine, and deliberately so:

- The Worker's step 3 finds **no line item matching any `shopifyProductId`** and returns `200` with
  `matched: 0`, having written nothing. Fails closed, exactly like a coach with no `ghlTag`.
- It costs one Worker request, which is free at this volume, against a Cloudflare free tier whose
  scarce resource is **writes**, not reads — and a non-match performs zero writes.
- It removes the entire class of bug where someone adds an author, forgets the Flow condition, and
  the trial silently never starts. **The mapping cannot drift if there is only one copy of it.**

> 🚨 **The order of Action 2 and Action 3 in Flow A is load-bearing and must not be swapped.** The
> HTTP request comes **before** the `coach-started` tag. Tag first, and if the request then fails,
> the order is permanently marked as handled and that reader never gets a trial — with no error
> anywhere. This trap is recorded in [`03-shopify-flows.md`](03-shopify-flows.md) and it survives
> the generalisation unchanged.

> 🚨 **`Send HTTP request` defaults to GET, and a GET sends no body.** Found on the real Flow A
> build, 2026-09-15 ([`04-phase-2-build-runbook.md`](04-phase-2-build-runbook.md)). Set POST
> explicitly and confirm it after saving.

#### Payload — send the order, not a summary

Today's Flow sends a flattened, hand-mapped payload because GHL's field mapper needed one. The
Worker needs no such thing, so send what Shopify already has:

```json
{
  "source": "shopify_flow_backstop",
  "order_id": "gid://shopify/Order/7521018609978",
  "order_number": "#4217",
  "email": "reader@example.com",
  "phone": "+15551234567",
  "first_name": "Jane",
  "last_name": "Doe",
  "ordered_at": "2026-09-15T12:38:23Z",
  "line_items": [
    { "product_id": "10434147320122", "variant_id": "54042631733562", "quantity": 1 }
  ]
}
```

> ⚠ **`order.email`, never `order.customer.email`.** `order.customer` is null on guest checkouts
> with accounts off and after a GDPR erasure. Email is GHL's dedupe key, so an empty one creates an
> un-deduplicable contact and permanently breaks the one-trial guard for that person. Names likewise
> from `order.billingAddress`. Verified on order #4217 — `order.email` resolves and
> `order.customer.email` was never needed.

### 4.4 `POST /shopify/order` — owner C — **the new endpoint**

Spec'd in `coach-router/plans/06` §4; this is that spec, updated for what the Worker has learned
since and for per-coach trial state. **It does not exist yet** — confirmed 2026-09-21, the Worker
has exactly one occurrence of the string `shopify` and no `/shopify` route.

```
POST /shopify/order
X-Shopify-Hmac-Sha256: <base64 HMAC-SHA256 of the raw body>
```

| # | Step | Detail |
|---|---|---|
| 1 | **Verify HMAC** | HMAC-SHA256 of the raw body, base64, against `SHOPIFY_WEBHOOK_SECRET`. Reject unsigned or mismatched with `403`. **This endpoint creates GHL contacts** — an open version lets anyone forge subscribers and grant themselves a coach. Mirror `validateTwilio`'s constant-time compare. |
| 2 | **Idempotency** | `shop:<order_id>` in KV, TTL 30 days. Already present → return `200` immediately, write nothing, log it. Shopify retries on any non-2xx and can deliver twice. |
| 3 | **Map line items → coaches** | For each `line_items[].product_id`, look up `shopifyProductId` across the registry. Collect the matched coaches. **No match → return `200` with `matched: 0` and write nothing.** |
| 4 | **Upsert the GHL contact** | By email. Exists → reuse it. Does not exist → create with email, name, and phone if the order carried one. |
| 5 | **Trial guard, per coach** | For each matched coach: if a `trial:<contactId>:<code>` record exists **or** the contact already holds that coach's `ghlTag`, skip that coach. This is the per-coach equivalent of the `coach_status is empty` guard. |
| 6 | **Write the trial record** | `trial:<contactId>:<code>` = `{ startedAt, expiresAt, source, orderNumber }`, where `expiresAt` = now + `trialDays` (§5). **No TTL** — the record *is* the queue, exactly like `arch:`. |
| 7 | **Add the tags** | The coach's `ghlTag` (entitlement) **and** the generic `coach-trial-started` (the GHL workflow's trigger). |
| 8 | **Write the display fields** | `coach_code`, `coach_name`, `coach_book_title`, `coach_link`, `coach_landing_url`, `coach_status: trial`, `coach_trial_started`, `coach_trial_source`, `shopify_order_number` (§4.5). |
| 9 | **Return `200` fast** | GHL calls go in `ctx.waitUntil()`. Shopify's webhook timeout is short and a slow GHL must never cause a retry storm. |

**Order of operations inside step 7 matters.** Write the trial record (step 6) **before** adding the
tag (step 7). If the process dies between them, the reader has a tag with no expiry record — which
the §4.8 sweep cannot see, so they keep access forever. The other order fails safe: an expiry record
with no tag expires harmlessly.

| Risk | Guard |
|---|---|
| Forged webhook creating fake subscribers | HMAC-SHA256, reject on mismatch |
| Shopify retry granting twice | `shop:<order_id>` idempotency key |
| Slow GHL causing retry storms | Return `200` immediately, GHL work in `waitUntil()` |
| One order containing two authors' bundles | Loop every line item, grant every match — this is correct and must be tested |
| Ordinary book orders hitting the endpoint | No product match → `200`, logged, zero writes |
| A wrong `shopifyProductId` silently granting nothing | `seed-coaches.mjs` validates the format; `npm run subs -- --list` shows it |
| Buyer's email differs from their Course360 login | They can still activate by texted code, but the tag lands on the wrong contact. Known, unchanged from today, out of scope here |
| Tag added but no expiry record | Step 6 before step 7 (above) |

> **Tests to write alongside it**, matching the existing suite's style: bad signature → `403` and no
> writes; duplicate order id → `200` and zero writes; two coach bundles in one order → two tags, two
> trial records; a non-coach order → `200`, `matched: 0`, zero writes; a GHL failure mid-flight →
> aborts before any tag is added.

### 4.5 The GHL trial workflow — owner M — **one, for all authors**

**Trigger changes from Inbound Webhook to `Contact Tag` added = `coach-trial-started`.** Free
trigger, no wallet dependency, and the premium-trigger failure that took the system down on
2026-09-15 stops being possible.

The workflow's job shrinks to **copy and timing**. It never names a coach.

| # | Action | Detail |
|---|---|---|
| 1 | *(no create contact)* | The Worker already created it |
| 2 | *(no trial guard)* | The Worker's step 5 already guarded, per coach |
| 3 | *(no field writes)* | The Worker's step 8 already wrote them |
| 4 | **Welcome email** | Reads `{{contact.coach_name}}`, `{{contact.coach_book_title}}`, `{{contact.coach_link}}` |
| 5 | **Wait 7 days** | unchanged |
| 6 | **Day 7 offer email** | guarded on `Coach Status is trial` |
| 7 | **Wait 2 days** | unchanged |
| 8 | **Day 9 reminder email** | guarded on `Coach Status is trial` |
| 9 | **Wait 1 day** | unchanged |
| 10 | **Day 10 email only** | guarded on `Coach Status is trial`. 🆕 **No `Remove Tag`, no field write** |
| 11 | **Remove Tag `coach-trial-started`** | so the contact can be re-enrolled by a future purchase |

**The guard direction stays `is trial`, never `is not active`.** `is trial` fails toward *keeping*
access: an unexpected value means no sales email and no expiry. `is not active` fails toward cutting
off a payer. Over-granting costs money; cutting off a payer costs a refund, a chargeback and a
support thread. This reasoning is from [`05-phase-4-trial-expiry.md`](05-phase-4-trial-expiry.md)
and it does not change.

#### Custom fields — create once, serve every author

Existing, keep as they are:

| Field | Key | Id |
|---|---|---|
| Coach Status | `coach_status` | `cAL8RHFCFUgPRA9gZjsx` |
| Coach Trial Started | `coach_trial_started` | `JJoM2V52xXLZqyNm5tOK` |
| Coach Trial Source | `coach_trial_source` | `kBxKqY1tUGc6waAjcONz` |
| Shopify Order Number | `shopify_order_number` | `818JeImrO5OKspBYkI8S` |

New, needed by the generic emails:

| Field | Key | Holds | Type |
|---|---|---|---|
| Coach Code | `coach_code` | `1042` | text |
| Coach Name | `coach_name` | `Michael Stickler` — the **display** spelling | text |
| Book Title | `coach_book_title` | `Life Without Reservation` | text |
| Coach Link | `coach_link` | that author's Course360 lesson URL | text |
| Coach Landing URL | `coach_landing_url` | that author's $59 funnel page | text |

> **`coach_tag` is deliberately NOT in this list.** `02` §2 proposed it, for a design where GHL
> applied the tag. The Worker applies it now, so a `coach_tag` contact field would be a second copy
> of a registry value with nothing reading it — the exact drift surface this plan exists to remove.

> ⚠ **These are display fields, and at two concurrent trials they hold the most recent author only.**
> That is a real limitation with a real consequence for email copy. It is §6, and it is the one
> genuinely hard problem in this plan.

#### The email swap list — every hardcoded string, in one pass

From `02` §2, re-verified against the built emails:

| Where | Hardcoded now | Becomes |
|---|---|---|
| Welcome email | `Michael Stickler's work` | `{{contact.coach_name}}'s work` |
| Welcome email | the Course360 lesson URL | `{{contact.coach_link}}` |
| Day-7 email, "What you keep" | `Michael Stickler's work` | `{{contact.coach_name}}'s work` |
| Day-9 email, "What you keep" | `Michael Stickler's work` | `{{contact.coach_name}}'s work` |
| Day-9 email, sign-off | `reading Life Without Reservation` | `reading {{contact.coach_book_title}}` |
| Day-10 email, sign-off | `reading Life Without Reservation` | `reading {{contact.coach_book_title}}` |
| Day-7/9/10 CTA link | `…/michael-stickler-coach-access` | `{{contact.coach_landing_url}}` |
| All five emails | `+1 854 254 5009` | **stays literal** — one number serves every author |
| All five emails | the `From` address on the verified sending domain | **stays literal** — do not touch; it is what makes DMARC pass |

🚨 **Do all of these in one pass.** Partial renames are how this project ended up with five
spellings of its own product name in circulation at once. A half-swapped email set is worse than an
unswapped one, because it looks done.

> **Verify by:** fire a test order for author #2 and read the *delivered* emails, not the templates.
> A merge field that resolves to an empty string renders as a blank space, not as an error — so
> `{{contact.coach_name}}'s work` on a contact with no `coach_name` silently sends *"'s work"*.
> Check every one of the five.

### 4.6 Course360 — owner M — **kill the per-author course**

`02` §4 identified `Grant Offer` as the action least likely to accept a merge field, because it
resolves an offer id rather than free text. That is still true, and the answer is not to branch N
ways — it is to stop needing it.

**One "My Coaches" page replaces all N courses.** A single members page, granted by a single Offer
to everyone, which asks the Worker which coaches this contact is entitled to and renders a link for
each.

This works because the Worker already computes exactly that. `codesForContact(env, contactId, tags)`
returns the entitled coach codes for a contact, as the **union** of the published `centitle:` map
and a live tag read — and it is already what `/api/bind/mint` and `/api/web/session` use.

**Confirmed safe to collapse:** the other lessons in each course (`Lesson 1: The What`, `The Why`,
`The How`) are **template filler, not author-specific content** — Muhammad, 2026-09-12. Nothing of
value is lost.

**Cost:** one page, plus a small Worker endpoint (`GET /api/my-coaches`, or extend
`/api/bind/status`). **Saves:** N courses, N offers, and the only workflow action that resists going
generic.

**It also composes with master-plan phase 6.** Once the coach page is gated by session token, the
members page is the natural place to mint that token.

> ⚠ **The activation UI must stay on the coach page, not the lesson.** The Course360 lesson editor
> strips `<script>` **and** `<button>`, and both failure modes look installed. `members-activation.html`
> is superseded; do not install it. The lesson contributes exactly one thing: the coach iframe with
> `?cid={{contact.id}}&em={{contact.email}}` appended.

### 4.7 Days 7 / 9 / 10 — no structural change

The waits, the guards and the three emails are already generic in shape and proven end to end on
2026-09-18. Only the copy changes (§4.5's swap list), and only day 10 changes behaviour — it loses
its `Remove Tag` and its field write to §4.8.

### 4.8 Expiry — the Worker sweeps, GHL just emails

**This is §2.3's decision, and here is the arithmetic behind it.**

| | Option 1 — GHL owns expiry | Option 2 — Worker owns expiry ← **chosen** |
|---|---|---|
| Day-10 tag removal | N-way If/Else on `coach_code`, each branch a literal `Remove Tag` | one cron sweep over `trial:` records |
| Adding author #16 | edit the workflow, add a branch, republish | `coaches.json` + `npm run push` |
| Concurrent trials (§6) | impossible — one workflow enrolment per contact | natural — one record per contact per coach |
| Proven today? | ✅ yes, for N=1 | ⬜ no — new code |
| Failure mode | a missing branch expires nobody, silently, forever | a broken cron is already alarmed by `/health` |
| Depends on | `Remove Tag` accepting a literal (fine) and someone remembering the branch | the cron, which already carries revocation and is already monitored |

Option 1's failure mode is the one this project keeps getting bitten by: **silent, and invisible
until a customer is affected.** A forgotten branch means author #12's trials never end, which looks
exactly like nothing being wrong.

#### The sweep

Add to the existing `*/15` cron, after the reconcile:

```
for each  trial:<contactId>:<code>  where  expiresAt <= now:
    remove that coach's ghlTag from the contact
    if the contact holds no other bookcoach-*-active tag:
        set coach_status = expired
    delete the trial: record
```

- **It reuses the cron that already exists**, which already carries revocation and trial-relevant
  work, and which `/health` already alarms on via `cronStaleAfterMinutes: 90`.
- **Revocation still lands within 15 minutes**, which is the system's contract everywhere else.
- **`coach_status` is only set to `expired` when the *last* trial ends.** A reader mid-trial on
  author #2 must not read `expired`, or the day-7/9 guards would stop their second sequence.

> 🚨 **This sweep removes tags, so it needs the same guards as the reconcile, and for the same
> reason.** A GHL API failure must abort before any write — an empty result set is indistinguishable
> from "everyone churned". And it needs a **majority guard measured against its own population**:
> the existing guard is computed over `sub:` leases, and with `autoLinkGhlPhone: false` most
> entitled contacts have no lease at all, so that guard is already looking at a near-empty set. This
> is the exact trap that was caught by a test — not in production — when the `centitle:` map was
> added on 2026-09-17, and it will recur here verbatim if it is not designed in.

> ⚠ **`trial:` records must not have a KV TTL.** The record *is* the queue, exactly like `arch:`. A
> TTL would delete the expiry instruction before the sweep could act on it, and the reader would
> keep access forever.

### 4.9 The $59 conversion — owner M — per author, and it must be

| Thing | Per author? | Why |
|---|---|---|
| GHL product + price | **yes** | `ghlProductId` is the reconcile's match key. One shared product would grant every coach to every subscriber |
| Funnel page | **yes**, from a template | needs the author's name, book and price block |
| Purchase workflow | **one** | 🆕 see below |
| Cancellation workflow | **one** | 🆕 see below |
| Stripe portal | **one** | already shared, already live |

**Today both workflows are filtered on Stickler's product and price**, and both add or remove his
literal tag. At N authors that is 2N workflows — the same trap as §4.5, and it has the same answer.

**The generalisation is the same shape:** the purchase and cancellation workflows stop naming a
product or a tag, and the Worker does the entitlement part from the subscription record it already
reads.

- **Purchase** — the Worker's reconcile **already grants on an active subscription** by matching
  `ghlProductId` and already publishes `centitle:<contactId>`. So a paying subscriber for *any*
  author is already entitled without any workflow touching a tag. The ACTIVE string is **`active`**,
  observed 2026-09-19. The workflow's remaining job is the post-purchase email and
  `coach_status: active` — both generic.
- **Cancellation** — already automatic. The lease decays and revocation lands within 15 minutes,
  with no GHL trigger required. That was the whole justification for the lease design.

> ⚠ **One thing that does not generalise for free: `Grant Offer` on the purchase workflow.** It
> closed the cold-buyer hole on 2026-09-18 by granting the Course360 offer to a $59 buyer who never
> had a trial. Under §4.6 there is only one Offer, so this action becomes generic too — **but only
> once §4.6 ships.** Until then it is per-author and it is the second reason to do §4.6 early.

> ⚠ **The decoy product is still live.** `6a9978eea94350eafc0958c3` (`BookCoachAI - Monthly
> (Standard)`) charges $59/month recurring and grants nothing, because no coach's `ghlProductId`
> matches it. It was linked from the landing page until 2026-09-17. **At N authors, keep a
> deliberate list of which GHL products are real**, or this happens again to an author nobody is
> watching.

---

## 5. The registry — `coaches.json` as the single source of truth

Every author value lives here and nowhere else. Adding an author is one object plus `npm run push`.

```json
{
  "code": "1042",
  "name": "Micheal Stickler",
  "displayName": "Michael Stickler",
  "bookTitle": "Life Without Reservation",
  "aliases": ["Micheal Stickler", "Michael Stickler", "Mike Stickler", "Stickler"],

  "projectID": "6a52da46bc446f70628c598c",
  "versionID": "main",
  "vfKey": "VF.DM.…",
  "voiceMode": "inline",
  "ttsVoice": "Polly.Matthew-Neural",

  "ghlTag": "bookcoach-micheal-stickler-active",
  "ghlProductId": "6a9185da778550cdf732a700",
  "shopifyProductId": "10434147320122",
  "landingPageUrl": "https://www.book-coach.ai/michael-stickler-coach-access",
  "courseLessonUrl": "https://login.leadershipbookspublishers.com/courses/products/d818952a-…",

  "trialDays": 10
}
```

**New keys, and what each is for:**

| Key | Needed by | Note |
|---|---|---|
| `displayName` | §4.1, §4.5 | the customer-facing spelling. Keeps `Micheal`/`Michael` from being "fixed" |
| `bookTitle` | §4.5 emails | populates `coach_book_title` |
| `shopifyProductId` | §4.4 step 3 | **the mapping key.** Chosen over handle or URL because it is what Shopify sends and it survives a rename |
| `courseLessonUrl` | §4.5 emails | populates `coach_link`. `02` §5 asked for this |
| `trialDays` | §4.4 step 6, §4.8 | default `10`; per-author override without a code change |

**All of them must be added to `KV_FIELDS` in `lib-config.mjs`** (currently: `name`, `aliases`,
`projectID`, `versionID`, `keyVar`, `heygenAvatarID`, `heygenVoiceID`, `voiceMode`, `dialNumber`,
`ttsVoice`, `ghlTag`, `ghlProductId`, `landingPageUrl`). **Anything not named there is silently
dropped on seed** — so a key added to `coaches.json` and forgotten in `KV_FIELDS` looks configured
and does nothing. That is the same class of failure as the merge-field trap.

**Validation to add to `seed-coaches.mjs`**, which already checks `ghlProductId` is 24 hex and
`landingPageUrl` is https:

| Rule | Why |
|---|---|
| `shopifyProductId` is all digits | Shopify ids are numeric; a GID (`gid://shopify/Product/…`) pasted here silently matches nothing |
| `ghlTag` matches `^bookcoach-[a-z0-9-]+-active$` | keeps the namespace predictable |
| 🚨 **`ghlTag` must not start with `shopify_`** | GHL is mirroring Shopify order tags onto contacts as `shopify_<tag>` — contact `Qu5bpryFoyfsgcfliC2k` carries `shopify_delivered-manual`, written by no part of this project. **The GHL tag namespace is not ours alone.** A collision would hand entitlement to an order tag |
| `ghlTag`, `shopifyProductId`, `ghlProductId`, `code` are **unique across coaches** | two authors sharing any of them cross-grants entitlement. At N=1 this is unthinkable; at N=15 it is a copy-paste away |
| `courseLessonUrl` is https and not an `app.coursecreator360.com` URL | that is the course *builder*, returns 404 for members. Also strip `is_preview=true` |
| `trialDays` is 1–90 | Shopify Flow's `Wait` caps at 90 days per workflow |
| warn if `shopifyProductId` is absent | that author can never be granted by purchase. Fails closed, like `ghlTag` |

> **`npm run push` is seed + secrets, live in ~60 s, no deploy.** Each author also needs
> `VF_KEY_<CODE>` as a Worker secret — `sync-secrets.mjs` handles it from `vfKey`.

---

## 6. The hard problem — one reader, two authors

**This is the only part of the plan I am not confident about, and it is worth saying so plainly
rather than burying it in a table.**

`02` §5 raised it as a consequence to decide. At N=1 it is hypothetical. At N=15, a reader buying a
second Leadership Books title is a *good customer* — and the system currently degrades their
experience in three separate ways.

### What breaks, precisely

| # | Breakage | Severity |
|---|---|---|
| 1 | **`coach_status` is one scalar.** Two concurrent trials cannot both be represented | ✅ **solved by §4.8** — per-coach `trial:` records in KV. `coach_status` demotes to a display field |
| 2 | **The display fields hold the most recent author only.** `coach_name`, `coach_book_title`, `coach_link` get overwritten by the second purchase — so the *first* author's day-7 email arrives naming the *second* author's book | 🚨 **unsolved** |
| 3 | **SMS and voice degrade.** With one entitled coach, a reader texts anything and their coach answers — the input is never consulted. With two, they must name the author or get *"I could not tell which coach you meant"* | 🟠 **inherent, needs copy not code** |

### Breakage 2 is the real one

Confirmed against the Worker source: `resolveEntitledCoach(env, input, codes)` drives routing, and
the single-entitlement short-circuit is deliberate — it is the actual security boundary, because
with one code the input is never read, so knowing another author's code cannot route anywhere.

But the **GHL emails** have no such mechanism. A GHL workflow enrolment reads contact fields at send
time, so two overlapping enrolments read the same overwritten scalars.

**Three ways out, none free:**

| Option | How | Cost | Verdict |
|---|---|---|---|
| **A — one trial at a time** | The Worker's step 5 refuses a second concurrent trial. The second author's trial *starts when the first ends*, granted by the §4.8 sweep | Cheap. Honest. Needs one email explaining it | ✅ **Recommended for v1** |
| **B — the Worker sends the trial emails** | Move all five emails out of GHL into the Worker, which knows which coach each one is about | Loses GHL's email builder, DMARC-aligned sending domain and the copy workflow Muhammad owns. **Large** | ❌ Not now |
| **C — per-coach field sets** | `coach_name_1042`, `coach_name_1043`… | N × 5 custom fields, and the workflow cannot template which set to read — merge fields again | ❌ Fails on §2.1 |

**Recommend Option A, and say so in the copy.** It is one sentence in the welcome email — *"Finished
with one coach? Your next one starts automatically."* — against a problem no customer has had yet,
because no second author exists.

> **The trigger to revisit:** the first reader who buys two coach bundles inside ten days. Until
> then, building for it is speculative. `trial:<contactId>:<code>` is deliberately shaped to support
> concurrency later, so Option A is a **policy applied at step 5**, not an architecture that has to
> be undone. That is the whole reason to key trial state per coach even while refusing concurrency.

### Breakage 3 — the copy fix

From `02` §4a, and it still applies:

1. **The welcome email needs a second variant**, sent when the contact already holds another
   `bookcoach-*-active` tag: *"you now have more than one coach — start your message with the
   author's name."* That is a branch on tag presence, which GHL can do without naming a coach.
2. **`aliases` stop being cosmetic.** `speechHints()` is built from the caller's own entitled codes,
   and HANDOFF §7 records speech recognition needing three attempts to capture a code on one real
   call — with hints for a *single* coach. At fifteen authors, mishearings and name collisions get
   materially worse. **Populate `aliases` per author: full name, common misspellings, surname
   alone.** Stickler's entry is the model.

---

## 7. Migration — without breaking the live author

Stickler is live, proven, and the only revenue path. **He must keep working at every step.**

The migration is safe because the new mechanism is **additive at every stage**: the Worker's tag
write is a union with the existing one, and the entitlement read has always been a union of the
published map and a live tag read.

| # | Step | Stickler risk |
|---|---|---|
| 1 | Add the new `coaches.json` keys + `KV_FIELDS` + validation. `npm run push` | **None** — unread keys change nothing |
| 2 | Create the five new GHL custom fields | **None** — unpopulated fields change nothing |
| 3 | Build `POST /shopify/order` and its tests. **Deploy but do not point Shopify at it** | **None** — nothing calls it |
| 4 | Exercise it with a signed synthetic payload against a throwaway email | **None** — new contact only |
| 5 | Build the §4.8 sweep. **Ship it behind a config flag, default off** | **None** while off |
| 6 | Swap the five emails to merge fields, and **backfill Stickler's display fields on existing trial contacts** | 🟠 **Real.** A merge field with no value renders blank. Backfill *before* swapping, and read a delivered email |
| 7 | Repoint Flow A and Flow B at `/shopify/order`, drop the product conditions | 🟠 **Real.** Test with a $0 order first (a 100%-discounted order still reports `Paid`) |
| 8 | Change the GHL workflow trigger to `coach-trial-started`; strip actions 1–3 and day 10's tag removal | 🟠 **Real.** This is the cutover. Do it immediately after step 7 verifies |
| 9 | Turn the §4.8 sweep on. Confirm one trial expires | 🟠 **Real** — but the failure direction is *late* expiry, not lost access |
| 10 | Retire the premium Inbound Webhook | **None** once step 8 is verified. **Regenerate it rather than leaving it live** — it is an unauthenticated capability |
| 11 | Onboard author #2 via §8, changing nothing but data | — |

> 🚨 **Steps 7 and 8 are one cutover, not two.** Between them, Flow calls the Worker (which adds
> `coach-trial-started`) while the GHL workflow still triggers on the Inbound Webhook — so **no
> trial workflow runs and no welcome email sends.** Do them in one sitting, and verify with a $0
> order before walking away.

> ⚠ **Do not start this until the enforce-mode SMS path has been walked once** (master plan phase 3
> step 4). SMS and voice have carried **zero traffic since 2026-08-26**, two days before
> `entitlementMode` went to `enforce` — verified against the Twilio API 2026-09-19. Generalising a
> channel nobody has exercised under its current configuration means debugging two unknowns at once.

---

## 7a. The actual roster — verified 2026-09-22

**Muhammad's list, checked against the live pages and the Voiceflow workspace rather than matched by
name.** Project IDs are confirmed independently: every page pins its project's **draft**, whose id is
the project id with the last hex character incremented — so page and project corroborate each other.

| `book-coach.ai` slug | Page `authorName` | Page `bookTitle` | Voiceflow project | Page | Activation UI |
|---|---|---|---|---|---|
| `/michael-hinkle` | **Micheal** Hinkle ⚠ | `Treasure Hunt` ⚠ | `69e68f5c26ce7fca93b47e18` | 200 | ❌ |
| `/leadership-books` | Leadership Books | `Book Publishing Coach` ⚠ | `69e9268d83b9b1d1d12de6d8` | 200 | ❌ |
| `/rick-meyer` | Rick Meyer | `Running on Faith` | `6a34712d677246c3541333c2` | 200 | ❌ |
| `/freddy-davis` | Freddy Davis | `Worldview Coach` ⚠ | `6a3339b6eb283c59b70cfa52` | 200 | ❌ |
| `/reinhard-klett` | Reinhard Klett | `Coached by the Bible` | `69ea7e499300ebd74883c215` | 200 | ❌ |
| `/michael-stickler` | Michael Stickler | `Life Without Reservation` | `6a52da46bc446f70628c598c` | 200 | ✅ |
| `/john-joseph` | — | — | `6a7b6ad32cebd5d1b4c9f31e` | 🚨 **404** | — |

> ✅ **Stickler stays on `6a52da46bc446f70628c598c`** — confirmed by Muhammad 2026-09-22. A second
> project, `6ab0e498a45d2247fd1d5c93` *"Michael Stickler - Life Without Reservation (Adaptive Modes
> + Audience)"*, was created 2026-09-21 and is **NOT in use.** Do not repoint anything at it.

### What this table changes about the plan

1. 🚨 **"Ready" means the coach answers, not that it is sellable.** All six live pages call
   Voiceflow **directly** with an API key in page source. None is in `coaches.json`, so the Worker
   does not know they exist, and **only Stickler has the activation UI** (`showActivation: true`).
   Every one of the other five is an ungated public chat with no entitlement, no trial and no
   billing attached.
2. **So §8's runbook is the real remaining work per author, not a formality.** Each of the five needs
   a `coaches.json` entry, a GHL tag, a GHL $59 product, a Shopify bundle, a Zipify page and a
   Course360 route. The Voiceflow project — genuinely the expensive part — is the one thing already
   done.
3. ⚠ **Three `bookTitle` values are coach names, not book titles**, and one author's name is spelled
   two ways. Both feed customer-facing email copy. [`29-later.md`](29-later.md) §6.
4. ⚠ **Every page pins a draft**, including Stickler's — whose Worker is pinned to `main`. His web
   and SMS channels are serving different snapshots. [`29-later.md`](29-later.md) §4.

**Still needed per author before a `coaches.json` entry can be written:** the real book title, the
confirmed display-name spelling, a `code`, a GHL tag, a GHL product id, and a Shopify product id.
The project id and `landingPageUrl` are settled by the table above.

---

## 7b. What actually breaks at many authors — measured 2026-09-22

**Muhammad, 2026-09-22:** *"there are not just 7 bookcoaches, in future there are going to be many
more."* So the question stopped being "does this survive 15?" and became "where is the wall?"

**Nothing below is urgent.** All of it is fine at 7, and fine at 15. It is written down now because
the fixes are cheap while the registry is small and expensive once it is not.

### The one hard ceiling: the reconcile makes one GHL call per coach

`reconcileEntitlements` loops the tag map and awaits one paginated `ghlSearchByTag` **per tag,
sequentially**, every 15 minutes:

```js
for (const [tag, codes] of tagCodes) {
  const contacts = await ghlSearchByTag(env, tag);   // >= 1 subrequest, up to 50 pages
}
```

| Coaches | GHL searches per cron run | Verdict |
|---|---|---|
| 1 (today) | 2 (one tag + the staff tag) | fine |
| 7 | 8 | fine |
| 15 | 16 | fine, but the run is now ~5-8s of sequential I/O |
| **~45+** | **~46+** | 🚨 **would have broken on the Cloudflare FREE plan** — ✅ fixed 2026-09-22, see below |

**Why ~45 is the wall.** The free plan allows **50 subrequests per request**, and the cron is one
request. Workers Paid raises it to 1,000. This project is still on the free plan —
`coach-router/plans/to-do.md` item 5 records Workers Paid as *"no longer on the critical path"*,
which was true about **KV writes** and says nothing about subrequests.

> ⚠ **The failure mode is the bad kind.** The reconcile aborts before any write on an error, so
> nobody is wrongly revoked — but entitlement simply stops updating, `/health` keeps reporting the
> last good sync until `cronStaleAfterMinutes` (90) elapses, and new buyers silently get nothing for
> up to an hour and a half.

### ✅ FIXED AND DEPLOYED 2026-09-22 — one search, not N

**Shipped in Worker version `bf1cf796-784b-426e-bf0c-a0aa36973a0d`.** `ghlSearchByTag(env, tag)`
became `ghlSearchByTags(env, tags)`; the reconcile makes **one** paginated query for every coach tag
and maps each contact's own tags back to codes. **467 tests** (440 → 467).

**Regression check, against live GHL data:** a dry reconcile on the old code and on the new code
returned byte-identical numbers — `tags seen 2`, `entitled contacts 3`, `KV writes 0` — and a real
`--sync` afterwards left `/health` at `ok: true, lastOk: true, errors: []`.

| Coaches | Searches before | Searches after |
|---|---|---|
| 1 | 2 | **1** |
| 10 | 11 | **1** |
| 50 | 51 — 🚨 over the free-plan limit | **1** |

**Three safety properties came with it, and two of them are new:**

1. 🆕 **Over-matching cannot over-grant.** Each contact is scored on the tags it actually holds, so a
   contact the filter returned that carries no registry tag contributes nothing. Tested.
2. 🆕 **A missing `tags` field aborts the run.** The combined query depends on contacts carrying
   their own tags; if GHL ever stopped returning that field, every contact would map to zero codes,
   which reads as *"everyone churned"*. The majority guard would catch a big wipe but **let a small
   one through**, and would report the wrong cause. So: contacts returned, none recognised → throw
   before any write. Tested against a seeded subscriber, which survives untouched.
3. ⚠️ **Truncation now throws instead of silently truncating** — and this fixed a latent bug. The
   old `GHL_MAX_PAGES = 50` was *5,000 contacts **per tag***; one shared query makes it 5,000
   **in total**, so at a few thousand subscribers across several authors it would have started
   dropping contacts off the end — and a dropped contact is an unentitled contact. The cap is now
   **200 pages (20,000 contacts)** and exhausting it raises rather than returning a short list.

**One thing to know about the test suite:** every mocked `contacts/search` response now defaults a
`tags` array, because the live API returns one and the reconcile depends on it. Three separate
responder helpers needed it — a fixture that forgets it will fail loudly rather than silently pass.

### The original finding, kept as the evidence

Tested live against the GHL API on 2026-09-22. **A tag filter accepts an ARRAY, and ORs it:**

```bash
{"locationId":"...","pageLimit":100,
 "filters":[{"field":"tags","operator":"contains",
             "value":["bookcoach-micheal-stickler-active","bookcoach-staff-all"]}]}
```

**Proof it is a union rather than an intersection:** at the time of the test the first tag was held
by **3** contacts and the second by **2**. The combined query returned **3** — the union. An
intersection would have returned 2. *(A `{"group":"OR", filters:[...]}` form also works and returns
the same 3; the array form is simpler.)*

So `reconcileEntitlements` can make **one** paginated sweep regardless of how many authors exist, and
map each returned contact's tags back to codes — which `codesForTags()` already does. The search
response already carries `tags` per contact; `ghlSearchByTag` currently discards them, which is the
only reason it cannot be done today.

**Effect:** the per-coach subrequest cost goes from N to 1, the wall disappears, and the cron gets
faster rather than slower as authors are added.

**Cost:** a contained change to two functions plus tests. **Do it when the registry passes ~5
coaches**, not before — there is no benefit at 1 and it would be untested against real multi-tag
data.

### The second ceiling: one Worker secret per coach

Each author needs `VF_KEY_<CODE>` as a Worker secret (`sync-secrets.mjs` pushes them). Six secrets
exist today; at N authors it is N+5.

⚠ **Cloudflare limits the number of bindings/environment variables per Worker, and the exact current
number is NOT verified here — check it before planning past ~30 authors.** Stated as a known
constraint rather than a number, because guessing it is exactly the habit this project keeps paying
for.

**The fix, when needed:** replace the per-coach secrets with **one** secret holding a JSON map of
`code -> key`. One secret regardless of N, and `sync-secrets.mjs` already has the shape to build it.
It does mean the whole map is re-pushed when any single key rotates — acceptable, since rotation is
already a deliberate, sequenced act (master plan phase 6).

### What does NOT break, and why it is worth knowing

| Concern | Verdict at many authors |
|---|---|
| `POST /shopify/order` | ✅ **O(1) per order.** One registry lookup, one contact upsert, one PUT — independent of how many authors exist |
| The GHL trial workflow | ✅ **Exactly one, forever.** It never names a coach; that is the whole point of §4.5 |
| Shopify Flows | ✅ **Exactly two, forever.** No product conditions — §4.3 |
| `codesForTags` / `resolveEntitledCoach` | ✅ O(N) over an in-memory Map, per request. Irrelevant at any realistic N |
| `loadRegistry` | ⚠ One KV `list` plus one `get` per coach, on a cold isolate only, then cached. Cheap, but it is N reads — worth a single packed registry key if it ever shows up in latency |
| KV writes | ✅ Scales with *subscribers*, not authors. Roughly one write per subscriber per day |
| The Twilio number | ✅ One number serves every coach. Routing is by entitlement, not by number — `02` §4a |
| A2P 10DLC | ✅ Unaffected by author count (but see `11-parking-lot.md` for the campaign's own issue) |
| Voiceflow projects | ❌ Genuinely one per author. It is the product; nothing makes it cheaper |

### The honest summary

**Two ceilings, both known, both with verified fixes, neither urgent.** The architecture in this plan
is O(1) in authors everywhere it matters — the Shopify endpoint, the GHL workflow, the Flows. The
only two places that count authors are the reconcile loop and the secret list, and both were designed
when N was 1.

**Trigger points:** ~~revisit the reconcile at 5+ coaches~~ ✅ **done 2026-09-22, before the second
author was added.** The secrets ceiling remains, at **~30** — and re-read the Cloudflare binding
limit before planning past it rather than trusting any number written here.

---

## 7b-bis. Naming conventions — decided 2026-09-24

**Muhammad, 2026-09-24:** *"in future i want this pattern to be followed."*

| Thing | Pattern | Example |
|---|---|---|
| GHL coach product | `BookCoach AI - <Author> - Coach Access` | `BookCoach AI - Freddy Davis - Coach Access` |
| Its price | `BookCoach AI - <Author> - Coach Access @ 59/month` | as above |
| Course360 Offer | `BookCoach AI — <Author> — <Coach Label>` | `BookCoach AI — Freddy Davis — Worldview Coach` |
| GHL tag | `bookcoach-<author-slug>-active` | `bookcoach-freddy-davis-active` |
| Grant workflow | `Book Coach — Grant Course (<Author>)` | — |
| Shopify bundle | `<Book Title> [<Author>] + Your Personal AI Coach` | — |

🟢 **Renaming is safe.** Everything binds on **ID**, never on name — the registry matches
`ghlProductId`, the funnel stores the product id, and `Grant Offer` stores the offer id. Verified
2026-09-24: Freddy's product was renamed after creation and the reconcile still matched it.

⚠️ **One exception, and it is the important one.** The master plan lists the Course360 **offer name**
among the internal match keys. Renaming it is very likely safe for the same reason — but if you
rename an Offer, **re-open its grant workflow and confirm the OFFER dropdown still resolves**, in the
same sitting. That is cheap insurance against the one case where a name turns out to be load-bearing.

⬜ **Stickler is still on the old names** (`Michael Stickler - Coach Access`,
`AI Coach Final — Micheal Stickler — Life Without Reservation`). Harmless, and worth aligning next
time that workflow is open anyway.

---

## 8. Adding author N — the runbook

**The deliverable of this whole plan.** If a step here requires editing a workflow, a Flow, or an
email, the plan is not finished.

| # | Step | Where | Owner | ~Time |
|---|---|---|---|---|
| 1 | Build the Voiceflow project; publish it; note the **`main`** alias | Voiceflow | M | days |
| 2 | Create the GHL tag `bookcoach-<author>-active` | GHL | M | 1 min |
| 3 | Create the Shopify bundle product. Set SKU and weight. Add to `coach-bundles` | Shopify | M | 10 min |
| 4 | Clone the Zipify landing page from `_TEMPLATE`; fill every placeholder | Zipify | M | 30 min |
| 5 | Create the GHL $59 product + monthly price | GHL | M | 2 min |
| 6 | Clone the $59 funnel page; point it at that product and price | GHL | M | 15 min |
| 7 | Clone the coach page on `book-coach.ai` | GHL | M | 10 min |
| 8 | Add the `coaches.json` object (§5) and run `npm run push` | repo | C | 2 min |
| 9 | Verify: `/health` lists the new code, `keyResolved: true` | terminal | C | 1 min |
| 10 | **$0 test order** through the new Zipify page → Flow B → tag + trial record + welcome email | live | both | 15 min |
| 11 | Delete the test contact and its `trial:` record | GHL + KV | C | 2 min |

**Nothing in the list touches a workflow, a Flow, an email template, or the Worker's code.** That is
the acceptance criterion.

> **Step 10 is not optional and the cheap version is not enough.** `test-ghl-webhook.ps1` proves the
> GHL half talks to itself. Only a real order exercises the Zipify product id, the Flow, the HMAC,
> the registry lookup and the emails — which is where every generalisation bug will actually live.
> A 100%-discounted $0.00 order still reports `Paid`, so this costs nothing.

---

## 9. Build order

Dependency-ordered. Each step is verifiable on its own, and nothing after step 6 can break Stickler
without step 6 having failed first.

| # | Work | Owner | Gates |
|---|---|---|---|
| 1 | ✅ **DONE 2026-09-22.** Registry keys + `KV_FIELDS` + `coachProblems()` validation + 30 tests, seeded to production KV | C | — |
| 2 | The five GHL custom fields | M | — |
| 3 | ✅ **BUILT AND DEPLOYED 2026-09-22.** `POST /shopify/order` + 54 tests (386 → 440). Version `750ccd84-157b-4ea1-99fd-651aba9046a9`. ⬜ **Not yet wired to Shopify** — the webhook/Flow still has to point at it | C | 1 |
| 4 | Backfill Stickler's display fields; swap the five emails to merge fields; **read a delivered email** | M | 2 |
| 5 | ✅ **BUILT, DEPLOYED AND ON — 2026-09-23.** `sweepExpiredTrials`, 35 tests (485 → 520), `afba3857`. `trialExpiryMode: on` in production | C | 1 |
| 6 | **Cutover:** repoint both Flows, change the workflow trigger, strip the moved actions, enable the sweep | both | 3, 4, 5 |
| 7 | Verify with a $0 order end to end; confirm one trial expires via the sweep | both | 6 |
| 8 | "My Coaches" page + `/api/my-coaches`; retire the per-author course and Offer | both | 7 |
| 9 | Nominate and freeze the Zipify `_TEMPLATE` | M | 4 |
| 10 | ✅ **AUTHOR #2 (Freddy Davis) PROVEN END TO END — 2026-09-24.** Trial path only; the $59 conversion path is outstanding | both | 8, 9 |
| 11 | Regenerate the retired Inbound Webhook URL | M | 6 |

**Steps 1–5 are all safe to build with Stickler live.** Step 6 is the only cutover. Step 10 is the
proof.

> **Do not reorder step 8 before step 7.** Collapsing the courses while the trial path is mid-cutover
> means two unproven things in the activation route at once, and activation is the step with no
> fallback — a reader who cannot reach a code has no coach at all.

---

## 9a. Step 1 as built — 2026-09-22

**Shipped and live in production KV.** `/health` re-verified after the push: `ok: true`,
`problems: []`, coach `1042` `versionID: main`, `keyResolved: true`. Voiceflow `main` still 200.

| Change | Where |
|---|---|
| `displayName`, `bookTitle`, `shopifyProductId`, `courseLessonUrl`, `trialDays` added to `KV_FIELDS` | `lib-config.mjs` |
| `SHOPIFY_WEBHOOK_SECRET` → `shared.shopifyWebhookSecret` | `lib-config.mjs` `SHARED_SECRETS`; pushed as a Worker secret (64 chars) |
| `assertNoSecrets` now also refuses `shopifyWebhookSecret` | `lib-config.mjs` |
| `shopifyProductId` normalised to a **string** on load | `lib-config.mjs` `loadConfig` — authored as a JSON *number* it would never `===` what Shopify sends |
| `coachProblems(coaches)` — exported, pure, testable | `lib-config.mjs`; called by `seed-coaches.mjs` beside `configProblems` |
| Three new per-coach warnings + seven new report lines | `seed-coaches.mjs` |
| **30 new tests — 356 → 386, all passing** | `verify.test.mjs` |
| Coach `1042` populated with all five new keys | `coaches.json` (backup written alongside) |

**What `coachProblems` refuses**, each guarding a failure that is invisible at one author:

- a `ghlTag`, `shopifyProductId` or `ghlProductId` **shared by two coaches** — the message names the
  consequence out loud, because the symptom is that buying one author's book grants another's coach
- a `ghlTag` in the **`shopify_` namespace**, which GHL populates from Shopify order tags
- a `shopifyProductId` that is not digits, **naming a GID as a GID** when that is what was pasted
- a `courseLessonUrl` on `app.coursecreator360.com` (the builder, 404 for members), carrying
  `is_preview=true`, or not `https://`
- a `trialDays` outside 1–90, or non-integer

Warnings, not refusals: a missing `shopifyProductId` (fails closed — no purchase can start a trial),
a missing `bookTitle` (the day-9/10 emails render a gap), a missing `courseLessonUrl` (no route to an
activation code at all), and a `ghlTag` off the `bookcoach-<author>-active` convention.

---

## 9b. Step 3 as built — 2026-09-22

**Written and tested; NOT deployed and NOT wired to Shopify.** `npm test` 440 passing, `npm run
check` clean. The route sits at `/shopify/order`, deliberately **outside** the
`path.startsWith(TWILIO_PREFIX)` block — a first attempt put it inside, where it would never have
matched and would have looked like Shopify was not calling.

### The custom-field discovery that changed the design

Plan §4.4 step 8 assumed field **ids**. Only four were known. Probed live on 2026-09-22 against the
staff test contact: **GHL accepts `{ key, field_value }` and it lands.** The read-back then returned
the ids for the five that were unknown.

**So the endpoint writes by KEY, not by id** — ids are per-location and would have to be
rediscovered for every GHL account this is deployed into; keys are stable, readable in a diff, and
identical to the email merge tags. The ids are recorded below only because a verification `curl`
returns fields by id.

| Key | Id |
|---|---|
| `coach_status` | `cAL8RHFCFUgPRA9gZjsx` |
| `coach_trial_started` | `JJoM2V52xXLZqyNm5tOK` |
| `coach_trial_source` | `kBxKqY1tUGc6waAjcONz` |
| `shopify_order_number` | `818JeImrO5OKspBYkI8S` |
| `coach_name` | `hhqfPEVtO6YLHRpsN3oa` |
| `coach_code` | `jWIWaKlhhTEVUx5s4Lp8` |
| `coach_book_title` | `7UMMGbo1SBtSnEljBjkp` |
| `coach_link` | `ZJYMJbg5SMTztow0Xhqj` |
| `coach_landing_url` | `CVoYdAl17AWMoKZpM9bN` |

### Decisions taken while building

- **Gate 1 is closed by construction.** `shopifyProductIds()` accepts `line_items[]`, a delimited
  `product_ids` string, or an array — and reduces a GID to its numeric tail. Whatever shape Flow can
  build, the Worker takes. The gate no longer blocks anything.
- **Three independent guards against a double grant**, because the failure is permanent access:
  `shop:<orderId>` idempotency, a `trial:<contactId>:<code>` record, and an existing-tag check.
- **The seen-marker is only written once an order has matched a coach.** A non-coach order is not
  marked, so a later re-send still works.
- **A coach order with no email is a loud 400**, not a silent drop — Shopify retries it. Losing a
  paying customer quietly is the worse failure.
- **Empty merge fields are never written.** An empty value renders as a gap in a customer email
  rather than an error, so a blank is omitted instead of overwriting a good value.
- **`grantTrialsForOrder` never throws.** It runs in `ctx.waitUntil()`, where a throw reaches
  nobody; failures are logged as `[shopify] order <id> FAILED`. ⚠ **`/health` does not cover this —
  the log IS the alarm.** Worth an entry in phase 9 before real traffic.

### Two tests that were wrong before they were right

1. **The two-author test failed**, because `loadRegistry` caches per isolate and seeding a second
   coach into KV did not change it. Fixed with `__resetCaches()` — the same trap will catch anyone
   adding registry tests later.
2. **The `trialDays` default test passed for the wrong reason.** It seeded a coach with no
   `trialDays` but read the cached one with `trialDays: 10`, which happens to equal the default. It
   now tests a per-coach `30` and the fallback separately.

---

## 9c. The cutover — dual auth, and the guard that must be removed

**Shopify Flow cannot produce an HMAC.** The endpoint was built for Shopify's *native* webhook
signing, but Flow owns the 21-day wait and is therefore the production caller. Fixed 2026-09-22 in
version `7dce404a-da87-4604-8989-17cb24effe79`: `verifyShopifyRequest` accepts **either** a valid
`X-Shopify-Hmac-Sha256` (native webhook, the test rig) **or** an `X-Coach-Token` shared secret
(Flow, via a Flow Secret). 474 tests. Live-verified: correct token `200`, wrong token `403`, no
credential `403` naming both methods.

`FLOW_SHARED_SECRET` is a Worker secret, sourced from `shared.flowSharedSecret`. Header lookup is
case-insensitive, which matters — **Flow rewrites header names to Capitalised-Form.**

### 🚨 The trap in the cutover: the trial guard inverts

The GHL workflow's guard is `Coach Status is empty`. Under the new design the **Worker sets
`coach_status: trial` before GHL ever sees the contact** — so that guard now evaluates FALSE, takes
the empty `None` branch, and **sends no emails at all.** The workflow would look like it ran fine.

**So the cutover is not just a trigger change.** In the same sitting:

| Action | Do what |
|---|---|
| Trigger | Inbound Webhook → **Contact Tag added = `coach-trial-started`** |
| `Create contact` | **remove** — the Worker upserts it |
| `Coach Status is empty` guard | **remove** — it now blocks every run |
| `Update contact field` (status/date/source) | **remove** — the Worker writes all of them |
| Welcome + day 7/9/10 emails, waits, `Coach Status is trial` guards | **keep unchanged** |
| End of workflow | **add `Remove Tag coach-trial-started`** so a later purchase can re-enrol |
| Day 10's `Remove Tag <author tag>` + `coach_status = expired` | ⚠ **keep for now.** It only removes Stickler's hardcoded tag, so it is correct for him and wrong for everyone else. It moves to the Worker sweep at build-order step 5 — **which must land before author #2 sells.** |

---

## 9d. ✅ The new path is PROVEN END TO END — 2026-09-22

Flow A's real resolved body (from its own `Test results` tab, order #4217) was POSTed to the live
endpoint with the email swapped for a throwaway. **Everything worked on the first attempt.**

`{"ok":true,"matched":1,"codes":["1042"]}` → GHL contact `uHzATEXTsrbe4myqJcxG`:

| | Value |
|---|---|
| tags | `bookcoach-micheal-stickler-active` **+** `coach-trial-started` |
| `coach_status` / `coach_trial_started` | `trial` / `2026-09-22` |
| `coach_trial_source` / `shopify_order_number` | `shopify_flow_backstop` / `#4217` |
| `coach_code` / `coach_name` | `1042` / **`Michael Stickler`** — the display spelling, not the internal `Micheal` |
| `coach_book_title` | `Life Without Reservation` |
| `coach_link` / `coach_landing_url` | the Course360 lesson / the $59 funnel |

**So Shopify Flow → Worker → registry lookup → GHL contact + both tags + all nine fields is proven
on real data.** What is NOT yet proven is the GHL half: the workflow still triggers on the Inbound
Webhook, so no email fires from `coach-trial-started` until the cutover (§9c).

Test contacts deleted; census and `/health` both back to 3.

### Two Flow findings worth keeping

- **The Liquid for line items is `{% for li in order.lineItems %}{{li.product.id}},{% endfor %}`**,
  and it resolves to `gid://shopify/Product/10434147320122,` — GID-wrapped, comma-suffixed. The
  endpoint strips the wrapper and ignores the trailing blank. Confirmed in Flow's own tester.
- **Flow's test run does NOT fire the HTTP request** — *"This action can't be safely simulated."*
  It proves the body only. The round trip has to be exercised separately, which is what the above did.

### 🚨 Trap: GHL's contacts/search index is EVENTUALLY CONSISTENT, in both directions

A newly created contact took **~20 seconds** to appear in `POST /contacts/search`, and a deleted one
was still listed ~10 seconds after a `200` delete. **`GET /contacts/<id>` is authoritative and
immediate** (`400 Contact not found` when gone).

**This matters because the tag census is this project's standard proof.** A census read too soon
shows a missing contact and reads as a broken workflow — the exact false alarm that has cost this
project time before. **Verify a single contact by id; use the census only for population counts,
and re-read it after ~30 seconds.**

---

## 9e. `coach_trial_ends` — the date a customer reads · 2026-09-23

Shipped in `46bb24b9-2209-4936-9c8b-237c6dac1854`, 485 tests. **Awaiting the GHL field**, which the
PIT token cannot create (`401 not authorized for this scope` on `/locations/<id>/customFields`).

**Why it exists:** the welcome email said *"Your 10 days start today"*, which makes the reader do the
arithmetic — and *"I didn't realise it had ended"* is the support ticket this removes. The Worker
already computed the exact expiry for the `trial:` record; it just never surfaced it.

| Decision | Why |
|---|---|
| **Text field, not a date picker** | Its only job is to be pasted into a sentence. `2026-10-02` makes a reader think; `10/02/2026` is ambiguous outside the US. `formatTrialEnd` renders **`2 October 2026`** — unambiguous everywhere |
| **Follows `granted[0]`** | The contact fields describe ONE trial, so the date must belong to the same coach as `coach_name`. Tested with two coaches at 10 and 30 days: the field shows the first one's |
| **Omitted when unknown** | Never written blank — an empty merge field renders as a gap in a customer email, not an error |
| **Invalid input → `''`** | Never the string `Invalid Date` in front of a customer |

### 🟢 Verified: deploying a field-write BEFORE the field exists is safe

Tested live 2026-09-23 against a throwaway contact. An unknown custom-field key is **ignored** — the
PUT returns success and every valid field still lands. So the Worker can ship a new field write and
it starts working the moment the GHL field is created, in either order.

**That is a genuinely useful property for this project**, where the code side and the GHL side are
owned by different people and cannot always be changed in the same sitting.

---

## 9f. The expiry sweep — and the guard I got wrong · 2026-09-23

**Live in `afba3857-c881-4f0e-9b8b-56517dd1c558`, `trialExpiryMode: on`, 520 tests.** The Worker now
ends trials from the registry instead of GHL removing one author's hardcoded tag. **This was the last
blocker on selling a second author.**

`sweepExpiredTrials` runs on the existing `*/15` cron, after the reconcile:
list `trial:` → find due → remove that coach's tag → set `coach_status: expired` **only if no other
coach tag remains** → delete the record.

| Decision | Why |
|---|---|
| `DELETE /contacts/<id>/tags` | Verified live: removes **only** the named tag and returns what remains. A whole-contact PUT with a rebuilt array would race with anything else touching that contact |
| `coach_status` flips only on the **last** trial | A reader mid-trial on another author must not read `expired`, or the day-7/9 guards stop matching and that sequence dies silently |
| A GHL failure **keeps** the record | Deleting it would leave the reader entitled with nothing scheduled to take it away. The next run retries |
| A deleted contact → orphan, record removed | Otherwise it retries forever |
| `off` / `dry` / `on`, shipped `off` | Turning it on is the moment trials start *ending*. Rollback is one word plus `npm run seed` — no deploy |

### 🚨 I specified the wrong guard in §4.8, and writing the tests caught it

§4.8 said the sweep *"needs a **majority guard** measured against its own population"*, by analogy
with the reconcile. **That reasoning does not transfer, and shipping it would have been a bug.**

The reconcile's guard exists because an empty GHL response is indistinguishable from *"everyone
churned"* — the danger is **an external system lying**. Trial expiry reads a local KV record carrying
a date this Worker computed itself. Nothing external can lie about it.

Worse, a majority guard **fires on the normal case**: everyone who buys on launch day expires on the
same day, so 100% of the population coming due at once is exactly what a healthy system looks like.
The guard would have refused it, ended nobody's trial, and handed every launch-day customer a free
coach — the precise failure the sweep exists to prevent, caused by the guard meant to protect it.

**Replaced with a per-run cap of 100.** It bounds a runaway without ever refusing legitimate work —
the overflow expires 15 minutes later on the next cron. There is no starvation, because each run
deletes what it processed. Both behaviours are tested, including the 12-of-12 launch-day case.

### Live state

Reading production KV: **3 `trial:` records tracked, 0 due, no errors.** All three are residue from
the endpoint tests and point at contacts since deleted — so when they come due (~2026-10-02) they
will be cleaned up as orphans, which incidentally exercises that path on real data.

⬜ **Still to retire:** the GHL workflow's day-10 `Remove Tag` + `coach_status = expired`. Harmless
to leave — both mechanisms are idempotent and fire within minutes of each other — but it is the last
author-specific string in the workflow and should go once the sweep has expired a real trial.

---

## 9g. Author #2 — Freddy Davis, proven 2026-09-24

**The trial path works for a second author with no code change and no per-author edit to either
Shopify Flow or the main GHL workflow.** That is the thesis of this plan, demonstrated.

Real $0 order #4233 → Flow B → `POST /shopify/order` → registry → GHL contact carrying
`bookcoach-freddy-davis-active` + `coach-trial-started`, `coach_code 1043`, `coach_name Freddy
Davis`, `coach_book_title The Truth Mirage`, `coach_trial_ends 4 October 2026`, and **his** lesson
URL. Welcome email received; lesson link confirmed working by Muhammad.

Registry entry, tag, Voiceflow key, Course360 course + Offer, per-author grant workflow — all live.
`/health` green, both coaches resolving, 3 tags in one reconcile query.

### Four failures on the way, all worth keeping

1. 🚨 **Both Shopify Flows had an inverted tag condition.** `None of order/tags → tags item **is not
   any of** coach-started` is a double negative: it means *"no tag is something other than
   coach-started"*. It passes only when the order has **no tags at all**, which is why four earlier
   test orders passed and this one did not.
   **In Flow A the consequence was severe and silent: any order carrying any unrelated tag — `gift`,
   `vip`, anything an app adds — would never have started a trial.**
   Fixed in both by changing the quantifier to **`All of order / tags`**, leaving the predicate
   alone: *"every tag is not coach-started"*.
   ⚠️ **The canvas card renders both versions identically** as `Tags is not any of coach-started`.
   Only the run log distinguishes them. `04-phase-2-build-runbook.md` already warned this card
   "renders ambiguously" — that warning was right and under-weighted.
2. 🚨 **The main GHL workflow had NO TRIGGER.** The Inbound Webhook was deleted during the cutover
   and the `Contact Tag` trigger was never added. A workflow with no trigger cannot run, and GHL
   shows no error — Execution logs simply stay empty. **When a workflow "does nothing", check that
   it has a trigger before checking anything else.**
3. **The per-author grant workflow was created but left inactive.** Publishing is a separate act
   from creating, and GHL's own notice warns the trigger "only applies to tags added after the
   workflow is published" — so a buyer arriving before publication gets a trial with no course.
4. **A typo'd test email** (`tester4-typo` vs `tester4`) sent the welcome email to an address nobody
   owned. Recovered without a new order by firing the endpoint with the correct address — the
   endpoint is the same path Flow B drives, and Flow B was already proven by its run log.

### Re-firing a trigger without a new order

`coach-trial-started` fires on **tag added**, so removing and re-adding it by API replays the whole
GHL half in seconds. Cycling the coach tag as well replays the grant workflow. This is the fast test
loop for anything GHL-side; only the Shopify leg needs a real order.

### ⬜ Outstanding for Freddy — the conversion path

`ghlProductId` and `landingPageUrl` are both unset, so **`coach_landing_url` renders EMPTY** and the
`KEEP MY COACH` button in his day-7, day-9 and day-10 emails is a dead link. Correctly omitted rather
than written blank — but it means the $59 product and funnel page **must exist before day 7 of his
first real trial.**

---

## 9h. The purchase path, without a GHL workflow · 2026-09-24

**Live in `c0a46c26-d0b7-47a9-98a3-eef629496d30`, 544 tests.** The reconcile now applies a coach's
tag to any contact entitled by an **active subscription** that does not already hold it, and sets
`coach_status: active`.

### The gap this closed

A subscription already granted entitlement — the reconcile matched `ghlProductId` and the subscriber
could text, call and open the web coach. What it did **not** give them was the **course**, because
the course is granted by a workflow that triggers on the coach tag and nothing applied it.

That was being filled by `Coach Subscription Started`, whose product filter **and** `Add Tag` were
both hardcoded to one author. Scaling it meant a second purchase workflow per author — on top of the
grant workflow. **Two author-specific workflows each, forever.**

Applying the tag in the reconcile means the same per-author grant workflow serves purchases and
trials through one mechanism, and **the purchase workflow can be deleted outright rather than
duplicated.**

`coach_status: active` matters for a second reason: day-7 and day-9 are guarded on
`Coach Status is trial`, so a trial user who converts would otherwise keep being sold the
subscription they just bought.

### Two properties worth keeping

- **Idempotent with no extra state.** The reconcile now records *how* each code was earned
  (`fromTag` / `fromSub`). Once the tag is applied, the next run finds that contact in the tag
  search, the code lands in `fromTag`, and nothing happens. No marker keys. A manually removed tag
  is re-applied — correct, because the subscription is the source of truth.
- **A failure cannot abort the reconcile.** Logged, never thrown. One bad tag write must not cost
  every other subscriber their lease renewal that cycle.

### The end state this produces

| Shared — never edited again | Per author — data, plus one 2-action workflow |
|---|---|
| Shopify Flow A + B | Shopify product |
| `Delivery → Trial Start` (emails + timing) | Zipify page |
| Trial expiry (Worker sweep, §9f) | GHL $59 product + price |
| Purchase → entitlement **and tag** (this) | Funnel page |
| | Course360 course + Offer |
| | `coaches.json` entry |
| | **Grant-course workflow** (tag → Grant Offer) |

That last row survives only because GHL cannot template an Offer ID. §4.6 removes it by collapsing
every course into one "My Coaches" page.

### ⬜ The GHL clean-up this unlocks — one pass, then never again

1. `Delivery → Trial Start` — delete day-10's **`Remove Tag`** and **`Coach Status = expired`**.
   The sweep does both, per-author. Left in place they strip *Stickler's* tag from a Freddy contact.
2. **Delete `Coach Subscription Started` entirely.** Not an action — the workflow.

> **A note on the churn, recorded honestly.** Muhammad built the purchase workflow and the day-10
> actions on instruction, and is now being asked to delete them. The day-10 removal was always the
> plan — it is what the sweep replaced, and the sweep was built first at his request. The purchase
> workflow is different: it was correct for one author and I did not have a generic answer for it
> until now. Deleting it is the cheaper of the two options that existed; the other was a second
> per-author workflow forever.

---

## 10. Gates — things I could not verify, and who can

**Everything below is stated as unverified on purpose.** This project has twice lost days to a
confident claim that turned out to be inherited from a different context.

| # | Gate | Why it matters | Who answers |
|---|---|---|---|
| 1 | **Can Shopify Flow `Send HTTP request` post a full `line_items` array?** §4.3's payload assumes it. Today's Flow sends flat scalars | If not, send a delimited product-id list and parse it in the Worker — or fall back to the `coach-bundles` collection condition (§4.2) | M, in Flow |
| 2 | **Does `Remove Tag` accept merge fields?** §2.1 assumes not, by analogy with `Add Tag` | Only changes §4.8's cost comparison, not its choice. **Write the answer down either way** | M, in GHL |
| 3 | **Can a GHL `Contact Tag` trigger re-enrol a contact that has completed the workflow before?** §4.5 step 11 removes `coach-trial-started` so it can. Unproven | If not, Option A in §6 becomes mandatory rather than recommended, and a second trial needs a different trigger | M, in GHL |
| 4 | **Shopify webhook signing secret** — can it be created and read? | §4.4 step 1 is unbuildable without it. `plans/06` §5 flagged this in August and it is still open | M, Shopify admin |
| 5 | **Does the $59 funnel page template cleanly?** §4.9 assumes a clone is cheap | It was rebuilt by hand on 2026-09-17 after being functionally blank; nobody has cloned one | M, in GHL |
| 6 | **Is 21 days right for books other than Stickler's?** | Different page counts and printers ship differently. `trialDays` is per-author; the Flow wait is not | M, after ~20 real orders |

> **I have no Shopify credential of any kind** — verified 2026-09-21, nothing in the tree. Gates 1,
> 4 and 5 are unverifiable from here by construction, not by omission.

---

## 11. Traps — carried forward, plus the new ones

**Carried forward, and all of these still apply at N authors:**

- 🚨 **Merge fields silently do not work in `Add Tag`.** The workflow runs green and grants nobody
  anything. This is the single fact the whole plan is built around.
- 🚨 **GHL's canvas state and published state are separate.** Confirm the publish before verifying.
  Cost this project an afternoon twice.
- 🚨 **A green execution log is not proof.** The contact record and the tag census are.
- 🚨 **`SENT OK` from `test-ghl-webhook.ps1` only means the trigger server accepted the webhook.** A
  fire at a workflow in Draft returns the same body and creates nothing.
- 🚨 **GHL dedupes on phone as well as email.** Use a unique phone per test or two tests silently
  merge into one contact and the email gets overwritten.
- **Blank `coach_status` before re-testing an existing contact.** Left set, the guard correctly stops
  the run, which looks exactly like a broken workflow.
- **KV is eventually consistent — allow ~60 s** before concluding the Worker did not see something.
- **Never import `+1 854 254 5009` into GHL/LeadConnector.** It silently rewrites the webhooks and
  the router goes dark with no error anywhere.
- **The Course360 lesson editor strips `<script>` and `<button>`,** and both failure modes look
  installed.
- **Read `Execution logs` before theorising** about a workflow.

**New, and specific to going multi-author:**

- 🚨 **Cloning a live author's page, not a frozen template.** Both 2026-09-17 landing-page defects
  were inheritance bugs. At N authors this is the highest-frequency failure available. §4.1.
- 🚨 **A registry key not listed in `KV_FIELDS` is silently dropped on seed.** It looks configured
  and does nothing. §5.
- 🚨 **Two authors sharing a `ghlTag`, `shopifyProductId`, `ghlProductId` or `code`** cross-grants
  entitlement. Unthinkable at N=1, one copy-paste away at N=15. Validate uniqueness. §5.
- 🚨 **The GHL tag namespace is not ours alone.** Something live mirrors Shopify order tags onto
  contacts as `shopify_<tag>`. A coach tag must never collide. §5.
- 🚨 **A merge field with no value renders blank, not as an error.** `{{contact.coach_name}}'s work`
  on an unpopulated contact sends *"'s work"*. Backfill before swapping; read a delivered email. §4.5.
- 🚨 **Adding the tag before writing the `trial:` record** leaves a reader entitled with no expiry —
  invisible to the sweep, permanent access. Order matters. §4.4.
- 🚨 **A `trial:` record with a KV TTL** deletes the expiry instruction before it can be acted on.
  The record is the queue. §4.8.
- ⚠ **The expiry sweep needs its own majority guard**, measured against its own population. The
  existing one is computed over `sub:` leases, which are near-empty under `autoLinkGhlPhone: false`.
  Exactly the trap caught by a test on 2026-09-17. §4.8.
- ⚠ **A reader's second book degrades their first coach's experience** — from "text anything" to
  "name the author first". It lands on the best customers. §6.
- ⚠ **`Micheal` vs `Michael` is deliberate.** Internal names are live match keys; display names are
  copy. Never normalise one to the other. §4.1.
- ⚠ **Canvas edits in Voiceflow no longer reach customers until published** — the alias is `main`.
  Every new author inherits this, and it is how someone edits, tests, sees no change live, and
  concludes the bot is broken.
