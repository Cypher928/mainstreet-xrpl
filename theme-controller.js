/**
 * theme-controller.js
 * Global, application-level theme system on top of the CSS design tokens.
 *
 * A theme is nothing but a set of token values in index.html:
 *   :root (default)              → Obsidian
 *   :root[data-theme="midnight"] → Midnight (navy)
 *   :root[data-theme="torch"]    → Torch (light)
 * This controller is the single source of truth for the *selected* theme: it
 * sets <html data-theme>, persists the choice to localStorage, keeps the meta
 * theme-color in sync, and wires the UI controls. No component styles here.
 *
 * The pre-paint apply happens in the inline <head> bootstrap (no FOUC); this
 * module re-applies on load and handles user changes.
 */
(function () {
  'use strict';

  var KEY = 'mainstreet-theme';
  var THEMES = [
    { id: 'obsidian', label: 'Obsidian' },
    { id: 'midnight', label: 'Midnight' },
    { id: 'torch',    label: 'Torch (Light)' },
  ];
  var VALID = THEMES.map(function (t) { return t.id; });
  var DEFAULT = 'obsidian';

  function get() {
    try {
      var v = localStorage.getItem(KEY);
      return VALID.indexOf(v) >= 0 ? v : DEFAULT;
    } catch (_) { return DEFAULT; }
  }

  function labelOf(id) {
    for (var i = 0; i < THEMES.length; i++) if (THEMES[i].id === id) return THEMES[i].label;
    return id;
  }

  function syncControls(id) {
    var sel = document.getElementById('themeSelect');
    if (sel && sel.value !== id) sel.value = id;
    var cur = document.getElementById('wsThemeCurrent');
    if (cur) cur.textContent = labelOf(id);
  }

  // Keep the browser-chrome color (mobile) matching the current page background.
  function syncMeta() {
    try {
      var m = document.querySelector('meta[name="theme-color"]');
      if (!m) return;
      var bg = getComputedStyle(document.documentElement).getPropertyValue('--theme-bg').trim();
      if (bg) m.setAttribute('content', bg);
    } catch (_) {}
  }

  function apply(id) {
    if (VALID.indexOf(id) < 0) id = DEFAULT;
    document.documentElement.setAttribute('data-theme', id);
    syncMeta();
    syncControls(id);
  }

  function set(id) {
    if (VALID.indexOf(id) < 0) id = DEFAULT;
    try { localStorage.setItem(KEY, id); } catch (_) {}
    apply(id);
  }

  // Cycle Obsidian → Midnight → Torch → Obsidian (used by the mobile menu row).
  function cycle() {
    var i = VALID.indexOf(get());
    set(VALID[(i + 1) % VALID.length]);
  }

  function init() {
    apply(get()); // re-assert (bootstrap already set it pre-paint)
    var sel = document.getElementById('themeSelect');
    if (sel && !sel.dataset.themeBound) {
      sel.dataset.themeBound = '1';
      sel.innerHTML = THEMES.map(function (t) {
        return '<option value="' + t.id + '">' + t.label + '</option>';
      }).join('');
      sel.value = get();
      sel.addEventListener('change', function () { set(sel.value); });
    }
    syncControls(get());
  }

  window.MainStreetTheme = {
    THEMES: THEMES, get: get, set: set, apply: apply, cycle: cycle, init: init,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
