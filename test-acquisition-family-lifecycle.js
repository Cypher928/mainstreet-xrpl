// test-acquisition-family-lifecycle.js
// ============================================================================
// Acquisition Review P4-3 remediation, Issue B — a leasehold can begin.
//
// THE FAILURE THIS SUITE EXISTS FOR
//
// The Pilot held three correctly classified lease documents and ZERO
// leaseholds, and the Lease Terms panel rendered its empty message because a
// family is what it iterates over. Neither door was open:
//
//   · proposeFamily may only START a leasehold from an `original_lease` —
//     correct, and not changed by any of this;
//   · acqSetDocType, the path a PERSON takes, ran no family step at all.
//
// So the review was stuck: no document in it was an original lease, and
// correcting one by hand would not have helped.
//
// WHAT IS PROVED HERE
//
//   1  proposeFamily is untouched, branch for branch
//   2  a tenant is read from evidence already on the row, and NEVER invented
//   3  correcting to `original_lease` begins the leasehold — confirmed, human
//   4  correcting to any other lease type files into a MATCHING leasehold as a
//      PROPOSAL, never confirmed
//   5  with no match, nothing is written and the reason says so; `canBegin`
//      marks the one case a person may settle
//   6  "this begins the leasehold" is reachable only with an explicit flag
//   7  unfiled same-tenant relatives are OFFERED, never taken, and never in
//      bulk
//   8  D-17 is preserved exactly, and the two branches cannot both run
//   9  the glue: acqSetDocType runs the step, records provenance and never
//      rewrites history; the panel names the reason and says what the control
//      does and does not mean
//
// Run: node test-acquisition-family-lifecycle.js
// ============================================================================
'use strict';
const fs   = require('fs');
const path = require('path');

const ROOT = __dirname;
const AD = require('./acquisition-documents.js');

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}${detail ? '  — ' + detail : ''}`); }
  else    { fail++; failures.push(name + (detail ? ': ' + detail : '')); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? '  — ' + detail : ''}`); }
}
function section(s) { console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 62 - s.length))); }

const S    = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/** A document carrying P4-1 evidence, the only place a tenant may be read from. */
const doc = (o) => ({
  id: o.id, intake_id: 'ik-' + o.id, file_name: (o.id) + '.pdf',
  doc_type: o.type, doc_type_status: o.status || 'proposed',
  family_id: o.familyId || null,
  superseded_by_document_id: o.superseded || null,
  classification_history: o.history || [],
  abstracted_fields: (o.tenant || o.suite)
    ? { fields: { tenant_name: { value: o.tenant || null }, suite: { value: o.suite || null } } }
    : undefined,
});
const fam = (id, label) => ({ id, label, tenant_hint: label });

const SHOPRITE = 'ShopRite Supermarkets, Inc.';

console.log('\n══ acquisition — the leasehold lifecycle ══');

// ── 1 · the AI path is untouched ───────────────────────────────────────────
section('1 · proposeFamily is not changed');
{
  const amendment = doc({ id: 'a', type: 'amendment' });
  amendment.tenant_hint = SHOPRITE;
  const lease = doc({ id: 'l', type: 'original_lease' });
  lease.tenant_hint = SHOPRITE;

  check('an amendment with no lease on file is still declined by the AI',
    AD.proposeFamily(amendment, []).kind === 'none');
  check('and the decline still carries no `canBegin` — the AI may not offer it',
    AD.proposeFamily(amendment, []).canBegin === undefined);
  check('an original lease still begins a leasehold on the AI path',
    AD.proposeFamily(lease, []).kind === 'new');
  check('a single tenant match is still `existing`',
    AD.proposeFamily(amendment, [fam('f1', SHOPRITE)]).kind === 'existing');
  check('two matches are still a question for a person',
    AD.proposeFamily(amendment, [fam('f1', SHOPRITE), fam('f2', 'ShopRite Supermarkets LLC')]).kind === 'none');
  check('a rent roll still belongs to the review',
    AD.proposeFamily(doc({ id: 'r', type: 'rent_roll' }), []).kind === 'none');
  check('proposeFamily still reads ONLY tenant_hint, not evidence — the AI path is unchanged',
    AD.proposeFamily(doc({ id: 'x', type: 'original_lease', tenant: SHOPRITE }), []).kind === 'none',
    'no tenant_hint, so it declines exactly as before');
}

