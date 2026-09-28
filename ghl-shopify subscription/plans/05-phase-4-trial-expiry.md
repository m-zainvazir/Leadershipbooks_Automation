# Phase 4 — the day 7 / 9 / 10 sequence and trial expiry

**Created:** 2026-09-16 · **Owner:** Muhammad (GHL UI), plus one coach-router config edit
**Parent plan:** [`00-master-plan.md`](00-master-plan.md) phase 4
**Click-by-click:** [`06-phase-4-build-runbook.md`](06-phase-4-build-runbook.md)

> ## ⛔ Do not build this phase on its own
>
> It has a hard prerequisite the master plan filed under **phase 5 step 4**, and shipping phase 4
> without it **removes the entitlement tag from paying customers**. See §4. Build both, test both,
> ship both.

---

## 1. What is missing, stated plainly

Phase 2 starts trials. **Nothing stops them.** The tag is never removed, so the Worker renews the
48-hour lease every 15 minutes, forever. Every trial started since 2026-09-15 is permanent.

What exists today is a free coach with a welcome email, not a trial. There is no day-7 offer, no
day-9 reminder, no day-10 expiry, and therefore **no revenue event anywhere in the system.** The
more successful phase 2 is, the more free lifetime access it gives away.

This phase is the whole commercial half of the product.

---

## 2. The shape — two workflows, and one config line

| # | Thing | Where | Why it is here |
|---|---|---|---|
| 1 | Extend `Book Coach — Delivery → Trial Start` with steps 7–10 | GHL | The sequence and the expiry |
| 2 | **New workflow `Book Coach — Coach Subscription Started`** | GHL | Sets `coach_status` = `active`. **Without it, step 10 expires paying customers.** §4 |
| 3 | `declineSms` / `declineVoice` in `coaches.json`, then `npm run seed` | coach-router | What an expired trial user is told when they text. Today it misdirects them. §6 |

Nothing here needs a Worker deploy. Item 3 is a config edit that goes live in ~30 seconds.

---

## 3. The sequence, corrected

The master plan's sketch was `Wait 7 → offer → Wait 2 → reminder → expire`. **That expires on day
9, not day 10** — 7 + 2 = 9, and the reminder and the expiry fire back to back. The customer loses
a day they were promised in the welcome email.

The corrected chain, appended inside the existing `Fresh - start trial` branch, after the welcome
email:

```
  (welcome email, already built)
        |
   Wait 7 days
        |
   IF  Coach Status is trial  ------------------ None --> (empty: they bought, they exit)
        | Yes
   Send Email: day-7 offer
        |
   Wait 2 days
        |
   IF  Coach Status is trial  ------------------ None --> (empty)
        | Yes
   Send Email: day-9 reminder
        |
   Wait 1 day
        |
   IF  Coach Status is trial  ------------------ None --> (empty)
        | Yes
   Remove Tag  bookcoach-micheal-stickler-active
   Update contact field  coach_status = expired
   Send Email: trial ended
```

**GHL branches do not reconverge.** Once a contact takes a `None` branch it is done with the
workflow, which is exactly right: a contact who is no longer `trial` has bought, and needs no
reminder and no expiry. That is why the later steps nest inside the earlier `Yes` branch rather
than sitting in a flat line.

### Why the condition is `is trial` and never `is not active`

`is trial` **fails toward keeping access.** If `coach_status` is ever blank, misspelt, or holding
some value nobody predicted, the guard sends the contact down `None`: no sales email, and crucially
**no tag removal.** They keep their coach.

`is not active` fails the other way — an unexpected value means the tag comes off and a customer is
cut off within 15 minutes. Over-granting costs money. Cutting off a payer costs a refund, a
chargeback and a support thread. Choose the failure that costs money over the one that costs trust.

### Three guards, not one

The master plan's sketch guarded **only** day 10. That is a real defect: a customer who subscribes
on day 3 stays enrolled and **gets sold the same $59 subscription twice more**, on days 7 and 9,
after they have already bought it. Every email step carries the same check.

### Deliberately not built: "Remove from workflow" on purchase

The purchase workflow *could* also pull the contact out of the trial workflow. It would flatten the
canvas — no nesting, no guards. **It is not worth it.** It makes one action load-bearing for an
outcome the guards already produce, and its failure mode is the catastrophic one: a paying customer
both sold to twice and expired on day 10. The guards are local, independently verifiable, and
visible in the execution log. Keep them as the mechanism.

If you later want tidier enrolment counts, add removal *on top of* the guards, never instead.

---

## 4. The prerequisite — phase 5 step 4, and why it is not optional

**Step 10 branches on `coach_status is trial`. Nothing in the live system ever sets it to anything
else.**

