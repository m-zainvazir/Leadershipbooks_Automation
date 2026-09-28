# Adding a new author — the A-to-Z runbook

**Created:** 2026-09-24 · **Owner:** M (UI), C (registry)
**Basis:** not theory — this is the Freddy Davis onboarding of 2026-09-24, written down with every
trap that actually bit. Micheal Stickler was author #1; Freddy Davis was the first author onboarded
against the generic system.
**Assumes:** the Voiceflow bot already exists, and the Worker is deployed and live.

> **The acceptance test for this whole document:** adding an author must never require editing a
> Shopify Flow, the trial workflow, the expiry logic, or the Worker's code. If a step below asks you
> to, something has regressed — read [`20-multi-author-generalisation.md`](20-multi-author-generalisation.md).

---

## ⚡ Tooling — read this first (2026-09-28)

Most of the steps below now have a command. **`npm run author`** (in `coach-router/`) shows every
author against every step, read live, and `npm run author -- status --code <code>` names the command
that fixes each gap. Full map: [`21-onboarding-automation.md`](21-onboarding-automation.md) §E.

| Step | Command |
|---|---|
| 1, 5, 7, 10 | `npm run onboard -- --code <n> --author "…" --book "…" --slug <slug> --write` |
| 2 | `npm run author -- page --code <n>` → paste over the CONFIG block of a clone |
| 3 | `npm run author -- shopify --code <n> --sku BC<ISBN> --grams <g> --write` (needs the Shopify token) |
| 4, 9 ids | `npm run author -- set --code <n> --courseLessonUrl … --bookLandingUrl … --shopifyVariantId …` |
| 9 | `npm run author -- zipify --code <n> --from <source code>` |
| 11, 12 | `npm run verify-author -- --code <n> --email <you> --write` |
| all | `npm run author -- status --code <n>` |

The sections below remain the reference for **why** each step is shaped the way it is.

---

## The steps

| Step # | Action | Automated |
|---|---|---|
| 1 | **Voiceflow** — confirm the project, collect projectID / versionID / API key | Manual — read-only, 5 min |
| 2 | **GHL (book-coach.ai)** — clone the coach page, fill `CONFIG`, set `showActivation: true` | Manual — clone + 6 fields |
| 3 | **Shopify** — create the book + coach bundle product | Manual — from scratch |
| 4 | **Course360** — create the course and its Offer | Manual — from scratch |
| 5 | **GHL** — create the coach tag | Manual — 30 seconds |
| 6 | **GHL** — create the grant-course workflow (tag → Grant Offer) | Manual — 2 actions, the ONLY workflow you ever create |
| 7 | **GHL** — create the $59 product and its monthly price | Manual — or ask C, it is one API call |
| 8 | **GHL** — clone the $59 funnel page, repoint it at the new product | Manual — clone + repoint |
| 9 | **Zipify** — clone the landing page, replace values, rewrite the pitch | Manual — the longest step |
| 10 | **Registry** — add the `coaches.json` entry and `npm run push` | **Data only** — one object, then automatic |
| 11 | **Test** — $0 order end to end | Manual — 20 min, do not skip |
| 12 | **Clean up** the test contact | Manual — 2 min |
| — | Shopify Flow A + B | ✅ **Automatic** — never touched again |
| — | Trial emails, waits, day 7/9/10 | ✅ **Automatic** — one workflow serves every author |
| — | Trial expiry (tag removal, `coach_status`) | ✅ **Automatic** — Worker sweep, per-author from the registry |
| — | Purchase → entitlement, tag, course | ✅ **Automatic** — the reconcile does all three |
| — | SMS / voice routing | ✅ **Automatic** — one number, routed by entitlement |

**Nine manual steps, one data entry, and four things that happen by themselves.** Of the nine, only
step 9 takes real time; the rest are clones and form-filling.

---

## 1. Voiceflow — collect the identifiers

You need three values. The **fastest source is the live coach page's HTML**, not the Voiceflow UI:

```bash
curl -s https://www.book-coach.ai/<author-slug> | grep -o 'VF_VERSION_ID *: *"[^"]*"'
```

| Value | Where |
|---|---|
| `projectID` | Voiceflow dashboard, or the version id minus 1 on its last hex character |
| `versionID` | the page's `VF_VERSION_ID` |
| `vfKey` | the page's `VF_API_KEY` |

⚠ **Every existing coach page pins the DRAFT, not `main`.** Stickler is the exception — his Worker
entry uses `main` while his page uses the draft, so his web and SMS coaches serve different
snapshots. Pick one per author and use it in both places. Draft = edits are instantly live, no
publish step. `main` = real staging, but someone must remember to publish.

---

