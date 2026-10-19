# Plan 30 — the pipeline tracker and dashboard

**Created:** 2026-10-02 · **Owner:** C (code), M (decisions, page checks, the Windows task) ·
**Status:** PLANNING — nothing built yet
**Tracks:** [`further-automation-v1.md`](further-automation-v1.md) — the 18 onboarding steps (0–17)
and the 9 after-launch steps (18–26). **Reuses:** the live checks of
[`21-onboarding-automation.md`](21-onboarding-automation.md) §E (`npm run author`).

> **What this is.** One place that knows, for every author, which step they are on, what is done,
> what is left, what is blocking it, and whether anything already live has quietly broken. A
> terminal command first, then a local web dashboard (a grid, then a health tab, then an n8n-style
> canvas). **It tracks and guides. It never changes what happens to a reader.**

---

## 0. Hard rules — every milestone is checked against these

| # | Rule | Why |
|---|---|---|
| 1 | **$0.** No paid service, no paid plan, no paid library | Decided 2026-10-02 |
| 2 | **No new load on Cloudflare worth the name.** The dashboard makes **zero KV list calls** and **zero KV writes** | The free plan allows 1,000 KV lists a day and the Worker's own cron already spends ~384 (four lists every 15 minutes: `sub:`, `centitle:`, `arch:`, `trial:`). The budget is shared, and an exhausted one **fails hard**, not slowly |
| 3 | **State is read, never stored.** "Where am I" is recomputed from the live systems every time | The lesson this project paid for repeatedly: a green log is not proof, the record is. A stored cursor drifts the moment someone clicks something in GHL by hand |
| 4 | **One definition of the steps.** The CLI, the dashboard and the optional guidance all read the same registry | Two copies of a step list is the drift plan 20 exists to remove |
| 5 | **Read-only towards GHL, Shopify, Voiceflow and Cloudflare** until a milestone explicitly adds a write, behind a confirmation | The existing `author.mjs` is read-only by construction (`ghl()` refuses any non-GET except `contacts/search`). Keep that property |
| 6 | **Guidance and alerts are OFF by default, each with its own switch** | Decided 2026-10-02. Both are optional; turning one on must be a deliberate act, and turning it off must actually stop it — not just hide it |
| 7 | **Local-first.** The server listens on `127.0.0.1` only | Just Muhammad for now; the team later (§9, M5) |

---

## 1. Decisions already made — 2026-10-02

| Question | Answer |
|---|---|
| Orchestrator | **Step registry + live checks inside `coach-router`.** Not LangGraph, not n8n, not a hosted workflow engine — options compared and ranked in the 2026-10-02 session |
| AI | **None in the core.** Optional guidance only, behind a switch |
| Who uses it | Muhammad now, the team later |
| Scope | **Both** onboarding (steps 0–17) **and** runtime health (steps 18–26) |
| Budget | $0, and no meaningful load on Cloudflare |
| UI build order | status grid → health tab → canvas |

---

## 2. What already exists — do not rebuild it

Read from `coach-router/` on 2026-10-02.

| Piece | What it gives this plan |
|---|---|
| `lib-author.mjs` `authorStatus(coach, ctx)` | Every live check, per author, as rows `{ step, check, status, detail, fix }`. **Read-only, never throws** (a failed read becomes a `FAIL` row), and **network is injected** through `ctx`, so it is testable offline |
| Status vocabulary | `DONE` · `TODO` · `FAIL` (started and wrong) · `WARN` (cosmetic) · `MANUAL` (cannot be read with the access we have) |
| `stepSummary(rows)` | Worst row wins, per step |
| `onboarding-state.local.json` via `lib-registry.mjs` `readState()` | A local, gitignored record already holding `lastVerify` per author. The natural home for sign-offs |
| `/health` | Already returns sync state, `counts.trialsTracked`, `counts.trialsExpired`, errors and `problems[]` — **one request, no KV list from our side** |
| `lib-shopify.mjs` | Admin API access via the client-credentials grant (24 h token, nothing long-lived stored). `write_orders` implies order reads |
| `verify.test.mjs` | The single test file every tool adds to. New tests go there, same style |

### The five gaps this plan closes

1. 🚨 **Two numberings.** `lib-author.mjs` `STEPS` is the **old 12-step runbook**; the working checklist
   (`further-automation-v1.md`) is **0–17**. Somebody reading `npm run author` and the checklist
   side by side sees different step numbers for the same work. Decision **D1** below.
