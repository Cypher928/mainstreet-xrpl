'use strict';
/**
 * test-acquisition-assignment.js — Acquisition Intake (I-3a): which property a
 * held document belongs to — the rule matrix, driven on the real module with the
 * real tenant comparator injected.
 *
 *   node test-acquisition-assignment.js
 *
 * The module PROPOSES; a person assigns (I-3b); I-4 files. Every rule the intent
 * states is driven here with fixtures: the clue kinds and their strengths, what
 * blocks a proposal, when "several" is allowed (and when a document that merely
 * MENTIONS several properties is a question), the sibling clue and its one hop,
 * the validator a person's choice passes through, the words the screen shows,
 * near-duplicates, what the prospect already holds — and that recompute never
 * touches an assignment. The generic-word lists are held equal to
 * acquisition-leasehold.js's, read from its source.
 */
const fs = require('fs'), path = require('path');
const ROOT = __dirname;
const AA = require('./acquisition-assignment.js');
const AL = require('./acquisition-leasehold.js');
const deps = { compareTenantNames: AL.compareTenantNames };

let pass = 0, fail = 0;
const failures = [];
function t(name, fn) {
  try { fn(); pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  catch (e) { fail++; failures.push(`${name}: ${e.message}`); console.log(`  \x1b[31m✗\x1b[0m ${name}\n      → ${e.message}`); }
}
const ok = (c, m) => { if (!c) throw new Error(m || 'expected truthy'); };
const eq = (a, b, m) => { const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error(`${m || ''} expected ${B}, got ${A}`); };
function sec(s) { console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 60 - s.length))); }

// ── fixtures ─────────────────────────────────────────────────────────────────
const review = (id, name, address, tenants) => ({ id, name, status: 'draft', data: { address: address || undefined, tenants: (tenants || []).map((n, i) => ({ tenant_name: n, suite: String(110 + 10 * i) })) } });
const prof = (id, name, address, tenants, families, docs) => AA.profileOf(review(id, name, address, tenants), families || [], docs || [], deps);
const MAPLE  = prof('rev-maple', 'Maple Plaza', '120 Maple Ave, Springfield', ['Harbor Cafe LLC', 'Coastal Outfitters Inc', 'Pine Dental PC']);
const CEDAR  = prof('rev-cedar', 'Cedar Court', '45 Cedar Ct, Springfield', ['Fern Books LLC', 'Quill Stationers', 'Harbor Cafe LLC']);   // Harbor Cafe is a chain
const OAK    = prof('rev-oak', 'Oak Ridge', '300 Oak Ridge Blvd', ['Summit Fitness LLC', 'Ridgeline Pharmacy', 'Acorn Pediatrics PC']);
const ELM    = prof('rev-elm', '900 Elm St', null, ['Elmwood Dental']);                       // an address-shaped name, no address
const GENERIC = prof('rev-gen', 'Shopping Center', null, ['Cobalt Comics LLC']);              // a generic-only name
const ALL = [MAPLE, CEDAR, OAK];
let seq = 0;
const item = (name, text, reading, type, extra) => Object.assign({ itemId: 'it-' + (++seq), name, state: 'classified', text, reading: reading || {}, type: { value: type || null, source: type ? 'ai' : null }, removed: false }, extra || {});
const PAD = ' The parties agree to the covenants, conditions and provisions set out in the schedules attached hereto.';
const lease = (p, tenant) => `LEASE AGREEMENT\nThis Lease is made between ${p.name} Owner LLC (Landlord) and Tenant: ${tenant}\nPremises: Suite 110, ${p.name}, ${p.address}\nDated: 2023-03-01${PAD}`;
const one = (items, profiles) => { const r = AA.recompute(items, profiles || ALL, deps); return { d: r.decisions[items[0].itemId], ranked: r.tallies[items[0].itemId], r }; };
const kinds = (tallyRow) => tallyRow.clues.map(c => c.kind + ':' + c.strength + (c.flag ? '/' + c.flag : ''));
const rowFor = (ranked, id) => ranked.find(r => r.reviewId === id);

sec('vocabulary and text');

t('the generic-word lists are acquisition-leasehold.js\'s, read from its source', () => {
  const src = fs.readFileSync(path.join(ROOT, 'acquisition-leasehold.js'), 'utf8');
  for (const name of ['LEGAL_SUFFIX', 'FILLER', 'GENERIC_TENANT', 'GENERIC_PROPERTY']) {
    const m = new RegExp('var ' + name + ' = \\{([\\s\\S]*?)\\};').exec(src);
    ok(m, name + ' not found in the leasehold source');
    const keys = [...m[1].matchAll(/([a-z]+): 1/g)].map(x => x[1]).sort();
    eq(Object.keys(AA[name]).sort(), keys, name);
  }
});

