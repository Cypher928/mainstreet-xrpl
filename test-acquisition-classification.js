'use strict';
/**
 * test-acquisition-classification.js — Acquisition Review Phase 1, P1-3.
 *
 *   node test-acquisition-classification.js
 *
 * P1-2 preserved every source. P1-3 says what each source IS, which leasehold
 * it belongs to, and what it changed — and the whole increment turns on those
 * being PROPOSALS until a person confirms them. So most of this suite is about
 * the model declining to decide:
 *
 *   · an amendment with no lease on file proposes no family
 *   · two families naming the same tenant proposes neither
 *   · a document type nobody is sure of stays unknown and stays visible
 *   · a confirmation with nobody behind it is refused outright
 *
 * It drives acquisition-documents.js for real — the module the browser runs —
 * and reads migration 024, script.js and index.html as text (through code(),
 * which strips comments so a fix's own explanation cannot satisfy an
 * assertion).
 *
 * The browser half is test-e2e-acquisition-classification.js; the migration is
 * EXECUTED by tools/verify-migration-024.js.
 */
const fs   = require('fs');
const path = require('path');
const ROOT = __dirname;
const AD   = require('./acquisition-documents.js');

let pass = 0, fail = 0;
const failures = [];
function t(name, fn) {
  try { fn(); pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  catch (e) { fail++; failures.push(`${name}: ${e.message}`); console.log(`  \x1b[31m✗\x1b[0m ${name}\n      → ${e.message}`); }
}
const ok = (c, m) => { if (!c) throw new Error(m || 'expected truthy'); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m || ''} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
function sec(s) { console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 60 - s.length))); }
function code(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8')
    .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*|--)/.test(l)).join('\n');
}
function fnBody(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i === -1) throw new Error('function ' + name + ' not found');
  const j = src.indexOf('\n}\n', i);
  return src.slice(i, j === -1 ? undefined : j + 2);
}

const REVIEW = 'rev-0001', OWNER = 'user-0001';
const doc = (o) => Object.assign({ id: 'd' + Math.random().toString(36).slice(2, 7) }, o);

console.log('\n══ Acquisition classification, families and versions — P1-3 ══');

// ── the vocabulary ──────────────────────────────────────────────────────────
sec('the vocabulary is LeaseIntelligence’s, not a new one');

// If these drift, P1-4 has to write a second reasoner to match this table
// instead of feeding reasonMultiDocumentLease, which already does the work.
t('the four tiered types keep the tiers the reasoner already uses', () => {
  eq(AD.docTypeTier('side_letter'), 4);
  eq(AD.docTypeTier('estoppel'), 3);
  eq(AD.docTypeTier('amendment'), 2);
  eq(AD.docTypeTier('original_lease'), 1);
});

t('and lease-intelligence.js still holds exactly those numbers', () => {
  const li = code('lease-intelligence.js');
  const m = li.match(/DOC_TYPE_TIER\s*=\s*\{([^}]*)\}/);
  ok(m, 'DOC_TYPE_TIER not found in lease-intelligence.js');
  for (const [name, tier] of [['side_letter', 4], ['estoppel', 3], ['amendment', 2], ['original_lease', 1]]) {
    ok(new RegExp(name + '\\s*:\\s*' + tier).test(m[1]),
       `${name} is not ${tier} in lease-intelligence.js: ${m[1].trim()}`);
  }
});

t('the types that modify a lease rank together, above the lease itself', () => {
  for (const t2 of ['renewal', 'extension', 'assignment', 'guaranty']) {
    eq(AD.docTypeTier(t2), 2, t2);
    ok(AD.isFamilyType(t2), t2 + ' should belong to a leasehold');
  }
});

t('review-level documents belong to no leasehold and carry no tier', () => {
  for (const t2 of ['psa', 'rent_roll', 'financial_statement', 'invoice', 'other', 'unknown']) {
    eq(AD.docTypeTier(t2), 0, t2);
    ok(!AD.isFamilyType(t2), t2 + ' should not belong to a leasehold');
  }
});

t('every type the roadmap named is in the vocabulary', () => {
  for (const t2 of ['original_lease', 'amendment', 'renewal', 'extension', 'assignment',
                    'guaranty', 'side_letter', 'snda', 'estoppel', 'psa', 'rent_roll',
                    'financial_statement', 'invoice', 'other', 'unknown']) {
    ok(AD.DOC_TYPES[t2], 'missing: ' + t2);
  }
});

