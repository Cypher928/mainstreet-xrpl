'use strict';
/**
 * test-acquisition-intake-module.js — Acquisition Intake (I-2): the rules a held
 * document follows, driven on the real module.
 *
 *   node test-acquisition-intake-module.js
 *
 * acquisition-intake.js decides what a dropped file becomes while it is held in
 * the tab: accepted or refused; read or never read (an image, a scan); classified
 * or waiting for a person; which lane its type goes to when filed; what the row
 * says and who proposed the type. This drives every rule with fixtures, and holds
 * the module's type table equal to acquisition-documents.js's.
 */
const fs = require('fs'), path = require('path');
const ROOT = __dirname;
const AI = require('./acquisition-intake.js');
const AD = require('./acquisition-documents.js');

let pass = 0, fail = 0;
const failures = [];
function t(name, fn) {
  try { fn(); pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  catch (e) { fail++; failures.push(`${name}: ${e.message}`); console.log(`  \x1b[31m✗\x1b[0m ${name}\n      → ${e.message}`); }
}
const ok = (c, m) => { if (!c) throw new Error(m || 'expected truthy'); };
const eq = (a, b, m) => { const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error(`${m || ''} expected ${B}, got ${A}`); };
const throws = (fn, m) => { let threw = false; try { fn(); } catch (_) { threw = true; } if (!threw) throw new Error(m || 'expected a throw'); };
function sec(s) { console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 60 - s.length))); }

const file = (name, type, size) => ({ name, type, size });
const held = (name, ext, extra) => Object.assign(AI.newItem({ name, type: '', size: 1000, ext }), extra || {});
const LETTERS = (n) => 'a'.repeat(n);
const PAGE = (n, text) => `--- Page ${n} ---\n${text}`;

sec('what may be dropped');

t('the accept list is the union of the two lanes: PDF and text from the lease lane, the images from the documents lane', () => {
  eq(Object.keys(AI.ACCEPT).sort(), ['jpeg', 'jpg', 'pdf', 'png', 'txt', 'webp']);
  eq(AI.ACCEPT_ATTR, '.pdf,.txt,.jpg,.jpeg,.png,.webp');
  for (const [n, ty] of [['a.pdf', 'application/pdf'], ['a.txt', 'text/plain'], ['a.jpg', 'image/jpeg'], ['a.jpeg', 'image/jpeg'], ['a.png', 'image/png'], ['a.webp', 'image/webp']]) {
    ok(AI.accept(file(n, ty, 10)).ok, n);
  }
  ok(AI.accept(file('a.PDF', 'application/pdf', 10)).ok, 'case-insensitive extension');
  ok(AI.accept(file('a.txt', '', 10)).ok, 'a missing MIME is allowed');
  eq(AI.accept(file('a.png', 'image/png', 10)).image, true, 'an image is marked as one');
});

t('a spreadsheet, a Word file or an unknown extension is refused, named, with a hint', () => {
  for (const n of ['rent.xlsx', 'lease.docx', 'notes', 'a.exe', 'a.csv']) {
    const v = AI.accept(file(n, '', 10));
    eq(v.ok, false, n);
    ok(/not a document Intake reads/.test(v.reason), v.reason);
    ok(/PDF, a text file, or a JPG, PNG or WebP/.test(v.hint), v.hint);
  }
});

t('the MIME type must agree with the extension when one is given', () => {
  const v = AI.accept(file('lease.pdf', 'image/png', 10));
  eq(v.ok, false);
  ok(/says it is image\/png, not a \.pdf/.test(v.reason), v.reason);
  eq(AI.accept(file('scan.jpg', 'image/jpeg', 10)).ok, true);
  eq(AI.accept(file('scan.jpg', 'image/png', 10)).ok, false, 'a .jpg that says png');
});

t('an empty file is refused; a size that cannot be read is refused', () => {
  const v = AI.accept(file('a.pdf', 'application/pdf', 0));
  eq(v.ok, false); ok(/empty/.test(v.reason), v.reason);
  eq(AI.accept(file('a.pdf', 'application/pdf', NaN)).ok, false);
  eq(AI.accept(file('a.pdf', 'application/pdf', -1)).ok, false);
});

