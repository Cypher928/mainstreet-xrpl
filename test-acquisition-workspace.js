'use strict';
/**
 * test-acquisition-workspace.js — Acquisition Review Phase 1, increment P1-1.
 *
 *   node test-acquisition-workspace.js
 *
 * Two halves. The first runs acquisition-workspace.js for real: upgrade is
 * idempotent and loses nothing, the stage is a recorded decision that the
 * conversion facts override, activity is appended (never rewritten) and
 * capped honestly, and a conditional save's empty response is a CONFLICT and
 * never a success. The second reads script.js and index.html as text (through
 * code(), which strips comments so a fix's own explanation cannot satisfy an
 * assertion) and pins the glue to the module: the save is conditioned on the
 * revision last read, a conflict reloads the stored row, a sent timestamp is
 * never recorded as a revision, and every screen that shows a review shows its
 * stage.
 *
 * The browser half of this increment is test-e2e-acquisition-workspace.js.
 */
const fs   = require('fs');
const path = require('path');
const ROOT = __dirname;
const AW   = require('./acquisition-workspace.js');

let pass = 0, fail = 0;
const failures = [];
function t(name, fn) {
  try { fn(); pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  catch (e) { fail++; failures.push(`${name}: ${e.message}`); console.log(`  \x1b[31m✗\x1b[0m ${name}\n      → ${e.message}`); }
}
const ok = (c, m) => { if (!c) throw new Error(m || 'expected truthy'); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m || ''} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const deq = (a, b, m) => { const ja = JSON.stringify(a), jb = JSON.stringify(b); if (ja !== jb) throw new Error(`${m || ''} expected ${jb}, got ${ja}`); };
function sec(s) { console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 60 - s.length))); }

// Source-text assertions go through this so a comment quoting the old
// pattern cannot satisfy them. Same helper as test-security.js.
function code(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8')
    .split('\n')
    .filter(l => !/^\s*(\/\/|\*|\/\*|--)/.test(l))
    .join('\n');
}
// A top-level `function NAME(` in script.js, up to its closing `}` at column 0.
function fnBody(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i === -1) throw new Error('function ' + name + ' not found');
  const j = src.indexOf('\n}\n', i);
  return src.slice(i, j === -1 ? undefined : j + 2);
}

// A stored row exactly as the Harborview demo seed and the pre-P1-1 create
// path wrote them: no schemaVersion, no stage, no activity.
function legacyRow(extra) {
  return Object.assign({
    id: 'rev-legacy', user_id: 'u1', name: 'Harborview Retail Center', status: 'complete',
    created_at: '2026-01-14T10:00:00.000Z', updated_at: '2026-01-20T09:00:00.000Z',
    data: {
      tenants:   [{ id: 't1', tenant_name: 'Coastal Outfitters', leased_sqft: '4200', quotes: { cam_cap: 'shall not exceed 5%' } }],
      invoices:  [{ id: 'i1', vendorName: 'Atlas Landscaping', amount: 18400 }],
      totalSqFt: 32000,
      documents: [],
      analysis:  { summary: { recoveryRate: 71.2 }, topRisks: [{ type: 'cap_leakage' }] },
      _demoAcq:  true,
    },
  }, extra || {});
}

console.log('\n══ Acquisition Workspace — P1-1 ══');

// ═════════════════════════════════════════════════════════════════════════════
sec('upgradeReview — merges, never replaces, idempotent');

t('a legacy row gains every v2 key and keeps every legacy key', () => {
  const up = AW.upgradeReview(legacyRow());
  for (const k of ['schemaVersion', 'stage', 'tenants', 'invoices', 'totalSqFt', 'documents',
                   'families', 'assumptions', 'activity', 'activityCount', 'activityDropped', 'analysis']) {
    ok(k in up.data, 'missing ' + k);
  }
  eq(up.data.schemaVersion, AW.SCHEMA_VERSION, 'schemaVersion');
  eq(up.data._demoAcq, true, 'legacy private key kept');
  eq(up.data.totalSqFt, 32000, 'totalSqFt');
  eq(up.id, 'rev-legacy'); eq(up.status, 'complete'); eq(up.updated_at, '2026-01-20T09:00:00.000Z');
});

