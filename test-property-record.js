'use strict';
/**
 * PHASE J — PropertyRecord is a read model, not a second engine.
 *
 * WHAT THESE TESTS ARE FOR
 * ------------------------
 * A canonical record is dangerous in exactly one way: once a value is inside it,
 * a consumer cannot tell whether it was composed from the module that owns it or
 * quietly recomputed here. So the assertions below are mostly about PROVENANCE OF
 * THE CODE, not just the values — each authoritative dependency is replaced with
 * a sentinel and the record is checked to be carrying the sentinel through. If
 * PropertyRecord ever starts computing its own CAM pool, its own provenance or
 * its own occupancy, the sentinel stops appearing and the test fails.
 *
 * The record runs in the real page against the real modules for the shape tests,
 * and in Node with injected sentinels for the composition tests.
 */
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = __dirname, PORT = 8851;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.json':'application/json' };
const MOCK = `(function(){var u={id:'t',email:'t@t.local'};function P(v){return Promise.resolve(v);}
function q(){var o={select:function(){return o;},insert:function(r){return P({data:r,error:null});},
upsert:function(r){return P({data:[r],error:null});},update:function(){return P({data:null,error:null});},
delete:function(){return {match:function(){return P({error:null});},eq:function(){return P({error:null});}};},
eq:function(){return o;},neq:function(){return o;},in:function(){return P({data:[],error:null});},
is:function(){return o;},order:function(){return o;},limit:function(){return o;},ilike:function(){return o;},
single:function(){return P({data:null,error:null});},then:function(f){return P({data:[],error:null}).then(f);}};return o;}
window.supabase={createClient:function(){return {auth:{getUser:function(){return P({data:{user:u},error:null});},
getSession:function(){return P({data:{session:{user:u}},error:null});},
onAuthStateChange:function(cb){setTimeout(function(){cb('SIGNED_IN',{user:u});},30);return {data:{subscription:{unsubscribe:function(){}}}};},
signOut:function(){return P({error:null});}},from:function(){return q();},
storage:{from:function(){return {upload:function(){return P({data:{path:'x'},error:null});},
getPublicUrl:function(){return {data:{publicUrl:''}};}};}}};}};})();`;