t('words: lower case, "&" is "and", apostrophes vanish, "L.L.C." is one word, punctuation separates; positions are kept', () => {
  eq(AA.words('Harbor Cafe & Bakery, L.L.C. — Don\'t'), ['harbor', 'cafe', 'and', 'bakery', 'llc', 'dont']);
  const toks = AA.tokenize('at 120 Maple Ave.');
  eq(toks.map(x => x.w), ['at', '120', 'maple', 'ave']);
  eq([toks[1].s, toks[1].e], [3, 6]);
  eq(AA.distinctive(['the', 'maple', 'plaza', 'llc', '120', 'at', 'oak']), ['maple', 'oak'], 'filler, legal suffixes, generic property words and numbers are not distinctive');
});

t('pages and snippets: offset 0 is page 1; a marker opens a page; a snippet quotes the words around the match without the markers', () => {
  const text = '--- Page 1 ---\nLEASE AGREEMENT between Maple Plaza Owner LLC\n\n--- Page 2 ---\nPremises: 120 Maple Ave, Springfield';
  eq(AA.pageAt(text, 0), 1); eq(AA.pageAt(text, 20), 1); eq(AA.pageAt(text, text.indexOf('Premises')), 2);
  const hit = AA.locate(text, ['120', 'maple', 'ave'])[0];
  eq(hit.page, 2);
  ok(/^“…?[^“”]*120 Maple Ave[^“”]*”$/.test(hit.snippet) && !/--- Page/.test(hit.snippet), hit.snippet);
  eq(AA.pageAt('no markers here', 5), 1);
});

t('an address is a number and its street, abbreviations expanded; a unit number is not an address', () => {
  eq(AA.addressParts('120 Maple Ave, Springfield'), { ok: true, number: '120', street: ['maple', 'avenue'] });
  eq(AA.addressParts('45 Cedar Ct'), { ok: true, number: '45', street: ['cedar', 'court'] });
  eq(AA.addressParts('900 Elm St').street, ['elm', 'street']);
  eq(AA.addressParts('Suite 110, Maple Plaza').ok, false, 'a unit number read as an address');
  eq(AA.addressParts('Maple Plaza').ok, false);
  eq(AA.findSequence(AA.tokenize('at 120 Maple Avenue today'), ['120', 'maple', 'ave']).length, 1, 'abbreviations are expanded on both sides');
  eq(AA.findSequence(AA.tokenize('at 120 Maple Ave today'), ['120', 'maple', 'avenue']).length, 1);
});

sec('what is known about a prospect');

t('a profile dedupes its tenants through the comparator, keeps suites and files, reads the address and the name', () => {
  const p = AA.profileOf(review('r1', 'Maple Plaza', '120 Maple Ave', ['Harbor Cafe LLC', 'Pine Dental PC']),
    [{ id: 'fam-1', tenant_name: 'Harbor Cafe' }], [{ id: 'd1', file_name: 'maple-plaza-lease.txt', doc_type: 'original_lease', doc_date: '2023-03-01', family_id: 'fam-1' }], deps);
  eq(p.tenants, ['Harbor Cafe LLC', 'Pine Dental PC'], '"Harbor Cafe" and "Harbor Cafe LLC" are one tenant');
  eq(p.suites, ['110', '120']); eq(p.files, ['maple-plaza-lease.txt']);
  eq(p.docs[0], { fileName: 'maple-plaza-lease.txt', docType: 'original_lease', docDate: '2023-03-01', tenantName: 'Harbor Cafe', superseded: false });
  eq(p.addressParts.street, ['maple', 'avenue']); eq(p.genericName, false); eq(p.addressShapedName, false);
});

t('a generic-only name is known to be generic; an address-shaped name is matched as an address', () => {
  eq(GENERIC.genericName, true); eq(GENERIC.distinctive, []);
  eq(ELM.addressShapedName, true); eq(ELM.nameAddressParts.street, ['elm', 'street']); eq(ELM.genericName, false);
});

t('prospectsKnowing finds every prospect that knows a tenant, by the comparator', () => {
  eq(AA.prospectsKnowing(ALL, 'Harbor Cafe', deps).map(p => p.reviewId), ['rev-maple', 'rev-cedar']);
  eq(AA.prospectsKnowing(ALL, 'Summit Fitness', deps).map(p => p.reviewId), ['rev-oak']);
  eq(AA.prospectsKnowing(ALL, 'Nobody Here LLC', deps), []);
});

sec('clues');