t('the tenants, invoices and analysis are the SAME objects — nothing is copied or rewritten', () => {
  const row = legacyRow();
  const up  = AW.upgradeReview(row);
  ok(up.data.tenants  === row.data.tenants,  'tenants identity');
  ok(up.data.invoices === row.data.invoices, 'invoices identity');
  ok(up.data.analysis === row.data.analysis, 'analysis identity');
});

t('the input row is not mutated', () => {
  const row = legacyRow();
  const before = JSON.stringify(row);
  AW.upgradeReview(row);
  eq(JSON.stringify(row), before, 'input changed');
  ok(!('stage' in row.data), 'stage written onto the input');
});

t('idempotent: upgrading an upgraded row changes nothing', () => {
  const once  = AW.upgradeReview(legacyRow());
  const twice = AW.upgradeReview(once);
  deq(twice.data, once.data, 'second upgrade differs');
  eq(AW.needsUpgrade(once), false, 'needsUpgrade after upgrade');
  eq(AW.needsUpgrade(legacyRow()), true, 'needsUpgrade on legacy');
});

t('conversion record and history survive byte-for-byte', () => {
  const row = legacyRow({ status: 'converted' });
  row.data.conversionRecord  = { propertyId: 'p1', propertyName: 'Harborview', convertedAt: '2026-02-01T00:00:00.000Z' };
  row.data.conversionHistory = [{ propertyId: 'p0', supersededReason: 'deleted' }];
  const up = AW.upgradeReview(row);
  deq(up.data.conversionRecord, row.data.conversionRecord);
  deq(up.data.conversionHistory, row.data.conversionHistory);
});

t('null or missing data becomes the empty v2 shape', () => {
  const a = AW.upgradeReview({ id: 'x', status: 'draft', data: null });
  const b = AW.upgradeReview({ id: 'y', status: 'draft' });
  for (const up of [a, b]) {
    deq(up.data.tenants, []); deq(up.data.activity, []); eq(up.data.analysis, null);
    eq(up.data.stage, 'intake'); eq(up.data.totalSqFt, 0);
  }
});

t('a newer schemaVersion is never downgraded', () => {
  const row = legacyRow(); row.data.schemaVersion = 7;
  eq(AW.upgradeReview(row).data.schemaVersion, 7);
});

t('newReviewData is already at v2 and needs no upgrade', () => {
  const row = { id: 'n', status: 'draft', data: AW.newReviewData() };
  eq(AW.needsUpgrade(row), false);
  eq(row.data.stage, 'intake');
});

// ═════════════════════════════════════════════════════════════════════════════
sec('stage — derived once for legacy rows, then a recorded decision');

t('derivation: analysis on file ⇒ report', () => eq(AW.deriveStage(legacyRow()), 'report'));
t('derivation: leases but no analysis ⇒ abstraction', () => {
  const r = legacyRow(); r.data.analysis = null; r.data.invoices = [];
  eq(AW.deriveStage(r), 'abstraction');
});
t('derivation: invoices only ⇒ abstraction', () => {
  const r = legacyRow(); r.data.analysis = null; r.data.tenants = [];
  eq(AW.deriveStage(r), 'abstraction');
});
t('derivation: documents only ⇒ abstraction', () => {
  const r = legacyRow(); r.data.analysis = null; r.data.tenants = []; r.data.invoices = []; r.data.documents = [{ id: 'd' }];
  eq(AW.deriveStage(r), 'abstraction');
});
t('derivation: nothing on file ⇒ intake', () => {
  eq(AW.deriveStage({ id: 'e', status: 'draft', data: { tenants: [], invoices: [] } }), 'intake');
});
t('derivation never produces financials or review — nobody chose them', () => {
  const seen = new Set();
  for (const d of [{}, { tenants: [{}] }, { analysis: {} }, { invoices: [{}] }, { documents: [{}] }]) {
    seen.add(AW.deriveStage({ id: 'z', status: 'draft', data: d }));
  }
  ok(!seen.has('financials') && !seen.has('review'), [...seen].join(','));
});