t('a new item is queued, typeless, laneless, with nothing read and nothing warned', () => {
  const it = AI.newItem({ name: 'x.pdf', type: 'application/pdf', size: 5, ext: 'pdf' });
  eq(it.state, 'queued'); eq(it.type, { value: null, source: null, confidence: null, evidence: null });
  eq(it.lane, null); eq(it.text, ''); eq(it.warnings, []); eq(it.attempts, 0); eq(it.aiType, null);
  ok(/^held-[a-z0-9]+-\d+-[a-z0-9]+$/.test(it.itemId), it.itemId);
  const other = AI.newItem({ name: 'x.pdf', type: 'application/pdf', size: 5, ext: 'pdf' });
  ok(it.itemId !== other.itemId, 'two items share an id');
  eq(AI.newItem({ name: 'p.png', size: 5 }).image, true, 'the extension is read from the name when not given');
});

t('a duplicate is the same name AND the same size, already held — the earlier one', () => {
  const a = held('lease.pdf', 'pdf', { bytes: 100 }), b = held('lease.pdf', 'pdf', { bytes: 100 }), c = held('lease.pdf', 'pdf', { bytes: 101 });
  eq(AI.duplicateOf([a], b), a);
  eq(AI.duplicateOf([a], c), null, 'a different size is a different file');
  eq(AI.duplicateOf([a], a), null, 'an item is not its own duplicate');
  eq(AI.duplicateOf([], b), null);
  ok(AI.MAX_HELD >= 61, 'sixty files and one more must fit in a tab');
});

sec('lanes');

t('a lease-family type goes to the lease lane, the rest to the documents lane, no type goes nowhere', () => {
  for (const ty of ['original_lease', 'amendment', 'renewal', 'extension', 'assignment', 'guaranty', 'estoppel', 'snda', 'side_letter']) eq(AI.laneFor(ty), 'lease', ty);
  for (const ty of ['rent_roll', 'psa', 'financial_statement', 'invoice', 'other']) eq(AI.laneFor(ty), 'other', ty);
  eq(AI.laneFor('unknown'), null); eq(AI.laneFor(null), null); eq(AI.laneFor('nonsense'), null);
  ok(/Lease lane/.test(AI.laneLabel('lease')) && /Documents lane/.test(AI.laneLabel('other')) && AI.laneLabel(null) === '');
});

t('the type table is acquisition-documents.js\'s — same names, same labels, same family flags', () => {
  eq(Object.keys(AI.TYPES).sort(), Object.keys(AD.DOC_TYPES).sort());
  for (const k of Object.keys(AD.DOC_TYPES)) {
    eq(AI.TYPES[k].label, AD.DOC_TYPES[k].label, k + ' label');
    eq(AI.TYPES[k].family, AD.DOC_TYPES[k].family, k + ' family');
  }
  eq(AI.picksFor(held('a.pdf', 'pdf')).indexOf('unknown'), -1, 'a person may not pick "unknown"');
  eq(AI.picksFor(held('a.pdf', 'pdf')).length, Object.keys(AD.DOC_TYPES).length - 1);
});

sec('reading: text and PDFs are read; images and scans are never transcribed or classified here');

t('a text file with enough letters stays in reading, for the classifier', () => {
  const it = held('lease.txt', 'txt');
  AI.transition(it, 'read_start');
  eq(it.state, 'reading'); eq(it.attempts, 1); eq(it.readToken, 1);
  AI.transition(it, 'read_ok', { text: 'LEASE AGREEMENT ' + LETTERS(200), textSource: 'text' });
  eq(it.state, 'reading', 'the classifier is next'); eq(it.textSource, 'text'); ok(it.letters >= 200);
});

