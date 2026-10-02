'use strict';
/**
 * test-lifecycle-stage.js — P0.2: a property becomes part of the portfolio by
 * a stage transition to `acquired`, never by copying — and until then it moves
 * no portfolio number.
 *
 *   node test-lifecycle-stage.js
 *
 * Offline. Six things, each proved against the real code rather than a copy:
 *
 *   A  the vocabulary and the read helpers (property-lifecycle.js)
 *   B  classify(): a prospect, a passed deal or an unrecognised stage NEVER
 *      lands in `active` or `archived` — the two lists every surface reads
 *   C  transition(): the allowed moves, the refusals, and the PATCH it emits —
 *      stage columns only, never the row's data (the no-copy invariant)
 *   D  loadProperties (script.js, extracted by name and run against a fake
 *      Supabase builder): returns acquired+active rows only, hands the rest to
 *      _prospectProps, and degrades correctly when 023 or 010 is not applied
 *   E  server refusals (P3): the hydrator refuses a prospect or passed deal as
 *      property_not_managed (owned, present, not managed — never "not found");
 *      list_properties lists managed rows only and STATES what it left out;
 *      and the client starts a deal only through begin_acquisition, which
 *      creates the prospect property and the episode together (migration 034)
 *   H  P4 ACQUIRE IN PLACE: a review that has its property is acquired through
 *      ONE acquire_property call on the SAME property — the canonical roster
 *      resolved by the JS resolver, the server's row adopted, the portfolio
 *      reloaded — and never through the legacy copy-based path (no property
 *      build, no saveProperty, no insert, no resync, no review save, before or
 *      after the call). The legacy branch survives only for a review with no
 *      property and still consults the guard. Proved by running the real
 *      functions against recording fakes, with a negative control.
 *   F  LEAKAGE, negatively: the real aggregate engines fed the classified
 *      `active` list produce the managed numbers, and fed the unclassified
 *      rows they produce DIFFERENT numbers — so the assertion has teeth
 *   G  index.html loads the module before script.js; the applied migration
 *      is recorded under migrations/phase0 (see migrations/APPLIED.md)
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const { fnSource } = require('./test-support/fn-source.js');

const PL   = require('./property-lifecycle.js');
const AE   = (() => { const a = require('./acquisition-engine.js'); return a && a.computeRevenueAtRisk ? a : global.AcquisitionEngine; })();

let pass = 0, fail = 0;
const failures = [];
function t(name, cond, detail) {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { fail++; failures.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail !== undefined ? '  — ' + detail : ''}`); }
}
const eq  = (a, b, name) => t(name, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const sec = (s) => console.log(`\n── ${s} ──`);

const ROOT = __dirname;
const SCRIPT = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');

// ── The world ──────────────────────────────────────────────────────────────
const U = '479b339e-9193-4b4d-bcf9-d3aa686a7c37';
const ROWS = [
  { id: 'p-mgd',  user_id: U, name: 'Managed Plaza',  sqft: 10000, archived_at: null, lifecycle_stage: 'acquired' },
  { id: 'p-old',  user_id: U, name: 'Legacy Row',     sqft: 5000,  archived_at: null },                              // predates 023
  { id: 'p-arch', user_id: U, name: 'Archived Plaza', sqft: 60000, archived_at: '2026-01-01T00:00:00Z', lifecycle_stage: 'acquired' },
  { id: 'p-pros', user_id: U, name: 'Prospect Tower', sqft: 90000, archived_at: null, lifecycle_stage: 'prospect' },
  { id: 'p-rev',  user_id: U, name: 'Review Court',   sqft: 40000, archived_at: null, lifecycle_stage: 'under_review' },
  { id: 'p-dd',   user_id: U, name: 'Diligence Mall', sqft: 70000, archived_at: null, lifecycle_stage: 'due_diligence' },
  { id: 'p-pass', user_id: U, name: 'Passed Centre',  sqft: 80000, archived_at: null, lifecycle_stage: 'passed' },
  { id: 'p-parc', user_id: U, name: 'Archived Deal',  sqft: 30000, archived_at: '2026-02-01T00:00:00Z', lifecycle_stage: 'prospect' },
  { id: 'p-odd',  user_id: U, name: 'Odd Stage',      sqft: 20000, archived_at: null, lifecycle_stage: 'sold' },
];
const TENANTS = [
  { id: 't-m',  property_id: 'p-mgd',  name: 'Managed Tenant',  sqft: 8000,  end_date: '2030-01-01' },
  { id: 't-p',  property_id: 'p-pros', name: 'Prospect Tenant', sqft: 90000, end_date: '2026-10-01' },
  { id: 't-x',  property_id: 'p-pass', name: 'Passed Tenant',   sqft: 80000, end_date: '2026-10-01' },
];

(async function main() {

sec('A. The vocabulary and the read helpers');
{
  eq(PL.STAGES, ['prospect', 'under_review', 'due_diligence', 'acquired', 'passed'], 'A1 five stages, in order');
  eq(PL.PRE_ACQUISITION, ['prospect', 'under_review', 'due_diligence'], 'A2 three pre-acquisition stages');
  eq(PL.MANAGED, ['acquired'], 'A3 exactly one managed stage');
  eq(PL.DEFAULT_STAGE, 'acquired', 'A4 a row with no stage is a managed property (the pre-023 world)');
  eq(PL.stageOf({}), 'acquired', 'A5 stageOf: absent → acquired');
  eq(PL.stageOf({ lifecycle_stage: null }), 'acquired', 'A6 stageOf: null → acquired');
  eq(PL.stageOf({ lifecycle_stage: '' }), 'acquired', 'A7 stageOf: empty → acquired');
  eq(PL.stageOf({ lifecycle_stage: 'prospect' }), 'prospect', 'A8 stageOf reads the database column');
  eq(PL.stageOf({ lifecycleStage: 'passed' }), 'passed', 'A9 and the app-side field');
  eq(PL.stageOf({ lifecycle_stage: 'due_diligence', lifecycleStage: 'acquired' }), 'due_diligence', 'A10 the database column wins when both are present');
  eq(PL.stageOf(null), 'acquired', 'A11 stageOf(null) does not throw');
  t('A12 isManaged: acquired only', PL.isManaged({ lifecycle_stage: 'acquired' }) && PL.isManaged({}) &&
    !PL.isManaged({ lifecycle_stage: 'prospect' }) && !PL.isManaged({ lifecycle_stage: 'passed' }) && !PL.isManaged({ lifecycle_stage: 'due_diligence' }));
  t('A13 an UNRECOGNISED stage is not managed — fail closed, out of the portfolio', !PL.isManaged({ lifecycle_stage: 'sold' }) && !PL.isManaged({ lifecycle_stage: 'ACQUIRED' }));
  t('A14 isProspect is the complement of isManaged', PL.isProspect({ lifecycle_stage: 'sold' }) && PL.isProspect({ lifecycle_stage: 'passed' }) && !PL.isProspect({}));
  t('A15 isPreAcquisition covers the three deal stages and nothing else',
    ['prospect', 'under_review', 'due_diligence'].every(s => PL.isPreAcquisition({ lifecycle_stage: s })) &&
    ['acquired', 'passed', 'sold'].every(s => !PL.isPreAcquisition({ lifecycle_stage: s })));
  t('A16 isPassed', PL.isPassed({ lifecycle_stage: 'passed' }) && !PL.isPassed({ lifecycle_stage: 'prospect' }));
  eq(PL.visibility({ lifecycle_stage: 'acquired' }), { portfolio: true, archive: false, acquisitions: false, passed: false }, 'A17 visibility: managed → portfolio only');
  eq(PL.visibility({ lifecycle_stage: 'acquired', archived_at: 't' }), { portfolio: false, archive: true, acquisitions: false, passed: false }, 'A18 visibility: archived → archive only');
  eq(PL.visibility({ lifecycle_stage: 'under_review' }), { portfolio: false, archive: false, acquisitions: true, passed: false }, 'A19 visibility: a deal → acquisitions only');
  eq(PL.visibility({ lifecycle_stage: 'passed' }), { portfolio: false, archive: false, acquisitions: false, passed: true }, 'A20 visibility: passed → the passed filter only');
  eq(PL.visibility({ lifecycle_stage: 'sold' }), { portfolio: false, archive: false, acquisitions: false, passed: false }, 'A21 visibility: an unrecognised stage is visible NOWHERE');
  eq(PL.label('under_review'), 'Under Review', 'A22 labels');
  t('A23 the vocabulary is frozen', Object.isFrozen(PL.STAGES) && Object.isFrozen(PL.TRANSITIONS) && Object.isFrozen(PL.STAGE_COLUMNS));
  eq(PL.MANAGED_FILTER, 'lifecycle_stage=eq.acquired', 'A24 the server-side filter names the one managed stage');
  t('A25 isStageColumnMissing recognises the PostgREST 42703 shapes',
    PL.isStageColumnMissing({ code: '42703', message: 'column properties.lifecycle_stage does not exist' }) &&
    PL.isStageColumnMissing({ message: 'column "lifecycle_stage" does not exist' }) &&
    !PL.isStageColumnMissing({ message: 'column properties.archived_at does not exist' }) &&
    !PL.isStageColumnMissing(null) && !PL.isStageColumnMissing({ message: 'permission denied' }));
}

sec('B. classify(): the split every surface reads');
{
  const c = PL.classify(ROWS);
  eq(c.active.map(r => r.id), ['p-mgd', 'p-old'], 'B1 active = acquired (or pre-023) and not archived');
  eq(c.archived.map(r => r.id), ['p-arch'], 'B2 archived = acquired and archived');
  eq(c.prospects.map(r => r.id), ['p-pros', 'p-rev', 'p-dd', 'p-pass', 'p-parc', 'p-odd'], 'B3 prospects = every pre-acquisition, passed, archived-prospect and unrecognised row');
  eq(c.unrecognised.map(r => r.id), ['p-odd'], 'B4 the unrecognised stage is named, so a caller can say so');
  t('B5 no row is in two lists', new Set([...c.active, ...c.archived, ...c.prospects].map(r => r.id)).size === ROWS.length);
  t('B6 an archived PROSPECT is a prospect, not an archived property — archive does not promote',
    !c.archived.some(r => r.id === 'p-parc') && c.prospects.some(r => r.id === 'p-parc'));
  eq(c.active[0], { id: 'p-mgd', name: 'Managed Plaza', totalSqft: 10000, archivedAt: null, lifecycleStage: 'acquired' },
     'B7 the shape is field-for-field what loadProperties built before P0.2, plus lifecycleStage');
  eq(c.active[1].lifecycleStage, 'acquired', 'B8 a pre-023 row is shaped as acquired');
  eq(PL.classify(null), { active: [], archived: [], prospects: [], unrecognised: [] }, 'B9 classify(null) is four empty lists');
  eq(PL.classify([null, 3, 'x']).active, [], 'B10 junk rows are dropped, not shaped');
  // An already-shaped row round-trips: the browser passes classify() raw rows,
  // but a test or a later caller may pass shaped ones.
  eq(PL.classify(c.active).active.map(r => r.totalSqft), [10000, 5000], 'B11 a shaped row keeps its totalSqft');
  eq(PL.managedOnly(ROWS).map(r => r.id), ['p-mgd', 'p-old'], 'B12 managedOnly() is the same rule as a filter');
  eq(PL.managedOnly(c.active.concat(c.prospects)).map(r => r.id), ['p-mgd', 'p-old'], 'B13 over shaped rows too');
}

sec('C. transition(): the moves, the refusals, and the no-copy invariant');
{
  const row = { id: 'p-pros', name: 'Prospect Tower', sqft: 90000, data: { tenants: [1, 2, 3] }, organization_id: 'org', user_id: U, lifecycle_stage: 'prospect' };
  const NOW = '2026-09-18T12:00:00.000Z';

  const acq = PL.transition(row, 'acquired', { actorUid: U, now: NOW });
  t('C1 prospect → acquired is allowed', acq.ok === true, JSON.stringify(acq));
  eq(acq.patch, { lifecycle_stage: 'acquired', stage_changed_by: U, stage_changed_at: NOW, acquired_at: NOW }, 'C2 the patch: the stage, who, when, and acquired_at');
  t('C3 THE INVARIANT: the patch carries stage columns and nothing else — no id, name, sqft, data, organization_id',
    Object.keys(acq.patch).every(k => PL.STAGE_COLUMNS.indexOf(k) !== -1) &&
    !('id' in acq.patch) && !('name' in acq.patch) && !('data' in acq.patch) && !('sqft' in acq.patch) && !('organization_id' in acq.patch));
  t('C4 and the row handed in was not mutated', row.lifecycle_stage === 'prospect' && row.data.tenants.length === 3);
  t('C5 there is no function here that builds a new property from an old one',
    !/function\s+(copy|clone|duplicate|rebuild|convert)\w*\s*\(/i.test(fs.readFileSync(path.join(ROOT, 'property-lifecycle.js'), 'utf8')));

  const pass_ = PL.transition(row, 'passed', { actorUid: U, now: NOW });
  eq(pass_.patch, { lifecycle_stage: 'passed', stage_changed_by: U, stage_changed_at: NOW, passed_at: NOW }, 'C6 → passed stamps passed_at');
  // LOCKED LIFECYCLE (contract D1, migration 033): under_review and
  // due_diligence are episode progress, never a property destination.
  eq(PL.transition(row, 'under_review', { actorUid: U, now: NOW }).error, 'not_allowed', 'C7 prospect → under_review refused: not a property stage');
  eq(PL.transition(row, 'due_diligence', { actorUid: U, now: NOW }).error, 'not_allowed', 'C7b prospect → due_diligence refused likewise');
  eq(PL.LIFECYCLE_STAGES, ['prospect', 'acquired', 'passed'], 'C7c the property lifecycle is three stages');
  eq(PL.LEGACY_STAGES, ['under_review', 'due_diligence'], 'C7d the two legacy values are named as legacy');

  // The full allowed matrix, from the table.
  const M = {};
  for (const from of PL.STAGES) { M[from] = PL.STAGES.filter(to => PL.canTransition(from, to)); }
  eq(M.prospect,      ['acquired', 'passed'], 'C8 from prospect: acquire or pass, nothing else');
  eq(M.under_review,  ['prospect'],           'C9 a legacy under_review row can only be normalised to prospect');
  eq(M.due_diligence, ['prospect'],           'C10 a legacy due_diligence row can only be normalised to prospect');
  eq(PL.transition({ ...row, lifecycle_stage: 'under_review' }, 'acquired').error, 'not_allowed', 'C10b legacy → acquired refused: normalise to prospect first');
  eq(M.acquired,      [],                                                       'C11 ACQUIRED IS TERMINAL — a managed property leaves by archive, never by stage');
  eq(M.passed,        ['prospect'],                                             'C12 a passed deal can only be reopened');

  eq(PL.transition({ ...row, lifecycle_stage: 'acquired' }, 'prospect').error, 'not_allowed', 'C13 acquired → prospect refused');
  eq(PL.transition({ ...row, lifecycle_stage: 'acquired' }, 'passed').error, 'not_allowed', 'C14 acquired → passed refused');
  eq(PL.transition({ ...row, lifecycle_stage: 'passed' }, 'acquired').error, 'not_allowed', 'C15 passed → acquired refused (reopen first)');
  eq(PL.transition(row, 'prospect').error, 'already_in_stage', 'C16 same stage refused');
  eq(PL.transition(row, 'sold').error, 'unknown_stage', 'C17 an unknown destination refused');
  eq(PL.transition({ ...row, lifecycle_stage: 'sold' }, 'acquired').error, 'unrecognised_current_stage', 'C18 an unrecognised current stage refused — nothing is inferred');
  eq(PL.transition({ name: 'no id', lifecycle_stage: 'prospect' }, 'acquired').error, 'no_property', 'C19 no id, no transition');
  eq(PL.transition(null, 'acquired').error, 'no_property', 'C20 null row refused');
  t('C21 a refusal carries no patch', PL.transition(row, 'sold').patch === undefined);
  const noActor = PL.transition(row, 'acquired', { now: NOW });
  eq(noActor.patch.stage_changed_by, null, 'C22 no actor → null, never a guess');
  t('C23 no clock given → an ISO timestamp from now', /^\d{4}-\d{2}-\d{2}T/.test(PL.transition(row, 'acquired').patch.stage_changed_at));
  eq(PL.transition(row, 'acquired', { now: new Date(NOW) }).patch.acquired_at, NOW, 'C24 a Date is accepted for now');
  // A pre-023 row (no stage) is a managed property, and a managed property has nowhere to go.
  eq(PL.transition({ id: 'x' }, 'prospect').error, 'not_allowed', 'C25 a row with no stage is acquired, and acquired is terminal');
}

sec('D. loadProperties: what the portfolio is made of');
{
  const src = fnSource(SCRIPT, 'loadProperties');
  t('D1 loadProperties hands its rows to PropertyLifecycle.classify', /PropertyLifecycle\.classify\(/.test(src));
  t('D2 and selects the stage column by the module\'s list', /PropertyLifecycle\.SELECT_COLUMNS\b/.test(src) && /SELECT_COLUMNS_PRE_023/.test(src));
  t('D3 and keeps ONLY the active list (or the archived one) — never the prospects',
    /const properties = archived \? split\.archived : split\.active;/.test(src));
  t('D4 and hands the prospects to _prospectProps, from the active read only',
    /_prospectProps = archived \? _prospectProps : split\.prospects;/.test(src));
  t('D5 script.js declares _prospectProps beside _props', /^let _prospectProps = \[\];/m.test(SCRIPT));
  t('D6 nothing in script.js ever reads _prospectProps into an aggregate — no reader yet exists',
    (SCRIPT.match(/_prospectProps/g) || []).length === 3);   // declaration + the two mentions in loadProperties

  // Run it. A fake Supabase builder that honours the two filters loadProperties
  // uses and can reject a column the way PostgREST does (42703).
  function fakeDb(rows, tenants, missing) {
    const calls = [];
    function q(table) {
      const st = { table, cols: null, eqs: [], isNull: null, notNull: null, inList: null };
      const run = () => {
        calls.push({ table, cols: st.cols, isNull: st.isNull, notNull: st.notNull });
        if (table === 'properties') {
          for (const col of missing || []) {
            if (st.cols && st.cols.split(/\s*,\s*/).indexOf(col) !== -1) {
              return { data: null, error: { code: '42703', message: `column properties.${col} does not exist` } };
            }
          }
          let out = rows.filter(r => st.eqs.every(([k, v]) => r[k] === v));
          if (st.isNull)  out = out.filter(r => r[st.isNull] == null);
          if (st.notNull) out = out.filter(r => r[st.notNull] != null);
          const cols = st.cols ? st.cols.split(/\s*,\s*/) : null;
          return { data: out.map(r => { if (!cols) return { ...r }; const o = {}; cols.forEach(c => { if (c in r) o[c] = r[c]; }); return o; }), error: null };
        }
        if (table === 'tenants') {
          return { data: tenants.filter(x => st.inList.indexOf(x.property_id) !== -1), error: null };
        }
        return { data: [], error: null };
      };
      const api = {
        select(c) { st.cols = c; return api; },
        eq(k, v) { st.eqs.push([k, v]); return api; },
        is(k, v) { if (v === null) st.isNull = k; return api; },
        not(k, op, v) { if (op === 'is' && v === null) st.notNull = k; return api; },
        in(k, vals) { st.inList = vals; return api; },
        then(res, rej) { return Promise.resolve(run()).then(res, rej); },
      };
      return api;
    }
    const db = { from: q, auth: { getUser: async () => ({ data: { user: { id: U } } }) } };
    db.calls = calls;
    return db;
  }
  async function runLoad(rows, tenants, missing, opts) {
    const db = fakeDb(rows, tenants, missing);
    const sandbox = { db, PropertyLifecycle: PL, normalizeTenant: (x) => x, console: { warn: () => {}, error: () => {} },
                      _prospectProps: ['stale'], Promise, Error, Array, Object, String, Number, JSON, RegExp };
    vm.createContext(sandbox);
    // Step A-1: loadProperties selects and maps tenants rows through the shared
    // column list and mapper declared beside it in script.js — run those too.
    const rowSrc = SCRIPT.slice(SCRIPT.indexOf('const TENANT_ROW_COLUMNS_PRE_037'),
                                SCRIPT.indexOf('// The table is the authority on a leasehold'));
    vm.runInContext(rowSrc + '\n' + src + '\nthis.loadProperties = loadProperties;', sandbox);
    const out = await sandbox.loadProperties(opts);
    return { out, prospects: sandbox._prospectProps, calls: db.calls };
  }

  const a = await runLoad(ROWS, TENANTS, []);
  eq(a.out.map(p => p.id), ['p-mgd', 'p-old'], 'D7 the active read returns acquired+active rows only');
  eq(a.prospects.map(p => p.id), ['p-pros', 'p-rev', 'p-dd', 'p-pass', 'p-odd'], 'D8 every non-managed active-side row lands in _prospectProps');
  t('D9 the stage column was selected', a.calls[0].cols === PL.SELECT_COLUMNS, a.calls[0].cols);
  t('D10 the archived filter is still applied at the query', a.calls[0].isNull === 'archived_at');
  eq(a.out[0].tenants.length, 1, 'D11 tenants are attached to the managed property');
  t('D12 and the prospect\'s tenant was not fetched for it — prospects are not hydrated here',
    !a.out.some(p => (p.tenants || []).some(x => x.id === 't-p')));
  eq(a.out[0], { id: 'p-mgd', name: 'Managed Plaza', totalSqft: 10000, archivedAt: null, lifecycleStage: 'acquired', tenants: a.out[0].tenants },
     'D13 the returned shape is the pre-P0.2 shape plus lifecycleStage');

  const b = await runLoad(ROWS, TENANTS, [], { archived: true });
  eq(b.out.map(p => p.id), ['p-arch'], 'D14 the archived read returns archived MANAGED rows only');
  eq(b.prospects, ['stale'], 'D15 and leaves _prospectProps alone — an archived prospect does not overwrite the deal list');

  const c = await runLoad(ROWS, TENANTS, ['lifecycle_stage']);
  t('D16 without migration 023 the query is retried without the stage column', c.calls.length >= 2 && c.calls[1].cols === PL.SELECT_COLUMNS_PRE_023, JSON.stringify(c.calls.map(x => x.cols)));
  eq(c.out.map(p => p.id).sort(), ['p-dd', 'p-mgd', 'p-odd', 'p-old', 'p-pass', 'p-pros', 'p-rev'], 'D17 and every active row reads as a managed property — the whole truth on that project');
  eq(c.prospects, [], 'D18 with no prospects');
  t('D19 the archived filter survived the retry', c.calls[1].isNull === 'archived_at');

  const d = await runLoad(ROWS, TENANTS, ['lifecycle_stage', 'archived_at']);
  eq(d.out.length, ROWS.length, 'D20 without 010 either, every row is active (the pre-existing degrade rule)');
  const e = await runLoad(ROWS, TENANTS, ['lifecycle_stage', 'archived_at'], { archived: true });
  eq(e.out, [], 'D21 and the archived view is empty rather than wrong');
}

