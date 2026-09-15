'use strict';
/**
 * test-timeline-merge.js — a property's history has to survive being loaded.
 *
 *   node test-timeline-merge.js
 *
 * WHY THIS EXISTS
 *
 * `saveProperty()` wrote `timeline` into properties.data on every save and
 * `loadPropertyData()` read it back, and nothing in between ever assigned it.
 * The history was fetched and dropped; `sync_restored` was then appended to an
 * empty array and the next save wrote that array over the record. Two manual
 * entries in Supabase and localStorage before a reload; zero in either after the
 * save that followed it. Across the pilot: 27 properties, 27 sync_restored
 * events — one each — and not one manual entry, attachment or lease reference in
 * any of them.
 *
 * This suite pins the merge itself. test-e2e-timeline-persistence.js drives the
 * real application through save, reload and save again; between them the rule is
 * the same one: an event that was recorded is still there afterwards, exactly as
 * it was recorded, and nothing arrives twice.
 */
const fs   = require('fs');
const path = require('path');
const TM   = require('./timeline-merge.js');
const { fnSource } = require('./test-support/fn-source');

let pass = 0, fail = 0;
const ok  = (m) => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      → ' + d : '')); fail++; };
const yes = (m, c, d) => c ? ok(m) : bad(m, d);
const R   = (l, v) => console.log('  ' + String(l).padEnd(44) + ':', typeof v === 'string' ? v : JSON.stringify(v));
const H   = (t) => console.log('\n\x1b[36m── ' + t + ' ──\x1b[0m');

const SCRIPT = fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8');
// The comments in this change quote the very strings these assertions look for
// — "property.timeline", "sync_restored", "mergeTimelines". A grep that reads
// them is a green test about a comment.
const CODE = SCRIPT.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
  .map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');

const ev = (o) => Object.assign({
  id: 'tl-' + Math.random().toString(36).slice(2, 10),
  timestamp: '2026-01-01T00:00:00.000Z',
  type: 'manual_maintenance', title: 'event', manual: false,
}, o);
const ids = (list) => list.map(e => e.id);

console.log('\n══ A property\'s history survives being loaded ══');

// ── 1. Union: nothing from either side is lost ──────────────────────────────
H('Neither side is discarded');
const stored = [ev({ id: 'a', timestamp: '2026-01-01T00:00:00Z' }),
                ev({ id: 'b', timestamp: '2026-01-02T00:00:00Z' })];
const live   = [ev({ id: 'c', timestamp: '2026-01-03T00:00:00Z' })];
let m = TM.mergeTimelines(live, stored);
R('merge(live, stored)', ids(m));
yes('every stored event survives a merge with a live one',
    ['a', 'b'].every(k => ids(m).includes(k)), JSON.stringify(ids(m)));
yes('and the live event is not dropped either',
    ids(m).includes('c'), JSON.stringify(ids(m)));
yes('three in, three out — no invention, no loss', m.length === 3, String(m.length));

// The exact shape of the bug: the stored side is the whole history and the live
// side holds only the event this session just wrote.
m = TM.mergeTimelines([ev({ id: 'new', timestamp: '2026-02-01T00:00:00Z' })], stored);
yes('a nearly-empty live array cannot erase the stored history',
    m.length === 3 && ids(m).includes('a') && ids(m).includes('b'), JSON.stringify(ids(m)));

// ── 2. Deduplication ────────────────────────────────────────────────────────
H('The same event on both sides is one event');
const shared = ev({ id: 'dup', timestamp: '2026-01-05T00:00:00Z', title: 'stored version' });
const sharedEdited = { ...shared, title: 'edited this session' };
m = TM.mergeTimelines([sharedEdited], [shared]);
R('merged titles', m.map(e => e.title));
yes('an id present on both sides yields exactly one row',
    m.length === 1, String(m.length));
yes('and the PRIMARY side wins — an edit made this session is not reverted',
    m[0].title === 'edited this session', m[0].title);
m = TM.mergeTimelines([shared], [sharedEdited]);
yes('    the rule follows the argument order, not the content',
    m[0].title === 'stored version', m[0].title);

