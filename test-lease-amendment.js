'use strict';
// test-lease-amendment.js — the amendment is a preserved document, and a
// superseded clause is never evidence.
//
//   node test-lease-amendment.js
//
// Two defects, one slice:
//
//   1. The amendment PDF was read for its numbers and then dropped. No storage
//      upload, no lease_documents row, no extracted text — so the document that
//      changed the lease could not be opened, asked, or listed, while the
//      original it amended was preserved three ways.
//   2. After a reload the card rendered the AMENDED value above a citation
//      quoting the clause the amendment replaced. "CAM Cap: 3%" over wording
//      that says five. FieldProvenance already refuses to certify a field whose
//      evidence states a different value (M8d); the chip was the last surface
//      still deciding it alone.
//
// Sections A and B EXECUTE the real functions out of script.js in a sandbox.
// Section C executes field-provenance.js and tenant-space.js as the modules
// they are. Nothing here is a source grep.
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT      = __dirname;
const scriptSrc = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
const FP        = require('./field-provenance.js');

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log(`  \x1b[32mok\x1b[0m   ${name}`); }
  catch (e) { fail++; console.log(`  \x1b[31mFAIL\x1b[0m ${name}\n       ${e.message}`); } };
const ok = (c, m) => { if (!c) throw new Error(m || 'expected truthy'); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b))
  throw new Error(`${m || ''}\n        expected ${JSON.stringify(b)}\n        got      ${JSON.stringify(a)}`); };
const sec = s => console.log(`\n── ${s} ──`);

