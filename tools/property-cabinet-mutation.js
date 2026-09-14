'use strict';
/**
 * tools/property-cabinet-mutation.js — do the Phase 0 foundations hold?
 *
 *   node tools/property-cabinet-mutation.js
 *
 * The cabinet is one map and a handful of predicates that every V2 surface
 * will trust. Each mutant is a plausible way of getting one wrong — and four
 * of them (P13–P16) are the exact omission that kept property.info demo-only
 * for the life of the product, restored one site at a time so the e2e must
 * catch EACH site independently.
 *
 *   P01  the category map is ignored — every record falls back to History
 *   P02  a system subject wins over the record's own category
 *   P03  a suite-scoped record is treated as the property's
 *   P04  an invoice's spaceId is ignored — every invoice is the property's
 *   P05  History counts every record — the tiles double-count
 *   P06  invoiceQuery includes space-scoped invoices by default
 *   P07  invoiceQuery sorts oldest first (undated float to the top)
 *   P08  importantDates ignores the horizon
 *   P09  importantDates lists a VACANT row's end_date as a lease expiration
 *   P10  importantDates invents an entry for an unreadable date
 *   P11  isVacant is truthy rather than strictly boolean
 *   P12  normalizeTenant drops `vacant` — the allow-list omission
 *   P13  saveProperty's payload drops info
 *   P14  loadPropertyData's projection drops info
 *   P15  the merge drops info
 *   P16  selectProperty never applies info
 *   P17  parseAddress loses the year
 *   P18  a manual record is read from its type, not its category
 *   P19  the merge discards a local-only info when the server has none
 *
 * A FAILING BASELINE IS NOT A PASS. The unmutated copy is asserted before any
 * mutant runs and the harness exits non-zero if it fails.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

const CAT_LOOKUP   = "      if (key && CATEGORY_DRAWER[key]) return { drawer: CATEGORY_DRAWER[key], reason: 'category' };";
const KEY_READ     = "    var key = recordKey(ev);";
const MANUAL_KEY   = "    if (ev.manual) return (ev.category != null && ev.category !== '') ? String(ev.category) : stripped;";
const SCOPE_SUITE  = "    if (t === 'property' || t === 'system') return 'property';";
const INV_SPACE    = "    return inv.spaceId ? null : 'invoices';";
const HISTORY_ONCE = "      if (filed.drawer !== 'history') {";
const QUERY_SPACE  = "      else if (i.spaceId) return false;";
const QUERY_SORT   = "      return tb - ta;";
const HORIZON      = "      if (horizon != null && days > horizon) return;";
const VACANT_DATE  = "      if (!t || isVacant(t) || !t.end_date) return;";
const BAD_DATE     = "      if (!d || isNaN(d.getTime())) return;                 // no date, no entry";
const IS_VACANT    = "  function isVacant(t) { return !!(t && t.vacant === true); }";
const TN_VACANT    = "      vacant:              d.vacant === true,";
const SAVE_INFO    = "      info:              (stripped.info && typeof stripped.info === 'object') ? stripped.info : null,";
const LOAD_INFO    = "        info:              (d.info && typeof d.info === 'object') ? d.info : null,";
const MERGE_INFO   = "    info:              (dbData.info && typeof dbData.info === 'object') ? dbData.info : (base.info ?? null),";
const SELECT_INFO  = "    property.info              = (data.info && typeof data.info === 'object') ? data.info : (property.info ?? null);";
const PARSE_YEAR   = "      if (parts[2] && parts[2] !== '-') out.year = parts[2];";

const MUTANTS = [
  { id: 'P01', file: 'property-cabinet.js', why: 'the category map is ignored — everything falls back',
    from: CAT_LOOKUP, to: '      if (false) {}' },
  { id: 'P02', file: 'property-cabinet.js', why: 'a system subject wins over the record’s own category',
    from: KEY_READ,
    to: "    if (ev.subject && ev.subject.type === 'system') return { drawer: 'building', reason: 'system' };\n" + KEY_READ },
  { id: 'P03', file: 'property-cabinet.js', why: 'a suite-scoped record is treated as the property’s',
    from: SCOPE_SUITE, to: "    if (t === 'property' || t === 'system' || t === 'suite') return 'property';" },
  { id: 'P04', file: 'property-cabinet.js', why: 'an invoice’s spaceId is ignored',
    from: INV_SPACE, to: "    return 'invoices';" },
  { id: 'P05', file: 'property-cabinet.js', why: 'History counts every record — the tiles double-count',
    from: HISTORY_ONCE, to: "      bump('history', ptr.year);\n      if (filed.drawer !== 'history') {" },
  { id: 'P06', file: 'property-cabinet.js', why: 'space-scoped invoices leak into the property drawer',
    from: QUERY_SPACE, to: '      else if (false) return false;' },
  { id: 'P07', file: 'property-cabinet.js', why: 'invoices sort oldest first, undated on top',
    from: QUERY_SORT, to: '      return ta - tb;' },
  { id: 'P08', file: 'property-cabinet.js', why: 'the horizon is ignored',
    from: HORIZON, to: '      if (false) return;' },
  { id: 'P09', file: 'property-cabinet.js', why: 'a vacant row’s date is listed as a lease expiration',
    from: VACANT_DATE, to: '      if (!t || !t.end_date) return;' },
  { id: 'P10', file: 'property-cabinet.js', why: 'an unreadable date is invented into an entry',
    from: BAD_DATE, to: '      if (!d) return;' },
  { id: 'P11', file: 'property-cabinet.js', why: 'isVacant is truthy, so the string "true" is vacant',
    from: IS_VACANT, to: '  function isVacant(t) { return !!(t && t.vacant); }' },
  { id: 'P12', file: 'tenant-normalize.js', why: 'normalizeTenant drops vacant — THE ALLOW-LIST OMISSION',
    from: TN_VACANT, to: '' },
  { id: 'P13', file: 'script.js', why: 'the save payload drops info',
    from: SAVE_INFO, to: '' },
  { id: 'P14', file: 'script.js', why: 'the load projection drops info',
    from: LOAD_INFO, to: '' },
  { id: 'P15', file: 'script.js', why: 'the merge drops info',
    from: MERGE_INFO, to: '' },
  { id: 'P16', file: 'script.js', why: 'selectProperty never applies info',
    from: SELECT_INFO, to: '' },
  { id: 'P17', file: 'property-cabinet.js', why: 'parseAddress loses the year',
    from: PARSE_YEAR, to: '      if (false) out.year = parts[2];' },
  { id: 'P18', file: 'property-cabinet.js', why: 'a manual record is read from its type, not its category — the cabinet and the timeline disagree',
    from: MANUAL_KEY, to: '    if (ev.manual) return stripped;' },
  { id: 'P19', file: 'script.js', why: 'the merge discards a local-only info when the server has none',
    from: MERGE_INFO, to: "    info:              (dbData.info && typeof dbData.info === 'object') ? dbData.info : null," },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cabmut-'));
fs.cpSync(ROOT, tmp, {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(ROOT, src);
    return !(rel === '.git' || rel.startsWith('.git' + path.sep) ||
             rel === 'node_modules' || rel.startsWith('node_modules' + path.sep));
  },
});
const FILES = [...new Set(MUTANTS.map(m => m.file))];
const ORIGINAL = {};
for (const f of FILES) ORIGINAL[f] = fs.readFileSync(path.join(ROOT, f), 'utf8');

// The pure suite owns the map and the predicates; the e2e owns persistence.
// Both run for every mutant so a persistence mutant cannot survive by only
// breaking something the pure suite never sees, and vice versa.
const SUITES = ['test-property-cabinet.js', 'test-e2e-property-foundations.js'];
function runSuites() {
  for (const suite of SUITES) {
    try {
      execFileSync(process.execPath, [suite], { cwd: tmp, stdio: 'pipe', timeout: 900000 });
    } catch (_) { return false; }
  }
  return true;
}

const baseline = runSuites();
console.log('Baseline (unmutated copy): ' + (baseline ? 'PASS' : 'FAIL'));
if (!baseline) {
  console.error('\nThe unmutated copy does not pass, so every result below would be\n' +
                'meaningless. Nothing is mutated. Fix the harness or the suites first.');
  for (const suite of SUITES) {
    try { execFileSync(process.execPath, [suite], { cwd: tmp, stdio: 'pipe', timeout: 900000 }); }
    catch (e) { console.error('\n── ' + suite + ' ──\n' + String(e.stdout || e.message).slice(-3000)); }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(2);
}

let killed = 0;
const survived = [];
for (const m of MUTANTS) {
  const src = ORIGINAL[m.file];
  const i = src.indexOf(m.from);
  if (i === -1) {
    console.log(`  ??   ${m.id}  ANCHOR NOT FOUND in ${m.file} — malformed mutant`);
    survived.push(m.id + ' (malformed)');
    continue;
  }
  if (src.indexOf(m.from, i + 1) !== -1) {
    console.log(`  ??   ${m.id}  ANCHOR NOT UNIQUE in ${m.file} — mutating only the first`);
  }
  if (m.to === m.from) { console.log(`  ??   ${m.id}  NO-OP MUTANT`); survived.push(m.id + ' (no-op)'); continue; }
  fs.writeFileSync(path.join(tmp, m.file), src.slice(0, i) + m.to + src.slice(i + m.from.length));
  const passedM = runSuites();
  fs.writeFileSync(path.join(tmp, m.file), src);
  if (passedM) { survived.push(`${m.id} (${m.file}): ${m.why}`); console.log(`  LIVE ${m.id}  ${m.why}`); }
  else         { killed++;                                      console.log(`  kill ${m.id}  ${m.why}`); }
}

console.log(`\n${killed}/${MUTANTS.length} killed`);
if (survived.length) {
  console.log('\nSURVIVORS — each needs a written verdict (real gap or equivalent):');
  survived.forEach(s => console.log('  · ' + s));
}
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(survived.length ? 1 : 0);