sec('E. Server refusals (P3): the hydrator and list_properties know the stage; the client starts a deal only through begin_acquisition');
{
  const HYD  = require('./api/_property-record-hydrator.js');
  const MCP  = require('./api/_mcp-capabilities.js');
  const DEPS = require('./api/_server-deps.js');
  const OWNER  = U;
  const P_MGD  = '11111111-1111-4111-8111-111111111111';
  const P_DEAL = '33333333-3333-4333-8333-333333333333';
  const P_PASS = '44444444-4444-4444-8444-444444444444';
  const P_OLD  = '55555555-5555-4555-8555-555555555555';
  const blob = { tenants: [], invoices: [], disputes: [], timeline: [] };
  const SRV = [
    { id: P_MGD,  user_id: OWNER, name: 'Managed Plaza',  sqft: 1000,  data: blob, created_at: '2025-01-01T00:00:00Z', updated_at: '2025-02-01T00:00:00Z', archived_at: null, lifecycle_stage: 'acquired' },
    { id: P_DEAL, user_id: OWNER, name: 'Prospect Tower', sqft: 90000, data: blob, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-02T00:00:00Z', archived_at: null, lifecycle_stage: 'prospect' },
    { id: P_PASS, user_id: OWNER, name: 'Passed Centre',  sqft: 80000, data: blob, created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-02T00:00:00Z', archived_at: null, lifecycle_stage: 'passed' },
    { id: P_OLD,  user_id: OWNER, name: 'Legacy Row',     sqft: 5000,  data: blob, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-02-01T00:00:00Z', archived_at: null }, // predates 023
  ];
  // The transport honours the SELECT projection, so a server that stops
  // selecting the stage is caught here rather than passing on a row the mock
  // was too generous with.
  const project = (row, p) => {
    const m = p.match(/select=([^&]+)/); if (!m) return row;
    const o = {}; m[1].split(',').forEach(c => { if (c in row) o[c] = row[c]; }); return o;
  };
  function sb(rows) {
    const calls = [];
    const fn = async (p, options) => {
      calls.push({ path: p, method: (options && options.method) || 'GET' });
      if (/^\/properties\?/.test(p)) {
        const idm = p.match(/(?:^|[?&])id=eq\.([^&]+)/), uidm = p.match(/user_id=eq\.([^&]+)/);
        const out = (rows || SRV).filter(r => (!uidm || r.user_id === decodeURIComponent(uidm[1])) && (!idm || r.id === decodeURIComponent(idm[1])));
        return { status: 200, json: out.map(r => project(r, p)) };
      }
      if (/^\/tenants\?|^\/tenant_field_evidence\?/.test(p)) return { status: 200, json: [] };
      return { status: 404, json: [] };
    };
    fn.calls = calls; return fn;
  }
  const auth = async (tok) => tok === 'owner' ? { status: 200, json: { id: OWNER, role: 'authenticated' } } : { status: 401, json: {} };
  const ctx  = (over) => Object.assign({ token: 'owner', authFetch: auth, sbFetch: sb(), now: '2026-09-27T00:00:00Z' }, over || {});
  const codes = (env) => (env.caveats || []).map(c => c.code);

  // the hydrator
  eq(HYD.REFUSAL.NOT_MANAGED, 'property_not_managed', 'E1 the hydrator names the refusal: property_not_managed');
  const hMgd = await HYD.hydrate({ propertyId: P_MGD, userId: OWNER, sbFetch: sb(), deps: DEPS });
  t('E2 a managed property hydrates', hMgd.ok === true, hMgd.reason);
  const t3 = sb();
  const hDeal = await HYD.hydrate({ propertyId: P_DEAL, userId: OWNER, sbFetch: t3, deps: DEPS });
  eq([hDeal.ok, hDeal.reason], [false, 'property_not_managed'], 'E3 a PROSPECT is refused as not managed — not as not found, not as not authorised');
  t('E4 and refused after the ownership probe and the property read, before any tenant or evidence read',
    t3.calls.length === 2 && !t3.calls.some(c => /^\/tenants|^\/tenant_field_evidence/.test(c.path)), JSON.stringify(t3.calls.map(c => c.path)));
  const hPass = await HYD.hydrate({ propertyId: P_PASS, userId: OWNER, sbFetch: sb(), deps: DEPS });
  eq([hPass.ok, hPass.reason], [false, 'property_not_managed'], 'E5 a PASSED deal is refused the same way');
  const hOld = await HYD.hydrate({ propertyId: P_OLD, userId: OWNER, sbFetch: sb(), deps: DEPS });
  t('E6 a row with no stage (pre-023) is managed and hydrates — the default rule holds on the server too', hOld.ok === true, hOld.reason);
  t('E7 the property read selects lifecycle_stage', t3.calls.some(c => /select=id,name,sqft,data,lifecycle_stage/.test(c.path)), JSON.stringify(t3.calls.map(c => c.path)));

  // list_properties
  const d1 = sb();
  const list = await MCP.call('list_properties', {}, ctx({ sbFetch: d1 }));
  eq(list.data.properties.map(p => p.propertyId).sort(), [P_MGD, P_OLD].sort(), 'E8 list_properties lists the managed properties only — the prospect and the passed deal are not in it');
  eq(list.data.count, 2, 'E9 and the count is of what is listed');
  t('E10 the list read selects lifecycle_stage', /lifecycle_stage/.test(d1.calls[0].path), d1.calls[0].path);
  t('E11 the two left out are STATED, not silently dropped: prospects_not_listed', codes(list).indexOf('prospects_not_listed') !== -1, JSON.stringify(codes(list)));
  const cav = (list.caveats || []).find(c => c.code === 'prospects_not_listed') || { message: '' };
  t('E12 and the caveat counts them and says they are not missing', /\b2 property records\b/.test(cav.message) && /not missing/.test(cav.message), cav.message);
  const listMgd = await MCP.call('list_properties', {}, ctx({ sbFetch: sb(SRV.filter(r => r.id === P_MGD || r.id === P_OLD)) }));
  t('E13 with no deal among the rows there is no such caveat', codes(listMgd).indexOf('prospects_not_listed') === -1, JSON.stringify(codes(listMgd)));

  // get_property through the capability
  const gDeal = await MCP.call('get_property', { propertyId: P_DEAL }, ctx());
  eq([gDeal.data, codes(gDeal)], [null, ['property_not_managed']], 'E14 get_property on a prospect returns no data and the property_not_managed refusal');
  t('E15 whose message says it is a prospect or passed deal, not that it does not exist', /prospect or a passed deal/.test(gDeal.caveats[0].message) && !/no such property/i.test(gDeal.caveats[0].message), gDeal.caveats[0].message);
  const gMgd = await MCP.call('get_property', { propertyId: P_MGD }, ctx());
  t('E16 get_property on a managed property still answers', gMgd.data && gMgd.data.propertyId === P_MGD, JSON.stringify(codes(gMgd)));

  // the client: a deal is born only through begin_acquisition (migration 034)
  const create = fnSource(SCRIPT, 'createAcquisitionReview');
  t('E17 createAcquisitionReview calls begin_acquisition with the name and the new review data', create.includes("db.rpc('begin_acquisition', { p_name: review.name, p_data: review.data })"));
  t('E18 and no longer inserts the review row itself', !/\.from\('acquisition_reviews'\)\s*\.insert\(/.test(create));
  t('E19 a call that returns no record adds nothing on screen', create.includes('if (!created || !created.review_id || !created.property_id) {') && /return;/.test(create.slice(create.indexOf('!created.property_id'))));
  t('E20 the returned ids and revision are adopted', create.includes('review.property_id  = created.property_id') && create.includes('_acqRevs.set(id, review.updated_at)'));
  t('E21 nowhere in script.js is a row inserted or upserted into acquisition_reviews any more', !/\.from\('acquisition_reviews'\)\s*\.(insert|upsert)\(/.test(SCRIPT));
  const save = fnSource(SCRIPT, '_saveAcqReview');
  t('E22 a save that finds no stored row does not re-create it, and says so', !/upsert\(/.test(save) && /no stored record/.test(save));
  const demo = fnSource(SCRIPT, 'ensureDemoAcqReview');
  t('E23 the demo seed creates its review through begin_acquisition under the demo id, and updates an existing row in place', demo.includes('p_review_id: DEMO_ACQ_REVIEW_ID') && !/upsert\(/.test(demo) && /\.update\(\{ name: review\.name, status: review\.status, data: review\.data \}\)/.test(demo));
  const del = fnSource(SCRIPT, 'deleteActiveAcquisitionReview');
  t('E24 deleting a deal on a prospect property goes through delete_prospect_acquisition', del.includes("if (onProspect) {\n      ({ error } = await db.rpc('delete_prospect_acquisition', { p_review_id: id }));"));
  t('E25 and a legacy episode without a property keeps the direct delete', /\.from\('acquisition_reviews'\)\s*\.delete\(\)/.test(del) && del.includes("const onProspect = !!review.property_id && review.status !== 'converted';"));
  const load = fnSource(SCRIPT, '_loadAcqReviews');
  t('E26 the review list carries property_id and converted_at', load.includes("select('id, name, status, data, property_id, converted_at, created_at, updated_at')"));
  const state = fnSource(SCRIPT, '_acqPropertyState');
  t('E27 the conversion state reads the row\'s own property_id first, the legacy record second', state.includes('const pid = review?.property_id || review?.data?.conversionRecord?.propertyId;'));
  const card = fnSource(SCRIPT, '_renderAcqCards');   // the cards' markup, drawn for _renderAcqSection
  t('E28 an open episode\'s card says it sits on a prospect property', card.includes("(r.property_id && r.status !== 'converted')") && /acq-card-prospect/.test(card));
}

sec('H. P4 ACQUIRE IN PLACE: a review that has its property is acquired through acquire_property on the SAME property; the legacy copy-based path is reachable only for a review with none');
{
  // The real functions, run against fakes that RECORD every write. The proof
  // is behavioural: on a P3 review (property_id set, open) the conversion must
  // call acquire_property once, with the canonical roster naming this property
  // and this review, and reach none of buildPropertyFromReview, saveProperty,
  // the properties insert, the tenant resync or the review save — before OR
  // after the call. It adopts the row the server returns and reloads the
  // portfolio from the database.
  const constSrc = (SCRIPT.match(/const _ACQ_LEGACY_ACQUIRE_UNAVAILABLE = [\s\S]*?';\n/) || [''])[0];
  t('H0 the legacy-branch guard constant exists', !!constSrc);
  const src = constSrc + '\n'
    + fnSource(SCRIPT, '_acqLegacyAcquireGuard') + '\n'
    + fnSource(SCRIPT, '_acqConversionBlock') + '\n'
    + fnSource(SCRIPT, '_acqAcquireSnapshot') + '\n'
    + fnSource(SCRIPT, '_acqAcquireInPlace') + '\n'
    + fnSource(SCRIPT, 'convertAcquisitionToProperty') + '\n';
  const P = 'a9903ebf-9f30-4f9d-b002-c34cfac89e27';
  const F1 = 'ffffffff-0000-4000-8000-0000000000f1', F2 = 'ffffffff-0000-4000-8000-0000000000f2';
  function world(review, opts) {
    const o = opts || {};
    const calls = { build: 0, save: 0, insert: 0, resync: 0, reviewSave: 0, alerts: [], hide: 0, rpc: [], reload: 0 };
    const canon = [
      { id: F1, _leaseholdId: F1, _source: 'leasehold', _status: 'ok', tenant_name: 'Tenant One', leased_sqft: '400', cap: 5, start_date: '2024-01-01', end_date: '2029-12-31', lease_type: 'NNN', _states: { cap: 'verified' } },
      { id: F2, _leaseholdId: F2, _source: 'leasehold', _status: 'ok', tenant_name: 'Tenant Two', leased_sqft: '600', cap: null, start_date: null, end_date: null, lease_type: 'Gross', _states: {} },
    ];
    const sandbox = {
      _acqReviews: [review], _activeAcqId: review.id, _props: [], _archivedProps: [], _propsLoadedOk: true,
      _acqRevs: new Map(),
      _acqOrphaned: () => false,
      // P5-6A: every review in these worlds is open; the freeze never fires.
      _acqFrozen: () => false, _acqRefuseFrozen: () => false, showToast: () => {},
      _acqEnsureRecord: async () => {},
      _acqRecordLoaded: () => o.loaded !== false,
      _acqUnresolvedExtractions: () => 0, _acqPendingDocuments: () => [],
      _acqLeaseholdsOnly: () => canon, _acqCanonicalRows: () => ({ rows: canon, leaseholds: 2, unfiled: 0, dropped: [], resolverAvailable: true }),
      _acqAnalysisStale: () => '',
      _acqConversionReview: (r) => Object.assign({}, r, { data: Object.assign({}, r.data, { tenants: canon }) }),
      AcquisitionEngine: { buildPropertyFromReview: () => { calls.build++; return { name: review.name, tenants: [], _conversionSource: { convertedAt: 'now' } }; } },
      saveProperty: async (p) => { calls.save++; p.id = 'NEW-PROPERTY-Q'; throw new Error('harness stop after saveProperty'); },
      resyncTenantsToTable: async () => { calls.resync++; },
      _saveAcqReview: async () => { calls.reviewSave++; return true; },
      _reloadPortfolioAfterLifecycleChange: async () => { calls.reload++; },
      _AW: () => ({ markAcquired: (r) => r }), _acqActor: () => 'test',
      _renderAcqConvertAction: () => {}, _renderAcqStageChips: () => {}, _renderAcqSection: () => {}, renderPortfolio: () => {},
      _hideAcqConvertModal: () => { calls.hide++; },
      alert: (m) => { calls.alerts.push(String(m)); },
      document: { getElementById: () => null },
      db: {
        from: () => ({ insert: () => { calls.insert++; return Promise.resolve({ data: null, error: null }); } }),
        rpc: async (fn, args) => { calls.rpc.push({ fn, args: JSON.parse(JSON.stringify(args)) }); return o.rpc ? o.rpc(fn, args) : { data: null, error: { message: 'no rpc in this world' } }; },
      },
      console: { log: () => {}, warn: () => {}, error: () => {} },
      Promise, Error, Array, Object, String, Number, JSON, RegExp, Date, Map,
    };
    vm.createContext(sandbox);
    vm.runInContext(src + '\nthis._acqLegacyAcquireGuard = _acqLegacyAcquireGuard; this._acqConversionBlock = _acqConversionBlock; this._acqAcquireSnapshot = _acqAcquireSnapshot; this.convertAcquisitionToProperty = convertAcquisitionToProperty;', sandbox);
    return { sandbox, calls };
  }
  const mkP3 = () => ({ id: 'r-p3', name: 'Lakeview', status: 'complete', property_id: P, converted_at: null, data: { analysis: { summary: {}, rentRoll: { occupancy: 87.5, walt: 4.2 } }, tenants: [], invoices: [{ id: 'inv-1', amount: 100 }] } });
  const legacy = { id: 'r-old', name: 'Old deal', status: 'complete', property_id: null, data: { analysis: { summary: {} }, tenants: [], invoices: [] } };
  const converted = { id: 'r-conv', name: 'Done', status: 'converted', property_id: P, data: { conversionRecord: { propertyId: P } } };
  const serverOk = (fn, args) => ({ data: { ok: true, property_id: args.p_property_id, review_id: args.p_review_id, lifecycle_stage: 'acquired', converted_at: '2026-09-27T10:00:00Z', tenants_written: 2, invoices_carried: 1, event_id: 'ev-1',
    review: { id: args.p_review_id, status: 'converted', property_id: args.p_property_id, converted_at: '2026-09-27T10:00:00Z', updated_at: '2026-09-27T10:00:00.5Z', data: { conversionRecord: { propertyId: args.p_property_id, source: 'acquire_property' }, stage: 'acquired', activity: [{ type: 'converted' }] } } }, error: null });

  // the legacy-branch guard, unchanged in meaning
  const w0 = world(mkP3());
  t('H1 the guard still names an open review that has its property', /temporarily unavailable/.test(w0.sandbox._acqLegacyAcquireGuard(mkP3())));
  eq(w0.sandbox._acqLegacyAcquireGuard(legacy), '', 'H2 a legacy review with no property is not guarded');
  eq(w0.sandbox._acqLegacyAcquireGuard(converted), '', 'H3 a converted review is not guarded');
  t('H4 the GATE no longer carries the guard: a P3 review with a clean record passes it (the RPC path is open)', w0.sandbox._acqConversionBlock(mkP3()) === '' && !/_acqLegacyAcquireGuard/.test(fnSource(SCRIPT, '_acqConversionBlock')));
  t('H5 the legacy branch of convertAcquisitionToProperty still consults the guard, after the P3 branch', (() => {
    const b = fnSource(SCRIPT, 'convertAcquisitionToProperty');
    return b.indexOf('return _acqAcquireInPlace(review);') !== -1 && b.indexOf('_acqLegacyAcquireGuard(review)') > b.indexOf('return _acqAcquireInPlace(review);');
  })());

  // the snapshot: the canonical roster, each row naming its leasehold, this property, this review
  const snap = w0.sandbox._acqAcquireSnapshot(mkP3());
  t('H6 the snapshot roster has one row per canonical leasehold, id = family_id = the leasehold id, property_id and review_id set, no private keys',
    snap.roster.length === 2 && snap.roster.every((r, i) => r.id === [F1, F2][i] && r.family_id === r.id && r.property_id === P && r.review_id === 'r-p3' && Object.keys(r).every(k => k.charAt(0) !== '_'))
    && snap.roster[0].tenant_name === 'Tenant One' && snap.roster[0].leased_sqft === '400', JSON.stringify(snap.roster).slice(0, 200));
  t('H7 and carries the analysis figures for the conversion record', snap.occupancyAtAcquisition === 87.5 && snap.waltAtAcquisition === 4.2 && snap.propertyName === 'Lakeview');

  // success: one RPC, no other write, adoption, reload
  const p3a = mkP3();
  const w1 = world(p3a, { rpc: serverOk });
  await w1.sandbox.convertAcquisitionToProperty();
  t('H8 a P3 review is acquired through ONE acquire_property call on ITS property and review', w1.calls.rpc.length === 1 && w1.calls.rpc[0].fn === 'acquire_property' && w1.calls.rpc[0].args.p_property_id === P && w1.calls.rpc[0].args.p_review_id === 'r-p3' && w1.calls.rpc[0].args.p_snapshot.roster.length === 2, JSON.stringify(w1.calls.rpc).slice(0, 200));
  t('H9 it builds NO property, and calls saveProperty / the properties insert / the tenant resync / the review save ZERO times — before or after the call', w1.calls.build === 0 && w1.calls.save === 0 && w1.calls.insert === 0 && w1.calls.resync === 0 && w1.calls.reviewSave === 0, JSON.stringify(w1.calls));
  t('H10 the server\'s review row is adopted: converted, converted_at, the same property_id, the server\'s data and revision', p3a.status === 'converted' && p3a.converted_at === '2026-09-27T10:00:00Z' && p3a.property_id === P && p3a.data.conversionRecord.source === 'acquire_property' && w1.sandbox._acqRevs.get('r-p3') === '2026-09-27T10:00:00.5Z');
  t('H11 the portfolio is reloaded from the database (the same property enters it) and nothing is pushed into _props', w1.calls.reload === 1 && w1.sandbox._props.length === 0 && w1.calls.hide === 1 && w1.calls.alerts.length === 0, JSON.stringify(w1.calls));

  // refusal: the server said no
  const p3b = mkP3();
  const w2 = world(p3b, { rpc: () => ({ data: null, error: { code: 'P0001', message: 'Review has 1 document(s) a person must still resolve' } }) });
  await w2.sandbox.convertAcquisitionToProperty();
  t('H12 when the server refuses, the person is told, and the review is untouched on screen', w2.calls.alerts.length === 1 && /Acquisition failed/.test(w2.calls.alerts[0]) && /must still resolve/.test(w2.calls.alerts[0]) && p3b.status === 'complete' && p3b.converted_at === null && w2.calls.reload === 0 && w2.calls.reviewSave === 0, JSON.stringify(w2.calls.alerts));
  // a result that does not name the acquired property is not trusted
  const p3c = mkP3();
  const w3 = world(p3c, { rpc: (fn, args) => ({ data: { ok: true, property_id: 'some-other-property', review: { status: 'converted' } }, error: null }) });
  await w3.sandbox.convertAcquisitionToProperty();
  t('H13 a result naming a different property is refused: nothing is adopted, nothing reloaded', p3c.status === 'complete' && w3.calls.reload === 0 && w3.calls.alerts.length === 1 && /did not confirm/.test(w3.calls.alerts[0]));

  // the gate still stands in front of the RPC
  const p3d = mkP3();
  const w4 = world(p3d, { rpc: serverOk, loaded: false });
  await w4.sandbox.convertAcquisitionToProperty();
  t('H14 the client gate runs before the RPC: a review whose record has not loaded makes no call', w4.calls.rpc.length === 0 && w4.calls.alerts.length === 1 && /Loading/.test(w4.calls.alerts[0]));

  // Negative control: the same harness reaches the legacy write for a review
  // with no property, so the zeros above are the P3 branch's doing.
  const w5 = world(legacy);
  await w5.sandbox.convertAcquisitionToProperty();
  t('H15 CONTROL — a legacy review without a property still reaches buildPropertyFromReview and saveProperty in this harness', w5.calls.build === 1 && w5.calls.save === 1 && w5.calls.rpc.length === 0, JSON.stringify(w5.calls));

  // Structural: the RPC branch contains none of the legacy writes; the gate is what the button, the modal and the conversion consult.
  const inPlace = fnSource(SCRIPT, '_acqAcquireInPlace');
  t('H16 _acqAcquireInPlace contains no property build, no saveProperty, no resync, no review save, no insert', !/buildPropertyFromReview|saveProperty\(|resyncTenantsToTable|_saveAcqReview|\.insert\(|\.upsert\(/.test(inPlace) && /db\.rpc\('acquire_property'/.test(inPlace));
  t('H17 the button, the modal and the conversion each consult the gate', /_acqConversionBlock\(review\)/.test(fnSource(SCRIPT, '_renderAcqConvertAction')) && /_acqConversionBlock\(review\)/.test(fnSource(SCRIPT, '_showAcqConvertModal')) && /_acqConversionBlock\(review\)/.test(inPlace));
}

sec('F. LEAKAGE, negatively: the real engines fed the right list, and the wrong one');
{
  const shapedAll = ROWS.map(r => ({ id: r.id, name: r.name, totalSqft: r.sqft, archivedAt: r.archived_at || null, lifecycle_stage: r.lifecycle_stage,
    tenants: TENANTS.filter(x => x.property_id === r.id).map(x => ({ id: x.id, tenant_name: x.name, leased_sqft: x.sqft, end_date: x.end_date })) }));
  const active = PL.classify(shapedAll).active.map(p => ({ ...p, tenants: shapedAll.find(r => r.id === p.id).tenants }));

  const pidActive = AE.computePortfolioIntelligence(active, new Date('2026-09-18'));
  const pidAll    = AE.computePortfolioIntelligence(shapedAll, new Date('2026-09-18'));
  eq(pidActive.propertyCount, 2, 'F1 portfolio intelligence over the classified list counts the two managed properties');
  eq(pidActive.totalBuildingSqft, 15000, 'F2 and their 15,000 sqft — not the 405,000 the deals would add');
  t('F3 THE TEETH: the same engine over the unclassified rows gives different numbers', pidAll.propertyCount === ROWS.length && pidAll.totalBuildingSqft > 15000, JSON.stringify([pidAll.propertyCount, pidAll.totalBuildingSqft]));
  const rarActive = AE.computeRevenueAtRisk(active, new Date('2026-09-18'));
  const rarAll    = AE.computeRevenueAtRisk(shapedAll, new Date('2026-09-18'));
  t('F4 revenue at risk over the classified list carries no prospect lease',
    ![...rarActive.expired, ...rarActive.critical, ...rarActive.high, ...rarActive.medium].some(a => a.propertyId === 'p-pros' || a.propertyId === 'p-pass'));
  t('F5 and over the unclassified rows it WOULD have (the 2026-10-01 expiries)',
    [...rarAll.expired, ...rarAll.critical, ...rarAll.high, ...rarAll.medium].some(a => a.propertyId === 'p-pros'));
  eq(PL.managedOnly(shapedAll).map(p => p.id), ['p-mgd', 'p-old'], 'F6 managedOnly() over the same rows agrees with classify()');
}

sec('G. Wiring');
{
  t('G19 index.html loads property-lifecycle.js before script.js', (() => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    return html.indexOf('<script src="property-lifecycle.js">') !== -1 && html.indexOf('<script src="property-lifecycle.js">') < html.indexOf('<script src="script.js">');
  })());
}

console.log('\n' + '─'.repeat(58));
if (fail) {
  console.log(`\x1b[31mRESULT: ${pass} passed, ${fail} failed\x1b[0m`);
  failures.forEach(f => console.log(`  · ${f}`));
  process.exit(1);
}
console.log(`\x1b[32mRESULT: ${pass} passed, 0 failed\x1b[0m`);
})().catch(e => { console.error(e); process.exit(1); });