t('an image is never read as text or classified: it needs a type, and says so', () => {
  const it = held('scan.png', 'png');
  AI.transition(it, 'read_start');
  AI.transition(it, 'read_ok', { text: '', textSource: 'image' });
  eq(it.state, 'needs_type'); eq(it.reason, 'image'); eq(it.lane, null);
  ok(/image is not read here/.test(AI.describe(it).note), AI.describe(it).note);
});

t('a scanned PDF — too few letters in all — needs a type and is never sent on', () => {
  const it = held('scan.pdf', 'pdf');
  AI.transition(it, 'read_start');
  AI.transition(it, 'read_ok', { text: PAGE(1, 'x1 . . 7') + '\n\n' + PAGE(2, '--'), textSource: 'pdf', pagesRead: 2 });
  eq(it.state, 'needs_type'); eq(it.reason, 'scanned');
  ok(/no text layer/.test(AI.describe(it).note) && /read when it is filed/.test(AI.describe(it).note), AI.describe(it).note);
});

t('the total-letters rule: a four-row rent roll is NOT a scan (the floor is 100 letters, not 200)', () => {
  eq(AI.SCAN_LETTERS_TOTAL, 100);
  const roll = 'RENT ROLL AS OF JUNE 30 2024 — MAPLE PLAZA, 120 MAPLE AVENUE\nSuite 110 Harbor Cafe LLC monthly $2,400\nSuite 120 Coastal Outfitters Inc monthly $4,100\nSuite 130 Pine Dental PC monthly $3,000\nSuite 140 Fern Books LLC monthly $1,900';
  ok(AI.letterCount(roll) >= 100 && AI.letterCount(roll) < 200, 'the fixture must sit between the old and the new floor: ' + AI.letterCount(roll));
  eq(AI.isScanned({ isPdf: true, text: PAGE(1, roll), pagesRead: 1 }), false);
  eq(AI.isScanned({ isPdf: true, text: PAGE(1, LETTERS(99)), pagesRead: 1 }), true, '99 letters is a scan');
  eq(AI.isScanned({ isPdf: true, text: PAGE(1, LETTERS(100)), pagesRead: 1 }), false, '100 letters is text');
});

t('the reader\'s own lines are not the document\'s text: page markers and unreadable-page placeholders are not counted', () => {
  eq(AI.letterCount('--- Page 1 ---\n[This page could not be read — it may be corrupted or image-only.]\n\n--- Page 2 ---\n[This page could not be read — it may be corrupted or image-only.]'), 0);
  eq(AI.letterCount('--- Document truncated ---\n[Pages 51–60 were not read. Exhibits or amendments beyond page 50 are not reflected in extracted terms.]'), 0);
  const fiftyMarkers = Array.from({ length: 50 }, (_, i) => PAGE(i + 1, '')).join('\n\n');
  eq(AI.isScanned({ isPdf: true, text: fiftyMarkers, pagesRead: 50 }), true, 'fifty empty pages are a scan, not a text layer');
  eq(AI.letterCount(PAGE(1, 'Lease')), 5, 'the document\'s own words still count');
});

t('the letters-per-page rule: a long PDF with a few words per page is a scan', () => {
  eq(AI.SCAN_LETTERS_PER_PAGE, 20);
  const thin = Array.from({ length: 10 }, (_, i) => PAGE(i + 1, 'Exhibit ' + i)).join('\n\n');   // ~7 letters a page, 70 in all → total rule too
  eq(AI.isScanned({ isPdf: true, text: thin, pagesRead: 10 }), true);
  const thin2 = Array.from({ length: 10 }, (_, i) => PAGE(i + 1, LETTERS(15))).join('\n\n');       // 150 letters in all, 15 a page
  eq(AI.isScanned({ isPdf: true, text: thin2, pagesRead: 10 }), true, '150 letters over 10 pages is a scan');
  const real = Array.from({ length: 10 }, (_, i) => PAGE(i + 1, LETTERS(400))).join('\n\n');
  eq(AI.isScanned({ isPdf: true, text: real, pagesRead: 10 }), false);
  eq(AI.isScanned({ isPdf: false, text: 'abc', pagesRead: 0 }), false, 'a text file is never a scan');
});

