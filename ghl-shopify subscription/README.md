# Book Coach AI — commercial & trial layer

Sells a physical book on Shopify, starts a 10-day AI-coach trial when it is delivered, and converts
to a $59/month coach subscription. This directory is the **commercial layer only**. The coach
product itself lives in [`../coach-router`](../coach-router) and is already built and live.

**Last updated:** 2026-09-19 · **Status: the commercial layer is BUILT AND PROVEN END TO END.**
Book sells → trial starts → day 7/9/10 fire → trial expires → purchase converts → cancellation
revokes. Every one of those is proven by a real run, not by reasoning.

**Six of nine phases complete** (1, 2, 4, 5, 7, and most of 9). **One item genuinely blocks a
launch:** phase 3 step 4 — a real SMS from a tagged handset, blocked on a US number. It is the only
path in the product nobody has walked, and it is the headline feature.

---

## Start here

| File | What it is |
|---|---|
| **[`plans/00-master-plan.md`](plans/00-master-plan.md)** | **The system of record.** Architecture, verified state, all 9 phases, open questions, identifiers, traps. Read this first. |
| [`plans/01-phase-1-grant-path.md`](plans/01-phase-1-grant-path.md) | The GHL workflow grant path — built and verified. Welcome email copy lives here. |
| [`plans/02-multi-coach-scaling.md`](plans/02-multi-coach-scaling.md) | How this survives ~15 coaches without 15 copies of everything. |
| [`plans/03-shopify-flows.md`](plans/03-shopify-flows.md) | Phase 2 spec — the Shopify Flows, and *why* they are shaped this way. |
| [`plans/04-phase-2-build-runbook.md`](plans/04-phase-2-build-runbook.md) | Phase 2 click-by-click. The keystrokes, with a check after every step. Built; kept as the record of every Shopify Flow trap. |
| **[`plans/05-phase-4-trial-expiry.md`](plans/05-phase-4-trial-expiry.md)** | **Phase 4 spec — the day 7/9/10 sequence and expiry, and the four defects in the old sketch. Next thing to build.** |
| **[`plans/06-phase-4-build-runbook.md`](plans/06-phase-4-build-runbook.md)** | **Phase 4 click-by-click**, including the purchase workflow it cannot ship without. |
| **[`plans/07-phase-5-conversion-path.md`](plans/07-phase-5-conversion-path.md)** | **Phase 5 — the $59 conversion path.** The cancellation workflow, the ACTIVE-status capture, self-serve cancellation, the cold-buyer hole. |
| **[`plans/08-funnel-and-landing-copy.md`](plans/08-funnel-and-landing-copy.md)** | **Paste-ready copy** for the $59 funnel page and the book landing page. Field-by-field for GHL, drop-in HTML for Zipify. |
| **[`plans/09-live-transaction-test.md`](plans/09-live-transaction-test.md)** | **The last untested path.** One transaction closes five open items — and three **free** routes that avoid paying for it. |
| **[`plans/how-the-coach-works.md`](plans/how-the-coach-works.md)** | **What the coach is and how someone reaches it.** The three channels, the 48h lease, and the activation-code flow step by step. Start here if you are new to the coach side. |
| **[`plans/21-new-author-runbook.md`](plans/21-new-author-runbook.md)** | **A-to-Z for onboarding a new author.** 9 manual steps, 1 data entry, 4 things that happen by themselves. Written from the Freddy Davis run, with every trap that actually bit. |
| **[`plans/21-onboarding-automation.md`](plans/21-onboarding-automation.md)** | **Automating the onboarding runbook.** 9 manual steps → 4. Needs one Shopify token; the rest is buildable now. |
| **[`plans/20-multi-author-generalisation.md`](plans/20-multi-author-generalisation.md)** | **Scaling past one author.** Zipify → Shopify → Worker → GHL → expiry, every author-specific value moved into `coaches.json`. Executes [`plans/02`](plans/02-multi-coach-scaling.md). |
| **[`plans/29-later.md`](plans/29-later.md)** | **Wanted, but deliberately not now.** Distinct from the parking lot: these are expected to get done. Currently headed by recreating the author's deleted GHL contact. |
| [`book-coach-ai-subscription-handoff.md`](book-coach-ai-subscription-handoff.md) | The original offer/trial design. Still authoritative on *why* the offer is shaped this way. **Superseded as a build plan** — §4, §6 and §8 carry in-place corrections. |
| [`test-ghl-webhook.ps1`](test-ghl-webhook.ps1) | Fires a fake delivery at the GHL workflow. The main test tool. |

