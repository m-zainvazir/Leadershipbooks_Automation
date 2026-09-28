# Later — wanted, but deliberately not now

**Created:** 2026-09-22 · **Purpose:** things that *should* happen, just not yet.

> ## How this differs from [`11-parking-lot.md`](11-parking-lot.md)
>
> | | `11-parking-lot.md` | **this file** |
> |---|---|---|
> | Means | *"real, but not worth doing"* — deprioritised, or deliberately dropped | **"wanted, just not now"** |
> | Default outcome | stays undone unless new information arrives | **gets done** |
> | Re-raising it | ⚠ don't, without new information | ✅ expected — ask about these |
>
> **If an item here stops being wanted, move it to `11`.** If an item in `11` becomes wanted, move
> it here. Keeping the distinction is the whole point: a parked item that quietly becomes urgent is
> how the Flow A wait sat wrong in the docs for four days.

---

## 1. 🚨 Recreate Michael Stickler's GHL contact — the author has no coach access

**Deferred 2026-09-22 by Muhammad** — *"I dont remember what were author-1042@example.com his
tags and other specifications, for now im not creating, keep it for later."*

**Verified 2026-09-22:** contact `9xr1rjXSV6Re5ijqmQSz` (`author-1042@example.com`) is
**gone**. `GET /contacts/9xr1rjXSV6Re5ijqmQSz` answers `400 Contact not found` and a search on the
email returns **0**. Almost certainly swept up in the post-test cleanup — he sat in the tagged-contact
list next to the test contacts.

### What is known about what it held, so it can be rebuilt accurately

| Field | Value | Confidence |
|---|---|---|
| Email | `author-1042@example.com` | ✅ read from the live API on 2026-09-19, before deletion |
| Phone | `+1XXXXXXXXX1` | ✅ read from the live API on 2026-09-19 |
| Tag | `bookcoach-micheal-stickler-active` | ✅ it was one of the two tagged contacts in every census since 2026-09-13 |
| `coach_status` | **empty** | ✅ read 2026-09-19 — a deliberate manual grant, never a trial, so the field was never set |
| `coach_trial_started` | empty | ✅ same read |
| Other handset | `+1XXXXXXXXX2` — the **US colleague's** test phone, bound to this same contact | ✅ master plan §7 named it; the `bind:` record confirms it |

> **That table is the whole answer to "I don't remember".** Everything needed to rebuild it is above,
> captured from the live API three days before the deletion. Nothing else was on it.

### What the deletion actually cost, and what it did not

🟢 **The Worker behaved perfectly, and this was its first unplanned revocation ever.** Both handsets
were revoked 2026-09-20 and archived (deleting in 29 days); `sub:` leases went to 0; the majority
guard correctly did **not** refuse it, because its floor of 3 exists so it does not fire on tiny
counts. **The revocation path is now proven on a real event rather than a test.**

🚨 **CORRECTION 2026-09-22 — I got this wrong, and the correction matters.** This section previously
said recreating the contact would *"restore access with no re-activation"*. **It does not.**

`bind:<phone>` stores the **contact id**, and a recreated contact gets a **new** id. The contact was
recreated on 2026-09-22 as `ZuOj6wTui9kabixF3z4e`; `bind:+1XXXXXXXXX1` still points at the deleted
`9xr1rjXSV6Re5ijqmQSz`. The reconcile builds `sub:` leases by walking `contact:<contactId> → phones`,
and the new contact has no such record — so it gets no lease.

**Confirmed by a dry reconcile the same day:** `entitled contacts 3`, and *"none has a linked
handset, so nobody can text or call yet."* The churn-survival behaviour is real, but it survives
**tag churn on a stable contact**, not the deletion and recreation of the contact itself.

**Three ways back, cheapest first:**

1. **Mint an activation code by API and have him text it** — `POST /api/bind/mint` with
   `{contactId: "ZuOj6wTui9kabixF3z4e", email: "author-1042@example.com"}` returns a 6-character
   code valid 15 minutes. He texts it to `+1 854 254 5009` from `+1XXXXXXXXX1`. This is the designed
   path, needs no Course360 access, and **it would also be the first walk of the code-only activation
   route under `enforce`** — which no one has ever done (master plan phase 3 step 4).
2. **Temporarily set `autoLinkGhlPhone: true`**, let one reconcile run, set it back. His contact
   carries the phone, so it would auto-link. Two pushes, ~30 seconds each, and reversible — but it
   briefly re-enables a behaviour that was deliberately switched off on 2026-09-17.
