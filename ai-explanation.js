/**
 * ai-explanation.js — scannable, cited AI explanations.
 * ============================================================================
 * The AI review of a charge used to render as a wall of markdown. This parses
 * the structured output (STATUS / WHY / SUGGESTION / EVIDENCE) into something a
 * property manager scans in seconds, and turns EVIDENCE into citation chips that
 * link to the supporting record — the lease clause, invoice, work order, or
 * document behind the conclusion.
 *
 * HONESTY RULE (matches the Evidence Viewer's tiers): a citation chip only
 * becomes a link when the underlying record is actually on file. When it isn't,
 * the chip renders as a neutral PLACEHOLDER that says what to attach — never a
 * dead link, and never an implication that a document exists when it doesn't.
 *
 * Degrades safely: if the model returns free-form prose instead of the labelled
 * format, the original text is shown unchanged.
 *
 * Reuses: esc(), renderMarkdown() (fallback path). No new backend.
 *
 * Exposes: window.AIExplanation
 */
window.AIExplanation = (function () {
  'use strict';

  var _esc = (window.esc) || function (v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  };

  // Evidence kinds the prompt is allowed to name → icon + where it lives.
  var EVIDENCE_KINDS = {
    'lease clause':    { icon: '\u{1F4C4}', label: 'Lease clause',    hint: 'Attach the governing lease section' },
    'invoice':         { icon: '\u{1F9FE}', label: 'Invoice',         hint: 'Attach the vendor invoice' },
    'work order':      { icon: '\u{1F527}', label: 'Work order',      hint: 'Attach the work order' },
    'vendor contract': { icon: '\u{1F4CB}', label: 'Vendor contract', hint: 'Attach the vendor contract' },
    'photo':           { icon: '\u{1F5BC}\u{FE0F}', label: 'Photo',   hint: 'Attach a photo of the work' },
    'service record':  { icon: '\u{1F6E0}\u{FE0F}', label: 'Service record', hint: 'Attach the service record' },
  };

  var STATUS_CLASS = {
    'no issues':              'aix-ok',
    'might get questions':    'aix-warn',
    'likely to be challenged':'aix-risk',
  };

  /**
   * Parse the labelled output. Returns null when the text isn't in the expected
   * shape, so callers can fall back to the raw rendering.
   */
  function parse(text) {
    if (!text || typeof text !== 'string') return null;
    var clean = text.replace(/\*\*/g, '').replace(/^#+\s*/gm, '');
    var grab = function (label) {
      var re = new RegExp(label + '\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*(?:STATUS|WHY|SUGGESTION|EVIDENCE)\\s*:|$)', 'i');
      var m = clean.match(re);
      return m ? m[1].trim().replace(/\s+/g, ' ') : null;
    };
    var status = grab('STATUS'), why = grab('WHY'), sugg = grab('SUGGESTION'), ev = grab('EVIDENCE');
    if (!status && !why) return null;   // not our format — caller falls back
    var evidence = [];
    if (ev && !/^none\b/i.test(ev)) {
      ev.split(/[,;]/).forEach(function (raw) {
        var k = String(raw).trim().toLowerCase().replace(/\.$/, '');
        if (!k) return;
        // tolerate plurals / minor wording drift
        var key = Object.keys(EVIDENCE_KINDS).find(function (kk) { return k === kk || k === kk + 's' || k.indexOf(kk) >= 0; });
        if (key && evidence.indexOf(key) < 0) evidence.push(key);
      });
    }
    return { status: status || null, why: why || null, suggestion: sugg || null, evidence: evidence };
  }

  /**
   * Render the parsed explanation.
   * @param {string} text  raw model output
   * @param {object} opts  { sources: { 'lease clause': {url|onFile, label}, ... } }
   *        A source marked onFile (or carrying a url) renders as a live citation;
   *        anything else renders as an honest "attach this" placeholder.
   */
  function render(text, opts) {
    opts = opts || {};
    var p = parse(text);
    if (!p) {
      // Unknown shape — show it as-is rather than mangling it.
      var md = (window.renderMarkdown) ? window.renderMarkdown(text) : '<p>' + _esc(text) + '</p>';
      return '<div class="aix aix--raw">' + md + '</div>';
    }
    injectStyles();
    var sources = opts.sources || {};

    var statusKey = String(p.status || '').toLowerCase().trim();
    var cls = STATUS_CLASS[statusKey] || 'aix-warn';
    for (var k in STATUS_CLASS) { if (statusKey.indexOf(k) >= 0) { cls = STATUS_CLASS[k]; break; } }

    var html = '<div class="aix">';
    html += '<div class="aix-status ' + cls + '">' + _esc(p.status || 'Reviewed') + '</div>';
    if (p.why) html += '<div class="aix-row"><span class="aix-k">Why</span><span class="aix-v">' + _esc(p.why) + '</span></div>';
    if (p.suggestion) html += '<div class="aix-row"><span class="aix-k">Suggestion</span><span class="aix-v">' + _esc(p.suggestion) + '</span></div>';

    if (p.evidence.length) {
      html += '<div class="aix-ev"><div class="aix-ev-lbl">Supporting evidence</div><div class="aix-ev-chips">';
      p.evidence.forEach(function (key) {
        var def = EVIDENCE_KINDS[key];
        var src = sources[key] || null;
        var onFile = !!(src && (src.url || src.onFile));
        if (onFile && src.url) {
          // SEC-1 — this rendered a raw <a href> to inv.fileUrl. Once uploads
          // began returning a relative storage reference, the browser resolved
          // it against the page origin and navigated to a Vercel 404. Every
          // document link goes through docLinkHtml now.
          html += (window.docLinkHtml
            ? window.docLinkHtml(src.url, def.icon + '&nbsp;' + _esc(src.label || def.label),
                                 { className: 'aix-chip aix-chip--live' })
            : '<span class="aix-chip aix-chip--live">' + def.icon + '&nbsp;' + _esc(src.label || def.label) + '</span>');
        } else if (onFile) {
          html += '<span class="aix-chip aix-chip--live">' + def.icon + '&nbsp;' + _esc(src.label || def.label) + '</span>';
        } else {
          html += '<span class="aix-chip aix-chip--todo" title="' + _esc(def.hint) + '">' +
            def.icon + '&nbsp;' + _esc(def.label) + '<span class="aix-chip-tag">not on file</span></span>';
        }
      });
      html += '</div><div class="aix-ev-note">Attach these to the record so this conclusion can be defended.</div></div>';
    }
    html += '</div>';
    return html;
  }

  function injectStyles() {
    if (document.getElementById('aix-styles')) return;
    var gold = '#C9973A';
    var css = [
      '.aix{font-size:0.82rem;line-height:1.5;}',
      '.aix--raw{color:var(--text-2,#CBD5E1);}',
      '.aix-status{display:inline-block;font-size:0.68rem;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;border-radius:6px;padding:4px 9px;margin-bottom:9px;}',
      '.aix-ok{color:#4ade80;background:rgba(74,222,128,0.12);border:1px solid rgba(74,222,128,0.35);}',
      '.aix-warn{color:#fbbf24;background:rgba(251,191,36,0.12);border:1px solid rgba(251,191,36,0.35);}',
      '.aix-risk{color:#f87171;background:rgba(248,113,113,0.12);border:1px solid rgba(248,113,113,0.35);}',
      '.aix-row{display:flex;gap:10px;padding:5px 0;align-items:baseline;}',
      '.aix-k{flex:none;width:78px;font-size:0.68rem;font-weight:800;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-4,#64748B);}',
      '.aix-v{flex:1;color:var(--text-2,#CBD5E1);min-width:0;}',
      '.aix-ev{margin-top:11px;padding-top:10px;border-top:1px solid rgba(var(--line-rgb,255,255,255),0.08);}',
      '.aix-ev-lbl{font-size:0.68rem;font-weight:800;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-4,#64748B);margin-bottom:7px;}',
      '.aix-ev-chips{display:flex;flex-wrap:wrap;gap:7px;}',
      '.aix-chip{display:inline-flex;align-items:center;gap:5px;font-size:0.74rem;font-weight:600;border-radius:7px;padding:6px 9px;text-decoration:none;white-space:nowrap;}',
      '.aix-chip--live{color:var(--text-1,#E2E8F0);background:var(--theme-panel,#0A0D12);border:1px solid ' + gold + ';}',
      '.aix-chip--live:hover{filter:brightness(1.15);}',
      '.aix-chip--todo{color:var(--text-4,#64748B);background:transparent;border:1px dashed rgba(var(--line-rgb,255,255,255),0.24);}',
      '.aix-chip-tag{font-size:0.6rem;font-weight:700;text-transform:uppercase;letter-spacing:0.03em;opacity:0.75;margin-left:3px;}',
      '.aix-ev-note{font-size:0.7rem;color:var(--text-4,#64748B);margin-top:7px;font-style:italic;}',
      '@media (max-width:480px){',
      '  .aix-row{flex-direction:column;gap:2px;padding:6px 0;}',
      '  .aix-k{width:auto;}',
      '  .aix-chip{white-space:normal;}',
      '}',
    ].join('\n');
    var s = document.createElement('style'); s.id = 'aix-styles'; s.textContent = css;
    document.head.appendChild(s);
  }

  return { parse: parse, render: render, EVIDENCE_KINDS: EVIDENCE_KINDS, injectStyles: injectStyles };
})();
