'use strict';
/**
 * tools/partial-basis-confirm-ui-mutation.js — is the control really a control?
 *
 *   node tools/partial-basis-confirm-ui-mutation.js
 *
 * The defect this protects against is not a wrong number. It is a finding that
 * asks a manager to decide something and gives them nothing to decide it with:
 * "Confirm the partial-period basis" rendered as text, and
 * confirmPartialPeriodBasis with no caller anywhere in the app.
 *
 * Four kinds of mutant:
 *
 *   INERT     the control goes back to being text, or is rendered but disabled,
 *             or loses its handler. Each one restores the original defect while
 *             leaving the words on screen unchanged.
 *   ROUTING   the click stops reaching the existing production function, or
 *             reaches it with the wrong tenant or the wrong basis. A button that
 *             records the wrong lease's decision is worse than no button.
 *   LEGIBILITY the label or the ask stops saying what is being confirmed, which
 *             turns the control into "trust the AI" — the thing the product
 *             requirement rules out.
 *   SCOPE     the action appears where no confirmation is needed. A lease that
 *             STATES its basis must never be offered a manual confirmation:
 *             taking it would overwrite the lease's own language with a
 *             manager's, which is the D-2 defect pointing the other way.
 *
 * A FAILING BASELINE IS NOT A PASS. The unmutated copy is asserted before any
 * mutant runs and the harness exits non-zero if it fails.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MUTATED_FILES = ['script.js', 'reconciliation-engine.js'];

const SLOT   = '        ${_auditFlagActionHtml(f)}';
const GUARD  = "  if (!c || c.kind !== 'partial_period_basis') return '';";
const BUTTON = `    <button type="button" class="ap-flag-confirm"
      onclick="confirmPartialBasisFromAudit('\${tid}','\${esc(basis)}',this)">
      Confirm \${esc(pretty)} for \${esc(c.tenant || 'this lease')}</button>`;
const ASK    = `    <div class="ap-flag-ask">MainStreet applied a <strong>\${esc(pretty)}</strong> apportionment because the lease is
      silent. Confirming records it as your decision against this lease &mdash; not as the lease&rsquo;s own language.</div>`;
const CALL   = '    ok = await confirmPartialPeriodBasis(tenantId, basis);';
const IDCHK  = '  if (!_isUsableRecordId(c.tenantId)) {';
const META   = `        confirm: {
          kind:     'partial_period_basis',`;

const MUTANTS = [
  // ── INERT: the control stops being one ──────────────────────────────────
  { id: 'C01', file: 'script.js', why: 'the action slot is removed — THE ORIGINAL DEFECT, prose only',
    from: SLOT, to: '' },
  { id: 'C02', file: 'script.js', why: 'the button becomes a span again',
    from: BUTTON, to: `    <span class="ap-flag-confirm">Confirm \${esc(pretty)} for \${esc(c.tenant || 'this lease')}</span>` },
  { id: 'C03', file: 'script.js', why: 'the button renders disabled',
    from: BUTTON, to: BUTTON.replace('<button type="button"', '<button type="button" disabled') },
  { id: 'C04', file: 'script.js', why: 'the button loses its click handler',
    from: BUTTON, to: BUTTON.replace(/onclick="[^"]*"/, '') },
  { id: 'C05', file: 'script.js', why: 'the renderer returns nothing for every finding',
    from: GUARD, to: "  if (true) return '';" },

  // ── ROUTING: the click must reach the production path, correctly ────────
  { id: 'C06', file: 'script.js', why: 'the click no longer calls the production confirmation',
    from: CALL, to: '    ok = true;' },
  { id: 'C07', file: 'script.js', why: 'the click confirms a hardcoded basis instead of the proposed one',
    from: CALL, to: "    ok = await confirmPartialPeriodBasis(tenantId, 'monthly');" },
  { id: 'C08', file: 'script.js', why: 'the button carries the tenant NAME where the id belongs',
    from: "  const tid = esc(String(c.tenantId)).replace(/'/g, \"\\\\'\");",
    to:   "  const tid = esc(String(c.tenant)).replace(/'/g, \"\\\\'\");" },
  { id: 'C09', file: 'script.js', why: 'a finding with no tenant id still offers a button that cannot work',
    from: IDCHK, to: '  if (false) {' },
  { id: 'C10', file: 'script.js', why: 'a failed confirmation is reported as success',
    from: '  if (!ok) {\n    // confirmPartialPeriodBasis has already told the manager why.',
    to:   '  if (false) {\n    // confirmPartialPeriodBasis has already told the manager why.' },

  // ── LEGIBILITY: the manager must know what they are ratifying ───────────
  { id: 'C11', file: 'script.js', why: 'the label becomes a bare "Confirm"',
    from: BUTTON, to: BUTTON.replace("Confirm ${esc(pretty)} for ${esc(c.tenant || 'this lease')}", 'Confirm') },
  { id: 'C12', file: 'script.js', why: 'the label drops the basis, leaving only the tenant',
    from: BUTTON, to: BUTTON.replace('Confirm ${esc(pretty)} for ', 'Confirm ') },
  { id: 'C13', file: 'script.js', why: 'the explanatory ask is removed',
    from: ASK, to: '' },
  { id: 'C14', file: 'script.js', why: 'the ask stops saying the confirmation is the manager\'s own decision',
    from: ASK, to: ASK.replace('Confirming records it as your decision against this lease &mdash; not as the lease&rsquo;s own language.',
                               'Confirming applies it.') },

  // ── SCOPE: only a lease that needs confirming is offered one ────────────
  { id: 'C15', file: 'reconciliation-engine.js', why: 'the action metadata is dropped, so nothing renders',
    from: META, to: "        confirm_DISABLED: {\n          kind:     'partial_period_basis'," },
  { id: 'C16', file: 'reconciliation-engine.js', why: 'the finding is raised even when the lease states the basis',
    from: '      if (_basis.stated) return;', to: '      if (false) return;' },
  { id: 'C17', file: 'reconciliation-engine.js', why: 'the proposed basis is hardcoded rather than the one applied',
    from: '          proposed: _basis.basis,', to: "          proposed: 'monthly'," },
  { id: 'C18', file: 'reconciliation-engine.js', why: 'the action carries no tenant id',
    from: '          tenantId: r.tenantId != null ? r.tenantId : null,',
    to:   '          tenantId: null,' },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cuimut-'));
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

const SUITES = ['test-e2e-partial-basis-confirm-ui.js'];
function runSuites() {
  for (const suite of SUITES) {
    try {
      execFileSync(process.execPath, [suite], {
        cwd: tmp, stdio: 'pipe', timeout: 600000,
        env: Object.assign({}, process.env, { CONFIRM_UI_PORT: '7979' }),
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
      execFileSync(process.execPath, [suite], { cwd: tmp, stdio: 'pipe', timeout: 600000,
        env: Object.assign({}, process.env, { CONFIRM_UI_PORT: '7979' }) });
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
  if (m.to === m.from) {
    console.log(`  ??   ${m.id}  NO-OP MUTANT — the replacement equals the anchor`);
    survived.push(m.id + ' (no-op)');
    continue;
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
