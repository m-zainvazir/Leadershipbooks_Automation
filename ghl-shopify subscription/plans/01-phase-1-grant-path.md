# Phase 1 — finish the trial grant path

**Owner:** Muhammad (GHL UI). **Time:** ~30 min. **Prerequisite:** actions 1–4 already built and tested.
**Parent plan:** [`00-master-plan.md`](00-master-plan.md) phase 1.

Everything below goes **inside the `Fresh - start trial` branch**, after the existing
`Update contact field` action. Nothing goes on the `None` branch, ever.

---

## Action 5a — Add Tag  ← this is the one that actually grants access

**Add the action:** `+` under `Update contact field` → **Contact** → **Add Tag**.

| Field | Value |
|---|---|
| Tag | `bookcoach-micheal-stickler-active` |

Copy it exactly, lowercase, hyphens not spaces. Note the spelling — **`micheal`**, not `michael`.
That is how it exists in `coaches.json` as the coach's `ghlTag`, and the Worker's comparison is a
lowercased exact match. A tag spelled correctly is a tag that grants nothing.

**What this does.** Within 15 minutes the Worker's reconcile sees the tag and issues a 48-hour
renewable lease. That single tag opens **all three channels at once** — web, SMS and voice —
because `codesForTags()` is what both the SMS/voice reconcile and the web-session gate read. This
is why the trial is granted by tag rather than by anything else.

**Verify it worked** (from `../../coach-router`):

```bash
npm run subs -- --sync     # don't wait for the cron
npm run subs -- --list     # the contact should appear under entitled
```

---

## Action 5b — Grant the Course360 course

**Blocked on one answer:** which membership offer holds the coach lesson.

**Find it:** GHL → **Memberships** → **Offers**. Copy the offer's exact name.
(There is no public API for this — `/courses/` and `/memberships/offers` both 404, so it has to
come off the screen.)

**Then add:** `+` → **Memberships** → **Grant Offer** → select that offer.

### 🔴 THIS IS NOW THE ONLY PATH — inverted 2026-09-17

**The text below used to say the course "matters less than it looks". That is no longer true and
the inversion is total.**

Until 2026-09-17 a trial user whose order carried a phone number never needed the course — the
reconcile auto-linked their handset. **`autoLinkGhlPhone` is now `false`**, so nobody is
auto-linked and **every** customer needs an activation code.

The activation box lives on the coach page, but it is `hidden` unless the page receives
`?cid=…&em=…`, and those only arrive when the page is iframed **from inside the course lesson**.
So: **no course access → no activation code → no coach, on any channel.**

**Action 5b is now load-bearing for every single customer.** It cannot be deferred, and neither can
the lesson URL that action 6 needs to point at.

---

## Action 6 — Welcome email

**Add:** `+` → **Send Email**.

### Two rules that shape the copy

**1. Lead with SMS, not the web page.** SMS and voice are genuinely gated today
(`entitlementMode: enforce`); the web coach is open to anyone with the URL
(`webGateMode: warn`). SMS also needs no login and no course access, and it is the channel the
auto-linked phone makes frictionless.

**2. Do NOT link to `book-coach.ai/michael-stickler` directly.** That link works today and
**dies the day `webGateMode` goes to `enforce`** — the page will start refusing anyone who did not
arrive through the course with a session token. Link to the **course lesson** instead, which
survives the change. Until 5b is configured, ship the email with the web link omitted rather than
pointing at a URL you will have to retract.

### 🔴 DEFECT 2026-09-18 — the day-0 email did not send at all

**Step 4a's test received days 7, 9 and 10 at `muhammadzain+test1@leadershipbooks.com` but nothing
on day 0.** Delivery to that address demonstrably works, and the chain demonstrably ran (the contact
reached `expired`), so the day-0 action specifically did not fire. Most likely detached or pushed
below a `Wait` while the wait steps were added to the canvas.

> **Both day-0 emails DID work on 2026-09-15** — confirmed from real inbox screenshots for order
> #4218 (`tester4@example.com`), both timestamped 11:26 PM. So neither action is inherently broken;
> something changed during the 2026-09-17 canvas edit.

### ✅ RESOLVED 2026-09-18 — a TEST-TOOL artefact, not a product defect

**Execution logs settled it.** `test-ghl-webhook.ps1` hardcoded `phone = '+15551234567'`, and GHL
dedupes on phone as well as email. Two fires with different emails became **one contact**:

