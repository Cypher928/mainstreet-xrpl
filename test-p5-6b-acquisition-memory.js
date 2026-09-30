'use strict';
/**
 * test-p5-6b-acquisition-memory.js — P5-6B: server-side acquisition memory.
 *
 *   A  memory() over Maple's exact Pilot rows (fixtures/maple-acquisition-rows.js,
 *      md5-verified against Pilot): every §6 figure, the three kinds of fact
 *      kept apart, request-local, deterministic, inputs untouched
 *   B  the status matrix: ok / empty / degraded / unavailable, each cause named
 *   C  parity: memory() says what build() and the browser's episode say —
 *      one rule, never a second one; the browser's read contract is unchanged
 *   D  the hydrator: the five reads run AS THE CALLER, only after the
 *      ownership and managed checks, never through the service transport;
 *      the token never leaves the read; the page map is never touched
 *   E  get_property: the section, its status and caveats; the token nowhere
 *   F  the external transport: actors withheld (caller / another_user),
 *      bounding disclosed, the token nowhere in the body
 *   G  static guards on the code itself
 *
 * Offline: every transport is injected. The live RLS matrix is
 * tools/verify-p5-6b-live.sql, run read-only against Pilot.
 */
const fs   = require('fs');
const PL   = require('./property-leaseholds.js');
const DS   = require('./decision-standing.js');
const HYD  = require('./api/_property-record-hydrator.js');
const CAP  = require('./api/_mcp-capabilities.js');
const T    = require('./api/_mcp-transport.js');
const TN   = require('./tenant-normalize.js');
const F    = require('./fixtures/maple-acquisition-rows.js');
const C    = require('./fixtures/maple-acquisition-canonical.js');

