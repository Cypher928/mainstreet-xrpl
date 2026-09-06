'use strict';
/**
 * timeline-merge.js — reuniting a property's history with itself.
 *
 * THE DEFECT THIS EXISTS FOR
 *
 * `saveProperty()` has written `timeline` into `properties.data` since the
 * feature shipped (script.js: `timeline: stripped.timeline || []`), and
 * `loadPropertyData()` has read it back out for just as long
 * (`timeline: d.timeline || []`). Nothing in between ever assigned it to the
 * property. The only two `.timeline =` sites in script.js were the `= []`
 * initialiser and the 500-entry cap, both inside appendPropertyTimelineEvent.
 *
 * So the history was fetched and dropped on the floor. `selectProperty` then
 * appended `sync_restored` to an empty array and the next save wrote that array
 * over the stored record. Measured on a non-demo property: two manual entries in
 * the database and in localStorage before a reload; one event in memory after
 * it; zero in either store after the next save. Not hidden — destroyed.
 *
 * The fingerprint is in the pilot. Across 27 properties there are 91 timeline
 * events, 27 of them `sync_restored` — exactly one per property — and not one
 * manual entry, attachment or lease reference in any of them. Every real
 * property's entire timeline spans between 0 and 17 minutes: a single session.
 * Happy Plaza carries 7 lease documents and 6 reconciliations and 1.1 minutes of
 * history. The demo looks healthy only because ensureDemoProperty() re-seeds
 * `timeline: demoTimeline` on load, which is a reseed, not a restore.
 *
 * WHY A MERGE AND NOT AN ASSIGNMENT
 *
 * `selectProperty` renders instantly from the in-memory `_props` cache and loads
 * from storage afterwards, on a timer. Events can be written in between — an
 * upload in flight emits `lease_uploaded` — and the property being opened may
 * already carry events from earlier in the same session. Assigning the persisted
 * array would discard those, which is the same bug pointed the other way.
 *
 * So both sides are kept. This is the pattern loadPropertyData already uses for
 * disputes ("DB is authoritative … also include any LS-only entries that haven't
 * reached Supabase yet"), applied to the timeline: union on identity, primary
 * wins a collision, secondary supplies everything the primary lacks. No second
 * persistence mechanism is introduced — `properties.data.timeline` remains the
 * store and localStorage remains its offline mirror.
 *
 * WHICH SIDE IS PRIMARY IS THE CALLER'S TO DECIDE, and the two callers answer
 * differently on purpose:
 *
 *   loadPropertyData   merge(db, localStorage)   Supabase is authoritative;
 *                                                unsynced local events survive.
 *   selectProperty     merge(live, persisted)    this session's events — which
 *                                                may include an edit made to an
 *                                                event the store still holds in
 *                                                its older form — win; the
 *                                                stored history fills in behind.
 *
 * ORDERING IS ESTABLISHED, NOT ASSUMED. Stored arrays are in insertion order,
 * which is not chronological: the demo's own blob fails a descending-timestamp
 * check. Merging two such arrays by concatenation would produce an order that
 * depends on which side was read first, and "reload, then save" would rewrite
 * the record differently every time. Sorting ascending by timestamp with a
 * deterministic tiebreak makes the merge a function of its inputs alone, so a
 * reload followed by a save reproduces the history byte for byte.
 */

(function (root) {

  /** Same ceiling as appendPropertyTimelineEvent — one policy, not two. */
  const MAX_EVENTS = 500;

  /**
   * The identity of an event.
   *
   * Every event appendPropertyTimelineEvent writes carries an `id`, and that is
   * the answer whenever it is present. The composite fallback is for rows that
   * predate it or were written by hand: without it two copies of the same
   * id-less event merge into two rows, which is how a deduplicating merge grows
   * a timeline instead of preserving it.
   */
  function eventKey(ev) {
    if (!ev || typeof ev !== 'object') return null;
    const id = ev.id;
    if (typeof id === 'string' && id.trim()) return 'id:' + id.trim();
    if (typeof id === 'number' && Number.isFinite(id)) return 'id:' + id;
    // Joined on a unit separator, written as an escape so this file stays plain
    // text. A printable joiner would let a title that happens to contain it
    // collide two distinct events into one; this character cannot occur in
    // anything a person typed into the entry form.
    return 'k:' + [ev.type ?? '', ev.timestamp ?? '', ev.title ?? ''].join('\u001f');
  }

  function _time(ev) {
    const t = ev && ev.timestamp;
    if (!t) return 0;
    const n = new Date(t).getTime();
    return Number.isFinite(n) ? n : 0;
  }

  /**
   * Union of two timelines, primary winning any collision.
   *
   * Returns a new array. Neither input is mutated, and no event object is
   * copied or rewritten — an entry comes out of the merge exactly as it went in,
   * which is what keeps `manual`, `attachments`, `responsibility`, `leaseRef`
   * and `subject` intact without this function having to know they exist.
   *
   * @param {Array} primary   authoritative side; its version of a shared event wins
   * @param {Array} secondary supplies every event the primary does not have
   * @param {{max?:number}} [opts]
   */
  function mergeTimelines(primary, secondary, opts) {
    const max = (opts && Number.isFinite(opts.max) && opts.max > 0) ? Math.floor(opts.max) : MAX_EVENTS;
    const a = Array.isArray(primary)   ? primary   : [];
    const b = Array.isArray(secondary) ? secondary : [];

    const byKey = new Map();
    // Secondary first so a primary entry with the same key overwrites it. Set()
    // on an existing key keeps the ORIGINAL insertion position, so this also
    // fixes the order the two sides are visited in — but the sort below is what
    // the result actually depends on.
    for (const ev of b) { const k = eventKey(ev); if (k) byKey.set(k, ev); }
    for (const ev of a) { const k = eventKey(ev); if (k) byKey.set(k, ev); }

    const merged = Array.from(byKey.entries())
      .sort((x, y) => {
        const dt = _time(x[1]) - _time(y[1]);
        if (dt !== 0) return dt;
        // A total order, so the merge is a pure function of its inputs. Several
        // seeded events share a millisecond; without this the sort is only as
        // stable as the engine chooses to be.
        return x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0;
      })
      .map(entry => entry[1]);

    // Newest kept, oldest dropped — the same end of the array
    // appendPropertyTimelineEvent trims from.
    return merged.length > max ? merged.slice(-max) : merged;
  }

  /**
   * The dedupe key for `sync_restored`.
   *
   * Restoring state from sync is a status marker, not something that happened to
   * the building. Before this module the timeline was wiped on every load, so
   * only ever one existed — which is exactly what the pilot shows, one per
   * property. Now that the history survives, an unkeyed append would add one on
   * every reload and turn a data-loss bug into an unbounded-growth one. One per
   * property, forever, keeps the observable behaviour identical to what pilot
   * data already contains.
   */
  function syncRestoredKey(propertyId) {
    return 'sync_restored:' + (propertyId == null ? '' : String(propertyId));
  }

  const api = { mergeTimelines, eventKey, syncRestoredKey, MAX_EVENTS };
  if (root) root.TimelineMerge = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

})(typeof window !== 'undefined' ? window : null);
