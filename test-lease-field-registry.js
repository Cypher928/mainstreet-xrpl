'use strict';
/**
 * test-lease-field-registry.js — P0.4: one list of lease fields, and the
 * prompts that used to keep their own copies now read from it.
 *
 *   node test-lease-field-registry.js
 *
 * Offline. Six things:
 *
 *   A  the registry itself — keys, labels, storage keys, profiles
 *   B  GOLDEN: every prompt block the registry renders is byte-for-byte what
 *      the hand-written block said at commit e03560a, the accepted P0.3 head.
 *      The expected text below is a frozen copy taken from that commit, not
 *      something the registry produced, so this cannot pass by agreeing with
 *      itself.
 *   C  AUTHORITY: script.js builds both lease prompts from the registry and
 *      no longer carries a field list of its own
 *   D  the existing contract is preserved — the registry's storage-key map is
 *      exactly script.js's _quoteMap, which P0.4 does not touch
 *   E  the server schema in api/_claude-tasks.js is recorded faithfully, so
 *      the drift between it and the browser prompts is visible rather than
 *      silent. That file is NOT rewritten here: changing what the model is
 *      asked for is an extraction-semantics decision, separately authorized.
 *   F  nothing else moved — extraction and normalization behaviour untouched
 */

const fs   = require('fs');
const path = require('path');