let pass = 0, fail = 0;
const failures = [];
const ok  = (m, d) => { console.log('  \x1b[32m✓\x1b[0m ' + m + (d ? '  — ' + d : '')); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '  — ' + d : '')); fail++; failures.push(m); };
const is  = (c, m, d) => (c ? ok(m, d) : bad(m, d));
const eq  = (a, b, m) => (JSON.stringify(a) === JSON.stringify(b) ? ok(m, JSON.stringify(a).slice(0, 160))
  : bad(m, 'got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b)));
const sec = (t) => console.log('\n\x1b[1m── ' + t + ' ──\x1b[0m');
const clone = (o) => JSON.parse(JSON.stringify(o));
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const P = F.P, U = F.U;
const STRANGER = '99999999-0000-4000-8000-000000000099';
const TOKEN_OWNER = 'eyJ.owner-token.SECRET-P56B';
const TOKEN_STRANGER = 'eyJ.stranger-token.SECRET-P56B';
const TENANTS_NOW = C.MAPLE_BLOB_TENANTS.map(TN.normalizeTenant);

const baseInput = () => ({
  propertyId: P, property: clone(F.property), families: clone(F.families), documents: clone(F.documents),
  decisions: clone(F.decisions), reviews: [clone(F.review)], events: clone(F.events), tenants: clone(TENANTS_NOW),
});
const lh = (m, id) => m.memory.leaseholds.find(l => l.leaseholdId === id);
const stand = (m, id, f) => lh(m, id).standing.fields.find(x => x.field === f);

// ════════════════════════════════════════════════════════════════════════════
sec('A. memory() over Maple\'s exact rows');
{
  PL._reset();
  const input = baseInput();
  const before = JSON.stringify(input);
  const m = PL.memory(input);
  is(JSON.stringify(input) === before, 'A0 memory() does not mutate its inputs');
  eq(m.status, 'ok', 'A1 Maple\'s memory is ok');
  eq(m.reasons, [], 'A1b with no degradation reason');
  eq([m.kind, m.version, m.propertyId], ['acquisition_memory', 1, P], 'A2 it names itself and its property');
  eq(Object.keys(m).sort(), ['current', 'kind', 'limitations', 'memory', 'propertyId', 'reasons', 'sources', 'status', 'version'],
     'A3 three kinds of fact, kept apart: memory / current / sources');

  // episode + acquisition event
  const ep = m.memory.episode;
  eq([ep.reviewId, ep.startedAt, ep.startedByUid, ep.convertedAt, ep.analysedAt, ep.analysisSource, ep.activityCount],
     [F.R, '2026-09-17T19:14:41.715+00:00', U, '2026-09-27T13:40:41.213071+00:00', '2026-09-26T16:56:24.830Z', 'fingerprint', 45],
     'A4 episode: review, started (date + uid as stored), converted, analysed, source, activity count');
  const aq = m.memory.acquired;
  eq([aq.at, aq.byUid, aq.byEmail, aq.source, aq.eventId], ['2026-09-27T13:40:41.213071+00:00', U, null, 'property_events', '9b9f424e-6cad-4649-8eea-c4a39ad85ec1'],
     'A5 acquired: at, by uid (email null, as stored), from the direct property_events row');
  eq(aq.counts, { leaseholds: 5, tenants: 5, invoices: 5 }, 'A6 the counts the acquisition event recorded');

  // leaseholds
  eq(m.memory.leaseholdCount, 5, 'A7 five leaseholds');
  eq(m.memory.leaseholds.map(l => l.label), ['ShopRite Supermarkets, Inc.', 'Luxe Nails', 'Maple Coffee Co.', 'Prime Wellness Spa', 'Sunrise Cafe & Bakery LLC'],
     'A8 by name, in the order they were established');
  eq(m.memory.leaseholds.map(l => l.leaseholdId), [F.FAM.shoprite, F.FAM.luxe, F.FAM.coffee, F.FAM.prime, F.FAM.sunrise],
     'A9 each identified by its leasehold id (= tenant id)');
  eq(m.memory.leaseholds.map(l => l.documentIds.length), [2, 1, 1, 1, 0], 'A10 live filed documents per leasehold (Sunrise none)');
  eq(m.memory.leaseholds.map(l => l.decisionCount), [24, 3, 0, 0, 0], 'A11 decision rows per leasehold');

  // documents + decisions summaries
  eq([m.memory.documents.total, m.memory.documents.filed, m.memory.documents.unfiled, m.memory.documents.superseded], [8, 5, 1, 2],
     'A12 documents: 8 = 5 filed + 1 unfiled + 2 superseded');
  const dx = m.memory.decisions;
  eq([dx.count, dx.confirm, dx.correct, dx.reject, dx.reopen, dx.leaseholds, dx.actors], [27, 10, 12, 1, 4, 2, 1],
     'A13 decisions: 27 = 10 confirm + 12 correct + 1 reject + 4 reopen, on 2 leaseholds, by 1 person');

  // standing decisions — by the one rule
  const sr = lh(m, F.FAM.shoprite).standing;
  eq(sr.fields.map(f => f.field + ':' + f.action), ['cap:confirm', 'audit_rights:reject', 'suite:confirm', 'base_rent:confirm', 'leased_sqft:correct', 'admin_fee_pct:correct'],
     'A14 ShopRite: six fields stand');
  eq(sr.openFields.map(f => f.field), ['security_deposit'], 'A15 ShopRite: security deposit stands open (its last row is a reopen)');
  eq([stand(m, F.FAM.shoprite, 'leased_sqft').value, stand(m, F.FAM.shoprite, 'leased_sqft').entered, stand(m, F.FAM.shoprite, 'leased_sqft').sourceDocumentId],
     ['67000', false, F.DOC.amendment], 'A16 ShopRite leased area: 67,000 verified at acquisition, citing the amendment');
  eq([stand(m, F.FAM.shoprite, 'suite').value, stand(m, F.FAM.shoprite, 'base_rent').value, stand(m, F.FAM.shoprite, 'cap').value],
     ['Anchor Unit A-1', '1251250', '3'], 'A17 ShopRite suite, base rent and cap as confirmed');
  eq([stand(m, F.FAM.shoprite, 'admin_fee_pct').value, stand(m, F.FAM.shoprite, 'admin_fee_pct').entered, stand(m, F.FAM.shoprite, 'admin_fee_pct').sourceDocumentId],
     ['10', true, null], 'A18 ShopRite admin fee 10%: ENTERED by a person, no document');
  is(stand(m, F.FAM.shoprite, 'audit_rights').rejected && !stand(m, F.FAM.shoprite, 'audit_rights').verified,
     'A19 ShopRite audit rights: the reading was rejected, nothing verified');
  eq([stand(m, F.FAM.luxe, 'end_date').value, stand(m, F.FAM.luxe, 'end_date').entered], ['2031-07-07', true],
     'A20 Luxe Nails end date 2031-07-07: entered, no document');
  eq(lh(m, F.FAM.shoprite).standing.fields.every(f => f.decidedByUid === U), true, 'A21 every standing decision names its decider as stored (a uid)');

  // at acquisition — the unresolved summary
  eq(m.memory.unresolvedAtAcquisition, { leaseholds: 5, contested: 2, unclear: 3, read: 32, missing: 92, noDocument: 1 },
     'A22 unresolved at acquisition: 2 contested, 3 unclear, 32 read-unverified, 92 not established, 1 with no document');
  const sat = lh(m, F.FAM.shoprite).atAcquisition;
  eq([sat.contested.map(x => x.field), sat.unclear.map(x => x.field)], [['start_date', 'renewal_options'], ['audit_rights']],
     'A23 ShopRite at acquisition: start date and renewal options contested, audit rights unclear');
  eq(lh(m, F.FAM.coffee).atAcquisition.unclear.map(x => x.field), ['base_rent'], 'A24 Maple Coffee: base rent unclear');
  eq([lh(m, F.FAM.sunrise).atAcquisition.noDocument, lh(m, F.FAM.sunrise).atAcquisition.counts.missing], [true, 27],
     'A25 Sunrise: no document, all 27 terms not established');

  // carried forward
  const inv = m.memory.carried.invoices;
  eq([inv.count, inv.total, inv.countMatchesEvent, inv.originalsLinked, inv.linkedToCurrentInvoices], [5, 13700, true, false, false],
     'A26 carried: 5 invoices totalling 13,700; count agrees with the event; no original linked; no link to current invoices');
  eq(inv.lines.map(l => l.vendorName + ':' + l.amount), ['GreenScape Lawn & Landscape:3200', 'ABC Insurance Group:6000', 'GreenScape LLC:2400', 'FixIt Maintenance:1200', 'CleanCo:900'],
     'A27 the five lines, by value, as the review recorded them');
  is(inv.lines.every(l => 'fileNameAsRecorded' in l && !('fileName' in l) && !('url' in l) && !('_status' in l)),
     'A28 a file NAME as recorded — never a url, never presented as an original');
  eq(m.memory.carried.metrics, { waltYears: 11.51, waltMonths: 138, weightedSqft: 74500, occupancyRate: 100, occupiedSqft: 77500, buildingSqft: 77500, vacantSqft: 0 },
     'A29 WALT and occupancy at acquisition, from the conversion record');
  eq(m.memory.milestones.map(x => x.key), ['started', 'documents', 'leaseholds', 'decisions', 'analysed', 'acquired'],
     'A30 the episode milestones, oldest first');

  // limitations
  eq(m.limitations, ['actor_uid_only', 'analysis_fingerprint_only', 'invoice_originals_not_linked',
                     'carried_invoices_not_linked_to_current', 'leasehold_without_document', 'current_differs_from_decided'],
     'A31 limitations, named: uid-only actor, pre-P5-4 analysis, no invoice originals, invoices unlinked, a leasehold with no document, current ≠ decided');

  // current — compared, never merged
  eq(m.current.lifecycleStage + '|' + m.current.acquiredAt, 'acquired|2026-09-27T13:40:41.213071+00:00', 'A32 current lifecycle, from the property row');
  const cs = m.current.leaseholds.find(l => l.leaseholdId === F.FAM.shoprite);
  eq(cs.standingVsCurrent, { cap: 'same', suite: 'absent', base_rent: 'absent', leased_sqft: 'same', admin_fee_pct: 'absent' },
     'A33 ShopRite now: cap and 67,000 sf the same; suite, base rent and admin fee not held by the current tenant');
  is(!('audit_rights' in cs.standingVsCurrent), 'A34 a rejected reading is not compared with anything');
  eq(m.current.leaseholds.find(l => l.leaseholdId === F.FAM.luxe).standingVsCurrent, { end_date: 'same' }, 'A35 Luxe Nails now: end date the same');
  is(m.current.leaseholds.every(l => l.tenantOnProperty), 'A36 every leasehold is still a tenant of the property');
  is(!JSON.stringify(m.memory).includes('"current"') && !JSON.stringify(m.memory.leaseholds).includes('tenantName'),
     'A37 the memory holds no current value; current values appear only under `current`');
  is(JSON.stringify(m.memory).indexOf('Anchor Unit A-1') > 0 && JSON.stringify(m.current).indexOf('Anchor Unit A-1') < 0,
     'A38 "Anchor Unit A-1" is remembered as decided, and is NOT stated as the current suite');

  // sources
  eq(m.sources.review, { table: 'acquisition_reviews', id: F.R }, 'A39 source: the review row');
  eq(m.sources.event, { table: 'property_events', id: '9b9f424e-6cad-4649-8eea-c4a39ad85ec1' }, 'A40 source: the event row');
  eq(m.sources.documents.map(d => d.filing), ['unfiled', 'superseded', 'filed', 'filed', 'filed', 'superseded', 'filed', 'filed'],
     'A41 source documents, by how each ended up');
  is(m.sources.documents.every(d => d.hasOriginal === true && !('storagePath' in d) && !('url' in d)),
     'A42 each says an original is on file — never a storage path or a url');
  eq(m.sources.decisionEvidence.map(e => e.field + '@' + (e.page == null ? '-' : e.page)), ['cap@1', 'suite@1', 'base_rent@1', 'leased_sqft@-'],
     'A43 decision evidence: the cited document, page and quote for the four documented decisions');
  is(m.sources.decisionEvidence.every(e => e.documentId && e.documentLive === true && e.documentMissing === false),
     'A44 each cites a live document still on file');

  // request-local, deterministic, no map
  is(!PL.has(P), 'A45 the page map was never written');
  eq(JSON.stringify(PL.memory(baseInput())), JSON.stringify(PL.memory(baseInput())), 'A46 two calls over the same rows are byte-identical');
  is(!JSON.stringify(m).includes('builtAt'), 'A47 nothing time-of-call leaks into the memory');
  is(!JSON.stringify(m).includes('2,800') && !JSON.stringify(m).includes('"2800"'), 'A48 Sunrise\'s unverified 2,800 sf upload never appears');
}

// ════════════════════════════════════════════════════════════════════════════
sec('B. Status: ok / empty / degraded / unavailable');
{
  const M = (over) => PL.memory(Object.assign(baseInput(), over || {}));
  const u1 = M({ failed: ['decisions'] });
  eq([u1.status, u1.reasons, u1.memory, u1.current, u1.sources], ['unavailable', ['read_failed:decisions'], null, null, null],
     'B1 a failed read: unavailable, named, nothing claimed');
  eq(PL.memory({}).status + '|' + PL.memory({}).reasons, 'unavailable|no_property', 'B2 no property: unavailable');
  eq(PL.memory(null).status, 'unavailable', 'B3 never throws on nothing');

  const e1 = M({ reviews: [], property: { lifecycle_stage: 'acquired', acquired_at: null } });
  eq([e1.status, e1.reasons, e1.memory], ['empty', ['no_acquisition_episode'], null], 'B4 no converted review, no acquired_at: empty');
  const e2 = M({ reviews: [] });
  eq([e2.status, e2.reasons], ['degraded', ['acquired_without_episode_record']], 'B5 acquired_at set but no episode on record: degraded, not empty');

  const two = M({ reviews: [clone(F.review), Object.assign(clone(F.review), { id: '00000000-0000-4000-8000-000000000002' })] });
  eq([two.status, two.reasons, two.memory], ['degraded', ['ambiguous_episodes'], null], 'B6 two converted reviews: degraded, nothing picked');

  const foreign = M({ reviews: [Object.assign(clone(F.review), { property_id: STRANGER })], property: { acquired_at: null } });
  eq(foreign.status, 'empty', 'B7 a converted review of ANOTHER property is not this one\'s episode');

  const noEv = M({ events: [] });
  eq([noEv.status, noEv.reasons, noEv.memory.acquired.source, noEv.memory.acquired.byUid], ['degraded', ['no_acquisition_event'], 'acquisition_reviews', null],
     'B8 no direct event: degraded, the date falls back to converted_at, and there is NO actor');
  is(noEv.limitations.indexOf('no_actor_recorded') >= 0 && noEv.limitations.indexOf('actor_uid_only') < 0, 'B9 and it says no actor is recorded');
  const derivedOnly = M({ events: [Object.assign(clone(F.events[0]), { source_key: 'timeline:x' })] });
  eq(derivedOnly.reasons, ['no_acquisition_event'], 'B10 a derived (blob-mirrored) row is never the acquisition event');

  const badCanon = M({ reviews: [Object.assign(clone(F.review), { canonical: { basis: 'leaseholds', fingerprint: 'not json' } })] });
  eq([badCanon.status, badCanon.reasons, badCanon.memory.unresolvedAtAcquisition], ['degraded', ['at_acquisition_unrecorded'], null],
     'B11 an unreadable canonical record: degraded, and unresolved is NULL — never zeros');
  is(badCanon.memory.leaseholds.every(l => l.atAcquisition === null), 'B12 no leasehold claims an at-acquisition state');

  const invMis = M({ reviews: [Object.assign(clone(F.review), { invoices: F.invoices.slice(0, 4) })] });
  eq([invMis.status, invMis.reasons, invMis.memory.carried.invoices.count], ['degraded', ['invoice_count_mismatch'], 4],
     'B13 invoice lines ≠ the event\'s count: degraded, both numbers kept');
  const invUnread = M({ reviews: [(() => { const r = clone(F.review); delete r.invoices; return r; })()] });
  eq([invUnread.reasons, invUnread.memory.carried.invoices], [['carried_invoices_unread'], null], 'B14 invoices not read: degraded, null — not "none"');
  const oddAmt = M({ reviews: [Object.assign(clone(F.review), { invoices: F.invoices.map((x, i) => i ? x : Object.assign({}, x, { amount: 'n/a' })) })] });
  eq([oddAmt.memory.carried.invoices.total, oddAmt.memory.carried.invoices.lines[0].amount], [null, null], 'B15 an amount that is not a number: no total is invented');

  const convMis = M({ reviews: [Object.assign(clone(F.review), { conversion: Object.assign(clone(F.conversion), { propertyId: STRANGER }) })] });
  eq([convMis.reasons, convMis.memory.carried.metrics], [['conversion_record_mismatch'], null], 'B16 a conversion record naming another property: refused');
  const convNone = M({ reviews: [Object.assign(clone(F.review), { conversion: null })] });
  eq([convNone.status, convNone.memory.carried.metrics, convNone.limitations.indexOf('metrics_not_recorded') >= 0], ['ok', null, true],
     'B17 no conversion record (a legacy conversion): metrics null, said as a limitation');
  const convUnread = M({ reviews: [(() => { const r = clone(F.review); delete r.conversion; return r; })()] });
  eq(convUnread.reasons, ['conversion_record_unread'], 'B18 conversion record not read: degraded');

  const atMis = M({ property: { lifecycle_stage: 'acquired', acquired_at: '2026-09-28T00:00:00Z' } });
  eq(atMis.reasons, ['acquired_at_mismatch'], 'B19 properties.acquired_at disagrees with the event: degraded');
  const lhMis = M({ families: F.families.slice(0, 4) });
  is(lhMis.reasons.indexOf('leasehold_count_mismatch') >= 0, 'B20 fewer leaseholds than the event recorded: degraded', JSON.stringify(lhMis.reasons));
  const trunc = M({ truncated: ['decisions'] });
  eq([trunc.status, trunc.reasons], ['degraded', ['read_truncated:decisions']], 'B21 a read that may be cut short: degraded, named');

  const cross = M({ decisions: F.decisions.concat([Object.assign(clone(F.decisions[0]), { id: 'x-foreign', property_id: STRANGER, action: 'reopen', decided_at: '2030-01-01T00:00:00Z' })]) });
  eq(stand(cross, F.FAM.shoprite, 'cap').action, 'confirm', 'B22 a row naming another property is dropped: it cannot reopen this one\'s term');
  const otherReviewFam = M({ families: F.families.concat([Object.assign(clone(F.families[0]), { id: 'fam-other', review_id: 'other-review' })]) });
  eq(otherReviewFam.memory.leaseholdCount, 5, 'B23 a family of another review is not this episode\'s leasehold');
  const noTenant = M({ tenants: TENANTS_NOW.filter(t => t.id !== F.FAM.luxe) });
  const luxeNow = noTenant.current.leaseholds.find(l => l.leaseholdId === F.FAM.luxe);
  eq([luxeNow.tenantOnProperty, luxeNow.standingVsCurrent], [false, {}], 'B24 a leasehold whose tenant is gone: said, not compared');
}

// ════════════════════════════════════════════════════════════════════════════
sec('C. Parity: one rule, the browser\'s');
{
  const input = baseInput();
  const m = PL.memory(input);
  const b = PL.build(Object.assign({}, input, { currentUid: null }));
  eq(m.memory.documents, b.episode.documents, 'C1 document summary = build().episode.documents');
  eq(m.memory.decisions, b.episode.decisions, 'C2 decision summary = build().episode.decisions');
  eq(m.memory.unresolvedAtAcquisition, b.episode.unresolved, 'C3 unresolved = build().episode.unresolved');
  eq(m.memory.milestones, PL.episodeMilestones(b.episode), 'C4 milestones = episodeMilestones(build().episode)');
  eq(m.memory.leaseholds.map(l => l.atAcquisition && l.atAcquisition.counts), b.leaseholdIds.map(id => b.byLeaseholdId[id].atAcquisition && b.byLeaseholdId[id].atAcquisition.counts),
     'C5 per-leasehold at-acquisition counts = build()');
  const shopRows = F.decisions.filter(d => d.family_id === F.FAM.shoprite);
  const byDS = DS.standingByField(shopRows);
  eq(lh(m, F.FAM.shoprite).standing.fields.map(f => f.decisionId), Object.keys(byDS).filter(k => byDS[k]).map(k => byDS[k].id),
     'C6 the standing decisions are exactly DecisionStanding.standingByField\'s');
  eq(lh(m, F.FAM.shoprite).standing.openFields.map(f => f.field), Object.keys(byDS).filter(k => !byDS[k]), 'C7 and the open ones are its nulls');
  // The browser read contract did not move.
  eq(PL.SELECT.reviews, 'id, property_id, status, converted_at, created_at, user_id, activity_count:data->activityCount, canonical:data->analysis->canonical',
     'C8 the browser\'s review read is unchanged');
  eq(PL.SELECT.memoryReviews, PL.SELECT.reviews + ', invoices:data->invoices, conversion:data->conversionRecord',
     'C9 the server\'s memory read is the browser\'s plus exactly two frozen paths');
  is(!/\bdata\b(?!->)/.test(PL.SELECT.memoryReviews) && !/data->tenants|data->activity\b|data->analysis(?!->canonical)/.test(PL.SELECT.memoryReviews),
     'C10 never `data` itself, never the raw upload rows or the activity log');
  const S = fs.readFileSync('./script.js', 'utf8');
  is(/select\(PL\.SELECT\.reviews\)/.test(S) && !/SELECT\.memoryReviews/.test(S), 'C11 the browser loader still asks for SELECT.reviews, not the memory read');
}

// ════════════════════════════════════════════════════════════════════════════
// Transports for D–F: a service back end that owns ONLY properties / tenants /
// evidence, and a caller back end that serves the acquisition tables under a
// simulated RLS (Maple's org has one member: its owner).
const OWNED = { [P]: U };
const PROSPECT = '44444444-4444-4444-8444-444444444444';
function serviceDb(opts) {
  const o = Object.assign({ stage: 'acquired' }, opts || {});
  const calls = [];
  const fn = async (p, options) => {
    calls.push({ path: p, method: (options && options.method) || 'GET' });
    const own = /^\/properties\?id=eq\.([^&]+)&user_id=eq\.([^&]+)&select=id$/.exec(p);
    if (own) {
      const pid = decodeURIComponent(own[1]), uid = decodeURIComponent(own[2]);
      const owns = (OWNED[pid] === uid) || (pid === PROSPECT && uid === U);
      return { status: 200, json: owns ? [{ id: pid }] : [] };
    }
    const prop = /^\/properties\?id=eq\.([^&]+)&user_id=eq\.([^&]+)&select=/.exec(p);
    if (prop) {
      const pid = decodeURIComponent(prop[1]);
      if (pid === PROSPECT) return { status: 200, json: [{ id: PROSPECT, name: 'Prospect', sqft: 1, data: {}, lifecycle_stage: 'prospect', acquired_at: null }] };
      return { status: 200, json: [Object.assign({}, F.property, { lifecycle_stage: o.stage, data: { tenants: C.MAPLE_BLOB_TENANTS, invoices: [] } },
                                                  'acquiredAt' in o ? { acquired_at: o.acquiredAt } : {})] };
    }
    if (/^\/tenant_field_evidence\?/.test(p)) return { status: 200, json: [] };
    if (/^\/tenants\?/.test(p)) return { status: 200, json: [] };
    return { status: 404, json: { message: 'the service back end does not serve ' + p.split('?')[0] } };
  };
  fn.calls = calls;
  return fn;
}
const UID_OF = { [TOKEN_OWNER]: U, [TOKEN_STRANGER]: STRANGER };
function callerDb(opts) {
  const o = opts || {};
  const calls = [];
  const fn = async (p, token, options) => {
    calls.push({ path: p, token, method: (options && options.method) || 'GET' });
    if (o.throws) throw new Error('boom ' + token);
    const table = (/^\/([a-z_]+)\?/.exec(p) || [])[1];
    if (o.fail && o.fail === table) return { status: 500, json: { message: 'x' } };
    const uid = UID_OF[token];
    const member = uid === U;   // RLS: member_property_ids() for Maple = the owner
    const rows = {
      acquisition_document_families: F.families, acquisition_documents: F.documents,
      acquisition_term_decisions: F.decisions, acquisition_reviews: [F.review], property_events: F.events,
    }[table];
    if (!rows) return { status: 404, json: { message: 'not an acquisition table' } };
    return { status: 200, json: member && decodeURIComponent(p).indexOf('property_id=eq.' + P) >= 0 ? clone(rows) : [] };
  };
  fn.calls = calls;
  return fn;
}

sec('D. The hydrator: read as the caller, only after the checks');
(async () => {
  {
    PL._reset();
    const sb = serviceDb(), ub = callerDb();
    const h = await HYD.hydrate({ propertyId: P, userId: U, sbFetch: sb, userFetch: ub, userToken: 'Bearer ' + TOKEN_OWNER });
    is(h.ok, 'D1 the owner\'s Maple hydrates');
    eq(h.record.acquisition.status, 'ok', 'D2 with an ok acquisition section');
    eq(h.record.acquisition.memory.unresolvedAtAcquisition, { leaseholds: 5, contested: 2, unclear: 3, read: 32, missing: 92, noDocument: 1 },
       'D3 carrying Maple\'s memory');
    // Step A-1 (037): + one tenants read, the leasehold lifecycle overlay (id + three lifecycle columns).
    eq(sb.calls.map(c => c.path.split('?')[0]), ['/properties', '/properties', '/tenants', '/tenant_field_evidence'], 'D4 the service transport read what it always read, and nothing more');
    is(sb.calls.every(c => !/acquisition_|property_events/.test(c.path)), 'D5 the service transport NEVER reads an acquisition table');
    eq(ub.calls.map(c => c.path.split('?')[0]).sort(), ['/acquisition_document_families', '/acquisition_documents', '/acquisition_reviews', '/acquisition_term_decisions', '/property_events'],
       'D6 the caller transport read exactly the five acquisition tables');
    is(ub.calls.every(c => c.token === TOKEN_OWNER), 'D7 each as the caller — the token the user id was resolved from, "Bearer " removed');
    is(ub.calls.every(c => c.method === 'GET'), 'D8 every one a GET');
    is(ub.calls.every(c => c.path.indexOf('property_id=eq.' + P + '&') > 0), 'D9 every one filtered to this property');
    const pathOf = (t) => ub.calls.find(c => c.path.indexOf('/' + t + '?') === 0).path;
    is(/status=eq\.converted/.test(pathOf('acquisition_reviews')) && /action=eq\.stage_changed/.test(pathOf('property_events')),
       'D10 reviews: converted only; events: stage_changed only');
    const selOf = (t) => decodeURIComponent(/select=([^&]+)/.exec(pathOf(t))[1]);
    eq([selOf('acquisition_document_families'), selOf('acquisition_documents'), selOf('acquisition_term_decisions'), selOf('acquisition_reviews'), selOf('property_events')],
       [PL.SELECT.families, PL.SELECT.documents, PL.SELECT.decisions, PL.SELECT.memoryReviews, PL.SELECT.events].map(s => s.replace(/\s+/g, '')),
       'D11 in exactly the columns PropertyLeaseholds.SELECT names');
    is(ub.calls.every(c => new RegExp('limit=' + HYD.ACQ_ROW_LIMIT + '$').test(c.path)), 'D12 each bounded by a stated row limit');
    const all = JSON.stringify(h);
    is(all.indexOf(TOKEN_OWNER) < 0 && all.indexOf('SECRET-P56B') < 0, 'D13 the token appears nowhere in the result — record, reads, degraded');
    is(!PL.has(P), 'D14 the page map was never written on the server');
    is(h.reads.length === 9, 'D15 reads records all nine requests (four service, five as the caller)', String(h.reads.length));
    const again = await HYD.hydrate({ propertyId: P, userId: U, sbFetch: serviceDb(), userFetch: callerDb(), userToken: TOKEN_OWNER });
    eq(JSON.stringify(again.record.acquisition), JSON.stringify(h.record.acquisition), 'D16 a second request builds the same memory, independently');
  }
  {
    const sb = serviceDb(), ub = callerDb();
    const h = await HYD.hydrate({ propertyId: P, userId: STRANGER, sbFetch: sb, userFetch: ub, userToken: TOKEN_STRANGER });
    eq([h.ok, h.reason, ub.calls.length], [false, 'not_authorized', 0], 'D17 another owner / an org member who is not the owner: refused, ZERO acquisition reads');
    const ub2 = callerDb();
    const h2 = await HYD.hydrate({ propertyId: '55555555-5555-4555-8555-555555555555', userId: U, sbFetch: serviceDb(), userFetch: ub2, userToken: TOKEN_OWNER });
    eq([h2.ok, ub2.calls.length], [false, 0], 'D18 a nonexistent property: refused, zero acquisition reads');
    const ub3 = callerDb();
    const h3 = await HYD.hydrate({ propertyId: PROSPECT, userId: U, sbFetch: serviceDb(), userFetch: ub3, userToken: TOKEN_OWNER });
    eq([h3.ok, h3.reason, ub3.calls.length], [false, 'property_not_managed', 0], 'D19 an open acquisition (prospect): refused as not managed, zero acquisition reads');
    const ub4 = callerDb();
    const h4 = await HYD.hydrate({ propertyId: P, userId: null, sbFetch: serviceDb(), userFetch: ub4, userToken: TOKEN_OWNER });
    eq([h4.ok, ub4.calls.length], [false, 0], 'D20 no authenticated user: refused before any read');
  }
  {
    const ub = callerDb();
    const h = await HYD.hydrate({ propertyId: P, userId: U, sbFetch: serviceDb(), userFetch: ub, userToken: '' });
    eq([h.ok, h.record.acquisition.status, h.record.acquisition.reasons, ub.calls.length], [true, 'unavailable', ['read_failed:user_session'], 0],
       'D21 no caller token: the section is unavailable — the service transport is never used in its place');
    const h2 = await HYD.hydrate({ propertyId: P, userId: U, sbFetch: serviceDb(), userToken: TOKEN_OWNER });
    eq([h2.record.acquisition.status, h2.record.acquisition.reasons], ['unavailable', ['read_failed:user_transport']],
       'D22 an injected service transport with no caller transport never reaches the network');
    const h3 = await HYD.hydrate({ propertyId: P, userId: U, sbFetch: serviceDb(), userFetch: callerDb({ fail: 'acquisition_term_decisions' }), userToken: TOKEN_OWNER });
    eq([h3.ok, h3.record.acquisition.status, h3.record.acquisition.reasons], [true, 'unavailable', ['read_failed:decisions']],
       'D23 one acquisition read fails: the section is unavailable, the property still hydrates');
    is(Array.isArray(h3.record.spaces) && h3.record.spaces.length === 5, 'D24 and every other section is intact');
    const h4 = await HYD.hydrate({ propertyId: P, userId: U, sbFetch: serviceDb(), userFetch: callerDb({ throws: true }), userToken: TOKEN_OWNER });
    eq(h4.record.acquisition.status, 'unavailable', 'D25 a transport that throws: unavailable, not a crash');
    is(JSON.stringify(h4).indexOf(TOKEN_OWNER) < 0, 'D26 and the thrown error (which named the token) is not carried into the result');
    const h5 = await HYD.hydrate({ propertyId: P, userId: U, sbFetch: serviceDb(), userFetch: callerDb(), userToken: TOKEN_STRANGER });
    eq([h5.record.acquisition.status, h5.record.acquisition.reasons], ['degraded', ['acquired_without_episode_record']],
       'D27 were RLS to return nothing (a token for another user), the section says the record is missing — it invents nothing');
  }
  {
    // _readAcquisition marks a read that reaches the limit.
    const full = async () => ({ status: 200, json: new Array(HYD.ACQ_ROW_LIMIT).fill(0).map(() => ({})) });
    const r = await HYD._readAcquisition(full, P);
    eq(r.truncated.slice().sort(), ['decisions', 'documents', 'events', 'families', 'reviews'], 'D28 a read that returns the row limit is marked possibly truncated');
  }
  {
    // The default caller transport: the publishable key, the caller's bearer.
    const realFetch = global.fetch;
    const seen = [];
    global.fetch = async (url, init) => { seen.push({ url, init }); return { status: 200, text: async () => '[]' }; };
    try {
      const r = await HYD._defaultUserFetch('/acquisition_reviews?x=1', TOKEN_OWNER, { method: 'GET', headers: { apikey: 'EVIL', Authorization: 'Bearer EVIL' } });
      const hd = seen[0].init.headers;
      const T_ = require('./api/_pilot-target.js');
      is(r.status === 200 && hd.apikey === T_.anonKey && hd.apikey !== T_.serviceRoleKey, 'D29 apikey is the publishable key — never the service key');
      eq(hd.Authorization, 'Bearer ' + TOKEN_OWNER, 'D30 the bearer is the caller\'s own token');
      is(hd.apikey !== 'EVIL' && hd.Authorization !== 'Bearer EVIL', 'D31 a caller-supplied header cannot replace either');
      is(!!seen[0].init.signal, 'D32 and the read is time-bounded');
      seen.length = 0;
      const none = await HYD._defaultUserFetch('/acquisition_reviews?x=1', '', {});
      eq([none.status, seen.length], [401, 0], 'D33 no token: refused without a request');
      global.fetch = async () => { const e = new Error('t'); e.name = 'TimeoutError'; throw e; };
      eq((await HYD._defaultUserFetch('/x', TOKEN_OWNER, {})).status, 504, 'D34 a timeout is a failed read');
    } finally { global.fetch = realFetch; }
  }

  // ══════════════════════════════════════════════════════════════════════════
  sec('E. get_property');
  const authFetch = async (tok) => UID_OF[tok] ? { status: 200, json: { id: UID_OF[tok] } } : { status: 401, json: {} };
  const ctx = (over) => Object.assign({ token: TOKEN_OWNER, authFetch, sbFetch: serviceDb(), userFetch: callerDb(), now: '2026-09-29T12:00:00.000Z' }, over || {});
  {
    const r = await CAP.call('get_property', { propertyId: P }, ctx());
    is(r.data && r.data.acquisition && r.data.acquisition.status === 'ok', 'E1 get_property carries the acquisition section');
    eq(r.provenance.sectionStatus.acquisition, 'ok', 'E2 its status is the composer\'s');
    is(/read as the authenticated caller, under RLS/.test(r.provenance.acquisitionStore), 'E3 provenance says where it came from, and as whom');
    const lim = r.caveats.find(c => c.code === 'acquisition.limitations');
    is(!!lim && /actor_uid_only/.test(lim.message) && /not current property values/.test(lim.message), 'E4 a caveat names the limitations before anyone reads the memory');
    is(JSON.stringify(r).indexOf(TOKEN_OWNER) < 0, 'E5 the token appears nowhere in the envelope');
    eq(r.data.spaces.length, 5, 'E6 current state stays where it was: five spaces');
    const u = await CAP.call('get_property', { propertyId: P }, ctx({ userFetch: callerDb({ fail: 'acquisition_reviews' }) }));
    eq([u.data.acquisition, u.provenance.sectionStatus.acquisition], [null, 'unavailable'], 'E7 unavailable: null, never an empty memory');
    is(u.caveats.some(c => c.code === 'acquisition.unavailable' && c.severity === 'unavailable' && /not a statement that the property was never acquired/.test(c.message)),
       'E8 with a caveat that says what null does NOT mean');
    const d = await CAP.call('get_property', { propertyId: P }, ctx({ userFetch: (() => { const f = callerDb(); return async (p, t, o) => /property_events/.test(p) ? { status: 200, json: [] } : f(p, t, o); })() }));
    eq([d.provenance.sectionStatus.acquisition, d.data.acquisition.reasons], ['degraded', ['no_acquisition_event']], 'E9 degraded: the section is present, with its reasons');
    is(d.caveats.some(c => c.code === 'acquisition.degraded'), 'E10 and a degraded caveat');
    const x = await CAP.call('get_property', { propertyId: P }, ctx({ token: TOKEN_STRANGER }));
    eq([x.data, x.caveats[0].code], [null, 'not_authorized'], 'E11 another user: refused');
    const pr = await CAP.call('get_property', { propertyId: PROSPECT }, ctx());
    eq(pr.caveats[0].code, 'property_not_managed', 'E12 an open acquisition is not a managed property');
    const neverUb = async (p) => ({ status: 200, json: [] });
    const em = await CAP.call('get_property', { propertyId: P }, ctx({ sbFetch: serviceDb({ acquiredAt: null }), userFetch: neverUb }));
    eq([em.provenance.sectionStatus.acquisition, em.data.acquisition.status, em.data.acquisition.reasons],
       ['empty', 'empty', ['no_acquisition_episode']], 'E13 a managed property never acquired: empty — present, and saying so');
    is(!em.caveats.some(c => /^acquisition\./.test(c.code)), 'E14 and no acquisition caveat is invented for it');
  }

  // ══════════════════════════════════════════════════════════════════════════
  sec('F. The external transport');
  const allowRate = () => ({ ok: true, remaining: 99, retryAfterSec: 0, limit: 60 });
  const serveCall = (token, seam) => T.serve({
    httpMethod: 'POST', headers: { authorization: 'Bearer ' + token },
    body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_property', arguments: { propertyId: P } } },
  }, Object.assign({ authFetch, sbFetch: serviceDb(), userFetch: callerDb(), checkRate: allowRate }, seam || {}));
  {
    const r = await serveCall(TOKEN_OWNER);
    const env = r.body.result.structuredContent;
    const a = env.data.acquisition;
    eq(r.status, 200, 'F1 served');
    eq([a.memory.acquired.by, a.memory.acquired.byEmailPresent, 'byUid' in a.memory.acquired, 'byEmail' in a.memory.acquired],
       ['caller', false, false, false], 'F2 "who acquired it?" — the caller; the id and email are withheld');
    eq([a.memory.episode.startedBy, 'startedByUid' in a.memory.episode], ['caller', false], 'F3 who started it — the caller');
    is(a.memory.leaseholds.every(l => l.standing.fields.every(f => f.decidedBy === 'caller' && !('decidedByUid' in f))), 'F4 every decision: decided by the caller, no id');
    is(a.memory.milestones.every(m => !('actorUid' in m) && !('actorEmail' in m)), 'F5 milestones carry no actor id or email');
    const body = JSON.stringify(r.body);
    is(body.indexOf(U) < 0, 'F6 the owner\'s uid appears NOWHERE in the response body');
    is(body.indexOf(TOKEN_OWNER) < 0 && body.indexOf('SECRET-P56B') < 0, 'F7 nor does the token');
    is(/caller or\s+another_user/.test(env.caveats.find(c => c.code === 'response.redacted_for_transport').message), 'F8 the redaction is disclosed');
    eq(env.provenance.transport.acquisitionActorPolicy, 'acquisition actors reported as caller / another_user; ids and emails withheld', 'F9 and named in provenance');
    eq(env.provenance.reads.byTable.acquisition_term_decisions, 1, 'F10 reads are summarised by table — the five acquisition reads included');
  }
  {
    const big = T._boundAcquisition({ memory: { leaseholds: new Array(60).fill({}), carried: { invoices: { lines: new Array(120).fill({}) } } },
                                      current: { leaseholds: new Array(60).fill({}) }, sources: { documents: new Array(130).fill({}), decisionEvidence: new Array(110).fill({}) } }, []);
    eq([big.memory.leaseholds.length, big.memory.carried.invoices.lines.length, big.current.leaseholds.length, big.sources.documents.length, big.sources.decisionEvidence.length],
       [50, 100, 50, 100, 100], 'F11 the growing lists are capped');
    const bounded = [];
    T._boundAcquisition({ memory: { leaseholds: new Array(60).fill({}) } }, bounded);
    eq(bounded.map(b => b.path + ':' + b.returned + '/' + b.total), ['data.acquisition.memory.leaseholds:50/60'], 'F12 and every cap is disclosed');
    eq(T._boundAcquisition(null, []), null, 'F13 null stays null');
    const bd = []; const bdOut = T._boundData('get_property', { acquisition: { memory: { leaseholds: new Array(60).fill({}) } } }, bd);
    eq([bdOut.acquisition.memory.leaseholds.length, bd.length], [50, 1], 'F15 get_property\'s bounding applies to the acquisition section');
    const other = T._redactAcquisition({ memory: { acquired: { byUid: STRANGER, byEmail: 'a@b.c' }, episode: { startedByUid: STRANGER } } }, U);
    eq([other.memory.acquired.by, other.memory.acquired.byEmailPresent, other.memory.episode.startedBy, JSON.stringify(other).indexOf('a@b.c')],
       ['another_user', true, 'another_user', -1], 'F14 another person\'s act: another_user, email withheld with byEmailPresent');
  }

  // ══════════════════════════════════════════════════════════════════════════
  sec('G. Static guards');
  {
    const HS = strip(fs.readFileSync('./api/_property-record-hydrator.js', 'utf8'));
    is(!/PropertyLeaseholds\.(set|get|has|clear|forTenant|_reset)\s*\(/.test(HS), 'G1 the hydrator never touches the page map');
    is(/PropertyLeaseholds\.memory\(/.test(HS), 'G2 it composes through memory()');
    const uf = HS.slice(HS.indexOf('async function _defaultUserFetch'), HS.indexOf('const ACQ_ROW_LIMIT'));
    is(uf.length > 0 && !/_key\(\)|serviceRoleKey/.test(uf) && /'apikey': SUPABASE_ANON_KEY/.test(uf), 'G3 the caller transport cannot use the service key');
    is(!/console\.(log|warn|error|info)/.test(uf) && !/console\.[a-z]+\([^)]*token/i.test(HS), 'G4 nothing logs the token');
    const ra = HS.slice(HS.indexOf('async function _readAcquisition'), HS.indexOf('function _readOnly('));
    is(!/sb\(|_defaultFetch/.test(ra.replace(/userSb\(/g, '')), 'G5 the acquisition reads go through the caller transport only');
    const iOwn = HS.indexOf('await _ownsProperty(sb, propertyId, userId)'), iMan = HS.indexOf('PropertyLifecycle.isManaged(row)'),
          iAcq = HS.indexOf('await _readAcquisition(userSb, propertyId)');
    const order = iOwn > 0 && iOwn < iMan && iMan < iAcq;
    is(order, 'G6 order: ownership, then the managed check, then — only then — the acquisition reads');
    const PS = strip(fs.readFileSync('./property-leaseholds.js', 'utf8'));
    const mem = PS.slice(PS.indexOf('function memory(input)'), PS.indexOf('var _byProperty'));
    is(mem.length > 0 && !/\bset\(|_byProperty/.test(mem), 'G7 memory() holds no module state and never calls set()');
    is(!/\.standing\(|standingByField\(/.test(mem) && /build\(/.test(mem), 'G8 memory() restates no standing rule — it composes build()');
    // P5-6B itself added no migration. Later, separately approved migrations
    // (037, the leasehold lifecycle; 038, leasehold protection; 039, the
    // register's leasehold link; 042, the 53-row register relink) are not
    // P5-6B's and are listed here by name, so an unexplained new file still
    // fails this check.
    const MIG = fs.readdirSync('./migrations').filter(f => /^03[7-9]|^0[4-9]\d/.test(f))
      .filter(f => !/^037_leasehold_lifecycle(_rollback)?\.sql$/.test(f))
      .filter(f => !/^038_leasehold_protection(_rollback)?\.sql$/.test(f))
      .filter(f => !/^039_register_leasehold_link(_rollback)?\.sql$/.test(f))
      .filter(f => !/^042_register_relink_deterministic(_rollback)?\.sql$/.test(f));
    eq(MIG, [], 'G9 no migration was added for P5-6B');
    const CS = strip(fs.readFileSync('./api/_mcp-capabilities.js', 'utf8'));
    is(/userToken: c\.token/.test(CS) && (CS.match(/c\.token/g) || []).length >= 2, 'G10 the token is handed to the hydrator — and to nothing new');
  }

  console.log('\n' + (fail ? '\x1b[31m' : '\x1b[32m') + 'RESULT: ' + pass + ' passed, ' + fail + ' failed\x1b[0m');
  if (fail) { console.log('FAILED:\n  - ' + failures.join('\n  - ')); process.exit(1); }
})().catch(e => { console.error(e); process.exit(1); });
