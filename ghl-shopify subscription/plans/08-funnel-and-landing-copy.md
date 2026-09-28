# Funnel and landing page copy — paste-ready

**Created:** 2026-09-17 · **Owner:** M (both are UI work) · **Needs:** no Stripe, no code

Two pages, both currently wrong in different ways. §1 is the **$59 funnel** (phase 5 step 1), which
is blank. §2 is the **book landing page** (phase 7), which is live and makes a promise it does not
keep. §3 is the one thing both need that is not yet decided.

> ## The name — decided 2026-09-17
>
> **`BookCoach AI - The Life Without Reservation`**, short form **`BookCoach AI`**.
> **Full name on first use in a piece of copy; `BookCoach AI` every time after.**
>
> ⚠ **`BookCoach` is ONE word.** Four spellings are in play and only the first is the brand:
>
> | Spelling | Where | Correct? |
> |---|---|---|
> | `BookCoach AI` | the decision above | ✅ the brand |
> | `Book Coach AI` | **live in the Worker's `declineSms`**, seeded 2026-09-17 | ❌ needs aligning — one `npm run seed`, no deploy |
> | `BookCoachAI` | the decoy GHL product `6a9978ee…` | never customer-facing |
> | `book-coach.ai` | the domain | ✅ correct as-is |
>
> ⚠ **Internal names are different on purpose and must NOT be renamed to match**: `Micheal Stickler`
> in `coaches.json`, `Michael Stickler - Coach Access` in GHL, and the Course360 offer name are all
> live match keys. Changing one breaks entitlement.

> **Read §3 before pasting either.** Both pages carry a recurring-terms line, and **no cancellation
> policy has been agreed** — neither the *route* (how someone cancels, blocked on Stripe) nor the
> *timing* (whether access ends at cancellation or at period end, which nobody has decided and which
> the system currently answers "at cancellation").

---

## 1. The $59 funnel page

`https://www.book-coach.ai/michael-stickler-coach-access`

> **The page is served at TWO paths** — `/michael-stickler-coach-access` and `/order-form-page`.
> Verified 2026-09-17: byte-identical content, same product and price. **One funnel, two routes,
> no decoy.** `coaches.json` `landingPageUrl` and the funnel's own order records both use the first,
> so treat that as canonical.

### ✅ MOSTLY DONE — published and verified live 2026-09-17

| | Before | Now |
|---|---|---|
| `showShipping` | on | **off** — "Where Should We Ship It?", Street Address, Zip Code and the 200-country picker are all gone |
| step-2 subheading | "Upgrade Your Order & Save!" | **"Your coach access"** |
| step-2 heading | "Your info" | **"Payment"** |
| headline | "Where Should We Ship It?" | **"Start Your Coach Access"** |
| subhead | *(none)* | **"$59/month. Your coach by text, call and web."** — price now on step 1 |
| step-2 security slot | "* 100% Secure & Safe Payments *" | **the recurring-terms line, in the right position:** `$59/month, charged today and monthly until you cancel. Cancel any time, email: MuhammadZain@leadershipbooks.com.` |

### ⬜ Four things still outstanding

1. 🚨 **"Cancel any time - just reply to this email and we'll take care of it"** — email copy on a
   **web page**. A visitor has no email to reply to, and it **contradicts the correct terms line
   lower down**, so the page gives two cancellation instructions and one is impossible. Present in
   the visible benefit block **and** in the page's JSON-LD `description`, which is what search
   engines and link previews read.
   → **`Cancel any time — email MuhammadZain@leadershipbooks.com`**
2. **`Book AI Coach` ×9** — a fifth spelling, in the headline *and* in structured data
   (`"serviceType": "Book AI Coach access"`). Official is **`BookCoach AI`**. See the naming table
   at the top of this file; settle all surfaces in one pass.
3. **`Go To Step #2` ×2** → **`Continue →`**
4. **`Complete Order`** → **`Start My Coach Access`**. Lowest value of the four.

> **Also noted:** the terms-acceptance checkbox is **disabled on both steps**
> (`isEnabledForStep1: false`, `isEnabledForStep2: false`). The terms line covers the disclosure, but
> for a recurring charge an explicit tick is the stronger position in a dispute. A decision, not a
> defect.

### What was there before — kept as the record

The entire visible text of step 1 was:

> You may place an order below · Shipping · **Where Should We Ship It?** · Your info ·
> **Upgrade Your Order & Save!** · *[200-country picker]* · Go To Step #2

