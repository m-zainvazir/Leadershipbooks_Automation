# Onboarding a new author — from scratch to live (v1, without time estimates)

**Created:** 2026-10-01 · Same as [`further-automation-v1.md`](further-automation-v1.md), with the time columns removed. · **Model:** **A — one Course360 course per author** (decided 2026-10-01).
The shared "My Coaches" course is built and parked — [`20-multi-author-generalisation.md`](20-multi-author-generalisation.md) §4.6a.
**Supersedes as the working checklist:** [`new-author-runbook.md`](new-author-runbook.md) (still the reference for *why*
each step is shaped as it is) and the step table in [`21-onboarding-automation.md`](21-onboarding-automation.md).

> **Track it live:** `npm run pipeline` (every author × these steps), `npm run pipeline -- status --code <n>`,
> or `npm run dashboard` for the same in a browser — its **+ Add author** wizard walks every step below with you.
> Steps 17–25: `npm run pipeline -- health`. The dashboard lives in `D:\Projects\LeadershipBooks\BookCoach Author Dashboard`.
> [`22-pipeline-dashboard.md`](22-pipeline-dashboard.md). `npm run author` uses this numbering too (since 2026-10-02).
> **Renumbered 2026-10-05:** the coach page moved up to **step 3** — it comes first, right after the Voiceflow work and
> before the author is created — and took in the old step 5 (page details). So the list is now 0–16, and after launch 17–25.
> Then the **Zipify page** moved to step 8 with **its address right after it (9)**, the funnel page to 10 and the grant workflow to 11.
> **Renumbered 2026-10-12:** "Build the Voiceflow coach" and "Read its IDs" became **one step, 1** (no tick box — the saved IDs are the
> proof), so the coach page is **2**, the author is created at **3**, the bundle **4**, Course360 **5**, the lesson URL **6**, Zipify **7** —
> and the new, optional **8 Course Collection + Bundle Image** keeps 9 onwards on their numbers. Still 0–16, after launch 17–25.

> **You never need the code.** Anywhere a command asks for `--code`, give the slug, the name or a unique part of it
> instead — `--code freddy`, `--code rick-meyer`, `--author stickler`. A name that fits two authors is refused, not guessed.

All commands run in `coach-router/`. Every write command is **dry by default** — add `--write` to act —
and every registry edit is backed up, validated and restored on refusal.

---

## The steps

**Legend:** ✅ **Automated** — one command does it · 🟡 **Assisted** — a command generates or verifies it, a
person pastes or clicks · ✋ **Manual** — no API exists, a person does it in the UI

