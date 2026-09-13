'use strict';
/**
 * tools/build-normalize-baseline.js — freeze what normalizeTenant does TODAY.
 *
 * NOT LOADED BY THE APPLICATION. Run once, before the M1a extraction, against
 * the unmodified script.js. It lifts normalizeTenant and its closure into a
 * sandbox, runs them over a deliberately awkward corpus, and writes the outputs
 * to evidence/. After the extraction, test-tenant-normalize-extraction.js
 * replays the same corpus through the new module and requires the same answers.
 *
 * The point is that "behaviour preserved" should be a measurement rather than a
 * claim. A baseline captured after the move would only prove the move agrees
 * with itself.
 *
 *   node tools/build-normalize-baseline.js            # verify against existing
 *   node tools/build-normalize-baseline.js --write    # (re)write the baseline
 */

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT  = path.join(ROOT, 'evidence', '2026-09-05-normalize-tenant-baseline.json');

/** The five functions normalizeTenant actually needs. Comments stripped when
 *  analysing, but lifted verbatim so behaviour is identical. */
const CLOSURE = ['cleanTenantName', 'toISODate', 'extractDatesFromText', '_dateWithRaw', 'normalizeTenant'];

function grab(src, name) {
  const i = src.indexOf('\nfunction ' + name + '(');
  if (i < 0) throw new Error('not found in source: ' + name);
  let depth = 0, started = false;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') { depth++; started = true; }
    else if (src[j] === '}') { depth--; if (started && depth === 0) return src.slice(i + 1, j + 1); }
  }
  throw new Error('unbalanced braces: ' + name);
}

/** Lift the closure out of a source string into an isolated context. */
function lift(src) {
  const sandbox = { console, Date, Math, JSON, Number, String, Object, Array,
                    isNaN, parseFloat, parseInt, RegExp, Boolean };
  vm.createContext(sandbox);
  for (const fn of CLOSURE) vm.runInContext(grab(src, fn), sandbox);
  return sandbox;
}

/**
 * The corpus. Every entry exists because it can go wrong: a field that is
 * dropped by the allow-list, a date that cannot be read, a value that arrives
 * under two spellings, or a record being normalised for the second time.
 */
const CORPUS = [
  ['empty object',            {}],
  ['null-ish',                { tenant_name: null, leased_sqft: null }],
  ['minimal',                 { tenant_name: 'Luxe Nails', leased_sqft: 3000 }],
  ['id preserved',            { id: 'keep-me', tenant_name: 'Keeper' }],
  ['id absent stays null',    { tenant_name: 'No Id Here' }],
  ['camelCase spellings',     { tenantName: 'Camel Co', leasedSqft: 1200, leaseType: 'NNN',
                                startDate: '2021-01-01', endDate: '2028-12-31',
                                camCommencementDate: '2021-03-01', partialPeriodBasis: ' Days ',
                                adminFeeBasis: ' Controllable ', propertyName: '  Maple Plaza  ' }],
  ['snake_case spellings',    { tenant_name: 'Snake Co', leased_sqft: 900, lease_type: 'Gross',
                                start_date: '2022-05-01', end_date: '2027-04-30',
                                cam_commencement_date: '2022-06-01', partial_period_basis: 'MONTHS',
                                admin_fee_basis: 'NET', property_name: 'Cascade Commons' }],
  ['name needing cleaning',   { tenant_name: '  P. Luxe   Nails ,; ' }],
  ['unreadable dates',        { tenant_name: 'TBD Dates', start_date: 'TBD', end_date: 'to be determined' }],
  ['unreadable carried fwd',  { tenant_name: 'Carry', start_date: '', end_date: '',
                                unreadableDates: { start_date: 'TBD', end_date: 'unknown' } }],
  ['readable clears prior',   { tenant_name: 'Cleared', start_date: '2024-01-01',
                                unreadableDates: { start_date: 'TBD' } }],
  ['dates from rawText',      { tenant_name: 'From Text',
                                rawText: 'The term commences 2020-02-01 and expires 2030-01-31.' }],
  ['cap variants',            { tenant_name: 'Cap A', cap: 5 }],
  ['cap fallback cam_cap',    { tenant_name: 'Cap B', cam_cap: 7 }],
  ['cap fallback pct',        { tenant_name: 'Cap C', capPercentage: 3 }],
  ['capBaseAmount',           { tenant_name: 'Base', capBaseAmount: 26000 }],
  ['excluded categories ""',  { tenant_name: 'Excl', excluded_categories: '' }],
  ['excluded categories null',{ tenant_name: 'Excl2' }],
  ['amendments array',        { tenant_name: 'Amend', amendments: [{ kind: 'x' }] }],
  ['amendments not array',    { tenant_name: 'Amend2', amendments: 'nope' }],
  ['lease url spellings',     { tenant_name: 'Url', file_url: 'https://example/x.pdf' }],
  ['review + overrides',      { tenant_name: 'Rev', review: { reviewerConfirmed: true },
                                reviewOverrides: { cap: { override: 6 } },
                                fieldEvidence: { cap: { snapshots: [] } } }],
  ['flags + confidence',      { tenant_name: 'Flags', flags: ['a'], confidence: { cap: 'high' } }],
  ['numeric strings',         { tenant_name: 'Nums', leased_sqft: '4500', cap: '5' }],
  ['extraction failure',      { tenant_name: 'Failed', extractionFailed: true, _needsReview: true,
                                _error: 'could not read' }],
  ['pending job review',      { tenant_name: 'Pending', _pendingJobReview: true, _jobId: 'j1' }],
  ['base rent + deposit',     { tenant_name: 'Money', base_rent: 1000, security_deposit: 2000 }],
  ['suite/unit variants',     { tenant_name: 'Suite', unit: '204' }],
  ['blank property_name',     { tenant_name: 'Blank', property_name: '   ' }],
];

/** Second pass over the first pass: normalizeTenant runs on every load, so a
 *  record it has already produced must survive being fed back to it. */
function withRoundTrips(sandbox) {
  const out = [];
  for (const [label, input] of CORPUS) {
    const once  = sandbox.normalizeTenant(input);
    const twice = sandbox.normalizeTenant(once);
    out.push({ label, input, once, twice });
  }
  // Explicit non-object inputs, which the function guards.
  out.push({ label: 'null input',      input: null,      once: sandbox.normalizeTenant(null),      twice: null });
  out.push({ label: 'undefined input', input: undefined, once: sandbox.normalizeTenant(undefined), twice: null });
  return out;
}

function main() {
  const src = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
  const sandbox = lift(src);
  const results = withRoundTrips(sandbox);
  const payload = {
    captured: '2026-09-05',
    purpose: 'M1a — behaviour of normalizeTenant BEFORE extraction to tenant-normalize.js',
    source: 'script.js, functions lifted: ' + CLOSURE.join(', '),
    cases: results.length,
    results,
  };
  const json = JSON.stringify(payload, null, 2);

  if (process.argv.includes('--write')) {
    fs.writeFileSync(OUT, json + '\n');
    console.log('baseline written: ' + OUT + '  (' + results.length + ' cases)');
    return;
  }
  if (!fs.existsSync(OUT)) { console.log('no baseline yet — run with --write'); process.exit(1); }
  const prev = fs.readFileSync(OUT, 'utf8');
  const same = prev.trim() === json.trim();
  console.log(same ? 'script.js still matches the frozen baseline'
                   : 'script.js DIFFERS from the frozen baseline');
  process.exit(same ? 0 : 1);
}

module.exports = { CORPUS, CLOSURE, lift, grab, withRoundTrips };
if (require.main === module) main();