No headline, no price, no description, and the word "coach" never appeared. It asked for a street
address for a product that is not shipped.

> **Trap, cost one round trip 2026-09-17:** the first edit pass was made but **not saved and
> published**, so the live page was byte-identical apart from GHL's own build hashes. This is the
> same `Trap 1 — unsaved canvas` recorded in the master plan for GHL workflows. **On this platform,
> confirm the publish before verifying anything.**

### 1a. Order form — field by field

These are the GHL two-step order form's own settings. Field names are from the live page's config
block, so they should map onto what the builder shows you.

| Setting | Now | Change to |
|---|---|---|
| `showShipping` | on | **OFF** — nothing is shipped. This removes the address block *and* "Where Should We Ship It?" in one toggle |
| `showCompanyName` | on | **OFF** — noise on a personal subscription |
| `headline` / `shippingHeadline` | "Where Should We Ship It?" | **`Start Your Coach Access`** |
| `subHeadline` | — | **`$59/month. Your coach by text, call and web.`** |
| `fullName` placeholder | "Full Name..." | `Your full name` |
| `email` placeholder | "Email Address..." | `Email address` |
| `phone` placeholder | "Phone Number..." | **`Mobile number (US — for text and call access)`** |
| `btnText` | "Go To Step #2" | **`Continue →`** |
| `btnSubText` | *(empty)* | `Takes about 60 seconds` |
| `footerText` | "We Respect Your Privacy & Information." | **keep.** ⚠ Do **not** put the recurring terms here: `footerText` sits under the **step-1** button, and no charge is authorised at step 1. The terms belong on step 2, next to `Complete Order` |

**Step 2 fields:**

| Setting | Now | Change to |
|---|---|---|
| step-2 heading | "Your info" | **`Payment`** |
| step-2 subheading | "Upgrade Your Order & Save!" | **`Your coach access`** |
| `btnText` (step 2) | "Complete Order" | **`Start My Coach Access`** |
| security line | "* 100% Secure & Safe Payments *" | **replace with the recurring-terms line — see §3.** This slot sits directly beside the button that authorises the charge, which is exactly where the terms belong, and it is currently spending that position on a platitude |
| "Edit Shipping Details" | — | should disappear with `showShipping` off. **If it does not, that is a bug to chase** — it implies shipping is still enabled somewhere |

> **On the phone placeholder.** It cannot be made required (GHL exposes a required-toggle for full
> name only). It is still worth asking well, because **every buyer now has to text an activation
> code** — `autoLinkGhlPhone` went to `false` on 2026-09-17, so a phone on the form no longer links
> anything by itself. The placeholder's job is now to set the expectation that this is a
> phone-based product, not to skip a step.

### 1b. Page copy — add above the form

The order form is an element on a page. Everything below goes in text blocks above it.

**Headline**

> # Your coach. On your phone. Whenever you need him.

**Subhead**

> Michael Stickler's AI coach, trained on *Life Without Reservation* — by text, by phone call, or
> on the web. $59/month.

**The three-point block**

> **Text him.** Send a question to +1 854 254 5009 and get an answer back. No app, no login.
>
> **Call him.** Same number. Talk it through out loud when typing is not the thing.
>
> **He remembers.** Your conversations carry forward, so you are not starting over every time.

**Price block, immediately above the form**

> ## $59/month
> Billed monthly. Cancel any time. *(§3 — do not paste this until the route is settled)*

**The recurring-terms line** — goes in step 2's security-line slot, not here. Exact string in §3.

**Honest footnote, worth including**

> Text and call access uses a US number and works with US mobile carriers. Web chat works
> anywhere.

**Why that footnote is not optional:** SMS runs on a US 10DLC campaign, and international delivery
on it is unreliable. Selling "text your coach" to a non-US buyer without saying so buys a refund.

### 1c. What NOT to change

Verified live and correct — leave alone:

- product `6a9185da778550cdf732a700` and price `6a9185e6e5d7f1bbc622c940`
- recurring / Monthly, Stripe connected
- the one-click prefill `?full_name=…&email=…`, verified in a browser 2026-09-16

---

## 2. The book landing page

`leadershipbooks.com/pages/life-without-reservation-ai-coach` (Zipify)

### What is wrong, verified live 2026-09-17

`$59` ×4 · `Cancel anytime` ×1 · `SUBSCRIBE NOW` ×1 — on a **$29.95 one-time** checkout.