t('a converted review with a conversion record is acquired, whatever data.stage says', () => {
  const r = legacyRow({ status: 'converted' });
  r.data.conversionRecord = { propertyId: 'p1' };
  r.data.stage = 'intake';
  eq(AW.stageOf(r), 'acquired');
  eq(AW.upgradeReview(r).data.stage, 'acquired', 'upgrade writes the override down');
});

t('status converted WITHOUT a conversion record is not acquired', () => {
  const r = legacyRow({ status: 'converted' });
  eq(AW.isConverted(r), false);
  eq(AW.stageOf(r), 'report');
});

t('a stored stage stands over the derivation', () => {
  const r = legacyRow(); r.data.stage = 'financials';
  eq(AW.stageOf(r), 'financials');
  eq(AW.upgradeReview(r).data.stage, 'financials');
});

t('a stored "acquired" on a review that is no longer converted is re-derived', () => {
  const r = legacyRow(); r.data.stage = 'acquired';    // status is complete, no record
  eq(AW.stageOf(r), 'report');
  eq(AW.upgradeReview(r).data.stage, 'report');
});

t('an unrecognised stored stage is re-derived, not trusted', () => {
  const r = legacyRow(); r.data.stage = 'closing';
  eq(AW.stageOf(r), 'report');
});

// ═════════════════════════════════════════════════════════════════════════════
sec('setStage — a person moves the review; the acquisition locks it');

t('a valid move changes the stage and records it, without touching the input', () => {
  const row = AW.upgradeReview(legacyRow());
  const before = JSON.stringify(row);
  const r = AW.setStage(row, 'financials', { actor: { id: 'u1', email: 'pm@example.com' }, at: '2026-09-21T10:00:00.000Z' });
  eq(r.ok, true); eq(r.changed, true); eq(r.reason, null);
  eq(r.review.data.stage, 'financials');
  eq(JSON.stringify(row), before, 'input mutated');
  const a = r.review.data.activity;
  eq(a.length, 1);
  eq(a[0].type, 'stage_changed');
  deq(a[0].meta, { from: 'report', to: 'financials' });
  deq(a[0].actor, { uid: 'u1', email: 'pm@example.com' });
  ok(/Financials/.test(a[0].summary) && /Report/.test(a[0].summary), a[0].summary);
  eq(a[0].at, '2026-09-21T10:00:00.000Z');
});

t('moving to the current stage is ok, unchanged, and records nothing', () => {
  const r = AW.setStage(AW.upgradeReview(legacyRow()), 'report');
  eq(r.ok, true); eq(r.changed, false);
  eq(r.review.data.activity.length, 0);
});

t('an unknown stage is refused', () => {
  const r = AW.setStage(legacyRow(), 'closing');
  eq(r.ok, false); eq(r.reason, 'unknown_stage');
});

t('"acquired" cannot be chosen — only the conversion sets it', () => {
  const r = AW.setStage(legacyRow(), 'acquired');
  eq(r.ok, false); eq(r.reason, 'acquired_is_set_by_conversion');
});

t('an acquired review cannot be moved', () => {
  const row = legacyRow({ status: 'converted' });
  row.data.conversionRecord = { propertyId: 'p1' };
  const r = AW.setStage(row, 'intake');
  eq(r.ok, false); eq(r.reason, 'locked_after_acquisition');
});

