'use strict';
/**
 * test-support/approved-api-changes.js — which API and migration changes the
 * working tree is allowed to carry, exactly.
 *
 * test-bulk-intake.js §9.2 once said "no migration and no API file is changed"
 * and compared the working tree with HEAD. That stops being true the moment a
 * later, separately approved change is in progress, and simply deleting the
 * check would let an unrelated API edit through unseen. So the check now asks:
 * is every changed or new file under api/ or migrations/ one that was approved,
 * and is api/upload.js changed by nothing but its approved hunks?
 *
 *   APPROVED_NEW      new files approved by name (migrations 045 and 046 and
 *                     the ledger handlers api/upload.js serves, Financial
 *                     Intake increment one — docs/ACQUISITION_REVIEW.md §7d), 047 (the
 *                     remaining member write rules) and 048 (the operating
 *                     tables, proposed) — §7e.
 *   UPLOAD_JS_HUNKS   the approved change to api/upload.js, hunk by hunk: each
 *                     `approved` text must appear exactly once, and putting
 *                     every `original` back must give HEAD's file byte for byte.
 *                     Any other edit to api/upload.js — even inside a hunk —
 *                     fails.
 *
 * Once this work is committed, the working tree equals HEAD and nothing here is
 * consulted: the check is then the old one again. A later change to api/ or
 * migrations/ must be added here, deliberately, to pass.
 */

const L = (lines) => lines.join('\n') + '\n';

const APPROVED_NEW = [
  'api/_ledger-common.js',
  'api/_ledger-import.js',
  'api/_ledger-reverse.js',
  'migrations/045_acquisition_member_write_rules.sql',
  'migrations/045_acquisition_member_write_rules_rollback.sql',
  'migrations/046_acquisition_general_ledger.sql',
  'migrations/046_acquisition_general_ledger_rollback.sql',
  'migrations/047_member_write_rules_remaining.sql',
  'migrations/047_member_write_rules_remaining_rollback.sql',
  'migrations/048_operating_tables_member_write_rules.sql',
  'migrations/048_operating_tables_member_write_rules_rollback.sql',
];

const UPLOAD_JS_HUNKS = [
  {
    approved: L([
      "const { checkRate, sendRateLimited } = require('./_rate-limit');",
      "",
      "// The general ledger import and its reversal (migration 046) are served from",
      "// this function, not functions of their own: Vercel's Hobby plan deploys twelve",
      "// and api/ holds twelve (docs/ACQUISITION_REVIEW.md §4b, §7d). A request naming",
      "// one of these operations goes to that module untouched — its own sign-in, rate",
      "// limit, checks and replies — and never reaches the upload below. Any other",
      "// operation is refused; a request naming none is an upload, exactly as before.",
      "const LEDGER_OPS = {",
      "  'ledger-import':  require('./_ledger-import'),",
      "  'ledger-reverse': require('./_ledger-reverse'),",
      "};",
    ]),
    original: L([
      "const { checkRate, sendRateLimited } = require('./_rate-limit');",
    ]),
  },
  {
    approved: L([
      "  webp: 'image/webp',",
      "};",
      "",
      "/**",
      " * An acquisition original — written once, never replaced (see the handler).",
      " * Judged on the name as it will be STORED: the handler turns every character",
      " * outside [A-Za-z0-9._-] into '_', so 'acq/…', 'acq\\…', 'acq …' and 'acq:…'",
      " * all land on the same 'acq_…' object, and every one of them is an original.",
      " */",
      "export function isAcquisitionOriginalName(fileName) {",
      "  return /^acq_/.test(String(fileName || '').replace(/[^a-zA-Z0-9._-]/g, '_'));",
      "}",
      "",
    ]),
    original: L([
      "  webp: 'image/webp',",
      "};",
      "",
    ]),
  },
  {
    approved: L([
      "export default async function handler(req, res) {",
      "  const op = req.query && req.query.op;",
      "  if (op !== undefined) {",
      "    if (typeof op !== 'string' || !Object.prototype.hasOwnProperty.call(LEDGER_OPS, op)) {",
      "      return res.status(400).json({ error: 'Unknown operation' });",
      "    }",
      "    return LEDGER_OPS[op](req, res);",
      "  }",
      "",
    ]),
    original: L([
      "export default async function handler(req, res) {",
    ]),
  },
  {
    approved: L([
      "  const buffer   = Buffer.from(fileBase64, 'base64');",
      "  // An acquisition original (script.js _acqStoreOriginal names it acq/<review>/…)",
      "  // is evidence — a general ledger may be imported from it (migration 046). It",
      "  // is written once: never with upsert, so a second upload under the same name",
      "  // is refused instead of silently replacing the file a ledger was read from.",
      "  const isAcquisitionOriginal = isAcquisitionOriginalName(fileName);",
    ]),
    original: L([
      "  const buffer   = Buffer.from(fileBase64, 'base64');",
    ]),
  },
  {
    approved: L([
      "      'Content-Type':  fileType || 'application/octet-stream',",
      "      'x-upsert':      isAcquisitionOriginal ? 'false' : 'true',",
    ]),
    original: L([
      "      'Content-Type':  fileType || 'application/octet-stream',",
      "      'x-upsert':      'true',",
    ]),
  },
  {
    approved: L([
      "  console.log('[api/upload] response:', status, body);",
      "",
      "  if (isAcquisitionOriginal && (status === 409 || (status >= 400 && /Duplicate|already exists/i.test(String(body))))) {",
      "    return res.status(409).json({ error: 'An original with this name is already stored. Acquisition originals are never replaced; upload it again to file a new copy.' });",
      "  }",
    ]),
    original: L([
      "  console.log('[api/upload] response:', status, body);",
      "",
    ]),
  },
];

const IN_SCOPE = (f) => /^api\//.test(f) || /^migrations\//.test(f);

/**
 * { ok, why } for a working tree.
 *   changed  tracked files that differ from HEAD (git diff --name-only HEAD)
 *   added    untracked files (git ls-files --others --exclude-standard)
 *   read(f)  the working-tree text of f (throws if it is gone)
 *   head(f)  HEAD's text of f
 */
function scopeVerdict({ changed, added, read, head }) {
  const problems = [];
  for (const f of added.filter(IN_SCOPE)) if (!APPROVED_NEW.includes(f)) problems.push(f + ' is new and not approved');
  for (const f of changed.filter(IN_SCOPE)) {
    if (f !== 'api/upload.js') { problems.push(f + ' changed'); continue; }
    let text;
    try { text = read(f); } catch (_) { problems.push(f + ' is gone'); continue; }
    for (const h of UPLOAD_JS_HUNKS) {
      const at = text.indexOf(h.approved);
      if (at === -1 || text.indexOf(h.approved, at + 1) !== -1) { problems.push(f + ': an approved hunk is missing, altered or repeated (' + JSON.stringify(h.approved.slice(0, 50)) + '…)'); text = null; break; }
      text = text.slice(0, at) + h.original + text.slice(at + h.approved.length);
    }
    if (text !== null && text !== head(f)) problems.push(f + ' carries a change beyond its approved hunks');
  }
  return { ok: problems.length === 0, why: problems.join('; ') || 'only approved changes' };
}

module.exports = { APPROVED_NEW, UPLOAD_JS_HUNKS, scopeVerdict };
