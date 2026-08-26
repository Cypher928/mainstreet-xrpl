'use strict';

/**
 * test-escrow-extraction-verification.js — Phase 21 live-extraction verification.
 *
 * Drives the REAL Anthropic API (no mocking, no canned responses) against
 * realistic lender reserve-document text fixtures, using the exact
 * CLAUDE_ESCROW_SYSTEM prompt shipped in script.js, then runs the response
 * through the real EscrowReserveEngine.normalizeReserve(). This checks
 * extraction *accuracy*, not just that the pipeline code runs — see
 * PHASE21_VERIFICATION.md for full methodology, scope, and known gaps.
 *
 * Requires ANTHROPIC_API_KEY. Costs real API tokens. NOT part of
 * test-regression.js — run manually or from a CI job with the key set:
 *
 *   ANTHROPIC_API_KEY=sk-ant-... node test-escrow-extraction-verification.js
 */

const fs = require('fs');
const path = require('path');

eval(fs.readFileSync(path.join(__dirname, 'escrow-reserve-engine.js'), 'utf8'));
const EE = (typeof EscrowReserveEngine !== 'undefined') ? EscrowReserveEngine : module.exports;

const FIXTURES = require('./escrow-verification-fixtures.js');

// Pulls the LIVE escrow system prompt out of the file that actually sends it, so
// this verification can never silently drift from what the app does.
//
// It used to read `CLAUDE_ESCROW_SYSTEM` from script.js. SEC-2 moved that prompt
// — and the lease, invoice and category ones — into api/_claude-tasks.js, because
// a schema defined in the browser is a schema the caller can rewrite before it
// reaches Anthropic. The prompt moved; this reader did not, so the suite crashed
// on load with "Could not find CLAUDE_ESCROW_SYSTEM in script.js" and verified
// nothing from that day on.
//
// Both names are tried, and a miss names both places rather than only the old
// one: the next move should fail loudly here too, but legibly.
function loadPromptConst(names) {
  const files = ['api/_claude-tasks.js', 'script.js'];
  for (const f of files) {
    const p = path.join(__dirname, f);
    if (!fs.existsSync(p)) continue;
    const src = fs.readFileSync(p, 'utf8');
    for (const constName of names) {
      const m = src.match(new RegExp('const ' + constName + ' = (`[\\s\\S]*?`);'));
      if (m) return eval(m[1]);
    }
  }
  throw new Error(`Could not find any of [${names.join(', ')}] in ${files.join(' or ')} — ` +
                  'the escrow extraction prompt has moved again; point this reader at its new home.');
}
const CLAUDE_ESCROW_SYSTEM = loadPromptConst(['ESCROW_EXTRACTION_SYSTEM', 'CLAUDE_ESCROW_SYSTEM']);

const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

function buildUserPrompt(docText) {
  return `
You are extracting lender reserve/escrow terms from a commercial real estate financing document.
Return ONLY valid JSON. No explanation. No markdown.

DOCUMENT TEXT:
"""
${docText}
"""
`;
}

