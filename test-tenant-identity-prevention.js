'use strict';
/**
 * test-tenant-identity-prevention.js — S6.2: a resync can no longer orphan anything.
 *
 *   node test-tenant-identity-prevention.js
 *
 * Read-only against every database. The five properties this phase was asked to
 * prove are each asserted twice where that is possible: once behaviourally,
 * against an executable model of the stored procedure, and once against the
 * text of the SQL and of script.js — because a model that agrees with itself
 * proves nothing, and a source pin that nobody exercises proves almost nothing.
 *
 *   1  an existing tenant id survives resync
 *   2  CAM/evidence references cannot be orphaned by resync
 *   3  an empty roster cannot wipe referenced tenants
 *   4  a genuinely new tenant receives an identity exactly once
 *   5  repeated resync is idempotent
 */

const fs = require('fs');
const vm = require('vm');
const M  = require('./tools/tenant-resync-model.js');

let pass = 0, fail = 0;
const ok  = (m, d) => { console.log('  \x1b[32m✓\x1b[0m ' + m + (d ? '  — ' + d : '')); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '  — ' + d : '')); fail++; };
const is  = (c, m, d) => (c ? ok(m, d) : bad(m, d));
const eq  = (a, b, m) => (a === b ? ok(m, JSON.stringify(a))
                                  : bad(m, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`));
const sec = (t) => console.log('\n\x1b[1m── ' + t + ' ──\x1b[0m');

const SRC  = fs.readFileSync(require.resolve('./script.js'), 'utf8');
const CODE = SRC.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
// M1a: normalizeTenant and its helpers now live here. Pins about what the
// normalizer does must read this file; pins about the call sites still read SRC.
const TNCODE = fs.readFileSync(require.resolve('./tenant-normalize.js'), 'utf8')
                 .replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
// Comments stripped: 021's header quotes the defective lines it removes, so an
// un-stripped pin would match the explanation and pass for the wrong reason.
const SQL  = fs.readFileSync('./migrations/021_safe_tenant_resync.sql', 'utf8')
               .replace(/^\s*--.*$/gm, '');

// ── Lift normalizeTenant and mintTenantIdentity out of script.js ───────────
// Executed for real rather than regex-matched: the claim is about what the
// functions DO, and only running them can establish that.
const sandbox = {
  crypto: { randomUUID: () => 'minted-' + (sandbox._n = (sandbox._n || 0) + 1) },
  console, Date, Math, JSON, Number, String, Object, Array, isNaN, parseFloat, parseInt,
};
vm.createContext(sandbox);
{
  const grab = (name) => {
    const i = SRC.indexOf('function ' + name + '(');
    if (i < 0) throw new Error('not found: ' + name);
    let d = 0, started = false;
    for (let j = i; j < SRC.length; j++) {
      if (SRC[j] === '{') { d++; started = true; }
      else if (SRC[j] === '}') { d--; if (started && d === 0) return SRC.slice(i, j + 1); }
    }
    throw new Error('unbalanced: ' + name);
  };
  // mintTenantIdentity still lives in script.js — the mint happens at the
  // extraction boundary, not inside normalization — so it is still lifted.
  const deps = ['mintTenantIdentity'];
  for (const d of deps) { try { vm.runInContext(grab(d), sandbox); } catch (_) { /* optional */ } }
}
// normalizeTenant MOVED to tenant-normalize.js in M1a. Requiring the module is
// not a workaround for the move: it is stricter than the old text lift, because
// it exercises the function the application actually calls rather than a copy
// re-evaluated in a sandbox.
const normalizeTenant    = require('./tenant-normalize.js').normalizeTenant;
const mintTenantIdentity = sandbox.mintTenantIdentity;

// ── 4. A genuinely new tenant receives an identity exactly once ────────────
sec('4. Identity is created once, where a tenant becomes new');
{
  is(typeof normalizeTenant === 'function', '4a normalizeTenant was lifted and runs');
  is(typeof mintTenantIdentity === 'function', '4b mintTenantIdentity was lifted and runs');

  // normalizeTenant no longer mints, so a record with no id keeps none.
  const bare = normalizeTenant({ tenant_name: 'Fresh Market Café' });
  eq(bare.id, null, '4c a record with no id comes back with id null, not a new uuid');

  // Running it repeatedly cannot manufacture identities.
  const again = normalizeTenant(normalizeTenant(normalizeTenant({ tenant_name: 'X' })));
  eq(again.id, null, '4d and normalizing three times still mints nothing');
  eq(sandbox._n, undefined, '4e crypto.randomUUID was never called by normalizeTenant');

  // The explicit mint creates exactly one, and is a no-op thereafter.
  const t = mintTenantIdentity(normalizeTenant({ tenant_name: 'Fresh Market Café' }));
  eq(t.id, 'minted-1', '4f mintTenantIdentity assigns an identity at the extraction boundary');
  const t2 = mintTenantIdentity(t);
  eq(t2.id, 'minted-1', '4g and calling it again never re-mints');
  eq(sandbox._n, 1, '4h exactly one uuid was generated across all of it');

  // An id that already exists always survives normalization.
  const kept = normalizeTenant({ id: 'existing-id', tenant_name: 'Luxe Nails' });
  eq(kept.id, 'existing-id', '4i an existing id survives normalizeTenant untouched');
  eq(mintTenantIdentity(kept).id, 'existing-id', '4j and the mint refuses to overwrite it');
  eq(sandbox._n, 1, '4k still one uuid generated in this whole suite');

  // Source pins for the two halves of the rule.
  is(/id:\s*d\.id\s*\?\?\s*null,/.test(TNCODE), '4l source: normalizeTenant preserves or nulls');
  const mintCalls = (CODE.match(/mintTenantIdentity\(normalizeTenant\(/g) || []).length;
  is(mintCalls >= 4, '4m source: the extraction boundaries mint explicitly', mintCalls + ' sites');
  is(!/crypto\.randomUUID/.test(TNCODE),
     '4n source: tenant-normalize.js mints nothing at all');

  // THE LOAD BOUNDARY. Removing the mint from normalizeTenant broke the Space
  // panel, because a tenant read from a property blob reached the UI with a null
  // id and the UI routes by id. That was a real regression, not a stale test:
  // extraction is not the only door a tenant comes through. A record entering
  // the working set must be addressable, so the blob-load path mints too — and
  // warns, because with extraction now minting, an id-less record arriving here
  // means legacy data or a bug. Pilot has none: 86 of 86 blob tenants carry an id.
  is(/const n = normalizeTenant\(t\);\s*\n\s*if \(!n\.id\) console\.warn\(/.test(CODE),
     '4o source: the blob-load path mints, and says so rather than doing it silently');
  is(/return mintTenantIdentity\(n\);/.test(CODE),
     '4p source: via the same single-mint helper, so it still cannot re-mint');
  is(/const n = mintTenantIdentity\(normalizeTenant\(t\)\);/.test(CODE),
     '4q source: the dedupe/load path mints too');
  // Minting at load is only safe because the helper is idempotent: a blob
  // tenant that HAS an id must keep it across any number of loads.
  const blobTenant = { id: 'blob-id', tenant_name: 'Whole Health Market' };
  let round = blobTenant;
  for (let i = 0; i < 5; i++) round = mintTenantIdentity(normalizeTenant(round));
  eq(round.id, 'blob-id', '4r a blob tenant with an id survives five load cycles unchanged');
  eq(sandbox._n, 1, '4s and no uuid was generated by any of them');
}

// ── 1. An existing tenant id survives resync ───────────────────────────────
sec('1. An existing id survives a resync');
{
  const db0 = {
    tenants: [{ id: 'T1', property_id: 'P', name: 'Luxe Nails', created_at: 'ORIGINAL' },
              { id: 'T2', property_id: 'P', name: 'Prime Wellness', created_at: 'ORIGINAL' }],
    camRefs: [], evidenceRefs: [],
  };
  const { db, result } = M.resync(db0, 'P', [
    { id: 'T1', name: 'Luxe Nails' }, { id: 'T2', name: 'Prime Wellness' },
  ]);
  eq(db.tenants.length, 2, '1a both tenants are still there');
  is(db.tenants.every(t => ['T1', 'T2'].includes(t.id)), '1b with their original ids');
  is(db.tenants.every(t => t.created_at === 'ORIGINAL'),
     '1c and their original rows — an upsert, not a delete and reinsert');
  eq(result.deleted, 0, '1d nothing was deleted');
  eq(result.upserted, 2, '1e two rows upserted');

  // A renamed tenant keeps its identity: the id is the tenant, the name is a field.
  const renamed = M.resync(db0, 'P', [{ id: 'T1', name: 'Luxe Nails & Spa' },
                                      { id: 'T2', name: 'Prime Wellness' }]);
  eq(renamed.db.tenants.find(t => t.id === 'T1').name, 'Luxe Nails & Spa',
     '1f a rename updates the row');
  eq(renamed.db.tenants.length, 2, '1g and does not create a second tenant');

  is(/on conflict \(id\) do update set/.test(SQL), '1h source: 021 upserts on id');
  is(/delete from public\.tenants t\s*\n\s*where t\.property_id = p_property_id\s*\n\s*and not \(t\.id = any\(v_incoming\)\)/.test(SQL),
     '1i source: its delete is scoped to ids absent from the roster');
}

// ── 2. CAM/evidence references cannot be orphaned ──────────────────────────
sec('2. A referenced tenant is retained even when the roster omits it');
{
  const db0 = {
    tenants: [{ id: 'KEEP', property_id: 'P', name: 'Whole Health Market' },
              { id: 'REF-EV', property_id: 'P', name: 'Prime Wellness Spa' },
              { id: 'STALE', property_id: 'P', name: 'Gone Tenant' }],
    camRefs: ['KEEP'], evidenceRefs: ['REF-EV'],
  };
  eq(M.danglingRefs(db0).length, 0, '2a the starting state has no dangling references');

  // The roster omits all three of them but one — exactly the filtered-roster
  // case that produced the six pilot orphans.
  const { db, result } = M.resync(db0, 'P', [{ id: 'NEW', name: 'Fresh Tenant' }]);

  eq(M.danglingRefs(db).length, 0, '2b and neither does the state after the resync');
  is(db.tenants.some(t => t.id === 'KEEP'),
     '2c the CAM-referenced tenant was retained despite being absent from the roster');
  is(db.tenants.some(t => t.id === 'REF-EV'),
     '2d so was the evidence-referenced one');
  is(!db.tenants.some(t => t.id === 'STALE'),
     '2e the unreferenced absentee was pruned — this is still a resync, not an append');
  eq(result.retained_referenced, 2, '2f and the retention is reported, not silent');
  eq(result.deleted, 1, '2g one row deleted');

  // The old behaviour, for contrast: delete-all-then-insert would have orphaned
  // both references. Modelled explicitly so the improvement is measured.
  const destructive = { ...db0, tenants: [{ id: 'NEW', property_id: 'P', name: 'Fresh Tenant' }] };
  eq(M.danglingRefs(destructive).length, 2,
     '2h the 009 behaviour would have orphaned both references');
}

// ── 3. An empty roster cannot wipe referenced tenants ──────────────────────
sec('3. An empty roster is a no-op');
{
  // C must be UNREFERENCED. If every tenant were referenced, a broken
  // implementation that fell through to the prune would retain them all and
  // look correct — the no-op would be indistinguishable from the retention
  // rule doing the work. C is the row that only survives a genuine no-op.
  const db0 = {
    tenants: [{ id: 'A', property_id: 'P', name: 'Luxe Nails' },
              { id: 'B', property_id: 'P', name: 'Prime Wellness' },
              { id: 'C', property_id: 'P', name: 'Unreferenced Tenant' }],
    camRefs: ['A'], evidenceRefs: ['B'],
  };
  for (const [label, roster] of [
    ['an empty array',              []],
    ['null',                        null],
    ['rows with no id',             [{ name: 'Nameless Id-less' }]],
    ['rows with no name',           [{ id: 'X', name: '   ' }]],
    ['a mix of both unusable',      [{ id: 'X', name: '' }, { name: 'Y' }]],
  ]) {
    const { db, result } = M.resync(db0, 'P', roster);
    is(db.tenants.length === 3 && result.deleted === 0 && M.danglingRefs(db).length === 0
       && db.tenants.some(t => t.id === 'C'),
       '3a ' + label + ' deletes nothing — including the UNREFERENCED tenant',
       'noop_reason=' + result.noop_reason);
  }
  const { result } = M.resync(db0, 'P', [{ name: 'no id' }]);
  eq(result.upserted, 0, '3b a row without an id is refused, not given one');
  eq(result.skipped, 1, '3c and counted as skipped so it is visible');

  // Both layers refuse it: the app before dispatching, the procedure on arrival.
  const body = CODE.slice(CODE.indexOf('async function resyncTenantsToTable('),
                          CODE.indexOf('async function syncTenantsToTable('));
  is(/const _usable = \(tenants \|\| \[\]\)\.filter\([\s\S]{0,120}?t\.id\);/.test(body)
     && /if \(!_usable\.length\)/.test(body),
     '3d source: the app refuses an empty roster before touching the database');
  is(/if p_rows is null or jsonb_array_length\(p_rows\) = 0 then/.test(SQL),
     '3e source: and 021 refuses it again server-side');
  is(/if v_upserted = 0 then[\s\S]{0,300}?no_usable_rows/.test(SQL),
     '3f including the case where every row turned out unusable');
}

// ── 5. Repeated resync is idempotent ───────────────────────────────────────
sec('5. Running the same resync twice changes nothing the second time');
{
  const db0 = {
    tenants: [{ id: 'A', property_id: 'P', name: 'Luxe Nails', created_at: 'ORIGINAL' },
              { id: 'STALE', property_id: 'P', name: 'Gone' }],
    camRefs: ['A'], evidenceRefs: [],
  };
  const roster = [{ id: 'A', name: 'Luxe Nails' }, { id: 'B', name: 'Prime Wellness' }];

  const r1 = M.resync(db0,   'P', roster);
  const r2 = M.resync(r1.db, 'P', roster);
  const r3 = M.resync(r2.db, 'P', roster);

  const shape = (db) => JSON.stringify(db.tenants.map(t => [t.id, t.name, t.property_id]).sort());
  eq(shape(r2.db), shape(r1.db), '5a the second run leaves the table identical to the first');
  eq(shape(r3.db), shape(r1.db), '5b and so does the third');
  eq(r2.result.deleted, 0, '5c the second run deletes nothing');
  eq(r3.result.deleted, 0, '5d nor the third');
  eq(r1.result.deleted, 1, '5e only the first run had a stale row to prune');
  eq(r1.db.tenants.find(t => t.id === 'A').created_at, 'ORIGINAL',
     '5f and the surviving row was never recreated');
  is(r2.db.tenants.filter(t => t.id === 'B').length === 1,
     '5g the tenant added on run one is not duplicated on run two');
  eq(M.danglingRefs(r3.db).length, 0, '5h no reference dangles at any point');

  // Idempotence depends on the id being stable, which is why 4 and 5 are the
  // same property viewed from two ends. A roster whose ids were re-minted each
  // time would grow without bound; assert that shape is impossible now.
  const minted = [
    mintTenantIdentity(normalizeTenant({ tenant_name: 'Repeat Tenant' })),
  ];
  const m1 = M.resync({ tenants: [], camRefs: [], evidenceRefs: [] }, 'P',
                      minted.map(t => ({ id: t.id, name: t.tenant_name })));
  const m2 = M.resync(m1.db, 'P', minted.map(t => ({ id: t.id, name: t.tenant_name })));
  eq(m2.db.tenants.length, 1, '5i an extraction-minted tenant resynced twice yields one row');
}

// ── 6. The guard covers every entry point ──────────────────────────────────
sec('6. No entry point can bypass the ownership guard');
{
  const body = CODE.slice(CODE.indexOf('async function resyncTenantsToTable('),
                          CODE.indexOf('async function syncTenantsToTable('));
  is(/if\s*\(!_tenantsBelongTo\(propertyId,\s*tenants\)\)\s*return;/.test(body),
     '6a the guard is inside resyncTenantsToTable itself');
  is(body.indexOf('_tenantsBelongTo') < body.indexOf('_resyncQueues.get'),
     '6b and runs before the coalescing queue, which could otherwise smuggle rows past it');
  const calls = (CODE.match(/\bawait resyncTenantsToTable\(/g) || []).length;
  is(calls >= 5, '6c so all ' + calls + ' call sites are covered, including ones not yet written');

  // The fallback path must be as safe as the RPC, since it runs when 021 is absent.
  const fb = CODE.slice(CODE.indexOf('async function _doResyncTenantsDirectly('),
                        CODE.indexOf('function _tenantsBelongTo('));
  is(!/db\.from\('tenants'\)\.delete\(\)\.eq\('property_id'/.test(fb),
     '6d the fallback no longer deletes every tenant for the property');
  is(fb.indexOf(".upsert(insertRows") < fb.indexOf(".delete()"),
     '6e it upserts before it prunes, so a failure loses nothing');
  is(/cam_reconciliations'\)\.select\('tenant_id'\)/.test(fb)
     && /tenant_field_evidence'\)\.select\('tenant_id'\)/.test(fb),
     '6f and it checks both reference tables before pruning anything');
  is(/pruning skipped/.test(SRC.slice(SRC.indexOf('async function _doResyncTenantsDirectly('),
                                      SRC.indexOf('function _tenantsBelongTo('))),
     '6g if the reference check fails it keeps stale rows rather than guessing');

  // Promoting the guard to gate every resync creates a new failure mode: a
  // refusal now means a legitimate save did not happen. Both refusal paths must
  // say so out loud, or a silent no-op becomes the next bug.
  const guard = CODE.slice(CODE.indexOf('function _tenantsBelongTo('),
                           CODE.indexOf('async function resyncTenantsToTable('));
  const refusals = (guard.match(/console\.error\(/g) || []).length;
  eq(refusals, 2, '6h both refusal paths log — foreign rows AND an unknown property');
  is(/if \(!prop\) \{[\s\S]{0,300}?console\.error\([\s\S]{0,200}?return false;/.test(guard),
     '6i the unknown-property case is no longer a silent false');
  // Every caller must have the property in _props by the time it resyncs, which
  // is what makes gating on it safe. currentProperty() is the binding that
  // guarantees it for three of the five sites.
  is(/function currentProperty\(\)\s*\{[\s\S]{0,160}?_props\.find\(p => p\.id === activePropId\)/.test(CODE),
     '6j currentProperty returns a _props entry, so callers using it always pass the guard');
}

console.log(`\n${fail ? '\x1b[31m' : '\x1b[32m'}RESULT: ${pass} passed, ${fail} failed\x1b[0m`);
process.exit(fail ? 1 : 0);