// ── Pull the functions under test out of script.js ───────────────────────────
function fn(name) {
  const m = scriptSrc.match(new RegExp(`\\nfunction ${name}\\([\\s\\S]*?\\n\\}\\n`));
  if (!m) throw new Error(`${name} not found in script.js`);
  return m[0];
}
const esc = (v) => v === null || v === undefined ? '' : String(v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// ═════════════════════════════════════════════════════════════════════════════
sec('A · applyAmendmentOverrides: the amendment entry records WHERE the document is');

// A sandbox holding only what the function actually reaches for. Every write
// the function makes is observable, so nothing is inferred from source text.
function runOverrides(tenant, amNorm, docMeta, opts) {
  const box = {
    console: { log() {}, warn() {}, error() {} },
    tenantData: [tenant],
    lastResults: (opts && opts.lastResults) || [],
    _resultsStale: false,
    Date, JSON, String, Number, Array, Object, Boolean, isFinite, parseFloat,
    audit: [], toasts: [], timeline: [], saved: 0, rendered: 0,
  };
  box.appendReviewAuditEntry     = (e) => box.audit.push(e);
  box.showToast                  = (m) => box.toasts.push(m);
  box.appendPropertyTimelineEvent = (p, e) => box.timeline.push(e);
  box.currentProperty            = () => ({ id: 'p1', name: 'Test' });
  box.savePropertyData           = () => { box.saved++; };
  box.renderBulkResults          = () => { box.rendered++; };
  box._refreshLfcExpansion       = () => {};
  box._updateStaleResultsBanner  = () => {};
  vm.createContext(box);
  vm.runInContext(fn('applyAmendmentOverrides')
    + `\nthis.__r = applyAmendmentOverrides('t1', ${JSON.stringify(amNorm)}, 'amd-1', ${JSON.stringify((opts && opts.fileName) || 'Amendment 1.pdf')}, ${JSON.stringify(docMeta)});`,
    box);
  return { tenant: box.tenantData[0], box };
}

// The original lease as intake leaves it: values, plus one cited snapshot per
// field carrying the clause it was read from.
const citedSnap = (val, quote) => ({
  fieldKey: 'x', value: val, quote, sourceFile: 'Original Lease.pdf',
  confidence: { status: 'estimated', note: 'AI-extracted' },
  extractedAt: '2024-01-10T00:00:00.000Z', approved: false, manuallyEdited: false,
});
const ORIGINAL = () => ({
  id: 't1', tenant_name: 'Alder Dental', leased_sqft: 4000, cap: 5,
  lease_type: 'NNN', start_date: '2021-01-01', end_date: '2031-12-31',
  fileName: 'Original Lease.pdf', leaseUrl: 'https://store.test/original.pdf',
  amendments: [],
  fieldEvidence: {
    cap:         { snapshots: [citedSnap(5, 'CAM cap shall not exceed five percent (5%) per annum.')] },
    leased_sqft: { snapshots: [citedSnap(4000, 'Premises comprise 4,000 rentable square feet.')] },
    lease_type:  { snapshots: [citedSnap('NNN', 'This is a triple net lease.')] },
  },
});
const AMENDMENT = { cap: 3, leased_sqft: 4600, start_date: '2025-07-01', fieldEvidence: {
  cap:         { snapshots: [{ quote: 'CAM cap is hereby reduced to three percent (3%).', section: '2.1' }] },
  leased_sqft: { snapshots: [{ quote: 'Premises expanded to 4,600 rentable square feet.' }] },
} };
const DOC = { fileUrl: 'https://store.test/1712-amendment-1.pdf', leaseDocumentId: 'ld-amd-1' };

const A = runOverrides(ORIGINAL(), AMENDMENT, DOC);

t('A1 the amendment entry carries the stored file url', () => {
  eq(A.tenant.amendments.length, 1, 'exactly one amendment recorded');
  eq(A.tenant.amendments[0].fileUrl, DOC.fileUrl);
});
t('A2 and the lease_documents id that makes it askable', () => {
  eq(A.tenant.amendments[0].leaseDocumentId, 'ld-amd-1');
});
t('A3 the filename and effective date are still recorded', () => {
  eq(A.tenant.amendments[0].fileName, 'Amendment 1.pdf');
  eq(A.tenant.amendments[0].effectiveDate, '2025-07-01');
});
t('A4 MULTIPLE AMENDED FIELDS stay associated with the amendment that changed them', () => {
  eq(A.tenant.amendments[0].overriddenFields.slice().sort(), ['cap', 'leased_sqft', 'start_date']);
  eq(A.tenant.amendments[0].extractedFields.cap, 3);
  eq(A.tenant.amendments[0].extractedFields.leased_sqft, 4600);
});
t('A5 the live values are the amended ones — the existing CAM path is unchanged', () => {
  eq([A.tenant.cap, A.tenant.leased_sqft], [3, 4600]);
});
t('A6 an untouched field keeps the original value and is NOT claimed as amended', () => {
  eq(A.tenant.lease_type, 'NNN');
  ok(!A.tenant.amendments[0].overriddenFields.includes('lease_type'), 'lease_type listed as overridden');
  eq(A.tenant.fieldEvidence.lease_type.snapshots.length, 1, 'its evidence was appended to');
});
t('A7 the ORIGINAL lease is untouched: its document, its filename, its snapshot', () => {
  eq(A.tenant.leaseUrl, 'https://store.test/original.pdf');
  eq(A.tenant.fileName, 'Original Lease.pdf');
  const first = A.tenant.fieldEvidence.cap.snapshots.find(s => s.sourceFile === 'Original Lease.pdf');
  ok(first, 'the original cap snapshot is gone');
  eq(first.value, 5, 'the original cap snapshot was mutated');
  eq(first.quote, 'CAM cap shall not exceed five percent (5%) per annum.');
});
t('A8 NO SECOND TENANT is created — the amendment lands on the existing record', () => {
  eq(A.box.tenantData.length, 1);
  eq(A.box.tenantData[0].id, 't1');
  eq(A.box.tenantData[0].tenant_name, 'Alder Dental');
});
t('A9 the amendment appends evidence rather than replacing it', () => {
  eq(A.tenant.fieldEvidence.cap.snapshots.length, 2);
  const amd = A.tenant.fieldEvidence.cap.snapshots.find(s => s.amendmentId === 'amd-1');
  ok(amd, 'no snapshot tagged with the amendment');
  eq(amd.value, 3);
  eq(amd.originalExtractedValue, 5, 'the superseded value is recorded on the new snapshot');
});
t('A10 a failed filing records null rather than a url that opens nothing', () => {
  const B = runOverrides(ORIGINAL(), AMENDMENT, { fileUrl: null, leaseDocumentId: null });
  eq(B.tenant.amendments[0].fileUrl, null);
  eq(B.tenant.amendments[0].leaseDocumentId, null);
  eq(B.tenant.amendments[0].overriddenFields.length, 3, 'the amendment still applied');
});
t('A11 omitting docMeta entirely does not throw and does not invent a url', () => {
  const C = runOverrides(ORIGINAL(), AMENDMENT, undefined);
  eq(C.tenant.amendments[0].fileUrl, null);
  eq(C.tenant.amendments[0].leaseDocumentId, null);
});
t('A12 recording an amendment marks an existing reconciliation stale', () => {
  const D = runOverrides(ORIGINAL(), AMENDMENT, DOC, { lastResults: [{ name: 'Alder Dental' }] });
  eq(D.box._resultsStale, true);
});

// ═════════════════════════════════════════════════════════════════════════════
sec('B · the citation chip: a superseded clause is never offered as proof');

function chip(tenant, fieldKey, opts) {
  const box = {
    console, JSON, String, Number, Array, Object, Boolean, esc,
    window: (opts && opts.noFP) ? {} : { FieldProvenance: FP },
  };
  vm.createContext(box);
  vm.runInContext(fn('_governingAmendment') + fn('_amendmentLabel')
    + fn('_amendmentProvenanceChip') + fn('_citationChip')
    + `\nthis.__c = _citationChip(${JSON.stringify(tenant)}, ${JSON.stringify(fieldKey)});`
    + `\nthis.__a = _amendmentProvenanceChip(${JSON.stringify(tenant)}, ${JSON.stringify(fieldKey)});`,
    box);
  return { citation: box.__c, amendment: box.__a };
}

// THE STATE AFTER A RELOAD, built the way the app really rebuilds it.
// tenant_field_evidence has no amendment_id or superseded column, so the
// amendment's snapshot is not restored; _stripBlobs already dropped the
// in-memory copy. The live value is the amended one, read from the blob. This
// is exactly the shape that produced "3%" over a clause reading five.
const RELOADED = {
  id: 't1', tenant_name: 'Alder Dental', cap: 3, leased_sqft: 4600, lease_type: 'NNN',
  amendments: [{
    amendmentId: 'amd-1', fileName: 'Amendment 1.pdf', effectiveDate: '2025-07-01',
    fileUrl: DOC.fileUrl, leaseDocumentId: 'ld-amd-1',
    overriddenFields: ['cap', 'leased_sqft', 'start_date'],
    extractedFields: { cap: 3, leased_sqft: 4600 },
  }],
  fieldEvidence: {
    cap:         { snapshots: [citedSnap(5, 'CAM cap shall not exceed five percent (5%) per annum.')] },
    leased_sqft: { snapshots: [citedSnap(4000, 'Premises comprise 4,000 rentable square feet.')] },
    lease_type:  { snapshots: [citedSnap('NNN', 'This is a triple net lease.')] },
  },
};

const capChip = chip(RELOADED, 'cap');

// The chip has two parts and they carry different claims. The BODY is what the
// card asserts on screen; the TITLE is the tooltip, where the superseded
// wording may be kept as long as it is labelled as superseded. Splitting them
// is the difference between "the record is preserved" and "the old clause is
// still being offered as proof", which is the whole point of this slice.
const body  = (html) => String(html).replace(/^[^>]*>/, '').replace(/<[^>]*>/g, '');
const title = (html) => { const m = String(html).match(/title="([^"]*)"/); return m ? m[1] : ''; };

t('B1 THE DEFECT IS GONE: the 5% clause is not printed beside the 3% value', () => {
  ok(!/five percent/i.test(body(capChip.citation)),
     'the superseded clause is still rendered as the visible chip body:\n       ' + body(capChip.citation));
  ok(!/fe-chip--cited/.test(capChip.citation), 'it is still styled as a citation');
  ok(!/fe-chip-quote/.test(capChip.citation), 'it is still rendered in the quote span');
});
t('B2 the chip says the clause is superseded and names the amendment', () => {
  ok(/fe-chip--superseded/.test(capChip.citation), capChip.citation);
  ok(/Superseded by Amendment 1/.test(capChip.citation), capChip.citation);
  ok(/2025-07-01/.test(capChip.citation), 'the effective date is not shown: ' + capChip.citation);
});
t('B3 and states plainly that it is not evidence for the value shown', () => {
  ok(/not evidence for this value/i.test(capChip.citation), capChip.citation);
});
t('B4 the superseded wording survives in the tooltip, labelled as superseded', () => {
  const tip = title(capChip.citation);
  ok(/Superseded wording/.test(tip), tip);
  ok(/five percent/i.test(tip), 'the record of the old clause was discarded rather than labelled: ' + tip);
  ok(/captured for 5, not 3/.test(tip), 'the tooltip does not name both values: ' + tip);
  ok(/not evidence for the value shown/i.test(tip), 'the tooltip does not disclaim it: ' + tip);
});
t('B5 the amendment provenance chip still names the governing document', () => {
  ok(/fe-chip--amendment/.test(capChip.amendment), capChip.amendment);
  ok(/Amendment 1 · 2025-07-01/.test(capChip.amendment), capChip.amendment);
});
t('B6 a second amended field behaves the same way', () => {
  const c = chip(RELOADED, 'leased_sqft');
  ok(/fe-chip--superseded/.test(c.citation), c.citation);
  ok(!/4,000 rentable/.test(body(c.citation)), 'the superseded area clause is still quoted on screen: ' + body(c.citation));
  ok(/captured for 4000, not 4600/.test(title(c.citation)), title(c.citation));
});
t('B7 AN UNAMENDED FIELD IS UNCHANGED — it still cites its clause normally', () => {
  const c = chip(RELOADED, 'lease_type');
  ok(/fe-chip--cited/.test(c.citation), c.citation);
  ok(/triple net lease/.test(c.citation), c.citation);
  ok(!/superseded/i.test(c.citation), c.citation);
  eq(c.amendment, '', 'an unamended field claims an amendment');
});
t('B8 the cited chip carries real HTML attributes — straight quotes, not curly', () => {
  const c = chip(RELOADED, 'lease_type');
  ok(/class="fe-chip fe-chip--cited"/.test(c.citation), 'attribute delimiters are not straight quotes: ' + c.citation);
  ok(!/[“”]fe-chip/.test(c.citation), 'a curly quote is still delimiting an attribute: ' + c.citation);
});
t('B9 IN SESSION, before any reload, the amendment cites its OWN clause', () => {
  // The amendment snapshot is present and describes the current value, so
  // there is nothing stale and the real clause is shown.
  const live = JSON.parse(JSON.stringify(RELOADED));
  live.fieldEvidence.cap.snapshots.push({
    fieldKey: 'cap', value: 3, quote: 'CAM cap is hereby reduced to three percent (3%).',
    sourceFile: 'Amendment 1.pdf', amendmentId: 'amd-1', section: '2.1',
    extractedAt: '2025-07-02T00:00:00.000Z', approved: false, manuallyEdited: false,
    confidence: { status: 'estimated', note: 'AI-extracted from amendment' },
  });
  const c = chip(live, 'cap');
  ok(/fe-chip--cited/.test(c.citation), c.citation);
  ok(/three percent/.test(c.citation), c.citation);
  ok(!/five percent/.test(c.citation), 'the old clause resurfaced: ' + c.citation);
});
t('B10 a stale clause with no amendment on file still refuses, without naming one', () => {
  const edited = { id: 't1', cap: 4, amendments: [],
    fieldEvidence: { cap: { snapshots: [citedSnap(5, 'CAM cap shall not exceed five percent (5%).')] } } };
  const c = chip(edited, 'cap');
  ok(/fe-chip--superseded/.test(c.citation), c.citation);
  ok(/Superseded clause on file/.test(c.citation), c.citation);
  ok(!/Superseded by/.test(c.citation), 'it invented a governing amendment: ' + c.citation);
});
t('B11 a field with no evidence renders nothing, as before', () => {
  eq(chip({ id: 't1', cap: 3, amendments: [], fieldEvidence: {} }, 'cap').citation, '');
});
t('B12 an empty value renders nothing, as before', () => {
  eq(chip({ id: 't1', cap: '', amendments: [], fieldEvidence: RELOADED.fieldEvidence }, 'cap').citation, '');
});
t('B13 with FieldProvenance absent the chip degrades to the old read, never throws', () => {
  const c = chip(RELOADED, 'lease_type', { noFP: true });
  ok(/fe-chip--cited/.test(c.citation), c.citation);
});

sec('C · the governing-amendment lookup is one rule, shared');
function gov(tenant, fieldKey) {
  const box = { console, JSON, String, Array, Object };
  vm.createContext(box);
  vm.runInContext(fn('_governingAmendment')
    + `\nthis.__g = _governingAmendment(${JSON.stringify(tenant)}, ${JSON.stringify(fieldKey)});`, box);
  return box.__g;
}
t('C1 no amendments → null', () => eq(gov({ amendments: [] }, 'cap'), null));
t('C2 an amendment that did not touch the field → null', () => {
  eq(gov({ amendments: [{ fileName: 'a.pdf', overriddenFields: ['end_date'] }] }, 'cap'), null);
});
t('C3 the latest effective date governs, which is the display rule this chip always used', () => {
  const g = gov({ amendments: [
    { fileName: 'first.pdf',  effectiveDate: '2023-01-01', overriddenFields: ['cap'] },
    { fileName: 'second.pdf', effectiveDate: '2025-07-01', overriddenFields: ['cap'] },
  ] }, 'cap');
  eq(g.fileName, 'second.pdf');
});
t('C4 array order does not decide it — the later date wins from either position', () => {
  const g = gov({ amendments: [
    { fileName: 'second.pdf', effectiveDate: '2025-07-01', overriddenFields: ['cap'] },
    { fileName: 'first.pdf',  effectiveDate: '2023-01-01', overriddenFields: ['cap'] },
  ] }, 'cap');
  eq(g.fileName, 'second.pdf');
});
t('C5 a malformed entry cannot throw', () => {
  eq(gov({ amendments: [null, { overriddenFields: null }, undefined] }, 'cap'), null);
  eq(gov({}, 'cap'), null);
});

sec('D · the Space file lists the amendment beside the lease it amended');
{
  const tsSrc = fs.readFileSync(path.join(ROOT, 'tenant-space.js'), 'utf8');
  const box = { window: {}, document: { getElementById: () => null }, console, Date, JSON, Math,
                Number, String, Array, Object, Boolean, isFinite, parseFloat, setTimeout };
  box.window.currentProperty = () => null;
  vm.createContext(box);
  vm.runInContext(tsSrc, box, { filename: 'tenant-space.js' });
  const TS = box.window.TenantSpace;
  const prop = { id: 'p1', name: 'Test', tenants: [{
    id: 't1', tenant_name: 'Alder Dental', leased_sqft: 4600, cap: 3, lease_type: 'NNN',
    leaseUrl: 'https://store.test/original.pdf', leaseFileName: 'Original Lease.pdf',
    amendments: [
      { amendmentId: 'amd-1', fileName: 'Amendment 1.pdf', effectiveDate: '2025-07-01',
        fileUrl: DOC.fileUrl, leaseDocumentId: 'ld-amd-1', overriddenFields: ['cap'] },
      { amendmentId: 'amd-2', fileName: 'Amendment 2.pdf', effectiveDate: '2026-01-01',
        fileUrl: null, leaseDocumentId: null, overriddenFields: ['end_date'] },
    ],
  }], timeline: [], invoices: [], disputes: [], activityLog: [] };
  const rec = TS.assemble(prop, 't1');

  t('D1 the original lease document is still first', () => {
    eq(rec.leaseDocs[0].url, 'https://store.test/original.pdf');
  });
  t('D2 the filed amendment is listed with it', () => {
    eq(rec.leaseDocs.length, 2);
    eq(rec.leaseDocs[1].name, 'Amendment 1.pdf');
    eq(rec.leaseDocs[1].url, DOC.fileUrl);
    eq(rec.leaseDocs[1].when, '2025-07-01');
  });
  t('D3 an amendment whose document was NOT filed is not listed as openable', () => {
    ok(!rec.leaseDocs.some(x => x.name === 'Amendment 2.pdf'),
       'an amendment with no stored file offers a link that opens nothing');
  });
  t('D4 a tenant with no amendments is exactly what it was', () => {
    const p2 = JSON.parse(JSON.stringify(prop));
    p2.tenants[0].amendments = [];
    eq(TS.assemble(p2, 't1').leaseDocs.length, 1);
  });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