2. **No dependencies.** Nothing says step 11 cannot be finished before step 4 exists, so "what is
   next" is a guess.
3. **`MANUAL` rows can never turn green.** "Offer is Free and unlisted", "the grant workflow
   triggers on this coach's tag", "the $0 order", "hands-on check" — there is no way to record that
   a person confirmed them, so an author can never read as finished.
4. **Nothing watches steps 18–26.** Once an author is live, a silently broken Flow, a stopped expiry
   sweep or a forgotten `Run workflow` click is invisible until a customer emails.
5. **Terminal only.**

---

## 3. Architecture

```
                      steps.mjs  ── the registry: steps 0–17 + health checks 18–26
                          │          (title, platform, kind, needs, which checks, action, sign-off)
                          ▼
                    lib-pipeline.mjs  ── pure: rows + sign-offs + dependencies → step states
                     │            │
     lib-author.mjs (existing)   lib-health.mjs (new, M3)
     onboarding checks            after-launch checks
                     │            │
          ┌──────────┴─────┬──────┴───────────────┐
          ▼                ▼                      ▼
   pipeline.mjs      server.mjs (127.0.0.1)    health job  ← only if alerts.local is ON
   npm run pipeline  npm run dashboard          Windows Task Scheduler, hourly
                           │
                        web/  grid (M2) → health tab (M3) → canvas (M4)

   settings:   pipeline.local.json            (switches — gitignored by *.local.*)
   sign-offs:  onboarding-state.local.json    (already exists — gitignored)
```

| New file (all in `coach-router/`) | Job |
|---|---|
| `steps.mjs` | The registry. Data only |
| `lib-pipeline.mjs` | `deriveSteps(rows, signoffs, registry)` → per-step state. Pure, no I/O |
| `lib-health.mjs` | The after-launch checks, `ctx`-injected like `lib-author` (M3) |
| `lib-settings.mjs` | Read/write `pipeline.local.json`, defaults all **off** |
| `pipeline.mjs` | The CLI |
| `server.mjs` | The local dashboard server. `node:http`, **no dependencies** |
| `web/` | Static UI. No build step for M2–M3 |

`npm run check` gains each new file; `npm run pipeline` and `npm run dashboard` are added to `package.json`.

---

## 4. The registry and how a step's state is decided

### 4.1 One entry per step

```js
{
  id: 9,
  title: 'Grant workflow',
  platform: 'GHL Automation',
  kind: 'manual',                       // automated | assisted | manual  (the checklist's own legend)
  needs: [3, 7],                        // must be DONE before this step is READY
  rows: { from: 6 },                    // which lib-author rows belong here (see D1)
  action: {                             // what the operator does next
    instructions: 'Contact Tag added = {ghlTag} -> Grant that Offer -> PUBLISH before the first order',
    doc: 'further-automation-v1.md',
  },
  signoff: 'The trigger is Contact Tag added = {ghlTag}',   // only for what no API can read
}
```

### 4.2 Derived state — the rules, in order

| State | When |
|---|---|
| `FAIL` | any row is `FAIL` |
| `BLOCKED` | something is `TODO`, and a step in `needs` is not `DONE` |
| `READY` | something is `TODO`, and every step in `needs` is `DONE` — **this is "do this next"** |
| `CONFIRM` | only `MANUAL` rows remain, and no sign-off is recorded |
| `DONE` | every row `DONE` or `WARN`, and every `MANUAL` row signed off. `WARN` shows as done-with-a-note |

**"Where am I"** = the lowest-numbered step that is `FAIL`, then `READY`, then `CONFIRM`.

### 4.3 Sign-offs

`npm run pipeline -- signoff --code 1045 --step 16 --note "welcome email names Jane"` writes
`{ at, note }` into `onboarding-state.local.json` under that author.

🚨 **A sign-off can only turn `MANUAL` into `DONE`. It can never override `FAIL` or `TODO`.** If a
live check later fails, the step reads `FAIL` regardless of any sign-off. Otherwise a tick recorded
last week would hide a breakage found today — exactly the stored-cursor failure rule 3 forbids.

### 4.4 Steps 0–17 against the checks that already exist

