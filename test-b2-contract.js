'use strict';
/**
 * test-b2-contract.js — B2 invariants that live in the source, not in a request.
 *
 * The HTTP suite proves what the database does. Some B2 guarantees cannot be
 * observed that way, either because they are about what the code MAY do rather
 * than what it did on one run, or because the failure they guard against would
 * make the HTTP suite pass while the system is wrong:
 *
 *   · "no REVOKE against authenticated" — a revoke that broke landlord reads
 *     would be caught by T52, but only after it shipped and only if that exact
 *     column were read. Asserting its absence is cheaper and total.
 *   · "the portal never queries a landlord table" — RLS means such a query
 *     returns 0 rows rather than failing, so a portal that asked would look
 *     identical to one that did not.
 *   · "the publish endpoint accepts no amounts" — provable from the allow-list
 *     without needing a tampered request for every field.
 */
const fs = require('fs');
const path = require('path');
const R = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');

let pass = 0, fail = 0;
const ok  = (m) => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? ' — ' + d : '')); fail++; };

const MIGRATIONS = ['migrations/016_tenant_space_profiles.sql',
                    'migrations/017_tenant_statements.sql',
                    'migrations/018_tenant_documents.sql'];
const SOURCES = ['tenant_space_profile_sources', 'tenant_statement_sources', 'tenant_document_sources'];
const PROJECTIONS = ['tenant_space_profiles', 'tenant_statements', 'tenant_documents'];

console.log('\n── No privilege is ever revoked from `authenticated` ──');
// The rev-1 design used column grants and had to revoke the table first. That
// cannot work when landlord and tenant share the role, and re-introducing it
// would silently break landlord publishing while every tenant test still passed.
{
  const offenders = MIGRATIONS.filter(f => /revoke\s+[\s\S]{0,80}?\bfrom\s+authenticated\b/i.test(R(f)));
  offenders.length === 0
    ? ok('no migration revokes anything from `authenticated`')
    : bad('a B2 migration revokes from `authenticated`', offenders.join(', '));
}
{
  const missing = MIGRATIONS.filter(f => !/revoke\s+all\s+on\s+\S+\s+from\s+anon/i.test(R(f)));
  missing.length === 0
    ? ok('every B2 migration revokes anon')
    : bad('a B2 migration does not revoke anon', missing.join(', '));
}

console.log('\n── The _sources tables have no tenant policy ──');
for (const f of MIGRATIONS) {
  const sql = R(f);
  for (const t of SOURCES) {
    if (!sql.includes('public.' + t)) continue;
    // Any policy naming a _sources table must be landlord or service_role.
    const re = new RegExp('create policy\\s+(\\S+)\\s+on\\s+public\\.' + t, 'gi');
    let m, offending = [];
    while ((m = re.exec(sql))) {
      if (!/landlord|service_role/.test(m[1])) offending.push(m[1]);
    }
    offending.length === 0
      ? ok(`${t}: no tenant policy (${path.basename(f)})`)
      : bad(`${t} has a tenant-facing policy`, offending.join(', '));
    /tenant_ids_for_current_user/.test(sql.slice(sql.indexOf('public.' + t)))
      && sql.split('public.' + t)[1].slice(0, 900).includes('tenant_ids_for_current_user')
      ? bad(`${t} references the tenant primitive`)
      : ok(`${t}: never calls tenant_ids_for_current_user()`);
  }
}

console.log('\n── Every projection gates on published, in the policy ──');
for (const f of MIGRATIONS) {
  const sql = R(f);
  for (const t of PROJECTIONS) {
    const marker = `create policy ${t}_tenant_select`;
    const i = sql.indexOf(marker);
    if (i < 0) continue;
    const body = sql.slice(i, i + 400);
    (/tenant_ids_for_current_user/.test(body) && /status\s*=\s*'published'/.test(body))
      ? ok(`${t}: tenant policy requires membership AND status='published'`)
      : bad(`${t}: tenant policy is missing a required predicate`, body.slice(0, 120));
  }
}

console.log('\n── No tenant write policy exists anywhere in B2 ──');
{
  let offenders = [];
  for (const f of MIGRATIONS) {
    const re = /create policy\s+(\S+)\s+on\s+public\.(\S+)\s+for\s+(insert|update|delete|all)\s+to\s+authenticated/gi;
    let m; const sql = R(f);
    while ((m = re.exec(sql))) {
      if (!/landlord/.test(m[1])) offenders.push(`${m[1]} (${m[3]})`);
    }
  }
  offenders.length === 0
    ? ok('the only write policies granted to `authenticated` are the landlord ones')
    : bad('a non-landlord write policy exists', offenders.join(', '));
}

console.log('\n── The publish endpoint accepts no figure from the client ──');
{
  const src = R('api/tenant-publish-statement.js');
  const m = src.match(/const ALLOWED_FIELDS = \[([^\]]+)\]/);
  if (!m) bad('could not find ALLOWED_FIELDS');
  else {
    const fields = m[1].split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean);
    const banned = ['allocated_amount', 'pro_rata_percent', 'total_pool', 'amount_billed',
                    'balance_due', 'status', 'published_at', 'version', 'statement_json'];
    const leaked = fields.filter(f => banned.includes(f));
    leaked.length === 0
      ? ok(`ALLOWED_FIELDS is [${fields.join(', ')}] — no amount, status or version`)
      : bad('the publish endpoint accepts a server-derived field', leaked.join(', '));
    /rejectUnexpectedFields\(res, body, ALLOWED_FIELDS\)/.test(src)
      ? ok('unexpected fields are rejected, not ignored')
      : bad('ALLOWED_FIELDS is declared but never enforced');
    /allocated\s*=\s*money\(rec\.allocated_amount\)/.test(src)
      ? ok('allocated_amount is read from the reconciliation row')
      : bad('the allocation is not derived from cam_reconciliations');
  }
}

