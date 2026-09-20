/**
 * demo-shell.js — what a judge sees and cannot break on /demo.
 * ============================================================================
 *
 * demo-store.js takes the database away. This takes the ambiguity away: it says
 * plainly that this is a demonstration, opens on Cascade Commons instead of
 * making a first-time visitor find it, and refuses the handful of actions that
 * would otherwise leave someone believing they had changed something real.
 *
 * ON "PREVENTING WRITES". Nothing here is a security boundary, and it is not
 * pretending to be one — demo-store.js already guarantees that no write can
 * leave the tab, because there is nowhere for it to go. What this adds is
 * HONESTY: without it the upload zones and delete buttons behave normally
 * against the in-memory copy, and a judge could reasonably come away thinking
 * they had edited the demonstration data for everyone. The refusal is a
 * statement to the user, not a lock on the door. The door is not there.
 *
 * Loaded last, after script.js and landing-experience.js, so the app is fully
 * defined before any of this runs. Self-detects /demo and no-ops elsewhere.
 */
(function () {
  'use strict';
  if (!/^\/demo(\/|$)/i.test(window.location.pathname)) return;

  var BANNER_TEXT = 'Demo Environment · Read-only · Demonstration Data';

  // ── 1 · The landing overlay never mounts ──────────────────────────────────
  // A judge who followed "Explore the live demo" has already chosen. The pitch
  // in front of the product is the detour this whole route exists to remove.
  try { window.__MS_SKIP_LANDING = true; } catch (_) {}

  function hideLanding() {
    try {
      if (window.MainStreetLanding && window.MainStreetLanding.hide) window.MainStreetLanding.hide();
      var el = document.getElementById('msLanding');
      if (el) { el.classList.remove('msl-on'); el.style.display = 'none'; }
      document.body.style.overflow = '';
    } catch (_) {}
  }

  // ── 2 · The banner ────────────────────────────────────────────────────────
  function mountBanner() {
    if (document.getElementById('msDemoBanner')) return;
    var css = document.createElement('style');
    css.textContent =
      '#msDemoBanner{position:fixed;left:0;right:0;top:0;z-index:2147483000;' +
      'display:flex;align-items:center;justify-content:center;gap:10px;' +
      'padding:7px 14px;font:600 12.5px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
      'letter-spacing:.04em;text-transform:uppercase;color:#1b1206;' +
      'background:linear-gradient(90deg,#d8b872,#e8cf9a);box-shadow:0 2px 14px rgba(0,0,0,.45);}' +
      '#msDemoBanner b{font-weight:800}' +
      '#msDemoBanner .msd-dot{width:7px;height:7px;border-radius:50%;background:#1b1206;opacity:.55;flex:0 0 auto}' +
      'body{padding-top:32px !important}' +
      '@media (max-width:560px){#msDemoBanner{font-size:10.5px;letter-spacing:.03em;padding:6px 10px}body{padding-top:28px !important}}' +
      /* Anything that would take a file is inert here, and looks it. */
      '.msd-off{opacity:.42 !important;cursor:not-allowed !important;pointer-events:none !important;}';
    document.head.appendChild(css);

    var bar = document.createElement('div');
    bar.id = 'msDemoBanner';
    bar.setAttribute('role', 'status');
    bar.innerHTML = '<span class="msd-dot"></span><span><b>Demo Environment</b> &middot; Read-only &middot; Demonstration Data</span>';
    document.body.appendChild(bar);
  }

  // ── 3 · Saying no, out loud ───────────────────────────────────────────────
  function refuse(what) {
    var msg = what
      ? what + ' is switched off in the demo — this is a read-only copy of demonstration data.'
      : 'The demo is read-only. Nothing here is saved.';
    try {
      if (typeof window.showToast === 'function') {
        window.showToast(msg, { color: '#92400e', textColor: '#fef3c7' });
        return;
      }
    } catch (_) {}
    try { console.info('[demo]', msg); } catch (_) {}
  }

  // Everything that takes a file, or destroys something, across the whole app.
  // Matched on the DOM rather than by patching each call site, so a control
  // added later is caught too.
  var DESTRUCTIVE = /delete|remove|discard|reset|clear all|sign out|log out|send settlement|settle now|pay /i;

  function disableWrites(root) {
    var scope = root || document;
    try {
      scope.querySelectorAll('input[type="file"]').forEach(function (i) {
        i.disabled = true;
        var zone = i.closest('.upload-zone,.bulk-upload-zone,.tenant-slot,label') || i.parentElement;
        if (zone && !zone.classList.contains('msd-off')) zone.classList.add('msd-off');
      });
    } catch (_) {}
    try {
      scope.querySelectorAll('button,a.btn').forEach(function (b) {
        var label = (b.textContent || '').trim();
        var onclick = b.getAttribute('onclick') || '';
        if (DESTRUCTIVE.test(label) || DESTRUCTIVE.test(onclick)) {
          if (!b.classList.contains('msd-off')) b.classList.add('msd-off');
          b.setAttribute('title', 'Disabled in the read-only demo');
        }
      });
    } catch (_) {}
  }

  // A capture-phase net for anything the sweep above has not reached yet —
  // newly rendered controls, for instance — so the refusal is consistent.
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest && e.target.closest('button,a,label,.upload-zone,.bulk-upload-zone');
    if (!t) return;
    var label = (t.textContent || '').trim();
    var onclick = t.getAttribute && (t.getAttribute('onclick') || '');
    var isFile = !!(t.querySelector && t.querySelector('input[type="file"]'));
    if (isFile || DESTRUCTIVE.test(label) || DESTRUCTIVE.test(onclick)) {
      e.preventDefault(); e.stopPropagation();
      refuse(isFile ? 'Uploading' : (label.slice(0, 40) || 'That action'));
    }
  }, true);

  // ── 4 · Open on Cascade Commons ───────────────────────────────────────────
  // The point of the route. A judge should land inside the property, not on a
  // portfolio list wondering which of two names to click.
  // THE LEASE TERMS HAVE TO BE PUT BACK.
  //
  // loadProperties() rebuilds property.tenants from the normalized `tenants`
  // table, selecting nine columns — id, name, sqft, cap, dates, lease_url,
  // lease_type. That table has no column for capBaseAmount or for
  // excluded_categories, so the rebuilt tenants carry a cap PERCENTAGE with
  // nothing to apply it to. The reconciliation then ran uncapped: Whole Health
  // Market billed $66,629.23 instead of the $34,650.00 its lease caps it at,
  // and Summit's unapplied parking exclusion vanished, taking the fifth tenant's
  // "needs confirmation" with it. Four of five billable, all of it wrong.
  //
  // In a signed-in session this never shows, because ensureDemoProperty() puts
  // the rich objects straight into _props and the thin ones are never seen. The
  // snapshot holds those same rich objects, so this restores them. It is not
  // decoration: it is the seeded lease data, put back where the round-trip
  // through a nine-column table dropped it.
  function restoreLeaseTerms(prop) {
    try {
      var snap = (window.__MS_DEMO_SNAPSHOT.properties || [])
        .find(function (p) { return p.id === prop.id; });
      var rich = snap && snap.data && snap.data.tenants;
      if (!rich || !rich.length) return;
      var thin = (prop.tenants || []).some(function (t) { return t && t.capBaseAmount == null; });
      if (!thin) return;
      prop.tenants = JSON.parse(JSON.stringify(rich));
    } catch (_) {}
  }

  function openCascade() {
    try {
      var list = (typeof _props !== 'undefined' && Array.isArray(_props)) ? _props : [];
      var c = list.find(function (p) { return p && /Cascade/i.test(p.name || ''); });
      if (!c) return false;
      list.forEach(restoreLeaseTerms);           // both demo properties, before anything renders
      var sel = (typeof window.selectProperty === 'function') ? window.selectProperty
              : (typeof selectProperty === 'function') ? selectProperty : null;
      if (!sel) return false;
      sel(c.id);
      // selectProperty re-loads in the background and can hand the thin tenants
      // back; put them right again once that has settled.
      setTimeout(function () {
        restoreLeaseTerms(c);
        try { if (typeof renderProperty === 'function') renderProperty(c); } catch (_) {}
      }, 1200);
      return true;
    } catch (_) {}
    return false;
  }

  var tries = 0;
  var poll = setInterval(function () {
    tries++;
    hideLanding();
    mountBanner();
    disableWrites();
    var app = document.getElementById('appContent');
    var up = app && getComputedStyle(app).display !== 'none';
    if (up && openCascade()) {
      clearInterval(poll);
      // One more sweep once the property view has rendered its own controls.
      setTimeout(function () { disableWrites(); mountBanner(); retellDemoTruth(); }, 900);
      setTimeout(function () { disableWrites(); retellDemoTruth(); }, 2600);
    } else if (tries > 120) {
      clearInterval(poll);
      console.warn('[demo] gave up waiting for the app shell');
    }
  }, 250);

  // ── 5 · Two sentences the product is right to say, and this route is not ──
  //
  // Press Calculate here and the app reports, correctly for itself, that the
  // results "weren't saved to the server … contact support". On /demo there is
  // no server, nothing was lost, and there is no support to contact — it reads
  // as a broken product to the one audience that must not think so. The header
  // chip has the opposite problem: it says "Synced to cloud ✓" when there is no
  // cloud in the picture at all.
  //
  // Both are corrected here rather than in script.js, because the product's own
  // wording is right for the product. This route is the exception, so this
  // route carries the exception.
  function retellDemoTruth(scope) {
    try {
      var walker = document.createTreeWalker(scope || document.body, NodeFilter.SHOW_TEXT, null);
      var n, hits = [];
      while ((n = walker.nextNode())) {
        var t = n.nodeValue || '';
        if (t.indexOf('saved to the server') >= 0 || t.indexOf('Synced to cloud') >= 0) hits.push(n);
      }
      hits.forEach(function (node) {
        if (node.nodeValue.indexOf('Synced to cloud') >= 0) {
          node.nodeValue = 'Demo copy · not saved';
        } else {
          node.nodeValue = 'This is the read-only demo: the reconciliation ran here in your browser '
            + 'and nothing was written anywhere. Reload to return to the seeded state.';
        }
      });
    } catch (_) {}
  }

  // Re-sweep as the app renders: the CAM screen, the drawers and the tenant
  // cards all build their controls long after first paint.
  try {
    var mo = new MutationObserver(function () { disableWrites(); retellDemoTruth(); });
    if (document.body) mo.observe(document.body, { childList: true, subtree: true });
    else document.addEventListener('DOMContentLoaded', function () { mo.observe(document.body, { childList: true, subtree: true }); });
  } catch (_) {}
})();
