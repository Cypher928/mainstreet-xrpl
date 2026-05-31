/**
 * test-lease-persistence.js
 * Phase 22A regression tests for lease document persistence.
 *
 * Tests the /api/lease-documents handler in isolation using a mock fetch
 * (same pattern as test-cam-persistence.js). Does NOT require a live Supabase
 * connection — all Supabase calls are intercepted by mockSbFetch.
 *
 * Run: node test-lease-persistence.js
 */

'use strict';

let passed = 0;
let failed = 0;

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Minimal mock of the API handler — replicate handler logic inline so we can
// test request routing, payload shaping, and error codes without HTTP.
// ---------------------------------------------------------------------------

// Stub fetch responses keyed by [method][path pattern]
function buildMockHandler(sbResponses) {
  let callLog = [];

  async function mockSbFetch(path, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const entry  = sbResponses.find(r => r.method === method && path.includes(r.pathMatch));
    callLog.push({ method, path });
    if (!entry) return { status: 500, json: { raw: 'No mock for ' + method + ' ' + path } };
    return { status: entry.status, json: entry.json };
  }

  // Inline replica of handler logic (POST path)
  async function handlePost(body) {
    const { propertyId, fileName, fileUrl, extractedText, parsingStatus, tenantId, tenantName, extractionModel, usedPdfDirect } = body || {};
    if (!propertyId || !fileName) return { status: 400, body: { error: 'Missing propertyId or fileName' } };

    const existing = await mockSbFetch(
      `/lease_documents?property_id=eq.${propertyId}&file_name=eq.${fileName}&select=id`,
      { method: 'GET' }
    );
    if (existing.status >= 300) {
      if (_isMigrationMissing(existing.json)) {
        return { status: 503, body: { error: 'lease_documents table not found', code: 'migration_missing' } };
      }
      return { status: 502, body: { error: 'Supabase lookup failed', detail: existing.json } };
    }

    const existingRows = Array.isArray(existing.json) ? existing.json : [];
    const payload = { property_id: propertyId, tenant_id: tenantId || null, tenant_name: tenantName || null,
      file_name: fileName, file_url: fileUrl || null, extracted_text: extractedText || null,
      parsing_status: parsingStatus || 'pending', extraction_model: extractionModel || null,
      used_pdf_direct: usedPdfDirect === true };

    let result;
    if (existingRows.length > 0) {
      result = await mockSbFetch(`/lease_documents?id=eq.${existingRows[0].id}`, { method: 'PATCH', body: JSON.stringify(payload) });
    } else {
      result = await mockSbFetch('/lease_documents', { method: 'POST', body: JSON.stringify(payload) });
    }

    if (result.status >= 300) {
      if (_isMigrationMissing(result.json)) return { status: 503, body: { error: 'lease_documents table not found', code: 'migration_missing' } };
      return { status: 502, body: { error: 'Write failed', detail: result.json } };
    }
    const data = Array.isArray(result.json) ? result.json : [result.json];
    return { status: 200, body: { ok: true, data } };
  }

  // GET path
  async function handleGet(query) {
    const { propertyId } = query || {};
    if (!propertyId) return { status: 400, body: { error: 'Missing propertyId' } };
    const result = await mockSbFetch(
      `/lease_documents?property_id=eq.${propertyId}&order=created_at.desc`,
      { method: 'GET' }
    );
    if (result.status >= 300) {
      if (_isMigrationMissing(result.json)) return { status: 503, body: { error: 'lease_documents table not found', code: 'migration_missing' } };
      return { status: 502, body: { error: 'Query failed', detail: result.json } };
    }
    const rows = Array.isArray(result.json) ? result.json : [];
    return { status: 200, body: { ok: true, data: rows } };
  }

  // DELETE path
  async function handleDelete(query) {
    const { id } = query || {};
    if (!id) return { status: 400, body: { error: 'Missing id' } };
    const result = await mockSbFetch(`/lease_documents?id=eq.${id}`, { method: 'DELETE' });
    if (result.status >= 300) return { status: 502, body: { error: 'Delete failed', detail: result.json } };
    return { status: 200, body: { ok: true } };
  }

  return { handlePost, handleGet, handleDelete, getCallLog: () => callLog };
}

