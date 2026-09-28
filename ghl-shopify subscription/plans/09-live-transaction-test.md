# The live transaction test — one card, five answers

**Created:** 2026-09-18 · **Owner:** M · **Cost:** ~$59, refundable · **Time:** ~25 minutes
**Covers:** phase 4 steps 4c and 4e, phase 5 steps 6 and 7, and the cancellation-timing question.

> **Why this is one test and not four.** Every remaining unknown in the commercial layer needs the
> same thing: a real paid subscription to exist. Doing them separately means paying and refunding
> several times. Done in one sitting, a single transaction closes all of them.

| # | Open item | Open since |
|---|---|---|
| 1 | ✅ **CLOSED 2026-09-19.** The purchase workflow **does** fire — a test-mode purchase wrote `coach_status: active` onto contact `bx5Ukr3lMkZgw1pmgqSg`. `Grant Offer` and the post-purchase email are still unconfirmed by observation | 2026-09-16 |
| 2 | ✅ **CLOSED 2026-09-19 — the string is `active`.** Re-verified live 2026-09-19: `status: "active", liveMode: false, 59, tester2@example.com`. `GHL_SUB_ACTIVE` already matched; no code change needed | 2026-08-28 |
| 3 | Does the Worker grant on a **subscription** rather than a tag? Never exercised live — `allowTestSubscriptions: false` correctly filtered the test-mode one, so this stayed shut | 2026-08-28 |
| 4 | Does the Stripe portal work, and does **GHL see a portal cancellation**? | 2026-09-17 |
| 5 | Does GHL report `Canceled` **immediately or at period end**? | 2026-09-17 |