| Time | Event |
|---|---|
| 1:30:30 | fire 1 (`coachtest+phase4a`) → **new** contact |
| 1:30:35 | **Welcome Email Executed** → delivered to `coachtest+phase4a@…` |
| 1:36:33 | fire 2 (`muhammadzain+test1`) → `Create contact` **deduped on phone, overwrote the email** |
| 1:36:33 | `None` → `coach_status` already `trial`; the guard stops it |
| 1:37:37 / 1:39:39 / 1:40:42 | days 7 / 9 / 10 → now delivered to `muhammadzain+test1@…` |

**The welcome email went out before the address changed; the other three after.** Hence "three
arrived, one didn't". It also explains why `coachtest+phase4a` has no contact (its email field was
overwritten) and why `pACELF0GTDE4vgGOGLtO` reads `expired` (same record, completed chain).

**Nothing was broken.** The Welcome Email action, the delivery path and the whole chain are healthy —
and the run **proved the trial guard refuses a duplicate enrollment**, which no earlier test had
exercised. ✅ The script now generates a unique phone per run.

> **Two wrong theories were entertained before the log was read** — a detached action, then an
> M365 self-send quarantine. Both were plausible and both were wrong. **Read `Execution logs`
> first**; it names the action, the status and the timestamp, and it would have answered this in
> one click.

### Superseded diagnosis — kept for the record

**The workflow is fine.** Canvas verified: `Update contact field → Add Tag → Course grant offer →
Welcome Email → Wait 7 mins`. Nothing detached. A `Send test mail` from the same action to
`tester4@example.com` arrived normally.

**The cause is SPF.** `leadershipbooks.com` publishes `v=spf1 include:spf.protection.outlook.com
-all` — a hard fail authorising Microsoft 365 only. The Welcome Email action **explicitly sets
`From: MuhammadZain@leadershipbooks.com`**, so GHL's relay fails SPF on every send.

| Recipient | Outcome |
|---|---|
| `muhammadzain+test1@leadershipbooks.com` — **the same mailbox as the From address** | ❌ M365 is authoritative for that domain, applies intra-org anti-spoofing regardless of DMARC, and **quarantined it silently** |
| `tester4@example.com` | ✅ delivered — Gmail honoured `p=none` |

### ⚠ CORRECTION 2026-09-18 — the SPF story does NOT explain the difference

**A prediction made here was wrong and is retracted.** It claimed days 7/9/10 arrived because their
actions leave From Name / From Email blank. **They do not.** The Day 7 action was opened and reads
`From Name: Book Coach AI`, `From Email: MuhammadZain@leadershipbooks.com` — **identical to the
Welcome Email.**

So all four emails are self-sends from the same address with the same SPF hard failure, and three
were delivered anyway. **The sender is not the differentiator.**

**What actually differs about the Welcome Email:**

| | Welcome | Day 7 / 9 / 10 |
|---|---|---|
| Composition | `Quick compose` | **Linked template** (`Sync Edits to Template`) |
| Fires at | **T+0** | T+7 / +9 / +10 min |
| Sent alongside | **Course360's `Welcome!`**, the same instant | nothing |

**Both day-0 emails appear to be missing** — the GHL one and Course360's — from two different
systems and two different senders, at the same moment. That pattern points at T+0, not at either
action. Unresolved.

### How to actually settle it — do this before theorising further

1. **Search the mailbox for `BookCoach`, not `welcome`.** The subject is *"Your BookCoach AI is
   ready!"*; "welcome" appears only in the body. The earlier negative search screenshot showed
   Outlook's **autocomplete dropdown**, not executed results.
2. **Check the Microsoft 365 quarantine** (`security.microsoft.com` → Review → Quarantine). Spoof-
   flagged mail lands there and never reaches the mailbox or the Junk folder.
3. **Open the workflow's `Execution logs` tab** and find the run for that contact. It reports every
   action with its status. **Executed → the mail left GHL and this is a delivery question. Error or
   skip → it is a workflow question.** This is the definitive check and it is one click.

> **The SPF defect stands independently, and applies more broadly than first written.** ALL FOUR
> customer emails send from `@leadershipbooks.com` and **all four fail SPF** against `-all`. Three
> being delivered does not make them safe — it means three receivers chose to ignore a hard
> authentication failure because DMARC says `p=none`. See the ops-hardening row in the master plan.