**The problem is a promise, not a typo.** *"Then $59/month. Cancel anytime."* tells a buyer they
are entering a subscription at this step. They are not: Shopify charges $29.95 once and nothing
auto-renews. The $59 is a **separate, opt-in purchase** through a different system, weeks later.
A buyer who reads that line and later sees a $59 charge they do not remember authorising disputes
it; a buyer who reads it and *never* sees one has been told something untrue either way.

> ⚠ **`book-coach-ai-subscription-handoff.md` §9 is half-stale and will mislead a rewrite.** It
> reasons from *"Under the final model nothing auto-bills."* That was true when it was written and
> is **not** true now — phase 5 exists and the $59/month subscription does auto-bill. Its suggested
> copy survives by luck, because the *book* still never auto-renews. **Corrected below; do not
> rewrite from §9's premise.**

### 2a. Replacement price block — paste-ready

Drop-in for the existing Custom Code element. Keeps the `inherit` + `opacity` approach and the
media query, for the reason §9 records: the section sits on light grey against desaturated navy
body copy, and fixed mid-greys read as a different hue family.

```html
<style>
.lwr-price-row{display:flex;align-items:baseline;flex-wrap:wrap;gap:10px;}
.lwr-now{font-size:42px;font-weight:700;color:inherit;line-height:1.1;}
.lwr-term{font-size:18px;color:inherit;opacity:.85;}
.lwr-incl{font-size:17px;color:inherit;opacity:.9;margin-top:10px;line-height:1.45;}
.lwr-note{font-size:15px;color:inherit;opacity:.75;margin-top:8px;line-height:1.45;}
@media (max-width:767px){.lwr-now{font-size:34px;}.lwr-term{font-size:16px;}.lwr-incl{font-size:16px;}}
</style>
<div style="font-family:inherit;margin-top:18px;">
  <div class="lwr-price-row">
    <span class="lwr-now">$29.95</span>
    <span class="lwr-term">one time</span>
  </div>
  <div class="lwr-incl">
    Your paperback copy of <em>Life Without Reservation</em> — plus <strong>10 days with
    your BookCoach AI</strong>, starting the day your book arrives.
  </div>
  <div class="lwr-note">
    No subscription today. No automatic charges. If you want to keep the coach after your
    10 days, you can continue for $59/month — entirely your choice.
  </div>
</div>
```

**What changed and why:**

| Was | Now | Why |
|---|---|---|
| `~~$59~~ $29.95 first 10 days` | `$29.95 one time` | the struck-through `$59` implied $29.95 is a discounted first period of a subscription. It is not a subscription at all |
| "Then $59/month. Cancel anytime." | "No subscription today. No automatic charges." | the old line promised automatic billing that does not happen here |
| — | "starting the day your book arrives" | sets the trial clock expectation before purchase, so "I didn't realise" is hard to claim |
| — | "entirely your choice" | the actual selling point the old copy threw away |

### 2a-bis. 🚨 The page promises the WRONG BOOK — found 2026-09-17

**Bigger than any copy issue on this page.** `life-without-reservation-ai-coach` is partially built
from the *Invisible to Viral* page, and the substitution was never finished:

| Element | Currently says |
|---|---|
| `<title>` | **Invisible to Viral + Book Coach** \| LeadershipBooks.com |
| `<meta description>` / `og:description` | "Discover the **Invisible to Viral** Book + Personal Coaching program…" |
| Body | "***Invisible to Viral™*** makes the complicated world of publishing understandable…" |
| Body | "Your copy of ***Invisible to Viral™*** will be shipped to you immediately after your order is completed." |

The checkout on that same page posts `10434147320122` / `54042631733562` —
**`Life Without Reservation + Your Personal AI Coach`, $29.95** (verified live).

**So the page tells the buyer they are getting *Invisible to Viral* and ships them *Life Without
Reservation*.** A wrong-product promise in the exact sentence describing what the money buys.

`og:url` is correct, so shares resolve to the right page — and then display the wrong book's title
and description.

**This also explains "AI Publishing Coach" ×12.** That is the right name for a book about
publishing; it reads oddly here because it came across with the rest of the copy. It is a symptom
of the copy-paste, not an independent naming defect.

**To fix, in the body text block:** both `Invisible to Viral™` references → `Life Without
Reservation™`; the opening description → describe this book; `AI Publishing Coach` ×12 → this
coach's real name. **And in Zipify page settings, not the block:** SEO title and meta description.

### ✅ FIXED 2026-09-17 — verified live

