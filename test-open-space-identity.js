'use strict';
/**
 * test-open-space-identity.js — "Open space →" must be able to do what it says.
 *
 *   node test-open-space-identity.js
 *
 * The defect: the Spaces list admits a tenant with a NAME or an id, and then
 * rendered the gold "Open space →" button for every one of them. _esc(undefined)
 * is '', so a named tenant with no id produced
 *
 *     onclick="...TenantSpace.openSpace('')"
 *
 * and openSpace's own no-identity guard returned silently. A full-strength
 * control that did nothing, said nothing, and stayed inviting. The review queue
 * card had the identical hole via esc(item.tenantId) → openReviewWorkspace('').
 *
 * What is asserted here:
 *   A. TenantSpace.renderList — EXECUTED against a real DOM. A tenant with no
 *      id gets no button and an explanation; a tenant with an id keeps the
 *      button it always had, wired to its own id.
 *   B. openSpace refuses an empty identity and SAYS so, and still opens a
 *      valid one.
 *   C. The review queue card (script.js source — that renderer lives in a
 *      28k-line browser-bound file with no seam to call) offers no action
 *      without an id, and is unchanged for items that have one.
 *   D. openReviewWorkspace fails loudly rather than silently.
 *
 * Section C reads comment-stripped source for the same reason
 * test-phase0-remediation.js does, and is mutation-proven in
 * tools/open-space-mutation.js so it cannot pass vacuously.
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

let pass = 0, fail = 0;
const failures = [];

function t(name, fn) {
  try { fn(); pass++; console.log(`  ok   ${name}`); }
  catch (e) { fail++; failures.push(`${name}: ${e.message}`); console.log(`  FAIL ${name}\n       ${e.message}`); }
}
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg || ''} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
function ok(c, msg) { if (!c) throw new Error(msg || 'expected truthy'); }
function sec(s) { console.log(`\n── ${s} ──`); }
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

// ── A minimal DOM, so renderList can be EXECUTED rather than read ────────────
// Only what tenant-space.js touches: getElementById, createElement, innerHTML,
// and a style host. Nothing here simulates behaviour the test then asserts —
// the assertions all read the HTML the real module produced.
function makeDom() {
  const nodes = {};
  const mk = (id) => {
    const el = {
      id, innerHTML: '', textContent: '', style: {}, children: [],
      appendChild(c) { this.children.push(c); if (c && c.id) nodes[c.id] = c; return c; },
      setAttribute(k, v) { if (k === 'id') { this.id = v; nodes[v] = this; } },
      getAttribute() { return null; },
      // openSpace wires the overlay up for real; a stub that cannot be listened
      // to fails the VALID path for a reason that has nothing to do with the
      // fix. These are inert — nothing here dispatches, so no assertion can be
      // satisfied by the harness pretending an interaction happened.
      addEventListener() {}, removeEventListener() {},
      querySelector() { return null; }, querySelectorAll() { return []; },
      classList: { add() {}, remove() {}, contains() { return false; } },
      focus() {}, scrollIntoView() {}, remove() {},
    };
    return el;
  };
  nodes.spacesList = mk('spacesList');
  return {
    getElementById: (id) => nodes[id] || null,
    createElement: (tag) => { const e = mk(null); e.tagName = tag; return e; },
    head: { appendChild(c) { if (c && c.id) nodes[c.id] = c; return c; } },
    body: { appendChild(c) { if (c && c.id) nodes[c.id] = c; return c; }, style: {},
            children: [], classList: { add() {}, remove() {} } },
    querySelectorAll: () => [],
    _nodes: nodes,
  };
}

function loadTenantSpace(property, toasts) {
  const src = fs.readFileSync(path.join(__dirname, 'tenant-space.js'), 'utf8');
  const doc = makeDom();
  const sandbox = {
    document: doc,
    console,
    setTimeout: (f) => f && 0,
    clearTimeout: () => {},
  };
  sandbox.window = sandbox;
  sandbox.currentProperty = () => property;
  sandbox.showToast = (msg, opts) => { toasts.push({ msg, opts }); };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'tenant-space.js' });
  return { TS: sandbox.window.TenantSpace, doc, sandbox };
}

// A property whose tenants are the two cases that matter, side by side, so a
// fix that simply removes the button for everyone cannot pass.
const PROPERTY = {
  id: 'prop-1', name: 'Maple Plaza', totalSqft: 26000, tenants: [
    { id: 'tenant-good', tenant_name: 'Alder Hardware', leased_sqft: 9200, lease_type: 'Triple Net (NNN)' },
    { id: null,          tenant_name: 'Briar Optical',  leased_sqft: 1800 },
    { id: '',            tenant_name: 'Cedar Stationers' },
    // The id key ABSENT, not null — the shape _scopedEvents' guard was written
    // for. `e.tenantId === tenantId` is true when both are undefined, so a
    // property-wide event (below) would otherwise scope into this one suite as
    // if it had happened there.
    {                    tenant_name: 'Dogwood Deli',    leased_sqft: 600 },
  ],
  // Real scoped records on the VALID tenant, so "counts still render" is an
  // assertion with something to lose. Without these every count is 0 and a
  // change that deleted the counts entirely would pass unnoticed — mutation
  // testing caught exactly that.
  timeline: [
    { id: 'ev-1', tenantId: 'tenant-good', manual: true, category: 'note', type: 'manual_note',
      title: 'Quarterly walkthrough', timestamp: '2026-03-02T10:00:00Z' },
    { id: 'ev-2', tenantId: 'tenant-good', manual: true, category: 'maintenance', type: 'manual_maintenance',
      title: 'HVAC filter change', timestamp: '2026-04-11T10:00:00Z',
      attachments: [{ name: 'invoice.pdf', url: 'https://x/i.pdf', kind: 'invoice' }] },
    // PROPERTY-WIDE: no tenantId at all. This belongs to the building, not to
    // any suite, and must never be counted as one tenant's record.
    { id: 'ev-3', manual: true, category: 'note', type: 'manual_note',
      title: 'Building fire-alarm inspection', timestamp: '2026-05-01T10:00:00Z' },
    // Addressed to a SUITE BY LABEL, with no tenantId. This is the live path
    // _scopedEvents' identity refusal still protects: the id/subject matches
    // below are both `!= null`-guarded, so an undefined id cannot match them,
    // but the name fallback matches on label alone. Without the early return an
    // id-less tenant with a unique name would collect this as its own record.
    { id: 'ev-4', manual: true, category: 'note', type: 'manual_note',
      title: 'Signage permit filed', timestamp: '2026-05-02T10:00:00Z',
      subject: { type: 'suite', label: 'Dogwood Deli' } },
  ],
  disputes: [],
};

const scriptSrc = code(fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8'));

// ── A. The Spaces list ───────────────────────────────────────────────────────
sec('A. The Spaces card only offers to open what it can open');
{
  const toasts = [];
  const { TS, doc } = loadTenantSpace(PROPERTY, toasts);
  TS.renderList(PROPERTY);
  const html = doc._nodes.spacesList.innerHTML;

  t('A0 the list actually rendered all three spaces', () => {
    ok(/Alder Hardware/.test(html), 'valid tenant missing from the list');
    ok(/Briar Optical/.test(html),  'a tenant with no id must still be SHOWN, just not openable');
    ok(/Cedar Stationers/.test(html), 'a tenant with a blank id must still be shown');
  });
  t('A1 NO control anywhere calls openSpace with an empty identity', () => {
    ok(!/openSpace\('\s*'\)/.test(html), `dead control present in:\n${html}`);
  });
  t('A2 the tenant WITH an id keeps its button, wired to its own id', () => {
    ok(/TenantSpace\.openSpace\('tenant-good'\)/.test(html),
       'the working case regressed — the valid button is gone or rewired');
    eq((html.match(/class="tsl-open"/g) || []).length, 1,
       'exactly one openable space in this fixture');
  });
  t('A3 the three that cannot be opened SAY so instead', () => {
    eq((html.match(/class="tsl-noopen"/g) || []).length, 3,
       'every id-less space must explain itself (null, empty string, and absent)');
    ok(/Can’t open yet — no saved record/.test(html), `explanation missing in:\n${html}`);
  });
  t('A3b an id-less space does not absorb records addressed to its label', () => {
    // ev-4 names "Dogwood Deli" as a suite subject and carries no tenantId.
    // The id and subject-id matches in _scopedEvents are both `!= null`-guarded
    // so an undefined id cannot reach them, but the unique-name fallback
    // matches on label alone — so the early identity refusal is what stops a
    // tenant with no id from collecting it. Remove that refusal and this card
    // starts reporting "1 event" it has no identity to own.
    eq((html.match(/No records yet/g) || []).length, 3,
       `an id-less space claimed records it cannot own:\n${html}`);
    eq((html.match(/tsl-counts">/g) || []).length, 1,
       'exactly one space on this property has records of its own');
  });
  t('A4 the explanation is not a button and carries no click handler', () => {
    const block = /<div class="tsl-noopen"[^>]*>[\s\S]*?<\/div>/.exec(html);
    ok(block, 'no tsl-noopen block found');
    ok(!/onclick/i.test(block[0]), `still clickable: ${block[0]}`);
    ok(!/<button/i.test(block[0]), `still a button: ${block[0]}`);
  });
  t('A5 no identity is invented — the id-less cards name no id at all', () => {
    ok(!/openSpace\('(null|undefined)'\)/.test(html), 'a literal null/undefined id was rendered');
    ok(!/tenant-good/.test(/Briar Optical[\s\S]*?<\/div>\s*<\/div>/.exec(html) ? RegExp.lastMatch : ''),
       'a neighbouring id leaked onto the wrong card');
  });
  t('A6 rendering did not fire a toast — a list is not an error', () => {
    eq(toasts.length, 0, JSON.stringify(toasts));
  });
}

// ── A′. The same card must not borrow a neighbour's numbers ──────────────────
sec('A′. An id-less card shows no figures it cannot attribute');
{
  // assemble() finds its tenant with `x.id === tenantId`, and null === null is
  // true — so with two id-less tenants BOTH assemble against the first. This
  // was measured on the real module before it was guarded: the second card,
  // 111 sqft, rendered "9999 sqft" under its own name.
  const TWO_BLANKS = { id: 'p', timeline: [], disputes: [], tenants: [
    { id: null, tenant_name: 'First NoId',  leased_sqft: 9999, lease_type: 'NNN' },
    { id: null, tenant_name: 'Second NoId', leased_sqft: 111 },
  ] };
  const { TS, doc } = loadTenantSpace(TWO_BLANKS, []);
  TS.renderList(TWO_BLANKS);
  const html = doc._nodes.spacesList.innerHTML;

  // ── KNOWN GAP, PINNED SO IT CANNOT BE FORGOTTEN ────────────────────────────
  //
  // The area on an id-less card can be its NEIGHBOUR's. This test records the
  // defect exactly rather than asserting it away, for two reasons: the honest
  // fix belongs in assemble()'s lookup (read by PropertyRecord, AIWorkspace and
  // the MCP projection, so not this slice's to change), and guarding the render
  // line alone changes the shape M8c/M8d pinned in test-m8d E12.
  //
  // A future slice that fixes it will fail A7 and have to update it on purpose,
  // which is the point of writing it down this way.
  t('A7 KNOWN GAP: an id-less card can show a neighbour’s area (not fixed here)', () => {
    ok(/9999 sqft/.test(html),
       'the neighbour-area leak appears to be fixed — good, but update this test deliberately');
    ok(!/111 sqft/.test(html),
       'the second id-less card now shows its OWN area, which would mean assemble() was changed');
  });
  t('A8 the leak is confined to the area — no records are claimed', () => {
    // The part that IS safe today, and worth holding: _scopedEvents refuses to
    // scope without an identity, so neither card claims the other's history.
    eq((html.match(/No records yet/g) || []).length, 2,
       `an id-less space claimed records it cannot own:\n${html}`);
  });
  t('A9 both cards still appear, named, and both say they cannot be opened', () => {
    ok(/First NoId/.test(html) && /Second NoId/.test(html), 'a card disappeared');
    eq((html.match(/class="tsl-noopen"/g) || []).length, 2, 'both must explain themselves');
  });
  t('A9b an id-less card claims no records — enforced upstream by _scopedEvents', () => {
    // This is the reason renderList carries no second guard on the counts:
    // _scopedEvents returns [] without an identity, so the count is already 0
    // and "No records yet" is what the card prints. Asserted here so that if
    // that upstream refusal is ever weakened, THIS fails rather than a card
    // quietly starting to claim the building's history as one suite's.
    eq((html.match(/No records yet/g) || []).length, 2,
       'an id-less space claimed records it cannot own');
  });
  t('A10 a tenant WITH an id keeps its area AND its record counts', () => {
    const { TS: TS2, doc: d2 } = loadTenantSpace(PROPERTY, []);
    TS2.renderList(PROPERTY);
    const h2 = d2._nodes.spacesList.innerHTML;
    ok(/9200 sqft/.test(h2), 'the working card lost the area it always showed');
    ok(/2 events/.test(h2), `the working card lost its record counts:\n${h2}`);
    ok(/1 invoice/.test(h2), 'the working card lost its attachment counts');
  });
}

// ── B. openSpace itself ──────────────────────────────────────────────────────
sec('B. openSpace refuses an empty identity out loud');
{
  t('B1 an empty id opens nothing and says why', () => {
    const toasts = [];
    const { TS, doc } = loadTenantSpace(PROPERTY, toasts);
    TS.openSpace('');
    eq(doc._nodes.tsOverlay, undefined, 'an overlay was built for a space with no identity');
    eq(toasts.length, 1, 'the refusal was silent — the original defect');
    ok(/no saved record/i.test(toasts[0].msg), toasts[0].msg);
  });
  t('B2 null and undefined are refused the same way', () => {
    for (const bad of [null, undefined]) {
      const toasts = [];
      const { TS } = loadTenantSpace(PROPERTY, toasts);
      TS.openSpace(bad);
      eq(toasts.length, 1, `openSpace(${bad}) was silent`);
    }
  });
  t('B3 with no property loaded it says THAT instead — a different fact', () => {
    const toasts = [];
    const src = fs.readFileSync(path.join(__dirname, 'tenant-space.js'), 'utf8');
    const doc = makeDom();
    const sb = { document: doc, console, setTimeout: (f) => f && 0, clearTimeout: () => {} };
    sb.window = sb;
    sb.currentProperty = () => null;
    sb.showToast = (msg) => toasts.push({ msg });
    vm.createContext(sb);
    vm.runInContext(src, sb, { filename: 'tenant-space.js' });
    sb.window.TenantSpace.openSpace('tenant-good');
    eq(toasts.length, 1);
    ok(/Open a property first/i.test(toasts[0].msg), toasts[0].msg);
  });
  // B4 asserts the GUARD BOUNDARY, which is what this slice changed, and stops
  // there on purpose.
  //
  // openSpace goes on to build the whole overlay out of parsed markup, and this
  // file's DOM is a stub with no HTML parser — it cannot getElementById an
  // element that only exists inside an innerHTML string. Faking that far would
  // mean the harness, not the module, deciding what "opened" means. The overlay
  // itself is already covered end-to-end by the Playwright suites
  // (test-space-activity.js opens a real space in a real browser).
  //
  // So: a valid id must NOT be refused, and must get past the guard into the
  // work — injectStyles() is the first statement after it, and it registers a
  // real element. Anything thrown after that is the stub's limit, not a refusal,
  // and the two are distinguished rather than conflated.
  t('B4 a VALID id is not refused — it passes the guard and starts opening', () => {
    const toasts = [];
    const { TS, doc } = loadTenantSpace(PROPERTY, toasts);
    let threwAt = null;
    try { TS.openSpace('tenant-good'); } catch (e) { threwAt = e.message; }
    eq(toasts.length, 0,
       `opening a real space was refused: ${JSON.stringify(toasts)}`);
    ok(doc._nodes['ts-styles'],
       'execution never reached injectStyles() — the guard rejected a valid id');
    ok(threwAt === null || /null|undefined/i.test(threwAt),
       `openSpace failed for a reason the DOM stub does not explain: ${threwAt}`);
  });
  t('B5 the refusal and the valid path are genuinely different — no toast, styles injected', () => {
    // Proves B4 is discriminating: the SAME assertions run against an empty id
    // must come out the other way round.
    const toasts = [];
    const { TS, doc } = loadTenantSpace(PROPERTY, toasts);
    try { TS.openSpace(''); } catch (_) {}
    eq(toasts.length, 1, 'the empty id was not refused');
    ok(!doc._nodes['ts-styles'],
       'an empty id still ran injectStyles — the guard is not first');
  });
}

// ── C. The review queue card ─────────────────────────────────────────────────
sec('C. The review queue offers no action it cannot perform');
{
  const card = /function _rqCompactItemHtml\(item\)[\s\S]*?\n}/.exec(scriptSrc);
  t('C0 the card renderer was found', () => ok(card, '_rqCompactItemHtml not found'));

  t('C1 an item with no tenant id gets no action button at all', () => {
    ok(/if \(!tid\) \{[\s\S]{0,240}?rq-chip--warn/.test(card[0]),
       'no id-less branch in the actions block');
    ok(/Can’t open — no saved record/.test(card[0]), 'the explanation text is missing');
  });
  t('C2 BOTH actions are inside that guard, not just the primary one', () => {
    // The bug was that openReviewWorkspace and openReviewItemFix each took tid
    // independently. Neither may be reachable when tid is falsy, so both must
    // be emitted after the early return.
    const guardAt   = card[0].indexOf('if (!tid)');
    const reviewAt  = card[0].indexOf('openReviewWorkspace(');
    const fixAt     = card[0].indexOf('openReviewItemFix(');
    ok(guardAt !== -1, 'no guard');
    ok(reviewAt > guardAt, 'openReviewWorkspace is emitted before the guard');
    ok(fixAt   > guardAt, 'openReviewItemFix is emitted before the guard');
  });
  t('C3 the working case is untouched — both still carry the tenant id', () => {
    ok(/openReviewWorkspace\('\$\{tid\}'\)/.test(card[0]), 'primary action lost its id');
    ok(/openReviewItemFix\('\$\{tid\}',/.test(card[0]), 'fix action lost its id');
  });
  t('C4 the acknowledged state still renders the primary action beside it', () => {
    ok(/if \(acked\) return primary \+/.test(card[0]),
       'an acknowledged item lost its Review button');
  });
  t('C5 no identity is invented for an id-less item', () => {
    const guard = /if \(!tid\) \{[\s\S]*?\n        \}/.exec(card[0]);
    ok(guard, 'guard block not found');
    ok(!/tenantId|item\.id|\|\|\s*'/.test(guard[0]),
       `the guard substitutes an id: ${guard[0]}`);
  });
}

// ── D. openReviewWorkspace ───────────────────────────────────────────────────
sec('D. openReviewWorkspace fails loudly, not silently');
{
  const fn = /function openReviewWorkspace\(tenantId\)[\s\S]*?\n}/.exec(scriptSrc);
  t('D0 the function was found', () => ok(fn, 'openReviewWorkspace not found'));
  t('D1 an empty id is refused before the lookup runs', () => {
    const guardAt = fn[0].indexOf('if (!tenantId)');
    const loopAt  = fn[0].indexOf('for (const p of _props)');
    ok(guardAt !== -1, 'no empty-id guard');
    ok(guardAt < loopAt, 'the guard runs after the scan');
  });
  t('D2 both failure paths tell the user something', () => {
    const toasts = (fn[0].match(/showToast\(/g) || []).length;
    ok(toasts >= 2, `only ${toasts} showToast call(s) — a silent return remains`);
  });
  // D2b exists because mutation found D2 asleep: counting showToast calls and
  // banning the exact string `if (!t) return;` both pass when the silent return
  // is simply rewritten as `if (!t) { return; }` with the toast stranded in
  // dead code below it. So the region between the lookup and the success path
  // is checked STRUCTURALLY — every way out of it must speak first.
  t('D2b no exit between the lookup and the open is silent', () => {
    const start = fn[0].indexOf('if (!t) t = tenantData');
    const end   = fn[0].indexOf('_rwActiveTenantId = tenantId');
    ok(start !== -1 && end > start, 'the lookup/open region could not be located');
    const region = fn[0].slice(start, end);
    const returns = (region.match(/\breturn\b/g) || []).length;
    eq(returns, 1, `expected exactly one bail-out in the region, found ${returns}:\n${region}`);
    const retAt   = region.indexOf('return');
    const toastAt = region.indexOf('showToast(');
    ok(toastAt !== -1 && toastAt < retAt,
       `the bail-out returns without telling the user:\n${region}`);
  });
  t('D3 the two failures are described differently', () => {
    ok(/no saved tenant record/i.test(fn[0]), 'missing the no-id message');
    ok(/not on any loaded property/i.test(fn[0]), 'missing the not-found message');
  });
  t('D4 a found tenant still opens the workspace', () => {
    ok(/document\.getElementById\('reviewWorkspace'\)\.classList\.add\('open'\)/.test(fn[0]),
       'the success path was disturbed');
  });
}

// ── Z. The source assertions are not vacuous ─────────────────────────────────
sec('Z. Self-checks');
{
  t('Z1 code() strips line comments', () => {
    ok(!/NOT A MATCH/.test(code('// NOT A MATCH')), 'comment survived');
  });
  t('Z2 code() strips block comments', () => {
    ok(!/NOT A MATCH/.test(code('/* NOT A MATCH */')), 'block comment survived');
  });
  t('Z3 script.js really loaded', () => ok(scriptSrc.length > 500000, `${scriptSrc.length} chars`));
  t('Z4 the DOM harness renders SOMETHING, so section A is real', () => {
    const { TS, doc } = loadTenantSpace(PROPERTY, []);
    TS.renderList(PROPERTY);
    ok(doc._nodes.spacesList.innerHTML.length > 200,
       'the harness produced no markup — section A would pass vacuously');
  });
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { failures.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