t('the address is a strong clue with its page and snippet, counted; the street alone is weak', () => {
  const it = item('a.txt', lease(MAPLE, 'Pine Dental PC'), { tenantName: 'Pine Dental PC' }, 'original_lease');
  const c = AA.directClues(it, MAPLE, ALL, deps);
  const addr = c.find(x => x.kind === 'address');
  ok(addr && addr.strength === 'strong' && addr.count === 1 && addr.page === 1 && /120 Maple Ave/.test(addr.snippet) && addr.source === 'the address you gave', JSON.stringify(addr));
  const st = AA.directClues(item('b.txt', 'Somewhere on Maple Avenue, no number given.' + PAD, {}, null), MAPLE, ALL, deps).find(x => x.kind === 'street_only');
  ok(st && st.strength === 'weak', JSON.stringify(st));
});

t('the name as a phrase is strong and counted; scattered name words are weak; a generic-only name is never matched', () => {
  const c = AA.directClues(item('a.txt', lease(MAPLE, 'Pine Dental PC'), {}, null), MAPLE, ALL, deps);
  const nm = c.find(x => x.kind === 'name');
  ok(nm && nm.strength === 'strong' && nm.count === 2, JSON.stringify(nm));
  const partial = AA.directClues(item('b.txt', 'The maple trees along the lot.' + PAD, {}, null), MAPLE, ALL, deps).find(x => x.kind === 'name_partial');
  ok(partial && partial.strength === 'weak' && partial.matched === 'maple', JSON.stringify(partial));
  eq(AA.directClues(item('c.txt', 'A shopping center with a plaza and a square.' + PAD, {}, null), GENERIC, [GENERIC], deps).filter(x => /name/.test(x.kind)), [], 'a generic-only name was matched');
});

t('the tenant the classifier read: medium when the prospect knows it, weak and flagged when two prospects do (a chain), weak and flagged when only similar', () => {
  const oak = AA.directClues(item('a.txt', 'SIDE LETTER regarding signage.' + PAD, { tenantName: 'Summit Fitness LLC' }, 'side_letter'), OAK, ALL, deps);
  eq(kinds(AA.tally('rev-oak', oak)), ['tenant_known:medium']);
  const chain = AA.directClues(item('b.txt', 'INVOICE' + PAD, { tenantName: 'Harbor Cafe LLC' }, 'invoice'), MAPLE, ALL, deps);
  eq(kinds(AA.tally('rev-maple', chain)), ['tenant_known:weak/shared']);
  const sim = AA.directClues(item('c.txt', 'NOTICE' + PAD, { tenantName: 'Summit Fitness and Yoga LLC' }, 'other'), OAK, ALL, deps);
  const s = sim.find(x => x.kind === 'tenant_similar');
  ok(s && s.strength === 'weak' && s.flag === 'similar' && /only partly agree|different businesses/.test(s.source), JSON.stringify(sim));
  eq(AA.directClues(item('d.txt', 'NOTICE' + PAD, { tenantName: 'Nobody Here LLC' }, 'other'), OAK, ALL, deps), [], 'an unknown tenant is a clue');
});

t('known tenants named in the text: three or more is a medium roster, one or two is weak', () => {
  const roll = `RENT ROLL\nSuite 110 Harbor Cafe LLC\nSuite 120 Coastal Outfitters Inc\nSuite 130 Pine Dental PC${PAD}`;
  const c = AA.directClues(item('r.txt', roll, {}, 'rent_roll'), MAPLE, ALL, deps);
  const roster = c.find(x => x.kind === 'roster');
  ok(roster && roster.strength === 'medium' && roster.count === 3, JSON.stringify(c));
  const two = AA.directClues(item('s.txt', 'Harbor Cafe LLC and Pine Dental PC share the lot.' + PAD, {}, null), MAPLE, ALL, deps).find(x => x.kind === 'tenant_in_text');
  ok(two && two.strength === 'weak' && two.count === 2, JSON.stringify(two));
});

t('a known suite is weak, and a suite alone counts for nothing', () => {
  const c = AA.directClues(item('a.txt', 'NOTICE' + PAD, { suite: '110' }, 'other'), MAPLE, ALL, deps);
  eq(c.map(x => x.kind), ['suite']);
  const ty = AA.tally('rev-maple', c);
  eq([ty.strong, ty.medium, ty.weak, ty.score], [0, 0, 0, 0], 'a lone suite scored');
  const withName = AA.tally('rev-maple', AA.directClues(item('b.txt', lease(MAPLE, 'Nobody'), { suite: '110' }, 'original_lease'), MAPLE, ALL, deps));
  ok(withName.weak >= 1 && withName.strong >= 1, 'with another clue the suite counts');
});