// ── 2 · a tenant is read, never invented ───────────────────────────────────
section('2 · the tenant comes from evidence on the row, or from nowhere');
{
  check('read from P4-1 evidence',
    AD.tenantHintFor(doc({ id: 'a', type: 'amendment', tenant: SHOPRITE })) === SHOPRITE);
  check('a caller-held hint is the fallback',
    AD.tenantHintFor({ tenant_hint: SHOPRITE }) === SHOPRITE);
  check('evidence outranks the hint',
    AD.tenantHintFor({ tenant_hint: 'Wrong Co', ...doc({ id: 'a', type: 'amendment', tenant: SHOPRITE }) }) === SHOPRITE);
  check('a document with neither reads null — not the file name',
    AD.tenantHintFor({ file_name: 'ShopRite_Anchor_Tenant_Lease.pdf' }) === null);
  check('a null evidence value is null, not the string "null"',
    AD.tenantHintFor({ abstracted_fields: { fields: { tenant_name: { value: null } } } }) === null);
  check('nothing at all is null', AD.tenantHintFor(null) === null && AD.tenantHintFor(undefined) === null);
  check('the suite is read the same way',
    AD.suiteHintFor(doc({ id: 'a', type: 'amendment', tenant: SHOPRITE, suite: 'Anchor Unit A-1' })) === 'Anchor Unit A-1');
  check('and is null when unread — a leasehold with no suite says so',
    AD.suiteHintFor(doc({ id: 'a', type: 'amendment', tenant: SHOPRITE })) === null);
}

// ── 3 · a person calls it the original lease ───────────────────────────────
section('3 · correcting to original_lease begins the leasehold');
{
  const v = AD.familyForCorrection(
    doc({ id: 'l', type: 'original_lease', tenant: SHOPRITE, suite: 'Anchor Unit A-1' }), []);
  check('it is a NEW leasehold', v.kind === 'new');
  check('confirmed, by a human — a person said it', v.status === 'confirmed' && v.source === 'human');
  check('labelled and hinted with the tenant the document names',
    v.label === SHOPRITE && v.tenantHint === SHOPRITE);
  check('carrying the suite when the document establishes one', v.suiteHint === 'Anchor Unit A-1');
  check('and it says why, in words a person can read', /original lease/.test(v.reason), v.reason);
  check('the payload it implies is accepted by buildFamilyPayload',
    AD.buildFamilyPayload('r1', 'u1', { label: v.label, tenantHint: v.tenantHint,
                                        suiteHint: v.suiteHint, familyKind: 'lease' }).ok);
  check('WITHOUT a tenant it refuses, even for an original lease',
    AD.familyForCorrection(doc({ id: 'l2', type: 'original_lease' }), []).kind === 'none');
  check('and says a tenant is what is missing',
    /No tenant has been read/.test(AD.familyForCorrection(doc({ id: 'l2', type: 'original_lease' }), []).reason));
}

// ── 4 · a match is a proposal, not a conclusion ────────────────────────────
section('4 · filing into a leasehold that already exists');
{
  for (const type of ['renewal', 'amendment', 'extension', 'assignment', 'guaranty', 'side_letter', 'snda', 'estoppel']) {
    const v = AD.familyForCorrection(doc({ id: 'x', type, tenant: SHOPRITE }), [fam('f1', SHOPRITE)]);
    check(`a ${type} matching one leasehold is PROPOSED there`,
      v.kind === 'existing' && v.familyId === 'f1' && v.status === 'proposed' && v.source === 'ai',
      `${v.kind}/${v.status}/${v.source}`);
  }
  check('NEVER confirmed — the person said what it IS, not where it belongs',
    AD.familyForCorrection(doc({ id: 'x', type: 'amendment', tenant: SHOPRITE }), [fam('f1', SHOPRITE)]).status !== 'confirmed');
  check('the source is `ai` because a tenant-name match is a machine reading it',
    AD.familyForCorrection(doc({ id: 'x', type: 'amendment', tenant: SHOPRITE }), [fam('f1', SHOPRITE)]).source === 'ai');
  check('a legal-suffix difference is not a difference',
    AD.familyForCorrection(doc({ id: 'x', type: 'amendment', tenant: 'SHOPRITE SUPERMARKETS LLC' }),
                           [fam('f1', SHOPRITE)]).kind === 'existing');
  check('a different tenant is a different leasehold',
    AD.familyForCorrection(doc({ id: 'x', type: 'amendment', tenant: 'Prime Wellness Spa' }),
                           [fam('f1', SHOPRITE)]).kind !== 'existing');
  const two = AD.familyForCorrection(doc({ id: 'x', type: 'amendment', tenant: SHOPRITE }),
                                     [fam('f1', SHOPRITE), fam('f2', 'ShopRite Supermarkets LLC')]);
  check('two leaseholds naming the tenant is a question, not a coin toss', two.kind === 'none');
  check('and it is NOT offered to a person as a new leasehold — that would hide the ambiguity',
    two.canBegin === undefined, JSON.stringify(two.canBegin));
}