| v1 step | Title | Kind | Needs | State comes from |
|---|---|---|---|---|
| 0 | Collect the inputs | manual | — | registry fields present: display name, real book title, coach label, code, slug |
| 1 | Build the Voiceflow coach | manual | 0 | **sign-off** ("the coach is built and answers as the author") |
| 2 | Read its IDs | manual | 1 | old row 1 (project, 24-char version, key recorded) |
| 3 | GHL side + registry entry | automated | 2 | old rows 5 (tag) + 7 (product, price) |
| 4 | Shopify bundle | automated | 3 | old row 3 |
| 5 | Page details | assisted | 3 | photo / initials / author link / books recorded (`coachPageGaps`) |
| 6 | Coach page | assisted | 3, 5 | old row 2 |
| 7 | Course360 course + Offer | manual | 3 | old row 4 "Offer is Free and unlisted" → **sign-off** |
| 8 | Record the lesson URL | assisted | 7 | old row 4 "lesson URL" |
| 9 | Grant workflow | manual | 3, 7 | old row 6; "triggers on this coach's tag" → **sign-off** |
| 10 | $59 funnel page | manual | 3 | old row 8 |
| 11 | Zipify sales page | manual | 4, 10 | old row 9 (page, cart link, no other author, no placeholders) |
| 12 | Record the sales page | assisted | 11 | `bookLandingUrl` recorded |
| 13 | Go live (`npm run push`) | automated | 3, 4, 8 | old row 10 |
| 14 | Check every step | automated | 0–13 | **derived** — DONE when 0–13 are DONE. No check of its own; it *is* this tool |
| 15 | End-to-end test | automated | 6, 9, 13 | old row 11 (`lastVerify`) |
| 16 | Hands-on check | manual | 15 | **sign-off** |
| 17 | Clean up the test contact | assisted | 16 | old row 12 |

> ⚠ **The `needs` column is a first draft, to be confirmed in M1.** Two are load-bearing and must
> survive review: **15 needs 9** (the grant workflow must be published before the first order —
> its trigger only applies to tags added afterwards), and **11 needs 4** (the cart link is the
> variant id).

---

## 5. The switches — guidance and alerts

Stored in `coach-router/pipeline.local.json` (gitignored by the root `*.local.*` rule). **Every
switch defaults to off.** The dashboard header shows each as a toggle; the CLI flips them with
`npm run pipeline -- config --<switch> on|off`. Both write the same file.

| Switch | Default | ON means | OFF means — and how "off" is made real |
|---|---|---|---|
| `guidance` | off | A Claude Code skill `/next-step` exists that reads `npm run pipeline -- next --code <n> --json` and explains the next step in plain words | **The skill file is removed** from `.claude/skills/next-step/`. A skill that merely says "I'm off" can still be auto-invoked by its description; a skill that is not there cannot. The template stays committed at `coach-router/pipeline/next-step.SKILL.md`; the installed copy is gitignored |
| `alerts.local` | off | A Windows Task Scheduler task runs the health checks every `alerts.intervalMinutes` (default **60**) and shows a desktop notification **only when something newly breaks or recovers** | **The task is deleted** (`schtasks /Delete`), not paused — nothing runs at all. As a second lock, the job reads the switch on start and exits if it is off |
| `alerts.uptime` | off | An external free uptime monitor watches `/health` (returns 503 on a stale sync or a silent cron) and emails when the Worker is down — **works while the PC is off** | Paused through the provider's API if it has one; otherwise the switch shows **"manual — pause it at the provider"** rather than pretending. Provider chosen at M5 (D4) |

> **Why two kinds of alert.** The local task can see everything (GHL, Shopify, the registry) but
> only while the PC is on. The uptime monitor sees only `/health`, but sees it always. Each covers
> the other's blind spot; neither is required.

> ⚠ **Neither guidance nor alerts is needed for the tracker to work.** With both off, everything in
> M1–M4 is fully functional.

---

## 6. Runtime health — what "something broke" means (steps 18–26)

**Neither system's run history is readable from here:** Shopify Flow has no public API, and the
GHL workflow API this project uses returns names and statuses, not runs. So breakage is detected
**by its effects**, which is also the project's standing rule for verifying anything.

