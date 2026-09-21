'use strict';
/**
 * test-acquisition-terms.js — Acquisition Review Phase 1, P1-4, increment P4-1.
 *
 *   node test-acquisition-terms.js
 *
 * P4-1 is the evidence layer: what each document SAYS about each of 27 terms,
 * with the clause behind it, stored on the document's row. Nothing in it
 * resolves a governing value, and nothing in it writes back into the review.
 * What this suite defends, in order of how much it would cost to get wrong:
 *
 *   · MISSING IS NOT NONE — a term the document does not address stays null,
 *     and no normaliser, no prompt rule and no column default turns it into 0,
 *     false, "" or "none". The reverse coercion happens exactly once: a
 *     negative word for a number field, WITH a quote, becomes 0.
 *   · ONE VOCABULARY — group A is LeaseIntelligence.CANONICAL_FIELDS byte for
 *     byte, the prompt names all 27 and nothing else, and the nine group-C
 *     fields the plan approved are all present under their approved names.
 *   · A CLAIM CARRIES ITS EVIDENCE — `success` or `partial` with no fields
 *     or no timestamp is refused by the module before the migration's check
 *     gets the chance to.
 *   · LeaseIntelligence is UNCHANGED by this increment.
 *
 * It drives acquisition-terms.js and acquisition-documents.js for real, loads
 * lease-intelligence.js in a sandbox, and reads the prompt, migration 025,
 * script.js and index.html as text through code(), which strips comments so a
 * change's own explanation cannot satisfy an assertion.
 *
 * The browser half is test-e2e-acquisition-abstraction.js; the migration is
 * EXECUTED by tools/verify-migration-025.js.
 */
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const ROOT = __dirname;
const AT   = require('./acquisition-terms.js');
const AD   = require('./acquisition-documents.js');
const TASKS = require('./api/_claude-tasks.js');