t('and migration 024 accepts exactly the same list', () => {
  const m = code('migrations/024_acquisition_document_classification.sql');
  const block = m.slice(m.indexOf('acq_docs_doc_type_check'), m.indexOf('acq_docs_doc_type_status_check'));
  for (const t2 of AD.DOC_TYPE_NAMES) ok(block.includes(`'${t2}'`), 'the migration rejects ' + t2);
});

// ── recognising a tenant ────────────────────────────────────────────────────
sec('recognising a tenant, without fuzzy matching');

t('case, punctuation and company form are not differences', () => {
  const want = 'coastal outfitters';
  for (const v of ['Coastal Outfitters', 'COASTAL OUTFITTERS, LLC', 'Coastal Outfitters Inc.',
                   'coastal  outfitters   corp', 'Coastal Outfitters, L.L.C.']) {
    eq(AD.normalizeParty(v), want, v);
  }
});

t('but a different tenant is a different tenant', () => {
  ok(AD.normalizeParty('Coastal Outfitters') !== AD.normalizeParty('Coastal Outfitters West'));
  ok(AD.normalizeParty('Harbor Cafe') !== AD.normalizeParty('Harbor Cafes'));
});

t('nothing in, nothing out', () => {
  eq(AD.normalizeParty(null), '');
  eq(AD.normalizeParty('   '), '');
  eq(AD.normalizeParty('LLC'), '');
});

// ── proposing a family ──────────────────────────────────────────────────────
sec('a family is proposed only when there is one answer');

const famCoastal = { id: 'fam-1', label: 'Coastal Outfitters', tenant_hint: 'Coastal Outfitters LLC' };

t('an original lease with no family yet begins one', () => {
  const r = AD.proposeFamily(doc({ doc_type: 'original_lease', tenant_hint: 'Harbor Cafe' }), []);
  eq(r.kind, 'new');
  eq(r.tenantHint, 'Harbor Cafe');
});

t('a document whose tenant matches exactly one family joins it', () => {
  const r = AD.proposeFamily(doc({ doc_type: 'amendment', tenant_hint: 'Coastal Outfitters, Inc.' }), [famCoastal]);
  eq(r.kind, 'existing');
  eq(r.familyId, 'fam-1');
});

// THE RULE THIS INCREMENT IS FOR.
t('an amendment with NO lease on file proposes nothing, and says why', () => {
  const r = AD.proposeFamily(doc({ doc_type: 'amendment', tenant_hint: 'Nobody In Particular' }), [famCoastal]);
  eq(r.kind, 'none');
  ok(/no lease on file/i.test(r.reason), r.reason);
});

t('two families naming the same tenant proposes NEITHER', () => {
  const r = AD.proposeFamily(doc({ doc_type: 'amendment', tenant_hint: 'Coastal Outfitters' }),
    [famCoastal, { id: 'fam-2', label: 'Coastal Outfitters (Suite 200)', tenant_hint: 'Coastal Outfitters' }]);
  eq(r.kind, 'none');
  ok(/more than one/i.test(r.reason), r.reason);
});

t('a document with no readable tenant proposes nothing', () => {
  eq(AD.proposeFamily(doc({ doc_type: 'amendment', tenant_hint: '' }), [famCoastal]).kind, 'none');
  eq(AD.proposeFamily(doc({ doc_type: 'amendment' }), [famCoastal]).kind, 'none');
});

t('an unknown type proposes nothing — there is nothing to reason from', () => {
  eq(AD.proposeFamily(doc({ doc_type: 'unknown', tenant_hint: 'Coastal Outfitters' }), [famCoastal]).kind, 'none');
  eq(AD.proposeFamily(doc({ tenant_hint: 'Coastal Outfitters' }), [famCoastal]).kind, 'none');
});

t('a rent roll or a PSA is never put in a leasehold', () => {
  for (const t2 of ['rent_roll', 'psa', 'financial_statement', 'invoice']) {
    const r = AD.proposeFamily(doc({ doc_type: t2, tenant_hint: 'Coastal Outfitters' }), [famCoastal]);
    eq(r.kind, 'none', t2);
    ok(/belongs to the review/i.test(r.reason), t2 + ': ' + r.reason);
  }
});

