'use strict';
/**
 * tools/membership-authz-mutation.js — do the P0.1 authorization suites bite?
 *
 *   node tools/membership-authz-mutation.js
 *
 * api/_membership.js and api/document-url.js are the API-layer half of the
 * organisation boundary (migration 024 is the other half). Each rule below is
 * a one-token edit that would open the boundary a little — or, for the
 * negative controls, close it on the people it must admit — and the suites
 * are required to object to every one.
 *
 * A FAILING BASELINE IS NOT A PASS. The unmutated copy is asserted first and
 * the harness exits non-zero if it fails.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MEM = 'api/_membership.js';
const DOC = 'api/document-url.js';
const HYD = 'api/_property-record-hydrator.js';
const MCP = 'api/_mcp-capabilities.js';

const MUTANTS = [
  // ── _membership.js: the rule ──────────────────────────────────────────────
  { id: 'M01', file: MEM, why: 'an unaccepted invitation counts as membership',
    from: '`&accepted_at=not.is.null&revoked_at=is.null&select=id&limit=1`',
    to:   '`&revoked_at=is.null&select=id&limit=1`' },
  { id: 'M02', file: MEM, why: 'a REVOKED membership still grants access (revocation stops working)',
    from: '`&accepted_at=not.is.null&revoked_at=is.null&select=id&limit=1`',
    to:   '`&accepted_at=not.is.null&select=id&limit=1`' },
  { id: 'M03', file: MEM, why: 'membership in ANY organisation grants access to this property',
    from: '`/organization_members?organization_id=eq.${_enc(orgId)}&user_id=eq.${_enc(userId)}`',
    to:   '`/organization_members?user_id=eq.${_enc(userId)}`' },
  { id: 'M04', file: MEM, why: 'a failed membership read is treated as a yes',
    from: '  if (_tableMissing(mem) || !mem || mem.status >= 300) return NO;',
    to:   '  if (_tableMissing(mem) || !mem) return NO;\n  if (mem.status >= 300) return { allowed: true, via: \'member\', organizationId: orgId };' },
  { id: 'M05', file: MEM, why: 'a failed owner probe is treated as ownership',
    from: '  if (!own || own.status >= 300) return NO;          // a failed read is not a "no", but it is not a "yes"',
    to:   '  if (!own || own.status >= 300) return { allowed: true, via: \'owner\', organizationId: null };' },
  { id: 'M06', file: MEM, why: 'an empty membership result is read as a member',
    from: '  const active = Array.isArray(mem.json) && mem.json.length > 0;',
    to:   '  const active = Array.isArray(mem.json);' },
  { id: 'M07', file: MEM, why: 'a property with no organisation admits anyone who asks',
    from: '  if (!_uuid(orgId)) return NO;',
    to:   '  if (!_uuid(orgId)) return { allowed: true, via: \'member\', organizationId: null };' },
  { id: 'M08', file: MEM, why: 'a missing membership table becomes an error (owners lose access on a pre-024 project)',
    from: '  if (_tableMissing(r)) return { ok: true, orgIds: [], degraded: \'no_membership_table\' };',
    to:   '  if (_tableMissing(r)) return { ok: false };' },
  { id: 'M09', file: MEM, why: 'a failed membership listing is reported as "no memberships"',
    from: '  if (!r || r.status >= 300) return { ok: false };',
    to:   '  if (!r || r.status >= 300) return { ok: true, orgIds: [] };' },
  { id: 'M10', file: MEM, why: 'the listing filter drops the ownership half',
    from: '  return `or=(user_id.eq.${_enc(userId)},organization_id.in.(${ids.map(_enc).join(\',\')}))`;',
    to:   '  return `organization_id=in.(${ids.map(_enc).join(\',\')})`;' },
  { id: 'M11', file: MEM, why: 'the listing filter interpolates an unvalidated organisation id',
    from: '  const ids = (orgIds || []).filter(_uuid);',
    to:   '  const ids = (orgIds || []).filter(Boolean);' },
  { id: 'M12', file: MEM, why: 'NEGATIVE CONTROL — the owner probe is dropped, so owners are only admitted via membership',
    from: '  if (own && own.status < 300 && Array.isArray(own.json) && own.json.length > 0) {',
    to:   '  if (false) {' },

  // ── document-url.js: a path is never a grant ──────────────────────────────
  { id: 'D01', file: DOC, why: 'an unregistered path under ANY uid is minted for any caller',
    from: '  if (pathOwner(parsed.path) === uid) {',
    to:   '  if (pathOwner(parsed.path)) {' },
  { id: 'D02', file: DOC, why: 'a registered path is minted without asking about membership',
    from: '    const access = await propertyAccess(sb, reg.row.property_id, uid);\n    if (!access.allowed) return { status: 403, error: \'Forbidden\' };',
    to:   '    const access = { allowed: true, via: \'owner\', organizationId: null };' },
  { id: 'D03', file: DOC, why: 'a by-id request is minted without asking about membership',
    from: '    const access = await propertyAccess(sb, row.property_id, uid);\n    if (!access.allowed) return { status: 403, error: \'Forbidden\' };',
    to:   '    const access = { allowed: true, via: \'owner\', organizationId: null };' },
  { id: 'D04', file: DOC, why: 'Rule 3 is dropped — a path filed under the wrong organisation is minted',
    from: '  if (row.organization_id && first === row.organization_id) return true;\n  return false;',
    to:   '  return true;' },
  { id: 'D05', file: DOC, why: 'Rule 3 accepts any prefix once access is granted',
    from: '  const first = pathOwner(path);\n  if (!first) return false;\n  if (first === uid) return true;',
    to:   '  return true;' },
  { id: 'D06', file: DOC, why: 'a failed register read falls back to the prefix rule',
    from: '  if (!reg.ok) return { status: 502, error: \'Could not read the document register\' };',
    to:   '  if (!reg.ok) reg.row = null;' },
  { id: 'D07', file: DOC, why: 'a LIKE candidate is accepted without re-parsing (a `_` wildcard match is enough)',
    from: '    return p && p.bucket === bucket && p.path === path;',
    to:   '    return !!p;' },
  { id: 'D08', file: DOC, why: 'the caller\'s ref overrides the register row\'s path on a by-id request',
    from: '    return { bucket: parsed.bucket, path: parsed.path, via: access.via, documentId: row.id };',
    to:   '    const alt = parseStoragePath(ref) || parsed;\n    return { bucket: alt.bucket, path: alt.path, via: access.via, documentId: row.id };' },
  { id: 'D09', file: DOC, why: 'NEGATIVE CONTROL — the owner\'s own unregistered path is refused',
    from: '  if (pathOwner(parsed.path) === uid) {',
    to:   '  if (false) {' },

  // ── the routes that consume the rule ──────────────────────────────────────
  { id: 'H01', file: HYD, why: 'the hydrator reads the property without the grant filter',
    from: '    `${_grantFilter(access, userId)}&select=id,name,sqft,data`,',
    to:   '    `&select=id,name,sqft,data`,' },
  { id: 'H02', file: HYD, why: 'the hydrator hydrates for a refused caller',
    from: '  if (!access.allowed) {\n    return { ok: false, reason: REFUSAL.NOT_OWNED, reads, degraded: [] };\n  }',
    to:   '  if (!access.allowed) { /* mutated */ }' },
  { id: 'C01', file: MCP, why: 'a failed membership listing is answered with an owner-only portfolio',
    from: '  if (!orgs.ok) {\n    return refuse(REFUSAL.READ_FAILED,',
    to:   '  if (!orgs.ok) orgs.orgIds = [];\n  if (false) {\n    return refuse(REFUSAL.READ_FAILED,' },
  { id: 'C02', file: MCP, why: 'list_properties ignores membership and lists owned rows only',
    from: '    `/properties?${propertyScope(id.userId, orgs.orgIds)}` +',
    to:   '    `/properties?${propertyScope(id.userId, [])}` +' },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'memmut-'));
