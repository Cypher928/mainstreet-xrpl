// test-acquisition-leasehold.js
// ============================================================================
// Acquisition Review §4l — one tenant row per leasehold, from resolved terms.
//
// The rules under test, in the order they matter:
//
//   THE RESOLVER'S ANSWER IS THE ROW   a leasehold row carries the resolved
//                                      value, so a person's correction reaches
//                                      the Rent Roll, the CSV and conversion.
//   NO ANSWER IS NOT ZERO              a contested or missing term is NULL on
//                                      the row and the row says which it is.
//   ENTERED IS NOT DOCUMENTED          an entered value is carried, and every
//                                      consumer can see it came from a person.
//   RAW ROWS ARE KEPT, NOT SHOWN       tenants[] is never modified; a raw row
//                                      is projected only when nothing else
//                                      represents it, and then never as verified.
//
// Run: node test-acquisition-leasehold.js
// ============================================================================
'use strict';
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = __dirname;
const AL = require('./acquisition-leasehold.js');
const AT = require('./acquisition-terms.js');

function loadLI() {
  const sb = { window: {}, console };
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'lease-intelligence.js'), 'utf8'), sb,
                  { filename: 'lease-intelligence.js' });
  if (!sb.window.LeaseIntelligence) throw new Error('lease-intelligence.js did not expose window.LeaseIntelligence');
  return sb.window.LeaseIntelligence;
}
const LI   = loadLI();
const WIRE = { terms: AT, reasoner: LI };

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}${detail ? '  — ' + detail : ''}`); }
  else    { fail++; failures.push(name + (detail ? ': ' + detail : '')); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? '  — ' + detail : ''}`); }
}
function section(s) { console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 62 - s.length))); }

console.log('\n══ §4l — one row per leasehold ══');

// ── fixtures: the Pilot's Maple Plaza shape ────────────────────────────────
const ev = (fields) => ({ schemaVersion: 1, model: 'claude-sonnet-4-6', at: '2026-09-22T15:09:11.892Z', fields });
const F  = (value, quote, page, confidence) => ({ value, quote, page: page ?? null, confidence: confidence ?? null });

const lease = {
  id: 'doc-shoprite', family_id: 'fam-1', produced_id: 't-shoprite',
  file_name: 'ShopRite_Anchor_Tenant_Lease.pdf',
  doc_type: 'renewal', doc_type_status: 'corrected', doc_date: '2024-03-01',
  storage_path: 'leases/u/acq_x-ShopRite.pdf', abstraction_status: 'success',
  abstracted_fields: ev({
    tenant_name: F('ShopRite Supermarkets, Inc.', 'Tenant:   ShopRite Supermarkets, Inc.', 1, 0.99),
    leased_sqft: F(65000, 'Leased Area:   65,000 rentable square feet', 1, 0.99),
    suite:       F('100', 'Suite 100', 1, 0.9),
    cap:         F(4, 'CAM increases are capped at 4% annually.', 4, 0.95),
    base_rent:   F(1202500, 'Tenant agrees to pay base rent of $18.50 per square foot annually.', 3, 0.95),
    end_date:    F('2034-02-28', 'expiring February 28, 2034', 2, 0.9),
  }),
};
const amendment = {
  id: 'doc-amd', family_id: 'fam-1', produced_id: 't-amd',
  file_name: 'Maple_Plaza_Test_Lease_Amendment.pdf',
  doc_type: 'amendment', doc_type_status: 'proposed', doc_date: '2027-01-01',
  storage_path: 'leases/u/acq_x-Amendment.pdf', abstraction_status: 'success',
  abstracted_fields: ev({
    tenant_name: F('ShopRite Supermarkets, Inc.', 'Tenant   ShopRite Supermarkets, Inc.', 1, 0.99),
    leased_sqft: F(65000, 'the Premises contain 65,000 rentable square feet', 1, 0.99),
    cap:         F(3, 'controllable Common Area Maintenance expense increases shall not exceed   3% per year', 1, 0.99),
    base_rent:   F(1251250, 'the annual base rent for the Premises shall be   $19.25 per rentable square foot', 1, 0.97),
  }),
};
const families = [{ id: 'fam-1', label: 'ShopRite Supermarkets, Inc.', tenant_hint: 'ShopRite Supermarkets, Inc.' }];
// The raw rows: one per uploaded file, as acqHandleLeaseFiles left them.
const rawTenants = [
  { id: 't-shoprite', tenant_name: 'ShopRite Supermarkets, Inc.', leased_sqft: 65000, base_rent: 1202500, cap: 4, _status: 'ok' },
  { id: 't-amd',      tenant_name: 'ShopRite Supermarkets, Inc.', leased_sqft: 65000, base_rent: 1251250, cap: 3, _status: 'ok' },
];
const correction = {
  id: 'dec-1', family_id: 'fam-1', field_key: 'leased_sqft', action: 'correct',
  previous_value: '65000', new_value: '67000', source_document_id: 'doc-shoprite',
  source_quote: 'Leased Area: 67,000 rentable square feet', source_page: 1,
  decided_by: 'u-1', decided_at: '2026-09-23T10:00:00Z', note: null,
};