So today: a customer subscribes on day 8 and their contact still reads `trial`. On day 10 the guard
passes, **the tag comes off, and the Worker revokes them inside 15 minutes** — while Stripe bills
them $59 a month. A paying customer with no product, and nothing alarms.

### The new workflow

**`Book Coach — Coach Subscription Started`**

| | |
|---|---|
| **Trigger** | The payment/order trigger for the $59 product `Michael Stickler - Coach Access` (`6a9185da778550cdf732a700`). **Menu names move** — pick the trigger that can filter on that specific product, and do not accept one that fires on every order in the location. |
| **Action 1** | `Update contact field` → `coach_status` = `active` |
| **Action 2** | *(none — see below)* |

### Why there is no Add Tag here — this is deliberate

It is tempting to add `bookcoach-micheal-stickler-active` on purchase. Don't.

- **The trial buyer already has it.** They were tagged on day 0, and step 10 now leaves it alone
  because their status reads `active`. It simply persists. There is nothing to add.
- **The cold buyer does not need it.** The Worker's reconcile grants SMS and voice on
  *active subscription **OR** tag* — a subscription alone is enough. Web is ungated
  (`webGateMode: warn`).
- **Adding it creates the exact trap master plan §3 exists to avoid:** if a workflow adds the tag on
  purchase and cancellation cannot reliably remove it, a cancelled subscriber keeps access forever.

**Revisit on the day `webGateMode` goes to `enforce`** (phase 6) — at that point a tag-less
subscriber loses the web coach, and the fix is the Worker change in master plan §3, not a tag here.

### The hole this phase does NOT close

Phase 4 makes the tag removable **on the trial path only.** The *subscribe-then-cancel* path stays
open: a customer who subscribes keeps the tag indefinitely, because the only thing that would
remove it is **phase 5 step 5**, the cancellation workflow — which does not exist, and whose GHL
trigger has never been confirmed to exist either (master plan §7).

That is not a regression; it is already true today. But phase 4 is the moment it starts being worth
money, so write it down rather than discovering it later. **Until phase 5 step 5 lands, every
cancellation is a manual SOP: remove the tag by hand and set `coach_status` = `expired`.**

---

## 5. What the customer gets, and when

| Day | Trigger | `coach_status` | Tag | What they receive |
|---|---|---|---|---|
| 0 | delivery webhook | `trial` | added | welcome email — already built |
| 7 | Wait | `trial` | present | the $59 offer, one click, prefilled |
| 9 | Wait | `trial` | present | reminder |
| 10 | Wait | → `expired` | **removed** | "your trial has ended" — access dies within 15 min |
| any | purchase | → `active` | unchanged | nothing further from this workflow |

**The 15-minute lag is real and it cuts in the customer's favour.** At day 10 the tag comes off and
the Worker revokes on its next cron, so someone may keep getting answers for up to a quarter of an
hour after the email says their trial ended. Leave it. The whole entitlement design is lease-based
on purpose, and making expiry instant would mean giving this project write access to the Worker.

---

## 6. The thing nobody specced — what an expired user actually hears

**Found 2026-09-16 by reading the Worker, not the docs.** `declineSms` and `declineVoice` are both
`""` in `coaches.json`, so the built-in defaults apply:

> *"This line is for Book Coach AI subscribers. If you have a subscription, open your members area
> and follow the activation steps to link this phone. Visit book-coach.ai to subscribe."*

**For a stranger that is correct. For an expired trial user it is actively wrong.** It tells someone
whose trial just ended to go and link their phone — sending them to chase an activation code that
can never work, because their problem is not an unlinked handset, it is a missing tag. Then it
points them at the generic site rather than the page that takes their money.

This is the **first thing an expiring customer experiences and the last conversion surface in the
funnel** — the exact moment somebody wants their coach back. Fix it in the same session as the rest
of phase 4.

In `coach-router/coaches.json`, inside `shared.config`:

```json
"declineSms": "This line is for Book Coach AI subscribers. If your trial has ended you can continue for $59/month at https://www.book-coach.ai/michael-stickler-coach-access - your coach remembers your conversations for 30 days. Already subscribed? Open your members area to link this phone.",
"declineVoice": "This line is for Book Coach AI subscribers. If your trial has ended, you can continue at book coach dot A I. If you are already subscribed, please open your members area to link your phone. Goodbye."
```

Then, from `../coach-router`:

```bash
npm run seed        # live in ~30 seconds, no redeploy
```

Two constraints the Worker enforces, both satisfied above: the copy **must never name another
coach** (that is what the removed menu did), and SMS should stay near the ~300-character channel
target.

> ⚠ **`declineSms` is shared config, not per-coach.** It lives in `shared.config`, not on the coach
> record, so the URL above is hardcoded for the one coach that exists. At ~15 coaches this becomes
> a real limitation — see [`02-multi-coach-scaling.md`](02-multi-coach-scaling.md). Fine for now;
> do not let it become a surprise.