let pass = 0, fail = 0;
const failures = [];
function t(name, fn) {
  try { fn(); pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  catch (e) { fail++; failures.push(`${name}: ${e.message}`); console.log(`  \x1b[31m✗\x1b[0m ${name}\n      → ${e.message}`); }
}
const ok = (c, m) => { if (!c) throw new Error(m || 'expected truthy'); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m || ''} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const deq = (a, b, m) => { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${m || ''} expected ${y}, got ${x}`); };
function sec(s) { console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 60 - s.length))); }
function code(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8')
    .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*|--)/.test(l)).join('\n');
}
function fnBody(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i === -1) throw new Error('function ' + name + ' not found');
  const j = src.indexOf('\n}\n', i);
  return src.slice(i, j === -1 ? undefined : j + 2);
}
function loadLeaseIntelligence() {
  const sb = { window: {}, console };
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'lease-intelligence.js'), 'utf8'), sb, { filename: 'lease-intelligence.js' });
  if (!sb.window.LeaseIntelligence) throw new Error('lease-intelligence.js did not expose window.LeaseIntelligence');
  return sb.window.LeaseIntelligence;
}
const LI = loadLeaseIntelligence();
const PROMPT = TASKS.CLAUDE_TASKS.acquisition_abstraction && TASKS.CLAUDE_TASKS.acquisition_abstraction.system;

const NINE = ['tenant_improvement_allowance', 'landlord_work', 'guarantor_name', 'guaranty_limit',
              'termination_rights', 'expansion_rights', 'assignment_consent', 'exclusive_use', 'co_tenancy'];
const FIVE = ['base_rent', 'security_deposit', 'suite', 'excluded_categories', 'admin_fee_basis'];

console.log('\n══ Acquisition lease terms — evidence layer (P1-4 / P4-1) ══');

// ── the vocabulary ──────────────────────────────────────────────────────────
sec('one vocabulary — LeaseIntelligence’s thirteen, plus what the plan approved');

t('group A is LeaseIntelligence.CANONICAL_FIELDS, byte for byte and in order', () => {
  deq(AT.FIELD_GROUPS.canonical, LI.CANONICAL_FIELDS);
  eq(LI.CANONICAL_FIELDS.length, 13);
});

t('group B is the five lease_extraction already returns and nobody governs', () => {
  deq(AT.FIELD_GROUPS.extracted, FIVE);
  const lease = TASKS.CLAUDE_TASKS.lease_extraction.system;
  for (const f of FIVE) ok(new RegExp('"' + f + '"').test(lease), f + ' is not in the lease_extraction schema');
  for (const f of FIVE) ok(LI.CANONICAL_FIELDS.indexOf(f) === -1, f + ' is canonical after all');
});

t('group C is the nine approved fields, under the approved names — none reduced, renamed or deferred', () => {
  deq(AT.FIELD_GROUPS.acquisition, NINE);
});

t('27 fields, each exactly once, each with a type and its group', () => {
  eq(AT.FIELDS.length, 27);
  eq(new Set(AT.FIELDS).size, 27, 'duplicate field');
  const TYPES = ['number', 'money', 'percent', 'date', 'boolean', 'enum', 'text'];
  for (const f of AT.FIELDS) {
    const m = AT.FIELD_META[f];
    ok(m && typeof m.label === 'string' && m.label, f + ' has no label');
    ok(TYPES.indexOf(m.type) >= 0, f + ' has type ' + m.type);
    ok(AT.FIELD_GROUPS[m.group] && AT.FIELD_GROUPS[m.group].indexOf(f) >= 0, f + ' claims group ' + m.group);
    if (m.type === 'enum') ok(Array.isArray(m.values) && m.values.length >= 2, f + ' is an enum with no values');
  }
  eq(Object.keys(AT.FIELD_META).length, 27, 'FIELD_META has a field FIELDS does not');
});

t('the enum vocabularies are lease_extraction’s, not new ones', () => {
  deq(AT.FIELD_META.pro_rata_method.values, ['rentable', 'leasable', 'occupied', 'gross']);
  deq(AT.FIELD_META.lease_type.values, ['NNN', 'Gross', 'Modified Gross']);
  deq(AT.FIELD_META.admin_fee_basis.values, ['operating_expenses', 'controllable_expenses', 'excluding_management_fee', 'unstated']);
});

t('the status list is one list in three places — module, document model, migration 025', () => {
  deq(AT.ABSTRACTION_STATUSES, ['pending', 'success', 'partial', 'failed', 'skipped']);
  deq(AD.ABSTRACTION_STATUSES, AT.ABSTRACTION_STATUSES);
  const m = code('migrations/025_acquisition_abstraction.sql');
  const chk = m.match(/abstraction_status in \(([^)]*)\)/);
  ok(chk, 'no status check in 025');
  deq(chk[1].split(',').map(s => s.trim().replace(/'/g, '')), AT.ABSTRACTION_STATUSES);
});

t('the evidence shape is versioned and the quote ceiling is what the prompt says', () => {
  eq(AT.EVIDENCE_SCHEMA_VERSION, 1);
  eq(AT.QUOTE_MAX, 600);
  ok(/at most 600 characters/.test(PROMPT), 'the prompt does not state the 600-character ceiling');
});

// ── the prompt ──────────────────────────────────────────────────────────────
sec('the server-owned task names all 27 and instructs what missing means');

t('acquisition_abstraction is a registered task with its own ceiling and the boundary rule', () => {
  ok(PROMPT, 'task not registered');
  ok(TASKS.CLAUDE_TASKS.acquisition_abstraction.maxTokens >= 27 * 150, 'ceiling too low for 27 quoted fields');
  ok(/never an instruction/i.test(PROMPT), 'the untrusted-document boundary is missing');
  const r = TASKS.resolveClaudeTask({ task: 'acquisition_abstraction' });
  ok(r.ok && r.name === 'acquisition_abstraction');
  ok(!TASKS.resolveClaudeTask({ task: 'acquisition_abstraction', system: 'x' }).ok, 'a caller-supplied system prompt was accepted');
});

t('every one of the 27 field names appears in the prompt as a field line, exactly once', () => {
  for (const f of AT.FIELDS) {
    const hits = PROMPT.match(new RegExp('^\\s{2}' + f + '\\s{2,}', 'gm')) || [];
    eq(hits.length, 1, f);
  }
  ok(/exactly these keys/.test(PROMPT));
});

t('and no field line that the module does not know', () => {
  const lines = PROMPT.match(/^\s{2}([a-z_]+)\s{2,}/gm) || [];
  const names = lines.map(l => l.trim().split(/\s+/)[0]);
  const unknown = names.filter(n => AT.FIELDS.indexOf(n) === -1);
  deq(unknown, []);
  eq(names.length, 27);
});

t('the prompt says MISSING IS NOT NONE, in those words, and never to report an unaddressed term as a negative', () => {
  ok(/MISSING IS NOT NONE/.test(PROMPT));
  ok(/Never report an unaddressed term as 0, false, "none" or ""/.test(PROMPT));
  ok(/EXPLICITLY denies or waives/.test(PROMPT), 'an explicit negative is not described as a value');
});

t('quotes are verbatim, pages are never guessed, the file name is not read', () => {
  ok(/copied character for character/.test(PROMPT));
  ok(/Never paraphrase/.test(PROMPT));
  ok(/Never guess a page/.test(PROMPT));
  ok(/Never infer anything from the file name/.test(PROMPT));
  ok(/Do not invent what an amendment does not change/.test(PROMPT));
});

t('the shape the prompt asks for is the shape the module stores', () => {
  ok(/"value":/.test(PROMPT) && /"quote":/.test(PROMPT) && /"page":/.test(PROMPT) && /"confidence":/.test(PROMPT));
  ok(/"fields": \{/.test(PROMPT));
});

// ── the normalisers ─────────────────────────────────────────────────────────
sec('missing is not none — null goes in, null comes out');

t('a number field: null, undefined and empty stay null, with or without a quote', () => {
  for (const f of ['cap', 'base_rent', 'admin_fee_pct', 'leased_sqft', 'guaranty_limit']) {
    for (const v of [null, undefined, '']) {
      eq(AT.normalizeFieldValue(f, v, false), null, f + ' ' + String(v));
      eq(AT.normalizeFieldValue(f, v, true),  null, f + ' ' + String(v) + ' with quote');
    }
  }
});

t('a negative word WITHOUT a quote is a guess, and a guess is null', () => {
  for (const w of ['none', 'No', 'nil', 'zero', '0', 'N/A']) {
    eq(AT.normalizeFieldValue('cap', w, false), null, w);
  }
});

t('a negative word WITH a quote is what the document said, and that is zero', () => {
  for (const w of ['none', 'No', 'nil', 'zero', '0', 'N/A']) {
    eq(AT.normalizeFieldValue('cap', w, true), 0, w);
  }
  eq(AT.normalizeFieldValue('renewal_options', 'none', true), 'none', 'a text field keeps the word');
});

t('numbers are read as numbers: currency, percent signs, commas, parentheses', () => {
  eq(AT.normalizeFieldValue('base_rent', '$1,250,000', true), 1250000);
  eq(AT.normalizeFieldValue('cap', '5%', true), 5);
  eq(AT.normalizeFieldValue('expense_stop', '(500)', true), -500);
  eq(AT.normalizeFieldValue('leased_sqft', 2600, true), 2600);
  eq(AT.normalizeFieldValue('cap', 'five percent', true), null, 'words are not a number');
  eq(AT.normalizeFieldValue('cap', true, true), null, 'a boolean is not a number');
  eq(AT.normalizeFieldValue('cap', Infinity, true), null);
  eq(AT.normalizeFieldValue('cap', NaN, true), null);
});

t('a date is YYYY-MM-DD or nothing', () => {
  eq(AT.normalizeFieldValue('start_date', '2023-03-01'), '2023-03-01');
  eq(AT.normalizeFieldValue('end_date', '2028-02-29T00:00:00Z'), '2028-02-29');
  eq(AT.normalizeFieldValue('start_date', 'March 1, 2023'), null);
  eq(AT.normalizeFieldValue('start_date', '2023-13-45'), null);
  eq(AT.normalizeFieldValue('start_date', 20230301), null);
  eq(AT.normalizeFieldValue('start_date', null), null);
});

t('a boolean is true, false, or not stated — "none" and "waived" are not answers', () => {
  eq(AT.normalizeFieldValue('audit_rights', true), true);
  eq(AT.normalizeFieldValue('audit_rights', false), false);
  eq(AT.normalizeFieldValue('audit_rights', 'yes'), true);
  eq(AT.normalizeFieldValue('audit_rights', 'No'), false);
  eq(AT.normalizeFieldValue('audit_rights', 'none'), null);
  eq(AT.normalizeFieldValue('audit_rights', 'waived'), null);
  eq(AT.normalizeFieldValue('audit_rights', null), null);
  eq(AT.normalizeFieldValue('audit_rights', 0), null, 'a number is not a boolean');
});

t('an enum is matched without case and returned in canonical case; outside the list is null', () => {
  eq(AT.normalizeFieldValue('lease_type', 'nnn'), 'NNN');
  eq(AT.normalizeFieldValue('lease_type', 'modified gross'), 'Modified Gross');
  eq(AT.normalizeFieldValue('lease_type', 'Triple Net'), null);
  eq(AT.normalizeFieldValue('pro_rata_method', 'OCCUPIED'), 'occupied');
  eq(AT.normalizeFieldValue('admin_fee_basis', 'unstated'), 'unstated');
  eq(AT.normalizeFieldValue('admin_fee_basis', 'of CAM'), null);
  eq(AT.normalizeFieldValue('lease_type', null), null);
});

t('text is trimmed and bounded; a stated zero-length is nothing', () => {
  eq(AT.normalizeFieldValue('landlord_work', '  Landlord shall deliver in white-box condition.  '), 'Landlord shall deliver in white-box condition.');
  eq(AT.normalizeFieldValue('landlord_work', ''), null);
  eq(AT.normalizeFieldValue('landlord_work', '   '), null);
  eq(AT.normalizeFieldValue('suite', 101), '101', 'a numeric suite is still a designator');
  eq(AT.normalizeFieldValue('co_tenancy', 'x'.repeat(2000)).length, 1000);
});

t('a field the vocabulary does not have is null whatever it holds', () => {
  eq(AT.normalizeFieldValue('cam_cap', 5, true), null);
  eq(AT.normalizeFieldValue('', 5, true), null);
});

// ── one entry ───────────────────────────────────────────────────────────────
sec('one field’s evidence entry');

t('a bare value becomes an entry with no quote, no page, no confidence', () => {
  deq(AT.normalizeEntry('cap', 5), { value: 5, quote: null, page: null, confidence: null });
});

t('the quote is trimmed, bounded to 600, and empty is null', () => {
  eq(AT.normalizeEntry('cap', { value: 5, quote: '  capped at 5%  ' }).quote, 'capped at 5%');
  eq(AT.normalizeEntry('cap', { value: 5, quote: 'q'.repeat(700) }).quote.length, 600);
  eq(AT.normalizeEntry('cap', { value: 5, quote: '' }).quote, null);
  eq(AT.normalizeEntry('cap', { value: 5, quote: 7 }).quote, null);
});

t('page is a positive integer or null — never guessed from a string, never zero', () => {
  eq(AT.normalizeEntry('cap', { value: 5, page: 3 }).page, 3);
  eq(AT.normalizeEntry('cap', { value: 5, page: '12' }).page, 12);
  eq(AT.normalizeEntry('cap', { value: 5, page: 0 }).page, null);
  eq(AT.normalizeEntry('cap', { value: 5, page: -1 }).page, null);
  eq(AT.normalizeEntry('cap', { value: 5, page: 2.5 }).page, null);
  eq(AT.normalizeEntry('cap', { value: 5, page: true }).page, null);
  eq(AT.normalizeEntry('cap', { value: 5, page: null }).page, null);
  eq(AT.normalizeEntry('cap', { value: 5 }).page, null);
});

t('confidence is 0..1 or null, and a stated zero stays zero', () => {
  eq(AT.normalizeEntry('cap', { value: 5, confidence: 0.9 }).confidence, 0.9);
  eq(AT.normalizeEntry('cap', { value: 5, confidence: '0.4' }).confidence, 0.4);
  eq(AT.normalizeEntry('cap', { value: 5, confidence: 0 }).confidence, 0);
  eq(AT.normalizeEntry('cap', { value: 5, confidence: 1.2 }).confidence, null);
  eq(AT.normalizeEntry('cap', { value: 5, confidence: -0.1 }).confidence, null);
  eq(AT.normalizeEntry('cap', { value: 5, confidence: null }).confidence, null);
  eq(AT.normalizeEntry('cap', { value: 5, confidence: true }).confidence, null);
});

t('the quote decides whether a negative word is a value', () => {
  deq(AT.normalizeEntry('cap', { value: 'none', quote: 'There shall be no cap on Operating Expenses.' }),
      { value: 0, quote: 'There shall be no cap on Operating Expenses.', page: null, confidence: null });
  deq(AT.normalizeEntry('cap', { value: 'none', quote: null }),
      { value: null, quote: null, page: null, confidence: null });
});

t('a value that cannot be read keeps its quote — “unclear” is recorded, not dropped', () => {
  deq(AT.normalizeEntry('lease_type', { value: 'Triple', quote: 'a triple-net lease', confidence: 0.5 }),
      { value: null, quote: 'a triple-net lease', page: null, confidence: 0.5 });
});

t('an array or null offered as an entry is treated as no value', () => {
  deq(AT.normalizeEntry('cap', null), { value: null, quote: null, page: null, confidence: null });
  deq(AT.normalizeEntry('cap', [5]), { value: null, quote: null, page: null, confidence: null });
});

// ── the whole abstraction ───────────────────────────────────────────────────
sec('one document’s evidence, whole');

const GOOD = { fields: {
  cap: { value: '5%', quote: 'CAM charges shall not increase more than 5% per annum', page: 3, confidence: 0.92 },
  renewal_options: { value: 'Tenant shall have no option to renew', quote: 'Tenant shall have no option to renew.', confidence: 0.9 },
  audit_rights: { value: 'waived', quote: 'Tenant waives any right to audit', confidence: 0.8 },
  leased_sqft: { value: '2,600' },
  bogus_field: { value: 1, quote: 'x' },
} };

t('a reading with no fields is failed, not partial — nothing was read', () => {
  for (const r of [null, undefined, 'x', 7, [], {}, { fields: null }, { fields: [] }, { fields: 'x' }]) {
    const b = AT.buildAbstraction(r, { model: 'm', at: '2026-01-01T00:00:00Z' });
    ok(!b.ok && b.status === 'failed' && b.abstraction === null, JSON.stringify(r) + ' → ' + JSON.stringify(b));
  }
});

t('every one of the 27 fields is present, and nothing outside them', () => {
  const b = AT.buildAbstraction(GOOD, { model: 'm', at: '2026-01-01T00:00:00Z' });
  ok(b.ok);
  deq(Object.keys(b.abstraction.fields), AT.FIELDS);
  ok(!('bogus_field' in b.abstraction.fields));
});

t('the header carries the version, the model and the time', () => {
  const b = AT.buildAbstraction(GOOD, { model: 'claude-x', at: '2026-01-01T00:00:00Z' });
  eq(b.abstraction.schemaVersion, 1);
  eq(b.abstraction.model, 'claude-x');
  eq(b.abstraction.at, '2026-01-01T00:00:00Z');
  const b2 = AT.buildAbstraction(GOOD);
  eq(b2.abstraction.model, null);
  ok(/^\d{4}-\d{2}-\d{2}T/.test(b2.abstraction.at), 'no timestamp minted');
});

t('missing stays missing, an explicit negative is a value with its quote, an unread value keeps its quote', () => {
  const f = AT.buildAbstraction(GOOD, { model: 'm', at: 'x' }).abstraction.fields;
  deq(f.cap, { value: 5, quote: 'CAM charges shall not increase more than 5% per annum', page: 3, confidence: 0.92 });
  deq(f.renewal_options, { value: 'Tenant shall have no option to renew', quote: 'Tenant shall have no option to renew.', page: null, confidence: 0.9 });
  deq(f.audit_rights, { value: null, quote: 'Tenant waives any right to audit', page: null, confidence: 0.8 },
      '"waived" is not a boolean — the quote is kept for a person');
  deq(f.leased_sqft, { value: 2600, quote: null, page: null, confidence: null });
  for (const missing of ['cap_base_amount', 'guarantor_name', 'co_tenancy', 'start_date']) {
    deq(f[missing], { value: null, quote: null, page: null, confidence: null }, missing);
  }
});

t('status: success when at least one value has its quote; partial when values have no quotes; partial when all null', () => {
  eq(AT.buildAbstraction(GOOD, { model: 'm', at: 'x' }).status, 'success');
  eq(AT.buildAbstraction({ fields: { cap: { value: 5 } } }, { model: 'm', at: 'x' }).status, 'partial');
  eq(AT.buildAbstraction({ fields: {} }, { model: 'm', at: 'x' }).status, 'partial');
  eq(AT.buildAbstraction({ fields: { cap: { value: null, quote: 'some clause' } } }, { model: 'm', at: 'x' }).status, 'partial',
     'a quote with no value is not a read term');
});

t('the counts say what was found', () => {
  deq(AT.buildAbstraction(GOOD, { model: 'm', at: 'x' }).counts, { fields: 27, valued: 3, evidenced: 2, missing: 24 });
});

t('the reading it was given is not modified', () => {
  const src = JSON.parse(JSON.stringify(GOOD));
  AT.buildAbstraction(src, { model: 'm', at: 'x' });
  deq(src, GOOD);
});

t('summarizeAbstraction counts valued, evidenced, quote-only and missing, and never throws', () => {
  const a = AT.buildAbstraction(GOOD, { model: 'm', at: 'x' }).abstraction;
  deq(AT.summarizeAbstraction(a), { total: 27, valued: 3, evidenced: 2, quoteOnly: 1, missing: 23 });
  deq(AT.summarizeAbstraction(null), { total: 27, valued: 0, evidenced: 0, quoteOnly: 0, missing: 27 });
  deq(AT.summarizeAbstraction({}), { total: 27, valued: 0, evidenced: 0, quoteOnly: 0, missing: 27 });
  deq(AT.summarizeAbstraction({ fields: 'x' }), { total: 27, valued: 0, evidenced: 0, quoteOnly: 0, missing: 27 });
});

// ── which documents are read ────────────────────────────────────────────────
sec('which documents are read for terms');

t('isAbstractable is exactly the lease-family types — the same answer as the document model', () => {
  for (const type of AD.DOC_TYPE_NAMES) {
    eq(AT.isAbstractable(type), AD.isFamilyType(type), type);
  }
  eq(AT.isAbstractable(null), false);
  eq(AT.isAbstractable(undefined), false);
  eq(AT.isAbstractable('unknown'), false);
  eq(AT.isAbstractable('rent_roll'), false);
  eq(AT.isAbstractable('original_lease'), true);
  eq(AT.isAbstractable('side_letter'), true);
});

// ── the document model ──────────────────────────────────────────────────────
sec('the document model carries the evidence and refuses a claim without it');

const BASE = { fileName: 'a.pdf', intakeId: 'ik-1' };
const EV = { schemaVersion: 1, model: 'm', at: '2026-01-02T00:00:00Z', fields: { cap: { value: 5, quote: 'q', page: null, confidence: 0.9 } } };

t('the four columns are writable, camel in and snake out', () => {
  const r = AD.buildPayload('rev', 'u1', { ...BASE, abstractedFields: EV, abstractionStatus: 'success',
                                           abstractionModel: 'm', abstractedAt: '2026-01-02T00:00:00Z' });
  ok(r.ok, r.error);
  deq(r.payload.abstracted_fields, EV);
  eq(r.payload.abstraction_status, 'success');
  eq(r.payload.abstraction_model, 'm');
  eq(r.payload.abstracted_at, '2026-01-02T00:00:00Z');
});

t('the list asks for the status, the model and the time — and NOT the evidence, and still not the text', () => {
  for (const c of ['abstraction_status', 'abstraction_model', 'abstracted_at']) ok(AD.LIST_COLUMNS.indexOf(c) >= 0, c);
  ok(AD.LIST_COLUMNS.indexOf('abstracted_fields') === -1, 'the list carries 27 quoted fields per row');
  ok(AD.LIST_COLUMNS.indexOf('extracted_text') === -1, 'the list carries the text');
});

t('a status outside the list is pending; a non-object evidence is the empty object', () => {
  eq(AD.WRITABLE.abstraction_status('done'), 'pending');
  eq(AD.WRITABLE.abstraction_status(null), 'pending');
  deq(AD.WRITABLE.abstracted_fields('x'), {});
  deq(AD.WRITABLE.abstracted_fields([1]), {});
  deq(AD.WRITABLE.abstracted_fields(null), {});
  deq(AD.WRITABLE.abstracted_fields(EV), EV);
});

t('success or partial with no fields key is refused before the database sees it', () => {
  for (const st of ['success', 'partial']) {
    const r = AD.buildPayload('rev', 'u1', { ...BASE, abstractionStatus: st, abstractedFields: {}, abstractedAt: 'x' });
    ok(!r.ok && /must carry its fields/.test(r.error), st + ': ' + JSON.stringify(r));
    const r2 = AD.buildPayload('rev', 'u1', { ...BASE, abstractionStatus: st, abstractedAt: 'x' });
    ok(!r2.ok, st + ' with no evidence at all was accepted');
  }
});

t('success or partial with no timestamp is refused too', () => {
  for (const st of ['success', 'partial']) {
    const r = AD.buildPayload('rev', 'u1', { ...BASE, abstractionStatus: st, abstractedFields: EV });
    ok(!r.ok && /timestamp/.test(r.error), st + ': ' + JSON.stringify(r));
  }
});

t('failed, skipped and pending need no evidence — a failed re-read keeps what was read', () => {
  for (const st of ['failed', 'skipped', 'pending']) {
    const r = AD.buildPayload('rev', 'u1', { ...BASE, abstractionStatus: st });
    ok(r.ok, st + ': ' + r.error);
    eq(r.payload.abstracted_fields, undefined, st + ' wrote the evidence column');
  }
});

t('a missing 025 column names migration 025; a missing 024 column still names 024', () => {
  const gone = (col) => ({ code: '42703', message: 'column acquisition_documents.' + col + ' does not exist' });
  for (const c of ['abstracted_fields', 'abstraction_status', 'abstraction_model', 'abstracted_at']) {
    ok(/025_acquisition_abstraction\.sql/.test(AD.migrationForError(gone(c), 'acquisition_documents')), c);
  }
  ok(/024_acquisition_document_classification\.sql/.test(AD.migrationForError(gone('doc_type'), 'acquisition_documents')));
  ok(/024_acquisition_document_classification\.sql/.test(AD.migrationForError({ code: '42703', message: 'nope' }, 'acquisition_documents')),
     'an unnamed missing column no longer falls back to 024');
  ok(/023_acquisition_documents\.sql/.test(AD.migrationForError({ code: '42P01', message: 'relation "public.acquisition_documents" does not exist' }, 'acquisition_documents')));
});

t('the column is read from either message shape PostgreSQL uses', () => {
  eq(AD.missingColumnName({ message: 'column acquisition_documents.abstraction_status does not exist' }), 'abstraction_status');
  eq(AD.missingColumnName({ message: 'column "abstracted_at" does not exist' }), 'abstracted_at');
  eq(AD.missingColumnName({ message: 'column "Abstracted_At" does not exist' }), 'abstracted_at');
  eq(AD.missingColumnName({ message: 'relation does not exist' }), null);
  eq(AD.missingColumnName(null), null);
});

// ── the migration ───────────────────────────────────────────────────────────
sec('migration 025, as text (executed by tools/verify-migration-025.js)');

t('adds exactly the four columns, guarded, with the documented defaults', () => {
  const m = code('migrations/025_acquisition_abstraction.sql');
  ok(/add column if not exists abstracted_fields\s+jsonb\s+not null default '\{\}'::jsonb/.test(m));
  ok(/add column if not exists abstraction_status text\s+not null default 'pending'/.test(m));
  ok(/add column if not exists abstraction_model\s+text/.test(m));
  ok(/add column if not exists abstracted_at\s+timestamptz/.test(m));
  eq((m.match(/add column if not exists/g) || []).length, 4);
});

t('a claim of having read carries the evidence — the coherence check', () => {
  const m = code('migrations/025_acquisition_abstraction.sql');
  ok(/acq_docs_abstraction_coherent_check/.test(m));
  ok(/abstraction_status not in \('success', 'partial'\)\s*or \(abstracted_fields \? 'fields' and abstracted_at is not null\)/.test(m));
  ok(/jsonb_typeof\(abstracted_fields\) = 'object'/.test(m));
});

t('is Pilot-only and touches nothing but acquisition_documents', () => {
  const raw = fs.readFileSync(path.join(ROOT, 'migrations/025_acquisition_abstraction.sql'), 'utf8');
  ok(/PILOT PROJECT ONLY \(bhmktujbxdbvdmpybmad\)/.test(raw));
  ok(/NEVER apply to production/.test(raw));
  const m = code('migrations/025_acquisition_abstraction.sql');
  const tables = new Set((m.match(/(?:alter table|on|comment on column)\s+public\.(\w+)/g) || [])
    .map(s => s.replace(/[\s\S]*public\./, '')));
  deq([...tables], ['acquisition_documents']);
  ok(!/lease_documents|tenants|properties/.test(m), 'the migration reaches into an operator table');
});

t('the rollback removes exactly what 025 added', () => {
  const r = code('migrations/025_acquisition_abstraction_rollback.sql');
  for (const c of ['abstracted_fields', 'abstraction_status', 'abstraction_model', 'abstracted_at']) ok(new RegExp('drop column if exists ' + c).test(r), c);
  for (const k of ['acq_docs_abstraction_coherent_check', 'acq_docs_abstraction_status_check', 'acq_docs_abstracted_fields_is_object_check']) ok(new RegExp('drop constraint if exists ' + k).test(r), k);
  ok(/drop index if exists public\.idx_acq_docs_abstraction/.test(r));
  eq((r.match(/drop column/g) || []).length, 4);
});

// ── the data layer, as text ─────────────────────────────────────────────────
sec('the data layer (script.js) — evidence in, nothing written back');

const S = code('script.js');
const ABS = fnBody(S, '_acqAbstractDocument');

t('the abstraction asks the server-owned task and never sends a system prompt', () => {
  ok(/task: 'acquisition_abstraction'/.test(ABS));
  ok(!/system:/.test(ABS), 'a system prompt is sent from the browser');
  ok(/max_tokens: 6000/.test(ABS));
});

t('the file name is given as context and the prompt is told not to read from it', () => {
  ok(/context only, do not read terms from it/.test(ABS));
});

t('a document that is not a lease-family document is skipped, honestly', () => {
  ok(/if \(!AT\.isAbstractable\(docRow\.doc_type\)\) \{\s*return _acqSaveDocument\(\{ \.\.\.base, abstractionStatus: 'skipped' \}\);/.test(ABS));
});

t('no text and a failed call are both `failed`, and neither erases the evidence the row had', () => {
  ok(/body\.length < 40\) \{\s*return _acqSaveDocument\(\{ \.\.\.base, abstractionStatus: 'failed' \}\);/.test(ABS));
  ok(/if \(!built\.ok\) \{\s*return _acqSaveDocument\(\{ \.\.\.base, abstractionStatus: 'failed' \}\);/.test(ABS));
  const failedWrites = ABS.match(/abstractionStatus: 'failed' \}/g) || [];
  eq(failedWrites.length, 2);
  ok(!/abstractionStatus: 'failed', abstractedFields/.test(ABS) && !/abstractedFields: \{\}/.test(ABS), 'a failure writes over the evidence');
});

t('a read writes all four columns together, from buildAbstraction and nothing else', () => {
  ok(/abstractedFields:\s+built\.abstraction,\s*abstractionStatus: built\.status,\s*abstractionModel:\s+built\.abstraction\.model,\s*abstractedAt:\s+built\.abstraction\.at,/.test(ABS));
  ok(/AT\.buildAbstraction\(reading/.test(ABS));
});

t('NO WRITE-BACK: the abstraction touches no tenant, no lease record and no review data', () => {
  for (const bad of ['_acqTenants', "from('tenants')", "from('lease_documents')", 'review.data', 'normalizeTenant', 'mintTenantIdentity', 'callClaudeForLease']) {
    ok(ABS.indexOf(bad) === -1, '_acqAbstractDocument reaches ' + bad);
  }
  const LT = fnBody(S, '_acqLoadDocumentText');
  ok(/select\('id, extracted_text'\)/.test(LT) && /\.eq\('user_id', user\.id\)/.test(LT), 'the text read is not scoped to the owner');
  ok(!/upsert|update\(/.test(LT), 'the text read writes');
});

t('at intake, the document is read AFTER it is stored and AFTER it is classified', () => {
  const iSave  = S.indexOf('const saved = await _acqSaveDocument({');
  const iClass = S.indexOf('await _acqApplyClassification(review.id, saved, reading,');
  const iAbs   = S.indexOf('await _acqAbstractDocument(review.id, classified, storedText);');
  ok(iSave > 0 && iClass > iSave && iAbs > iClass, `save@${iSave} classify@${iClass} abstract@${iAbs}`);
  ok(/classified = \(await _acqApplyClassification\(/.test(S), 'the classified row is not what is abstracted');
  // Once. A second call from the unclassified row would write `skipped` on a
  // lease for the moment before its classification landed — a state that is
  // false the instant it is written.
  const intake = fnBody(S, 'acqHandleLeaseFiles');
  eq((intake.match(/_acqAbstractDocument\(/g) || []).length, 1, 'abstraction calls in the intake');
});

t('a correction INTO a lease-family type re-reads the document from its stored text; OUT of one marks it skipped', () => {
  const SET = fnBody(S, 'acqSetDocType');
  ok(/if \(isAbstractable && !wasAbstractable\) \{\s*const text = await _acqLoadDocumentText\(docId\);\s*await _acqAbstractDocument\(_activeAcqId, savedRow, text\);/.test(SET));
  ok(/else if \(!isAbstractable && row\.abstraction_status !== 'skipped'\)/.test(SET));
  ok(/abstractionStatus: 'skipped'/.test(SET));
  ok(!/abstractedFields/.test(SET), 'a correction rewrites the evidence');
});

t('the panel shows whether a document was read, only for documents that carry terms, and offers to read it', () => {
  const R = fnBody(S, '_renderAcqDocuments');
  ok(/acq-doc-terms/.test(R) && /_ACQ_ABS_STATUS\[r\.abstraction_status\]/.test(R));
  ok(/abstractable && abs/.test(R), 'the chip is shown for a rent roll');
  ok(/acq-doc-reabstract/.test(R));
  ok(/r\.abstraction_status !== 'success' && r\.abstraction_status !== 'partial'/.test(R), 'Read terms is offered for a document already read');
  const B = fnBody(S, '_acqBindDocControls');
  ok(/acqReabstractDocument\(rd\.getAttribute\('data-doc-id'\)\)/.test(B));
  ok(!/skipped:/.test(S.slice(S.indexOf('const _ACQ_ABS_STATUS'), S.indexOf('const _ACQ_ABS_STATUS') + 400)), 'skipped has a label — a rent roll would say something about terms');
});

t('index.html loads acquisition-terms.js after acquisition-documents.js and before script.js, with the chip styles', () => {
  const h = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const a = h.indexOf('<script src="acquisition-documents.js">');
  const b = h.indexOf('<script src="acquisition-terms.js">');
  const c = h.indexOf('<script src="script.js">');
  ok(a > 0 && b > a && c > b, `documents@${a} terms@${b} script@${c}`);
  ok(/\.acq-doc-terms\.ok/.test(h) && /\.acq-doc-reabstract \{/.test(h));
  ok(/\.acq-doc-type, \.acq-doc-confirm, \.acq-doc-reabstract, \.acq-doc-open \{ padding-top: 6px/.test(h), 'the phone rule skips the new control');
});

t('the security suite lists the task, and api/ is still inside its twelve', () => {
  ok(/'acquisition_abstraction'/.test(fs.readFileSync(path.join(ROOT, 'test-security.js'), 'utf8')));
  const handlers = fs.readdirSync(path.join(ROOT, 'api')).filter(f => /\.js$/.test(f) && !/^_/.test(f));
  ok(handlers.length <= 12, handlers.length + ' handlers');
});

// ── LeaseIntelligence is untouched ──────────────────────────────────────────
sec('LeaseIntelligence is unchanged by this increment');

t('reasonMultiDocumentLease still takes one argument and reasons over CANONICAL_FIELDS', () => {
  const li = code('lease-intelligence.js');
  ok(/function reasonMultiDocumentLease\(documents\) \{/.test(li), 'the signature changed — that is P4-2, not P4-1');
  ok(!/AcquisitionTerms|abstracted_fields|acquisition-terms/.test(li), 'lease-intelligence.js references the new module');
  eq(LI.reasonMultiDocumentLease.length, 1);
});

t('and its behaviour on an owner-operator family is what it was', () => {
  const docs = [
    { docType: 'original_lease', docDate: '2023-03-01', fileName: 'lease.pdf',
      extractedFields: { cap: 4, tenant_name: 'Coastal Outfitters', leased_sqft: 2600, lease_type: 'NNN' },
      quotes: { cap: 'not increase more than 4%' } },
    { docType: 'amendment', docDate: '2024-05-01', fileName: 'amd.pdf',
      extractedFields: { cap: 5 }, quotes: { cap: 'capped at 5%' } },
  ];
  const r = LI.reasonMultiDocumentLease(docs);
  eq(r.cap.currentValue, 5);
  eq(r.cap.governingDocument, 'amendment', 'the reasoner names the governing document by type — as it always has');
  eq(r.cap.supersededValues.length, 1);
  eq(r.tenant_name.currentValue, 'Coastal Outfitters');
  deq(Object.keys(r), LI.CANONICAL_FIELDS.filter(f => f in r));
  for (const f of NINE) ok(!(f in r), 'the reasoner already knows ' + f + ' — it should not until P4-2');
});

console.log('\n' + '─'.repeat(64));
console.log(`RESULT: ${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILED:'); failures.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);
