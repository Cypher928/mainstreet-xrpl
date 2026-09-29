'use strict';
/**
 * tools/property-leaseholds-mutation.js — do the P5-2 suites bite?
 *
 *   node tools/property-leaseholds-mutation.js
 *
 * The rule: an acquired property's Space file shows the documents filed into
 * its leasehold during the acquisition and says a person verified the terms —
 * joined on tenants.id = families.id, scoped to THIS property, live and
 * confirmed documents only, links only for the uploader, and nothing written.
 * P5-3 (V01..V13): what STANDS per field is the last known-action decision by
 * decided_at (a last reopen ⇒ nothing), computed per leasehold; a correct's
 * value is its new value; a source resolves by id; the shown value is never
 * replaced and a line says when it differs; "by you" only for the signed-in uid.
 * P5-4 (A01..A19): the acquisition's recorded states are READ, fail closed on
 * any ambiguity, never promote an unverified extraction, never count what the
 * workspace already raises, and never open a write path onto the closed review.
 * Each mutant is a one-token edit that breaks one leg. Every one must be
 * caught by the unit suites or the browser suite.
 *
 * A FAILING BASELINE IS NOT A PASS.
 */
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PL = 'property-leaseholds.js', APP = 'script.js', TS = 'tenant-space.js', DS = 'decision-standing.js', PW = 'property-workspace.js', PCV = 'property-cabinet-view.js';

