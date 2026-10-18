/**
 * lib-author.mjs — the author record: what each checklist step looks like LIVE.
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
import { ghlNames, slugConventions, parseCoachPage, withAuthor, youtubeId } from './lib-onboard.mjs';
import { STEPS, STEP as S, PIPELINE_STEPS } from './steps.mjs';
import { courseIdFrom, courseIdFromUrl, COURSE_ID_RE, COURSES_VERSION, DEFAULT_COURSE_MASTER, courseShape, shapeDiff, coachLesson, iframeIsFor, iframeSlug, sameTitle, courseTitle, listAll, posterShows } from './lib-course360.mjs';

// The step numbers are the working checklist's (further-automation-v1.md, 0-16),
// defined once in steps.mjs. Rows name their step by key (S.coachPage), never by
// number, so a reorder of steps.mjs moves every row with it.
export { STEPS };

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
  // The optional Course Collection product (step Course Collection + Bundle Image). Local only:
  // never in KV_FIELDS, so an order for it is matched to no coach (plan 02 is what would change that).
  collectionProductId: 'the Course Collection product id (digits)',
  collectionVariantId: 'the Course Collection variant id (digits) — its cart link',
  bookLandingUrl: 'https:// the Zipify landing page on leadershipbooks.com',
  courseLessonUrl: 'https:// the Course360 MEMBER lesson URL',
  // Step Course360 through the Courses API (author course360). Local only, never in KV_FIELDS.
  courseId: 'the Course360 course id (a uuid, or its link)',
  courseOfferId: 'the Course360 Offer id (a uuid)',
  ghlPriceId: 'the $59 price id (24 hex)',
  trialDays: 'whole days, 1-90',
  aliases: 'comma-separated names a caller might say',
  bookTitle: 'the book\'s real title',
  versionID: 'the Voiceflow version ID, 24 hex characters (the personal key rejects aliases like main)',
  displayName: 'the customer-facing spelling',
  videoUrl: 'the book\'s YouTube video for the Zipify sales page — any YouTube link',
};

/** Validate one `author set` value. Returns [value, problem]. */
export function parseRecordValue(field, raw) {
  const s = Array.isArray(raw) ? raw : String(raw ?? '').trim();
  const https = (v) => (/^https:\/\/\S+$/.test(v) ? [v, null] : [null, `${field} must be an https:// URL`]);
  switch (field) {
    case 'slug':
      return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s) ? [s, null] : [null, 'slug must be lowercase words joined by hyphens'];
    case 'shopifyProductId':
    case 'shopifyVariantId':
    case 'collectionProductId':
    case 'collectionVariantId': {
      const gid = /^gid:\/\/shopify\/\w+\/(\d+)$/.exec(s);
      const v = gid ? gid[1] : s;
      return /^\d+$/.test(v) ? [v, null] : [null, `${field} must be digits`];
    }
    case 'versionID':
      return /^[0-9a-f]{24}$/i.test(s) ? [s.toLowerCase(), null] : [null, 'versionID must be the 24-character Voiceflow version ID — an alias like main is rejected by the personal key'];
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
    case 'courseId':
    case 'courseOfferId': {
      const id = field === 'courseId' ? courseIdFrom(s) : (COURSE_ID_RE.test(s) ? s.toLowerCase() : '');
      return id ? [id, null] : [null, `${field} must be a Course360 id (8-4-4-4-12 hex)`];
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
    case 'videoUrl': {
      // Any YouTube link is accepted and kept in one plain form.
      const id = youtubeId(s);
      return id ? [`https://www.youtube.com/watch?v=${id}`, null] : [null, 'videoUrl must be a YouTube link (youtube.com/watch?v=…, youtu.be/…, /shorts/…)'];
    }
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

/**
 * Every Add to Cart on a sales page that is NOT this author's bundle, once each:
 * Shopify cart links (/cart/<variant>:<qty>, several joined by commas) and
 * /cart/add?id=<variant>. Each says whose bundle it is, or that it is unknown —
 * and this author's own bundle at a quantity other than 1 counts too.
 */
export function wrongCartLinks(html, coach, all = []) {
  const ours = String(coach.shopifyVariantId || '');
  // This author's course collection (the optional step) may have its own button on the page.
  const ownCollection = [coach.collectionVariantId, coach.collectionProductId].filter(Boolean).map(String);
  const seen = new Map();
  const whose = (variant) => {
    const o = all.find((x) => String(x.shopifyVariantId || '') === variant);
    const oc = all.find((x) => String(x.collectionVariantId || '') === variant || String(x.collectionProductId || '') === variant);
    return o ? `${o.displayName || o.name}'s bundle` : oc ? `${oc.displayName || oc.name}'s course collection` : 'not a Book Coach bundle';
  };
  for (const m of String(html || '').matchAll(/\/cart\/(\d+:\d+(?:,\d+:\d+)*)/g)) {
    for (const part of m[1].split(',')) {
      const [variant, qty] = part.split(':');
      const link = `/cart/${variant}:${qty}`;
      if ((variant === ours || ownCollection.includes(variant)) && qty === '1') continue;
      if (!seen.has(link)) seen.set(link, { link, variant, what: variant === ours ? `adds ${qty}, not 1` : whose(variant) });
    }
  }
  for (const m of String(html || '').matchAll(/\/cart\/add[^"'\s<>]*?[?&](?:amp;)?id=(\d+)/g)) {
    const link = `/cart/add?id=${m[1]}`;
    if (m[1] !== ours && !seen.has(link)) seen.set(link, { link, variant: m[1], what: whose(m[1]) });
  }
  // Zipify's own product blocks ("Product"): a form bound to a Shopify product and variant. A
  // cloned page keeps the source author's (found on three live pages, 2026-10-06). It only adds
  // to the cart if it has its own buy button: `live`. Without one — the house style, a plain
  // link button inside it — it cannot send a buyer anywhere; it only feeds Zipify's product data.
  const ourProduct = String(coach.shopifyProductId || '');
  for (const m of String(html || '').matchAll(/<form\b[^>]*data-zp-add-to-cart-form[^>]*>([\s\S]*?)<\/form>/g)) {
    const product = (/data-productid="(\d+)"/.exec(m[0]) || [])[1] || '';
    const variant = (/name="id"[\s\S]*?value="(\d+)"/.exec(m[1]) || [])[1] || '';
    if (variant ? variant === ours || ownCollection.includes(variant) : product === ourProduct || ownCollection.includes(product)) continue;
    const owner = all.find((x) => (variant && String(x.shopifyVariantId || '') === variant) || (product && String(x.shopifyProductId || '') === product));
    const ownerC = !owner && all.find((x) => (variant && String(x.collectionVariantId || '') === variant) || (product && String(x.collectionProductId || '') === product));
    const link = `Zipify product block (${variant ? `variant ${variant}` : `product ${product}`})`;
    // A <button> with no type, or type="submit", submits the form; type="button" (the +/- quantity) does not.
    const live = /<button\b(?![^>]*\btype="button")[^>]*>|<input\b[^>]*\btype="submit"/i.test(m[1]);
    if (!seen.has(link)) seen.set(link, { link, variant: variant || product, product, live, what: owner ? `${owner.displayName || owner.name}'s bundle` : ownerC ? `${ownerC.displayName || ownerC.name}'s course collection` : 'not a Book Coach bundle' });
  }
  return [...seen.values()];
}

/**
 * Zipify "Product" blocks on a sales page bound to THIS author's bundle: [{ variant, product, live }].
 * `live`: it has its own buy button (ADD TO CART / BUY NOW), so a buyer can press it.
 */
export function ourProductButtons(html, coach) {
  const v = String(coach.shopifyVariantId || '');
  const p = String(coach.shopifyProductId || '');
  const out = [];
  for (const m of String(html || '').matchAll(/<form\b[^>]*data-zp-add-to-cart-form[^>]*>([\s\S]*?)<\/form>/g)) {
    const product = (/data-productid="(\d+)"/.exec(m[0]) || [])[1] || '';
    const variant = (/name="id"[\s\S]*?value="(\d+)"/.exec(m[1]) || [])[1] || '';
    if (!(variant ? variant === v : product && product === p)) continue;
    out.push({ variant, product, live: /<button\b(?![^>]*\btype="button")[^>]*>|<input\b[^>]*\btype="submit"/i.test(m[1]) });
  }
  return out;
}

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
      step === S.funnel /* the $59 funnel page */ ? 'Funnel Settings -> SEO & AEO: the JSON-LD description is inherited from the clone source' : 'in a script or meta tag — reaches search snippets, not readers'));
  }
  return out;
}