## 2. GHL — the coach page on `book-coach.ai`

Clone an existing coach page and edit its `CONFIG` block:

```js
authorName: "Freddy Davis",
bookTitle:  "Worldview Coach",        // the coach label, not necessarily the book
pageTitle:  "Freddy Davis - Worldview Coach",
showActivation: true,                  // 🚨 see below
VF_API_KEY: "VF.DM.…",
VF_VERSION_ID: "6a3339b6eb283c59b70cfa53",
```

🚨 **`showActivation: true` is the single most-missed step.** Of the seven live coach pages checked
on 2026-09-22, **only Stickler's had it.** Without it there is no "Get my activation code" button,
so the buyer can open their course, see the coach, and have **no route to SMS or voice at all** —
with no error anywhere. It looks like everything worked.

**Verify:**

```bash
curl -s https://www.book-coach.ai/<slug> | grep -o 'showActivation *: *[a-z]*'
```

---

## 3. Shopify — the bundle product

| Field | Value |
|---|---|
| Title | `<Book Title> [<Author>] + Your Personal AI Coach` |
| Price | $29.95 |
| Requires shipping | **yes** — it is a physical book |
| SKU | set it. Convention `BC<ISBN>` |
| Weight | set it — `0` breaks carrier-calculated rates |
| Status | Active, published to Online Store |

**Collect both ids.** The product id is in the admin URL; the variant id is not. Get both at once:

```bash
curl -s https://leadershipbooks.com/products/<handle>.js \
| python -c "import json,sys; d=json.load(sys.stdin); print('product',d['id']); [print('variant',v['id'],v['price']/100) for v in d['variants']]"
```

---

## 4. Course360 — course and Offer

**Build it clean; do not duplicate an author's live course.** Duplicating carries the filler lessons
(`Lesson 1: The What`, `The Why`, `The How`, `What's Next?`) into every future author. They are
template junk and they are customer-visible.

| | |
|---|---|
| Course name | `BookCoach AI — <Author> — <Coach Label>` |
| Lessons | **one**, holding only the coach iframe |
| Iframe src | `https://www.book-coach.ai/<slug>?cid={{contact.id}}&amp;em={{contact.email}}` |
| Offer | one, **Free** |

⚠ **The Offer must be Free.** It is the access-grant mechanism, never a sales surface — money is
collected by Shopify ($29.95) and the GHL funnel ($59). Pricing it creates a third, unmanaged
checkout that the Worker cannot see. Also confirm it is **not publicly listed**, or anyone with an
account can grant themselves course access.

⚠ `&amp;` in the iframe src is correct HTML encoding. Do not "fix" it.
⚠ The lesson editor strips `<script>` **and** `<button>`. Nothing executable goes in the lesson —
that is why the activation UI lives on the coach page.

**Then get the MEMBER lesson URL** — not the admin one:

```
https://login.leadershipbookspublishers.com/courses/products/<uuid>
```

Take the admin URL and **delete everything from the `?` onwards**. The admin link carries
`is_preview=true` and a personal `token=`; the preview flag serves an admin shell that silently
fails for real members. `seed-coaches.mjs` refuses both.

---

## 5. GHL — create the coach tag

Convention: `bookcoach-<author-slug>-active`

GHL creates tags implicitly, but the tag must **exist** before it can be picked in step 6's trigger.
Either add it by hand under Settings → Tags, or apply it to any contact once and remove it again —
the tag persists in the location either way.

---

## 6. GHL — the grant-course workflow

**This is the only workflow you will ever create per author.** Two actions:

| | |
|---|---|
| Name | `Book Coach — Grant Course (<Author>)` |
| Trigger | **Contact Tag** → Tag added → `bookcoach-<author>-active` |
| Action | **Grant Course360 offer** → that author's Offer |
| | **Publish** |

🚨 **Publish it BEFORE the first order.** GHL's own notice on that trigger reads *"only applies to
tags added after the workflow is published."* A buyer who arrives first gets a trial with no course
access, and it cannot be fixed retroactively without re-cycling their tag.

**Why this exists at all:** `Grant Offer` resolves an Offer **id**, and GHL cannot template one.
It is the last author-specific thing in the whole system. [`20`](20-multi-author-generalisation.md)
§4.6 removes it by collapsing every course into one "My Coaches" page — worth doing around author
four or five.

> **Do not put this in the trial workflow.** GHL branches never merge, so an If/Else per author would
> force duplicating the entire email sequence inside each branch.

---

## 7. GHL — the $59 product and price

