/**
 * lib-author.mjs — the author record: what each runbook step looks like LIVE.
 *
 * `npm run author` (author.mjs) is the operator's view of every author:
 * coaches.json is the record, and every other system is checked against it.
 * Plan: ghl-shopify subscription/plans/21-onboarding-automation.md §E.
 *
 * Every check reads; nothing here writes. Network access is injected (`ctx`),
 * so each rule is testable offline:
 *
 *   ctx.fetchText(url)  -> { status, text }        public pages
 *   ctx.catalog()       -> Map<productId, product> Shopify's public products.json
 *   ctx.ghl(path)       -> JSON                    GHL, read-only calls only
 *   ctx.health()        -> JSON                    Worker /health with the token
 *   ctx.kvGet(key)      -> JSON | null             Cloudflare KV
 *
 * Status per row: DONE, TODO (not started), FAIL (started and wrong), WARN
 * (right for readers, wrong somewhere cosmetic), MANUAL
 * (cannot be read with the access this project has — says which access would).
 */

import { registryValue } from './lib-config.mjs';
import { ghlNames, slugConventions, parseCoachPage } from './lib-onboard.mjs';

export const STEPS = [
  [1, 'Voiceflow'],
  [2, 'Coach page'],
  [3, 'Shopify bundle'],
  [4, 'Course360'],
  [5, 'GHL tag'],
  [6, 'Grant workflow'],
  [7, 'GHL $59 product'],
  [8, 'Funnel page'],
  [9, 'Zipify page'],
  [10, 'Registry live'],
  [11, 'Tested'],
  [12, 'Clean'],
];

/** Author-record fields that tooling reads. Not all reach KV — see KV_FIELDS. */
export const RECORD_FIELDS = {
  slug: 'book-coach.ai page slug, e.g. rick-meyer',
  coachLabel: 'the coach label on the page and course, e.g. "Worldview Coach"',
  authorInitials: 'two letters shown when there is no photo',
  authorPhotoURL: 'https:// image for the coach page',
  authorURL: 'https:// the author\'s own page (NOT another author\'s)',
  books: 'the coach page\'s book buttons: "Title|https://url" (repeat --books for several)',
  shopifyProductId: 'the bundle product id (digits)',
  shopifyVariantId: 'the bundle variant id (digits) — the Zipify cart link',
  bookLandingUrl: 'https:// the Zipify landing page on leadershipbooks.com',
  courseLessonUrl: 'https:// the Course360 MEMBER lesson URL',
  ghlPriceId: 'the $59 price id (24 hex)',
  trialDays: 'whole days, 1-90',
  aliases: 'comma-separated names a caller might say',
  bookTitle: 'the book\'s real title',
  displayName: 'the customer-facing spelling',
};

/** Validate one `author set` value. Returns [value, problem]. */
export function parseRecordValue(field, raw) {
  const s = Array.isArray(raw) ? raw : String(raw ?? '').trim();
  const https = (v) => (/^https:\/\/\S+$/.test(v) ? [v, null] : [null, `${field} must be an https:// URL`]);
  switch (field) {
    case 'slug':
      return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s) ? [s, null] : [null, 'slug must be lowercase words joined by hyphens'];
    case 'shopifyProductId':
    case 'shopifyVariantId': {
      const gid = /^gid:\/\/shopify\/\w+\/(\d+)$/.exec(s);
      const v = gid ? gid[1] : s;
      return /^\d+$/.test(v) ? [v, null] : [null, `${field} must be digits`];
    }
    case 'ghlPriceId':
      return /^[0-9a-f]{24}$/i.test(s) ? [s, null] : [null, 'ghlPriceId must be 24 hex characters'];
    case 'trialDays': {
      const n = Number(s);
      return Number.isInteger(n) && n >= 1 && n <= 90 ? [n, null] : [null, 'trialDays must be a whole number 1-90'];
    }
    case 'aliases': {
      const list = String(s).split(',').map((x) => x.trim()).filter(Boolean);
      return list.length ? [list, null] : [null, 'aliases needs at least one name'];
    }
    case 'books': {
      const items = (Array.isArray(s) ? s : [s]).map((b) => {
        const [title, url] = String(b).split('|').map((x) => (x || '').trim());
        return { title, url };
      });
      const bad = items.find((b) => !b.title || !/^https:\/\/\S+$/.test(b.url || ''));
      return bad ? [null, 'books must be "Title|https://url"'] : [items, null];
    }
    case 'authorInitials':
      return /^[A-Za-z]{1,3}$/.test(s) ? [s.toUpperCase(), null] : [null, 'authorInitials must be 1-3 letters'];
    case 'courseLessonUrl': {
      // Same rule seed enforces, applied at the point of entry: strip the query
      // (is_preview=true + a personal token) instead of making someone do it.
      const [v, p] = https(s);
      return p ? [null, p] : [v.split('?')[0], null];
    }
    case 'authorPhotoURL':
    case 'authorURL':
    case 'bookLandingUrl':
      return https(s);
    case 'coachLabel':
    case 'bookTitle':
    case 'displayName':
      return s ? [s, null] : [null, `${field} cannot be empty`];
    default:
      return [null, `unknown field "${field}". Settable: ${Object.keys(RECORD_FIELDS).join(', ')}`];
  }
}

