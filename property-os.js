/**
 * property-os.js — Property Operating System: the Property subject.
 * ============================================================================
 * Information architecture: records belong to SUBJECTS, not feature modules.
 *
 *   Property   → everything belonging to the building as a whole
 *                (setup, financials, building systems, property documents,
 *                 the invoice register, property-wide timeline)
 *   Space      → everything specific to one suite (tenant-space.js)
 *   CAM        → a workflow that REFERENCES invoices; it does not own them
 *   Reports    → generated outputs only
 *   Reserves   → long-term capital planning
 *
 * KEY ARCHITECTURAL RULE — invoices belong to the Property:
 * every invoice is uploaded once to the property (property.invoices, which is
 * already where they live) and may optionally relate to a Space, to CAM
 * eligibility, to a Building System, and to a Vendor. CAM consumes them from the
 * property's financial record rather than owning them.
 *
 * Nav re-parenting: instead of moving hundreds of lines of markup (and risking
 * the handlers/ids inside those cards), this module MOVES the existing card
 * nodes into their subject panes at init. Every id and listener is preserved
 * because the node itself is relocated, not cloned.
 *
 * Reuses: property.invoices, property.timeline (subject-scoped), savePropertyData,
 * switchWorkspaceTab, esc(). No new store, no new backend.
 *
 * Exposes: window.PropertyOS
 */
