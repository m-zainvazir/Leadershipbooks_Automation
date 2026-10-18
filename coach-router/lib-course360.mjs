/**
 * lib-course360.mjs — checklist step Course360 through HighLevel's Courses API (Version v3).
 * Plan: BookCoach Author Dashboard/plans/03-course360-by-api.md
 *
 * The course itself is made by GHL's own Duplicate of the master course: the API
 * cannot see or copy lesson videos, and has no duplicate. Everything after that is
 * here — find the copy, check it has the master's modules and lessons, give it this
 * author's title, description, picture and coach iframe, and a Free Offer that is
 * Published and gives the course.
 *
 * Network access is injected (`get(path)` for reads), and the writes are returned as
 * a plan the command carries out, so every rule is testable offline.
 */

import { courseDescription, withAuthor } from './lib-onboard.mjs';

export const COURSES_VERSION = 'v3';
export const MEMBER_COURSE_URL = 'https://login.leadershipbookspublishers.com/courses/products/';
// Freddy Davis' course: two modules, the 7 intro videos + the coach lesson (Muhammad, 2026-10-13).
export const DEFAULT_COURSE_MASTER = 'a89deca1-abb6-40e5-81ae-bdd1ec9666ae';
// Its name in GHL, for the how-to (where to press Duplicate). The command reads the real one.
export const DEFAULT_COURSE_MASTER_TITLE = 'BookCoach AI — Freddy Davis — Worldview Coach';
export const COACH_LESSON_TITLE = 'BookCoach AI';
export const COURSE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COACH_SITE = 'https://www.book-coach.ai';

const authorOf = (c) => c.displayName || c.name || '';

/** "BookCoach AI — <Author> — <Label>" — the live courses' pattern. */
export const courseTitle = (coach) => `BookCoach AI — ${withAuthor(authorOf(coach), coach.coachLabel || coach.bookTitle, ' — ')}`;
export const memberCourseUrl = (id) => `${MEMBER_COURSE_URL}${id}`;

/** The course id in a member link (…/courses/products/<id>), or ''. */
export function courseIdFromUrl(url) {
  const m = /\/courses\/products\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(String(url || ''));
  return m ? m[1].toLowerCase() : '';
}

/** A course id, from an id or any link that holds one. */
export function courseIdFrom(s) {
  const v = String(s || '').trim();
  return COURSE_ID_RE.test(v) ? v.toLowerCase() : courseIdFromUrl(v);
}

/** Titles compared loosely: case, spacing and the kind of dash do not matter. */
export const sameTitle = (a, b) => normTitle(a) === normTitle(b);
function normTitle(s) {
  return String(s || '').toLowerCase().replace(/\s*[—–-]+\s*/g, ' - ').replace(/\s+/g, ' ').trim();
}

/* ----------------------------------------------------------- the picture --- */

/**
 * Whether GHL can show a course's picture. GHL puts its course-picture server in front of
 * whatever posterImage holds, so only an address in ITS course storage shows — a path
 * (/memberships/…) or that bucket's own addresses. A Media Storage link came out as
 * "https://cdn.courses.apisystem.techhttps//assets.cdn.filesafe.space/…" — broken (Rick,
 * 2026-10-13). The API cannot upload there, so the picture is added on the course's screen in GHL.
 */
export function posterShows(url) {
  const u = String(url || '').trim();
  return /^\/memberships\//.test(u)
    || /^https:\/\/storage\.googleapis\.com\/revex-membership-production\//.test(u)
    || /^https:\/\/cdn\.courses\.apisystem\.tech\//.test(u);
}

/* ------------------------------------------------------------ the iframe --- */

const coachSrc = (slug) => `${COACH_SITE}/${slug}?cid={{contact.id}}&em={{contact.email}}`;

/** The coach lesson's text: the live lessons' exact iframe (GHL stores the `&` plain). */
export const coachLessonHtml = (slug) =>
  `<p><iframe src="${coachSrc(slug)}" width="100%" height="800" allow="microphone" style="border:0px"></iframe></p><p></p>`;

/** The iframe's src in a lesson's HTML, `&amp;` read as `&`. '' when there is none. */
export function iframeSrc(html) {
  const m = /<iframe[^>]*?\ssrc\s*=\s*["']([^"']+)["']/i.exec(String(html || ''));
  return m ? m[1].replace(/&amp;/g, '&') : '';
}