// An event with no id still must not double. Legacy rows and hand-written
// fixtures have none, and blind concatenation is what this guards against.
const noId = { timestamp: '2026-01-06T00:00:00Z', type: 'lease_uploaded', title: 'Lease uploaded — Acme' };
m = TM.mergeTimelines([{ ...noId }], [{ ...noId }]);
yes('an id-less event is deduplicated on type + timestamp + title',
    m.length === 1, JSON.stringify(m.map(e => e.title)));
m = TM.mergeTimelines([{ ...noId }], [{ ...noId, title: 'Lease uploaded — Other' }]);
yes('    but two genuinely different id-less events both survive',
    m.length === 2, JSON.stringify(m.map(e => e.title)));

// ── 3. Ordering ─────────────────────────────────────────────────────────────
H('Chronological, and the same answer every time');
const unsorted = [ev({ id: 'z', timestamp: '2026-03-01T00:00:00Z' }),
                  ev({ id: 'x', timestamp: '2026-01-01T00:00:00Z' }),
                  ev({ id: 'y', timestamp: '2026-02-01T00:00:00Z' })];
m = TM.mergeTimelines(unsorted, []);
R('sorted', ids(m));
yes('the merge orders ascending by timestamp',
    JSON.stringify(ids(m)) === JSON.stringify(['x', 'y', 'z']), JSON.stringify(ids(m)));
// Stored arrays are in insertion order, which is NOT chronological — the demo's
// own blob fails a descending check. Two such arrays concatenated give an order
// that depends on which side was read first.
const tie = [ev({ id: 'm2', timestamp: '2026-01-01T00:00:00Z' }),
             ev({ id: 'm1', timestamp: '2026-01-01T00:00:00Z' })];
const one = TM.mergeTimelines(tie, []);
const two = TM.mergeTimelines([tie[1], tie[0]], []);
yes('events sharing a millisecond get a total order, so input order is irrelevant',
    JSON.stringify(ids(one)) === JSON.stringify(ids(two)), JSON.stringify([ids(one), ids(two)]));

// ── 4. Reload, then save, does not rewrite the record ───────────────────────
H('Reload → save reproduces the history, it does not change it');
// This is the property the whole fix turns on: merging a restored timeline back
// against itself has to be a no-op, or every reload rewrites the stored array.
const history = [ev({ id: 'h1', timestamp: '2026-01-01T00:00:00Z', manual: true }),
                 ev({ id: 'h2', timestamp: '2026-01-02T00:00:00Z' }),
                 ev({ id: 'h3', timestamp: '2026-01-03T00:00:00Z' })];
const first  = TM.mergeTimelines([], history);
const second = TM.mergeTimelines(first, history);
const third  = TM.mergeTimelines(second, first);
R('first', ids(first)); R('third', ids(third));
yes('merging a restored timeline against its own source is idempotent',
    JSON.stringify(ids(first)) === JSON.stringify(ids(second)) &&
    JSON.stringify(ids(second)) === JSON.stringify(ids(third)),
    JSON.stringify([ids(first), ids(second), ids(third)]));
yes('    and the events are the same objects, not rebuilt copies',
    first.every((e, i) => e === second[i]), 'a merge rewrote an event');

// ── 5. Everything on an event survives it ───────────────────────────────────
H('A record comes out of the merge exactly as it went in');
const rich = ev({
  id: 'rich', timestamp: '2026-05-01T00:00:00Z', type: 'manual_maintenance',
  manual: true, category: 'maintenance', responsibility: 'landlord',
  leaseRef: 'Section 7.3',
  attachments: [{ name: 'RTU-3 invoice.pdf', url: 'data:application/pdf;base64,AAAA', kind: 'invoice' }],
  subject: { type: 'suite', id: 't1', label: 'Northgate Hardware' },
  relatedInvoiceIds: ['i1'], actor: 'Property Manager',
  metadata: { recordedBy: 'Property Manager', recordedVia: 'Manual' },
});
m = TM.mergeTimelines([], [rich]);
const got = m[0];
yes('the manual flag survives',              got.manual === true, JSON.stringify(got.manual));
yes('the responsibility survives',           got.responsibility === 'landlord', String(got.responsibility));
yes('the lease-section reference survives',  got.leaseRef === 'Section 7.3', String(got.leaseRef));
yes('the attachment survives, with its url', (got.attachments || []).length === 1 &&
    got.attachments[0].url.startsWith('data:'), JSON.stringify(got.attachments));
