'use strict';
/**
 * tools/property-leaseholds-mutation.js — do the P5-2 suites bite?
 *
 *   node tools/property-leaseholds-mutation.js
 *
 * The rule: an acquired property's Space file shows the documents filed into
 * its leasehold during the acquisition and says a person verified the terms —
 * joined on tenants.id = families.id, scoped to THIS property, live and
 * confirmed documents only, links only for the uploader, and nothing written.
 * Each mutant is a one-token edit that breaks one leg. Every one must be
 * caught by the unit suite or the browser suite.
 *
 * A FAILING BASELINE IS NOT A PASS.
 */
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PL = 'property-leaseholds.js', APP = 'script.js', TS = 'tenant-space.js';

const MUTANTS = [
  { id: 'L01', file: PL, why: 'the join is by tenant NAME instead of id — two "Vacant" leaseholds share documents',
    from: "    return !!doc && doc.family_id === familyId",
    to:   "    return !!doc && (doc.family_id === familyId || true)" },
  { id: 'L02', file: PL, why: 'superseded documents are back on file',
    from: "      && !doc.superseded_by_document_id\n",
    to:   "\n" },
  { id: 'L03', file: PL, why: 'a document merely PROPOSED for a leasehold (or unfiled) counts as on file',
    from: "      && doc.family_status === 'confirmed';",
    to:   "      && doc.family_status !== 'nothing';" },
  { id: 'L04', file: APP, why: 'the documents read is no longer scoped to the property',
    from: "      db.from('acquisition_documents').select(PL.SELECT.documents).eq('property_id', propertyId).order('created_at', { ascending: true }),",
    to:   "      db.from('acquisition_documents').select(PL.SELECT.documents).order('created_at', { ascending: true })," },
  { id: 'L05', file: APP, why: 'the acquired-only gate is gone: prospects (and rows not in the portfolio) load acquisition data',
    from: "      if (_managed) await loadPropertyLeaseholds(id, uid);",
    to:   "      await loadPropertyLeaseholds(id, uid);" },
  { id: 'L06', file: PL, why: 'a non-uploader gets a link the signed-url check would refuse',
    from: "      url:          mine ? d.storage_path : null,",
    to:   "      url:          d.storage_path," },
  { id: 'L07', file: PL, why: 'decisions are not grouped by leasehold — every leasehold gets them all',
    from: "      var theirs = decs.filter(function (d) { return d.family_id === f.id; })",
    to:   "      var theirs = decs.filter(function (d) { return true; })" },
  { id: 'L08', file: PL, why: 'build() keeps rows that name ANOTHER property — cross-property leakage',
    from: "    return row.property_id == null || row.property_id === propertyId;",
    to:   "    return true;" },
  { id: 'L09', file: TS, why: 'the Space file ignores the leasehold documents',
    from: "    if (leasehold) {\n      (leasehold.documents || []).forEach(function (d) {",
    to:   "    if (false) {\n      (leasehold.documents || []).forEach(function (d) {" },
  { id: 'L10', file: APP, why: 'the loader filters on user_id — an organisation member loses the read',
    from: "      db.from('acquisition_document_families').select(PL.SELECT.families).eq('property_id', propertyId).order('created_at', { ascending: true }),",
    to:   "      db.from('acquisition_document_families').select(PL.SELECT.families).eq('property_id', propertyId).eq('user_id', currentUid).order('created_at', { ascending: true })," },
  { id: 'L11', file: TS, why: 'the verification line is shown with zero decisions',
    from: "    var acqLineHtml = (_lhSum && _lhSum.count > 0)",
    to:   "    var acqLineHtml = (_lhSum && _lhSum.count >= 0)" },
  // EQUIVALENT BY CONSTRUCTION, kept as documentation. The map is keyed by
  // property uuid and set() refuses a projection built for another property
  // (L14), so an entry whose propertyId differs from its key cannot exist and
  // the guard inside forTenant() can never observe a mismatch. Removing it
  // changes no reachable behaviour; it is defence in depth. Reported, not
  // counted as a survivor.
  { id: 'L12', file: PL, equivalent: 'unreachable through the public API: set() refuses mismatched projections (L14 is killed)',
    why: 'the map answers a tenant id under ANY property (keyed by tenant, not property)',
    from: "    return (e && e.propertyId === propertyId) ? e : null;",
    to:   "    return e || null;" },
  { id: 'L13', file: APP, why: 'the entry is not cleared before the read — a stale set shows while the query is pending',
    from: "  PL.clear(propertyId);\n  const rows = (r) =>",
    to:   "  const rows = (r) =>" },
  { id: 'L14', file: PL, why: 'set() accepts a projection built for another property',
    from: "    if (built.propertyId && built.propertyId !== propertyId) return false;",
    to:   "" },
  { id: 'L15', file: TS, why: 'assemble() reads the leasehold from a global "current" property instead of the one being rendered',
    from: "      ? (_PL.forTenant(property.id, tenantId) || null) : null;",
    to:   "      ? (_PL.forTenant((window.currentProperty && window.currentProperty() || property).id, tenantId) || null) : null;" },
  { id: 'L16', file: APP, why: 'the loader asks for the document text and the abstracted evidence',
    from: "      db.from('acquisition_documents').select(PL.SELECT.documents)",
    to:   "      db.from('acquisition_documents').select('*')" },
  { id: 'L17', file: TS, why: 'NEGATIVE CONTROL — the records count text starts counting lease documents (scope creep P5-2 deferred)',
    from: "    if (c.events) bits.push(c.events + ' event' + (c.events !== 1 ? 's' : ''));",
    to:   "    if (c.events) bits.push(c.events + ' event' + (c.events !== 1 ? 's' : ''));\n    if (c.leaseDocs) bits.push(c.leaseDocs + ' lease docs');" },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plmut-'));
fs.cpSync(ROOT, tmp, { recursive: true, filter: (src) => { const rel = path.relative(ROOT, src); return !(rel === '.git' || rel.startsWith('.git' + path.sep) || rel === 'node_modules' || rel.startsWith('node_modules' + path.sep)); } });
try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(tmp, 'node_modules'), 'dir'); } catch (_) {}
const ORIGINAL = {};
for (const f of [PL, APP, TS]) ORIGINAL[f] = fs.readFileSync(path.join(ROOT, f), 'utf8');