| Check | Before | After |
|---|---|---|
| "Invisible to Viral" | 6 | **0** — body, `<title>`, meta and og all clean |
| `<title>` | Invisible to Viral + Book Coach | **Life Without Reservation + Book Coach** |
| meta / og description | "…the Invisible to Viral Book…" | **"…the Life Without Reservation Book…"** |
| QR code claim | present | **gone** |
| price block | `~~$59~~ $29.95 first 10 days` | **new block live** |

✅ **The QR code was an error** (Muhammad, 2026-09-17). No QR code is printed in the book; it was
inherited from the *Invisible to Viral* copy and has been removed. The trial starts from Shopify
Flow on the 21-day timer and by no other route. **If one is ever printed, it is a new delivery path
that bypasses Flow and needs its own spec.**

### 🅿️ PARKED 2026-09-19 — the rename is deferred, not lost

**`AI Publishing Coach` appears 12 times**, including throughout the Subscription Terms block.
**Muhammad parked this on 2026-09-19** — see [`11-parking-lot.md`](11-parking-lot.md). It is a
plausible description rather than a wrong one, and both genuine defects on this page are fixed.

**The table below is kept ready to execute.** If it is ever done, do the whole set in one pass —
partial renames are how five spellings ended up in circulation at once.

| Now | Change to |
|---|---|
| "Then your **AI Publishing Coach** makes it personal." | "Then your **BookCoach AI** makes it personal." |
| "Life Without Reservation™ + **AI Publishing Coach**" | "Life Without Reservation™ + **BookCoach AI**" |
| "Your Book + 10-Day **AI Publishing Coach** Access" | "Your Book + 10-Day **BookCoach AI** Access" |
| "10 days of access to the Life Without Reservation™ **AI Publishing Coach**" | "10 days of access to **BookCoach AI - The Life Without Reservation**" ← the one full-name use |
| remaining occurrences in Subscription Terms | **BookCoach AI** |

### 2b. ✅ FIXED — the button sold the DECOY product (found and closed 2026-09-17)

> **Resolved the same day.** The `SUBSCRIBE NOW` button has been removed. Verified live:
> `SUBSCRIBE NOW` → **0**, `6a997a37e…` → **0**, and **no `payment-link` URL remains on the page at
> all.** The record below is kept because the trap is reusable — any future CTA on any page must be
> checked against the product ID it actually sells, not the label it wears.

#### What it was

```
SUBSCRIBE NOW  ->  https://link.leadershipbookspublishers.com/payment-link/6a997a37a7f78e147447ea71
```

That payment link sells **`6a9978eea94350eafc0958c3`** — `BookCoachAI - Monthly (Standard)`, which
master plan §6 records as **"a live decoy that sells nothing."** The correct product
`6a9185da778550cdf732a700` appears **zero** times on it. Fetched and verified 2026-09-17.

**What happens when a customer clicks it today:**

| | |
|---|---|
| Charge | **$59/month, recurring**, on a live link |
| Worker | matches `recurringProduct.product._id` against `productCodes` = `{6a9185da…}` → **no entitlement, any channel** |
| Purchase workflow (step 4) | filtered on the correct product → **never fires.** No tag, no `coach_status` |
| Cancellation workflow (step 5) | filtered the same way → **never fires either** |

**It takes recurring money and delivers nothing, and nothing in the system records that it
happened.** This is a live billing defect, not a copy defect.

> An earlier note in the master plan said *"the button says SUBSCRIBE NOW when nobody subscribes at
> that step."* That was wrong in an important way: somebody **can** subscribe at that step — to the
> wrong product.

**Fix, either:**

1. **Point it at the real funnel** — `https://www.book-coach.ai/michael-stickler-coach-access` —
   and relabel to `Get The Book` / `Start For $29.95`, or
2. **Remove the button** until this page's job is settled. The book checkout is the intended action
   on this page, and a second CTA competing with it is a conversion problem as well as a billing one.

Keep the parent product block in place either way — the Add to Cart button lives inside it.

**Worth checking:** whether that link has ever taken a payment. `6a9978ee…` did not appear in the
11 subscriptions pulled on 2026-09-17, which is weak evidence nobody has clicked it yet.

### 2c. The "Your purchase includes" block

Handoff §9 problem 3, still open. It describes a one-time buy with no mention of the coach or the
10-day window. Add two bullets:

> - 10 days with Michael's AI coach — text, call or web
> - Your trial starts when your book arrives, not when you order

**The 10-day window should appear twice before the button** — once here, once by the price. That is
deliberate, and it is what makes the trial length hard to dispute later.