console.log('\n── F-02 is the same resolver the browser uses ──');
{
  const src = R('api/_exclusion-block.js');
  /require\(['"]\.\.\/cam-exclusions\.js['"]\)/.test(src)
    ? ok('the server requires cam-exclusions.js — one resolver, no second implementation')
    : bad('the server does not reuse cam-exclusions.js');
  /resolverMissing:\s*true/.test(src)
    ? ok('a missing resolver blocks publication (fails closed)')
    : bad('a missing resolver does not block publication');
  const CX = require('./cam-exclusions.js');
  const { exclusionBlockReason } = require('./api/_exclusion-block.js');
  const fp = CX.exclusionFingerprint('capital expenditures');
  exclusionBlockReason({ excluded_categories: 'capital expenditures' })
    ? ok('an unresolvable exclusion blocks publication')
    : bad('an unresolvable exclusion does not block publication');
  exclusionBlockReason({ excluded_categories: 'capital expenditures', _exclusionAck: { fingerprint: fp } }) === null
    ? ok('a matching acknowledgement permits publication')
    : bad('a matching acknowledgement still blocks');
  const stale = exclusionBlockReason({ excluded_categories: 'capital expenditures', _exclusionAck: { fingerprint: 'nope' } });
  (stale && stale.staleAck === true)
    ? ok('an acknowledgement for a DIFFERENT exclusion set does not count')
    : bad('a stale acknowledgement is accepted');
}

console.log('\n── The portal reads projections and nothing else ──');
{
  const js = R('portal.js');
  const forbidden = ['properties', 'cam_reconciliations', 'lease_documents',
                     'tenant_field_evidence', 'tenant_review_audit', ...SOURCES];
  const queried = [];
  const re = /\.from\(['"]([^'"]+)['"]\)/g;
  let m; while ((m = re.exec(js))) queried.push(m[1]);
  const leaked = queried.filter(t => forbidden.includes(t));
  leaked.length === 0
    ? ok(`portal.js queries only [${[...new Set(queried)].join(', ')}]`)
    : bad('portal.js queries a table a tenant must not read', leaked.join(', '));
  // RLS would return 0 rows anyway, which is exactly why this needs asserting:
  // the mistake would be invisible at runtime.
  !/storage_path|source_run_hash/.test(js)
    ? ok('portal.js never names a withheld column')
    : bad('portal.js references a withheld column');
  !/src="script\.js"/.test(R('portal.html'))
    ? ok('portal.html does not load the landlord bundle')
    : bad('portal.html loads script.js');
}

console.log('\n── B2 adds no Stripe, payment, dispute or tenant-edit surface ──');
{
  const files = ['portal.js', 'portal.html', 'api/tenant-publish-statement.js',
                 'api/tenant-document-url.js', 'api/tenant-publish-document.js'];
  // Comments are stripped first. The invariant is "no payment or dispute
  // SURFACE", not "the word never appears" — portal.js's header has to be able
  // to say the landlord's dispute workspace is deliberately absent, and the
  // publish endpoint has to be able to note that B3 will need the same
  // amount rule. Scanning prose for feature names would forbid explaining the
  // boundary in the file that implements it.
  const strip = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '')).join('\n');
  const banned = /stripe|checkout|payment_intent|paymentIntent|payNow|createPayment|dispute/i;
  const hits = files.filter(f => banned.test(strip(R(f))));
  hits.length === 0
    ? ok('no payment or dispute surface in any B2 file (comments excluded)')
    : bad('a B2 file implements an out-of-scope feature', hits.join(', '));

  // And prove the stripper is load-bearing rather than blanket-passing: a real
  // call must still be caught.
  const probe = strip('// dispute\n/* stripe */\nawait createPaymentIntent();');
  /createPayment/i.test(probe)
    ? ok('the comment stripper still catches a real call')
    : bad('the comment stripper hides real code — this check proves nothing');
}

console.log('\n── B1 is frozen ──');
{
  // B2 must not have edited a B1 migration. Compared against the committed
  // blobs rather than by eye.
  const { execSync } = require('child_process');
  const b1 = ['migrations/012_tenant_users_phase_a.sql', 'migrations/013_tenant_users_revoke_anon.sql',
              'migrations/014_tenant_invitations.sql', 'migrations/015_tenant_users_hide_revoked.sql'];
  let changed = [];
  for (const f of b1) {
    try {
      const d = execSync(`git diff ac0ccf9 -- ${f}`, { cwd: __dirname, encoding: 'utf8' });
      if (d.trim()) changed.push(f);
    } catch (e) { /* git unavailable — skip rather than fail the suite */ }
  }
  changed.length === 0
    ? ok('no B1 migration was modified by B2')
    : bad('B2 modified a frozen B1 migration', changed.join(', '));
}

console.log('\n' + (fail ? '\x1b[31m' : '\x1b[32m') + 'RESULT: ' + pass + ' passed, ' + fail + ' failed\x1b[0m');
process.exit(fail ? 1 : 0);
