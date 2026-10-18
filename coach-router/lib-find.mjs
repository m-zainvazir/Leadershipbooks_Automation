/**
 * lib-find.mjs — find an author by whatever a person types.
 *
 * The four-digit code stays the ID everything is stored under (KV keys, trial
 * records, the coach page's COACH_CODE, the phone keypad). A person should not
 * have to remember it, so every command that asks for `--code` also takes the
 * slug, the name (either spelling), an alias, or a unique part of the name:
 *
 *   --code 1043   --code freddy-davis   --code "Freddy Davis"   --code freddy
 *   --author freddy    (the same, where the command has no other --author)
 *
 * A guess that fits more than one author is REFUSED with the list — picking
 * one would be the wrong author's onboarding, quietly. Decided 2026-10-02.
 */

const fold = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** "Michael O'Brien" -> "michael-o-brien": the slug form, so names and slugs compare alike. */
const slugish = (s) => fold(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const slugOf = (c) => c.slug || ((/^bookcoach-(.+)-active$/.exec(c.ghlTag || '') || [])[1]) || '';

/** Every way an author can be named, in slug form. */
function namesOf(c) {
  return [...new Set([slugOf(c), c.name, c.displayName, ...(c.aliases || [])].map(slugish).filter(Boolean))];
}

const label = (c) => `${c.code} ${c.displayName || c.name}${slugOf(c) ? ` (${slugOf(c)})` : ''}`;

/**
 * Returns { coach } or { problem } — never a guess.
 *   1. the exact code
 *   2. the exact slug, name, display name or alias (any case, accents ignored)
 *   3. a part of one of them — whole words only, at least 3 characters
 */
export function findCoach(coaches = [], query) {
  const raw = String(query ?? '').trim();
  if (!raw) return { problem: `which author? Give the code, the slug or the name. Authors: ${coaches.map(label).join(', ')}` };

  const byCode = coaches.find((c) => String(c.code) === raw)
    // A renumbered author still answers to their old code (formerCodes).
    || coaches.find((c) => Array.isArray(c.formerCodes) && c.formerCodes.map(String).includes(raw));
  if (byCode) return { coach: byCode };

  const q = slugish(raw);
  if (!q) return { problem: `"${raw}" is not an author. Authors: ${coaches.map(label).join(', ')}` };

  const exact = coaches.filter((c) => namesOf(c).includes(q));
  if (exact.length === 1) return { coach: exact[0] };
  if (exact.length > 1) return { problem: `"${raw}" fits more than one author — use the code: ${exact.map(label).join(', ')}` };

  // A part of a name: "freddy", "stickler", "rick-meyer". Whole words, so "ric"
  // never matches "patrick", and a too-short guess is never tried at all.
  if (q.length >= 3) {
    const words = q.split('-');
    const partial = coaches.filter((c) => namesOf(c).some((n) => {
      const parts = n.split('-');
      return words.every((w) => parts.includes(w)) || n.startsWith(`${q}-`);
    }));
    if (partial.length === 1) return { coach: partial[0] };
    if (partial.length > 1) return { problem: `"${raw}" fits more than one author — be more specific, or use the code: ${partial.map(label).join(', ')}` };
  }
  return { problem: `no author matches "${raw}". Authors: ${coaches.map(label).join(', ')}` };
}

/**
 * The common CLI case: the author named by `--code` or `--author`.
 * Returns { coach } or { problem }.
 */
export function coachFromArgs(coaches, valOf) {
  const q = valOf('--code') ?? valOf('--author');
  return findCoach(coaches, q);
}

export { slugish };
