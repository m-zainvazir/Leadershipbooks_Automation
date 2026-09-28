# New-session prompt — the commercial layer is built; what remains is verification and ops

Copy everything below the line into a fresh Claude Code session started in
`D:\Projects\LeadershipBooks\ghl-shopify subscription`.

**Last updated:** 2026-09-19, end of the phase 4/5 completion session.

---

I'm building the commercial layer for Book Coach AI: a physical book sells on Shopify, delivery
starts a 10-day AI-coach trial, and it converts to a $59/month coach subscription.

Read these first, in order:

1. `README.md`
2. `plans/00-master-plan.md` — the system of record
3. `plans/09-live-transaction-test.md` — the only untested path, and the free routes to it
4. `plans/11-parking-lot.md` — so you don't resurface things we deliberately parked
5. `../coach-router/HANDOFF.md` §2 and §10, and `../coach-router/plans/to-do.md`

## Where this stands

**The commercial layer is built and proven end to end.** Book sells → trial starts → day 7/9/10
emails fire → trial expires → purchase converts → cancellation revokes. Each of those is proven by
a real run, not by reasoning. Six of nine phases are complete (1, 2, 4, 5, 7, most of 9).

**Do not re-derive these — they are settled and verified:**

- Two systems, one GHL sub-account (`tjdqrnOqMAMheHIt6pQD`), joined by exactly one thing: the tag
  `bookcoach-micheal-stickler-active`. This project writes it; the coach-router Worker reads it on a
  15-minute cron and turns it into a 48h renewable lease. **Keep that seam thin.**
- **coach-router is DONE and live.** `entitlementMode: enforce`, `webGateMode: warn`.
- **Activation is by texted code ONLY** (`autoLinkGhlPhone: false`). A phone on a form links nothing.
- The ACTIVE subscription status string is **`active`** — observed 2026-09-19. A declined card
  produces `incomplete`. `GHL_SUB_ACTIVE` already matched; no code change needed.
- Voiceflow is published; the environment alias is **`main`**, not `production`. **Canvas edits no
  longer reach customers until published.**
- Email sends from the verified dedicated domain and **passes DMARC**.
- Delivery status exists only in IngramSpark, checked by hand. The carrier-DELIVERED flow is
  **impossible, not deferred**.

## What is actually left

🔴 **The one thing blocking a launch: phase 3 step 4** — a real SMS from a tagged handset to
+1 854 254 5009. Blocked on a US number. **The only end-to-end path nobody has walked**, and the
product's headline feature. The Worker half was proven in August, but activation went code-only on
09-17, so that proof no longer covers the current path.

⬜ **Ops, cheap:** uptime monitor on `/health` (nothing watches it), Twilio Advanced Opt-Out,
confirm wallet auto-recharge, create the `bookcoach-staff-all` staff tag.

⬜ **Waiting on time or money:** one genuinely `liveMode: true` purchase; a real cancellation
reaching period end (settles whether GHL reports `Canceled` immediately or defers — it decides
whether customers lose days they paid for).

⬜ **Phase 6** (web gate) is deferred by choice, prerequisites now cleared. **Phase 8**
(IngramSpark) is blocked on credentials. Everything else is parked in `plans/11`.

## How I want you to work

- **Verify against live systems rather than trusting the docs.** They have been wrong several
  times, and so have you. The GHL token and location id are in `../coach-router/coaches.json`
  (gitignored). Shopify answers `/products/<handle>.js` publicly. The Worker's `/health` takes an
  `x-health-token` header.
- **Tell me when a doc contradicts reality, and correct the doc in place.**
- I do the GHL, Shopify and Voiceflow UI work. You write specs, verify results, keep plans current.
- **Be direct about problems**, and say plainly when you got something wrong.

## Traps that have already cost this project real time

- **A green execution log is not proof.** The contact record and the tag census are.
- **`SENT OK` from `test-ghl-webhook.ps1` only means GHL accepted the webhook** — a fire at a
  workflow in Draft returns the same body and does nothing.
- **GHL dedupes contacts on phone as well as email.** Reusing a phone across tests silently merges
  them into one record and overwrites the email. Use a unique phone every time.
- **GHL's canvas state and published state are separate.** Confirm the publish before verifying.
- **Read `Execution logs` before theorising** about a workflow. It names the action, status and time.
- **Check for idempotency before editing a file twice** — an edit script that assumes its change is
  absent will happily apply it a second time and break the file.
