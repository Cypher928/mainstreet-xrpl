'use strict';
/**
 * tools/leasehold-lifecycle-mutation.js — does the Step A-1 coverage actually
 * catch the defects it exists for?
 *
 *   node tools/leasehold-lifecycle-mutation.js
 *
 * Each mutant re-introduces one way the leasehold lifecycle could be lost,
 * re-derived, silently defaulted, or one way a leasehold could again be deleted
 * for leaving a list — in a throwaway copy of the tree. The suites below must
 * FAIL on every mutant. The unmutated copy must pass first, or nothing is run.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

const MUTANTS = [
  // ── the predicate ──
  { id: 'L01', file: 'leasehold-status.js', why: 'every leasehold reads current',
    from: 'function isCurrent(t)      { return !isEnded(t); }', to: 'function isCurrent(t)      { return true; }' },
  { id: 'L02', file: 'leasehold-status.js', why: 'the period roster ignores the period',
    from: '    return end >= start;', to: '    return true;' },
  { id: 'L03', file: 'leasehold-status.js', why: 'a leasehold ended ON the first day falls out of the period',
    from: '    return end >= start;', to: '    return end > start;' },
  { id: 'L04', file: 'leasehold-status.js', why: 'an unknown reason ("assigned") is kept',
    from: "ended_reason:     (ended && REASONS.indexOf(r.ended_reason) >= 0) ? r.ended_reason : null,",
    to:   "ended_reason:     ended ? r.ended_reason : null," },
  // ── the allow-list ──
  { id: 'L05', file: 'tenant-normalize.js', why: 'normalizeTenant drops the lifecycle — ended reads current after a reload',
    from: '      ..._lifecycle(d),\n', to: '' },
  // ── LeasePeriod ──
  { id: 'L06', file: 'lease-period.js', why: 'an ended leasehold is still apportioned by its contractual end_date',
    from: '      out.end           = endedAt;', to: '      out.end           = end.value;' },
  { id: 'L07', file: 'lease-period.js', why: 'a confirmed end is asked about anyway',
    from: 'lateStart || (earlyEnd && !endConfirmed) || out.assumedStart', to: 'lateStart || earlyEnd || out.assumedStart' },
  { id: 'L08', file: 'lease-period.js', why: 'ended-before-the-period is no longer its own case',
    from: '      if (ot.endedAt < p.start) {', to: '      if (false) {' },
  { id: 'L09', file: 'lease-period.js', why: 'an excluded leasehold is not reported as excluded',
    from: "if (c.case === 'ended_confirmed_before') { out.excluded = true; return out; }",
    to:   "if (c.case === 'ended_confirmed_before') { return out; }" },
  { id: 'L10', file: 'lease-period.js', why: 'ended with no ended_at is treated as covered, not unknown',
    from: '      if (!ot.endConfirmed) {', to: '      if (false) {' },
  { id: 'L11', file: 'reconciliation-engine.js', why: 'money allocated to a leasehold ended before the period raises nothing',
    from: "      if (c.case === 'ended_confirmed_before') {", to: '      if (false) {' },
  // ── consumers ──
  { id: 'L12', file: 'selectors.js', why: 'Selectors re-derives "current" as "not vacant"',
    from: 'const _isCurrentLease = (t) => _LS().isCurrentLease(t);', to: 'const _isCurrentLease = (t) => !!t && t.vacant !== true;' },
  { id: 'L13', file: 'acquisition-engine.js', why: 'lease alerts / renewals include ended leaseholds',
    from: '    if (!_isCurrent(t)) return false;\n', to: '' },
  { id: 'L14', file: 'acquisition-engine.js', why: 'the forecast counts ended rent as current rent',
    from: 'if (!t || t.extractionFailed || !_isCurrent(t)) continue;', to: 'if (!t || t.extractionFailed) continue;' },
  { id: 'L15', file: 'property-cabinet.js', why: 'an ended leasehold is an active tenant',
    from: 'return t && _LS().isCurrentLease(t) && (t.tenant_name || t.id);', to: 'return t && !isVacant(t) && (t.tenant_name || t.id);' },
  { id: 'L16', file: 'property-cabinet.js', why: 'an ended leasehold\'s space reads occupied',
    from: '        if (!vacant && _LS().isEnded(t)) {', to: '        if (false) {' },
  { id: 'L17', file: 'property-area.js', why: 'an ended leasehold still counts as leased area',
    from: 'return !!x && _LS().isCurrent(x);', to: 'return !!x;' },
  { id: 'L18', file: 'property-record.js', why: 'the record lists an ended leasehold among current spaces',
    from: 'return !(_tenants[i] && _LS().isEnded(_tenants[i]));', to: 'return true;' },
  { id: 'L19', file: 'property-record.js', why: 'the record forgets its ended leaseholds',
    from: '    if (ended.length) record.endedLeaseholds = ended;\n', to: '' },
  { id: 'L20', file: 'property-record.js', why: 'an ended leasehold\'s events fall through to the property',
    from: '      timeline:  _timeline(p, roster, deps),', to: '      timeline:  _timeline(p, spaces, deps),' },
  { id: 'L21', file: 'tenant-space.js', why: 'an ended leasehold still covers its space',
    from: '      if (_isEndedRow(t)) return;\n', to: '' },
  { id: 'L22', file: 'tenant-space.js', why: 'the Spaces list shows an ended leasehold as occupied',
    from: "if (_isEndedRow(t)) { row.status = 'ended';", to: "if (false) { row.status = 'ended';" },
  { id: 'L23', file: 'lease-review-packets.js', why: 'the lender summary counts ended leaseholds',
    from: "!t.extractionFailed && !t._error && _LS().isCurrent(t));", to: "!t.extractionFailed && !t._error);" },
  { id: 'L24', file: 'command-center.js', why: 'the Command Center counts ended leaseholds',
    from: '.filter(t => t && LS.isCurrent(t));', to: '.filter(t => t);' },
  { id: 'L25', file: 'property-reference.js', why: 'reference occupancy counts ended leaseholds',
    from: '      if (t && !LS.isCurrent(t)) return s;\n', to: '' },
  // ── script.js ──
  { id: 'L26', file: 'script.js', why: 'the CAM roster ignores the lifecycle',
    from: '    LS.inPeriodRoster(t, period) &&\n', to: '' },
  // Step A-2 moved D7 from script.js's findTenantMatch into the one rule every
  // upload consults, LeaseUploadIdentity.isEligibleTarget.
  { id: 'L27', file: 'lease-upload-identity.js', why: 'an upload can be proposed for an ended leasehold (D7)',
    from: "    if (!_LS().isCurrent(t)) return false;                      // ENDED is never a candidate\n", to: '' },
  { id: 'L28', file: 'script.js', why: 'Clear All deletes leaseholds again',
    from: "  document.getElementById('bulkLeaseInput').value = '';\n  if (lastResults.length > 0) { _resultsStale = true; _updateStaleResultsBanner(); }\n  await savePropertyData();\n}",
    to:   "  document.getElementById('bulkLeaseInput').value = '';\n  if (prop?.id) await db.from('tenants').delete().eq('property_id', prop.id);\n  if (lastResults.length > 0) { _resultsStale = true; _updateStaleResultsBanner(); }\n  await savePropertyData();\n}" },
  { id: 'L29', file: 'script.js', why: 'the direct fallback prunes absentees again',
    from: "  console.log('[resyncTenantsDirectly] fallback resync OK —', insertRows.length,",
    to:   "  await db.from('tenants').delete().in('id', ['absentee']);\n  console.log('[resyncTenantsDirectly] fallback resync OK —', insertRows.length," },
  { id: 'L30', file: 'script.js', why: 'the resync writes a lifecycle column',
    from: "      lease_type: t.lease_type || null,\n    }));\n\n  const { data, error } = await db.rpc('resync_property_tenants'",
    to:   "      lease_type: t.lease_type || null,\n      leasehold_status: t.leasehold_status || 'active',\n    }));\n\n  const { data, error } = await db.rpc('resync_property_tenants'" },
  { id: 'L31', file: 'script.js', why: 'the resync drops ended rows, so the live 039 RPC would prune them',
    from: ".filter(t => t && t.tenant_name && !t._pendingJobReview && t.id)\n    .map(t => ({\n      id:         t.id,",
    to:   ".filter(t => t && t.tenant_name && !t._pendingJobReview && t.id && t.leasehold_status !== 'ended')\n    .map(t => ({\n      id:         t.id," },
  { id: 'L32', file: 'script.js', why: 'the Cascade Commons reseed deletes before inserting again',
    from: "const { error: tenErr } = await db.from('tenants').upsert(tenantRows, { onConflict: 'id' }).select('id');",
    to:   "await db.from('tenants').delete().eq('property_id', DEMO_PROPERTY_ID);\n  const { error: tenErr } = await db.from('tenants').upsert(tenantRows, { onConflict: 'id' }).select('id');" },
  { id: 'L33', file: 'script.js', why: 'the blob wins over the table\'s lifecycle',
    from: '    if (r) Object.assign(t, window.LeaseholdStatus.lifecycleFrom(r));', to: '    if (r && false) Object.assign(t, window.LeaseholdStatus.lifecycleFrom(r));' },
  { id: 'L34', file: 'script.js', why: 'ending a leasehold does not make a saved run stale',
    from: "(window.LeaseholdStatus.isEnded(x) ? '|ended:'", to: "(false ? '|ended:'" },
  { id: 'L35', file: 'script.js', why: 'every fingerprint changes — every saved reconciliation would read stale',
    from: "(window.LeaseholdStatus.isEnded(x) ? '|ended:' + (window.LeaseholdStatus.endedAt(x) || '?') : '')",
    to:   "('|ended:' + (window.LeaseholdStatus.endedAt(x) || '?'))" },
  { id: 'L36', file: 'script.js', why: 'getValidTenants falls back to "current" when the module is missing',
    from: "  if (!LS) throw new Error('LeaseholdStatus is not loaded (leasehold-status.js must load before script.js)');\n  const period",
    to:   "  if (!LS) return (currentProperty()?.tenants || []).filter(t => t && t.vacant !== true && t.tenant_name);\n  const period" },
  { id: 'L37', file: 'script.js', why: 'the KPI header counts ended leaseholds',
    from: "(property.tenants || []).filter(t => t && t.tenant_name && window.LeaseholdStatus.isCurrent(t));",
    to:   "(property.tenants || []).filter(t => t && t.tenant_name);" },
  // ── server ──
  { id: 'L38', file: 'api/_property-record-hydrator.js', why: 'the hydrator does not lay the table lifecycle over the blob',
    from: '        if (r) Object.assign(t, LeaseholdStatus.lifecycleFrom(r));', to: '        if (false) Object.assign(t, LeaseholdStatus.lifecycleFrom(r));' },
  { id: 'L39', file: 'api/_property-record-hydrator.js', why: 'a pre-037 database is reported as degraded',
    from: "      if (!_isLifecycleColumnMissing(lRes.json)) degraded.push('tenants.lifecycle_read_failed');",
    to:   "      degraded.push('tenants.lifecycle_read_failed');" },
  { id: 'L40', file: 'api/_property-record-hydrator.js', why: 'a failed lifecycle read is silent',
    from: "      if (!_isLifecycleColumnMissing(lRes.json)) degraded.push('tenants.lifecycle_read_failed');",
    to:   "      /* silent */" },
  { id: 'L41', file: 'api/_property-record-hydrator.js', why: 'the table fallback does not retry without the 037 columns',
    from: '    if (tRes.status >= 300 && _isLifecycleColumnMissing(tRes.json)) {', to: '    if (false) {' },
  { id: 'L42', file: 'api/_mcp-capabilities.js', why: 'get_property drops the ended leaseholds',
    from: '    data.endedLeaseholds = rec.endedLeaseholds.map(e => Object.assign({}, e));', to: '    data._ended = null;' },
  { id: 'L43', file: 'portal.js', why: 'the portal has no pre-037 retry',
    from: '      sp = await db.from(\'tenants\').select(SPACE_COLUMNS);', to: '      /* no retry */' },
];