// ── 5 · no match: nothing is invented ──────────────────────────────────────
section('5 · with no leasehold on file, MainStreet declines and says so');
{
  const v = AD.familyForCorrection(doc({ id: 'a', type: 'amendment', tenant: SHOPRITE }), []);
  check('the answer is `none` — no family id, no label, nothing written',
    v.kind === 'none' && v.familyId === undefined && v.label === undefined);
  check('the reason names the document type and what is unknown',
    /no lease on file for this tenant/.test(v.reason) && /amendment/.test(v.reason), v.reason);
  check('and `canBegin` marks it as the one case a person may settle', v.canBegin === true);
  check('an unclassified document offers nothing',
    AD.familyForCorrection(doc({ id: 'u', type: null, tenant: SHOPRITE }), []).canBegin === undefined);
  check('nor does a document with no tenant read',
    AD.familyForCorrection(doc({ id: 'n', type: 'amendment' }), []).canBegin === undefined);
  check('nor does a rent roll',
    AD.familyForCorrection(doc({ id: 'r', type: 'rent_roll', tenant: SHOPRITE }), []).canBegin === undefined);
}

// ── 6 · the human act ──────────────────────────────────────────────────────
section('6 · "this begins the leasehold" needs the explicit flag');
{
  const d = doc({ id: 'a', type: 'amendment', tenant: SHOPRITE });
  check('without the flag it stays a decline', AD.familyForCorrection(d, []).kind === 'none');
  const v = AD.familyForCorrection(d, [], { beginLeasehold: true });
  check('with it, a leasehold begins', v.kind === 'new');
  check('confirmed, by a human', v.status === 'confirmed' && v.source === 'human');
  check('and the reason says a PERSON used the document — not that we decided it is the lease',
    /A person used this document to begin the leasehold/.test(v.reason), v.reason);
  check('it does NOT claim the document is an original lease',
    !/original lease/.test(v.reason), v.reason);
  check('the flag cannot conjure a tenant',
    AD.familyForCorrection(doc({ id: 'n', type: 'amendment' }), [], { beginLeasehold: true }).kind === 'none');
  check('the flag cannot file a rent roll into a leasehold',
    AD.familyForCorrection(doc({ id: 'r', type: 'rent_roll', tenant: SHOPRITE }), [], { beginLeasehold: true }).kind === 'none');
  check('the flag does not override an existing match — that is still a proposal',
    AD.familyForCorrection(d, [fam('f1', SHOPRITE)], { beginLeasehold: true }).kind === 'existing');
  check('a falsy flag is not the flag',
    AD.familyForCorrection(d, [], { beginLeasehold: 'yes' }).kind === 'none');
}