---

## 7. Email copy

> ### ✅ ALL THREE ARE BUILT — 2026-09-17
>
> `Book Coach — Day 7 offer` · `Book Coach — Day 9 reminder` · `Book Coach — Trial ended`.
> Verdana 16px / 1.5, plain text, matching day 0. **The copy below is the draft; the built versions
> differ in wording and are the ones that ship.** They are good — do not rewrite them.
>
> ⚠ **CORRECTION: they are saved TEMPLATES, not Quick compose.**
> [`01-phase-1-grant-path.md`](01-phase-1-grant-path.md) predicted the opposite — *"the three new
> emails cannot be built by duplicating a template, because there is no template. Build them in
> Quick compose too."* That was reasoning from day 0's build method, and it was wrong. Templates are
> fine, and arguably better. **But a template is not wired up until it is selected in the workflow's
> `Send Email` action** — writing them and attaching them are two separate jobs.
>
> #### What to check before wiring them in
>
> | # | Check | Why it matters |
> |---|---|---|
> | 1 | 🚨 **Every `KEEP MY COACH` / `BRING MY COACH BACK` href carries `?full_name=…&email=…`** | All three claim *"Your name and email are already filled in."* A bare link makes that a lie and throws away the one-click tactic. **Fails silently** |
> | 2 | ✅ **DONE** — sender is `MuhammadZain@leadershipbooks.com` on all three, and it accepts replies |
> | 3 | ✅ **DONE** — day 9 now reads *"your coach stops answering"* |
> | 4 | ✅ **DONE** — signatures unified |
> | 5 | ✅ **DONE 2026-09-17** — all three now route cancellation to the **Stripe portal**, `https://billing.stripe.com/p/login/00g7vegVZ5dH8h2fYY`, replacing *"reply to this email"* |
>
> **Known and acceptable:** day 10 says *"your coach has stopped answering"*, which is true within
> ~15 minutes rather than instantly — the workflow removes the tag, the Worker's reconcile revokes on
> its next run. Not worth engineering around.

All three use `{{contact.first_name}}` only, plus the prefilled link.

### The link — verified working 2026-09-16

```
https://www.book-coach.ai/michael-stickler-coach-access?full_name={{contact.full_name}}&email={{contact.email}}
```

**Confirmed live in a browser: the funnel's order form prefills from `full_name` and `email`.**
That is the "one click" conversion tactic from the handoff doc §2.3, and it is real rather than
hoped-for.

- `phone` as a third parameter is **unverified**. Most trial contacts have no phone in GHL anyway —
  four of the five test contacts carry none — so it is not worth blocking on. Try it; if it fills,
  keep it.
- ⚠ **Check the rendered link in the first real test email.** `{{contact.full_name}}` renders with
  literal spaces inside a query string. Browsers normally encode them, but confirm the name arrives
  whole rather than truncated at the first space.

### One promise to be careful with

**Do not write "cancel anytime" yet.** There is no self-serve cancellation (master plan phase 5
step 7) — it would be the same unkept promise that makes the landing page wrong in phase 7. Say
what you can actually do:

> *Cancel any time — reply to this email and we'll take care of it.*

Honest, keepable today, and it costs nothing.

### Day 7 — the offer

**Subject:** `Your coach has 3 days left`
**Preheader:** `Keep him for $59/month, or do nothing and access ends.`

```
Hi {{contact.first_name}},

You're seven days into your coach. Three left.

On day 10 your access ends and nothing happens automatically - there's no
card on file and you won't be charged. If you want to keep going, this is
the step:

[ KEEP MY COACH - $59/month -> ]

Your name and email are already filled in. It takes a card and about
thirty seconds.

What you keep:
  - Text or call +1 854 254 5009, any time, no login
  - A coach that knows Michael Stickler's work and remembers your
    conversations
  - Cancel any time - reply to this email and we'll take care of it

If you've not used it much yet, use it now while it's still free. Ask it
the thing you've been putting off.
```

### Day 9 — the reminder

**Subject:** `Tomorrow your coach goes quiet`
**Preheader:** `Last day of your trial.`

```
Hi {{contact.first_name}},

Your trial ends tomorrow. After that, texting +1 854 254 5009 gets you a
polite no.

[ KEEP MY COACH - $59/month -> ]

No card is on file, so nothing happens unless you choose it. If you'd
rather stop here, you don't need to do anything at all - and thank you
for reading the book.
```

### Day 10 — trial ended

**Subject:** `Your trial has ended`
**Preheader:** `Your coach remembers you for 30 days.`

```
Hi {{contact.first_name}},

That's your 10 days. Your coach has stopped answering.

Here's the part worth knowing: he remembers your conversations for the
next 30 days. Come back within a month and he picks up where you left
off, rather than starting cold.

[ BRING MY COACH BACK - $59/month -> ]

After 30 days that history is deleted for good.

Either way - thank you for reading Life Without Reservation. That was
the point of all this.
```

