'use strict';
/**
 * test-support/fn-source.js — extract a whole top-level function from a source
 * file, by NAME, brace-matched.
 *
 * WHY THIS EXISTS
 *
 * Several suites assert things about a function's body by reading script.js as
 * text. Each grew its own extractor, and each was brittle in the same two ways:
 *
 *   1. They pinned the SIGNATURE — `function generateTenantStatement(tenantName) {`
 *      — so adding an optional parameter stopped the suite dead. That is what
 *      happened: it crashed on load with "not found in script.js", and because
 *      it was not registered, it stayed dead and six real assertions about the
 *      tenant statement's staleness guards went unevaluated.
 *
 *   2. They bounded the search by CHARACTER DISTANCE — `[\s\S]{0,320}?` — so a
 *      comment added inside the function pushed the line being asserted out of
 *      the window, and the suite reported the product as having lost a guard it
 *      still has. test-property-confirmation.js failed exactly this way.
 *
 * A test should fail when the BEHAVIOUR it names changes, not when a signature
 * gains an argument or a comment gains a line. So: match the name, skip the
 * parameter list (a default value spells a brace — `f(a, opts = {})` — and the
 * naive `indexOf('{')` opens and closes on it, yielding an EMPTY body, which is
 * worse than no match because every assertion then fails blaming the product),
 * and count braces to the real end, ignoring braces inside strings and comments.
 */

function fnSource(src, name) {
  const decl = new RegExp(`(?:^|\\n)(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const m = src.match(decl);
  if (!m) throw new Error(`${name} not found in source`);
  const start = m.index + (src[m.index] === '\n' ? 1 : 0);

  // Walk the parameter list to its closing paren before looking for the body.
  let pd = 0, open = -1;
  for (let j = src.indexOf('(', m.index + m[0].length - 1); j < src.length; j++) {
    if (src[j] === '(') pd++;
    else if (src[j] === ')') { pd--; if (pd === 0) { open = src.indexOf('{', j); break; } }
  }
  if (open < 0) throw new Error(`${name} has no body`);

  let depth = 0, instr = null, esc = false;
  for (let j = open; j < src.length; j++) {
    const c = src[j];
    if (instr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === instr) instr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { instr = c; continue; }
    if (c === '/' && src[j + 1] === '/') { j = src.indexOf('\n', j); if (j < 0) break; continue; }
    if (c === '/' && src[j + 1] === '*') { j = src.indexOf('*/', j) + 1; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error(`${name} body did not close`);
}

module.exports = { fnSource };
