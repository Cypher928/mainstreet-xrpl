/**
 * evidence-viewer.js — Phase 24: Interactive Evidence Viewer
 *
 * Makes every AI citation inspectable: click a citation and MainStreet opens
 * the original document, jumps to the cited page, and highlights the quoted
 * language — with the extracted evidence beside it.
 *
 * Three tiers, degrading honestly (never fabricating a highlight):
 *   Tier 1 — Evidence Panel: quote + page + confidence + reason. Always works,
 *            even when the original file was never uploaded.
 *   Tier 2 — Document render: when a fileUrl exists, fetch the PDF (same path
 *            the Reprocess action already uses) and render the cited page via
 *            the PDF.js build the app already loads for extraction.
 *   Tier 3 — Highlight: locate the verbatim quote in the page's text layer and
 *            overlay highlight boxes. If the quote can't be located confidently,
 *            the viewer jumps to the page and SAYS the paragraph couldn't be
 *            auto-identified — per the product's honesty rules.
 *
 * Reuses: the existing citation shape ({source, detail, page, quote, fileUrl}),
 * the existing evidence model (fieldEvidence / reserve.evidence), the existing
 * PDF.js dependency. No duplicate extraction, no new search index — search mode
 * scans the already-fetched document's text layer on demand.
 *
 * Pure core (Node-testable): _normalizeForMatch, locateQuoteInItems,
 * searchPageTexts, fromReserve, fromTenantField.
 *
 * Exposes: window.EvidenceViewer
 */