async function callClaude(docText) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1200,
      system: CLAUDE_ESCROW_SYSTEM,
      messages: [{ role: 'user', content: buildUserPrompt(docText) }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API HTTP ${res.status}: ${body.slice(0, 400)}`);
  }
  const json = await res.json();
  const text = (json.content || []).map(b => b.text || '').join('');
  const match = text.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON found in Claude response:\n' + text.slice(0, 500));
  const parsed = JSON.parse(match[0]);
  // The live system prompt now asks for an array (one element per reserve account
  // the document describes). These fixtures are single-reserve documents, so the
  // first element is the one under test.
  return Array.isArray(parsed) ? parsed[0] : parsed;
}

async function runTestSet(name, docText, checks) {
  console.log(`\n── ${name} ${'─'.repeat(Math.max(1, 60 - name.length))}`);
  let raw;
  try {
    raw = await callClaude(docText);
  } catch (err) {
    console.error(`  ❌ API call failed: ${err.message}`);
    return false;
  }

  const reserve = EE.normalizeReserve(raw, {
    extractionPath: 'text',
    ocrChars: docText.length,
    sourceFileName: name.replace(/\s+/g, '_') + '.pdf',
  });

  console.log('  Reserve type:   ', reserve.reserveTypeLabel);
  console.log('  Current balance:', reserve.currentBalance);
  console.log('  Eligible uses:  ', reserve.eligibleUses);
  console.log('  Requirements:   ', JSON.stringify(reserve.requirements));
  console.log('  Deadlines:      ', JSON.stringify(reserve.deadlines));
  console.log('  Confidence:     ', `${reserve.extractionConfidence.level} (${reserve.extractionConfidence.score})`);
  console.log('  Source pages:   ', reserve.sourcePages.join(', ') || '(none cited)');

  let pass = true;
  for (const [label, fn] of Object.entries(checks)) {
    let ok = false;
    try { ok = !!fn(reserve, raw); } catch (_) { ok = false; }
    console.log(`  ${ok ? '✅' : '❌'} ${label}`);
    if (!ok) pass = false;
  }
  return pass;
}

async function main() {
  if (!API_KEY) {
    console.log('═'.repeat(72));
    console.log('  BLOCKED — ANTHROPIC_API_KEY is not set in this environment.');
    console.log('  This script calls the live Anthropic API and cannot run without it.');
    console.log('  Run from an environment with the key configured, e.g.:');
    console.log('    ANTHROPIC_API_KEY=sk-ant-... node test-escrow-extraction-verification.js');
    console.log('═'.repeat(72));
    process.exitCode = 0; // not a pipeline failure — this suite is gated on credentials, not code
    return;
  }

  let allPass = true;

  allPass = await runTestSet('Test Set A — Clean Digital PDF', FIXTURES.cleanDigital, {
    'reserve type identified as Roof Reserve (primary reserve in doc)': r => r.reserveType === 'roof',
    'current balance extracted as $75,000': r => r.currentBalance === 75000,
    'requires invoices': r => r.requirements.requiresInvoices === true,
    'requires photos': r => r.requirements.requiresPhotos === true,
    'requires lien waivers': r => r.requirements.requiresLienWaivers === true,
    'has a verbatim source quote for reserve_type': r => !!(r.evidence.reserve_type && r.evidence.reserve_type.quote),
    'has a verbatim source quote for current_balance': r => !!(r.evidence.current_balance && r.evidence.current_balance.quote),
  }) && allPass;

  allPass = await runTestSet('Test Set C — Messy Legal Language (reserve clause on pages 17-19 of 25)', FIXTURES.messyMortgage, {
    'reserve type identified (not "other")': r => r.reserveType !== 'other',
    'current balance extracted from buried clause ($62,500)': r => r.currentBalance === 62500,
    'repair completion deadline extracted (2027-03-01)': r => r.deadlines.repairCompletionDeadline === '2027-03-01',
    'reserve expiration date extracted (2027-06-30)': r => r.deadlines.reserveExpirationDate === '2027-06-30',
    'min draw amount extracted ($2,500)': r => r.requirements.minDrawAmount === 2500,
    'source page citation points into the buried section (page > 10)': r => r.sourcePages.some(p => p > 10),
    'no hallucinated reserve content from the surrounding boilerplate pages': r =>
      !/single-purpose entity|yield maintenance/i.test(String(r.eligibleUses || '') + String(r.notes || '')),
  }) && allPass;

  console.log('\n' + '─'.repeat(72));
  console.log('NOTE: Test Set B (scanned/image-only PDF) is NOT covered by this script.');
  console.log('It requires a real scanned PDF run through the browser upload flow so');
  console.log('PDF.js text extraction actually fails and the vision fallback path');
  console.log('(callClaudeForEscrowDocumentPdfDirect) activates. See the manual');
  console.log('procedure in PHASE21_VERIFICATION.md.');
  console.log('─'.repeat(72));

  console.log(allPass ? '\n✅ Verification pack PASSED (Sets A & C)' : '\n❌ Verification pack FAILED — see ❌ lines above');
  process.exitCode = allPass ? 0 : 1;
}

main().catch(err => { console.error('FATAL:', err); process.exitCode = 1; });
