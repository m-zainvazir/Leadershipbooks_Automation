# Onboarding a new author — from scratch to live (v1, without time estimates)

**Created:** 2026-10-01 · Same as [`further-automation-v1.md`](further-automation-v1.md), with the time columns removed. · **Model:** **A — one Course360 course per author** (decided 2026-10-01).
The shared "My Coaches" course is built and parked — [`20-multi-author-generalisation.md`](20-multi-author-generalisation.md) §4.6a.
**Supersedes as the working checklist:** [`new-author-runbook.md`](new-author-runbook.md) (still the reference for *why*
each step is shaped as it is) and the step table in [`21-onboarding-automation.md`](21-onboarding-automation.md).

All commands run in `coach-router/`. Every write command is **dry by default** — add `--write` to act —
and every registry edit is backed up, validated and restored on refusal.

---

## The steps

**Legend:** ✅ **Automated** — one command does it · 🟡 **Assisted** — a command generates or verifies it, a
person pastes or clicks · ✋ **Manual** — no API exists, a person does it in the UI

| # | Step | Where | How | Automated? |
|---|---|---|---|---|
| 0 | **Collect the inputs:** author name (and internal spelling if different), real book title, coach label, coach code (next free number, e.g. `1045`), page slug, author photo URL, the author's own page URL, book purchase link | — | from the author / the book | ✋ Manual |
| 1 | **Build the Voiceflow coach** — prompts, knowledge base, playbooks | Voiceflow | the `book-coach-ai-builder` skill, by hand | ✋ Manual — *it is the product* |
| 2 | **Read its IDs** — Project ID (Settings → General) and the **24-character Version ID** (in the address bar with *Main* selected). **Never** an alias like `main` | Voiceflow | copy two values | ✋ Manual |
| 3 | **Create the GHL side + the registry entry** — coach tag, $59 SERVICE product, recurring monthly price, `coaches.json` entry (slug, label, price id). Refuses on any clash *before* writing | GHL + repo | `npm run onboard -- --code 1045 --author "Jane Smith" --book "Her Book" --slug jane-smith --label "Her Coach" --version <24-char> --project <24-char> --write` | ✅ **Automated** |
| 4 | **Create the Shopify bundle** — "Book [Author] + Your Personal AI Coach", $29.95, ships; published to the Online Store; added to `coach-bundles`; product + variant ids recorded | Shopify | `npm run author -- shopify --code 1045 --write` | ✅ **Automated** |
| 5 | **Record the page details** — photo, initials, author link, book button(s) | repo | `npm run author -- set --code 1045 --authorPhotoURL https://… --authorURL https://… --books "Her Book\|https://…"` | 🟡 Assisted — data entry, validated |
| 6 | **Coach page** — in GHL **Websites**, clone the Freddy page; replace its whole `const CONFIG = {…};` block with the generated one; (optional) paste the Voiceflow personal key after `Bearer ` for the fallback; publish at `/<slug>` | GHL Websites | `npm run author -- page --code 1045` prints the block — `showActivation: true`, the coach code, the switch and the 24-char version are already in it | 🟡 Assisted — generated, pasted by hand |
| 7 | **Course360 course + Offer** — `BookCoach AI — <Author> — <Label>`, **one** lesson holding the coach iframe, one **Free, unlisted** Offer | Course360 | the iframe `src` is printed by step 3 | ✋ Manual — no Course360 API |
| 8 | **Record the lesson URL** — the **member** URL (`login.leadershipbookspublishers.com/courses/products/…`); the preview query is stripped automatically | repo | `npm run author -- set --code 1045 --courseLessonUrl "<paste the preview link>"` | 🟡 Assisted |
| 9 | **Grant workflow** — `Book Coach — Grant Course (<Author>)`: Contact Tag added = `bookcoach-<slug>-active` → Grant that Offer → **Publish before the first order** | GHL Automation | step 3 prints the exact tag; `author status` confirms it is **published** | ✋ Manual — no workflow-create API · ✅ checked |
| 10 | **$59 funnel page** — clone an existing coach-access page to `/<slug>-coach-access`; **repoint the order form** to this author's product + price; change the author's name in the copy; publish | GHL Websites | ids printed by step 3; `author status` proves the page sells **this** author's product and price and names no other author | ✋ Manual · ✅ checked |
| 11 | **Zipify sales page** — clone; apply the generated find-and-replace list **in order**; Add to Cart = a plain Button to the cart link; **rewrite the pitch and the About-the-Author section** (~70% of the page is book-specific) | Zipify | `npm run author -- zipify --code 1045 --from 1043` prints the list and the cart link | ✋ Manual — copywriting · 🟡 list generated |
| 12 | **Record the sales page** | repo | `npm run author -- set --code 1045 --bookLandingUrl https://leadershipbooks.com/pages/…` | 🟡 Assisted |
| 13 | **Go live** — registry to KV + the key to the Worker. Refuses on any problem (duplicate ids, alias version, missing fields) | Cloudflare | `npm run push` | ✅ **Automated** |
| 14 | **Check every step, live** — pages, product, price, funnel repoint, cart link, other authors' names, workflow published, registry live, key resolved | all systems | `npm run author -- status --code 1045` (or `npm run author` for every author) | ✅ **Automated** |
| 15 | **End-to-end test** — a real $0 order → Flow B → Worker → GHL; checks both tags and all ten fields; cancels the order; `--keep` leaves the contact for hands-on checks | Shopify → GHL | `npm run verify-author -- --code 1045 --shopify-order --write --keep` | ✅ **Automated** |
| 16 | **Hands-on check** — welcome email names the author; Course360 invite opens the course; coach answers; **Get my activation code** works | inbox + browser | the test inbox (`npm run author -- config --verifyEmail …`) | ✋ Manual |
| 17 | **Clean up the test contact** | GHL + KV | ask Claude ("done") — or delete it in GHL | 🟡 Assisted |

