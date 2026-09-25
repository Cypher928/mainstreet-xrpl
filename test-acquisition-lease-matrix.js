// test-acquisition-lease-matrix.js
// ============================================================================
// Acquisition Review §4m — the Lease Matrix and the head of one leasehold's
// record, from the canonical projection. Pure: no browser.
//
// Reads Maple Plaza as the Pilot holds it (fixtures/maple-plaza-acquisition.js)
// through the real resolver and the real §4l projection, then checks what the
// matrix says about each leasehold — and what it refuses to say.
//
// Run: node test-acquisition-lease-matrix.js
// ============================================================================
'use strict';
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const AT = require('./acquisition-terms.js');
const AL = require('./acquisition-leasehold.js');
const LM = require('./acquisition-lease-matrix.js');
const F  = require('./fixtures/maple-plaza-acquisition.js');

function loadLI() {
  const sb = { window: {}, console };
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'lease-intelligence.js'), 'utf8'), sb);
  if (!sb.window.LeaseIntelligence) throw new Error('lease-intelligence.js did not expose window.LeaseIntelligence');
  return sb.window.LeaseIntelligence;
}
const LI = loadLI();

let pass = 0, fail = 0;
const failures = [];
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; failures.push(name + ': ' + e.message); console.log('  ✗ ' + name + '  — ' + e.message); }
}
function sec(s) { console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 60 - s.length))); }
function ok(v, m) { if (!v) throw new Error(m || 'expected truthy'); }
function eq(a, b, m) { if (a !== b) throw new Error((m ? m + ': ' : '') + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }
function deq(a, b, m) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error((m ? m + ': ' : '') + x + ' !== ' + y); }

const OPTS = { terms: AT };
const canon = (over) => AL.leaseholdRows(Object.assign({
  families: F.families, documents: F.documents, decisions: F.decisions, tenants: F.tenants,
}, over || {}), { terms: AT, reasoner: LI });
const MAPLE = canon();
const M = LM.buildMatrix(MAPLE.rows, OPTS);
const byId = (id) => M.leaseholds.find(e => e.leaseholdId === id);
const SHOP = byId(F.FAM.shoprite), LUXE = byId(F.FAM.luxe), COFFEE = byId(F.FAM.coffee), PRIME = byId(F.FAM.prime);

console.log('\nAcquisition Review §4m — Lease Matrix (pure)\n' + '='.repeat(64));

// ── 1 · one row per canonical leasehold ─────────────────────────────────────
sec('1 · one row per canonical leasehold');
t('Maple Plaza: four leaseholds, one row each, in the projection\'s order', () => {
  eq(MAPLE.leaseholds, 4);
  eq(M.leaseholds.length, MAPLE.leaseholds);
  deq(M.leaseholds.map(e => e.leaseholdId), MAPLE.rows.filter(r => r._source === 'leasehold').map(r => r._leaseholdId));
  deq(M.leaseholds.map(e => e.tenant), ['ShopRite Supermarkets, Inc.', 'Luxe Nails', 'Maple Coffee Co.', 'Prime Wellness Spa']);
});
t('ShopRite\'s two files — a renewal and an amendment — are ONE row', () => {
  eq(M.leaseholds.filter(e => /ShopRite/.test(e.tenant)).length, 1);
  eq(SHOP.documentCount, 2);
});
t('the raw rows nothing represents are listed apart, as extracted — six of them', () => {
  eq(M.unfiled.length, MAPLE.unfiled);
  eq(M.unfiled.length, 6);
  ok(M.unfiled.every(u => !('status' in u) && !('leaseholdId' in u)), 'an unfiled row was given a status or a record');
  ok(M.unfiled.some(u => u.tenant === 'SafeShield Insurance' && u.sqftText === '5,000'));
});
t('a leasehold with no rows at all is a matrix with no rows — not an error', () => {
  const m = LM.buildMatrix([], OPTS);
  deq(m, { leaseholds: [], unfiled: [] });
  deq(LM.buildMatrix(null, OPTS), { leaseholds: [], unfiled: [] });
});

