// test-e2e-acquisition-documents-mobile.js
// ============================================================================
// The Acquisition Documents panel on a phone.
//
// P1-3 added a type control and a Confirm button to each document row. The row
// was a single-line flex whose other children all carry flex-shrink: 0, so on a
// narrow screen the only flexible child — the one holding the FILE NAME —
// collapsed to nothing, and `overflow-wrap: anywhere` then broke names like
// SafeShield_Insurance_Lease.pdf one character per line.
//
// This suite measures the rendered geometry at real iPhone widths rather than
// reading the stylesheet, because the bug was in how the boxes resolved and not
// in any single declaration. It asserts what a person actually needs:
//
//   · the file name has usable width and reads on a couple of lines, not thirty
//   · nothing the increment added is lost — type control, Confirm, status,
//     classification label, and the control that opens the original
//   · the panel does not scroll sideways
//   · the desktop layout still puts the name and the controls on ONE row
//
// It renders through the real _renderAcqDocuments() so the assertions are about
// the shipped renderer and stylesheet, not a fixture of them.
//
// Run: node test-e2e-acquisition-documents-mobile.js
// ============================================================================
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = __dirname, PORT = 8931;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg',
               '.svg':'image/svg+xml', '.pdf':'application/pdf', '.txt':'text/plain' };

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? '  — ' + detail : ''));
}

const UID = 'u1', REVIEW_ID = 'eeeeeee1-0000-4000-b000-000000000001';
const FAMILY_ID = 'fam-mobile-1';

// The three documents actually on the Pilot review, by name.
const DOCS = [
  { id: 'd1', review_id: REVIEW_ID, user_id: UID, intake_id: 'ik-1',
    file_name: 'SafeShield_Insurance_Lease.pdf', intake_kind: 'lease',
    parsing_status: 'success', byte_size: 1909,
    storage_path: 'leases/' + UID + '/acq_x_1-SafeShield_Insurance_Lease.pdf',
    doc_type: 'original_lease', doc_type_status: 'proposed', doc_type_source: 'ai',
    doc_type_confidence: 0.95, doc_date: '2023-03-01',
    family_id: FAMILY_ID, family_status: 'proposed', family_source: 'ai',
    created_at: '2026-09-21T12:29:52Z', classification_history: [] },
  { id: 'd2', review_id: REVIEW_ID, user_id: UID, intake_id: 'ik-2',
    file_name: 'Prime_Wellness_Spa_Lease.pdf', intake_kind: 'lease',
    parsing_status: 'success', byte_size: 3143,
    storage_path: 'leases/' + UID + '/acq_x_2-Prime_Wellness_Spa_Lease.pdf',
    doc_type: null, doc_type_status: 'unclassified',
    family_id: null, family_status: 'unfiled',
    created_at: '2026-09-21T12:30:54Z', classification_history: [] },
  { id: 'd3', review_id: REVIEW_ID, user_id: UID, intake_id: 'ik-3',
    file_name: 'ShopRite_Anchor_Tenant_Lease.pdf', intake_kind: 'lease',
    parsing_status: 'success', byte_size: 33098,
    storage_path: 'leases/' + UID + '/acq_x_3-ShopRite_Anchor_Tenant_Lease.pdf',
    doc_type: 'amendment', doc_type_status: 'proposed', doc_type_source: 'ai',
    doc_date: '2024-05-01', parent_document_id: 'd1', relationship: 'amends',
    relationship_status: 'proposed',
    family_id: FAMILY_ID, family_status: 'proposed', family_source: 'ai',
    created_at: '2026-09-21T12:31:02Z', classification_history: [] },
];
const FAMILIES = [{ id: FAMILY_ID, review_id: REVIEW_ID, label: 'SafeShield Insurance', tenant_hint: 'SafeShield Insurance' }];

const DB = `
(function(){
  var U = { id: '${UID}', email: 'pm@example.com' };
  function P(v) { return Promise.resolve(v); }
  function q() {
    var api = {
      select: function () { return api; }, eq: function () { return api; },
      neq: function () { return api; }, is: function () { return api; },
      not: function () { return api; }, in: function () { return api; },
      order: function () { return api; }, limit: function () { return api; },
      ilike: function () { return api; },
      single: function () { return P({ data: null, error: null }); },
      maybeSingle: function () { return P({ data: null, error: null }); },
      update: function () { return api; },
      insert: function () { var p = P({ data: [], error: null }); p.select = function () { return P({ data: [], error: null }); }; return p; },
      upsert: function () { var p = P({ data: [], error: null }); p.select = function () { return P({ data: [], error: null }); }; return p; },
      delete: function () { return { eq: function () { return P({ error: null }); }, in: function () { return P({ error: null }); } }; },
      then: function (res, rej) { return P({ data: [], error: null }).then(res, rej); },
    };
    return api;
  }
  window.supabase = { createClient: function () { return {
    auth: {
      getUser: function () { return P({ data: { user: U }, error: null }); },
      getSession: function () { return P({ data: { session: { user: U, access_token: 'tok' } }, error: null }); },
      onAuthStateChange: function (cb) { setTimeout(function () { try { cb('SIGNED_IN', { user: U }); } catch (_) {} }, 40);
        return { data: { subscription: { unsubscribe: function () {} } } }; },
      signOut: function () { return P({ error: null }); },
    },
    rpc: function () { return P({ data: null, error: null }); },
    from: q,
    storage: { from: function () { return { upload: function () { return P({ data: { path: 'x' }, error: null }); },
                                           getPublicUrl: function () { return { data: { publicUrl: '' } }; } }; } },
  }; } };
})();`;

