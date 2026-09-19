#!/usr/bin/env node
'use strict';
/**
 * e1-raw-response-probe.js — the gate on Phase 0 finding E1.
 *
 * E1 claims that `suite`, `base_rent` and `security_deposit` are lost in the
 * client mapping at script.js `_normalizeExtraction` (they are absent from the
 * literal passed to normalizeTenant) rather than missing from the model's
 * output. The persisted tenant object CANNOT distinguish those two causes —
 * both produce the same nulls. Only the raw API response can.
 *
 * This probe replays the stored lease text through the real server-side system
 * prompt and prints the UNMODIFIED response, before any normalization.
 *
 *   ANTHROPIC_API_KEY=sk-... node tools/e1-raw-response-probe.js <lease.txt> [...]
 *
 * Optional: CLAUDE_MODEL to match production's server-configured model.
 *
 * Exit codes:
 *   0  every field was present in every response  → E1 is a mapping defect; fix the mapping.
 *   2  one or more fields absent from the raw response → E1 is a model/contract
 *      issue, NOT a mapping defect. Stop and report; do not "fix" the mapping.
 *   1  could not run (no key, no input, API error) → E1 remains unverified.
 *
 * Raw responses are written to ./e1-raw/ so the evidence outlives the run.
 */

const fs   = require('fs');
const path = require('path');

const { resolveClaudeTask, resolveClaudeMaxTokens } = require('../api/_claude-tasks');

const PROBE_FIELDS = ['suite', 'base_rent', 'security_deposit'];
const OUT_DIR = path.join(process.cwd(), 'e1-raw');

function die(msg, code) {
  console.error(`\n[E1 PROBE] ${msg}`);
  console.error('[E1 PROBE] E1 remains UNVERIFIED. Do not close it.');
  process.exit(code == null ? 1 : code);
}

async function probe(file, apiKey, model) {
  const text = fs.readFileSync(file, 'utf8');
  const label = path.basename(file);

  // Same resolution the server performs: the task name selects the system
  // prompt; a caller-supplied system prompt is refused, not ignored (SEC-2).
  const resolved = resolveClaudeTask({ task: 'lease_extraction' });
  if (!resolved || !resolved.system) die('resolveClaudeTask did not return a system prompt for lease_extraction');

  const payload = {
    model,
    max_tokens: resolveClaudeMaxTokens({ task: 'lease_extraction' }) || 4096,
    system: resolved.system,
    messages: [{ role: 'user', content: text }],
  };

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': apiKey },
    body: JSON.stringify(payload),
  });
  if (!r.ok) die(`Anthropic returned ${r.status}: ${(await r.text()).slice(0, 400)}`);

  const json = await r.json();
  const raw  = json?.content?.[0]?.text || '';

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const dump = path.join(OUT_DIR, `${label.replace(/\W+/g, '_')}.raw.json`);
  fs.writeFileSync(dump, JSON.stringify({ model: json.model, usage: json.usage, raw }, null, 2));

  // Parse exactly the way api/claude.js does, so the probe sees what the client
  // would have seen — no more forgiving, no less.
  const cleaned = raw.replace(/```json/g, '').replace(/```/g, '').trim();
  const match   = cleaned.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
  if (!match) die(`no JSON found in the response for ${label} (raw saved to ${dump})`);
  let data = JSON.parse(match[0]);
  if (Array.isArray(data) && data.length === 1) data = data[0];

  const result = { label, model: json.model, dump, fields: {} };
  for (const f of PROBE_FIELDS) {
    result.fields[f] = {
      keyPresent: Object.prototype.hasOwnProperty.call(data, f),
      value:      Object.prototype.hasOwnProperty.call(data, f) ? data[f] : undefined,
    };
  }
  return result;
}

(async () => {
  const files = process.argv.slice(2);
  if (!files.length) die('usage: node tools/e1-raw-response-probe.js <lease-text-file> [...]');
  for (const f of files) if (!fs.existsSync(f)) die(`no such file: ${f}`);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    die('ANTHROPIC_API_KEY is not set. E1 is gated on observing the raw model\n' +
        '           response and MUST NOT be closed by inference from the persisted\n' +
        '           tenant object — the persisted nulls are identical whether the\n' +
        '           model omitted the fields or the client dropped them.');
  }
  const model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
  console.log(`[E1 PROBE] model: ${model}`);
  console.log(`[E1 PROBE] probing for: ${PROBE_FIELDS.join(', ')}\n`);

  const results = [];
  for (const f of files) {
    process.stdout.write(`  ${path.basename(f)} … `);
    results.push(await probe(f, apiKey, model));
    console.log('done');
  }

  console.log('\n── RAW RESPONSE FIELD PRESENCE ──');
  let allPresent = true;
  for (const r of results) {
    console.log(`\n  ${r.label}   (${r.model})`);
    console.log(`    raw saved: ${r.dump}`);
    for (const f of PROBE_FIELDS) {
      const { keyPresent, value } = r.fields[f];
      if (!keyPresent) allPresent = false;
      const shown = keyPresent ? JSON.stringify(value) : '— KEY ABSENT —';
      console.log(`    ${keyPresent ? 'present' : 'ABSENT '}  ${f.padEnd(18)} ${shown}`);
    }
  }

  console.log('\n── VERDICT ──');
  if (allPresent) {
    console.log('  Every probed field is present in every raw response.');
    console.log('  => E1 is a MAPPING defect. Fix script.js _normalizeExtraction.');
    process.exit(0);
  }
  console.log('  At least one probed field is ABSENT from the raw model response.');
  console.log('  => E1 is NOT a pure mapping defect. It is a model/contract issue.');
  console.log('  => STOP. Report separately. Fixing the mapping alone would not');
  console.log('     populate the field, and shipping it would look like a fix.');
  process.exit(2);
})().catch(e => die(`probe threw: ${e && e.message}`));