t('every stage in STAGES except acquired is reachable from intake', () => {
  const base = { id: 'n', status: 'draft', data: AW.newReviewData() };
  for (const s of AW.STAGES) {
    const r = AW.setStage(base, s);
    if (s === AW.TERMINAL_STAGE) eq(r.ok, false, s);
    else if (s === 'intake')     eq(r.changed, false, s);
    else { eq(r.ok, true, s); eq(r.review.data.stage, s, s); }
  }
});

// ═════════════════════════════════════════════════════════════════════════════
sec('markAcquired / markReverted — the conversion path');

t('markAcquired after the glue has written the facts: stage acquired, act recorded', () => {
  const row = AW.upgradeReview(legacyRow());
  row.status = 'converted';
  row.data.conversionRecord = { propertyId: 'p-new', propertyName: 'Harborview Retail Center' };
  const out = AW.markAcquired(row, { actor: { uid: 'u1', email: 'pm@example.com' }, at: '2026-09-21T11:00:00.000Z' });
  eq(out.data.stage, 'acquired');
  const a = out.data.activity[out.data.activity.length - 1];
  eq(a.type, 'converted');
  eq(a.meta.propertyId, 'p-new'); eq(a.meta.from, 'report'); eq(a.meta.repair, false);
  ok(/Harborview/.test(a.summary), a.summary);
  eq(AW.stageChips(out).every(c => !c.selectable), true, 'nothing selectable once acquired');
});

t('a repair (Convert Again) is recorded as a repair', () => {
  const row = AW.upgradeReview(legacyRow({ status: 'converted' }));
  row.data.conversionRecord = { propertyId: 'p-rebuilt' };
  const out = AW.markAcquired(row, { repair: true });
  eq(out.data.activity[0].meta.repair, true);
});

t('markReverted after the glue has cleared the record: stage re-derived, act recorded', () => {
  const row = AW.upgradeReview(legacyRow({ status: 'converted' }));
  row.data.conversionRecord = { propertyId: 'p-gone' };
  const acquired = AW.markAcquired(row);
  // what _revertAcquisitionsForDeletedProperty does before calling in:
  const reverted = Object.assign({}, acquired, { status: 'complete', data: Object.assign({}, acquired.data) });
  delete reverted.data.conversionRecord;
  const out = AW.markReverted(reverted, { propertyId: 'p-gone', at: '2026-09-21T12:00:00.000Z' });
  eq(out.data.stage, 'report');
  eq(AW.stageOf(out), 'report');
  const a = out.data.activity[out.data.activity.length - 1];
  eq(a.type, 'conversion_reverted'); eq(a.meta.propertyId, 'p-gone'); eq(a.meta.to, 'report');
  eq(out.data.activity.length, 2, 'the converted entry is still there');
});

// ═════════════════════════════════════════════════════════════════════════════
sec('recordActivity — appended, attributed, capped honestly');

t('an entry is appended with id, timestamp, normalised actor and meta', () => {
  const row = AW.upgradeReview(legacyRow());
  const out = AW.recordActivity(row, { type: 'documents_added', summary: '2 lease files added',
    actor: { id: 'u9', email: 'a@b.c' }, meta: { kind: 'lease', files: ['a.pdf', 'b.pdf'] }, at: '2026-09-21T13:00:00.000Z' });
  eq(out.data.activity.length, 1);
  const a = out.data.activity[0];
  ok(/^act-1-/.test(a.id), a.id);
  eq(a.at, '2026-09-21T13:00:00.000Z');
  deq(a.actor, { uid: 'u9', email: 'a@b.c' });
  deq(a.meta, { kind: 'lease', files: ['a.pdf', 'b.pdf'] });
  eq(out.data.activityCount, 1);
  eq(row.data.activity.length, 0, 'input mutated');
});

t('no actor ⇒ a system act (null), never an invented person', () => {
  const out = AW.recordActivity(legacyRow(), { type: 'analysis_run', summary: 'x' });
  eq(out.data.activity[0].actor, null);
  const out2 = AW.recordActivity(legacyRow(), { type: 'analysis_run', summary: 'x', actor: {} });
  eq(out2.data.activity[0].actor, null);
});

