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
 *   E  the server: get_property refuses a prospect by name; list_properties
 *      lists managed properties only and SAYS how many it left out; both read
 *      correctly on a project without the column
 *   F  LEAKAGE, negatively: the real aggregate engines fed the classified
 *      `active` list produce the managed numbers, and fed the unclassified
 *      rows they produce DIFFERENT numbers — so the assertion has teeth
 *   G  migration 023 and its rollback say what the plan says
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const { fnSource } = require('./test-support/fn-source.js');

const PL   = require('./property-lifecycle.js');
const HYD  = require('./api/_property-record-hydrator.js');
const MCP  = require('./api/_mcp-capabilities.js');
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
  eq(PL.transition(row, 'under_review', { actorUid: U, now: NOW }).patch,
     { lifecycle_stage: 'under_review', stage_changed_by: U, stage_changed_at: NOW }, 'C7 a move within the deal path stamps neither');

  // The full allowed matrix, from the table.
  const M = {};
  for (const from of PL.STAGES) { M[from] = PL.STAGES.filter(to => PL.canTransition(from, to)); }
  eq(M.prospect,      ['under_review', 'due_diligence', 'acquired', 'passed'], 'C8 from prospect');
  eq(M.under_review,  ['prospect', 'due_diligence', 'acquired', 'passed'],     'C9 from under_review');
  eq(M.due_diligence, ['prospect', 'under_review', 'acquired', 'passed'],      'C10 from due_diligence');
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
    vm.runInContext(src + '\nthis.loadProperties = loadProperties;', sandbox);
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

