# Phase 4 — build runbook, click by click

**Spec (the *why*):** [`05-phase-4-trial-expiry.md`](05-phase-4-trial-expiry.md) — read §3, §4 and §9 first
**Owner:** Muhammad · **Time:** ~90 min to build, ~15 min to test, ~2 min to switch to real timings

Every step has a check. **If a check fails, stop** — the next step will build on a broken one and
you will debug the wrong thing.

---

## Step 0 — Clear the decks (do this first, it is not optional)

### 0a. Delete the five test contacts

GHL → Contacts. Delete each one:

| Contact | Email |
|---|---|
| `ODXV9VdMb4qSLs6eL8LG` | `coachtest+ghl@leadershipbooks.com` |
| `ZEDCeK8nwUF0fzZmFByT` | `tester1@example.com` |
| `Qu5bpryFoyfsgcfliC2k` | `tester2@example.com` |
| `0ysjoG8xaNYrDwSIugs3` | `tester3@example.com` |
| `goQnXRfFY6MxYpnqERPw` | `tester4@example.com` |

**Leave these two alone** — deliberate manual grants, not test residue:
`LUgsYcYM6TcsZ8UwYmUg` (Muhammad) and `9xr1rjXSV6Re5ijqmQSz` (Micheal Stickler).

> They have already reached `End Of Workflow`, so appending steps will **not** re-enrol them. They
> will simply never expire, and will show up in every count as permanent phantom customers.

**✅ Check** — the tag census should return **2**, not 7:

```bash
curl -s -X POST 'https://services.leadconnectorhq.com/contacts/search' \
  -H "Authorization: Bearer $GHL_TOKEN" -H 'Version: 2021-07-28' \
  -H 'Content-Type: application/json' \
  -d '{"locationId":"tjdqrnOqMAMheHIt6pQD","pageLimit":100,
       "filters":[{"field":"tags","operator":"eq","value":"bookcoach-micheal-stickler-active"}]}'
```

Then, from `../coach-router`, confirm the Worker agrees within 15 minutes:

```bash
npm run subs -- --sync
npm run subs -- --list      # the five should be gone
```

### 0b. Wallet — ✅ CONFIRMED FUNDED 2026-09-16

The Inbound Webhook is a premium trigger at ~$0.01/execution and you are about to spend 5–10 of them
testing. **An empty wallet answers `422 LOCATION does not have enough funds`, which looks exactly
like a broken workflow.** Funded as of 2026-09-16 — **turn auto-recharge on while you are in there**,
because the failure mode is total and silent.

### 0c. `coach_status` field type — ✅ ALREADY CLEARED

**Confirmed 2026-09-16: it is a single-line TEXT field** (id `cAL8RHFCFUgPRA9gZjsx`). Nothing to do.
`active` and `expired` will write cleanly, and there are no dropdown options to add.

> **What replaces this risk:** a text field validates nothing, and all three guards are exact string
> matches. Every write comes from a workflow action, so values stay consistent by construction —
> but **never hand-edit `coach_status` on a contact record** except to blank it for a re-test. A
> contact reading `Trial` instead of `trial` never gets a sales email and **never expires**, and
> nothing anywhere reports it.

### 0d. Confirm workflow re-entry is OFF

Open `Book Coach — Delivery → Trial Start` → **Settings** (top right) → confirm
**"Allow re-entry" is OFF**.

> Until now a run lasted seconds and re-entry barely mattered. From now on a contact sits in this
> workflow for **10 days**, and a duplicate delivery webhook inside that window would spawn a second
> set of timers and send the entire sequence twice.

---

## Step 1 — Build the purchase workflow FIRST

**Build this before touching the trial workflow.** It is the prerequisite from spec §4, and building
it second means there is a window in which the expiry exists and the thing that protects payers does
not.

GHL → Automation → **Create Workflow** → Start from scratch.

**Name:** `Book Coach — Coach Subscription Started`

### 1a. Trigger — **`Order Submitted`**, not `Order Form Submission`

**Resolved against GoHighLevel's own documentation, 2026-09-16.** Both triggers exist in this
location and they are not interchangeable:

| | `Order Submitted` ✅ | `Order Form Submission` ❌ |
|---|---|---|
| Fires on | an **actual payment/transaction** | the **form submission event**, regardless of payment |
| Declined card | does **not** fire | **fires anyway** |
| Abandoned checkout | does not fire | fires |
| Filter by product | **yes** — global product *and* price | no — funnel/page only |
| Intended for | post-purchase fulfilment | lead capture, RFQ |