/** The slug, from the record or recovered from the tag it was built from. */
export function slugOf(coach) {
  if (coach.slug) return coach.slug;
  const m = /^bookcoach-(.+)-active$/.exec(coach.ghlTag || '');
  return m ? m[1] : '';
}

export const initialsOf = (name) =>
  String(name || '').trim().split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase()).filter((_, i, a) => i === 0 || i === a.length - 1).join('');

/**
 * Strings that belong to OTHER authors. Finding one on this author's page is the
 * inheritance bug of plans/20 §4.1: a clone still selling its predecessor.
 * Full names and ids only — a bare surname or first name false-alarms on prose.
 */
export function foreignMarkers(coach, all) {
  const out = [];
  for (const o of all) {
    if (o.code === coach.code) continue;
    for (const v of [o.displayName, o.name, o.shopifyProductId, o.shopifyVariantId, o.ghlProductId, o.ghlPriceId, slugOf(o) && `/${slugOf(o)}-coach-access`]) {
      if (v && !out.includes(String(v))) out.push(String(v));
    }
    // Two-word slugs are specific enough to catch "/pages/michael-stickler-…".
    const s = slugOf(o);
    if (s && s.includes('-') && !out.includes(s)) out.push(s);
  }
  // Never flag something that is also ours (two authors sharing a surname slug).
  const own = [coach.displayName, coach.name, slugOf(coach)].filter(Boolean).map(String);
  return out.filter((m) => !own.some((x) => x.includes(m)));
}

const found = (text, markers) => markers.filter((m) => text.includes(m));

/** What a visitor reads: the page minus scripts, styles and tags. */
export const visibleText = (html) =>
  String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');

/**
 * Another author on this author's page. Visible copy is a FAIL — a reader sees
 * the wrong name. Only in scripts (GHL's page data, the JSON-LD a clone
 * inherits) is a WARN: it reaches search snippets, not the page.
 */
function foreignRows(step, html, markers) {
  const vis = found(visibleText(html), markers);
  const hidden = found(html, markers).filter((m) => !vis.includes(m));
  const out = [];
  out.push(vis.length
    ? row(step, 'no other author on the page', 'FAIL', `visible: ${vis.join(', ')}`, 'an inherited value from the page it was cloned from')
    : row(step, 'no other author on the page', 'DONE'));
  if (hidden.length) {
    out.push(row(step, 'no other author in SEO / page data', 'WARN', hidden.join(', '),
      step === 8 ? 'Funnel Settings -> SEO & AEO: the JSON-LD description is inherited from the clone source' : 'in a script or meta tag — reaches search snippets, not readers'));
  }
  return out;
}

/* ------------------------------------------------------------------ checks --- */

const row = (step, check, status, detail = '', fix = '') => ({ step, check, status, detail, fix });

/**
 * Every row for one author, in runbook order. Never throws: a failed read is a
 * FAIL row naming what could not be read, so one outage cannot hide the rest.
 */
