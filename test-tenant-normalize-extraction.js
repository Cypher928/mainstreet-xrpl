'use strict';
/**
 * test-tenant-normalize-extraction.js — M1a: the move changed no answers.
 *
 *   node test-tenant-normalize-extraction.js
 *
 * Read-only. No database, no network, no mutation.
 *
 * WHY A FROZEN BASELINE AND NOT JUST UNIT TESTS
 * ---------------------------------------------
 * Unit tests written after a refactor assert what the code does now, which is
 * exactly the thing in question. So before normalizeTenant moved, its answers to
 * 31 deliberately awkward inputs were captured from the ORIGINAL script.js and
 * frozen in evidence/2026-09-05-normalize-tenant-baseline.json. This suite
 * replays that corpus through the extracted module and requires the same
 * answers, field for field. A behaviour that changed cannot pass, and the
 * failure names the case.
 *
 * The corpus includes each record normalised TWICE, because normalizeTenant runs
 * on every property load: a record it produced must survive being fed back to
 * it. That round trip is where an allow-list regression shows up.
 */

const fs   = require('fs');
const path = require('path');
const TN   = require('./tenant-normalize.js');
const BASE = require('./evidence/2026-09-05-normalize-tenant-baseline.json');

let pass = 0, fail = 0;
const ok  = (m, d) => { console.log('  \x1b[32m✓\x1b[0m ' + m + (d ? '  — ' + d : '')); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '  — ' + d : '')); fail++; };
const is  = (c, m, d) => (c ? ok(m, d) : bad(m, d));
const eq  = (a, b, m) => (a === b ? ok(m, JSON.stringify(a))
                                  : bad(m, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`));
const sec = (t) => console.log('\n\x1b[1m── ' + t + ' ──\x1b[0m');

const SRC    = fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8');
const CODE   = SRC.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const TNSRC  = fs.readFileSync(path.join(__dirname, 'tenant-normalize.js'), 'utf8');
const TNCODE = TNSRC.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const HTML   = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// ── A. Every frozen answer is reproduced exactly ───────────────────────────
sec('A. The extracted module answers as script.js did before the move');
{
  eq(BASE.cases, 31, 'A1 the baseline holds 31 cases');
  is(/BEFORE extraction/.test(BASE.purpose), 'A2 and was captured BEFORE the move');

  const diffs = [];
  for (const c of BASE.results) {
    const once = TN.normalizeTenant(c.input);
    if (JSON.stringify(once) !== JSON.stringify(c.once)) { diffs.push(c.label + ' [first pass]'); continue; }
    if (c.twice !== null) {
      const twice = TN.normalizeTenant(once);
      if (JSON.stringify(twice) !== JSON.stringify(c.twice)) diffs.push(c.label + ' [round trip]');
    }
  }
  eq(diffs.length, 0, 'A3 every case matches, first pass and round trip'
     + (diffs.length ? ' — ' + diffs.join('; ') : ''));

  // A guard on the guard: if the corpus were empty or the comparison vacuous,
  // A3 would pass while proving nothing.
  is(BASE.results.length >= 31, 'A4 the corpus is non-trivial', BASE.results.length + ' cases');
  const keyCount = Object.keys(BASE.results.find(r => r.label === 'camelCase spellings').once).length;
  is(keyCount > 25, 'A5 and each result carries the full field set', keyCount + ' fields compared');
}

// ── B. The comparison can actually fail ────────────────────────────────────
sec('B. The baseline detects a changed answer');
{
  const c = BASE.results.find(r => r.label === 'minimal');
  const tampered = JSON.parse(JSON.stringify(c.once));
  tampered.tenant_name = 'Something Else';
  is(JSON.stringify(TN.normalizeTenant(c.input)) !== JSON.stringify(tampered),
     'B1 a deliberately wrong expectation does not match the module');
  is(JSON.stringify(TN.normalizeTenant(c.input)) === JSON.stringify(c.once),
     'B2 while the real frozen answer does');
}

// ── C. The module is pure, and must stay pure ──────────────────────────────
sec('C. No browser, no clock, no randomness');
{
  is(!/document\.|localStorage|sessionStorage|window\.|fetch\(|XMLHttpRequest/.test(TNCODE),
     'C1 no DOM, storage or network API appears in the module');
  is(!/crypto\.|Math\.random|Date\.now|new Date\(\)/.test(TNCODE),
     'C2 and no randomness or wall clock — the same input always gives the same answer');
  is(/\(typeof window !== 'undefined' \? window : null\)/.test(TNCODE),
     'C3 it is UMD, matching field-provenance.js and timeline-merge.js');

  // Proved by running, not only by reading.
  const desc = Object.getOwnPropertyDescriptor(global, 'document');
  let threw = false;
  Object.defineProperty(global, 'document', { configurable: true, get() { threw = true; throw new Error('DOM'); } });
  try {
    const r = TN.normalizeTenant({ tenant_name: 'Purity', leased_sqft: 100, rawText: 'term 2020-01-01 to 2030-01-01' });
    is(!threw && r.tenant_name === 'Purity', 'C4 it runs with a document that throws on contact');
  } finally {
    if (desc) Object.defineProperty(global, 'document', desc); else delete global.document;
  }

  // Determinism across repeated calls on the same input.
  const inp = { tenant_name: 'Same', leased_sqft: 42 };
  eq(JSON.stringify(TN.normalizeTenant(inp)), JSON.stringify(TN.normalizeTenant(inp)),
     'C5 two calls on one input are byte-identical');
}

// ── D. script.js delegates and keeps no second copy ────────────────────────
sec('D. One definition, not two');
{
  for (const fn of ['cleanTenantName', 'toISODate', 'extractDatesFromText', '_dateWithRaw', 'normalizeTenant']) {
    is(new RegExp('function ' + fn + '\\([^)]*\\) \\{ return _TN\\(\\)\\.' + fn + '\\(').test(CODE),
       'D1 script.js delegates ' + fn);
  }
  // The allow-list body moved out. script.js keeps ONE occurrence of these two
  // rules, and it is not a leftover copy of the normalizer: callClaudeForLease
  // normalises raw extraction output and had its own version long before M1a.
  // That duplication is PRE-EXISTING — two copies before this phase, one after —
  // and consolidating it is a separate change, not something to smuggle in here.
  is(/admin_fee_basis:\s*\(\(\) =>/.test(TNCODE), 'D2 the allow-list body is in tenant-normalize.js');
  const adminInScript = (CODE.match(/admin_fee_basis:\s*\(\(\) =>/g) || []).length;
  const partialInScript = (CODE.match(/partial_period_basis:\s*\(\(\) =>/g) || []).length;
  eq(adminInScript, 1, 'D3 script.js retains exactly one admin_fee_basis rule (callClaudeForLease)');
  eq(partialInScript, 1, 'D4 and one partial_period_basis rule, for the same reason');
  // Order-independent: find each survivor and name the function that encloses it,
  // rather than assuming which function follows which in the file.
  const enclosing = (needle) => {
    const at = CODE.indexOf(needle);
    if (at < 0) return null;
    const before = CODE.slice(0, at);
    const ms = [...before.matchAll(/(?:async )?function ([A-Za-z_$][\w$]*)\s*\(/g)];
    return ms.length ? ms[ms.length - 1][1] : null;
  };
  eq(enclosing('admin_fee_basis: (() =>'), 'callClaudeForLease',
     'D4b the surviving admin_fee_basis rule is inside callClaudeForLease');
  eq(enclosing('partial_period_basis: (() =>'), 'callClaudeForLease',
     'D4c as is the surviving partial_period_basis rule — neither is a normalizer copy');

  // The delegation is hard on purpose: a silent fallback would be a second
  // definition wearing a disguise.
  is(/function _TN\(\)/.test(CODE), 'D5 the accessor exists');
  is(/throw new Error\('tenant-normalize\.js is not loaded/.test(CODE),
     'D6 and throws when the module is absent rather than falling back');
  is(!/d\.id\s*\?\?\s*null/.test(CODE),
     'D7 no fragment of the normalizer body remains in script.js');
}

// ── E. Load order, or the browser gets a thrown error ──────────────────────
sec('E. index.html loads the module before script.js');
{
  // Match the TAG, not the filename: the comment above it names the file too, so
  // indexOf('tenant-normalize.js') would still find something after the tag had
  // been deleted — a pin that passes while the browser is broken.
  const iTN = HTML.indexOf('<script src="tenant-normalize.js"></script>');
  const iSC = HTML.indexOf('<script src="script.js"></script>');
  is(iTN > 0, 'E1 index.html has an actual <script> tag for tenant-normalize.js');
  is(iSC > 0, 'E1b and one for script.js');
  is(iSC > 0 && iTN > 0 && iTN < iSC, 'E2 and loads the module BEFORE script.js',
     'positions ' + iTN + ' < ' + iSC);
  // Every other consumer of normalizeTenant is inside script.js or loaded after
  // it, so one tag is enough — but if that stops being true this should fail.
  for (const f of ['acquisition-engine.js', 'review-engine.js']) {
    const i = HTML.indexOf('src="' + f + '"');
    is(i === -1 || i > iTN, 'E3 ' + f + ' loads after tenant-normalize.js');
  }
}

// ── F. The baseline generator still agrees with the original source ────────
// The generator can be re-run against script.js; after the move script.js no
// longer contains the bodies, so this asserts the frozen file is the record of
// a state that no longer exists — which is exactly what makes it a baseline.
sec('F. The baseline is a record of the pre-move state');
{
  is(!/function normalizeTenant\(d\) \{\s*\n/.test(SRC.replace(/\r/g, '')),
     'F1 script.js no longer defines a multi-line normalizeTenant');
  is(/function normalizeTenant\(d\) \{ return _TN\(\)/.test(SRC),
     'F2 only the one-line delegation remains');
  is(fs.existsSync(path.join(__dirname, 'evidence', '2026-09-05-normalize-tenant-baseline.json')),
     'F3 and the frozen pre-move answers are committed alongside');
}

console.log(`\n${fail ? '\x1b[31m' : '\x1b[32m'}RESULT: ${pass} passed, ${fail} failed\x1b[0m`);
process.exit(fail ? 1 : 0);
