/**
 * lib-onboard.mjs — the logic behind `npm run onboard` (onboard.mjs).
 *
 * Creates the GHL side of a new author and the coaches.json entry that points
 * at it. Plan: ghl-shopify subscription/plans/21-onboarding-automation.md §B.
 *
 * Split from the CLI so every decision is testable without GHL: the network is
 * an injected `ghl(path, { method, body })` function, never a global fetch.
 *
 * The shape of the whole thing is READ, then DECIDE, then WRITE:
 *
 *   preflightProblems()  pure — the registry rules, before anything is called
 *   inspectGhl()         reads only — duplicate products, the scratch contact,
 *                        who already holds the tag
 *   applyGhl()           the only function that writes to GHL
 *
 * Nothing in applyGhl runs unless the first two came back clean, so a bad slug
 * or a duplicate product costs nothing. That ordering is the point of the file.
 */

import { coachProblems } from './lib-config.mjs';

/** book-coach.ai page slugs: lowercase words joined by single hyphens. */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The one coach monthly price. Shared by every author until there is a reason not to. */
export const COACH_PRICE = { amount: 59, currency: 'USD', interval: 'month', intervalCount: 1 };

const COACH_SITE = 'https://www.book-coach.ai';

/**
 * GHL product naming, from plans/20 §7b-bis (decided 2026-09-24). Kept
 * byte-identical to what was created by hand for Freddy Davis, which the tests
 * pin, so the convention cannot drift quietly.
 */
export function ghlNames(author) {
  const product = `BookCoach AI - ${author} - Coach Access`;
  return {
    product,
    price: `${product} @ ${COACH_PRICE.amount}/month`,
    description: `Monthly access to the ${author} Book Coach AI by text, phone and web.`,
  };
}

/** Every value that follows from the slug alone. */
export function slugConventions(slug) {
  return {
    ghlTag: `bookcoach-${slug}-active`,
    pageUrl: `${COACH_SITE}/${slug}`,
    landingPageUrl: `${COACH_SITE}/${slug}-coach-access`,
    // `&amp;` is correct: this is pasted into HTML. See new-author-runbook §4.
    iframeSrc: `${COACH_SITE}/${slug}?cid={{contact.id}}&amp;em={{contact.email}}`,
  };
}

/**
 * Voiceflow's draft version id is the project id plus one.
 *
 * Both are Mongo ObjectIds, whose last three bytes are a counter, so the
 * relationship is numeric — which means a version ending in `0` borrows from
 * the digit before it. "Decrement the last hex character" (the runbook's rule
 * of thumb) gets exactly that case wrong; BigInt arithmetic does not.
 * Corroborated on all seven live pages, 2026-09-22 (plans/20 §7a).
 */
export function projectFromVersion(versionID) {
  if (!/^[0-9a-f]{24}$/i.test(String(versionID || ''))) return null;
  const n = BigInt(`0x${versionID}`) - 1n;
  if (n < 0n) return null;
  return n.toString(16).padStart(24, '0');
}

/**
 * Read the CONFIG block of a live coach page.
 *
 * Two page generations exist. A legacy page calls Voiceflow directly and so
 * carries the key in its source; a Worker-proxied page (Freddy's pattern)
 * carries `VF_API_KEY: ""` and a COACH_CODE instead. Only the first can supply
 * a key — the second is exactly the page plans/21 §A is moving everyone to, so
 * scraping is a fallback, never the plan.
 */
export function parseCoachPage(html) {
  const s = String(html || '');
  // GHL serves the CONFIG block twice: once as script, once JSON-escaped inside
  // its page data (`COACH_CODE: \"1043\"`). The optional backslash takes either.
  const str = (name) => {
    const m = new RegExp(`${name}\\s*:\\s*\\\\?["']([^"'\\\\]*)\\\\?["']`).exec(s);
    return m ? m[1].trim() : '';
  };
  const bool = (name) => {
    const m = new RegExp(`${name}\\s*:\\s*(true|false)`).exec(s);
    return m ? m[1] === 'true' : null;
  };
  return {
    versionID: str('VF_VERSION_ID'),
    projectID: str('VF_PROJECT_ID'),
    vfKey: str('VF_API_KEY'),
    coachCode: str('COACH_CODE'),
    connection: str('CONNECTION'),
    authorName: str('authorName'),
    showActivation: bool('showActivation'),
  };
}

