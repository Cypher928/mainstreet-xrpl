// test-e2e-acquisition-intake-assignment.js
// ============================================================================
// Acquisition Intake — which property (I-3b): ten prospects, sixty documents.
//
// The module decides (acquisition-assignment.js); the screen shows it; a person
// assigns. This drops sixty files for ten prospects and checks the real UI:
// confident proposals with their reasons; ambiguous candidates with counts and
// no tick-boxes; no-match documents; genuinely multi-property documents with
// tick-boxes; nothing preselected anywhere; Accept, override (the evidence
// note stands), Clear; the validator's refusal; a bulk act; recompute after new
// evidence — a human assignment lends a sibling clue, a prospect created
// mid-batch turns a "none" into a proposal — with every earlier assignment
// unchanged; zero document writes; a phone width. File names are never
// evidence: one invoice is named after the wrong property.
//
// The Supabase stand-in is test-e2e-acquisition-intake.js's. The classifier
// answers from the text it is given.
//
// Run: node test-e2e-acquisition-intake-assignment.js
// ============================================================================
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = __dirname, PORT = 8933;
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
               '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg',
               '.svg':'image/svg+xml', '.pdf':'application/pdf', '.txt':'text/plain' };

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? '  — ' + String(detail).slice(0, 420) : ''));
}