t('only an original lease may START a family — an amendment may not', () => {
  eq(AD.proposeFamily(doc({ doc_type: 'original_lease', tenant_hint: 'New Tenant' }), []).kind, 'new');
  for (const t2 of ['amendment', 'renewal', 'assignment', 'guaranty', 'estoppel']) {
    eq(AD.proposeFamily(doc({ doc_type: t2, tenant_hint: 'New Tenant' }), []).kind, 'none', t2);
  }
});

// ── proposing a relationship ────────────────────────────────────────────────
sec('what a document changed, proposed only when unambiguous');

const lease1 = { id: 'doc-lease-1', doc_type: 'original_lease' };
const lease2 = { id: 'doc-lease-2', doc_type: 'original_lease' };

t('each modifying type maps to what it actually does', () => {
  const cases = { amendment: 'amends', renewal: 'renews', extension: 'extends',
                  assignment: 'assigns', guaranty: 'guarantees', side_letter: 'supplements',
                  estoppel: 'certifies', snda: 'relates_to' };
  for (const [type, rel] of Object.entries(cases)) {
    const r = AD.proposeRelationship(doc({ doc_type: type }), [lease1]);
    eq(r.kind, 'proposed', type);
    eq(r.relationship, rel, type);
    eq(r.parentDocumentId, 'doc-lease-1', type);
  }
});

t('two leases in a family proposes no parent — that is a question for a person', () => {
  const r = AD.proposeRelationship(doc({ doc_type: 'amendment' }), [lease1, lease2]);
  eq(r.kind, 'none');
  ok(/more than one lease/i.test(r.reason), r.reason);
});

t('no lease in the family proposes no parent', () => {
  const r = AD.proposeRelationship(doc({ doc_type: 'amendment' }), [{ id: 'x', doc_type: 'estoppel' }]);
  eq(r.kind, 'none');
});

t('a superseded lease is not a parent to propose', () => {
  const stale = { id: 'doc-old', doc_type: 'original_lease', superseded_by_document_id: 'doc-lease-1' };
  eq(AD.proposeRelationship(doc({ doc_type: 'amendment' }), [stale]).kind, 'none');
  eq(AD.proposeRelationship(doc({ doc_type: 'amendment' }), [stale, lease1]).parentDocumentId, 'doc-lease-1');
});

t('an original lease is not proposed as amending anything', () => {
  eq(AD.proposeRelationship(doc({ doc_type: 'original_lease' }), [lease1]).kind, 'none');
  eq(AD.proposeRelationship(doc({ doc_type: 'rent_roll' }), [lease1]).kind, 'none');
});

t('a document is never proposed as its own parent', () => {
  const self = { id: 'doc-lease-1', doc_type: 'amendment' };
  eq(AD.proposeRelationship(self, [lease1]).kind, 'none');
});

// ── the write contract ──────────────────────────────────────────────────────
sec('a proposal may not become a fact with nobody behind it');

const base = { fileName: 'lease.pdf', intakeId: 'ik-1' };
const bp = (extra) => AD.buildPayload(REVIEW, OWNER, Object.assign({}, base, extra));

t('a confirmed type with no confirmer is refused', () => {
  const r = bp({ docType: 'amendment', docTypeStatus: 'confirmed' });
  ok(!r.ok && /who confirmed/i.test(r.error), JSON.stringify(r));
});

t('a corrected type with no confirmer is refused', () => {
  ok(!bp({ docType: 'renewal', docTypeStatus: 'corrected' }).ok);
});

t('a confirmed family with no confirmer is refused', () => {
  ok(!bp({ familyId: 'fam-1', familyStatus: 'confirmed' }).ok);
});

t('a confirmed relationship with no confirmer is refused', () => {
  ok(!bp({ parentDocumentId: 'doc-1', relationship: 'amends', relationshipStatus: 'confirmed' }).ok);
});

t('a PROPOSED reading needs no confirmer — that is the whole point', () => {
  const r = bp({ docType: 'amendment', docTypeStatus: 'proposed', docTypeSource: 'ai', docTypeConfidence: 0.8 });
  ok(r.ok, r.error);
  eq(r.payload.doc_type_status, 'proposed');
  eq(r.payload.doc_type_confidence, 0.8);
});

