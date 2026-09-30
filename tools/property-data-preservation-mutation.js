'use strict';
/**
 * tools/property-data-preservation-mutation.js — does the preservation suite bite?
 *
 *   node tools/property-data-preservation-mutation.js
 *
 * The rule: server-owned keys in properties.data (acquiredFrom, _p3Backfill,
 * an invoice's sourceEpisodeId / acquiredAt) survive an ordinary property
 * save, and the client-owned keys are still the client's. Each mutant is a
 * one-token edit that breaks one leg of that rule. The suite must object to
 * every one.
 *
 * A FAILING BASELINE IS NOT A PASS.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const APP  = 'script.js';
const POS  = 'property-os.js';

const MUTANTS = [
  { id: 'P01', file: APP, why: 'saveProperty forgets the server-owned keys (the Maple bug, verbatim)',
    from: "      ..._serverOwnedDataKeys(stripped._serverOwned),\n      invoices:          stripped.invoices          || [],",
    to:   "      invoices:          stripped.invoices          || []," },
  { id: 'P02', file: APP, why: 'the server-owned spread comes AFTER the client keys, so a stale server bag could override what the client just wrote',
    from: "      ..._serverOwnedDataKeys(stripped._serverOwned),\n      invoices:          stripped.invoices          || [],",
    to:   "      invoices:          stripped.invoices          || []," ,
    also: { from: "      pendingLeaseUploads: Array.isArray(stripped.pendingLeaseUploads) ? stripped.pendingLeaseUploads : [],\n    };",
            to:   "      pendingLeaseUploads: Array.isArray(stripped.pendingLeaseUploads) ? stripped.pendingLeaseUploads : [],\n      ..._serverOwnedDataKeys(stripped._serverOwned),\n    };" } },
  { id: 'P03', file: APP, why: 'the helper stops filtering: a client key smuggled into _serverOwned is written',
    from: "    if (PROPERTY_DATA_CLIENT_KEYS.indexOf(k) === -1) out[k] = blob[k];",
    to:   "    out[k] = blob[k];" },
  { id: 'P04', file: APP, why: 'loadPropertyData no longer projects the server-owned keys from the database row',
    from: "        _serverOwned:      _serverOwnedDataKeys(d),",
    to:   "        _serverOwned:      {}," },
  { id: 'P05', file: APP, why: 'the local/database merge drops the server-owned keys',
    from: "    _serverOwned:      _serverOwnedDataKeys(dbData._serverOwned),\n  };",
    to:   "  };" },
  { id: 'P06', file: APP, why: 'the merge lets a stale local copy supply the server-owned keys',
    from: "    _serverOwned:      _serverOwnedDataKeys(dbData._serverOwned),",
    to:   "    _serverOwned:      _serverOwnedDataKeys(base._serverOwned || dbData._serverOwned)," },
  { id: 'P07', file: APP, why: 'selectProperty never carries _serverOwned onto the live record',
    from: "    if (data._serverOwned && typeof data._serverOwned === 'object') property._serverOwned = data._serverOwned;",
    to:   "" },
  { id: 'P08', file: APP, why: '_stripBlobs drops sourceEpisodeId again',
    from: "      sourceEpisodeId: inv.sourceEpisodeId,\n      acquiredAt:      inv.acquiredAt,",
    to:   "      acquiredAt:      inv.acquiredAt," },
  { id: 'P09', file: APP, why: '_stripBlobs drops acquiredAt again',
    from: "      sourceEpisodeId: inv.sourceEpisodeId,\n      acquiredAt:      inv.acquiredAt,",
    to:   "      sourceEpisodeId: inv.sourceEpisodeId," },
  { id: 'P10', file: APP, why: 'the constant claims acquiredFrom for the client, so the server\'s marker is dropped as "client-owned"',
    from: "  'tenants', 'escrowReserves', 'drawRequests', 'info', 'pendingLeaseUploads',\n]);",
    to:   "  'tenants', 'escrowReserves', 'drawRequests', 'info', 'pendingLeaseUploads', 'acquiredFrom',\n]);" },
  { id: 'P11', file: APP, why: 'the constant forgets a client key (timeline), so the save literal and the constant disagree and the blob\'s stale timeline rides in the server bag',
    from: "  'settlement', 'aiDrafts', '_demoVersion', '_demoV', 'activityLog', 'timeline',",
    to:   "  'settlement', 'aiDrafts', '_demoVersion', '_demoV', 'activityLog'," },
  { id: 'P12', file: APP, why: 'NEGATIVE CONTROL — the helper returns the whole blob for an array input',
    from: "  if (!blob || typeof blob !== 'object' || Array.isArray(blob)) return out;",
    to:   "  if (!blob || typeof blob !== 'object') return out;" },
  // ── P5-0: the database is the base ───────────────────────────────────────
  { id: 'M01', file: APP, why: 'P5-0: the old rule is back — a local copy with more tenants replaces the database roster',
    from: "    tenants:           [...(dbData.tenants || []), ..._lsOnlyTenants],",
    to:   "    tenants:           ((lsData.tenants || []).length > (dbData.tenants || []).length) ? lsData.tenants : [...(dbData.tenants || []), ..._lsOnlyTenants]," },
  { id: 'M02', file: APP, why: 'P5-0: every local copy is treated as unsynced, so a stale copy adds its ghost rows',
    from: "  const _lsUnsynced = lsData._unsynced === true;",
    to:   "  const _lsUnsynced = true;" },
  { id: 'M03', file: APP, why: 'P5-0: a flagged local copy re-adds tenants the database already has (no id dedupe)',
    from: "    ? (lsData.tenants || []).filter(t => t && t.id && !_dbTenantIds.has(t.id))",
    to:   "    ? (lsData.tenants || []).filter(t => t && t.id)" },
  { id: 'M04', file: APP, why: 'P5-0: a flagged local copy re-adds invoices the database already has (no key dedupe)',
    from: "    ? (lsData.invoices || []).filter(i => { const k = _invKey(i); return k && !_dbInvKeys.has(k); })",
    to:   "    ? (lsData.invoices || []).filter(i => !!_invKey(i))" },
  { id: 'M05', file: APP, why: 'P5-0: a failed write no longer flags the local copy, so the edit it holds is never recovered',
    from: "    _lsMarkUnsynced(property?.id, true);",
    to:   "    _lsMarkUnsynced(property?.id, false);" },
  // ── P5-1: save only when dirty ───────────────────────────────────────────
  { id: 'M06', file: APP, why: 'P5-1: the leaving flush is unconditional again — every navigation rewrites the previous property',
    from: "    if (leavingProp && (_saveDebounceTimer || leavingProp._dirty === true)) {",
    to:   "    if (leavingProp) {" },
  { id: 'M07', file: APP, why: 'P5-1: backToPortfolio saves unconditionally again',
    from: "      if (_saveDebounceTimer || prop._dirty === true) {",
    to:   "      if (true) {" },
  { id: 'M08', file: POS, why: 'P5-1: PropertyOS saves on open again whenever it minted an invoice id (the Maple write)',
    from: "    try { ensureInvoiceIds(property); } catch (_) {}",
    to:   "    try { if (ensureInvoiceIds(property) && window.savePropertyData) window.savePropertyData(); } catch (_) {}" },
  { id: 'M09', file: APP, why: 'P5-1: edits no longer mark the record dirty, so a failed debounced save is never retried on leave',
    from: "    prop._dirty = true;\n\n    // Debounce: collapse rapid successive saves",
    to:   "\n    // Debounce: collapse rapid successive saves" },
  { id: 'M10', file: APP, why: 'P5-1: a successful save no longer marks the record clean, so leaving writes a second identical copy',
    from: "      property._dirty = false;\n      _lsMarkUnsynced(id, false);",
    to:   "      _lsMarkUnsynced(id, false);" },
  { id: 'M11', file: APP, why: 'P5-1: hydration marks the record dirty, so merely opening a property saves it on the way out',
    from: "    if (data._serverOwned && typeof data._serverOwned === 'object') property._serverOwned = data._serverOwned;",
    to:   "    if (data._serverOwned && typeof data._serverOwned === 'object') property._serverOwned = data._serverOwned;\n    property._dirty = true;" },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pdpmut-'));
fs.cpSync(ROOT, tmp, { recursive: true, filter: (src) => { const rel = path.relative(ROOT, src); return !(rel === '.git' || rel.startsWith('.git' + path.sep) || rel === 'node_modules' || rel.startsWith('node_modules' + path.sep)); } });
const ORIGINAL = {};
for (const f of [APP, POS]) ORIGINAL[f] = fs.readFileSync(path.join(ROOT, f), 'utf8');

const SUITES = ['test-property-data-preservation.js'];
function runSuites() {
  const failed = [];
  for (const suite of SUITES) {
    try { execFileSync(process.execPath, [suite], { cwd: tmp, stdio: 'pipe', timeout: 600000 }); }
    catch (_) { failed.push(suite); }
  }
  return failed;
}

const baseline = runSuites();
console.log('Baseline (unmutated copy): ' + (baseline.length ? 'FAIL ' + baseline.join(', ') : 'PASS'));
if (baseline.length) {
  console.error('\nThe unmutated copy does not pass, so every result below would be meaningless. Nothing is mutated.');
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(2);
}

let killed = 0, survived = 0;
const survivors = [];
for (const m of MUTANTS) {
  let src = ORIGINAL[m.file];
  const anchors = [m].concat(m.also ? [m.also] : []);
  if (anchors.some(a => src.indexOf(a.from) === -1)) {
    console.log(`  ?  ${m.id} anchor not found in ${m.file} — the harness is stale, not the product`);
    survived++; survivors.push(m.id + ' (anchor missing)');
    continue;
  }
  anchors.forEach(a => { src = src.replace(a.from, a.to); });
  fs.writeFileSync(path.join(tmp, m.file), src);
  const failed = runSuites();
  fs.writeFileSync(path.join(tmp, m.file), ORIGINAL[m.file]);
  if (failed.length) { killed++; console.log(`  \x1b[32m☠\x1b[0m  ${m.id} killed by ${failed.join(', ')} — ${m.why}`); }
  else { survived++; survivors.push(m.id); console.log(`  \x1b[31m✗\x1b[0m  ${m.id} SURVIVED — ${m.why}`); }
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('\n' + '─'.repeat(58));
console.log(`${killed} killed, ${survived} survived of ${MUTANTS.length}`);
if (survived) { survivors.forEach(s => console.log('  · ' + s)); process.exit(1); }
