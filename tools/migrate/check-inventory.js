'use strict';
/**
 * tools/migrate/check-inventory.js — every catalog line that changed must be one
 * the migration names. Mechanical version of the "explain every difference" rule.
 *
 *   node tools/migrate/check-inventory.js <name> <before.json|txt> <after.json|txt>
 *
 * before/after are the connector's results for tools/migrate/sql/inventory.sql
 * (JSON array of {cat, x}; wrapper text tolerated) or files of "cat|x" lines.
 * For each added or removed line the object is identified — a function, policy
 * or trigger by name, a grant row by table — and must appear in the migration
 * text. Any change the migration does not mention is UNEXPLAINED and the check
 * fails. Exit 0 = every change explained; exit 1 = stop and report.
 */
const fs = require('fs');
const path = require('path');
const [, , name, beforeFile, afterFile] = process.argv;
if (!name || !beforeFile || !afterFile || !/^[0-9]{3}[a-z]?_[A-Za-z0-9_]+$/.test(name)) { console.error('usage: check-inventory.js <NNN_snake_case> <before> <after>'); process.exit(64); }
const load = (f) => {
  const raw = fs.readFileSync(f, 'utf8');
  const i = raw.indexOf('[{'), j = raw.lastIndexOf('}]');
  if (i !== -1 && j !== -1) return new Set(JSON.parse(raw.slice(i, j + 2)).map(r => r.cat + '|' + r.x));
  return new Set(raw.split('\n').filter(Boolean));
};
const before = load(beforeFile), after = load(afterFile);
const removed = [...before].filter(l => !after.has(l)), added = [...after].filter(l => !before.has(l));
const migration = fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', `${name}.sql`), 'utf8').replace(/--[^\n]*/g, '').toLowerCase();
const ident = (line) => {
  const [cat, a, b] = line.split('|');
  if (cat === 'fn') return a.replace(/\(.*$/, '').replace(/^public\./, '');          // function name
  if (cat === 'pol') return b;                                                        // policy name
  if (cat === 'trg') return b;                                                        // trigger name
  if (cat === 'pri') return a.replace(/^public\.|^storage\./, '');                    // table name (grant rows)
  return a;
};
const explained = (line) => { const id = ident(line).toLowerCase(); return id && migration.includes(id); };
const unexplained = [...removed.map(l => ['removed', l]), ...added.map(l => ['added', l])].filter(([, l]) => !explained(l));
const tally = (arr) => { const t = {}; for (const l of arr) { const c = l.split('|')[0]; t[c] = (t[c] || 0) + 1; } return Object.entries(t).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'; };
console.log(`inventory diff for ${name}: removed ${removed.length} (${tally(removed)}), added ${added.length} (${tally(added)}); unchanged ${[...before].filter(l => after.has(l)).length}`);
if (unexplained.length) {
  console.log(`UNEXPLAINED changes (${unexplained.length}) — not named anywhere in migrations/${name}.sql:`);
  unexplained.forEach(([how, l]) => console.log(`  ${how}: ${l.slice(0, 160)}`));
  process.exit(1);
}
console.log('EXPLAINED: every added or removed line names an object the migration mentions.');
