'use strict';
/**
 * tools/ai-intent-coverage-mutation.js — does the AI intent-coverage suite bite?
 *
 *   node tools/ai-intent-coverage-mutation.js
 *
 * Five kinds of mutant:
 *
 *   MATCHER     an intent stops recognising the phrasings this slice added, or
 *               swallows phrasings it must leave to another intent.
 *   AUTHORITY   an answer stops reading the authority and derives its own — the
 *               reconciliation status instead of the billing verdict, pool minus
 *               allocation instead of the variance breakdown.
 *   IDENTITY    the tenant join drops to array position or bare name, so one
 *               tenant is handed another's money.
 *   INVENTION   a missing property-manager becomes a confident answer, or an
 *               unsupported question stops falling back.
 *   GUARD       a refusal that protects unverified data is removed: no verdict,
 *               no breakdown, another property's verdict, an unexplained
 *               residual, unmatched invoices.
 *
 * A FAILING BASELINE IS NOT A PASS. The unmutated copy is asserted before any
 * mutant runs and the harness exits non-zero if it fails.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MUTATED_FILES = ['ai-workspace.js', 'script.js'];

const MUTANTS = [
  // ── MATCHER ─────────────────────────────────────────────────────────────
  { id: 'A01', file: 'ai-workspace.js', why: 'the affirmative billing phrasings are removed again',
    from: "    'ready to bill', 'ready to invoice',", to: "    'zzz-never-matches-aaa'," },
  { id: 'A02', file: 'ai-workspace.js', why: '"can I bill / can I issue" stops matching',
    from: "    'can (?:i|we) bill', 'can (?:i|we) issue', 'able to bill',", to: "    'zzz-never-matches-bbb'," },
  { id: 'A03', file: 'ai-workspace.js', why: '"safe/ok/clear to bill" stops matching',
    from: "    'safe to bill', 'ok(?:ay)? to bill', 'clear to bill',", to: "    'zzz-never-matches-ccc'," },
  { id: 'A04', file: 'ai-workspace.js', why: 'the allocation wording is removed from tenant_charge',
    from: "    match: (s, ctx, { props }) => (/why does|owes?\\b|charge|allocat|billed to|cam (?:amount|share|total)|how much/.test(s)",
    to:   "    match: (s, ctx, { props }) => (/why does|owes?\\b|charge/.test(s)" },
  { id: 'A05', file: 'ai-workspace.js', why: 'the unbilled matcher never fires',
    from: "    match: (s) => _UNBILLED_RE.test(s),", to: '    match: () => false,' },
  { id: 'A06', file: 'ai-workspace.js', why: 'the unbilled matcher fires on everything, stealing other intents',
    from: "    match: (s) => _UNBILLED_RE.test(s),", to: '    match: () => true,' },
  { id: 'A07', file: 'ai-workspace.js', why: 'the property-info matcher never fires',
    from: '    match: (s) => _PROP_INFO_FIELDS.some(f => f.re.test(s)),', to: '    match: () => false,' },
  // TWO EQUIVALENTS LIVE HERE, AND BOTH WERE REPLACED RATHER THAN ARGUED AWAY.
  //
  //   match: () => true                     — the handler re-checks with
  //                                           `if (!field) return null`, so the
  //                                           loop moves on exactly as before.
  //   `find(...) || _PROP_INFO_FIELDS[0]`   — the MATCHER already guarantees
  //                                           some field pattern matched, so
  //                                           the fallback arm never runs.
  //
  // The matcher and the handler guard are redundant on purpose: defence in
  // depth, each covering the other. Neither is individually observable, which
  // makes both genuinely equivalent rather than uncaught. What IS observable is
  // picking the WRONG field — answering "what is the parcel ID?" with the
  // property manager — so that is what this mutant does.
  { id: 'A08', file: 'ai-workspace.js', why: 'every reference question is answered with the first field (the manager)',
    from: '      const field = _PROP_INFO_FIELDS.find(f => f.re.test(s));',
    to:   '      const field = _PROP_INFO_FIELDS[0];' },
  { id: 'A09', file: 'ai-workspace.js', why: 'the manager pattern no longer covers "who manages"',
    from: "re: /property manager|who manages|managing agent|manager of this/ }",
    to:   're: /property manager/ }' },

  // ── AUTHORITY ───────────────────────────────────────────────────────────
  { id: 'A10', file: 'ai-workspace.js', why: 'billing readiness is taken from the calculation status instead of the verdict',
    from: '      if (r.canBill) {',
    to:   "      if ((v.calcStatus || 'calculated') === 'calculated') {" },
  { id: 'A11', file: 'ai-workspace.js', why: 'the billing answer ignores the verdict and always reports clear',
    from: '      const r        = v.readiness;',
    to:   "      const r        = { canBill: true, label: 'Ready to bill', reason: 'ok', blockers: [] };" },
  { id: 'A12', file: 'ai-workspace.js', why: 'the unbilled answer infers causes by subtraction instead of reading the breakdown',
    from: '      const lines = Array.isArray(bk.lines) ? bk.lines.filter(Boolean) : [];',
    to:   "      const lines = [{ key: 'x', label: 'Unallocated', amount: (bk.pool || 0) - (bk.billed || 0) }];" },
  { id: 'A13', file: 'ai-workspace.js', why: 'the unbilled answer drops the breakdown labels for its own wording',
    from: '      const bullets = lines.map(l => `${l.label} — ${_fmt$(l.amount)}`);',
    to:   '      const bullets = lines.map(l => `Category — ${_fmt$(l.amount)}`);' },
  { id: 'A14', file: 'ai-workspace.js', why: 'the property-info answer stops consulting PropertyReference',
    from: '      const raw = info ? info[field.key] : null;',
    to:   "      const raw = (p && p.name) ? (p.name + ' management') : null;" },
  { id: 'A15', file: 'script.js', why: 'the exposed breakdown is re-derived instead of the one on screen',
    from: '  if (!_lastVarianceBreakdown) return null;',
    to:   '  if (!_lastVarianceBreakdown) return { propertyId: null, propertyName: null, breakdown: { pool: 0, billed: 0, difference: 0, lines: [], explained: true } };' },

  // ── IDENTITY ────────────────────────────────────────────────────────────
  { id: 'A16', file: 'ai-workspace.js', why: 'the tenant join falls back to array position',
    from: '      const result = (t.id != null && _rows.some(r => r && r.tenantId != null)\n                        ? _rows.find(r => r && r.tenantId === t.id)\n                        : null)\n                    || _rows.find(r => r && r.tenantName === t.tenant_name);',
    to:   '      const result = _rows[0];' },
  { id: 'A17', file: 'ai-workspace.js', why: 'the tenant join ignores tenantId and uses the name only',
    from: '      const result = (t.id != null && _rows.some(r => r && r.tenantId != null)\n                        ? _rows.find(r => r && r.tenantId === t.id)\n                        : null)\n                    || _rows.find(r => r && r.tenantName === t.tenant_name);',
    to:   '      const result = _rows.find(r => r && r.tenantName === t.tenant_name);' },
  { id: 'A18', file: 'ai-workspace.js', why: 'tenant_charge answers without resolving a tenant at all',
    from: '      const hit = _findTenantByQuestion(q, props, ctx);\n      if (!hit) return null;',
    to:   '      const hit = _findTenantByQuestion(q, props, ctx) || { p: props[0], t: (props[0] && props[0].tenants || [])[0] };\n      if (!hit || !hit.t) return null;' },

  // ── INVENTION ───────────────────────────────────────────────────────────
  { id: 'A19', file: 'ai-workspace.js', why: 'a missing property-manager becomes a confident invented answer',
    from: '      if (!value) {',
    to:   '      if (false) {' },
  { id: 'A20', file: 'ai-workspace.js', why: 'a blank/whitespace value is printed as if it were data',
    from: "      const value = (raw == null || String(raw).trim() === '') ? null : String(raw).trim();",
    to:   '      const value = (raw == null) ? null : String(raw);' },
  { id: 'A21', file: 'ai-workspace.js', why: 'the honest miss claims the field simply has not loaded yet',
    from: '          paragraphs: [`I don’t have a ${field.label.toLowerCase()} for ${p.name} in the verified property record, so I won’t guess at one. Add it on the Property tab and I’ll read it from there.`],',
    to:   '          paragraphs: [`The ${field.label.toLowerCase()} is still loading — try again in a moment.`],' },

  // ── GUARD ───────────────────────────────────────────────────────────────
  { id: 'A22', file: 'ai-workspace.js', why: 'no billing verdict is treated as nothing being wrong',
    from: '      if (!v || !v.readiness) {',
    to:   '      if (false) {' },
  { id: 'A23', file: 'ai-workspace.js', why: 'no variance breakdown is treated as nothing left over',
    from: '      if (!v || !v.breakdown) {',
    to:   '      if (false) {' },
  { id: 'A24', file: 'ai-workspace.js', why: 'a breakdown belonging to another property is answered anyway',
    from: '      if (p && v.propertyId && p.id !== v.propertyId) {\n        return {\n          heading: `That breakdown isn’t ${p.name}’s`,',
    to:   '      if (false) {\n        return {\n          heading: `That breakdown isn’t ${p.name}’s`,' },
  { id: 'A25', file: 'ai-workspace.js', why: 'an unexplained residual is no longer surfaced',
    from: '      if (!bk.explained) {', to: '      if (false) {' },
  { id: 'A26', file: 'ai-workspace.js', why: 'unmatched invoices stop being reported as incompleteness',
    from: '      if (_num(bk.unmatchedInvoices) > 0) {', to: '      if (false) {' },
  { id: 'A27', file: 'ai-workspace.js', why: 'a reference lookup that throws is no longer contained',
    from: '      const info = (PR && typeof PR.infoFor === \'function\') ? (function () {\n        try { return PR.infoFor(p); } catch (_) { return null; }\n      })() : null;',
    to:   "      const info = (PR && typeof PR.infoFor === 'function') ? PR.infoFor(p) : null;" },
  { id: 'A28', file: 'ai-workspace.js', why: 'the unbilled answer stops distinguishing itself from the blocked question',
    from: "      paragraphs.push('None of this is an audit exception — it is where the pool went. Ask \"why can’t I bill?\" for the exceptions that hold statements.');",
    to:   '      /* no disclaimer */' },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aicmut-'));
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

const SUITES = ['test-ai-intent-coverage.js'];
function runSuites() {
  for (const suite of SUITES) {
    try {
      execFileSync(process.execPath, [suite], {
        cwd: tmp, stdio: 'pipe', timeout: 400000,
        env: Object.assign({}, process.env, { AIC_PORT: '8981' }),
      });
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
    try {
      execFileSync(process.execPath, [suite], { cwd: tmp, stdio: 'pipe', timeout: 400000,
        env: Object.assign({}, process.env, { AIC_PORT: '8981' }) });
    } catch (e) { console.error('\n── ' + suite + ' ──\n' + String(e.stdout || e.message).slice(-3000)); }
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
