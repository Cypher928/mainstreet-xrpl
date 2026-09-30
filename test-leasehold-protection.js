'use strict';
/**
 * test-leasehold-protection.js — the client side of 038 (leasehold protection).
 *
 *   node test-leasehold-protection.js
 *
 * 038 makes the database refuse every direct tenant delete and every direct
 * lifecycle change, and makes the resync report absentees instead of deleting
 * them. That is only safe if nothing in the product relies on the old
 * behaviour — a writer that deletes a leasehold would now fail, and one that
 * writes a lifecycle column would now be refused. This suite pins, statically,
 * across EVERY product file (the browser and the API — A-1's
 * test-lifecycle-plumbing.js D12 covers script.js alone):
 *
 *   A  nothing deletes a tenants row: no supabase-js chain, no PostgREST
 *      DELETE, no SQL outside the migrations
 *   B  the resync payload the browser sends is exactly the column set the 038
 *      RPC writes — and neither carries a lifecycle field
 *   C  Remove and Clear All rely on the resync only to WRITE, never to delete
 *   D  the migration, its rollback, verifier and mutation harness exist, the
 *      verifier is registered in the regression, and migrations/APPLIED.md
 *      records 038 as applied to Pilot with this file's md5
 *
 * 043 (Step B1, absorbed leaseholds) extends 038, and this suite follows it:
 * B6 the 043 resync still writes the browser's column set; C5/C6 nothing in
 * the product calls the new functions or writes the new columns before B2/B3;
 * D7–D11 043's files exist and its verifier is registered.
 *
 * The database behaviour itself is proved by tools/verify-migration-038.js on
 * a throwaway cluster.
 */
const fs = require('fs');
const path = require('path');
const { fnSource } = require('./test-support/fn-source');

const ROOT = __dirname;
let pass = 0, fail = 0;
const t = (name, ok, detail) => {
  if (ok) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
  else    { fail++; console.log('  \x1b[31m✗\x1b[0m ' + name + (detail ? '  — ' + detail : '')); }
};
const section = (s) => console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 60 - s.length)));
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

// Every product source file: the app shell's scripts and the API. Tests, tools,
// migrations, vendored and generated files are not product code.
const productFiles = [
  ...fs.readdirSync(ROOT).filter(f => f.endsWith('.js') && !/^test-|\.test\.js$|\.config\.js$/.test(f)),
  ...fs.readdirSync(path.join(ROOT, 'api')).filter(f => f.endsWith('.js')).map(f => 'api/' + f),
];

