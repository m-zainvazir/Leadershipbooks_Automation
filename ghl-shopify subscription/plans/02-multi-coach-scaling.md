# Scaling to ~15 coaches — one workflow, not fifteen

**Written:** 2026-09-12. **Trigger:** ~15 coaches are coming; the phase 1 build is per-coach shaped.
**Parent:** [`00-master-plan.md`](00-master-plan.md).

---

## 1. Separate what multiplies from what only looks like it does

| Per coach | Cost | Verdict |
|---|---|---|
| Voiceflow project | real content work | **Unavoidable.** It *is* the product. |
| Coach page on `book-coach.ai` | one page | Unavoidable, but templated already |
| `coaches.json` entry | one object | **Already solved.** `npm run push`, no redeploy, live in 60s. |
| GHL tag | ~30 seconds | Trivial |
| Course360 course + Offer | ~a few minutes | Cheap **one-time**. Annoying, not expensive. |
| Shopify bundle product | one product | Unavoidable — it's what's being sold |
| $59 GHL product | ~2 minutes | Cheap one-time |
| **GHL workflow** | **~1 hour each, forever** | ⚠ **This is the real cost** |
| **Shopify Flow** | **~30 min each, forever** | ⚠ **This is the real cost** |

The first seven are **create-once** costs. Fifteen of them is a slow afternoon.

The last two are **maintenance** costs. Fifteen copies of the same workflow means every future change
to the welcome email, the trial length, the day-7 offer or the expiry logic is fifteen edits — and
the failure mode is silent drift, where coach #9 keeps sending last quarter's price because someone
missed it. **That is the thing to engineer away, and it is the only thing.**

---

## 2. The fix — carry coach identity in the payload

Nothing in the current design needs a per-coach workflow. The workflow only needs to know *which*
coach, and that can travel with the delivery event instead of being hardcoded.

```
Shopify order contains a coach bundle
        |
        v
ONE Shopify Flow  --->  looks up which coach that product is
        |
        v  payload gains: coach_code, coach_name, coach_tag, coach_link
        |
ONE GHL workflow  --->  writes those to contact custom fields
        |               then acts on them via merge fields
        v
  Add Tag {{contact.coach_tag}}
  Emails say {{contact.coach_name}}, link {{contact.coach_link}}
```

### New contact custom fields (create once, serve every coach)

| Field | Key | Holds |
|---|---|---|
| Coach Code | `coach_code` | `1042` |
| Coach Name | `coach_name` | `Micheal Stickler` |
| Coach Tag | `coach_tag` | `bookcoach-micheal-stickler-active` |
| Coach Link | `coach_link` | the course lesson URL for that coach |
| **Book Title** | **`coach_book_title`** | **`Life Without Reservation`** — added 2026-09-16 |

> **`coach_book_title` was missing from this table until 2026-09-16.** It surfaced while writing the
> phase-4 emails, which thank the reader by book name. Without it the day-9 and day-10 emails cannot
> be de-hardcoded, and the whole point of this plan is that no email needs editing per coach.

These join the existing `coach_status` and `coach_trial_started`. A contact can hold a trial for
one coach at a time under this scheme — see §5.

### Extended webhook payload

```json
{
  "event": "book_delivered",
  "source": "shopify_flow_manual",
  "email": "reader@example.com",
  "first_name": "Jane",
  "last_name": "Doe",
  "phone": "+15551234567",
  "shopify_order_id": "5432109876543",
  "shopify_order_number": "#1042",
  "delivered_at": "2026-09-08T14:22:00Z",

  "coach_code": "1042",
  "coach_name": "Micheal Stickler",
  "coach_tag": "bookcoach-micheal-stickler-active",
  "coach_link": "https://login.leadershipbookspublishers.com/..."
}
```

> **Re-fire `test-ghl-webhook.ps1` after adding these keys.** GHL cannot map a field it has never
> received, and the mapper only learns from real traffic.

### Hardcoded strings owed at migration — the exact swap list

**Recorded 2026-09-16 while building phase 4.** This plan's stated failure mode is *"silent drift,
where coach #9 keeps sending last quarter's price because someone missed it."* These are the strings
that will drift. They are deliberately hardcoded today — there is exactly one coach, and naming him
converts better than any generic phrasing — but every one must be swapped in the same pass.

