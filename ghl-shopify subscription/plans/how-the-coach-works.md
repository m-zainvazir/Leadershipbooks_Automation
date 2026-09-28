# How the coach works

**Created:** 2026-09-25 · **Source:** read from the live Worker source, not from the other docs.
**Purpose:** the orientation that did not exist anywhere. `HANDOFF.md` has all the pieces but assumes
you already know the shape; the master plan covers the commercial layer. This is the coach itself —
what it is, how someone reaches it, and how the activation code actually works.

---

## What the coach is

Each author has a **Voiceflow agent** trained on their book — its arguments, examples, the way that
author talks. That's the product. Everything else exists to decide *who may talk to it* and *how they
reach it*.

A reader buys a physical book on Shopify. Delivery starts a 10-day trial. After that it's $59/month,
or it stops.

---

## Two systems, one join

```
 COMMERCE (ghl-shopify subscription)        THE COACH (coach-router)
 Shopify → Flow → Worker endpoint
        writes ↓
              GHL CONTACT TAG  ←──────── read every 15 min by the cron
              bookcoach-<author>-active
                                                    ↓
                                          48h lease in KV  →  web · SMS · voice
```

The **tag is the entire interface** between them. The commercial side writes it; the Worker reads it.
Neither knows anything else about the other. Keep the seam this thin and the two can change
independently forever.

---

## Three channels, one phone number

`+1 854 254 5009` serves **every** author. There is no per-author number.

| Channel | Gate | Status |
|---|---|---|
| Web | `webGateMode: warn` | **open to anyone** with the URL |
| SMS | `entitlementMode: enforce` | gated |
| Voice | `entitlementMode: enforce` | gated |

---

## How access is actually decided

Entitlement is a **lease**, not a permission:

```js
sub:+18885550100  →  { contactId, codes: ["1042"], expires: "<48h out>" }
```

Every 15 minutes the cron asks GHL who holds each coach tag, and renews. Two consequences, both
deliberate:

- **Access decays.** If the GHL sync breaks, leases expire within 48 hours rather than granting
  forever. Failure is loud rather than silent.
- **How access ends is a GHL setting, not a code change.** Cancellation, refund, expiry and manual
  removal all reduce to "does the tag exist right now".

An expired lease and no lease are the same answer: no access.

---

## Activation by code

**The problem it solves:** the lease is keyed on a **phone number**, but GHL contacts are
**email-first**. The very first tagged contact had no phone at all. Keying on phone would have
admitted nobody, silently.

So a handset has to prove it belongs to a contact. That is what the code is for.

Since 2026-09-17, `autoLinkGhlPhone: false` — **a phone number sitting on a GHL contact links
nothing.** A texted code is the only way.

### The flow

**1. The member opens their course lesson.** The lesson holds one thing: an iframe of the coach page,
with the member passed through:

```
book-coach.ai/<author>?cid={{contact.id}}&em={{contact.email}}
```

Those merge fields are how the page knows who is looking. *(The Course360 editor strips `<script>`
**and** `<button>`, which is why nothing executable lives in the lesson and the activation UI lives on
the coach page instead.)*

**2. The page calls `POST /api/bind/status`.** Already linked → shows "Phone linked" and the last four
digits. Not linked → shows the button. This path performs **no KV writes**, because it runs on every
page load and writes are the scarce resource.

**3. They press it → `POST /api/bind/mint`** with `{contactId, email}`. The Worker:

- fetches the contact from GHL and checks the email **matches** — one error message for both "no such
  contact" and "wrong email", so the endpoint cannot be used to probe whether an account exists
- computes entitlement via `codesForContact` — the **union** of the published `centitle:` map and a
  live tag read. Either alone is a legitimate grant: the map carries paying subscribers, the tag
  carries trials, staff, comps and the ≤15-minute window before the next reconcile
- no codes → `403 That account does not have an active coach subscription`
- rate-limited to **5 mints per contact per hour**

**4. It returns a 6-character code.**

```
tok:0CF5VM  →  { contactId, codes:["1042"] }   TTL 15 minutes, single use
```

Alphabet is `0-9 A-Z` minus **I, L, O and U** — so nobody mistypes `1` for `I` or `0` for `O`, and it
cannot spell anything unfortunate.

**5. They text it to `+1 854 254 5009`.** `redeemBindToken` fires:

- if that handset was bound to a *different* contact, it is unlinked from the old one first —
  otherwise one phone would answer to two subscriptions