// ── ten prospects, three tenants each; Harbor Cafe is a chain ────────────────
const PROPS = [
  { name: 'Maple Plaza',      address: '120 Maple Ave, Springfield', tenants: ['Harbor Cafe LLC', 'Coastal Outfitters Inc', 'Pine Dental PC'] },
  { name: 'Cedar Court',      address: '45 Cedar Ct, Springfield',   tenants: ['Fern Books LLC', 'Quill Stationers', 'Harbor Cafe LLC'] },   // Harbor Cafe is a chain
  { name: 'Harbor Point',     address: '8 Harbor Point Rd',          tenants: ['Lighthouse Optics Inc', 'Seabreeze Salon', 'Dockside Grill LLC'] },
  { name: 'Oak Ridge',        address: '300 Oak Ridge Blvd',         tenants: ['Summit Fitness LLC', 'Ridgeline Pharmacy', 'Acorn Pediatrics PC'] },
  { name: 'Pine Crossing',    address: '77 Pine Crossing Dr',        tenants: ['Evergreen Insurance', 'Timber Tacos LLC', 'Northwind Books'] },
  { name: 'Birch Commons',    address: '12 Birch Commons Ln',        tenants: ['Silverleaf Jewelers', 'Commons Cleaners Inc', 'Hearth Bakery LLC'] },
  { name: 'Elm Street Plaza', address: '900 Elm St',                 tenants: ['Elmwood Dental', 'Cobalt Comics LLC', 'Lantern Thai Kitchen'] },
  { name: 'Willow Park',      address: '5 Willow Park Way',          tenants: ['Parkside Vet PC', 'Willow Wellness Spa', 'Riverbend Tax Inc'] },
  { name: 'Aspen Row',        address: '410 Aspen Row',              tenants: ['Rowhouse Coffee LLC', 'Aspen Optical Inc', 'Granite Hardware'] },
  { name: 'Juniper Square',   address: '22 Juniper Sq',              tenants: ['Junction Burgers LLC', 'Square One Realty', 'Meadow Florist'] },
];
const NEW_PROSPECT = { name: 'Spruce Center', address: '61 Spruce Center Ave' };
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const PAD = '\n\nThe parties agree to the covenants, conditions and provisions set out in the schedules attached hereto. ';
const lease = (p, tenant) => `LEASE AGREEMENT\nThis Lease is made between ${p.name} Owner LLC (Landlord) and Tenant: ${tenant}\nPremises: Suite 110, ${p.name}, ${p.address}\nDated: 2023-03-01\nTerm: sixty (60) months commencing 2023-03-01.\nBase Rent: $2,400 per month.${PAD}`;
const amendment = (tenant) => `FIRST AMENDMENT TO LEASE\nThis Amendment is made between Landlord and Tenant: ${tenant}\nDated: 2024-05-01\nBase Rent is amended to $2,600 per month from 2024-06-01.${PAD}`;
const rentroll = (p) => `RENT ROLL AS OF 2024-06-30\n${p.name.toUpperCase()} - ${p.address}\nSuite 110 ${p.tenants[0]} $2,400\nSuite 120 ${p.tenants[1]} $4,100\nSuite 130 ${p.tenants[2]} $3,000${PAD}`;
const invoice = (i) => `INVOICE #44${i}\nLandscaping services - June\nAmount due: $1,250.00\nDated: 2024-07-02${PAD}`;
const statement = (p) => `OPERATING STATEMENT - ${p.name}\nFor the year ended 2023-12-31\nRental income by tenant: ${p.tenants[0]} 28,800; ${p.tenants[1]} 49,200; ${p.tenants[2]} 36,000.\nTotal 114,000.${PAD}`;
const FILES = [];
PROPS.forEach((p, i) => {
  const s = slug(p.name);
  FILES.push([`${s}-lease.txt`, lease(p, p.tenants[0])]);
  FILES.push([`${s}-amendment.txt`, amendment(p.tenants[1])]);
  FILES.push([`${s}-rentroll.txt`, rentroll(p)]);
  // the Maple invoice carries another property's name in its FILE NAME — file names are not evidence;
  // Cedar Court's own invoice takes a distinct name so the two are not held as duplicates
  FILES.push([i === 0 ? 'cedar-court-invoice.txt' : i === 1 ? 'cedar-court-june-invoice.txt' : `${s}-invoice.txt`, invoice(i)]);
  FILES.push([`${s}-statement.txt`, statement(p)]);
});
const [MAPLE, CEDAR, HARBOR, OAK, PINE, BIRCH, ELM, WILLOW, ASPEN, JUNIPER] = PROPS;
FILES.push(['portfolio-rentroll-a.txt', `RENT ROLL - PORTFOLIO AS OF 2024-06-30\n${MAPLE.name.toUpperCase()} - ${MAPLE.address}\nSuite 110 ${MAPLE.tenants[0]}\nSuite 120 ${MAPLE.tenants[1]}\nSuite 130 ${MAPLE.tenants[2]}\n${CEDAR.name.toUpperCase()} - ${CEDAR.address}\nSuite 1 ${CEDAR.tenants[0]}\nSuite 2 ${CEDAR.tenants[1]}\nSuite 3 ${CEDAR.tenants[2]}${PAD}`]);
FILES.push(['portfolio-rentroll-b.txt', `RENT ROLL - PORTFOLIO AS OF 2024-06-30\n${HARBOR.name.toUpperCase()} - ${HARBOR.address}\nSuite 1 ${HARBOR.tenants[0]}\nSuite 2 ${HARBOR.tenants[1]}\nSuite 3 ${HARBOR.tenants[2]}\n${OAK.name.toUpperCase()} - ${OAK.address}\nSuite 1 ${OAK.tenants[0]}\nSuite 2 ${OAK.tenants[1]}\nSuite 3 ${OAK.tenants[2]}${PAD}`]);
FILES.push(['psa-three.txt', `PURCHASE AND SALE AGREEMENT\nThe Properties: ${PINE.name}; ${BIRCH.name}; ${ELM.name}.\nPurchase price allocated among the Properties as set out in Schedule A.${PAD}`]);
FILES.push(['prior-location-lease.txt', `LEASE AGREEMENT\nLandlord: ${MAPLE.name} Owner LLC. Premises: Suite 120, ${MAPLE.name}, ${MAPLE.address}.\nTenant: ${MAPLE.tenants[1]}\nDated: 2024-09-01\nRecitals: Tenant formerly operated at ${CEDAR.name} and relocates to ${MAPLE.name} under this Lease.${PAD}`]);
FILES.push(['unknown-address-lease-a.txt', `LEASE AGREEMENT\nPremises: 77 Birch Road, Springfield.\nTenant: ${PINE.tenants[2]}\nDated: 2022-01-01${PAD}`]);
FILES.push(['unknown-address-lease-b.txt', `LEASE AGREEMENT\nPremises: 1500 Granite Parkway.\nTenant: ${ASPEN.tenants[2]}\nDated: 2022-01-01${PAD}`]);
FILES.push(['illegible-scan.txt', `ILLEGIBLE ILLEGIBLE ILLEGIBLE — scan residue — 0x00 0x00 ... nothing a reader can hold on to here, lines of noise.${PAD}`]);
FILES.push(['sibling-side-letter.txt', `SIDE LETTER\nBetween Landlord and Tenant: ${OAK.tenants[0]}\nregarding signage on the east elevation.${PAD}`]);
FILES.push(['meadow-letter.txt', `SIDE LETTER\nBetween Landlord and Tenant: ${JUNIPER.tenants[2]}\nregarding the holiday kiosk.${PAD}`]);
FILES.push(['meadow-notice.txt', `NOTICE TO TENANT\nTo Tenant: ${JUNIPER.tenants[2]}\nThe parking lot will be resurfaced on Monday.${PAD}`]);
if (FILES.length !== 60) throw new Error('fixture count ' + FILES.length);

