# Automating author onboarding

**Created:** 2026-09-28 · **Owner:** C (code), M (credentials + page edits)
**Parent:** [`new-author-runbook.md`](new-author-runbook.md) — the twelve steps this plan attacks.
**Goal:** take onboarding from **9 manual steps → 4**, without touching the shared workflows.

> **Scope discipline.** Nothing here changes what happens to a reader. It changes only how much
> clicking it takes to add an author. If a change would alter the customer path, it belongs in
> [`20-multi-author-generalisation.md`](20-multi-author-generalisation.md), not here.

---

## Where the effort actually goes

Measured on the Freddy Davis onboarding, 2026-09-24:

| Step | Platform | Minutes | Automatable |
|---|---|---|---|
| 1 Voiceflow ids | Voiceflow | 5 | ✅ fully |
| 2 Coach page | GHL | 15 | ✅ mostly — §A |
| 3 Shopify product | Shopify | 10 | 🔑 blocked on a token |
| 4 Course + Offer | Course360 | 15 | ❌ — but §4.6 deletes the step |
| 5 GHL tag | GHL | 1 | ✅ fully — §B |
| 6 Grant workflow | GHL | 5 | ❌ — but §4.6 deletes the step |
| 7 $59 product + price | GHL | 5 | ✅ fully — §B |
| 8 Funnel page | GHL | 15 | ❌ no API |
| 9 Zipify page | Zipify | 45–90 | ❌ no API, and the pitch is copywriting |
| 10 Registry | repo | 3 | ✅ already |
| 11 Test | live | 20 | ✅ mostly — §C |
| 12 Cleanup | GHL | 2 | ✅ fully — §C |

**Step 9 dominates and cannot be automated.** Everything below is about removing the other ~80
minutes of clicking, not about the thing that actually takes longest. Worth being honest about that
before starting.

---

## §A — Serve the coach page's config from the Worker

**Kills step 2. Also closes the largest open security item in the project.**

### 🟢 Half of this already shipped, and nobody planned it

Checked live 2026-09-28:

| Page | VF key in source | Proxies `/api/vf-interact` |
|---|---|---|
| `/freddy-davis` | **no** | **yes** |
| `/michael-stickler` | **yes** | no |

The shared-memory work of 2026-09-25 repointed Freddy's page at the Worker. **So the pattern is
built, deployed and serving a real coach.** What was master-plan phase 6's hardest part is done once.

### What is left

1. **Bring the other pages onto Freddy's pattern.** Copy his `CONFIG` + `vfInteract()` into each.
   Per-author cost is unchanged for now — still a clone and a few fields.
2. **Then make the config itself dynamic.** A page asks the Worker *"who is `/freddy-davis`?"*, and
   the Worker answers from `coaches.json`: display name, book, Voiceflow project, whether to show
   the activation box. New endpoint, roughly:

   ```
   GET /api/coach-page?slug=freddy-davis
   -> { code, displayName, bookTitle, projectID, showActivation: true }
   ```

   After that a new author's page is a clone with **one value changed — the slug** — and
   `showActivation` can never be forgotten, because the Worker decides it.

⚠ **`showActivation` was missing on six of seven pages** when checked on 2026-09-22. It is the most
consequential thing a human forgets, and this removes the opportunity entirely. That is the real
argument for §A, more than the keystrokes saved.

### 🔑 Needed from M