/* ---------------------------------------------------------------- Course360 --- */

/**
 * Step Course360, read live through HighLevel's Courses API (Version v3): the course,
 * its title, the coach lesson's iframe, its likeness to the master course, and the
 * Offer that gives it. Without the courses.readonly scope: one MANUAL row.
 * Plan: BookCoach Author Dashboard/plans/03-course360-by-api.md.
 */
async function courseRows(coach, ctx, slug) {
  const out = [];
  const get = (p) => ctx.ghl(`${p}${p.includes('?') ? '&' : '?'}locationId=${encodeURIComponent(ctx.locationId)}`, { version: COURSES_VERSION });
  const id = coach.courseId || courseIdFromUrl(coach.courseLessonUrl);
  const fix = `Onboard → step ${S.course360} → Preview, then Make the course (or npm run author -- course360 --code ${coach.code})`;
  if (!id) return [row(S.course360, 'course made', 'TODO', 'no course saved for this author yet', `GHL → Duplicate the master course, then ${fix}`)];
  let course;
  try {
    course = await get(`/courses/products/${encodeURIComponent(id)}`);
  } catch (err) {
    if (/^GHL 401 /.test(err.message)) return [row(S.course360, 'course readable', 'MANUAL', '', 'the GHL token has no courses.readonly scope')];
    if (/^GHL 404 /.test(err.message)) return [row(S.course360, 'course exists', 'FAIL', `the saved course ${id} is not in Course360 (deleted?)`, `Duplicate the master course again, then ${fix}`)];
    throw err;
  }
  out.push(row(S.course360, 'course exists', 'DONE', course.title));
  const want = courseTitle(coach);
  if (!sameTitle(course.title, want)) out.push(row(S.course360, 'course title', 'WARN', `"${course.title}" — expected "${want}"`, fix));
  // GHL shows a course picture only from its own course storage (posterShows) — set on the course's screen.
  const picFix = 'GHL → Memberships → Courses → this course → ⋮ → Edit → upload its image there';
  out.push(!course.posterImage
    ? row(S.course360, 'course picture shows in GHL', 'WARN', 'no picture yet — the course shows GHL\'s default', picFix)
    : posterShows(course.posterImage)
      ? row(S.course360, 'course picture shows in GHL', 'DONE', 'uploaded on the course\'s own screen')
      : row(S.course360, 'course picture shows in GHL', 'FAIL', `its picture is stored where GHL's course page cannot show it (${new URL(course.posterImage, 'https://x').host}) — it shows as a broken picture`, picFix));

  const shapeOf = async (cid) => {
    const [cat, les] = await Promise.all([get(`/courses/products/${encodeURIComponent(cid)}/categories`), get(`/courses/products/${encodeURIComponent(cid)}/lessons`)]);
    return courseShape(cat.categories || [], les.lessons || []);
  };
  const shape = await shapeOf(id);
  const lesson = coachLesson(shape);
  const has = lesson ? iframeSlug(lesson.description) : '';
  out.push(!lesson
    ? row(S.course360, 'coach lesson opens this author\'s coach', 'FAIL', 'no "BookCoach AI" lesson', 'copy it from the master course in GHL')
    : iframeIsFor(lesson.description, slug)
      ? row(S.course360, 'coach lesson opens this author\'s coach', 'DONE', `book-coach.ai/${slug}`)
      : row(S.course360, 'coach lesson opens this author\'s coach', 'FAIL', has ? `it opens book-coach.ai/${has}${has === slug ? ' with another link shape' : ' — another coach'}` : 'its text has no book-coach.ai iframe', fix));
  if (id !== DEFAULT_COURSE_MASTER) {
    const diff = shapeDiff(shape, await shapeOf(DEFAULT_COURSE_MASTER));
    out.push(diff.length
      ? row(S.course360, 'course matches the master', 'WARN', diff.join('; '), 'the modules or intro lessons differ from the master course — check them in GHL')
      : row(S.course360, 'course matches the master', 'DONE', `${shape.length} modules, ${shape.reduce((n, m) => n + m.lessons.length, 0)} lessons`));
  }

  const offers = await listAll(get, 'offers');
  const gives = offers.filter((o) => (o.products || []).some((p) => p.id === id));
  const mine = coach.courseOfferId ? offers.find((o) => o.id === coach.courseOfferId) : (gives.find((o) => sameTitle(o.title, want)) || gives[0]);
  if (!mine) {
    out.push(row(S.course360, 'Offer is Free, Published and gives this course', 'FAIL', coach.courseOfferId ? `the saved Offer ${coach.courseOfferId} is not in Course360` : 'no Offer gives this course — a reader granted it would get nothing', fix));
    return out;
  }
  const wrong = [
    !gives.includes(mine) && 'gives another course or none',
    mine.type !== 'free' && `is ${mine.type}, not Free`,
    mine.visibility !== 'published' && `is ${mine.visibility} — the grant workflow cannot pick it`,
  ].filter(Boolean);
  out.push(row(S.course360, 'Offer is Free, Published and gives this course', wrong.length ? 'FAIL' : 'DONE', `"${mine.title}"${wrong.length ? ` ${wrong.join('; ')}` : ''}`, wrong.length ? fix : ''));
  return out;
}