window.EvidenceViewer = (() => {
  'use strict';

  const _esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ── pure core ──────────────────────────────────────────────────────────────

  // Normalization tolerant of what PDF text layers do to prose: curly quotes,
  // dash variants, hyphen line-breaks, and arbitrary whitespace runs.
  function _normalizeForMatch(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[‘’“”'"`]/g, '')
      .replace(/[-‐-―]/g, ' ')
      .replace(/[^a-z0-9\s%$.,]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Locates a quote inside a page's text items (PDF.js getTextContent().items).
   * Returns { itemIndexes:[...], exact:boolean } or null when the quote cannot
   * be located confidently (caller must fall back honestly, not guess).
   */
  function locateQuoteInItems(items, quote) {
    const safe = (items || []).map(it => _normalizeForMatch(it && it.str));
    if (!safe.length) return null;

    // Build one haystack with a char→item index map.
    let hay = '';
    const owner = [];
    safe.forEach((s, i) => {
      if (!s) return;
      if (hay) { hay += ' '; owner.push(-1); }
      for (let k = 0; k < s.length; k++) owner.push(i);
      hay += s;
    });

    let needle = _normalizeForMatch(quote);
    if (needle.length < 8) return null;               // too short to trust
    let at = hay.indexOf(needle);
    let exact = true;
    if (at === -1 && needle.length > 40) {            // tolerate a clipped tail
      needle = needle.slice(0, 40);
      at = hay.indexOf(needle);
      exact = false;
    }
    if (at === -1) return null;

    const itemIndexes = [];
    for (let k = at; k < at + needle.length; k++) {
      const idx = owner[k];
      if (idx >= 0 && itemIndexes[itemIndexes.length - 1] !== idx) itemIndexes.push(idx);
    }
    return itemIndexes.length ? { itemIndexes, exact } : null;
  }

  /** Search a set of page texts for a term. Returns synthetic citations. */
  function searchPageTexts(pageTexts, term) {
    const t = _normalizeForMatch(term);
    if (t.length < 3) return [];
    const out = [];
    (pageTexts || []).forEach(({ page, text }) => {
      const norm = _normalizeForMatch(text);
      let from = 0, at;
      while ((at = norm.indexOf(t, from)) !== -1 && out.length < 50) {
        const start = Math.max(0, at - 60);
        out.push({
          page,
          quote: norm.slice(start, at + t.length + 60).trim(),
          source: 'Document search', detail: `Page ${page}`, _search: term,
        });
        from = at + t.length;
      }
    });
    return out;
  }

  // ── adapters over the EXISTING evidence model (no duplication) ─────────────

  function fromReserve(reserve) {
    const r = reserve || {};
    const labels = { reserve_type: 'Reserve Type', current_balance: 'Current Balance', eligible_uses: 'Eligible Uses' };
    return Object.entries(r.evidence || {})
      .filter(([, ev]) => ev && (ev.quote || ev.page != null))
      .map(([field, ev]) => ({
        source: `Mortgage — ${r.sourceFileName || 'reserve document'}`,
        detail: ev.page != null ? `Page ${ev.page}` : null,
        page: ev.page ?? null,
        quote: ev.quote || null,
        fileUrl: r.sourceFileUrl || null,
        fileName: r.sourceFileName || null,
        reason: `${labels[field] || field} — governs what this reserve holds and allows.`,
        confidence: r.extractionConfidence ? r.extractionConfidence.score : null,
      }));
  }

  function fromTenantField(p, t, fieldKeys, reason) {
    for (const k of (fieldKeys || [])) {
      const snaps = t && t.fieldEvidence && t.fieldEvidence[k] && t.fieldEvidence[k].snapshots;
      const last = Array.isArray(snaps) && snaps.length ? snaps[snaps.length - 1] : null;
      if (last && (last.quote || last.page != null)) {
        return {
          source: `Lease — ${t.tenant_name}`,
          detail: last.page != null ? `Page ${last.page}` : (p ? p.name : null),
          page: last.page ?? null,
          quote: last.quote || null,
          fileUrl: t.leaseUrl || t.lease_url || null,
          fileName: t.leaseFileName || null,
          reason: reason || null,
          confidence: t._confidenceScore ?? null,
        };
      }
    }
    return null;
  }

  // ── viewer state + DOM ─────────────────────────────────────────────────────

  const st = { citations: [], index: 0, fileUrl: null, pdf: null, pageTexts: null, searchStack: null };

  function _el(id) { return document.getElementById(id); }

  function open({ citations, index } = {}) {
    st.citations = (citations || []).filter(c => c && (c.quote || c.page != null || c.fileUrl));
    if (!st.citations.length) return;
    st.index = Math.min(Math.max(index || 0, 0), st.citations.length - 1);
    st.pdf = null; st.fileUrl = null; st.pageTexts = null; st.searchStack = null;
    const modal = _el('evidenceViewer');
    if (!modal) return;
    modal.style.display = 'flex';
    // A11y (Phase 26): move focus into the dialog.
    setTimeout(() => { const box = modal.querySelector('.evd-box'); if (box) box.focus(); }, 30);
    _renderCurrent();
  }

  function close() {
    const modal = _el('evidenceViewer');
    if (modal) modal.style.display = 'none';
    st.pdf = null; st.pageTexts = null;
  }

  function next() { if (st.index < st.citations.length - 1) { st.index++; _renderCurrent(); } }
  function prev() { if (st.index > 0) { st.index--; _renderCurrent(); } }
  function jump(i) { if (i >= 0 && i < st.citations.length) { st.index = i; _renderCurrent(); } }

  function copyCitation() {
    const c = st.citations[st.index]; if (!c) return;
    const txt = `${c.source || 'Document'}${c.detail ? ' · ' + c.detail : ''}${c.quote ? ` — "${c.quote}"` : ''}`;
    try { navigator.clipboard.writeText(txt); } catch (_) {}
    const b = _el('evdCopyBtn'); if (b) { b.textContent = 'Copied ✓'; setTimeout(() => { b.textContent = 'Copy Citation'; }, 1400); }
  }

  function explainClause() {
    const c = st.citations[st.index]; if (!c) return;
    close();
    try {
      if (typeof openAIWorkspace === 'function') {
        openAIWorkspace();
        const input = _el('aiwInput');
        if (input) { input.value = `Explain this clause: "${(c.quote || c.source || '').slice(0, 140)}"`; input.focus(); }
      }
    } catch (_) {}
  }

  function _sidePanelHtml(c, tierNote) {
    const rows = [
      ['Document', c.source || '—'],
      ['Citation', c.detail || (c.page != null ? `Page ${c.page}` : '—')],
      ['Page', c.page != null ? String(c.page) : '—'],
      c.confidence != null ? ['Confidence', `${c.confidence}%`] : null,
    ].filter(Boolean).map(([k, v]) => `<div class="evd-row"><span>${_esc(k)}</span><b>${_esc(v)}</b></div>`).join('');
    return `
      ${rows}
      ${c.quote ? `<div class="evd-lbl">Extracted text</div><blockquote class="evd-quote">“${_esc(c.quote)}”</blockquote>` : ''}
      ${c.reason ? `<div class="evd-lbl">Why it matters</div><div class="evd-reason">${_esc(c.reason)}</div>` : ''}
      ${tierNote ? `<div class="evd-note">${_esc(tierNote)}</div>` : ''}
      <div class="evd-actions">
        <button class="aiw-action" onclick="EvidenceViewer.explainClause()">Explain This Clause</button>
        <button class="cc-nav-link" id="evdCopyBtn" onclick="EvidenceViewer.copyCitation()">Copy Citation</button>
      </div>
      <div class="evd-nav">
        <button class="cc-nav-link" onclick="EvidenceViewer.prev()" ${st.index === 0 ? 'disabled' : ''}>← Previous</button>
        <span>${st.index + 1} of ${st.citations.length}</span>
        <button class="cc-nav-link" onclick="EvidenceViewer.next()" ${st.index === st.citations.length - 1 ? 'disabled' : ''}>Next →</button>
      </div>
      ${st.citations.length > 1 ? `<div class="evd-jump">${st.citations.map((x, i) =>
        `<button class="evd-jump-chip ${i === st.index ? 'evd-jump-chip--on' : ''}" onclick="EvidenceViewer.jump(${i})">${x.page != null ? 'p.' + _esc(x.page) : (i + 1)}</button>`).join('')}</div>` : ''}`;
  }

  async function _ensurePdf(fileUrl) {
    if (st.pdf && st.fileUrl === fileUrl) return st.pdf;
    const lib = window.pdfjsLib;
    if (!lib) throw new Error('PDF renderer unavailable');
    const res = await fetch(fileUrl);
    if (!res.ok) throw new Error('Could not fetch the document');
    const buf = await res.arrayBuffer();
    st.pdf = await lib.getDocument({ data: buf }).promise;
    st.fileUrl = fileUrl;
    st.pageTexts = null;
    return st.pdf;
  }

  async function _renderCurrent() {
    const c = st.citations[st.index];
    const side = _el('evdSide'), docWrap = _el('evdDoc'), title = _el('evdTitle'), banner = _el('evdBanner');
    if (!c || !side || !docWrap) return;
    if (title) title.textContent = `${c.source || 'Evidence'}${c.fileName ? ' · ' + c.fileName : ''}`;
    if (banner) { banner.style.display = 'none'; banner.textContent = ''; }

    // Tier 1 — always render the evidence panel first.
    if (!c.fileUrl) {
      side.innerHTML = _sidePanelHtml(c, 'The original document is not on file for this citation — the extracted text above is the evidence of record. Upload the source document to view it here.');
      docWrap.innerHTML = `<div class="evd-empty">No source file uploaded for this citation.<br>The verbatim extracted text is shown in the panel →</div>`;
      return;
    }
    side.innerHTML = _sidePanelHtml(c, null);
    docWrap.innerHTML = `<div class="evd-empty">Loading ${_esc(c.fileName || 'document')}…</div>`;

    // Tier 2 — fetch + render the cited page.
    let pdf;
    try { pdf = await _ensurePdf(c.fileUrl); }
    catch (e) {
      docWrap.innerHTML = `<div class="evd-empty">Couldn't open the document here (${_esc(e.message)}). <a href="${_esc(c.fileUrl)}" target="_blank" rel="noopener">Open the original in a new tab ↗</a></div>`;
      return;
    }
    if (st.citations[st.index] !== c) return; // user navigated away meanwhile
    const pageNum = Math.min(Math.max(c.page || 1, 1), pdf.numPages);
    const page = await pdf.getPage(pageNum);
    const scale = Math.min(1.5, (docWrap.clientWidth - 24) / page.getViewport({ scale: 1 }).width) || 1.2;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width; canvas.height = viewport.height;
    const hlLayer = document.createElement('div');
    hlLayer.className = 'evd-hl-layer';
    hlLayer.style.width = viewport.width + 'px'; hlLayer.style.height = viewport.height + 'px';
    docWrap.innerHTML = `<div class="evd-page-lbl">Page ${pageNum} of ${pdf.numPages}</div>`;
    const stage = document.createElement('div'); stage.className = 'evd-stage';
    stage.appendChild(canvas); stage.appendChild(hlLayer);
    docWrap.appendChild(stage);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

    // Tier 3 — locate & highlight; honest banner when we can't.
    // Search-mode citations locate the search TERM (their "quote" is a
    // normalized context slice that won't match verbatim), and stay quiet on a
    // miss — the match-count banner is already showing.
    const needle = c._search || c.quote;
    if (!needle) return;
    const tc = await page.getTextContent();
    const hit = locateQuoteInItems(tc.items, needle);
    if (!hit) {
      if (banner && !c._search) {
        banner.textContent = `Jumped to page ${pageNum} — the exact paragraph couldn't be automatically identified. The verbatim extracted text is shown in the panel.`;
        banner.style.display = 'block';
      }
      return;
    }
    const lib = window.pdfjsLib;
    let firstTop = null;
    hit.itemIndexes.forEach(i => {
      const it = tc.items[i];
      if (!it || !it.transform) return;
      const tx = lib.Util.transform(viewport.transform, it.transform);
      const h = Math.hypot(tx[2], tx[3]) || (it.height * scale) || 12;
      const div = document.createElement('div');
      div.className = 'evd-hl';
      div.style.left = tx[4] + 'px';
      div.style.top = (tx[5] - h) + 'px';
      div.style.width = ((it.width || 40) * scale) + 'px';
      div.style.height = (h * 1.15) + 'px';
      hlLayer.appendChild(div);
      if (firstTop == null) firstTop = tx[5] - h;
    });
    if (!hit.exact && banner) {
      banner.textContent = 'Highlighted the start of the cited passage — the full quote spans formatting the text layer splits differently.';
      banner.style.display = 'block';
    }
    if (firstTop != null) docWrap.scrollTop = Math.max(0, firstTop - 120);
  }

  // ── in-document search (intelligent PDF search over the loaded file) ──────
  async function find() {
    const input = _el('evdFindInput');
    const term = input ? input.value.trim() : '';
    const c = st.citations[st.index];
    if (!term || !c || !c.fileUrl) return;
    let pdf;
    try { pdf = await _ensurePdf(c.fileUrl); }
    catch (e) {
      const banner = _el('evdBanner');
      if (banner) { banner.textContent = `Couldn't search this document (${e.message}).`; banner.style.display = 'block'; }
      return;
    }
    if (!st.pageTexts) {
      st.pageTexts = [];
      const maxPages = Math.min(pdf.numPages, 60);
      for (let n = 1; n <= maxPages; n++) {
        const tc = await (await pdf.getPage(n)).getTextContent();
        st.pageTexts.push({ page: n, text: tc.items.map(i => i.str).join(' ') });
      }
    }
    const matches = searchPageTexts(st.pageTexts, term).map(m => ({
      ...m, fileUrl: c.fileUrl, fileName: c.fileName,
      source: `Search — "${term}"`, reason: null, confidence: null,
    }));
    if (!matches.length) {
      const banner = _el('evdBanner');
      if (banner) { banner.textContent = `No matches for "${term}" in this document.`; banner.style.display = 'block'; }
      return;
    }
    st.searchStack = { citations: st.citations, index: st.index };
    st.citations = matches; st.index = 0;
    _renderCurrent();
    // UX (Phase 27): say how many matches — "3 matches" beats silent navigation.
    const banner = _el('evdBanner');
    if (banner) {
      banner.textContent = `${matches.length} match${matches.length !== 1 ? 'es' : ''} for "${term}" — use Next/Previous or the page chips to move between them.`;
      banner.style.display = 'block';
    }
    const back = _el('evdBackBtn'); if (back) back.style.display = 'inline-block';
  }

  function backToCitations() {
    if (!st.searchStack) return;
    st.citations = st.searchStack.citations; st.index = st.searchStack.index; st.searchStack = null;
    const back = _el('evdBackBtn'); if (back) back.style.display = 'none';
    _renderCurrent();
  }

  // Opens from an AI Workspace / Drafting citation chip: the answer element
  // carries the full citation list as JSON; the chip carries its index.
  function openFromChip(chipEl) {
    try {
      const holder = chipEl.closest('[data-evd]');
      if (!holder) return;
      const citations = JSON.parse(holder.dataset.evd);
      open({ citations, index: Number(chipEl.dataset.idx) || 0 });
    } catch (_) {}
  }

  return {
    open, close, next, prev, jump, find, backToCitations, copyCitation, explainClause, openFromChip,
    fromReserve, fromTenantField,
    // pure core (exported for tests)
    _normalizeForMatch, locateQuoteInItems, searchPageTexts,
  };
})();