t('type and summary are required', () => {
  let threw = 0;
  try { AW.recordActivity(legacyRow(), { summary: 'x' }); } catch (_) { threw++; }
  try { AW.recordActivity(legacyRow(), { type: 'analysis_run' }); } catch (_) { threw++; }
  try { AW.recordActivity(legacyRow(), { type: '  ', summary: 'x' }); } catch (_) { threw++; }
  eq(threw, 3);
});

t('entries are appended in order and earlier entries are never rewritten', () => {
  let r = AW.upgradeReview(legacyRow());
  r = AW.recordActivity(r, { type: 'analysis_run', summary: 'first', at: '2026-01-01T00:00:00.000Z' });
  const firstRef = r.data.activity[0];
  r = AW.recordActivity(r, { type: 'analysis_run', summary: 'second', at: '2026-01-02T00:00:00.000Z' });
  eq(r.data.activity.length, 2);
  ok(r.data.activity[0] === firstRef, 'first entry replaced');
  eq(r.data.activity[1].summary, 'second');
  eq(r.data.activityCount, 2);
});

t('at the cap the oldest go and activityDropped says how many; the count keeps climbing', () => {
  let r = AW.upgradeReview(legacyRow());
  for (let i = 0; i < AW.ACTIVITY_CAP + 3; i++) {
    r = AW.recordActivity(r, { type: 'analysis_run', summary: 'n' + i, at: '2026-01-01T00:00:00.000Z' });
  }
  eq(r.data.activity.length, AW.ACTIVITY_CAP);
  eq(r.data.activityDropped, 3);
  eq(r.data.activityCount, AW.ACTIVITY_CAP + 3);
  eq(r.data.activity[0].summary, 'n3', 'oldest three dropped');
  eq(r.data.activity[AW.ACTIVITY_CAP - 1].summary, 'n' + (AW.ACTIVITY_CAP + 2));
});

