/**
 * lib-registry.mjs — the one safe way to WRITE coaches.json.
 *
 * Every tool that edits the registry goes through saveRegistry(), so every edit
 * gets the same three guarantees:
 *
 *   1. a byte-for-byte backup first (coaches.json.bak-<stamp>-<label>)
 *   2. the file re-read immediately before the change, never a stale copy
 *   3. seed-coaches.mjs run (dry) on the result — and the backup restored if
 *      it refuses, so a bad edit can never be left in place
 *
 * coaches.json holds every credential, so this never prints values.
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { CONFIG_FILE, HERE } from './lib-config.mjs';

/** Local, gitignored record of verify-author results (the "Tested" column). */
export const STATE_FILE = `${HERE}/onboarding-state.local.json`;

export function readState() {
  try {
    return existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : {};
  } catch {
    return {};
  }
}

export function recordVerify(code, result) {
  const s = readState();
  s[code] = { ...(s[code] || {}), lastVerify: result };
  writeFileSync(STATE_FILE, `${JSON.stringify(s, null, 2)}\n`, 'utf8');
}

/** One author's sign-offs, keyed by step id: { at, note, checks[] }. */
export const readSignoffs = (code, state = readState()) => (state[code] && state[code].signoffs) || {};

/**
 * Record (or, with `value` null, remove) a person's confirmation of a step's
 * MANUAL checks — the "Tested" column's sibling. `checks` names exactly which
 * checks were confirmed, so a check added to that step later is not covered.
 * Plan: ghl-shopify subscription/plans/22-pipeline-dashboard.md §4.3.
 */
export function recordSignoff(code, step, value, { file = STATE_FILE } = {}) {
  let s = {};
  try {
    s = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  } catch {
    s = {};
  }
  const mine = { ...(s[code] || {}) };
  const signoffs = { ...(mine.signoffs || {}) };
  if (value === null) delete signoffs[step];
  else signoffs[step] = value;
  mine.signoffs = signoffs;
  s[code] = mine;
  writeFileSync(file, `${JSON.stringify(s, null, 2)}\n`, 'utf8');
  return signoffs;
}

/**
 * Apply `mutate(doc)` to coaches.json. `mutate` edits the parsed document in
 * place and may throw to abort before anything is written.
 *
 * Returns { backup, warnings } where warnings are seed's `!` lines for `code`.
 * Throws — with the file already restored — if seed refuses the result.
 */
export function saveRegistry(mutate, { label, code }) {
  const doc = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  mutate(doc);

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
  const backup = `${CONFIG_FILE}.bak-${stamp}-${label}`;
  copyFileSync(CONFIG_FILE, backup);
  writeFileSync(CONFIG_FILE, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');

  // spawnSync, not execFileSync: seed prints its warnings to STDERR, which
  // execFileSync discards on success.
  const seed = spawnSync(process.execPath, ['seed-coaches.mjs'], { cwd: HERE, encoding: 'utf8' });
  if (seed.status !== 0) {
    copyFileSync(backup, CONFIG_FILE);
    const refusals = String(seed.stderr || '').split('\n').filter((l) => l.trim().startsWith('x ')).map((l) => l.trim());
    const e = new Error(`seed validation refused the change — coaches.json restored:\n  ${refusals.join('\n  ') || String(seed.stderr).trim()}`);
    e.restored = true;
    throw e;
  }
  const warnings = `${seed.stdout}\n${seed.stderr}`
    .split('\n')
    .filter((l) => (code ? l.includes(`"${code}"`) : true) && l.trim().startsWith('!'))
    .map((l) => l.trim());
  return { backup: backup.split(/[\\/]/).pop(), warnings };
}
