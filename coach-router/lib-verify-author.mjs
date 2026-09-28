/**
 * lib-verify-author.mjs — the checks behind `npm run verify-author`.
 *
 * Fires a synthetic order at POST /shopify/order for one coach, reads the
 * resulting GHL contact back BY ID, and compares it against the registry.
 * Plan: ghl-shopify subscription/plans/21-onboarding-automation.md §C.
 *
 * Pure: no network here. verify-author.mjs does the calls.
 *
 * WHAT THIS CANNOT PROVE, and says so in its own output: Shopify Flow and the
 * Zipify button. Both onboarding bugs found so far (the inverted Flow tag
 * condition, Zipify's `No variants`) live there, and both would pass this.
 * It supplements the $0 order test (runbook step 11); it never replaces it.
 */

/**
 * GHL custom-field KEY -> id, for location tjdqrnOqMAMheHIt6pQD.
 *
 * Needed because GET /contacts/<id> returns fields by id only, and the token
 * cannot list them (401 on /locations/<id>/customFields, 2026-09-28). The Worker
 * WRITES by key (plans/20 §9b) so it needs none of this; only a reader does.
 * Ids are per-location: a second GHL account would need its own table.
 */
export const FIELD_IDS = {
  coach_status: 'cAL8RHFCFUgPRA9gZjsx',
  coach_trial_started: 'JJoM2V52xXLZqyNm5tOK',
  coach_trial_source: 'kBxKqY1tUGc6waAjcONz',
  shopify_order_number: '818JeImrO5OKspBYkI8S',
  coach_name: 'hhqfPEVtO6YLHRpsN3oa',
  coach_code: 'jWIWaKlhhTEVUx5s4Lp8',
  coach_book_title: '7UMMGbo1SBtSnEljBjkp',
  coach_link: 'ZJYMJbg5SMTztow0Xhqj',
  coach_landing_url: 'CVoYdAl17AWMoKZpM9bN',
  // Discovered 2026-09-28 from a live contact carrying "4 October 2026".
  coach_trial_ends: 'Y0QMX2OoGXLCy96tq1bL',
};

export const TRIAL_STARTED_TAG = 'coach-trial-started';
export const VERIFY_SOURCE = 'verify_author';

/**
 * A fresh address every run: `you@x.com` -> `you+verify-1044-<stamp>@x.com`.
 *
 * Fresh matters twice over. GHL dedupes on email, so a reused address lands on
 * an existing contact whose trial guard correctly skips the grant — which reads
 * as a broken onboarding. And this tool DELETES the contact at the end, so it
 * must only ever be one it created.
 */
export function testEmail(base, code, now = new Date()) {
  const [local, domain] = String(base || '').trim().toLowerCase().split('@');
  if (!local || !domain) return '';
  const stamp = now.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  return `${local.split('+')[0]}+verify-${code}-${stamp}@${domain}`;
}

/**
 * The run sends a REAL welcome email (the contact gets coach-trial-started, the
 * trigger of the live trial workflow). An address nobody receives is a bounce
 * from the verified sending domain on every run, which erodes the DMARC-passing
 * reputation plans/01 fought for. So: a real inbox, or no run.
 */
export function emailProblems(base) {
  const e = String(base || '').trim().toLowerCase();
  if (!e) return ['no test inbox: pass --email, or save one with npm run author -- config --verifyEmail you@example.org. The run sends it the real welcome email.'];
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e)) return [`--email "${base}" is not an email address`];
  if (/@(example\.(com|org|net)|[^@]*\.(invalid|test|example|localhost))$/.test(e)) {
    return [`--email "${base}" does not receive mail. The welcome email would bounce from the verified sending domain on every run — use a real inbox`];
  }
  return [];
}

/** The order body Flow sends, reduced to what the endpoint reads. */
export function orderPayload({ coach, email, now = new Date() }) {
  const stamp = now.getTime();
  return {
    source: VERIFY_SOURCE,
    // Unique per run: the endpoint silently ignores an order id it has seen in
    // the last 30 days (the `shop:` idempotency key).
    order_id: `verify-${coach.code}-${stamp}`,
    order_number: `#VERIFY-${coach.code}-${stamp}`,
    email,
    first_name: 'Verify',
    last_name: `Author ${coach.code}`,
    line_items: [{ product_id: String(coach.shopifyProductId), quantity: 1 }],
  };
}

/** Registry values this coach must have before a verify means anything. */
export function coachProblems(coach) {
  const p = [];
  if (!coach) return ['no such coach in coaches.json'];
  if (!coach.shopifyProductId) p.push(`coach ${coach.code} has no shopifyProductId — no order can start its trial, so there is nothing to verify yet`);
  if (!coach.ghlTag) p.push(`coach ${coach.code} has no ghlTag`);
  return p;
}

