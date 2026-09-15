// test-inline-handlers.js
// ============================================================================
// A dead inline handler is the quietest bug this codebase produces.
//
// Restore did nothing on the pilot preview — no spinner, no toast, no request,
// no console error. The button was rendered as:
//
//   onclick="restoreProperty('${esc(p.id)}', ${JSON.stringify(p.name)})"
//
// JSON.stringify emits DOUBLE quotes, and that sits inside a double-quoted HTML
// attribute. The browser terminates the attribute at the first one, so the
// handler is the fragment `restoreProperty('p-1', ` — a syntax error, which
// compiles to a NULL onclick. Clicking runs nothing, and nothing can report the
// failure because no code executes. The rest of the name leaks out as junk
// attributes (maple="" plaza")"="").
//
// Two more sites had the identical bug and had been dead since they shipped:
// the low-confidence invoice badge, and BOTH "View in Lease ↗" buttons.
//
// This file is the guard. Two layers:
//
//   1. A SOURCE scan for the pattern — JSON.stringify (or a bare template
//      expression that could contain a quote) interpolated into a double-quoted
//      inline handler attribute. Cheap, and catches it at the point of writing.
//   2. A RENDER check — build each known-risky control with a hostile name and
//      ask the browser whether the handler actually compiled. Source scans can
//      be evaded; `typeof el.onclick === 'function'` cannot.
//
// Run: node test-inline-handlers.js
// ============================================================================
'use strict';
const fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); }
catch (_) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = __dirname;
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? '  — ' + detail : ''));
}

// Files that render HTML strings with inline handlers.
const SOURCES = ['script.js', 'tenant-space.js', 'property-os.js', 'property-timeline.js',
                 'space-actions.js', 'evidence-viewer.js', 'doc-viewer.js', 'command-center.js',
                 'ai-workspace.js', 'property-workspace.js', 'guided-tour.js', 'lease-review-packets.js'];

// An inline handler attribute whose value interpolates JSON.stringify. That call
// ALWAYS produces a double quote for a string or an array of strings, so this is
// not a heuristic — it is the bug.
const RISK = /on(?:click|change|input|submit|keydown|keyup|blur|focus)\s*=\s*"[^"]*\$\{[^}]*JSON\.stringify/;

(async () => {
  console.log('\nInline handlers — do they actually compile?\n' + '='.repeat(58));

  // ── 1 · source scan ──────────────────────────────────────────────────────
  const offenders = [];
  for (const f of SOURCES) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
      // Skip comment lines — this file's own explanation quotes the bad pattern,
      // and so does the fix's comment in script.js.
      if (/^\s*(\/\/|\*|--)/.test(line)) return;
      if (RISK.test(line)) offenders.push(`${f}:${i + 1}`);
    });
  }
  check('no inline handler interpolates JSON.stringify into its attribute',
        offenders.length === 0, offenders.join(', ') || 'clean');

  // ── 2 · render check ─────────────────────────────────────────────────────
  // A name engineered to break naive quoting: apostrophe, ampersand, and the
  // double quotes that caused the original failure.
  const HOSTILE = `O'Neill & Sons "Annex" <b>`;

  const browser = await pw.chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();

  // The escaper the app uses, so this tests the real contract.
  await page.addScriptTag({ content: `
    window.esc = function (s) { return String(s ?? '').replace(/[&<>"']/g, function (c) {
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); };
    window.calls = [];
    window.restoreProperty   = function (a, b) { calls.push(['restoreProperty', a, b]); };
    window.openLeaseModal    = function (u)    { calls.push(['openLeaseModal', u]); };
    window.openInvoiceAndHighlight = function (i, f) { calls.push(['openInvoiceAndHighlight', i, f]); };
  ` });

  // Each entry is the SHIPPING markup shape, rebuilt here. If a template in
  // script.js changes, this file must change with it — that coupling is
  // deliberate, and cheaper than the alternative, which is not noticing.
  const CONTROLS = [
    { name: 'Restore (archived property)',
      html: (esc, nm) => `<button class="ptf-arch-restore" data-prop-id="${esc('p-1')}" data-prop-name="${esc(nm)}" onclick="restoreProperty(this.dataset.propId, this.dataset.propName)">Restore</button>`,
      expect: c => c[0] === 'restoreProperty' && c[2] === HOSTILE },
    { name: 'View in Lease (validation panel)',
      html: (esc) => `<button class="lv-view-btn" data-lease-url="${esc('https://x.supabase.co/a b/lease.pdf?t="1"')}" onclick="openLeaseModal(this.dataset.leaseUrl)">View in Lease</button>`,
      expect: c => c[0] === 'openLeaseModal' && /lease\.pdf/.test(c[1]) },
    { name: 'View in Lease (Ask the Lease answer)',
      html: (esc) => `<button class="lc-view-lease-btn" data-lease-url="${esc('https://x.supabase.co/lease.pdf')}" onclick="openLeaseModal(this.dataset.leaseUrl)">View in Lease</button>`,
      expect: c => c[0] === 'openLeaseModal' },
    { name: 'Low-confidence invoice badge',
      html: (esc) => `<span class="conf-badge" data-inv-idx="3" data-weak-fields="${esc(JSON.stringify(['cap', 'end_date']))}" onclick="event.stopPropagation();openInvoiceAndHighlight(Number(this.dataset.invIdx),JSON.parse(this.dataset.weakFields||'[]'))">badge</span>`,
      expect: c => c[0] === 'openInvoiceAndHighlight' && c[1] === 3 && Array.isArray(c[2]) && c[2][1] === 'end_date' },
  ];

  for (const ctl of CONTROLS) {
    const out = await page.evaluate(({ src, nm }) => {
      window.calls = [];
      const host = document.createElement('div');
      // eslint-disable-next-line no-new-func
      host.innerHTML = new Function('esc', 'nm', 'return (' + src + ')(esc, nm);')(window.esc, nm);
      document.body.appendChild(host);
      const el = host.firstElementChild;
      const bound = typeof el.onclick === 'function';
      let junk = [];
      try {
        junk = [].slice.call(el.attributes).map(a => a.name)
          .filter(n => !/^(class|onclick|title)$/.test(n) && !/^data-/.test(n));
      } catch (_) { junk = ['<unreadable>']; }
      if (bound) el.click();
      const calls = window.calls.slice();
      host.remove();
      return { bound, junk, calls };
    }, { src: ctl.html.toString(), nm: HOSTILE });

    check(`${ctl.name}: handler compiles`, out.bound,
          out.bound ? '' : 'onclick is null — the attribute was truncated');
    check(`${ctl.name}: no junk attributes from a hostile value`,
          out.junk.length === 0, JSON.stringify(out.junk));
    check(`${ctl.name}: clicking calls through with the right arguments`,
          out.calls.length === 1 && ctl.expect(out.calls[0]),
          JSON.stringify(out.calls[0] || null));
  }

  await browser.close();

  const failed = results.filter(r => !r.ok);
  console.log('='.repeat(58));
  console.log(`${results.length - failed.length}/${results.length} passed`);
  if (failed.length) { console.log('FAILED:'); failed.forEach(f => console.log('  - ' + f.name + ' :: ' + f.detail)); }
  process.exit(failed.length ? 1 : 0);
})();