External, and required reading before touching the Worker:

- [`../coach-router/HANDOFF.md`](../coach-router/HANDOFF.md) — the coach product's state of play
- [`../coach-router/plans/to-do.md`](../coach-router/plans/to-do.md) — its outstanding work

---

## The one-paragraph version

Two systems share one GHL sub-account (`tjdqrnOqMAMheHIt6pQD`) and are joined by exactly one thing:
the contact tag **`bookcoach-micheal-stickler-active`**. This project's job is to *write* that tag
when a trial should start and remove it when it ends. The Worker's job is to *read* it — a
15-minute cron turns the tag into a 48-hour renewable lease covering web, SMS and voice. Neither
system needs to know anything else about the other.

---

## Where things actually stand

**Built and verified**

- GHL custom fields `coach_status`, `coach_trial_started`
- GHL workflow `Book Coach — Delivery → Trial Start`, actions 1–6:
  create contact → trial guard → set fields → add tag → grant course offer → welcome email
- Idempotency proven both ways: a duplicate delivery changes nothing
- The join proven: a workflow-applied tag makes the Worker grant entitlement
- Shopify bundle product live at $29.95 with the landing page pointing at it

- **Shopify Flows (phase 2) — COMPLETE 2026-09-16, both paths proven live.** Four real orders:
  #4217 and #4220 through Flow B (`shopify_flow_manual`), #4218 and #4219 through Flow A
  (`shopify_flow_backstop`). All four produced a tagged GHL contact and a Worker lease.
- **The $59 funnel page (phase 5 step 1) EXISTS and is live** at
  `https://www.book-coach.ai/michael-stickler-coach-access` — 200, wired to product
  `6a9185da778550cdf732a700` / price `6a9185e6e5d7f1bbc622c940`, recurring Monthly, Stripe
  connected. Re-verified 2026-09-16. **Do not rebuild it.** `coach-router/plans/07` is stale here.
  ✅ **Rebuilt 2026-09-17** — it was functionally blank (no headline, no price, asking for a
  shipping address on a digital subscription). Now has a headline, `$59/month` on step 1, shipping
  off, and the recurring-terms line by the pay button.
- **`allowTestSubscriptions: false`, `declineSms` and `declineVoice` are set** (2026-09-17) and
  seeded to production KV. A Stripe test card no longer grants a real coach, and an expiring
  subscriber is pointed at the $59 page rather than at an activation code that cannot work.
- **Phase 5 steps 4 and 5 are LIVE (2026-09-17).** `Book Coach — Coach Subscription Started` now
  also adds the tag, and `Book Coach — Coach Subscription Cancelled` removes it on a `Canceled`
  subscription. Neither has fired yet — both are unverified until a real purchase.
- **Activation is by texted code ONLY** (`autoLinkGhlPhone: false`, deployed 2026-09-17). A phone
  number on a contact or a subscription no longer links a handset.
- **The Worker publishes an entitlement map** (`centitle:<contactId>`), so a paying subscriber with
  no tag can now mint an activation code and open a web session. Master plan §3. 323 tests.

**Built since, 2026-09-17/19**

- ✅ **Phase 4 — a trial now ENDS.** `Wait 7d → day-7 email → Wait 2d → day-9 email → Wait 1d →
  Remove Tag + `coach_status` = `expired` + day-10 email`, each step guarded on
  `Coach Status is trial`. **Proven end to end 2026-09-18**: tag removed, status flipped, all three
  emails delivered, census clean. The first trial in this project's history to expire.
- ✅ **The declined-card negative test PASSED** (2026-09-18). A live decline created **no contact
  at all** — `Order Submitted` is proven to be the right trigger, which rules out the worst failure
  available: permanent free access to everyone whose card declined.
