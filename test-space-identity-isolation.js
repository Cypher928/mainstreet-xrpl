'use strict';
/**
 * test-space-identity-isolation.js — a space with no identity owns nothing.
 *
 *   node test-space-identity-isolation.js
 *
 * THE DEFECT. TenantSpace.assemble resolved its tenant with
 * `x.id === tenantId`, and `null === null` is true. On a property carrying two
 * id-less tenants, BOTH assembled against whichever one came first, and every
 * identity-dependent field then read off that stranger:
 *
 *     space.name   the neighbour's NAME, shown as this space's name
 *     lease.*      their type, area, dates, cap
 *     lease.url    their lease DOCUMENT, linked and openable
 *     camResult    their CAM allocation, with the dollar figure
 *     disputes     theirs, matched by that borrowed name
 *     summary      one sentence asserting all of it
 *
 * It did not stay on the card. PropertyRecord._spaces passes lease, space,
 * summary and camResult through unchanged, AIWorkspace reads them for its
 * answers, and the MCP projection ships them — so an id-less space could
 * report a neighbour's money to an external caller under a borrowed name.
 *
 * THE FIX, and what this suite pins: with no identity, no tenant is resolved at
 * all, and disputes are refused the same way events already were. Every
 * identity-dependent field falls to null/empty on its own from an empty tenant;
 * nothing is substituted, and no valid-id behaviour changes.
 *
 * Sections:
 *   A. assemble() — the canonical boundary, per leaked field
 *   B. valid ids are untouched
 *   C. the disputes filter's own hole (matching on ABSENCE)
 *   D. PropertyRecord._spaces, the shared projection
 *   E. AIWorkspace, which reads that projection
 *   F. the MCP projection does not reintroduce it
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

// ── Load the real modules ────────────────────────────────────────────────────
function loadModules() {
  const sandbox = { console, setTimeout: () => 0, clearTimeout: () => {} };
  sandbox.window = sandbox;
  sandbox.document = {
    getElementById: () => null, createElement: () => ({ style: {}, appendChild() {},
      setAttribute() {}, addEventListener() {}, classList: { add() {}, remove() {} } }),
    head: { appendChild() {} }, body: { appendChild() {}, style: {} },
    querySelectorAll: () => [],
  };
  vm.createContext(sandbox);
  for (const f of ['property-area.js', 'dispute-status.js', 'tenant-space.js', 'property-record.js']) {
    const p = path.join(__dirname, f);
    if (fs.existsSync(p)) vm.runInContext(fs.readFileSync(p, 'utf8'), sandbox, { filename: f });
  }
  return sandbox;
}

const SB = loadModules();
const TS = SB.window.TenantSpace;
const PR = SB.window.PropertyRecord;

// ── The property that reproduces it ──────────────────────────────────────────
// Alder has a real id and a full record. Briar and Cedar have NO id — the shape
// tenant-normalize.js deliberately produces (`id: null`, identity minted only
// at a fresh extraction). Before the fix, Briar and Cedar both resolved to
// Alder... no: to each OTHER — whichever id-less tenant came first. So the
// first id-less tenant carries the bait.
const PROPERTY = {
  id: 'prop-1', name: 'Maple Plaza', totalSqft: 26000,
  tenants: [
    { id: 'alder', tenant_name: 'Alder Hardware', leased_sqft: 9200, lease_type: 'Triple Net (NNN)',
      start_date: '2020-01-01', end_date: '2030-12-31', cap: 5,
      leaseUrl: 'https://x/alder-lease.pdf', leaseFileName: 'alder-lease.pdf' },
    // THE BAIT: a full record on a tenant with no identity.
    { id: null, tenant_name: 'Briar Optical', leased_sqft: 9999, lease_type: 'Gross',
      start_date: '2019-05-01', end_date: '2029-04-30', cap: 7,
      leaseUrl: 'https://x/briar-lease.pdf', leaseFileName: 'briar-lease.pdf' },
    // THE VICTIM: a second id-less tenant, which used to inherit all of it.
    { id: null, tenant_name: 'Cedar Stationers', leased_sqft: 111 },
    { id: '',   tenant_name: 'Dogwood Deli',     leased_sqft: 222 },
  ],
  timeline: [
    { id: 'ev-1', tenantId: 'alder', manual: true, category: 'note', type: 'manual_note',
      title: 'Walkthrough', timestamp: '2026-03-02T10:00:00Z' },
  ],
  camReconciliation: {
    camYear: 2026,
    results: [
      { tenantId: 'alder', tenantName: 'Alder Hardware', allocatedAmount: 24000 },
      // Briar's money. Matched by NAME, which is how it reached the victim.
      { tenantName: 'Briar Optical', allocatedAmount: 88888 },
    ],
  },
  disputes: [
    { tenantName: 'Briar Optical', status: 'open', amount: 4200, timestamp: '2026-04-01T00:00:00Z' },
    // No tenantId and no tenantName: matches on ABSENCE against an empty tenant.
    { status: 'open', amount: 999, timestamp: '2026-04-02T00:00:00Z' },
  ],
};

const recAlder  = TS.assemble(PROPERTY, 'alder');
const recNull   = TS.assemble(PROPERTY, null);
const recEmpty  = TS.assemble(PROPERTY, '');
const recUndef  = TS.assemble(PROPERTY, undefined);

// ── A. The canonical boundary ────────────────────────────────────────────────
sec('A. assemble() attributes nothing to a space with no identity');
{
  t('A1 it reports the space as having no identity at all', () => {
    [recNull, recEmpty, recUndef].forEach(r => eq(r.noIdentity, true));
  });
  t('A2 the space does not take the neighbour’s NAME', () => {
    [recNull, recEmpty, recUndef].forEach(r => {
      ok(r.space.name !== 'Briar Optical', `borrowed a name: ${r.space.name}`);
      eq(r.space.name, 'Space', 'the placeholder is the only honest name here');
    });
  });
  t('A3 no lease term is inherited', () => {
    [recNull, recEmpty, recUndef].forEach(r => {
      eq(r.lease.type,  null, 'lease type leaked');
      eq(r.lease.sqft,  null, 'leased area leaked');
      eq(r.lease.start, null, 'start date leaked');
      eq(r.lease.end,   null, 'end date leaked');
      eq(r.lease.cap,   null, 'CAM cap leaked');
    });
  });
  t('A4 no lease DOCUMENT is inherited — the worst of them', () => {
    [recNull, recEmpty, recUndef].forEach(r => {
      eq(r.lease.url, null, 'a document URL leaked to a space that cannot own it');
      eq(r.lease.fileName, null);
      eq(r.leaseDocs.length, 0, JSON.stringify(r.leaseDocs));
    });
  });
  t('A5 no CAM allocation is inherited — money, by name match', () => {
    [recNull, recEmpty, recUndef].forEach(r => {
      eq(r.camResult, null, 'a neighbour’s CAM row leaked');
      eq(r.counts.cam, 0);
    });
    // Discriminating: that row IS findable by name, so A5 is not passing
    // because the fixture lacks one.
    ok(PROPERTY.camReconciliation.results.some(x => x.tenantName === 'Briar Optical'),
       'the fixture stopped carrying the bait row');
  });
  t('A6 no disputes are inherited, by name OR by absence', () => {
    [recNull, recEmpty, recUndef].forEach(r => {
      eq(r.disputes.length, 0, JSON.stringify(r.disputes));
      eq(r.counts.disputes, 0);
      eq(r.counts.openDisputes, 0);
    });
  });
  t('A7 no events, photos, invoices, warranties or notes', () => {
    [recNull, recEmpty, recUndef].forEach(r => {
      ['events', 'photos', 'invoices', 'warranties', 'documents', 'notes'].forEach(k => {
        eq(r[k].length, 0, `${k} leaked`);
      });
    });
  });
  t('A8 the summary asserts nothing', () => {
    [recNull, recEmpty, recUndef].forEach(r => {
      eq(r.summary, 'No records yet for this space.', r.summary);
      ok(!/Briar|9999|88,888|88888|Gross/.test(r.summary), `summary leaked: ${r.summary}`);
    });
  });
  t('A9 NOTHING anywhere in the record mentions the neighbour', () => {
    // The catch-all: serialise the whole record and look for any trace. This is
    // what makes the section hard to defeat field-by-field.
    [recNull, recEmpty, recUndef].forEach(r => {
      const blob = JSON.stringify(r);
      ['Briar', '9999', 'briar-lease', '88888', '4200', 'Gross', '2019-05-01']
        .forEach(needle => ok(blob.indexOf(needle) === -1,
          `"${needle}" reached a record with no identity: ${blob.slice(0, 300)}`));
    });
  });
  t('A10 the id it reports back is the (absent) one it was asked for', () => {
    eq(recNull.space.id, null);
    eq(recEmpty.space.id, '');
    // Never a borrowed id.
    ok(recNull.space.id !== 'alder' && recEmpty.space.id !== 'alder');
  });
}

// ── B. Valid ids are untouched ───────────────────────────────────────────────
sec('B. A space WITH an identity keeps everything it had');
{
  t('B1 its own name, lease terms and document', () => {
    eq(recAlder.space.name, 'Alder Hardware');
    eq(recAlder.lease.type, 'Triple Net (NNN)');
    eq(recAlder.lease.sqft, 9200);
    eq(recAlder.lease.start, '2020-01-01');
    eq(recAlder.lease.cap, 5);
    eq(recAlder.lease.url, 'https://x/alder-lease.pdf');
    eq(recAlder.leaseDocs.length, 1);
  });
  t('B2 its own CAM result, matched by id', () => {
    ok(recAlder.camResult, 'the valid space lost its CAM row');
    eq(recAlder.camResult.allocatedAmount, 24000);
    ok(recAlder.camResult.allocatedAmount !== 88888, 'and not the neighbour’s');
  });
  t('B3 its own scoped events', () => {
    eq(recAlder.events.length, 1);
    eq(recAlder.counts.events, 1);
  });
  t('B4 its summary still says something', () => {
    ok(recAlder.summary !== 'No records yet for this space.', recAlder.summary);
    ok(/Triple Net/.test(recAlder.summary), recAlder.summary);
  });
  t('B5 a VALID id that matches no tenant is empty, not borrowed', () => {
    const gone = TS.assemble(PROPERTY, 'no-such-tenant');
    eq(gone.noIdentity, false, 'it HAS an identity; it just is not on this property');
    eq(gone.lease.sqft, null);
    eq(gone.space.name, 'Space');
    ok(JSON.stringify(gone).indexOf('Briar') === -1, 'a missing tenant borrowed a record');
  });
  t('B6 a genuine 0 area still survives (M8c/M8d)', () => {
    const zero = TS.assemble({ id: 'p', tenants: [{ id: 'z', tenant_name: 'Kiosk', leased_sqft: 0 }],
                               timeline: [], disputes: [] }, 'z');
    eq(zero.lease.sqft, 0, 'a real 0 must not be nulled by this change');
  });
}

// ── C. The disputes filter's own hole ────────────────────────────────────────
sec('C. Disputes are refused for the same reason events are');
{
  t('C1 a dispute with NO tenantId and NO tenantName matched on absence', () => {
    // Proves the extra guard is load-bearing rather than belt-and-braces: with
    // an empty tenant, `d.tenantName === t.tenant_name` is undefined ===
    // undefined, which is true, so this dispute WOULD attach without it.
    const bare = PROPERTY.disputes.find(d => d.tenantId === undefined && d.tenantName === undefined);
    ok(bare, 'the fixture stopped carrying the absence-matching dispute');
    eq(recNull.disputes.length, 0, 'a property-wide dispute attached to an id-less space');
  });
  t('C2 the valid space still collects the disputes that name it', () => {
    const withDispute = TS.assemble({
      id: 'p', timeline: [], camReconciliation: null,
      tenants: [{ id: 'x', tenant_name: 'Named Co' }],
      disputes: [{ tenantId: 'x', status: 'open', amount: 10, timestamp: '2026-01-01T00:00:00Z' }],
    }, 'x');
    eq(withDispute.disputes.length, 1, 'the valid dispute path regressed');
    eq(withDispute.counts.disputes, 1);
  });
}

// ── D. The shared projection ─────────────────────────────────────────────────
sec('D. PropertyRecord._spaces carries the fix, not the leak');
{
  const record = PR && typeof PR.assemble === 'function'
    ? PR.assemble(PROPERTY, { TenantSpace: TS })
    : null;

  t('D0 PropertyRecord assembled a record with spaces', () => {
    ok(record, 'PropertyRecord.assemble is unavailable — section D would be vacuous');
    ok(Array.isArray(record.spaces) && record.spaces.length === 4,
       `expected 4 spaces, got ${record.spaces && record.spaces.length}`);
  });

  t('D1 every id-less space is flagged and carries no borrowed lease', () => {
    record.spaces.filter(s => s.noIdentity).forEach(s => {
      eq(s.lease.type,  null, `${s.tenantName} inherited a lease type`);
      eq(s.lease.sqft,  null, `${s.tenantName} inherited an area`);
      eq(s.lease.url ?? null, null, `${s.tenantName} inherited a document`);
      eq(s.camResult, null, `${s.tenantName} inherited a CAM row`);
    });
    eq(record.spaces.filter(s => s.noIdentity).length, 3, 'expected three id-less spaces');
  });
  t('D2 the id-less rows still report their OWN tenantName — that is their field', () => {
    // Not inference: PropertyRecord reads tenantName off the tenant row itself,
    // which is legitimately that row's own data. What it must not do is take
    // space.name, which comes from the resolved (and now unresolved) tenant.
    const cedar = record.spaces.find(s => s.tenantName === 'Cedar Stationers');
    ok(cedar, 'the victim row is missing');
    eq(cedar.noIdentity, true);
    ok(cedar.space.name !== 'Briar Optical', `space.name borrowed: ${cedar.space.name}`);
  });
  t('D3 the valid space is unchanged in the projection', () => {
    const alder = record.spaces.find(s => s.tenantId === 'alder');
    ok(alder, 'the valid space vanished from the projection');
    eq(alder.noIdentity, false);
    eq(alder.lease.sqft, 9200);
    eq(alder.camResult.allocatedAmount, 24000);
  });
  t('D4 no OTHER id-less space carries a trace of the bait tenant', () => {
    // Scoped to the victims. Briar's own row legitimately carries "Briar
    // Optical" as its tenantName — that is the row's own field, read off the
    // tenant rather than inferred, and D2 is the assertion that keeps it. A
    // blanket scan over every id-less row flagged that and was wrong.
    const victims = record.spaces.filter(s => s.noIdentity && s.tenantName !== 'Briar Optical');
    eq(victims.length, 2, 'expected Cedar and Dogwood as the victim rows');
    const blob = JSON.stringify(victims);
    ['Briar Optical', '9999', 'briar-lease', '88888', 'Gross', '2019-05-01']
      .forEach(n => ok(blob.indexOf(n) === -1, `"${n}" survived into the projection: ${blob.slice(0, 300)}`));
  });
  t('D5 and the bait row itself carries none of its OWN lease either', () => {
    // Briar has no identity, so its own terms are unattributable too — the rule
    // is about identity, not about who the neighbour is.
    const briar = record.spaces.find(s => s.tenantName === 'Briar Optical');
    ok(briar, 'the bait row is missing');
    eq(briar.noIdentity, true);
    eq(briar.lease.sqft, null, 'an id-less row reported its own area as fact');
    eq(briar.lease.url ?? null, null, 'an id-less row linked its own document');
    eq(briar.camResult, null);
  });
}

// ── E. The AI consumer ───────────────────────────────────────────────────────
sec('E. AIWorkspace reads the projection, so it inherits the fix');
{
  const aiSrc = fs.readFileSync(path.join(__dirname, 'ai-workspace.js'), 'utf8');
  t('E1 _spacesOf takes lease/camResult/space from the record, not the raw tenant', () => {
    const fn = /function _spacesOf\(rec, p\)[\s\S]*?\n  }/.exec(aiSrc);
    ok(fn, '_spacesOf not found');
    ok(/lease: sp\.lease \|\| null, camResult: sp\.camResult \|\| null/.test(fn[0]),
       'AIWorkspace stopped reading the canonical record — it would need its own guard');
    ok(/noIdentity: !!sp\.noIdentity/.test(fn[0]),
       'AIWorkspace stopped carrying noIdentity through');
  });
  t('E2 and it prefers the row’s own name over the space’s', () => {
    const fn = /function _spacesOf\(rec, p\)[\s\S]*?\n  }/.exec(aiSrc)[0];
    ok(/name: sp\.tenantName \|\| \(sp\.space && sp\.space\.name\) \|\| null/.test(fn),
       'the name precedence changed — an id-less space could show the placeholder or worse');
  });
}

// ── F. The external surface ──────────────────────────────────────────────────
sec('F. The MCP projection does not reintroduce it');
{
  const mcpSrc = fs.readFileSync(path.join(__dirname, 'api/_mcp-capabilities.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  t('F1 spaces reach a caller through the record, not a second assembly', () => {
    ok(!/TenantSpace\.assemble\(/.test(mcpSrc),
       'MCP assembles spaces itself — it would need the guard duplicated');
  });
  t('F2 the CAM trust gate is still in front of every space camResult', () => {
    ok(/camResult: _gatedCamResult\(s\.camResult\)/.test(mcpSrc),
       'the space camResult gate is gone');
  });
  t('F3 this slice did not touch the MCP layer', () => {
    ok(!/noIdentity\s*\?/.test(mcpSrc), 'an identity guard leaked into MCP — it belongs upstream');
  });
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { failures.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