// ── 1 · canonicalValue ─────────────────────────────────────────────────────
section('1 · the value a consumer may use');
check('a verified term yields its value', AL.canonicalValue({ state: 'verified', value: 67000 }) === 67000);
check('an AI reading yields its value too — it is the best answer on file',
  AL.canonicalValue({ state: 'ai_extracted', value: 4 }) === 4);
check('a CONTESTED term yields nothing — nothing has been chosen',
  AL.canonicalValue({ state: 'conflicting', value: 4 }) === null);
check('a missing term yields null, never zero',
  AL.canonicalValue({ state: 'missing', value: null }) === null);
check('no term at all is null', AL.canonicalValue(undefined) === null && AL.canonicalValue(null) === null);
check('an undefined value is null, not undefined',
  AL.canonicalValue({ state: 'verified' }) === null);

// ── 2 · tenantRowFor ───────────────────────────────────────────────────────
section('2 · one leasehold as one tenant row');
{
  const res = AT.resolveFamilyTerms([lease, amendment], [correction], { reasoner: LI });
  check('the fixture resolves', res.ok === true, res.error || '');
  const row = AL.tenantRowFor(families[0], res);
  check('the row is a leasehold row', row._source === AL.SOURCE.LEASEHOLD && row._source === 'leasehold');
  check('its id is the family id — conversion and the engine key on `id`',
    row.id === 'fam-1' && row._leaseholdId === 'fam-1');
  check('the corrected sqft is the row\'s sqft — the whole point',
    row.leased_sqft === 67000, String(row.leased_sqft));
  // The amendment (2027, still `proposed`) governs the term, so the P4-3
  // ceiling caps the corrected term at ai_extracted. The VALUE is the
  // person's; the state is honest about the document behind it.
  check('the state is carried alongside it, capped by the governing document\'s ceiling',
    row._states.leased_sqft === 'ai_extracted', row._states.leased_sqft);
  check('and the row does not show the file\'s stale 65,000 anywhere',
    !Object.keys(row).some(k => row[k] === 65000));
  check('the CAM cap contradiction (4% vs 3%) is NULL on the row, not either figure',
    row.cap === null && row.cam_cap === null, JSON.stringify([row.cap, row.cam_cap]));
  check('and the row says it is contested',
    row._states.cap === 'conflicting' && AL.cellState(row, 'cap') === 'contested');
  check('a term no document establishes is null and says missing',
    row.security_deposit === null && row._states.security_deposit === 'missing'
    && AL.cellState(row, 'security_deposit') === 'missing');
  check('the tenant name is the read one, and the row says so',
    row.tenant_name === 'ShopRite Supermarkets, Inc.' && row._tenantNameFrom === 'term');
  check('every alias the engine reads is populated from the same term',
    row.start_date === row.lease_start && row.end_date === row.lease_end
    && row.end_date === '2034-02-28', JSON.stringify([row.end_date, row.lease_end]));
  check('the suite is carried', row.suite === '100');
  check('no field on the row is undefined — every reader sees a value or null',
    Object.keys(row).every(k => row[k] !== undefined));
  check('_status is ok so the engine does not skip the row', row._status === 'ok');
  check('and nothing was entered, so no origin is set',
    Object.keys(row._origins).every(k => row._origins[k] === null));
  check('the row is not unverified', !row._unverified);

  // Without a resolved result the row still exists and says nothing.
  const bare = AL.tenantRowFor({ id: 'fam-9', label: 'Bakery' }, null);
  check('a family with no resolution is still a row, named by its label',
    bare.tenant_name === 'Bakery' && bare._tenantNameFrom === 'leasehold_label' && bare._resolved === false);
  check('with every value null', bare.leased_sqft === null && bare.base_rent === null);
  check('and every cell reads missing', AL.cellState(bare, 'leased_sqft') === 'missing');
  const unnamed = AL.tenantRowFor({ id: 'fam-8' }, null);
  check('a label-less family is never a blank name', unnamed.tenant_name === 'Unnamed leasehold');
}