/** The book-coach.ai slug the lesson's iframe opens, or ''. */
export function iframeSlug(html) {
  const m = /^https:\/\/(?:www\.)?book-coach\.ai\/([a-z0-9-]+)(?:[?#]|$)/i.exec(iframeSrc(html));
  return m ? m[1].toLowerCase() : '';
}

export const iframeIsFor = (html, slug) => !!slug && iframeSrc(html) === coachSrc(slug);

/* ------------------------------------------------------------ the shape --- */

/** Modules in order, each with its lessons in order. */
export function courseShape(categories = [], lessons = []) {
  const bySeq = (a, b) => (a.sequenceNo ?? 0) - (b.sequenceNo ?? 0);
  return [...categories].filter((c) => !c.parentCategory).sort(bySeq).map((m) => ({
    id: m.id,
    title: m.title,
    lessons: lessons.filter((l) => l.categoryId === m.id).sort(bySeq).map((l) => ({ id: l.id, title: l.title, description: l.description })),
  }));
}

/** What differs from the master's modules and lesson titles — [] when the same. */
export function shapeDiff(have, want) {
  const out = [];
  const t = (x) => normTitle(x.title);
  if (have.length !== want.length) out.push(`${have.length} module(s), the master has ${want.length}`);
  want.forEach((m, i) => {
    const h = have[i];
    if (!h) return;
    if (t(h) !== t(m)) out.push(`module ${i + 1} is "${h.title}", the master's is "${m.title}"`);
    const hl = h.lessons.map(t).join('|');
    const ml = m.lessons.map(t).join('|');
    if (hl !== ml) out.push(`module ${i + 1} has ${h.lessons.length} lesson(s)${h.lessons.length === m.lessons.length ? ' with other titles' : ''}, the master's has ${m.lessons.length}`);
  });
  return out;
}

/** The lesson holding the coach: titled "BookCoach AI", else the one with a book-coach.ai iframe. */
export function coachLesson(shape) {
  const all = shape.flatMap((m) => m.lessons);
  return all.find((l) => sameTitle(l.title, COACH_LESSON_TITLE)) || all.find((l) => iframeSlug(l.description)) || null;
}

/** Read one course's modules and lessons. `get(path)` returns the JSON. */
export async function readShape(get, courseId) {
  const id = encodeURIComponent(courseId);
  const [cat, les] = await Promise.all([get(`/courses/products/${id}/categories`), get(`/courses/products/${id}/lessons`)]);
  return courseShape(cat.categories || [], les.lessons || []);
}

/** Every course, or every Offer, all pages (the API pages by `cursor`). */
export async function listAll(get, kind) {
  const out = [];
  let cursor = '';
  for (let page = 0; page < 40; page++) {
    const r = await get(`/courses/${kind}?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    const items = r[kind] || [];
    out.push(...items);
    if (!items.length || !r.nextCursor) return out;
    cursor = r.nextCursor;
  }
  throw new Error(`more than 2,000 ${kind} — refusing to read a cut-off list`);
}

/* ------------------------------------------------------- whose course --- */

/**
 * The author a course belongs to: one whose record holds its id (courseId, or the
 * lesson link) — else one whose name it carries ("— Freddy Davis —"), unless that
 * author's recorded course still exists (then a same-named course is a copy), or
 * the title says "copy".
 */
export function courseOwner(course, coaches, liveIds = new Set()) {
  const recorded = (c) => c.courseId || courseIdFromUrl(c.courseLessonUrl);
  const strong = coaches.find((c) => recorded(c) === course.id);
  if (strong) return strong;
  if (/\bcopy\b/i.test(course.title || '')) return null;
  const t = ` ${normTitle(course.title)} `;
  return coaches.find((c) => !liveIds.has(recorded(c)) && [c.displayName, c.name].filter(Boolean)
    .some((n) => t.includes(` - ${normTitle(n)} - `) || t.endsWith(` - ${normTitle(n)} `))) || null;
}

/**
 * Which course is this author's, in order: --course · the recorded courseId · the
 * course in the saved lesson link · a course titled for this author · the fresh
 * Duplicate of the master (same modules + lessons, nobody's, in no Offer). Never
 * guesses between two. Returns { course, how } or { problem }.
 */
export async function findCourse({ coach, coaches, courses, offers, given, masterId, masterShape, shapeOf }) {
  const byId = new Map(courses.map((c) => [c.id, c]));
  const liveIds = new Set(courses.map((c) => c.id));
  const owner = (c) => courseOwner(c, coaches, liveIds);
  const theirs = (c) => { const o = owner(c); return o && o.code !== coach.code ? o : null; };
  const list = (cs) => cs.map((c) => `"${c.title}" (${c.id})`).join(', ');
  if (given) {
    const id = courseIdFrom(given);
    if (!id) return { problem: 'the course must be its id or its link (…/courses/products/<id>)' };
    const c = byId.get(id);
    if (!c) return { problem: `course ${id} is not in Course360` };
    const o = theirs(c);
    if (o) return { problem: `"${c.title}" is ${authorOf(o)}'s course (${o.code}) — not this author's` };
    return { course: c, how: 'the course you gave' };
  }
  if (coach.courseId) {
    const c = byId.get(coach.courseId);
    return c ? { course: c, how: 'the course saved for this author' }
      : { problem: `the course saved for this author (${coach.courseId}) is not in Course360 any more — duplicate the master again, or give the course` };
  }
  const fromLink = byId.get(courseIdFromUrl(coach.courseLessonUrl));
  if (fromLink) return { course: fromLink, how: 'the saved lesson link' };
  const named = courses.filter((c) => { const o = owner(c); return o && o.code === coach.code; });
  if (named.length === 1) return { course: named[0], how: 'its title names this author' };
  if (named.length > 1) return { problem: `${named.length} courses name this author: ${list(named)} — give the one to use` };
  const inOffer = new Set(offers.flatMap((o) => (o.products || []).map((p) => p.id)));
  const masterTitle = (byId.get(masterId) || {}).title || '';
  const candidates = courses.filter((c) => c.id !== masterId && !owner(c) && !inOffer.has(c.id)
    && (/\bcopy\b/i.test(c.title || '') || /^bookcoach ai\b/i.test(c.title || '') || (masterTitle && normTitle(c.title).includes(normTitle(masterTitle)))));
  const copies = [];
  for (const c of candidates) if (!shapeDiff(await shapeOf(c.id), masterShape).length) copies.push(c);
  if (copies.length === 1) return { course: copies[0], how: 'a fresh Duplicate of the master' };
  if (copies.length > 1) return { problem: `${copies.length} unused copies of the master: ${list(copies)} — give the one to use` };
  return { problem: `no course for this author yet — in GHL: Memberships → Courses → "${masterTitle || masterId}" → ⋯ → Duplicate, then run this again` };
}

/* ------------------------------------------------------------ the plan --- */

/**
 * The Offer: the one saved for this author, else the one that gives this course
 * (the one titled for it, if several), else the one titled for it — else a new one.
 * Free, Published, giving this course. Returns { offer, write } or { problem }.
 */
export function planOffer({ coach, course, offers, title }) {
  let offer = null;
  const gives = offers.filter((o) => (o.products || []).some((p) => p.id === course.id));
  // Titled for this author: as it should be, or as the course is called now (a typo in an old name).
  const named = offers.filter((o) => sameTitle(o.title, title) || sameTitle(o.title, course.title));
  if (coach.courseOfferId) {
    offer = offers.find((o) => o.id === coach.courseOfferId);
    if (!offer) return { problem: `the Offer saved for this author (${coach.courseOfferId}) is not in Course360 any more` };
  } else if (gives.length) {
    const both = gives.filter((o) => named.includes(o));
    offer = both.length === 1 ? both[0] : gives.length === 1 ? gives[0] : null;
    if (!offer) return { problem: `${gives.length} Offers give this course: ${gives.map((o) => `"${o.title}"`).join(', ')} — say which is this author's (keep one titled "${title}")` };
  } else if (named.length > 1) {
    return { problem: `${named.length} Offers are called "${title}" — delete the extra one in GHL first` };
  } else {
    offer = named[0] || null;
  }
  if (!offer) {
    return { offer: null, write: { key: 'offer', method: 'POST', path: '/courses/offers', say: `create the Offer "${title}" — Free, Published, gives this course`,
      body: { title, type: 'free', amount: 0, currency: 'USD', visibility: 'published', productIds: [course.id] } } };
  }
  const others = (offer.products || []).filter((p) => p.id !== course.id);
  if (others.length) return { problem: `the Offer "${offer.title}" also gives ${others.map((p) => `"${p.title}"`).join(', ')} — change it in GHL; a program does not take a course out of an Offer` };
  if (offer.type !== 'free') return { problem: `the Offer "${offer.title}" is ${offer.type}, not Free — change it in GHL` };
  const body = {};
  const says = [];
  if (!(offer.products || []).some((p) => p.id === course.id)) { body.productIds = [course.id]; says.push('give this course'); }
  if (offer.visibility !== 'published') { body.visibility = 'published'; says.push(`${offer.visibility} → Published`); }
  return { offer, write: says.length ? { key: 'offer', method: 'PUT', path: `/courses/offers/${encodeURIComponent(offer.id)}`, say: `Offer "${offer.title}": ${says.join(', ')}`, body } : null };
}

/**
 * Everything step Course360 still needs for this author, as a list of writes in
 * order (course, coach lesson, Offer) + what to save in coaches.json. Pure.
 * No picture: only GHL's own course screen can set one that shows (see posterShows).
 */
export function planCourse360({ coach, slug, course, shape, masterShape, offers }) {
  const problems = [];
  const writes = [];
  const done = [];
  const title = courseTitle(coach);
  const diff = shapeDiff(shape, masterShape);
  if (diff.length) problems.push(`the course is not a copy of the master: ${diff.join('; ')} — duplicate the master again, or fix it in GHL`);
  if (!slug) problems.push('this author has no slug — the coach link needs it');

  const body = {};
  const says = [];
  if (course.title !== title) { body.title = title; says.push(`title "${course.title}" → "${title}"`); }
  const description = courseDescription(authorOf(coach));
  if ((course.description || '') !== description) { body.description = description; says.push('the standard description'); }
  if (says.length) writes.push({ key: 'course', method: 'PUT', path: `/courses/products/${encodeURIComponent(course.id)}`, say: `course: ${says.join(', ')}`, body });
  else done.push(`course "${course.title}" — title and description already right`);

  const lesson = coachLesson(shape);
  if (!lesson) problems.push(`the course has no "${COACH_LESSON_TITLE}" lesson`);
  else if (slug && !iframeIsFor(lesson.description, slug)) {
    const now = iframeSlug(lesson.description);
    writes.push({ key: 'lesson', method: 'PUT', path: `/courses/products/${encodeURIComponent(course.id)}/lessons/${encodeURIComponent(lesson.id)}`,
      say: `lesson "${lesson.title}": coach link ${now ? `book-coach.ai/${now}` : '(none)'} → book-coach.ai/${slug}`, body: { description: coachLessonHtml(slug) } });
  } else if (lesson) done.push(`lesson "${lesson.title}" — already opens book-coach.ai/${slug}`);

  const o = planOffer({ coach, course, offers, title });
  if (o.problem) problems.push(o.problem);
  else if (o.write) writes.push(o.write);
  else done.push(`Offer "${o.offer.title}" — Free, Published, gives this course`);

  const record = { courseId: course.id, courseLessonUrl: memberCourseUrl(course.id), ...(o.offer ? { courseOfferId: o.offer.id } : {}) };
  return { title, problems, writes, done, record, offerId: o.offer ? o.offer.id : '' };
}

/**
 * Carry out the writes in order. `send(write)` returns the JSON answer. Stops at the
 * first failure; `created` holds every id made so far, so nothing is ever half-made
 * silently — the caller saves them and says what is left.
 */
export async function runWrites(send, writes, { log = () => {} } = {}) {
  const created = {};
  for (let i = 0; i < writes.length; i++) {
    const w = writes[i];
    try {
      const r = await send(w);
      if (w.key === 'offer' && w.method === 'POST') {
        const id = r && (r.id || (r.offer && r.offer.id));
        if (!id) throw new Error('GHL answered without the new Offer\'s id');
        created.courseOfferId = id;
      }
      log(`  ✓ ${w.say}${created.courseOfferId && w.key === 'offer' ? `  (Offer id ${created.courseOfferId})` : ''}`);
    } catch (err) {
      return { ok: false, created, failed: w, error: err.message, left: writes.slice(i) };
    }
  }
  return { ok: true, created, left: [] };
}