let pass = 0, fail = 0;
const ok  = (m, d) => { console.log('  \x1b[32m✓\x1b[0m ' + m + (d ? '  — ' + d : '')); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '  — ' + d : '')); fail++; };
const is  = (c, m, d) => (c ? ok(m, d) : bad(m, d));
const eq  = (a, b, m) => (a === b ? ok(m, JSON.stringify(a))
                                  : bad(m, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`));
const sec = (t) => console.log('\n\x1b[1m── ' + t + ' ──\x1b[0m');
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const PR = require(path.join(ROOT, 'property-record.js'));

// ── A property with one of everything, so each section has something to carry.
function fixture() {
  return {
    id: 'p1', name: 'Harborview Retail Center', camYear: '2025',
    totalSqft: 20000,
    tenants: [
      { id: 'tA', tenant_name: 'Alpha Co', leased_sqft: 9200, cap: 5, capBaseAmount: 33000,
        lease_type: 'NNN', start_date: '2021-01-01', end_date: '2030-12-31',
        _confidence: 'low',
        fieldEvidence: { cap: { snapshots: [{ value: 5, quote: 'not more than five percent (5%)',
                                              reviewedAt: '2026-01-01T00:00:00Z' }] } } },
      { id: 'tB', tenant_name: 'Beta LLC', leased_sqft: 1800, cap: null, capBaseAmount: null,
        lease_type: 'NNN', start_date: '2022-01-01', end_date: '2029-12-31', fieldEvidence: {} },
    ],
    invoices: [
      { vendor: 'V1', amount: 60000, category: 'landscaping', date: '2025-06-01' },
      { vendor: 'V2', amount: 40000, category: 'utilities',   date: '2025-07-01' },
    ],
    camReconciliation: {
      camYear: 2025, total: 100000,
      results: [
        { tenantId: 'tA', tenantName: 'Alpha Co', allocatedAmount: 34650, totalAllocated: 34650,
          proRataPercent: 46, capApplied: true,  capAdjustment: 2670.77,
          expectedCam: 34650, variance: 0, expectedCamBasis: 'cap_ceiling' },
        { tenantId: 'tB', tenantName: 'Beta LLC', allocatedAmount: 6696, totalAllocated: 6696,
          proRataPercent: 9, capApplied: false, capAdjustment: null,
          expectedCam: null, variance: null, expectedCamBasis: null },
      ],
    },
    timeline: [
      { id: 'e1', type: 'lease_uploaded', title: 'Lease uploaded — Alpha Co',
        timestamp: '2026-05-01T00:00:00Z', tenantId: 'tA',
        attachments: [{ kind: 'pdf', name: 'alpha-lease.pdf', url: 'https://x/a.pdf' }] },
      { id: 'e2', type: 'cam_reconciled', title: 'CAM reconciled — 2025',
        timestamp: '2026-06-01T00:00:00Z', tenantId: null,
        subject: { id: 'p1', type: 'property' } },
      { id: 'e3', type: 'settlement_completed', title: 'Settled', timestamp: '2026-07-01T00:00:00Z' },
      // Scoped by SUBJECT, with no tenantId at all. TenantSpace claims this for
      // tA; a naive `e.tenantId === id` rule would leave it property-level. It is
      // the only event in this fixture that tells the two apart.
      { id: 'e4', type: 'note', title: 'Roof patch noted', timestamp: '2026-08-01T00:00:00Z',
        subject: { id: 'tA', type: 'suite', label: 'Alpha Co' } },
    ],
    disputes: [{ id: 1, tenantName: 'Alpha Co', status: 'open', reason: 'HVAC scope',
                 vendor: 'ACME', category: 'maintenance', tenantShare: 500 }],
  };
}

(async () => {
  // ═══ PART 1 — Node: composition, purity, determinism (sentinel deps) ═══
  sec('the record composes its owners rather than recomputing them');

  const calls = [];
  const sentinelDeps = {
    PropertyReference: { occupancyPct: (p) => { calls.push('occupancyPct'); return 77.7; } },
    CamPool:           { total: (inv) => { calls.push('CamPool.total'); return 123456; } },
    VarianceBreakdown: { derive: (a) => { calls.push('VB.derive'); return { difference: -999 }; } },
    FieldProvenance:   { fieldProvenance: (k, t) => { calls.push('FP:' + k);
                           return { state: 'sentinel_state', field: k, tenant: t.id }; } },
    LeaseIntelligence: { CANONICAL_FIELDS: ['cap', 'leased_sqft'] },
    TimelineMerge:     require(path.join(ROOT, 'timeline-merge.js')),
    TenantSpace: { assemble: (p, id) => { calls.push('TS.assemble:' + id);
      return { space: { name: 'SPACE_' + id }, noIdentity: false,
               lease: { type: 'SENTINEL_LEASE' }, summary: 'SENTINEL_SUMMARY',
               events: (p.timeline || []).filter(e =>
                 e.tenantId === id || (e.subject && e.subject.id === id)),
               documents: id === 'tA' ? [{ kind: 'pdf', name: 'alpha-lease.pdf', url: 'u', when: 'w', from: 'f' }] : [],
               leaseDocs: [], invoices: [], photos: [], warranties: [], notes: [], disputes: [],
               camResult: { allocatedAmount: 1, expectedCam: 'FROM_TENANTSPACE' } }; } },
    PropertyWorkspace: { collectAttention: (p) => { calls.push('collectAttention');
      // Seven, deliberately: MAX_SHOWN is 5, so a record that borrowed the UI's
      // limit would silently drop two real items. Only a list longer than the
      // limit can prove it did not.
      return Array.from({ length: 7 }, (_, i) => ({ severity: 'critical',
        title: i === 0 ? 'SENTINEL_ATTENTION' : 'ITEM_' + i, why: 'w', action: 'a' })); } },
  };

  const f = fixture();
  const rec = PR.assemble(f, sentinelDeps);

  eq(Object.keys(rec).sort().join(','),
     'attention,cam,disputes,documents,fields,identity,meta,spaces,timeline',
     'J1  assemble() returns the declared top-level shape');

  is(calls.includes('occupancyPct'),     'J2  occupancy comes from PropertyReference.occupancyPct');
  eq(rec.identity.occupancy, 77.7,       'J2b and the record carries what that returned');
  is(calls.includes('CamPool.total'),    'J3  cam.pool comes from CamPool.total');
  eq(rec.cam.pool, 123456,               'J3b and is not recomputed from invoices');
  is(calls.includes('VB.derive'),        'J4  cam.unallocated comes from VarianceBreakdown.derive');
  eq(rec.cam.unallocated, -999,          'J4b and is not recomputed here');
  is(calls.includes('FP:cap'),           'J5  fields come from FieldProvenance.fieldProvenance');
  eq(rec.fields.tA.cap.state, 'sentinel_state', 'J5b and carry that resolver\'s state verbatim');
  is(calls.includes('TS.assemble:tA'),   'J6  spaces come from TenantSpace.assemble');
  eq(rec.spaces[0].space.name, 'SPACE_tA', 'J6b and carry its space identity');
  eq(rec.spaces[0].summary, 'SENTINEL_SUMMARY', 'J6c and its summary, unreworded');
  is(calls.includes('collectAttention'), 'J7  attention comes from PropertyWorkspace.collectAttention');
  eq(rec.attention[0].title, 'SENTINEL_ATTENTION', 'J7b and is passed through unchanged');
  eq(rec.attention.length, 7,            'J7c unsliced — MAX_SHOWN is a render limit, not the answer');

  // Provenance of the CAM numbers: read, never derived.
  sec('CAM figures are read from the authoritative reconciliation');
  eq(rec.cam.results.length, 2,          'J8  cam.results carries the stored rows');
  eq(rec.cam.results[0].expectedCam, 34650, 'J8b expectedCam is the stored value');
  eq(rec.cam.results[0].variance, 0,     'J8c variance is the stored value');
  eq(rec.cam.results[1].expectedCam, null,  'J8d a tenant with no cap base keeps null expectedCam');
  eq(rec.cam.results[1].variance, null,     'J8e and null variance — not backfilled');
  eq(rec.cam.capped.length, 1,           'J9  capped lists only capApplied === true rows');
  eq(rec.cam.capped[0].tenantId, 'tA',   'J9b the right one');

  const prSrc = code(fs.readFileSync(path.join(ROOT, 'property-record.js'), 'utf8'));
  /capBaseAmount\s*\*|1 \+ .*\/ 100|_camCeiling|expectedCam\s*=/.test(prSrc)
    ? bad('J10 PropertyRecord contains no expectedCam/cap arithmetic of its own')
    : ok('J10 PropertyRecord contains no expectedCam/cap arithmetic of its own');
  /_confidence/.test(prSrc)
    ? bad('J11 PropertyRecord never reads the legacy _confidence field')
    : ok('J11 PropertyRecord never reads the legacy _confidence field');
  is(JSON.stringify(rec.fields).indexOf('low') === -1,
     'J11b and no legacy confidence string reaches the record');

  // ── Identity sourcing ──────────────────────────────────────────────────────
  sec('identity is sourced, never guessed');
  eq(rec.identity.name, 'Harborview Retail Center', 'J12 name is property.name');
  eq(rec.identity.camYear, 2025,        'J12b camYear is the reconciliation year, normalised');
  eq(rec.identity.totalSqft, 20000,     'J12c totalSqft is the persisted Property Setup value');
  eq(rec.identity.leasedSqft, null,     'J13 leasedSqft is null — three modules disagree on its meaning');

  const bare = PR.assemble({ id: 'x', name: 'Bare' }, sentinelDeps);
  eq(bare.identity.totalSqft, null,     'J14 a property with no totalSqft reports null, not 0');
  eq(bare.identity.camYear, null,       'J14b and no camYear reports null, not this year');
  eq(bare.cam.results.length, 0,        'J14c and no reconciliation is an empty result list');
  eq(bare.disputes.length, 0,           'J14d and no disputes is an empty list');

  // Alternate spelling + legacy snapshot key.
  const alt = PR.assemble({ id: 'y', name: 'Alt', totalSqFt: 999,
                            results: { camYear: 2019, results: [{ tenantId: 'z', capApplied: false }] } },
                          sentinelDeps);
  eq(alt.identity.totalSqft, 999,       'J15 the totalSqFt spelling is read too, as script.js does');
  eq(alt.identity.camYear, 2019,        'J15b and the legacy `results` snapshot supplies the year');
  eq(alt.cam.results.length, 1,         'J15c and its rows');

  // ── Timeline scoping ───────────────────────────────────────────────────────
  sec('timeline scoping is preserved, not re-implemented');
  eq(rec.timeline.byTenant.tA.length, 2, 'J16 a tenant event is scoped to its tenant');
  eq(rec.timeline.byTenant.tA.map(e => e.id).sort().join(','), 'e1,e4',
     'J16b including one scoped by subject rather than tenantId');
  eq(rec.timeline.byTenant.tB.length, 0, 'J16c a tenant with no events gets an empty list');
  eq(rec.timeline.property.length, 2,    'J17 property-level events stay property-level');
  eq(rec.timeline.property.map(e => e.id).sort().join(','), 'e2,e3',
     'J17b exactly the events no space claimed');
  const dup = rec.timeline.property.filter(e => rec.timeline.byTenant.tA.some(x => x.id === e.id));
  eq(dup.length, 0, 'J18 no event appears in both scopes');
  /mergeTimelines|MAX_EVENTS|superseded/.test(prSrc)
    ? bad('J19 PropertyRecord implements no timeline merge of its own')
    : ok('J19 PropertyRecord implements no timeline merge of its own');

  // ── Disputes & documents are real records ──────────────────────────────────
  sec('disputes and documents are real records');
  eq(rec.disputes.length, 1,             'J20 disputes are the property\'s stored records');
  eq(rec.disputes[0].reason, 'HVAC scope', 'J20b carried verbatim');
  eq(PR.assemble({ id: 'q', name: 'Q' }, sentinelDeps).disputes.length, 0,
     'J21 no disputes yields the empty representation, not an invented one');
  eq(rec.documents.length, 1,            'J22 documents come from TenantSpace attachments');
  eq(rec.documents[0].name, 'alpha-lease.pdf', 'J22b with their stored identity');
  eq(rec.documents[0].tenantId, 'tA',    'J22c tagged to the space that holds them');
  is(!/fieldEvidence|source_page|\bquote\b/.test(prSrc),
     'J23 no document is synthesised from evidence rows, pages or quotes');

  // ── Purity, immutability, determinism ──────────────────────────────────────
  sec('assemble() reads and nothing else');
  const before = JSON.stringify(f);
  const rec2 = PR.assemble(f, sentinelDeps);
  is(JSON.stringify(f) === before, 'J24 the input property is not mutated');
  is(JSON.stringify(rec2) === JSON.stringify(rec), 'J25 repeated assembly is deterministic');
  is(rec.cam.results !== f.camReconciliation.results,
     'J26 returned arrays are copies, so a consumer cannot write back through them');
  is(rec.disputes !== f.disputes, 'J26b including disputes');

  for (const forbidden of [/localStorage/, /fetch\(/, /XMLHttpRequest/, /supabase/i,
                           /\bdb\./, /appendPropertyTimelineEvent/, /savePropertyData/,
                           /Math\.random/, /Date\.now/]) {
    is(!forbidden.test(prSrc), `J27 source contains no ${String(forbidden)}`);
  }

  // Absence is reported as absence, never as emptiness.
  sec('a missing dependency is not the same answer as an empty one');
  const noDeps = PR.assemble(fixture(), {});
  eq(noDeps.spaces, null,    'J28 spaces is null when TenantSpace is unavailable');
  eq(noDeps.attention, null, 'J28b attention is null when PropertyWorkspace is unavailable');
  eq(noDeps.documents, null, 'J28c documents is null when TenantSpace is unavailable');
  is(noDeps.meta.unavailable.includes('spaces') && noDeps.meta.unavailable.includes('attention'),
     'J29 and meta.unavailable names what could not be composed', noDeps.meta.unavailable.join(','));
  eq(rec.meta.unavailable.length, 0, 'J29b with every dependency present, nothing is unavailable');

  // ═══ PART 2 — browser: the real modules, wired as shipped ═══
  sec('the shipped page composes the real modules');
  const srv = http.createServer((rq, rs) => {
    let r = decodeURIComponent(rq.url.split('?')[0]); if (r === '/') r = '/index.html';
    fs.readFile(path.join(ROOT, r), (e, d) => { if (e) { rs.writeHead(404); rs.end(); return; }
      rs.writeHead(200, { 'Content-Type': MIME[path.extname(r)] || 'application/octet-stream' }); rs.end(d); });
  });
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));
  const b = await pw.chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await (await b.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
  await page.addInitScript('window.__TEST_AUTHED=true;');
  await page.addInitScript(MOCK);
  await page.route('**jsdelivr**', r => r.fulfill({ status: 200, body: '/*x*/' }));
  await page.route('**supabase**', r => r.request().url().includes('127.0.0.1')
    ? r.continue() : r.fulfill({ status: 200, body: '/*x*/' }));
  await page.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForSelector('#appContent', { state: 'visible', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const live = await page.evaluate((prop) => {
    if (!window.PropertyRecord) return { error: 'PropertyRecord not loaded' };
    const before = JSON.stringify(prop);
    const r1 = window.PropertyRecord.assemble(prop);
    const r2 = window.PropertyRecord.assemble(prop);
    return {
      loaded: true,
      unmutated: JSON.stringify(prop) === before,
      deterministic: JSON.stringify(r1) === JSON.stringify(r2),
      unavailable: r1.meta.unavailable,
      keys: Object.keys(r1).sort().join(','),
      spacesN: r1.spaces ? r1.spaces.length : null,
      spaceName: r1.spaces && r1.spaces[0] ? (r1.spaces[0].space || {}).name : null,
      capState: r1.fields && r1.fields.tA ? r1.fields.tA.cap.state : null,
      camPool: r1.cam.pool,
      camResults: r1.cam.results.length,
      cappedN: r1.cam.capped.length,
      tlProperty: r1.timeline.property.map(e => e.id).sort().join(','),
      tlTenantA: (r1.timeline.byTenant.tA || []).map(e => e.id).join(','),
      disputesN: r1.disputes.length,
      attentionIsArray: Array.isArray(r1.attention),
      docsN: r1.documents ? r1.documents.length : null,
      occupancy: r1.identity.occupancy,
      leasedSqft: r1.identity.leasedSqft,
    };
  }, fixture());

  if (live.error) { bad('J30 PropertyRecord is loaded by the page', live.error); }
  else {
    ok('J30 PropertyRecord is loaded by the page');
    eq(live.keys, 'attention,cam,disputes,documents,fields,identity,meta,spaces,timeline',
       'J30b with the same shape as in Node');
    eq(live.unavailable.length, 0, 'J31 every real dependency is present in the page',
       live.unavailable.join(','));
    is(live.unmutated,     'J32 the real modules do not mutate the property either');
    is(live.deterministic, 'J33 and two live assemblies agree');
    eq(live.spacesN, 2,    'J34 both tenants become spaces via the real TenantSpace');
    eq(live.spaceName, 'Alpha Co', 'J34b named by TenantSpace, not by this record');
    eq(live.capState, 'lease_confirmed',
       'J35 the real FieldProvenance resolves the quoted cap to lease_confirmed');
    eq(live.camPool, 100000, 'J36 the real CamPool totals the eligible invoices');
    eq(live.camResults, 2,   'J36b the stored reconciliation rows come through');
    eq(live.cappedN, 1,      'J36c and the capped one is identified');
    eq(live.tlProperty, 'e2,e3', 'J37 the real TenantSpace scoping leaves e2/e3 property-level');
    eq(live.tlTenantA.split(',').sort().join(','), 'e1,e4',
       'J37b and scopes BOTH the tenantId event and the subject-scoped one to tA');
    eq(live.disputesN, 1,        'J38 the dispute record survives');
    is(live.attentionIsArray,    'J39 the real collectAttention returns a list');
    eq(live.docsN, 1,            'J40 the real TenantSpace yields one attachment document');
    eq(live.occupancy, 55,       'J41 the real occupancyPct computes 11,000 / 20,000');
    eq(live.leasedSqft, null,    'J42 leasedSqft stays null even where occupancy resolves');
  }

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  await b.close(); srv.close();
  process.exit(fail ? 1 : 0);
})();
