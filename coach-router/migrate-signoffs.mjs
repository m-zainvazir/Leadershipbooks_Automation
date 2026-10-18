#!/usr/bin/env node
/**
 * migrate-signoffs.mjs — move the sign-offs in onboarding-state.local.json to
 * the step numbers of 2026-10-12 (steps.mjs RENUMBER_2026_10_12). One time.
 *
 *   node migrate-signoffs.mjs            show what would change (nothing written)
 *   node migrate-signoffs.mjs --write    back the file up, then change it
 *
 * Old step 1's sign-off ("the coach is built and answers as the author") is
 * dropped: the Voiceflow coach and its IDs are one step now, and the saved IDs
 * are the proof. Every other sign-off moves to its step's new number. Each author
 * migrated is marked `renumbered: "2026-10-12"`, so running it twice changes nothing.
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { STATE_FILE } from './lib-registry.mjs';
import { RENUMBER_2026_10_12 } from './steps.mjs';

const MARK = '2026-10-12';
const DROPPED = 'the coach is built and answers as the author';

/** Pure: the state with every author's sign-offs renumbered. Returns { state, changes }. */
export function migrateSignoffs(state, map = RENUMBER_2026_10_12) {
  const out = {};
  const changes = [];
  for (const [code, entry] of Object.entries(state || {})) {
    if (!entry || typeof entry !== 'object' || entry.renumbered === MARK || !entry.signoffs) {
      out[code] = entry;
      continue;
    }
    const signoffs = {};
    for (const [old, value] of Object.entries(entry.signoffs)) {
      const checks = (value && value.checks) || [];
      if (checks.length && checks.every((c) => c === DROPPED)) {
        changes.push(`${code}: step ${old} "${DROPPED}" — dropped (the IDs are the proof now)`);
        continue;
      }
      const to = map[Number(old)] ?? Number(old);
      if (signoffs[to]) throw new Error(`${code}: two sign-offs would land on step ${to} — stopping, nothing written`);
      signoffs[to] = value;
      if (to !== Number(old)) changes.push(`${code}: step ${old} → ${to} (${checks.join(', ')})`);
    }
    out[code] = { ...entry, signoffs, renumbered: MARK };
  }
  return { state: out, changes };
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) {
  if (!existsSync(STATE_FILE)) {
    console.log(`No ${STATE_FILE} — nothing to migrate.`);
    process.exit(0);
  }
  const before = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  const { state, changes } = migrateSignoffs(before);
  console.log(`\nSign-offs → the 2026-10-12 numbering${process.argv.includes('--write') ? '' : '   (DRY RUN)'}\n`);
  console.log(changes.length ? changes.map((c) => `  ${c}`).join('\n') : '  nothing to change');
  if (!process.argv.includes('--write')) {
    console.log('\nDry run only. Re-run with --write.\n');
    process.exit(0);
  }
  const backup = `${STATE_FILE}.bak-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}`;
  copyFileSync(STATE_FILE, backup);
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  console.log(`\nWritten. Backup: ${backup}\n`);
}