t('and a confirmation is accepted once it names somebody', () => {
  const r = bp({ docType: 'amendment', docTypeStatus: 'confirmed', confirmedBy: OWNER });
  ok(r.ok, r.error);
  eq(r.payload.confirmed_by, OWNER);
});

// Migration 024's trigger refuses this too. Both, deliberately: the database is
// what makes it true, and the module makes it a named error at the call site.
t('migration 024 refuses it in the database as well', () => {
  const m = code('migrations/024_acquisition_document_classification.sql');
  ok(/confirmed_by is null/.test(m), 'no trigger guard on confirmed_by');
  ok(/raise exception/.test(m), 'the guard does not refuse');
});

sec('what a write may set');

t('an unrecognised type becomes unknown, never something plausible', () => {
  eq(bp({ docType: 'memorandum_of_lease' }).payload.doc_type, 'unknown');
  eq(bp({ docType: 'lease' }).payload.doc_type, 'unknown');
});

t('but NULL stays null — unclassified is an ordinary state', () => {
  eq(bp({ docType: null }).payload.doc_type, null);
});

t('a confidence outside 0..1 is dropped rather than stored', () => {
  eq(bp({ docTypeConfidence: 1.5 }).payload.doc_type_confidence, null);
  eq(bp({ docTypeConfidence: -0.2 }).payload.doc_type_confidence, null);
  eq(bp({ docTypeConfidence: 'high' }).payload.doc_type_confidence, null);
  eq(bp({ docTypeConfidence: 0 }).payload.doc_type_confidence, 0);
});

t('a half-parsed date is dropped — a family is ordered by these', () => {
  eq(bp({ docDate: '2024-06-15' }).payload.doc_date, '2024-06-15');
  eq(bp({ docDate: 'June 2024' }).payload.doc_date, null);
  eq(bp({ docDate: '2024-13-45' }).payload.doc_date, null);
  eq(bp({ docDate: '' }).payload.doc_date, null);
});

t('a standing in no family is not stored — the row comes back unfiled', () => {
  const p = bp({ familyId: null, familyStatus: 'proposed', familySource: 'ai' }).payload;
  eq(p.family_status, 'unfiled');
  eq(p.family_source, null);
});

t('half a relationship is refused', () => {
  ok(!bp({ parentDocumentId: 'doc-1' }).ok);
  ok(!bp({ parentDocumentId: 'doc-1', relationship: 'amends' }).ok);
  ok(bp({ parentDocumentId: 'doc-1', relationship: 'amends', relationshipStatus: 'proposed' }).ok);
});

t('an unrecognised relationship is dropped, which then refuses the pair', () => {
  ok(!bp({ parentDocumentId: 'doc-1', relationship: 'replaces', relationshipStatus: 'proposed' }).ok);
});

t('clearing the parent clears what went with it', () => {
  const p = bp({ parentDocumentId: null, relationship: 'amends', relationshipStatus: 'proposed' }).payload;
  eq(p.relationship, null);
  eq(p.relationship_status, null);
});

// ── the audit trail ─────────────────────────────────────────────────────────
sec('the trail keeps both the reading and the correction');

t('an entry records what happened, to what, by whom', () => {
  const e = AD.classificationEntry({ action: 'proposed', field: 'doc_type', from: null, to: 'amendment',
    source: 'ai', model: 'claude', confidence: 0.9, evidence: 'FIRST AMENDMENT TO LEASE',
    actor: { uid: 'u1', email: 'pm@example.com' } });
  eq(e.action, 'proposed'); eq(e.field, 'doc_type'); eq(e.to, 'amendment');
  eq(e.source, 'ai'); eq(e.confidence, 0.9); eq(e.actor.uid, 'u1');
  ok(e.at, 'no timestamp');
});

t('a correction does not erase the reading it replaced', () => {
  let h = AD.appendHistory([], { action: 'proposed', field: 'doc_type', to: 'amendment', source: 'ai' });
  h = AD.appendHistory(h, { action: 'corrected', field: 'doc_type', from: 'amendment', to: 'renewal',
    source: 'human', actor: { uid: 'u1' } });
  eq(h.length, 2);
  eq(h[0].to, 'amendment');
  eq(h[1].from, 'amendment');
  eq(h[1].to, 'renewal');
});