const MUTANTS = [
  { id: 'L01', file: PL, why: 'the join is by tenant NAME instead of id — two "Vacant" leaseholds share documents',
    from: "    return !!doc && doc.family_id === familyId",
    to:   "    return !!doc && (doc.family_id === familyId || true)" },
  { id: 'L02', file: PL, why: 'superseded documents are back on file',
    from: "      && !doc.superseded_by_document_id\n",
    to:   "\n" },
  { id: 'L03', file: PL, why: 'a document merely PROPOSED for a leasehold (or unfiled) counts as on file',
    from: "      && doc.family_status === 'confirmed';",
    to:   "      && doc.family_status !== 'nothing';" },
  { id: 'L04', file: APP, why: 'the documents read is no longer scoped to the property',
    from: "      db.from('acquisition_documents').select(PL.SELECT.documents).eq('property_id', propertyId).order('created_at', { ascending: true }),",
    to:   "      db.from('acquisition_documents').select(PL.SELECT.documents).order('created_at', { ascending: true })," },
  { id: 'L05', file: APP, why: 'the acquired-only gate is gone: prospects (and rows not in the portfolio) load acquisition data',
    from: "      if (_managed) await loadPropertyLeaseholds(id, uid);",
    to:   "      await loadPropertyLeaseholds(id, uid);" },
  { id: 'L06', file: PL, why: 'a non-uploader gets a link the signed-url check would refuse',
    from: "      url:          mine ? d.storage_path : null,",
    to:   "      url:          d.storage_path," },
  { id: 'L07', file: PL, why: 'decisions are not grouped by leasehold — every leasehold gets them all',
    from: "      var theirs = decs.filter(function (d) { return d.family_id === f.id; })",
    to:   "      var theirs = decs.filter(function (d) { return true; })" },
  { id: 'L08', file: PL, why: 'build() keeps rows that name ANOTHER property — cross-property leakage',
    from: "    return row.property_id == null || row.property_id === propertyId;",
    to:   "    return true;" },
  { id: 'L09', file: TS, why: 'the Space file ignores the leasehold documents',
    from: "    if (leasehold) {\n      (leasehold.documents || []).forEach(function (d) {",
    to:   "    if (false) {\n      (leasehold.documents || []).forEach(function (d) {" },
  { id: 'L10', file: APP, why: 'the loader filters on user_id — an organisation member loses the read',
    from: "      db.from('acquisition_document_families').select(PL.SELECT.families).eq('property_id', propertyId).order('created_at', { ascending: true }),",
    to:   "      db.from('acquisition_document_families').select(PL.SELECT.families).eq('property_id', propertyId).eq('user_id', currentUid).order('created_at', { ascending: true })," },
  { id: 'L11', file: TS, why: 'the verification summary (and history) is shown with zero decisions',
    from: "    if (_lhC && _lhC.decisions > 0) {",
    to:   "    if (_lhC) {" },
  // EQUIVALENT BY CONSTRUCTION, kept as documentation. The map is keyed by
  // property uuid and set() refuses a projection built for another property
  // (L14), so an entry whose propertyId differs from its key cannot exist and
  // the guard inside forTenant() can never observe a mismatch. Removing it
  // changes no reachable behaviour; it is defence in depth. Reported, not
  // counted as a survivor.
  { id: 'L12', file: PL, equivalent: 'unreachable through the public API: set() refuses mismatched projections (L14 is killed)',
    why: 'the map answers a tenant id under ANY property (keyed by tenant, not property)',
    from: "    return (e && e.propertyId === propertyId) ? e : null;",
    to:   "    return e || null;" },
  { id: 'L13', file: APP, why: 'the entry is not cleared before the read — a stale set shows while the query is pending',
    from: "  PL.clear(propertyId);\n  const rows = (r) =>",
    to:   "  const rows = (r) =>" },
  { id: 'L14', file: PL, why: 'set() accepts a projection built for another property',
    from: "    if (built.propertyId && built.propertyId !== propertyId) return false;",
    to:   "" },
  { id: 'L15', file: TS, why: 'assemble() reads the leasehold from a global "current" property instead of the one being rendered',
    from: "      ? (_PL.forTenant(property.id, tenantId) || null) : null;",
    to:   "      ? (_PL.forTenant((window.currentProperty && window.currentProperty() || property).id, tenantId) || null) : null;" },
  { id: 'L16', file: APP, why: 'the loader asks for the document text and the abstracted evidence',
    from: "      db.from('acquisition_documents').select(PL.SELECT.documents)",
    to:   "      db.from('acquisition_documents').select('*')" },
  { id: 'L17', file: TS, why: 'NEGATIVE CONTROL — the records count text starts counting lease documents (scope creep P5-2 deferred)',
    from: "    if (c.events) bits.push(c.events + ' event' + (c.events !== 1 ? 's' : ''));",
    to:   "    if (c.events) bits.push(c.events + ' event' + (c.events !== 1 ? 's' : ''));\n    if (c.leaseDocs) bits.push(c.leaseDocs + ' lease docs');" },
  // ── P5-3: what stands ─────────────────────────────────────────────────────
  { id: 'V01', file: DS, why: 'a latest REOPEN is counted as the standing decision',
    from: "    return last.action === 'reopen' ? null : last;",
    to:   "    return last;" },
  { id: 'V02', file: PL, why: 'a standing REJECT is presented as verified',
    from: "    var verified = d.action === 'confirm' || d.action === 'correct';",
    to:   "    var verified = d.action === 'confirm' || d.action === 'correct' || d.action === 'reject';" },
  { id: 'V03', file: DS, why: 'rows are ordered by created_at instead of decided_at',
    from: "      var x = String(a.decided_at || ''), y = String(b.decided_at || '');",
    to:   "      var x = String(a.created_at || ''), y = String(b.created_at || '');" },
  { id: 'V04', file: PL, why: 'standing is computed across ALL of the property\'s decisions, not this leasehold\'s',
    from: "        verified: standingDecisions(theirs, docs, f.id, uid),",
    to:   "        verified: standingDecisions(decs, docs, f.id, uid)," },
  { id: 'V05', file: PL, why: 'an unknown action is counted as a decision',
    from: "      if (!r || _DS.DECISION_ACTIONS.indexOf(r.action) < 0) return;\n      c.decisions++;",
    to:   "      if (!r) return;\n      c.decisions++;" },
  { id: 'V06', file: PL, why: 'a correction\'s value is taken from previous_value (the reading it replaced)',
    from: "    if (d.action === 'correct') return d.new_value == null ? null : d.new_value;",
    to:   "    if (d.action === 'correct') return d.previous_value == null ? null : d.previous_value;" },
  { id: 'V07', file: TS, why: '"by you" is said for ANY decider',
    from: "    function _who(decidedBy) { return (decidedBy && _uid && decidedBy === _uid) ? 'you' : 'a person'; }",
    to:   "    function _who(decidedBy) { return 'you'; }" },
  { id: 'V08', file: TS, why: 'a shown value that differs from the decided one is presented as verified, without the "changed since" note',
    from: "        var same = !!(_PLm && _PLm.matchesShown(field, e.value, shown));",
    to:   "        var same = true;" },
  { id: 'V09', file: TS, why: 'the shown term value is REPLACED by the decided one',
    from: "    if (rec.lease.sqft != null) leaseRows.push(['Leased area', rec.lease.sqft + ' sqft', _rowLine('leased_sqft', rec.lease.sqft)]);",
    to:   "    if (rec.lease.sqft != null) leaseRows.push(['Leased area', ((_lhV && _lhV.byField.leased_sqft && _lhV.byField.leased_sqft.value) || rec.lease.sqft) + ' sqft', _rowLine('leased_sqft', rec.lease.sqft)]);" },
  { id: 'V10', file: TS, why: 'the history omits the reopens (the record is edited)',
    from: "        hist.slice().reverse().map(function (d) {",
    to:   "        hist.filter(function (d) { return d.action !== 'reopen'; }).reverse().map(function (d) {" },
  { id: 'V11', file: PL, why: 'a source document is resolved by file NAME instead of id',
    from: "    for (var i = 0; i < docs.length; i++) { if (docs[i] && docs[i].id === sourceDocumentId) { d = docs[i]; break; } }",
    to:   "    for (var i = 0; i < docs.length; i++) { if (docs[i] && docs[i].file_name === sourceDocumentId) { d = docs[i]; break; } }" },
  { id: 'V12', file: PL, why: 'quantities are compared as strings ("67,000" ≠ 67000)',
    from: "    if (NUMERIC_FIELDS[field]) {\n      var a = _num(decided), b = _num(shown);",
    to:   "    if (false) {\n      var a = _num(decided), b = _num(shown);" },
  { id: 'V13', file: PL, why: 'an entered value (no document) is presented as document-backed',
    from: "      entered: d.action === 'correct' && !d.source_document_id,",
    to:   "      entered: false," },
  // ── P5-4: acquisition attention, read — never copied ──────────────────────
  { id: 'A01', file: PL, why: 'a fingerprint row that is not a leasehold (an unfiled extraction) is accepted',
    from: "      if (e[1] !== 'leasehold') return null;", to: "" },
  { id: 'A02', file: PL, why: 'two converted reviews on one property are not treated as ambiguous',
    from: "    if (mine.length !== 1) return null;\n    var r = mine[0];\n    // Only the selected", to: "    if (!mine.length) return null;\n    var r = mine[0];\n    // Only the selected" },
  { id: 'A03', file: PL, why: 'structured states that disagree with the fingerprint are read anyway',
    from: "    if (s && f && !_sameStates(s, f)) return null;", to: "" },
  { id: 'A04', file: PL, why: 'a leasehold the review does not own is adopted into the record',
    from: "    if (!ids.every(function (id) { return famOfReview[id]; })) return null;", to: "" },
  { id: 'A05', file: PL, why: 'a CONTESTED term is presented as merely missing (the defect P5-4 exists for)',
    from: "conflicting: 'contested', missing: 'missing' };", to: "conflicting: 'missing', missing: 'missing' };" },
  { id: 'A06', file: PL, why: 'the rolled-up item counts fields the workspace already raises (double counting)',
    from: "        if (!it.open || it.representedInWorkspace) return false;", to: "        if (!it.open) return false;" },
  { id: 'A07', file: PL, why: 'the rolled-up item counts terms that were merely not established',
    from: "        if (it.kind === 'contested' || it.kind === 'unclear') return true;", to: "        if (it.kind === 'contested' || it.kind === 'unclear' || it.kind === 'missing') return true;" },
  { id: 'A08', file: PL, why: 'a value is claimed "read by AI" without comparing it to the value shown',
    from: "&& it.current === 'present' && it.comparable;", to: "&& it.current === 'present';" },
  { id: 'A09', file: PL, why: 'a value changed since acquisition is still reported as the AI\'s unverified reading',
    from: "        open: !resolvedSince && !changedSince,", to: "        open: !resolvedSince," },
  { id: 'A10', file: APP, why: 'the loader reads every review of the property, not the converted one',
    from: ".select(PL.SELECT.reviews).eq('property_id', propertyId).eq('status', 'converted'),", to: ".select(PL.SELECT.reviews).eq('property_id', propertyId)," },
  { id: 'A11', file: PL, why: 'an area of 0 counts as a value (Sunrise would read as resolved)',
    from: "return !isNaN(n) && n > 0; }", to: "return !isNaN(n) && n >= 0; }" },
  { id: 'A12', file: TS, why: 'the acquisition line is drawn even where a decision stands',
    from: "      if (_lhV && _lhV.byField && _lhV.byField[field]) return '';\n      var it = null;", to: "      var it = null;" },
  { id: 'A13', file: TS, why: 'the read-only record offers a way into the editable acquisition review',
    from: "'<summary>Open acquisition record · read-only'", to: "'<summary><button onclick=\"selectAcquisitionReview(\\'' + _esc(_atA.reviewId) + '\\')\">Edit</button>Open acquisition record · read-only'" },
  { id: 'A14', file: TS, why: 'a term not established and still blank gets a line the Review Queue already says',
    from: "text = it.resolvedSince ? 'Not established at acquisition — the value shown was entered since' : '';", to: "text = it.resolvedSince ? 'Not established at acquisition — the value shown was entered since' : 'Not established at acquisition';" },
  { id: 'A15', file: APP, why: 'the Review Queue history carries an action — an acquisition task after Acquire',
    from: "At acquisition: ${\n    hist.map(", to: "<button onclick=\"selectAcquisitionReview()\">Resolve</button>At acquisition: ${\n    hist.map(" },
  { id: 'A16', file: APP, why: 'the analysis no longer stores structured states (future reviews fall back to the fingerprint forever)',
    from: "    states: _acqCanonicalStates(tenants),\n", to: "\n" },
  { id: 'A17', file: PL, why: 'an analysis of anything but leaseholds is read as the acquisition record',
    from: "if (!_isObj(canonical) || canonical.basis !== 'leaseholds') return null;", to: "if (!_isObj(canonical)) return null;" },
  { id: 'A18', file: PL, why: '"entered" is accepted on a term that was not verified',
    from: "      if (v !== 'entered' || states[g] !== 'verified') return null;", to: "      if (v !== 'entered') return null;" },
  { id: 'A19', file: PL, why: 'unreadable structured states are skipped in favour of the fingerprint',
    from: "    if (hasS && !s) return null;                       // structured but unreadable: do not fall back past it", to: "" },
  { id: 'A20', file: PL, why: 'a person\'s rejection of the audit-rights reading is dropped from the history',
    from: "      var rejected = !!(sd && sd.rejected);", to: "      var rejected = false;" },
  { id: 'A21', file: PW, why: 'the acquisition item is raised as a warning — an acquisition task, not history',
    from: "      items.push(_mk('info', '\\u{1F4DC}',", to: "      items.push(_mk('warning', '\\u{1F4DC}'," },

  // ── P5-5: the acquisition episode for History ──────────────────────────────
  { id: 'B01', file: PL, why: 'a DERIVED event (mirrored from a blob save, attributed to the saver) is read as the acquisition',
    from: "      return _isObj(e) && e.source_key == null && e.action === 'stage_changed'", to: "      return _isObj(e) && e.action === 'stage_changed'" },
  { id: 'B02', file: PL, why: 'an acquire event naming ANOTHER review is claimed as this episode\'s',
    from: "        && _isObj(e.detail) && e.detail.reviewId === reviewId;", to: "        ;" },
  { id: 'B03', file: PL, why: 'two acquire rows for one episode: the first is taken instead of refusing to claim an actor',
    from: "    return hits.length === 1 ? hits[0] : null;", to: "    return hits[0] || null;" },
  { id: 'B04', file: PL, why: 'the episode is built from the first of two converted reviews on one property',
    from: "    var mine = _arr(reviews).filter(function (r) { return r.property_id === propertyId && r.status === 'converted'; });\n    if (mine.length !== 1) return null;\n    var r = mine[0];\n    var fams",
    to: "    var mine = _arr(reviews).filter(function (r) { return r.property_id === propertyId && r.status === 'converted'; });\n    if (!mine.length) return null;\n    var r = mine[0];\n    var fams" },
  { id: 'B05', file: PL, why: 'with no lifecycle event the review\'s OWNER is presented as the person who acquired the property',
    from: "        by: ev ? (ev.actor_uid || null) : null,", to: "        by: ev ? (ev.actor_uid || null) : (r.user_id || null)," },
  { id: 'B06', file: PL, why: 'a superseded upload is counted as a document filed into a leasehold',
    from: "      if (d.superseded_by_document_id) dc.superseded++;\n      else if", to: "      if (false) dc.superseded++;\n      else if" },
  { id: 'B07', file: PL, why: 'an event on ANOTHER property (property_id) is read as this property\'s acquisition',
    from: "        && _sameProperty(e, propertyId)\n", to: "\n" },
  { id: 'B08', file: PL, why: 'an event whose subject is another property is read as this property\'s acquisition',
    from: "        && (e.subject_id == null || e.subject_id === propertyId)\n", to: "\n" },
  { id: 'B09', file: PL, why: 'a passed / reopened stage change is read as an acquisition',
    from: "        && e.old_value === 'prospect' && e.new_value === 'acquired'\n", to: "\n" },
  { id: 'B10', file: PL, why: 'terms read by AI are summed into the "contested" figure of the unresolved summary',
    from: "        unresolved.contested += at.counts.contested; unresolved.unclear += at.counts.unclear;", to: "        unresolved.contested += at.counts.contested + at.counts.read; unresolved.unclear += at.counts.unclear;" },
  { id: 'B11', file: PL, why: 'an "Acquisition started" milestone is drawn with no date to support it',
    from: "    if (ep.review.startedAt) out.push({ key: 'started', at: ep.review.startedAt,", to: "    if (true) out.push({ key: 'started', at: ep.review.startedAt," },
  { id: 'B12', file: PL, why: '"Property acquired" is drawn from converted_at with an invented date when there is none',
    from: "    if (ep.acquired) out.push({ key: 'acquired', at: ep.acquired.at,", to: "    if (ep.acquired || ep.review.id) out.push({ key: 'acquired', at: (ep.acquired || {}).at || ep.review.startedAt," },
  { id: 'B13', file: APP, why: 'the loader reads every property event, not the stage changes',
    from: ".eq('property_id', propertyId).eq('action', 'stage_changed').order('created_at', { ascending: true }),", to: ".eq('property_id', propertyId).order('created_at', { ascending: true })," },
  { id: 'B14', file: APP, why: 'the Overview\'s lifecycle row is no longer marked derived — it draws like a stored entry (Edit, evidence, no History link)',
    from: "      derived: true, timestamp: ep.acquired.at, type: 'property_acquired', severity: 'success',", to: "      derived: false, timestamp: ep.acquired.at, type: 'property_acquired', severity: 'success'," },
  { id: 'B15', file: APP, why: 'the lifecycle row is pushed into property.timeline — the next save stores a copy and the derive trigger mirrors it as a second event',
    from: "  const tlAll = (Array.isArray(property.timeline) ? property.timeline.slice() : [])\n    .concat(_lifecycleTimelineRows(property))",
    to: "  if (Array.isArray(property.timeline)) _lifecycleTimelineRows(property).forEach(r => { if (!property.timeline.some(x => x.id === r.id)) property.timeline.push(r); });\n  const tlAll = (Array.isArray(property.timeline) ? property.timeline.slice() : [])" },
  { id: 'B16', file: PCV, why: 'the doorway records the visit as a timeline event on the property',
    from: "      if (typeof window.selectAcquisitionReview === 'function') { window.selectAcquisitionReview(reviewId); return true; }",
    to: "      if (typeof window.selectAcquisitionReview === 'function') { if (window.appendPropertyTimelineEvent && window.currentProperty) window.appendPropertyTimelineEvent(window.currentProperty(), { type: 'acquisition_opened', title: 'Acquisition record opened' }); window.selectAcquisitionReview(reviewId); return true; }" },
  { id: 'B17', file: PCV, why: 'the History section grows an edit control on the acquisition',
    from: "      '<div class=\"pos-note\">Read-only here: this summary", to: "      '<button type=\"button\" class=\"pcv-btn\" onclick=\"PropertyCabinetView.openAcquisitionRecord(this.dataset.review)\">Edit acquisition</button>' +\n      '<div class=\"pos-note\">Read-only here: this summary" },
  { id: 'B21', file: PCV, why: 'the property-level line counts every leasehold with an at-acquisition record (5) instead of the spaces Needs attention raises (4)',
    from: "        '<b>' + _esc('Unresolved at acquisition on ' + _plural(aa.leaseholds, 'space', 'spaces')) + '</b> ' +", to: "        '<b>' + _esc('Unresolved at acquisition on ' + _plural(u ? u.leaseholds : aa.leaseholds, 'space', 'spaces')) + '</b> ' +" },
  { id: 'B18', file: PCV, why: 'any durable actor is presented as "you"',
    from: "    if (uid && me && uid === me) return 'you';", to: "    if (uid) return 'you';" },
  { id: 'B19', file: PCV, why: 'with no actor on record, the review\'s owner is named as the acquirer',
    from: "    var acquiredBy = ep.acquired ? _who(ep.acquired.by, ep.acquired.byEmail) : null;", to: "    var acquiredBy = ep.acquired ? _who(ep.acquired.by || ep.review.startedBy, ep.acquired.byEmail) : null;" },
  { id: 'B20', file: PCV, why: 'the History section is drawn for a property with no episode (an empty, invented acquisition)',
    from: "    var ep = _episode(property);\n    if (!ep) return '';", to: "    var ep = _episode(property) || { review: { id: 'none', startedAt: null, startedBy: null, convertedAt: null, activityCount: null }, acquired: null, documents: { total: 0 }, leaseholds: { count: 0 }, decisions: { count: 0 }, analysedAt: null, unresolved: null };" },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plmut-'));
fs.cpSync(ROOT, tmp, { recursive: true, filter: (src) => { const rel = path.relative(ROOT, src); return !(rel === '.git' || rel.startsWith('.git' + path.sep) || rel === 'node_modules' || rel.startsWith('node_modules' + path.sep)); } });
try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(tmp, 'node_modules'), 'dir'); } catch (_) {}
const ORIGINAL = {};
for (const f of [PL, APP, TS, DS, PW, PCV]) ORIGINAL[f] = fs.readFileSync(path.join(ROOT, f), 'utf8');