| # | Step | Where | How | Automated? |
|---|---|---|---|---|
| 0 | **Collect the inputs:** author name (and internal spelling if different), real book title, coach label (filled in as "Author – Book title"), coach code (next free number, e.g. `1045`), page slug (filled in from the name), author photo URL, the author's own page URL, book purchase link | — | from the author / the book | ✋ Manual |
| 1 | **Build the Voiceflow coach, then record its IDs** — prompts, knowledge base, playbooks (it is the product); then the **24-character Version ID** (address bar, *Main* selected — **never** an alias like `main`) and the Project ID (Settings → General). Saving the IDs is the proof: **no tick box** (since 2026-10-12) | Voiceflow | the `book-coach-ai-builder` skill, by hand; the IDs into the dashboard's step 1 | ✋ Manual — *it is the product* |
| 2 | **Coach page — first.** Photo, initials, the author's own site, book button(s); **Save and build the page** makes the whole page from the master template (`showActivation: true`, the coach code, the switch, the 24-char version and the fallback key already in it); **Copy the whole page**; in GHL **Websites** duplicate a coach page, paste into its Custom Code element (Ctrl+A, Ctrl+V), publish at `/<slug>`. Works **before** the author exists — the details wait in the draft and step 3 carries them over | GHL Websites | dashboard **Onboard → step 2** (or `npm run pipeline -- page --code 1045 --copy`) | 🟡 Assisted — built for you, pasted by hand |
| 3 | **Create the GHL side + the registry entry** — coach tag, $59 SERVICE product, recurring monthly price, `coaches.json` entry (slug, label, price id, and the page details from step 2). Refuses on any clash *before* writing | GHL + repo | `npm run onboard -- --code 1045 --author "Jane Smith" --book "Her Book" --slug jane-smith --label "Her Coach" --version <24-char> --project <24-char> --write` | ✅ **Automated** |
| 4 | **Create the Shopify bundle** — "Book [Author] + Your Personal AI Coach", $29.95, ships; published to the Online Store; added to `coach-bundles`; product + variant ids recorded | Shopify | `npm run author -- shopify --code 1045 --write` | ✅ **Automated** |
| 5 | **Course360 course + Offer** — `BookCoach AI — <Author> — <Label>`, **one** lesson holding the coach iframe, one **Free, unlisted** Offer | Course360 | the iframe `src` is printed by step 3 | ✋ Manual — no Course360 API |
| 6 | **Record the lesson URL** — the **member** URL (`login.leadershipbookspublishers.com/courses/products/…`); the preview query is stripped automatically | repo | `npm run author -- set --code 1045 --courseLessonUrl "<paste the preview link>"` | 🟡 Assisted |
| 7 | **Zipify sales page** — clone a live page; name it `Book Coach AI - <Author> - <Book title>` (the dashboard gives it to copy); paste the three boxes of **Generate Landing Pages** (the words for THIS book, written by Claude Code from the Voiceflow coach — `/landing-page <code>`, or the dashboard's button); Add to Cart = **Zipify's Product block set to this author's bundle** (since 2026-10-12; it replaced the plain button to the cart link) | Zipify | dashboard step 7 → Generate Landing Pages; `npm run pipeline -- landing --code 1045` builds the page from its answers. Needs only the bundle (step 4) — publish it the same day as step 11 | ✋ Manual paste · 🟡 words generated |
| 8 | **Course Collection + Bundle Image — optional.** A second product, `<Book title> - Collection Bundle` (course + book), $97 to start, **no inventory tracked, no shipping address**, the Educational Services category and a standard description (both needed to sell abroad), its image uploaded full size; ids recorded as `collectionProductId`. Plus its two boxes of text (Generate Landing Pages → collection). **Sign it off** if this author has none. It never blocks anything, and buying it does **not** give the coach yet ([plan 02](../../BookCoach%20Author%20Dashboard/plans/02-collection-three-months.md)) | Shopify | `npm run author -- shopify-collection --code 1045 --write` | ✅ **Automated** · optional |
| 9 | **Record the sales page** — right after building it, so step 7 can be checked | repo | `npm run author -- set --code 1045 --bookLandingUrl https://leadershipbooks.com/pages/…` | 🟡 Assisted |
| 10 | **$59 funnel page** — clone an existing coach-access page to `/<slug>-coach-access`; **repoint the order form** to this author's product + price; change the author's name in the copy; publish | GHL Websites | ids printed by step 3; `author status` proves the page sells **this** author's product and price and names no other author | ✋ Manual · ✅ checked |
| 11 | **Grant workflow** — `Book Coach — Grant Course (<Author>)`: Contact Tag added = `bookcoach-<slug>-active` → Grant that Offer → **Publish before the first order** | GHL Automation | step 3 prints the exact tag; `author status` confirms it is **published** | ✋ Manual — no workflow-create API · ✅ checked |
| 12 | **Go live** — registry to KV + the key to the Worker. Refuses on any problem (duplicate ids, alias version, missing fields) | Cloudflare | `npm run push` | ✅ **Automated** |
| 13 | **Check every step, live** — pages, product, price, funnel repoint, cart link, other authors' names, workflow published, registry live, key resolved | all systems | `npm run author -- status --code 1045` (or `npm run author` for every author) | ✅ **Automated** |
| 14 | **End-to-end test** — a real $0 order → Flow B → Worker → GHL; checks both tags and all ten fields; cancels the order; `--keep` leaves the contact for hands-on checks | Shopify → GHL | `npm run verify-author -- --code 1045 --shopify-order --write --keep` | ✅ **Automated** |
| 15 | **Hands-on check** — welcome email names the author; Course360 invite opens the course; coach answers; **Get my activation code** works | inbox + browser | the test inbox (`npm run author -- config --verifyEmail …`) | ✋ Manual |
| 16 | **Clean up the test contact** | GHL + KV | ask Claude ("done") — or delete it in GHL | 🟡 Assisted |

### After that — nothing per author, ever

| # | What | Automated? |
|---|---|---|
| 17 | Order paid → Flow A waits 21 days → trial starts | ✅ Automatic |
| 18 | Delivery known → tag the order `delivered-manual` → Flow B starts the trial now | ✋ one tag on the order, then automatic |
| 19 | Trial start: tags, ten contact fields, welcome email, Course360 invite | ✅ Automatic |
| 20 | Day 7 / 9 / 10 emails | ✅ Automatic — one workflow for every author |
| 21 | Trial expiry: tag removed, `coach_status: expired` | ✅ Automatic — Worker sweep |
| 22 | $59 purchase → entitlement, tag, course, `coach_status: active` | ✅ Automatic — Worker reconcile |
| 23 | Cancellation → access ends within ~15 min | ✅ Automatic |
| 24 | SMS / voice routed to the right coach | ✅ Automatic — one number, routed by entitlement |
| 25 | Coach page falls back to Voiceflow if the Worker is down (`CONNECTION: "auto"`) | ✅ Automatic |

---

## The count

| | Steps |
|---|---|
| ✅ Automated (one command) | 3, 4, 8 (optional), 12, 13, 14 |
| 🟡 Assisted (generated or validated, a person pastes) | 2, 6, 9, 16 |
| ✋ Manual (no API exists) | 0, 1, 5, 7, 10, 11, 15 |

**The Zipify page (7) was the longest manual step, because it is copywriting** — Generate Landing Pages now writes
the words (from the Voiceflow coach), leaving the paste. The next two (5 Course360, 11 grant workflow) are exactly what the parked
**My Coaches** model removes; switching it on would move them to "nothing to do"
([`20`](20-multi-author-generalisation.md) §4.6a).

---

## Why each manual step is manual

| Step | Blocker |
|---|---|
| 1 Voiceflow | The coach is the product. Its management API refuses scripted calls (`503`), so even the IDs are read by eye |
| 5 Course360 | No API for courses or Offers |
| 7 Zipify | No API — the words are generated, the paste is by hand |
| 10 Funnel page | No write API for GHL websites/funnels — so it is **verified**, not built |
| 11 Grant workflow | GHL can read workflows (`workflows.readonly`) but not create them — so it is **verified**, not built |
| 15 Hands-on | Reading an email and clicking a login link is the one thing a script cannot honestly claim to have checked |

---

## One-time setup (already done — listed so a new machine can be rebuilt)

| What | Where it lives |
|---|---|
| GHL Private Integration **Book Coach Automation** (contacts, products, prices, subscriptions, workflows, tags, custom fields) | `coaches.json` → `shared.ghlApiToken` |
| Shopify Dev Dashboard app **Book Coach Automation** (`write_products`, `write_publications`, `write_draft_orders`, `write_orders`) | `shared.shopifyShop`, `shopifyClientId`, `shopifyClientSecret` |
| Voiceflow **personal key** — one key for every coach | `shared.vfApiKey` |
| Test inbox for `verify-author` | `shared.verifyEmail` — change with `npm run author -- config --verifyEmail …` |
| `npm run author -- check` | proves every credential above, read-only |

---

## Traps that cost real time — keep these in mind on every author

- **The Voiceflow version must be the 24-character ID.** An alias (`main`) is refused by the personal key, and `npm run push` refuses it.
- **Publish the grant workflow before the first order** — its tag trigger only applies to tags added after publishing.
- **A cloned funnel still sells the source author's product** until its order form is repointed. `author status` catches it.
- **Cloned copy carries the source author's name** — Freddy's live Zipify page still shows Michael Stickler's "About the Author" and pitch (found 2026-10-01). `author status` flags visible names.
- **Never re-add a native Shopify "Order creation" webhook** pointing at the Worker — it starts trials at purchase instead of delivery (removed 2026-10-01).
- **Test in the published page, not the GHL builder preview** — the Worker only accepts `book-coach.ai`, so the preview always looks broken.
- **The Voiceflow key on a coach page is public** — only the fallback uses it; every `<name>-v2` page file is gitignored so it never reaches GitHub.