| Where | Hardcoded now | Becomes |
|---|---|---|
| Day-7 email, "What you keep" | `Michael Stickler's work` | `{{contact.coach_name}}'s work` |
| Day-9 email, "What you keep" | `Michael Stickler's work` | `{{contact.coach_name}}'s work` |
| Day-9 email, sign-off | `reading Life Without Reservation` | `reading {{contact.coach_book_title}}` |
| Day-10 email, sign-off | `reading Life Without Reservation` | `reading {{contact.coach_book_title}}` |
| Welcome email (action 6) | `Michael Stickler's work` *(if present)* | `{{contact.coach_name}}'s work` |
| Welcome email (action 6) | `login.leadershipbookspublishers.com` | `{{contact.coach_link}}` |
| Day-7/9/10 emails, the CTA link | `…/michael-stickler-coach-access` | the coach's `landingPageUrl` |
| All three emails | `+1 854 254 5009` | **stays literal** — one number serves every coach |

> **Why they are hardcoded and not made generic today.** Generic phrasing ("the author's work",
> "thank you for reading the book") is the worst of both: colder than naming him now, and it still
> has to be edited at migration. Hardcoded is the best copy for the only coach that exists, and the
> swap cost is identical either way.

---

## 3. ✅ ANSWERED 2026-09-12 — merge fields do NOT work in Add Tag

**Test run:** the Add Tag action was set to `{{contact.coach_tag}}` and the workflow fired.

**Result:** the contact came back with `tags: ["{{contact.coach_tag}}"]` — the literal template
string, created as a real tag. **GHL accepts merge-field syntax in Add Tag and never interpolates
it.** No error, no warning.

> **This is the dangerous failure mode, not the safe one.** A hard rejection would have been
> obvious. Instead the workflow looks correctly configured, runs green, and grants nobody anything —
> because the Worker matches `ghlTag` exactly and no coach has a tag named `{{contact.coach_tag}}`.
> At 15 coaches this would have been found in production, by a customer.
>
> Two clean-ups whenever this is retried: delete the junk `{{contact.coach_tag}}` tag from the
> location's tag list, and revert the action to a literal tag.

**Therefore: Fallback A below is the design.** Not an option — the decision.

### Fallback A — the Worker does the tagging ← **CHOSEN**

Already designed: [`../../coach-router/plans/06-shopify-tag-automation.md`](../../coach-router/plans/06-shopify-tag-automation.md) §4,
`POST /shopify/order` — HMAC-verified, idempotent on order ID, maps Shopify product → coach from the
registry, upserts the GHL contact and adds the right tag.

The Worker already holds the registry, the GHL token, and the config machinery. It maps products to
coaches natively because that is what `coaches.json` is for. **Adding a coach becomes one object in
`coaches.json` and `npm run push` — no GHL edit at all.**

The Worker then adds **two** tags:

1. the coach's `ghlTag` — entitlement
2. a generic `coach-trial-started` — the GHL workflow's trigger

One GHL workflow triggers on `coach-trial-started` (a free, standard Contact Tag trigger — which
also retires the premium Inbound Webhook that `HANDOFF.md` §10 wanted avoided) and handles only
trial bookkeeping and email. It never needs to know which coach, because the Worker already did
that part.

**Day-10 revoke** then also belongs to the Worker: the workflow removes `coach-trial-started` and
calls the Worker, or the Worker reads `coach_status` itself. Decide when building.

### Fallback B — one workflow, 15 branches

An If/Else on `coach_code` with a branch per coach, each with its own literal Add Tag and Grant
Offer. Scales to 15, ugly at 40, and adding a coach means editing the workflow. **Acceptable as a
stopgap, not as the design.** Its one virtue: the shared parts (emails, waits, expiry) still live
in one place, so the drift problem is solved even if the branching is inelegant.

---

## 4. The Offer grant is the awkward one

`Course grant offer` is the action least likely to accept a merge field, because it resolves an
offer ID rather than free text.

**Two ways out:**

**(a) Accept per-coach branching just for this one action.** Everything else stays generic. A
15-way branch that only picks an offer is far cheaper to maintain than 15 whole workflows.

**(b) Collapse the courses into one members surface — the better long-term answer.**

Today each coach gets a Course360 course whose real job is to hold one lesson containing the coach
iframe and pass `?cid=&em=` through. The lessons around it (`Lesson 1: The What`, `The Why`,
`The How`) are **confirmed template filler, not author-specific content** — Muhammad, 2026-09-12.
Nothing of value is lost by collapsing them.