export async function authorStatus(coach, ctx, { all = [], deep = false } = {}) {
  const rows = [];
  const slug = slugOf(coach);
  const conv = slug ? slugConventions(slug) : null;
  const foreign = foreignMarkers(coach, all);
  const safe = async (step, check, fn) => {
    try {
      await fn();
    } catch (err) {
      rows.push(row(step, check, 'FAIL', `could not read: ${err.message}`));
    }
  };

  // 1 — Voiceflow ------------------------------------------------------------
  const vfOk = /^[0-9a-f]{24}$/i.test(coach.projectID || '') && !!coach.versionID && !!coach.apiKey;
  rows.push(row(1, 'project, version and key recorded', vfOk ? 'DONE' : 'TODO',
    vfOk ? `${coach.projectID} @ ${coach.versionID}` : 'missing projectID, versionID or vfKey',
    vfOk ? `npm run verify:vf -- --code ${coach.code} proves they answer` : 'npm run onboard fills these'));

  // 2 — Coach page -----------------------------------------------------------
  await safe(2, 'coach page', async () => {
    if (!conv) return rows.push(row(2, 'coach page', 'TODO', 'no slug in the record', `npm run author -- set --code ${coach.code} --slug <slug>`));
    const r = await ctx.fetchText(conv.pageUrl);
    if (r.status !== 200) return rows.push(row(2, 'page exists', 'TODO', `${conv.pageUrl} -> ${r.status}`, `npm run author -- page --code ${coach.code}, paste into a clone of /freddy-davis`));
    const p = parseCoachPage(r.text);
    rows.push(row(2, 'page exists', 'DONE', conv.pageUrl));
    // A page built from pages/coach-page.html carries no CONFIG values at all:
    // it asks /api/coach-page, and the Worker decides showActivation. The
    // registry is then the only thing to check — and it is checked everywhere else.
    if (r.text.includes('/api/coach-page')) {
      rows.push(row(2, 'loads its config from the registry', 'DONE', 'pages/coach-page.html loader — nothing on the page to drift'));
      rows.push(...foreignRows(2, r.text, foreign));
      return;
    }
    // Decided 2026-09-29: pages keep their own CONFIG block (the freddy-v2
    // format), generated by `author page`. The loader template is optional.
    rows.push(p.coachCode === coach.code
      ? row(2, 'talks through the Worker', 'DONE', `COACH_CODE ${p.coachCode}`)
      : p.coachCode
        ? row(2, 'talks through the Worker', 'FAIL', `COACH_CODE is ${p.coachCode}, not ${coach.code} — this page is another coach`, `npm run author -- page --code ${coach.code}`)
        : row(2, 'talks through the Worker', 'FAIL', `calls Voiceflow directly${p.vfKey ? ' — the key is readable in page source' : ''}`, `npm run author -- page --code ${coach.code}, then rotate the key (plans/21 §A order)`));
    rows.push(p.showActivation === true
      ? row(2, 'showActivation: true', 'DONE')
      : row(2, 'showActivation: true', 'FAIL', `is ${p.showActivation === null ? 'absent' : p.showActivation} — buyers get no route to SMS or voice`, `npm run author -- page --code ${coach.code}`));
    const want = coach.displayName || coach.name;
    if (p.authorName && p.authorName !== want) rows.push(row(2, 'author name', 'FAIL', `page says "${p.authorName}", record says "${want}"`));
    rows.push(...foreignRows(2, r.text, foreign));
  });

  // 3 — Shopify --------------------------------------------------------------
  await safe(3, 'Shopify bundle', async () => {
    if (!coach.shopifyProductId) return rows.push(row(3, 'bundle product', 'TODO', 'no shopifyProductId', `create it, then: npm run author -- set --code ${coach.code} --shopifyProductId <id>`));
    const cat = await ctx.catalog();
    const prod = cat.get(String(coach.shopifyProductId));
    if (!prod) return rows.push(row(3, 'bundle product', 'FAIL', `${coach.shopifyProductId} is not in the public catalogue — unpublished, draft, or a wrong id`));
    rows.push(row(3, 'bundle product', 'DONE', `${prod.title}`));
    const wantTitle = `${coach.bookTitle} [${coach.displayName || coach.name}] + Your Personal AI Coach`;
    if (prod.title !== wantTitle) rows.push(row(3, 'title convention', 'FAIL', `"${prod.title}"`, `expected "${wantTitle}" (plans/20 §7b-bis)`));
    const v = prod.variants || [];
    if (v.length !== 1) rows.push(row(3, 'one variant', 'FAIL', `${v.length} variants — the cart link needs exactly one`));
    const variant = v.find((x) => String(x.id) === String(coach.shopifyVariantId)) || v[0];
    if (variant) {
      if (!coach.shopifyVariantId) rows.push(row(3, 'variant recorded', 'TODO', `variant is ${variant.id}`, `npm run author -- set --code ${coach.code} --shopifyVariantId ${variant.id}`));
      else if (String(variant.id) !== String(coach.shopifyVariantId)) rows.push(row(3, 'variant recorded', 'FAIL', `record says ${coach.shopifyVariantId}, product has ${v.map((x) => x.id).join(', ')}`));
      rows.push(row(3, 'available, ships', variant.available && variant.requires_shipping ? 'DONE' : 'FAIL',
        // Price is not shown: the public catalogue converts it to the visitor's
        // local currency (Shopify Markets), so it reads as PKR from here.
        `available ${variant.available}, requires_shipping ${variant.requires_shipping}`));
      // SKU and weight are deliberately NOT checked: delivery goes through
      // IngramSpark, updated by hand, not Shopify shipping (decided 2026-09-29).
    }
  });

  // 4 — Course360 ------------------------------------------------------------
  await safe(4, 'Course360 lesson', async () => {
    if (!coach.courseLessonUrl) return rows.push(row(4, 'lesson URL', 'TODO', 'no courseLessonUrl', `npm run author -- set --code ${coach.code} --courseLessonUrl <member url>`));
    const r = await ctx.fetchText(coach.courseLessonUrl);
    rows.push(row(4, 'lesson URL', r.status === 200 ? 'DONE' : 'FAIL', `${r.status} ${coach.courseLessonUrl}`));
    rows.push(row(4, 'Offer is Free and unlisted', 'MANUAL', 'no Course360 API for offers'));
  });

  // 5 — GHL tag --------------------------------------------------------------
  await safe(5, 'GHL tag', async () => {
    if (!coach.ghlTag) return rows.push(row(5, 'coach tag', 'TODO', 'no ghlTag', 'npm run onboard creates it'));
    const data = await ctx.ghl('/contacts/search', {
      method: 'POST',
      body: { locationId: ctx.locationId, pageLimit: 100, filters: [{ field: 'tags', operator: 'contains', value: [coach.ghlTag] }] },
    });
    const holders = Array.isArray(data.contacts) ? data.contacts : [];
    rows.push(row(5, 'coach tag', 'DONE', `${coach.ghlTag} — held by ${holders.length}${holders.length === 100 ? '+' : ''} contact(s)`));
    ctx._holders = holders;
  });

  // 6 — grant workflow ---------------------------------------------------------
  // GHL's workflow list gives name + status, not the trigger. So: find it by the
  // naming convention (either spelling of the author), require PUBLISHED — the
  // failure that bit Freddy's onboarding — and leave the trigger to a human.
  await safe(6, 'grant workflow', async () => {
    let list;
    try {
      if (!ctx._workflows) ctx._workflows = (await ctx.ghl(`/workflows/?locationId=${encodeURIComponent(ctx.locationId)}`)).workflows || [];
      list = ctx._workflows;
    } catch (err) {
      if (!/401/.test(err.message)) throw err;
      return rows.push(row(6, 'grant workflow published', 'MANUAL', '', 'the GHL token has no workflows.readonly scope'));
    }
    const names = [coach.displayName, coach.name].filter(Boolean).map((n) => n.toLowerCase());
    const hits = list.filter((w) => /^book coach\s*[—-]+\s*grant course\s*\(/i.test(w.name || '') && names.some((n) => w.name.toLowerCase().includes(`(${n})`)));
    const want = `Book Coach — Grant Course (${coach.displayName || coach.name})`;
    if (!hits.length) return rows.push(row(6, 'grant workflow published', 'TODO', `no workflow named "${want}"`, `create it: Contact Tag added = ${coach.ghlTag} -> Grant Course360 offer -> PUBLISH`));
    const live = hits.filter((w) => w.status === 'published');
    rows.push(live.length
      ? row(6, 'grant workflow published', 'DONE', live.map((w) => w.name).join(', '))
      : row(6, 'grant workflow published', 'FAIL', `"${hits[0].name}" is ${hits[0].status}`, 'publish it BEFORE the first order — the tag trigger only applies to tags added after publishing'));
    if (hits.length > 1) rows.push(row(6, 'exactly one grant workflow', 'FAIL', hits.map((w) => `${w.name} [${w.status}]`).join(', '), 'two would grant the course twice, or race'));
    rows.push(row(6, 'triggers on this coach\'s tag', 'MANUAL', coach.ghlTag || '', 'the API does not expose a workflow\'s trigger — confirm once in the builder'));
  });

  // 7 — GHL product + price --------------------------------------------------
  await safe(7, 'GHL product', async () => {
    if (!coach.ghlProductId) return rows.push(row(7, '$59 product', 'TODO', 'no ghlProductId', 'npm run onboard creates it'));
    const prod = await ctx.ghl(`/products/${encodeURIComponent(coach.ghlProductId)}?locationId=${encodeURIComponent(ctx.locationId)}`);
    const names = ghlNames(coach.displayName || coach.name);
    rows.push(row(7, '$59 product', prod && prod._id ? 'DONE' : 'FAIL', prod && prod.name ? prod.name : `${coach.ghlProductId} not found`));
    if (prod && prod._id && (prod.productType !== 'SERVICE' || prod.availableInStore)) {
      rows.push(row(7, 'hidden SERVICE', 'FAIL', `${prod.productType}, availableInStore ${prod.availableInStore}`));
    }
    if (prod && prod.name && prod.name !== names.product) rows.push(row(7, 'name convention', 'FAIL', `"${prod.name}"`, `expected "${names.product}" — harmless (everything binds on id), but align it`));
    const prices = (await ctx.ghl(`/products/${encodeURIComponent(coach.ghlProductId)}/price?locationId=${encodeURIComponent(ctx.locationId)}`)).prices || [];
    const monthly = prices.filter((x) => !x.deleted && x.type === 'recurring' && Number(x.amount) === 59 && x.recurring && x.recurring.interval === 'month');
    rows.push(row(7, '$59 monthly price', monthly.length === 1 ? 'DONE' : 'FAIL', monthly.map((x) => x._id).join(', ') || 'none',
      monthly.length > 1 ? 'more than one — the funnel can point at either' : ''));
    if (monthly.length === 1 && !coach.ghlPriceId) rows.push(row(7, 'price recorded', 'TODO', monthly[0]._id, `npm run author -- set --code ${coach.code} --ghlPriceId ${monthly[0]._id}`));
    ctx._priceId = coach.ghlPriceId || (monthly[0] && monthly[0]._id);
  });

  // 8 — funnel page ------------------------------------------------------------
  await safe(8, 'funnel page', async () => {
    if (!coach.landingPageUrl) return rows.push(row(8, 'funnel page', 'TODO', 'no landingPageUrl'));
    const r = await ctx.fetchText(coach.landingPageUrl);
    if (r.status !== 200) return rows.push(row(8, 'funnel page', 'TODO', `${coach.landingPageUrl} -> ${r.status}`, 'the day-7/9/10 emails link here: it must exist before a trial reaches day 7'));
    rows.push(row(8, 'funnel page', 'DONE', coach.landingPageUrl));
    // 🚨 A cloned funnel still sells the SOURCE author's product (runbook §8).
    rows.push(coach.ghlProductId && r.text.includes(coach.ghlProductId)
      ? row(8, 'sells THIS author\'s product', 'DONE', coach.ghlProductId)
      : row(8, 'sells THIS author\'s product', 'FAIL', `${coach.ghlProductId || '(no ghlProductId)'} not in the page`, 'repoint the order form — until then a buyer pays and gets another coach'));
    if (ctx._priceId) rows.push(row(8, '...at the $59 price', r.text.includes(ctx._priceId) ? 'DONE' : 'FAIL', ctx._priceId));
    rows.push(...foreignRows(8, r.text, foreign));
  });

  // 9 — Zipify ---------------------------------------------------------------
  await safe(9, 'Zipify page', async () => {
    if (!coach.bookLandingUrl) return rows.push(row(9, 'landing page', 'TODO', 'no bookLandingUrl', `npm run author -- zipify --code ${coach.code}, then set --bookLandingUrl`));
    const r = await ctx.fetchText(coach.bookLandingUrl);
    if (r.status !== 200) return rows.push(row(9, 'landing page', 'FAIL', `${coach.bookLandingUrl} -> ${r.status}`));
    rows.push(row(9, 'landing page', 'DONE', coach.bookLandingUrl));
    const cart = coach.shopifyVariantId && `/cart/${coach.shopifyVariantId}:1`;
    rows.push(cart && r.text.includes(cart)
      ? row(9, 'Add to Cart is the plain cart link', 'DONE', cart)
      : row(9, 'Add to Cart is the plain cart link', 'FAIL', cart ? `${cart} not in the page` : 'no shopifyVariantId recorded', 'runbook §9c: Zipify\'s Product button shows "No variants" for new products'));
    rows.push(...foreignRows(9, r.text, foreign));
    if (/\{\{[A-Z_]+\}\}/.test(r.text)) rows.push(row(9, 'no template placeholders', 'FAIL', (r.text.match(/\{\{[A-Z_]+\}\}/g) || []).slice(0, 5).join(' ')));
  });

  // 10 — registry live ---------------------------------------------------------
  await safe(10, 'registry', async () => {
    const h = await ctx.health();
    const live = (h.coaches || []).find((c) => c.code === coach.code);
    if (!live) return rows.push(row(10, 'pushed to KV', 'TODO', 'not in /health', 'npm run push'));
    rows.push(row(10, 'pushed to KV', 'DONE'));
    rows.push(row(10, 'Worker holds the key', live.keyResolved ? 'DONE' : 'FAIL', live.keyVar, live.keyResolved ? '' : 'npm run secrets'));
    if (deep) {
      const kv = await ctx.kvGet(`coach:${coach.code}`);
      const want = registryValue(coach);
      const drift = Object.keys({ ...want, ...(kv || {}) }).filter((k) => JSON.stringify(want[k]) !== JSON.stringify((kv || {})[k]));
      rows.push(row(10, 'KV matches coaches.json', drift.length ? 'FAIL' : 'DONE', drift.length ? `differs: ${drift.join(', ')}` : '', drift.length ? 'npm run push' : ''));
    }
  });

  // 11 — tested --------------------------------------------------------------
  const last = ctx.lastVerify && ctx.lastVerify(coach.code);
  rows.push(last
    ? row(11, 'verify-author', last.passed ? 'DONE' : 'FAIL', `${last.passed ? 'passed' : 'FAILED'} ${last.at}`)
    : row(11, 'verify-author', 'TODO', 'never run', `npm run verify-author -- --code ${coach.code} --email <you> --write`));
  rows.push(row(11, '$0 real order', 'MANUAL', 'Flow + Zipify can only be proven by a real order', 'runbook step 11'));

  // 12 — clean -----------------------------------------------------------------
  if (ctx._holders) {
    const tests = ctx._holders.filter((c) => /\+verify-/.test(String(c.email || '')));
    rows.push(row(12, 'no test contacts left entitled', tests.length ? 'FAIL' : 'DONE', tests.map((c) => c.id).join(', '),
      tests.length ? 'a leftover verify-author contact holds the tag and is granted a lease every cron' : ''));
  }

  return rows;
}

/** One status per step, worst row wins. For the all-authors table. */
export function stepSummary(rows) {
  const rank = { FAIL: 4, TODO: 3, WARN: 2, MANUAL: 1, DONE: 0 };
  const out = {};
  for (const [n] of STEPS) {
    const mine = rows.filter((r) => r.step === n);
    out[n] = mine.length ? mine.reduce((a, r) => (rank[r.status] > rank[a] ? r.status : a), 'DONE') : 'TODO';
  }
  return out;
}

/* -------------------------------------------------------------- generators --- */

const q = (v) => JSON.stringify(String(v ?? ''));

/**
 * The coach page's CONFIG block, for a page that talks through the Worker.
 *
 * Pasted over the CONFIG block of a clone of /freddy-davis. It is generated so
 * that showActivation cannot be forgotten and authorURL cannot be inherited —
 * the two defects found on live pages. There is no key in it, by design.
 */
export function coachPageConfig(coach, { workerUrl }) {
  const name = coach.displayName || coach.name;
  const label = coach.coachLabel || coach.bookTitle;
  const books = Array.isArray(coach.books) ? coach.books : [];
  return [
    '   const CONFIG = {',
    `    authorName: ${q(name)},`,
    `    bookTitle: ${q(label)},`,
    `    authorPhotoURL: ${q(coach.authorPhotoURL || '')},`,
    `    authorInitials: ${q(coach.authorInitials || initialsOf(name))},`,
    `    pageTitle: ${q(`${name} - ${label}`)},`,
    '',
    `    authorURL: ${q(coach.authorURL || '')},`,
    '',
    '    showActivation: true,',
    `    showBooks: ${books.length > 0},`,
    '    showCourses: false,',
    '',
    'books: [',
    ...books.map((b) => `  { title: ${q(b.title)}, url: ${q(b.url)} },`),
    '],',
    'courses: [',
    '],',
    `    // Generated by \`npm run author -- page --code ${coach.code}\` from coaches.json.`,
    '    // ---- How this page reaches the coach ----------------------------------',
    '    //   "auto"   (recommended) - the coach router (Worker) first. If the Worker',
    '    //            cannot be reached - network error, timeout, or a 5xx - fall',
    '    //            back to Voiceflow directly with VF_API_KEY + VF_VERSION_ID.',
    '    //   "worker" - the coach router only. No fallback.',
    '    //   "direct" - Voiceflow only, with VF_API_KEY + VF_VERSION_ID.',
    '    CONNECTION: "auto",',
    '',
    '    // Coach router: the Worker holds the Voiceflow key as a secret and decides',
    "    // whose conversation it is. COACH_CODE is this coach's code in coaches.json.",
    `    COACH_CODE: ${q(coach.code)},`,
    `    WORKER_URL: ${q(workerUrl)},`,
    '',
    '    // Voiceflow direct: used by "direct", and by "auto" as the fallback.',
    '    // Paste the PERSONAL key after "Bearer " in the GHL editor only - never in',
    "    // a file that is committed. It is readable in this page's source.",
    '    VF_API_KEY: "Bearer ",',
    `    VF_VERSION_ID: ${q(pageVersionId(coach))}`,
    '  };',
  ].join('\n');
}

/**
 * The version ID the page's direct fallback uses. The personal-key format needs
 * the 24-character id, so an alias (`main`) is replaced by the project's DRAFT
 * id — project id + 1, the rule every live page follows (plans/20 §7a).
 */
export function pageVersionId(coach) {
  if (/^[0-9a-f]{24}$/i.test(coach.versionID || '')) return coach.versionID;
  if (!/^[0-9a-f]{24}$/i.test(coach.projectID || '')) return '';
  return (BigInt(`0x${coach.projectID}`) + 1n).toString(16).padStart(24, '0');
}

/** What the generated page is still missing — printed beside it. */
export function coachPageGaps(coach) {
  const g = [];
  if (!coach.authorPhotoURL) g.push('authorPhotoURL (the page falls back to initials)');
  if (!coach.authorURL) g.push('authorURL (the author link is hidden)');
  if (!Array.isArray(coach.books) || !coach.books.length) g.push('books (no "Buy the Book" button)');
  if (!coach.coachLabel) g.push(`coachLabel (using the book title "${coach.bookTitle}")`);
  if (!/^[0-9a-f]{24}$/i.test(coach.versionID || '')) {
    g.push(`VF_VERSION_ID: the registry has "${coach.versionID}", an alias — the fallback uses the draft id ${pageVersionId(coach) || '(unknown: no projectID)'}. Check it is the version you want`);
  }
  g.push('VF_API_KEY: paste the personal key after "Bearer " in the GHL editor (only needed for the fallback)');
  return g;
}

/**
 * The Zipify clone as an ordered find-and-replace list, from the SOURCE
 * author's record to this one. Order is the runbook's (§9a), because it
 * matters: the ™ form before the plain title, possessives before names.
 */
export function zipifyReplacements(from, to) {
  const pairs = [];
  const add = (a, b, why = '') => {
    if (a && b && String(a) !== String(b) && !pairs.some((p) => p.find === String(a))) pairs.push({ find: String(a), replace: String(b), why });
  };
  const fn = (c) => String(c.displayName || c.name || '').split(/\s+/)[0];
  add(`${from.bookTitle}™`, `${to.bookTitle}™`, 'the ™ form first, or the plain replace mangles it');
  add(from.bookTitle, to.bookTitle);
  add(from.displayName || from.name, to.displayName || to.name);
  if (from.name && from.name !== from.displayName) add(from.name, to.name, 'internal spelling');
  add(`${fn(from)}'s`, `${fn(to)}'s`, 'possessives are missed by a plain replace');
  add(`${fn(from)}’s`, `${fn(to)}’s`, 'curly-apostrophe possessive');
  add(fn(from), fn(to), 'first name alone — review each hit');
  add(from.shopifyProductId, to.shopifyProductId, 'product id');
  add(from.shopifyVariantId, to.shopifyVariantId, 'variant id');
  add(from.landingPageUrl, to.landingPageUrl, 'the $59 funnel link');
  return pairs;
}