t('an unrecognised action or field is named honestly, not invented', () => {
  const e = AD.classificationEntry({ action: 'decided', field: 'vibes' });
  eq(e.action, 'proposed');
  eq(e.field, 'doc_type');
});

t('the trail is bounded and keeps the RECENT end', () => {
  let h = [];
  for (let i = 0; i < AD.HISTORY_CAP + 25; i++) h = AD.appendHistory(h, { to: 'v' + i });
  eq(h.length, AD.HISTORY_CAP);
  eq(h[h.length - 1].to, 'v' + (AD.HISTORY_CAP + 24));
});

t('appending never mutates what it was given', () => {
  const before = [];
  AD.appendHistory(before, { to: 'x' });
  eq(before.length, 0);
});

// ── supersession (D-14) ─────────────────────────────────────────────────────
sec('D-14 — a re-upload keeps both sources');

const older = { id: 'doc-1', file_name: 'lease.pdf', intake_id: 'ik-1', created_at: '2026-01-01T00:00:00Z' };
const other = { id: 'doc-2', file_name: 'other.pdf', intake_id: 'ik-2', created_at: '2026-01-02T00:00:00Z' };

t('a new upload of a used name finds the document it replaces', () => {
  const found = AD.findSuperseded([older, other], 'lease.pdf', 'ik-3');
  ok(found && found.id === 'doc-1', JSON.stringify(found));
});

t('a new name replaces nothing', () => {
  eq(AD.findSuperseded([older, other], 'brand-new.pdf', 'ik-3'), null);
});

t('a row never supersedes itself — the second write of one upload is not a replacement', () => {
  eq(AD.findSuperseded([older], 'lease.pdf', 'ik-1'), null);
});

t('a THIRD upload replaces the second, not the first', () => {
  const second = { id: 'doc-3', file_name: 'lease.pdf', intake_id: 'ik-3', created_at: '2026-02-01T00:00:00Z' };
  const supersededFirst = Object.assign({}, older, { superseded_by_document_id: 'doc-3' });
  const found = AD.findSuperseded([supersededFirst, second], 'lease.pdf', 'ik-4');
  ok(found && found.id === 'doc-3', JSON.stringify(found));
});

// Found by tools/acquisition-classification-mutation.js (D10): the case above
// leaves only one CURRENT candidate, so it never exercises which of several a
// new upload should replace. Two current rows of one name is what a failed
// supersession write leaves behind — the marking is a second round trip and
// can be lost — and the newest is the one the next upload replaces. Reversing
// the sort has to make a test go red, and until this case existed it did not.
t('with two current rows of one name, the NEWEST is the one replaced', () => {
  const a = { id: 'doc-a', file_name: 'lease.pdf', intake_id: 'ik-a', created_at: '2026-01-01T00:00:00Z' };
  const b = { id: 'doc-b', file_name: 'lease.pdf', intake_id: 'ik-b', created_at: '2026-03-01T00:00:00Z' };
  eq(AD.findSuperseded([a, b], 'lease.pdf', 'ik-c').id, 'doc-b');
  eq(AD.findSuperseded([b, a], 'lease.pdf', 'ik-c').id, 'doc-b', 'the answer depends on input order');
});

t('an already-replaced document is not replaced again', () => {
  const stale = Object.assign({}, older, { superseded_by_document_id: 'doc-9' });
  eq(AD.findSuperseded([stale], 'lease.pdf', 'ik-3'), null);
});

t('isCurrent is the one predicate that separates them', () => {
  ok(AD.isCurrent(older));
  ok(!AD.isCurrent({ superseded_by_document_id: 'x' }));
});

// ── reading the pile back ───────────────────────────────────────────────────
sec('ordering inside a family follows tier, then date');

t('tier first, newest first inside a tier — the reasoner’s own rule', () => {
  const rows = [
    { id: 'a', doc_type: 'original_lease', doc_date: '2020-01-01' },
    { id: 'b', doc_type: 'amendment',      doc_date: '2022-01-01' },
    { id: 'c', doc_type: 'amendment',      doc_date: '2023-01-01' },
    { id: 'd', doc_type: 'side_letter',    doc_date: '2021-01-01' },
  ];
  eq(AD.orderWithinFamily(rows).map(r => r.id).join(''), 'dcba');
});