// Measure the panel as the browser laid it out.
function measure(reviewId) {
  const el = document.getElementById('acqDocsList');
  const rows = [].slice.call(el.querySelectorAll('.acq-doc-row'));
  return {
    panelWidth: el.clientWidth,
    panelScrollWidth: el.scrollWidth,
    rows: rows.map(r => {
      const name = r.querySelector('.acq-doc-name');
      const main = r.querySelector('.acq-doc-main');
      const sel  = r.querySelector('.acq-doc-type');
      const open = r.querySelector('[data-doc-url]');
      const nb   = name ? name.getBoundingClientRect() : null;
      const cs   = name ? getComputedStyle(name) : null;
      const lh   = cs ? (parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2) : 0;
      return {
        text: name ? name.textContent.trim() : '',
        nameWidth: nb ? Math.round(nb.width) : 0,
        nameHeight: nb ? Math.round(nb.height) : 0,
        lines: (nb && lh) ? Math.round(nb.height / lh) : 0,
        mainWidth: main ? Math.round(main.getBoundingClientRect().width) : 0,
        rowWidth: Math.round(r.getBoundingClientRect().width),
        hasSelect: !!sel,
        selectWidth: sel ? Math.round(sel.getBoundingClientRect().width) : 0,
        hasConfirm: !!r.querySelector('.acq-doc-confirm'),
        hasStatus: !!r.querySelector('.acq-doc-status'),
        hasClass: !!r.querySelector('.acq-doc-class'),
        hasOpen: !!open,
        openRight: open ? Math.round(open.getBoundingClientRect().right) : 0,
        // Same visual row as the name, or wrapped below it?
        controlsBelowName: !!(main && sel &&
          Math.round(sel.getBoundingClientRect().top) >= Math.round(main.getBoundingClientRect().bottom) - 2),
      };
    }),
  };
}