t('a text file with nothing to read needs a type', () => {
  const it = held('empty.txt', 'txt');
  AI.transition(it, 'read_start'); AI.transition(it, 'read_ok', { text: '   \n ', textSource: 'text' });
  eq(it.state, 'needs_type'); eq(it.reason, 'no_text');
});

t('held text is capped so sixty files fit in a tab; the cap is said on the item', () => {
  ok(AI.TEXT_CAP >= 100000 && AI.TEXT_CAP <= 300000, 'cap ' + AI.TEXT_CAP);
  const it = held('long.txt', 'txt');
  AI.transition(it, 'read_start'); AI.transition(it, 'read_ok', { text: LETTERS(AI.TEXT_CAP + 5000), textSource: 'text' });
  eq(it.text.length, AI.TEXT_CAP); eq(it.truncated, true);
  const short = held('short.txt', 'txt');
  AI.transition(short, 'read_start'); AI.transition(short, 'read_ok', { text: LETTERS(500), textSource: 'text' });
  eq(short.truncated, false);
});

t('a read that fails is said, with its reason, and can be retried', () => {
  const it = held('bad.pdf', 'pdf');
  AI.transition(it, 'read_start'); AI.transition(it, 'read_failed', { error: 'Invalid PDF structure' });
  eq(it.state, 'read_failed'); eq(it.error, 'Invalid PDF structure');
  eq(AI.describe(it).label, 'Could not be read'); eq(AI.describe(it).note, 'Invalid PDF structure');
  AI.transition(it, 'retry');
  eq(it.state, 'queued'); eq(it.error, null); eq(it.attempts, 1, 'attempts count reads, not retries');
});

sec('classification: how sure the AI was, and who proposed the type');

function classify(it, reading) { AI.transition(it, 'read_start'); AI.transition(it, 'read_ok', { text: 'LEASE ' + LETTERS(300), textSource: 'text' }); return AI.transition(it, 'classified', { reading }); }

t('a confident answer sets the type, the lane and who proposed it', () => {
  const it = classify(held('a.txt', 'txt'), { docType: 'amendment', confidence: 0.91, evidence: 'FIRST AMENDMENT' });
  eq(it.state, 'classified'); eq(it.type, { value: 'amendment', source: 'ai', confidence: 0.91, evidence: 'FIRST AMENDMENT' });
  eq(it.lane, 'lease'); eq(it.aiType.value, 'amendment');
  const d = AI.describe(it);
  eq(d.label, 'Amendment'); eq(d.badge, null); eq(d.note, 'proposed by AI at 91%');
});

t('below the confidence line the type stands but is badged', () => {
  eq(AI.LOW_CONFIDENCE, 0.75);
  const it = classify(held('b.txt', 'txt'), { docType: 'rent_roll', confidence: 0.6 });
  eq(it.state, 'classified'); eq(it.lane, 'other');
  eq(AI.describe(it).badge, 'Low confidence');
  eq(AI.describe(classify(held('c.txt', 'txt'), { docType: 'rent_roll', confidence: 0.75 })).badge, null, 'exactly the line is not low');
});

t('below the floor the AI\'s answer is only a hint: the file needs a type, and the hint is shown', () => {
  eq(AI.CLASSIFIER_FLOOR, 0.5);
  const it = classify(held('d.txt', 'txt'), { docType: 'side_letter', confidence: 0.3 });
  eq(it.state, 'needs_type'); eq(it.reason, 'low_confidence'); eq(it.type.value, null); eq(it.lane, null);
  eq(it.aiType, { value: 'side_letter', confidence: 0.3, evidence: null });
  ok(/AI was not sure — it read "Side Letter" at 30% — say what it is\./.test(AI.describe(it).note), AI.describe(it).note);
});