// ── 3 · entered values ─────────────────────────────────────────────────────
section('3 · an entered value is carried, and never dressed as documented');
{
  const row = AL.tenantRowFor(families[0], { ok: true, terms: {
    security_deposit: { state: 'verified', value: 25000, support: 'entered' },
    leased_sqft:      { state: 'verified', value: 67000, support: 'stated' },
    cap:              { state: 'ai_extracted', value: 4, support: 'stated' },
  } });
  check('the entered value is the row\'s value', row.security_deposit === 25000);
  check('with origin `entered`', row._origins.security_deposit === 'entered');
  check('and the cell reads `entered`, not `verified`',
    AL.cellState(row, 'security_deposit') === 'entered');
  check('a document-supported verified term reads `verified`', AL.cellState(row, 'leased_sqft') === 'verified');
  check('and its origin is not entered', row._origins.leased_sqft === null);
  check('an AI reading reads `read`', AL.cellState(row, 'cap') === 'read');
  check('the note constant names the rule',
    /Entered by a person/.test(AL.ENTERED_NOTE) && /No document on file supports/.test(AL.ENTERED_NOTE));
}

// ── 4 · legacyRows ─────────────────────────────────────────────────────────
section('4 · raw rows: kept in the review, shown only when nothing represents them');
{
  const docs = [lease, amendment];
  const before = JSON.stringify(rawTenants);
  const lg = AL.legacyRows(rawTenants, docs, families);
  check('tenants[] is untouched', JSON.stringify(rawTenants) === before);
  check('both raw rows are represented by the leasehold, so neither is projected',
    lg.rows.length === 0, `${lg.rows.length} rows`);
  check('and the projection says why each was dropped',
    lg.dropped.length === 2 && lg.dropped.every(d => d.why === 'in_leasehold' && d.familyId === 'fam-1'),
    JSON.stringify(lg.dropped));
  check('the dropped record names the file, so history is traceable',
    lg.dropped.every(d => /\.pdf$/.test(d.fileName)));

  // A raw row whose document is in NO leasehold.
  const unfiledDoc = { id: 'doc-x', family_id: null, produced_id: 't-x', file_name: 'Mystery.pdf' };
  const lg2 = AL.legacyRows(
    rawTenants.concat([{ id: 't-x', tenant_name: 'Mystery Tenant', leased_sqft: 1200, _status: 'ok' }]),
    docs.concat([unfiledDoc]), families);
  check('a raw row whose document is unfiled IS projected', lg2.rows.length === 1 && lg2.rows[0].tenant_name === 'Mystery Tenant');
  check('as an unfiled row', lg2.rows[0]._source === AL.SOURCE.UNFILED && lg2.rows[0]._source === 'unfiled');
  check('with the reason', lg2.rows[0]._legacyWhy === 'unfiled_document');
  check('marked unverified, with the note', lg2.rows[0]._unverified === true && lg2.rows[0]._note === AL.UNFILED_NOTE);
  check('with NO states — nothing about it can read as verified',
    Object.keys(lg2.rows[0]._states).length === 0 && AL.cellState(lg2.rows[0], 'leased_sqft') === 'unverified');
  check('its extracted value is still carried — it is what the file said',
    lg2.rows[0].leased_sqft === 1200);
  check('the projected row is a COPY — the raw row gained no marks',
    !('_source' in rawTenants[0]) && !('_unverified' in rawTenants[0]));

  // Lake View: raw rows, no documents, no families.
  const lakeview = [
    { id: 'lv-1', tenant_name: 'Lake Pharmacy', leased_sqft: 3000, base_rent: 60000, _status: 'ok' },
    { id: 'lv-2', tenant_name: 'Lake Diner',    leased_sqft: 2500, _status: 'ok' },
    { id: 'lv-3', tenant_name: 'Failed File',   _status: 'error' },
    { id: 'lv-4', tenant_name: 'Still Reading', _status: 'pending' },
    { id: 'lv-5', leased_sqft: 900, _status: 'ok' },
  ];
  const lg3 = AL.legacyRows(lakeview, [], []);
  check('rows with no document row at all are projected (pre-P1-2 uploads)',
    lg3.rows.length === 2 && lg3.rows.every(r => r._legacyWhy === 'no_document'), `${lg3.rows.length}`);
  check('every one is unfiled and unverified', lg3.rows.every(r => r._source === 'unfiled' && r._unverified));
  check('errored, pending and unnamed rows are skipped, as the engine already skips them',
    !lg3.rows.some(r => /Failed|Still/.test(r.tenant_name || '')) && !lg3.rows.some(r => r.id === 'lv-5'));
  check('nothing was dropped as represented', lg3.dropped.length === 0);

  // A replaced document.
  const replaced = Object.assign({}, lease, { superseded_by_document_id: 'doc-new' });
  const lg4 = AL.legacyRows([rawTenants[0]], [replaced], []);
  check('a raw row whose document was replaced is dropped as `replaced`',
    lg4.rows.length === 0 && lg4.dropped[0].why === 'replaced');

  check('garbage in, empty out', AL.legacyRows(null, undefined, 'x').rows.length === 0);
  check('tenantName camelCase is honoured for the name test',
    AL.legacyRows([{ id: 'c', tenantName: 'Camel', _status: 'ok' }], [], []).rows.length === 1);
}