GHL's guidance is explicit about the failure this avoids: *"using Order Form Submission for product
delivery workflows may grant access to people whose payments never succeeded."* **That is precisely
our failure mode** — a declined card would set `coach_status` = `active`, which makes that contact
**permanently immune to the day-10 expiry** while never paying a cent. They would hold the
entitlement tag forever and appear in no report as a problem.

**This is not hypothetical in this location.** A `$59 incomplete_expired` subscription from
2026-09-01 already exists (master plan §2) — a checkout that was started and never completed.
`Order Form Submission` would have granted it.

**Add these trigger filters:**

| Filter | Value |
|---|---|
| **Product** `is` | `Michael Stickler - Coach Access` (`6a9185da778550cdf732a700`) |
| **Price** `is` | the **$59 Monthly** price (`6a9185e6e5d7f1bbc622c940`) — optional but recommended |

#### Picking the product — the dropdown has two traps in it

**Verified live against the GHL products API, 2026-09-16.** The location holds **1,355 products**
and several read like the right one. These are the three that matter:

| Product | id | Type | Price | Pick it? |
|---|---|---|---|---|
| **`Michael Stickler - Coach Access`** | `6a9185da778550cdf732a700` | **SERVICE** | **$59/mo recurring** | ✅ **this one** |
| `Life Without Reservation + Your Personal AI Coach` | `6aa3c2dab5682f0951fdb237` | PHYSICAL | **$29.95 one-time** | ❌ that is the **book** |
| `BookCoachAI - Monthly (Standard)` | `6a9978eea94350eafc0958c3` | DIGITAL | **$59/mo recurring** | ❌ **decoy** — see below |

**Trap 1 — the book is not the subscription.** The two sit at **opposite ends of the lifecycle**:
buying the book **starts** the trial, buying Coach Access **ends** it by converting to paid. This
workflow exists to detect the conversion.

> **What selecting the book would do.** `coach_status` would be set to `active` at the moment of the
> $29.95 purchase — day 0. Then, 21 days later when the delivery webhook fires, the trial guard
> (`Coach Status is empty`) finds it **not** empty, takes the `None` branch, and stops.
> **No trial, no tag, no welcome email — the customer pays $29.95 and receives nothing at all.**
> It breaks the system at the opposite end from where anyone would look for the fault.
>
> It might instead simply never fire, since the book sells through **Shopify** and `Order Submitted`
> watches GHL/Stripe orders. Both outcomes are wrong, so there is no need to find out which.

**Trap 2 — `BookCoachAI - Monthly (Standard)` is a live $59/month recurring decoy.** Same price,
same interval, plausible name, and **nothing sells through it** — the funnel is wired to
`6a9185da778550cdf732a700`. Select it and the trigger **never fires**, `coach_status` never becomes
`active`, and **every paying customer is expired on day 10.** The failure is silent on both sides.

> ✅ A third look-alike, `BookCoach AI - Monthly Standard` (`6a999d662ce3c9050ca6a3f0`, PHYSICAL,
> one-time despite the name), **no longer exists** — the API returns 404. One trap fewer than the
> phase-1 doc recorded.

**Tell them apart by type, not name:** the one you want is the only **SERVICE**.

> **Why the product filter is not optional.** This location sells books. An unfiltered trigger would
> stamp `coach_status` = `active` on every book buyer, making them all immune to expiry and
> permanently entitled. The filter is the difference between a subscription workflow and a giveaway.

> **Menu names move.** If `Order Submitted` is not where this says, take the nearest equivalent —
> but the test is behavioural, not nominal: **it must filter to one product, and it must require a
> completed payment.** Verify the second half yourself in step 4e; GHL's official comparison page is
> silent on declined cards and only third-party write-ups state it outright.

> **Renewals are undocumented and harmless either way.** If `Order Submitted` also fires on the
> monthly renewal, it simply rewrites `coach_status` = `active` over the top. Idempotent. Nothing
> to guard.

### 1b. Action 1 — `Update contact field`

| Field | Value |
|---|---|
| `coach_status` | `active` |

### 1c. There is no action 2

**Do not add an `Add Tag` action here.** Spec §4 explains why at length; the short version is that
the trial buyer already holds the tag and the cold buyer is granted by subscription, while adding it
here would mean a cancelled subscriber keeps access forever.

### 1d. Publish

Toggle the workflow from **Draft** to **Publish**. Save.