fs.cpSync(ROOT, tmp, {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(ROOT, src);
    return !(rel === '.git' || rel.startsWith('.git' + path.sep) ||
             rel === 'node_modules' || rel.startsWith('node_modules' + path.sep));
  },
});
const ORIGINAL = {};
for (const f of [MEM, DOC, HYD, MCP]) ORIGINAL[f] = fs.readFileSync(path.join(ROOT, f), 'utf8');

const SUITES = ['test-membership-authz.js', 'test-security.js', 'test-property-record-hydrator.js',
                'test-m4-mcp-capabilities.js', 'test-m9-external-transport.js'];
function runSuites() {
  const failed = [];
  for (const suite of SUITES) {
    try {
      execFileSync(process.execPath, [suite], { cwd: tmp, stdio: 'pipe', timeout: 600000 });
    } catch (_) { failed.push(suite); }
  }
  return failed;
}

const baseline = runSuites();
console.log('Baseline (unmutated copy): ' + (baseline.length ? 'FAIL ' + baseline.join(', ') : 'PASS'));
if (baseline.length) {
  console.error('\nThe unmutated copy does not pass, so every result below would be meaningless. Nothing is mutated.');
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(2);
}

let killed = 0, survived = 0;
const survivors = [];
for (const m of MUTANTS) {
  const src = ORIGINAL[m.file];
  if (src.indexOf(m.from) === -1) {
    console.log(`  ?  ${m.id} anchor not found in ${m.file} — the harness is stale, not the product`);
    survived++; survivors.push(m.id + ' (anchor missing)');
    continue;
  }
  fs.writeFileSync(path.join(tmp, m.file), src.replace(m.from, m.to));
  const failed = runSuites();
  fs.writeFileSync(path.join(tmp, m.file), src);
  if (failed.length) { killed++; console.log(`  \x1b[32m☠\x1b[0m  ${m.id} killed by ${failed.join(', ')} — ${m.why}`); }
  else { survived++; survivors.push(m.id); console.log(`  \x1b[31m✗\x1b[0m  ${m.id} SURVIVED — ${m.why}`); }
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('\n' + '─'.repeat(58));
console.log(`${killed} killed, ${survived} survived of ${MUTANTS.length}`);
if (survived) { survivors.forEach(s => console.log('  · ' + s)); process.exit(1); }