const MUTATED_FILES = [...new Set(MUTANTS.map(m => m.file))];
const SUITES = ['test-leasehold-status.js', 'test-lifecycle-plumbing.js', 'test-property-record-hydrator.js',
                'tools/leasehold-inert-golden.js'];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lhmut-'));
fs.cpSync(ROOT, tmp, {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(ROOT, src);
    return !(rel === '.git' || rel.startsWith('.git' + path.sep) ||
             rel === 'node_modules' || rel.startsWith('node_modules' + path.sep));
  },
});
const ORIGINAL = {};
for (const f of MUTATED_FILES) ORIGINAL[f] = fs.readFileSync(path.join(ROOT, f), 'utf8');

function runSuites() {
  for (const suite of SUITES) {
    try { execFileSync(process.execPath, [suite], { cwd: tmp, stdio: 'pipe', timeout: 300000 }); }
    catch (_) { return false; }
  }
  return true;
}

const baseline = runSuites();
console.log('Baseline (unmutated copy): ' + (baseline ? 'PASS' : 'FAIL'));
if (!baseline) {
  for (const suite of SUITES) {
    try { execFileSync(process.execPath, [suite], { cwd: tmp, stdio: 'pipe', timeout: 300000 }); }
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
  if (i === -1) { console.log(`  ??   ${m.id}  ANCHOR NOT FOUND in ${m.file}`); survived.push(m.id + ' (malformed)'); continue; }
  if (src.indexOf(m.from, i + 1) !== -1) console.log(`  ??   ${m.id}  ANCHOR NOT UNIQUE in ${m.file} — mutating only the first`);
  fs.writeFileSync(path.join(tmp, m.file), src.slice(0, i) + m.to + src.slice(i + m.from.length));
  const passedM = runSuites();
  fs.writeFileSync(path.join(tmp, m.file), src);
  if (passedM) { survived.push(`${m.id} ${m.file}: ${m.why}`); console.log(`  LIVE ${m.id}  ${m.why}`); }
  else         { killed++;                                    console.log(`  kill ${m.id}  ${m.why}`); }
}

console.log(`\n${killed}/${MUTANTS.length} killed`);
if (survived.length) {
  console.log('\nSURVIVORS — each needs a written verdict (real gap or equivalent):');
  survived.forEach(s => console.log('  · ' + s));
}
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(survived.length ? 1 : 0);
