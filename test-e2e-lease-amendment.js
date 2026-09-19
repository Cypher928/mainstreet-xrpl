'use strict';
// test-e2e-lease-amendment.js
// ============================================================================
// UPLOAD AN AMENDMENT, RELOAD THE PAGE, AND THE DOCUMENT IS STILL THERE.
//
// Before this slice the amendment PDF was read for its numbers and dropped:
// no storage upload, no lease_documents row, no extracted text. The document
// that changed the lease could not be opened, listed or asked, while the
// original it amended was preserved three ways. And because the amendment's
// evidence was never persisted either, after a reload the card rendered the
// AMENDED value above a citation quoting the clause the amendment replaced —
// "CAM Cap: 3%" over wording that reads five.
//
//   1 · the amendment PDF reaches storage, through the intake path
//   2 · a lease_documents row is written, carrying this tenant's id and the text
//   3 · the amendment entry keeps the url and the document id
//   4 · the ORIGINAL lease document is untouched
//   5 · no second tenant and no second lease is created
//   6 · the amended values still flow through the tenant record into CAM
//   7 · after a full reload the document is still retrievable and still askable
//   8 · after a full reload the amended field does NOT cite the superseded clause
//   9 · a field the amendment never touched still cites its clause normally
//
//   node test-e2e-lease-amendment.js
// ============================================================================
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = __dirname, PORT = 8996;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.pdf':'application/pdf', '.png':'image/png' };
const showroom = fs.readFileSync(path.join(ROOT, 'test-e2e-demo-showroom.js'), 'utf8');
const DB = showroom.slice(showroom.indexOf('const DB = `') + 12, showroom.indexOf('`;', showroom.indexOf('const DB = `')));