### After that — nothing per author, ever

| What | Automated? |
|---|---|
| Order paid → Flow A waits 21 days → trial starts | ✅ Automatic |
| Delivery known → tag the order `delivered-manual` → Flow B starts the trial now | ✋ one tag on the order, then automatic |
| Trial start: tags, ten contact fields, welcome email, Course360 invite | ✅ Automatic |
| Day 7 / 9 / 10 emails | ✅ Automatic — one workflow for every author |
| Trial expiry: tag removed, `coach_status: expired` | ✅ Automatic — Worker sweep |
| $59 purchase → entitlement, tag, course, `coach_status: active` | ✅ Automatic — Worker reconcile |
| Cancellation → access ends within ~15 min | ✅ Automatic |
| SMS / voice routed to the right coach | ✅ Automatic — one number, routed by entitlement |
| Coach page falls back to Voiceflow if the Worker is down (`CONNECTION: "auto"`) | ✅ Automatic |

---

## The count

| | Steps |
|---|---|
| ✅ Automated (one command) | 3, 4, 13, 14, 15 |
| 🟡 Assisted (generated or validated, a person pastes) | 5, 6, 8, 12, 17 |
| ✋ Manual (no API exists) | 0, 1, 2, 7, 9, 10, 11, 16 |

**The longest manual step is the Zipify page (11), and it is copywriting** — no automation shortens
writing about a specific book. The next two (7 Course360, 9 grant workflow) are exactly what the parked
**My Coaches** model removes; switching it on would move them to "nothing to do"
([`20`](20-multi-author-generalisation.md) §4.6a).

---

## Why each manual step is manual

| Step | Blocker |
|---|---|
| 1, 2 Voiceflow | The coach is the product. Its management API refuses scripted calls (`503`), so even the IDs are read by eye |
| 7 Course360 | No API for courses or Offers |
| 9 Grant workflow | GHL can read workflows (`workflows.readonly`) but not create them — so it is **verified**, not built |
| 10 Funnel page | No write API for GHL websites/funnels — so it is **verified**, not built |
| 11 Zipify | No API, and most of the page is book-specific copy |
| 16 Hands-on | Reading an email and clicking a login link is the one thing a script cannot honestly claim to have checked |

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
- **The Voiceflow key on a coach page is public** — only the fallback uses it; `freddy-v2` is gitignored so it never reaches GitHub.