| | |
|---|---|
| Product | `BookCoach AI - <Author> - Coach Access` |
| Type | **SERVICE** |
| Available in store | **off** |
| Description | `Monthly access to the <Author> Book Coach AI by text, phone and web.` |
| Price name | `BookCoach AI - <Author> - Coach Access @ 59/month` |
| Amount | 59 USD, **recurring**, every 1 month |

This product id becomes `ghlProductId`, and it is what the reconcile matches to grant a paying
subscriber. **Get it wrong and a buyer pays for one author and receives another.**

⚠ **Do not reuse a similarly-named existing product.** The location already contains things like
`The Truth Mirage Course in 4 Payments Plan` — a different product entirely.

🟢 Renaming later is safe: everything binds on id, never on name. Verified 2026-09-24.

---

## 8. GHL — the $59 funnel page

Clone an existing coach funnel, then:

1. **Repoint the order form** at the new product **and** its price
2. Give it a real slug — `/<author-slug>-coach-access`
3. Replace the author's name in the copy (hardcode it; a funnel page has no contact context, so
   merge fields do not resolve)
4. Publish

🚨 **A cloned funnel still points at the source author's product.** Until you repoint it, a buyer
pays $59 and is granted the *other* author's coach — entitlement matches on product id, not on which
page they bought from.

⚠ The clone also inherits the source author's **JSON-LD schema**, which GHL will not refresh on a
page that already has it. Cosmetic (search snippets only). Fix under Funnel Settings → SEO & AEO.

**Verify:**

```bash
curl -s https://www.book-coach.ai/<slug>-coach-access | grep -c "<previous author surname>"
```

---

## 9. Zipify — the landing page

The longest step, and the one no automation covers. **Zipify has no variables** — a cloned page is
static HTML.

### 9a. Clone and replace

| Find | Replace |
|---|---|
| `<Old Book>™` | `<New Book>™` ← **do the ™ form first**, or the plain replace mangles it |
| `<Old Book>` | `<New Book>` |
| `<Old Author>` | `<New Author>` |
| `<Old First Name>'s` | `<New First Name>'s` ← **possessives are missed by a plain replace** |
| `<Old First Name>` | `<New First Name>` |
| old Shopify product id | new product id |
| old Shopify variant id | new variant id |

### 9b. Rewrite the pitch — this is not optional

**Roughly 70% of the page is book-specific.** Stickler's page sells a *publishing* coach because his
novel is set in the publishing world. Another author's book is about something else, and a
find-and-replace leaves their page selling the wrong thing.

