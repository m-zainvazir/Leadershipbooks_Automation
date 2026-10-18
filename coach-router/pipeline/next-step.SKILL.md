---
name: next-step
description: Use when the user asks where a Book Coach author is in onboarding, what to do next for an author or coach code (e.g. "next step for 1044", "what's left for Rick Meyer", "where is Freddy in the pipeline"), or whether anything live has broken. Reads the live pipeline tracker and explains it in plain words. Tracks and guides only.
---

# Next step — the Book Coach pipeline, in plain words

Installed by `npm run pipeline -- config --guidance on`; switching guidance off deletes this file.
The tracker lives in `{{COACH_ROUTER}}` (plan: `ghl-shopify subscription/plans/22-pipeline-dashboard.md`).

## What to do

1. Work out the author's **coach code**. If the user gave a name, run
   `node pipeline.mjs` in `{{COACH_ROUTER}}` and match it in the table.
2. Run, in `{{COACH_ROUTER}}`:

   ```
   node pipeline.mjs next --code <code> --json
   ```

   For the whole picture: `node pipeline.mjs status --code <code>`. For anything live
   breaking (checklist steps 18-26): `node pipeline.mjs health`.
3. Tell the user, briefly and in this order:
   - **where they are** — the step number and title, and its state (wrong / do this next /
     needs your confirmation)
   - **why** — the failing or missing checks (`next.fixes`)
   - **what to do** — `next.command` and `next.instructions`, with the author's values filled in
   - if the state is **needs your confirmation**: what to check by hand (`next.signoff`), and
     that they record it with `node pipeline.mjs signoff --code <code> --step <n> --note "…"`

## Rules

- **Read-only by default.** `next`, `status`, `health` and `npm run author -- status` only read.
  Never run anything with `--write`, `npm run push`, `npm run onboard`, `verify-author`, or a
  `signoff` without the user saying so in this conversation.
- **The live systems are the truth, not the docs.** Every state is recomputed on each run; a
  sign-off never overrides a check that is wrong.
- Step numbers are the checklist's: `ghl-shopify subscription/plans/further-automation-v1.md`.
