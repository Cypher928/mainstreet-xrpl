'use strict';
/**
 * Extraction-contract field preservation.
 *
 * finalEntry is the object that becomes the persisted tenant record. It used to
 * be a hand-written list of fields, so anything the normalizer produced but the
 * list omitted was silently dropped between extraction and persistence:
 * audit_rights, fieldEvidence, admin_fee_pct, gross_up_pct, expense_stop,
 * excluded_categories, pro_rata_method, renewal_options. The visible symptom was
 * the validator reporting "audit rights are not addressed" for a lease whose
 * stored text plainly granted them.
 *
 * These checks fail if the construction reverts to enumerating fields by hand,
 * or if a field in the extraction contract stops being carried through.
 */
const fs = require('fs'), path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8');

let pass = 0, fail = 0;
const ok  = m => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? ' — ' + d : '')); fail++; };

// The normalizer is the contract in practice: whatever it emits is what a
// downstream consumer may read. Derive the field list from it rather than
// hard-coding a second list that could itself drift.
const normStart = SRC.indexOf('    admin_fee_pct:       _pf(raw.admin_fee_pct),');
const normBlock = SRC.slice(normStart, SRC.indexOf('property_name:', normStart));
const CONTRACT_FIELDS = [...new Set(
  (normBlock.match(/^\s{4}([a-z_]+):/gm) || []).map(m => m.trim().replace(':', ''))
)];

// The finalEntry construction.
const feStart = SRC.indexOf('const finalEntry = {');
const feBlock = SRC.slice(feStart, SRC.indexOf('\n    };', feStart));

console.log('\n── finalEntry derives from the normalizer ──');
/\.\.\.\(\s*norm\s*\|\|\s*\{\}\s*\)/.test(feBlock)
  ? ok('finalEntry spreads the normalizer output — new contract fields carry through automatically')
  : bad('finalEntry does not spread norm', 'fields not enumerated by hand will be silently dropped');

const spreadIdx = feBlock.search(/\.\.\.\(\s*norm/);
const firstOverride = feBlock.indexOf('tenant_name:');
(spreadIdx > -1 && spreadIdx < firstOverride)
  ? ok('the spread comes first, so explicit values still override it')
  : bad('spread is not before the explicit fields', 'overrides would be clobbered');

console.log('\n── Fields that were being dropped ──');
const REGRESSED = ['audit_rights', 'fieldEvidence', 'admin_fee_pct', 'gross_up_pct',
                   'expense_stop', 'excluded_categories', 'pro_rata_method', 'renewal_options'];
// Covered either by the spread or by an explicit line.
const spreadsAll = /\.\.\.\(\s*norm\s*\|\|\s*\{\}\s*\)/.test(feBlock);
for (const f of REGRESSED) {
  const explicit = new RegExp('\\b' + f + '\\s*:').test(feBlock);
  (spreadsAll || explicit)
    ? ok(`${f} survives into the persisted tenant`)
    : bad(`${f} is dropped`, 'not spread and not listed');
}

console.log('\n── The contract itself is covered ──');
CONTRACT_FIELDS.length >= 6
  ? ok(`normalizer contract has ${CONTRACT_FIELDS.length} fields: ${CONTRACT_FIELDS.join(', ')}`)
  : bad('could not read the normalizer contract', JSON.stringify(CONTRACT_FIELDS));
const uncovered = CONTRACT_FIELDS.filter(f =>
  !spreadsAll && !new RegExp('\\b' + f + '\\s*:').test(feBlock));
uncovered.length === 0
  ? ok('every contract field reaches finalEntry')
  : bad(`${uncovered.length} contract field(s) dropped`, uncovered.join(', '));

console.log('\n── Explicit overrides still win ──');
for (const [field, why] of [
  ['tenant_name', 'resolved name beats the raw extraction'],
  ['id',          'job id identifies the row'],
  ['leaseFile',   'the File object is not part of the extraction'],
]) {
  const line = new RegExp('^\\s+' + field + ':', 'm').test(feBlock);
  line ? ok(`${field} is still set explicitly — ${why}`) : bad(`${field} override missing`);
}

console.log('\n' + (fail ? '\x1b[31m' : '\x1b[32m') + `RESULT: ${pass} passed, ${fail} failed\x1b[0m`);
process.exit(fail ? 1 : 0);