- writes `bind:<phone> → {contactId}` — **permanent**, survives churn
- writes `contact:<contactId> → {phones[]}` — the reverse index the cron walks
- writes the 48h `sub:` lease **immediately**
- deletes the token, and cancels any pending conversation deletion

**6. The coach replies in character, in that same message.**

**No cron wait.** The lease is written on redemption, so the coach answers straight away. The old
welcome-email line about "ready within 15 minutes" became wrong once this landed.

And the link is permanent — they never activate again, even if access lapses and later returns.

---

## An inbound SMS, in order

The order is load-bearing and must not be rearranged:

```
1. STOP / UNSUBSCRIBE  → clear session, reply with NOTHING
                         (Twilio owns the compliance reply; two would be worse)
2. Is it an activation code?  → redeem, link, start the coach
                         (BEFORE the gate — redeeming is how you become entitled)
3. Entitlement check
4. Not entitled + crisis language  → the 988 response, NOT the decline
5. Not entitled  → declineSms, pointing at the $59 page
6. HELP  → what this line is
7. RESET → start the conversation over
8. Otherwise → the coach
```

**Step 4 matters most.** A person in crisis who has never subscribed gets help, not a marketing line.
Verified live in `enforce`.

**Step 2 before step 3** is equally deliberate: an unentitled handset *must* be able to redeem, or
nobody could ever activate.

---

## A call

Same gate, different shape:

- **Not entitled** → `declineVoice`, then hang up. It never reads coach names or codes aloud — that
  was the worst disclosure in the file before it was removed.
- **Entitled to exactly one coach** → **straight through.** No greeting, no code prompt, nothing to
  mishear. This removed two turns from every call, and with them the repeated speech-recognition
  failures recorded in `HANDOFF.md` §7.
- **Entitled to two or more** → a greeting asking for the author's name, with speech hints built
  **only from the coaches that caller holds**.

That last point is the real security boundary: **with one entitled coach the caller's input is never
consulted at all**, so knowing another author's code, or saying their name, cannot route anywhere.
Removing the old coach menu was not what secured this; scoping resolution to the caller's own
entitlement was.

Voice also races Voiceflow against an **8-second soft deadline**, because Twilio abandons a webhook at
15s. If the model is slow the caller hears "let me think about that", the answer parks in
`pend:<CallSid>` for 300 seconds, and is spoken on the next turn. The request is never aborted, so the
turn is not lost.

⚠ **SMS has no equivalent guard.** That is the unfixed cause of the three `11200` errors in the only
real conversation this line has ever had — see "What is not proven" below.

---

## The keyspace

| Key | Holds |
|---|---|
| `coach:<CODE>` | the coach's config, pushed from `coaches.json` |
| `config` | runtime knobs — modes, lease hours, decline copy |
| `sub:<E.164>` | the lease. One read per message; the hot path |
| `bind:<E.164>` | handset ↔ contact. Permanent, survives churn |
| `contact:<id>` | reverse index of phones, walked by the cron |
| `centitle:<id>` | published entitlement, so a paying subscriber with no tag can still mint a code |
| `tok:<CODE>` | activation code, 15 min, single use |
| `trial:<id>:<code>` | when a trial ends. **No TTL — the record is the queue** |
| `arch:<E.164>` | pending conversation deletion, 30 days after access ends |
| `sess:<channel>:<phone>` | which coach and when. No message text. Written frugally |
| `pend:<CallSid>` | one parked voice reply, 300s, deleted on read |

**Conversations live in Voiceflow, not here** — 6-month retention, and we do not control it. The only
exception is `pend:`, which holds one slow voice answer so the call does not drop.

---

## What is proven, and what is not

**Proven end to end, twice** — Micheal Stickler and Freddy Davis. Book sells → trial starts → tag →
lease → welcome + day 7/9/10 emails → expiry → purchase converts → cancellation revokes. Each by a
real run, not by reasoning.

🔴 **Not proven: SMS and voice under `enforce`.** The line has carried **zero traffic since
2026-08-26** — two days *before* enforcement turned on, and three weeks before activation went
code-only. The August conversation worked, but it exercised a different configuration: handsets
auto-linked from the contact's phone number back then, which is exactly the step that changed.

So the activation flow described above is correct in the code and correct in principle, and **no
human has walked it as a real customer would.** That is the one genuine hole left in the product, and
it is blocked on a US handset.
