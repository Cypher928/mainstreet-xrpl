'use strict';
/**
 * test-acquisition-intake.js — Acquisition Intake: the front door (I-1).
 *
 *   node test-acquisition-intake.js
 *
 * Reads script.js, index.html and test-regression.js as text (comments
 * stripped, so a fix's own explanation cannot satisfy an assertion) and pins
 * the Properties step to the rules I-1 exists for:
 *
 *   - every acquisition starts here, one property or many;
 *   - each property is created as a PROSPECT through begin_acquisition by the
 *     ONE creation path "+ New Review" shares, one after another, never all at
 *     once;
 *   - a failure stops the sequence at the row it hit; what was created is
 *     kept, the failed row keeps its text and its reason, and Create again
 *     continues from it;
 *   - the address is review-scoped evidence (data.address), never a property
 *     column or a tenant; nothing is written to a document, a property or a
 *     tenant from the front door;
 *   - the Acquisitions section is shown to a brand-new account, so a first
 *     acquisition can begin before any managed property exists;
 *   - nothing is preselected or pre-created.
 *
 * The browser half is test-e2e-acquisition-intake.js.
 */
const fs   = require('fs');
const path = require('path');
const ROOT = __dirname;
const { fnSource } = require('./test-support/fn-source.js');

let pass = 0, fail = 0;
const failures = [];
function t(name, fn) {
  try { fn(); pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  catch (e) { fail++; failures.push(`${name}: ${e.message}`); console.log(`  \x1b[31m✗\x1b[0m ${name}\n      → ${e.message}`); }
}
const ok = (c, m) => { if (!c) throw new Error(m || 'expected truthy'); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m || ''} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
function sec(s) { console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 60 - s.length))); }

function stripComments(src) {
  return src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*|--)/.test(l)).join('\n');
}
function code(relPath) { return stripComments(fs.readFileSync(path.join(ROOT, relPath), 'utf8')); }
// Brace-matched, comments stripped: what a function DOES.
function fnBody(src, name) { return stripComments(fnSource(src, name)); }

const RAW = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
const S   = stripComments(RAW);
const H   = code('index.html');
const R   = code('test-regression.js');

// The Intake block, by its markers (comment lines — read from the raw source),
// then comments stripped so only code is pinned.
const START = '// ── Acquisition Intake (I-1): the front door — properties ──';
const END   = '// ── end of Acquisition Intake (I-1) ──';
const BLOCK = stripComments(RAW.slice(RAW.indexOf(START), RAW.indexOf(END)));

sec('I-1: the front door — properties, one or many');

t('the Intake block exists, bounded by its markers, between the creation path and the review opener', () => {
  ok(RAW.indexOf(START) > -1 && RAW.indexOf(END) > RAW.indexOf(START), 'markers');
  ok(BLOCK.length > 2000, 'the block is shorter than expected');
  ok(RAW.indexOf('async function _acqCreateProspect(') < RAW.indexOf(START), 'the creation path precedes the block');
  ok(RAW.indexOf(END) < RAW.indexOf('function selectAcquisitionReview('), 'the block precedes the review opener');
});