(async () => {
  const srv = http.createServer((rq, rs) => {
    let u = decodeURIComponent(rq.url.split('?')[0]);
    if (u === '/') u = '/index.html';
    if (u.startsWith('/api/')) { rs.writeHead(200, { 'Content-Type': 'application/json' }); rs.end('{}'); return; }
    fs.readFile(path.join(ROOT, u), (e, d) => {
      if (e) { rs.writeHead(404); rs.end(); return; }
      rs.writeHead(200, { 'Content-Type': MIME[path.extname(u)] || 'application/octet-stream' }); rs.end(d);
    });
  });
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));

  const browser = await pw.chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const errs = [];

  // Render the panel at a given viewport and hand back its geometry.
  async function renderAt(width, height, mobile) {
    const ctx = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: mobile ? 3 : 1,
      isMobile: !!mobile, hasTouch: !!mobile,
    });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(String(e.message).split('\n')[0]));
    page.on('dialog', d => d.dismiss().catch(() => {}));
    await page.route('**cdnjs**',    r => r.fulfill({ status: 200, body: '/*x*/' }));
    await page.route('**jsdelivr**', r => r.fulfill({ status: 200, body: '/*x*/' }));
    await page.route('**fonts.g**',  r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.addInitScript(DB);
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2200);
    await page.evaluate(() => {
      const w = document.getElementById('obWelcomeModal');
      if (w && w.style.display !== 'none') { if (typeof obCloseWelcome === 'function') obCloseWelcome('skip'); else w.style.display = 'none'; }
    });
    // Seed the caches the renderer reads and call the REAL renderer.
    //
    // The panel then has to be LAID OUT, not merely present: a hidden element
    // reports every rectangle as zero, and a geometry test that measures zeros
    // passes everything it should catch. So the ancestor chain is revealed and
    // the width is asserted before anything is measured.
    await page.evaluate(({ rid, docs, fams }) => {
      _activeAcqId = rid;
      _acqDocs.set(rid, docs);
      _acqFamilies.set(rid, fams);
      _acqDocsUnavailable = false;
      _renderAcqDocuments();
      for (let el = document.getElementById('acqDocsList'); el && el !== document.body; el = el.parentElement) {
        if (getComputedStyle(el).display === 'none') el.style.display = 'block';
        if (getComputedStyle(el).visibility === 'hidden') el.style.visibility = 'visible';
      }
    }, { rid: REVIEW_ID, docs: DOCS, fams: FAMILIES });
    await page.waitForTimeout(250);
    const m = await page.evaluate(measure, REVIEW_ID);
    m.laidOut = m.panelWidth > 0;
    const shot = `/tmp/claude-0/-home-user-mainstreet-xrpl/dc0a26be-962b-5d11-abc8-f6dbe11d73db/scratchpad/acq-docs-${width}x${height}.png`;
    try { await page.locator('#acqDocsList').screenshot({ path: shot }); } catch (_) {}
    await ctx.close();
    return m;
  }

  console.log('\nAcquisition Documents panel — narrow viewports\n' + '='.repeat(64));

  // ── iPhone widths ────────────────────────────────────────────────────────
  for (const [w, h, label] of [[375, 667, 'iPhone SE'], [390, 844, 'iPhone 14'], [430, 932, 'iPhone 14 Pro Max']]) {
    const m = await renderAt(w, h, true);
    const tag = `${label} ${w}×${h}`;

    check(`${tag}: the panel is actually laid out`, m.laidOut,
          `panel width ${m.panelWidth}px — a hidden panel measures zero and proves nothing`);
    check(`${tag}: all three documents render`, m.rows.length === 3, `${m.rows.length} rows`);
    if (!m.laidOut || m.rows.length !== 3) continue;

    const narrowest = Math.min(...m.rows.map(r => r.nameWidth));
    const tallest   = Math.max(...m.rows.map(r => r.lines));
    const names     = m.rows.map(r => r.text);

    check(`${tag}: the file name column has usable width`,
          narrowest >= 150, `narrowest name box ${narrowest}px of ${m.panelWidth}px panel`);
    check(`${tag}: names read on a couple of lines, not one character per line`,
          tallest <= 3, `worst name wraps to ${tallest} lines`);
    check(`${tag}: the three real file names are intact`,
          names.includes('SafeShield_Insurance_Lease.pdf')
          && names.includes('Prime_Wellness_Spa_Lease.pdf')
          && names.includes('ShopRite_Anchor_Tenant_Lease.pdf'),
          names.join(' | '));
    check(`${tag}: every row keeps its type control and status`,
          m.rows.every(r => r.hasSelect && r.hasStatus && r.hasClass),
          `${m.rows.filter(r => r.hasSelect).length}/3 type controls, ${m.rows.filter(r => r.hasStatus).length}/3 statuses`);
    check(`${tag}: every row still opens its original`,
          m.rows.every(r => r.hasOpen), `${m.rows.filter(r => r.hasOpen).length}/3 openers`);
    check(`${tag}: the proposed rows still offer Confirm`,
          m.rows.filter(r => r.hasConfirm).length === 2,
          `${m.rows.filter(r => r.hasConfirm).length} Confirm buttons`);
    check(`${tag}: the panel does not scroll sideways`,
          m.panelScrollWidth <= m.panelWidth + 1, `content ${m.panelScrollWidth}px in a ${m.panelWidth}px panel`);
    check(`${tag}: nothing overflows the panel's right edge`,
          m.rows.every(r => r.openRight <= m.panelWidth + 24),
          `furthest control at ${Math.max(...m.rows.map(r => r.openRight))}px`);
    check(`${tag}: the controls sit BELOW the name rather than squeezing it`,
          m.rows.every(r => r.controlsBelowName), `${m.rows.filter(r => r.controlsBelowName).length}/3 rows put the controls on their own line`);
  }

  // ── desktop must be unchanged ────────────────────────────────────────────
  const d = await renderAt(1280, 900, false);
  check('desktop 1280×900: the panel is actually laid out', d.laidOut, `panel width ${d.panelWidth}px`);
  check('desktop 1280×900: all three documents render', d.rows.length === 3, `${d.rows.length} rows`);
  check('desktop 1280×900: name and controls stay on ONE row',
        d.rows.every(r => !r.controlsBelowName), `${d.rows.filter(r => !r.controlsBelowName).length}/3 rows single-line`);
  check('desktop 1280×900: the name column is wide',
        Math.min(...d.rows.map(r => r.nameWidth)) >= 400,
        `narrowest ${Math.min(...d.rows.map(r => r.nameWidth))}px`);
  check('desktop 1280×900: every control is still there',
        d.rows.every(r => r.hasSelect && r.hasStatus && r.hasClass && r.hasOpen),
        'type control, status, classification label and opener on all 3');

  check('no uncaught errors while rendering', errs.length === 0, errs.slice(0, 3).join(' | ') || 'clean');

  await browser.close(); srv.close();

  const failed = results.filter(r => !r.ok);
  console.log('='.repeat(64));
  console.log(`${results.length - failed.length}/${results.length} passed`);
  if (failed.length) { console.log('FAILED:'); failed.forEach(f => console.log('  - ' + f.name + ' :: ' + f.detail)); }
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