> **The 30-day line is true, and it is the strongest retention hook in the sequence.** The Worker's
> `archiveRetentionDays` is `30` with `archiveAutoDelete: true` — a revoked subscriber's
> conversation state is genuinely kept for 30 days and then genuinely deleted. **If anyone ever
> changes that config value, this email becomes a lie.** The cross-reference is kept here on
> purpose.

---

## 8. Verification — what proves it, and what only looks like proof

The GHL token carries **contacts and payments scope only**; `/workflows/` answers 401. So the
workflow cannot be inspected through the API. **It is verified by its effects on the contact** —
which is sufficient, and in some ways better, because it tests the outcome rather than the
configuration.

```bash
# who currently holds the entitlement tag, with custom fields inline
curl -s -X POST 'https://services.leadconnectorhq.com/contacts/search' \
  -H "Authorization: Bearer $GHL_TOKEN" -H 'Version: 2021-07-28' \
  -H 'Content-Type: application/json' \
  -d '{"locationId":"tjdqrnOqMAMheHIt6pQD","pageLimit":100,
       "filters":[{"field":"tags","operator":"eq","value":"bookcoach-micheal-stickler-active"}]}'
```

**Expiry is proven when the contact disappears from that list** and its `coach_status`
(field `cAL8RHFCFUgPRA9gZjsx`) reads `expired`. Then, from `../coach-router`:

```bash
npm run subs -- --sync     # don't wait for the cron
npm run subs -- --list     # the contact's lease should be gone
```

**Do not accept a green execution log as proof.** Trap 1 in the master plan is exactly this: a
workflow whose canvas was never saved runs the old published version and reports success. The
contact record is the truth.

---

## 9. Traps specific to this phase

1. **Editing a workflow that has contacts mid-wait.** After this ships, every trial customer sits
   inside the workflow for **10 days**. Changing Wait durations or branch structure while people are
   parked in it is the riskiest routine operation in the system. **Before editing, check the
   enrolment count; if anyone is mid-flight, either wait them out or accept their sequence may
   change under them.** This is new — until now the workflow completed in seconds and editing it
   was free.
2. **`coach_status` is a single-line TEXT field** — confirmed in the GHL UI, 2026-09-16. Good news:
   no dropdown options to add, and `active`/`expired` will write cleanly. **The risk it carries
   instead is typos.** Nothing validates the value, and the three guards are exact string matches.
   Every write comes from a workflow action, so consistency is by construction — but **the moment
   anyone edits `coach_status` by hand on a contact record, a stray capital or trailing space
   silently changes that person's lifecycle.** A contact reading `Trial` instead of `trial` never
   gets a sales email and **never expires**, with nothing anywhere reporting a problem.
   Treat the field as workflow-owned. Do not hand-edit it except to blank it for a re-test.
3. **Re-entry must be OFF.** Already required, now load-bearing: a duplicate delivery webhook inside
   a 10-day window would spawn a second set of timers and send the whole sequence twice.
4. **Every test costs a premium-trigger execution** (~$0.01 from the sub-account wallet; the 100
   free lifetime executions are long gone). Budget 5–10. **An empty wallet returns 422, and that
   looks exactly like a broken workflow.**
5. **Delete the five test contacts first** (master plan §7). They have already reached
   `End Of Workflow`, so appending steps will not re-enrol them and they will never expire — they
   would sit in every count as permanent phantom customers.
6. **Trap 1 still applies: Save the canvas.** GHL's canvas state and published state are separate.
7. **`allowTestSubscriptions` is `true`.** A Stripe **test-mode** $59 payment will set
   `coach_status` = `active` and grant real access. Useful for testing this phase for free — and it
   **must be set to `false` at launch.** See master plan phase 9.

---

## 10. Open, and deliberately left open

- [ ] **No trial-end date is stored**, by design (handoff doc §7). The Wait steps *are* the clock.
      Consequence: the emails cannot merge a date, which is why the copy says "three days left"
      rather than a calendar date. **Do not add a date field just for the copy** — it creates a
      second source of truth that will drift from the Wait steps.
- [ ] **One trial per contact, ever.** The `coach_status is empty` guard means a repeat buyer whose
      trial expired gets no second one — and after this phase, `expired` becomes the normal end
      state, so this stops being theoretical. Someone who buys a second book gets nothing.
      **Decide whether that is the policy you want** before the first repeat buyer complains.
- [ ] **Refund after expiry.** Unchanged, and still open in both source docs.
- [ ] **Nothing alarms on a failed expiry.** If the workflow breaks, trials silently become
      permanent again — the same failure the system has today, just quieter. The tag census in §8 is
      the manual check; run it weekly for the first month.