// The classifier, answering from the TEXT it is given (never the file name).
function classify(text) {
  const who   = (text.match(/Tenant:\s*([^\n]+)/) || [])[1] || null;
  const dated = (text.match(/Dated:\s*(\d{4}-\d{2}-\d{2})/) || [])[1] || null;
  const r = (docType, conf, ev, extra) => Object.assign({ docType, docDate: dated, tenantName: who, suite: null, confidence: conf, evidence: ev }, extra || {});
  if (/ILLEGIBLE/.test(text))                    return r('unknown', 0.12, null, { tenantName: null, docDate: null });
  if (/FIRST AMENDMENT TO LEASE/.test(text))     return r('amendment', 0.88, 'FIRST AMENDMENT TO LEASE');
  if (/RENT ROLL/.test(text))                    return r('rent_roll', 0.94, 'RENT ROLL', { tenantName: null, docDate: '2024-06-30' });
  if (/PURCHASE AND SALE AGREEMENT/.test(text))  return r('psa', 0.93, 'PURCHASE AND SALE AGREEMENT', { tenantName: null });
  if (/OPERATING STATEMENT/.test(text))          return r('financial_statement', 0.9, 'OPERATING STATEMENT', { tenantName: null, docDate: '2023-12-31' });
  if (/INVOICE/.test(text))                      return r('invoice', 0.91, 'INVOICE', { tenantName: null });
  if (/SIDE LETTER/.test(text))                  return r('side_letter', 0.9, 'SIDE LETTER');
  if (/NOTICE TO TENANT/.test(text))             return r('other', 0.8, 'NOTICE TO TENANT');
  return r('original_lease', 0.95, 'LEASE AGREEMENT', { suite: (text.match(/Suite\s+(\w+)/) || [])[1] || null });
}

// The I-1 walk's stand-in, carried verbatim; its `${UID}` placeholder is filled in here as it is there,
// so the seeded rows (user 'u1') are the signed-in user's own and the ownership filter returns them.
const UID = 'u1';
const DB = fs.readFileSync(path.join(ROOT, 'test-e2e-acquisition-intake.js'), 'utf8').match(/const DB = `([\s\S]*?)`;\n/)[1].replace(/\$\{UID\}/g, UID);

