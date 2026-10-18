# Plan 22 — the pipeline tracker and dashboard

**Created:** 2026-10-02 · **Owner:** C (code), M (decisions, page checks, the Windows task) ·
**Status:** ✅ **BUILT 2026-10-02 — M1 to M5**, verified live. As built: §13. Team sharing is the one
part left as a choice, for when the team exists.

> ⚠ **Renumbered 2026-10-05 (§18):** the coach page is now **step 3**, before the author is created, so the
> checklist is **0–16** and after launch **17–25**. Sections §1–§17 below keep the numbers they were written with.

> ### Use it — it lives in `D:\Projects\LeadershipBooks\BookCoach Author Dashboard` (moved 2026-10-02, §14)
>
> ```bash
> cd "BookCoach Author Dashboard"           # coach-router's npm run pipeline / dashboard start it too
> npm run dashboard                         # http://127.0.0.1:5178 — including the + Add author wizard
> npm run pipeline                          # every author x checklist steps 0-16
> npm run pipeline -- status --code 1044    # one author: each step, why, what to do
> npm run pipeline -- next --code 1044      # just where you are and the next action
> npm run pipeline -- health                # steps 17-25: has anything quietly broken?
> npm run pipeline -- config                # the switches — guidance and alerts, all OFF by default
> ```
**Tracks:** [`further-automation-v1.md`](further-automation-v1.md) — the 17 onboarding steps (0–16)
and the 9 after-launch steps (17–25). **Reuses:** the live checks of
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

> ✅ **Confirmed in M1** (pinned by tests). Two are load-bearing and must
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

## 10. Decisions — as taken

| # | Decision | Taken |
|---|---|---|
| **D1** | Renumber `lib-author.mjs` to the 0–17 checklist? | ✅ **Renumbered** (Muhammad, 2026-10-02). `npm run author` now speaks 0–17. Proven lossless: every check from before exists after (§13) |
| D2 | Where sign-offs live | ✅ `onboarding-state.local.json`, beside `lastVerify` |
| D3 | Add `trialsDue` to the Worker's published counts? | ⏸ **Not done — not needed.** H4 reads the trial end from the GHL contact and works without it. Doing it would have meant a production Worker deploy for a convenience; left for whenever the Worker is next deployed anyway |
| D4 | Which free uptime monitor | ⬜ **Yours to pick.** The switch works in **manual** mode today and drives UptimeRobot by API if configured. ⚠ UptimeRobot's free plan was reported (2024) to exclude **commercial** use — check a provider's terms before relying on its free tier |
| D5 | Run buttons in the dashboard? | ✅ **No.** Copy buttons only. The dashboard never runs a command |
| D6 | How the canvas loads React Flow | ✅ **It doesn't — plain SVG.** The graph is fixed (18 steps + the after-launch group); it needs a layout, not a graph editor. No build step, and no CDN script in a page that holds a write-capable token |

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

---

## 13. As built — 2026-10-02

**All in `coach-router/`. 969 tests (854 → 969), `npm run check` clean.** Nothing was deployed: the
Worker is untouched. Everything here reads the live systems and writes only local files.

| File | What it is |
|---|---|
| `steps.mjs` | **The** step list — 0–17 with `needs`, `kind`, command, instructions, sign-off; 18–26 mapped to health checks. `lib-author.mjs` imports its numbering from here |
| `lib-author.mjs` | **Renumbered to 0–17** (D1). Gained rows for steps 0, 1, 5, 12, 14, 16 so no step reads done unlooked-at; the $0-order row now reads DONE when `verify-author --shopify-order` passed |
| `lib-readers.mjs` | Every live read, shared by `author`, `pipeline` and the dashboard. Read-only by construction, **no KV list** |
| `lib-pipeline.mjs` | Pure: rows + sign-offs + `needs` → DONE / READY / BLOCKED / CONFIRM / FAIL, and "where am I" |
| `lib-health.mjs` | H1–H9 (below), by effect, `ctx`-injected |
| `lib-settings.mjs` | `pipeline.local.json` — every switch defaults **off** |
| `lib-switches.mjs` | Makes the switches real: installs/deletes the skill, creates/deletes the Windows task, pauses/resumes the monitor |
| `lib-live.mjs` | One way to open the pipeline, so the terminal and the browser cannot disagree. Also the exact-value credential check |
| `pipeline.mjs` | The CLI — `npm run pipeline` |
| `server.mjs` + `web/` | The dashboard — `npm run dashboard`. `node:http`, no dependencies, no build, no CDN |
| `pipeline/next-step.SKILL.md` | The guidance skill's template (installed copy is gitignored) |