t('an address nobody has is named (up to three); a known address and a unit number are not', () => {
  const u = AA.unknownAddresses(item('a.txt', 'Premises: 77 Birch Road, Springfield. Also 120 Maple Ave. Suite 110, Maple Plaza.' + PAD, {}, null), ALL);
  eq(u.map(x => x.address), ['77 Birch Road']);
  const many = AA.unknownAddresses(item('b.txt', '1 First St; 2 Second Ave; 3 Third Rd; 4 Fourth Blvd' + PAD, {}, null), ALL);
  eq(many.length, 3);
  eq(AA.unknownAddresses(item('c.txt', 'Suite 110, Maple Plaza' + PAD, {}, null), ALL), []);
});

sec('the decision');

t('one strong clue and nothing elsewhere: proposed; a weak mention elsewhere is a faint note, not a block', () => {
  const { d } = one([item('a.txt', lease(MAPLE, 'Pine Dental PC') + ' Formerly near the Cedar lot.', { tenantName: 'Pine Dental PC' }, 'original_lease')]);
  eq(d.state, 'proposed'); eq(d.proposal.reviewId, 'rev-maple'); eq(d.basis, 'strong'); eq(d.multiAllowed, false);
  ok(d.notes.some(n => n.kind === 'faint' && n.reviewId === 'rev-cedar'), JSON.stringify(d.notes));
});

t('one strong clue with a medium clue elsewhere: candidates, never a proposal', () => {
  // Maple's address in the text; the tenant the classifier read is known to Oak Ridge only.
  const { d } = one([item('a.txt', lease(MAPLE, 'Summit Fitness LLC'), { tenantName: 'Summit Fitness LLC' }, 'original_lease')]);
  eq(d.state, 'candidates'); eq(d.basis, 'competition');
  eq(d.candidates.map(r => r.reviewId), ['rev-maple', 'rev-oak']);
});

t('a lease that names two properties is a question, never several — the counts are shown, the dominant first', () => {
  const text = `LEASE AGREEMENT\nLandlord: Maple Plaza Owner LLC. Premises: Suite 120, Maple Plaza, 120 Maple Ave, Springfield.\nTenant: Coastal Outfitters Inc\nRecitals: Tenant formerly operated at Cedar Court and relocates to Maple Plaza under this Lease.${PAD}`;
  const { d } = one([item('prior.txt', text, { tenantName: 'Coastal Outfitters Inc' }, 'original_lease')]);
  eq(d.state, 'candidates'); eq(d.basis, 'single_premises'); eq(d.multiAllowed, false);
  eq(d.candidates.map(r => r.reviewId), ['rev-maple', 'rev-cedar']);
  const n = d.notes.find(x => x.kind === 'several_mentions');
  ok(n && n.counts[0].reviewId === 'rev-maple' && n.counts[0].mentions >= 3 && n.counts[1].mentions === 1, JSON.stringify(n));
  ok(/but an original lease covers one premises: Maple Plaza ×\d+, Cedar Court ×1\./.test(AA.noteSentence(n, ALL)), AA.noteSentence(n, ALL));
});

t('a portfolio document (rent roll, PSA, financial statement) naming several in balance is SEVERAL — and only then may several be assigned', () => {
  const text = `RENT ROLL - PORTFOLIO\nMAPLE PLAZA - 120 Maple Ave, Springfield\nSuite 110 Harbor Cafe LLC\nCEDAR COURT - 45 Cedar Ct, Springfield\nSuite 1 Fern Books LLC${PAD}`;
  for (const type of ['rent_roll', 'psa', 'financial_statement']) {
    const { d } = one([item('p.txt', text, {}, type)]);
    eq(d.state, 'several', type); eq(d.multiAllowed, true, type); eq(d.basis, 'portfolio_balanced');
    eq(d.candidates.map(r => r.reviewId).sort(), ['rev-cedar', 'rev-maple']);
  }
  ok(/Names 2 properties, and a rent roll can cover several — file it to each, or pick one\./.test(AA.explain(one([item('p.txt', text, {}, 'rent_roll')]).d, [], ALL).notes.join(' ')));
});

t('the same mentions with a type that covers one premises, or no type yet, are a question', () => {
  const text = `MAPLE PLAZA - 120 Maple Ave, Springfield\nCEDAR COURT - 45 Cedar Ct, Springfield${PAD}`;
  const a = one([item('a.txt', text, {}, 'amendment')]).d;
  eq([a.state, a.basis, a.multiAllowed], ['candidates', 'single_premises', false]);
  const b = one([item('b.txt', text, {}, null)]).d;
  eq([b.state, b.basis, b.multiAllowed], ['candidates', 'type_unset', false]);
  ok(b.notes.some(n => n.kind === 'type_unset'));
  const c = one([item('c.txt', text, {}, 'other')]).d;
  eq([c.state, c.basis], ['candidates', 'single_premises'], '"other" is not trusted to be multi-property');
});

