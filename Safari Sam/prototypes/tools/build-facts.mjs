// Makes shared/facts.js from the compiled notes, for every creature named in shared/worlds.js.
// Run from the prototypes folder:  node tools/build-facts.mjs        (add --all to list every fact)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const notesPath = join(root, '..', 'Gerald Robbin', 'Gerald Robinson Kids', 'Notes', '1. BHLI-compiled-noref.md');

// Load worlds.js the way a browser would (it sets window.SAFARI).
const sandbox = { window: {} };
vm.runInNewContext(readFileSync(join(root, 'shared', 'worlds.js'), 'utf8'), sandbox);
const { worlds } = sandbox.window.SAFARI;

// Read every "**Creature: Name**" block and its question/answer pairs.
const norm = (s) => s.replace(/[‘’]/g, "'").trim().toLowerCase();
const entries = new Map();
let current = null;
let category = '';
for (const line of readFileSync(notesPath, 'utf8').split(/\r?\n/)) {
  const cat = line.match(/^## (.+?)\s*\(\d+\)\s*$/);
  if (cat) category = cat[1].replace(/^\S+\s/, '');
  const head = line.match(/^\*\*Creature: (.+?)\*\*/);
  if (head) {
    current = { name: head[1], category, facts: [] };
    entries.set(norm(head[1]), current);
    continue;
  }
  if (!current) continue;
  const q = line.match(/^The question:\s*(.+?)\s*$/);
  const a = line.match(/^The answer:\s*(.+?)\s*$/);
  if (q) current.facts.push({ q: q[1], a: '' });
  else if (a && current.facts.length) current.facts[current.facts.length - 1].a = a[1];
}

const clean = (s) => s.replace(/\*([^*]+)\*/g, '$1');
const out = {};
const missing = [];
const showAll = process.argv.includes('--all');
for (const w of worlds) {
  for (const c of w.creatures) {
    const entry = entries.get(norm(c.k));
    if (!entry) { missing.push(`${w.id}: ${c.k}`); continue; }
    const fact = entry.facts[c.f || 0] || entry.facts[0];
    out[c.k] = { cat: entry.category, q: clean(fact.q), a: clean(fact.a), more: entry.facts.length - 1 };
    if (showAll) entry.facts.forEach((f, i) => console.log(`${w.id} | ${c.k} [${i}] ${f.q} -> ${f.a}`));
  }
}

writeFileSync(join(root, 'shared', 'facts.js'),
  '/* Made by tools/build-facts.mjs from "1. BHLI-compiled-noref.md". Do not edit by hand. */\n' +
  'window.SAFARI_FACTS = ' + JSON.stringify(out, null, 1) + ';\n');
console.log(`facts.js: ${Object.keys(out).length} creatures`);
if (missing.length) console.log('Not found in the notes:\n  ' + missing.join('\n  '));