/* ------------------------------------------------------------------ checks --- */

const row = (step, check, status, detail = '', fix = '') => ({ step, check, status, detail, fix });

/**
 * Every row for one author, in checklist order (steps.mjs, 0-16). Never throws:
 * a failed read is a FAIL row naming what could not be read, so one outage
 * cannot hide the rest. Every step gets at least one row, so no step can read
 * as finished just because nothing looked at it.
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
  const set = (flags) => `npm run author -- set --code ${coach.code} ${flags}`;

  // Inputs -----------------------------------------------------------------
  {
    const missing = [
      !(coach.displayName || coach.name) && 'author name',
      !coach.bookTitle && 'bookTitle',
      !coach.coachLabel && 'coachLabel',
      !slug && 'slug',
    ].filter(Boolean);
    // Complete when the four are saved — or, if one is missing, when (1) the dashboard's "where you stand"
    // checklist is fully ticked (ctx.inputsTicked), or (2) Muhammad signed Inputs off (ctx.inputsSigned).
    // Decided 2026-10-13. Either way the gap is still named, as a note.
    const fix = set(missing.map((m) => `--${m === 'author name' ? 'displayName' : m} "…"`).join(' '));
    if (!missing.length) {
      rows.push(row(S.inputs, 'name, book, coach label and slug recorded', 'DONE', `${coach.displayName || coach.name} — ${coach.bookTitle} — ${coach.coachLabel} — /${slug}`));
    } else if (ctx.inputsTicked || ctx.inputsSigned) {
      rows.push(row(S.inputs, 'name, book, coach label and slug recorded', 'WARN',
        `missing: ${missing.join(', ')} — counted as complete because ${ctx.inputsTicked ? 'every item of "where you stand" is ticked' : 'you signed Inputs off'}`, fix));
    } else {
      rows.push(row(S.inputs, 'name, book, coach label and slug recorded', 'TODO', `missing: ${missing.join(', ')}`, fix));
    }
    // The person's way out: sign it off. Only offered while something is missing (nothing to confirm otherwise).
    if (missing.length) rows.push(row(S.inputs, 'inputs confirmed', ctx.inputsTicked ? 'DONE' : 'MANUAL',
      ctx.inputsTicked ? 'every item of "where you stand" is ticked' : 'something above is not saved — if the author does not need it, confirm that here',
      'press Sign off (or tick every item of "where you stand")'));
  }

  // Voiceflow coach + IDs — one step since 2026-10-12: the IDs exist once the coach
  // does, so they are the proof. No sign-off ("the coach is built") any more.
  const vfOk = /^[0-9a-f]{24}$/i.test(coach.projectID || '') && !!coach.versionID && !!coach.apiKey;
  rows.push(row(S.voiceflow, 'project, version and key recorded', vfOk ? 'DONE' : 'TODO',
    vfOk ? `${coach.projectID} @ ${coach.versionID}` : 'missing projectID, versionID or vfKey',
    vfOk ? `npm run verify:vf -- --code ${coach.code} proves they answer` : 'npm run onboard fills these'));
  if (coach.versionID && !/^[0-9a-f]{24}$/i.test(coach.versionID)) {
    rows.push(row(S.voiceflow, 'versionID is the 24-character id', 'FAIL', `"${coach.versionID}" is an alias — the personal key rejects it and npm run push refuses it`,
      set('--versionID <24-char id from the address bar, Main selected>')));
  }

  // GHL + registry — tag + $59 product and price (npm run onboard) ---------------------------
  await safe(S.ghl, 'GHL tag', async () => {
    if (!coach.ghlTag) return rows.push(row(S.ghl, 'coach tag', 'TODO', 'no ghlTag', 'npm run onboard creates it'));
    const data = await ctx.ghl('/contacts/search', {
      method: 'POST',
      body: { locationId: ctx.locationId, pageLimit: 100, filters: [{ field: 'tags', operator: 'contains', value: [coach.ghlTag] }] },
    });
    const holders = Array.isArray(data.contacts) ? data.contacts : [];
    rows.push(row(S.ghl, 'coach tag', 'DONE', `${coach.ghlTag} — held by ${holders.length}${holders.length === 100 ? '+' : ''} contact(s)`));
    ctx._holders = holders;
  });
  await safe(S.ghl, 'GHL product', async () => {
    if (!coach.ghlProductId) return rows.push(row(S.ghl, '$59 product', 'TODO', 'no ghlProductId', 'npm run onboard creates it'));
    const prod = await ctx.ghl(`/products/${encodeURIComponent(coach.ghlProductId)}?locationId=${encodeURIComponent(ctx.locationId)}`);
    const names = ghlNames(coach.displayName || coach.name);
    rows.push(row(S.ghl, '$59 product', prod && prod._id ? 'DONE' : 'FAIL', prod && prod.name ? prod.name : `${coach.ghlProductId} not found`));
    if (prod && prod._id && (prod.productType !== 'SERVICE' || prod.availableInStore)) {
      rows.push(row(S.ghl, 'hidden SERVICE', 'FAIL', `${prod.productType}, availableInStore ${prod.availableInStore}`));
    }
    if (prod && prod.name && prod.name !== names.product) rows.push(row(S.ghl, 'name convention', 'WARN', `"${prod.name}"`, `expected "${names.product}" — harmless (everything binds on id), but align it`));
    const prices = (await ctx.ghl(`/products/${encodeURIComponent(coach.ghlProductId)}/price?locationId=${encodeURIComponent(ctx.locationId)}`)).prices || [];
    const monthly = prices.filter((x) => !x.deleted && x.type === 'recurring' && Number(x.amount) === 59 && x.recurring && x.recurring.interval === 'month');
    rows.push(row(S.ghl, '$59 monthly price', monthly.length === 1 ? 'DONE' : 'FAIL', monthly.map((x) => x._id).join(', ') || 'none',
      monthly.length > 1 ? 'more than one — the funnel can point at either' : ''));
    if (monthly.length === 1 && !coach.ghlPriceId) rows.push(row(S.ghl, 'price recorded', 'TODO', monthly[0]._id, set(`--ghlPriceId ${monthly[0]._id}`)));
    ctx._priceId = coach.ghlPriceId || (monthly[0] && monthly[0]._id);
  });

  // Shopify bundle -----------------------------------------------------------
  await safe(S.shopify, 'Shopify bundle', async () => {
    if (!coach.shopifyProductId) return rows.push(row(S.shopify, 'bundle product', 'TODO', 'no shopifyProductId', `npm run author -- shopify --code ${coach.code} --write   (or create it by hand, then: ${set('--shopifyProductId <id>')})`));
    const cat = await ctx.catalog();
    const prod = cat.get(String(coach.shopifyProductId));
    if (!prod) return rows.push(row(S.shopify, 'bundle product', 'FAIL', `${coach.shopifyProductId} is not in the public catalogue — unpublished, draft, or a wrong id`));
    rows.push(row(S.shopify, 'bundle product', 'DONE', `${prod.title}`));
    const wantTitle = `${coach.bookTitle} [${coach.displayName || coach.name}] + Your Personal AI Coach`;
    if (prod.title !== wantTitle) rows.push(row(S.shopify, 'title convention', 'WARN', `"${prod.title}"`, `expected "${wantTitle}" (plans/20 §7b-bis) — cosmetic: everything binds on id`));
    const v = prod.variants || [];
    if (v.length !== 1) rows.push(row(S.shopify, 'one variant', 'FAIL', `${v.length} variants — the cart link needs exactly one`));
    const variant = v.find((x) => String(x.id) === String(coach.shopifyVariantId)) || v[0];
    if (variant) {
      if (!coach.shopifyVariantId) rows.push(row(S.shopify, 'variant recorded', 'TODO', `variant is ${variant.id}`, set(`--shopifyVariantId ${variant.id}`)));
      else if (String(variant.id) !== String(coach.shopifyVariantId)) rows.push(row(S.shopify, 'variant recorded', 'FAIL', `record says ${coach.shopifyVariantId}, product has ${v.map((x) => x.id).join(', ')}`));
      rows.push(row(S.shopify, 'available, ships', variant.available && variant.requires_shipping ? 'DONE' : 'FAIL',
        // Price is not shown: the public catalogue converts it to the visitor's
        // local currency (Shopify Markets), so it reads as PKR from here.
        `available ${variant.available}, requires_shipping ${variant.requires_shipping}`));
      // SKU and weight are deliberately NOT checked: delivery goes through
      // IngramSpark, updated by hand, not Shopify shipping (decided 2026-09-29).
    }
  });

  // Course Collection + Bundle Image — optional. No product: a person either creates it
  // here or signs off that this author has none (a MANUAL row). A product: read live.
  await safe(S.collection, 'collection product', async () => {
    if (!coach.collectionProductId) {
      return rows.push(row(S.collection, 'collection product', 'MANUAL', 'none yet — optional: create it here, or sign off that this author has none',
        `npm run author -- shopify-collection --code ${coach.code} --write`));
    }
    const cat = await ctx.catalog();
    const prod = cat.get(String(coach.collectionProductId));
    if (!prod) return rows.push(row(S.collection, 'collection product', 'FAIL', `${coach.collectionProductId} is not in the public catalogue — unpublished, draft, or a wrong id`));
    rows.push(row(S.collection, 'collection product', 'DONE', prod.title));
    if (!(prod.images || []).length) rows.push(row(S.collection, 'collection image', 'WARN', 'the product has no picture', `npm run author -- shopify-image --code ${coach.code} --product collection --image-url https://…`));
    const v = (prod.variants || [])[0];
    if (v && !coach.collectionVariantId) rows.push(row(S.collection, 'collection variant recorded', 'TODO', `variant is ${v.id}`, set(`--collectionVariantId ${v.id}`)));
  });

  // Coach page — details (what the coach page shows) ------------------------------------
  {
    const has = { photo: !!coach.authorPhotoURL, link: !!coach.authorURL, books: Array.isArray(coach.books) && coach.books.length > 0 };
    if (!has.photo && !has.link && !has.books) {
      rows.push(row(S.coachPage, 'page details recorded', 'TODO', 'no photo, author link or book buttons yet', set('--authorPhotoURL https://… --authorURL https://… --books "Title|https://…"')));
    } else {
      rows.push(has.photo ? row(S.coachPage, 'author photo', 'DONE') : row(S.coachPage, 'author photo', 'WARN', 'none — the page shows initials', set('--authorPhotoURL https://…')));
      rows.push(has.link ? row(S.coachPage, 'author link', 'DONE') : row(S.coachPage, 'author link', 'WARN', 'none — the link is hidden on the page', set('--authorURL https://…   (the author\'s OWN page)')));
      rows.push(has.books ? row(S.coachPage, 'book buttons', 'DONE', `${coach.books.length}`) : row(S.coachPage, 'book buttons', 'WARN', 'none — no "Buy the Book" button', set('--books "Title|https://…"')));
    }
  }

  // Coach page -----------------------------------------------------------------
  await safe(S.coachPage, 'coach page', async () => {
    if (!conv) return rows.push(row(S.coachPage, 'coach page', 'TODO', 'no slug in the record', set('--slug <slug>')));
    const r = await ctx.fetchText(conv.pageUrl);
    if (r.status !== 200) return rows.push(row(S.coachPage, 'page exists', 'TODO', `${conv.pageUrl} -> ${r.status}`, `dashboard Onboard → step ${S.coachPage} (or npm run pipeline -- page --code ${coach.code} --copy), paste into a GHL page's Custom Code element`));
    const p = parseCoachPage(r.text);
    rows.push(row(S.coachPage, 'page exists', 'DONE', conv.pageUrl));
    // A page built from pages/coach-page.html carries no CONFIG values at all:
    // it asks /api/coach-page, and the Worker decides showActivation. The
    // registry is then the only thing to check — and it is checked everywhere else.
    if (r.text.includes('/api/coach-page')) {
      rows.push(row(S.coachPage, 'loads its config from the registry', 'DONE', 'pages/coach-page.html loader — nothing on the page to drift'));
      rows.push(...foreignRows(S.coachPage, r.text, foreign));
      return;
    }
    // Decided 2026-09-29: pages keep their own CONFIG block (the freddy-v2
    // format), generated by `author page`. The loader template is optional.
    // A page made before the renumber (2026-10-02) still carries the coach's OLD
    // code. The Worker finds the coach by it (formerCodes), so it works — a WARN,
    // re-paste when convenient, never a FAIL.
    const formerCode = p.coachCode && (coach.formerCodes || []).map(String).includes(p.coachCode);
    rows.push(p.coachCode === coach.code
      ? row(S.coachPage, 'talks through the Worker', 'DONE', `COACH_CODE ${p.coachCode}`)
      : formerCode
        ? row(S.coachPage, 'page uses the old coach code', 'WARN', `COACH_CODE is ${p.coachCode}, this coach's old code (now ${coach.code}) — it still works`, `npm run pipeline -- page --code ${coach.code} --copy`)
        : p.coachCode
          ? row(S.coachPage, 'talks through the Worker', 'FAIL', `COACH_CODE is ${p.coachCode}, not ${coach.code} — this page is another coach`, `npm run pipeline -- page --code ${coach.code} --copy`)
          : row(S.coachPage, 'talks through the Worker', 'FAIL', `calls Voiceflow directly${p.vfKey ? ' — the key is readable in page source' : ''}`, `npm run pipeline -- page --code ${coach.code} --copy`));
    rows.push(p.showActivation === true
      ? row(S.coachPage, 'showActivation: true', 'DONE')
      : row(S.coachPage, 'showActivation: true', 'FAIL', `is ${p.showActivation === null ? 'absent' : p.showActivation} — buyers get no route to SMS or voice`, `npm run pipeline -- page --code ${coach.code} --copy`));
    const want = coach.displayName || coach.name;
    if (p.authorName && p.authorName !== want) rows.push(row(S.coachPage, 'author name', 'FAIL', `page says "${p.authorName}", record says "${want}"`));
    rows.push(...foreignRows(S.coachPage, r.text, foreign));
  });

  // With the shared My Coaches course on, an author without their own course is
  // served by it: Course360, Lesson URL and Grant workflow check the ONE shared course and workflow.
  const sharedCourse = !coach.courseLessonUrl && ctx.cfg && ctx.cfg.myCoaches === 'on' && ctx.cfg.myCoachesUrl;

  // Course360 + Lesson URL — Course360 course + Offer, and its lesson URL ------------------------------
  if (sharedCourse) {
    await safe(S.course360, 'Course360 lesson', async () => {
      const r = await ctx.fetchText(ctx.cfg.myCoachesUrl);
      rows.push(row(S.course360, 'served by the shared My Coaches course', r.status === 200 ? 'DONE' : 'FAIL', `${r.status} ${ctx.cfg.myCoachesUrl}`,
        r.status === 200 ? '' : 'config.myCoachesUrl does not answer'));
    });
    rows.push(row(S.lessonUrl, 'lesson URL', 'DONE', 'none needed — the shared My Coaches course is linked'));
  } else {
    await safe(S.course360, 'Course360 course', async () => rows.push(...await courseRows(coach, ctx, slug)));
    await safe(S.lessonUrl, 'Course360 lesson', async () => {
      if (!coach.courseLessonUrl) return rows.push(row(S.lessonUrl, 'lesson URL', 'TODO', 'no courseLessonUrl', set('--courseLessonUrl <member url>')));
      const r = await ctx.fetchText(coach.courseLessonUrl);
      rows.push(row(S.lessonUrl, 'lesson URL', r.status === 200 ? 'DONE' : 'FAIL', `${r.status} ${coach.courseLessonUrl}`));
    });
  }

  // Grant workflow -------------------------------------------------------------
  // GHL's workflow list gives name + status, not the trigger. So: find it by the
  // naming convention (either spelling of the author), require PUBLISHED — the
  // failure that bit Freddy's onboarding — and leave the trigger to a human.
  await safe(S.grant, 'grant workflow', async () => {
    let list;
    try {
      if (!ctx._workflows) ctx._workflows = (await ctx.ghl(`/workflows/?locationId=${encodeURIComponent(ctx.locationId)}`)).workflows || [];
      list = ctx._workflows;
    } catch (err) {
      if (!/401/.test(err.message)) throw err;
      return rows.push(row(S.grant, 'grant workflow published', 'MANUAL', '', 'the GHL token has no workflows.readonly scope'));
    }
    if (sharedCourse) {
      // ONE workflow for everyone: Contact Tag added = coach-member -> Grant the My Coaches Offer.
      const mc = list.filter((w) => /grant\s+my\s+coaches/i.test(w.name || ''));
      const live = mc.filter((w) => w.status === 'published');
      return rows.push(live.length
        ? row(S.grant, 'shared My Coaches grant workflow published', 'DONE', live.map((w) => w.name).join(', '))
        : row(S.grant, 'shared My Coaches grant workflow published', mc.length ? 'FAIL' : 'TODO',
          mc.length ? `"${mc[0].name}" is ${mc[0].status}` : 'no workflow named "Book Coach — Grant My Coaches"',
          'Contact Tag added = coach-member -> Grant the My Coaches Offer -> PUBLISH'));
    }
    const names = [coach.displayName, coach.name].filter(Boolean).map((n) => n.toLowerCase());
    const hits = list.filter((w) => /^book coach\s*[—-]+\s*grant course\s*\(/i.test(w.name || '') && names.some((n) => w.name.toLowerCase().includes(`(${n})`)));
    const want = `Book Coach — Grant Course (${coach.displayName || coach.name})`;
    if (!hits.length) return rows.push(row(S.grant, 'grant workflow published', 'TODO', `no workflow named "${want}"`, `create it: Contact Tag added = ${coach.ghlTag} -> Grant Course360 offer -> PUBLISH`));
    const live = hits.filter((w) => w.status === 'published');
    rows.push(live.length
      ? row(S.grant, 'grant workflow published', 'DONE', live.map((w) => w.name).join(', '))
      : row(S.grant, 'grant workflow published', 'FAIL', `"${hits[0].name}" is ${hits[0].status}`, 'publish it BEFORE the first order — the tag trigger only applies to tags added after publishing'));
    if (hits.length > 1) rows.push(row(S.grant, 'exactly one grant workflow', 'FAIL', hits.map((w) => `${w.name} [${w.status}]`).join(', '), 'two would grant the course twice, or race'));
    rows.push(row(S.grant, 'triggers on this coach\'s tag', 'MANUAL', coach.ghlTag || '', 'the API does not expose a workflow\'s trigger — confirm once in the builder'));
  });

  // Funnel page — $59 -----------------------------------------------------------
  await safe(S.funnel, 'funnel page', async () => {
    if (!coach.landingPageUrl) return rows.push(row(S.funnel, 'funnel page', 'TODO', 'no landingPageUrl'));
    const r = await ctx.fetchText(coach.landingPageUrl);
    if (r.status !== 200) return rows.push(row(S.funnel, 'funnel page', 'TODO', `${coach.landingPageUrl} -> ${r.status}`, 'the day-7/9/10 emails link here: it must exist before a trial reaches day 7'));
    rows.push(row(S.funnel, 'funnel page', 'DONE', coach.landingPageUrl));
    // 🚨 A cloned funnel still sells the SOURCE author's product (runbook §8).
    rows.push(coach.ghlProductId && r.text.includes(coach.ghlProductId)
      ? row(S.funnel, 'sells THIS author\'s product', 'DONE', coach.ghlProductId)
      : row(S.funnel, 'sells THIS author\'s product', 'FAIL', `${coach.ghlProductId || '(no ghlProductId)'} not in the page`, 'repoint the order form — until then a buyer pays and gets another coach'));
    if (ctx._priceId) rows.push(row(S.funnel, '...at the $59 price', r.text.includes(ctx._priceId) ? 'DONE' : 'FAIL', ctx._priceId));
    rows.push(...foreignRows(S.funnel, r.text, foreign));
  });

  // Zipify page + Sales page URL — the Zipify sales page, and recording it ---------------------------------
  if (!coach.bookLandingUrl) {
    rows.push(row(S.zipify, 'Zipify page', 'TODO', `not recorded yet — build it, then step ${S.salesUrl} records its URL so it can be checked`, `npm run pipeline -- landing --code ${coach.code}`));
    rows.push(row(S.salesUrl, 'sales page URL recorded', 'TODO', 'no bookLandingUrl', set('--bookLandingUrl https://leadershipbooks.com/pages/…')));
  } else {
    rows.push(row(S.salesUrl, 'sales page URL recorded', 'DONE', coach.bookLandingUrl));
    await safe(S.zipify, 'Zipify page', async () => {
      const r = await ctx.fetchText(coach.bookLandingUrl);
      if (r.status !== 200) return rows.push(row(S.zipify, 'landing page', 'FAIL', `${coach.bookLandingUrl} -> ${r.status}`));
      rows.push(row(S.zipify, 'landing page', 'DONE', coach.bookLandingUrl));
      // The Add to Cart is Zipify's own Product block, linked to this author's bundle (the house
      // style since 2026-10-12 — it replaced the plain button to /cart/<variant>:1, which still works).
      const cart = coach.shopifyVariantId && `/cart/${coach.shopifyVariantId}:1`;
      const buttons = ourProductButtons(r.text, coach).filter((b) => b.live);
      rows.push(!coach.shopifyVariantId ? row(S.zipify, 'Add to Cart is this author\'s product button', 'TODO', 'no shopifyVariantId recorded yet')
        : buttons.length ? row(S.zipify, 'Add to Cart is this author\'s product button', 'DONE', `Zipify product button → variant ${buttons[0].variant || coach.shopifyVariantId}`)
          : r.text.includes(cart) ? row(S.zipify, 'Add to Cart is this author\'s product button', 'WARN', `a plain link button to ${cart} — it works, but the house style is now Zipify's Product block`, 'in Zipify: replace the button with a Product block set to this author\'s bundle')
            : row(S.zipify, 'Add to Cart is this author\'s product button', 'FAIL', 'nothing on the page adds this author\'s bundle to the cart', 'in Zipify: add a Product block set to this author\'s bundle, with its Add to Cart button'));
      // 🚨 EVERY cart link, not just "ours is there": a clone can keep a second button on the
      // source author's bundle, and a buyer who presses it gets the wrong book and coach.
      const wrong = wrongCartLinks(r.text, coach, all);
      // What a buyer can press decides payment; a Zipify product block with no buy button cannot.
      const pressable = wrong.filter((w) => w.live !== false);
      const inert = wrong.filter((w) => w.live === false);
      rows.push(!coach.shopifyVariantId ? row(S.zipify, 'no Add to Cart link points elsewhere', 'TODO', 'no shopifyVariantId recorded yet')
        : pressable.length ? row(S.zipify, 'no Add to Cart link points elsewhere', 'FAIL', pressable.map((w) => `${w.link} → ${w.what}`).join('; '), 'every Add to Cart must add this author\'s bundle (variant ' + coach.shopifyVariantId + ')')
          : row(S.zipify, 'no Add to Cart link points elsewhere', 'DONE'));
      if (inert.length) {
        rows.push(row(S.zipify, 'Zipify product block linked to another bundle', 'WARN', inert.map((w) => `${w.link} → ${w.what}`).join('; '),
          'not about payment: it has no buy button of its own — only Zipify\'s product data and search results see it'));
      }
      // Those ids are already reported above — not again as "hidden page data".
      const reported = new Set(wrong.flatMap((w) => [w.variant, w.product].filter(Boolean)));
      rows.push(...foreignRows(S.zipify, r.text, foreign.filter((m) => !reported.has(m))));
      if (/\{\{[A-Z_]+\}\}/.test(r.text)) rows.push(row(S.zipify, 'no template placeholders', 'FAIL', (r.text.match(/\{\{[A-Z_]+\}\}/g) || []).slice(0, 5).join(' ')));
    });
  }

  // Go live — registry live -----------------------------------------------------------
  await safe(S.goLive, 'registry', async () => {
    const h = await ctx.health();
    const live = (h.coaches || []).find((c) => c.code === coach.code);
    if (!live) return rows.push(row(S.goLive, 'pushed to KV', 'TODO', 'not in /health', 'npm run push'));
    rows.push(row(S.goLive, 'pushed to KV', 'DONE'));
    rows.push(row(S.goLive, 'Worker holds the key', live.keyResolved ? 'DONE' : 'FAIL', live.keyVar, live.keyResolved ? '' : 'npm run secrets'));
    if (deep) {
      const kv = await ctx.kvGet(`coach:${coach.code}`);
      const want = registryValue(coach);
      const drift = Object.keys({ ...want, ...(kv || {}) }).filter((k) => JSON.stringify(want[k]) !== JSON.stringify((kv || {})[k]));
      rows.push(row(S.goLive, 'KV matches coaches.json', drift.length ? 'FAIL' : 'DONE', drift.length ? `differs: ${drift.join(', ')}` : '', drift.length ? 'npm run push' : ''));
    }
  });

  // End-to-end test ------------------------------------------------------------------
  const last = ctx.lastVerify && ctx.lastVerify(coach.code);
  rows.push(last
    ? row(S.e2e, 'verify-author', last.passed ? 'DONE' : 'FAIL', `${last.passed ? 'passed' : 'FAILED'} ${last.at}${last.via ? ` via ${last.via}` : ''}`)
    : row(S.e2e, 'verify-author', 'TODO', 'never run', `npm run verify-author -- --code ${coach.code} --shopify-order --write --keep`));
  // `--shopify-order` IS the real $0 order: a draft order through Shopify, Flow B
  // and the Worker. Only a run without it leaves the order path unproven.
  rows.push(last && last.passed && last.via === 'shopify-order'
    ? row(S.e2e, '$0 real order', 'DONE', `verify-author --shopify-order passed ${last.at}`)
    : row(S.e2e, '$0 real order', 'MANUAL', 'Flow + Zipify can only be proven by a real order', `npm run verify-author -- --code ${coach.code} --shopify-order --write --keep`));

  // Hands-on: reading an email and clicking a login link ---------------------------
  rows.push(row(S.handsOn, 'welcome email, course invite, coach reply, activation code', 'MANUAL', 'the one thing a script cannot honestly claim to have checked',
    `send the test welcome to your inbox: npm run author -- config --verifyEmail …`));

  // Clean up -----------------------------------------------------------------
  if (ctx._holders) {
    const tests = ctx._holders.filter((c) => /\+verify-/.test(String(c.email || '')));
    rows.push(row(S.cleanUp, 'no test contacts left entitled', tests.length ? 'FAIL' : 'DONE', tests.map((c) => c.id).join(', '),
      tests.length ? 'a leftover verify-author contact holds the tag and is granted a lease every cron' : ''));
  } else {
    rows.push(row(S.cleanUp, 'no test contacts left entitled', 'TODO', `cannot tell until the coach tag exists and can be read (step ${S.ghl})`));
  }

  // All checks — every step before it reads green, except an optional one. A gate:
  // computed last, from the rows above. MANUAL rows do not block it here;
  // `npm run pipeline` adds the sign-offs.
  {
    const counted = new Set(PIPELINE_STEPS.filter((x) => x.id < S.allChecks && !x.optional).map((x) => x.id));
    const open = [...new Set(rows.filter((r) => counted.has(r.step) && (r.status === 'FAIL' || r.status === 'TODO')).map((r) => r.step))];
    rows.push(open.length
      ? row(S.allChecks, 'steps 0-12 read green', 'TODO', `still open: step ${open.join(', ')}`, `npm run author -- status --code ${coach.code}`)
      : row(S.allChecks, 'steps 0-12 read green', 'DONE'));
  }

  return rows.sort((a, b) => a.step - b.step);
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

// `<` as <: a title holding "</script>" cannot end the page's script early.
const q = (v) => JSON.stringify(String(v ?? '')).replace(/</g, '\\u003c');

/**
 * The coach page's CONFIG block, for a page that talks through the Worker.
 *
 * Pasted over the CONFIG block of a clone of /freddy-davis. It is generated so
 * that showActivation cannot be forgotten and authorURL cannot be inherited —
 * the two defects found on live pages. There is no key in it, by design.
 *
 * `subtitle` is the line under the author's name, above "Coach online" (CONFIG
 * bookTitle). Not set: the book's title (decided 2026-10-05; it used to be the
 * coach label, which for a new author also repeats the author's name).
 */