t('"unknown" from the AI, a null answer, or a type not in the table each need a person', () => {
  eq(classify(held('e.txt', 'txt'), { docType: 'unknown', confidence: 0.9 }).reason, 'unknown');
  eq(classify(held('f.txt', 'txt'), null).reason, 'classifier_unavailable');
  const g = classify(held('g.txt', 'txt'), { docType: 'memo', confidence: 0.9 });
  eq(g.state, 'needs_type'); eq(g.reason, 'unknown'); eq(g.aiType.value, 'unknown');
  ok(/classifier was unavailable/.test(AI.describe(classify(held('h.txt', 'txt'), null)).note));
});

t('a type a person sets wins, names the person, keeps the AI\'s answer beside it, and is never re-read', () => {
  const it = classify(held('i.txt', 'txt'), { docType: 'other', confidence: 0.55 });
  AI.transition(it, 'set_type', { type: 'original_lease' });
  eq(it.type, { value: 'original_lease', source: 'human', confidence: null, evidence: null });
  eq(it.lane, 'lease'); eq(it.state, 'classified'); eq(it.aiType.value, 'other', 'the AI answer is forgotten');
  eq(AI.describe(it).note, 'set by you (AI read "Other")'); eq(AI.describe(it).badge, null, 'a person\'s type is never badged');
  throws(() => AI.transition(it, 'retry'), 'a human type was re-read');
  throws(() => AI.transition(it, 'read_start'), 'a human type was read again');
  throws(() => AI.transition(it, 'set_type', { type: 'unknown' }), '"unknown" was picked');
  const same = classify(held('j.txt', 'txt'), { docType: 'invoice', confidence: 0.9 });
  AI.transition(same, 'set_type', { type: 'invoice' });
  eq(AI.describe(same).note, 'set by you', 'agreeing with the AI does not repeat it');
});

t('a person can give a type to a file that needs one, to an image, to a scan, and to a failed read', () => {
  for (const [name, ext, event, info] of [['s.png', 'png', 'read_ok', { text: '' }], ['s.pdf', 'pdf', 'read_ok', { text: PAGE(1, 'x'), pagesRead: 1 }], ['s.txt', 'txt', 'read_failed', { error: 'boom' }]]) {
    const it = held(name, ext);
    AI.transition(it, 'read_start'); AI.transition(it, event, info);
    AI.transition(it, 'set_type', { type: 'rent_roll' });
    eq(it.state, 'classified', name); eq(it.lane, 'other', name); eq(it.type.source, 'human', name);
  }
});

sec('left out, included, retried');

t('a file left out while it is being read stays left out when the read lands — the token moved', () => {
  const it = held('k.txt', 'txt');
  AI.transition(it, 'read_start');
  const token = it.readToken;
  AI.transition(it, 'leave_out');
  eq(it.state, 'left_out'); ok(it.readToken !== token, 'the token did not move');
  // The glue compares tokens before applying a landed read; the model never
  // moves a left-out file back by itself.
  eq(AI.nextToRead([it]), null, 'a left-out file is picked up by the reader');
});

t('a left-out file is not read, not typed, and comes back as queued (or as classified when it already had a type)', () => {
  const it = held('l.txt', 'txt');
  AI.transition(it, 'leave_out');
  throws(() => AI.transition(it, 'read_start'), 'a left-out file was read');
  throws(() => AI.transition(it, 'set_type', { type: 'invoice' }), 'a left-out file was typed');
  AI.transition(it, 'include'); eq(it.state, 'queued');
  const typed = classify(held('m.txt', 'txt'), { docType: 'invoice', confidence: 0.9 });
  AI.transition(typed, 'leave_out'); AI.transition(typed, 'include'); eq(typed.state, 'classified'); eq(typed.type.value, 'invoice');
  eq(AI.describe(AI.transition(held('n.txt', 'txt'), 'leave_out')).label, 'Left out');
});

