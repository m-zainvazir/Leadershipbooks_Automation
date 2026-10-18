/**
 * steps.mjs — THE definition of the onboarding pipeline. Data only.
 *
 * One list, read by everything that talks about steps: `npm run author`
 * (lib-author.mjs), `npm run pipeline`, the dashboard, and the optional
 * /next-step guidance. Two copies of a step list is the drift plans/20 exists
 * to remove, so nothing else may number the steps.
 *
 * The numbering IS the working checklist:
 *   ghl-shopify subscription/plans/further-automation-v1.md  (steps 0-16, 17-25)
 * Plan: ghl-shopify subscription/plans/22-pipeline-dashboard.md §4.
 *
 * Fields:
 *   id, title          the checklist number and a short name for a table header
 *   key                a fixed name for code to use (STEP.coachPage), so a reorder
 *                      renumbers everything at once and no number is left behind
 *   optional           never blocks anything and never counts against "All checks";
 *                      reads OPTIONAL until done (or signed off)
 *   long               the checklist's own wording
 *   platform           where the work happens
 *   kind               automated | assisted | manual  (the checklist's legend)
 *   needs              steps that must be DONE before this one is READY
 *   gate               DONE only when every step in `needs` is DONE (step 13)
 *   command            the command for this step, {code} filled in per author
 *   instructions       what a person does, when there is no command (or as well)
 *   signoff            what a sign-off confirms — only for what no API can read
 *
 * `needs` only ever points at LOWER ids, so states resolve in one pass in order.
 */

export const DOC = 'ghl-shopify subscription/plans/further-automation-v1.md';