const ROOT = __dirname;
const R    = require('./lease-field-registry.js');
const SCRIPT = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
const TASKS  = fs.readFileSync(path.join(ROOT, 'api', '_claude-tasks.js'), 'utf8');
const HTML   = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function t(name, cond, detail) {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else {
    fail++; failures.push(name + (detail ? ` — ${detail}` : ''));
    console.log(`  \x1b[31m✗ ${name}\x1b[0m${detail ? ` — ${detail}` : ''}`);
  }
}
const eq = (a, b, name) => t(name, JSON.stringify(a) === JSON.stringify(b),
  `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const sec = (s) => console.log(`\n── ${s} ──`);

// ── GOLDEN ──────────────────────────────────────────────────────────────────
// Frozen at commit e03560a (P0.3 accepted). These are the exact bytes the
// three prompts contained BEFORE the registry existed. If a change to the
// registry alters any of them, the model is being asked something different
// and this suite fails.
const GOLDEN = {
  text: [
    '{',
    '  "tenant_name": string,',
    '  "lease_start_date": "YYYY-MM-DD" or null,',
    '  "lease_end_date": "YYYY-MM-DD" or null,',
    '  "cam_commencement_date": "YYYY-MM-DD" or null,',
    '  "partial_period_basis": "per_diem" | "monthly" | "full_period" | null,',
    '  "lease_type": "NNN" | "Gross" | "Modified Gross" | null,',
    '  "sqft": number or null,',
    '  "cam_cap": number or null,',
    '  "cap_base_amount": number or null,',
    '  "admin_fee_pct": number or null,',
    '  "admin_fee_basis": "operating_expenses" | "controllable_expenses" | "excluding_management_fee" | "unstated" | null,',
    '  "gross_up_pct": number or null,',
    '  "expense_stop": number or null,',
    '  "audit_rights": true | false | null,',
    '  "pro_rata_method": "rentable" | "leasable" | "occupied" | "gross" | null,',
    '  "renewal_options": string or null,',
    '  "excluded_categories": string or null,',
    '  "property_name": string or null,',
    '  "quotes": { "cam_cap": string|null, "cap_base_amount": string|null, "admin_fee_pct": string|null, "gross_up_pct": string|null, "expense_stop": string|null, "audit_rights": string|null, "pro_rata_method": string|null, "renewal_options": string|null, "cam_commencement_date": string|null, "partial_period_basis": string|null, "admin_fee_basis": string|null }',
    '}',
  ].join('\n'),

  pdf: [
    '{',
    '  "tenant_name": string or null,',
    '  "lease_start_date": "YYYY-MM-DD" or null,',
    '  "lease_end_date": "YYYY-MM-DD" or null,',
    '  "cam_commencement_date": "YYYY-MM-DD" or null,',
    '  "partial_period_basis": "per_diem" | "monthly" | "full_period" | null,',
    '  "lease_type": "NNN" | "Gross" | "Modified Gross" | null,',
    '  "sqft": number or null,',
    '  "cam_cap": number or null,',
    '  "property_name": string or null',
    '}',
  ].join('\n'),

  server: [
    '{',
    '  "tenant_name": string,',
    '  "suite": string | null,',
    '  "lease_start_date": "YYYY-MM-DD",',
    '  "lease_end_date": "YYYY-MM-DD",',
    '  "lease_type": string,',
    '  "sqft": number,',
    '  "base_rent": number | null,',
    '  "cam_cap": number,',
    '  "admin_fee_pct": number | null,',
    '  "admin_fee_basis": "operating_expenses" | "controllable_expenses" | "excluding_management_fee" | "unstated" | null,',
    '  "gross_up_pct": number | null,',
    '  "expense_stop": number | null,',
    '  "audit_rights": true | false | null,',
    '  "pro_rata_method": "rentable" | "leasable" | "occupied" | "gross" | null,',
    '  "renewal_options": string | null,',
    '  "excluded_categories": string | null,',
    '  "security_deposit": number | null,',
    '  "property_name": string | null,',
    '  "quotes": {',
    '    "cam_cap": string | null,',
    '    "admin_fee_pct": string | null,',
    '    "admin_fee_basis": string | null,',
    '    "gross_up_pct": string | null,',
    '    "expense_stop": string | null,',
    '    "audit_rights": string | null,',
    '    "pro_rata_method": string | null,',
    '    "renewal_options": string | null,',
    '    "base_rent": string | null,',
    '    "security_deposit": string | null,',
    '    "tenant_name": string | null,',
    '    "lease_type": string | null,',
    '    "sqft": string | null,',
    '    "lease_start_date": string | null,',
    '    "lease_end_date": string | null',
    '  }',
    '}',
  ].join('\n'),
};

console.log('\n╔══════════════════════════════════════════════════════════════╗');
console.log('║  P0.4 — one lease field registry, and the prompts read it    ║');
console.log('╚══════════════════════════════════════════════════════════════╝');

// ── A ───────────────────────────────────────────────────────────────────────
sec('A. the registry');
{
  t('A1 it exports the three profiles', JSON.stringify(R.PROFILES) === JSON.stringify(['text', 'pdf', 'server']));
  t('A2 every field has a key, a label and a storage key',
    R.FIELDS.every(f => f.key && f.label && f.store));
  t('A3 keys are unique', new Set(R.FIELDS.map(f => f.key)).size === R.FIELDS.length);
  t('A4 every field belongs to at least one profile',
    R.FIELDS.every(f => R.PROFILES.some(p => Object.prototype.hasOwnProperty.call(f.types, p))));

  // The four keys whose storage name differs from their extraction name. Every
  // other field stores under its own key, and that identity is the thing the
  // rest of the app relies on.
  eq(R.storeKey('sqft'), 'leased_sqft', 'A5 sqft stores as leased_sqft');
  eq(R.storeKey('cam_cap'), 'cap', 'A6 cam_cap stores as cap');
  eq(R.storeKey('lease_start_date'), 'start_date', 'A7 lease_start_date stores as start_date');
  eq(R.storeKey('lease_end_date'), 'end_date', 'A8 lease_end_date stores as end_date');
  const renamed = R.FIELDS.filter(f => f.store !== f.key).map(f => f.key).sort();
  eq(renamed, ['cam_cap', 'lease_end_date', 'lease_start_date', 'sqft'],
    'A9 those four are the ONLY fields that are renamed on storage');

  t('A10 an unknown key is not invented', R.field('not_a_lease_field') === null);
  t('A11 label() falls back to the key rather than throwing', R.label('not_a_lease_field') === 'not_a_lease_field');
  // Identity, not a guess. An unknown key must map to itself: inventing a
  // storage name would silently file an answer under another field.
  t('A11b storeKey() falls back to the key itself for an unknown field',
    R.storeKey('not_a_lease_field') === 'not_a_lease_field', R.storeKey('not_a_lease_field'));
  eq(R.quoteMap('pdf'), {}, 'A11c quoteMap is empty for a profile that asks for no clauses');
  t('A12 an unknown profile is refused', (() => {
    try { R.promptSchema('nope'); return false; } catch (e) { return /unknown lease prompt profile/.test(e.message); }
  })());
  t('A13 the pdf profile asks for no quotes', R.quoteKeys('pdf').length === 0);
  // Labels are the registry's own contribution: the human name for a field,
  // which until now was spelled out again in every surface that showed one.
  // Pinned so a rename is a decision, not a slip.
  eq(R.FIELDS.map(f => [f.key, f.label]), [
    ['tenant_name', 'Tenant Name'], ['suite', 'Suite'],
    ['lease_start_date', 'Lease Start'], ['lease_end_date', 'Lease End'],
    ['cam_commencement_date', 'CAM Commencement'], ['partial_period_basis', 'Partial Period Basis'],
    ['lease_type', 'Lease Type'], ['sqft', 'Leased SqFt'], ['base_rent', 'Base Rent'],
    ['cam_cap', 'CAM Cap'], ['cap_base_amount', 'Cap Base Amount'],
    ['admin_fee_pct', 'Admin Fee %'], ['admin_fee_basis', 'Admin Fee Basis'],
    ['gross_up_pct', 'Gross-Up %'], ['expense_stop', 'Expense Stop'],
    ['audit_rights', 'Audit Rights'], ['pro_rata_method', 'Pro-Rata Method'],
    ['renewal_options', 'Renewal Options'], ['excluded_categories', 'Excluded Categories'],
    ['security_deposit', 'Security Deposit'], ['property_name', 'Property Name'],
  ], 'A15 every field key and its label, pinned');

  t('A14 FIELDS order is prompt order for every profile', R.PROFILES.every(p => {
    const ks = R.keys(p);
    const all = R.FIELDS.map(f => f.key);
    let last = -1;
    return ks.every(k => { const i = all.indexOf(k); const ok = i > last; last = i; return ok; });
  }));
}

// ── B ───────────────────────────────────────────────────────────────────────
sec('B. GOLDEN — the rendered prompts are byte-for-byte what they were');
{
  for (const profile of ['text', 'pdf', 'server']) {
    const got = R.promptSchema(profile);
    const want = GOLDEN[profile];
    let detail = '';
    if (got !== want) {
      const a = want.split('\n'), b = got.split('\n');
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (a[i] !== b[i]) { detail = `first difference at line ${i}: want ${JSON.stringify(a[i])}, got ${JSON.stringify(b[i])}`; break; }
      }
    }
    t(`B1 ${profile}: the rendered schema equals the frozen e03560a block`, got === want, detail);
  }
  t('B2 the text profile lists 19 entries (18 fields + quotes)', R.keys('text').length === 18);
  t('B3 the pdf profile lists 9 fields', R.keys('pdf').length === 9);
  t('B4 the server profile lists 18 fields', R.keys('server').length === 18);
}

// ── C ───────────────────────────────────────────────────────────────────────
sec('C. AUTHORITY — script.js reads the registry and keeps no list of its own');
{
  t('C1 callClaudeForLease builds its schema from the registry',
    SCRIPT.includes("${LeaseFieldRegistry.promptSchema('text')}"));
  t('C2 callClaudeWithPdfDirect builds its schema from the registry',
    SCRIPT.includes("${LeaseFieldRegistry.promptSchema('pdf')}"));

  // The decisive one. Splice the registry's output back into the live source
  // and the original prompt reappears, character for character. That is the
  // same thing the browser does at runtime.
  for (const [profile, fn] of [['text', 'callClaudeForLease'], ['pdf', 'callClaudeWithPdfDirect']]) {
    const call = "${LeaseFieldRegistry.promptSchema('" + profile + "')}";
    const rebuilt = SCRIPT.replace(call, R.promptSchema(profile));
    t(`C3 ${fn}: substituting the registry reproduces the original prompt exactly`,
      rebuilt.includes(GOLDEN[profile]));
  }

  // No competing list left behind. A prompt field line looks like
  //   "  "cam_cap": number or null,"
  // and there must be none of them anywhere in script.js any more.
  const promptFieldLine = /^\s{2}"(tenant_name|lease_start_date|lease_end_date|cam_commencement_date|partial_period_basis|lease_type|sqft|cam_cap|cap_base_amount|admin_fee_pct|admin_fee_basis|gross_up_pct|expense_stop|audit_rights|pro_rata_method|renewal_options|excluded_categories|property_name|suite|base_rent|security_deposit)":\s+(string|number|true|"|\{)/;
  const leftovers = SCRIPT.split('\n')
    .map((l, i) => ({ l, i: i + 1 }))
    .filter(x => promptFieldLine.test(x.l));
  t('C4 script.js carries no lease prompt field list of its own',
    leftovers.length === 0,
    leftovers.slice(0, 4).map(x => `line ${x.i}: ${x.l.trim().slice(0, 60)}`).join(' | '));

  t('C5 index.html loads the registry before script.js', (() => {
    const a = HTML.indexOf('<script src="lease-field-registry.js">');
    const b = HTML.indexOf('<script src="script.js">');
    return a !== -1 && b !== -1 && a < b;
  })());
}

// ── D ───────────────────────────────────────────────────────────────────────
sec('D. the existing contract — the registry agrees with script.js _quoteMap');
{
  // _quoteMap is script.js's extraction-key → storage-key table. P0.4 does not
  // touch it; the point here is that the registry says the same thing, so the
  // two cannot disagree without this failing.
  const block = SCRIPT.slice(SCRIPT.indexOf('const _quoteMap = {'));
  const body  = block.slice(0, block.indexOf('};'));
  const live  = {};
  for (const m of body.matchAll(/^\s*([a-z_]+):\s*'([a-z_]+)',/gm)) live[m[1]] = m[2];

  t('D1 _quoteMap was located and parsed', Object.keys(live).length >= 15, `${Object.keys(live).length} entries`);
  const fromRegistry = {};
  for (const k of Object.keys(live)) fromRegistry[k] = R.storeKey(k);
  eq(fromRegistry, live, 'D2 every _quoteMap entry matches the registry\'s storage key');

  // And the text profile's quote list is exactly the quotable keys, so a field
  // cannot be asked for a clause in the prompt while the resolver ignores it.
  const quoted = R.quoteKeys('text').slice().sort();
  const mapped = Object.keys(live).filter(k => quoted.includes(k)).sort();
  eq(mapped, quoted, 'D3 every field quoted in the text prompt is resolved by _quoteMap');
}

// ── E ───────────────────────────────────────────────────────────────────────
sec('E. the server schema is recorded, and its drift is visible');
{
  t('E1 api/_claude-tasks.js still contains its schema verbatim', TASKS.includes(GOLDEN.server));
  t('E2 P0.4 did not rewrite the server prompt', TASKS.includes('LEASE_EXTRACTION_SYSTEM'));

  // The divergences, asserted as facts rather than left to be discovered. If
  // someone later unifies these, these three flip and the change is deliberate.
  const textKeys = R.keys('text'), serverKeys = R.keys('server'), pdfKeys = R.keys('pdf');
  eq(serverKeys.filter(k => !textKeys.includes(k)).sort(), ['base_rent', 'security_deposit', 'suite'],
    'E3 the server asks for three fields neither browser prompt does');
  eq(textKeys.filter(k => !serverKeys.includes(k)).sort(), ['cam_commencement_date', 'cap_base_amount', 'partial_period_basis'],
    'E4 the text prompt asks for three the server does not');
  t('E5 tenant_name is nullable in the pdf prompt only',
    R.field('tenant_name').types.pdf === 'string or null'
    && R.field('tenant_name').types.text === 'string'
    && R.field('tenant_name').types.server === 'string');
  t('E6 every pdf field is also a text field', pdfKeys.every(k => textKeys.includes(k)));
}

// ── F ───────────────────────────────────────────────────────────────────────
sec('F. nothing else moved');
{
  // P0.4 is a registry and one delegation. These are the behaviours it must
  // not have touched, checked at the source level.
  t('F1 the resolver still maps sqft → leased_sqft in script.js', /sqft:\s+'leased_sqft'/.test(SCRIPT));
  t('F2 the resolver still maps cam_cap → cap in script.js', /cam_cap:\s+'cap'/.test(SCRIPT));
  t('F3 quickConfirmTenantFields still has its own CORE_FIELDS (out of P0.4 scope)',
    /const CORE_FIELDS = \[/.test(SCRIPT));
  t('F4 applyAmendmentOverrides still has its own COMPARABLE_FIELDS (out of P0.4 scope)',
    /const COMPARABLE_FIELDS = \[/.test(SCRIPT));
  t('F5 no migration or schema file is referenced by the registry',
    !/migrations\//.test(fs.readFileSync(path.join(ROOT, 'lease-field-registry.js'), 'utf8')));
  t('F6 the registry is pure — it reads no globals and performs no I/O', (() => {
    const src = fs.readFileSync(path.join(ROOT, 'lease-field-registry.js'), 'utf8');
    return !/require\(|fetch\(|localStorage|window\.|document\./.test(src);
  })());
}

console.log('\n' + '─'.repeat(62));
if (fail) {
  console.log(`\x1b[31mRESULT: ${pass} passed, ${fail} failed\x1b[0m`);
  failures.forEach(f => console.log(`  · ${f}`));
  process.exit(1);
}
console.log(`\x1b[32mRESULT: ${pass} passed, 0 failed\x1b[0m`);