- Paste the new loader into each remaining coach page (Freddy's is the reference)
- **A decision on rotating Stickler's Voiceflow key**, which is still readable in his page source

> 🚨 **Sequence, or the coach goes dark.** Repoint the page FIRST, then rotate the key, then
> `npm run secrets`. Rotating before repointing breaks that coach immediately. This trap is recorded
> in master plan phase 6 and has not changed.

**Effort:** endpoint + tests ~2h. Page edits are M's, ~10 min each.

---

## §B — One command creates the GHL side

**Kills steps 5 and 7. Needs nothing from M.**

All three calls were executed by hand on 2026-09-24 and are known to work:

| Thing | Call | Proven |
|---|---|---|
| Coach tag | `POST /contacts/{id}/tags` then remove | ✅ created `bookcoach-freddy-davis-active` |
| $59 product | `POST /products/` | ✅ created `6ab501e01d7cb94f5e175eb4` |
| Monthly price | `POST /products/{id}/price` | ✅ created `6ab501eb80e11d5e52c11198` |

### The command

```bash
npm run onboard -- --code 1044 --author "Jane Smith" --book "Her Book" --slug jane-smith
```

Does, in order:

1. **Scrape** `https://www.book-coach.ai/<slug>` for `VF_VERSION_ID` and `VF_API_KEY` → derive
   `projectID`
2. **Create** the GHL coach tag (apply to a scratch contact, remove, leave the tag behind)
3. **Create** the $59 SERVICE product and its recurring monthly price, following the naming
   convention in [`20`](20-multi-author-generalisation.md) §7b-bis
4. **Write** the `coaches.json` entry with everything it now knows
5. **Run** the existing validation and refuse on any problem
6. **Print** the remaining manual steps with the exact fields still to fill

Deliberately **not** idempotent-by-guessing: if the coach code already exists it refuses rather than
editing. Creating a second $59 product by accident is worse than typing a command twice.

### Design notes

- Runs `coachProblems()` **before** any write. A bad slug or a duplicate tag must cost nothing.
- `--dry` prints what it would create and calls nothing. Same posture as every other tool here.
- Writes the product id straight back into `coaches.json`, so step 10 collapses into this step.
- Does **not** push to KV. Review the diff, then `npm run push` — the existing two-step stays.

**Effort:** ~3h with tests.

### ✅ Built 2026-09-28 — `coach-router/onboard.mjs` + `lib-onboard.mjs`, 66 tests (614 → 680)

**Not yet run with `--write`** — no author has been onboarded through it. Dry-run verified against
live GHL and live pages: Freddy (`1043`) is refused five ways; Rick Meyer (`1044`) plans cleanly,
and the derived project id `6a34712d677246c3541333c2` matches the one [`20`](20-multi-author-generalisation.md) §7a recorded.

```bash
npm run onboard -- --code 1044 --author "Jane Smith" --book "Her Book" --slug jane-smith            # dry
npm run onboard -- --code 1044 --author "Jane Smith" --book "Her Book" --slug jane-smith --write    # real
```

**Where the build differs from the design above, and why:**

| Design said | Built as | Why |
|---|---|---|
| `--dry` to preview | **dry by default**, `--write` to act | Same posture as `seed`, `subs`, `verify:vf`. `--dry` is harmless and ignored |
| Scrape the page for the key | Key from **env `VF_KEY_<CODE>`**, page only as fallback | 🚨 **A Worker page carries no Voiceflow ids at all** — not just no key. Live `/freddy-davis`, checked today, has only `COACH_CODE` + `WORKER_URL`. After §A no page will have them |
| `projectID` = version minus 1 on the last character | **BigInt** `version − 1` | The last-character rule is wrong whenever the version ends in `0`: it borrows. Tested |
| "Calls nothing" in a dry run | Dry run makes **GHL reads** | A same-named product, a missing staff contact or a real contact already holding the tag are only knowable by reading. Reads cost nothing |
| Create the tag | Applied to the **staff contact** (`shared.config.staffTag`), then removed | ✅ Confirmed necessary: `GET /locations/<id>/tags` → `401 not authorized for this scope` |

**Refuses before any write** on: an existing code, a bad slug, a non-numeric code, TwiML punctuation
in the name, a missing or non-`VF.DM.` key, a bad project/version, any cross-coach duplicate
(`coachProblems`), **a GHL product with the same name**, no staff contact, and **any real contact
already holding the new tag** (they would be entitled on push).

**On a failed write** it stops, names everything already created, and changes nothing in
`coaches.json`. A price failure after the product exists is recovered with
`--ghl-product <id>`, which adopts the product and reuses a matching $59 monthly price if one exists.

**On success** it backs up `coaches.json` (`.bak-<stamp>-onboard-<code>`), appends the entry with
`ghlProductId`, runs `seed-coaches.mjs` dry — restoring the backup if it fails — and prints the manual
steps with the exact values. It warns when `landingPageUrl` is not live yet: the day-7/9/10 emails
link to it.

⚠ **Two things found while building:**

- **`ghl-shopify subscription/freddy-v2` is stale.** The live page is newer (no `CONNECTION`, no
  `VF_*` fields). Re-save the live source before cloning from it.
- **Freddy's live page has `authorURL` pointing at Stickler's speakers-bureau page** — an
  inheritance bug of exactly the §4.1 kind. The printed checklist now names `authorURL`,
  `authorInitials`, `authorPhotoURL` and `books[]`, which the runbook's step 2 omitted.

---

## §C — Verification and cleanup as commands

**Kills most of steps 11 and 12. Needs nothing from M.**

Every onboarding so far has been verified by hand-written curl, and the checks drifted each time.

```bash
npm run verify-author -- --code 1043 --email test@example.invalid
```

1. Fires a signed payload at `POST /shopify/order` with that coach's `shopifyProductId`
2. Waits out GHL's ~20-second search-index lag
3. Reads the contact back **by id** (authoritative; the search index is not)
4. Asserts: both tags, `coach_status: trial`, and that `coach_name`, `coach_book_title`,
   `coach_link`, `coach_landing_url`, `coach_trial_ends`, `coach_code` all match the registry
5. Deletes the test contact and confirms it is gone
6. Prints a pass/fail table

**What it cannot do:** exercise Shopify Flow or the Zipify button. Those need a real order, and that
is exactly where onboarding bugs live — the inverted Flow condition and the Zipify `No variants`
failure would both have passed this check. **`verify-author` supplements the $0 order test; it does
not replace it.** Say so in its own output.

**Effort:** ~2h.

### ✅ Built 2026-09-28 — `coach-router/verify-author.mjs` + `lib-verify-author.mjs`, 23 tests (680 → 703)

**Not yet run with `--write`** — waiting on a test inbox. Dry runs verified.

```bash
npm run verify-author -- --code 1043 --email you@yourdomain.com            # dry: the plan
npm run verify-author -- --code 1043 --email you@yourdomain.com --write    # run it
```

| Design said | Built as | Why |
|---|---|---|
| `--email test@example.invalid` | **A real inbox, refused otherwise**; each run uses `you+verify-<code>-<stamp>@…` | 🚨 The contact gets `coach-trial-started`, so the **real welcome email sends**. A dead address is a bounce from the verified sending domain on every run |
| "a signed payload" | **`X-Coach-Token`**, not HMAC | That is what Shopify Flow — the production caller — sends |
| Reads fields back | By **field id**, from a hardcoded table | GET returns ids only and the token cannot list them (`401` on `/locations/<id>/customFields`). `coach_trial_ends` = `Y0QMX2OoGXLCy96tq1bL`, discovered today |
| "Deletes the test contact" | Deletes it **only if this run created it** (fresh address checked before sending, `dateAdded` after the run started), and also deletes the `trial:` and `shop:` KV records | The runbook said the `trial:` record "cannot be deleted by hand". `wrangler kv key delete` can |

Twelve checks — both tags, all ten fields — plus the endpoint response, the KV trial record and the
cleanup. A registry value not filled in yet is a **WARN**, not a pass: the field is correctly
absent, but a customer email would show a gap. Every run prints the Flow/Zipify caveat.

---

## Author #3 — Rick Meyer (`1044`), onboarded through `npm run onboard` · 2026-09-28

| | |
|---|---|
| GHL tag | `bookcoach-rick-meyer-active` — ✅ created; verified held by nobody afterwards |
| GHL product | `6aba640f86e4201cb55921ee` — ✅ verified by id: SERVICE, not in store |
| GHL price | `6aba640f809b8051b34c2790` — ✅ verified: $59 USD recurring monthly |
| `coaches.json` | ✅ entry appended, seed validation clean (2 expected warnings: Shopify, lesson) |
| Voiceflow | ✅ `verify:vf` 200 — *"I'm the Running on Faith AI Coach, built on the teachings… of Rick Meyer"* |
| KV | ⬜ **not pushed** — deliberately. See below |

**Not pushed, on purpose.** Rick's live page still calls Voiceflow directly, with `showActivation`
**absent**. Pushing is harmless (no Shopify product means nothing can grant him) but pointless until
his page is repointed at the Worker with `COACH_CODE: "1044"` — which is §A for him.

**Remaining for Rick, all M:** coach page onto the Worker pattern (§A), Shopify bundle, Course360
course + Offer, grant workflow, funnel page at `/rick-meyer-coach-access` (currently **404**), Zipify
page. Then add `shopifyProductId` + `courseLessonUrl`, `npm run push`, `verify-author`, $0 order.

⚠ **Found while verifying:** contact `IzJVZoHSwC3wUtR6SYPs` (created 2026-09-18, from Freddy's #4233
test) still holds `bookcoach-freddy-davis-active` + `coach-trial-started`, so it is entitled. The sweep
removes the tag on 4 October. Runbook step 12 says to delete it — left for M, since it may be a
teammate's deliberate test account.

---

## §D — Shopify, blocked on one credential

**Would kill step 3 and make step 11's order scriptable.**

Creating a product is a single Admin API call. Creating a $0 draft order for testing is another.
Neither is hard. **There is no Shopify credential anywhere in this project** — that is the only
reason both are manual.

### 🔑 Needed from M

A **Shopify Admin API access token** with `write_products` and `write_draft_orders`.
Settings → Apps and sales channels → Develop apps → create an app → Admin API scopes → install.

Store it as `shopifyAdminToken` in `coaches.json` `shared` (gitignored) and it syncs to the Worker
like every other secret.

**Effort once the token exists:** ~2h for both.

---

## What stays manual, permanently

| Step | Why |
|---|---|
| **9 — Zipify page** | No public API. Global Sections cut the repetition; the clone stays manual |
| **9b — the pitch rewrite** | ~70% of the page is about the specific book. Copywriting, not tooling |
| **8 — GHL funnel page** | No funnel API |
| **4, 6 — Course360 + grant workflow** | Memberships API is incomplete; full course CRUD is an open GHL request. ⚠ **Do not automate these — [`20`](20-multi-author-generalisation.md) §4.6 deletes both steps** by collapsing every course into one "My Coaches" page. Automating a step you intend to remove is the worst option available |

---

## Build order

| # | Work | Blocks on | Effort |
|---|---|---|---|
| 1 | **§B** — `npm run onboard` | nothing | ~3h |
| 2 | **§C** — `npm run verify-author` | nothing | ~2h |
| 3 | **§A** part 1 — bring remaining pages onto Freddy's proxy pattern | M's page edits | ~1h + M |
| 4 | **§A** part 2 — `GET /api/coach-page`, config from the registry | 3 | ~2h |
| 5 | **§D** — Shopify product + draft order | 🔑 **a token** | ~2h |
| 6 | Rotate the exposed Voiceflow keys | 3 | M, sequenced |

**Start with §B and §C.** Both are pure code, need nothing from anyone, and together remove four
steps. §A is the higher-value change but it touches live customer pages and a key rotation, so it
deserves its own sitting rather than being squeezed alongside.

---

## The honest summary

After all of it: **9 manual steps → 4** — the Zipify page, the GHL funnel clone, the Course360
course, and the real test order. §4.6 later removes the Course360 one.

But **step 9 is 45–90 minutes and none of this touches it.** The automation removes roughly 80
minutes of clicking from a job whose longest task stays exactly as long as it was. Worth doing,
worth not overselling.