3. Leave it until the SMS test happens anyway.

⚠ **Stale `bind:` records are now junk in KV.** All four point at contacts that no longer exist.
Harmless (the reconcile drives from contacts, not from `bind:`), but they will confuse the next
person reading `npm run subs -- --list`.

⚠ **But the archive sweep will delete the Voiceflow conversation state on ~2026-10-19.** Before that
date, recreating the contact brings back the coach *and its memory*. After it, the coach starts
fresh. **If his conversation history matters, this becomes time-boxed rather than open-ended.**

---

## 2. ~~Wire `staffTag`~~ — ✅ DONE 2026-09-22

**Authorised and pushed by Muhammad on 2026-09-22.** `config.staffTag` is now
`bookcoach-staff-all`, seeded to production KV. Verified by a dry reconcile: `tags seen` went
**1 → 2** and `entitled contacts` **2 → 3**. `codesForTags()` short-circuits on it and returns every
coach code, so the staff contact grants every author automatically as the registry grows.

*(Original note, kept for the reasoning:)* **One line, one push, currently a no-op.** The staff test contact
`pBbymJS7yAOeoUU71zNq` (`bookcoach-staff-test@leadershipbooks.net`) was created 2026-09-22 carrying
**both** `bookcoach-micheal-stickler-active` and `bookcoach-staff-all`.

The first tag works today. **The second does nothing**, because `config.staffTag` is `""`:

```jsonc
// coaches.json → shared.config
"staffTag": "bookcoach-staff-all"   // then: npm run push
```

`codesForTags()` short-circuits on it and returns **every** coach code, so it is the right mechanism
for testing without a purchase — and it is what makes an SMS test possible now that the author's
contact is gone.

**Why it is deferred rather than done:** it is a live config change beyond the step-1 authorisation,
and with one coach in the registry it currently grants exactly what the Stickler tag already grants.
It becomes genuinely useful the moment a second coach enters `coaches.json`.

---

## 3. Populate `coach_code` on contacts

The GHL field **exists as of 2026-09-22** (created by Muhammad). Nothing writes it yet.

It is read by exactly one thing: the **multi-coach welcome-email variant**
([`20-multi-author-generalisation.md`](20-multi-author-generalisation.md) §6, breakage 3), which
tells a reader who now holds two coaches to start their message with the author's name. Until a
second coach ships, there is nothing for it to say.

`POST /shopify/order` will write it (plan 20 §4.4 step 8), so this closes itself as part of step 3.

---

## 4. Align every coach page's Voiceflow version, and decide the rule

**Found 2026-09-22 by reading all six live pages' source.** Every one pins the **draft**, not the
published `main`:

| Page | Project | Page pins | Which is it |
|---|---|---|---|
| `/michael-hinkle` | `69e68f5c26ce7fca93b47e18` | `…b47e19` | draft |
| `/leadership-books` | `69e9268d83b9b1d1d12de6d8` | `…2de6d9` | draft |
| `/rick-meyer` | `6a34712d677246c3541333c2` | `…1333c3` | draft |
| `/freddy-davis` | `6a3339b6eb283c59b70cfa52` | `…0cfa53` | draft |
| `/reinhard-klett` | `69ea7e499300ebd74883c215` | `…83c216` | draft |
| `/michael-stickler` | `6a52da46bc446f70628c598c` | `…8c598d` | **draft** |

> **The last row is the one that matters.** The Worker is pinned to **`main`** for Stickler, but his
> web page is pinned to the **draft**. Those are provably different snapshots — `main` renders
> *"today's coaching"* with a straight apostrophe, the draft with a curly one. **So the web coach and
> the SMS/voice coach are currently serving two different versions of the same author**, and a canvas
> edit changes one channel and not the other.

**The decision owed:** either publish each project and pin every surface to `main`, or accept drafts
everywhere and drop `main`. Consistency matters more than which one wins — the current split is the
worst of both, because testing on the web proves nothing about SMS.

**Deferred because** it is six page edits plus a publish per project, and it changes nothing for a
reader today (no other coach is entitlement-gated at all).

---

## 5. Rotate the Shopify webhook signing secret

The secret was shared in chat on 2026-09-22 and is now in a session transcript. It is correctly
stored — `coaches.json` is gitignored and untracked, and it was pushed to a Worker secret
(`SHOPIFY_WEBHOOK_SECRET`, 64 chars) — so nothing is exposed publicly.