t('a replaced upload sorts last whatever its type', () => {
  const rows = [
    { id: 'a', doc_type: 'side_letter', doc_date: '2024-01-01', superseded_by_document_id: 'z' },
    { id: 'b', doc_type: 'original_lease', doc_date: '2020-01-01' },
  ];
  eq(AD.orderWithinFamily(rows).map(r => r.id).join(''), 'ba');
});

t('ordering does not mutate its input', () => {
  const rows = [{ id: 'a', doc_type: 'amendment' }, { id: 'b', doc_type: 'side_letter' }];
  AD.orderWithinFamily(rows);
  eq(rows[0].id, 'a');
});

sec('the panel, as data');

const families = [{ id: 'fam-1', label: 'Coastal Outfitters' }];
const pile = [
  { id: 'd1', doc_type: 'original_lease', family_id: 'fam-1', doc_date: '2020-01-01' },
  { id: 'd2', doc_type: 'amendment',      family_id: 'fam-1', doc_date: '2022-01-01', family_status: 'proposed' },
  { id: 'd3', doc_type: 'rent_roll' },
  { id: 'd4', doc_type: 'unknown' },
  { id: 'd5', doc_type: 'amendment' },                       // a family type, unfiled
  { id: 'd6', doc_type: 'original_lease', family_id: 'fam-1', superseded_by_document_id: 'd1' },
];
const g = AD.groupDocuments(pile, families);

t('what nobody has placed is its own group', () => {
  eq(g.needsReview.map(r => r.id).sort().join(''), 'd4d5');
});

t('a leasehold’s documents are grouped under it, in governing order', () => {
  eq(g.families.length, 1);
  eq(g.families[0].documents.map(r => r.id).join(''), 'd2d1d6');
});

t('the group says how many are unconfirmed and how many were replaced', () => {
  eq(g.families[0].counts.total, 3);
  eq(g.families[0].counts.proposed, 1);
  eq(g.families[0].counts.superseded, 1);
  eq(g.families[0].counts.current, 2);
});

t('review-level documents are not put in a leasehold', () => {
  eq(g.reviewLevel.map(r => r.id).join(''), 'd3');
});

t('every document appears exactly once', () => {
  const seen = [].concat(g.needsReview, g.reviewLevel, ...g.families.map(f => f.documents)).map(r => r.id);
  eq(seen.length, pile.length, seen.join(','));
  eq(new Set(seen).size, pile.length);
});

t('a document filed into a family that is gone is shown, not dropped', () => {
  const orphan = AD.groupDocuments([{ id: 'x', doc_type: 'amendment', family_id: 'fam-missing' }], []);
  eq(orphan.needsReview.map(r => r.id).join(''), 'x');
  eq(orphan.families.length, 0);
});

t('an empty family is not rendered as a heading with nothing under it', () => {
  eq(AD.groupDocuments([], [{ id: 'fam-1', label: 'Empty' }]).families.length, 0);
});

sec('a reading always says how settled it is');

t('an unclassified document says so', () => {
  const d = AD.describeClassification({});
  eq(d.label, 'Unclassified'); eq(d.verified, false);
});

t('a proposal is labelled a proposal', () => {
  const d = AD.describeClassification({ doc_type: 'amendment', doc_type_status: 'proposed' });
  eq(d.label, 'Amendment'); eq(d.verified, false);
  ok(/not confirmed/i.test(d.note), d.note);
});

t('only a person’s act reads as verified', () => {
  ok(AD.describeClassification({ doc_type: 'amendment', doc_type_status: 'confirmed' }).verified);
  ok(AD.describeClassification({ doc_type: 'renewal', doc_type_status: 'corrected' }).verified);
  ok(!AD.describeClassification({ doc_type: 'amendment', doc_type_status: 'proposed' }).verified);
  ok(!AD.describeClassification({ doc_type: 'amendment' }).verified);
});

// ── shipping before the migration ───────────────────────────────────────────
// The code and the schema do not land at the same instant. Between a deploy
// and a migration the table is there and the P1-3 columns are not, and the
// product has to say which file is missing — 023 is already applied, so naming
// it sends an operator to a migration they have run.
sec('a column that is not there names 024, not 023');

const COL_GONE = { code: '42703', message: 'column "intake_id" of relation "acquisition_documents" does not exist' };
const TBL_GONE = { code: '42P01', message: 'relation "public.acquisition_documents" does not exist' };