window.PropertyOS = (function () {
  'use strict';

  var _esc = (window.esc) || function (v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  };
  var _d = function (id) { return document.getElementById(id); };
  // PW-5 — Math.round(Number(n)) silently dropped cents on every figure in the
  // pane, and Number(undefined) rendered "$NaN" beside a tenant's name. The
  // try/catch never fired because nothing throws. Parse what extraction
  // actually produces ("1,250.00", "$84,500"), keep cents, and say "—" when
  // there is genuinely no number rather than inventing one.
  // CAM-1 — the SAME parser the engine uses. This pane and the reconciliation
  // disagreeing about one invoice is worse than either being wrong alone: the
  // panel is the more convincing of the two, so a manager would trust the
  // number that never reached the math. Local copy is a fallback only.
  function _num(v) {
    if (window.parseMoney) return window.parseMoney(v);
    if (v == null || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    var cleaned = String(v).replace(/[$,\s]/g, '');
    if (cleaned === '' || cleaned === '-') return null;
    var n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  function _money(v) {
    var n = _num(v);
    if (n === null) return '\u2014';
    return n.toLocaleString('en-US', { style: 'currency', currency: 'USD',
                                       minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function _fmtDate(ts) { try { return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch (_) { return String(ts || ''); } }

  // Shared building systems — the physical assets of the building as a whole.
  var BUILDING_SYSTEMS = [
    { key: 'roof',            label: 'Roof',            icon: '\u{1F3E0}' },
    { key: 'parking',         label: 'Parking Lot',     icon: '\u{1F17F}\u{FE0F}' },
    { key: 'hvac',            label: 'HVAC',            icon: '\u{2744}\u{FE0F}' },
    { key: 'fire',            label: 'Fire Suppression',icon: '\u{1F9EF}' },
    { key: 'landscaping',     label: 'Landscaping',     icon: '\u{1F333}' },
    { key: 'electrical',      label: 'Electrical',      icon: '\u{26A1}' },
    { key: 'plumbing',        label: 'Plumbing',        icon: '\u{1F6BF}' },
    { key: 'other',           label: 'Other / Shared',  icon: '\u{1F527}' },
  ];
  function systemLabel(key) {
    for (var i = 0; i < BUILDING_SYSTEMS.length; i++) if (BUILDING_SYSTEMS[i].key === key) return BUILDING_SYSTEMS[i].label;
    return null;
  }

  // ── Invoice relational model ────────────────────────────────────────────────
  // Invoices already live on property.invoices. We read them with their optional
  // relations normalized, and write relations back additively.
  function invoices(property) {
    return (property && Array.isArray(property.invoices) ? property.invoices : []).map(function (inv, i) {
      return {
        _i: i,
        id: inv.id != null ? String(inv.id) : null,
        vendorName: inv.vendorName || inv.fileName || 'Vendor',
        amount: _num(inv.amount) || 0,   // PW-4: "84,500.00" used to become 0
        category: inv.category || null,
        invoiceDate: inv.invoiceDate || null,
        fileUrl: inv.fileUrl || null,
        fileName: inv.fileName || null,
        // relations (optional, additive — absent on legacy invoices)
        spaceId: inv.spaceId || null,
        camEligible: inv.camEligible !== false,   // default: CAM-eligible unless told otherwise
        system: inv.system || null,
      };
    });
  }

  // PW-2 — resolve by id, never by the index baked into the rendered control.
  // The onchange used to carry the render-time position; an invoice removed
  // between render and click meant the relation (including `system`, which
  // feeds the Roof/HVAC story) was written onto a different invoice.
  function setInvoiceRelation(invoiceId, field, value) {
    var p = window.currentProperty && window.currentProperty();
    if (!p || !Array.isArray(p.invoices)) return;
    var inv = null;
    for (var i = 0; i < p.invoices.length; i++) {
      if (p.invoices[i] && String(p.invoices[i].id) === String(invoiceId)) { inv = p.invoices[i]; break; }
    }
    if (!inv) {
      if (window.showToast) window.showToast('That invoice is no longer in the register — the page has been refreshed.',
        { color: '#92400e', textColor: '#fef3c7', duration: 6000 });
      renderPropertyPage(p);
      return;
    }
    if (field === 'camEligible') inv.camEligible = !!value;
    else inv[field] = value || null;
    try { if (window.savePropertyData) window.savePropertyData(); } catch (_e) {}
    renderPropertyPage(p);
  }

  // ── Nav: create the Property pane and re-parent cards to their subjects ─────
  function _ensurePane() {
    if (_d('wsPane-property')) return _d('wsPane-property');
    var overview = _d('wsPane-overview');
    if (!overview || !overview.parentNode) return null;
    var pane = document.createElement('div');
    pane.className = 'workspace-tab-pane';
    pane.id = 'wsPane-property';
    pane.style.display = 'none';
    pane.innerHTML =
      '<div class="card" id="propertySection">' +
        '<div class="sec-head"><div class="sec-num" style="background:#0ea5e9;">\u{1F3E2}</div>' +
          '<div><h2>Property</h2><p>Everything that belongs to the building as a whole.</p></div></div>' +
        '<div id="propertyOsBody"></div>' +
      '</div>';
    overview.parentNode.insertBefore(pane, overview.nextSibling);
    return pane;
  }

  function _ensureTabButton() {
    if (_d('wsTabBtn-property')) return;
    var bar = _d('workspaceTabBar');
    var ov = _d('wsTabBtn-overview');
    if (!bar || !ov) return;
    var b = document.createElement('button');
    b.className = 'workspace-tab';
    b.id = 'wsTabBtn-property';
    b.setAttribute('onclick', "switchWorkspaceTabFromNav('property')");
    b.innerHTML = '<span class="ws-tab-icon">\u{1F3E2}</span>Property';
    bar.insertBefore(b, ov.nextSibling);
  }

  var _reparented = false;
  function _reparent() {
    if (_reparented) return;
    var pane = _ensurePane();
    if (!pane) return;
    var body = _d('propertyOsBody');
    // Property Setup belongs to the Property subject.
    var setup = _d('cardSetup');
    if (setup && body && !body.contains(setup)) body.parentNode.insertBefore(setup, body);
    _ensureSetupSummary(setup, body);
    // Lease intake creates spaces → it belongs under Spaces (no app-wide Lease section).
    var leases = _d('cardLeases'), spacesPane = _d('wsPane-spaces');
    if (leases && spacesPane && !spacesPane.contains(leases)) spacesPane.appendChild(leases);
    // The old Documents pane is retired from navigation; hide whatever remains.
    var docs = _d('wsPane-documents');
    if (docs) docs.style.display = 'none';
    var docsBtn = _d('wsTabBtn-documents');
    if (docsBtn) docsBtn.style.display = 'none';
    _reparented = true;
  }

  // ── Property Setup, once it is no longer setup ──────────────────────────────
  // The Property tab opened with "Property Setup — Enter property details to
  // begin the CAM reconciliation" and a worked pro-rata example, forever, on a
  // building configured months ago. First-run copy that never retires reads as
  // unfinished.
  //
  // COLLAPSED, not hidden. #propertyName and #totalSqft exist in exactly one
  // place in the app, so removing the card removes the only way to correct a
  // building's name or square footage — trading an eyesore for a dead end. A
  // configured property gets a one-line summary with Edit; nothing is lost.
  function _ensureSetupSummary(setup, body) {
    if (!setup || !body || _d('posSetupSummary')) return;
    var bar = document.createElement('div');
    bar.id = 'posSetupSummary';
    bar.className = 'pos-setup-sum';
    bar.style.display = 'none';
    setup.parentNode.insertBefore(bar, setup);
  }

  function _isConfigured() {
    var n = _d('propertyName'), q = _d('totalSqft');
    var name = n ? String(n.value || '').trim() : '';
    var sqft = q ? parseFloat(q.value) : NaN;
    return !!name && sqft > 0;
  }

  function toggleSetup(force) {
    var setup = _d('cardSetup'), bar = _d('posSetupSummary');
    if (!setup || !bar) return;
    var open = (force != null) ? !!force : (setup.style.display === 'none');
    setup.style.display = open ? '' : 'none';
    bar.classList.toggle('pos-setup-sum--open', open);
    var btn = _d('posSetupEdit');
    if (btn) btn.textContent = open ? 'Done' : 'Edit';
  }

  function renderSetupSummary(property) {
    var setup = _d('cardSetup'), bar = _d('posSetupSummary');
    if (!setup || !bar) return;
    if (!_isConfigured()) {
      // Not set up yet — the setup card IS the job. Leave it alone.
      bar.style.display = 'none';
      setup.style.display = '';
      return;
    }
    var name = (_d('propertyName') || {}).value || (property && property.name) || 'This property';
    var sqft = parseFloat((_d('totalSqft') || {}).value) || (property && property.totalSqft) || 0;
    var yearEl = _d('camYearSelect') || _d('camYear');
    var year = yearEl ? (yearEl.options && yearEl.options[yearEl.selectedIndex]
      ? yearEl.options[yearEl.selectedIndex].text : yearEl.value) : null;
    bar.style.display = '';
    bar.innerHTML =
      '<span class="pos-setup-name">' + _esc(name) + '</span>' +
      '<span class="pos-setup-meta">' + _esc(Math.round(sqft).toLocaleString('en-US')) + ' sq ft' +
        (year ? ' \u00b7 ' + _esc(year) : '') + '</span>' +
      '<button type="button" class="pos-setup-edit" id="posSetupEdit"' +
        ' onclick="PropertyOS.toggleSetup()">Edit</button>';
    // Collapsed by default on a configured property; re-opening is one tap.
    if (setup.style.display !== '') setup.style.display = 'none';
    else if (!bar.classList.contains('pos-setup-sum--open')) setup.style.display = 'none';
  }

  function init() {
    _ensureTabButton();
    _ensurePane();
    _reparent();
    injectStyles();
  }

  // ── Property page ───────────────────────────────────────────────────────────
  // ── Property Records ────────────────────────────────────────────────────────
  // ONE surface over ONE store. Categories are a filter, not screens, and every
  // record below is a property-scoped timeline event — the same events the
  // Building Systems grid counts and the Property documents list draws files
  // from. Nothing here has its own array. docs/PROPERTY_WORKSPACE.md.
  var _filter = { cat: 'all', system: null };
  var _focusId = null;   // record to highlight after a jump from Documents
  var _docIcon = function () { return '\u{1F4C4}'; };

  function setRecordFilter(cat, system) {
    _filter = { cat: cat || 'all', system: system || null };
    renderPropertyPage();
  }

  // Every property-scoped event: the building as a whole, plus each system.
  // Space-scoped events belong to the Space workspace and are deliberately out.
  function propertyRecords(property) {
    return (property.timeline || [])
      .filter(function (e) {
        if (!e) return false;
        var t = e.subject && e.subject.type;
        return !e.subject || t === 'property' || t === 'system';
      })
      .sort(function (a, b) {
        return (new Date(b.timestamp).getTime() || 0) - (new Date(a.timestamp).getTime() || 0);
      });
  }

  /**
   * Every document on this building, derived from the records that hold it.
   *
   * NOT a repository. A document is an attachment on a record — the roof
   * warranty PDF belongs to the roof job, not to a folder that happens to
   * mention roofs. So each entry carries the record it came from, and the
   * Documents view is a VIEW of records rather than a second place files live.
   *
   * That is also what makes the "open" promise keepable: a chip labelled with a
   * file name has to be able to say which record it is on, or it is a link into
   * nowhere. ARCHITECTURE_PRINCIPLES — no broken promises.
   */
  function propertyDocuments(property) {
    var out = [];
    propertyRecords(property).forEach(function (e) {
      (e.attachments || []).forEach(function (a) {
        if (!a || !a.url) return;
        out.push({
          name: a.name, url: a.url, kind: a.kind,
          recordId: e.id, recordTitle: e.title || e.type,
          category: e.category || null,
          system: (e.subject && e.subject.type === 'system') ? e.subject.id : null,
          when: e.timestamp,
        });
      });
    });
    // Invoices carry their own file and are their own record in the register.
    invoices(property).forEach(function (i) {
      if (!i.fileUrl || i.spaceId) return;
      out.push({
        name: i.fileName || i.vendorName, url: i.fileUrl, kind: 'invoice',
        recordId: null, recordTitle: i.vendorName, invoiceKey: _invoiceKeyOf(i),
        category: 'invoice', system: i.system || null, when: i.invoiceDate,
      });
    });
    return out.sort(function (a, b) {
      return (new Date(b.when).getTime() || 0) - (new Date(a.when).getTime() || 0);
    });
  }

  // Jump to the record a document sits on: filter to it and scroll it into
  // view. The label names a file on a record, so the control has to open THAT
  // record — not the Documents section it was already looking at.
  function openRecord(recordId) {
    var property = window.currentProperty && window.currentProperty();
    if (!property || !recordId) return false;
    var ev = (property.timeline || []).find(function (x) { return String(x.id) === String(recordId); });
    if (!ev) return false;
    _filter = { cat: 'all', system: null };
    _focusId = String(recordId);
    renderPropertyPage(property);
    setTimeout(function () {
      var el = document.querySelector('.pos-rec[data-rec-id="' + String(recordId).replace(/"/g, '') + '"]');
      if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 40);
    return true;
  }

  // Attach a document to an EXISTING record. Without this the only way to add a
  // file was at creation time, so the invoice that arrives three weeks after the
  // roof job had nowhere to go but a flat list. Recorded as an amendment.
  function attachToRecord(recordId, fileList) {
    var property = window.currentProperty && window.currentProperty();
    if (!property) return Promise.resolve(false);
    var ev = (property.timeline || []).find(function (x) { return String(x.id) === String(recordId); });
    if (!ev) return Promise.resolve(false);
    var files = [].slice.call(fileList || []);
    if (!files.length) return Promise.resolve(false);

    var kindOf = function (f) {
      return /^image\//.test(f.type) ? 'photo' : (/pdf$/i.test(f.type || '') ? 'document' : 'document');
    };
    var uploads = files.map(function (f) {
      if (!window.uploadInvoiceFile) return Promise.resolve(null);
      return window.uploadInvoiceFile(f)
        .then(function (r) { return (r && r.url) ? { name: f.name, url: r.url, kind: kindOf(f) } : null; })
        .catch(function () { return null; });
    });

    return Promise.all(uploads).then(function (res) {
      var okFiles = res.filter(Boolean);
      var failed = res.length - okFiles.length;
      // No silent failures: a file that did not upload is said out loud, and
      // the ones that did are still kept.
      if (failed && window.showToast) {
        window.showToast('\u26A0\uFE0F ' + failed + ' file' + (failed !== 1 ? 's' : '') +
          " couldn't upload — the others were attached.",
          { color: '#92400e', textColor: '#fef3c7', duration: 6000 });
      }
      if (!okFiles.length) {
        if (!failed && window.showToast) window.showToast('\u26A0\uFE0F Nothing was attached — upload is unavailable.',
          { color: '#92400e', textColor: '#fef3c7', duration: 6000 });
        return false;
      }
      var PT = window.PropertyTimeline;
      if (PT && PT.amendAttachments) PT.amendAttachments(ev, okFiles);
      else ev.attachments = (ev.attachments || []).concat(okFiles);
      try { if (window.savePropertyData) window.savePropertyData(); } catch (_) {}
      renderPropertyPage(property);
      if (window.showToast) window.showToast('\u2713 Attached to \u201C' + (ev.title || 'record') + '\u201D', { duration: 3500 });
      return true;
    });
  }

  // Hidden input, one per page, reused. Created on demand so nothing is
  // appended to document.body on a property that never attaches anything.
  function pickAttachment(recordId) {
    var inp = _d('posAttachInput');
    if (!inp) {
      inp = document.createElement('input');
      inp.type = 'file'; inp.id = 'posAttachInput'; inp.multiple = true;
      inp.style.display = 'none';
      inp.addEventListener('change', function () {
        var rid = inp.dataset.recordId;
        var files = inp.files;
        attachToRecord(rid, files).then(function () { inp.value = ''; });
      });
      document.body.appendChild(inp);
    }
    inp.dataset.recordId = String(recordId);
    inp.click();
  }

  // What belongs alongside THIS record. The first version said "the warranty,
  // the contractor invoice, the inspection and the photos for this job" on
  // every record — roof-repair copy on a tax assessment, three times on one
  // screen. Copy written for one example and shown everywhere reads as
  // unfinished, because it is describing something the user is not looking at.
  var REL_EMPTY = {
    real_estate_taxes:  'Nothing linked yet. The assessment notice, the appeal and the paid receipt for this tax year belong together.',
    insurance:          'Nothing linked yet. The policy, its certificates and any claim made against it belong together.',
    mortgage_financing: 'Nothing linked yet. The note, the amendments and the reserve draws against it belong together.',
    survey:             'Nothing linked yet. Link the survey to the work that required it.',
    site_plan:          'Nothing linked yet. Link the site plan to the work it governs.',
    building_plan:      'Nothing linked yet. Link the plan set to the work it governs.',
    environmental:      'Nothing linked yet. The report, any follow-up testing and the remediation it triggered belong together.',
    capital_improvement:'Nothing linked yet. The contractor invoice, the warranty, the inspection and the photos for this job belong here \u2014 on the job, not scattered across the building.',
    warranty:           'Nothing linked yet. Link this warranty to the work it covers, so the job and its cover stay together.',
    building_photo:     'Nothing linked yet. Link these photos to what they show.',
    inspection:         'Nothing linked yet. Link this inspection to the work or system it was carried out on.',
    maintenance:        'Nothing linked yet. The invoice, the photos and the vendor for this work belong here.',
    repair:             'Nothing linked yet. The invoice, the photos and the vendor for this repair belong here.',
    vendor:             'Nothing linked yet. Link this vendor to the work they carried out.',
  };
  function _relEmptyCopy(e) {
    var c = e && e.category;
    if (c && REL_EMPTY[c]) return REL_EMPTY[c];
    // Generic, and still true of anything: the invoice, the document and the
    // photograph that go with a record belong on it.
    return 'Nothing linked yet. Anything that belongs with this record \u2014 an invoice, a document, a related job \u2014 can be linked here so they stay one thing.';
  }

  // Related Items on a record: the rest of its story, plus the way to add to it.
  // Shown even when empty, because an empty Related Items is the prompt that
  // teaches the feature — a roof job with nothing attached is the case this
  // exists to fix.
  function _relatedHtml(property, e) {
    var g = relatedGroup(property, e.id);
    var others = g.events.filter(function (x) { return String(x.id) !== String(e.id); });
    var invs   = g.invoices;
    var n = others.length + invs.length + (g.missingInvoices || []).length;

    var rows = others.map(function (x) {
      var d = (window.PropertyTimeline && PropertyTimeline.describe) ? PropertyTimeline.describe(x) : { label: x.type, icon: '' };
      var atts = (x.attachments || []).filter(function (a) { return a && a.url; }).length;
      return '<div class="pos-ri-row">' +
        '<span class="pos-ri-ic">' + (d.icon || '\u{1F4CC}') + '</span>' +
        '<span class="pos-ri-t">' + _esc(x.title || d.label || x.type) + '</span>' +
        '<span class="pos-ri-m">' + _esc(d.label || '') + (atts ? ' \u00b7 ' + atts + ' file' + (atts !== 1 ? 's' : '') : '') + '</span>' +
        '<span class="pos-ri-w">' + _esc(_fmtDate(x.timestamp)) + '</span>' +
        '<button type="button" class="pos-ri-x" title="Remove this link"' +
          ' data-ev="' + _esc(e.id) + '" data-kind="event" data-id="' + _esc(x.id) + '"' +
          ' onclick="PropertyOS.unlinkRecord(this.dataset.ev, this.dataset.kind, this.dataset.id)">\u2715</button>' +
      '</div>';
    }).join('') + (g.missingInvoices || []).map(function (ref) {
      // PW-1 — a link whose invoice is gone is reported, not silently dropped
      // and never resolved positionally to whatever now sits at that index.
      return '<div class="pos-ri-row pos-ri-row--missing">' +
        '<span class="pos-ri-ic">\u26A0\uFE0F</span>' +
        '<span class="pos-ri-t">Linked invoice no longer on file</span>' +
        '<span class="pos-ri-m">removed from the register</span>' +
        '<button type="button" class="pos-ri-x" title="Remove this dead link"' +
          ' data-ev="' + _esc(e.id) + '" data-kind="invoice" data-id="' + _esc(ref) + '"' +
          ' onclick="PropertyOS.unlinkRecord(this.dataset.ev, this.dataset.kind, this.dataset.id)">\u2715</button>' +
      '</div>';
    }).join('') + invs.map(function (i) {
      return '<div class="pos-ri-row">' +
        '<span class="pos-ri-ic">\u{1F9FE}</span>' +
        '<span class="pos-ri-t">' + _esc(i.vendorName) + '</span>' +
        '<span class="pos-ri-m">Invoice \u00b7 ' + _esc(_money(i.amount)) + '</span>' +
        '<span class="pos-ri-w">' + _esc(i.invoiceDate ? _fmtDate(i.invoiceDate) : '') + '</span>' +
        '<button type="button" class="pos-ri-x" title="Remove this link"' +
          ' data-ev="' + _esc(e.id) + '" data-kind="invoice" data-id="' + _esc(_invoiceKeyOf(i)) + '"' +
          ' onclick="PropertyOS.unlinkRecord(this.dataset.ev, this.dataset.kind, this.dataset.id)">\u2715</button>' +
      '</div>';
    }).join('');

    return '<div class="pos-ri">' +
      '<div class="pos-ri-head">Related items <span class="pos-ri-n">' + n + '</span>' +
        // Edit lives ON the record. Without it the only way to fix a typo was to
      // scroll to Property Timeline at the bottom and find the pencil there —
      // everything else about the record is here, and editing was not.
      //
      // Shown only for MANUAL records: openEditEntry() refuses anything the
      // system generated ("Only manager entries can be edited"), and offering a
      // button that will refuse is a broken promise.
      (e.manual ? '<button type="button" class="pos-ri-add" data-ev="' + _esc(e.id) + '"' +
          ' onclick="PropertyOS.editRecord(this.dataset.ev)">\u270F\uFE0F Edit</button>' : '') +
        '<button type="button" class="pos-ri-add" data-ev="' + _esc(e.id) + '"' +
          ' onclick="PropertyOS.pickAttachment(this.dataset.ev)">\u{1F4CE} Attach</button>' +
        '<button type="button" class="pos-ri-add" data-ev="' + _esc(e.id) + '"' +
          ' onclick="PropertyOS.openLinkPicker(this.dataset.ev)">\uFF0B Link</button></div>' +
      (n ? '<div class="pos-ri-list">' + rows + '</div>'
         : '<div class="pos-ri-empty">' + _esc(_relEmptyCopy(e)) + '</div>') +
    '</div>';
  }

  // Revision history, rendered from event.revisions[]. Preserved history that
  // cannot be read is not preserved — the point of amending instead of
  // overwriting is that someone can see what the record used to say.
  //
  // Collapsed by default: the current state is what a manager needs, and the
  // history is what they go looking for.
  function _revHtml(e) {
    var revs = e && e.revisions;
    if (!Array.isArray(revs) || revs.length < 2) return '';   // 1 = created only
    var edits = revs.length - 1;
    var lines = revs.map(function (r) {
      var when = _fmtDate(r.at);
      if (r.action === 'created') {
        return '<div class="pos-rev"><span class="pos-rev-w">' + _esc(when) + '</span>' +
          '<span class="pos-rev-t">Recorded by ' + _esc(r.by || 'Unknown') + '</span></div>';
      }
      var bits = (r.changes || []).map(function (c) {
        return _esc(c.label || c.field) + ': ' + _esc(c.from || 'empty') + ' \u2192 ' + _esc(c.to || 'empty');
      });
      if (r.note) bits.push(_esc(r.note));
      (r.added   || []).forEach(function (a) { bits.push('Added ' + _esc(a.name)); });
      (r.removed || []).forEach(function (a) { bits.push('Removed ' + _esc(a.name)); });
      return '<div class="pos-rev"><span class="pos-rev-w">' + _esc(when) + '</span>' +
        '<span class="pos-rev-t">' + bits.join(' \u00b7 ') + ' \u2014 ' + _esc(r.by || 'Unknown') + '</span></div>';
    }).join('');
    return '<details class="pos-revs"><summary>Edited ' + edits + ' time' + (edits !== 1 ? 's' : '') +
      ' \u2014 view history</summary>' + lines + '</details>';
  }

  // ── Related Items — the connective tissue ─────────────────────────────────
  // A roof replacement is not six records. It is one story: the timeline event,
  // the warranty, the contractor, the invoice, the photos, the inspection, and
  // the insurance claim if there was one. Related Items is what makes those one
  // thing.
  //
  // STORAGE: a single `relatedTo` array on the timeline event, holding
  // { kind:'event'|'invoice', id }. Nothing else. No join table, no link store —
  // the same rule as everywhere else here.
  //
  // DIRECTION: links are stored one-way and read UNDIRECTED. Storing both ends
  // would mean keeping two copies in step, and the copy that drifts is the one
  // nobody looks at. Reading the reverse costs a scan of the timeline, which at
  // property scale is nothing.
  //
  // SHAPE: the story is the CONNECTED COMPONENT, not the immediate neighbours.
  // If the invoice links to the roof job and the warranty links to the invoice,
  // opening the warranty must still show the whole job — otherwise "one
  // connected story" is only true when you happen to start at the anchor. BFS
  // with a visited set, so a cycle terminates instead of hanging.
  function _refKey(kind, id) { return kind + ':' + String(id); }

  // PW-1 — a link must survive the register changing underneath it.
  //
  // This used to persist the ARRAY INDEX as the link id, on the stated premise
  // that "the array is append-only in practice". It is not: removeInvItem()
  // (script.js:8628) splices, shifting every later invoice down one, and
  // mergeInvoicesDedup() rewrites the array wholesale. So a roof job linked to
  // invoice 3 silently pointed at a different vendor and a different amount
  // after any earlier invoice was removed — wrong money, no warning, in the one
  // feature sold as verified memory.
  //
  // Links now key on a stable id. Ids that look like a bare integer are legacy
  // positional links and are migrated once, while the positions are still
  // correct (see _ensureInvoiceIds).
  function _invoiceKeyOf(inv) {
    return inv && inv.id != null ? String(inv.id) : null;
  }
  function _isLegacyIndexKey(k) { return /^\d+$/.test(String(k)); }

  /**
   * Stamp a stable id on every invoice that lacks one, and rewrite any
   * positional link to the id now at that position.
   *
   * MUST run before the invoice array is mutated — at that moment the indices
   * still mean what the old links assumed. Called from renderPropertyPage (the
   * only place links are created) and from removeInvItem (the destructive path)
   * so the window between the two is closed.
   *
   * Ids are prefixed and random so they can never collide with a legacy
   * positional key, which is how the migration stays idempotent.
   */
  function ensureInvoiceIds(property) {
    if (!property || !Array.isArray(property.invoices)) return false;
    var changed = false;
    var idAt = [];
    property.invoices.forEach(function (inv, i) {
      if (!inv) { idAt[i] = null; return; }
      if (inv.id == null || _isLegacyIndexKey(inv.id)) {
        inv.id = 'inv-' + Math.random().toString(36).slice(2, 10) + '-' + i;
        changed = true;
      }
      idAt[i] = String(inv.id);
    });
    // Migrate positional links on the timeline, once.
    (property.timeline || []).forEach(function (e) {
      if (!e || !Array.isArray(e.relatedTo)) return;
      e.relatedTo.forEach(function (r) {
        if (!r || r.kind !== 'invoice') return;
        if (!_isLegacyIndexKey(r.id)) return;
        var pos = Number(r.id);
        // Out of range means the invoice it pointed at is already gone. Mark it
        // unresolved rather than silently re-pointing at whatever sits there.
        r.id = (pos >= 0 && pos < idAt.length && idAt[pos]) ? idAt[pos] : ('missing:' + pos);
        changed = true;
      });
    });
    return changed;
  }

  function _linksOf(node) {
    return (node && Array.isArray(node.relatedTo) ? node.relatedTo : [])
      .filter(function (r) { return r && r.kind && r.id != null; });
  }

  /**
   * Everything in the same story as `startId`, including the starting record.
   * Returns { events: [...], invoices: [...] }.
   */
  function relatedGroup(property, startId) {
    var events = (property && property.timeline) || [];
    var invs   = invoices(property || {});
    var byEvent = {}, byInv = {};
    events.forEach(function (e) { if (e && e.id != null) byEvent[String(e.id)] = e; });
    invs.forEach(function (i) { byInv[_invoiceKeyOf(i)] = i; });

    // Undirected adjacency, built once per call.
    var adj = {};
    function edge(a, b) {
      (adj[a] = adj[a] || []).push(b);
      (adj[b] = adj[b] || []).push(a);
    }
    events.forEach(function (e) {
      if (!e || e.id == null) return;
      _linksOf(e).forEach(function (r) { edge(_refKey('event', e.id), _refKey(r.kind, r.id)); });
    });

    var start = _refKey('event', startId);
    var seen = {}, queue = [start], outE = [], outI = [], outMissing = [];
    while (queue.length) {
      var k = queue.shift();
      if (seen[k]) continue;
      seen[k] = true;
      var parts = k.split(':'), kind = parts[0], id = parts.slice(1).join(':');
      if (kind === 'event' && byEvent[id]) outE.push(byEvent[id]);
      else if (kind === 'invoice' && byInv[id]) outI.push(byInv[id]);
      // A referenced invoice that is not in the register is DEAD, not absent:
      // the link was made deliberately and the target has gone. Report it.
      else if (kind === 'invoice' && k !== start) outMissing.push(id);
      (adj[k] || []).forEach(function (n) { if (!seen[n]) queue.push(n); });
    }
    return { events: outE, invoices: outI, missingInvoices: outMissing };
  }

  /**
   * Everything about one building system, in one place — which is what a
   * manager means by "show me the Roof". Not just records whose subject IS the
   * system: also the invoices related to it, and anything linked into those
   * stories. Clicking Roof should end the search, not start one.
   */
  function systemStory(property, systemKey) {
    var events = (property && property.timeline) || [];
    var invs   = invoices(property || {});
    var seedE = events.filter(function (e) {
      return e && e.subject && e.subject.type === 'system' && e.subject.id === systemKey;
    });
    var seedI = invs.filter(function (i) { return i.system === systemKey; });

    var eIds = {}, iIds = {};
    seedE.forEach(function (e) { eIds[String(e.id)] = e; });
    seedI.forEach(function (i) { iIds[_invoiceKeyOf(i)] = i; });
    // Pull in each seed's connected story, so the invoice attached to the roof
    // job arrives even if only the job carries the system tag.
    seedE.forEach(function (e) {
      var g = relatedGroup(property, e.id);
      g.events.forEach(function (x) { eIds[String(x.id)] = x; });
      g.invoices.forEach(function (x) { iIds[_invoiceKeyOf(x)] = x; });
    });
    return {
      events: Object.keys(eIds).map(function (k) { return eIds[k]; })
        .sort(function (a, b) { return (new Date(b.timestamp).getTime() || 0) - (new Date(a.timestamp).getTime() || 0); }),
      invoices: Object.keys(iIds).map(function (k) { return iIds[k]; }),
    };
  }

  // Linking is an AMENDMENT, not a silent write. Who connected the invoice to
  // the roof job, and when, is part of the record — the same standard as every
  // other edit. ARCHITECTURE_PRINCIPLES §6.
  function linkRecord(eventId, kind, targetId) {
    var property = window.currentProperty && window.currentProperty();
    if (!property) return false;
    var ev = (property.timeline || []).find(function (x) { return String(x.id) === String(eventId); });
    if (!ev) return false;
    var already = _linksOf(ev).some(function (r) { return r.kind === kind && String(r.id) === String(targetId); });
    if (already) return false;

    var label = kind === 'invoice'
      ? (function () {
          var i = invoices(property).find(function (x) { return _invoiceKeyOf(x) === String(targetId); });
          return i ? (i.vendorName + ' ' + _money(i.amount)) : 'invoice';
        })()
      : (function () {
          var t = (property.timeline || []).find(function (x) { return String(x.id) === String(targetId); });
          return t ? (t.title || t.type) : 'record';
        })();

    var next = _linksOf(ev).concat([{ kind: kind, id: String(targetId) }]);
    var PT = window.PropertyTimeline;
    if (PT && PT.amendRelated) PT.amendRelated(ev, next, label);
    else ev.relatedTo = next;   // degraded, but never silently lost

    try { if (window.savePropertyData) window.savePropertyData(); } catch (_) {}
    renderPropertyPage(property);
    return true;
  }

  function unlinkRecord(eventId, kind, targetId) {
    var property = window.currentProperty && window.currentProperty();
    if (!property) return false;
    var ev = (property.timeline || []).find(function (x) { return String(x.id) === String(eventId); });
    if (!ev) return false;
    var next = _linksOf(ev).filter(function (r) { return !(r.kind === kind && String(r.id) === String(targetId)); });
    if (next.length === _linksOf(ev).length) return false;
    var PT = window.PropertyTimeline;
    if (PT && PT.amendRelated) PT.amendRelated(ev, next, null, true);
    else ev.relatedTo = next;
    try { if (window.savePropertyData) window.savePropertyData(); } catch (_) {}
    renderPropertyPage(property);
    return true;
  }

  // The picker. Offers every OTHER property record and every invoice, minus
  // whatever is already in this story — a list that offers what you already
  // have is a list people stop reading.
  function openLinkPicker(eventId) {
    var property = window.currentProperty && window.currentProperty();
    if (!property) return;
    var story = relatedGroup(property, eventId);
    var haveE = {}, haveI = {};
    story.events.forEach(function (e) { haveE[String(e.id)] = 1; });
    story.invoices.forEach(function (i) { haveI[_invoiceKeyOf(i)] = 1; });

    var evOpts = propertyRecords(property)
      .filter(function (e) { return !haveE[String(e.id)]; })
      .slice(0, 60)
      .map(function (e) {
        return '<option value="event:' + _esc(e.id) + '">' + _esc((e.title || e.type) + '  —  ' + _fmtDate(e.timestamp)) + '</option>';
      }).join('');
    var invOpts = invoices(property)
      .filter(function (i) { return !haveI[_invoiceKeyOf(i)]; })
      .slice(0, 60)
      .map(function (i) {
        return '<option value="invoice:' + _esc(_invoiceKeyOf(i)) + '">' + _esc(i.vendorName + '  —  ' + _money(i.amount)) + '</option>';
      }).join('');

    var old = _d('posLinkOverlay'); if (old) old.remove();
    var ov = document.createElement('div');
    ov.id = 'posLinkOverlay'; ov.className = 'pos-link-ov';
    ov.innerHTML =
      '<div class="pos-link-box" role="dialog" aria-modal="true" aria-label="Link a related record">' +
        '<div class="pos-link-head">Link a related record' +
          '<button type="button" class="pos-link-x" id="posLinkX" aria-label="Close">\u2715</button></div>' +
        '<p class="pos-link-sub">Connect the warranty, the invoice, the inspection and the photos to the job they belong to, so the building remembers them as one thing.</p>' +
        (evOpts || invOpts
          ? '<select class="pos-link-sel" id="posLinkSel">' +
              (evOpts ? '<optgroup label="Property records">' + evOpts + '</optgroup>' : '') +
              (invOpts ? '<optgroup label="Invoices">' + invOpts + '</optgroup>' : '') +
            '</select>' +
            '<div class="pos-link-acts">' +
              '<button type="button" class="pos-link-cancel" id="posLinkCancel">Cancel</button>' +
              '<button type="button" class="pos-link-go" id="posLinkGo" data-ev="' + _esc(eventId) + '">Link</button>' +
            '</div>'
          : '<div class="pos-empty">Nothing left to link — everything on this property is already part of this story.</div>') +
      '</div>';
    document.body.appendChild(ov);
    var close = function () { ov.remove(); };
    _d('posLinkX').onclick = close;
    if (_d('posLinkCancel')) _d('posLinkCancel').onclick = close;
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    if (_d('posLinkGo')) _d('posLinkGo').onclick = function () {
      var v = (_d('posLinkSel') || {}).value || '';
      var ix = v.indexOf(':');
      if (ix < 0) { close(); return; }
      close();
      linkRecord(this.dataset.ev, v.slice(0, ix), v.slice(ix + 1));
    };
  }

  function _applyFilter(records, property) {
    var storyIds = null;
    if (_filter.system && property) {
      storyIds = {};
      systemStory(property, _filter.system).events.forEach(function (e) { storyIds[String(e.id)] = 1; });
    }
    return records.filter(function (e) {
      if (storyIds && !storyIds[String(e.id)]) return false;
      if (_filter.cat !== 'all' && (e.category || '') !== _filter.cat) return false;
      return true;
    });
  }

  function _sec(title, count, body) {
    return '<section class="pos-sec"><div class="pos-sec-head"><span class="pos-sec-title">' + _esc(title) + '</span>' +
      (count != null ? '<span class="pos-sec-count">' + count + '</span>' : '') + '</div>' +
      '<div class="pos-sec-body">' + body + '</div></section>';
  }
  function _empty(m) { return '<div class="pos-empty">' + _esc(m) + '</div>'; }

  function renderPropertyPage(property) {
    property = property || (window.currentProperty && window.currentProperty());
    var body = _d('propertyOsBody');
    if (!body || !property) return;
    injectStyles();
    // PW-1 — stamp ids and migrate positional links BEFORE anything reads them.
    try { if (ensureInvoiceIds(property) && window.savePropertyData) window.savePropertyData(); } catch (_) {}
    // Collapse the first-run setup card once the building is configured.
    try { renderSetupSummary(property); } catch (_) {}

    var PR = window.PropertyReference;   // declared early: the documents section uses it
    var invs = invoices(property);
    var spaces = (property.tenants || []).filter(function (t) { return t && (t.tenant_name || t.id); });
    var tl = (property.timeline || []);

    // Financial snapshot — property-wide money, read from the record.
    // PW-4 — the panel used to sum EVERY invoice on the property under a header
    // the app elsewhere labels with a CAM year. Three separate ways to be wrong:
    // invoices from other years were included, space-scoped (tenant-direct)
    // invoices inflated the property pool, and "84,500.00" coerced to 0.
    //
    // Scope is now explicit and stated on screen, because a total whose basis
    // is invisible is a total a manager cannot check.
    var camYear = (window.currentCamYear && window.currentCamYear()) ||
                  (window._camYear != null ? window._camYear : null);
    var invYear = function (i) {
      if (!i.invoiceDate) return null;
      var d = new Date(i.invoiceDate);
      return isNaN(d.getTime()) ? null : d.getFullYear();
    };
    var undated = invs.filter(function (i) { return invYear(i) === null; });
    var inYear = invs.filter(function (i) {
      if (camYear == null) return true;               // no year selected → all
      var y = invYear(i);
      return y === null ? true : String(y) === String(camYear);  // undated counted, and said so
    });
    var propertyScoped = inYear.filter(function (i) { return !i.spaceId; });
    var spaceScoped    = inYear.filter(function (i) { return !!i.spaceId; });

    var total   = propertyScoped.reduce(function (s, i) { return s + i.amount; }, 0);
    var camPool = propertyScoped.filter(function (i) { return i.camEligible; })
                                .reduce(function (s, i) { return s + i.amount; }, 0);
    var nonCam  = total - camPool;

    var scopeBits = [];
    if (camYear != null) scopeBits.push(_esc(String(camYear)) + ' only');
    scopeBits.push(propertyScoped.length + ' property invoice' + (propertyScoped.length !== 1 ? 's' : ''));
    if (spaceScoped.length) scopeBits.push(spaceScoped.length + ' tenant-direct excluded');
    if (undated.length)     scopeBits.push(undated.length + ' undated, counted');
    var excludedYear = camYear != null ? invs.length - inYear.length : 0;
    if (excludedYear > 0) scopeBits.push(excludedYear + ' from other years excluded');

    var finHtml = invs.length
      ? '<div class="pos-fin">' +
          '<div class="pos-fin-cell"><div class="pos-fin-v">' + _money(total) + '</div><div class="pos-fin-l">Total invoiced</div></div>' +
          '<div class="pos-fin-cell"><div class="pos-fin-v">' + _money(camPool) + '</div><div class="pos-fin-l">CAM-eligible</div></div>' +
          '<div class="pos-fin-cell"><div class="pos-fin-v">' + _money(nonCam) + '</div><div class="pos-fin-l">Not CAM</div></div>' +
        '</div>' +
        '<div class="pos-fin-scope">' + scopeBits.join(' \u00b7 ') + '</div>'
      : _empty('No invoices on file for this property yet.');

    // Invoice register — uploaded once to the property, related outward.
    var spaceOpts = function (sel) {
      return '<option value="">Property only</option>' + spaces.map(function (t) {
        return '<option value="' + _esc(t.id) + '"' + (sel === t.id ? ' selected' : '') + '>' + _esc(t.tenant_name || t.id) + '</option>';
      }).join('');
    };
    var sysOpts = function (sel) {
      return '<option value="">No system</option>' + BUILDING_SYSTEMS.map(function (s) {
        return '<option value="' + s.key + '"' + (sel === s.key ? ' selected' : '') + '>' + _esc(s.label) + '</option>';
      }).join('');
    };
    var regHtml = invs.length
      ? '<div class="pos-reg">' + invs.slice(0, 40).map(function (inv) {
          return '<div class="pos-inv">' +
            '<div class="pos-inv-top">' +
              '<span class="pos-inv-vendor">' + _esc(inv.vendorName) + '</span>' +
              '<span class="pos-inv-amt">' + _money(inv.amount) + '</span>' +
            '</div>' +
            '<div class="pos-inv-meta">' + _esc([inv.category, inv.invoiceDate ? _fmtDate(inv.invoiceDate) : null].filter(Boolean).join(' · ') || '—') + '</div>' +
            '<div class="pos-inv-rel">' +
              '<label class="pos-rel"><span>Space</span><select onchange="PropertyOS.setInvoiceRelation(this.dataset.invId,\'spaceId\',this.value)" data-inv-id="' + _esc(inv.id) + '">' + spaceOpts(inv.spaceId) + '</select></label>' +
              '<label class="pos-rel"><span>System</span><select onchange="PropertyOS.setInvoiceRelation(this.dataset.invId,\'system\',this.value)" data-inv-id="' + _esc(inv.id) + '">' + sysOpts(inv.system) + '</select></label>' +
              '<label class="pos-rel pos-rel--chk"><input type="checkbox"' + (inv.camEligible ? ' checked' : '') + ' onchange="PropertyOS.setInvoiceRelation(this.dataset.invId,\'camEligible\',this.checked)" data-inv-id="' + _esc(inv.id) + '"><span>CAM eligible</span></label>' +
            '</div>' +
          '</div>';
        }).join('') + '</div>' +
        (invs.length > 40 ? '<div class="pos-empty">Showing 40 of ' + invs.length + '</div>' : '') +
        '<div class="pos-note">Uploaded once to the property. CAM references these — it doesn’t own them.</div>'
      : _empty('Invoices uploaded to this property will appear here, ready to relate to a space, a building system, or CAM.');

    // Building systems — the shared physical assets, with what's attached to each.
    var sysHtml = '<div class="pos-sys">' + BUILDING_SYSTEMS.map(function (s) {
      var n = invs.filter(function (i) { return i.system === s.key; }).length;
      var ev = tl.filter(function (e) { return e && e.subject && e.subject.type === 'system' && e.subject.id === s.key; }).length;
      var tot = n + ev;
      return '<div class="pos-sys-cell' + (tot ? ' pos-sys-cell--on' : '') +
        (_filter.system === s.key ? ' pos-sys-cell--sel' : '') + '" role="button" tabindex="0"' +
        ' data-sys="' + _esc(s.key) + '"' +
        ' onclick="PropertyOS.setRecordFilter(\'all\', this.dataset.sys)"' +
        ' title="Show only records for this system"><span class="pos-sys-ic">' + s.icon + '</span>' +
        '<span class="pos-sys-l">' + _esc(s.label) + '</span>' +
        '<span class="pos-sys-n">' + (tot ? tot + ' record' + (tot !== 1 ? 's' : '') : '—') + '</span></div>';
    }).join('') + '</div>';

    // The flat document scrape that used to live here is gone. It built a
    // second list of files with no idea which record each came from, which is
    // exactly the "another flat document repository" this workspace must not
    // be. propertyDocuments() derives the same files FROM the records.
    _docIcon = function (k) {
      return k === 'photo' ? '\u{1F5BC}\u{FE0F}' : (k === 'invoice' ? '\u{1F9FE}'
        : (k === 'warranty' ? '\u{1F6E1}\u{FE0F}' : (k === 'plan' ? '\u{1F4D0}' : '\u{1F4C4}')));
    };
    // Documents is a VIEW of records, not a repository. Every row names the
    // record its file sits on and opens THAT record — a file chip that opens
    // nothing, or opens the section you were already looking at, is a broken
    // promise. Files arrive here by being attached to a record; there is no
    // other way in, which is the point.
    var recDocs = propertyDocuments(property);
    var docHtml = recDocs.length
      ? '<div class="pos-docs-list">' + recDocs.slice(0, 40).map(function (a) {
          var on = a.recordId
            ? '<button type="button" class="pos-doc-on" data-rec="' + _esc(a.recordId) + '"' +
              ' onclick="PropertyOS.openRecord(this.dataset.rec)"' +
              ' title="Open the record this document is filed on">on: ' + _esc(a.recordTitle) + '</button>'
            : '<span class="pos-doc-on pos-doc-on--inv">on: ' + _esc(a.recordTitle) + ' (invoice register)</span>';
          return '<div class="pos-doc-row">' +
            '<a class="pos-doc" href="' + _esc(a.url) + '" target="_blank" rel="noopener">' +
              _docIcon(a.kind) + '&nbsp;<span class="pos-doc-n">' + _esc(a.name) + '</span></a>' +
            on +
            (a.system ? '<span class="pos-doc-sys">' + _esc(systemLabel(a.system) || a.system) + '</span>' : '') +
            (a.when ? '<span class="pos-doc-w">' + _esc(_fmtDate(a.when)) + '</span>' : '') +
          '</div>';
        }).join('') + '</div>' +
        (recDocs.length > 40 ? '<div class="pos-empty">Showing 40 of ' + recDocs.length + '</div>' : '') +
        '<div class="pos-note">Every document is filed on a record. Attach one from the record it belongs to \u2014 that is what keeps the roof warranty with the roof job.</div>'
      : _empty('No documents yet. Insurance policies, tax bills, surveys, plans and warranties are attached to the record they belong to \u2014 add a record, then attach its files.');

    // Reference samples exist only on the seeded demo property. Kept visibly
    // apart so a preview can never be mistaken for a record on file.
    var sampleDocs = PR ? PR.propertyDocumentsFor(property) : [];
    if (sampleDocs.length) {
      docHtml += '<div class="pos-sample-head">Reference samples \u2014 examples of what a building keeps on file. Not records on this property.</div>' +
        '<div class="pos-docs">' + sampleDocs.slice(0, 20).map(function (a) {
          return '<div class="pos-doc pos-doc--ref">' + _docIcon(a.kind) + '&nbsp;<span class="pos-doc-n">' + _esc(a.name) + '</span>' +
            (a.category ? '<span class="pos-doc-cat">' + _esc(a.category) + '</span>' : '') + '</div>';
        }).join('') + '</div>';
    }

    // Property-wide timeline — what affects the building as a whole.
    var propEvents = tl.filter(function (e) { return !e.subject || e.subject.type === 'property' || e.subject.type === 'system'; })
      .sort(function (a, b) { return (new Date(b.timestamp).getTime() || 0) - (new Date(a.timestamp).getTime() || 0); });
    var tlHtml = propEvents.length
      ? '<div class="pos-tl">' + propEvents.slice(0, 10).map(function (e) {
          var d = (window.PropertyTimeline && PropertyTimeline.describe) ? PropertyTimeline.describe(e) : { label: e.type };
          return '<div class="pos-tl-row"><span class="pos-tl-w">' + _esc(_fmtDate(e.timestamp)) + '</span>' +
            '<span class="pos-tl-b">' + _esc(d.label || e.type) + '</span>' +
            '<span class="pos-tl-t">' + _esc(e.title) + '</span></div>';
        }).join('') + '</div>' + (propEvents.length > 10 ? '<div class="pos-empty">+ ' + (propEvents.length - 10) + ' earlier — full history on Overview</div>' : '')
      : _empty('Roof replacements, insurance renewals, tax appeals and capital improvements appear here.');

    // ── Property Information — reference facts, not operational alerts ──────
    var infoHtml = '';
    if (PR) {
      var info = PR.infoFor(property);
      if (info) {
        infoHtml = PR.GROUPS.map(function (g) {
          var rows = PR.FIELDS.filter(function (f) { return f.group === g; }).map(function (f) {
            return '<div class="pos-info-row"><span class="pos-info-k">' + _esc(f.label) + '</span>' +
              '<span class="pos-info-v">' + _esc(PR.formatValue(f, info[f.key], property)) + '</span></div>';
          }).join('');
          return '<div class="pos-info-grp"><div class="pos-info-grp-t">' + _esc(g) + '</div>' + rows + '</div>';
        }).join('');
        infoHtml = '<div class="pos-info">' + infoHtml + '</div>';
      } else {
        infoHtml = _empty('No property information recorded yet. Address, year built, insurance, roof and HVAC details appear here once added.');
      }
    }

    // ── Property Records — the operating surface ──────────────────────────
    var allRecs  = propertyRecords(property);
    var shown    = _applyFilter(allRecs, property);
    var PT       = window.PropertyTimeline;
    var catKeys  = (PT && PT.propertyCategories) || [];
    // Only offer a chip for a category that exists here or is a building-level
    // one — a filter that always returns nothing teaches people not to use it.
    var present  = {};
    allRecs.forEach(function (e) { if (e.category) present[e.category] = (present[e.category] || 0) + 1; });
    var chipKeys = catKeys.filter(function (k) { return present[k]; });
    Object.keys(present).forEach(function (k) { if (chipKeys.indexOf(k) < 0) chipKeys.push(k); });

    var chip = function (key, label, count, on) {
      return '<button type="button" class="pos-chip' + (on ? ' pos-chip--on' : '') + '" ' +
        'data-cat="' + _esc(key) + '" onclick="PropertyOS.setRecordFilter(this.dataset.cat, ' +
        (_filter.system ? "'" + _esc(_filter.system) + "'" : 'null') + ')">' +
        _esc(label) + (count != null ? ' <span class="pos-chip-n">' + count + '</span>' : '') + '</button>';
    };
    var chipsHtml = '<div class="pos-chips">' +
      chip('all', 'All records', allRecs.length, _filter.cat === 'all') +
      chipKeys.map(function (k) {
        var d = (PT && PT.describe) ? PT.describe({ category: k, type: k }) : { label: k };
        return chip(k, d.label || k, present[k] || 0, _filter.cat === k);
      }).join('') + '</div>';

    // Clicking a Building System must END the search, not start one: everything
    // about the Roof, in one place. That is the records whose subject IS the
    // system, PLUS the invoices tagged to it, PLUS anything linked into those
    // stories — an invoice attached to the roof job belongs under Roof even if
    // only the job carries the tag.
    var sysFilterHtml = '';
    if (_filter.system) {
      var story = systemStory(property, _filter.system);
      var sysInvTotal = story.invoices.reduce(function (t, i) { return t + i.amount; }, 0);
      sysFilterHtml = '<div class="pos-filter-note">Showing <b>' +
        _esc(systemLabel(_filter.system) || _filter.system) + '</b> \u2014 ' +
        story.events.length + ' record' + (story.events.length !== 1 ? 's' : '') +
        (story.invoices.length ? ', ' + story.invoices.length + ' invoice' +
          (story.invoices.length !== 1 ? 's' : '') + ' (' + _esc(_money(sysInvTotal)) + ')' : '') +
        ' <button type="button" class="pos-clear" onclick="PropertyOS.setRecordFilter(\'' +
        _esc(_filter.cat) + '\', null)">Clear</button></div>' +
        (story.invoices.length
          ? '<div class="pos-ri-list pos-sys-invs">' + story.invoices.map(function (i) {
              return '<div class="pos-ri-row"><span class="pos-ri-ic">\u{1F9FE}</span>' +
                '<span class="pos-ri-t">' + _esc(i.vendorName) + '</span>' +
                '<span class="pos-ri-m">Invoice \u00b7 ' + _esc(_money(i.amount)) + '</span>' +
                '<span class="pos-ri-w">' + _esc(i.invoiceDate ? _fmtDate(i.invoiceDate) : '') + '</span></div>';
            }).join('') + '</div>'
          : '');
    }

    var recHtml = shown.length
      ? '<div class="pos-recs">' + shown.slice(0, 40).map(function (e) {
          var d = (PT && PT.describe) ? PT.describe(e) : { label: e.type, icon: null };
          var subj = e.subject && e.subject.type === 'system'
            ? (systemLabel(e.subject.id) || e.subject.id) : 'Property-wide';
          var by = (e.metadata && e.metadata.recordedBy) || e.actor || null;
          var atts = (e.attachments || []).filter(function (a) { return a && a.url; });
          return '<div class="pos-rec' + (_focusId && String(e.id) === _focusId ? ' pos-rec--focus' : '') +
            '" data-rec-id="' + _esc(e.id) + '">' +
            '<div class="pos-rec-top">' +
              '<span class="pos-rec-t">' + _esc(e.title || d.label || e.type) + '</span>' +
              '<span class="pos-rec-w">' + _esc(_fmtDate(e.timestamp)) + '</span>' +
            '</div>' +
            '<div class="pos-rec-meta">' +
              '<span class="pos-rec-cat">' + (d.icon || '') + ' ' + _esc(d.label || e.category || e.type) + '</span>' +
              '<span class="pos-rec-subj">' + _esc(subj) + '</span>' +
              (by ? '<span class="pos-rec-by">Recorded by ' + _esc(by) + '</span>' : '') +
            '</div>' +
            (e.description ? '<div class="pos-rec-note">' + _esc(e.description) + '</div>' : '') +
            _relatedHtml(property, e) +
            _revHtml(e) +
            (atts.length ? '<div class="pos-rec-att">' + atts.map(function (a) {
              return '<a class="pos-doc" href="' + _esc(a.url) + '" target="_blank" rel="noopener">' +
                _docIcon(a.kind) + '&nbsp;<span class="pos-doc-n">' + _esc(a.name) + '</span></a>';
            }).join('') + '</div>' : '') +
          '</div>';
        }).join('') + '</div>' +
        (shown.length > 40 ? '<div class="pos-empty">Showing 40 of ' + shown.length + '</div>' : '')
      : _empty(allRecs.length
          ? 'Nothing recorded under this filter yet. Choose another category, or add a record.'
          : 'Nothing recorded for this building yet. Tax bills, insurance policies, surveys, site and building plans, environmental reports, capital improvements, photos and system warranties all live here — each one a dated entry on the property timeline.');

    var addBtn = '<button type="button" class="pos-add" onclick="PropertyOS.addRecord()">\u2795 Add Record</button>';

    body.innerHTML =
      (infoHtml ? _sec('Property information', null, infoHtml) : '') +
      _sec('Property records', allRecs.length, addBtn + chipsHtml + sysFilterHtml + recHtml) +
      _sec('Building systems', null, sysHtml) +
      _sec('Financials', null, finHtml) +
      _sec('Invoice register', invs.length, regHtml) +
      _sec('Documents', recDocs.length, docHtml) +
      _sec('Property timeline', propEvents.length, tlHtml);
  }

  // Opens the EXISTING timeline modal. No new persistence, no second writer —
  // the same path the Overview timeline uses, so a record added here is the
  // same kind of object as one added there.
  // Opens the SAME modal Add Record uses, in edit mode.
  function editRecord(recordId) {
    if (window.PropertyTimeline && PropertyTimeline.openEditEntry) {
      PropertyTimeline.openEditEntry(recordId);
    }
  }

  function addRecord() {
    var property = window.currentProperty && window.currentProperty();
    if (!property) return;
    if (window.PropertyTimeline && PropertyTimeline.openAddEntry) {
      PropertyTimeline.openAddEntry(property);
    }
  }

  function injectStyles() {
    if (_d('pos-styles')) return;
    var gold = '#C9973A';
    var css = [
      '.pos-sec{padding:14px 0;border-bottom:1px solid rgba(var(--line-rgb,255,255,255),0.06);}',
      // ── Property Records ──
      '.pos-setup-sum{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:11px 13px;margin-bottom:14px;border:1px solid rgba(var(--line-rgb,255,255,255),0.09);background:rgba(var(--line-rgb,255,255,255),0.03);border-radius:10px;}',
      '.pos-setup-name{font-size:0.92rem;font-weight:700;color:var(--text-1,#E2E8F0);}',
      '.pos-setup-meta{font-size:0.78rem;color:var(--text-4,#64748B);}',
      '.pos-setup-edit{margin-left:auto;font:600 0.74rem/1 inherit;color:var(--text-3,#94A3B8);background:rgba(var(--line-rgb,255,255,255),0.05);border:1px solid rgba(var(--line-rgb,255,255,255),0.14);border-radius:7px;padding:6px 12px;cursor:pointer;min-height:28px;}',
      '.pos-setup-edit:hover{color:var(--text-1,#E2E8F0);}',
      '.pos-add{font:700 0.76rem/1 inherit;color:#07090C;background:' + gold + ';border:1px solid ' + gold + ';border-radius:8px;padding:9px 15px;cursor:pointer;margin-bottom:12px;min-height:36px;}',
      '.pos-add:hover{filter:brightness(1.08);}',
      '.pos-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;}',
      '.pos-chip{font:600 0.72rem/1 inherit;color:var(--text-3,#94A3B8);background:rgba(var(--line-rgb,255,255,255),0.04);border:1px solid rgba(var(--line-rgb,255,255,255),0.1);border-radius:999px;padding:6px 11px;cursor:pointer;min-height:30px;}',
      '.pos-chip:hover{background:rgba(var(--line-rgb,255,255,255),0.09);color:var(--text-1,#E2E8F0);}',
      '.pos-chip--on{background:rgba(201,151,58,0.15);border-color:rgba(201,151,58,0.45);color:' + gold + ';}',
      '.pos-chip-n{opacity:0.65;font-weight:500;}',
      '.pos-filter-note{font-size:0.76rem;color:var(--text-3,#94A3B8);margin-bottom:9px;}',
      '.pos-clear{font:600 0.7rem/1 inherit;color:var(--text-4,#64748B);background:none;border:1px solid rgba(var(--line-rgb,255,255,255),0.14);border-radius:6px;padding:3px 8px;margin-left:8px;cursor:pointer;}',
      '.pos-recs{display:flex;flex-direction:column;gap:8px;}',
      '.pos-rec{border:1px solid rgba(var(--line-rgb,255,255,255),0.08);background:rgba(var(--line-rgb,255,255,255),0.02);border-radius:9px;padding:10px 12px;}',
      '.pos-rec-top{display:flex;justify-content:space-between;gap:10px;align-items:baseline;}',
      '.pos-rec-t{font-size:0.88rem;font-weight:600;color:var(--text-1,#E2E8F0);}',
      '.pos-rec-w{font-size:0.72rem;color:var(--text-4,#64748B);white-space:nowrap;}',
      '.pos-rec-meta{display:flex;flex-wrap:wrap;gap:10px;margin-top:4px;font-size:0.72rem;color:var(--text-4,#64748B);}',
      '.pos-rec-cat{color:' + gold + ';}',
      '.pos-rec-note{margin-top:6px;font-size:0.79rem;color:var(--text-3,#94A3B8);line-height:1.5;}',
      '.pos-rec-att{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;}',
      '.pos-docs-list{display:flex;flex-direction:column;gap:4px;}',
      '.pos-doc-row{display:flex;align-items:center;gap:9px;flex-wrap:wrap;padding:5px 0;border-bottom:1px solid rgba(var(--line-rgb,255,255,255),0.04);}',
      '.pos-doc-on{font:600 0.7rem/1 inherit;color:' + gold + ';background:rgba(201,151,58,0.09);border:1px solid rgba(201,151,58,0.3);border-radius:6px;padding:4px 9px;cursor:pointer;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-height:26px;}',
      '.pos-doc-on:hover{background:rgba(201,151,58,0.19);}',
      '.pos-doc-on--inv{cursor:default;color:var(--text-4,#64748B);background:none;border-color:rgba(var(--line-rgb,255,255,255),0.1);}',
      '.pos-doc-sys{font-size:0.7rem;color:var(--text-4,#64748B);}',
      '.pos-doc-w{font-size:0.7rem;color:var(--text-4,#64748B);margin-left:auto;}',
      '.pos-sample-head{margin:14px 0 7px;font-size:0.72rem;color:var(--text-4,#64748B);font-style:italic;}',
      '.pos-rec--focus{border-color:rgba(201,151,58,0.55)!important;box-shadow:0 0 0 2px rgba(201,151,58,0.14);}',
      '.pos-ri{margin-top:9px;padding-top:8px;border-top:1px solid rgba(var(--line-rgb,255,255,255),0.06);}',
      '.pos-ri-head{display:flex;align-items:center;gap:8px;font-size:0.72rem;font-weight:600;color:var(--text-3,#94A3B8);margin-bottom:5px;}',
      '.pos-ri-n{font-weight:500;color:var(--text-4,#64748B);}',
      '.pos-ri-add{margin-left:auto;font:600 0.7rem/1 inherit;color:' + gold + ';background:rgba(201,151,58,0.1);border:1px solid rgba(201,151,58,0.35);border-radius:6px;padding:4px 9px;cursor:pointer;min-height:26px;}',
      '.pos-ri-add:hover{background:rgba(201,151,58,0.2);}',
      '.pos-ri-empty{font-size:0.72rem;color:var(--text-4,#64748B);line-height:1.5;}',
      '.pos-ri-list{display:flex;flex-direction:column;gap:3px;}',
      '.pos-ri-row{display:flex;align-items:center;gap:8px;font-size:0.74rem;padding:4px 0;}',
      '.pos-ri-t{color:var(--text-2,#CBD5E1);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.pos-ri-m{color:var(--text-4,#64748B);white-space:nowrap;}',
      '.pos-ri-w{color:var(--text-4,#64748B);margin-left:auto;white-space:nowrap;}',
      '.pos-ri-x{background:none;border:none;color:var(--text-4,#64748B);cursor:pointer;font-size:0.7rem;padding:2px 4px;}',
      '.pos-ri-x:hover{color:var(--c-f87171,#f87171);}',
      '.pos-ri-row--missing .pos-ri-t{color:var(--c-fbbf24,#fbbf24);}',
      '.pos-ri-row--missing .pos-ri-m{font-style:italic;}',
      '.pos-sys-invs{margin:6px 0 10px;}',
      '.pos-fin-scope{margin-top:7px;font-size:0.72rem;color:var(--text-4,#64748B);}',
      '.pos-link-ov{position:fixed;inset:0;z-index:9600;background:rgba(0,0,0,0.66);display:flex;align-items:center;justify-content:center;padding:18px;}',
      '.pos-link-box{background:var(--theme-panel,#11161F);border:1px solid rgba(var(--line-rgb,255,255,255),0.12);border-radius:12px;padding:18px;max-width:520px;width:100%;}',
      '.pos-link-head{display:flex;align-items:center;font-size:0.95rem;font-weight:700;color:var(--text-1,#E2E8F0);margin-bottom:6px;}',
      '.pos-link-x{margin-left:auto;background:none;border:none;color:var(--text-4,#64748B);font-size:0.95rem;cursor:pointer;}',
      '.pos-link-sub{font-size:0.78rem;color:var(--text-3,#94A3B8);line-height:1.55;margin:0 0 12px;}',
      '.pos-link-sel{width:100%;box-sizing:border-box;padding:9px 10px;border-radius:8px;border:1px solid rgba(var(--line-rgb,255,255,255),0.16);background:var(--theme-surface,#0d1218);color:var(--text-1,#E2E8F0);font-size:0.84rem;}',
      '.pos-link-acts{display:flex;gap:9px;justify-content:flex-end;margin-top:14px;}',
      '.pos-link-cancel{padding:8px 16px;border-radius:7px;font:600 0.8rem/1 inherit;background:rgba(var(--line-rgb,255,255,255),0.04);border:1px solid rgba(var(--line-rgb,255,255,255),0.1);color:var(--text-3,#94A3B8);cursor:pointer;}',
      '.pos-link-go{padding:8px 16px;border-radius:7px;font:700 0.8rem/1 inherit;background:' + gold + ';border:1px solid ' + gold + ';color:#07090C;cursor:pointer;}',
      '.pos-revs{margin-top:8px;}',
      '.pos-revs>summary{font-size:0.72rem;color:var(--text-4,#64748B);cursor:pointer;list-style:none;}',
      '.pos-revs>summary::-webkit-details-marker{display:none;}',
      '.pos-revs>summary:hover{color:var(--text-2,#CBD5E1);}',
      '.pos-revs[open]>summary{color:var(--text-3,#94A3B8);margin-bottom:5px;}',
      '.pos-rev{display:flex;gap:9px;padding:3px 0;font-size:0.72rem;color:var(--text-4,#64748B);border-top:1px solid rgba(var(--line-rgb,255,255,255),0.05);}',
      '.pos-rev-w{white-space:nowrap;opacity:0.8;}',
      '.pos-rev-t{color:var(--text-3,#94A3B8);}',
      '.pos-sys-cell{cursor:pointer;}',
      '.pos-sys-cell--sel{border-color:rgba(201,151,58,0.5)!important;background:rgba(201,151,58,0.08)!important;}',
      // Mobile: every one of these rows is flex with nowrap text in it, and a
      // flex child will not shrink below its content unless min-width:0 says
      // so. Without this a record card measured 623px inside a 284px column and
      // the whole page scrolled sideways. Wrap the rows — do NOT reach for
      // overflow-x:auto, which hides a layout bug behind a scrollbar.
      '.pos-rec,.pos-ri,.pos-ri-list,.pos-docs-list{min-width:0;}',
      // A grid track is min-content by default, so a cell holding "Fire
      // Suppression" refuses to go below its widest word and pushes the grid
      // 5px past its column. Predates this work; fixed here because Building
      // Systems is the surface this sprint is building on.
      '.pos-sys-cell{min-width:0;box-sizing:border-box;}',
      // Wrap BETWEEN words, never inside them. overflow-wrap:anywhere fixed a
      // 5px overflow and produced "Fire Suppressio n" / "Landscapin g", which
      // reads as broken software. Balanced wrapping plus a narrower minimum
      // column keeps the grid inside its container without cutting words.
      '.pos-sys-l{min-width:0;overflow-wrap:normal;word-break:normal;hyphens:none;line-height:1.25;text-wrap:balance;}',
      '.pos-rec-t{min-width:0;overflow-wrap:anywhere;}',
      '.pos-ri-t,.pos-doc,.pos-doc-on{min-width:0;}',
      '@media(max-width:600px){',
      '  .pos-add{width:100%;}',
      '  .pos-rec-top{flex-direction:column;gap:2px;}',
      // Three actions (Edit, Attach, Link) will not sit beside the label on a
      // phone. Give the label its own line so the buttons get a full-width row
      // instead of stacking one per line and squeezing the list beside them.
      '  .pos-ri-head{flex-wrap:wrap;row-gap:7px;}',
      '  .pos-ri-head>span:first-child,.pos-ri-head>.pos-ri-n{flex:0 0 auto;}',
      '  .pos-ri-head .pos-ri-add{margin-left:0;flex:0 1 auto;text-align:center;}',
      '  .pos-ri-head .pos-ri-add:first-of-type{margin-left:0;}',
      '  .pos-ri-row,.pos-doc-row{flex-wrap:wrap;row-gap:2px;}',
      '  .pos-ri-t{flex:1 1 100%;white-space:normal;overflow-wrap:anywhere;}',
      '  .pos-ri-w,.pos-doc-w{margin-left:0;}',
      '  .pos-ri-x{margin-left:auto;}',
      '  .pos-doc{flex:1 1 100%;overflow-wrap:anywhere;}',
      '  .pos-doc-on{max-width:100%;white-space:normal;text-align:left;}',
      '}',
      '.pos-sec:last-child{border-bottom:none;}',
      '.pos-sec-head{display:flex;align-items:center;gap:8px;margin-bottom:9px;}',
      '.pos-sec-title{font-size:0.74rem;font-weight:800;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-4,#64748B);}',
      '.pos-sec-count{font-size:0.66rem;font-weight:800;color:var(--text-3,#94A3B8);background:rgba(var(--line-rgb,255,255,255),0.07);border-radius:20px;padding:1px 8px;}',
      '.pos-empty{font-size:0.78rem;color:var(--text-4,#64748B);line-height:1.5;}',
      '.pos-note{font-size:0.72rem;color:var(--text-4,#64748B);margin-top:8px;font-style:italic;}',
      '.pos-fin{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;}',
      '.pos-fin-cell{background:var(--theme-panel,#0A0D12);border:1px solid rgba(var(--line-rgb,255,255,255),0.08);border-radius:10px;padding:11px 13px;}',
      '.pos-fin-v{font-size:1.05rem;font-weight:800;color:var(--text-1,#E2E8F0);}',
      '.pos-fin-l{font-size:0.72rem;color:var(--text-4,#64748B);margin-top:2px;}',
      '.pos-reg{display:flex;flex-direction:column;gap:9px;}',
      '.pos-inv{background:var(--theme-panel,#0A0D12);border:1px solid rgba(var(--line-rgb,255,255,255),0.08);border-radius:10px;padding:11px 13px;}',
      '.pos-inv-top{display:flex;align-items:baseline;gap:10px;}',
      '.pos-inv-vendor{font-size:0.86rem;font-weight:700;color:var(--text-1,#E2E8F0);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.pos-inv-amt{margin-left:auto;font-size:0.86rem;font-weight:800;color:' + gold + ';flex:none;}',
      '.pos-inv-meta{font-size:0.74rem;color:var(--text-4,#64748B);margin-top:2px;}',
      '.pos-inv-rel{display:flex;flex-wrap:wrap;gap:8px;margin-top:9px;}',
      '.pos-rel{display:flex;align-items:center;gap:5px;font-size:0.72rem;color:var(--text-4,#64748B);}',
      '.pos-rel select{padding:6px 8px;border-radius:7px;font:0.75rem inherit;background:var(--theme-card,#0F1217);border:1px solid rgba(var(--line-rgb,255,255,255),0.14);color:var(--text-1,#E2E8F0);max-width:150px;}',
      '.pos-rel select:focus{outline:none;border-color:' + gold + ';}',
      '.pos-rel--chk{background:var(--theme-card,#0F1217);border:1px solid rgba(var(--line-rgb,255,255,255),0.14);border-radius:7px;padding:6px 9px;cursor:pointer;}',
      '.pos-rel--chk input{accent-color:' + gold + ';width:15px;height:15px;}',
      '.pos-sys{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:8px;}',
      '.pos-sys-cell{display:flex;align-items:center;gap:7px;background:var(--theme-panel,#0A0D12);border:1px solid rgba(var(--line-rgb,255,255,255),0.08);border-radius:9px;padding:9px 11px;}',
      '.pos-sys-cell--on{border-color:rgba(201,151,58,0.4);}',
      '.pos-sys-l{font-size:0.8rem;color:var(--text-2,#CBD5E1);}',
      '.pos-sys-n{margin-left:auto;font-size:0.68rem;color:var(--text-4,#64748B);flex:none;}',
      '.pos-docs{display:flex;flex-direction:column;gap:5px;}',
      '.pos-doc{display:flex;align-items:center;gap:7px;font-size:0.78rem;color:var(--text-2,#CBD5E1);text-decoration:none;background:var(--theme-panel,#0A0D12);border:1px solid rgba(var(--line-rgb,255,255,255),0.1);border-radius:8px;padding:8px 10px;}',
      '.pos-doc:hover{border-color:' + gold + ';}',
      '.pos-doc-n{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.pos-doc-w{margin-left:auto;font-size:0.7rem;color:var(--text-4,#64748B);flex:none;}',
      '.pos-doc--ref{cursor:default;}',
      '.pos-doc-cat{font-size:0.62rem;font-weight:700;text-transform:uppercase;letter-spacing:0.03em;color:var(--text-4,#64748B);background:rgba(var(--line-rgb,255,255,255),0.06);border-radius:5px;padding:1px 6px;margin-left:8px;flex:none;}',
      // Property information — reference facts, calm and scannable
      '.pos-info{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;}',
      '.pos-info-grp-t{font-size:0.66rem;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:' + gold + ';margin-bottom:7px;}',
      '.pos-info-row{display:flex;gap:10px;padding:5px 0;border-bottom:1px solid rgba(var(--line-rgb,255,255,255),0.05);font-size:0.8rem;}',
      '.pos-info-row:last-child{border-bottom:none;}',
      '.pos-info-k{flex:none;width:130px;color:var(--text-4,#64748B);}',
      '.pos-info-v{flex:1;color:var(--text-1,#E2E8F0);min-width:0;}',
      '.pos-tl{display:flex;flex-direction:column;gap:6px;}',
      '.pos-tl-row{display:flex;align-items:center;gap:9px;font-size:0.8rem;}',
      '.pos-tl-w{color:var(--text-4,#64748B);font-size:0.72rem;flex:none;width:96px;}',
      '.pos-tl-b{font-size:0.62rem;font-weight:800;color:var(--text-3,#94A3B8);background:rgba(var(--line-rgb,255,255,255),0.07);border-radius:5px;padding:1px 6px;flex:none;}',
      '.pos-tl-t{color:var(--text-2,#CBD5E1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '@media (max-width:480px){',
      '  .pos-tl-w{width:74px;}',
      '  .pos-rel select{max-width:120px;}',
      '  .pos-sys{grid-template-columns:1fr 1fr;}',
      '  .pos-sys-cell{align-items:flex-start;}',
      '}',
    ].join('\n');
    var s = document.createElement('style'); s.id = 'pos-styles'; s.textContent = css;
    document.head.appendChild(s);
  }

  return {
    BUILDING_SYSTEMS: BUILDING_SYSTEMS, systemLabel: systemLabel,
    setRecordFilter: setRecordFilter, addRecord: addRecord, editRecord: editRecord, propertyRecords: propertyRecords,
    toggleSetup: toggleSetup, renderSetupSummary: renderSetupSummary,
    relatedGroup: relatedGroup, systemStory: systemStory,
    propertyDocuments: propertyDocuments, openRecord: openRecord, ensureInvoiceIds: ensureInvoiceIds,
    attachToRecord: attachToRecord, pickAttachment: pickAttachment,
    linkRecord: linkRecord, unlinkRecord: unlinkRecord, openLinkPicker: openLinkPicker,
    invoices: invoices, setInvoiceRelation: setInvoiceRelation,
    init: init, renderPropertyPage: renderPropertyPage,
  };
})();