// The pure suite first (cheap); the browser suite only when it survives that.
const SUITES = ['test-property-leaseholds.js', 'test-e2e-property-leaseholds.js'];
function runSuites() {
  for (const suite of SUITES) {
    try { execFileSync(process.execPath, [suite], { cwd: tmp, stdio: 'pipe', timeout: 600000 }); }
    catch (_) { return suite; }
  }
  return null;
}

const baseline = runSuites();
console.log('Baseline (unmutated copy): ' + (baseline ? 'FAIL ' + baseline : 'PASS'));
if (baseline) { console.error('\nThe unmutated copy does not pass, so every result below would be meaningless. Nothing is mutated.'); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(2); }

let killed = 0; const survivors = [], equivalents = [];
for (const m of MUTANTS) {
  const src = ORIGINAL[m.file];
  if (src.indexOf(m.from) === -1) { console.log(`  ?  ${m.id} anchor not found in ${m.file} — the harness is stale, not the product`); survivors.push(m.id + ' (anchor missing)'); continue; }
  fs.writeFileSync(path.join(tmp, m.file), src.replace(m.from, m.to));
  const failedBy = runSuites();
  fs.writeFileSync(path.join(tmp, m.file), ORIGINAL[m.file]);
  if (failedBy) { killed++; console.log(`  \x1b[32m☠\x1b[0m  ${m.id} killed by ${failedBy} — ${m.why}`); }
  else if (m.equivalent) { equivalents.push(m.id); console.log(`  \x1b[33m≡\x1b[0m  ${m.id} equivalent (survived, as expected) — ${m.equivalent}`); }
  else { survivors.push(m.id); console.log(`  \x1b[31m✗\x1b[0m  ${m.id} SURVIVED — ${m.why}`); }
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log('\n' + '─'.repeat(58));
console.log(`${killed} killed, ${equivalents.length} equivalent, ${survivors.length} survived of ${MUTANTS.length}`);
if (survivors.length) { survivors.forEach(s => console.log('  · ' + s)); process.exit(1); }