---

## 3. ⚠ Cancellation — NOT AGREED, and it gates both pages

**No cancellation policy has been decided.** Two separate things get bundled under that one word,
and both are open. The terms line cannot be finalised until (a) resolves, and should not mention
timing until (b) does.

### (a) The route — how does someone cancel?

Blocked on Stripe dashboard access. Options and reasoning: [`07`](07-phase-5-conversion-path.md) §5.

### (b) The timing — when does access actually stop?

> 🟡 **HALF-ANSWERED 2026-09-17.** Stripe's customer portal is configured **`Cancel at end of
> billing period`**, so a portal cancellation keeps the subscription `active` until the paid period
> ends. **The copy upgrade below is therefore now available — but do not paste it until GHL's
> mirroring is verified on a real cancellation:**
>
> ```
> $59/month, charged today and monthly until you cancel. Cancel any time — you keep
> access until the end of your billing period.
> ```
>
> Promising that while GHL might report `Canceled` immediately is the worst of both worlds: the
> customer holds two written statements that disagree. **Keep the timing-neutral line until the
> first real cancellation proves it.**

**The rest of this section predates that finding and is kept because GHL's half is still open.**

**What the system does today:** `Book Coach — Coach Subscription Cancelled` fires on Status =
`Canceled`, removes the tag, and the Worker revokes within ~15 minutes. So access ends **when GHL
reports the cancellation** — not at the end of the paid period.

**What has never been verified:** whether GHL reports `Canceled` the moment someone clicks cancel,
or only when the paid period expires. Stripe distinguishes the two. **If GHL reports immediately, a
customer who cancels on day 2 of a paid month loses 28 days they have already paid for.**

> **This is why the terms line below says nothing about timing.** Promise *"keep your access until
> the end of your billing period"* and, if GHL cancels immediately, the copy lies — generating
> exactly the dispute this whole pass exists to prevent. Promise *"access ends when you cancel"*
> and, if GHL actually defers, the offer has been made worse than it is for nothing.

**How to settle it:** on the first real subscription, cancel with `cancel_at_period_end` and read
`status` straight from the API — the same call as step 6, on the same purchase. If it comes back
`active`, GHL defers, and the copy can be upgraded to *"keep your access through the end of your
billing period"*, which is the better offer and worth having.

### The exact line — safe under either outcome

Goes in **step 2's security-line slot** (replacing `* 100% Secure & Safe Payments *`), beside the
button that authorises the charge.

**If the Stripe portal is enabled:**

```
$59/month, charged today and monthly until you cancel. Cancel any time from your account.
```

**If it is a support address:**

```
$59/month, charged today and monthly until you cancel. Cancel any time — email MuhammadZain@leadershipbooks.com.
```

✅ **Address supplied 2026-09-17 (Muhammad).** ⚠ **Provisional in two senses.** It is a *personal*
address, not a role address, so it does not survive someone being away or leaving — and it is
`.com` where this account is `.net` elsewhere (`.com` is confirmed real: it is GHL contact
`LUgsYcYM6TcsZ8UwYmUg`). **It must actually be monitored**; a stated cancellation method reaching an
unwatched inbox is worse than none. Revisit before volume, ideally as `support@` or `help@`.

**Do not paste either line, or the price block's "Cancel any time", until (a) is answered.** Card
networks expect a stated cancellation method beside a recurring charge, and the method has to work.

> Everything else on both pages can ship today. **This is the only gate**, and it is a ten-second
> edit once the answer lands.

---

## 4. Verification

| Page | Proof it worked |
|---|---|
| Funnel | fetch the page, strip markup: it names the coach, shows `$59/month`, and contains **no** "Ship It" or "Upgrade Your Order" |
| Funnel | the form shows name, email, phone — and **no** street, city, state, zip, country |
| Landing | `$59` appears **only** in the "continue for $59/month" sentence — never as a price, never with "Cancel anytime" |
| Landing | the button no longer says `SUBSCRIBE NOW` |

```bash
# funnel — should print the new headline and no shipping strings
curl -s https://www.book-coach.ai/michael-stickler-coach-access \
| sed -e 's/<script.*?<\/script>//g' -e 's/<[^>]*>/\n/g' | grep -iE 'coach|ship|upgrade|59'

# landing — count what is left
curl -sL https://leadershipbooks.com/pages/life-without-reservation-ai-coach \
| grep -oiE '\$59|cancel anytime|subscribe now' | sort | uniq -c
```
