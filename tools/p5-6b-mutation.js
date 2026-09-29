'use strict';
/**
 * tools/p5-6b-mutation.js — do the P5-6B suites bite?
 *
 *   node tools/p5-6b-mutation.js
 *
 * P5-6B puts the acquisition memory into the server's PropertyRecord: read AS
 * THE CALLER (publishable key + the caller's token, under RLS), only after the
 * ownership and managed checks, composed by the one shared pure module,
 * request-local, never through the service transport, never with the token
 * leaving the read, and narrowed at the external boundary. Each mutant is one
 * edit that breaks one leg of that. Every one must be caught.
 *
 * A FAILING BASELINE IS NOT A PASS.
 */
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PL = 'property-leaseholds.js', HYD = 'api/_property-record-hydrator.js', CAP = 'api/_mcp-capabilities.js',
      TR = 'api/_mcp-transport.js', PR = 'property-record.js';

const MUTANTS = [
  // ── the composer ─────────────────────────────────────────────────────────
  { id: 'M01', file: PL, why: 'a failed read is ignored — the memory claims what it could not read',
    from: "    if (!propertyId || failed.length) {", to: "    if (!propertyId) {" },
  { id: 'M02', file: PL, why: 'an acquired property with no episode record reads as never acquired',
    from: "      else if (current.acquiredAt) reasons.push('acquired_without_episode_record');", to: "" },
  { id: 'M03', file: PL, why: 'two converted reviews: the first is picked instead of refusing',
    from: "    if (converted.length !== 1) {", to: "    if (converted.length === 0) {" },
  { id: 'M04', file: PL, why: 'families of another review count as this episode\'s leaseholds',
    from: ".filter(function (id) { return built.byLeaseholdId[id].family.reviewId === r.id; })", to: ".filter(function (id) { return !!id; })" },
  { id: 'M05', file: PL, why: 'a rejected reading is compared with the current value as if it were decided',
    from: "        if (t && !s.rejected) {", to: "        if (t) {" },
  { id: 'M06', file: PL, why: 'an acquisition with no direct event is reported ok',
    from: "    if (!ep.acquired || ep.acquired.source !== 'property_events') reasons.push('no_acquisition_event');", to: "" },
  { id: 'M07', file: PL, why: 'an unreadable canonical record is reported ok',
    from: "    if (!built.acquisition) reasons.push('at_acquisition_unrecorded');", to: "" },
  { id: 'M08', file: PL, why: 'invoice lines that disagree with the event count pass silently',
    from: "    else if (invoices.countMatchesEvent === false) reasons.push('invoice_count_mismatch');", to: "" },
  { id: 'M09', file: PL, why: 'a non-numeric invoice amount becomes 0 — a total is invented',
    from: "amount: isFinite(amt) ? amt : null,", to: "amount: isFinite(amt) ? amt : 0," },
  { id: 'M10', file: PL, why: 'carried invoices claim linked originals',
    from: "             originalsLinked: false, linkedToCurrentInvoices: false };", to: "             originalsLinked: lines.length > 0, linkedToCurrentInvoices: false };" },
  { id: 'M11', file: PL, why: 'a conversion record naming another property is accepted',
    from: "    if ((conv.reviewId != null && conv.reviewId !== reviewId) || (conv.propertyId != null && conv.propertyId !== propertyId)) {", to: "    if (false) {" },
  { id: 'M12', file: PL, why: 'acquired_at disagreeing with the event passes silently',
    from: "    if (current.acquiredAt && ep.acquired && _time(current.acquiredAt) !== _time(ep.acquired.at)) reasons.push('acquired_at_mismatch');", to: "" },
  { id: 'M13', file: PL, why: 'a uid-only actor is not flagged — a reader may name a person',
    from: "    if (ep.acquired && ep.acquired.by && !ep.acquired.byEmail) limitations.push('actor_uid_only');", to: "" },
  { id: 'M14', file: PL, why: 'the server writes the page-lifetime map (shared across requests on a warm instance)',
    from: "    var ep = built.episode;\n    var limitations = [];", to: "    var ep = built.episode; set(propertyId, built);\n    var limitations = [];" },
  { id: 'M15', file: PL, why: 'a value the current tenant does not hold is reported as the same',
    from: "    if (!_present(field, shown)) return 'absent';", to: "    if (!_present(field, shown)) return 'same';" },
  { id: 'M16', file: PL, why: 'the CURRENT value is merged into the acquisition memory',
    from: "        return { field: s.field, label: s.label, action: s.action, value: s.value,",
    to:   "        return { field: s.field, label: s.label, action: s.action, value: (t && currentFromTenant(t)[s.field] != null && currentFromTenant(t)[s.field] !== '') ? currentFromTenant(t)[s.field] : s.value," },
  { id: 'M17', file: PL, why: 'a superseded upload counts as unfiled',
    from: "    if (d.superseded_by_document_id) return 'superseded';\n", to: "" },
  { id: 'M18', file: PL, why: 'the memory read takes the whole review data blob',
    from: "REVIEW_COLUMNS.concat(['invoices:data->invoices', 'conversion:data->conversionRecord'])", to: "REVIEW_COLUMNS.concat(['data'])" },
  { id: 'M19', file: PL, why: 'a possibly truncated read is not reported',
    from: "    _arr(inp.truncated).forEach(function (t) { reasons.push('read_truncated:' + String(t)); });", to: "" },
  { id: 'M20', file: PL, why: 'the browser\'s review read is widened too',
    from: "    reviews:   REVIEW_COLUMNS.join(', '),", to: "    reviews:   MEMORY_REVIEW_COLUMNS.join(', ')," },
  // ── the hydrator ─────────────────────────────────────────────────────────
  { id: 'H01', file: HYD, why: 'with no caller transport the SERVICE transport is borrowed for the acquisition reads',
    from: "    const rawUser = o.userFetch || (o.sbFetch ? null : _defaultUserFetch);", to: "    const rawUser = o.userFetch || (o.sbFetch ? ((p, t, opt) => raw(p, opt)) : _defaultUserFetch);" },
  { id: 'H02', file: HYD, why: 'the caller transport sends the service key as apikey',
    from: "        'apikey': SUPABASE_ANON_KEY,\n        'Authorization': `Bearer ${token}`,", to: "        'apikey': _key(),\n        'Authorization': `Bearer ${token}`," },
  { id: 'H03', file: HYD, why: 'the caller transport sends the service key as the bearer — RLS no longer judges the caller',
    from: "        'Authorization': `Bearer ${token}`,", to: "        'Authorization': `Bearer ${_key()}`," },
  { id: 'H04', file: HYD, why: 'a caller-supplied header can replace the key and bearer',
    from: "        'Content-Type': 'application/json',\n        ...(options.headers || {}),\n        'apikey': SUPABASE_ANON_KEY,\n        'Authorization': `Bearer ${token}`,\n        'Prefer': '',\n      },",
    to:   "        'Content-Type': 'application/json',\n        'apikey': SUPABASE_ANON_KEY,\n        'Authorization': `Bearer ${token}`,\n        'Prefer': '',\n        ...(options.headers || {}),\n      }," },
  { id: 'H05', file: HYD, why: 'the "Bearer " prefix is sent through as part of the token',
    from: "    const token = String(o.userToken == null ? '' : o.userToken).replace(/^Bearer\\s+/i, '').trim();", to: "    const token = String(o.userToken == null ? '' : o.userToken).trim();" },
  { id: 'H06', file: HYD, why: 'the decisions read is not filtered to the property',
    from: "    decisions: `/acquisition_term_decisions?property_id=eq.${pid}&select=", to: "    decisions: `/acquisition_term_decisions?select=" },
  { id: 'H07', file: HYD, why: 'the review read takes open reviews too',
    from: "    reviews:   `/acquisition_reviews?property_id=eq.${pid}&status=eq.converted&select=", to: "    reviews:   `/acquisition_reviews?property_id=eq.${pid}&select=" },
  { id: 'H08', file: HYD, why: 'a failed acquisition read is swallowed as "no rows"',
    from: "    if (!r || r.status >= 300 || !Array.isArray(r.json)) { failed.push(n); rows[n] = []; return; }", to: "    if (!r || !Array.isArray(r.json)) { rows[n] = []; return; }" },
  { id: 'H09', file: HYD, why: 'the token leaks into the recorded reads',
    from: "    const userSb  = _readOnly(async (p, options) => { reads.push(p); return rawUser(p, token, options); });", to: "    const userSb  = _readOnly(async (p, options) => { reads.push(p + '#' + token); return rawUser(p, token, options); });" },
  { id: 'H10', file: HYD, why: 'no caller token: the reads go ahead anyway',
    from: "    if (!token) {\n      return PropertyLeaseholds.memory({ propertyId, property: lifecycle, failed: ['user_session'] });\n    }", to: "" },
  { id: 'H11', file: HYD, why: 'a read that reached the row limit is not marked',
    from: "    if (r.json.length >= ACQ_ROW_LIMIT) truncated.push(n);", to: "" },
  // ── the capability ───────────────────────────────────────────────────────
  { id: 'C01', file: CAP, why: 'the caller token is not handed to the hydrator',
    from: "    userToken: c.token,", to: "    userToken: undefined," },
  { id: 'C02', file: CAP, why: 'an unavailable section is returned as an object instead of null',
    from: "    acquisition: sectionValue(status.acquisition, rec.acquisition),", to: "    acquisition: rec.acquisition," },
  { id: 'C03', file: CAP, why: 'an empty section is reported ok',
    from: "  if (s === 'empty') return STATUS.EMPTY;", to: "  if (s === 'empty') return STATUS.OK;" },
  { id: 'C04', file: CAP, why: 'a degraded section carries no caveat',
    from: "  } else if (st === STATUS.DEGRADED) {", to: "  } else if (false) {" },
  // ── the external transport ───────────────────────────────────────────────
  { id: 'T01', file: TR, why: 'the acquiring actor\'s id and email leave the boundary',
    from: "    delete q.byUid; delete q.byEmail;", to: "" },
  { id: 'T02', file: TR, why: 'every actor is reported as the caller',
    from: "  return (callerUid && uid === callerUid) ? 'caller' : 'another_user';", to: "  return 'caller';" },
  { id: 'T03', file: TR, why: 'the acquisition section is not narrowed at all',
    from: "    if (toolName === 'get_property' && data.acquisition) {", to: "    if (false) {" },
  { id: 'T04', file: TR, why: 'the caller is not known to the narrowing — the caller\'s own act reads as another user\'s',
    from: "  const projected = _project(name, env, win, identity.userId);", to: "  const projected = _project(name, env, win);" },
  { id: 'T05', file: TR, why: 'the acquisition section is not bounded',
    from: "    d.acquisition = _boundAcquisition(d.acquisition, bounded);\n", to: "" },
  // ── the record ───────────────────────────────────────────────────────────
  { id: 'R01', file: PR, why: 'PropertyRecord drops the acquisition section',
    from: "      acquisition: (p && p.acquisition && typeof p.acquisition === 'object') ? p.acquisition : null,", to: "      acquisition: null," },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p56bmut-'));
fs.cpSync(ROOT, tmp, { recursive: true, filter: (src) => { const rel = path.relative(ROOT, src); return !(rel === '.git' || rel.startsWith('.git' + path.sep) || rel === 'node_modules' || rel.startsWith('node_modules' + path.sep)); } });
try { fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(tmp, 'node_modules'), 'dir'); } catch (_) {}
const ORIGINAL = {};
for (const f of [PL, HYD, CAP, TR, PR]) ORIGINAL[f] = fs.readFileSync(path.join(ROOT, f), 'utf8');