> 🚨 **LEFT ARMED — clean this up before running anything below.** Verified live 2026-09-19: the
> test-mode subscription from the item-1/item-2 test is **still `active`** (`sub_1UHEm8C7G7kTQrjQ6cSKTAeA`,
> contact `bx5Ukr3lMkZgw1pmgqSg`, `liveMode: false`), and that contact reads **`coach_status: active`
> with `tags: []`** — the tag/field drift the README names as risk #1, live right now.
> ✅ **`coach_status` was cleared on 2026-09-22** (via the API, with Muhammad's go-ahead) — the field
> drift is gone. 🚨 **The subscription itself is STILL ACTIVE and cannot currently be cancelled:
> Muhammad has no Stripe access as of 2026-09-22.** So the hazard below stands in full.
> It is inert **only** because `allowTestSubscriptions` is `false`. **Free test B below tells you to
> set that to `true`** — the moment you do, this stale subscription grants a real renewing coach
> lease to a contact nobody is watching. **Cancel the subscription and clear `coach_status` first.**

---

## 🟢 The no-payment routes — added 2026-09-18

**A live transaction is not the only way through this.** Three free tests exist, and between them
they close almost everything below. Use this section when a real charge is not an option.

### Free test A — the declined card ✅ DONE 2026-09-18, PASSED

**Cost: nothing. Works in Live mode.** A declined payment moves no money.

Run `4000 0000 0000 0002` (or any invalid number) through the real funnel.

**Result, 2026-09-18:** the payment declined and **no contact was created** — no `coach_status`, no
tag, no workflow run. **`Order Submitted` is proven correct.** This closes step 9 below and rules out
the most expensive failure in the system: a submission-based trigger would have granted permanent,
unexpirable access to every declined card.

### Free test B — Stripe test mode

**Cost: nothing. Closes four of the five open items.** Flip the funnel to **test mode**, run
`4242 4242 4242 4242`, flip back.

The result is a real GHL subscription record with `liveMode: false`, which is enough for:

| Open item | Provable in test mode? |
|---|---|
| Purchase workflow fires — `Add Tag`, `Grant Offer`, post-purchase email | ✅ |
| **The ACTIVE status string** | ✅ — Stripe uses identical status values in test and live |
| Stripe portal round trip | ✅ |
| **Cancellation timing** — immediate or period-end | ✅ |
| Worker grants on a *subscription* rather than a tag | ⚠ needs one temporary config change |

**For that last one:** `allowTestSubscriptions` is `false`, so the Worker deliberately ignores
test-mode subscriptions. Set it to `true` for the duration and back afterwards — one `npm run seed`
each way, no deploy, live in ~30 seconds. Then it is a complete simulation.

> 🚨 **Two things that must be undone.** A funnel left in **test mode takes no money and looks like
> it is working.** And `allowTestSubscriptions: true` means a test card grants a real coach. **Flip
> both back and verify**, as the last step of the session.

> ⚠ **One assumption to watch:** GHL's `Order Submitted` trigger is *believed* to fire on test-mode
> payments, but this has not been verified. If the workflow does not fire, check that before
> concluding the workflow is broken.

### Free test C — a $0 Shopify order

**Cost: nothing.** A 100%-discounted $0.00 order still reports `Paid` — this is how orders #4218 and
#4219 were tested (master plan phase 2.5).

Shopify order → Flow → webhook → workflow → **the rewritten welcome email** → `Grant Offer` →
Course360 `Welcome!`.

**This is the best available test of the rewritten welcome copy**, because it exercises the real
customer path rather than `test-ghl-webhook.ps1`. With the waits now at days, the trial also starts
properly instead of dying in ten minutes.

It does **not** test expiry — that now takes 10 real days — but expiry is already proven (step 4a,
2026-09-18).

### What no free route can close

- **`4c` on a genuinely live subscription** — whether the Worker grants on a real `liveMode: true`
  payment. Test mode plus a temporary flag flip is a faithful simulation, not the thing itself.
- **A real refund path** — untested either way.

---

## Before you start

| Check | Why |
|---|---|
| Funnel **Payment mode = Live** | Confirmed 2026-09-17. `4242 4242 4242 4242` will **decline** in Live mode — that is expected, and it is what makes step 9 a valid negative test |
| Both workflows say **Published**, not Draft | `Coach Subscription Started` and `Coach Subscription Cancelled`. A Draft workflow accepts events and does nothing |
| An email **never used in GHL before** | An existing contact with `coach_status` set stops at the trial guard, which looks exactly like a broken workflow |
| A **real card** | And the intention to refund it at step 10 |

**Record the baseline** so the new subscription is easy to spot:

```bash
curl -s "https://services.leadconnectorhq.com/payments/subscriptions?altId=tjdqrnOqMAMheHIt6pQD&altType=location&limit=100" \
  -H "Authorization: Bearer $GHL_TOKEN" -H 'Version: 2021-07-28' \
| python -c "import json,sys,collections; d=json.load(sys.stdin); print(d['totalCount'], collections.Counter(s['status'] for s in d['data']))"
```

⚠️ **Baseline corrected 2026-09-19 — it is 13, not 11.** Live read:
**`13 Counter({'canceled': 9, 'incomplete_expired': 2, 'active': 1, 'incomplete': 1})`**.
The two new records are both from tests run on 2026-09-18/19: the `active` one is the test-mode
purchase (still live — see the warning above), the `incomplete` one is the declined-card negative
test (`tester5@example.com`, `liveMode: true`). **Anything above 13 afterwards is yours.**

---

## 1. Buy

```
https://www.book-coach.ai/michael-stickler-coach-access?full_name=Live Test&email=<YOUR-FRESH-EMAIL>
```

Real card. Complete the purchase.

---

## 2. Within two minutes — did the workflow fire?

**This is open item 1, and three of these actions have never run before.**

```bash
curl -s -X POST 'https://services.leadconnectorhq.com/contacts/search' \
  -H "Authorization: Bearer $GHL_TOKEN" -H 'Version: 2021-07-28' -H 'Content-Type: application/json' \
  -d '{"locationId":"tjdqrnOqMAMheHIt6pQD","pageLimit":5,
       "filters":[{"field":"email","operator":"eq","value":"<YOUR-FRESH-EMAIL>"}]}'
```

| ✅ Expect | Field |
|---|---|
| `coach_status` = **`active`** | `cAL8RHFCFUgPRA9gZjsx` |
| tag **`bookcoach-micheal-stickler-active`** present | from `Add Tag` |
| Post-purchase email received | *"You're in — your coach is yours"* |
| Course360 **`Welcome!`** email received | proves `Grant Offer` ran |

> **If `coach_status` is empty**, the purchase workflow did not fire — check its trigger is
> `Order Submitted` and that both the product and price filters match. **Stop here if so**; nothing
> downstream is meaningful.

---

## 3. 🎯 Capture the ACTIVE status string — the one that has been open longest

```bash
curl -s "https://services.leadconnectorhq.com/payments/subscriptions?altId=tjdqrnOqMAMheHIt6pQD&altType=location&limit=100" \
  -H "Authorization: Bearer $GHL_TOKEN" -H 'Version: 2021-07-28' \
| python -c "
import json,sys
for s in json.load(sys.stdin)['data']:
    rp=(s.get('recurringProduct') or {}).get('product') or {}
    if rp.get('_id')=='6a9185da778550cdf732a700':
        print(s['status'], '| liveMode', s['liveMode'], '|', s['amount'], '|', s.get('contactEmail'))
"
```

**Write the exact string into this file, and into master plan §7.**

Observed value: **`active`** — captured 2026-09-19 from a test-mode purchase, re-verified live the
same day. Full record: `status: "active" | liveMode: false | 59 | tester2@example.com |
sub_1UHEm8C7G7kTQrjQ6cSKTAeA`. ✅ **`GHL_SUB_ACTIVE = {'active','trialing'}` matches — no code change.**
**Bonus:** a declined card produces **`incomplete`**, correctly excluded.

> ⚠ **Still worth re-reading on the first `liveMode: true` purchase.** The string was observed in
> test mode. Stripe uses identical status values either way, so this is strong evidence rather than
> proof — and master plan phase 5 step 6 records why GHL's UI vocabulary (`Trial`, `Overdue`) is not
> the same set as its API vocabulary (`trialing`, `past_due`).

---

## 4. The self-checking version of step 3

**Easier and more conclusive than reading the string by eye.** From `../coach-router`:

```bash
npm run subs -- --dry
```

| Reads | Means |
|---|---|
| `active subs 1` | ✅ **The string matches `GHL_SUB_ACTIVE`.** Open items 2 and 3 both close |
| `active subs 0` | 🚨 **The string does NOT match.** This is exactly the silent failure the Worker was built to avoid — a paying customer refused. Paste the string from step 3 and it is a one-word fix in `coach-router.worker.js:1584` |

> **This is the cheapest possible test of a year-old assumption.** `GHL_SUB_ACTIVE` is
> `{'active','trialing'}` and both were guessed from Stripe convention. GHL's own trigger UI lists
> `Trial`, not `trialing`, so a mismatch is genuinely plausible.

Then confirm entitlement actually landed:

```bash
npm run subs -- --sync
npm run subs -- --list      # a sub: lease for this contact
```

---

## 5. Cancel through the Stripe portal

```
https://billing.stripe.com/p/login/00g7vegVZ5dH8h2fYY
```

Enter the purchase email → Stripe emails a one-time link → open it → cancel the subscription.

**✅ Check:** the portal loads, finds the subscription, and accepts the cancellation. That closes the
first half of open item 4.

---

## 6. 🎯 IMMEDIATELY re-read the status — this is the timing answer

**Do this within a minute of cancelling. The answer decays.**

Re-run the step 3 curl.

| Reads | Meaning | Action |
|---|---|---|
| **`active`** | ✅ GHL honours Stripe's `Cancel at end of billing period`. **The customer keeps what they paid for.** | Upgrade the funnel and email copy to *"you keep access until the end of your billing period"* — see [`08`](08-funnel-and-landing-copy.md) §3 |
| **`canceled`** | 🚨 GHL reports cancellation **immediately**. The step-5 workflow strips the tag today, so **a customer who cancels on day 2 loses 28 days they paid for** — while holding Stripe's email saying otherwise | Delay the tag removal, or accept it as policy. **Do not** ship the period-end copy |

Observed value: `________________`  ← fill this in

---

## 7. Did the cancellation workflow fire?

Re-run the step 2 contact query.

| ✅ Expect | |
|---|---|
| `coach_status` = `expired` | from `Book Coach — Coach Subscription Cancelled` |
| tag **removed** | same workflow |

> ⚠ **If step 6 said `active`, this will NOT fire today — and that is correct.** The workflow
> triggers on Status = `Canceled`, which will not arrive until period end. **That is the system
> working**, not a failure. Note it and re-check after the period ends; it is the one item this
> sitting cannot fully close.

---

## 8. Confirm the Worker revokes

```bash
npm run subs -- --sync
npm run subs -- --list      # the lease should be gone
```

Then the tag census — the contact **must not** appear:

```bash
curl -s -X POST 'https://services.leadconnectorhq.com/contacts/search' \
  -H "Authorization: Bearer $GHL_TOKEN" -H 'Version: 2021-07-28' -H 'Content-Type: application/json' \
  -d '{"locationId":"tjdqrnOqMAMheHIt6pQD","pageLimit":100,
       "filters":[{"field":"tags","operator":"eq","value":"bookcoach-micheal-stickler-active"}]}'
```

⚠️ **Baseline is 2, but they are NOT the two contacts this file used to mean** — corrected
2026-09-22. `9xr1rjXSV6Re5ijqmQSz` (the author) was **deleted**; the Worker revoked both its
handsets on 2026-09-20 (master plan §7, [`29-later.md`](29-later.md) §1). The current two are:

| Contact | Email | Why it holds the tag |
|---|---|---|
| `LUgsYcYM6TcsZ8UwYmUg` | `muhammadzain@leadershipbooks.com` | deliberate manual grant |
| `pBbymJS7yAOeoUU71zNq` | `bookcoach-staff-test@leadershipbooks.net` | **staff test contact, created 2026-09-22.** Also carries `bookcoach-staff-all`, which is inert until `config.staffTag` is set — [`29-later.md`](29-later.md) §2 |

Anything other than those two is residue.

---

## 9. The negative test — a declined card must grant nothing

**Do not skip this.** It is the only thing that proves the trigger choice was right, and the failure
it catches is silent and permanent.

Fresh email again, same funnel, Stripe's decline card — **this one works in Live mode**:

```
4000 0000 0000 0002        (generic decline — any future expiry, any CVC)
```

| ✅ Expect | |
|---|---|
| The payment fails at the funnel | as it should |
| **No contact is created**, or if one is, `coach_status` is **empty** | the purchase workflow did **not** fire |
| **No tag** | |

> 🚨 **If `coach_status` reads `active` after a decline, stop and do not launch.** It means the
> trigger is firing on form submission rather than payment, and **every declined card grants
> permanent, unexpirable access.** That is the exact failure `Order Submitted` was chosen to
> prevent — see [`06-phase-4-build-runbook.md`](06-phase-4-build-runbook.md) step 1a.

---

## 10. Clean up

| | |
|---|---|
| **Refund** the $59 in Stripe | cancelling ≠ refunding; do both |
| **Delete both test contacts** in GHL | left tagged, the next reconcile grants a renewing lease forever |
| **Re-run the tag census** | must return to **2** — but see the corrected list above; the two are no longer the two this file originally named |
| **Confirm the funnel is still `Live`** | if you flipped it at any point |

---

## What this test cannot close

Be honest about the edges, so nobody records them as done:

- **Period-end cancellation** (step 7) if step 6 reads `active` — needs a real month to elapse
- **SMS/voice activation** end to end — still blocked on a US handset (phase 3 step 4)
- **Email deliverability** — the SPF/DMARC defect is unaffected by any of this and remains the real
  launch blocker. See master plan phase 9

---

## Traps

- **`4242 4242 4242 4242` declines in Live mode.** That is not a bug. Use a real card for the happy
  path and `4000 0000 0000 0002` for the negative test.
- **A funnel left in test mode takes no money and looks like it is working.** If you flip it, flip
  it back and verify.
- **Use a fresh email every time.** GHL dedupes on email *and* phone; a reused contact stops at the
  trial guard and reads as a broken workflow.
- **`SENT OK` and a green execution log are not proof.** The contact record and the tag census are.
- **KV is eventually consistent — allow ~60s** before concluding the Worker did not see something.