**Remember there are TWO day-0 emails, from different senders:**

| Email | Sender | Sent by |
|---|---|---|
| `Welcome!` | `Leadership Books <support@reply.leadershipbookspublishers.com>` | the **`Grant Offer`** action — Course360's automatic magic-link email |
| `Your BookCoach AI is ready!` | `BookCoachAI Subscription <MuhammadZain@leadershipbooks.com>` | the **`Send Email`** action — the copy below |

> **The one carrying a *working* course link is Course360's.** The GHL email has only the placeholder
> `[LINK TO COURSE360 LESSON - PENDING]`. So a memory of "the welcome email with the working link to
> the course" is a memory of the **Course360** email — which is also why the rewritten copy below is
> right to point at it as step 1.

**Until the `Send Email` action is restored, a trial customer receives no activation instructions at
all** — and with activation now code-only, that means no coach on any channel.

### 🔴 REWRITTEN 2026-09-17 — activation is now CODE ONLY

**`autoLinkGhlPhone` went to `false` on 2026-09-17.** A phone number on the order or the contact no
longer links anything. **Every customer must now fetch an activation code from inside the course and
text it in.** The previous copy said the opposite — *"No login, no password, no code to remember"* —
and that sentence has been live to every trial customer since order #4217.

#### What changed, and what got better

| | Before | Now |
|---|---|---|
| Customer with a phone on the order | auto-linked, never saw a code | **must fetch a code** |
| Customer without a phone | code from the course | unchanged |
| Course360 access | a fallback path | **the only path** |
| Time from email to working coach | "about 15 minutes" (waiting on the cron) | **immediate** — see below |

**The 15-minute wait is gone, and that is worth saying in the copy.** It only ever applied to the
auto-link path, which depended on the reconcile cron. On the code path, `handleBindMint` reads the
contact's tags **live from the GHL API** (not from KV), and `redeemBindToken` writes the `sub:`
lease **immediately** on redemption with a full 48h expiry. Verified in the Worker source
2026-09-17. So the coach works the moment the code is texted back.

#### ✅ The course URL — resolved 2026-09-17

```
https://login.leadershipbookspublishers.com/courses/products/d818952a-d5a6-46ca-afae-57d1a924b8f9
```

**Verified live 2026-09-17:** `200`, and logged-out it returns `<title>Sign in | Platform</title>`
with a password form — the correct member experience. `login.leadershipbookspublishers.com` is the
members domain already in the Worker's `ALLOWED_ORIGIN`.

**Two near-misses that were offered alongside it and must NOT be used:**

| URL | Why not |
|---|---|
| `app.coursecreator360.com/v2/location/…?view=manager&sub_view=outline` | **404**, and it is the admin course *builder*. A customer must never receive it |
| the same member URL with `?…&is_preview=true` | `is_preview=true` is an admin preview flag. Strip it — the bare URL works and is what a member should get |

> ⚠ **One thing still unverified from outside.** A logged-out fetch can confirm the course product
> and the member domain, but **not** that the coach lesson with the activation box is reachable from
> that page. **Log in as a real member once and confirm the lesson renders the iframe and the
> "Get my activation code" button appears.** The iframe must carry
> `?cid={{contact.id}}&em={{contact.email}}` — without those the box stays `hidden` and the whole
> path dead-ends silently.

#### Why it was a HARD BLOCKER

The old plan said *"ship the email with the web link omitted rather than pointing at a URL you will
have to retract."* **That advice is now dangerous.** Without the course link there is no route to an
activation code, and therefore no route to the coach at all. The email cannot ship without it.

The live email currently contains the literal string `[LINK TO COURSE360 LESSON - PENDING]`, which
has gone to orders #4217–#4220. That was embarrassing before. **It is now a total onboarding
failure** — it is the only step that matters and it points at nothing.

#### 🟢 The two-email contradiction RESOLVES ITSELF

Previously Course360's automatic `Welcome!` email (*"you'll be prompted to create your password"*)
contradicted this one (*"you don't need to log in"*). **With code-only activation, the Course360
email is now step 1 of the correct sequence, not a contradiction.** The copy below leans on it
rather than fighting it.

Still fix the sender mismatch — two different from-addresses in the same minute remains a trust and
deliverability problem.

### Subject line

> Your coach is ready — two minutes to set up