t('a missing column is recognised as a missing column', () => {
  ok(AD.isMissingColumn(COL_GONE));
  ok(AD.isMissingColumn({ message: 'column "doc_type" does not exist' }));
  ok(!AD.isMissingColumn(TBL_GONE));
  ok(!AD.isMissingColumn({ code: '23503' }) && !AD.isMissingColumn(null));
});

t('and is NOT mistaken for a missing table, despite saying "does not exist"', () => {
  ok(!AD.isMissingTable(COL_GONE), 'a missing column read as a missing table');
  ok(AD.isMissingTable(TBL_GONE), 'a missing table stopped being recognised');
});

t('both are a schema gap the product must report', () => {
  ok(AD.schemaGap(COL_GONE) && AD.schemaGap(TBL_GONE));
  ok(!AD.schemaGap({ code: '23505' }) && !AD.schemaGap(null));
});

t('a missing COLUMN names migration 024', () => {
  ok(/024_acquisition_document_classification\.sql/.test(AD.migrationForError(COL_GONE, 'acquisition_documents')),
     AD.migrationForError(COL_GONE, 'acquisition_documents'));
  ok(!/023/.test(AD.migrationForError(COL_GONE, 'acquisition_documents')));
});

t('a missing TABLE still names the migration that creates it', () => {
  ok(/023_acquisition_documents\.sql/.test(AD.migrationForError(TBL_GONE, 'acquisition_documents')));
  ok(/006_acquisition_reviews\.sql/.test(AD.migrationForError(TBL_GONE, 'acquisition_reviews')));
  ok(/024_acquisition_document_classification\.sql/.test(
     AD.migrationForError(TBL_GONE, 'acquisition_document_families')));
});

t('the panel names whichever migration is missing rather than a fixed one', () => {
  const S2 = code('script.js');
  const r = fnBody(S2, '_renderAcqDocuments');
  ok(/_acqSchemaGapFile/.test(r), 'the panel hard-codes one migration name');
  const m = fnBody(S2, '_acqDocsMissing');
  ok(/migrationForError\(error, table\)/.test(m), 'the file is not decided from the error');
});

// ── the classification task ─────────────────────────────────────────────────
sec('the classifier is server-owned and classifies only');

const TASKS = require('./api/_claude-tasks.js');

t('document_classification is a registered task with its own ceiling', () => {
  const task = TASKS.CLAUDE_TASKS.document_classification;
  ok(task, 'not registered');
  ok(Number.isFinite(task.maxTokens) && task.maxTokens > 0 && task.maxTokens <= 600, task && task.maxTokens);
});

t('it carries the untrusted-document boundary like every other task', () => {
  ok(/never an instruction/i.test(TASKS.CLAUDE_TASKS.document_classification.system));
});

t('its list is the module’s list — no third vocabulary', () => {
  const sys = TASKS.CLAUDE_TASKS.document_classification.system;
  for (const n of AD.DOC_TYPE_NAMES) ok(sys.includes(n), 'the prompt never offers ' + n);
});

// The most important line in the prompt.
t('it is told to answer unknown rather than pick the closest match', () => {
  const sys = TASKS.CLAUDE_TASKS.document_classification.system;
  ok(/not confident/i.test(sys) && /unknown/.test(sys), 'no instruction to decline');
  ok(/do not pick the closest match/i.test(sys), 'nothing forbids guessing');
});

t('it does not extract lease terms — that contract is not touched', () => {
  const sys = TASKS.CLAUDE_TASKS.document_classification.system;
  ok(!/cam_cap|pro_rata|audit_rights|expense_stop/.test(sys), 'the classifier reads terms');
  const lease = TASKS.CLAUDE_TASKS.lease_extraction.system;
  ok(/"tenant_name"/.test(lease) && /"cam_cap"/.test(lease), 'lease_extraction changed');
});

t('no serverless function was added for any of this', () => {
  const fns = fs.readdirSync(path.join(ROOT, 'api')).filter(f => /\.js$/.test(f) && !f.startsWith('_'));
  ok(fns.length <= 12, fns.length + ': ' + fns.join(', '));
  ok(!fs.existsSync(path.join(ROOT, 'api/acquisition-classification.js')));
  ok(!fs.existsSync(path.join(ROOT, 'api/acquisition-families.js')));
});