**Rotate it once `POST /shopify/order` is live and proven**, so a rotation is not debugging a new
endpoint at the same time. The swap is one edit plus `npm run push`, roughly 30 seconds, no deploy.

---

## 6. ~~Fix the `bookTitle` values that are not book titles~~ — ✅ DECIDED 2026-09-22: they stay

**Muhammad, 2026-09-22:** *"The customized coach names like Sales Coach and Worldview coach are meant
to be there, I want it the way they are."*

**So this is settled, and it costs nothing — because the fix belongs in the email copy, not in the
data.** The only reason those values mattered was the day-9/10 sign-off
*"thank you for reading {{contact.coach_book_title}}"*, which reads wrong as *"thank you for reading
Worldview Coach"*.

**The cheap answer is to stop referencing the book at all.** Sign off with the coach instead:

> *"Thank you for spending these ten days with {{contact.coach_name}}."*

That is correct for every author whether `bookTitle` holds a real book, a coach name, or nothing —
and it removes a merge field that could render as a gap. **No per-author exception, no manual step,
no extra automation.** Recorded here rather than done, because it is one edit to three GHL email
templates and belongs in the same pass as the rest of the swap list (plan 20 §4.5).

⚠ **`bookTitle` stays in the registry regardless** — it is still the honest place to record what a
coach is about, and the welcome email may still want it.

*(Original finding, kept for the evidence:)*

Read from the live pages 2026-09-22:

| Page | `bookTitle` reads | Problem |
|---|---|---|
| `/michael-hinkle` | `Treasure Hunt` | Muhammad's roster calls this coach "Sales Coach" — which is the *book* and which is the coach? |
| `/leadership-books` | `Book Publishing Coach` | a coach name, not a book |
| `/freddy-davis` | `Worldview Coach` | a coach name, not a book |

This matters because `coach_book_title` goes into the day-9 and day-10 email sign-offs as
*"thank you for reading {{contact.coach_book_title}}"*. **"Thank you for reading Worldview Coach"
is wrong in a way a customer will notice.**

**Needed per author:** the actual book title, separate from the coach's display name. Cheap to
collect, and it must happen before those emails go generic (plan 20 §4.5).

Also: `/michael-hinkle` renders **"Micheal Hinkle"** while Muhammad's roster says "Michael Hinkle" —
a second `Micheal`/`Michael` split, like Stickler's. Confirm which spelling the author uses before it
is baked into `displayName`.

---

## 7. ~~`/john-joseph` returns 404~~ — ✅ FIXED 2026-09-22 by Muhammad

**Re-verified live:** `https://www.book-coach.ai/john-joseph` now returns **200**, `authorName`
`John Joseph`, pinned to `6a7b6ad32cebd5d1b4c9f31f` (the draft of project
`6a7b6ad32cebd5d1b4c9f31e`) — consistent with every other coach page.

⚠ **One thing to fix while you are in there:** the page's `bookTitle` reads
**`Pastor's Guide to Chuch Law`** — *Chuch*, missing the `r`. Customer-visible on the live page.

*(Original finding:)*

Muhammad's 2026-09-22 roster lists **John Joseph — Pastor's Guide to Church Law** at
`https://www.book-coach.ai/john-joseph`. **Verified 404.**

The Voiceflow project exists — `6a7b6ad32cebd5d1b4c9f31e`, *"Pastor's Guide to Church Law - John
Joseph"*, updated 2026-08-18 — so the coach is built and the page is not published, or is at a
different slug. **Resolve the slug before this author enters `coaches.json`**; a `landingPageUrl`
that 404s fails silently, because nothing reads it on the request path.

---

## 8. The VF API key is readable in all six coach pages, not just one

Master-plan **phase 6** records this for Stickler's page. It is now confirmed on **all six** live
pages, each with its own distinct key.

**The blast radius is worse than phase 6 assumes.** Voiceflow credits are a workspace-wide hard stop
with no mid-cycle top-up, so draining any one of those six keys takes **every** coach offline — not
just the one whose key leaked. Six exposed keys is six independent ways to do it.

Phase 6's fix sequence (repoint the page at `/api/vf-interact` → rotate → `npm run secrets` →
`webGateMode: enforce`) now has to run **six times**, and the ordering trap applies every time:
rotating before repointing takes that coach down immediately.

**Deferred, not dismissed** — phase 6 is already a deliberate deferral. This entry exists so the
scope is recorded as ×6 rather than ×1 whenever it is picked up.