**Preheader:** `Log in, grab your code, text it. That's the whole thing.`

### Body — replaces the live copy

**Tightened 2026-09-18** to ~130 words from ~200, and the duplicate course link removed.

```
Hi {{contact.first_name}},

Your book has arrived, so your coach is live for the next 10 days.

Two minutes to set up, once:

1. Open the separate email titled "Welcome!" from Leadership Books and use
   the login link inside (check spam - it's easy to miss)
2. In your course, open the coach lesson and press "Get my activation code"
3. Text that code to +1 854 254 5009

After that, just text or call that number like you would a person. No app,
no login, nothing to remember.

Your 10 days start today. On day 7 we'll tell you how to keep your coach.
There's no card on file and nothing happens automatically - if you do
nothing, access simply ends.

Outside the US? The text line is US-only - use the coach on the web from
inside the course lesson.

Best Regards,
Muhammad Zain Vazir
AI Project Manager, BookCoach AI
Leadership Books, Inc.
```

### ⚠ Do NOT add a plain course URL to this email

An earlier draft carried
`https://login.leadershipbookspublishers.com/courses/products/d818952a-…`
alongside step 1. **Removed 2026-09-18, and it must not come back.**

**It is a dead end for the audience this email has.** Fetched logged-out, that URL returns
`<title>Sign in | Platform</title>` with a **password form** — and at T+0 the customer has not set a
password yet. The **magic link inside Course360's `Welcome!` email is the only thing that works on
first use**, which is why step 1 points at that email instead of at a URL.

(The plain URL is still correct for the **post-purchase** email in
[`07-phase-5-conversion-path.md`](07-phase-5-conversion-path.md) §3b — a subscriber converting from
a trial already has a password.)

> 🚨 **Consequence: this email now depends entirely on Course360's `Welcome!` arriving.** If that
> lands in spam and goes unread, there is **no route to the coach at all**. That makes the sending-
> domain fix (master plan phase 9) a launch blocker rather than a nice-to-have.

#### Why each line is the way it is

| Line | Reason |
|---|---|
| "two minutes, once" | Sets the expectation honestly. The old copy promised zero setup and then required some |
| Numbered 1-2-3 | This is now a multi-step flow. Prose hides steps; a list does not |
| "the separate Welcome! email" | Turns the contradictory second email into part of the sequence. Naming it also pre-empts "which email?" |
| "check spam" | A magic-link email from a new sender is a classic spam-folder casualty, and it is now step 1 of everything |
| "From then on… nothing to remember" | Preserves the real selling point without lying about setup. The friction is one-time |
| **No "give it 15 minutes"** | Deliberately removed. It was true only for the auto-link path; the code path is immediate |
| "the last one texted in is the one that works" | `redeemBindToken` rebinds a handset and unlinks it from the previous contact. Accurate, and answers the second-phone question without explaining tokens |
| "no card on file" | Keeps the day-10 expiry from reading as a surprise charge |

### ⚠ AS ACTUALLY BUILT — 2026-09-16, read from the live workflow action

The action does **not** use the copy above verbatim, and it does not use a template. Recorded here
so the next person compares against reality rather than the draft.

| Thing | As built |
|---|---|
| Method | **`Quick compose`** — inline in the workflow action, **not** a saved template and not smart builder |
| Font | Verdana 16px, line height 1.5, plain text throughout |
| Images / logo / buttons | **none** — text only |
| Length | 724 characters, 131 words |
| Pre-header | **EMPTY** — the spec called for one; the field is still `(Optional)` |
| Track clicks | ON |
| `{{contact.first_name}}` fallback | none set |

> **Consequence for phase 4:** the three new emails cannot be built by duplicating a template,
> because there is no template. **Build them in `Quick compose` too** — that is what keeps them
> consistent with day 0. See [`06-phase-4-build-runbook.md`](06-phase-4-build-runbook.md) step 2.
>
> ⚠ **CORRECTED 2026-09-17 — this advice was not followed, and that is fine.** All three phase 4
> emails were built as **saved templates** (`Book Coach — Day 7 offer`, `— Day 9 reminder`,
> `— Trial ended`), matching day 0's Verdana 16px / 1.5 plain-text styling by hand. Consistency came
> from matching the formatting, not from sharing a build method. **The trap to remember instead: a
> template is not wired up until it is selected in the workflow's `Send Email` action.**