// ── 7 · relatives are offered, never taken ─────────────────────────────────
section('7 · unfiled same-tenant documents');
{
  const anchor = doc({ id: 'anchor', type: 'renewal', tenant: SHOPRITE });
  const pool = [
    anchor,
    doc({ id: 'amd',     type: 'amendment', tenant: 'SHOPRITE SUPERMARKETS LLC' }),
    doc({ id: 'other',   type: 'amendment', tenant: 'Prime Wellness Spa' }),
    doc({ id: 'rr',      type: 'rent_roll', tenant: SHOPRITE }),
    doc({ id: 'filed',   type: 'amendment', tenant: SHOPRITE, familyId: 'f9' }),
    doc({ id: 'old',     type: 'amendment', tenant: SHOPRITE, superseded: 'amd' }),
    doc({ id: 'notenant', type: 'amendment' }),
  ];
  const sibs = AD.unfiledSiblings(anchor, pool).map(r => r.id);
  check('a same-tenant unfiled lease document is offered', sibs.includes('amd'));
  check('a different tenant is not', !sibs.includes('other'));
  check('a rent roll is not — it belongs to the review', !sibs.includes('rr'));
  check('one already filed is not — nothing is re-filed', !sibs.includes('filed'));
  check('a superseded upload is not', !sibs.includes('old'));
  check('one with no tenant read is not — that is a guess', !sibs.includes('notenant'));
  check('and never the anchor itself', !sibs.includes('anchor'));
  check('exactly one document is offered here', sibs.length === 1, sibs.join(',') || '(none)');
  check('an anchor with no tenant offers nothing at all',
    AD.unfiledSiblings(doc({ id: 'z', type: 'renewal' }), pool).length === 0);
  check('garbage in is an empty list, not a throw',
    AD.unfiledSiblings(null, null).length === 0 && AD.unfiledSiblings(anchor, 'nope').length === 0);
}

