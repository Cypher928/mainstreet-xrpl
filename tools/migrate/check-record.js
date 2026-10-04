'use strict';
/**
 * tools/migrate/check-record.js — the post-apply record check, made mechanical.
 *
 *   node tools/migrate/check-record.js <name> <record-result.json> --expect-rows N --key UUID
 *
 * <record-result.json> is what the Supabase connector returned for
 * tools/migrate/sql/record.sql (the JSON array of {k, v} rows; the connector's
 * wrapper text around it is tolerated). The check passes only when ALL hold:
 *   · the Pilot marker property is present (we are reading Pilot);
 *   · exactly one history row is named <name>;
 *   · its recorded text hashes to the approval's sql_md5 and has sql_bytes bytes;
 *   · it is a single statement, is the newest row, and carries an idempotency key
 *     (equal to --key when given);
 *   · --expect-rows, when given, equals the history row count (before + 1).
 * Exit 0 = verified; exit 1 = NOT verified (the reason is printed). A report of
 * success is not written until this exits 0.
 */
const fs = require('fs');
const path = require('path');
const [, , name, file, ...rest] = process.argv;
if (!name || !file || !/^[0-9]{3}[a-z]?_[A-Za-z0-9_]+$/.test(name)) { console.error('usage: check-record.js <NNN_snake_case> <record-result.json> [--expect-rows N] [--key UUID]'); process.exit(64); }
const opt = (f) => { const i = rest.indexOf(f); return i === -1 ? null : rest[i + 1]; };
const approvalPath = path.join(__dirname, 'approvals', `${name}.approval`);
if (!fs.existsSync(approvalPath)) { console.error(`no approval on record for ${name}`); process.exit(1); }
const approval = Object.fromEntries(fs.readFileSync(approvalPath, 'utf8').split('\n').filter(l => l && !l.startsWith('#') && l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const raw = fs.readFileSync(file, 'utf8');
const i = raw.indexOf('['), j = raw.lastIndexOf(']');
if (i === -1 || j === -1) { console.error('no JSON array found in ' + file); process.exit(1); }
const rows = JSON.parse(raw.slice(i, j + 1));
const kv = Object.fromEntries(rows.map(r => [r.k, String(r.v)]));
const problems = [];
const need = (cond, msg) => { if (!cond) problems.push(msg); };
need(kv['project marker present (Pilot only)'] === '1', 'Pilot marker property not present: this is not Pilot, or the query ran elsewhere');
need(kv[`rows named ${name}`] === '1', `rows named ${name}: ${kv[`rows named ${name}`]} (want exactly 1)`);
const detail = kv['row detail'] || 'none';
need(detail !== 'none' && !detail.includes(' ;; '), 'row detail missing or more than one row');
const m = {}; for (const part of detail.split(' | ')) { const mm = part.match(/^([\w ]+)=(.*)$/); if (mm) m[mm[1]] = mm[2]; }
need(m.statements === '1', `statements=${m.statements} (want 1: the file as one statement)`);
need(m.md5 === approval.sql_md5, `recorded md5 ${m.md5} ≠ approved ${approval.sql_md5}`);
need(m.sha256 === approval.sql_sha256, `recorded sha256 ${m.sha256} ≠ approved ${approval.sql_sha256}`);
need(m.bytes === approval.sql_bytes, `recorded bytes ${m.bytes} ≠ approved ${approval.sql_bytes}`);
need(m['created_by set'] === 'true', 'created_by is not set');
need(m.idem && m.idem !== 'null' && /^[0-9a-f-]{36}$/.test(m.idem), `idempotency_key missing or malformed (${m.idem})`);
// The two expectations that do NOT come from the approval file come from the operator, never from
// the output under test: the key the apply script printed, and the history count read BEFORE the
// apply plus one. Both are required so a verification cannot pass on weaker evidence.
const key = opt('--key'); const expectRows = opt('--expect-rows');
if (!key || !/^[0-9a-f-]{36}$/.test(key)) { console.error('--key <UUID the apply script printed> is required'); process.exit(64); }
if (!expectRows || !/^\d+$/.test(expectRows)) { console.error('--expect-rows <history rows before the apply + 1> is required'); process.exit(64); }
need(m.idem === key, `idempotency_key ${m.idem} ≠ the key the script printed ${key}`);
need(kv['is the newest row'] === 'true', 'the migration row is not the newest');
need(kv['migration rows'] === String(expectRows), `migration rows ${kv['migration rows']} ≠ expected ${expectRows}`);
need(/^\d+ \S+ md5=[0-9a-f]{32}$/.test(kv['previous newest row'] || ''), 'previous newest row not reported');
if (problems.length) { console.log(`NOT VERIFIED: ${name}`); problems.forEach(p => console.log('  · ' + p)); process.exit(1); }
console.log(`VERIFIED: ${name} recorded once on Pilot as version ${detail.split(' | ')[0]}, md5 ${m.md5}, sha256 ${m.sha256}, ${m.bytes} bytes, key ${m.idem}; history rows ${kv['migration rows']}; previous newest ${kv['previous newest row']}`);