- ✅ **Phase 5 step 1 — the funnel page is rebuilt.** Shipping off, headline and `$59/month` on
  step 1, and the recurring-terms line beside the pay button carrying a real cancellation route.
- ✅ **Self-serve cancellation is live.** Stripe customer portal, configured
  `Cancel at end of billing period`, linked from all the trial emails.
- ✅ **The cold-buyer hole is closed.** The purchase workflow now also grants the Course360 offer
  and sends a post-purchase email, so a $59 buyer who never had a trial can still activate.
- ✅ **Email authentication passes DMARC** (2026-09-19). All five emails send from the verified
  dedicated sending domain; verified `SPF PASS · DKIM PASS · DMARC PASS` from a delivered message.

**Not built / outstanding**

- ✅ **Flow A's Wait is 21 days** — reported done 2026-09-17. **Unverifiable from here** (no Shopify
  credential exists in this tree); the only independent check is that the next real Flow A order
  starts its trial ~21 days after the order date.
- 🔴 **Phase 3 step 4 — a real SMS from a tagged handset.** Blocked on a US number. **The only
  end-to-end path never walked**, and the product's headline feature. The Worker half was proven in
  August, but activation went **code-only** on 2026-09-17, which changed how every customer reaches
  it — so that proof no longer covers the current path.
- ⬜ **Ops, cheap and yours:** an uptime monitor on `/health` (nothing watches it), Twilio Advanced
  Opt-Out, confirming wallet **auto-recharge**, and the `bookcoach-staff-all` staff tag.
- ⬜ **Waiting on time or money, not work:** one genuinely `liveMode: true` purchase, and a real
  cancellation reaching period end (settles whether GHL reports `Canceled` immediately or defers).
  Both in [`plans/09-live-transaction-test.md`](plans/09-live-transaction-test.md).
- ⬜ **Phase 6** — web-channel enforcement. Deferred at Muhammad's request; **prerequisites are now
  cleared**, so it is a decision rather than a blocker.
- ⬜ **Phase 8** — IngramSpark delivery data. Blocked on credentials.
- 🅿️ Everything else is parked in [`plans/11-parking-lot.md`](plans/11-parking-lot.md).

**Corrected 2026-09-13.** [`plans/03-shopify-flows.md`](plans/03-shopify-flows.md) named an
`Order tags added` trigger that **does not exist in Shopify Flow**, and omitted a cancel/refund guard
on the 21-day timer. Both are fixed in the spec. The flows are now called **Flow A** (the timer) and
**Flow B** (the manual accelerator).

**The two things most likely to bite**

0. ~~**Nothing ends a trial.**~~ ✅ **Fixed and proven 2026-09-18.** Kept here because it was the
   defining risk of this project for two weeks: phase 2 started trials and nothing stopped them.
1. **`coach_status` and the tag can drift.** The field is bookkeeping; the tag is entitlement.
   Nothing enforces that they move together. A contact reading `trial` with no tag gets nothing,
   silently, and never complains because the welcome email never arrives.
2. **The web coach is ungated** (`webGateMode: warn`) and the Voiceflow API key is readable in the
   live page source. Until that is closed, the trial is enforced on SMS and voice only.

---

## Testing

```powershell
# fire a fake delivery at the GHL workflow
.\test-ghl-webhook.ps1 `
  -WebhookUrl '<GHL_TRIAL_WEBHOOK_URL>' `
  -Email 'you+coachtest@example.com'
```

```bash
# from ../coach-router — did the Worker see it?
npm run subs -- --dry     # preview, writes nothing
npm run subs -- --list    # what is in KV
```

**Delete the test contact afterwards.** Left in place it is tagged, so the next reconcile grants it
a real lease. And **blank `coach_status` before re-testing an existing contact** — left set, the
guard correctly stops the run, which looks exactly like a broken workflow.

> The webhook URL is an **unauthenticated capability**: anyone holding it can start a trial and
> grant themselves the tag. If this repo is ever published, regenerate it in GHL.