t('a portfolio document whose mentions are unbalanced (below 1/3) is a question, not several', () => {
  const text = `RENT ROLL\nMAPLE PLAZA - 120 Maple Ave, Springfield\nMaple Plaza\nMaple Plaza\nMaple Plaza\nSee also Cedar Court${PAD}`;
  const { d } = one([item('u.txt', text, {}, 'rent_roll')]);
  eq([d.state, d.basis, d.multiAllowed], ['candidates', 'portfolio_unbalanced', false]);
  ok(/mostly one/.test(AA.explain(d, [], ALL).notes.join(' ')));
});

t('no strong clue: two medium clues carry a proposal only when one is read from the text and no unknown address is present', () => {
  const roll = `RENT ROLL\nSuite 110 Harbor Cafe LLC\nSuite 120 Coastal Outfitters Inc\nSuite 130 Pine Dental PC${PAD}`;
  // ROSTER (medium, text) + TENANT_KNOWN (medium, Pine Dental is Maple's only) → proposed
  const a = one([item('a.txt', roll, { tenantName: 'Pine Dental PC' }, 'rent_roll')]).d;
  eq([a.state, a.basis, a.proposal.reviewId], ['proposed', 'medium_text', 'rev-maple']);
  // the same with an address nobody has → a question
  const b = one([item('b.txt', roll + ' Premises: 77 Birch Road, Springfield.', { tenantName: 'Pine Dental PC' }, 'rent_roll')]).d;
  eq([b.state, b.basis], ['candidates', 'unknown_address']);
  ok(b.notes.some(n => n.kind === 'unknown_address' && n.address === '77 Birch Road'));
});

t('AI-derived mediums alone — the tenant the classifier read and a sibling that shares it — are only a reason to ask', () => {
  const sib = item('oak-lease.txt', lease(OAK, 'Summit Fitness LLC'), { tenantName: 'Summit Fitness LLC' }, 'original_lease');
  const letter = item('side.txt', 'SIDE LETTER regarding signage on the east elevation.' + PAD, { tenantName: 'Summit Fitness LLC' }, 'side_letter');
  const r = AA.recompute([sib, letter], ALL, deps);
  const d = r.decisions[letter.itemId];
  eq([d.state, d.basis], ['candidates', 'ai_only']);
  ok(d.notes.some(n => n.kind === 'ai_only' && n.reviewId === 'rev-oak'));
  const oak = rowFor(r.tallies[letter.itemId], 'rev-oak');
  eq(kinds(oak), ['tenant_known:medium', 'batch_sibling:medium']);
  ok(/Only the tenant name points at Oak Ridge — confirm it yourself\./.test(AA.explain(d, r.tallies[letter.itemId], ALL).notes.join(' ')));
});

t('a single medium, or only weak clues, is a question; nothing is none; no text is none and says so', () => {
  const m = one([item('a.txt', 'NOTICE TO TENANT' + PAD, { tenantName: 'Summit Fitness LLC' }, 'other')]).d;
  eq([m.state, m.basis], ['candidates', 'medium_only']);
  const w = one([item('b.txt', 'The maple trees along the lot.' + PAD, {}, 'other')]).d;
  eq([w.state, w.basis], ['candidates', 'weak_only']);
  const n = one([item('c.txt', 'INVOICE #441 Landscaping services' + PAD, {}, 'invoice')]).d;
  eq([n.state, n.basis, n.candidates.length], ['none', 'no_clue', 0]);
  const e = one([item('d.txt', '', {}, null)]).d;
  eq(e.state, 'none'); ok(e.notes.some(x => x.kind === 'no_text'));
});

t('with a single open prospect nothing is implicit: a question says so', () => {
  const d = one([item('a.txt', 'NOTICE TO TENANT' + PAD, { tenantName: 'Pine Dental PC' }, 'other')], [MAPLE]).d;
  eq(d.state, 'candidates'); ok(d.notes.some(n => n.kind === 'only_prospect'));
  ok(/One open prospect — nothing is assumed/.test(AA.explain(d, [], [MAPLE]).notes.join(' ')));
  const none = one([item('b.txt', 'INVOICE' + PAD, {}, 'invoice')], [MAPLE]).d;
  eq(none.state, 'none', 'one prospect does not make an invoice its own');
});

t('a shared tenant (a chain) is said, and lends no sibling clue', () => {
  const a = item('a.txt', lease(MAPLE, 'Harbor Cafe LLC'), { tenantName: 'Harbor Cafe LLC' }, 'original_lease');
  const b = item('b.txt', 'SIDE LETTER' + PAD, { tenantName: 'Harbor Cafe LLC' }, 'side_letter');
  const r = AA.recompute([a, b], ALL, deps);
  ok(r.decisions[b.itemId].notes.some(n => n.kind === 'shared_tenant'));
  eq(r.tallies[b.itemId].filter(x => x.clues.some(c => c.kind === 'batch_sibling')).length, 0, 'a chain tenant lent a sibling clue');
  eq(r.decisions[a.itemId].state, 'proposed', 'the lease with Maple\'s address is still proposed (the tenant is weak, the address is strong)');
});