// ── 2 · ShopRite ────────────────────────────────────────────────────────────
sec('2 · ShopRite Supermarkets, Inc.');
t('67,000 SF — the human-confirmed correction — is the canonical value, verified', () => {
  const c = SHOP.cells.leased_sqft;
  eq(c.value, 67000); eq(c.text, '67,000'); eq(c.state, 'verified');
});
t('the raw upload rows still say 65,000 — the matrix read the projection, not them', () => {
  ok(F.tenants.filter(r => /ShopRite/.test(r.tenant_name)).every(r => r.leased_sqft === 65000));
});
t('base rent $1,251,250, verified; expiration 2039-02-28, read by AI', () => {
  eq(SHOP.cells.base_rent.text, '$1,251,250'); eq(SHOP.cells.base_rent.state, 'verified');
  eq(SHOP.cells.end_date.text, '2039-02-28');  eq(SHOP.cells.end_date.state, 'read');
});
t('lease / CAM structure: NNN · 3% cap, each part with its own state', () => {
  eq(SHOP.structure.text, 'NNN · 3% cap');
  deq(SHOP.structure.parts.map(p => p.state), ['read', 'verified']);
});
t('status: 2 contested — the two contested terms', () => {
  deq(SHOP.status, { kind: 'issues', label: '2 contested' });
});
t('the record\'s header: "67,000 SF · NNN · $1,251,250 base rent"', () => {
  eq(LM.headline(SHOP), '67,000 SF · NNN · $1,251,250 base rent');
});
t('the issues behind its status: Commencement contested, Renewal options contested', () => {
  deq(SHOP.attention.map(a => [a.field, a.kind]), [['start_date', 'contested'], ['renewal_options', 'contested']]);
  deq(SHOP.attention.map(a => a.text), ['Commencement — contested', 'Renewal options — contested']);
});
t('a contested term has no value in the matrix — nothing was chosen', () => {
  const c = LM.cellFor(MAPLE.rows[0], 'start_date', OPTS);
  eq(c.state, 'contested'); eq(c.value, null); eq(c.text, 'Contested');
});
t('audit rights (rejected by a person → unclear) is not a key term and not an issue', () => {
  eq(MAPLE.rows[0]._states.audit_rights, 'unclear');
  ok(!SHOP.attention.some(a => a.field === 'audit_rights'));
});

// ── 3 · Luxe Nails ──────────────────────────────────────────────────────────
sec('3 · Luxe Nails');
t('3,000 SF · — · 5% cap · Terms not established', () => {
  eq(LUXE.cells.leased_sqft.text, '3,000');
  eq(LUXE.cells.base_rent.state, 'missing'); eq(LUXE.cells.base_rent.text, null); eq(LUXE.cells.base_rent.value, null);
  eq(LUXE.structure.text, '5% cap');
  deq(LUXE.status, { kind: 'missing', label: 'Terms not established' });
});
t('its header says what is not established, rather than leaving it out', () => {
  eq(LM.headline(LUXE), '3,000 SF · Lease type not established · Base rent not established');
});
t('its attention list names the missing key terms', () => {
  deq(LUXE.attention.map(a => a.text), ['Base rent — not established', 'Expiration — not established', 'Lease type — not established']);
});
t('nothing of ShopRite\'s leaks into Luxe Nails\' entry', () => {
  const s = JSON.stringify(LUXE);
  ok(!/ShopRite|67,000|1,251,250|NNN/.test(s), s.slice(0, 120));
});

// ── 4 · the other two ───────────────────────────────────────────────────────
sec('4 · Maple Coffee Co. and Prime Wellness Spa');
t('Maple Coffee: a derived base rent is unclear, and two key terms are missing', () => {
  eq(COFFEE.cells.base_rent.state, 'unclear'); eq(COFFEE.cells.base_rent.text, '$84,000');
  deq(COFFEE.status, { kind: 'missing', label: 'Terms not established' });
});
t('Prime Wellness: every key term has a value; base rent is unclear', () => {
  deq(PRIME.status, { kind: 'unclear', label: 'Unclear terms' });
  deq(PRIME.attention.map(a => a.text), ['Base rent — unclear']);
});

// ── 5 · the rules, on their own ─────────────────────────────────────────────
sec('5 · the rules');
const ROW = (states, values, origins) => Object.assign({ _source: 'leasehold', _leaseholdId: 'f', tenant_name: 'T',
  _states: states, _origins: origins || {} }, values);
