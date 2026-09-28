# Book Coach AI — Master Plan

**Created:** 2026-09-11
**Supersedes as the top-level plan:** nothing. It *joins* two existing plans that were written
independently and did not know about each other.

| Read this for | Go here |
|---|---|
| A one-page orientation | [`../README.md`](../README.md) |
| The whole picture, and what to build next | **This file** |
| Phase 1 detail + the welcome email copy | [`01-phase-1-grant-path.md`](01-phase-1-grant-path.md) |
| Surviving ~15 coaches | [`02-multi-coach-scaling.md`](02-multi-coach-scaling.md) |
| Phase 2 — the Shopify Flows, and why | [`03-shopify-flows.md`](03-shopify-flows.md) |
| Phase 2 — click by click | [`04-phase-2-build-runbook.md`](04-phase-2-build-runbook.md) |
| **Handing this to a fresh session** | **[`../NEW-CHAT-PROMPT.md`](../NEW-CHAT-PROMPT.md)** — kept current; currently points at phase 5 |
| **Phase 4 — trial expiry, and why** | **[`05-phase-4-trial-expiry.md`](05-phase-4-trial-expiry.md)** |
| **Phase 4 — click by click** | **[`06-phase-4-build-runbook.md`](06-phase-4-build-runbook.md)** |
| **Phase 5 — the $59 conversion path** | **[`07-phase-5-conversion-path.md`](07-phase-5-conversion-path.md)** — the current focus |
| **Funnel + landing page copy, paste-ready** | **[`08-funnel-and-landing-copy.md`](08-funnel-and-landing-copy.md)** — phase 5 step 1 and phase 7 |
| **The live transaction test** | **[`09-live-transaction-test.md`](09-live-transaction-test.md)** — one card, five open answers, plus three **free** routes. Phase 4 steps 4c/4e + phase 5 steps 6/7 |
| **What the coach IS, and how activation works** | **[`how-the-coach-works.md`](how-the-coach-works.md)** — the orientation doc. Channels, the lease, the activation code end to end. Read this before touching the Worker |
| **Adding a new author, A to Z** | **[`21-new-author-runbook.md`](21-new-author-runbook.md)** — the onboarding runbook, written from the Freddy Davis run. Start here for author N |
| **Automating onboarding** | **[`21-onboarding-automation.md`](21-onboarding-automation.md)** — taking author onboarding from 9 manual steps to 4. What is blocked, what is free, and what stays manual forever |
| **Many authors, not one** | **[`20-multi-author-generalisation.md`](20-multi-author-generalisation.md)** — the whole journey made variable per author. Executes `02`; supersedes its §2–§6 as the build plan |
| **Wanted, but later** | **[`29-later.md`](29-later.md)** — deferred-but-intended work. Unlike the parking lot, these are expected to get done; re-raising them is welcome |
| **Parking lot** | **[`11-parking-lot.md`](11-parking-lot.md)** — deferred, low priority, or deliberately dropped. Nothing here blocks launch |
| The coach product — Worker, channels, entitlement internals | `../../coach-router/HANDOFF.md` |
| The coach product's outstanding work | `../../coach-router/plans/to-do.md` |
| The trial/offer design and its reasoning | `../book-coach-ai-subscription-handoff.md` |
| The $59 funnel, step by step | `../../coach-router/plans/07-ghl-funnel-setup.md` |

> **A note on the two source documents.** Both are accurate about their own scope and wrong where
> they guess about the other's. `book-coach-ai-subscription-handoff.md` §4 and §8 have been
> corrected in place. `coach-router/plans/07` says "no tag automation, no workflows at all" —
> true while the web channel was out of scope, and §3 below explains why it stops being true.
> Neither document is at fault; they were written three weeks and one scope apart.

---

## 1. The two systems, and the one thing that joins them

```
  SYSTEM B — commercial layer            SYSTEM A — the coach product
  (this directory, IN PROGRESS)          (../coach-router, DONE & LIVE)

  Shopify: book sold $29.95
        |
        v
  Order marked delivered  (MANUAL today)
        |
        v
  Shopify Flow  --webhook-->  GHL workflow
                                  |
                                  |  writes
                                  v
                       +--------------------------+          reads
                       |  GHL CONTACT TAG         | <------------------ Worker cron
                       |  bookcoach-micheal-      |                     every 15 min
                       |  stickler-active         |                          |
                       +--------------------------+                          v
                                  ^                              KV lease (48h, renewable)
                                  |                                          |
                       GHL $59/mo subscription                               v
                       (active sub also grants,                    +--------------------+
                        but see §3)                                | WEB · SMS · VOICE  |
                                                                   | one number,        |
                                                                   | +1 854 254 5009    |
                                                                   +--------------------+
```

**System B's only job is to write that tag at the right moments. System A's only job is to read
it.** Everything else in either system is internal detail. Keep the seam this thin and the two
can be changed independently forever.

Both live in the **same GHL sub-account**: `ghlLocationId` = `tjdqrnOqMAMheHIt6pQD`. Verified —
it is identical in `coaches.json` and in the inbound-webhook URL built on 2026-09-10.

---

## 2. Verified current state

### System A — coach-router: DONE and enforcing

| Thing | State |
|---|---|
| Worker | `https://coach-router.bookcoachai.workers.dev`, deployed |
| Channels | Web, SMS, voice — one number `+1 854 254 5009` |
| `entitlementMode` | **`enforce`** since 2026-08-28. SMS and voice are gated. |
| `webGateMode` | **`warn`** — the web coach is open to the public. See phase 6. |
| Reconcile | Cron `*/15 * * * *`; 48h renewable lease; revocation lands within 15 min |
| Guards | GHL API failure aborts before any write; >50% revocation refuses and alarms |
| Ops | `/health` returns 503 on stale/failed sync. Nothing is watching it yet. |
| Tests | **292** (re-run 2026-09-17) |
| Coaches | one — code `1042`, Micheal Stickler |
| Voiceflow | project `6a52da46bc446f70628c598c`, **draft** version `6a52da46bc446f70628c598d` — **no staging; every canvas edit is instantly live** |

### Live verification sweep — 2026-09-16

Everything below was read from the live systems this morning, not from a screen or a doc.

| Check | Result |
|---|---|
| Worker `/health` (with `x-health-token`) | `ok: true`, `entitlementMode: enforce`, last sync 15 min old, `lastOk: true`, **`counts.contacts: 7`**, `problems: []` |
| Contacts holding `bookcoach-micheal-stickler-active` | **exactly 7** — the 5 test contacts in §7 plus the 2 deliberate grants. Matches the Worker's count exactly. |
| Shopify bundle `…/products/<handle>.js` | id `10434147320122`, variant `54042631733562`, **$29.95**, `sku: null`, `weight: 0`, `available: true`, `requires_shipping: true` — unchanged |
| $59 funnel page | **200**, 168 KB, carries product `6a9185da778550cdf732a700` **and** price `6a9185e6e5d7f1bbc622c940`, `recurring`, `Monthly`. Live and correctly wired. |
| …and its template leftovers | still carries **"Where Should We Ship It?" ×2** and **"Upgrade Your Order & Save!" ×2** — ⚠ **understated. Re-read on 2026-09-17 with the markup stripped, the page has no headline, no price on step 1 and never says "coach". It is blank, not merely untidy.** See [`07-phase-5-conversion-path.md`](07-phase-5-conversion-path.md) §6 |
| Book landing page | **200** — posts the correct `10434147320122` / `54042631733562` at `29.95`, **and still says `$59/month` ×2, "Cancel anytime" ×1, "SUBSCRIBE NOW" ×1.** Phase 7 confirmed live and wrong. |
| GHL subscriptions in the location | 11 total: **`canceled` ×9, `incomplete_expired` ×2. Still no `active` string ever observed.** |

**Three findings that are new:**

0. 🚨 **Shopify orders are GHL orders in this location, and the only coach order ever placed was
   never paid.** The location holds **3,463 orders**; 99 of the newest 100 are
   `sourceType: external / sourceSubType: shopify` from `get-published-pro.myshopify.com`. Exactly
   one is `funnel / two_step_order_form` — order `6a96ce6e8660770420b15330`, the coach page, with
   the correct product and price at $59 recurring, reading **`status: pending`,
   `paymentStatus: unpaid`**.
   **Both facts constrain the phase 4 purchase workflow's trigger**, and between them they rule out
   every submission-based trigger and any trigger without a product filter:
   an unfiltered one fires on essentially every order the business takes (making every trial
   customer immune to expiry on the day they order), and a submission-based one grants permanent
   immunity to someone whose card declined. Decision and evidence:
   [`06-phase-4-build-runbook.md`](06-phase-4-build-runbook.md) step 1a.

1. **A `$59 incomplete_expired` subscription exists, dated 2026-09-01.** It is *not* a lost
   customer — the contact is `bx5Ukr3lMkZgw1pmgqSg`, `zzzzzzzzzz@zzzz.com`, `+923333333333`,
   created 2026-08-28. It is an internal test of the funnel, and it is the closest thing to
   evidence that the funnel's payment path has ever been exercised. **It still does not give us
   the `active` status string** — see phase 5 step 6.