export const PIPELINE_STEPS = [
  {
    id: 0, key: 'inputs', title: 'Inputs', long: 'Collect the inputs', platform: 'the author / the book', kind: 'manual', needs: [],
    instructions: 'Author name (and the internal spelling if different), real book title, coach label, coach code (next free number), page slug, photo URL, the author\'s own page URL, book purchase link.',
    command: 'npm run author -- set --code {code} --coachLabel "…" --bookTitle "…"',
    // Offered only while a basic detail is missing: complete = all saved, or every "where you stand" box
    // ticked, or this sign-off (2026-10-13).
    signoff: 'The inputs are complete — anything not saved is not needed for this author',
  },
  {
    // One step since 2026-10-12 (was "Build the Voiceflow coach" + "Read its IDs"): the IDs exist
    // only once the coach does, so saving them is the proof — no separate tick box.
    id: 1, key: 'voiceflow', title: 'Voiceflow coach + IDs', long: 'Build the Voiceflow coach, then record its IDs', platform: 'Voiceflow', kind: 'manual', needs: [0],
    instructions: 'Build it with the book-coach-ai-builder skill (prompts, knowledge base, playbooks), then record the 24-character Version ID (address bar, with Main selected — never an alias like main) and the Project ID (Settings → General).',
    command: 'npm run verify:vf -- --code {code}',
  },
  {
    // First, right after the coach exists (decided 2026-10-05): the page is what
    // everything else points at. Built from the draft — the author need not exist yet.
    id: 2, key: 'coachPage', title: 'Coach page', long: 'Coach page — details + build + publish', platform: 'GHL Websites', kind: 'assisted', needs: [1],
    instructions: 'Dashboard → Onboard → step 2: photo, initials, the author’s own site, book buttons; "Save and build the page" (the whole page, from the master template); "Copy the whole page"; in GHL Websites paste it into the page’s Custom Code element; publish at /<slug>.',
    command: 'npm run pipeline -- page --code {code} --copy',
  },
  {
    id: 3, key: 'ghl', title: 'GHL + registry', long: 'Create the GHL side + the registry entry', platform: 'GHL + repo', kind: 'automated', needs: [1],
    instructions: 'Coach tag, $59 SERVICE product, recurring monthly price, coaches.json entry (with the page details from step 2). Refuses on any clash before writing.',
    command: 'npm run onboard -- --code {code} --author "…" --book "…" --slug … --label "…" --version <24-char> --project <24-char> --write',
  },
  {
    id: 4, key: 'shopify', title: 'Shopify bundle', long: 'Create the Shopify bundle', platform: 'Shopify', kind: 'automated', needs: [3],
    instructions: '"Book [Author] + Your Personal AI Coach", $29.95, ships; published to the Online Store; added to coach-bundles; ids recorded.',
    command: 'npm run author -- shopify --code {code} --write',
  },
  {
    // Since 2026-10-13 through the Courses API (dashboard plans/03): a person Duplicates the master
    // course in GHL (videos can only be copied there), the command does the rest. No sign-off.
    id: 5, key: 'course360', title: 'Course360', long: 'Course360 course + Offer', platform: 'Course360', kind: 'assisted', needs: [3],
    instructions: 'Duplicate the master course in GHL, then the command names it `BookCoach AI — <Author> — <Label>`, points its "BookCoach AI" lesson at this coach, and makes the Free Offer, Published, that gives it.',
    command: 'npm run author -- course360 --code {code} --write',
  },
  {
    id: 6, key: 'lessonUrl', title: 'Lesson URL', long: 'Record the lesson URL', platform: 'repo', kind: 'assisted', needs: [5],
    instructions: 'The MEMBER URL (login.leadershipbookspublishers.com/courses/products/…) — saved by the Course360 command; paste it only for a course made by hand. The preview query is stripped automatically.',
    command: 'npm run author -- set --code {code} --courseLessonUrl "<paste the preview link>"',
  },
  {
    id: 7, key: 'zipify', title: 'Zipify page', long: 'Zipify sales page', platform: 'Zipify', kind: 'manual', needs: [4],
    instructions: 'Clone a live sales page; paste the generated landing page text (Generate Landing Pages); Add to Cart = Zipify\'s Product block set to this author\'s bundle.',
    command: 'npm run pipeline -- landing --code {code}',
  },
  {
    // Added 2026-10-12. Optional: a second product, "<Book> - Collection Bundle" (course + book),
    // with its own image. Never blocks anything, never counts against All checks.
    id: 8, key: 'collection', title: 'Course Collection + Bundle Image', long: 'Course collection product + its image (optional)', platform: 'Shopify', kind: 'assisted', needs: [3], optional: true,
    instructions: '"<Book title> - Collection Bundle", $97 to start, no inventory tracked, no shipping address, the Educational Services category and a standard description (needed to sell abroad); its image uploaded full size; ids recorded. Optional — sign it off if this author has none.',
    command: 'npm run author -- shopify-collection --code {code} --write',
    signoff: 'This author needs no collection product (or it was made by hand)',
  },
  {
    id: 9, key: 'salesUrl', title: 'Sales page URL', long: 'Record the sales page', platform: 'repo', kind: 'assisted', needs: [4],
    instructions: 'Record the published Zipify page so it can be checked.',
    command: 'npm run author -- set --code {code} --bookLandingUrl https://leadershipbooks.com/pages/…',
  },
  {
    id: 10, key: 'funnel', title: 'Funnel page', long: '$59 funnel page', platform: 'GHL Websites', kind: 'manual', needs: [3],
    instructions: 'Clone a coach-access page to /<slug>-coach-access; REPOINT the order form to this author\'s product + price; change the author\'s name in the copy; publish.',
  },
  {
    id: 11, key: 'grant', title: 'Grant workflow', long: 'Grant workflow', platform: 'GHL Automation', kind: 'manual', needs: [3, 5],
    instructions: '`Book Coach — Grant Course (<Author>)`: Contact Tag added = {ghlTag} → Grant that Offer → PUBLISH before the first order.',
    signoff: 'The trigger is Contact Tag added = the coach tag',
  },
  {
    id: 12, key: 'goLive', title: 'Go live', long: 'Go live — registry to KV + the key to the Worker', platform: 'Cloudflare', kind: 'automated', needs: [3, 4, 6],
    instructions: 'Refuses on any problem (duplicate ids, alias version, missing fields).',
    command: 'npm run push',
  },
  {
    // Every step before it except the optional one.
    id: 13, key: 'allChecks', title: 'All checks', long: 'Check every step, live', platform: 'all systems', kind: 'automated',
    needs: [0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12], gate: true,
    instructions: 'Done when steps 0–12 are all done (step 8 is optional and not counted). This tool is the check.',
    command: 'npm run pipeline -- status --code {code}',
  },
  {
    id: 14, key: 'e2e', title: 'End-to-end test', long: 'End-to-end test', platform: 'Shopify → GHL', kind: 'automated', needs: [2, 11, 12],
    instructions: 'A real $0 order → Flow B → Worker → GHL; checks both tags and all ten fields; cancels the order. --keep leaves the contact for step 15.',
    command: 'npm run verify-author -- --code {code} --shopify-order --write --keep',
  },
  {
    id: 15, key: 'handsOn', title: 'Hands-on', long: 'Hands-on check', platform: 'inbox + browser', kind: 'manual', needs: [14],
    instructions: 'Welcome email names the author; the Course360 invite opens the course; the coach answers; "Get my activation code" works.',
    signoff: 'Welcome email, course invite, coach reply and activation code all checked by hand',
  },
  {
    id: 16, key: 'cleanUp', title: 'Clean up', long: 'Clean up the test contact', platform: 'GHL + KV', kind: 'assisted', needs: [15],
    instructions: 'Delete the verify-author test contact (left tagged, every cron grants it a lease).',
  },
];