yes('the subject scoping survives',          got.subject && got.subject.type === 'suite' && got.subject.id === 't1',
    JSON.stringify(got.subject));
yes('the relation arrays survive',           JSON.stringify(got.relatedInvoiceIds) === '["i1"]',
    JSON.stringify(got.relatedInvoiceIds));
yes('    and the whole event is the identical object — nothing is normalised away',
    got === rich, 'the merge copied or rewrote the event');

// BOTH SIDES, NOT JUST THE STORED ONE. Found by mutation testing: a mutant that
// dropped manual entries from the PRIMARY side survived every assertion here,
// because every fixture above puts the manual event on the secondary side. The
// primary side is this session — a note typed a moment before the async load
// callback lands is a primary-side manual event, and dropping it would delete
// the manager's entry in front of them.
m = TM.mergeTimelines([rich], [ev({ id: 'other', timestamp: '2026-04-01T00:00:00Z' })]);
yes('a manual event on the PRIMARY side survives too — the one typed this session',
    m.some(e => e.id === 'rich' && e.manual === true), JSON.stringify(ids(m)));
yes('    with its attachment and responsibility intact from that side as well',
    (m.find(e => e.id === 'rich') || {}).responsibility === 'landlord' &&
    ((m.find(e => e.id === 'rich') || {}).attachments || []).length === 1,
    JSON.stringify(m.find(e => e.id === 'rich')));
const bothSides = TM.mergeTimelines(
  [ev({ id: 'live-manual',   manual: true, timestamp: '2026-06-02T00:00:00Z' })],
  [ev({ id: 'stored-manual', manual: true, timestamp: '2026-06-01T00:00:00Z' })]);
yes('and a manual event from each side survives the same merge',
    bothSides.length === 2 && bothSides.every(e => e.manual === true),
    JSON.stringify(ids(bothSides)));

// ── 6. System events are history too ────────────────────────────────────────
H('System-generated events are not second-class');
const mixed = [ev({ id: 's1', type: 'lease_uploaded',   manual: false, timestamp: '2026-01-01T00:00:00Z' }),
               ev({ id: 's2', type: 'cam_reconciled',   manual: false, timestamp: '2026-01-02T00:00:00Z' }),
               ev({ id: 's3', type: 'dispute_created',  manual: false, timestamp: '2026-01-03T00:00:00Z' }),
               ev({ id: 'm1', type: 'manual_note',      manual: true,  timestamp: '2026-01-04T00:00:00Z' })];
m = TM.mergeTimelines([], mixed);
yes('every system event survives alongside the manual one',
    m.length === 4 && ['s1', 's2', 's3', 'm1'].every(k => ids(m).includes(k)), JSON.stringify(ids(m)));

// ── 7. sync_restored ────────────────────────────────────────────────────────
H('sync_restored is a marker, not an event that repeats');
R('key', TM.syncRestoredKey('prop-1'));
yes('the key is stable for a property',
    TM.syncRestoredKey('prop-1') === TM.syncRestoredKey('prop-1'), 'key is not stable');
yes('and different for a different property',
    TM.syncRestoredKey('prop-1') !== TM.syncRestoredKey('prop-2'), 'keys collide across properties');
// The append itself is deduped by appendPropertyTimelineEventOnce on that key;
// the merge is the second line of defence if two loads race.
const sr = ev({ id: 'sr1', type: 'sync_restored', timestamp: '2026-01-09T00:00:00Z',
                metadata: { dedupeKey: TM.syncRestoredKey('p') } });
m = TM.mergeTimelines([sr], [sr, { ...sr }]);
yes('a duplicated sync_restored row collapses to one in the merge',
    m.filter(e => e.type === 'sync_restored').length === 1,
    String(m.filter(e => e.type === 'sync_restored').length));
// And the whole point: it must never be the thing that replaces the history.
m = TM.mergeTimelines([sr], history);
yes('sync_restored never replaces the history it is announcing',
    m.length === 4 && ['h1', 'h2', 'h3'].every(k => ids(m).includes(k)), JSON.stringify(ids(m)));