/** [full name, first, last] — the pattern plans/20 §6 asks for, deduplicated. */
export function defaultAliases(...names) {
  const out = [];
  const add = (v) => {
    const s = String(v || '').trim();
    if (s && !out.some((x) => x.toLowerCase() === s.toLowerCase())) out.push(s);
  };
  for (const n of names) add(n);
  for (const n of names) {
    const parts = String(n || '').trim().split(/\s+/);
    if (parts.length > 1) { add(parts[0]); add(parts[parts.length - 1]); }
  }
  return out;
}

/**
 * The coaches.json object for this author, before GHL ids are known.
 *
 * `name` is the internal match key and `displayName` the customer spelling; they
 * default to the same value but are kept separate on purpose (the
 * Micheal/Michael split, plans/20 §4.1).
 */
export function buildEntry(o) {
  const c = slugConventions(o.slug);
  const name = o.name || o.author;
  const entry = {
    code: String(o.code),
    // Recorded, not just used: every later check (npm run author) derives the
    // coach page, funnel and tag from it.
    slug: o.slug,
    ...(o.coachLabel ? { coachLabel: o.coachLabel } : {}),
    name,
    displayName: o.author,
    bookTitle: o.book,
    aliases: o.aliases && o.aliases.length ? o.aliases : defaultAliases(name, o.author),
    projectID: o.projectID,
    versionID: o.versionID,
    // Omitted when the shared personal key is in use: no per-coach key to store.
    ...(o.vfKey ? { vfKey: o.vfKey } : {}),
    voiceMode: 'inline',
    ttsVoice: o.ttsVoice || 'Polly.Matthew-Neural',
    ghlTag: c.ghlTag,
    landingPageUrl: c.landingPageUrl,
    trialDays: o.trialDays ?? 10,
  };
  if (o.shopifyProductId) entry.shopifyProductId = String(o.shopifyProductId);
  if (o.courseLessonUrl) entry.courseLessonUrl = o.courseLessonUrl;
  if (o.ghlProductId) entry.ghlProductId = o.ghlProductId;
  return entry;
}

/**
 * Everything that must be true before a single network call is made.
 *
 * Deliberately refuses an existing code rather than editing it. Creating a
 * second $59 product by accident is worse than typing the command twice.
 */