// The pure suites first (cheap); the browser suite only when a mutant survives them.
const SUITES = ['test-decision-standing.js', 'test-property-leaseholds.js', 'test-e2e-property-leaseholds.js'];
function runSuites() {
  for (const suite of SUITES) {
    try { execFileSync(process.execPath, [suite], { cwd: tmp, stdio: 'pipe', timeout: 600000 }); }
    catch (_) { return suite; }
  }
  return null;
}

const baseline = runSuites();
console.log('Baseline (unmutated copy): ' + (baseline ? 'FAIL ' + baseline : 'PASS'));
if (baseline) { console.error('\nThe unmutated copy does not pass, so every result below would be meaningless. Nothing is mutated.'); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(2); }

let killed = 0; const survivors = [], equivalents = [];
for (const m of MUTANTS) {
  const src = ORIGINAL[m.file];
  if (src.indexOf(m.from) === -1) { console.log(`  ?  ${m.id} anchor not found in ${m.file} — the harness is stale, not the product`); survivors.push(m.id + ' (anchor missing)'); continue; }
  fs.writeFileSync(path.join(tmp, m.file), src.replace(m.from, m.to));
  const failedBy = runSuites();
  fs.writeFileSync(path.join(tmp, m.file), ORIGINAL[m.file]);
  if (failedBy) { killed++; console.log(`  \x1b[32m☠\x1b[0m  ${m.id} killed by ${failedBy} — ${m.why}`); }
  else if (m.equivalent) { equivalents.push(m.id); console.log(`  \x1b[33m≡\x1b[0m  ${m.id} equivalent (survived, as expected) — ${m.equivalent}`); }
  else { survivors.push(m.id); console.log(`  \x1b[31m✗\x1b[0m  ${m.id} SURVIVED — ${m.why}`); }
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log('\n' + '─'.repeat(58));
console.log(`${killed} killed, ${equivalents.length} equivalent, ${survivors.length} survived of ${MUTANTS.length}`);
if (survivors.length) { survivors.forEach(s => console.log('  · ' + s)); process.exit(1); }