#### 🚨 THE LIVE COPY, AS RENDERED — read from a real inbox 2026-09-18

Screenshot of the delivered email, order #4218. **Four of its claims went false on 2026-09-17** when
`autoLinkGhlPhone` was set to `false`:

| Live line | Status now |
|---|---|
| *"You don't need to log in or download anything."* | ❌ **False** — they must log into the course to get a code |
| *"In about 15 minutes, text or call your coach at: +1 854 254 5009"* | ❌ **False twice** — texting does nothing before activation, and the 15-minute wait applied only to the auto-link path |
| *"Texting from a different number than the one on your order? …press 'Get my activation code'."* | ❌ Frames the code as an **exception**; it is now the only path |
| *"[LINK TO COURSE360 LESSON - PENDING]"* | ❌ Live placeholder, sent to #4217–#4220 |
| *"Your trial starts today and will automatically expire in exactly 10 days."* | ✅ **Now true** — as of the 2026-09-18 expiry test |

The rewrite above fixes all of them.

#### 🚨 LIVE DEFECT — a placeholder is being emailed to real customers

The live body contains, verbatim:

```
(If you are outside the US, SMS delivery won't work. You can chat with the
coach on the web here: [LINK TO COURSE360 LESSON - PENDING])
```

**`[LINK TO COURSE360 LESSON - PENDING]` has gone out to every trial customer so far** — orders
#4217, #4218, #4219 and #4220. It is unmissable, it reads as unfinished software, and it appears in
the one email whose job is to make the product feel real.

This is the failure mode this plan explicitly warned against two sections above: *"ship the email
with the web link omitted rather than pointing at a URL you will have to retract."* A placeholder is
worse than the omission it was meant to be.

**Fix, in order of preference:**

1. **Paste the real Course360 lesson URL.** The offer grant (action 5b) is configured and working —
   `AI Coach Final — Micheal Stickler — Life Without Reservation` — so trial users genuinely have
   course access. The URL lives in Course360 under that lesson. **Do not** substitute
   `book-coach.ai/michael-stickler`: it works today and **dies the day `webGateMode` goes to
   `enforce`**, which is exactly the retraction this plan was avoiding.
2. **If the URL cannot be found right now, delete the whole parenthetical.** SMS is the lead channel
   and the email works without it. An omission is invisible; a placeholder is not.

#### ✅ RESOLVED 2026-09-19 — one aligned sender across the whole journey

The sender half of this is fixed. All five GHL emails now send from the **verified dedicated
sending domain** (`reply.leadershipbookspublishers.com`, mailgun), which is the same domain
Course360's `Welcome!` already used. **`DMARC: PASS`**, verified from a delivered message.

So the *"two different sender names and two different from-addresses in the same minute"* problem
below is gone. The **contradiction** half was resolved separately on 2026-09-17, when activation
went code-only and Course360's login email became **step 1 of the correct sequence** rather than a
contradiction.

#### The original finding — kept for the record

#### 🚨 TWO welcome emails go out, seconds apart, and they contradict each other

**Confirmed in a real inbox 2026-09-16** (`tester4@example.com`, order #4218, both stamped
2026-09-15 11:26 PM). The branch sends **two** emails, from **two different senders**:

| Action | Subject | Sender | Content |
|---|---|---|---|
| **5b** `Grant Offer` | `Welcome!` | `Leadership Books <support@reply.leadershipbookspublishers.com>` | Course360's automatic magic-link email — *"you'll be prompted to create your password"* |
| **6** `Send Email` | `Your BookCoach AI is ready!` | `BookCoachAI Subscription <MuhammadZain@leadershipbooks.com>` | the Quick compose copy — *"You don't need to log in or download anything"* |

**The contradiction is the problem, not the double-send.** One email says there is no login; the
other hands them a password setup, in the same minute. That undercuts the single strongest thing
about this product — the SMS path needs no account at all — at the exact moment it is being
established.

**Two different sender names and two different from-addresses** in the same minute is also a trust
and spam-filter problem in its own right.

> **For phase 4:** all three new emails must use **one** sender, and it must be a **monitored
> mailbox** — the day-7 copy promises *"reply to this email and we'll take care of it"* as the
> cancellation route, and there is no self-serve cancellation behind it. A reply that lands nowhere
> turns the only cancellation path into a dead end.

#### One line that is currently untrue, and phase 4 makes it true