export function preflightProblems({ existing = [], entry, slug, personalKey = '' }) {
  const p = [];
  if (!SLUG_RE.test(String(slug || ''))) {
    p.push(`--slug "${slug}" must be lowercase words joined by hyphens, e.g. jane-smith`);
  }
  if (!/^\d+$/.test(entry.code)) {
    p.push(`--code "${entry.code}" must be digits — a voice caller keys it on a phone keypad`);
  }
  const clash = existing.find((c) => String(c.code) === entry.code);
  if (clash) {
    p.push(`code ${entry.code} is already in coaches.json (${clash.name}). onboard creates, it never edits — pick another code or edit the entry by hand`);
  }
  for (const f of ['name', 'displayName', 'bookTitle']) {
    if (!String(entry[f] || '').trim()) p.push(`${f} is empty`);
  }
  // Same rule seed-coaches.mjs applies. Checked here too because by the time
  // seed runs, the GHL product already exists.
  if (/[&<>"']/.test(entry.name || '')) {
    p.push(`name "${entry.name}" contains punctuation that breaks TwiML — remove & < > " '`);
  }
  if (!/^[0-9a-f]{24}$/i.test(entry.projectID || '')) {
    p.push(`projectID "${entry.projectID || ''}" is not a 24-hex Voiceflow id — pass --project, or --version to derive it`);
  }
  if (!/^([0-9a-f]{24}|main|production|development)$/i.test(entry.versionID || '')) {
    p.push(`versionID "${entry.versionID || ''}" is neither a 24-hex id nor a Voiceflow alias — pass --version`);
  }
  if (personalKey) {
    // One shared personal key serves every coach; a per-coach key is not needed.
  } else if (!entry.vfKey) {
    p.push(`no Voiceflow key — set shared.vfApiKey (the personal key, all coaches) in coaches.json, or VF_KEY_${entry.code} in the environment`);
  } else if (!/^VF\.DM\./.test(entry.vfKey)) {
    p.push(`the Voiceflow key does not start with VF.DM. — that is not a Dialog Manager API key`);
  }
  // The cross-coach rules: duplicate tags, product ids, the shopify_ namespace.
  const all = [...existing, { ...entry, index: existing.length }];
  for (const msg of coachProblems(all)) if (msg.includes(`"${entry.code}"`)) p.push(msg);
  return p;
}

const lower = (s) => String(s || '').trim().toLowerCase();

const isCoachPrice = (pr) =>
  pr && !pr.deleted && pr.type === 'recurring' &&
  Number(pr.amount) === COACH_PRICE.amount &&
  lower(pr.currency) === lower(COACH_PRICE.currency) &&
  pr.recurring && pr.recurring.interval === COACH_PRICE.interval &&
  Number(pr.recurring.intervalCount || 1) === COACH_PRICE.intervalCount;

async function contactsWithTag(ghl, locationId, tag, pageLimit) {
  const data = await ghl('/contacts/search', {
    method: 'POST',
    body: { locationId, pageLimit, filters: [{ field: 'tags', operator: 'contains', value: [tag] }] },
  });
  return Array.isArray(data.contacts) ? data.contacts : [];
}

/**
 * Read-only look at GHL. Returns { problems, notes, ...facts } and writes
 * nothing, so it is safe in a dry run.
 *
 * `adoptProductId` is the recovery path: if a previous run created the product
 * and then failed on the price, re-running with --ghl-product <id> reuses it
 * instead of refusing on the duplicate name.
 */
export async function inspectGhl({ ghl, locationId, entry, staffTag, adoptProductId }) {
  const problems = [];
  const notes = [];
  const names = ghlNames(entry.displayName);

  // --- the product must not exist already, unless we were told to adopt it --
  const search = await ghl(`/products/?locationId=${encodeURIComponent(locationId)}&limit=100&search=${encodeURIComponent(names.product)}`);
  const sameName = (Array.isArray(search.products) ? search.products : []).filter((pr) => lower(pr.name) === lower(names.product));

  let product = null;
  let price = null;
  if (adoptProductId) {
    product = await ghl(`/products/${encodeURIComponent(adoptProductId)}?locationId=${encodeURIComponent(locationId)}`);
    if (!product || !product._id) problems.push(`--ghl-product ${adoptProductId} was not found in GHL`);
    const others = sameName.filter((pr) => pr._id !== adoptProductId);
    if (others.length) problems.push(`another product is also named "${names.product}" (${others.map((x) => x._id).join(', ')}) — delete the spare in GHL first`);
    if (product && product._id) {
      const prices = await ghl(`/products/${encodeURIComponent(adoptProductId)}/price?locationId=${encodeURIComponent(locationId)}`);
      price = (Array.isArray(prices.prices) ? prices.prices : []).find(isCoachPrice) || null;
      notes.push(`adopting existing product ${adoptProductId}${price ? ` and its price ${price._id}` : ' — a price will be created'}`);
    }
  } else if (sameName.length) {
    problems.push(
      `GHL already has a product named "${names.product}" (${sameName.map((x) => x._id).join(', ')}). ` +
        `If a previous onboard run created it, re-run with --ghl-product ${sameName[0]._id}; otherwise rename or delete it`,
    );
  }

  // --- the scratch contact the tag is created on ----------------------------
  // The token cannot call /locations/<id>/tags (401, verified 2026-09-28), so a
  // tag is created the way GHL creates them anyway: by applying it once.
  let staffContactId = null;
  if (!staffTag) {
    problems.push('shared.config.staffTag is empty — onboard needs the staff test contact to create the tag on');
  } else {
    const staff = await contactsWithTag(ghl, locationId, staffTag, 1);
    if (!staff.length) problems.push(`no contact holds the staff tag "${staffTag}" — create the staff test contact first`);
    else staffContactId = staff[0].id;
  }

  // --- nobody may hold the new tag yet --------------------------------------
  // A real contact already carrying it would be ENTITLED the moment the entry
  // is pushed. The staff contact is the exception: an interrupted run leaves
  // the tag on it, and this run removes it again.
  const holders = await contactsWithTag(ghl, locationId, entry.ghlTag, 5);
  const strangers = holders.filter((h) => h.id !== staffContactId);
  if (strangers.length) {
    problems.push(
      `${strangers.length}${strangers.length === 5 ? '+' : ''} contact(s) already hold ${entry.ghlTag} ` +
        `(${strangers.map((h) => h.id).join(', ')}). They would be granted this coach on the next push — investigate before onboarding`,
    );
  } else if (holders.length) {
    notes.push(`the staff contact still holds ${entry.ghlTag} from an earlier run — it will be removed`);
  }

  return { problems, notes, names, product, price, staffContactId };
}

/**
 * The only writes. Order: tag, then product, then price — cheapest and most
 * reversible first.
 *
 * On failure the thrown error carries `.created`, naming everything that now
 * exists in GHL, so the operator is never left guessing what to clean up.
 */
export async function applyGhl({ ghl, locationId, entry, inspection }) {
  const created = {};
  const fail = (step, err) => {
    const e = new Error(`${step} failed: ${(err && err.message) || err}`);
    e.created = created;
    throw e;
  };

  const { names, staffContactId } = inspection;

  try {
    await ghl(`/contacts/${encodeURIComponent(staffContactId)}/tags`, { method: 'POST', body: { tags: [entry.ghlTag] } });
    created.tagAppliedTo = staffContactId;
  } catch (err) { fail('creating the tag', err); }

  try {
    // The tag persists in the location after removal — that is what it was
    // applied for. Left on, the staff contact would be granted this coach.
    await ghl(`/contacts/${encodeURIComponent(staffContactId)}/tags`, { method: 'DELETE', body: { tags: [entry.ghlTag] } });
    created.tag = entry.ghlTag;
    delete created.tagAppliedTo;
  } catch (err) { fail(`removing ${entry.ghlTag} from the staff contact ${staffContactId} (remove it by hand)`, err); }

  let productId = inspection.product && inspection.product._id;
  if (!productId) {
    try {
      const res = await ghl('/products/', {
        method: 'POST',
        body: { locationId, name: names.product, description: names.description, productType: 'SERVICE', availableInStore: false },
      });
      productId = res._id || (res.product && res.product._id);
      if (!productId) throw new Error('GHL returned no product id');
      created.productId = productId;
    } catch (err) { fail('creating the product', err); }
  }

  let priceId = inspection.price && inspection.price._id;
  if (!priceId) {
    try {
      const res = await ghl(`/products/${encodeURIComponent(productId)}/price`, {
        method: 'POST',
        body: {
          locationId,
          name: names.price,
          type: 'recurring',
          currency: COACH_PRICE.currency,
          amount: COACH_PRICE.amount,
          recurring: { interval: COACH_PRICE.interval, intervalCount: COACH_PRICE.intervalCount },
        },
      });
      priceId = res._id || (res.price && res.price._id);
      if (!priceId) throw new Error('GHL returned no price id');
      created.priceId = priceId;
    } catch (err) {
      fail(`creating the price (product ${productId} exists — re-run with --ghl-product ${productId})`, err);
    }
  }

  return { ghlProductId: productId, ghlPriceId: priceId, tag: entry.ghlTag };
}

/** The manual steps still left, filled in with this author's exact values. */
export function remainingSteps({ entry, slug, label, priceId }) {
  const c = slugConventions(slug);
  const a = entry.displayName;
  const lines = [
    `Still manual — in this order (new-author-runbook.md):`,
    ``,
    `  2  Coach page      clone ${COACH_SITE}/freddy-davis to /${slug}, then set in CONFIG:`,
    `                     authorName: "${a}", bookTitle: "${label || entry.bookTitle}",`,
    `                     pageTitle: "${a} - ${label || entry.bookTitle}", COACH_CODE: "${entry.code}",`,
    `                     authorInitials, authorPhotoURL, books[] -> this author's book,`,
    `                     authorURL -> THIS author's page (Freddy's still points at Stickler's),`,
    `                     CONNECTION: "worker", VF_API_KEY: "", VF_VERSION_ID: "${entry.versionID}",`,
    `                     VF_PROJECT_ID: "${entry.projectID}", showActivation: true`,
    `  3  Shopify         "${entry.bookTitle} [${a}] + Your Personal AI Coach", $29.95, SKU BC<ISBN>, real weight`,
    `                     -> add "shopifyProductId" to coaches.json`,
    `  4  Course360       "BookCoach AI — ${a} — ${label || entry.bookTitle}", ONE lesson, Offer FREE, not listed`,
    `                     iframe src: ${c.iframeSrc}`,
    `                     -> add the MEMBER lesson URL as "courseLessonUrl" (strip everything from ?)`,
    `  6  Grant workflow  "Book Coach — Grant Course (${a})": Contact Tag added = ${entry.ghlTag}`,
    `                     -> Grant Offer -> PUBLISH before the first order`,
    `  8  Funnel page     clone the $59 funnel to /${slug}-coach-access`,
    `                     order form -> product ${entry.ghlProductId}, price ${priceId}`,
    `  9  Zipify page     cart link https://leadershipbooks.com/cart/<VARIANT_ID>:1`,
    ``,
    `Then:  npm run seed            dry run — zero warnings means the author is complete`,
    `       npm run push            live in ~60 s`,
    `       npm run verify:vf -- --code ${entry.code}`,
    `       a real $0 order (runbook step 11) — nothing here replaces it`,
  ];
  return lines.join('\n');
}