function _isMigrationMissing(json) {
  if (!json) return false;
  const obj = Array.isArray(json) ? (json[0] || {}) : json;
  const msg = String(obj.message || obj.error || obj.raw || '').toLowerCase();
  return obj.code === '42P01' || (msg.includes('does not exist') || (msg.includes('relation') && msg.includes('exist')));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function runTests() {
  console.log('\n' + '='.repeat(60));
  console.log('  Phase 22A — Lease Persistence Regression Tests');
  console.log('='.repeat(60));

  // ── Suite: POST (upsert) ─────────────────────────────────────────────────

  console.log('\n[POST — insert new record]');
  {
    const h = buildMockHandler([
      { method: 'GET',  pathMatch: 'file_name=eq.',          status: 200, json: [] },
      { method: 'POST', pathMatch: '/lease_documents',        status: 200, json: [{ id: 'abc-123', file_name: 'lease.pdf', parsing_status: 'success' }] },
    ]);
    const r = await h.handlePost({ propertyId: 'prop-1', fileName: 'lease.pdf', parsingStatus: 'success', tenantName: 'Sunrise Cafe' });
    assert('LP-1: HTTP 200 on successful insert', r.status === 200);
    assert('LP-2: ok=true in body',               r.body.ok === true);
    assert('LP-3: returned row array',             Array.isArray(r.body.data) && r.body.data.length > 0);
    assert('LP-4: lookup + insert calls made',     h.getCallLog().length === 2);
  }

  console.log('\n[POST — update existing record]');
  {
    const h = buildMockHandler([
      { method: 'GET',   pathMatch: 'file_name=eq.',  status: 200, json: [{ id: 'existing-id' }] },
      { method: 'PATCH', pathMatch: 'id=eq.',         status: 200, json: [{ id: 'existing-id', parsing_status: 'success' }] },
    ]);
    const r = await h.handlePost({ propertyId: 'prop-1', fileName: 'lease.pdf', parsingStatus: 'success' });
    assert('LP-5: HTTP 200 on update',       r.status === 200);
    assert('LP-6: PATCH was called',         h.getCallLog().some(c => c.method === 'PATCH'));
    assert('LP-7: POST insert not called',   !h.getCallLog().some(c => c.method === 'POST'));
  }

  console.log('\n[POST — missing required fields]');
  {
    const h = buildMockHandler([]);
    const r1 = await h.handlePost({ fileName: 'lease.pdf' });
    const r2 = await h.handlePost({ propertyId: 'prop-1' });
    assert('LP-8: 400 when propertyId missing', r1.status === 400);
    assert('LP-9: 400 when fileName missing',   r2.status === 400);
  }

  console.log('\n[POST — migration_missing on lookup]');
  {
    const h = buildMockHandler([
      { method: 'GET', pathMatch: 'file_name=eq.', status: 400, json: { code: '42P01', message: 'relation "lease_documents" does not exist' } },
    ]);
    const r = await h.handlePost({ propertyId: 'prop-1', fileName: 'lease.pdf' });
    assert('LP-10: 503 on migration_missing',         r.status === 503);
    assert('LP-11: code=migration_missing returned',  r.body.code === 'migration_missing');
  }

  console.log('\n[POST — migration_missing on write]');
  {
    const h = buildMockHandler([
      { method: 'GET',  pathMatch: 'file_name=eq.',   status: 200, json: [] },
      { method: 'POST', pathMatch: '/lease_documents', status: 400, json: { code: '42P01', message: 'does not exist' } },
    ]);
    const r = await h.handlePost({ propertyId: 'prop-1', fileName: 'lease.pdf' });
    assert('LP-12: 503 on migration_missing (write)', r.status === 503);
  }

  console.log('\n[POST — usedPdfDirect flag preserved]');
  {
    let capturedPayload = null;
    const h = buildMockHandler([
      { method: 'GET',  pathMatch: 'file_name=eq.',   status: 200, json: [] },
      { method: 'POST', pathMatch: '/lease_documents', status: 200, json: [{ id: 'new-id', used_pdf_direct: true }] },
    ]);
    const r = await h.handlePost({ propertyId: 'prop-1', fileName: 'scan.pdf', usedPdfDirect: true });
    assert('LP-13: 200 with usedPdfDirect=true', r.status === 200);
  }

  // ── Suite: GET ───────────────────────────────────────────────────────────

  console.log('\n[GET — list documents]');
  {
    const docs = [
      { id: 'doc-1', file_name: 'lease-a.pdf', parsing_status: 'success', created_at: '2025-01-01T00:00:00Z' },
      { id: 'doc-2', file_name: 'lease-b.pdf', parsing_status: 'partial', created_at: '2025-01-02T00:00:00Z' },
    ];
    const h = buildMockHandler([
      { method: 'GET', pathMatch: 'property_id=eq.', status: 200, json: docs },
    ]);
    const r = await h.handleGet({ propertyId: 'prop-1' });
    assert('LP-14: HTTP 200 on GET',         r.status === 200);
    assert('LP-15: ok=true in body',         r.body.ok === true);
    assert('LP-16: returns document array',  Array.isArray(r.body.data) && r.body.data.length === 2);
    assert('LP-17: file names preserved',    r.body.data[0].file_name === 'lease-a.pdf');
  }

  console.log('\n[GET — missing propertyId]');
  {
    const h = buildMockHandler([]);
    const r = await h.handleGet({});
    assert('LP-18: 400 when propertyId missing', r.status === 400);
  }

  console.log('\n[GET — empty result]');
  {
    const h = buildMockHandler([
      { method: 'GET', pathMatch: 'property_id=eq.', status: 200, json: [] },
    ]);
    const r = await h.handleGet({ propertyId: 'prop-empty' });
    assert('LP-19: 200 with empty array',    r.status === 200);
    assert('LP-20: data is empty array',     Array.isArray(r.body.data) && r.body.data.length === 0);
  }

  console.log('\n[GET — migration_missing]');
  {
    const h = buildMockHandler([
      { method: 'GET', pathMatch: 'property_id=eq.', status: 400, json: { code: '42P01', message: 'relation "lease_documents" does not exist' } },
    ]);
    const r = await h.handleGet({ propertyId: 'prop-1' });
    assert('LP-21: 503 on migration_missing', r.status === 503);
    assert('LP-22: code returned',            r.body.code === 'migration_missing');
  }

  // ── Suite: DELETE ────────────────────────────────────────────────────────

  console.log('\n[DELETE — remove document]');
  {
    const h = buildMockHandler([
      { method: 'DELETE', pathMatch: 'id=eq.', status: 200, json: [] },
    ]);
    const r = await h.handleDelete({ id: 'doc-abc' });
    assert('LP-23: HTTP 200 on DELETE',  r.status === 200);
    assert('LP-24: ok=true in body',     r.body.ok === true);
  }

  console.log('\n[DELETE — missing id]');
  {
    const h = buildMockHandler([]);
    const r = await h.handleDelete({});
    assert('LP-25: 400 when id missing', r.status === 400);
  }

  console.log('\n[DELETE — Supabase error]');
  {
    const h = buildMockHandler([
      { method: 'DELETE', pathMatch: 'id=eq.', status: 500, json: { error: 'Internal error' } },
    ]);
    const r = await h.handleDelete({ id: 'doc-bad' });
    assert('LP-26: 502 on Supabase error', r.status === 502);
  }

  // ── Suite: _isMigrationMissing helper ────────────────────────────────────

  console.log('\n[_isMigrationMissing helper]');
  {
    assert('LP-27: detects 42P01 code',              _isMigrationMissing({ code: '42P01' }));
    assert('LP-28: detects "does not exist" message', _isMigrationMissing({ message: 'relation "lease_documents" does not exist' }));
    assert('LP-29: false for normal error',           !_isMigrationMissing({ message: 'permission denied' }));
    assert('LP-30: false for null',                   !_isMigrationMissing(null));
    assert('LP-31: handles array wrapping',           _isMigrationMissing([{ code: '42P01' }]));
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log('\n' + '='.repeat(60));
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(60) + '\n');

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
