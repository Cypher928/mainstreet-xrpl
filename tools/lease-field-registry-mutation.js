'use strict';
/**
 * tools/lease-field-registry-mutation.js — does the P0.4 registry contract bite?
 *
 *   node tools/lease-field-registry-mutation.js
 *
 * The registry is now the only place a lease field is declared, which makes it
 * the only place a lease field can be broken. Each mutant below is a one-token
 * edit that would change what the model is asked for, where an answer is
 * stored, or whether script.js is still reading the registry at all. Every one
 * must be caught.
 *
 * A FAILING BASELINE IS NOT A PASS.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const REG = 'lease-field-registry.js';
const SCR = 'script.js';

const MUTANTS = [
  // ── what the model is asked for ──────────────────────────────────────────
  { id: 'L01', file: REG, why: 'sqft stops being nullable in the text prompt',
    from: "types: { text: 'number or null', pdf: 'number or null', server: 'number' } },",
    to:   "types: { text: 'number', pdf: 'number or null', server: 'number' } }," },
  { id: 'L02', file: REG, why: 'cap_base_amount drops out of the text prompt',
    from: "    { key: 'cap_base_amount', label: 'Cap Base Amount', store: 'cap_base_amount',\n      types: { text: 'number or null' } },\n",
    to:   "" },
  { id: 'L03', file: REG, why: 'property_name moves ahead of the rest, reordering every prompt',
    from: "    { key: 'tenant_name', label: 'Tenant Name', store: 'tenant_name',",
    to:   "    { key: 'property_name', label: 'Property Name', store: 'property_name',\n      types: { text: 'string or null', pdf: 'string or null', server: 'string | null' } },\n\n    { key: 'tenant_name', label: 'Tenant Name', store: 'tenant_name'," },
  { id: 'L04', file: REG, why: 'the admin fee vocabulary loses a value',
    from: "'\"operating_expenses\" | \"controllable_expenses\" | \"excluding_management_fee\" | \"unstated\" | null',\n               server:",
    to:   "'\"operating_expenses\" | \"controllable_expenses\" | \"unstated\" | null',\n               server:" },
  { id: 'L05', file: REG, why: 'tenant_name becomes nullable in the text prompt too',
    from: "types: { text: 'string', pdf: 'string or null', server: 'string' } },",
    to:   "types: { text: 'string or null', pdf: 'string or null', server: 'string' } }," },
  { id: 'L06', file: REG, why: 'the pdf prompt silently gains the full field set',
    from: "      types: { text: 'number or null' } },\n\n    { key: 'admin_fee_pct'",
    to:   "      types: { text: 'number or null', pdf: 'number or null' } },\n\n    { key: 'admin_fee_pct'" },

  // ── where an answer is stored ────────────────────────────────────────────
  { id: 'L07', file: REG, why: 'sqft stores under its own name, so leased_sqft never fills',
    from: "{ key: 'sqft', label: 'Leased SqFt', store: 'leased_sqft',",
    to:   "{ key: 'sqft', label: 'Leased SqFt', store: 'sqft'," },
  { id: 'L08', file: REG, why: 'cam_cap stores under its own name instead of cap',
    from: "{ key: 'cam_cap', label: 'CAM Cap', store: 'cap',",
    to:   "{ key: 'cam_cap', label: 'CAM Cap', store: 'cam_cap'," },
  { id: 'L09', file: REG, why: 'lease_start_date stops mapping to start_date',
    from: "{ key: 'lease_start_date', label: 'Lease Start', store: 'start_date',",
    to:   "{ key: 'lease_start_date', label: 'Lease Start', store: 'lease_start_date'," },

  // ── the quote channel ────────────────────────────────────────────────────
  { id: 'L10', file: REG, why: 'a quoted field loses its clause channel in the text prompt',
    from: "'audit_rights', 'pro_rata_method', 'renewal_options', 'cam_commencement_date',",
    to:   "'audit_rights', 'pro_rata_method', 'cam_commencement_date'," },
  { id: 'L11', file: REG, why: 'the text prompt writes its quotes as a block, like the server',
    from: "text:   { inline: true,  nullType: 'string|null' },",
    to:   "text:   { inline: false, nullType: 'string|null' }," },
  { id: 'L12', file: REG, why: 'the quote null type gains spaces and stops matching the contract',
    from: "text:   { inline: true,  nullType: 'string|null' },",
    to:   "text:   { inline: true,  nullType: 'string | null' }," },
  { id: 'L13', file: REG, why: 'the pdf prompt starts asking for quotes it has no fields for',
    from: "    pdf: null,",
    to:   "    pdf: ['cam_cap']," },

  // ── the server record ────────────────────────────────────────────────────
  { id: 'L14', file: REG, why: 'the recorded server schema quietly gains a field it does not ask for',
    from: "{ key: 'cap_base_amount', label: 'Cap Base Amount', store: 'cap_base_amount',\n      types: { text: 'number or null' } },",
    to:   "{ key: 'cap_base_amount', label: 'Cap Base Amount', store: 'cap_base_amount',\n      types: { text: 'number or null', server: 'number | null' } }," },
  { id: 'L15', file: REG, why: 'suite disappears, so the recorded server schema no longer matches the file',
    from: "    { key: 'suite', label: 'Suite', store: 'suite',\n      types: { server: 'string | null' } },\n",
    to:   "" },

  // ── the registry stops being authoritative ───────────────────────────────
  { id: 'L16', file: SCR, why: 'script.js goes back to its own hand-written field list',
    from: "${LeaseFieldRegistry.promptSchema('text')}",
    to:   "{\n  \"tenant_name\": string,\n  \"sqft\": number or null,\n  \"cam_cap\": number or null\n}" },
  { id: 'L17', file: SCR, why: 'the pdf prompt stops reading the registry',
    from: "${LeaseFieldRegistry.promptSchema('pdf')}",
    to:   "{\n  \"tenant_name\": string or null,\n  \"sqft\": number or null\n}" },

  // ── guards ───────────────────────────────────────────────────────────────
  { id: 'L18', file: REG, why: 'an unknown profile renders an empty schema instead of refusing',
    from: "    if (PROFILES.indexOf(profile) === -1) throw new Error('unknown lease prompt profile: ' + profile);",
    to:   "    if (PROFILES.indexOf(profile) === -1) return '{}';" },
  { id: 'L19', file: REG, why: 'storeKey invents a mapping for a field that does not exist',
    from: "  function storeKey(key) { return BY_KEY[key] ? BY_KEY[key].store : key; }",
    to:   "  function storeKey(key) { return BY_KEY[key] ? BY_KEY[key].store : 'tenant_name'; }" },
  { id: 'L20', file: REG, why: 'a label is renamed without anyone deciding to',
    from: "label: 'Pro-Rata Method'", to: "label: 'Prorata Method'" },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lfrmut-'));
fs.cpSync(ROOT, tmp, {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(ROOT, src);
    return !(rel === '.git' || rel.startsWith('.git' + path.sep) || rel === 'node_modules' || rel.startsWith('node_modules' + path.sep));
  },
});
const ORIGINAL = {};
for (const m of MUTANTS) if (!ORIGINAL[m.file]) ORIGINAL[m.file] = fs.readFileSync(path.join(ROOT, m.file), 'utf8');

const SUITES = ['test-lease-field-registry.js', 'test-admin-fee-basis.js'];
function runSuites() {
  const failed = [];
  for (const suite of SUITES) {
    try { execFileSync(process.execPath, [suite], { cwd: tmp, stdio: 'pipe', timeout: 120000 }); }
    catch (_) { failed.push(suite); }
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
  if (failed.length) { killed++; console.log(`  \x1b[32m☠\x1b[0m  ${m.id} killed — ${m.why}`); }
  else { survived++; survivors.push(m.id); console.log(`  \x1b[31m✗\x1b[0m  ${m.id} SURVIVED — ${m.why}`); }
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('\n' + '─'.repeat(58));
console.log(`${killed} killed, ${survived} survived of ${MUTANTS.length}`);
if (survived) { survivors.forEach(s => console.log('  · ' + s)); process.exit(1); }