// ── 5 · leaseholdRows ──────────────────────────────────────────────────────
section('5 · the projection: leaseholds first, unfiled after, source history intact');
{
  const unfiledDoc = { id: 'doc-x', family_id: null, produced_id: 't-x', file_name: 'Mystery.pdf' };
  const tenants = rawTenants.concat([{ id: 't-x', tenant_name: 'Mystery Tenant', leased_sqft: 1200, _status: 'ok' }]);
  const before = JSON.stringify(tenants);
  const out = AL.leaseholdRows({ families, documents: [lease, amendment, unfiledDoc], decisions: [correction], tenants }, WIRE);
  check('the resolver was available', out.resolverAvailable === true);
  check('one leasehold, one unfiled row, two dropped', out.leaseholds === 1 && out.unfiled === 1 && out.dropped.length === 2,
    JSON.stringify({ l: out.leaseholds, u: out.unfiled, d: out.dropped.length }));
  check('leasehold rows come first', out.rows[0]._source === 'leasehold' && out.rows[1]._source === 'unfiled');
  check('two source files became ONE tenant row, carrying the correction',
    out.rows.filter(r => /ShopRite/.test(r.tenant_name)).length === 1 && out.rows[0].leased_sqft === 67000);
  check('the leasehold row knows how many documents stand behind it', out.rows[0]._documentCount === 2);
  check('tenants[] was not modified — the raw upload record survives', JSON.stringify(tenants) === before);
  check('the unfiled row is still what the file said, unverified',
    out.rows[1].leased_sqft === 1200 && out.rows[1]._unverified === true);

  // Only this family's decisions reach this family's terms.
  const other = Object.assign({}, correction, { id: 'dec-2', family_id: 'fam-2', new_value: '99999', decided_at: '2026-09-24T00:00:00Z' });
  const out2 = AL.leaseholdRows({ families, documents: [lease, amendment], decisions: [correction, other], tenants: [] }, WIRE);
  check('a decision on another family does not reach this one', out2.rows[0].leased_sqft === 67000, String(out2.rows[0].leased_sqft));
  // Only this family's documents.
  const strayDoc = Object.assign({}, lease, { id: 'doc-stray', family_id: 'fam-2',
    abstracted_fields: ev({ leased_sqft: F(1, 'one', 1, 1) }) });
  const out3 = AL.leaseholdRows({ families, documents: [lease, amendment, strayDoc], decisions: [], tenants: [] }, WIRE);
  check('a document in another family does not reach this one', out3.rows[0]._documentCount === 2);

  // No resolver: rows still exist, say nothing, and the flag says why.
  const out4 = AL.leaseholdRows({ families, documents: [lease, amendment, unfiledDoc], decisions: [], tenants }, { terms: null, reasoner: null });
  check('without a resolver the projection still returns one row per leasehold',
    out4.resolverAvailable === false && out4.leaseholds === 1 && out4.rows[0]._resolved === false);
  check('with null values rather than stale file values', out4.rows[0].leased_sqft === null);
  check('and the raw rows behind the leasehold are still not shown twice', out4.unfiled === 1);

  check('empty input is an empty projection',
    AL.leaseholdRows(null, WIRE).rows.length === 0 && AL.leaseholdRows({}, WIRE).leaseholds === 0);
  check('the leasehold with no documents at all is a row with nothing established',
    AL.leaseholdRows({ families: [{ id: 'f-empty', label: 'Empty' }], documents: [], decisions: [], tenants: [] }, WIRE)
      .rows[0]._states.leased_sqft === 'missing');
}