(async () => {
  const net = { classify: [], upload: 0, explain: 0, other: [] };
  const srv = http.createServer((rq, rs) => {
    let u = decodeURIComponent(rq.url.split('?')[0]);
    if (u === '/') u = '/index.html';
    if (u.startsWith('/api/')) {
      if (u === '/api/upload') net.upload++; else if (u === '/api/explain') net.explain++; else if (u !== '/api/claude') net.other.push(u);
      rs.writeHead(200, { 'Content-Type': 'application/json' }); rs.end('{}'); return;
    }
    fs.readFile(path.join(ROOT, u), (e, d) => {
      if (e) { rs.writeHead(404); rs.end(); return; }
      rs.writeHead(200, { 'Content-Type': MIME[path.extname(u)] || 'application/octet-stream' }); rs.end(d);
    });
  });
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));
  const browser = await pw.chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const errs = [];

  async function boot(viewport) {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(String(e.message).split('\n')[0]));
    page.on('dialog', d => d.dismiss().catch(() => {}));
    for (const g of ['**cdnjs**', '**jsdelivr**']) await page.route(g, r => r.fulfill({ status: 200, body: '/*x*/' }));
    await page.route('**fonts.g**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.route('**/api/claude', async route => {
      const post = route.request().postData() || '';
      let body = {}; try { body = JSON.parse(post); } catch (_) {}
      const content = body.messages && body.messages[0] ? String(body.messages[0].content) : '';
      const fileName = (content.match(/File name \(context only, do not classify from it\): ([^\n]+)/) || [])[1] || '';
      const text = content.slice(content.indexOf('Document text:\n') + 15);
      net.classify.push({ fileName, task: body.task });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(classify(text)) });
    });
    await page.addInitScript(DB);
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2400);
    await page.evaluate(() => {
      const w = document.getElementById('obWelcomeModal');
      if (w && w.style.display !== 'none') { if (typeof obCloseWelcome === 'function') obCloseWelcome('skip'); else w.style.display = 'none'; }
    });
    return { ctx, page };
  }
  // Ten prospects through the one creation path, with their tenants, and what Maple already holds.
  async function seedProspects(page) {
    await page.evaluate(async (props) => {
      let seq = 0;
      for (const p of props) {
        const r = await _acqCreateProspect(p.name, { address: p.address });
        if (!r.ok) throw new Error('seed: ' + r.error);
        const tenants = p.tenants.map((t, i) => ({ tenant_name: t, suite: String(110 + 10 * i) }));
        r.review.data.tenants = tenants;
        const row = __store.acquisition_reviews.find(x => x.id === r.review.id);
        row.data.tenants = JSON.parse(JSON.stringify(tenants));
        if (p.name === 'Maple Plaza') {
          __store.acquisition_document_families.push({ id: 'fam-' + (++seq), review_id: r.review.id, user_id: 'u1', tenant_name: 'Harbor Cafe', status: 'confirmed', created_at: '2026-09-21T12:00:00Z' });
          __store.acquisition_documents.push({ id: 'doc-' + (++seq), review_id: r.review.id, user_id: 'u1', file_name: 'maple-plaza-lease.txt', intake_id: 'ik-seed', intake_kind: 'lease',
            parsing_status: 'success', doc_type: 'original_lease', doc_type_status: 'confirmed', doc_date: '2023-03-01', family_id: 'fam-1', family_status: 'confirmed',
            superseded_by_document_id: null, classification_history: [], created_at: '2026-09-21T12:31:02Z' });
        }
      }
      __writes.length = 0;
    }, PROPS);
    await page.waitForTimeout(300);
  }
  const idle = (page, timeout) => page.waitForFunction(() => !_acqIntakeReader.running && !_acqIntakeReader.paused && !_acqIntakeProfilesLoading
    && !_acqIntakeHeld.some(i => i.state === 'queued' || i.state === 'reading'), null, { timeout: timeout || 60000 }).catch(() => null);
  const vis = (page, sel) => page.evaluate((sel) => { const el = document.querySelector(sel); if (!el) return null;
    const cs = getComputedStyle(el); return cs.display !== 'none' && cs.visibility !== 'hidden' && el.getClientRects().length > 0; }, sel);
  const rowOf = (page, name) => page.evaluate((n) => { const it = _acqIntakeHeld.find(i => i.name === n); if (!it) return null;
    const el = document.querySelector(`.acq-intake-doc[data-item="${it.itemId}"]`); const prop = el && el.querySelector('.acq-intake-prop');
    return { id: it.itemId, state: prop ? prop.getAttribute('data-prop-state') : null, text: prop ? prop.innerText.replace(/\s+/g, ' ') : '',
             selects: prop ? Array.from(prop.querySelectorAll('select[data-prop]')).map(s => s.value) : [],
             accept: prop ? !!prop.querySelector('.acq-intake-prop-accept') : false, multi: prop ? prop.querySelectorAll('input[data-multi]').length : 0,
             assignment: it.assignment ? JSON.parse(JSON.stringify(it.assignment)) : null }; }, name);
  const counts = (page) => page.evaluate(() => { const c = {}; document.querySelectorAll('#acqIntakeHeld .acq-intake-prop').forEach(p => { const s = p.getAttribute('data-prop-state'); c[s] = (c[s] || 0) + 1; }); return c; });
  const noWrites = (page) => page.evaluate(() => ({ docs: __store.acquisition_documents.filter(d => !/^doc-/.test(d.id)).length, fams: __store.acquisition_document_families.filter(f => !/^fam-/.test(f.id)).length,
    writes: __writes.filter(w => /acquisition_documents|acquisition_document_families|acquisition_reviews|properties|storage/.test(w.table)).length,
    rpcs: Array.from(new Set(__rpcCalls.map(c => c.fn))) }));

  console.log('\nAcquisition Intake I-3b — ten properties, sixty documents\n' + '='.repeat(64));
  const { ctx, page } = await boot({ width: 1280, height: 1000 });
  await page.click('.acq-intake-start');
  await page.waitForTimeout(300);
  await seedProspects(page);
  await page.evaluate(() => openAcquisitionIntake());
  await page.waitForTimeout(200);
  check('ten open prospects are listed in the Properties step', (await page.$eval('#acqIntakeProspectCount', el => el.textContent)) === '10');

  // ── 1 · sixty files from disk ─────────────────────────────────────────────
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acq-intake-assign-'));
  const paths = FILES.map(([name, text]) => { const f = path.join(dir, name); fs.writeFileSync(f, text); return f; });
  await page.setInputFiles('#acqIntakeFileInput', paths);
  await idle(page, 90000);
  await page.waitForFunction(() => Object.keys(_acqIntakeDecisions).length >= 60, null, { timeout: 20000 }).catch(() => null);
  const c1 = await counts(page);
  check('sixty files are held and every one has the module\'s decision on screen', await page.evaluate(() => _acqIntakeHeld.length) === 60 && Object.values(c1).reduce((a, b) => a + b, 0) === 60, JSON.stringify(c1));
  check('thirty proposed: each property\'s lease, rent roll and statement', c1.proposed === 30, JSON.stringify(c1));
  check('sixteen candidates: ten amendments (one tenant), a prior-location lease, two unknown addresses, a sibling-only side letter, two files for one tenant', c1.candidates === 16, JSON.stringify(c1));
  check('three several: two portfolio rent rolls and a PSA naming three', c1.several === 3, JSON.stringify(c1));
  check('eleven none: ten invoices and an illegible scan', c1.none === 11, JSON.stringify(c1));
  check('exactly sixty classification calls, one per file', net.classify.length === 60, `${net.classify.length}`);
  const strip = await page.$eval('#acqIntakeByProperty', el => el.textContent);
  check('the By-property strip counts proposals per prospect and the three kinds of question', /Maple Plaza: 3 proposed/.test(strip) && /16 need a person/.test(strip) && /3 mention several/.test(strip) && /11 no property/.test(strip), strip);

  // ── 2 · nothing preselected, anywhere ─────────────────────────────────────
  const pre = await page.evaluate(() => ({
    selects: Array.from(document.querySelectorAll('#acqIntakeHeld select[data-prop]')).map(s => s.value).filter(Boolean).length,
    acceptsOutsideProposed: Array.from(document.querySelectorAll('#acqIntakeHeld .acq-intake-prop:not([data-prop-state="proposed"]) .acq-intake-prop-accept')).length,
    multiOutsideSeveral: Array.from(document.querySelectorAll('#acqIntakeHeld .acq-intake-prop:not([data-prop-state="several"]) input[data-multi]')).length,
    severalWithBoxes: Array.from(document.querySelectorAll('#acqIntakeHeld .acq-intake-prop[data-prop-state="several"]')).filter(p => p.querySelectorAll('input[data-multi]').length >= 2).length,
    assigned: _acqIntakeHeld.filter(i => i.assignment).length,
  }));
  check('no picker has a value, no Accept outside a proposal, no tick-boxes outside "several", and nothing is assigned', pre.selects === 0 && pre.acceptsOutsideProposed === 0 && pre.multiOutsideSeveral === 0 && pre.assigned === 0, JSON.stringify(pre));
  check('every "several" block offers tick-boxes for the properties it names', pre.severalWithBoxes === 3, JSON.stringify(pre));

  // ── 3 · the words ─────────────────────────────────────────────────────────
  const mapleLease = await rowOf(page, 'maple-plaza-lease.txt');
  check('a confident proposal: "Proposed: Maple Plaza" with the address reason and its snippet', mapleLease.state === 'proposed' && /Proposed: Maple Plaza/.test(mapleLease.text) && /Its address “120 Maple Ave, Springfield” appears \(“…?[^”]*120 Maple Ave[^”]*”\) — the address you gave\./.test(mapleLease.text), mapleLease.text.slice(0, 300));
  check('the chain tenant is explained as weak, and Cedar Court is a faint mention', /known here AND in another prospect \(a chain\), so weak/.test(mapleLease.text) && /Faint mention of Cedar Court/.test(mapleLease.text), mapleLease.text.slice(0, 400));
  check('a file already in the prospect is named: filing will supersede it', /A file named maple-plaza-lease\.txt is already in Maple Plaza; filing will supersede it/.test(mapleLease.text), mapleLease.text.slice(-300));
  const prior = await rowOf(page, 'prior-location-lease.txt');
  check('a lease that mentions a prior location is a question, never several: counts shown, no tick-boxes', prior.state === 'candidates' && /Could belong to Maple Plaza or Cedar Court — which is it\?/.test(prior.text)
        && /but an original lease covers one premises/.test(prior.text) && /Maple Plaza ×\d+, Cedar Court ×1/.test(prior.text) && prior.multi === 0, prior.text.slice(0, 400));
  const portfolio = await rowOf(page, 'portfolio-rentroll-a.txt');
  check('a portfolio rent roll naming two properties with their rosters is "several", with the reason', portfolio.state === 'several' && /Names 2 properties, and a rent roll can cover several — file it to each, or pick one\./.test(portfolio.text), portfolio.text.slice(0, 300));
  // I-3a follow-up F1: the roll's date ("AS OF 2024-06-30") ends the line above a property name — not an address.
  const cedarRoll0 = await rowOf(page, 'cedar-court-rentroll.txt');
  check('a date fragment above a property name is not reported as an unknown address (no "30 MAPLE PLAZA" / "30 CEDAR COURT")', !/Names an address not among your prospects/.test(portfolio.text) && !/Names an address not among your prospects/.test(cedarRoll0.text), (portfolio.text + ' || ' + cedarRoll0.text).slice(0, 500));
  const unknown = await rowOf(page, 'unknown-address-lease-a.txt');
  check('a lease at an address nobody has: a question, with the address named', unknown.state === 'candidates' && /Names an address not among your prospects: “77 Birch Road”/.test(unknown.text), unknown.text.slice(0, 300));
  const sib = await rowOf(page, 'sibling-side-letter.txt');
  check('a side letter whose only clue is the tenant: "only the tenant name points at Oak Ridge"', sib.state === 'candidates' && /Only the tenant name points at Oak Ridge — confirm it yourself\./.test(sib.text), sib.text.slice(0, 300));
  await page.click(`.acq-intake-doc[data-item="${sib.id}"] .acq-intake-prop-why`);
  await page.waitForTimeout(100);
  const sibWhy = await rowOf(page, 'sibling-side-letter.txt');
  check('"Why?" shows the sibling clue: the tenant also appears in the Oak Ridge lease, which names the prospect in its text', /also appears in oak-ridge-lease\.txt, which names this prospect in its text/.test(sibWhy.text), sibWhy.text.slice(-400));
  const inv = await rowOf(page, 'cedar-court-invoice.txt');
  check('a generic invoice named after another property is "none" — file names are not evidence', inv.state === 'none' && /No property is named in this document\./.test(inv.text) && !/Cedar Court/.test(inv.text.replace(/Choose a property…[\s\S]*$/, '')), inv.text.slice(0, 200));
  const ill = await rowOf(page, 'illegible-scan.txt');
  check('the illegible scan (needs a type) is "none" for property too', ill.state === 'none');

  // ── 4 · a person decides ──────────────────────────────────────────────────
  const writesBefore = (await noWrites(page)).writes;
  await page.click(`.acq-intake-doc[data-item="${mapleLease.id}"] .acq-intake-prop-accept`);
  await page.waitForTimeout(150);
  let r = await rowOf(page, 'maple-plaza-lease.txt');
  check('Accept records the proposal as the person\'s: "Assigned to Maple Plaza by you, as proposed"', r.state === 'assigned' && /Assigned to Maple Plaza by you, as proposed/.test(r.text)
        && r.assignment && r.assignment.by === 'human' && r.assignment.fromProposal === true && r.assignment.reviewIds.length === 1, JSON.stringify(r.assignment));
  const cedarRoll = await rowOf(page, 'cedar-court-rentroll.txt');
  const harborId = await page.evaluate(() => _acqIntakeProfiles.find(p => p.name === 'Harbor Point').reviewId);
  await page.selectOption(`.acq-intake-doc[data-item="${cedarRoll.id}"] select[data-prop]`, harborId);
  await page.waitForTimeout(150);
  r = await rowOf(page, 'cedar-court-rentroll.txt');
  check('choosing another property overrides the proposal, and the evidence note says the choice stands', r.state === 'assigned' && /Assigned to Harbor Point by you/.test(r.text) && !/as proposed/.test(r.text)
        && /The evidence points at Cedar Court — your choice stands\./.test(r.text) && r.assignment.fromProposal === false && r.assignment.proposedReviewId, r.text.slice(0, 300));
  await page.click(`.acq-intake-doc[data-item="${cedarRoll.id}"] .acq-intake-prop-clear`);
  await page.waitForTimeout(150);
  r = await rowOf(page, 'cedar-court-rentroll.txt');
  check('Clear returns the row to the proposal, unassigned', r.state === 'proposed' && r.assignment === null);
  await page.evaluate((id) => { document.querySelectorAll(`.acq-intake-doc[data-item="${id}"] input[data-multi]`).forEach(b => { b.checked = true; }); }, portfolio.id);
  await page.click(`.acq-intake-doc[data-item="${portfolio.id}"] .acq-intake-prop-multi-go`);
  await page.waitForTimeout(150);
  r = await rowOf(page, 'portfolio-rentroll-a.txt');
  // (the two are named in the candidates' order — a tie broken by review id, so either order is right)
  check('where several is allowed, ticking both files it to both — by the person', r.state === 'assigned' && r.assignment.reviewIds.length === 2 && /Assigned to (Maple Plaza and Cedar Court|Cedar Court and Maple Plaza) by you/.test(r.text), r.text.slice(0, 200));
  // (a held file carries no `assignment` until a person sets one; the screen reads it as absent either way)
  const refused = await page.evaluate((id) => { const it = _acqIntakeHeld.find(i => i.itemId === id); const ids = _acqIntakeProfiles.slice(0, 2).map(p => p.reviewId); const ok = _acqIntakeSetAssignment(it, ids); return { ok, assignment: it.assignment || null }; }, prior.id);
  check('where several is NOT allowed, the validator refuses two properties and nothing is assigned', refused.ok === false && refused.assignment === null, JSON.stringify(refused));

  // bulk: three invoices, one human act
  const invoices = await page.evaluate(() => _acqIntakeHeld.filter(i => /-invoice\.txt$/.test(i.name)).slice(0, 3).map(i => i.itemId));
  for (const id of invoices) await page.check(`.acq-intake-doc[data-item="${id}"] input[data-select]`);
  check('ticking files shows the bulk bar with the count', await vis(page, '#acqIntakeBulk') && /3 files ticked/.test(await page.$eval('#acqIntakeBulk', el => el.textContent)));
  const willowId = await page.evaluate(() => _acqIntakeProfiles.find(p => p.name === 'Willow Park').reviewId);
  await page.selectOption('#acqIntakeBulkSelect', willowId);
  await page.click('#acqIntakeBulkGo');
  await page.waitForTimeout(200);
  const bulk = await page.evaluate((ids) => ids.map(id => { const it = _acqIntakeHeld.find(i => i.itemId === id); return it.assignment && it.assignment.by === 'human' && it.assignment.reviewIds[0]; }), invoices);
  check('the bulk act assigns each ticked file, by the person, through the validator', bulk.every(x => x === willowId) && /Willow Park: 3 assigned/.test(await page.$eval('#acqIntakeByProperty', el => el.textContent)), JSON.stringify(bulk));

  // ── 5 · new evidence ──────────────────────────────────────────────────────
  // (a) a human assignment lends a sibling clue
  const letter = await rowOf(page, 'meadow-letter.txt'), notice0 = await rowOf(page, 'meadow-notice.txt');
  check('two files for one tenant with no names are both questions', letter.state === 'candidates' && notice0.state === 'candidates');
  const juniperId = await page.evaluate(() => _acqIntakeProfiles.find(p => p.name === 'Juniper Square').reviewId);
  await page.selectOption(`.acq-intake-doc[data-item="${letter.id}"] select[data-prop]`, juniperId);
  await page.waitForTimeout(150);
  await page.click(`.acq-intake-doc[data-item="${notice0.id}"] .acq-intake-prop-why`);
  await page.waitForTimeout(100);
  const notice1 = await rowOf(page, 'meadow-notice.txt');
  check('after the person assigns one, the other\'s evidence gains the sibling clue "which you assigned to this prospect" — and stays a question', notice1.state === 'candidates'
        && /also appears in meadow-letter\.txt, which you assigned to this prospect/.test(notice1.text) && /Only the tenant name points at Juniper Square/.test(notice1.text), notice1.text.slice(-400));
  // (b) a prospect created mid-batch turns a "none" into a proposal, with no new drop
  // (a tenant sharing no word with the thirty seeded tenants — a shared "Books" would be a weak similar-tenant clue, and a question)
  fs.writeFileSync(path.join(dir, 'spruce-center-lease.txt'), lease({ name: NEW_PROSPECT.name, address: NEW_PROSPECT.address }, 'Tidewater Yoga Studio'));
  await page.setInputFiles('#acqIntakeFileInput', [path.join(dir, 'spruce-center-lease.txt')]);
  await idle(page);
  const spruce0 = await rowOf(page, 'spruce-center-lease.txt');
  check('a lease for a property that is not yet a prospect is "none" (and names its address as unknown)', spruce0.state === 'none' && /Names an address not among your prospects: “61 Spruce Center Ave”/.test(spruce0.text), spruce0.text.slice(0, 300));
  const snapshotBefore = await page.evaluate(() => JSON.stringify(_acqIntakeHeld.filter(i => i.assignment).map(i => [i.name, i.assignment.reviewIds])));
  await page.fill('#acqIntakeRows .acq-intake-row:not(.acq-intake-row-created) input[data-field="name"]', NEW_PROSPECT.name);
  await page.fill('#acqIntakeRows .acq-intake-row:not(.acq-intake-row-created) input[data-field="address"]', NEW_PROSPECT.address);
  await page.click('#acqIntakeCreateBtn');
  await page.waitForFunction(() => _acqIntakeProfiles.some(p => p.name === 'Spruce Center') && !_acqIntakeProfilesLoading, null, { timeout: 10000 }).catch(() => null);
  await page.waitForTimeout(300);
  const spruce1 = await rowOf(page, 'spruce-center-lease.txt');
  check('creating the prospect recomputes: the held lease becomes "Proposed: Spruce Center" without a new drop', spruce1.state === 'proposed' && /Proposed: Spruce Center/.test(spruce1.text), spruce1.text.slice(0, 200));
  const snapshotAfter = await page.evaluate(() => JSON.stringify(_acqIntakeHeld.filter(i => i.assignment).map(i => [i.name, i.assignment.reviewIds])));
  check('every human assignment survived the recompute unchanged', snapshotBefore === snapshotAfter && JSON.parse(snapshotAfter).length === 6, snapshotAfter.slice(0, 160));
  check('the Properties step now lists eleven', (await page.$eval('#acqIntakeProspectCount', el => el.textContent)) === '11');

  // ── 6 · zero writes ───────────────────────────────────────────────────────
  const nw = await noWrites(page);
  check('nothing was written: no document row, family, review save, storage object, upload or transcription; the only RPC is begin_acquisition',
        nw.writes === 0 && writesBefore === 0 && nw.docs === 0 && nw.fams === 0 && net.upload === 0 && net.explain === 0 && net.other.length === 0 && nw.rpcs.join(',') === 'begin_acquisition', JSON.stringify(nw) + ` upload=${net.upload} explain=${net.explain}`);
  fs.rmSync(dir, { recursive: true, force: true });

  // ── 7 · a phone ──────────────────────────────────────────────────────────
  const m = await boot({ width: 390, height: 844 });
  await m.page.click('.acq-intake-start');
  await m.page.waitForTimeout(300);
  await seedProspects(m.page);
  await m.page.evaluate(() => openAcquisitionIntake());
  await m.page.setInputFiles('#acqIntakeFileInput', [{ name: 'maple-plaza-lease.txt', mimeType: 'text/plain', buffer: Buffer.from(lease(MAPLE, MAPLE.tenants[0])) }]);
  await idle(m.page);
  const geo = await m.page.evaluate(() => {
    const prop = document.querySelector('#acqIntakeHeld .acq-intake-prop');
    const acc = prop && prop.querySelector('.acq-intake-prop-accept'), sel = prop && prop.querySelector('select[data-prop]');
    return { state: prop && prop.getAttribute('data-prop-state'), scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth,
             acceptH: acc ? acc.getBoundingClientRect().height : 0, stacked: acc && sel ? sel.getBoundingClientRect().top >= acc.getBoundingClientRect().bottom - 1 : false,
             propW: prop ? prop.getBoundingClientRect().width : 0 };
  });
  check('phone: the proposal block fits, its controls stack, Accept is 44px', geo.state === 'proposed' && geo.scrollW <= geo.innerW + 1 && geo.acceptH >= 44 && geo.stacked && geo.propW > 280, JSON.stringify(geo));
  await m.ctx.close();

  check('no uncaught errors', errs.length === 0, errs.slice(0, 3).join(' | ') || 'clean');

  await ctx.close(); await browser.close(); srv.close();
  const failed = results.filter(x => !x.ok);
  console.log('='.repeat(64));
  console.log(`${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