t('one reader: the next file is the first queued one that is not left out or removed', () => {
  const a = held('a.txt', 'txt'), b = held('b.txt', 'txt'), c = held('c.txt', 'txt');
  AI.transition(a, 'leave_out'); b.removed = true;
  eq(AI.nextToRead([a, b, c]), c);
  AI.transition(c, 'read_start');
  eq(AI.nextToRead([a, b, c]), null, 'a file being read is offered again');
});

t('retry re-queues a failed read or a file that needs a type; a settled AI type can be read again too', () => {
  const nt = classify(held('o.txt', 'txt'), { docType: 'unknown', confidence: 0.9 });
  AI.transition(nt, 'retry'); eq(nt.state, 'queued'); eq(nt.reason, null);
  const ai = classify(held('p.txt', 'txt'), { docType: 'invoice', confidence: 0.9 });
  AI.transition(ai, 'retry'); eq(ai.state, 'queued');
  const q = held('q.txt', 'txt'); AI.transition(q, 'retry'); eq(q.state, 'queued', 'retry on a queued file is a no-op');
});

sec('what the screen is told');

t('hints come from the reading, not the file name', () => {
  eq(AI.hintsFor({ tenantName: 'Harbor Cafe LLC', docDate: '2023-03-01', suite: '110' }), ['Tenant: Harbor Cafe LLC', 'Dated 2023-03-01', 'Suite 110']);
  eq(AI.hintsFor({ tenantName: null }), []); eq(AI.hintsFor(null), []);
});

t('the summary counts every state and the text held', () => {
  const a = classify(held('a.txt', 'txt'), { docType: 'invoice', confidence: 0.9 });
  const b = held('b.png', 'png'); AI.transition(b, 'read_start'); AI.transition(b, 'read_ok', { text: '' });
  const c = held('c.txt', 'txt'); AI.transition(c, 'read_start'); AI.transition(c, 'read_failed', { error: 'x' });
  const d = AI.transition(held('d.txt', 'txt'), 'leave_out');
  const e = held('e.txt', 'txt');
  const s = AI.summary([a, b, c, d, e]);
  eq([s.held, s.classified, s.needsType, s.failed, s.leftOut, s.queued], [5, 1, 1, 1, 1, 1]);
  ok(s.textChars > 300, 'text held is not counted');
  eq(AI.summaryText([a, b, c, d, e]), '5 files held · 1 classified · 1 needs a type · 1 could not be read · 1 left out');
  eq(AI.summaryText([]), '');
});

t('the reader\'s line: reading, paused with the seconds left (0 is a number), waiting, or nothing', () => {
  const a = classify(held('a.txt', 'txt'), { docType: 'invoice', confidence: 0.9 });
  const b = held('b.txt', 'txt'); AI.transition(b, 'read_start');
  const c = held('c.txt', 'txt');
  ok(/Reading "b\.txt" — 1 of 3 read\./.test(AI.readerStatus([a, b, c], { current: b.itemId })), AI.readerStatus([a, b, c], { current: b.itemId }));
  eq(AI.readerStatus([a, b, c], { paused: true, resumeAt: 20000, now: 0 }), 'Paused — the classifier asked for a wait; reading resumes in 20s.');
  eq(AI.readerStatus([a, b, c], { paused: true, resumeAt: 5000, now: 5000 }), 'Paused — the classifier asked for a wait; reading resumes in 0s.');
  eq(AI.readerStatus([a, c], {}), '1 waiting to be read.');
  eq(AI.readerStatus([a], {}), '');
});

t('the row\'s words for the states a person waits on', () => {
  eq(AI.describe(held('a.txt', 'txt')).label, 'Waiting to be read');
  eq(AI.describe(AI.transition(held('b.txt', 'txt'), 'read_start')).label, 'Reading…');
  const w = AI.WARN;
  ok(/left out/.test(w.DUPLICATE) && /will not be stored/.test(w.ORIGINAL_NOT_STORABLE));
  eq(AI.MIN_TEXT_TO_CLASSIFY, 40, 'the classifier\'s own floor, as _acqClassifyDocument has it');
});

console.log('\n' + '─'.repeat(64));
console.log(`RESULT: ${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILED:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);