sec('siblings in the batch, one hop');

t('a human assignment lends a medium sibling clue to another file for the same tenant — and the file stays a question', () => {
  const letter = item('letter.txt', 'SIDE LETTER regarding the holiday kiosk.' + PAD, { tenantName: 'Meadow Florist' }, 'side_letter', { assignment: { reviewIds: ['rev-oak'], by: 'human', at: 'now', fromProposal: false, proposedReviewId: null } });
  const notice = item('notice.txt', 'NOTICE TO TENANT: the lot will be resurfaced.' + PAD, { tenantName: 'Meadow Florist' }, 'other');
  const JUN = prof('rev-jun', 'Juniper Square', '22 Juniper Sq', ['Meadow Florist']);
  const r = AA.recompute([letter, notice], ALL.concat([JUN]), deps);
  const oakRow = rowFor(r.tallies[notice.itemId], 'rev-oak');
  const sibClue = oakRow.clues.find(c => c.kind === 'batch_sibling');
  ok(sibClue && sibClue.strength === 'medium' && sibClue.human === true && /you assigned to this prospect/.test(sibClue.source), JSON.stringify(oakRow.clues));
  eq(r.decisions[notice.itemId].state, 'candidates');
  ok(/also appears in letter\.txt, which you assigned to this prospect\./.test(AA.clueSentence(sibClue, ALL.concat([JUN]), 'rev-oak')));
});

t('a sibling\'s own strong text clue lends one hop and never chains', () => {
  const a = item('oak-lease.txt', lease(OAK, 'Summit Fitness LLC'), { tenantName: 'Summit Fitness LLC' }, 'original_lease');
  const b = item('b.txt', 'SIDE LETTER' + PAD, { tenantName: 'Summit Fitness LLC' }, 'side_letter');
  const c = item('c.txt', 'NOTICE' + PAD, { tenantName: 'Summit Fitness LLC' }, 'other');
  const r = AA.recompute([a, b, c], ALL, deps);
  const viaA = (id) => rowFor(r.tallies[id], 'rev-oak').clues.filter(x => x.kind === 'batch_sibling');
  eq(viaA(b.itemId).map(x => x.via), [a.itemId], 'b gets the clue from a only');
  eq(viaA(c.itemId).map(x => x.via), [a.itemId], 'c gets the clue from a only — not from b, which has no strong clue of its own');
  ok(/names this prospect in its text/.test(viaA(b.itemId)[0].source));
});

t('recompute never touches an assignment, skips left-out and removed files, and keys its answers by item', () => {
  const a = item('a.txt', lease(MAPLE, 'Pine Dental PC'), { tenantName: 'Pine Dental PC' }, 'original_lease', { assignment: { reviewIds: ['rev-cedar'], by: 'human', at: 'now', fromProposal: false, proposedReviewId: 'rev-maple' } });
  const before = JSON.stringify(a.assignment);
  const out = item('out.txt', lease(MAPLE, 'X'), {}, 'original_lease', { state: 'left_out' });
  const gone = item('gone.txt', lease(MAPLE, 'X'), {}, 'original_lease', { removed: true });
  const r = AA.recompute([a, out, gone], ALL, deps);
  eq(JSON.stringify(a.assignment), before, 'the assignment changed');
  eq(Object.keys(r.decisions), [a.itemId]);
  eq(r.decisions[a.itemId].state, 'proposed', 'what the evidence says is still computed beside the person\'s choice');
  const src = fs.readFileSync(path.join(ROOT, 'acquisition-assignment.js'), 'utf8');
  const body = src.slice(src.indexOf('function recompute('), src.indexOf('function assign('));
  ok(!/\.assignment\s*=[^=]/.test(body), 'recompute writes an assignment');
});

sec('a person\'s choice, validated');

t('assign records who, when, what was proposed and whether the person agreed', () => {
  const { d } = one([item('a.txt', lease(MAPLE, 'Pine Dental PC'), { tenantName: 'Pine Dental PC' }, 'original_lease')]);
  const yes = AA.assign(d, ['rev-maple'], ALL, '2026-10-08T00:00:00Z');
  eq(yes, { ok: true, assignment: { reviewIds: ['rev-maple'], by: 'human', at: '2026-10-08T00:00:00Z', fromProposal: true, proposedReviewId: 'rev-maple' } });
  const no = AA.assign(d, ['rev-cedar'], ALL, 'now');
  eq([no.ok, no.assignment.fromProposal, no.assignment.proposedReviewId], [true, false, 'rev-maple']);
});

