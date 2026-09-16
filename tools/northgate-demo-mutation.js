'use strict';
/**
 * tools/northgate-demo-mutation.js — is Northgate Exchange billable for the
 * reasons the demo claims, and would the suites notice if it stopped being?
 *
 *   node tools/northgate-demo-mutation.js
 *
 * The risk a demo fixture carries is that it passes for the wrong reason, or
 * quietly stops demonstrating what it says it demonstrates. Each mutant below
 * is a single plausible edit to the seed data, the seeder, or the generator,
 * chosen so the result is still a working property — just a less honest one. A
 * SURVIVOR means the suites would have shipped that.
 *
 *   The conditions that make it billable
 *     N01  a lease states an administrative fee — a provision the engine does
 *          not apply, which blocks billing by design
 *     N02  a lease becomes Modified Gross
 *     N03  a lease starts mid-CAM-year, so a partial period is billed in full
 *     N04  the seeder stops attaching source documents to the invoices
 *     N05  one invoice is dated outside the CAM year
 *     N06  an invoice is marked not CAM-eligible
 *
 *   The things it is supposed to demonstrate
 *     N07  the vacancy no longer closes the coverage gap
 *     N08  the vacant row loses its flag and becomes a nameless tenant
 *     N09  the seeder feeds the vacancy into the leases
 *     N10  a cap loses its prior-year base, so it can never be enforced
 *     N11  every cap bites, so nothing shows a cap being respected
 *     N12  the exclusion is dropped, so no exclusion changes any number
 *
 *   The paperwork
 *     N13  the seed's cap disagrees with the lease PDF on file
 *     N14  a lease points at a document that does not exist
 *     N15  the invoice documents stop stating their amount
 *
 *   Idempotency and restore
 *     N16  the version check is removed, so opening re-seeds every time
 *     N17  the reconciliation is stored without its inputs fingerprint, so it
 *          reopens permanently unverifiable
 *
 *   Persistence — the id has to be one the database will take
 *     N18  the property id goes back to a prefix containing a non-hex digit
 *     N19  the space ids do
 *
 *   Identity — the property has to describe itself
 *     N20  the stored row carries Cascade's _demoVersion marker again
 *     N21  the live object does
 *     N22  the stored row loses its own info block
 *     N23  the live object does
 *     N24  the rendering is swapped for Cascade's
 *     N25  the caption keeps Northgate's picture but Cascade's words
 *
 * A FAILING BASELINE IS NOT A PASS.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const S = 'script.js', N = 'demo-northgate.js', G = 'tools/build-demo-northgate.js';

const MUTANTS = [
  // ── what makes it billable ───────────────────────────────────────────────
  { id: 'N01', file: N, why: 'a lease states an administrative fee, which blocks billing by design',
    from: "      cap: 5, capBaseAmount: 33400,", to: "      cap: 5, capBaseAmount: 33400, admin_fee_pct: 3," },
  { id: 'N02', file: N, why: 'a lease becomes Modified Gross',
    from: "      suite: '130', leased_sqft: 1800,\n      start_date: '2023-01-01', end_date: '2028-12-31',\n      lease_type: 'NNN',",
    to:   "      suite: '130', leased_sqft: 1800,\n      start_date: '2023-01-01', end_date: '2028-12-31',\n      lease_type: 'Modified Gross'," },
  { id: 'N03', file: N, why: 'a lease starts mid-CAM-year, so a partial period is billed in full',
    from: "      start_date: '2022-03-01', end_date: '2027-02-28',",
    to:   "      start_date: '2025-05-01', end_date: '2027-02-28'," },
  { id: 'N04', file: S, why: 'the seeder stops attaching source documents to the invoices',
    from: "    fileUrl: ND.invoicePath(inv), fileName: inv.n + '.pdf',",
    to:   "    fileUrl: null, fileName: null," },
  { id: 'N05', file: N, why: 'one invoice is dated outside the CAM year',
    from: "invoiceDate: '2025-08-14'", to: "invoiceDate: '2024-08-14'" },
  { id: 'N06', file: S, why: 'an invoice is marked not CAM-eligible',
    from: "    camEligible: true,", to: "    camEligible: i !== 0," },

  // ── what it demonstrates ─────────────────────────────────────────────────
  { id: 'N07', file: N, why: 'the vacancy no longer closes the coverage gap',
    from: "  const VACANCY = { suite: '150', leased_sqft: 3900 };",
    to:   "  const VACANCY = { suite: '150', leased_sqft: 2000 };" },
  { id: 'N08', file: S, why: 'the vacant row loses its flag and becomes a nameless tenant',
    from: "    leased_sqft: String(ND.VACANCY.leased_sqft), vacant: true,",
    to:   "    leased_sqft: String(ND.VACANCY.leased_sqft), vacant: false," },
  { id: 'N09', file: S, why: 'the seeder feeds the vacancy into the leases',
    from: "  reconProp.addLeases(ngTenants.map(t => {", to: "  reconProp.addLeases(ngSpaces.map(t => {" },
  { id: 'N10', file: N, why: 'a cap loses its prior-year base, so it can never be enforced',
    from: "      cap: 4, capBaseAmount: 14900,", to: "      cap: 4, capBaseAmount: null," },
  { id: 'N11', file: N, why: 'every cap bites, so nothing shows a cap being respected',
    from: "      cap: 6, capBaseAmount: 18200,", to: "      cap: 6, capBaseAmount: 9000," },
  { id: 'N12', file: N, why: 'the exclusion is dropped, so no exclusion changes any number',
    from: "      excluded_categories: 'management',", to: "      excluded_categories: ''," },

  // ── the paperwork ────────────────────────────────────────────────────────
  { id: 'N13', file: N, why: "the seed's cap disagrees with the lease PDF on file",
    from: "      cap: 5, capBaseAmount: 33400,", to: "      cap: 7, capBaseAmount: 33400," },
  { id: 'N14', file: N, why: 'a lease points at a document that does not exist',
    from: "  function leaseFileName(t) { return 'lease-northgate-' + t.key + '.pdf'; }",
    to:   "  function leaseFileName(t) { return 'lease-northgate-' + t.key + '-v2.pdf'; }" },
  // Both cells, because the total row states the amount too — removing only
  // the line item leaves the document still saying what it is worth, which is
  // not the regression this mutant is for.
  { id: 'N15', file: G, why: 'the invoice documents stop stating their amount',
    from: '<tr><td>${esc(inv.desc)}</td><td class="n">${esc(money(inv.amount))}</td></tr>\n      <tr class="tot"><td>Total due</td><td class="n">${esc(money(inv.amount))}</td></tr>',
    to:   '<tr><td>${esc(inv.desc)}</td><td class="n">on file</td></tr>\n      <tr class="tot"><td>Total due</td><td class="n">on file</td></tr>' },

  // ── idempotency and restore ──────────────────────────────────────────────
  { id: 'N16', file: S, why: 'the version check is removed, so opening re-seeds every time',
    from: "    if (!error && row?.data?._ngV === ND.DEMO_VERSION && row?.data?.camReconciliation?.results?.length > 0) {",
    to:   "    if (false) {" },
  { id: 'N17', file: S, why: 'the reconciliation is stored without its inputs fingerprint',
    from: "      try { return camInputsFingerprint(ngSpaces, ngInvoices); } catch (_) { return null; }",
    to:   "      return null;" },

  // ── persistence: an id the database will actually accept ─────────────────
  // This is the defect itself. `n` is not a hex digit, so the id is not a uuid,
  // and properties.id / tenants.id / cam_reconciliations.property_id all are.
  { id: 'N18', file: S, why: 'the property id goes back to a prefix containing a non-hex digit',
    from: "  NORTHGATE_PROPERTY_ID = 'de000001-0000-4000-a000-' + node;",
    to:   "  NORTHGATE_PROPERTY_ID = 'ne000000-0000-4000-a000-' + node;" },
  { id: 'N19', file: S, why: 'the space ids do',
    from: "    'de000001-0000-4000-a00' + n + '-' + node",
    to:   "    'ne000000-0000-4000-a00' + n + '-' + node" },

  // ── identity: the property describes itself ──────────────────────────────
  { id: 'N20', file: S, why: "the stored row carries Cascade's _demoVersion marker again",
    from: "    _ngV:      ND.DEMO_VERSION,\n    info:      ND.INFO,",
    to:   "    _ngV:      ND.DEMO_VERSION,\n    _demoVersion: ND.DEMO_VERSION,\n    info:      ND.INFO," },
  { id: 'N21', file: S, why: 'the live object does',
    from: "    _ngV: ND.DEMO_VERSION,\n    info: ND.INFO,",
    to:   "    _ngV: ND.DEMO_VERSION, _demoVersion: ND.DEMO_VERSION,\n    info: ND.INFO," },
  { id: 'N22', file: S, why: 'the stored row loses its own info block, so a reload falls back to Cascade\'s',
    from: "    _ngV:      ND.DEMO_VERSION,\n    info:      ND.INFO,",
    to:   "    _ngV:      ND.DEMO_VERSION," },
  { id: 'N23', file: S, why: 'the live object does',
    from: "    _ngV: ND.DEMO_VERSION,\n    info: ND.INFO,",
    to:   "    _ngV: ND.DEMO_VERSION," },
  { id: 'N24', file: N, why: "the rendering is swapped for Cascade's",
    from: "    imageUrl:          'assets/demo/northgate/northgate-exchange-rendering.svg',",
    to:   "    imageUrl:          'assets/demo/cascade-commons-rendering.svg'," },
  { id: 'N25', file: N, why: "the caption keeps Northgate's picture but Cascade's words",
    from: "    imageCaption:      'Architectural rendering of the fictional Northgate Exchange",
    to:   "    imageCaption:      'Architectural rendering of the fictional Cascade Commons" },
  { id: 'N26', file: S, why: 'the unsaveable copy under the old id is left to reappear as a twin',
    from: "  const _ngLegacyPrefix = 'ne000000-';",
    to:   "  const _ngLegacyPrefix = '\\u0000never-matches-';" },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ngmut-'));
fs.cpSync(ROOT, tmp, {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(ROOT, src);
    return !(rel === '.git' || rel.startsWith('.git' + path.sep) ||
             rel === 'node_modules' || rel.startsWith('node_modules' + path.sep));
  },
});
// test-demo-northgate.js reads the PDFs with pdfjs-dist, so the copy needs the
// dependency tree. Copying it would cost more than the whole run; a link is
// enough because nothing here writes into it.
try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(tmp, 'node_modules'), 'dir'); }
catch (e) { console.warn('[ngmut] could not link node_modules:', e && e.message); }
const FILES = [...new Set(MUTANTS.map(m => m.file))];
const ORIGINAL = {};
for (const f of FILES) ORIGINAL[f] = fs.readFileSync(path.join(ROOT, f), 'utf8');

// The pure suite runs FIRST and the harness stops at the first failure, so a
// mutant the data check catches never pays for the browser run.
// N15 mutates the generator, so its effect only exists once the documents are
// re-rendered; the harness re-renders when the generator is the mutated file.
const SUITES = ['test-demo-northgate.js', 'test-e2e-northgate-billable.js'];
function runSuites(rebuild) {
  if (rebuild) {
    try { execFileSync(process.execPath, ['tools/build-demo-northgate.js'], { cwd: tmp, stdio: 'pipe', timeout: 900000 }); }
    catch (_) { return false; }
  }
  for (const suite of SUITES) {
    try { execFileSync(process.execPath, [suite], { cwd: tmp, stdio: 'pipe', timeout: 900000 }); }
    catch (_) { return false; }
  }
  return true;
}

const baseline = runSuites(false);
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
  if (i === -1) { console.log(`  ??   ${m.id}  ANCHOR NOT FOUND in ${m.file} — malformed mutant`); survived.push(m.id + ' (malformed)'); continue; }
  if (src.indexOf(m.from, i + 1) !== -1) console.log(`  ??   ${m.id}  ANCHOR NOT UNIQUE in ${m.file} — mutating only the first`);
  if (m.to === m.from) { console.log(`  ??   ${m.id}  NO-OP MUTANT`); survived.push(m.id + ' (no-op)'); continue; }
  fs.writeFileSync(path.join(tmp, m.file), src.slice(0, i) + m.to + src.slice(i + m.from.length));
  const passedM = runSuites(m.file === G);
  fs.writeFileSync(path.join(tmp, m.file), src);
  if (m.file === G) {
    // Put the real documents back before the next mutant is measured.
    try { execFileSync(process.execPath, ['tools/build-demo-northgate.js'], { cwd: tmp, stdio: 'pipe', timeout: 900000 }); } catch (_) {}
  }
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
