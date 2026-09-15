'use strict';
/**
 * tools/space-identity-mutation.js — does the isolation suite actually bite?
 *
 *   node tools/space-identity-mutation.js
 *
 * Each mutant reinstates a plausible version of the neighbour-leak, or breaks
 * the valid-id behaviour the fix had to preserve. Both focused suites are run
 * against each mutant, because the rule lives at the canonical boundary and its
 * consequences are asserted in two places.
 *
 * Applied to a COPY in a scratch directory; the working tree is never touched.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const FILES = ['tenant-space.js', 'property-record.js', 'property-area.js', 'dispute-status.js',
               'ai-workspace.js', 'script.js', 'api/_mcp-capabilities.js',
               'test-space-identity-isolation.js', 'test-open-space-identity.js'];

const RESOLVE = `    var t = noIdentity
      ? {}
      : ((property.tenants || []).find(function (x) { return x && x.id === tenantId; }) || {});`;

const MUTANTS = [
  // ── the tenant lookup itself ─────────────────────────────────────────────
  { id: 'I01', file: 'tenant-space.js', why: 'the original leak returns — an id-less space resolves a tenant',
    from: RESOLVE,
    to:   "    var t = ((property.tenants || []).find(function (x) { return x && x.id === tenantId; }) || {});" },
  { id: 'I02', file: 'tenant-space.js', why: 'the guard inverts — VALID ids resolve nothing',
    from: '    var t = noIdentity\n      ? {}',
    to:   '    var t = !noIdentity\n      ? {}' },
  { id: 'I03', file: 'tenant-space.js', why: 'noIdentity stops covering the empty-string id',
    from: "    var noIdentity = (tenantId == null || tenantId === '');",
    to:   '    var noIdentity = (tenantId == null);' },
  { id: 'I04', file: 'tenant-space.js', why: 'noIdentity stops covering null/undefined',
    from: "    var noIdentity = (tenantId == null || tenantId === '');",
    to:   "    var noIdentity = (tenantId === '');" },
  { id: 'I05', file: 'tenant-space.js', why: 'noIdentity is never true, so nothing is ever refused',
    from: "    var noIdentity = (tenantId == null || tenantId === '');",
    to:   '    var noIdentity = false;' },

  // ── the disputes guard ───────────────────────────────────────────────────
  { id: 'I06', file: 'tenant-space.js', why: 'disputes match on absence again',
    from: '    var disputes = noIdentity ? [] : (property.disputes || []).filter',
    to:   '    var disputes = (property.disputes || []).filter' },
  { id: 'I07', file: 'tenant-space.js', why: 'the disputes guard inverts — valid spaces lose theirs',
    from: '    var disputes = noIdentity ? [] : (property.disputes || []).filter',
    to:   '    var disputes = !noIdentity ? [] : (property.disputes || []).filter' },

  // ── the event scoping this rule mirrors ──────────────────────────────────
  //
  // I08 removed _scopedEvents' own identity refusal and SURVIVED. That is an
  // equivalent mutant, and it became one because of this slice — proved from
  // the call graph rather than argued:
  //
  //   _scopedEvents has exactly one caller (assemble, line ~186) and is not
  //   exported. After this fix that caller passes `t.tenant_name` from an EMPTY
  //   tenant whenever there is no identity, so tenantName is always undefined
  //   there; `if (tenantName)` never runs, nameIsUnique stays false, and the
  //   suite-label fallback — the only branch that can match without an id — is
  //   disabled. The other two matches are `!= null`-guarded and cannot match
  //   null or ''. So the early return can no longer change any answer.
  //
  // It is KEPT anyway, and deliberately not deleted the way a guard added dead
  // in the previous slice was: this one is pre-existing, was load-bearing
  // before today (the same mutant was killed by the prior suite), and it states
  // a rule at its own layer that should not silently depend on the layer above.
  // The mutant is left in the list, marked, so the reasoning is re-read rather
  // than rediscovered.
  { id: 'I08', file: 'tenant-space.js', why: 'EQUIVALENT (see note): events scope without an identity again',
    from: "    if (tenantId == null || tenantId === '') return [];",
    to:   '    if (false) return [];', equivalent: true },

  // ── the projection that carries it ───────────────────────────────────────
  { id: 'I09', file: 'property-record.js', why: 'the projection reports lease from the raw tenant instead of the record',
    from: '        lease:      rec && rec.lease ? rec.lease : null,',
    to:   "        lease:      { type: t && t.lease_type || null, sqft: t && t.leased_sqft || null, start: null, end: null, cap: null }," },
  { id: 'I10', file: 'property-record.js', why: 'the projection stops flagging noIdentity',
    from: '        noIdentity: !!(rec && rec.noIdentity),',
    to:   '        noIdentity: false,' },
  { id: 'I11', file: 'property-record.js', why: 'the projection drops the space record entirely',
    from: '        space:      rec && rec.space ? rec.space : null,',
    to:   '        space:      null,' },
  { id: 'I12', file: 'property-record.js', why: 'camResult is taken from somewhere other than the record',
    from: '        camResult:  rec && rec.camResult ? rec.camResult : null,',
    to:   '        camResult:  null,' },

  // ── the AI consumer's contract ───────────────────────────────────────────
  { id: 'I13', file: 'ai-workspace.js', why: 'AIWorkspace reads the raw tenant instead of the record',
    from: '                 lease: sp.lease || null, camResult: sp.camResult || null,',
    to:   '                 lease: (t && { type: t.lease_type, sqft: t.leased_sqft }) || null, camResult: sp.camResult || null,' },
  { id: 'I14', file: 'ai-workspace.js', why: 'AIWorkspace stops carrying noIdentity',
    from: '                 space: sp.space || null, noIdentity: !!sp.noIdentity, tenant: t };',
    to:   '                 space: sp.space || null, noIdentity: false, tenant: t };' },

  // ── the MCP gate this slice must not disturb ─────────────────────────────
  { id: 'I15', file: 'api/_mcp-capabilities.js', why: 'a space camResult reaches a caller ungated',
    from: '    return Object.assign({}, s, { camResult: _gatedCamResult(s.camResult) });',
    to:   '    return Object.assign({}, s, { camResult: s.camResult });' },

  // ── the M8c/M8d zero-area rule the fix must not break ────────────────────
  { id: 'I16', file: 'tenant-space.js', why: 'a genuine 0 area is nulled along with the leak',
    from: '      type: t.lease_type || null, sqft: _leasedArea(t),',
    to:   '      type: t.lease_type || null, sqft: _leasedArea(t) || null,' },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spaceid-mut-'));
fs.mkdirSync(path.join(tmp, 'api'), { recursive: true });
const ORIGINAL = {};
for (const f of FILES) {
  ORIGINAL[f] = fs.readFileSync(path.join(ROOT, f), 'utf8');
  fs.writeFileSync(path.join(tmp, f), ORIGINAL[f]);
}

function runSuites() {
  for (const suite of ['test-space-identity-isolation.js', 'test-open-space-identity.js']) {
    try {
      execFileSync(process.execPath, [suite], { cwd: tmp, stdio: 'pipe', timeout: 120000 });
    } catch (_) { return false; }   // any suite failing kills the mutant
  }
  return true;
}

console.log('Baseline (unmutated copy): ' + (runSuites() ? 'PASS' : 'FAIL — fix before mutating'));

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
  fs.writeFileSync(path.join(tmp, m.file), src.slice(0, i) + m.to + src.slice(i + m.from.length));
  const passed = runSuites();
  fs.writeFileSync(path.join(tmp, m.file), src);
  if (passed) {
    // A mutant declared equivalent must actually survive; if one starts dying,
    // the reasoning behind it has gone stale and needs re-reading.
    if (m.equivalent) { console.log(`  EQUIV ${m.id}  ${m.why}`); }
    else { survived.push(`${m.id} ${m.file}: ${m.why}`); console.log(`  LIVE ${m.id}  ${m.why}`); }
  } else {
    killed++;
    if (m.equivalent) {
      survived.push(`${m.id} was declared EQUIVALENT but was killed — re-read the note above it`);
      console.log(`  ??!  ${m.id}  declared equivalent, but the suites caught it`);
    } else {
      console.log(`  kill ${m.id}  ${m.why}`);
    }
  }
}

const equivalents = MUTANTS.filter(m => m.equivalent).length;
console.log(`\n${killed}/${MUTANTS.length - equivalents} killed` +
            (equivalents ? ` (${equivalents} declared equivalent, argued in place)` : ''));
if (survived.length) {
  console.log('\nSURVIVORS — each needs a written verdict (real gap or equivalent):');
  survived.forEach(s => console.log('  · ' + s));
}
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(survived.length ? 1 : 0);