t('an entered value is marked entered — never passed off as document-supported', () => {
  const r = ROW({ leased_sqft: 'verified', base_rent: 'verified', end_date: 'verified', lease_type: 'verified', security_deposit: 'verified' },
    { leased_sqft: 1000, base_rent: 5000, end_date: '2030-01-01', lease_type: 'NNN', security_deposit: 25000 },
    { security_deposit: 'entered', base_rent: 'entered' });
  eq(LM.cellFor(r, 'security_deposit', OPTS).state, 'entered');
  eq(LM.cellFor(r, 'base_rent', OPTS).state, 'entered');
  eq(LM.cellFor(r, 'base_rent', OPTS).stateText, 'Verified by a person — entered, no document on file supports this value');
  deq(LM.statusFor(r, null, OPTS), { kind: 'verified', label: 'Key terms verified by a person' });
});
t('zero and false are values, not missing', () => {
  const r = ROW({ cap: 'ai_extracted', audit_rights: 'ai_extracted' }, { cap: 0, audit_rights: false });
  eq(LM.cellFor(r, 'cap', OPTS).text, '0%');
  eq(LM.cellFor(r, 'audit_rights', OPTS).text, 'No');
  eq(LM.formatValue(null, 'money'), null);
  eq(LM.formatValue(undefined, 'number'), null);
});
t('a term with no state at all reads as missing, not as a value', () => {
  eq(LM.cellFor(ROW({}, { base_rent: 999 }), 'base_rent', OPTS).state, 'missing');
});
t('status order: issues before missing before unclear before not-yet-verified', () => {
  const all = { leased_sqft: 'ai_extracted', base_rent: 'ai_extracted', end_date: 'ai_extracted', lease_type: 'ai_extracted' };
  const vals = { leased_sqft: 1, base_rent: 1, end_date: 'x', lease_type: 'NNN' };
  eq(LM.statusFor(ROW(all, vals), null, OPTS).kind, 'unverified');
  eq(LM.statusFor(ROW(Object.assign({}, all, { base_rent: 'unclear' }), vals), null, OPTS).kind, 'unclear');
  eq(LM.statusFor(ROW(Object.assign({}, all, { base_rent: 'unclear', end_date: 'missing' }), vals), null, OPTS).kind, 'missing');
  eq(LM.statusFor(ROW(Object.assign({}, all, { end_date: 'missing', co_tenancy: 'conflicting' }), vals), null, OPTS).label, '1 contested');
});
t('a contested cap or lease type is said in the structure column, not dropped', () => {
  const r = ROW({ lease_type: 'conflicting', cap: 'conflicting' }, { lease_type: null, cap: null });
  eq(LM.structureFor(r, OPTS).text, 'Lease type contested · Cap contested');
  eq(LM.structureFor(ROW({}, {}), OPTS).text, null);
});
t('the matrix module decides no state of its own: every state it emits maps from _states / _origins', () => {
  // Code only: the header comment is allowed to NAME what the module does not read.
  const src = fs.readFileSync(path.join(__dirname, 'acquisition-lease-matrix.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  ok(!/resolveFamilyTerms|tenants\[|review\.data/.test(src), 'the matrix re-resolves or reads the raw rows');
});

// ── 5b · the refinements (§4m review) ───────────────────────────────────
sec('5b · review order, readiness, contested readings');
t('the record reads in lease-review order, every term exactly once', () => {
  const o = LM.detailOrder(AT.FIELDS);
  eq(o.length, AT.FIELDS.length); eq(new Set(o).size, AT.FIELDS.length);
  deq(o.slice(0, 8), ['tenant_name', 'suite', 'leased_sqft', 'start_date', 'end_date', 'lease_type', 'base_rent', 'cap']);
  deq(o.slice(8, 10), ['security_deposit', 'renewal_options'], 'security and renewal do not follow the CAM cap');
  ok(o.indexOf('renewal_options') < o.indexOf('cap_base_amount') && o.indexOf('audit_rights') < o.indexOf('tenant_improvement_allowance'),
     'the other terms (CAM details, then obligations) do not follow the core ones');
  deq(LM.detailOrder(['zz_new', 'cap', 'tenant_name']), ['tenant_name', 'cap', 'zz_new'], 'an unnamed field is lost or misplaced');
});
t('no new field was added for rent increases — the groups name only fields the resolver knows', () => {
  ok(LM.DETAIL_ORDER.every(f => AT.FIELDS.indexOf(f) >= 0));
});
t('the header line is leasehold readiness: "4 leaseholds · 1 with contested terms · 2 with terms not established · 1 with unclear terms"', () => {
  eq(LM.summaryLine(M), '4 leaseholds · 1 with contested terms · 2 with terms not established · 1 with unclear terms');
  eq(LM.summaryLine(M, { documents: { unmatched: 3, untyped: 0 } }),
     '4 leaseholds · 1 with contested terms · 2 with terms not established · 1 with unclear terms · 3 documents not yet matched to a tenant');
  eq(LM.summaryLine({ leaseholds: [] }, { documents: { unmatched: 1, untyped: 2 } }), '1 document not yet matched to a tenant · 2 documents of unknown type');
  eq(LM.summaryLine({ leaseholds: [] }), '');
  ok(!/verified/.test(LM.summaryLine(M)));
});
const SHOP_TERMS = AT.resolveFamilyTerms(F.documents.filter(d => d.family_id === F.FAM.shoprite), F.decisions, { reasoner: LI }).terms;
t('Needs attention reads in review order: Commencement, then Renewal options', () => {
  deq(SHOP.attention.map(a => a.field), ['start_date', 'renewal_options']);
});
t('Lease terms, grouped and ordered; a contested term reads "Contested", with no value', () => {
  const g = LM.termRows(SHOP_TERMS, OPTS);
  deq(g.map(x => x.key), ['premises', 'rent', 'security', 'cam', 'obligations']);
  deq(g.map(x => x.tier), ['core', 'core', 'core', 'other', 'other']);
  deq(g[0].rows.map(r => r.field), ['tenant_name', 'suite', 'leased_sqft', 'start_date', 'end_date', 'lease_type']);
  const st = g[0].rows.find(r => r.field === 'start_date');
  eq(st.state, 'contested'); eq(st.text, 'Contested');
  eq(g[0].rows.find(r => r.field === 'leased_sqft').text, '67,000');
  eq(g.reduce((n, x) => n + x.rows.length, 0), 27);
});
t('Lease terms split in two: the 10 core terms, then the 17 others — all 27, each once', () => {
  deq(LM.CORE_FIELDS, ['tenant_name', 'suite', 'leased_sqft', 'start_date', 'end_date', 'lease_type',
                       'base_rent', 'cap', 'security_deposit', 'renewal_options']);
  const S = LM.termSections(SHOP_TERMS, OPTS);
  deq(S.map(x => [x.key, x.title, x.total]), [['core', 'Core lease terms', 10], ['other', 'Other lease terms', 17]]);
  deq(S[1].groups.map(g => g.title), ['CAM details', 'Obligations & special terms']);
  const all = S.reduce((a, x) => a.concat(...x.groups.map(g => g.rows.map(r => r.field))), []);
  eq(all.length, 27); eq(new Set(all).size, 27);
  deq(all, LM.detailOrder(AT.FIELDS), 'the tiers do not read in review order');
});
t('each tier says what is in it, so a folded tier hides nothing it does not count', () => {
  const S = LM.termSections(SHOP_TERMS, OPTS);
  eq(LM.sectionLine(S[0]), '10 terms · 4 verified by a person · 3 read by AI, not yet verified · 2 contested · 1 not established');
  eq(LM.sectionLine(S[1]), '17 terms · 8 read by AI, not yet verified · 1 unclear · 8 not established');
  eq(S[1].counts.contested, 0);
  eq(LM.sectionLine({ total: 1, counts: { contested: 1 } }), '1 term · 1 contested');
});
t('a field the groups do not name still lands in Other lease terms, not nowhere', () => {
  const T = Object.assign({}, SHOP_TERMS, { zz_new: { field: 'zz_new', label: 'New', state: 'missing' } });
  const S = LM.termSections(T, {});
  ok(S[1].groups.some(g => g.rows.some(r => r.field === 'zz_new')));
});
t('a contested term lists every document\'s own reading, in file-name order — none first because it governs', () => {
  const r = LM.contestedReadings(SHOP_TERMS.start_date);
  deq(r.map(x => [x.fileName, x.value, x.page, x.confidence]),
      [['Maple_Plaza_Test_Lease_Amendment.pdf', '2027-01-01', 1, 0.97], ['ShopRite_Anchor_Tenant_Lease.pdf', '2024-03-01', 2, 0.99]]);
  ok(r.every(x => x.quote), 'a reading lost its clause');
  deq(LM.contestedReadings(SHOP_TERMS.leased_sqft), [], 'an uncontested term produced readings');
});

// ── 5c · the five states, in one set of words (§4m clarity pass) ─────────────
sec('5c · the five states, and what still needs a person');
t('the five states read exactly: Verified by a person · Read by AI · not yet verified · Unclear · Contested · Not established', () => {
  deq(LM.STATE_LABEL, { verified: 'Verified by a person', entered: 'Verified by a person', read: 'Read by AI · not yet verified',
                        unclear: 'Unclear', contested: 'Contested', missing: 'Not established' });
  deq(LM.TERM_STATE_LABEL, { verified: 'Verified by a person', ai_extracted: 'Read by AI · not yet verified',
                             unclear: 'Unclear', conflicting: 'Contested', missing: 'Not established' });
  Object.keys(LM.STATE_TEXT).forEach(k => ok(LM.STATE_TEXT[k].indexOf(LM.STATE_LABEL[k]) === 0, k + ' tooltip does not start with its state'));
});
t('an entered value is Verified by a person — its tooltip also says no document supports it', () => {
  ok(/^Verified by a person — entered, no document on file supports this value$/.test(LM.STATE_TEXT.entered));
});
t('counts use the same words, in one order, zeros left out', () => {
  eq(LM.countsLine({ total: 27, verified: 4, read: 11, unclear: 1, contested: 2, missing: 9 }),
     '27 terms · 4 verified by a person · 11 read by AI, not yet verified · 1 unclear · 2 contested · 9 not established');
  eq(LM.countsLine({ total: 1, missing: 1 }), '1 term · 1 not established');
  deq(LM.summaryCounts({ total: 27, verified: 4, ai_extracted: 11, unclear: 1, conflicting: 2, missing: 9 }),
      { total: 27, verified: 4, read: 11, unclear: 1, contested: 2, missing: 9 });
});
t('values only read by AI are counted as needing a person: ShopRite 11, Luxe 4, Maple Coffee 8, Prime Wellness 9', () => {
  deq([SHOP, LUXE, COFFEE, PRIME].map(e => e.unverified.length), [11, 4, 8, 9]);
  eq(SHOP.unverified[0], 'tenant_name', 'the count does not start in review order');
  ok(SHOP.unverified.indexOf('start_date') < 0 && SHOP.unverified.indexOf('suite') < 0, 'a contested or verified term counted as unverified');
  eq(SHOP.unverified.length, SHOP_TERMS && Object.keys(SHOP_TERMS).filter(f => SHOP_TERMS[f].state === 'ai_extracted' && SHOP_TERMS[f].support !== 'entered').length,
     'the matrix and the evidence disagree on how many are unverified');
});
t('an entered value is never counted as unverified; a verified row has nothing to review', () => {
  const r = ROW({ leased_sqft: 'verified', base_rent: 'verified', end_date: 'verified', lease_type: 'verified' },
    { leased_sqft: 1000, base_rent: 5000, end_date: '2030-01-01', lease_type: 'NNN' }, { base_rent: 'entered' });
  deq(LM.unverifiedFor(r, OPTS), []);
  deq(LM.attentionSummary(r, OPTS), []);
  const one = ROW({ leased_sqft: 'ai_extracted' }, { leased_sqft: 1000 });
  deq(LM.attentionSummary(one, OPTS).map(g => g.text), ['1 value read by AI · not yet verified']);
});
t('the unverified values do not change a row\'s status — they are counted, not ranked', () => {
  eq(PRIME.status.kind, 'unclear'); eq(SHOP.status.kind, 'issues');
  ok(!SHOP.attention.some(a => a.kind === 'unverified'));
});

// ── 5d · Needs attention is the workload, never "N items" ─────────────────────
sec('5d · Needs attention: every state with its count');
const RESOLVED = (fam) => AT.resolveFamilyTerms(F.documents.filter(d => d.family_id === F.FAM[fam]),
  F.decisions.filter(d => d.family_id === F.FAM[fam]), { reasoner: LI }).summary;
t('ShopRite: 2 contested · 9 not established · 1 unclear · 11 values read by AI · not yet verified — in that order', () => {
  deq(SHOP.attentionSummary.map(g => g.text), ['2 contested', '9 not established', '1 unclear', '11 values read by AI · not yet verified']);
  deq(SHOP.attentionSummary.map(g => g.kind), ['contested', 'missing', 'unclear', 'unverified']);
  deq(SHOP.attentionSummary[0].terms.map(t => t.label), ['Commencement', 'Renewal options']);
  deq(SHOP.attentionSummary[2].terms.map(t => t.field), ['audit_rights']);
  eq(SHOP.attentionSummary[3].terms[0].field, 'tenant_name', 'the terms are not in review order');
});
t('every group names every term it counts, each once', () => {
  [SHOP, LUXE, COFFEE, PRIME].forEach(e => e.attentionSummary.forEach(g => {
    eq(g.terms.length, g.count, e.tenant + ' ' + g.kind);
    eq(new Set(g.terms.map(t => t.field)).size, g.count, e.tenant + ' ' + g.kind + ' repeats a term');
  }));
});
t('the counts are the resolver\'s own, for every leasehold — nothing re-counted, nothing summed into "items"', () => {
  [['shoprite', SHOP], ['luxe', LUXE], ['coffee', COFFEE], ['prime', PRIME]].forEach(([fam, e]) => {
    const R = RESOLVED(fam);
    const c = Object.fromEntries(e.attentionSummary.map(g => [g.kind, g.count]));
    deq([c.contested || 0, c.missing || 0, c.unclear || 0, c.unverified || 0],
        [R.conflicting, R.missing, R.unclear, R.ai_extracted - (R.entered || 0)], fam);
    eq((c.contested || 0) + (c.missing || 0) + (c.unclear || 0) + (c.unverified || 0) + R.verified, R.total, fam + ' does not add up to every term');
  });
  deq(LUXE.attentionSummary.map(g => g.text), ['23 not established', '4 values read by AI · not yet verified']);
  deq(COFFEE.attentionSummary.map(g => g.text), ['18 not established', '1 unclear', '8 values read by AI · not yet verified']);
  deq(PRIME.attentionSummary.map(g => g.text), ['17 not established', '1 unclear', '9 values read by AI · not yet verified']);
});
t('there is no "N items need attention" any more', () => {
  eq(LM.attentionHeading, undefined);
});
t('documents still to review are named in the same words as Documents › Needs review', () => {
  deq(LM.documentsLine({ unmatched: 3, untyped: 0 }), ['3 documents not yet matched to a tenant']);
  deq(LM.documentsLine({ unmatched: 1, untyped: 1 }), ['1 document not yet matched to a tenant', '1 document of unknown type']);
  deq(LM.documentsLine({}), []);
});

// ── 6 · the page wiring (static) ────────────────────────────────────────────
sec('6 · the page wiring');
const S = fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8');
const H = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
function fnBody(src, name) {
  const re = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(');
  const m = re.exec(src); if (!m) throw new Error('no function ' + name);
  let i = src.indexOf('{', m.index), depth = 0, j = i;
  for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}') { depth--; if (!depth) break; } }
  return src.slice(i, j + 1);
}
t('index.html loads the module after the projection it reads', () => {
  const a = H.indexOf('<script src="acquisition-leasehold.js"></script>');
  const b = H.indexOf('<script src="acquisition-lease-matrix.js"></script>');
  ok(a > 0 && b > a, `leasehold@${a} matrix@${b}`);
});
t('the matrix reads the canonical rows — and nothing else', () => {
  ok(/_acqCanonicalRows\(reviewId\)\.rows/.test(fnBody(S, '_acqMatrixFor')));
});
t('the evidence is drawn only for the open leasehold, in review order', () => {
  const R = fnBody(S, '_renderAcqTerms');
  ok(/const openId = _acqOpenLeaseholdId\(families\);/.test(R));
  ok(/if \(fam\.id !== openId\) return '';/.test(R), 'another leasehold\'s evidence is still drawn');
  ok(/\(LM \? LM\.detailOrder\(AT\.FIELDS\) : AT\.FIELDS\)\.map\(field =>/.test(R), 'the evidence is not in review order');
  ok(/_acqLeaseholdHeadHtml\(openId\)/.test(R) && /_acqLeaseMatrixHtml\(_activeAcqId\)/.test(R));
});
t('the header counts leaseholds, never every possible term', () => {
  const R = fnBody(S, '_renderAcqTerms');
  ok(/countEl\.textContent = LM \? LM\.summaryLine\(_acqMatrixFor\(_activeAcqId\), \{ documents: _acqDocsToReview\(_activeAcqId\) \}\) : '';/.test(R));
  ok(!/of \$\{totalTerms\} verified|totalVerified/.test(R), 'the "X of Y verified" framing is still there');
});
t('a contested row shows no value, source, clause or "Replaced" of its own — only each document\'s reading', () => {
  const R = fnBody(S, '_renderAcqTerms');
  ok(/const contested = term\.state === 'conflicting';/.test(R));
  ok(/const valueHtml = contested\s*\? `<span class="acq-term-contested">Contested — the documents disagree\. Nothing has been chosen\.<\/span>`/.test(R));
  ok(/const src = !contested && /.test(R) && /const quote = !contested && /.test(R) && /const superseded = !contested && /.test(R));
  ok(/LM\.contestedReadings\(term\)/.test(R) && /Nothing has been chosen for you/.test(R));
  ok(/conflicting:  \{ label: 'Contested'/.test(S), 'the chip still says Conflicting');
});
t('after a person confirms or corrects, a past disagreement no longer says "Nothing has been chosen"', () => {
  const R = fnBody(S, '_renderAcqTerms');
  ok(/const selected = !contested && !!term\.decision\s*&& \(term\.decision\.action === 'confirm' \|\| term\.decision\.action === 'correct'\);/.test(R),
     'a rejection, or a still-contested term, would read as chosen');
  ok(/\(selected\s*\? `<div class="acq-term-conflict" data-resolved="person">Documents previously contained conflicting values: `/.test(R));
  ok(/\(selected \? `\. This value was selected by a person\.<\/div>` : `\. Nothing has been chosen for you\.<\/div>`\)/.test(R));
});
t('the Lease terms layer: Core always shown, Other folded — opened by a contest, and kept open across a re-render', () => {
  const Hd = fnBody(S, '_acqLeaseholdHeadHtml');
  ok(/LM\.termSections\(resolved\.terms/.test(Hd) && /LM\.sectionLine\(t\)/.test(Hd));
  ok(/<details class="acq-lh-tier acq-lh-other"[^`]*\$\{\(t\.counts\.contested \|\| _acqLhOtherOpen\[familyId\]\) \? ' open' : ''\}/.test(Hd));
  ok(/addEventListener\('toggle'[\s\S]*_acqLhOtherOpen\[lh\.getAttribute\('data-leasehold'\)\] = d\.open;[\s\S]*\}, true\);/.test(fnBody(S, '_acqBindLeaseMatrixControls')));
});
t('the evidence chips use the five states — no "AI extracted", "Missing" or bare "Verified"', () => {
  const B = S.slice(S.indexOf('const _ACQ_TERM_STATE = {'), S.indexOf('};', S.indexOf('const _ACQ_TERM_STATE = {')));
  const labels = [...B.matchAll(/label: '([^']+)'/g)].map(m => m[1]);
  deq(labels, ['Verified by a person', 'Read by AI · not yet verified', 'Contested', 'Unclear', 'Not established']);
  const R = fnBody(S, '_renderAcqTerms');
  ok(/const sub = LM \? LM\.countsLine\(LM\.summaryCounts\(s\)\)/.test(R), 'the evidence counts are not in the five states\' words');
  ok(!/' AI'|' missing'\]/.test(R), 'the old "11 AI · 9 missing" counts are still there');
});
t('MainStreet\'s Record is labelled as the record, and the uploads as source material', () => {
  ok(/<h3>&#x1F4CB; MainStreet’s Record<\/h3>/.test(H) && !/<h3>&#x1F4CB; Lease Matrix<\/h3>/.test(H));
  ok(/<h3>&#x1F4C4; Extracted Lease Files<\/h3>/.test(H) && /as extracted from your files — not reviewed/.test(H));
  const M2 = fnBody(S, '_acqLeaseMatrixHtml');
  ok(/one record per tenant\/leasehold/.test(M2));
  const L = fnBody(S, '_renderAcqLeaselist');
  ok(/acq-src-file/.test(L) && /read as “/.test(L) && /not reviewed/.test(L) && !/acq-file-dot/.test(L), 'the upload list still reads as a roster');
});
t('no internal words: "not in a leasehold" and "not yet placed" are gone from the workspace', () => {
  ok(!/not in a leasehold — as extracted/.test(fnBody(S, '_acqUnfiledListHtml')));
  ok(/not matched to a tenant — as extracted from the file, not reviewed/.test(fnBody(S, '_acqUnfiledListHtml')));
  ok(!/not yet placed/.test(S), '"not yet placed" is still on screen');
  ok(/LMd\.documentsLine\(due\)/.test(fnBody(S, '_renderAcqDocuments')), 'Documents › Needs review does not use the shared words');
});
t('the documents to review are counted from the same grouping the Documents panel draws', () => {
  const D = fnBody(S, '_acqDocsToReview');
  ok(/AD\.groupDocuments\(rows, fams\)\.needsReview/.test(D) && /!d\.family_id \|\| !ids\.has\(d\.family_id\)/.test(D));
  ok(/\.acq-lm-docs-due/.test(fnBody(S, '_acqBindLeaseMatrixControls')) && /acq-doc-group\.needs-review/.test(fnBody(S, '_acqBindLeaseMatrixControls')));
});
t('Needs attention draws one line per state, with its count and its terms — no aggregate heading', () => {
  const Hd = fnBody(S, '_acqLeaseholdHeadHtml');
  ok(/const due = e\.attentionSummary;/.test(Hd) && /acq-lh-attn-count">\$\{esc\(g\.text\)\}/.test(Hd));
  ok(/g\.terms\.map\(t => `<button type="button" class="acq-lh-attn-item/.test(Hd), 'a term in a group is not a link to its evidence');
  ok(!/attentionHeading|items need attention|acq-lh-attn-head/.test(Hd), 'the aggregate heading is still drawn');
});
t('an open record belongs to one review: another review, or a vanished family, drops it', () => {
  const O = fnBody(S, '_acqOpenLeaseholdId');
  ok(/o\.reviewId !== _activeAcqId/.test(O) && /f\.id === o\.familyId/.test(O) && /_acqOpenLeasehold = null;/.test(O));
  ok(/_acqOpenLeasehold\s*=\s*null;/.test(fnBody(S, 'selectAcquisitionReview')), 'opening a review does not land on its matrix');
  ok(/_acqOpenLeasehold = null;/.test(fnBody(S, 'closeAcquisitionDetail')));
});
t('opening refuses a family that is not this review\'s', () => {
  ok(/_acqFamilyRows\(_activeAcqId\)\.some\(f => f && f\.id === familyId\)/.test(fnBody(S, 'acqOpenLeasehold')));
});
t('every value the matrix and the header print into HTML is escaped', () => {
  for (const name of ['_acqLmCellHtml', '_acqLhValueHtml', '_acqLeaseMatrixHtml', '_acqLeaseholdHeadHtml', '_acqUnfiledListHtml']) {
    const B = fnBody(S, name);
    const raw = (B.match(/\$\{(?!esc\()[^}]*\}/g) || [])
      .filter(s => !/^\$\{(title|mark|rows|n\b|n ===|_acqLmCellHtml|attn|heading \?|_acqUnfiledListHtml|m\.unfiled\.length|e\.structure\.parts\.length|m\.unfiled\.map|e\.attention\.map|_ACQ_LH_OVERVIEW\.map|_acqLhValueHtml|heading\s|resolved \?|e\.unverified\.length\s|dueText \?|due\.length\s|due\.map|g\.terms\.map|groups\.map|t\.groups\.map|sections\.map|\(t\.counts\.contested \|\| _acqLhOtherOpen\[familyId\]\) \? ' open' : ''|g\.rows\.map|docs\.length|opener|overview|terms|documents|attn)/.test(s));
    deq(raw, [], name + ' interpolates without esc()');
  }
});

console.log('\n' + '─'.repeat(64));
console.log(`RESULT: ${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILED:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);