// ── A ────────────────────────────────────────────────────────────────────────
section('A. Nothing in the product deletes a tenants row');
{
  const offenders = [];
  productFiles.forEach(f => {
    const src = stripComments(read(f));
    // supabase-js: .from('tenants') … .delete(  within one chain (no statement end between)
    const re = /\.from\(\s*['"`]tenants['"`]\s*\)([^;]*?)\.delete\s*\(/g;
    let m; while ((m = re.exec(src))) offenders.push(f + ': supabase-js chain');
    if (/\/rest\/v1\/tenants\b[^\n]*[\s\S]{0,200}?method\s*:\s*['"`]DELETE['"`]/.test(src)) offenders.push(f + ': PostgREST DELETE');
    if (/delete\s+from\s+(public\.)?tenants\b/i.test(src)) offenders.push(f + ': SQL');
  });
  t('A1 no product file deletes a tenants row (' + productFiles.length + ' files scanned: supabase-js, PostgREST, SQL)', offenders.length === 0, offenders.join('; '));
  t('A2 the scan sees the files that matter', ['script.js', 'portal.js', 'api/lease-documents.js', 'api/_property-record-hydrator.js'].every(f => productFiles.includes(f)));
  // The scanner itself bites: a planted chain is found.
  const planted = ".from('tenants')\n      .delete()\n      .eq('id', x)";
  t('A3 the scanner finds a multi-line delete chain when one is there', /\.from\(\s*['"`]tenants['"`]\s*\)([^;]*?)\.delete\s*\(/.test(planted));
}

// ── B ────────────────────────────────────────────────────────────────────────
section('B. The resync payload is the RPC\'s column set, and carries no lifecycle');
{
  const SCRIPT = read('script.js');
  const M038 = read('migrations/038_leasehold_protection.sql');
  const rpcCall = fnSource(SCRIPT, '_doResyncTenantsToTable');
  const keysOf = (src, anchor) => {
    const i = src.indexOf(anchor); const j = src.indexOf('}))', i);
    return (src.slice(i, j).match(/^\s*([a-z_]+)\s*:/gm) || []).map(s => s.replace(/[\s:]/g, ''));
  };
  const payload = keysOf(rpcCall, '.map(t => ({');
  const a = M038.indexOf('create or replace function public.resync_property_tenants(');
  const ins = M038.slice(M038.indexOf('insert into public.tenants (', a), M038.indexOf(') values (', a));
  const cols = ins.replace('insert into public.tenants (', '').split(',').map(s => s.trim()).filter(c => c !== 'id' && c !== 'property_id');
  t('B1 the browser sends id plus exactly the columns the 038 resync writes',
    JSON.stringify(payload.filter(k => k !== 'id').sort()) === JSON.stringify(cols.slice().sort()) && payload.includes('id'),
    'payload ' + payload.join(',') + ' | rpc ' + cols.join(','));
  t('B2 neither carries leasehold_status, ended_at or ended_reason',
    !payload.some(k => /leasehold_status|ended_at|ended_reason/.test(k)) && !/leasehold_status|ended_at|ended_reason/.test(ins));
  const upd = M038.slice(M038.indexOf('on conflict (id) do update set', a), M038.indexOf('get diagnostics v_written', a));
  t('B3 the RPC\'s update never sets a lifecycle column, and is guarded to ACTIVE rows',
    !/leasehold_status\s*=|ended_at\s*=|ended_reason\s*=/.test(upd.replace(/tenants\.leasehold_status = 'active'/, '')) && /tenants\.leasehold_status = 'active'/.test(upd));
  const direct = fnSource(SCRIPT, '_doResyncTenantsDirectly');
  t('B4 the direct-write fallback (used only when the RPC is missing) never deletes and never writes lifecycle',
    !/\.delete\s*\(/.test(stripComments(direct)) && !/leasehold_status|ended_at|ended_reason/.test(stripComments(direct)));
  t('B5 the client never reads the resync\'s deleted count as a signal',
    !/\.deleted\b|\[['"]deleted['"]\]/.test(stripComments(fnSource(SCRIPT, 'resyncTenantsToTable') + fnSource(SCRIPT, '_doResyncTenantsToTable'))));
  // 043 replaces the resync; the column set it writes must still be the one the browser sends.
  const M043 = read('migrations/043_leasehold_absorption.sql');
  const b = M043.indexOf('create or replace function public.resync_property_tenants(');
  const ins43 = M043.slice(M043.indexOf('insert into public.tenants (', b), M043.indexOf(') values (', b));
  const cols43 = ins43.replace('insert into public.tenants (', '').split(',').map(s => s.trim()).filter(c => c !== 'id' && c !== 'property_id');
  t('B6 the 043 resync writes exactly the columns the browser sends — and no lifecycle or absorption column',
    JSON.stringify(cols43.slice().sort()) === JSON.stringify(cols.slice().sort())
    && !/leasehold_status|ended_at|ended_reason|absorbed_into|absorbed_reason|absorbed_at/.test(ins43), 'rpc 043 ' + cols43.join(','));
}

// ── C ────────────────────────────────────────────────────────────────────────
section('C. Remove and Clear All leave the leasehold on record');
{
  const SCRIPT = read('script.js');
  const remove = stripComments(fnSource(SCRIPT, 'removeBulkTenant'));
  t('C1 Remove drops the row from the list and re-syncs what remains — no delete of its own',
    /tenantData\.splice\(i, 1\)/.test(remove) && /resyncTenantsToTable\(/.test(remove) && !/\.delete\s*\(|delete_|discard_leasehold|end_leasehold/.test(remove));
  t('C2 its comment no longer claims the resync deletes rows',
    !/delete all rows for this property/.test(fnSource(SCRIPT, 'removeBulkTenant')) && /never deletes/.test(fnSource(SCRIPT, 'removeBulkTenant')));
  const clear = stripComments(fnSource(SCRIPT, 'clearBulkResults'));
  t('C3 Clear All clears the upload list and deletes no tenants row', !/from\(\s*['"`]tenants['"`]\s*\)/.test(clear));
  t('C4 nothing in the product calls end / reactivate / discard yet (Step B, separately approved)',
    !productFiles.some(f => /['"`](end_leasehold|reactivate_leasehold|discard_leasehold)['"`]/.test(stripComments(read(f)))));
  t('C5 nothing in the product calls absorb / restore / the preflight yet (B3, separately approved)',
    !productFiles.some(f => /['"`](absorb_leasehold|restore_absorbed_leasehold|absorb_leasehold_preflight)['"`]/.test(stripComments(read(f)))));
  t('C6 nothing in the product writes an absorption column or data_revision (only the database does)',
    !productFiles.some(f => /\b(absorbed_into|absorbed_reason|absorbed_at|data_revision)\s*:/.test(stripComments(read(f)))));
}

// ── D ────────────────────────────────────────────────────────────────────────
section('D. The migration ships with its rollback, verifier and mutation harness');
{
  ['migrations/038_leasehold_protection.sql', 'migrations/038_leasehold_protection_rollback.sql',
   'tools/verify-migration-038.js', 'tools/leasehold-protection-mutation.js'].forEach((f, i) =>
    t('D' + (i + 1) + ' ' + f + ' exists', fs.existsSync(path.join(ROOT, f))));
  const REG = read('test-regression.js');
  t('D5 the verifier and this suite are registered in the regression',
    /node tools\/verify-migration-038\.js/.test(REG) && /node test-leasehold-protection\.js/.test(REG));
  // 038 was applied to Pilot on 2026-09-30. The manifest's history row must
  // name it, say the recorded text is the file verbatim, and cite the md5 of
  // THIS file — so an edit to the migration after it was applied shows up here.
  const row = (read('migrations/APPLIED.md').split('\n')
    .find(l => /^\| `\d{14}` \| `038_leasehold_protection` \|/.test(l)) || '');
  const fileMd5 = require('crypto').createHash('md5').update(read('migrations/038_leasehold_protection.sql')).digest('hex');
  t('D6 038 is recorded as applied: its history row names it, the file verbatim, this file\'s md5, identical',
    /applied 20\d\d-\d\d-\d\d/.test(row) && row.includes('`migrations/038_leasehold_protection.sql`')
    && row.includes('md5 `' + fileMd5.slice(0, 8)) && /\| identical \|$/.test(row),
    row ? 'md5 ' + fileMd5.slice(0, 8) + ' | ' + row.slice(0, 120) : 'no 038 row in migrations/APPLIED.md');
  // 043 (Step B1) extends 038: same shape — migration, rollback, verifier, mutation harness, registered.
  ['migrations/043_leasehold_absorption.sql', 'migrations/043_leasehold_absorption_rollback.sql',
   'tools/verify-migration-043.js', 'tools/leasehold-absorption-mutation.js'].forEach((f, i) =>
    t('D' + (7 + i) + ' ' + f + ' exists', fs.existsSync(path.join(ROOT, f))));
  t('D11 the 043 verifier is registered in the regression', /node tools\/verify-migration-043\.js/.test(REG));
}

console.log('\n' + '─'.repeat(58));
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