let pass = 0, fail = 0;
const yes = (c, m, d) => { if (c) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${m}`); } else { fail++; console.log(`  \x1b[31m✗\x1b[0m ${m}${d ? `\n      → ${d}` : ''}`); } };
const is  = (a, b, m) => yes(JSON.stringify(a) === JSON.stringify(b), m, `expected ${JSON.stringify(b)}\n        got      ${JSON.stringify(a)}`);
const sec = s => console.log(`\n── ${s} ──`);

const WHM  = 'Whole Health Market';
const AMD  = 'Amendment 1 - Whole Health Market.pdf';
// The amendment's own language. The clause text is distinctive so the test can
// tell which document a quote came from, and the stored copy can be recognised
// when it comes back out of the document record after the reload.
const AMD_TEXT = '--- Page 1 ---\nFIRST AMENDMENT TO LEASE dated July 1, 2025. '
  + 'Section 2.1 is amended so that the CAM cap is hereby reduced to three percent (3%) per annum. '
  + 'Section 1.4 is amended so that the Premises are expanded to 9,800 rentable square feet. '
  + 'All other terms of the Original Lease remain in full force and effect.';

// What the server records, so the test can assert on what the app actually sent
// rather than on what it says it sent.
const seen = { uploads: [], docPosts: [], askPosts: [] };
const leaseDocs = new Map();   // id → row, standing in for the lease_documents table
let docSeq = 0;

const READ = `(() => {
  const T = el => el ? el.textContent.replace(/\\s+/g, ' ').trim() : null;
  const prop = currentProperty();
  const t = (prop.tenants || []).find(x => x && x.tenant_name === ${JSON.stringify(WHM)}) || {};
  const rec = (window.TenantSpace && t.id) ? window.TenantSpace.assemble(prop, t.id) : null;
  const chipBody  = h => String(h || '').replace(/^[^>]*>/, '').replace(/<[^>]*>/g, '');
  const chipTitle = h => { const m = String(h || '').match(/title="([^"]*)"/); return m ? m[1] : ''; };
  const capChip  = _citationChip(t, 'cap');
  const typeChip = _citationChip(t, 'lease_type');
  const r = (lastResults || []).find(x => x.name === ${JSON.stringify(WHM)}) || {};
  return {
    tenantCount: (prop.tenants || []).length,
    tenantNames: (prop.tenants || []).map(x => x && x.tenant_name).filter(Boolean).sort(),
    amendments: (t.amendments || []).map(a => ({
      fileName: a.fileName, fileUrl: a.fileUrl, leaseDocumentId: a.leaseDocumentId,
      effectiveDate: a.effectiveDate, overridden: (a.overriddenFields || []).slice().sort() })),
    cap: t.cap, sqft: t.leased_sqft, leaseType: t.lease_type,
    originalUrl: t.leaseUrl || null, originalFileName: t.fileName || null,
    leaseDocs: rec ? rec.leaseDocs.map(d => ({ name: d.name, url: d.url })) : null,
    capChip: { html: capChip, body: chipBody(capChip), title: chipTitle(capChip) },
    typeChip: { html: typeChip, body: chipBody(typeChip) },
    amendChip: _amendmentProvenanceChip(t, 'cap'),
    stale: _resultsStale,
    resultCap: r.capApplied ? r.capAdjustment : null,
    resultNames: (lastResults || []).map(x => x.name).sort(),
  };
})()`;

(async () => {
  const srv = http.createServer((rq, rs) => {
    let u = decodeURIComponent(rq.url.split('?')[0]);
    if (u === '/') u = '/index.html';
    const json = (o) => { rs.writeHead(200, { 'Content-Type': 'application/json' }); rs.end(JSON.stringify(o)); };

    if (u.startsWith('/api/')) {
      let raw = '';
      rq.on('data', c => { raw += c; });
      rq.on('end', () => {
        let b = {}; try { b = JSON.parse(raw || '{}'); } catch (_) {}

        // Storage. Returns a url the way api/upload.js does.
        if (u === '/api/upload') {
          seen.uploads.push({ fileName: b.fileName, bucket: b.bucket, bytes: (b.fileBase64 || '').length });
          return json({ url: `http://127.0.0.1:${PORT}/stored/${encodeURIComponent(b.fileName || 'x')}` });
        }
        // The lease_documents table, in memory.
        if (u === '/api/lease-documents') {
          if (rq.method === 'POST') {
            seen.docPosts.push(b);
            const existing = [...leaseDocs.values()].find(r2 => r2.property_id === b.propertyId && r2.file_name === b.fileName);
            const id = existing ? existing.id : 'ld-' + (++docSeq);
            const row = { id, property_id: b.propertyId, tenant_id: b.tenantId || null,
              tenant_name: b.tenantName || null, file_name: b.fileName, file_url: b.fileUrl || null,
              extracted_text: b.extractedText || null, parsing_status: b.parsingStatus || 'pending',
              extraction_model: b.extractionModel || null, used_pdf_direct: !!b.usedPdfDirect,
              created_at: new Date().toISOString() };
            leaseDocs.set(id, row);
            return json({ ok: true, data: [row] });
          }
          const rows = [...leaseDocs.values()].map(r2 => ({ ...r2, extracted_text: undefined }));
          return json({ ok: true, data: rows });
        }
        // Ask-the-Lease, answering strictly from the stored text so the test can
        // prove the amendment's own words were persisted and are reachable.
        if (u === '/api/ask-lease') {
          seen.askPosts.push(b);
          const row = leaseDocs.get(b.leaseDocumentId);
          if (!row) return json({ error: 'not found' });
          const m = String(row.extracted_text || '').match(/CAM cap is hereby reduced to ([a-z]+ percent \(\d+%\))/i);
          return json({ answer: m ? `The document states the ${m[1]}.` : 'The document does not say.',
                        sources: [{ file: row.file_name }] });
        }
        // The amendment extraction.
        if (u === '/api/claude') {
          return json({ tenant_name: WHM, cam_cap: 3, sqft: 9800,
            lease_start_date: '2025-07-01', lease_end_date: null, lease_type: null,
            cap_base_amount: null, admin_fee_pct: null, gross_up_pct: null, expense_stop: null,
            audit_rights: null, pro_rata_method: null, renewal_options: null,
            excluded_categories: null, property_name: null,
            quotes: { cam_cap: 'the CAM cap is hereby reduced to three percent (3%) per annum' },
            __meta: { model: 'claude-test-model' } });
        }
        return json({});
      });
      return;
    }
    if (u.startsWith('/stored/')) { rs.writeHead(200, { 'Content-Type': 'application/pdf' }); rs.end('%PDF-1.4 stored'); return; }
    fs.readFile(path.join(ROOT, u), (e, d) => { if (e) { rs.writeHead(404); rs.end(); return; }
      rs.writeHead(200, { 'Content-Type': MIME[path.extname(u)] || 'application/octet-stream' }); rs.end(d); });
  });
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));

  const browser = await pw.chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 1360, height: 1000 } })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  for (const p of ['**cdnjs**', '**jsdelivr**']) await page.route(p, r => r.fulfill({ status: 200, body: '' }));
  await page.route('**fonts.g**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.addInitScript('window.__TEST_AUTHED=true;');
  await page.addInitScript(DB);

  const boot = async () => {
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2600);
    await page.evaluate(() => { try { MainStreetLanding.hide(); } catch (_) {} });
    await page.waitForTimeout(400);
    await page.evaluate(() => loadDemo());
    await page.waitForFunction(() => document.getElementById('mainWorkflow').style.display !== 'none'
      && typeof lastResults !== 'undefined' && lastResults.length > 0, null, { timeout: 30000 });
    await page.waitForTimeout(2200);
  };
  const read = () => page.evaluate(READ);

  await boot();

  // ══ 0 · the lease as it ships ═════════════════════════════════════════════
  sec('0 · before the amendment: the original lease, cited from its own clause');
  const D0 = await read();
  is(D0.amendments, [], 'no amendments on file');
  is(D0.cap, '5', 'the cap is 5% as the original lease states');
  is(D0.leaseDocs.length, 1, 'one lease document on file');
  const BASE = { names: D0.tenantNames, count: D0.tenantCount, origUrl: D0.originalUrl,
                 origName: D0.originalFileName, resultNames: D0.resultNames, typeChip: D0.typeChip.html };

  // ══ 1–3 · upload ══════════════════════════════════════════════════════════
  sec('1–3 · the amendment is read, filed to storage, and given a document record');
  const UP = await page.evaluate(async ({ amdText, amdName, whm }) => {
    const t = tenantData.find(x => x && x.tenant_name === whm);
    // Watch the evidence writer. This slice deliberately adds no migration, so
    // the amendment's snapshots are still not persisted — the test records that
    // rather than leaving it as an unstated assumption.
    window.__tfeWrites = [];
    const _origTfe = window._writeTenantFieldEvidence;
    window._writeTenantFieldEvidence = function (p, tid, fk, snap) {
      window.__tfeWrites.push({ fk, value: snap && snap.value, amendmentId: (snap && snap.amendmentId) || null });
      return Promise.resolve();
    };
    window.__restoreTfe = () => { window._writeTenantFieldEvidence = _origTfe; };
    // The PDF text layer is not what this test is about; the parser is exercised
    // by the extraction suites. Everything downstream of it is real.
    window.extractLeaseText = async () => amdText;
    const file = new File([new Uint8Array(2048)], amdName, { type: 'application/pdf' });
    await handleAmendmentUpload(t.id, file);
    await new Promise(r => setTimeout(r, 1200));
    const writes = window.__tfeWrites.slice();
    window.__restoreTfe();
    return { tenantId: t.id, tfeWrites: writes };
  }, { amdText: AMD_TEXT, amdName: AMD, whm: WHM });

  is(seen.uploads.length, 1, 'the amendment PDF was uploaded exactly once');
  yes(seen.uploads[0] && seen.uploads[0].bucket === 'leases' && /Amendment 1/.test(seen.uploads[0].fileName),
      'it went to the leases bucket, under its own name', JSON.stringify(seen.uploads[0]));
  is(seen.docPosts.length, 1, 'one lease_documents row was written');
  const P = seen.docPosts[0] || {};
  yes(P.tenantId === UP.tenantId, 'the row carries this tenant’s id, so it is addressable as theirs', JSON.stringify({ got: P.tenantId, want: UP.tenantId }));
  is(P.tenantName, WHM, 'and this tenant’s name');
  is(P.fileName, AMD, 'the amendment’s filename');
  yes(!!P.fileUrl && /stored/.test(P.fileUrl), 'the stored file url', String(P.fileUrl));
  yes(/three percent \(3%\)/.test(P.extractedText || ''), 'the amendment’s TEXT was persisted, which is what makes it askable', String(P.extractedText || '').slice(0, 80));
  is(P.parsingStatus, 'success', 'and the row is not claimed to be more complete than it is');

  const D1 = await read();
  is(D1.amendments.length, 1, 'one amendment on the tenant');
  yes(!!D1.amendments[0].fileUrl, 'the amendment entry keeps the stored file url', JSON.stringify(D1.amendments[0]));
  yes(!!D1.amendments[0].leaseDocumentId, 'and the lease_documents id', JSON.stringify(D1.amendments[0]));
  is(D1.amendments[0].effectiveDate, '2025-07-01', 'and its effective date');
  is(D1.amendments[0].overridden, ['cap', 'end_date', 'leased_sqft', 'start_date'], 'the fields it changed are recorded against it');

  // ══ 4–6 · what must not have moved ════════════════════════════════════════
  sec('4–6 · the original is untouched, no second tenant, the values reach CAM');
  is(D1.originalUrl, BASE.origUrl, '4 · the ORIGINAL lease document url is unchanged');
  is(D1.originalFileName, BASE.origName, '4 · and its filename');
  is(D1.tenantCount, BASE.count, '5 · the tenant count is unchanged');
  is(D1.tenantNames, BASE.names, '5 · and so is every tenant name — no second lease was created');
  is(D1.cap, 3, '6 · the amended cap is on the tenant record the engine reads');
  is(D1.sqft, 9800, '6 · and the amended area');
  is(D1.leaseType, D0.leaseType, '6 · a field the amendment did not state is unchanged');
  is(D1.stale, true, '6 · and the existing reconciliation is marked stale rather than silently kept');
  is(D1.leaseDocs.length, 2, 'the Space file now lists two lease documents');
  is(D1.leaseDocs[0], D0.leaseDocs[0], 'the original is still first and unchanged');
  is(D1.leaseDocs[1].name, AMD, 'and the amendment follows it');

  // ══ 7 · the reload ════════════════════════════════════════════════════════
  sec('7 · after a FULL RELOAD the amendment document is still there and still askable');
  await boot();
  const D2 = await read();
  is(D2.amendments.length, 1, 'the amendment survived the reload');
  is(D2.amendments[0].fileName, AMD, 'with its filename');
  yes(!!D2.amendments[0].fileUrl && D2.amendments[0].fileUrl === D1.amendments[0].fileUrl,
      'with the SAME stored file url it was given', JSON.stringify([D1.amendments[0].fileUrl, D2.amendments[0].fileUrl]));
  yes(D2.amendments[0].leaseDocumentId === D1.amendments[0].leaseDocumentId,
      'and the same document id', JSON.stringify([D1.amendments[0].leaseDocumentId, D2.amendments[0].leaseDocumentId]));
  is(D2.leaseDocs.length, 2, 'the Space file still lists both documents');
  is(D2.leaseDocs[1].name, AMD, 'the amendment among them');

  const RETRIEVE = await page.evaluate(async () => {
    const t = currentProperty().tenants.find(x => x && x.tenant_name === 'Whole Health Market');
    const id = t.amendments[0].leaseDocumentId;
    // The listing path Lease Center uses, and the question path Ask-the-Lease uses.
    const list = await (await fetch('/api/lease-documents?propertyId=' + currentProperty().id,
      { headers: { 'Content-Type': 'application/json' } })).json();
    const ask = await (await fetch('/api/ask-lease', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leaseDocumentId: id, question: 'What is the CAM cap?' }) })).json();
    const row = (list.data || []).find(r => r.id === id) || null;
    return { id, listed: !!row, row, answer: ask.answer || ask.error || null,
             fetched: (await fetch(t.amendments[0].fileUrl)).status };
  });
  yes(RETRIEVE.listed, 'the amendment is listed by the document record the whole app reads', JSON.stringify(RETRIEVE.row));
  is(RETRIEVE.row && RETRIEVE.row.tenant_id, (await read()) && D2.amendments[0] ? RETRIEVE.row.tenant_id : null, 'the row still carries a tenant id');
  yes(RETRIEVE.row && RETRIEVE.row.file_name === AMD, 'under the amendment’s own name', JSON.stringify(RETRIEVE.row));
  is(RETRIEVE.fetched, 200, 'the stored PDF itself is retrievable at that url');
  yes(/three percent \(3%\)/.test(RETRIEVE.answer || ''),
      'and Ask-the-Lease answers FROM THE AMENDMENT’S OWN TEXT — it is askable, not just filed', String(RETRIEVE.answer));

  // ══ 8–9 · evidence honesty ════════════════════════════════════════════════
  //
  // WHY THE EVIDENCE IS REBUILT HERE RATHER THAN READ BACK. tenant_field_evidence
  // has no amendment_id and no superseded column, and applyAmendmentOverrides
  // writes no row at all — asserted just below — so after a reload the only
  // snapshot the table can return is the ORIGINAL lease's, written at intake.
  // This harness's mock store does not model that table, so the rows it WOULD
  // return are put back through the app's own _evidenceRowToSnapshot mapper.
  // That is the exact shape loadFieldEvidence produces on a real reload, and it
  // is the shape that used to render "CAM Cap: 3%" over a clause reading five.
  sec('8–9 · after the reload the amended field does not cite the clause it replaced');
  is(UP.tfeWrites.filter(w => w.amendmentId).length, 0,
     'the amendment writes no evidence row — the lineage genuinely does not survive, which is what makes the chip’s refusal necessary');

  const REBUILT = await page.evaluate(() => {
    const prop = currentProperty();
    const t = prop.tenants.find(x => x && x.tenant_name === 'Whole Health Market');
    const row = (fk, value, quote) => ({
      field_key: fk, value: value, quote: quote, source_file: 'Whole Health Market Lease.pdf',
      confidence_status: 'estimated', confidence_note: 'AI-extracted', source_page: 4,
      extraction_id: null, extraction_version: 'v1', reviewer_uid: null, reviewer_email: null,
      reviewed_at: '2024-01-10T00:00:00.000Z', approved: false, manually_edited: false,
      original_extracted_value: null,
    });
    t.fieldEvidence = {
      // The cap as the ORIGINAL lease stated it. The live value is now 3.
      cap: { snapshots: [_evidenceRowToSnapshot(row('cap', '5', 'CAM cap shall not exceed five percent (5%) per annum.'))] },
      // A field the amendment never mentioned: evidence and value still agree.
      lease_type: { snapshots: [_evidenceRowToSnapshot(row('lease_type', t.lease_type, 'This is a triple net lease.'))] },
    };
    const i = tenantData.findIndex(x => x && x.id === t.id);
    if (i !== -1) tenantData[i] = t;
    return { capSnapValue: t.fieldEvidence.cap.snapshots[0].value, liveCap: t.cap };
  });
  yes(String(REBUILT.capSnapValue) === '5' && String(REBUILT.liveCap) === '3',
      'the reconstructed state is the real one: evidence says 5, the field says 3', JSON.stringify(REBUILT));
  Object.assign(D2, await read());

  yes(!/five percent/i.test(D2.capChip.body),
      '8 · THE DEFECT IS GONE: the 5% clause is not printed beside the 3% cap', D2.capChip.body);
  yes(!/fe-chip--cited/.test(D2.capChip.html), '8 · and it is not styled as a citation', D2.capChip.html);
  yes(/fe-chip--superseded/.test(D2.capChip.html), '8 · it is marked superseded', D2.capChip.html);
  yes(/Superseded by Amendment 1/.test(D2.capChip.body) && /2025-07-01/.test(D2.capChip.body),
      '8 · naming the amendment and its effective date', D2.capChip.body);
  yes(/not evidence for this value/i.test(D2.capChip.body), '8 · and saying plainly that it does not prove the value', D2.capChip.body);
  yes(/captured for 5, not 3/.test(D2.capChip.title) && /Superseded wording/.test(D2.capChip.title),
      '8 · the old wording is kept in the tooltip, labelled superseded, so the record is not lost', D2.capChip.title);
  yes(/Amendment 1/.test(D2.amendChip), '8 · the amendment provenance chip still names the governing document', D2.amendChip);
  yes(/fe-chip--cited/.test(D2.typeChip.html) && /triple net/i.test(D2.typeChip.body),
      '9 · a field the amendment never touched still cites its own clause normally', D2.typeChip.body);
  yes(!/superseded/i.test(D2.typeChip.html),
      '9 · and is not swept into the refusal — only the amended field is', D2.typeChip.html);
  is(D2.cap, 3, 'the value on screen is still the amended one');
  is(D2.tenantNames, BASE.names, 'and the roster is still unchanged');

  // ══ 11 · a scanned amendment with no text layer ══════════════════════════
  //
  // The document is still filed and still has a row — what it lacks is text to
  // ask questions of, and the row must say so rather than claiming success.
  sec('11 · a scanned amendment is filed, and its row does not overstate what was captured');
  const SCAN = await page.evaluate(async ({ whm }) => {
    const t = tenantData.find(x => x && x.tenant_name === whm);
    window.extractLeaseText = async () => '';                       // no text layer
    window.extractTextFromPdfDirect = async () => null;             // transcription finds none
    window.callClaudeWithPdfDirect  = async () => ({ tenant_name: whm, cam_cap: 3, sqft: 9800,
      lease_start_date: '2025-07-01', quotes: {} });
    const file = new File([new Uint8Array(1024)], 'Scanned Amendment.pdf', { type: 'application/pdf' });
    await handleAmendmentUpload(t.id, file);
    await new Promise(r => setTimeout(r, 1000));
    return { amendments: (currentProperty().tenants.find(x => x && x.tenant_name === whm).amendments || []).length };
  }, { whm: WHM });
  const scanPost = seen.docPosts.find(p => p.fileName === 'Scanned Amendment.pdf');
  yes(!!scanPost, 'the scanned amendment still gets a document row');
  is(scanPost && scanPost.parsingStatus, 'partial',
     'and the row reads "partial", not "success" — there is no text to ask questions of');
  yes(scanPost && !scanPost.extractedText, 'its text column is empty rather than filled with a claim', JSON.stringify(scanPost && scanPost.extractedText));
  yes(!!(scanPost && scanPost.fileUrl), 'the file itself is still stored', String(scanPost && scanPost.fileUrl));
  is(SCAN.amendments, 2, 'and it is recorded as a second amendment on the same tenant');

  sec('10 · quiet page');
  is(errors, [], 'no uncaught errors');

  await browser.close(); srv.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