Shared across all authors (~30%): the mechanics, the terms, the phone number, the guarantee, footer.
**Make those [Zipify Global Sections](https://help.zipify.com/en/articles/7855548-global-sections-zipify-pages)** — saved once, reused everywhere, and edits propagate
instantly to every page. ⚠ That propagation has no staging: a bad edit hits every author at once.

### 9c. 🚨 The Add to Cart button — use a plain link

**Zipify's Product element will probably show `No variants` and render the button as `Unavailable`.**
Seen on 2026-09-24 with Freddy. Shopify was fine — the two products were byte-identical on the
storefront API — but Zipify's synced copy of a newly created product had the title and thumbnail and
**no variants**. Re-selecting the product, deleting and re-adding the button, saving and publishing
all failed to fix it.

**The fix that works: drop the Zipify Product Button and use a plain Button element.**

```
Label: ADD TO CART
Link : https://leadershipbooks.com/cart/<VARIANT_ID>:1
```

Verified: adds the variant and goes straight to checkout. It bypasses Zipify's product resolution
entirely, so the sync problem stops mattering. The only loss is Zipify's dynamic `{{price}}` token,
and the page already shows the price as static text.

**Do this by default for every new author** — it is fewer moving parts, and the only per-author value
is the variant id.

### 9d. Verify

```bash
curl -s https://leadershipbooks.com/pages/<new-slug> \
| grep -c "<old author>\|<old book>\|<old product id>\|<old variant id>"
```

Must return **0**.

---

## 10. Registry — the one data-only step

Add to `coaches.json`, then `npm run push`:

```json
{
  "code": "1043",
  "name": "Freddy Davis",
  "displayName": "Freddy Davis",
  "bookTitle": "The Truth Mirage",
  "aliases": ["Freddy Davis", "Freddy", "Davis"],
  "projectID": "6a3339b6eb283c59b70cfa52",
  "versionID": "6a3339b6eb283c59b70cfa53",
  "vfKey": "VF.DM.…",
  "voiceMode": "inline",
  "ttsVoice": "Polly.Matthew-Neural",
  "ghlTag": "bookcoach-freddy-davis-active",
  "ghlProductId": "6ab501e01d7cb94f5e175eb4",
  "shopifyProductId": "10454698754362",
  "landingPageUrl": "https://www.book-coach.ai/freddy-davis-coach-access",
  "courseLessonUrl": "https://login.leadershipbookspublishers.com/courses/products/<uuid>",
  "trialDays": 10
}
```

**`npm run seed` is your checklist.** It refuses the write on a duplicate id, a non-numeric Shopify
id, a preview lesson URL, or a tag in the `shopify_` namespace — and it warns on every field you
have not filled in yet. A clean run with zero warnings means the author is complete.

`code` must be numeric so a voice caller can key it. `aliases` stop being cosmetic at several
authors: speech recognition needs them.

---

## 11. Test — a $0 order, end to end

Do not skip this, and do not substitute `test-ghl-webhook.ps1` — it only proves GHL talking to
itself. Only a real order exercises the Zipify button, the Flow, the HMAC, the registry lookup and
the emails, which is where every onboarding bug actually lives.

1. Shopify → 100%-discount code → order the new bundle with a **fresh email never used in GHL**
   (a $0.00 order still reports `Paid`)
2. Tag the order `delivered-manual` → **More actions → Automate with Flow → Run workflow** → Flow B
3. Within two minutes, check the contact

| Check | Expect |
|---|---|
| tags | `bookcoach-<author>-active` **and** `coach-trial-started` |
| `coach_status` / `coach_code` | `trial` / the new code |
| `coach_name` / `coach_book_title` | the new author / the new book |
| `coach_trial_ends` | a real date ~10 days out |
| `coach_link` / `coach_landing_url` | **that author's** lesson and funnel |
| Welcome email | arrives, names the author, lesson link works |
| Course360 `Welcome!` | arrives — proves the grant workflow fired |

### Traps that cost real time during Freddy's run

- 🚨 **A workflow with no trigger shows no error.** The trial workflow lost its trigger during a
  cutover and Execution logs simply stayed empty. **When a workflow "does nothing", check it has a
  trigger before checking anything else.**
- 🚨 **Shopify Flow's tag condition is easy to invert.** `None of order/tags → is not any of X` means
  *"no tag is something other than X"* — it passes only when the order has **no tags at all**. The
  correct form is `All of order/tags → is not any of X`. **The canvas renders both identically**;
  only the run log tells them apart.
- ⚠ **GHL's contacts/search index lags ~20 seconds**, on creates *and* deletes. `GET /contacts/<id>`
  is immediate and authoritative. A census read too soon looks like a broken workflow.
- ⚠ **Use a unique email AND phone.** GHL dedupes on both.
- 🟢 **Re-firing needs no new order.** `coach-trial-started` triggers on *tag added*, so removing and
  re-adding it by API replays the entire GHL half in seconds. Cycle the coach tag too and the grant
  workflow replays as well.

---

## 12. Clean up

Delete the test contact. Left in place it is tagged, so the next reconcile grants it a renewing
48-hour lease forever, and it is indistinguishable from a real customer in every count the system
reports.

Its `trial:` KV record cannot be deleted by hand — the expiry sweep removes it as an orphan when it
comes due.

---

## What happens after that, with no further action

| When | What | Who |
|---|---|---|
| Order paid | Flow A starts a 21-day timer | ✅ automatic |
| Delivery known | tag `delivered-manual`, run Flow B — the trial starts now instead | manual, optional |
| Trial start | Worker tags the contact, writes nine fields, GHL sends the welcome | ✅ automatic |
| Day 7 / 9 / 10 | offer, reminder, expiry notice — all merge-field driven | ✅ automatic |
| Day 10 | Worker removes the tag, sets `coach_status: expired`, revokes within 15 min | ✅ automatic |
| Any time | $59 purchase → entitlement, coach tag, course, `coach_status: active` | ✅ automatic |
| Cancellation | lease decays, access ends within 15 minutes | ✅ automatic |

**Nothing in that table needs a per-author workflow.** That is the whole point of the design.

---

## Known gaps, as of 2026-09-24

- 🔴 **SMS and voice have never been exercised under `enforce`.** Zero traffic since 2026-08-26 —
  before enforcement, and before activation went code-only. The capability was proven in August; the
  current path has not been walked. **This is the headline feature.**
- ⚠ **`coach-trial-started` is never removed.** A reader who buys a *second* book gets entitlement
  and the course but **no welcome email**, because GHL only triggers on a tag being added. Harmless
  until someone buys twice.
- ⚠ **Stickler's Voiceflow coach opens with a devotional from *A Journey to Generosity*** — a
  different book from the one his page sells. Voiceflow-side; see [`29-later.md`](29-later.md).
- ⚠ Per-author Course360 courses and grant workflows still exist. §4.6 of
  [`20`](20-multi-author-generalisation.md) collapses them into one "My Coaches" page.