t('ACTIVITY_TYPES is a true inventory of what the glue and the module emit', () => {
  const src = code('script.js');
  const emitted = new Set();
  for (const m of src.matchAll(/_acqRecord\([^)]*?\{\s*type:\s*'([a-z_]+)'/g)) emitted.add(m[1]);
  ok(emitted.size >= 3, 'glue emits ' + [...emitted].join(','));
  for (const ty of emitted) ok(AW.ACTIVITY_TYPES.includes(ty), 'glue emits unlisted type ' + ty);
  for (const ty of ['stage_changed', 'converted', 'conversion_reverted']) ok(AW.ACTIVITY_TYPES.includes(ty), ty);
});

// ═════════════════════════════════════════════════════════════════════════════
sec('stageChips — the view model');

t('done · current · upcoming, and acquired is never selectable', () => {
  const r = AW.upgradeReview(legacyRow()); r.data.stage = 'financials';
  const chips = AW.stageChips(r);
  deq(chips.map(c => c.key), AW.STAGES);
  deq(chips.map(c => c.state), ['done', 'done', 'current', 'upcoming', 'upcoming', 'upcoming']);
  deq(chips.map(c => c.selectable), [true, true, true, true, true, false]);
  eq(chips[2].label, 'Financials');
});

t('an acquired review: every earlier stage done, acquired current, nothing selectable', () => {
  const r = legacyRow({ status: 'converted' }); r.data.conversionRecord = { propertyId: 'p1' };
  const chips = AW.stageChips(r);
  deq(chips.map(c => c.state), ['done', 'done', 'done', 'done', 'done', 'current']);
  eq(chips.some(c => c.selectable), false);
});

// ═════════════════════════════════════════════════════════════════════════════
sec('persistence contract — what a save writes and what its answer means');

t('savePayload carries name, status, data — and nothing else', () => {
  const row = legacyRow(); row._rev = 'x';
  const p = AW.savePayload(row);
  deq(Object.keys(p).sort(), ['data', 'name', 'status']);
  ok(p.data === row.data, 'data must be the same object (identity is what keeps the in-memory trick honest)');
  ok(!('id' in p) && !('user_id' in p) && !('updated_at' in p) && !('_rev' in p));
});

t('one row back ⇒ ok, with the new revision', () => {
  const v = AW.classifySaveResult({ rows: [{ id: 'r', updated_at: '2026-09-21T14:00:00.123456+00:00' }], error: null, hadRev: true });
  eq(v.ok, true); eq(v.rev, '2026-09-21T14:00:00.123456+00:00');
});

t('no row back with a revision filter ⇒ CONFLICT, never success', () => {
  const v = AW.classifySaveResult({ rows: [], error: null, hadRev: true });
  eq(v.ok, false); eq(v.kind, 'conflict');
  const v2 = AW.classifySaveResult({ rows: null, error: null, hadRev: true });
  eq(v2.ok, false); eq(v2.kind, 'conflict');
});

t('no row back without a revision filter ⇒ missing (the row does not exist yet)', () => {
  const v = AW.classifySaveResult({ rows: [], error: null, hadRev: false });
  eq(v.ok, false); eq(v.kind, 'missing');
});

t('a database error is an error even when rows are present', () => {
  const v = AW.classifySaveResult({ rows: [{ id: 'r' }], error: { message: 'permission denied', code: '42501' }, hadRev: true });
  eq(v.ok, false); eq(v.kind, 'error'); eq(v.code, '42501'); ok(/permission/.test(v.message));
});

t('a row without updated_at is ok with rev null (the next save is unconditional, not wrong)', () => {
  const v = AW.classifySaveResult({ rows: [{ id: 'r' }], error: null, hadRev: false });
  eq(v.ok, true); eq(v.rev, null);
});

// ═════════════════════════════════════════════════════════════════════════════
sec('the glue — script.js and index.html are wired to the module');

const S = code('script.js');
const H = code('index.html');

t('index.html loads acquisition-workspace.js before script.js', () => {
  const a = H.indexOf('<script src="acquisition-workspace.js">');
  const b = H.indexOf('<script src="script.js">');
  ok(a !== -1, 'module tag missing'); ok(b !== -1); ok(a < b, 'module must load first');
});

t('the detail panel has the stage row and the chips have styles', () => {
  ok(H.includes('id="acqStageChips"'), 'chips container');
  ok(/\.acq-stage-chip\.current\s*\{/.test(H), 'current style');
  ok(/\.acq-stage-chip\.done\s*\{/.test(H), 'done style');
});

t('_saveAcqReview updates with a payload from the module and conditions on the revision last read', () => {
  const b = fnBody(S, '_saveAcqReview');
  ok(b.includes('savePayload(review)'), 'savePayload');
  ok(b.includes(".update(payload).eq('id', review.id).eq('user_id', user.id)"), 'update by id and owner');
  ok(b.includes("q.eq('updated_at', rev)"), 'the revision filter');
  ok(b.includes('classifySaveResult({ rows: data, error, hadRev: !!rev })'), 'the verdict comes from the module');
  ok(!b.includes('upsert({ ...review'), 'the whole-object upsert is gone');
  ok(b.includes("verdict.kind === 'conflict'") && b.includes('_acqHandleSaveConflict(review, user.id)'), 'conflict handled');
  ok(b.includes('_acqRevs.set(review.id, verdict.rev)'), 'the new revision is recorded');
});

t('a conflict reloads the stored row, replaces the in-memory copy and says so', () => {
  const b = fnBody(S, '_acqHandleSaveConflict');
  ok(b.includes("select('id, name, status, data, created_at, updated_at')"), 'refetch');
  ok(b.includes('_acqAdopt(rows[0])'), 'adopted through the module');
  ok(b.includes('_acqReviews[idx] = fresh'), 'replaced in memory');
  ok(/changed elsewhere/.test(b), 'told the user');
  ok(/deleted elsewhere/.test(b) && b.includes('_acqReviews.filter(r => r && r.id !== review.id)'), 'a vanished row is removed, not kept as a ghost');
  ok(b.includes('if (wasActive) selectAcquisitionReview(review.id)'), 're-rendered if open');
});

t('a revision is recorded only from rows READ from the database (and our own inserts)', () => {
  const adopt = fnBody(S, '_acqAdopt');
  ok(adopt.includes('_acqRevs.set(row.id, String(row.updated_at))'), 'adopt records the read revision');
  const load = fnBody(S, '_loadAcqReviews');
  ok(load.includes('.map(_acqAdopt)'), 'loaded rows are adopted');
  const create = fnBody(S, 'createAcquisitionReview');
  ok(create.includes('_acqRevs.set(id, review.updated_at)'), 'an insert records what it stored');
  ok(create.includes('_AW().newReviewData()'), 'a new review is created at v2');
  ok(create.includes("type: 'review_created'"), 'creation is recorded');
  const demo = fnBody(S, 'ensureDemoAcqReview');
  ok(demo.includes('_acqReviews.unshift(_AW().upgradeReview(review))'), 'the seeded review is upgraded');
  ok(!demo.includes('_acqAdopt(review)'), 'the seed must NOT record the timestamp it sent — an upsert-as-update replaces it');
  ok(demo.includes('_acqReviews.unshift(_acqAdopt(existing))'), 'a demo row read from the database IS adopted');
  const del = fnBody(S, 'deleteActiveAcquisitionReview');
  ok(del.includes('_acqRevs.delete(id)'), 'a deleted review forgets its revision');
});

t('the stage is rendered wherever a review is opened, and a chip click persists', () => {
  ok(fnBody(S, 'selectAcquisitionReview').includes('_renderAcqStageChips(review)'), 'on open');
  ok(fnBody(S, 'convertAcquisitionToProperty').includes('_renderAcqStageChips(review)'), 'after conversion');
  const set = fnBody(S, 'acqSetStage');
  ok(set.includes('_AW().setStage(review, stage, { actor: _acqActor() })'), 'through the module');
  ok(set.includes('review.data = r.review.data'), 'applied in place');
  ok(set.includes('_saveAcqReview(review)'), 'saved');
  ok(set.includes('if (!r.changed) return'), 'a no-op does not save');
  const render = fnBody(S, '_renderAcqStageChips');
  ok(render.includes('AW.stageChips(review)'), 'chips come from the module');
  ok(render.includes('onclick="acqSetStage(\'${esc(c.key)}\')"'), 'selectable chips click through');
  ok(render.includes('disabled'), 'unselectable chips are disabled');
});

t('conversion and revert go through markAcquired / markReverted', () => {
  ok(fnBody(S, 'convertAcquisitionToProperty').includes('_AW().markAcquired(review, { actor: _acqActor(), repair: _isRepair })'));
  ok(fnBody(S, '_revertAcquisitionsForDeletedProperty').includes('_AW().markReverted(review, { actor: _acqActor(), propertyId: propId })'));
});

t('analysis and uploads are recorded on the review', () => {
  ok(fnBody(S, 'runAcquisitionAnalysis').includes("type: 'analysis_run'"));
  ok(fnBody(S, 'acqHandleLeaseFiles').includes("type: 'documents_added'"));
  ok(fnBody(S, 'acqHandleInvoiceFiles').includes("type: 'documents_added'"));
});

t('the module itself: acquired is the last stage and the only terminal one', () => {
  eq(AW.STAGES[AW.STAGES.length - 1], AW.TERMINAL_STAGE);
  eq(AW.STAGES.length, 6);
  for (const s of AW.STAGES) ok(AW.STAGE_LABELS[s], 'label for ' + s);
});

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n' + '─'.repeat(64));
console.log(`RESULT: ${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILED:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);