So one **"My Coaches"** page replaces all fifteen: a single members page, one Offer
granted to everyone, that asks the Worker which coaches this contact is entitled to and renders
links for those. The Worker already computes exactly that — `codesForTags()` returns the entitled
coach codes for a contact, and it is already what `/api/web/session` uses.

Then the per-coach Course and Offer disappear entirely, and `Grant Offer` leaves the workflow. It
also composes with master-plan phase 6: once the coach page is gated by session token, the members
page is the natural place to mint it.

**Cost:** one page plus a small Worker endpoint. **Saves:** 15 courses, 15 offers, and the only
action that resists going generic.

---

## 4a. One phone number, many coaches — how routing actually behaves

**Confirmed against the Worker source, 2026-09-12.** There is one Twilio number
(`+1 854 254 5009`) for every coach; nothing is per-coach about the phone. Routing is driven by
what the caller is *entitled to*, via `resolveEntitledCoach(env, input, codes)`:

| Reader holds | SMS | Voice |
|---|---|---|
| **1 coach** | texts anything → their coach answers. **Input is not consulted at all.** | calls → **straight through**. No greeting, no code prompt. |
| **2+ coaches** | must name the author, else *"I could not tell which coach you meant. Reply with the author name on your subscription."* | hears the greeting: *"say the author's name, or enter your four digit access code"* |

The source comment is explicit that this — not the removal of the coach menu — is the real security
boundary: with one entitled code the input is never read, so knowing another author's code or saying
their name cannot route anywhere.

### The consequence that matters at 15 coaches

**A reader's second book degrades their first coach's experience.** They go from "text and Michael
answers" to "text and say which author first." Nobody expects that, and it lands on the best
customers — the ones who bought twice.

Two things follow:

1. **The welcome email needs a second variant.** When the contact already holds another coach tag,
   the copy must say *"you now have more than one coach — start your message with the author's
   name."* This is a branch in the workflow on whether any other `bookcoach-*-active` tag is
   present. Include `{{contact.coach_name}}` and `{{contact.coach_code}}` in that variant.
2. **`aliases` in `coaches.json` stop being cosmetic.** `HANDOFF.md` §7 records speech recognition
   needing three attempts to capture a code on one real call — with hints for a *single* coach.
   At 15 authors, mishearings and name collisions get materially worse, and `aliases` are the only
   lever (`speechHints()` is built from the caller's own entitled codes). Populate them per coach:
   full name, common misspellings, surname alone.

---

## 5. Consequences to decide before building

- **One trial at a time per contact.** `coach_status` is a single field, so a reader who buys two
  different authors' books cannot hold two trials. Options: accept it (second trial starts when the
  first ends), or move to `coach_status_<code>` fields, or let the Worker own trial state per coach.
  **The guard in the current workflow already enforces one trial per contact ever** — this is the
  same decision, arriving at scale.
- **`coach_link` per coach** must be recorded somewhere. `coaches.json` already has
  `landingPageUrl`; add a `courseLessonUrl` alongside it so one file stays the registry.
- **The Shopify → coach mapping must live in exactly one place.** Put `shopifyProductId` in
  `coaches.json` (already designed in `plans/06` §4). If Shopify Flow does the lookup instead, that
  mapping gets duplicated into Flow conditions and will drift.

---

## 6. Recommended order

| # | Step | Status |
|---|---|---|
| 1 | ~~Test whether `Add Tag` accepts a merge field~~ | ✅ **Done 2026-09-12 — it does not.** See §3 |
| 2 | **Revert Add Tag to the literal `bookcoach-micheal-stickler-active`** | ⬜ urgent — the workflow is broken until this is done |
| 3 | **Delete the junk `{{contact.coach_tag}}` tag** from the location | ⬜ before it lands on a real contact |
| 4 | Finish coach #1 the current way | ⬜ do not re-architect before one coach works end to end |
| 5 | Build `POST /shopify/order` on the Worker (§3 Fallback A) | ⬜ the chosen design |
| 6 | Add `shopifyProductId` + `courseLessonUrl` to `coaches.json` | ⬜ one registry, one push |
| 7 | Build the "My Coaches" page (§4b) | ⬜ confirmed viable — lessons are template filler |

**Do not stop finishing coach #1 to build this.** A generic workflow with nothing proven end to end
is fifteen times harder to debug than a specific one. Get Stickler live, then generalise from a
thing that works.