### What changed in `npm run author` (D1)

Proven lossless on the live system: the set of checks for 1042, 1043 and 1044 was captured
before and after, and every check from before is present after. The only differences:

- **New rows**, so every step has at least one: 0 inputs recorded, 1 the coach is built (sign-off),
  5 photo / author link / books, 12 the sales page URL recorded, 14 steps 0–13 green, 16 hands-on
  (sign-off)
- **Split:** "landing page" (TODO when unrecorded) became step 11 *Zipify page* + step 12 *Sales page URL*
- **$0 real order** now reads DONE when the last `verify-author` passed **via `--shopify-order`** —
  that run IS the real order. It stays a confirmation otherwise
- ⚠ **Two FAILs became WARNs:** the GHL product *name convention* and the Shopify *title convention*.
  Both fix texts already said "harmless (everything binds on id)" — the module's own definition of
  WARN. As FAILs they blocked every step that depends on step 3 for Stickler, whose names predate
  the convention

### The health checks, live on 2026-10-02

| # | Check | First live read |
|---|---|---|
| H1 | Worker `/health` ok, keys resolved, sync ok | ✅ 3 coaches, 6 trials tracked, 4 entitled contacts |
| H2 | No paid bundle order past 22 days without `coach-started` (Flow A) | ✅ 11 bundle orders in 60 days, none overdue |
| H3 | No `delivered-manual` order left un-run | ✅ |
| H4 | No tag holder still on trial past their end date | ✅ 1 on trial |
| H5 | No coach tag without a trial, a subscription or a known reason | ✗ → ✅ `LUgsYcYM6TcsZ8UwYmUg` (Muhammad's own manual grant, recorded as deliberate in master plan §7) added to `knownGrants` |
| H6 | `coach_status` and the tag agree — incl. "trial but no tag", found with the `customFields.<id>` search filter, proven 2026-10-02 | ✅ |
| H7 | No `+verify-` test contact still entitled | ✅ |
| H8 | `Book Coach — Delivery → Trial Start` is published | ✅ |
| H9 | Paying subscribers carry their coach tag | ✅ 0 subscribers |

**Zero KV list calls in a full run.** Trial end dates come from the contact's `coach_trial_ends`,
parsed explicitly as UTC — `Date.parse("2 October 2026")` reads local midnight, five hours early in
Pakistan, and a test pins that.

### The switches, proven on this machine

| Switch | On | Off |
|---|---|---|
| `guidance` | installs `D:\Projects\LeadershipBooks\.claude\skills\next-step\SKILL.md` (gitignored). An already-open Claude Code session needs `/reload-skills` the first time | **deletes it**, and the empty `.claude/skills/` with it |
| `alertsLocal` | creates task **BookCoach Pipeline Health** (hourly by default), launched hidden through `wscript` so no window flashes. Fired once through Task Scheduler: the log got its line | **deletes the task and its launcher**; the job also exits on its own if the switch is off |
| `alertsUptime` | resumes the monitor through the provider API, or says **manual** | pauses it, or says **manual** |

A notification fires **only on change** — a check that breaks, or one that recovers. A check that
stays broken notifies once. Log: `coach-router/pipeline-alerts.local.log`.

### The dashboard, proven

- Live: bad Host → **421**, no token → **401**, foreign Origin → **403**, full live read ~19 s
- Every response is checked against the **actual** credential values in `coaches.json` and refused if
  one would leave — tested with a planted secret
- Screenshotted headless in all four views (grid, drawer, health, canvas) and adjusted from what the
  screenshots showed: 18 columns fit at 1500 px, the canvas opens at a readable zoom centred on the
  step you are on (**Fit** shows everything)
- Deep links: `#health`, `#canvas&author=1043`, `#grid&step=1043:11`

### Still yours

1. **Sign off what only a person can confirm** — for 1042 and 1043, steps 1 (the coach is built) and
   7 (the Offer is Free and unlisted), then 9 (the grant workflow's trigger) once 7 is done:
   `npm run pipeline -- signoff --code 1043 --step 1,7 --note "…"`, or the **Sign off** button
2. **Pick an uptime provider** if you want alerts with the PC off (D4) — or leave it manual
3. **Team sharing** (M5) — the snapshot exists (`npm run pipeline -- snapshot`, or the Snapshot
   button: status only, no credentials, no emails). Choose the route when the team exists:
   Cloudflare Tunnel + Access, Tailscale, or the monday.com board

---

## 14. The move, and the Add-author wizard — 2026-10-02

**Muhammad, 2026-10-02:** add the guidance skill; add a button to add a new author that asks for the
inputs one by one, step by step, with next / previous, and can create the code locally and add the
author to `coaches.json`; move the dashboard to `D:\Projects\LeadershipBooks\BookCoach Author Dashboard`.

### The move

| Moved to `BookCoach Author Dashboard/` | Stayed in `coach-router/` — and why |
|---|---|
| `server.mjs`, `web/`, `pipeline.mjs`, `lib-pipeline`, `lib-health`, `lib-settings`, `lib-switches`, `lib-live`, the skill template, `pipeline.local.json` + alert state | `coaches.json` (the one registry — the Worker is seeded from it), `steps.mjs` (`npm run author` numbers its rows from it), `lib-readers.mjs` (`npm run author` reads through it), every command that writes |

`coach-router`'s `npm run pipeline` / `npm run dashboard` now start the new folder, so nothing
written earlier stops working. Tests split: **859** in `coach-router` (including a guard that the
numbering stays tied to `steps.mjs`), **185** in the dashboard. Sign-offs stay in
`coach-router/onboarding-state.local.json`, beside `lastVerify`.

### The wizard — `lib-wizard.mjs`, `lib-actions.mjs`, `web/wizard.js`

**D5 reversed, on request:** the dashboard can now change things — but only through the wizard, and
only like this:

| Guard | How |
|---|---|
| **The same commands** | It runs `onboard`, `author set`, `author shopify`, `author config`, `seed` + `secrets` and `verify-author` — never its own copy of what they do. Every refusal, backup and validation they have still applies |
| **An allowlist** | Six actions (seven since 2026-10-12: + the product image), each a fixed script. Anything else is refused (tested) |
| **No shell** | Arguments are built from validated values and passed to `node` as an array |
| **Preview, then confirm** | Every action with a dry run shows it first; a real run needs a confirmation naming the action and the author (`onboard 1045`) |
| **One at a time** | A second job is refused while one runs; each is timed out |
| **No credential shown** | Command output is scrubbed of the real credential values; generated files are refused if they would contain one |
| **The key never via the browser** | `set` refuses any field that is not a registry field, so `vfKey` cannot be written from the page |

**Drafts.** Steps 0-2 are saved to `drafts.local.json` (gitignored) — nothing exists anywhere until
step 3 runs `onboard`. A "the Voiceflow coach is built" confirmation given in the draft becomes the
real step-1 sign-off the moment the author is created, and the draft is deleted.

**Code created locally** — `generated/<slug>/` (gitignored), refused if it would carry a credential:

| Step | File | What it is |
|---|---|---|
| ~~6~~ | ~~`coach-page.html` + `coach-page-CONFIG.js`~~ | **Replaced by the step-6 form, §17** — the whole page is now built from a master template into `ghl-shopify subscription/<name>-v2` |
| 7, 9 | `course360.txt` | course name, the lesson iframe (`&amp;` and all), the Offer, the grant workflow and its trigger |
| 10 | `funnel.txt` | the address, the product and price to repoint the order form to |
| 11 | `zipify.txt` | the ordered find-and-replace list and the plain cart link |

**Proven live, 2026-10-02**, writing nothing to GHL, Shopify or KV: a throwaway draft (1099, then
discarded) → the onboard **preview** ran through the dashboard and printed exactly what it would
create; a real run without the confirmation → **400**; an action not on the list → **400**. Rick's
(1044) files were generated for real — **his coach page is ready to paste**, which is the fix for his
step 6.

### Guidance — switched ON 2026-10-02

The `/next-step` skill is installed at `D:\Projects\LeadershipBooks\.claude\skills\next-step\`
(gitignored), pointing at the new folder. A Claude Code session that was already open needs
`/reload-skills` once. The **Guidance** switch removes it again.

---

## 15. Authors by name, not by code — 2026-10-02

**Asked:** are the four-digit codes needed, and could the author names be the IDs instead?

**Decided: the code stays the ID; nobody has to type it.** It is what a caller keys on the phone
keypad when they hold two coaches, what each coach page sends (`COACH_CODE`), and what everything
is stored under (`coach:<code>`, `trial:<contact>:<code>`, the leases, the GHL `coach_code` field).
A name makes a bad ID: it has two spellings (Micheal / Michael), it can clash (two Michaels already
exist in the roster), a keypad cannot type it, and changing it would mean rewriting live pages,
trial records and every customer's GHL fields at once — for no benefit to a reader.

**Built instead — `coach-router/lib-find.mjs`:** every command that asks for `--code` also takes
the slug, the name in either spelling, an alias, or a unique whole-word part of the name; `--author`
is the same. Used by `npm run author` (including `zipify --from`), `verify-author`, `verify:vf`,
`npm run pipeline`, and the dashboard's links (`#wizard&code=freddy`, `#grid&step=freddy:11`).
A name that fits more than one author is **refused with the list** — a guess would quietly work on the
wrong author. 18 tests (873 in coach-router, 189 in the dashboard).

---

## 16. The codes renumbered, and help in plain words — 2026-10-02

**Renumbered (Muhammad ran the steps):** 1042 → **1001** Michael Stickler, 1043 → **1002** Freddy
Davis, 1044 → **1003** Rick Meyer; new authors continue from **1004**. Verified live afterwards:
`coaches.json` carries the new codes with `formerCodes`, `/health` ok with all three keys resolved,
`/api/coach-page?slug=freddy-davis` answers `1002`.

The Worker keeps every old code working (`formerCodes`, `canonicalCode()` in every lookup): KV
trial records, SMS sessions, activation tokens, leases and the live coach pages' `COACH_CODE` all
still resolve, and a superseded `coach:<old>` entry is ignored, so an author is never in the registry
twice. A coach page still carrying an old code reads **"done, with a note"** — it works; re-paste it
when convenient. An old code is never handed to a new author. Tool: `coach-router/renumber-coaches.mjs`.

**Help in plain words — `lib-help.mjs`.** Muhammad asked for the dashboard itself to explain, in
easy words, what to do at every step, whenever stuck. Every step (0-17) now carries: a one-line
headline (what state it is in), **what is wrong and exactly how to fix it** — with this author's real
links, names and ids filled in, copy buttons on the values — then **how the step works** (what, why,
numbered how-to, done-when), and what can be ignored. Problems are marked **Fix this**, **Check, then
sign off**, or **Optional**; two problems with one fix are one box. The nine health checks carry the
same. Shown in the grid's side panel, at the top of every wizard step, and on the Health tab.

A test reads every check name `lib-author.mjs` can produce and fails if one has no plain explanation,
so a new check cannot ship unexplained. Static text, no AI, $0. Tests: 891 coach-router, 230 dashboard.

## 17. Step 6 — the coach page from a form — 2026-10-02

**Asked:** "rather than me having to edit the config manually every time … a form, where I would just
have to input relevant details, rest all the work will be done from behind, the whole code file would
be generated and saved in the relevant folder."

**One master page.** ms-v2 and freddy-v2 were proven identical outside their `CONFIG` block (1,201
lines after it, 10 before). That shared code is now `BookCoach Author Dashboard/templates/coach-page.template.html`
— committed, with an empty `CONFIG` block, no author name, no key. Rebuilding Stickler's page from it
reproduces ms-v2 byte for byte outside `CONFIG`; the only difference inside is his new code (1001).
Rebuilding Freddy's also drops the inherited `authorURL` (Stickler's speakers-bureau page) his file still has.

**The form — Onboard → step 6** (`lib-pages.mjs`, `POST /api/wizard/page`):

| Answer | Kept in | CONFIG key |
|---|---|---|
| photo, initials, the author's own website, book buttons | `coaches.json` via `author set` (the same answers as step 5) | `authorPhotoURL`, `authorInitials`, `authorURL`, `books` |
| tab title, course buttons, connection (auto / worker / direct), "put the key in" | `page-settings.local.json` | `pageTitle`, `courses`/`showCourses`, `CONNECTION`, `VF_API_KEY` |
| author name, coach name, code, router address, Voiceflow version, activation button | shown, not asked — from steps 0, 2 and `shared` | `authorName`, `bookTitle`, `COACH_CODE`, `WORKER_URL`, `VF_VERSION_ID`, `showActivation: true` |

"Save and build the page" validates everything first (one bad answer writes nothing), runs
`author set` only for answers that changed and **waits for it** (the job runner's new `wait()`), and only
if it succeeded writes the page. A saved answer can be changed but not emptied — `author set` cannot
remove a value, and the form says so rather than silently keeping it.

**Where it goes:** `ghl-shopify subscription/<name>-v2`, next to the others — an author whose page file
exists keeps it (found by the `COACH_CODE` inside, current or former: ms-v2, freddy-v2), a new author
gets `<slug>-v2`. The version replaced is kept as `<name>-v2.bak-<yyyymmdd-hhmmss>`. `/ghl-shopify subscription/*-v2`
is gitignored: with "put the key in" ticked (the default, as on both live pages) the file holds the
personal key, readable in the page source by design, for the "auto" fallback.

**The key never crosses HTTP.** The build is refused if the page would carry any credential other than
the key it was asked to include. The browser gets only the file's name and size. **Copy the whole page**
is done by the server (`clip.exe`, UTF-16 with no byte-order mark — tested: em dashes and arrows survive,
and a BOM would paste as an invisible character); **Open in Notepad** / **Show in folder** start
`notepad.exe` / `explorer.exe` on the path the server worked out. No shell anywhere.

**Hardening that came with it:** the CONFIG writer escapes `<` as `<`, so a title can never end the
page's `<script>` early; the form refuses `<`/`>` in titles outright.

**Terminal:** `npm run pipeline -- page --author rick [--copy]` rebuilds from the saved answers;
`npm run pipeline -- page-template --from <finished page>` makes a finished page the new master (refused
if a key or an author's name would be left outside `CONFIG`). Both live pages already equal the master.

**Proven, 2026-10-02:** through the running dashboard, Rick Meyer's page was built from the form
(`rick-meyer-v2`, 137 KB, code 1003, the Worker, `showActivation: true`); a non-https photo was refused
with nothing written. His live page still calls Voiceflow directly with no activation button — pasting
this file fixes both. Tests: 891 coach-router, 279 dashboard (49 new).

## 18. The coach page first — renumbered 2026-10-05

**Asked:** "Step 6 should be in place of step 3, as first I would create the website (page) for the coach,
after that I would do anything else. Otherwise I will get an error 404 in step 3."

**The 404 never blocked step 3.** `onboard.mjs` reads the coach page only as a fallback source for the
Voiceflow ids and prints its status; its refusals (`preflightProblems`) never look at the page. The
dry run Muhammad ran finished green. The funnel-page 404 beside it is the same: a note.

**The order now** (`coach-router/steps.mjs`, `RENUMBER_2026_10_05` maps old → new):

| New | Step | Was |
|---|---|---|
| 0–2 | Inputs · Voiceflow coach · Voiceflow IDs | 0–2 |
| **3** | **Coach page** — details + build + publish; needs only step 2 | 6, and 5 (page details) folded in |
| 4 | GHL + registry (onboard) — now also saves the step-3 page details | 3 |
| 5 | Shopify bundle | 4 |
| 6–16 | Course360 · Lesson URL · **Zipify** · Funnel · **Grant workflow** · Sales page URL · Go live · All checks (gate) · End-to-end · Hands-on · Clean up — Zipify and the grant workflow swapped the same day (§19) | 7–17 |
| 17–25 | after launch | 18–26 |

"Page details" (old 5) is not a step any more: the step-3 form already asks for photo, initials, the
author's own site and book buttons, so a separate step AFTER the page would have been backwards.

**The page before the author exists.** The step-3 form works on a draft: its coaches.json answers are
validated and kept in the draft (`saveDraft` now takes everything before step 4 — `CREATE_STEP`), the
page is built from the draft's values, and the view reads the page's address once to show whether it is
published. Step 4's real run is two commands: `onboard.mjs --write`, then `author set` with the draft's
page details (onboard has no flags for them); its preview is onboard alone. Before Go live (step 12) a
new page answers through its "auto" fallback, straight to Voiceflow.

**Nothing stored needed migrating:** the only sign-offs on file (1001, 1002, and the 1004 draft) are for
step 1, which kept its number.

**What the renumber broke, and was fixed:** the canvas looked up step 17 by number — the whole page
failed to load after the grid ("Cannot read properties of undefined"). It now links from the last step,
whatever its number, and a test fails if `canvas.js` ever indexes a step by a fixed number again.

**Proven live, 2026-10-05:** a throwaway draft (1099) built its coach page at step 3 before existing in
coaches.json — photo and book button saved to the draft, page file written with code 1099 and
`showActivation: true`; draft, page file and settings removed afterwards. Stickler's live status reads
every row under its new number. Tests: coach-router 893, dashboard 293.

## 19. Page switches as toggles, Meet the Author, the bundle price — 2026-10-05

- **`showMeetAuthor`** — a new CONFIG switch, written on the line under `showCourses`. The master page's
  "Meet the Author" button now obeys it (`false` removes the button; `true` — or a page from before the
  switch — shows it whenever there is an `authorURL`). Pages built before today work as they did; rebuild
  one to get the line.
- **The four switches are toggles in the step-3 form** — "Get my activation code", "Buy the Book", "Buy the
  Course", "Meet the Author" (`showActivation`, `showBooks`, `showCourses`, `showMeetAuthor`). Kept in
  `page-settings.local.json` with the page's other settings; not set, they start where the page would:
  activation and Meet the Author on, books and courses on when there are any. Activation is a toggle now
  rather than "always on"; switching it off is allowed, and step 3's live check still reads it as wrong.
- **Step 5's bundle price starts filled in as 29.95** — an answer you can change, not a grey hint.
- **Step 6 (Course360) gives a course description to copy** — one wording for every coach, only the author's
  name changes (`courseDescription()` in `coach-router/lib-onboard.mjs`; also written into course360.txt).
- **"Generate the files" is gone as a name.** It never created anything — GHL, Course360 and Zipify cannot be
  written to — it only saved the on-screen notes to `generated/<slug>/`. Steps 6, 8 and 9 now say **Save these
  notes as a file (optional)** with "creates nothing in GHL" beside it, and step 6's how-to no longer sends you to
  it; step 10's says **Make the find-and-replace list**, the one that produces something new. A test fails if any
  help text names "Generate the files" again.

- **Steps 8 and 10 swapped** (Muhammad): the **Zipify page is step 8**, the **grant workflow step 10**. Zipify now
  needs only step 5 (the cart link is the bundle's variant): it links to the funnel page too, but that
  address is fixed from step 4, so the page can be built before the funnel is published. End-to-end (14)
  needs 10 — the grant workflow is still published before the first order; step 8's how-to says to finish
  step 10 the same day the sales page goes public. `RENUMBER_2026_10_05` maps old 9 → 10 and old 11 → 8.
- **Step 8 gives the Zipify page name to copy**, right under the cart link: `Book Coach AI - <Author> - <Book
  title>` (`zipifyPageName()`, lib-onboard) — the pattern of Freddy's live page, whose address Zipify built from
  it (…/pages/book-coach-ai-freddy-davis-the-truth-mirage).

- **A renumber bug, found on Sue's live status and fixed:** the "no other author on the page" check takes
  its step as an argument (`foreignRows(step, …)`), and the renumber had left those calls on their old
  numbers — the coach page's under 6, the funnel's under 10, Zipify's under 11. So "Michael Stickler" on
  Sue's FUNNEL page was reported under the grant workflow. Now 3, 9 and 8; a test plants a foreign name
  on all three pages and checks each lands on its own step. The same stale number sat in the hidden-data
  note (`step === 10` for the funnel): its "Funnel Settings → SEO & AEO" fix now shows on step 9 again.
  A sweep for any other `step === <n>` found none left stale.

- **Sales page URL moved up to step 9**, right after Zipify (Muhammad: the dashboard can only check the
  Zipify page once its address is saved, so the two belong together). Funnel page → 10, grant workflow → 11;
  12 onwards unchanged. The sales address still needs only the bundle (5), not step 8 — step 8 reads "to do"
  until the address is saved, so making 9 wait on 8 would have locked them together.
- **Everything is now checked by step NAME, not number** — a test block files every live check, answer box,
  button, "what you need" box and help entry under the title of the step it belongs to, and checks the main
  "go to step N" lines point at the right step. A reorder that leaves a number behind now fails a test
  instead of reaching the screen. (The checklist was reordered three times today; twice a number was missed.)
- Zipify's "Make the find-and-replace list" step text now says to publish the same day as the grant workflow (11).

- **Step 8 also gives Zipify's Publish Settings to copy:** the **URL and Handle** (the page name made into a
  Shopify handle — lowercase, apostrophes dropped: `book-coach-ai-freddy-davis-the-truth-mirage`, exactly Freddy's
  live one) and the **Meta Title** (`<Book title> + BookCoach AI | LeadershipBooks.com`, the live pattern). Step 9
  shows the exact address the page should end up at. (`zipifyHandle`, `zipifyMetaTitle` in lib-onboard.)

- **"Publish the Offer" reminder** (found on Sue Summers): a Course360 Offer is created as **Draft**, and a draft
  Offer cannot be granted — the grant workflow's "Grant Offer" list does not even show it. Publishing it
  cannot be automated: there is no API for Offers (`/memberships/offers` 404s, plans/01), and driving GHL's web
  UI would break with every GHL change. So step 7 (Lesson URL) shows a highlighted reminder right under its
  answer box, step 6's how-to says to publish it, and step 11's says what to do when the Offer is missing.
  Reminders are keyed by step NAME (`STEP_REMINDERS` in lib-wizard) and cite step numbers from the step list.

- **Every view has its own address** (Muhammad: "the url should change"): `/pipeline`, `/canvas`, `/health`,
  `/onboard`, `/onboard/1002-freddy-davis`, `/onboard/1002-freddy-davis/6` — code AND slug, so two authors
  sharing a first name cannot collide; a name alone (`/onboard/freddy`) is resolved and rewritten to the full
  address. Opening an author or a tab is a new history entry; moving between steps replaces it. Back/Forward
  re-open what the address says. The server serves the page only on those shapes (`PAGE_PATH`) — anything
  else is still a 404. A deep link is now followed once, when the page opens: before, every re-read after a
  save re-applied it and could jump you back to the linked step. Old `#wizard&code=…` links still work.

- **The line under the author's name** (above "Coach online"; CONFIG `bookTitle`) is its own box in the step-3
  form, first, starting as the **book title** — it used to be the coach label, which for a new author repeats
  the name ("Sue Summers – Let's Raise…" under "Sue Summers"). The book title (or nothing) is stored as "not
  set", so it follows the book title. The coach label stays for the Course360 course name and the tab title.
  Rebuilding with defaults changes only Freddy's line ("Worldview Coach" → "The Truth Mirage") — type
  "Worldview Coach" in the box to keep it.

- **Step 3 gives the GHL page's "Name for page" to copy**, between "Publish the page at" and "Page path in GHL":
  `AI Coach Final — <Author> — Book Coach` (`coachPageName()` in lib-onboard), e.g. "AI Coach Final — Rob
  Streetman — Book Coach". The how-to names it too.

- **Step 8 turns a YouTube link into the sales page's embed code.** "Book video on YouTube (optional)" takes any
  link a person pastes (watch?v=, youtu.be, /shorts/, /embed/, m., with &t= or &list=, or the bare id), saves it to
  coaches.json as `videoUrl` in one plain form (`author set` validates it; it is not pushed to KV), and step 8 then
  shows the embed to copy — the live pages' exact iframe, looping the video as its own playlist
  (`youtubeId`, `youtubeEmbed` in lib-onboard). No video: no box.

- **Step 0 (Inputs) shows "Where you stand"** (lib-checklist.mjs; it sat on step 1 for a day — Muhammad meant step 0;
  moved by step NAME, so every author's ticks moved with it): About the author link · YouTube video link · Books (n) ·
  Courses (n). Each ticks itself when the dashboard can see it saved (the author's site, book and course buttons
  at step 3; the YouTube link at step 8 — step numbers by name). A person can tick or untick any item; unticking
  one the dashboard ticked shows a soft warning first, then the choice wins and the line says the dashboard
  still sees it. Only the person's difference from the automatic answer is stored (checklists.local.json,
  gitignored), so an item follows the dashboard again once they agree. More items: add to `ITEMS`.

- **Every Add to Cart on a sales page is checked, not just "ours is there"** (`wrongCartLinks`, lib-author; new
  step-8 check "no Add to Cart link points elsewhere"): Shopify cart links (`/cart/<variant>:<qty>`, several joined
  by commas), `/cart/add?id=`, and **Zipify's own product blocks** (a "Product Listing" form bound to a product and
  variant). Each wrong one is named — whose bundle it is, "not a Book Coach bundle", or "adds 2, not 1" — and is a
  FAIL, no longer only a quiet "hidden page data" note. **Found live on its first run:** Sue Summers', Rob
  Streetman's and Doug Fearing's pages — all cloned from Freddy's — keep a visible "Product Listing 1" block still
  bound to **Freddy's bundle** (variant 54120408187194), under their own edited title; their plain ADD TO CART
  buttons are right.
- **…and then, rightly, demoted** (Muhammad: "the button link that leads to payment … is the only thing that should
  be checked"). Those blocks have no buy button of their own — only the +/- quantity (`type="button"`) — and the
  visible Add to Cart is the plain link button inside them, so nothing a buyer can press reaches Freddy's bundle.
  Now: what a buyer can press decides it. A wrong cart link, `/cart/add`, or a product block WITH its own buy
  button is **red**; a block with none, still linked to another bundle, is an optional note ("Zipify product block
  linked to another bundle" — Zipify's product data and search results see it, buyers do not).

- **The Onboard tab has an author list** beside the steps: every author and draft, each with where it stands (from
  the Pipeline's own reading). A click switches author and KEEPS the step, so one step can be compared across
  authors; the address follows (`/onboard/1002-freddy-davis/8`). When the Pipeline re-reads, only that list is
  redrawn — never the form being typed in. **"Book Coach" (top left) is the way home**: the Pipeline grid at `/`.

- **The dashboard opens on the last reading** (2026-10-06). A full read had grown to ~50 s (one author: 3-19 s,
  health ~2.5 s). Each author's reading is kept in `readings.local.json` (lib-readings.mjs) with a fingerprint of
  its inputs (coaches.json entry, sign-offs, last verify) — change one and that author alone is read again. A
  step-list change drops every reading; a change to the check code keeps them, marked `oldChecks`, with a note
  and a "Refresh those" button. **Refresh…** asks: everything, or the authors ticked (+ health if ticked);
  `/api/state?refresh=all|1001,1003&health=1`. In the Onboard tab it is **Refresh this author**. A job refreshes
  only its own author (+ health); a sign-off re-reads rows older than 10 min. The terminal (`npm run pipeline`)
  keeps no readings — it always reads live. Nothing with a credential is written.

- **Step 5, a bundle that stopped shipping** (2026-10-07). Stickler's and Freddy's bundle variants had
  "This is a physical product" unticked by hand in Shopify (requires_shipping false → no shipping address at
  checkout). Ticked back through the Admin API (productVariantsBulkUpdate, inventoryItem.requiresShipping) — both
  pass. The help box now says what that means and where the tick box is; once a bundle exists, step 5 shows
  "already exists" instead of a Create button the command would refuse.

- **Step 5 uploads the product image** (2026-10-12, Muhammad: "either provide image path locally, or a link … it should
  upload the HD quality image"). Two optional boxes: a file on this computer ("Copy as path" quotes are dropped) or a
  link (Google Drive / Dropbox share links are turned into the file). `author shopify --image-file … | --image-url …`
  reads the bytes ITSELF, checks them by their header — not the name or the server's word — and uploads them
  untouched: no resize, no re-encode, so Shopify keeps the full-size original. The preview shows the size
  ("2400 × 3600 JPEG, 1.9 MB"), refuses over 20 MB / 20 megapixels (Shopify's limits), a web page instead of the
  picture, or both boxes filled, and notes anything under 2048 px (Shopify's recommended size) without refusing it.
  Order: staged upload FIRST (a failed upload leaves nothing in the store) → `productCreate` with the media, alt =
  the product title → price, publish, collection → wait for Shopify to process it (≤ 60 s). If processing fails the
  product and its ids still stand, and the output says to check the picture by hand. Not a "bundle image" — that is
  separate and untouched. ⚠ Written against the documented API (`stagedUploadsCreate`, `productCreate(media:)`), not
  yet run for real: watch the first real bundle with an image. Dry runs proven live with a link and a local file.
- **…and to a product that already exists** (same day — Reinhard's bundle was made by hand, so step 5 had hidden its
  buttons and the image boxes had nowhere to go). A seventh allowlisted action, `shopify-image` →
  `author shopify-image --code … (--image-file | --image-url) [--write]`: reads the product first (refused if Shopify
  does not know the id), uploads, then `productUpdate` with ONLY the id and the media — title, price, everything
  else untouched, no image removed; alt = the product's own title. The preview says how many pictures it has now:
  with none, the new one becomes the main picture; with some, it goes after them (drag it first in Shopify to make
  it the main one). Dry run proven live on Reinhard (1011): 0 pictures now.

- **Renumbered again, 2026-10-12, and two features** — built from this dashboard's own plan,
  [`BookCoach Author Dashboard/plans/01-merge-steps-landing-pages-collection.md`](../../BookCoach%20Author%20Dashboard/plans/01-merge-steps-landing-pages-collection.md) (as built: its §8):
  the two Voiceflow steps are **one step, 1** (no tick box); the new **optional step 8, Course Collection + Bundle Image**
  (a second Shopify product with its image — buying it gives no coach yet, plan 02); and **Generate Landing Pages** in the
  Zipify step (the words by Claude Code, the layout by code). Steps now named by key in code (`STEP.coachPage`).

- **Course360 (step 5) through HighLevel's Courses API** (2026-10-13) — built from this dashboard's
  [`plans/03-course360-by-api.md`](../../BookCoach%20Author%20Dashboard/plans/03-course360-by-api.md) (as built: its §9).
  The old note "no API for courses or Offers" is out of date: with `courses.readonly`/`courses.write` (added to the
  Private Integration that day; its other scopes re-set to exactly what the code uses) the API reads and writes courses,
  lessons and Offers — an Offer can be created **Published**, so the forgotten Draft → Published click is gone. A person
  Duplicates the master course (videos are invisible to the API), `author course360` / "Make the course" does the rest.
  The manual "Offer is Free and unlisted" sign-off is replaced by live checks. Found on the way: Freddy's saved course had
  been deleted and his Offer gave no course. Later idea (plan 04): `POST /courses/enrollments` could let the Worker grant
  the Offer itself, with no per-author grant workflow.

Tests: coach-router 1033, dashboard 437.