t('assign refuses an unknown prospect, nothing, and several unless the decision allowed several — and then only the named', () => {
  const { d } = one([item('a.txt', lease(MAPLE, 'Pine Dental PC'), {}, 'original_lease')]);
  eq(AA.assign(d, ['rev-nope'], ALL, 'now').ok, false);
  eq(AA.assign(d, [], ALL, 'now').ok, false);
  const two = AA.assign(d, ['rev-maple', 'rev-cedar'], ALL, 'now');
  eq(two.ok, false); ok(/one property/.test(two.error), two.error);
  const sev = one([item('p.txt', `RENT ROLL\nMAPLE PLAZA - 120 Maple Ave, Springfield\nCEDAR COURT - 45 Cedar Ct, Springfield${PAD}`, {}, 'rent_roll')]).d;
  eq(AA.assign(sev, ['rev-maple', 'rev-cedar'], ALL, 'now').ok, true);
  const stranger = AA.assign(sev, ['rev-maple', 'rev-oak'], ALL, 'now');
  eq(stranger.ok, false); ok(/Only the properties this document names/.test(stranger.error));
  eq(AA.assign(null, ['rev-oak'], ALL, 'now').ok, true, 'one property may always be chosen, decision or none');
});

sec('the words');

t('explain: the headline per state, the proposal\'s reasons with page and snippet, the others with theirs or "no mention"', () => {
  const { d, ranked } = one([item('a.txt', lease(MAPLE, 'Harbor Cafe LLC'), { tenantName: 'Harbor Cafe LLC' }, 'original_lease')]);
  const x = AA.explain(d, ranked, ALL);
  eq(x.headline, 'Proposed: Maple Plaza');
  ok(/^Its address “120 Maple Ave, Springfield” appears \(“[^”]*120 Maple Ave[^”]*”\) — the address you gave\.$/.test(x.reasons[0]), x.reasons[0]);
  ok(/^“Maple Plaza” appears 2 times \(“/.test(x.reasons[1]), x.reasons[1]);
  ok(x.reasons.some(s => /Tenant read by AI as “Harbor Cafe LLC” — known here AND in another prospect \(a chain\), so weak$/.test(s)), x.reasons.join(' | '));
  const oak = x.others.find(o => o.reviewId === 'rev-oak');
  eq([oak.name, oak.strength, oak.reasons], ['Oak Ridge', 'none', ['no mention']]);
  const cedar = x.others.find(o => o.reviewId === 'rev-cedar');
  eq(cedar.strength, 'weak');
});

t('explain: a question names the candidates; several says so; none says so; the notes are sentences', () => {
  const q = AA.explain(one([item('a.txt', lease(MAPLE, 'Summit Fitness LLC'), { tenantName: 'Summit Fitness LLC' }, 'original_lease')]).d, [], ALL);
  eq(q.headline, 'Could belong to Maple Plaza or Oak Ridge — which is it?');
  const s = AA.explain(one([item('p.txt', `RENT ROLL\nMAPLE PLAZA - 120 Maple Ave, Springfield\nCEDAR COURT - 45 Cedar Ct, Springfield${PAD}`, {}, 'rent_roll')]).d, [], ALL);
  eq(s.headline, 'Names several properties — and may cover them');
  const n = AA.explain(one([item('i.txt', 'INVOICE' + PAD, {}, 'invoice')]).d, [], ALL);
  eq(n.headline, 'No property is named in this document.'); eq(n.reasons, []);
  const u = AA.explain(one([item('u.txt', 'Premises: 77 Birch Road, Springfield.' + PAD, { tenantName: 'Pine Dental PC' }, 'original_lease')]).d, [], ALL);
  ok(u.notes.some(x => x === 'Names an address not among your prospects: “77 Birch Road” — create a prospect for it?'), u.notes.join(' | '));
});

t('the sentences for the clue kinds and the notes the screen never invents', () => {
  const P = ALL;
  eq(AA.clueSentence({ kind: 'suite', matched: '110' }, P, 'rev-maple'), 'Suite 110 is a known suite of Maple Plaza — weak, only with another clue.');
  eq(AA.clueSentence({ kind: 'tenant_similar', matched: 'Northwind Books', source: 'the names only partly agree' }, P, 'rev-oak'), 'Tenant read by AI as similar to “Northwind Books”, not the same — the names only partly agree — weak, flagged.');
  eq(AA.clueSentence({ kind: 'tenant_known', matched: 'Summit Fitness LLC', source: 'already known to Oak Ridge' }, P, 'rev-oak'), 'Tenant read by AI as “Summit Fitness LLC” — already known to Oak Ridge.');
  eq(AA.clueSentence({ kind: 'roster', matched: 'A, B, C', count: 3, snippet: '“x”' }, P, 'rev-maple'), '3 known tenants are named in the text: A, B, C (“x”).');
  eq(AA.noteSentence({ kind: 'faint', reviewId: 'rev-cedar' }, P), 'Faint mention of Cedar Court.');
  eq(AA.noteSentence({ kind: 'generic_name', reviewId: 'rev-gen' }, [GENERIC]), '“Shopping Center” is a generic name — every word describes a kind of property — so the name alone cannot be matched; give it an address.');
  eq(AA.noteSentence({ kind: 'no_text' }, P), 'Nothing was read from this file, so nothing in it points anywhere.');
  eq(AA.noteSentence({ kind: 'several_mentions', basis: 'single_premises', type: 'original_lease', counts: [{ reviewId: 'rev-maple', mentions: 3 }, { reviewId: 'rev-cedar', mentions: 1 }] }, P), 'Names 2 properties, but an original lease covers one premises: Maple Plaza ×3, Cedar Court ×1.');
  eq(AA.noteSentence({ kind: 'several_mentions', basis: 'type_unset', type: null, counts: [{ reviewId: 'rev-maple', mentions: 1 }, { reviewId: 'rev-cedar', mentions: 1 }] }, P), 'Names 2 properties (Maple Plaza ×1, Cedar Court ×1) — say what the document is before it can go to several.');
});

sec('duplicates in the batch, and what the prospect already holds');

t('near-duplicates: the same type, date, tenant and length — a different tenant or length is a different document', () => {
  const base = lease(MAPLE, 'Pine Dental PC');
  const a = item('a.txt', base, { tenantName: 'Pine Dental PC', docDate: '2023-03-01' }, 'original_lease');
  const b = item('b.txt', base + ' ', { tenantName: 'Pine Dental', docDate: '2023-03-01' }, 'original_lease');
  const c = item('c.txt', base, { tenantName: 'Pine Dental PC', docDate: '2024-01-01' }, 'original_lease');
  const d = item('d.txt', base + PAD.repeat(3), { tenantName: 'Pine Dental PC', docDate: '2023-03-01' }, 'original_lease');
  const e = item('e.txt', base, { tenantName: 'Pine Dental PC', docDate: '2023-03-01' }, 'amendment');
  const f = item('f.txt', base, { tenantName: 'Coastal Outfitters Inc', docDate: '2023-03-01' }, 'original_lease');   // same type, date and length — a different tenant
  const pairs = AA.nearDuplicates([a, b, c, d, e, f], deps);
  eq(pairs.map(p => [p.a, p.b]), [[a.itemId, b.itemId]]);
  ok(/look like the same document/.test(pairs[0].text));
});

t('what the prospect already holds: the same file name will be superseded; the same document is named', () => {
  const p = AA.profileOf(review('r1', 'Maple Plaza', '120 Maple Ave', ['Harbor Cafe LLC']),
    [{ id: 'fam-1', tenant_name: 'Harbor Cafe' }],
    [{ id: 'd1', file_name: 'maple-plaza-lease.txt', doc_type: 'original_lease', doc_date: '2023-03-01', family_id: 'fam-1' },
     { id: 'd0', file_name: 'old.txt', doc_type: 'original_lease', doc_date: '2023-03-01', family_id: 'fam-1', superseded_by_document_id: 'd1' }], deps);
  const it = item('maple-plaza-lease.txt', lease(MAPLE, 'Harbor Cafe LLC'), { tenantName: 'Harbor Cafe LLC', docDate: '2023-03-01' }, 'original_lease');
  const c = AA.filedConflicts(it, p, deps);
  eq(c.map(x => x.kind), ['same_name', 'same_document']);
  ok(/^A file named maple-plaza-lease\.txt is already in Maple Plaza; filing will supersede it/.test(c[0].text), c[0].text);
  eq(c[1].text, 'An original lease for Harbor Cafe dated 2023-03-01 is already in Maple Plaza.');
  eq(AA.filedConflicts(item('other.txt', 'x', { tenantName: 'Nobody', docDate: '2023-03-01' }, 'original_lease'), p, deps), []);
});

t('tuning constants are the documented ones', () => {
  eq(AA.ROSTER_MIN, 3); eq(AA.BALANCE_RATIO, 1 / 3); eq(AA.WEIGHT, { strong: 3, medium: 2, weak: 1 });
  eq(Object.keys(AA.PORTFOLIO_TYPES).sort(), ['financial_statement', 'psa', 'rent_roll']);
  eq(AA.STATE, { PROPOSED: 'proposed', CANDIDATES: 'candidates', SEVERAL: 'several', NONE: 'none' });
});

console.log('\n' + '─'.repeat(64));
console.log(`RESULT: ${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILED:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);