sec('E. The server: prospects are refused by name, never listed as properties');
{
  const PROP_ID = 'p-pros', MGD_ID = 'p-mgd';
  function sbFake(o) {
    o = Object.assign({ stageColumn: true, stageOf: {} }, o || {});
    const calls = [];
    const fn = async (p, options) => {
      calls.push(p);
      const m = p.match(/^\/properties\?id=eq\.([^&]+)&user_id=eq\.([^&]+)&select=id$/);
      if (m) return { status: 200, json: ROWS.some(r => r.id === decodeURIComponent(m[1])) && decodeURIComponent(m[2]) === U ? [{ id: decodeURIComponent(m[1]) }] : [] };
      if (/^\/properties\?id=eq\./.test(p)) {
        const id = decodeURIComponent(p.match(/id=eq\.([^&]+)/)[1]);
        const sel = (p.match(/select=([^&]+)/) || [])[1] || '';
        if (/lifecycle_stage/.test(sel) && !o.stageColumn) return { status: 400, json: { code: '42703', message: 'column properties.lifecycle_stage does not exist' } };
        const r = ROWS.find(x => x.id === id);
        if (!r) return { status: 200, json: [] };
        const out = { id: r.id, name: r.name, sqft: r.sqft, data: { tenants: [] } };
        if (/lifecycle_stage/.test(sel)) out.lifecycle_stage = r.lifecycle_stage === undefined ? null : r.lifecycle_stage;
        if (/organization_id/.test(sel)) out.organization_id = null;
        return { status: 200, json: [out] };
      }
      if (/^\/properties\?/.test(p)) {   // the listing
        const sel = (p.match(/select=([^&]+)/) || [])[1] || '';
        if (/lifecycle_stage/.test(sel) && !o.stageColumn) return { status: 400, json: { code: '42703', message: 'column properties.lifecycle_stage does not exist' } };
        return { status: 200, json: ROWS.filter(r => !r.archived_at || true).map(r => {
          const row = { id: r.id, name: r.name, sqft: r.sqft, created_at: 'c', updated_at: 'u', archived_at: r.archived_at };
          if (/lifecycle_stage/.test(sel)) row.lifecycle_stage = r.lifecycle_stage === undefined ? null : r.lifecycle_stage;
          return row;
        }) };
      }
      if (/^\/organization_members/.test(p)) return { status: 404, json: { code: 'PGRST205' } };
      if (/^\/tenant_field_evidence|^\/tenants/.test(p)) return { status: 200, json: [] };
      return { status: 404, json: [] };
    };
    fn.calls = calls;
    return fn;
  }

  const refused = await HYD.hydrate({ propertyId: PROP_ID, userId: U, sbFetch: sbFake() });
  eq(refused.ok, false, 'E1 the hydrator refuses a prospect');
  eq(refused.reason, HYD.REFUSAL.NOT_MANAGED, 'E2 by name: property_not_managed');
  eq(refused.lifecycleStage, 'prospect', 'E3 and says which stage it is in');
  t('E4 and never read the tenants or evidence for it', !refused.reads.some(r => /tenants|evidence/.test(r)));
  for (const id of ['p-pass', 'p-dd', 'p-rev', 'p-odd']) {
    const r = await HYD.hydrate({ propertyId: id, userId: U, sbFetch: sbFake() });
    eq(r.reason, HYD.REFUSAL.NOT_MANAGED, `E5 ${id} is refused the same way`);
  }
  const okMgd = await HYD.hydrate({ propertyId: MGD_ID, userId: U, sbFetch: sbFake() });
  t('E6 a managed property hydrates as before', okMgd.ok === true && okMgd.lifecycleStage === 'acquired', JSON.stringify(okMgd.reason));
  const okOld = await HYD.hydrate({ propertyId: 'p-old', userId: U, sbFetch: sbFake() });
  t('E7 a pre-023 row (null stage) hydrates as a managed property', okOld.ok === true && okOld.lifecycleStage === 'acquired');
  const widened = await HYD.hydrate({ propertyId: PROP_ID, userId: U, sbFetch: sbFake(), stages: ['prospect', 'under_review', 'due_diligence'] });
  t('E8 a caller that names the pre-acquisition stages explicitly may hydrate a prospect', widened.ok === true && widened.lifecycleStage === 'prospect');
  const widenedWrong = await HYD.hydrate({ propertyId: 'p-pass', userId: U, sbFetch: sbFake(), stages: ['prospect'] });
  eq(widenedWrong.reason, HYD.REFUSAL.NOT_MANAGED, 'E9 and only those stages — a passed deal is still refused');
  const noCol = await HYD.hydrate({ propertyId: MGD_ID, userId: U, sbFetch: sbFake({ stageColumn: false }) });
  t('E10 without migration 023 the hydrator retries without the column and says the stage was assumed',
    noCol.ok === true && noCol.degraded.indexOf('lifecycle.stage_column_absent') !== -1, JSON.stringify(noCol.degraded));
  const noColPros = await HYD.hydrate({ propertyId: PROP_ID, userId: U, sbFetch: sbFake({ stageColumn: false }) });
  t('E11 on that project a would-be prospect reads as managed — the whole truth there', noColPros.ok === true);

  const auth = () => async () => ({ status: 200, json: { id: U } });
  const ctx = (over) => Object.assign({ token: 'tok', authFetch: auth(), now: '2026-09-18T00:00:00.000Z' }, over || {});
  const list = await MCP.call('list_properties', {}, ctx({ sbFetch: sbFake() }));
  eq(list.data.properties.map(p => p.propertyId).sort(), ['p-arch', 'p-mgd', 'p-old'], 'E12 list_properties lists MANAGED properties only (archived flagged, prospects absent)');
  eq(list.data.count, 3, 'E13 and counts them');
  const cav = list.caveats.find(c => c.code === 'acquisitions_excluded');
  t('E14 and SAYS how many acquisitions it left out', !!cav && /6 properties/.test(cav.message), cav && cav.message);
  t('E15 not as a refusal — the listing is complete for what it describes', cav.severity === 'info');
  const listNoCol = await MCP.call('list_properties', {}, ctx({ sbFetch: sbFake({ stageColumn: false }) }));
  eq(listNoCol.data.count, ROWS.length, 'E16 without migration 023 every row is listed');
  t('E17 with a caveat that the stage was assumed', listNoCol.caveats.some(c => c.code === 'lifecycle_stage_assumed'));
  t('E18 and no acquisitions_excluded caveat is invented', !listNoCol.caveats.some(c => c.code === 'acquisitions_excluded'));
  const gp = await MCP.call('get_property', { propertyId: PROP_ID }, ctx({ sbFetch: sbFake() }));
  eq(gp.data, null, 'E19 get_property on a prospect returns no data');
  eq(gp.caveats.map(c => c.code), ['property_not_managed'], 'E20 refused as property_not_managed');
  t('E21 the refusal explains itself', /acquisition prospect/.test(gp.caveats[0].message));
  for (const tool of ['get_tenant', 'get_space', 'get_timeline', 'get_disputes', 'get_cam_status', 'get_attention', 'get_lease_evidence']) {
    const r = await MCP.call(tool, { propertyId: PROP_ID, tenantId: 't-p', spaceId: 't-p' }, ctx({ sbFetch: sbFake() }));
    t(`E22 ${tool} on a prospect is refused too (${(r.caveats[0] || {}).code})`, r.data === null && (r.caveats[0] || {}).code === 'property_not_managed');
  }
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

sec('G. Migration 023 and its rollback');
{
  const MIG = fs.readFileSync(path.join(ROOT, 'migrations/023_property_lifecycle.sql'), 'utf8');
  const RB  = fs.readFileSync(path.join(ROOT, 'migrations/023_property_lifecycle_rollback.sql'), 'utf8');
  const MARKER = 'fd9c09b1-b657-4c58-9999-c3cce28e7600';
  t('G1 pilot marker guard, before any DDL', MIG.indexOf(MARKER) !== -1 && MIG.indexOf('raise exception') < MIG.indexOf('alter table'));
  t('G2 one transaction', /^begin;/m.test(MIG) && /^commit;/m.test(MIG));
  t('G3 lifecycle_stage text not null default acquired', /add column if not exists lifecycle_stage text not null default 'acquired'/.test(MIG));
  t('G4 the check names exactly the five stages',
    /check \(lifecycle_stage in \('prospect', 'under_review', 'due_diligence', 'acquired', 'passed'\)\)/.test(MIG));
  t('G5 the check is added idempotently', /if not exists \([\s\S]*pg_constraint[\s\S]*properties_lifecycle_stage_check/.test(MIG));
  for (const col of ['acquired_at', 'passed_at', 'stage_changed_at']) t(`G6 ${col} timestamptz`, new RegExp(`add column if not exists ${col}\\s+timestamptz`).test(MIG));
  t('G7 stage_changed_by references auth.users, set null on delete', /stage_changed_by uuid references auth\.users\(id\) on delete set null/.test(MIG));
  t('G8 NO BACKFILL of acquired_at — the date is unknown, not fabricated', !/update public\.properties/.test(MIG) && !/set acquired_at/.test(MIG));
  t('G9 no property row is inserted, copied or moved', !/insert into public\.properties/.test(MIG));
  t('G10 acquisition_reviews gains a nullable property_id, set null on delete',
    /alter table public\.acquisition_reviews\s+add column if not exists property_id uuid references public\.properties\(id\) on delete set null/.test(MIG));
  t('G11 no RLS policy is touched', !/create policy|drop policy/.test(MIG));
  t('G12 the partial index serves the portfolio and acquisitions reads', /properties_user_stage_active_idx[\s\S]*\(user_id, lifecycle_stage\)[\s\S]*where archived_at is null/.test(MIG));
  t('G13 the stage vocabulary in SQL matches the module', PL.STAGES.every(s => MIG.indexOf(`'${s}'`) !== -1));
  t('G14 rollback: guarded, one transaction', RB.indexOf(MARKER) !== -1 && /^begin;/m.test(RB) && /^commit;/m.test(RB));
  for (const col of ['lifecycle_stage', 'acquired_at', 'passed_at', 'stage_changed_by', 'stage_changed_at']) {
    t(`G15 rollback drops ${col}`, new RegExp(`drop column if exists ${col}`).test(RB));
  }
  t('G16 rollback drops the constraint before the column', RB.indexOf('drop constraint if exists properties_lifecycle_stage_check') < RB.indexOf('drop column if exists lifecycle_stage'));
  t('G17 rollback removes the review link and both indexes',
    /drop column if exists property_id/.test(RB) && /drop index if exists public\.acq_reviews_property_id_idx/.test(RB) && /drop index if exists public\.properties_user_stage_active_idx/.test(RB));
  t('G18 rollback warns that prospects would surface in the portfolio', /appear in the portfolio/.test(RB));
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
