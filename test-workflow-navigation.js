'use strict';
/**
 * test-workflow-navigation.js — can a manager tell where they are, and follow
 * the instructions the app gives them?
 *
 *   node test-workflow-navigation.js
 *
 * Two defects, both found by walking the real workflow rather than reading it:
 *
 * A. INSTRUCTIONS NAMING PLACES THAT DO NOT EXIST. The app was reorganised from
 *    numbered sections into subject tabs (Overview · Property · Spaces · CAM ·
 *    Reserves · Reports — script.js WORKSPACE_TABS). Six user-facing messages
 *    were left behind pointing at "Section 2", "Section 3" and "Section 4".
 *    Every one of them fires exactly when a manager is already stuck:
 *
 *      "upload at least one lease ... in Section 2"        (nothing to allocate)
 *      "Click Edit on each tenant in Section 2"            (tenant missing sqft)
 *      "upload at least one invoice ... in Section 3"      (no invoices)
 *      "Open each invoice in Section 3"                    (invoice with no amount)
 *      "Upload at least one lease in Section 2"            (allocation blocker)
 *      "Run a CAM allocation in Section 4"                 (Reports, empty)
 *
 *    So the one moment the app explains what to do next, it names a place the
 *    manager cannot find. The fix is not new copy — script.js already had the
 *    right convention a few hundred lines away ("(Property tab)", "(Spaces
 *    tab)", "(CAM tab)"); the stragglers now match it.
 *
 * B. A SPACE THAT DOES NOT SAY WHICH BUILDING IT IS IN. TenantSpace.openSpace
 *    covers the screen, hiding the workspace, its tab bar and the property name
 *    behind it. Its subtitle was the fixed line "Everything about this space, in
 *    one place". The review overlay in the same product puts the property name
 *    in exactly that slot, so the two disagreed about whether a manager needs to
 *    know where they are.
 *
 * WHAT IS DELIBERATELY NOT FIXED HERE, and asserted so the reasoning survives:
 * a VACANT suite is not distinguished from an occupied one in the Spaces list.
 * It cannot be, honestly — see section D.
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

// Comments are stripped so no assertion can be satisfied by the fix's own prose
// — including the block above, which quotes every string this file bans.
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const scriptSrc = code(fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8'));
// COMMENT-STRIPPED, and the reason is worth keeping: the first version of this
// file read tenant-space.js raw, and C2 ("the fallback copy still exists") then
// passed against the explanatory COMMENT above the fix, which quotes that exact
// sentence. Mutation caught it — deleting the real fallback left the suite
// green. An assertion that a fix's own prose can satisfy is not an assertion.
const tsSrc     = code(fs.readFileSync(path.join(__dirname, 'tenant-space.js'), 'utf8'));
const htmlSrc   = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// ── A. The tab vocabulary is real ────────────────────────────────────────────
sec('A. The places the app names are places that exist');
{
  const m = /const WORKSPACE_TABS = \[([^\]]*)\];/.exec(scriptSrc);
  const TABS = m ? m[1].match(/'([^']+)'/g).map(s => s.replace(/'/g, '')) : [];

  t('A1 WORKSPACE_TABS is the six subject tabs', () => {
    ok(m, 'WORKSPACE_TABS not found');
    ['overview', 'property', 'spaces', 'cam', 'reports', 'reserves']
      .forEach(x => ok(TABS.indexOf(x) !== -1, `${x} missing from ${JSON.stringify(TABS)}`));
  });
  t('A2 every tab a manager can reach has a pane and a button', () => {
    // 'property' is built at runtime by property-os.js, which is why grepping
    // the HTML for it finds nothing; asserted here so the exception stays
    // deliberate rather than becoming a surprise.
    const runtime = ['property'];
    TABS.filter(x => runtime.indexOf(x) === -1).forEach(x => {
      ok(htmlSrc.indexOf('id="wsPane-' + x + '"') !== -1, `no pane for ${x}`);
    });
    ok(/pane\.id = 'wsPane-property'/.test(tsSrcOrOs()), 'nothing builds the property pane');
    ok(/b\.id = 'wsTabBtn-property'/.test(tsSrcOrOs()), 'nothing builds the property tab button');
  });
  function tsSrcOrOs() {
    return fs.readFileSync(path.join(__dirname, 'property-os.js'), 'utf8');
  }
  t('A3 the retired Documents tab is hidden rather than left clickable', () => {
    const os = fs.readFileSync(path.join(__dirname, 'property-os.js'), 'utf8');
    ok(/docsBtn\.style\.display = 'none'/.test(os),
       'the retired Documents button is no longer hidden — it would be a dead tab');
    ok(TABS.indexOf('documents') === -1, 'documents is back in the tab list without a pane');
  });
}

// ── B. No instruction points at a place that no longer exists ────────────────
sec('B. Navigation instructions name tabs, not retired section numbers');
{
  // The six messages, by the condition that fires them. Each is asserted twice:
  // the stale form is gone, and the replacement names a real tab — so deleting
  // the sentence outright would not pass.
  const CASES = [
    { why: 'a tenant is missing leased sqft',
      gone: /Click "Edit" on each tenant in Section 2/,
      now:  /Click "Edit" on each tenant on the Spaces tab/ },
    { why: 'no lease has a name and sqft',
      gone: /at least one lease with a name and square footage in Section 2/,
      now:  /at least one lease with a name and square footage on the Spaces tab/ },
    { why: 'no invoice has a vendor and amount',
      gone: /at least one invoice with a vendor and amount in Section 3/,
      now:  /at least one invoice with a vendor and amount on the CAM tab/ },
    { why: 'an invoice has no amount',
      gone: /Open each invoice in Section 3/,
      now:  /Open each invoice on the CAM tab/ },
    { why: 'allocation is blocked with no leases',
      gone: /Upload at least one lease in Section 2 before running allocation/,
      now:  /Upload at least one lease on the Spaces tab before running allocation/ },
    { why: 'Reports has nothing to show yet',
      gone: /Run a CAM allocation in Section 4 to generate reports/,
      now:  /Run a CAM allocation on the CAM tab to generate reports/ },
  ];
  CASES.forEach((c, i) => {
    t(`B${i + 1} ${c.why}`, () => {
      ok(!c.gone.test(scriptSrc), 'still names a retired numbered section');
      ok(c.now.test(scriptSrc), 'the instruction lost its destination entirely');
    });
  });

  t('B7 no user-facing instruction anywhere sends a manager to a Section number', () => {
    // The catch-all. Report BODIES legitimately use "Section 1 — Summary" as
    // their own headings, and a lease citation legitimately says "Section 9.1";
    // neither is navigation. What must not survive is an instruction that tells
    // someone to go somewhere: those all carry a verb and a preposition.
    const nav = scriptSrc.match(/(?:in|to|on|open|upload|click)[^'"`\n]{0,60}Section \d(?!\.\d)(?![^'"`\n]{0,20}—)/gi) || [];
    eq(nav.length, 0, `navigation instructions still name a Section: ${JSON.stringify(nav)}`);
  });
  t('B8 B7 is discriminating — it matches the old wording and spares the legitimate one', () => {
    // B7 passing could mean "no instruction names a Section" or "the pattern
    // matches nothing at all". Proved directly against text rather than against
    // other code: the pattern must fire on each sentence as it USED to read,
    // and must not fire on a lease-clause citation.
    //
    // (The report-body headings first used as the counter-example here turned
    // out to be `//` comments, which code() strips — so they could never have
    // demonstrated anything. This checks the property itself.)
    const nav = (s) => (s.match(/(?:in|to|on|open|upload|click)[^'"`\n]{0,60}Section \d(?!\.\d)(?![^'"`\n]{0,20}—)/gi) || []).length;
    [
      'Click "Edit" on each tenant in Section 2 and enter their square footage, then run again.',
      'Please upload at least one lease with a name and square footage in Section 2.',
      'Please upload at least one invoice with a vendor and amount in Section 3.',
      'Open each invoice in Section 3 and enter the missing amount to include them.',
      'Upload at least one lease in Section 2 before running allocation',
      'Run a CAM allocation in Section 4 to generate reports.',
    ].forEach(old => ok(nav(old) > 0, `B7 would not have caught: ${old}`));

    ok(nav('Tenant requested documentation per lease Section 9.1.') === 0,
       'B7 would flag a lease-clause citation as navigation');
  });
  t('B8b and that lease citation is still in the product, unrewritten', () => {
    ok(/lease Section 9\.1/.test(scriptSrc),
       'the clause citation was rewritten as if it were navigation');
  });
  t('B9 the replacements use the convention the app already had', () => {
    // script.js already told managers where to go by tab name; the fix matches
    // that rather than inventing a third vocabulary.
    ok(/\(Property tab\)/.test(scriptSrc) && /\(Spaces tab\)/.test(scriptSrc) && /\(CAM tab\)/.test(scriptSrc),
       'the existing tab-naming convention is gone — the fix now stands alone');
  });
}

// ── C. A space says which building it is in ──────────────────────────────────
sec('C. The space overlay names its property');
{
  t('C1 the subtitle is the property name, not fixed copy', () => {
    ok(/property && property\.name/.test(tsSrc), 'the subtitle no longer reads the property');
    ok(/_esc\(property\.name\)/.test(tsSrc), 'the property name is interpolated unescaped');
  });
  t('C2 a property with no name falls back rather than showing an empty line', () => {
    ok(/Everything about this space, in one place/.test(tsSrc),
       'the fallback was removed, so an unnamed property gets a blank subtitle');
  });
  t('C3 it reads the property openSpace already resolved — nothing new is fetched', () => {
    const fn = /function openSpace\(tenantId\)[\s\S]*?\n  }/.exec(tsSrc);
    ok(fn, 'openSpace not found');
    ok(/var property = window\.currentProperty && window\.currentProperty\(\);/.test(fn[0]),
       'openSpace no longer resolves the property it names');
  });
  t('C4 the review overlay it now matches still names its property too', () => {
    ok(/getElementById\('rwSubtitle'\)\.textContent = prop \? \(prop\.name \|\| ''\) : ''/.test(scriptSrc),
       'the review overlay stopped naming the property — the two have diverged again');
  });
  t('C5 no tenant/space identity is used for the subtitle', () => {
    // Requirement: this must not become another route for a space to borrow
    // something. The property name is property-level and openSpace already
    // refuses to open a space with no identity at all.
    const head = /'<div class="ts-head-main">[\s\S]*?<\/div>' \+/.exec(tsSrc);
    ok(head, 'the overlay header was not found');
    ok(!/rec\.lease|rec\.camResult|tenantId/.test(head[0]),
       `the header reaches for tenant data: ${head[0].slice(0, 200)}`);
  });
}

// ── D. Vacancy: found, and deliberately NOT guessed at ───────────────────────
sec('D. A vacant suite is not distinguished — and why that is not fixed here');
{
  // A rent roll carries "Vacant" as a tenant NAME. In the Spaces list that
  // card renders exactly like a tenancy: same icon, same "Open space →", its
  // area counted the same way.
  //
  // It is not fixed in this slice because there is nothing honest to read.
  // Vacancy in this codebase is STRUCTURAL — acquisition-engine.js derives it
  // as buildingSqft - occupiedSqft — and no tenant row carries a vacancy flag.
  // Marking a card "Vacant" would mean sniffing the name, which is the exact
  // inference tenant-space.js already refuses ("'Vacant' is the most common
  // tenant name in a real rent roll" is why the event scoper will not match on
  // label alone), and it would invent a relationship the record does not hold.
  //
  // These assertions pin the two facts a future slice needs, so that whoever
  // models vacancy finds the reasoning instead of rediscovering it.
  t('D1 vacancy is defined structurally, not per tenant', () => {
    const acq = fs.readFileSync(path.join(__dirname, 'acquisition-engine.js'), 'utf8');
    ok(/vacant\s*=\s*Math\.max\(0,\s*bsqft - occupied\)/.test(acq),
       'the structural definition of vacancy moved — re-check before modelling it per tenant');
  });
  t('D2 nothing in the product marks a tenant row as vacant', () => {
    const joined = scriptSrc + code(tsSrc);
    ok(!/\bis_vacant\b|\bisVacant\b|\bvacancy_flag\b/.test(joined),
       'a per-tenant vacancy flag now exists — the Spaces list can and should use it');
  });
  t('D3 and the name is still not treated as a vacancy signal', () => {
    ok(!/tenant_name\s*===\s*['"]Vacant['"]/i.test(code(tsSrc) + scriptSrc),
       'something started inferring vacancy from the tenant name');
  });
}

// ── Z. Self-checks ───────────────────────────────────────────────────────────
sec('Z. The source reading is not vacuous');
{
  t('Z1 code() strips line comments', () => {
    ok(!/NOT A MATCH/.test(code('// NOT A MATCH')), 'comment survived');
  });
  t('Z2 code() strips block comments', () => {
    ok(!/NOT A MATCH/.test(code('/* NOT A MATCH */')), 'block comment survived');
  });
  t('Z3 the sources actually loaded', () => {
    ok(scriptSrc.length > 500000, `script.js ${scriptSrc.length} chars`);
    ok(tsSrc.length > 20000, `tenant-space.js ${tsSrc.length} chars`);
    ok(htmlSrc.length > 50000, `index.html ${htmlSrc.length} chars`);
  });
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { failures.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