t('one creation path: "+ New Review" and the Intake both create through _acqCreateProspect, which calls begin_acquisition', () => {
  const create = fnBody(S, '_acqCreateProspect');
  ok(create.includes("db.rpc('begin_acquisition', { p_name: review.name, p_data: review.data })"), 'begin_acquisition is not called with the name and the data');
  eq((S.match(/db\.rpc\('begin_acquisition'/g) || []).length, 2, 'begin_acquisition callers in script.js (the creation path and the demo seed)');
  ok(fnBody(S, 'createAcquisitionReview').includes('await _acqCreateProspect(name, null)'), '"+ New Review" does not go through the one path');
  ok(fnBody(S, 'acqIntakeCreate').includes("await _acqCreateProspect(row.name.trim(), { address: row.address.trim() || null })"), 'the Intake does not go through the one path');
  ok(create.includes("_acqRecord(review, { type: 'review_created'"), 'creation is not recorded on the review');
  ok(create.includes('_acqRevs.set(id, review.updated_at)') && create.includes('_acqReviews.unshift(review)'), 'the created review is not adopted');
  ok(create.includes('return { ok: true, review }') && /return \{ ok: false, error: /.test(create), 'the path does not answer ok / error');
});

t('the prospects are created one after another, never all at once; a failure stops the sequence where it hit', () => {
  const c = fnBody(S, 'acqIntakeCreate');
  ok(/for \(const row of named\) \{/.test(c), 'no sequential loop');
  ok(!/Promise\.all/.test(c), 'the rows are created all at once');
  ok(c.includes("if (!r.ok) { row.state = 'failed'; row.error = r.error; stoppedAt = row; break; }"), 'a failure does not stop the sequence');
  ok(c.includes("row.state = 'created'; row.reviewId = r.review.id; created++;"), 'a created row is not marked');
  ok(c.includes('if (_acqIntakeBusy) return;') && c.includes('_acqIntakeBusy = true;') && c.includes('_acqIntakeBusy = false;'), 'two Creates can run at once');
});

t('partial failure is recoverable: created rows are kept, the failed row keeps its text and its reason, Create again continues from it', () => {
  const c = fnBody(S, 'acqIntakeCreate');
  ok(c.includes("const pending = _acqIntakeRows.filter(r => r.state !== 'created');"), 'Create again does not start from what is not yet created');
  ok(!/_acqIntakeRows = \[\]/.test(c), 'the rows are wiped after a Create');
  ok(c.includes('Stopped at') && c.includes('press Create again'), 'the status does not say where it stopped and what to do');
  ok(c.includes('already created') && c.includes('kept'), 'the status does not say that what was created is kept');
  const e = fnBody(S, 'acqIntakeEdit');
  ok(e.includes("if (!row || row.state === 'created' || row.state === 'creating') return;"), 'a created or in-flight row can be edited');
  ok(!/_renderAcqIntake\(\)/.test(e), 'typing redraws the rows under the cursor');
  const rm = fnBody(S, 'acqIntakeRemoveRow');
  ok(rm.includes("_acqIntakeRows[i].state === 'created'"), 'a created row can be removed from the list');
});

t('the address is review-scoped evidence: it goes into the review data and never into a property column or a tenant', () => {
  const create = fnBody(S, '_acqCreateProspect');
  const ev = fnBody(S, '_acqIntakeEvidence');
  ok(ev.includes('out.address = address') && ev.includes('.trim()'), 'the address is not kept as evidence');
  ok(create.includes('Object.assign(_AW().newReviewData(), _acqIntakeEvidence(evidence))'), 'the evidence is not folded into the new review data');
  const front = BLOCK + create + ev;
  ok(!/from\('properties'\)|from\('tenants'\)|from\('acquisition_documents'\)|from\('acquisition_document_families'\)|\/api\/upload|\/api\/claude/.test(front),
     'the front door writes or reads a property, tenant or document directly');
  ok(!/\.update\(|\.insert\(|\.upsert\(|\.delete\(/.test(front), 'a direct table write in the front door');
  ok(!/_acqSaveDocument|_acqStoreOriginal|_acqFileLease|_acqFileOther|acquire_property/.test(front), 'the front door files a document or acquires');
});

t('the Acquisitions section is shown for a zero-property account', () => {
  const rp = fnBody(S, 'renderPortfolio');
  ok(rp.includes("_tglEmpty('#acqSection', true)"), 'the section is still hidden until a property exists');
  ok(!/_tglEmpty\('#acqSection', _hasAny/.test(rp), 'the old rule is still there');
});

t('open prospects exclude converted (closed) acquisitions, and the count on screen is theirs', () => {
  const op = fnBody(S, '_acqIntakeOpenProspects');
  ok(op.includes("r.status !== 'converted' && !_acqFrozen(r)"), 'a closed acquisition counts as an open prospect');
  const r = fnBody(S, '_renderAcqIntake');
  ok(r.includes('const open = _acqIntakeOpenProspects();') && r.includes("countEl.textContent = String(open.length)"), 'the count is not the open prospects');
});

t('the screen: "+ New Acquisition" opens the Intake; the panel has the Properties step, the rows, Create, the count, a status line and a way back', () => {
  ok(/class="acq-new-btn acq-intake-start" onclick="openAcquisitionIntake\(\)"/.test(H), 'the header control does not open the Intake');
  ok(/\+ New Acquisition/.test(H), 'the control is not called New Acquisition');
  ok(!/onclick="createAcquisitionReview\(\)"/.test(H), 'the prompt path is still a screen control');
  for (const id of ['acqIntakePanel', 'acqIntakeProperties', 'acqIntakeRows', 'acqIntakeCreateBtn', 'acqIntakeAddRowBtn', 'acqIntakeProspectCount', 'acqIntakeProspectList', 'acqIntakeStatus']) {
    ok(new RegExp('id="' + id + '"').test(H), 'missing #' + id);
  }
  ok(/id="acqIntakeBackBtn" onclick="closeAcquisitionIntake\(\)"/.test(H), 'no way back');
  ok(/id="acqIntakeCreateBtn" onclick="acqIntakeCreate\(\)" disabled/.test(H), 'Create is enabled before anything is named');
  ok(/id="acqIntakeStatus" role="status" aria-live="polite"/.test(H), 'the status line is not announced');
});

t('opening the Intake shows its panel and nothing else, and puts the cursor in the first name; leaving returns to the Acquisitions section', () => {
  const o = fnBody(S, 'openAcquisitionIntake');
  ok(o.includes("document.getElementById('acqIntakePanel').style.display     = 'block'"), 'the panel is not shown');
  for (const id of ['portfolioDashboard', 'acqDetailPanel', 'propertyBreadcrumb', 'propertyWorkspaceNavCard', 'mainWorkflow']) {
    ok(o.includes(`document.getElementById('${id}').style.display`) && new RegExp(`'${id}'\\)\\.style\\.display\\s*= 'none'`).test(o), id + ' is left on screen');
  }
  ok(o.includes('input[data-field="name"]') && o.includes('.focus()'), 'the first name is not focused');
  ok(o.includes("if (!_acqIntakeRows.some(r => r.state !== 'created')) _acqIntakeRows.push(_acqIntakeNewRow());"), 'an empty row is not offered');
  const c = fnBody(S, 'closeAcquisitionIntake');
  ok(c.includes("document.getElementById('acqIntakePanel').style.display     = 'none'") && c.includes("document.getElementById('portfolioDashboard').style.display = 'block'"), 'leaving does not return to the portfolio');
  ok(c.includes('_renderAcqSection(_acqReviews)'), 'the Acquisitions section is not redrawn on return');
});

t('nothing is preselected or pre-created: a fresh row is empty, and Create is disabled until a property is named', () => {
  ok(fnBody(S, '_acqIntakeNewRow').includes("name: '', address: '', state: 'new', error: null, reviewId: null"), 'a fresh row is not empty');
  const b = fnBody(S, '_acqIntakeUpdateCreateBtn');
  ok(b.includes("const n = _acqIntakeRows.filter(r => r.state !== 'created' && r.name.trim()).length;") && b.includes('btn.disabled = _acqIntakeBusy || n === 0'), 'Create is not disabled while nothing is named');
  const c = fnBody(S, 'acqIntakeCreate');
  ok(c.includes("const unnamed = pending.filter(r => !r.name.trim() && r.address.trim());") && c.includes('Name this property, or clear its address.'), 'an address without a name is sent');
});

t('the rows render what the model holds — name, address, state, the reason — and a created row offers to open its review', () => {
  const r = fnBody(S, '_renderAcqIntake');
  ok(r.includes('data-row="${id}" data-state="${esc(row.state)}"') && r.includes('data-state="created"'), 'the row state is not on the element');
  ok(r.includes('input type="text" data-field="name" value="${esc(row.name)}"') && r.includes('input type="text" data-field="address" value="${esc(row.address)}"'), 'the inputs do not carry the model');
  ok(r.includes('class="acq-intake-row-error" role="alert"'), 'a failed row does not say why');
  ok(r.includes(`onclick="selectAcquisitionReview('\${esc(row.reviewId)}')"`), 'a created row does not open its review');
  ok(!/selected|checked/.test(r), 'something is preselected');
});

t('a phone stacks the row, and the Intake controls are 44px there', () => {
  ok(/@media \(max-width: 720px\) \{\s*\.acq-intake-row \{ grid-template-columns: minmax\(0, 1fr\); align-items: stretch; \}\s*\.acq-intake-row-created \{ grid-template-columns: minmax\(0, 1fr\); \}/.test(H), 'the row does not stack');
  ok(/\.acq-intake-actions \.acq-btn \{ min-height: 44px;/.test(H), 'the controls are not 44px on a phone');
});

t('both halves are registered in the regression', () => {
  ok(R.includes("cmd: 'node test-acquisition-intake.js'"), 'this suite is not registered');
  ok(R.includes("cmd: 'node test-e2e-acquisition-intake.js'"), 'the browser walk is not registered');
});

// (uses the suite's helpers: t, ok, eq, sec, fnBody, S, RAW, H, R)

sec('I-2: documents held, read and classified in the tab — nothing filed');

const I2_START = '// ── Acquisition Intake (I-2): documents, held and read before any lane ──';
const I2 = stripComments(RAW.slice(RAW.indexOf(I2_START), RAW.indexOf(END)));

t('the Documents step is wired: the module is loaded after acquisition-documents.js, the step is drawn and armed when the Intake opens', () => {
  ok(RAW.indexOf(I2_START) > RAW.indexOf(START) && RAW.indexOf(I2_START) < RAW.indexOf(END), 'the I-2 block is not inside the Intake block');
  ok(I2.length > 4000, 'the I-2 block is shorter than expected');
  const scripts = [...H.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
  ok(scripts.indexOf('acquisition-intake.js') > scripts.indexOf('acquisition-documents.js') && scripts.indexOf('acquisition-intake.js') < scripts.indexOf('script.js'), 'load order: ' + scripts.filter(s => /acquisition|script\.js/.test(s)).join(' → '));
  const o = fnBody(S, 'openAcquisitionIntake');
  ok(o.includes('_acqIntakeDropHandlers();') && o.includes('_renderAcqIntakeDocs();'), 'opening the Intake does not draw or arm the Documents step');
});

t('one reader, one file at a time, in order; a 429 pauses the queue and re-queues the file', () => {
  const next = fnBody(S, '_acqIntakeReadNext');
  ok(next.includes('if (!AI || _acqIntakeReader.running || _acqIntakeReader.paused) return;'), 'a second reader can start');
  ok(next.includes('const next = AI.nextToRead(_acqIntakeHeld);') && next.includes('_acqIntakeReader.running = true;'), 'the module does not choose the next file');
  ok(next.includes('_acqIntakeReader.running = false;') && /_acqIntakeReadNext\(\);\s*\}\);/.test(next), 'the reader does not go on to the next file');
  const one = fnBody(S, '_acqIntakeReadOne');
  ok(one.includes("if (e && e.status === 429) {") && one.includes("AI.transition(item, 'requeue');") && one.includes('_acqIntakePause(e.retryAfterSec);'), 'a 429 does not re-queue and pause');
  ok(one.includes("AI.transition(item, 'classified', { reading: null });"), 'another classifier error is not a person\'s call');
  const pause = fnBody(S, '_acqIntakePause');
  ok(pause.includes('_acqIntakeReader.paused = true;') && pause.includes('_acqIntakeReader.resumeAt = Date.now() + secs * 1000;') && pause.includes('_acqIntakeReadNext();'), 'the pause does not resume');
});

t('reading: pdf.js for PDFs, text otherwise; images and scanned PDFs are never transcribed or classified here', () => {
  const one = fnBody(S, '_acqIntakeReadOne');
  ok(one.includes("if (item.image) {") && one.includes("textSource = 'image';"), 'an image is read');
  ok(one.includes("text = (await extractPdfText(item.file)) || '';"), 'a PDF is not read as the lease lane reads it');
  ok(one.includes("text = (await item.file.text()) || '';"), 'a text file is not read as text');
  ok(one.includes("if (item.state !== 'reading') return;"), 'a file the module gave to a person is sent to the classifier');
  ok(!/extractTextFromPdfDirect|callClaudeWithPdfDirect|\/api\/explain|lease_text_extraction|explainFetch/.test(I2), 'something in the Documents step transcribes');
  ok(one.includes("const live = () => !item.removed && item.readToken === token && item.state === 'reading';"), 'a read that lands late is applied');
  ok(one.includes("_acqClassifyDocument(item.text, item.name, { rethrow: true })"), 'the classifier is not asked to rethrow a 429');
});

t('the classifier rethrows ONLY a 429, ONLY when asked; every other caller still passes two arguments and gets null on failure', () => {
  const c = fnBody(S, '_acqClassifyDocument');
  ok(/^async function _acqClassifyDocument\(text, fileName, opts\)/m.test(S), 'no opts parameter');
  ok(c.includes('if (opts && opts.rethrow === true && e && e.status === 429) throw e;'), 'the rethrow is not exactly a 429 when asked');
  ok(c.includes('return null;') && c.indexOf('throw e;') < c.lastIndexOf('return null;'), 'other errors no longer return null');
  eq((S.match(/_acqClassifyDocument\(/g) || []).length, 4, 'call sites of _acqClassifyDocument (definition, the two-argument wrapper, the lease core, the Intake)');
  eq((S.match(/_acqClassifyDocument\([^;]*\{ rethrow: true \}\)/g) || []).length, 1, 'only the Intake opts in');
  ok(fnBody(S, '_acqFileLease').includes('_acqClassifyDocument(storedText, file.name);'), 'the lease core no longer passes two arguments');
  ok(S.includes('return _acqClassifyDocument(text, fileName);'), 'the wrapper no longer passes two arguments');
  const cf = fnBody(S, 'claudeFetch');
  ok(cf.includes('err.retryAfterSec = parsed && typeof parsed.retryAfter === \'number\' ? parsed.retryAfter : null;'), 'the server\'s retry interval is not carried');
});

t('nothing is filed from the Documents step: no document, family, review, property or storage write, no upload, no RPC', () => {
  ok(!/_acqSaveDocument|_acqStoreOriginal|_acqFileLease|_acqFileOther|_acqSupersedePrevious|_acqApplyClassification|_acqAbstractDocument/.test(I2), 'the Documents step files');
  // (Array.from is not a table read; db.from would be.)
  ok(!/(?<!Array)\.from\(|\.rpc\(|\.upsert\(|\.insert\(|\.update\(|\.delete\(|\/api\/upload|fetch\(/.test(I2), 'the Documents step writes or calls out');
  ok(I2.includes("_acqIntakeHeld[i].removed = true;") && I2.includes('_acqIntakeHeld.forEach(x => { x.removed = true; });'), 'a removed or cleared file can still land its read');
});

t('the drop accepts the union of the two lanes, refuses with reasons, holds duplicates left out, and warns past the upload limit', () => {
  const add = fnBody(S, 'acqIntakeAddFiles');
  ok(add.includes('const v = AI.accept({ name: f.name, type: f.type, size: f.size });') && add.includes("if (!v.ok) { _acqIntakeRefused.push({ name: f.name, reason: v.reason, hint: v.hint }); continue; }"), 'a refusal is not recorded with its reason');
  ok(add.includes("if (dup) { item.warnings.push(AI.WARN.DUPLICATE); item.duplicateOf = dup.itemId; AI.transition(item, 'leave_out'); }"), 'a duplicate is not left out');
  ok(add.includes("if (!sz.ok) item.warnings.push(AI.WARN.ORIGINAL_NOT_STORABLE);") && add.includes("_L.checkUploadSize(f.size, 'document')"), 'the upload limit is not a warning');
  ok(add.includes('if (_acqIntakeHeld.length >= AI.MAX_HELD) {'), 'the tab holds any number of files');
  ok(/id="acqIntakeFileInput" accept="\.pdf,\.txt,\.jpg,\.jpeg,\.png,\.webp" multiple/.test(H), 'the file control does not accept the union');
});

t('the Documents step markup: drop zone, status, summary, held and refused lists, Clear all', () => {
  for (const id of ['acqIntakeDocuments', 'acqIntakeDropZone', 'acqIntakeFileInput', 'acqIntakeReadStatus', 'acqIntakeDocSummary', 'acqIntakeHeld', 'acqIntakeRefused', 'acqIntakeDocActions', 'acqIntakeClearBtn']) {
    ok(new RegExp('id="' + id + '"').test(H), 'missing #' + id);
  }
  ok(/id="acqIntakeReadStatus" role="status" aria-live="polite"/.test(H), 'the reader\'s line is not announced');
  ok(/id="acqIntakeDocActions" style="display:none;"/.test(H), 'Clear all is shown before anything is held');
  ok(/onchange="acqIntakeAddFiles\(this\.files\); this\.value = '';"/.test(H), 'the same file cannot be dropped again after a Clear');
});

t('the row says who proposed the type and how sure, offers the picker where a person is needed, and Read again never for a human pick', () => {
  const row = fnBody(S, '_acqIntakeDocHtml');
  ok(row.includes('const d = AI.describe(item);') && row.includes('${esc(d.label)}') && row.includes('${esc(d.badge)}') && row.includes('${esc(d.note)}'), 'the row does not read the module\'s description');
  ok(row.includes("const canRetry = settled && item.type.source !== 'human';"), 'Read again is offered on a human pick');
  ok(row.includes("const settled = item.state !== 'queued' && item.state !== 'reading' && item.state !== 'left_out';"));
  ok(row.includes("AI.picksFor(item).map(t =>") && row.includes('<option value="">Choose a type…</option>'), 'the picker preselects or invents types');
  ok(row.includes('AI.laneLabel(item.lane)') && row.includes('AI.hintsFor(item.reading)'), 'the lane or the hints are not the module\'s');
  const sync = fnBody(S, '_acqIntakeSyncUnload');
  ok(sync.includes("window.addEventListener('beforeunload', _acqIntakeBeforeUnload)") && sync.includes("window.removeEventListener('beforeunload', _acqIntakeBeforeUnload)"), 'held files do not guard the tab');
});

t('the I-2 suites are registered', () => {
  ok(R.includes("cmd: 'node test-acquisition-intake-module.js'") && R.includes("cmd: 'node test-e2e-acquisition-intake-documents.js'"));
});

console.log('\n' + '─'.repeat(64));
console.log(`RESULT: ${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILED:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);