**✅ Check** — you cannot test this without a purchase, and that is fine: it is tested as part of
step 4c below, using a Stripe **test-mode** payment (`allowTestSubscriptions` is `true`, so the
Worker honours test subscriptions). Do not spend $59.

---

## Step 2 — Write the three emails

GHL → Marketing → **Emails** → Templates. Create three, so the workflow steps just select them.

Copy is in [spec §7](05-phase-4-trial-expiry.md#7-email-copy) — use it verbatim; each awkward line
is there for a reason documented alongside it.

### Use `Quick compose` — RESOLVED 2026-09-16 by reading the live welcome email

**The day-0 welcome email is built with `Quick compose`, inline in the workflow action.** It is not
a saved template and not smart builder: plain text, Verdana 16px, line height 1.5, no logo, no
images, no buttons, 724 characters.

**Build these three as saved TEMPLATES anyway, styled to match that plain look**, then select them
in each `Send Email` action via *Select existing template*. Two reasons, and the second is the
important one:

1. **Templates can be test-sent.** An inline `Quick compose` body inside a workflow action cannot,
   so the prefill link would go unverified until the live test.
2. **You can rewrite the copy later without opening the workflow.** After this ships, trial
   customers sit inside that workflow in 10-day waits, and editing it while they are parked is the
   riskiest routine operation in the system (trap 1, §9). Templates let you iterate on sales copy —
   which you *will* want to do — while never touching a live workflow.

The sender is set on the **action**, not the template, so sender consistency with day 0 is
unaffected by this choice.

**Do not pick a gallery template.** The library's "welcome email" results are all wrong for this:
`Affiliate Program Welcome` is built entirely from `{{affiliate.*}}` merge fields that resolve to
nothing for a contact, and `Membership Welcome` carries `{{membership_contact.password}}`, a
placeholder logo, a stock illustration, dead social icons and blank copyright fields. Stripping
either is slower and riskier than composing 10 plain lines.

**One adjustment this forces.** `Quick compose` is a rich-text editor with a link tool, **not a
button element** — so `[ KEEP MY COACH - $59/month -> ]` becomes a **bold, hyperlinked line on its
own**, not a styled button. Take that trade: consistency with day 0 and the deliverability of a
plain email beat a styled button, and this audience reads text fine. (The toolbar does have a
`</>` code view if you ever want a real HTML button — not worth the risk for v1.)

**Set the Pre-Header field.** The welcome email left it empty; these three should not. It is the
preview line most clients show next to the subject, and it is free open-rate.

The three reasons a designed template would have cost money, kept because they still apply:

1. **Deliverability.** These emails *are* the revenue event. An image-heavy, multi-column marketing
   template is far more likely to land in Promotions or spam than a mostly-text email with a single
   link — and a trial-expiry notice that lands in Promotions is worth exactly nothing.
2. **They must match the welcome email.** The customer already received one email from this system
   on day 0. If that one is plain and personal and the day-7 is a branded marketing piece, it reads
   as a different company selling to them — at precisely the moment you need it to read as *your
   coach is about to switch off*. **Open the existing welcome email first and match it:** same
   sender name, same from-address, same visual weight.
3. **The copy is written to be plain.** It is short, conversational and direct because the audience
   is older, faith-oriented, and bought a physical book. A hero image and a three-column footer
   fight it.

### The layout, in full

```
  text block      the greeting and the body copy
  ONE button      "KEEP MY COACH - $59/month"   <- a real button, not a raw URL
  text block      the remaining lines
```

That is the whole design. **One button, one destination, no second CTA**, no hero image, no social
icons. A single styled button does convert better than a bare link — that is the one piece of
design worth having.

**Build the day-7 email properly, then duplicate it twice** and swap the copy. Faster, and it
guarantees the three look like each other.

### Four things that will bite

- **Sender name and from-address must match the welcome email.** A different sender breaks the
  thread in most clients and reads as a stranger.
- **Set a fallback on `{{contact.first_name}}`.** Not every contact has one — a contact created from
  a Shopify order with no billing first name opens the email *"Hi ,"*. If the merge-field picker
  offers a fallback box, use `there`. **Test it with a contact whose first name is blank.**
- **Unsubscribe is usually mandatory and GHL may inject it.** Consequence worth knowing:
  **a contact who unsubscribes at day 7 gets no day-9 and no day-10 email, but still expires on
  schedule.** Their access dies with no warning. That is acceptable — they asked not to be emailed —
  but it should be a known behaviour, not a surprise support ticket.
- **Check it in dark mode.** A white logo on a transparent background disappears; so does black text
  in a box that inverts.

| Template name | Subject |
|---|---|
| `Book Coach — Day 7 offer` | `Your coach has 3 days left` |
| `Book Coach — Day 9 reminder` | `Tomorrow your coach goes quiet` |
| `Book Coach — Trial ended` | `Your trial has ended` |

**The button/link in all three:**

```
https://www.book-coach.ai/michael-stickler-coach-access?full_name={{contact.full_name}}&email={{contact.email}}
```

**✅ Check** — send yourself a test of the day-7 template, **click the link from inside the received
email**, and confirm the order form arrives with the name and email already prefilled.

> ⚠ **Click it from the email, never paste the URL.** `Track clicks` is ON (it is on the welcome
> email, and it should stay on here — you want to know who clicked the $59 link). Click tracking
> **rewrites the link into a redirect**, and the prefill only works if the redirect preserves the
> `?full_name=…&email=…` query string. The browser test on 2026-09-16 used a hand-typed URL, so the
> **tracked** path is still unproven. If prefill fails, the fix is to turn `Track clicks` off on
> these three and accept losing the click data.

> ⚠ Also confirm **the name is not truncated at the first space** — `{{contact.full_name}}` renders
> literal spaces into a query string.

---

## Step 3 — Extend the trial workflow, with MINUTES not days

Open `Book Coach — Delivery → Trial Start`. Work **inside the `Fresh - start trial` branch**, below
the existing welcome-email action. Nothing goes on the `None` branch, ever.

> **Build with minutes.** You cannot test a 10-day sequence in real time, so build the whole chain
> with **7 / 2 / 1 minutes**, prove it end to end, and only then switch to days (step 5). Building
> straight to days means shipping something never observed working.

> ### ⚠ Edit THIS workflow — do not build a separate test one
>
> Added 2026-09-17. The contact is already enrolled here. A separate test workflow would need its
> own trigger — and the inbound webhook is a **premium trigger at ~$0.01/execution** — and it would
> prove a workflow that is not the one that ships. Same workflow, minutes instead of days.

> ### 🚨 The minutes window is LIVE — added 2026-09-17
>
> While these waits read minutes, **any real order that arrives starts a trial that dies about ten
> minutes later**: day-7 and day-9 emails inside the same coffee break, then access cut, for a
> customer whose book has not shipped.
>
> Order volume is tiny (four orders ever), so the odds are low — but the exposure is real and the
> runbook previously did not mention it.
>
> **Mitigation:** do the whole test in one sitting, flip to days the moment step 4 passes, and then
> run the step 0a tag census looking for a contact you do not recognise. If one appears, blank its
> `coach_status` and re-add the tag by hand.

### 3a. `Wait` — **7 minutes**

### 3b. `If/Else` — name it `Day 7 - still on trial?`

| | |
|---|---|
| Branch name | `Yes - still trial` |
| Condition | `Coach Status` **is** `trial` |

Leave the `None` branch **completely empty**. That emptiness is the guard — a contact who has bought
lands there and exits the workflow.

### 3c. Inside `Yes - still trial`: `Send Email` → `Book Coach — Day 7 offer`

### 3d. `Wait` — **2 minutes** *(still inside `Yes - still trial`)*

### 3e. `If/Else` — `Day 9 - still on trial?`, same condition, same empty `None`

### 3f. `Send Email` → `Book Coach — Day 9 reminder`

### 3g. `Wait` — **1 minute**

### 3h. `If/Else` — `Day 10 - still on trial?`, same condition, same empty `None`

### 3i. Inside that `Yes` branch, three actions in this order:

| # | Action | Value |
|---|---|---|
| 1 | **Remove Tag** | `bookcoach-micheal-stickler-active` |
| 2 | **Update contact field** | `coach_status` = `expired` |
| 3 | **Send Email** | `Book Coach — Trial ended` |

> **Order matters a little.** Removing the tag first means that if the run dies halfway, the customer
> has lost access and still reads `trial` — which is recoverable and visible. The reverse leaves
> someone reading `expired` while still fully entitled, which nothing will ever notice.

### 3j. **SAVE.** Then save again and confirm it took.

> **Trap 1, the one that has already cost this project a day.** GHL's canvas state and published
> state are separate. An unsaved canvas runs the *old* published version and reports success — a
> stale run is indistinguishable from a misconfigured action. **If an action appears to do nothing,
> check Save before debugging it.**

---

## Step 4 — Test the whole thing, in about 15 minutes

### 4a. Fire a fresh trial

Use an email that has **never** been in GHL. An existing contact with `coach_status` set will
correctly stop at the trial guard, which looks exactly like a broken workflow.

```powershell
.\test-ghl-webhook.ps1 `
  -WebhookUrl '<GHL_TRIAL_WEBHOOK_URL>' `
  -Email 'coachtest+phase4a@leadershipbooks.com'
```

**✅ Check at T+1 min** — contact exists, `coach_status` = `trial`, tag present, welcome email
received. (`Add Tag` lands ~12s after `Update contact field`; polling sooner reads as failure.)

### 4b. Watch the clock

| At | Expect |
|---|---|
| T+7 min | day-7 offer email arrives |
| T+9 min | day-9 reminder arrives |
| T+10 min | **tag removed**, `coach_status` = `expired`, "trial ended" email arrives |

**✅ The check that actually matters** — at T+11 min, run the tag census from step 0a. **The contact
must not be in it**, and its `coach_status` must read `expired`. A green execution log is not proof.

Then confirm the Worker follows, from `../coach-router`:

```bash
npm run subs -- --sync
npm run subs -- --list      # the lease should be gone
```

### 4c. Test the purchase path — the one that protects payers

Fire a **second** fresh trial:

```powershell
.\test-ghl-webhook.ps1 `
  -WebhookUrl '<same URL>' `
  -Email 'coachtest+phase4b@leadershipbooks.com'
```

> ### 🚨 `4242…` WILL NOT WORK AS WRITTEN — corrected 2026-09-17
>
> The funnel's **Payment mode is `Live`** (confirmed on the funnel settings screen, 2026-09-17).
> `4242 4242 4242 4242` is a **test-mode** card; in live mode Stripe simply declines it. So as
> originally written, **4c cannot pass** (no subscription, no `coach_status = active`) and **4e
> passes for the wrong reason** (every card declines, proving nothing about the trigger).
>
> | Option | Notes |
> |---|---|
> | **Flip the funnel to test mode** for 4c and 4e, then back | Cleanest. `allowTestSubscriptions` is `false` since 2026-09-17, so the Worker ignores the test subscription — but entitlement still arrives via the **tag**, which the purchase workflow now adds. The workflow test stays valid |
> | **Use a real card, then refund** | Proves the live path exactly. Costs $59 briefly |
>
> ⚠ **Set it back to `Live` afterwards.** A funnel left in test mode takes no money and looks like
> it is working.

Then, **within 7 minutes**, put that contact through the $59 funnel using a card appropriate to the
mode you chose above (see the correction), with the same email:

```
https://www.book-coach.ai/michael-stickler-coach-access?full_name=Phase Four&email=coachtest%2Bphase4b@leadershipbooks.com
```

**✅ Checks, and this is the most important test in the phase:**

1. Purchase workflow fires → `coach_status` becomes `active`
2. At T+7 min **no day-7 email arrives** — the guard sent them down `None`
3. At T+10 min **the tag is still present** and `coach_status` still reads `active`
4. The contact still appears in the tag census

> **If the tag comes off at step 3, stop and do not ship.** That is the failure mode this entire
> prerequisite exists to prevent, and it means either the purchase workflow did not fire or the
> `coach_status` dropdown is missing the `active` option (step 0c).

> **Note, 2026-09-17:** the purchase workflow now also carries an **`Add Tag`** action, added so a
> cold $59 buyer (who never had a trial and so holds no tag) can mint an activation code — see
> [`07-phase-5-conversion-path.md`](07-phase-5-conversion-path.md) §2. Check 3 above therefore
> passes for two reasons now rather than one: the trial tag persists **and** the purchase re-adds it.
> That is belt and braces, not a problem — but if you are debugging, know that a passing check 3 no
> longer isolates the `coach_status` guard on its own.

### 4d. Capture the subscription status string — free intelligence, do it now

✅ **DONE 2026-09-19 — the string is `active`.** Captured from a test-mode purchase through the live
funnel (`status: "active", liveMode: false, 59`), re-verified live the same day. A **declined** card
produces `incomplete`. `GHL_SUB_ACTIVE = {'active','trialing'}` matches — **no code change needed.**
*(This step previously read "it has never been observed"; that was true until 2026-09-19.)*

Kept below because it is still worth re-running on the first `liveMode: true` purchase — the capture
was in test mode, which is strong evidence rather than proof.

```bash
curl -s 'https://services.leadconnectorhq.com/payments/subscriptions?altId=tjdqrnOqMAMheHIt6pQD&altType=location&limit=100' \
  -H "Authorization: Bearer $GHL_TOKEN" -H 'Version: 2021-07-28'
```

**Write whatever it says into master plan §7 and tell the coach-router side.** It is a one-line
change there and it closes an open question that has been sitting there since 2026-08-28.

### 4e. The negative test — prove a declined card grants nothing

**Do not skip this.** It is the only thing that proves you picked the right trigger, and the
failure it catches is silent and permanent.

Fire a third fresh trial:

```powershell
.	est-ghl-webhook.ps1 `
  -WebhookUrl '<same URL>' `
  -Email 'coachtest+phase4c@leadershipbooks.com'
```

Then take that contact through the $59 funnel with Stripe's **decline** test card:

```
4000 0000 0000 0002        (generic decline - any future expiry, any CVC)
```

**✅ Checks:**

1. The payment fails at the funnel, as it should
2. **`coach_status` still reads `trial`** — the purchase workflow did **not** fire
3. At T+10 min the contact **is expired normally**: tag removed, `coach_status` = `expired`

> **If `coach_status` flipped to `active` on a declined card, you are on `Order Form Submission`.**
> Change the trigger to `Order Submitted` and run this test again. Left unfixed, every abandoned or
> failed checkout creates a contact that can never expire and never pays.

### 4f. Clean up

Delete all three `coachtest+phase4*` contacts, and cancel the test subscription in Stripe.

---

## Step 5 — Switch to real timings

**Only after step 4 passed.** Re-open the trial workflow and change the three Waits:

| Step | From | To |
|---|---|---|
| 3a | 7 minutes | **7 days** |
| 3d | 2 minutes | **2 days** |
| 3g | 1 minute | **1 day** |

**SAVE.** Confirm the workflow is still **Published**, not back in Draft.

**✅ Check** — walk the canvas once more and read the three Wait cards out loud. 7 + 2 + 1 = 10. If
they read 7 / 2 / 0 or 7 / 3 / 1, the customer gets the wrong trial length and nothing will ever
tell you.

> ⚠ **From this moment, editing this workflow is a different kind of operation.** Trial customers
> sit inside it for 10 days. Before any future edit, check the enrolment count — if anyone is
> mid-flight, their sequence may change under them.

---

## Step 6 — Fix the decline copy (coach-router, 2 minutes)

The last piece, and the one nobody had specced. Reasoning in
[spec §6](05-phase-4-trial-expiry.md#6-the-thing-nobody-specced--what-an-expired-user-actually-hears).

Edit `../coach-router/coaches.json`, inside `shared.config`, replacing the two empty strings:

```json
"declineSms": "This line is for Book Coach AI subscribers. If your trial has ended you can continue for $59/month at https://www.book-coach.ai/michael-stickler-coach-access - your coach remembers your conversations for 30 days. Already subscribed? Open your members area to link this phone.",
"declineVoice": "This line is for Book Coach AI subscribers. If your trial has ended, you can continue at book coach dot A I. If you are already subscribed, please open your members area to link your phone. Goodbye."
```

```bash
cd ../coach-router
npm run seed        # live in ~30 seconds, no redeploy needed
```

**✅ Check** — text `+1 854 254 5009` from any number that is not linked to a tagged contact. You
should get the new wording with the $59 link, not the old "open your members area" copy.

---

## Step 7 — Mark it done

Update in [`00-master-plan.md`](00-master-plan.md):

- Phase 4 heading → ✅ with the date and the evidence
- Phase 5 step 4 → ✅ (built here as the prerequisite)
- §7 cleanup table → remove the five deleted contacts
- §7 open question "the exact string GHL uses for an ACTIVE subscription" → whatever step 4d found

---

## The five ways this build fails, in order of likelihood

| # | Symptom | Cause |
|---|---|---|
| 1 | An action appears to do nothing | Canvas never saved; the old published version ran — **step 3j** |
| 2 | Expiry runs green, tag stays on | `coach_status` holds a hand-typed variant (`Trial`, trailing space) — **step 0c** |
| 3 | Nothing happens at all, no contact created | Wallet drained by testing → `422` — **step 0b** |
| 4 | Run stops immediately at the guard | Test email already exists with `coach_status` set — **step 4a** |
| 5 | A paying customer is expired on day 10 | Purchase workflow did not fire, or fired on the wrong product — **step 1a** |