| # | Check | Source | What a failure means | Cost per run |
|---|---|---|---|---|
| H1 | `/health` is `ok`, no `problems[]`, last sync `lastOk` | Worker | Cron stopped, key unresolved, sync failing | 1 Worker request |
| H2 | A paid coach-bundle order **older than 22 days** (21-day wait + Flow's 24 h retry), not cancelled or refunded, **without `coach-started`** | Shopify Admin API | **Flow A is broken** — wrong condition, GET method, or the endpoint refusing | 1 GraphQL query |
| H3 | An order tagged **`delivered-manual` without `coach-started`** for more than an hour | Shopify Admin API | **Someone tagged the order and forgot `Run workflow`** — the trap in [`03`](03-shopify-flows.md) §1.1. The reader silently waits out 21 days | same query |
| H4 | A coach-tag holder reading `coach_status: trial` whose `coach_trial_ends` has passed (+1 h grace) | GHL census, fields inline | **The expiry sweep is not running** — a free coach forever | 1 paginated search for every coach tag at once (the array filter proven 2026-09-22) |
| H5 | A coach-tag holder with **no trial, no active subscription, and not on the known-grants list** | GHL census + subscriptions | Access nobody granted on purpose | same search + 1 subscriptions read |
| H6 | `coach_status` and the tag disagree (`active`/`trial` with no tag, or `expired` with one) | GHL census | The drift the README calls risk #1 | same search |
| H7 | A `+verify-` test contact still holds a coach tag | GHL census | Test residue being granted a lease every cron | same search |

⚠ **H4 only sees trials started through `POST /shopify/order`** — older contacts carry no
`coach_trial_ends`. It is a text field rendered as `2 October 2026`, so the parser must be tested
against that exact format, and an unparseable value is a `WARN`, never a silent pass.

**Known grants** (H5) — Muhammad's account and the staff test contact hold tags deliberately —
live in `pipeline.local.json` as `knownGrants: [contactId, …]`, so they never false-alarm.

**No KV list, by design.** H4 reads the trial end from the **GHL contact** (`coach_trial_ends`,
written by the Worker) instead of listing `trial:` records. Optional hardening in M3, decision
**D3**: publish `trialsDue` in the cron's existing `syncmeta.counts`, so `/health` itself says how
many trials are overdue.

---

## 7. Load and cost budget

| Activity | Cloudflare | GHL / Shopify | $ |
|---|---|---|---|
| Opening the dashboard, pressing Refresh | 1 Worker request (`/health`) | the reads `author status` already makes | 0 |
| Auto-refresh | **off by default**; when on, no faster than every 15 min, cached | cached between refreshes | 0 |
| `alerts.local` on, hourly | 24 Worker requests a day | 24 × (1 search + 1 orders query + 1 subscriptions read) | 0 |
| KV list / KV write from any of the above | **0 / 0** | — | 0 |

Against the free plan: **100,000** Worker requests a day, of which this uses **under 100**.

⚠ **`npm run author -- status --deep` spawns `wrangler kv key get` per coach** — reads, not lists,
and only on `--deep`. The dashboard never passes `--deep` automatically.

---

## 8. The local server — security, because it can reach GHL and Shopify

A server on `127.0.0.1` is not private by default: **any website open in the same browser can send
requests to localhost.** So:

| Guard | Detail |
|---|---|
| Bind `127.0.0.1` only | never `0.0.0.0` |
| Per-run session token | generated at start, embedded in the page, required on every API call |
| `Origin` / `Host` check | refuse anything not `http://127.0.0.1:<port>` — also blocks DNS rebinding |
| No secrets in any response | the API returns step states and display values only; tokens never leave `coaches.json` |
| No arbitrary commands | M2 shows a **Copy command** button, nothing runs. If Run buttons are added later (D5), they call an **allowlist** of the existing commands, with a confirmation, and dry-run first |

---

## 9. Milestones

### M1 — the registry and `npm run pipeline` · detailed

| # | Task |
|---|---|
| 1 | Settle **D1** (step numbering) and apply it |
| 2 | `steps.mjs` — steps 0–17 per §4.4, with `needs`, `kind`, `action`, `signoff` |
| 3 | `lib-pipeline.mjs` — `deriveSteps()` per §4.2, pure |
| 4 | `lib-settings.mjs` — defaults all off; refuses unknown keys |
| 5 | `pipeline.mjs` — `npm run pipeline` (every author × steps 0–17, plus "next"), `status --code`, `next --code [--json]`, `signoff` / `unsignoff --code --step [--note]`, `config` (switches only — M1 stores them, later milestones act on them) |
| 6 | Tests in `verify.test.mjs` (below) |

**Acceptance — all must hold:**

- 🚨 **No check is lost.** A test feeds every row `authorStatus` can produce through the registry and
  asserts each lands in **exactly one** step. A check that falls through a gap would be a silent
  hole in the very tool meant to find them
- A sign-off cannot turn `FAIL` or `TODO` green (tested)
- A step with an unmet `needs` reads `BLOCKED`, never `READY` (tested)
- Settings default off; an unknown switch is refused (tested)
- Run live for 1042, 1043 and 1044: the findings match `npm run author -- status` row for row
- Writes nothing anywhere except `onboarding-state.local.json` (sign-offs) and
  `pipeline.local.json` (switches)
- `npm test` and `npm run check` pass

### M2 — the dashboard: status grid · outline

`npm run dashboard` → `http://127.0.0.1:<port>`. Authors down the side, steps 0–17 across, one
coloured cell per step; click a cell → side panel with the rows, the fix, the exact command
(**Copy**), the doc link and a **Sign off** button where one applies. Refresh button, cached reads.
The two switches in the header (stored only — they act from M3/M5). Read-only towards every
platform. Security per §8.
**Accept:** same states as the CLI for every author; no response contains a secret (tested); a
request without the session token or from another origin is refused (tested).

### M3 — health tab + local alerts · outline

`lib-health.mjs` with H1–H7, a **Health** tab, and the `alerts.local` switch made real (creates /
deletes the scheduled task; notifies on change only; writes a local log).
**Accept:** each H-check proven with an injected failure in tests; switching alerts off removes the
task (`schtasks /Query` finds nothing); zero KV lists in a full health run.

### M4 — the canvas · outline

The n8n-style view: one author's steps as a graph from `needs`, nodes coloured by state, the M2
side panel on click. React Flow (MIT). Decision **D6** on how it is loaded.
**Accept:** the canvas and the grid never disagree — both render the same `deriveSteps` output.

### M5 — guidance, uptime, and the team · outline

`guidance` switch made real (installs / removes the `/next-step` skill). `alerts.uptime` with a
free provider (D4). A **snapshot** endpoint — step states and health only, no secrets — as the
basis for team access, then pick the sharing route when the team exists: Cloudflare Tunnel +
Access free tier, Tailscale's free plan, or pushing the snapshot to the monday.com tracker
(`18424730976`). **Team members get read-only; actions stay with the operator.**

---

## 10. Decisions owed

| # | Decision | Recommendation |
|---|---|---|
| **D1** | Renumber `lib-author.mjs` to the 0–17 checklist, or keep its 12 steps and map them in the registry? | **Renumber**, in M1, with its tests. One numbering everywhere; `npm run author` keeps working with the new numbers. Mapping leaves two numberings alive forever |
| D2 | Where sign-offs live | `onboarding-state.local.json`, beside `lastVerify` — already gitignored, already read by `author.mjs` |
| D3 | Add `trialsDue` to the Worker's published counts? | **Yes, in M3** — a small Worker change and one deploy, then `/health` reports overdue trials directly. Optional: H4 works without it |
| D4 | Which free uptime monitor | Pick at M5. Must be free, poll every ≥5 min, and ideally have an API to pause — or the switch says "manual" |
| D5 | Run buttons in the dashboard? | **Not in M2.** Copy-command first. Revisit after M3 with an allowlist, confirmations and dry-run-first |
| D6 | How the canvas loads React Flow | Decide at M4: a small Vite build versus an import from a CDN. Both free |

---

## 11. Out of scope

- Any change to the customer path, the Shopify Flows, the GHL workflows or the emails
- Any write to GHL, Shopify, Voiceflow or KV from the dashboard (until D5 says otherwise)
- AI in the core, LangGraph, n8n, or any hosted workflow engine
- Hosting — until the team exists (M5)

---

## 12. Traps that will bite the dashboard specifically

- **GHL's search index lags ~20 seconds**, on creates and deletes. Refresh straight after a change
  and the census looks wrong. `GET /contacts/<id>` is immediate
- **KV is eventually consistent — ~60 s** before `/health` reflects a push
- **`sync.ageMinutes` is not cron liveness** — `syncmeta` is rewritten only hourly when nothing
  changes. Read `problems[]`, never the raw age
- **The public Shopify catalogue shows prices in the visitor's currency** (Shopify Markets) — never
  show price from it
- **GHL answers an unknown contact id with `400`, not `404`**
- **The GHL API does not expose a workflow's trigger** — that is why step 9 keeps a sign-off even
  when the workflow reads `published`
- **A `WARN` row is not a pass for an email.** An empty merge field renders as a gap, not an error