export function coachPageConfig(coach, { workerUrl, pageTitle = '', connection = 'auto', courses = [], vfKey = '', by = '', switches = {}, subtitle = '' } = {}) {
  const name = coach.displayName || coach.name;
  const label = coach.coachLabel || coach.bookTitle;
  const books = Array.isArray(coach.books) ? coach.books : [];
  const extra = Array.isArray(courses) ? courses : [];
  // The page's four on/off switches (the dashboard's step-3 toggles). Not set:
  // the activation and Meet-the-Author buttons on, books and courses on when there are any.
  const on = (v, dflt) => (typeof v === 'boolean' ? v : dflt);
  const sw = {
    showActivation: on(switches.showActivation, true),
    showBooks: on(switches.showBooks, books.length > 0),
    showCourses: on(switches.showCourses, extra.length > 0),
    showMeetAuthor: on(switches.showMeetAuthor, true),
  };
  // The page's own CONNECTION switch; anything else falls back to the safe default.
  const mode = ['auto', 'worker', 'direct'].includes(connection) ? connection : 'auto';
  // The personal key is written only when asked for (the dashboard's step-3 form,
  // "include the backup key"). It is readable in the page's source by design.
  const key = vfKey ? `Bearer ${String(vfKey).trim().replace(/^bearer\s+/i, '')}` : 'Bearer ';
  return [
    '   const CONFIG = {',
    `    authorName: ${q(name)},`,
    `    bookTitle: ${q(String(subtitle || '').trim() || coach.bookTitle || label)},`,
    `    authorPhotoURL: ${q(coach.authorPhotoURL || '')},`,
    `    authorInitials: ${q(coach.authorInitials || initialsOf(name))},`,
    `    pageTitle: ${q(pageTitle || withAuthor(name, label))},`,
    '',
    `    authorURL: ${q(coach.authorURL || '')},`,
    '',
    `    showActivation: ${sw.showActivation},`,
    `    showBooks: ${sw.showBooks},`,
    `    showCourses: ${sw.showCourses},`,
    `    showMeetAuthor: ${sw.showMeetAuthor},`,
    '',
    'books: [',
    ...books.map((b) => `  { title: ${q(b.title)}, url: ${q(b.url)} },`),
    '],',
    'courses: [',
    ...extra.map((c) => `  { title: ${q(c.title)}, url: ${q(c.url)} },`),
    '],',
    `    // Generated by ${by || `\`npm run author -- page --code ${coach.code}\``} from coaches.json.`,
    '    // ---- How this page reaches the coach ----------------------------------',
    '    //   "auto"   (recommended) - the coach router (Worker) first. If the Worker',
    '    //            cannot be reached (down, timing out, or not answering as the Worker), fall',
    '    //            back to Voiceflow directly with VF_API_KEY + VF_VERSION_ID.',
    '    //   "worker" - the coach router only. No fallback.',
    '    //   "direct" - Voiceflow only, with VF_API_KEY + VF_VERSION_ID.',
    `    CONNECTION: ${q(mode)},`,
    '',
    '    // Coach router: the Worker holds the Voiceflow key as a secret and decides',
    "    // whose conversation it is. COACH_CODE is this coach's code in coaches.json.",
    `    COACH_CODE: ${q(coach.code)},`,
    `    WORKER_URL: ${q(workerUrl)},`,
    '',
    '    // Voiceflow direct: used by "direct", and by "auto" as the fallback.',
    '    // Paste the PERSONAL key after "Bearer " in the GHL editor only - never in',
    "    // a file that is committed. It is readable in this page's source.",
    `    VF_API_KEY: ${q(key)},`,
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
