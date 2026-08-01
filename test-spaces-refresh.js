'use strict';
/**
 * Spaces list must be refreshed after an upload changes the tenant array.
 *
 * The Spaces cards bake tenant ids into their "Open space" buttons
 * (tenant-space.js:393). The upload pipeline can change which ids exist — a
 * matched upload writes onto the existing tenant's id and splices the
 * placeholder out — so a list rendered before the pipeline points at an id that
 * no longer exists. openSpace() then finds nothing, assemble() falls back to
 * `|| {}`, and the modal reports "No lease on file" for a space whose own card
 * is displaying the terms.
 *
 * Diagnosed from: openSpace:read found:false with 5 valid idsPresent, and
 * sharedArray:false confirming property.tenants is a copy of tenantData.
 */
const fs = require('fs'), path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8');
const TS  = fs.readFileSync(path.join(__dirname, 'tenant-space.js'), 'utf8');

let pass = 0, fail = 0;
const ok  = m => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? ' — ' + d : '')); fail++; };

// The premise: buttons carry ids, so a stale list is a broken list.
console.log('\n── The premise ──');
TS.split('\n').some(l => l.includes('openSpace(') && l.includes('_esc(t.id)'))
  ? ok('Spaces buttons embed the tenant id, so the list goes stale when ids change')
  : bad('could not confirm the button embeds t.id', 'the premise of this test may no longer hold');

// Every place the pipeline is awaited must refresh the list afterwards.
console.log('\n── Every pipeline caller refreshes the Spaces list ──');
const callers = [
  ['handleBulkLeases', 'bulk upload'],
  ['retryLeaseJob',    'retry'],
];
for (const [fn, label] of callers) {
  const start = SRC.indexOf(`function ${fn}(`);
  if (start < 0) { bad(`${fn} not found`); continue; }
  // Body runs to the next top-level function declaration.
  const next = SRC.indexOf('\nasync function ', start + 10);
  const next2 = SRC.indexOf('\nfunction ', start + 10);
  const end = Math.min(next < 0 ? Infinity : next, next2 < 0 ? Infinity : next2);
  const body = SRC.slice(start, end === Infinity ? start + 6000 : end);

  const awaits = body.includes('_runLeaseJobPipeline');
  if (!awaits) { bad(`${fn} no longer awaits the pipeline`, 'test needs updating'); continue; }
  const idx = body.lastIndexOf('_runLeaseJobPipeline');
  const after = body.slice(idx);
  /TenantSpace\.renderList/.test(after)
    ? ok(`${label} (${fn}) refreshes the Spaces list after the pipeline`)
    : bad(`${label} (${fn}) does not refresh the list`, 'its buttons would keep stale ids');
  /property\.tenants = \[\.\.\.tenantData\]|prop\.tenants = \[\.\.\.tenantData\]/.test(after)
    ? ok(`${label} re-syncs the tenant array before refreshing`)
    : bad(`${label} refreshes without re-syncing`, 'the list would render stale records');
}

console.log('\n── The refresh cannot break the upload ──');
const guarded = (SRC.match(/TenantSpace\.renderList\(\w+\);\s*\n\s*\}\s*catch/g) || []).length;
guarded >= 2
  ? ok(`both refreshes are wrapped in try/catch (${guarded}) — a render fault never fails an upload`)
  : bad('a refresh is unguarded', 'a TenantSpace error would abort the upload');

console.log('\n' + (fail ? '\x1b[31m' : '\x1b[32m') + `RESULT: ${pass} passed, ${fail} failed\x1b[0m`);
process.exit(fail ? 1 : 0);