> *"Your trial starts today and will automatically expire in exactly 10 days."*

**Nothing expires anything today.** The sentence is a promise the system does not keep — it becomes
accurate the moment phase 4 ships. Worth knowing that shipping phase 4 is also what makes the
existing welcome email honest.

### Why each awkward line is there

| Line | Reason it cannot be cut |
|---|---|
| "about 15 minutes" | The reconcile is a `*/15` cron, not an instant grant. A buyer who texts 30 seconds after the email gets refused and emails you. This line is the difference between a launch and a support queue. |
| "YOUR 10 DAYS START TODAY" | The trial-end date is deliberately never stored (handoff doc §7), so it cannot be merged. Saying it starts today is accurate on delivery day and makes "I didn't realise" hard to claim. |
| "different number than the one on your order" | Auto-linking binds the handset on the order. Someone texting from a second phone is refused with no explanation otherwise. |
| "Outside the US" | The number is a US 10DLC campaign. International delivery is unreliable at best. |
| "no card on file" | The whole point of the opt-in model, and the answer to the landing page's current false promise (handoff doc §9). Say it here even though the page is still wrong. |

### Merge fields used

`{{contact.first_name}}` only. `{{contact.coach_trial_started}}` is available and set to today,
but the copy reads better without a date stamp, and the field is reporting-only by design.

---

## Test the whole branch

1. **Blank `coach_status`** on the test contact (`Test Reader`). Leave it set and every run
   correctly stops at the guard — which looks identical to a broken workflow.
2. Also **remove the tag** from that contact, or 5a is a no-op and proves nothing.
3. Fire it:
   ```powershell
   .\test-ghl-webhook.ps1 -WebhookUrl '<GHL_TRIAL_WEBHOOK_URL>'
   ```
4. Execution logs should show, in order: `Add to workflow` → `Create contact` →
   `Fresh - start trial` → `Update contact field` → `Add Tag` → (`Grant Offer`) → `Send Email` →
   `Removed by - End Of Workflow`.
5. Contact record: `coach_status` = `trial`, `coach_trial_started` = today, tag present.
6. From `../../coach-router`: `npm run subs -- --sync` then `npm run subs -- --list` — the contact
   should be entitled.
7. **Fire a second time.** Should take `None` and change nothing.
8. Clean up: delete the test contact, or blank `coach_status` and remove the tag.

The test contact has no phone that can receive US SMS, so step 6 proves entitlement but not
delivery. Actual SMS delivery is proven in master-plan phase 3, with a real order.

---

## Open items this phase surfaced

- [ ] **Which membership offer holds the coach lesson?** Blocks 5b. GHL → Memberships → Offers.
- [x] **UPDATED 2026-09-16 — now TWO $59 products, not three.** Re-read from the live products API.
      `Michael Stickler - Coach Access` (`6a9185da778550cdf732a700`, SERVICE, **$59/mo recurring**)
      is the mapped one and the one the funnel sells.
      `BookCoachAI - Monthly (Standard)` (`6a9978eea94350eafc0958c3`, DIGITAL, **$59/mo recurring**)
      **still exists** and is a live decoy — same price, same interval, nothing sells through it.
      `BookCoach AI - Monthly Standard` (`6a999d662ce3c9050ca6a3f0`) now returns **404 — deleted.**
      ⚠ The surviving decoy matters in phase 4: selecting it as the `Order Submitted` trigger
      product means the trigger never fires and **every paying customer is expired on day 10.**
      See [`06-phase-4-build-runbook.md`](06-phase-4-build-runbook.md) step 1a.
- [x] **RESOLVED 2026-09-16 — it exists now.** `Life Without Reservation + Your Personal AI Coach`
      is in GHL as `6aa3c2dab5682f0951fdb237`, **PHYSICAL, $29.95 one-time** — the Shopify bundle,
      mirrored across. It was genuinely absent when this was written on 2026-09-11 (the Shopify
      product had only just been created) and has synced since.
      ⚠ **It is the book, not the subscription.** Never select it as a purchase trigger — see
      [`06-phase-4-build-runbook.md`](06-phase-4-build-runbook.md) step 1a, trap 1.
- [ ] **`membershipOffers` is empty on all three $59 prices** — no purchase grants course access
      today. Attaching the coach offer to `6a9185e6e5d7f1bbc622c940` would fix that for subscribers
      without a workflow.