/** Step number by fixed name: STEP.coachPage === 2. Use this in code — never a bare number. */
export const STEP = Object.freeze(Object.fromEntries(PIPELINE_STEPS.map((s) => [s.key, s.id])));

/**
 * After launch — nothing per author, ever. Each is watched by the health checks
 * in lib-health.mjs, by effect, because neither Shopify Flow's run history nor
 * GHL's workflow runs can be read with the access this project has.
 */
export const AFTER_LAUNCH = [
  { id: 17, short: 'Flow A starts trials', title: 'Order paid → Flow A waits 21 days → trial starts', checks: ['H2'] },
  { id: 18, short: 'Flow B on delivery', title: 'Delivery known → tag delivered-manual → Run workflow', checks: ['H3'] },
  { id: 19, short: 'Trial start', title: 'Trial start: tags, contact fields, welcome email, course invite', checks: ['H1', 'H6'] },
  { id: 20, short: 'Day 7/9/10 emails', title: 'Day 7 / 9 / 10 emails', checks: ['H8'] },
  { id: 21, short: 'Trial expiry', title: 'Trial expiry: tag removed, coach_status expired', checks: ['H4'] },
  { id: 22, short: '$59 purchase', title: '$59 purchase → entitlement, tag, course, coach_status active', checks: ['H9'] },
  { id: 23, short: 'Cancellation', title: 'Cancellation → access ends within ~15 min', checks: ['H5'] },
  { id: 24, short: 'SMS / voice routing', title: 'SMS / voice routed to the right coach', checks: ['H1'] },
  { id: 25, short: 'Page fallback', title: 'Coach page falls back to Voiceflow if the Worker is down', checks: ['H1'] },
];

/**
 * The renumbering of 2026-10-05: the coach page moved up to step 3 (absorbing
 * the old step 5, "Page details"), so the old 3-4 moved down one and 7-17 up
 * one; then the Zipify page (old 11) moved to 8, its address (old 12) to 9
 * right after it, the funnel page to 10 and the grant workflow to 11.
 * Old -> new, for anything stored under the old numbers.
 */
export const RENUMBER_2026_10_05 = { 0: 0, 1: 1, 2: 2, 3: 4, 4: 5, 5: 3, 6: 3, 7: 6, 8: 7, 9: 11, 10: 10, 11: 8, 12: 9, 13: 12, 14: 13, 15: 14, 16: 15, 17: 16 };

/**
 * The renumbering of 2026-10-12: "Build the Voiceflow coach" (1) and "Read its
 * IDs" (2) became one step, 1, so 3-8 moved up one; the new optional step 8
 * (Course Collection + Bundle Image) came in after Zipify; 9 onwards kept their
 * numbers. Old -> new. Old step 1's sign-off ("the coach is built") has no
 * successor: the saved IDs are the proof now (migrate-signoffs drops it).
 */
export const RENUMBER_2026_10_12 = { 0: 0, 1: 1, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 7, 9: 9, 10: 10, 11: 11, 12: 12, 13: 13, 14: 14, 15: 15, 16: 16 };

/** [id, title] pairs, the shape lib-author's table has always used. */
export const STEPS = PIPELINE_STEPS.map((s) => [s.id, s.title]);

export const stepById = (id) => PIPELINE_STEPS.find((s) => s.id === Number(id));
export const stepByKey = (key) => PIPELINE_STEPS.find((s) => s.key === key);

/** A step's command with this author's values filled in. */
export function commandFor(step, coach) {
  if (!step || !step.command) return '';
  return step.command.replace(/\{code\}/g, coach.code || '<code>').replace(/\{ghlTag\}/g, coach.ghlTag || '<tag>');
}

export function instructionsFor(step, coach) {
  if (!step || !step.instructions) return '';
  return step.instructions.replace(/\{code\}/g, coach.code || '<code>').replace(/\{ghlTag\}/g, coach.ghlTag || 'the coach tag');
}