// ── 8. Safety ───────────────────────────────────────────────────────────────
H('Nothing is mutated, and bad input cannot throw');
const inA = [ev({ id: 'p1' })], inB = [ev({ id: 'p2' })];
const snapA = JSON.stringify(inA), snapB = JSON.stringify(inB);
TM.mergeTimelines(inA, inB);
yes('neither input array is mutated',
    JSON.stringify(inA) === snapA && JSON.stringify(inB) === snapB, 'an input was mutated');
yes('undefined / null / non-array inputs return an empty array, not a throw',
    TM.mergeTimelines(undefined, null).length === 0 &&
    TM.mergeTimelines('nope', 7).length === 0, 'non-array input was not tolerated');
yes('a null entry inside a timeline is skipped rather than kept',
    TM.mergeTimelines([null, ev({ id: 'good' })], [undefined]).length === 1, 'null entries leaked through');

// ── 9. The 500 cap, matching the writer ─────────────────────────────────────
H('One ceiling, not two');
const many = Array.from({ length: 600 }, (_, i) =>
  ev({ id: 'e' + String(i).padStart(4, '0'), timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString() }));
m = TM.mergeTimelines(many, []);
R('600 events in', m.length + ' out');
yes('a merge is capped at 500, the same number appendPropertyTimelineEvent trims to',
    m.length === 500 && TM.MAX_EVENTS === 500, String(m.length));
yes('    and it is the NEWEST 500 that are kept',
    m[m.length - 1].id === 'e0599' && m[0].id === 'e0100', ids(m).slice(0, 1) + '…' + ids(m).slice(-1));

// ── 10. Both call sites actually use it ─────────────────────────────────────
H('The two restore paths are wired to the merge');
const SELECT = fnSource(CODE, 'selectProperty');
const LOAD   = fnSource(CODE, 'loadPropertyData');
yes('selectProperty ASSIGNS property.timeline — the line that did not exist',
    /property\.timeline\s*=/.test(SELECT), 'selectProperty still drops the loaded timeline');
yes('    and it assigns a MERGE, not the loaded array',
    /property\.timeline\s*=[\s\S]{0,200}?TimelineMerge\.mergeTimelines\(/.test(SELECT),
    'selectProperty overwrites instead of merging');
yes('    with the live side primary, so an in-session event is not discarded',
    /mergeTimelines\(\s*property\.timeline\s*,\s*data\.timeline\s*\)/.test(SELECT),
    'the merge arguments are the wrong way round');
yes('loadPropertyData carries the timeline through its DB/localStorage merge',
    /timeline:\s*_mergedTl/.test(LOAD), 'the merged timeline never reaches the returned object');
yes('    and that merge is a union of both stores, not a pick',
    /_mergedTl\s*=[\s\S]{0,220}?mergeTimelines\(\s*_dbTl\s*,\s*_lsTl\s*\)/.test(LOAD),
    'the DB/LS timeline merge is missing or reversed');
yes('sync_restored is written through the deduped helper, nowhere else',
    /_appendSyncRestored\(/.test(SELECT) &&
    !/appendPropertyTimelineEvent\(\s*property\s*,\s*\{\s*type:\s*'sync_restored'/.test(CODE),
    'a raw sync_restored append is still in the source');
yes('and that helper goes through appendPropertyTimelineEventOnce with the shared key',
    /appendPropertyTimelineEventOnce\(\s*property\s*,\s*key\s*,/.test(fnSource(CODE, '_appendSyncRestored')) &&
    /TimelineMerge\.syncRestoredKey\(/.test(fnSource(CODE, '_appendSyncRestored')),
    'the sync_restored helper is not deduped on the shared key');

// ── 11. The store is unchanged ──────────────────────────────────────────────
H('No second persistence mechanism was introduced');
yes('saveProperty still writes the timeline to properties.data and nowhere else',
    /timeline:\s*stripped\.timeline\s*\|\|\s*\[\]/.test(fnSource(CODE, 'saveProperty')),
    'the save path changed');
yes('loadPropertyData still reads it from the same blob key',
    /timeline:\s*d\.timeline\s*\|\|\s*\[\]/.test(LOAD), 'the read path changed');

console.log(`\n${fail ? '\x1b[31m' : '\x1b[32m'}RESULT: ${pass} passed, ${fail} failed\x1b[0m\n`);
process.exit(fail ? 1 : 0);