// ── 6 · attachStates ───────────────────────────────────────────────────────
section('6 · states ride along to the engine\'s tenantSummary');
{
  const rows = [
    { _source: 'leasehold', _leaseholdId: 'fam-1', _states: { cap: 'conflicting' }, _origins: { cap: null } },
    { _source: 'unfiled', _unverified: true, _legacyWhy: 'no_document', _states: {}, _origins: {} },
  ];
  const ts = [{ name: 'A', sqft: 67000 }, { name: 'B', sqft: 1200 }, { name: 'C' }];
  const out = AL.attachStates(ts, rows);
  check('the same array comes back', out === ts);
  check('row 0 got its leasehold marks', ts[0]._source === 'leasehold' && ts[0]._leaseholdId === 'fam-1' && ts[0]._states.cap === 'conflicting');
  check('row 1 got its unfiled marks', ts[1]._source === 'unfiled' && ts[1]._unverified === true && ts[1]._legacyWhy === 'no_document');
  check('a summary row with no canonical row is left alone', !('_source' in ts[2]));
  check('the engine\'s own fields are not disturbed', ts[0].name === 'A' && ts[0].sqft === 67000);
  check('null input does not throw', Array.isArray(AL.attachStates(null, null)));
}

// ── 7 · cellState ──────────────────────────────────────────────────────────
section('7 · what a cell says');
check('unfiled outranks everything', AL.cellState({ _source: 'unfiled', _states: { cap: 'verified' } }, 'cap') === 'unverified');
check('conflicting → contested', AL.cellState({ _states: { cap: 'conflicting' } }, 'cap') === 'contested');
check('missing → missing', AL.cellState({ _states: { cap: 'missing' } }, 'cap') === 'missing');
check('no state recorded → missing', AL.cellState({ _states: {} }, 'cap') === 'missing');
check('entered → entered, even though its state is verified',
  AL.cellState({ _states: { cap: 'verified' }, _origins: { cap: 'entered' } }, 'cap') === 'entered');
check('verified → verified', AL.cellState({ _states: { cap: 'verified' }, _origins: {} }, 'cap') === 'verified');
check('ai_extracted → read', AL.cellState({ _states: { cap: 'ai_extracted' } }, 'cap') === 'read');
check('unclear → read (a reading with no value shows as a dash anyway)',
  AL.cellState({ _states: { cap: 'unclear' } }, 'cap') === 'read');
check('no row → missing', AL.cellState(null, 'cap') === 'missing');

// ── 8 · the module's shape ─────────────────────────────────────────────────
section('8 · shape');
const src = fs.readFileSync(path.join(ROOT, 'acquisition-leasehold.js'), 'utf8');
check('no DOM, no network, no fetch', !/document\.|window\.fetch|XMLHttpRequest|supabase/i.test(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')));
check('exposed on window as AcquisitionLeasehold', /root\.AcquisitionLeasehold = api/.test(src));
check('index.html loads it', /acquisition-leasehold\.js/.test(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('\nFailures:'); failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