const fieldValue = (contact, key) => {
  const id = FIELD_IDS[key];
  const f = (Array.isArray(contact.customFields) ? contact.customFields : []).find((x) => x.id === id);
  return f === undefined ? undefined : String(f.value ?? '');
};

/**
 * Every assertion, as table rows: { check, expected, actual, status }.
 * status: PASS | FAIL | WARN. WARN is a registry value not yet filled in — the
 * field is correctly left unwritten, but a customer email would show a gap.
 */
export function checkContact(contact, coach, { orderNumber, now = new Date(), formatTrialEnd, source = VERIFY_SOURCE }) {
  const rows = [];
  const row = (check, expected, actual, ok, warn = false) =>
    rows.push({ check, expected: String(expected), actual: actual === undefined ? '(absent)' : String(actual), status: ok ? 'PASS' : warn ? 'WARN' : 'FAIL' });

  const tags = (Array.isArray(contact.tags) ? contact.tags : []).map((t) => String(t).toLowerCase());
  row('tag: coach entitlement', coach.ghlTag, tags.includes(coach.ghlTag) ? coach.ghlTag : undefined, tags.includes(coach.ghlTag));
  row('tag: trial workflow trigger', TRIAL_STARTED_TAG, tags.includes(TRIAL_STARTED_TAG) ? TRIAL_STARTED_TAG : undefined, tags.includes(TRIAL_STARTED_TAG));

  const eq = (key, expected) => {
    const actual = fieldValue(contact, key);
    if (expected === undefined || expected === '') {
      // Absent is right (the Worker never writes blanks) but still a WARN: the
      // email renders a gap. Present means it came from somewhere else: FAIL.
      row(key, '(not in registry)', actual, false, actual === undefined);
      return;
    }
    row(key, expected, actual, actual === String(expected));
  };

  eq('coach_status', 'trial');
  eq('coach_code', String(coach.code));
  eq('coach_name', coach.displayName || coach.name);
  eq('coach_book_title', coach.bookTitle);
  eq('coach_link', coach.courseLessonUrl);
  eq('coach_landing_url', coach.landingPageUrl);
  eq('coach_trial_source', source);
  eq('shopify_order_number', orderNumber);

  // Dates: the Worker stamps its own clock, so allow the run to straddle UTC
  // midnight rather than fail on a one-day skew nobody cares about.
  const days = Number.isInteger(coach.trialDays) ? coach.trialDays : 10;
  const day = (offset) => new Date(now.getTime() + offset * 86400000);
  const started = fieldValue(contact, 'coach_trial_started');
  const okStarted = [0, 1].map((o) => day(o).toISOString().slice(0, 10));
  row('coach_trial_started', okStarted[0], started, okStarted.includes(started));
  const ends = fieldValue(contact, 'coach_trial_ends');
  const okEnds = [days, days + 1].map((d) => formatTrialEnd(day(d).toISOString()));
  row('coach_trial_ends', `${okEnds[0]} (${days} days)`, ends, okEnds.includes(ends));

  return rows;
}

/** The `trial:` KV record — the expiry sweep's queue entry. */
export function checkTrialRecord(rec, coach, contactId) {
  const ok = !!rec && rec.contactId === contactId && String(rec.code) === String(coach.code) && !Number.isNaN(Date.parse(rec.expiresAt));
  return {
    check: 'KV trial record (the sweep will expire it)',
    expected: `trial:${contactId}:${coach.code}`,
    actual: rec ? `expiresAt ${rec.expiresAt}` : '(absent)',
    status: ok ? 'PASS' : 'FAIL',
  };
}

export function formatTable(rows) {
  const w = (k) => Math.min(48, Math.max(k.length, ...rows.map((r) => String(r[k]).length)));
  const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));
  const [a, b, c] = [w('check'), w('expected'), w('actual')];
  const line = (r) => `  ${r.status.padEnd(4)}  ${cut(r.check, a)}  ${cut(r.expected, b)}  ${cut(r.actual, c)}`;
  return [line({ status: '', check: 'check', expected: 'expected', actual: 'actual' }), ...rows.map(line)].join('\n');
}

/** Printed after a --shopify-order run: Flow was exercised, Zipify was not. */
export const LIMITS_NOTICE_ORDER = [
  'This exercised a real Shopify order and Flow B, but NOT the Zipify Add-to-Cart button.',
  'npm run author -- status checks the button\'s cart link; a click-through on the live page is still worth doing once.',
].join('\n  ');

/** Printed on every run, pass or fail. */
export const LIMITS_NOTICE = [
  'This did NOT exercise Shopify Flow or the Zipify Add-to-Cart button.',
  'Both onboarding bugs found so far lived there (the inverted Flow tag condition, Zipify "No variants")',
  'and both would have passed this check. A real $0 order (runbook step 11) is still required.',
].join('\n  ');