const SUITES = ['test-p5-6b-acquisition-memory.js', 'test-property-leaseholds.js', 'test-property-record.js'];
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

let killed = 0; const survivors = [];
for (const m of MUTANTS) {
  const src = ORIGINAL[m.file];
  if (src.indexOf(m.from) === -1) { console.log(`  ?  ${m.id} anchor not found in ${m.file} — the harness is stale, not the product`); survivors.push(m.id + ' (anchor missing)'); continue; }
  if (src.indexOf(m.from) !== src.lastIndexOf(m.from)) { console.log(`  ?  ${m.id} anchor is not unique in ${m.file}`); survivors.push(m.id + ' (anchor ambiguous)'); continue; }
  fs.writeFileSync(path.join(tmp, m.file), src.replace(m.from, m.to));
  const failedBy = runSuites();
  fs.writeFileSync(path.join(tmp, m.file), ORIGINAL[m.file]);
  if (failedBy) { killed++; console.log(`  \x1b[32m☠\x1b[0m  ${m.id} killed by ${failedBy} — ${m.why}`); }
  else { survivors.push(m.id); console.log(`  \x1b[31m✗\x1b[0m  ${m.id} SURVIVED — ${m.why}`); }
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log('\n' + '─'.repeat(58));
console.log(`${killed} killed, ${survivors.length} survived of ${MUTANTS.length}`);
if (survivors.length) { survivors.forEach(s => console.log('  · ' + s)); process.exit(1); }