2. **GHL is syncing Shopify *order tags* onto GHL contacts.** Contact `Qu5bpryFoyfsgcfliC2k`
   (order #4220) carries a GHL contact tag **`shopify_delivered-manual`** that nothing in this
   project wrote. Some Shopify↔GHL integration is live on this location and mirrors order tags as
   `shopify_<tag>`. Harmless today — the Worker matches `ghlTag` exactly and ignores it — but it
   means **the GHL tag namespace is not ours alone**, and a future coach tag must never collide
   with a `shopify_`-prefixed name.

### Live verification sweep — 2026-09-17

| Check | Result |
|---|---|
| Tag census | **exactly 2** — `LUgsYcYM6TcsZ8UwYmUg`, `9xr1rjXSV6Re5ijqmQSz`. Both deliberate. Worker `counts.contacts: 2` agrees. ⚠️ **Still 2 as of 2026-09-22, but not the same two** — `9xr1rjXSV6Re5ijqmQSz` was deleted and `pBbymJS7yAOeoUU71zNq` (staff test) created. See §7 and [`29-later.md`](29-later.md). |
| Contacts with `coach_status` = `active` / `trial` / `expired` | **0 / 0 / 0.** The filter was proven working against a field with 170 hits, so this is a real zero, not a silent failure. **The purchase workflow has never fired, and phase 4's first expiry run will start with an empty population.** |
| GHL subscriptions | 11, unchanged — `canceled` ×9, `incomplete_expired` ×2. No `active` yet. |
| Funnel order `6a96ce6e…` | still `pending` / `unpaid` |
| Shopify bundle | `10434147320122` / `54042631733562`, $29.95, `sku: null`, `weight: 0` — unchanged |
| Landing page (phase 7) | `$59` ×4, "Cancel anytime" ×1, "SUBSCRIBE NOW" ×1 — **still live and wrong** |
| `allowTestSubscriptions`, `declineSms`, `declineVoice` | ✅ **all three set and seeded to production KV** — see phase 9 |
| Worker cron | 🚨 **63 minutes since the last run on a `*/15` schedule**, `/health` still green — see phase 9 |

**A fourth product ID, for the dropdown-trap list.** The funnel subscription record carries
`recurringProduct.product._id = 6a9185da778550cdf732a700` (the one the Worker matches) **and**
`lineItemDetails.productId = 6a91a8e137462c1ae1d83206` — a different ID on the same record. Nothing
is broken, because the Worker reads the former; anything reading the latter finds no coach.

### System B — subscription/trial: build order steps 1–4 done

| # | Task | Status |
|---|---|---|
| 1 | GHL custom fields `coach_status`, `coach_trial_started` | DONE |
| 2 | Premium-trigger decision | DONE — Option A, Inbound Webhook |
| 3 | Workflow created, URL captured | DONE — `Book Coach — Delivery → Trial Start` |
| 4 | Test POST so GHL learns the payload fields | DONE 2026-09-10 |
| 5 | Workflow actions 1–6 (grant path) | **DONE and VERIFIED 2026-09-11** — see below |
| 6 | Workflow actions 7–9 (day 7/9/10) | outstanding — master plan phase 4 |

**Phase 1 verified end to end, 2026-09-11.** Full branch is
`Create contact → Trial guard → Update contact field → Add Tag → Course grant offer → Email`.
A fired test webhook produced a contact with `coach_status: trial`,
`coach_trial_started: 2026-09-11`, and the tag `bookcoach-micheal-stickler-active`. A
`npm run subs -- --dry` then reported `entitled contacts 3, granted 1` — the Worker recognises the
contact the workflow tagged. **That is the two systems proven joined, with no order spent.**

**Re-verified live on 2026-09-13** (second pass, this time against Shopify and the GHL API rather
than the docs): the bundle is still `10434147320122` / variant `54042631733562` at $29.95,
`sku: null`, `weight: 0`; the landing page posts the right product and carries no trace of the old
`10419843137850`; exactly **two** contacts hold `bookcoach-micheal-stickler-active` (yours and
Micheal Stickler’s) and the 09-13 test contact was cleaned up; and **no contact holds the junk
`{{contact.coach_tag}}` tag**, so it can no longer affect anything.

> ⚠ **The private-integration token is narrower than this project assumes — but it is not as
> narrow as this doc used to claim.** Re-probed 2026-09-16. It carries **contacts and payments
> scope only**: `/locations/<id>/tags`, `/locations/<id>/customFields`, `/workflows/` and
> `/emails/builder` all answer `401 The token is not authorized for this scope`. So the tag
> *registry*, the custom-field *registry* and the workflows cannot be listed.
>
> **However — `POST /contacts/search` with a `tags` filter works, and returns exactly who holds a
> tag, with their custom-field values inline.** That is the verification tool this project actually
> needs, and the doc previously said it did not exist. Use it:
>
> ```bash
> curl -s -X POST 'https://services.leadconnectorhq.com/contacts/search' >   -H "Authorization: Bearer $GHL_TOKEN" -H 'Version: 2021-07-28' >   -H 'Content-Type: application/json' -d '{"locationId":"tjdqrnOqMAMheHIt6pQD","pageLimit":100,
>   "filters":[{"field":"tags","operator":"eq","value":"bookcoach-micheal-stickler-active"}]}'
> ```
>
> Plain `GET /contacts/?limit=100` returns only the 100 most recent of **8,893** contacts, so it
> silently misses older tagged contacts. Always use the search endpoint for a tag census.

**Re-verified clean on 2026-09-13** after two defects were fixed (below). One run produced:
contact created, `coach_status: trial`, `coach_trial_started: 2026-09-12`, tag
`bookcoach-micheal-stickler-active`, welcome email delivered, offer granted, and
`npm run subs -- --dry` reporting `granted 1`.

Course offer granted by action 5b: **`AI Coach Final — Micheal Stickler — Life Without Reservation`**.
(An earlier build pointed at `AI Coach Final — Leadership Books — Book Publishing Coach`, a
different coach entirely. Grant Offer resolves **Offers**, not Courses, so the Stickler Offer had to
be created before it could be selected.)

> **Trap 1 — unsaved canvas.** The first attempt set the custom fields and then stopped:
> `tags: []`, no email. The three new actions were on the canvas but had not been **saved**, so the
> published version that executed was still the four-action one. GHL's canvas state and published
> state are separate, and a stale run is indistinguishable from a misconfigured action.
> **If an action appears to do nothing, check Save before debugging it.** Also: `Add Tag` lands
> ~12s after `Update contact field`, so polling too soon reads as failure.

> **Trap 2 — merge fields silently do not work in Add Tag.** Setting the tag to
> `{{contact.coach_tag}}` produced a contact tagged with the **literal string**
> `"{{contact.coach_tag}}"`. GHL accepts the syntax and never interpolates it: no error, no
> warning, workflow runs green, nobody is granted anything. This decided the multi-coach
> architecture — see [`02-multi-coach-scaling.md`](02-multi-coach-scaling.md) §3.
> **Delete the junk `{{contact.coach_tag}}` tag from the location if it still exists.**

**Actions 1–4, as built and verified:**

1. `Create contact` — maps `email` (dedupe key), `first_name`, `last_name`, `phone`.
   Deliberately does **not** write `coach_status`, so an existing contact's value survives the
   upsert and the guard below stays meaningful.
2. `Trial guard` — If/Else. Branch `Fresh - start trial` on `Coach Status is empty`. The `None`
   branch is intentionally empty; that emptiness is the guard.
3. and 4. One `Update contact field` writing `coach_status` = `trial`, `coach_trial_started` = today.

**Proof, 2026-09-10.** `test-ghl-webhook.ps1` fired twice at the published workflow. Run 1 took
`Fresh - start trial` then `Update contact field`. Run 2 took `None` and wrote nothing. That proves
the idempotency guard *and* email-based dedupe, for the price of nothing.

**To re-test after any change:** blank `coach_status` on the test contact first. Left set, every
run correctly stops at the guard — which on screen is indistinguishable from a broken workflow.

---

## 3. The critical finding — two entitlement paths, two sources of truth

Read out of the Worker source, not the docs.

| Path | Entry point | Grants on |
|---|---|---|
| SMS + voice | `reconcileSubscribers` → `sub:<E.164>` leases | tag **OR** active subscription (union) |
| Web session | `handleWebSession` → `codesForTags` | **tag only** |
| Activation-code mint | `handleBindMint` → `codesForTags` | **tag only** |

`codesForTags(env, tags)` reads `contact.tags` against each coach's `ghlTag` (plus `staffTag`).
It never consults subscriptions.

### Two consequences

**1. The tag is the universal key — so grant the trial by tag.** One `Add Tag` action opens all
three channels. No alternative mechanism comes close for the effort.

**2. A paying subscriber without the tag is a second-class citizen.** Today they cannot mint an
activation code (a live gap, though it only bites phone-less buyers). The day `webGateMode` flips
to `enforce`, they lose the web coach while still being billed. That is a silent, paying-customer
failure, and it is currently scheduled to arrive as a *side effect* of a security fix.

### The trap in the obvious fix — ✅ DEFUSED 2026-09-17

"Just add the tag on purchase too" used to create a worse problem. `plans/06` §3a chose
subscription-driven entitlement precisely to avoid depending on a GHL cancellation trigger — *"no
dependency on GHL having a cancellation trigger, the risk that would have undermined Option A."* If
a workflow adds the tag on purchase and cancellation cannot reliably remove it, **a cancelled
subscriber keeps access forever.** That is the exact failure the lease design exists to prevent,
reintroduced by hand.

> **That objection rested on one factual claim, and the claim is now false.** GHL **does** have a
> reliable cancellation trigger — a `Subscription` trigger with Status and Global Products filters,
> confirmed 2026-09-17. Build the remover (phase 5 step 5) **first**, and tagging on purchase
> becomes safe rather than reckless.
>
> **This is now load-bearing, not optional.** With activation moving to code-only, a cold $59 buyer
> has to hold the tag or `handleBindMint` refuses them a code and they cannot activate at all.
> Sequence and reasoning: [`07-phase-5-conversion-path.md`](07-phase-5-conversion-path.md) §2.

### ✅ SHIPPED 2026-09-17 — fixed in the Worker, tag kept as an override

The reconcile now publishes what it already computes. It builds an `entitled` map every 15 minutes
and writes it out as `centitle:<contactId>` holding the codes; `handleWebSession` and
`handleBindMint` read that **in union with** `codesForTags`.

**Union, not replacement.** Either source alone is a legitimate grant: the published map carries
paying subscribers, the live tag read carries trials, staff, comps and manual grants — and it also
covers the ≤15-minute window between a tag being applied and the next reconcile publishing it.
Preferring one would silently drop the other.

**Deployed and verified live**, version `98875553`: first run published 2 entitlements for 2 KV
writes, the next run published 0 for 0 writes. 323 tests.

- Payment status stays the source of truth for paying customers — a subscription record *is* the
  truth, a tag is a copy that drifts.
- Cancellation revokes automatically on all three channels, no GHL trigger required.
- The tag keeps working, as the deliberate manual override for trials, staff, comps and testing.
- Cost is one KV read, not a paginated GHL API call, on paths that run per lesson load.
- Staleness under 15 minutes, which is already the system's contract everywhere else.

**Owner:** coach-router side. ✅ **Done 2026-09-17.** This was the stated prerequisite for
`webGateMode: enforce` (phase 6) — **that blocker is now cleared.**

> ⚠ **One guard needed rethinking on the way in, and it is worth knowing why.** The mass-revocation
> guard is computed over `sub:` leases. With `autoLinkGhlPhone` now `false`, most entitled contacts
> have **no lease at all** until they text an activation code — so that guard is routinely looking
> at a near-empty population and would have waved through a wipe of the entitlement map on one bad
> GHL read. The map therefore has **its own majority guard**, measured against its own previous
> size, reported as `refusedEntitlementRemoval`, with the same `force` override. Caught by a test,
> not in production.

---

## 4. The lifecycle, as a state machine

`coach_status` is **bookkeeping** — it drives workflow branching and the idempotency guard.
The **tag** is **entitlement** — it is the only thing the Worker reads. They are set together,
always, and drift between them is the bug class to watch for.

| Event | `coach_status` | Tag | What the customer can do |
|---|---|---|---|
| Before purchase | *(blank)* | absent | nothing |
| Book delivered | `trial` | **added** | web + SMS + voice, within 15 min |
| Day 7 | `trial` | present | ...plus a $59 offer email |
| Day 9 | `trial` | present | ...plus a reminder |
| Day 10, no purchase | `expired` | **removed** | nothing, within 15 min |
| Subscribed (any day) | `active` | present | everything, indefinitely |
| Subscription cancelled | `expired` | **removed** | nothing, within 15 min |
| Refund / return | `expired` | **removed** | nothing — see §7 open questions |

**Day 10 branches on `coach_status`, never on subscription status.** That remains the right design,
but the reason has changed. ✅ **CORRECTED 2026-09-19 — the ACTIVE string IS now observed: `active`.**
A test-mode purchase through the live funnel produced `status: "active"`, and a declined card
produced `incomplete`; `GHL_SUB_ACTIVE = {'active','trialing'}` matches, so no code change is needed.
*(The previous text here said it "has never been observed" — true until 2026-09-19, stale after.)*

**So why still branch on `coach_status`?** Because one status string being confirmed does not make
the vocabulary safe: GHL's own trigger UI lists `Trial`, `Overdue`, `Expired` and `Scheduled`, and
only some of those are Stripe names. `coach_status` is a field this project writes and therefore
fully controls. See phase 5 step 6 for the full vocabulary trap.

**One trial per contact, ever.** The guard is `coach_status is empty`, so a repeat buyer whose
first trial expired gets no second one. That is a policy, encoded — almost certainly the right
one, since the trial sells the coach rather than the book, but it should be a choice.

---

## 5. Build phases

Ordered by dependency and by what is bleeding. Owner column: **M** = Muhammad (GHL/Shopify UI),
**C** = code, in the coach-router repo.

### Phase 1 — Finish the trial grant path — ✅ **DONE** · built 2026-09-11, copy corrected 2026-09-19 · owner M

> 🚨 **The live welcome email became untrue on 2026-09-17.** Turning off `autoLinkGhlPhone` means
> **every** customer must now fetch an activation code from inside the course and text it in. The
> live email says *"No login, no password, no code to remember"* — the exact opposite — and that
> sentence has reached every trial customer since order #4217.
>
> **Rewritten copy is ready:** [`01-phase-1-grant-path.md`](01-phase-1-grant-path.md), Action 6.
>
> **Two knock-on effects, both important:**
>
> 1. 🚨 **The Course360 lesson URL is now a HARD BLOCKER.** The old advice — *"ship with the web
>    link omitted rather than pointing at a URL you will have to retract"* — is now dangerous:
>    without the course link there is **no route to an activation code and therefore no coach at
>    all**. The live email still contains the literal `[LINK TO COURSE360 LESSON - PENDING]`, which
>    went to orders #4217–#4220. That was embarrassing before; it is now a total onboarding failure.
>    ✅ **URL resolved 2026-09-17** — `https://login.leadershipbookspublishers.com/courses/products/d818952a-d5a6-46ca-afae-57d1a924b8f9`,
>    verified 200 and returning the member sign-in page when logged out. It is in the rewritten copy.
>    **Still to do: paste the rewritten email into the live GHL workflow action.**
> 2. 🟢 **The 15-minute wait is gone, and the two-email contradiction resolves itself.** Verified in
>    the Worker source 2026-09-17: `handleBindMint` reads tags **live from GHL**, and
>    `redeemBindToken` writes the 48h `sub:` lease **immediately** on redemption — neither waits for
>    the cron. And Course360's automatic *"create your password"* email is now **step 1 of the
>    correct sequence** rather than a contradiction.

Inside the `Fresh - start trial` branch, after the field update:

| # | Action | Detail |
|---|---|---|
| 5a | **Add Tag** | `bookcoach-micheal-stickler-active` — this is what actually grants access |
| 5b | **Grant Course360 course** | the course holding the coach lesson. Needs the offer name — §7 |
| 6 | **Send welcome email** | see below |

**The welcome email should lead with SMS, not the web page.** SMS and voice are genuinely gated
today; the web coach is open to anyone with the URL. SMS also needs no course access and no login.
And if Shopify passed a phone number, the handset auto-links and they never see an activation code.

Must-haves in the copy:

- **"Your coach is ready within 15 minutes"** — the reconcile is a cron, not an instant grant.
  A buyer who clicks 30 seconds after the email lands gets "no active coach subscription" and
  emails you. This one line prevents a support queue.
- Text or call **+1 854 254 5009**
- The coach page link, for non-US buyers — SMS is US 10DLC only
- The trial's end date in plain words, so "I didn't realise" is hard to claim

**Verify by:** blanking `coach_status` on the test contact, re-firing `test-ghl-webhook.ps1`,
then `npm run subs -- --list` in coach-router to confirm the tag produced a lease.

### Phase 2 — Shopify Flows · owner M — ✅ **COMPLETE 2026-09-16, both paths proven live**

Verified against the live GHL API, not a screen. Four real orders, both paths:

| Order | `coach_trial_source` | Path |
|---|---|---|
| #4217, #4220 | `shopify_flow_manual` | Flow B — tag + Run workflow |
| #4218, #4219 | `shopify_flow_backstop` | **Flow A — the timer** |

All four produced `coach_status: trial`, `coach_trial_started`, the entitlement tag, and a Worker
lease. **The commercial layer works end to end on both paths.**

> ### ✅ Flow A’s Wait is 21 DAYS — reported done by Muhammad 2026-09-17
>
> **Verbatim, 2026-09-17: _"I have changed flow A back to 21 days."_** Reported alongside
> "Flow A is ON" and the wallet balance confirmation.
>
> ⚠️ **This was never recorded here until 2026-09-21, and the omission caused real harm.** The
> banner below kept saying "still 5 minutes" for four days after it was fixed. A later session
> audited the docs, found no record of the change, and correctly raised it as the project's single
> largest open risk — a false alarm created purely by a documentation gap.
>
> 🚫 **Nobody can verify this from outside.** Shopify Flow has no public endpoint and there is no
> Shopify credential anywhere in the tree. **The only evidence is Muhammad's report**, and the only
> independent confirmation available is indirect: on the next real Flow A order, `coach_trial_started`
> should land ~21 days after the order date. Both are readable via the tag census.
>
> **Historical record of the defect, kept because the reasoning still matters:**
>
> #4218 and #4219 were ordered and started the same day, so the Wait had not been lengthened. **Left
> at 5 minutes, every real customer starts their 10-day trial ~5 minutes after ordering** — before
> the book is printed, let alone delivered — and the trial expires roughly a fortnight before the
> parcel lands. That is precisely the harmful direction §1 of the spec warns about.
>
> ~~**Change it to 21 days, then confirm the workflow is still On.**~~ ✅ **Done 2026-09-17.**
>
> ### 🔴 Phase 4 makes this bug worse, so fix it FIRST — 2026-09-16
>
> Today the 5-minute Wait means a customer gets their coach ~5 minutes after ordering and then
> **keeps it forever**, because nothing expires anything. Annoying, not fatal.
>
> **The moment phase 4 ships, the same bug becomes fatal:** trial starts at order + 5 min, the
> day-7 and day-9 sales emails land while the book is still at the printer, and **access is dead on
> day 10 — roughly eleven days before the parcel arrives.** The customer pays $29.95, receives a
> book, and their coach was already switched off before they could open it. The two bugs compound.
>
> **Therefore: the Flow A Wait must be 21 days before phase 4 goes live.** It is 30 seconds of work
> gating a 90-minute build. Do it first.

**Full spec: [`03-shopify-flows.md`](03-shopify-flows.md).** Read that, not this summary.
**Click-by-click build: [`04-phase-2-build-runbook.md`](04-phase-2-build-runbook.md).**
**It was corrected on 2026-09-13** — the 2026-09-12 draft named a trigger that does not exist and
an action this store may not be entitled to.

#### Both gates cleared — 2026-09-13

| Gate | Answer | Consequence |
|---|---|---|
| **A** — is `Send HTTP request` available? | **Grow plan** | ✅ Available (Grow, Advanced, Plus — not Basic or Starter). Build the flows as specced. |
| **B** — payment capture | **Automatic** | ✅ Flow A triggers on **`Order paid`**. Unpaid, authorise-only and fraud-held orders never start a trial. |

> ⚠ **Switching payment capture to manual would break Flow A silently.** `Order paid` does not fire
> for authorised-but-uncaptured orders, so the trigger would stop firing and no trial would ever
> start, with no error anywhere. The manual-capture variant is kept in the spec §2.2 for that day.

**The three-flow hierarchy inverted once IngramSpark was confirmed manual (2026-09-12/13),** and the
survivors were renamed so the names stop encoding the old hierarchy.

| Was | Now | Role |
|---|---|---|
| Flow 2 — carrier `DELIVERED` | — | ❌ **impossible.** Do not build. |
| Flow 3 — time-based | **Flow A** | ⚠ **the primary path** — order → wait 21 days |
| Flow 1 — `delivered-manual` tag | **Flow B** | **accelerator** — starts the trial early when a delivery is known |

**21 days, erring late on purpose.** Starting the clock before the book lands is the harmful
direction — the reader burns trial days on a coach for a book they cannot read, and the trial
expires around when the parcel arrives. Starting late only costs delay. Revisit after ~20 real
orders. Flow’s `Wait` caps at 90 days per workflow, so 21 is comfortably inside it.

**Both flows must condition on `order contains product 10434147320122`.** Without it, tagging any
unrelated order starts a coach trial. Key on product ID, not SKU — the bundle has `sku: null`
(re-verified live 2026-09-13) and this catalogue already has a duplicate-SKU collision.

#### Three corrections that change what gets built

1. **There is no `Order tags added` trigger in Shopify Flow.** Order triggers are exactly:
   `Order canceled`, `Order created`, `Order deleted`, `Order fulfilled`, `Order paid`,
   `Order risk analyzed`, `Order transaction created`. Tag-change triggers exist for **customers
   only**. Flow B therefore triggers on `Order created`, conditions on the `delivered-manual` tag,
   and is fired by hand from the order: **More actions → Automate with Flow → Run workflow**.
   Native, no third-party app, and it keeps both the product condition and the `coach-started` lock.
2. **Flow A needs a cancel/refund guard.** Order → wait 21 days → fire, with no check that the
   order is still alive, means a buyer who cancels on day 2 gets a welcome email on day 21 for a book
   they returned. Add `cancelledAt is empty` **and** `displayFinancialStatus is not REFUNDED /
   PARTIALLY_REFUNDED / VOIDED` after the wait. This works because **Flow refreshes workflow data
   when a wait ends** — verified, and it is the assumption the whole idempotency design rests on.
3. **Send `order.email`, not `order.customer.email`.** `order.customer` is null on guest checkouts
   with accounts off and after a GDPR erasure. Email is GHL’s dedupe key, so an empty one creates an
   un-deduplicable contact and permanently breaks the one-trial-per-contact guard for that person.
   Names likewise from `order.billingAddress`, not `order.customer`.

#### One thing to do in GHL at the same time

**Nothing currently stores `source`.** Phase 8 below, and the spec, both say to check it daily for
three weeks after launch — an instruction that cannot be followed, because the payload carries
`source` and GHL discards it. Create `coach_trial_source` and `shopify_order_number` custom fields
and add them to the existing `Update contact field` action. Re-fire `test-ghl-webhook.ps1` first;
GHL cannot map a field it has never received.

### Phase 2.5 — what the first live test proved · 2026-09-15

**Order #4217, Flow B.** The Shopify half is **verified end to end**. Flow's run log showed
`Condition was true` with all three criteria green — including `None of order / tags`, which the
canvas card renders ambiguously and which the engine confirmed — and the exact request body it sent:

| Field | Sent | Verdict |
|---|---|---|
| `email` | `tester1@example.com` | ✅ **`order.email` resolves.** The 2026-09-12 draft's `order.customer.email` was never needed |
| `first_name` / `last_name` | `Muhammad Zain` / `Vazir` | ✅ `order.billingAddress` resolves |
| `phone` | `""` | ⚠ **empty — the order carried no phone.** Expected, not a bug: this contact will need the activation code, since nothing auto-links the handset |
| `shopify_order_id` | `gid://shopify/Order/7521018609978` | ✅ a GID, exactly as predicted |
| `shopify_order_number` | `#4217` | ✅ |
| `delivered_at` | `2026-09-15T12:38:23Z` | ✅ order-creation time, reporting only |
| `source` | `shopify_flow_manual` | ✅ |

**It then failed on the GHL side with `422 — LOCATION does not have enough funds`** — the premium
trigger billing problem (phase 9). **Shopify did everything correctly.**

### ✅ PROVEN END TO END once the wallet was funded — 2026-09-15

The wallet was topped up inside Flow’s 24-hour retry window, **the retry completed on its own, and
no order was wasted.** That is the `On client error (4XX) → Retry` setting earning its place.

Verified against the live GHL API and the Worker’s KV, not from a screen:

```
GHL contact ZEDCeK8nwUF0fzZmFByT  (tester1@example.com)
  coach_status          trial
  coach_trial_started   2026-09-15
  coach_trial_source    shopify_flow_manual      <- new field, works
  shopify_order_number  #4217                    <- new field, works
  tags                  bookcoach-micheal-stickler-active

coach-router  npm run subs -- --list
  +923403213330   codes=1042   lease 48h left   contact=ZEDCeK8nwUF0fzZmFByT
```

**Shopify order → Flow B → GHL webhook → contact + tag → Worker cron → 48h entitlement lease.**
The whole commercial layer, working, for the first time. Phase 2’s Flow B path is done.

Incidental: the contact **already existed** (added 2026-08-18) with `coach_status` empty, so this
also re-proved email dedupe *and* the trial guard on a real pre-existing contact rather than a
freshly created one.

> ⚠ **This now blocks the Flow A test.** `coach_status` on that contact is `trial`, so a second
> order from `tester1@example.com` will correctly stop at the guard and look exactly like a broken
> Flow A. **Use a different email, or blank `coach_status` first.**

Two incidental findings worth keeping:

- **A 100%-discounted $0.00 order still reports `Paid`.** So Flow A (`Order paid`) can be tested
  with a free order too — no need to spend $29.95 twice.
- **The run fired automatically on `Order created`, not from the manual run**, because the draft
  order was tagged `delivered-manual` *before* being converted. Real customer orders will not be,
  so the manual run is still the path — but pre-tagging a draft order is a faster way to test.

### Phase 3 — End-to-end test with a real order · owner M

1. Place a real order for the bundle (**$29.95**, product `10434147320122`)
2. Add `delivered-manual` by hand, then **More actions → Automate with Flow → Run workflow**
   (this exercises Flow B; Flow A cannot be tested on demand — build it with a 5-minute wait first)
3. Confirm: contact in GHL, `coach_status` = `trial`, tag present, welcome email arrives
4. Wait up to 15 min, then text `+1 854 254 5009` from the phone on the order — coach replies with
   no activation code
5. **Add the tag a second time** → confirm nothing changes (the Shopify-side lock)
6. Refund yourself

Step 4 is the one that proves both systems are actually joined. Everything before it only proves
System B talked to itself.

### Phase 4 — Day 7 / 9 / 10 sequence · owner M · ✅ **BUILT AND PROVEN 2026-09-18**

> Resumed 2026-09-17 after being paused on 09-16. Waits are 7/2/1 **days**, published. The expiry
> chain ran end to end on 2026-09-18 — tag removed, `coach_status` = `expired`, all three emails
> delivered, census clean. The declined-card negative test passed the same day.

> ✅ **A TRIAL HAS NOW ENDED — 2026-09-18.** The first one ever. Step 4a passed end to end: tag
> removed, `coach_status` = `expired`, all three emails delivered, census clean. **The sequence
> below is built and proven; what remains is switching the waits to real days (step 5), fixing the
> day-0 welcome email (4b), and the two payment tests (4c/4e).**
>
> **Historical, kept for context:** nothing used to end a trial. Phase 2 started them; nothing
> stopped them. The tag was never removed, so the Worker renewed the 48h lease **forever**, and
> every trial started since 2026-09-15 was permanent.
>
> **What exists today is a free coach, not a trial.** There is no day-7 offer, no day-9 reminder,
> no day-10 expiry, and therefore no revenue event anywhere in the system. Until this ships, the
> more successful phase 2 is, the more free lifetime access it gives away.
>
> **Unblocked:** the day-7 email needs somewhere to send people, and the funnel page is confirmed
> live — see phase 5 step 1.

**Full spec: [`05-phase-4-trial-expiry.md`](05-phase-4-trial-expiry.md).**
**Click-by-click: [`06-phase-4-build-runbook.md`](06-phase-4-build-runbook.md).**
Both written 2026-09-16. Read them, not this summary.

#### Progress when paused — 2026-09-16

| Runbook step | State |
|---|---|
| 0a — delete the five test contacts | ✅ done; tag census now returns **2**, both deliberate |
| 0b — wallet funded | ✅ confirmed |
| 0c — `coach_status` field type | ✅ **single-line TEXT**. No dropdown options needed. |
| 0d — workflow re-entry OFF | ✅ confirmed |
| 1 — `Book Coach — Coach Subscription Started` | ✅ **BUILT AND PUBLISHED** — `Order Submitted` trigger, filtered on product *and* price, one action `coach_status` = `active`. **This is also phase 5 step 4.** |
| 2 — three email templates | ✅ **DONE 2026-09-17 — all three written.** `Book Coach — Day 7 offer`, `Book Coach — Day 9 reminder`, `Book Coach — Trial ended`. Verdana 16px / 1.5, matching day 0. **Built as saved TEMPLATES, not Quick compose** — see the correction below |
| 3 — extend the trial workflow (7/2/1 **minutes**) | ✅ **BUILT AND SAVED 2026-09-17.** Canvas verified from a screenshot: three `Coach Status is trial` gates, **all three `None` branches empty → END**, `Wait 2` / `Wait 1`, and day 10 ordered `Remove Tag` → `expired` → `Email (Day 10)`. ⚠ **Two things the screenshot could not show**: the first `Wait 7 mins` was cropped, and the card labels (`Email (Day 7)` etc.) do **not** prove the right template is selected inside each action. **Both are settled by running step 4a** — see below |
| 4a — the expiry chain | ✅ **PASSED 2026-09-18 — the first trial in this project's history to actually end.** Contact `pACELF0GTDE4vgGOGLtO` (`muhammadzain+test1@…`) read `coach_status: expired`, `tags: []`, `coach_trial_started: 2026-09-18`, `coach_trial_source: test`. Day 7, 9 and 10 emails all delivered. Tag census returned to **2** (the deliberate grants only); Worker `/health` ok, no residue. **This also retro-verified step 3's two unverifiable items** — the day-7 email landing on time proves the `Wait 7 mins`, and the three arriving in order proves the templates are correctly selected. ⚠ **`granted: 0` / `revoked: 0` on the Worker is EXPECTED, not a failure**: the tag existed for ten minutes against a fifteen-minute cron, so the Worker never saw it. The Worker half was proven separately by the four real orders in phase 2 |
| 4b — 🔴 **the day-0 welcome email did NOT arrive** | Days 7/9/10 reached the same address, so delivery works — day 0 specifically did not send. **Two day-0 emails exist and they come from different senders:** Course360's automatic `Welcome!` (from `Grant Offer`, `support@reply.leadershipbookspublishers.com`) and GHL's `Your BookCoach AI is ready!` (from `Send Email`, `MuhammadZain@leadershipbooks.com`). Most likely the `Send Email` action was detached or emptied while the wait steps were added. **Must be fixed before real traffic** — without it a customer has no activation instructions at all |
| **4e — the declined-card negative test** | ✅ **PASSED 2026-09-18.** A live decline (`4000 0000 0000 0002`) through the real funnel created **no contact at all** — no `coach_status`, no tag, no workflow run. **`Order Submitted` is proven to be the correct trigger.** This rules out the worst failure in the system: a submission-based trigger would have granted permanent, unexpirable access to everyone whose card declined. Cost: nothing |
| 4c — the purchase happy path | ✅ **PASSED 2026-09-19 via Stripe test mode** (free route B in [`09`](09-live-transaction-test.md)). The contact received the **tag**, `coach_status` = `active`, and the **post-purchase email sent** — the three actions on that workflow that had never executed are now proven. Funnel confirmed switched **back to Live**. ⚠ Not proven on a genuinely `liveMode: true` payment; test mode is a faithful simulation, not the thing itself. Original note: |
| ~~4c~~ | ⬜ Step-by-step: [`09-live-transaction-test.md`](09-live-transaction-test.md). One real card settles **five** open items at once — the purchase workflow firing (its `Add Tag`, `Grant Offer` and post-purchase email have never executed), the ACTIVE status string, subscription-sourced entitlement, the Stripe portal round trip, and the cancellation-timing question. ⚠ `4242…` **declines in Live mode** — real card for the happy path, `4000 0000 0000 0002` for the negative test |
| 5 — switch waits to 7/2/1 **days** | ✅ **DONE 2026-09-18** (Muhammad) — waits are 7/2/1 days and the workflow is Published. **The live hazard is closed.** Original note: | Deliberate deviation from the runbook's order: the minutes config is a **live hazard** — any real Shopify order landing now starts a trial that dies ten minutes later, before the book ships. The expiry chain is proven; leaving it in minutes buys nothing and the risk compounds hourly |
| 6 — `declineSms`/`declineVoice` + `npm run seed` | ✅ **DONE 2026-09-17**, seeded to production KV |

**Nothing in phase 4 is live.** The trial workflow is untouched, so trials still never end. The
purchase workflow *is* live, which is harmless on its own — it only writes `coach_status` = `active`,
and nothing yet reads that value.

> 🚨 **The unchanged risk:** every trial started remains permanent, and there is still **no revenue
> event anywhere in the system.** Contacts that have already exited the workflow will never expire
> even after phase 4 ships.

**The sketch that used to live here had four defects, all fixed in the spec:**

| # | The defect | What it would have done |
|---|---|---|
| 1 | **The day-10 branch has no prerequisite named.** Nothing sets `coach_status` = `active` on purchase — that is phase 5 step 4, and it is not built. | A customer who subscribes on day 8 still reads `trial` on day 10: **the tag comes off and they are revoked within 15 minutes while being billed $59/month.** Phase 4 **cannot ship without phase 5 step 4**; the runbook builds it first. |
| 2 | **7 + 2 = day 9, not day 10.** | The tag was removed a day early, with the reminder and the expiry firing back to back. A third `Wait 1 day` is now in the chain. |
| 3 | **Only day 10 was guarded.** | Someone who subscribed on day 3 stayed enrolled and **was sold the same subscription twice more**, on days 7 and 9. All three email steps now carry `Coach Status is trial`. |
| 4 | **Nothing specced what an expired user is told.** `declineSms`/`declineVoice` are empty, so the Worker's default fires: *"open your members area and follow the activation steps."* | It sends someone whose trial just ended to chase an activation code that **cannot** work — their problem is a missing tag, not an unlinked handset — and points at the generic site rather than the page that takes their money. **The last conversion surface in the funnel, currently misdirecting.** One `coaches.json` line + `npm run seed`. |

**The guard direction is deliberate: `is trial`, never `is not active`.** `is trial` fails toward
*keeping* access — an unexpected value means no sales email and, crucially, no tag removal.
`is not active` fails toward cutting off a payer. Over-granting costs money; cutting off a payer
costs a refund, a chargeback and a support thread.

**Confirm workflow re-entry is OFF before the Wait steps exist.** A contact now sits enrolled for
10 days; a duplicate delivery webhook inside that window would spawn a second set of timers and
send everything twice.

**The $49 early-continuation lever is DROPPED for v1** (Muhammad, 2026-09-16). It doubles the price
surface and needs a second GHL price, against zero conversion data. Revisit once the day-7 baseline
is known.

**The one-click prefill is REAL** — verified in a browser 2026-09-16:
`…/michael-stickler-coach-access?full_name=…&email=…` fills the order form. That makes the handoff
doc §2.3 tactic buildable rather than hoped-for.

### Phase 5 — The $59 conversion path · owner M, then C · ✅ **ALL 7 STEPS DONE 2026-09-19**

> **Step 1** funnel rebuilt · **step 3** closed (GHL cannot make phone required) · **step 4**
> purchase workflow live, fired, and now also granting the course offer + post-purchase email ·
> **step 5** cancellation workflow live · **step 6** the ACTIVE string is **`active`** — observed,
> and `GHL_SUB_ACTIVE` already matched · **step 7** Stripe portal live and linked.
>
> ⬜ **Not closed by any of that:** one genuinely `liveMode: true` purchase, and a cancellation
> reaching period end. Both wait on time or money, not on work. [`09`](09-live-transaction-test.md).

**Full spec: [`07-phase-5-conversion-path.md`](07-phase-5-conversion-path.md)** — written 2026-09-17.
Read that, not this summary. What follows is kept only as the decision trail.

1. 🟢 **REBUILT 2026-09-17 — published and verified live.** Shipping is off, the template
   leftovers are gone, the headline and `$59/month` are on step 1, and the recurring-terms line
   sits in step 2's security slot beside the pay button carrying the real cancellation address.
   Served at both `/michael-stickler-coach-access` and `/order-form-page` — **same page, two
   routes, no decoy funnel.**
   ⬜ **Four items remain**, one of them a live contradiction: the benefit block says *"Cancel any
   time - just reply to this email"* on a **web page**, which nobody can act on and which
   contradicts the correct terms line lower down. Full list:
   [`08-funnel-and-landing-copy.md`](08-funnel-and-landing-copy.md) §1.
   > **Trap:** the first edit pass was not saved and published, so the live page was unchanged apart
   > from GHL's build hashes. Same class as `Trap 1 — unsaved canvas`. **Confirm the publish before
   > verifying.**
   `https://www.book-coach.ai/michael-stickler-coach-access` returns 200 with a GHL order form
   wired to the right product (`6a9185da778550cdf732a700`) and price
   (`6a9185e6e5d7f1bbc622c940`), Stripe connected, recurring/Monthly. **`coaches.json` was right;
   `plans/07` step 5 is stale.** Do not rebuild it.
   ⚠ One thing to check: the page carries *"Where Should We Ship It?"* and *"Upgrade Your Order &
   Save!"* — leftovers from a physical-product funnel template. A shipping address on a digital
   subscription confuses buyers and invites support mail. Worth a pass over the copy.
2. If not built: follow `coach-router/plans/07-ghl-funnel-setup.md`. The product already exists —
   `Michael Stickler - Coach Access`, `6a9185da778550cdf732a700`, $59/mo, Stripe connected.
   **Do not create it again.** Build-order step 11 in the old doc is already done.
3. ✅ **CLOSED 2026-09-17 — GHL cannot make the phone field required.** Confirmed in the builder
   (Muhammad) *and* independently in the live page's config block, which exposes
   `fullNameValidation` and **no `phoneValidation` / `phoneRequired`** — a required-toggle exists
   for full name only.
   **DECISION 2026-09-17 (Muhammad): activation is by CODE ONLY.** A handset is linked when the
   subscriber texts an activation code, and by nothing else. Supplying a phone on a form must not
   grant a working phone.
   ✅ **SHIPPED 2026-09-17 — `autoLinkGhlPhone: false`**, deployed and seeded. A phone on a contact
   or on a subscription record no longer links a handset; only a texted activation code does.
   Kept as a config flag rather than deleted, so it is reversible with `npm run seed` and no
   redeploy. Existing `bind:` records were untouched — nobody already linked lost access.
   **The two prerequisites were done first, in order:** the cancellation workflow (step 5), then
   `Add Tag` on the purchase workflow (step 4), then this. Without them a cold $59 buyer would have
   held no tag, been refused a code by `handleBindMint`, and had no way to activate at all.
   The phone field itself stays, optional. It is now ordinary contact data.
4. 🟡 **BUILT 2026-09-16, and needs TWO MORE ACTIONS.** Workflow
   `Book Coach — Coach Subscription Started`, live and published, **never fired**.
   🚨 **The cold-buyer hole, found 2026-09-17.** It sets `coach_status` and adds the tag — but
   **grants no course offer and sends no email**. The activation box only renders when the coach
   page is iframed from the Course360 lesson (`?cid=…&em=…`), and only phase 1 grants that offer.
   So **a $59 subscriber who never had a trial has no route to an activation code and cannot use
   SMS or voice at all** — they keep web chat only, and solely because `webGateMode` is still
   `warn`. **Adding the tag fixed the minting permission, not the route to the minting UI.**
   ✅ **BOTH FIXED 2026-09-18 (Muhammad).** `Grant Offer` → `AI Coach Final — Micheal Stickler —
   Life Without Reservation`, and the post-purchase email is pasted in. **The cold-buyer hole is
   closed.** ⚠ **All three actions on this workflow have still never executed** — verify with
   [`09-live-transaction-test.md`](09-live-transaction-test.md) step 2.
   ⚠ **Fix before phase 6.** When the web gate hardens, a cold buyer loses their last working
   channel and has nothing while being billed.
   ⚠ **`Add Tag` must be added to it** once step 5 exists — see §3 above and `07` §2. Without it a
   cold $59 buyer cannot mint an activation code, which matters the moment the phone auto-link is
   switched off. The "deliberately no Add Tag" note below was correct only while GHL had no
   cancellation trigger.
   Trigger **`Order Submitted`** (NOT `Order Form Submission` — that one fires on the form event
   regardless of payment, so a declined card would have granted permanent, unexpirable access),
   filtered on product `Michael Stickler - Coach Access` **and** the $59 monthly price. One action:
   `coach_status` = `active`. **Deliberately no Add Tag** — see §3 and `05-phase-4-trial-expiry.md` §4.
   ⚠ **Still unverified:** it has never fired. The happy-path and declined-card tests are runbook
   steps 4c and 4e, which were not reached.
5. ⬜ **UNBLOCKED 2026-09-17 — GHL does have the trigger.** It ships a **`Subscription`** trigger
   with a **Status** filter and a **Global Products** filter; the statuses are `Active`, `Canceled`,
   `Expired`, `Incomplete Expired`, `Incomplete`, `Overdue`, `Scheduled`, `Trial`, `Unpaid`.
   Build `Book Coach — Coach Subscription Cancelled`: trigger `Subscription`, filtered on the
   product **and** Status = `Canceled`, actions `coach_status` = `expired` + `Remove Tag`.
   **`Canceled` only — not `Overdue`/`Unpaid`**, which are transient retry states; the decaying
   lease already handles a failed payment correctly. Full build in `07` §3.
6. ✅ **RESOLVED 2026-09-19 — the ACTIVE status string is `active`.** Observed at last, from a
   test-mode purchase through the real funnel:
   `status: "active" | liveMode: false | 59 | tester2@example.com`.
   **The Worker's inference was correct** — `GHL_SUB_ACTIVE = {'active','trialing'}` matches, and
   **no code change is needed.** Open since 2026-08-28.
   **Bonus observation:** a **declined** card produces `status: "incomplete"`, which is correctly
   excluded from `GHL_SUB_ACTIVE` and granted nothing.
   *(Historical: never observed as of 2026-09-17 — 11 subscriptions, `canceled` ×9 +
   `incomplete_expired` ×2.)*
   ⚠ **Riskier than it looked.** `coach-router.worker.js:1576` claims *"GHL proxies Stripe, so
   these are Stripe's names."* Only half true — `Expired` and `Scheduled` are **not Stripe
   statuses**, and `Trial`/`Overdue` are GHL's names for `trialing`/`past_due`, yet the API returns
   Stripe-shaped `canceled`/`incomplete_expired`. **GHL's UI and API vocabularies are not the same
   set.** If the API ever says `trial` rather than `trialing`, `GHL_SUB_ACTIVE` silently refuses a
   paying customer and `/health` stays green. Curl to capture it: `07` §4.
7. **Self-serve cancellation** must exist before launch — a Stripe portal link in the welcome
   email and on the member page. Without it every cancellation is a support email, and chargebacks
   rise.

### Phase 6 — Close the web hole · owner C, then M · DECISION NEEDED

Currently `to-do.md` item 1, **deferred 2026-08-28 at your request**. Stated plainly so the
trade-off is visible rather than implicit:

- The coach page calls `general-runtime.voiceflow.com` **directly**, with `VF_API_KEY` in plain
  page source. Anyone reading source can drain the Voiceflow credits, and credits are a hard stop
  with no mid-cycle top-up — that takes **every** coach offline, not just this one.
- The web coach is **open to the public**. The trial's headline experience gates nothing.
- The gate is already built and dormant: `/api/web/session` mints tokens, `/api/vf-interact` and
  `/api/heygen-token` honour them, and `coach-page-snippet.html` is installed and already picks up
  the `?s=` token. Only the chat's `vfInteract()` still bypasses the Worker.

**Sequence — getting this wrong takes the coach offline:**

0. 🚨 **Close the cold-buyer hole first** (phase 5 step 4 — add `Grant Offer` + a post-purchase
   email). Today a cold $59 subscriber keeps web chat *by accident*, because the gate is off.
   Hardening it removes that and leaves them with **no working channel at all** while being billed.
   See [`07-phase-5-conversion-path.md`](07-phase-5-conversion-path.md) §3b.
1. ~~Land the §3 Worker change first, or paying subscribers lose web access~~
   ✅ **DONE 2026-09-17** — `handleWebSession` reads the published entitlement map. **This was the
   gating item for phase 6 and it is cleared.**
2. Repoint `vfInteract()` at `/api/vf-interact`; delete `VF_API_KEY` and `VF_VERSION_ID` from the
   page `CONFIG`; re-paste into GHL
3. **Then** rotate the key in Voiceflow
4. **Then** update `vfKey` in `coaches.json` and run `npm run secrets`
5. **Then** `webGateMode: enforce` and `npm run seed`

Rotating before step 2 breaks the live page immediately.

**Assessment:** the trial is enforceable on SMS and voice today and unenforceable on the web until
this ships. That is survivable for a soft launch and not survivable for a real one — a 10-day
countdown that locks nothing on the channel most people will use is a countdown, not a trial.

### Phase 7 — Landing page copy · owner M · ✅ BOTH LIVE DEFECTS CLOSED 2026-09-17

> ✅ **Both defects below were found and fixed the same day.** Verified live: `SUBSCRIBE NOW` → 0,
> the decoy payment link → 0, "Invisible to Viral" → 0 (body, `<title>`, meta, og), the QR code
> claim → gone, "Cancel anytime" → 0, and the corrected price block is live.
> **Remaining on this page:** `AI Publishing Coach` ×12 → rename per the decision in §7, and the
> "Your purchase includes" bullets. Both in [`08`](08-funnel-and-landing-copy.md) §2.
>
> **Kept below as the record — the traps are reusable.**
>
> 1. 🚨 **`SUBSCRIBE NOW` sold the decoy product.** It links to
>    `link.leadershipbookspublishers.com/payment-link/6a997a37a7f78e147447ea71`, which sells
>    **`6a9978eea94350eafc0958c3`** (`BookCoachAI - Monthly (Standard)`) — the decoy in §6 below.
>    **It charges $59/month recurring and grants nothing**: the Worker does not match that product,
>    and both phase 5 workflows are filtered on the correct one, so neither fires. No tag, no
>    `coach_status`, no entitlement, no record. **A live billing defect.**
> 2. 🚨 **The page promises the wrong book.** It is half-built from the *Invisible to Viral* page —
>    `<title>`, meta description and two body sentences still say *Invisible to Viral™*, including
>    *"Your copy of Invisible to Viral™ will be shipped to you"* — while the checkout posts
>    `10434147320122`, which is *Life Without Reservation*. This also explains `AI Publishing Coach`
>    ×12: right name for a publishing book, inherited here.
>
> Both, with evidence and fixes: [`08-funnel-and-landing-copy.md`](08-funnel-and-landing-copy.md)
> §2a-bis and §2b.

> ✅ **Replacement copy is written and paste-ready:**
> [`08-funnel-and-landing-copy.md`](08-funnel-and-landing-copy.md) §2 — drop-in HTML for the price
> block, the button change, and the "Your purchase includes" bullets.
> ⚠ **One gate before publishing:** both pages carry a recurring-terms line that promises a way to
> cancel, and phase 5 step 7 has not resolved. See `08` §3.

Independent of everything above, and cheap. Currently promising *"Then $59/month. Cancel anytime."*
on a checkout that will never auto-bill — a promise not kept, in the direction that generates
disputes, and it throws away the actual selling point. The button says SUBSCRIBE NOW when nobody
subscribes at that step. Full detail and replacement copy in the handoff doc §9.

### Phase 8 — Get real delivery data out of IngramSpark · owner M · FUTURE

**The single biggest accuracy improvement available to this system, and it is blocked on access,
not on code.**

Today the trial clock is a 21-day guess (phase 2). The real delivery date exists — it is just
inside IngramSpark, visible to a human, and nowhere else. Every day of that guess is either trial
time a reader loses or trial time they get for free.

**Blocked on:** IngramSpark credentials. Nobody on this project has them yet.

Once available, in ascending order of effort:

1. **Find out what IngramSpark actually exposes.** It has an FTP/EDI feed and reporting exports for
   publisher accounts; whether a per-order shipment/delivery status with tracking is retrievable is
   **unverified — do not assume it.** That question is the whole gate.
2. **Push tracking into Shopify.** If shipment data can be retrieved, write it onto the Shopify
   order (mark fulfilled + tracking number). That single step revives **Flow 2**, because Shopify
   then generates real carrier `DELIVERED` events — and the 21-day guess collapses to the actual
   delivery date with no further work.
3. **Or bypass Shopify entirely.** The Worker already fronts this system and holds the GHL token.
   An IngramSpark poller there could call the same GHL webhook (or tag directly, per
   [`02-multi-coach-scaling.md`](02-multi-coach-scaling.md) §3) with `source: ingramspark_delivered`.
   More control, and it composes with the Worker-side tagging that is already the chosen design.

**Route 2 is preferable if it works** — it keeps Shopify as the order system of record and reuses
Flow 2 exactly as originally specced, rather than adding a second delivery path to maintain.

**Interim, and cheap:** if someone checks IngramSpark manually anyway, applying `delivered-manual`
to the Shopify order at that moment is already wired (Flow 1) and makes the trial start accurate
for those orders today. **That is worth doing even before any automation exists** — but it needs a
named owner and a habit, or it silently never happens.

**Check `source` on new contacts daily for the first three weeks after launch.** It is the only
thing that says which path fired, and the only way to notice one silently failing. Consider a
`coach_trial_source` custom field — the payload carries `source` today and nothing captures it.

### Phase 9 — Ops hardening · owner M mostly

| Item | Why |
|---|---|
| ✅ **DMARC PASSES — fixed 2026-09-19, no DNS access required** | **Was:** `DMARC: FAIL` on every customer email. SPF and DKIM both passed, but both authenticated `reply.leadershipbookspublishers.com` while the `From:` header said `@leadershipbooks.com` — **neither aligned**, so DMARC failed.<br><br>**Fix:** the `From Email` on all five GHL email actions (welcome, post-purchase, day 7, day 9, day 10) was changed to an address on the **already-verified sending domain**. GHL → Settings → Email Services → SMTP Service confirms the default provider is **mailgun / `reply.leadershipbookspublishers.com`**. `From Name` stays `BookCoach AI`, so branding is unaffected — most clients show the name, not the address.<br><br>**Verified from a delivered message's `Authentication-Results`:** `SPF: PASS` · `DKIM: PASS` with `reply.leadershipbookspublishers.com` · **`DMARC: PASS`**.<br><br>**Side effect — an older finding closed too.** The 2026-09-16 note that *"two different sender names and two different from-addresses in the same minute is a trust and spam-filter problem"* is resolved: Course360's `Welcome!` was already on this domain, so **all five emails now share one aligned sender** across the whole journey.<br><br>⚠ **One thing to confirm:** where replies land now. The email bodies still name `MuhammadZain@leadershipbooks.com` for support, so the stated route is fine — but a customer pressing Reply goes wherever GHL routes it. Check someone watches it. |
| ⬜ **DNS work — for whoever holds the zone** | **Downgraded 2026-09-19 from launch blocker to housekeeping**, now that DMARC passes without it. Neither item gates anything.<br>**(1) Delete the duplicate DMARC record.** `_dmarc.leadershipbooks.com` returns **two** TXT records — keep `v=DMARC1; p=none; rua=mailto:dmarc@leadershipbooks.com`, **delete the bare `v=DMARC1; p=none`**. Per RFC 7489 multiple records = **no DMARC policy at all**, so the `rua=` address collects nothing and none of this is visible to anyone. Safe in both directions.<br>**(2) Add a Mailgun DKIM key for `leadershipbooks.com`** if sending from the brand domain is wanted: GHL → **Settings → Email Services → Dedicated Sending Domain**; GHL issues the exact TXT/CNAME records.<br><br>🚫 **Do NOT modify the existing SPF record.** `v=spf1 include:spf.protection.outlook.com -all` is what makes normal Microsoft 365 mail work, and adding `include:mailgun.org` **would not fix alignment anyway** — SPF alignment is judged on the Return-Path domain, which stays Mailgun's. **DKIM is the only thing that aligns a `From: @leadershipbooks.com`.** |
| 🚨 **Fund the GHL sub-account wallet + auto-recharge** | **The Inbound Webhook is a premium trigger**, ~$0.01/execution from the sub-account wallet, with only **100 free lifetime executions** — spent during testing. An empty wallet answers **422** and **no trial starts at all**. Hit live 2026-09-15. Shopify Flow retries 24h, then a paying customer silently gets nothing. |
| **GHL wallet low-balance alarm** | Nothing warns you before the wallet empties, and the failure mode is total. |
| **Cloudflare Workers Paid, $5/mo** | Free tier is 1,000 KV writes/day, roughly **50 SMS conversations/day**, and it fails hard rather than degrading. Fine for two testers, not for a launch. |
| ⬜ **Uptime monitor on `/health`** | **The top remaining ops item.** Already returns 503 on a stale or failed sync, and since 2026-09-19 also on a cron silent past `cronStaleAfterMinutes` (90). Safe to poll publicly — it names no coach. **Nothing is watching it.** 5 minutes with any uptime service. |
| ✅ **Voiceflow is published and the Worker is pinned to it — 2026-09-19** | **The alias is `main`, not `production`.** `versionID: production` and `development` both return `400 Unable to resolve … alias`; **`main` returns `200`.** `coaches.json` now carries `versionID: "main"`, seeded to production KV; `/health` reports `versionID: main, keyResolved: true`.<br><br>**Proof that `main` is a genuinely separate snapshot** (rather than an alias for the draft, which would give no staging at all): probed side by side, the two differ by one character — `main` says *"today's coaching"* with a **straight** apostrophe, the draft `6a52da46bc446f70628c598d` says *"today’s"* with a **curly** one. The draft has diverged since publication. **Staging is real.**<br><br>🚨 **New failure mode that arrives with it:** a canvas edit **no longer reaches customers until it is published**. That is the entire point, and it is also how someone edits, tests, sees no change live, and concludes the bot is broken. |
| ~~Publish the Voiceflow project~~ — superseded | Muhammad pressed Publish on 2026-09-19, but **the runtime still refuses the alias**: `POST general-runtime…/interact` with `versionID: production` returns **`400 Unable to resolve production version alias`** — byte-identical to the pre-publish result. The draft `6a52da46bc446f70628c598d` still serves `200`. **So there is still no staging: every canvas edit remains instantly live to real users.** Check which *environment* was published to; if it is not Main, the `production` alias will not point at it. **This is a two-step job** — (1) publish so the alias resolves, then (2) `versionID` → `"production"` in `coaches.json` **plus `npm run seed`**, because the Worker reads the version from KV, not the file. ⚠ **Nothing is broken meanwhile**; the Worker is pinned to the draft ID and the coach answers normally. **Better alternative:** if Voiceflow exposes an explicit *published version ID*, pin that directly instead of the alias — a known version beats a moving pointer. |
| **Voiceflow credit alarm** | Blocked on Voiceflow support — ask whether remaining credits are queryable. Credits are a hard stop. |
| **Twilio Advanced Opt-Out** | So Twilio sends the STOP/HELP compliance replies; the Worker stays silent deliberately. |
| ✅ **`allowTestSubscriptions` is `false`** | **DONE 2026-09-17**, seeded to production KV. It cost nothing: the Worker's comment says *"9 of the 10 in this location are test"*, implying the flip would break testing — **not true.** All 9 `liveMode: false` subscriptions belong to **other people's products** (*Where's My Husband?*, *The Truth Mirage*, *Not A Mistake*), which the reconcile discards anyway because they are not in `productCodes`. **Every coach-product subscription that has ever existed is `liveMode: true`.** Verified by a dry reconcile after the flip: `active subs 0`, `entitled 2`, `unchanged 2`, `writes 0`. |
| ✅ **`declineSms` / `declineVoice` set** | **DONE 2026-09-17** (275 / 198 chars), seeded. Copy from [`05-phase-4-trial-expiry.md`](05-phase-4-trial-expiry.md) §6. An expiring subscriber is now pointed at the $59 page instead of being sent to chase an activation code that cannot work. |
| ✅ **`/health` can now detect a dead cron** | **Fixed 2026-09-17** — new `cronStaleAfterMinutes` knob, default **90**, deployed as version `fbdea5e2`. `/health` now returns 503 once the reconcile has been silent past that, long before the 24h lease-staleness alarm. The two are deliberately separate: staleness says *"subscribers are about to lose access"*, which is already too late; cron silence says *"the cron has stopped"*, which is actionable now. Revocation and trial expiry both ride that cron. |
| ⚠️ **CORRECTION — the "four missed runs" on 2026-09-17 was a misread** | An earlier entry here reported the cron had missed four consecutive runs, on the evidence of `lastRunAt 03:01:16Z` read at `04:04Z`. **That conclusion was wrong.** `syncmeta` is written **frugally**: when counts have not changed it is rewritten only once an hour (`SYNCMETA_HEARTBEAT_MS`). So `lastRunAt` legitimately lags a **healthy** cron by up to 60 minutes — and `03:01:16 + 60min = 04:01:16`, meaning a cron firing at ~04:01 would correctly have written nothing, leaving the value at 03:01 until 04:16. The reading was fully consistent with everything working. **`sync.ageMinutes` measures time since `syncmeta` was last WRITTEN, not time since the cron ran**, and `/health` now says so in an `ageMeaning` field so the mistake is harder to repeat. There is no evidence the cron ever stalled. |
| ⬜ **Staff tag `bookcoach-staff-all`** | Grants every coach for internal testing with no purchase. Create it, then tell the coach-router side to set `staffTag`. Worth having before the SMS test, so testers do not need a real order. |
| **Rewrite `TEST-CHECKLIST.md`** | 11 references to the removed coach menu. Anyone running it pre-launch reports failures that are the system working correctly. |

---

## 6. Already done — do not rebuild

- **$59/mo GHL product** — `Michael Stickler - Coach Access`, `6a9185da778550cdf732a700`,
  price `6a9185e6e5d7f1bbc622c940`. Stripe connected. Hidden from the public storefront.
- **Entitlement, leases, revocation, archive, retention, `/health`** — all built, deployed, and
  enforcing on SMS and voice since 2026-08-28.
- **The web gate itself** — `/api/web/session`, token verification on `/api/vf-interact` and
  `/api/heygen-token`, `coach-page-snippet.html` installed. Dormant, not missing.
- **Activation UI** — lives in the coach page, not the lesson, because the Course360 editor strips
  `<script>` **and** `<button>`. `members-activation.html` is superseded; do not install it.
- **Transcripts** — Voiceflow records everything automatically, 6-month retention, nothing to build.
- **The handoff doc's §8 "security gap"** — fix levels 1 and 2 are built. Only the page repoint
  remains.

---

## 7. Open questions — owner named, or it will not get answered

**Blocking a real launch**

- [x] ✅ **Is the GHL sub-account wallet funded?** Confirmed funded by Muhammad 2026-09-17.
      Auto-recharge still unconfirmed — the failure mode below is unchanged if it empties.
      *(Original finding kept:)* Verified broken
      2026-09-15: the first real test order returned `422 — LOCATION does not have enough funds`.
      The Inbound Webhook that starts every trial is a **premium trigger** (~$0.01/execution,
      100 free lifetime executions per sub-account, all spent in testing). **Until this is funded,
      nothing can start a trial**, and the failure is invisible outside a Flow run log.

- [ ] 🚨 **Nobody has a named job of starting trials.** Delivery status lives **only in
      IngramSpark**, checked by a human. Nothing in Shopify or GHL knows a book arrived. So Flow 1
      fires only if someone remembers, which means in practice **Flow 3's 21-day timer is the real
      trial start for most customers**. That is workable, but it should be a decision, not a
      discovery. Either name an owner and a habit for applying `delivered-manual`, or accept the
      timer and say so in the landing page copy. See phase 8 for the fix.
- [ ] **Duplicate SKU.** `Life Without Reservation` paperback and `Life Without Reservation Study
      Guide` both carry sku `9781951648213`. Any Flow condition keyed on SKU matches both —
      **key on product ID.** Also: the bundle itself has `sku: null`; suggested `BC9781951648213`,
      matching the existing convention (`Invisible to Viral™ Book + Personal Coach` uses
      `BC9781951648435`).
- [ ] **Bundle variant `weight` is `0`.** Breaks carrier-calculated shipping rates, and matters more
      if fulfilment ever moves into Shopify (phase 8, route 2).
- [x] ✅ **Does GHL have a reliable subscription-cancelled trigger? YES — resolved 2026-09-17.**
      A **`Subscription`** trigger with Status and Global Products filters, including `Canceled`.
      Phase 5 step 5 is buildable today. See `07` §3.
- [ ] **Does GHL report `Canceled` at cancellation, or at period end?** New, and it decides whether
      the step 5 workflow revokes someone who has paid through the end of the month. The Worker
      already behaves that way for subscription-only customers, so step 5 makes the two paths
      consistent rather than adding a new failure — but which behaviour is *correct* is a business
      decision nobody has made. Cheapest answer: cancel the first real subscription with
      `cancel_at_period_end` and read `status` from the API immediately.
- [~] 🟡 **When does cancelled access actually END? HALF-ANSWERED 2026-09-17 — Stripe's side is
      settled, GHL's is not.** Stripe's customer portal is configured
      **`Cancel at end of billing period`** (seen on the portal settings screen). So on a portal
      cancellation Stripe sets the subscription to expire at period end, keeps `status: active`
      until that date, and only *then* flips it to `canceled`. **That is the customer-friendly
      answer and it needs no decision from us.**
      🚨 **The remaining risk is GHL's mirroring, and it is specific.** Stripe now tells the
      cancelling customer in writing *"you keep access until [date]"*. **If GHL reports `Canceled`
      at the moment of cancellation rather than at period end, the step-5 workflow strips the tag
      that same day and the customer loses access weeks early — holding a Stripe confirmation that
      says otherwise.** A support ticket with a screenshot attached.
      **Test on the first real cancellation:** read the GHL subscription status immediately after.
      `active` → everything lines up. `canceled` → delay the tag removal. Same API call as step 6.
- [x] ✅ **A monitored support email address — `MuhammadZain@leadershipbooks.com`**, provisional
      (Muhammad, 2026-09-17). Now in `08` §3's route-B terms line in place of the placeholder.
      ⚠ **Provisional in two senses:** it is a personal address rather than a role address, so it
      does not survive someone being away or leaving; and it is `.com` where the account elsewhere
      is `.net` (`.com` is confirmed real — it is contact `LUgsYcYM6TcsZ8UwYmUg`). Revisit before
      volume.
- [x] ✅ **What is this coach CALLED, customer-facing? DECIDED 2026-09-17 (Muhammad):**
      **`BookCoach AI - The Life Without Reservation`**, short form **`BookCoach AI`**.
      *(Revised the same day from an earlier `The Life Without Reservation Book Coach AI`.)*
      ⚠ **Note the spacing.** `BookCoach` is ONE word. Four spellings are now in play and only the
      first is the brand: `BookCoach AI` (official) · `Book Coach AI` (**live in the Worker's
      `declineSms`, seeded 2026-09-17 — needs aligning, one `npm run seed`, no deploy**) ·
      `BookCoachAI` (the decoy GHL product, never customer-facing) · `book-coach.ai` (the domain,
      hyphenated and correct as-is).
      **House rule: full name on first use in a piece of copy, `Book Coach AI` every time after.**
      The short form is already the live voice — the Worker's `declineSms` opens *"This line is for
      Book Coach AI subscribers"* and the domain is `book-coach.ai` — so consistency is the default
      rather than extra work. The internal names (`Micheal Stickler` in `coaches.json`,
      `Michael Stickler - Coach Access` in GHL, the Course360 offer name) are **unchanged and stay
      internal**; renaming any of them would break a live match.
- [x] ✅ **Is the QR code real? NO, for now — resolved 2026-09-17 (Muhammad).** There is no QR code
      printed in the book. It was an error inherited from the *Invisible to Viral* copy and **has been
      removed from the landing page** (verified live: 0 occurrences). The trial starts from Shopify
      Flow on the 21-day timer and by no other route. **If a QR code is ever added to a printed
      book, it is a new delivery path and needs its own spec** — it would bypass Flow entirely.
- [x] ✅ **How do subscribers cancel themselves? RESOLVED 2026-09-17 — the Stripe portal is live.**
      `https://billing.stripe.com/p/login/00g7vegVZ5dH8h2fYY`, Active, on the same account as the
      subscriptions. Set to `Cancel at end of billing period`. **Still to do: put the link into the
      funnel terms line and the emails, and verify GHL sees a portal cancellation.** `07` §5.

**Resolved 2026-09-11/13 — kept so the answers are not re-derived**

- ✅ **Shopify plan is Grow** (2026-09-13). `Send HTTP request` — which every phase 2 flow depends on
      — is available on Grow, Advanced and Plus, and **not** on Basic or Starter. Phase 2 is buildable
      as designed.
- ✅ **Payment capture is automatic** (2026-09-13). Flow A therefore triggers on `Order paid`, which
      skips unpaid, authorise-only and fraud-held orders for free. **If capture is ever switched to
      manual this breaks silently** — `Order paid` stops firing and no trial starts, with no error.

- ✅ **The landing page charged $59 for the wrong product.** It posted
      `product-id 10419843137850` (`BookCoach AI - Monthly Standard`, $59 one-time, not the book)
      under cosmetic `$29.95` text. **Fixed** — now posts `10434147320122`, variant
      `54042631733562`, **$29.95**, single Add to Cart form. The old $59 product is hidden in both
      Shopify and GHL.
- ✅ **The bundle product exists:** `Life Without Reservation + Your Personal AI Coach`,
      id **`10434147320122`**, handle `life-without-reservation-your-personal-ai-coach`,
      variant `54042631733562`, $29.95, `requires_shipping: true`, published 2026-09-11.
      It was created on 2026-09-11 — which is why the earlier catalogue search could not find it.
- ✅ **Course360 offer:** `AI Coach Final — Micheal Stickler — Life Without Reservation`.
      Note the Grant Offer action needs an **Offer**, not a Course — the Offer had to be created
      first. The course's other lessons (`Lesson 1: The What` etc.) are **template filler**, which
      is what makes the "My Coaches" consolidation in `02-multi-coach-scaling.md` §4b viable.
- ✅ **Lesson iframe verified:**
      `https://www.book-coach.ai/michael-stickler?cid={{contact.id}}&amp;em={{contact.email}}` —
      correct coach, both merge fields present. `&amp;` is correct HTML encoding.
- ❌ **Required checkout phone — DECLINED (Muhammad, 2026-09-12).** The activation-code path already
      lets a buyer link any handset, and a required phone field costs checkout conversion on this
      audience. Buyers who leave a phone still auto-link; the rest use the code.

**Cleanup — ✅ RESOLVED 2026-09-16.** All five test contacts below were deleted; the tag census now
returns exactly **2** (`LUgsYcYM6TcsZ8UwYmUg` and `9xr1rjXSV6Re5ijqmQSz`, both deliberate), and the
Worker's `/health` agreed at the following reconcile. The table is kept as the record of what was
removed and why.

**Cleanup owed — historical, now done**

As of 2026-09-16, **five test contacts hold `bookcoach-micheal-stickler-active`** and are being
granted a renewing 48h lease by the Worker every 15 minutes:

| Contact | Email | Note |
|---|---|---|
| `ODXV9VdMb4qSLs6eL8LG` | `coachtest+ghl@leadershipbooks.com` | from `test-ghl-webhook.ps1`; phone `+15551234567` is **fake and bound in KV** |
| `ZEDCeK8nwUF0fzZmFByT` | `tester1@example.com` | order #4217, Flow B |
| `Qu5bpryFoyfsgcfliC2k` | `tester2@example.com` | order #4220, Flow B |
| `0ysjoG8xaNYrDwSIugs3` | `tester3@example.com` | order #4219, **Flow A** |
| `goQnXRfFY6MxYpnqERPw` | `tester4@example.com` | order #4218, **Flow A** |

**Delete them in GHL; the next reconcile revokes within 15 minutes.** Two contacts are tagged with
`coach_status` blank and should be **left alone** — `LUgsYcYM6TcsZ8UwYmUg` (Muhammad) and
`9xr1rjXSV6Re5ijqmQSz` (the author): those are deliberate manual grants, not test residue.

> **Re-verified live 2026-09-16** via `POST /contacts/search` — still exactly these five, plus the
> two deliberate grants, and the Worker's own `/health` reports `counts.contacts: 7`, matching.
>
> ⚠ **Correction to the previous note here.** It claimed these contacts would start receiving
> day-7 and day-9 sales emails once phase 4 exists. They will not: all seven have already reached
> `End Of Workflow`, and appending steps to a workflow does not re-enrol a contact that has
> already completed it. **The real reason to delete them is worse than spam** — because they have
> already exited, **nothing will ever expire them**, so they hold a renewing 48h lease
> permanently, and they are indistinguishable from real customers in every count the system
> reports. Delete them before phase 4 goes live so the first expiry run has a clean population.

**Needed soon**

- [ ] Refund / return handling — book returned, does coach access go? Cheap to add, pointless if
      unwanted. Open in *both* source docs since 2026-08-28.
- [ ] Un-defer the web repoint (phase 6)? The single largest open risk.
- [ ] What TTS voice does Voiceflow project 1042 use? Decides whether `ttsVoice` matches for free
      or the author's real voice needs an audio relay.
- [ ] A US number on Muhammad's GHL contact (`LUgsYcYM6TcsZ8UwYmUg`) — currently **locked out of
      SMS/voice testing**, since the contact has no phone and a Pakistani number is no use on a US
      10DLC campaign. Live testing depends entirely on the US colleague.
- [x] ~~Unlink the colleague's two test handsets when testing finishes (contact
      `9xr1rjXSV6Re5ijqmQSz`).~~ ✅ **RESOLVED BY DELETION, and it cost something — 2026-09-22.**
      🚨 **Contact `9xr1rjXSV6Re5ijqmQSz` (`author-1042@example.com` — the AUTHOR) no longer
      exists.** `GET /contacts/9xr1rjXSV6Re5ijqmQSz` answers `400 Contact not found`, and a search
      for his email returns **0**. Almost certainly swept up in the post-test cleanup, since he
      appeared in the tagged-contact list alongside the test contacts.
      **The tag census baseline is now 1, not 2** — `LUgsYcYM6TcsZ8UwYmUg` only, which matches the
      Worker's `counts.contacts: 1`.
      🟢 **The Worker handled it perfectly, and this is the first unplanned revocation the system has
      ever had to perform.** Both of that contact's handsets — `+1XXXXXXXXX1` (the author) and
      `+1XXXXXXXXX2` (the US colleague) — were **revoked 2026-09-20** and archived, deleting in 29
      days. `sub:` leases are 0. The `bind:` records survive by design, so recreating the contact
      with the tag restores access with no re-activation. The majority guard correctly did **not**
      refuse it: the floor of 3 exists so it does not fire on tiny counts.
      ⬜ **Two consequences:** the author has no coach access until his contact is recreated and
      tagged; and **the blocked SMS test (phase 3 step 4) now needs a tagged contact created
      first**, which is the strongest argument yet for the `bookcoach-staff-all` staff tag.

**Business decisions, not technical**

- [ ] **Confirm the hybrid model out loud.** `plans/06` is stamped *"DECIDED 2026-08-28 — sold
      through GHL, NOT Shopify."* This project puts a $29.95 Shopify book in front of it. Those
      reconcile only if Shopify sells the *book* and GHL sells the *coach* — coherent, but nobody
      has actually said so, and the revocation machinery was justified on "recurring".
- [ ] One trial per contact ever, or one per book purchased? (§4)
- [ ] The $49 early-continuation lever — use it or drop it?

---

## 8. Reference

### Identifiers

| Thing | Value |
|---|---|
| GHL location | `tjdqrnOqMAMheHIt6pQD` |
| **The tag** | `bookcoach-micheal-stickler-active` |
| **Customer-facing coach name** | **`BookCoach AI - The Life Without Reservation`** — short form **`BookCoach AI`** (`BookCoach` is one word). Decided 2026-09-17. Full name on first use, short form thereafter. Internal names (`coaches.json`, GHL product, Course360 offer) are different on purpose and must not be renamed. |
| **Stripe customer portal** | `https://billing.stripe.com/p/login/00g7vegVZ5dH8h2fYY` — **Active**, verified 200 on 2026-09-17. Config `bpc_1M0pGsC7G7kTQrjQzd…`, set to **`Cancel at end of billing period`** with cancellation reasons collected. ✅ **Confirmed to be on the same Stripe account as the coach subscriptions** — `acct_1Ah4NX**C7G7kTQrjQ**`, `sub_1UArQy**C7G7kTQrjQ**…` and `bpc_1M0pGs**C7G7kTQrjQ**…` share the account identifier Stripe embeds in its object IDs. Public by design; the customer authenticates via a one-time link Stripe emails them. |
| **Support / cancellation email** | `MuhammadZain@leadershipbooks.com` — provisional, 2026-09-17. Goes on the funnel's recurring-terms line as the cancellation route if the Stripe portal is unavailable. ⚠ Note `.com`, not the `.net` used elsewhere; `.com` is confirmed real (it is GHL contact `LUgsYcYM6TcsZ8UwYmUg`). **It must be monitored** — a stated cancellation method reaching an unwatched inbox is worse than none. |
| Coach code | `1042` |
| Worker | `https://coach-router.bookcoachai.workers.dev` |
| Public number | `+1 854 254 5009` |
| Coach page | `https://www.book-coach.ai/michael-stickler` |
| Members area | `https://login.leadershipbookspublishers.com` (Course360) |
| **Course lesson URL** (for emails) | `https://login.leadershipbookspublishers.com/courses/products/d818952a-d5a6-46ca-afae-57d1a924b8f9` — verified 2026-09-17. ⚠ **Not** the `app.coursecreator360.com` admin URL (404, and it is the course builder), and **strip `is_preview=true`** if you copy it from the admin screen |
| $59 product / price | `6a9185da778550cdf732a700` / `6a9185e6e5d7f1bbc622c940` |
| Book landing page | `leadershipbooks.com/pages/life-without-reservation-ai-coach` (Zipify) |
| GHL workflow | `Book Coach — Delivery → Trial Start` |
| `coach_status` field id | `cAL8RHFCFUgPRA9gZjsx` |
| `coach_trial_started` field id | `JJoM2V52xXLZqyNm5tOK` — a **date**, stored `2026-09-15T00:00:00.000Z` |
| `coach_trial_source` field id | `kBxKqY1tUGc6waAjcONz` |
| `shopify_order_number` field id | `818JeImrO5OKspBYkI8S` |
| Inbound webhook | `<GHL_TRIAL_WEBHOOK_URL>` |

> The webhook URL is an **unauthenticated capability**. Anyone holding it can start a trial and
> grant themselves the tag. It sits in a git working tree; if this repo is ever published,
> regenerate it in GHL and treat the old one as burned.

### Commands (run from `../coach-router`)

```bash
npm run subs                  # entitlement status: last sync, counts, mode
npm run subs -- --list        # sub: / bind: / arch: records in KV
npm run subs -- --sync        # reconcile now, do not wait for the cron
npm run subs -- --dry         # preview a reconcile, write nothing
npm run seed                  # push coaches.json config to KV (mode changes live in 30s)
npm run push                  # seed + secrets
npx wrangler tail             # live logs while testing
```

```powershell
# from this directory - fire a test delivery at the GHL workflow
.\test-ghl-webhook.ps1 -WebhookUrl '<the URL above>'
```

### Traps carried forward from both projects

- **Idempotency has two locks and needs both.** Shopify: the `coach-started` order tag.
  GHL: the `coach_status is empty` guard. Either alone lets a duplicate reset someone's clock.
- **Blank `coach_status` before re-testing.** Left set, the guard correctly stops every run —
  which looks exactly like a broken workflow.
- 🚨 **`test-ghl-webhook.ps1` used to send a HARDCODED phone, and GHL dedupes on phone.**
  Found 2026-09-18 after it cost an afternoon. Every fire carried `+15551234567`, so two fires with
  *different emails* collided into **one contact**:
  fire 1 created it and its Welcome Email went to email A; fire 2 **deduped on the phone, overwrote
  the email to B**, hit the `coach_status is trial` guard and correctly exited down `None`; then
  fire 1's chain carried on and delivered days 7/9/10 to email **B**.
  **The symptom is "the welcome email never sends", and it is entirely an artefact of the tool.**
  ✅ **Fixed** — the script now generates a unique random `+1555…` per run, with `-Phone` available
  to override when deliberately testing dedupe. **It also proved the trial guard works on a real
  duplicate**, which no test had done before.
- 🚨 **`SENT OK` from `test-ghl-webhook.ps1` does NOT mean the workflow ran.** Found 2026-09-18. The
  response `{"status": "Success: request sent to trigger execution server"}` is the trigger server
  acknowledging **receipt**, nothing more. A fire against a workflow sitting in **Draft** returns
  exactly the same body and creates no contact. Verified: `coachtest+phase4a@leadershipbooks.com`
  returned `SENT OK` with a trigger id and **produced no GHL contact at all**.
  **The only proof a run happened is the contact.** Check the tag census, never the script output.
- **`test-ghl-webhook.ps1` must be run from this directory.** From `C:\WINDOWS\system32` it fails
  with `CommandNotFoundException`, which reads as a broken script rather than a wrong cwd.
- **`coach_status` and the tag must move together.** Nothing enforces this but discipline. Drift
  between them is the bug class to watch.
- **KV is eventually consistent — allow about 60s.** Before debugging a KV read, wait a minute.
- **Never import `+1 854 254 5009` into GHL/LeadConnector.** It silently rewrites the webhooks and
  the router goes dark with no error anywhere.
- **The Course360 lesson editor strips `<script>` and `<button>`,** and both failure modes look
  installed. This is why the activation UI lives in the coach page.
- **GHL strips leading indentation from pasted code.** Match on content, never whitespace.
- **GHL answers an unknown contact ID with `400`, not `404`.**
- **A failed `/twilio/*` request returns `200`** with apologetic TwiML, deliberately — a status
  check cannot distinguish a working reply from a crash.
- **The `contact.` prefix** goes in merge tags and workflow references, never in a custom field
  Key box.
- **Menu names move.** Both GHL and Shopify rename things between releases. Look for the nearest
  equivalent rather than assuming the wrong screen.