// ── the data layer ──────────────────────────────────────────────────────────
sec('the data layer keeps P1-2’s storage flow and RLS pattern');

{
  const S = code('script.js');

  t('families are read and written through the authenticated client', () => {
    const load = fnBody(S, '_acqLoadFamilies');
    ok(/db\s*\n?\s*\.from\('acquisition_document_families'\)/.test(load), 'not the db client');
    ok(/\.eq\('user_id', user\.id\)/.test(load), 'not scoped to the signed-in user');
    ok(!/fetch\(/.test(load), 'it goes through an endpoint');
  });

  t('a re-upload marks its predecessor instead of replacing it', () => {
    const f = fnBody(S, '_acqSupersedePrevious');
    ok(/findSuperseded/.test(f), 'it does not look for the earlier upload');
    ok(/superseded_by_document_id/.test(f), 'it does not mark anything');
    ok(!/\.delete\(/.test(f), 'it deletes a source');
  });

  t('nothing anywhere deletes an acquisition document', () => {
    ok(!/from\('acquisition_documents'\)\s*\n?\s*\.delete\(/.test(S), 'a delete path exists');
    ok(!/from\('acquisition_document_families'\)\s*\n?\s*\.delete\(/.test(S), 'a family delete path exists');
  });

  t('the intake mints one identity per file and reuses it for that upload', () => {
    const lease = fnBody(S, 'acqHandleLeaseFiles');
    ok(/const intakeId = _acqMintIntakeId\(\)/.test(lease), 'no identity is minted');
    eq((lease.match(/intakeId,/g) || []).length >= 3, true, 'the identity is not reused by every write');
  });

  t('classification runs AFTER the source is safe, and never gates it', () => {
    const lease = fnBody(S, 'acqHandleLeaseFiles');
    const saveAt = lease.indexOf('const saved = await _acqSaveDocument');
    const classAt = lease.indexOf('_acqClassifyDocument');
    ok(saveAt > -1 && classAt > saveAt, 'classification does not follow the save');
    const c = fnBody(S, '_acqClassifyDocument');
    ok(/catch/.test(c) && /return null/.test(c), 'a failed classification is not survivable');
  });

  t('it classifies from the text already stored — nothing is re-read', () => {
    const c = fnBody(S, '_acqClassifyDocument');
    ok(!/_acqStoreOriginal|\/api\/upload|extractLeaseText/.test(c), 'it re-reads the original');
    ok(/document_classification/.test(c), 'it does not use the server-owned task');
  });

  t('a confirmation always names who made it', () => {
    for (const fn of ['acqConfirmDocType', 'acqSetDocType']) {
      const b = fnBody(S, fn);
      ok(/confirmedBy: user\.id/.test(b), fn + ' does not name the confirmer');
      ok(/db\.auth\.getUser\(\)/.test(b), fn + ' never asks who is signed in');
    }
  });

  t('AI never writes a confirmed status', () => {
    const b = fnBody(S, '_acqApplyClassification');
    ok(!/'confirmed'/.test(b), 'the AI path writes a confirmation');
    ok(/'proposed'/.test(b), 'the AI path does not mark its work as a proposal');
  });

  t('a replacement inherits where its predecessor was filed, but not the confirmation', () => {
    const b = fnBody(S, '_acqApplyClassification');
    ok(/familySource = opts\.inheritedFamily \? 'inherited'/.test(b), 'inheritance is not recorded');
    ok(/familyStatus = 'proposed'/.test(b), 'an inherited filing is not re-proposed');
  });
}

{
  const H = code('index.html');
  t('the panel shows an unconfirmed reading as unconfirmed', () => {
    ok(/\.acq-doc-unconf\s*\{/.test(H), 'no style for an unconfirmed reading');
    ok(/\.acq-doc-class\.proposed\s*\{/.test(H) && /\.acq-doc-class\.confirmed\s*\{/.test(H),
       'a proposal and a confirmation look the same');
  });
  t('a replaced upload is still shown, marked', () => {
    ok(/\.acq-doc-row\.superseded\s*\{/.test(H) && /\.acq-doc-superseded\s*\{/.test(H));
  });
  t('the needs-review group is styled as the thing to act on', () => {
    ok(/\.acq-doc-group\.needs-review/.test(H));
  });
}

console.log('\n' + '─'.repeat(64));
console.log(`RESULT: ${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILED:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);