// ── 8 · D-17 ───────────────────────────────────────────────────────────────
section('8 · D-17 is preserved, and the two branches are exclusive');
{
  const setDocType = S.slice(S.indexOf('async function acqSetDocType('),
                             S.indexOf('async function _loadAcqReviews('));
  check('correcting OUT still clears the family',
    /if \(!AD\.isFamilyType\(nextType\) && row\.family_id\) \{[\s\S]{0,200}fields\.familyId = null; fields\.familyStatus = 'unfiled'; fields\.familySource = null;/.test(setDocType));
  check('correcting OUT still PRESERVES the parent and the relationship',
    /fields\.parentDocumentId\s*=\s*row\.parent_document_id;\s*\n\s*fields\.relationship\s*=\s*row\.relationship;/.test(setDocType));
  check('and still flags it needs_review with its own history entry',
    /fields\.relationshipStatus = 'needs_review';/.test(setDocType)
    && /action: 'needs_review', field: 'relationship'/.test(setDocType));
  check('correcting INTO a lease type now runs the family step',
    /if \(AD\.isFamilyType\(nextType\) && !row\.family_id\) \{\s*\n\s*familyStep = await _acqFamilyForHuman\(reviewId, row, nextType\);/.test(setDocType));
  // Cross-review isolation: the review is the one captured before any await,
  // never whichever review is open when the await returns.
  check('…in the review captured before the first await, not the one open afterwards',
    setDocType.indexOf('const reviewId = _activeAcqId;') >= 0
    && setDocType.indexOf('const reviewId = _activeAcqId;') < setDocType.indexOf('await ')
    && !/_activeAcqId/.test(setDocType.slice(setDocType.indexOf('await '))));
  check('the two branches test opposite conditions — they cannot both run',
    setDocType.includes('if (AD.isFamilyType(nextType) && !row.family_id) {')
    && setDocType.includes('if (!AD.isFamilyType(nextType) && row.family_id) {'));
  check('the IN branch runs only for a document not already filed',
    /isFamilyType\(nextType\) && !row\.family_id/.test(setDocType));
  check('a decline writes nothing — the patch is applied only when there is one',
    /if \(familyStep\.patch\) \{/.test(setDocType));
  check('the family step never touches doc_type', !/familyStep[\s\S]{0,400}fields\.docType/.test(setDocType));
  check('D-17 still admits needs_review in the module', AD.REL_STATUSES.includes('needs_review'));
}

// ── 9 · the glue and the screen ────────────────────────────────────────────
section('9 · provenance, and what the screen says');
{
  check('an existing match is recorded as `proposed` by `ai`',
    /familyStatus: 'proposed', familySource: 'ai',\s*\n\s*historyEntry: \{ action: 'proposed', field: 'family'/.test(S));
  check('a new leasehold is recorded as `confirmed` by `human`, with the actor',
    /familyStatus: 'confirmed', familySource: 'human',\s*\n\s*historyEntry: \{ action: 'confirmed', field: 'family'[\s\S]{0,120}actor: _acqActor\(\)/.test(S));
  check('history is APPENDED, never rewritten — every write goes through appendHistory',
    (S.match(/AD\.appendHistory\([\s\S]{0,40}action: 'proposed', field: 'family'/g) || []).length >= 1
    && !/classificationHistory:\s*\[\s*\{/.test(S));
  check("the action word is one classificationEntry allows — `confirmed`, not a new word",
    AD.classificationEntry({ action: 'confirmed', field: 'family', to: 'f1', source: 'human' }).action === 'confirmed');
  check('and a word it does NOT allow would be coerced — which is why none was invented',
    AD.classificationEntry({ action: 'filed', field: 'family', to: 'f1', source: 'human' }).action === 'proposed');
  check('siblings are proposed one row at a time, each with its own history',
    /async function _acqProposeSiblings\([\s\S]{0,900}for \(const s of sibs\) \{[\s\S]{0,400}classificationHistory: AD\.appendHistory\(s\.classification_history,/.test(S));
  check('siblings are never confirmed in bulk',
    !/unfiledSiblings[\s\S]{0,900}familyStatus: 'confirmed'/.test(S));
  check('the begin control writes confirmed_by — 024 refuses a settled status naming nobody',
    /async function acqBeginLeasehold\([\s\S]{0,1400}confirmedBy: user\.id, confirmedAt:/.test(S));
  check('and it refuses a document already filed, or one that is not a lease document',
    /if \(!row \|\| !AD\.isFamilyType\(row\.doc_type\) \|\| row\.family_id\) return;/.test(S));
  const beginBody = S.slice(S.indexOf('async function acqBeginLeasehold('),
                            S.indexOf('// The panel is re-rendered wholesale'));
  check('it does not change the document type — an amendment that begins a leasehold is still an amendment',
    !/docType:/.test(beginBody) && !/docTypeStatus:/.test(beginBody),
    beginBody.length + ' chars of body read');
  check('and it does not touch the relationship either',
    !/relationship/.test(beginBody));
  check('the tenant is read through the evidence cache, not from the list row',
    /function _acqWithEvidence\(row\) \{[\s\S]{0,220}_acqEvidence\.get\(row\.id\)/.test(S));
  check('the panel names the reason a document is unfiled',
    /class="acq-doc-unfiled"/.test(S) && /acq-doc-unfiled-why/.test(S));
  check('it offers the control ONLY where canBegin is set',
    /v\.canBegin[\s\S]{0,400}acq-doc-begin/.test(S));
  check('the wording says the document CAN BEGIN a leasehold if the person confirms',
    /This document can begin a leasehold if you confirm that it belongs to this/.test(S));
  check('it does NOT say MainStreet identified an original lease',
    !/we have determined|MainStreet determined|identified as the original lease/i.test(S));
  check('the control is bound by delegation, like every other row control',
    /closest\('\.acq-doc-begin'\)[\s\S]{0,120}acqBeginLeasehold/.test(S));
  check('the row carries its family status for the walk to read',
    /data-family="\$\{esc\(r\.family_status \|\| 'unfiled'\)\}"/.test(S));
  check('index.html styles the notice and the control',
    /\.acq-doc-unfiled \{/.test(HTML) && /\.acq-doc-begin \{/.test(HTML));
  check('and stacks them at phone width instead of squeezing the button away',
    /\.acq-doc-unfiled \{ flex-direction: column;/.test(HTML));
  check('no migration was needed — family_source already admits human and ai',
    /family_source in \('ai', 'human', 'inherited'\)/.test(
      fs.readFileSync(path.join(ROOT, 'migrations', '024_acquisition_document_classification.sql'), 'utf8')));
  check('and nothing in Issue B writes a new column',
    !/abstraction_error/.test(S.slice(S.indexOf('async function acqBeginLeasehold('),
                                      S.indexOf('function _acqBindDocControls('))));
}

console.log('\n' + '─'.repeat(66));
console.log(`RESULT: ${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILED:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);
