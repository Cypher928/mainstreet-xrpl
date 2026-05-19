/**
 * dev-switcher.js
 * DEV-ONLY role switcher panel for Phase 7 access-control testing.
 *
 * Activates ONLY on localhost / 127.0.0.1. Returns immediately on any
 * other hostname — zero production exposure.
 *
 * Requires (loaded before this file): auth-service.js, access-control.js
 * Optional: fixtures/auth-sessions.js (QAFixtures) — has inline fallbacks.
 *
 * Usage: open the app on localhost, use the panel to switch roles and
 * verify that the correct UI sections appear/hide per access-control rules.
 */
(function () {
  'use strict';

  // ── Production guard ────────────────────────────────────────────────────────
  const _host = window.location.hostname;
  if (_host !== 'localhost' && _host !== '127.0.0.1' && _host !== '') return;

  // ── Pre-normalized dev users (fallbacks when QAFixtures not loaded) ─────────
  // These match the shape AuthService.setUser() expects.
  const _DEV_USERS = {
    landlord: {
      id: 'dev-landlord', email: 'dev-landlord@localhost',
      role: 'landlord', displayName: 'Dev Landlord',
      propertyIds: [], createdAt: null,
    },
    tenant: {
      id: 'dev-tenant', email: 'dev-tenant@localhost',
      role: 'tenant', displayName: 'Dev Tenant',
      propertyIds: [], createdAt: null,
    },
    reviewer: {
      id: 'dev-reviewer', email: 'dev-reviewer@localhost',
      role: 'reviewer', displayName: 'Dev Reviewer',
      propertyIds: [], createdAt: null,
    },
    admin: {
      id: 'dev-admin', email: 'dev-admin@localhost',
      role: 'admin', displayName: 'Dev Admin',
      propertyIds: [], createdAt: null,
    },
  };

  /**
   * Returns a pre-normalized user for the given role.
   * Prefers QAFixtures (hydrated via AuthService) so the full normalization
   * path is exercised; falls back to the inline _DEV_USERS table.
   * @param {'landlord'|'tenant'|'reviewer'|'admin'} role
   * @returns {object}
   */
  function _userForRole(role) {
    const AS  = window.AuthService;
    const fx  = window.QAFixtures;
    const map = { landlord: 'sbLandlord', tenant: 'sbTenant', reviewer: 'sbReviewer', admin: 'sbAdmin' };
    const raw = fx && fx[map[role]];
    if (AS && raw) {
      // hydrateFromSupabaseUser normalizes the raw fixture; we read the result
      // back so the dev user matches what production normalization would produce.
      const norm = AS.hydrateFromSupabaseUser(raw);
      if (norm) return norm;
    }
    return _DEV_USERS[role];
  }

  // ── Role switch ──────────────────────────────────────────────────────────────

  function _applyRole(role) {
    const AS = window.AuthService;
    if (!AS) {
      console.warn('[DevSwitcher] AuthService not ready');
      return;
    }

    // 1. Set normalized user via AuthService.setUser()
    const user = AS.setUser(_userForRole(role));
    if (!user) return;

    // 2. Update data-role on #appContent (drives CSS section gating)
    const appEl = document.getElementById('appContent');
    if (appEl) appEl.setAttribute('data-role', role);

    // 3. Sync header role badge
    const badgeEl = document.getElementById('headerRoleBadge');
    if (badgeEl) {
      badgeEl.textContent = role;
      badgeEl.setAttribute('data-role', role);
      badgeEl.style.display = '';
    }

    // 4. Sync header email
    const emailEl = document.getElementById('headerUserEmail');
    if (emailEl) emailEl.textContent = user.email;

    // 5. Handle view routing
    const dashEl    = document.getElementById('portfolioDashboard');
    const wfEl      = document.getElementById('mainWorkflow');
    const portalMsg = document.getElementById('tenantPortalMsg');

    if (role === 'tenant') {
      // Tenant portal: show dashboard, hide workflow, reveal welcome message
      if (dashEl)    dashEl.style.display    = 'block';
      if (wfEl)      wfEl.style.display      = 'none';
      if (portalMsg) portalMsg.style.display  = 'block';
    } else {
      // All other roles: hide tenant welcome, restore portfolio if dashboard is hidden
      if (portalMsg) portalMsg.style.display = 'none';
      if (dashEl && dashEl.style.display === 'none') dashEl.style.display = 'block';
    }

    // 6. Update the panel's own status display
    _syncPanelStatus(role);

    console.log('[DevSwitcher] role =', role, '| user:', user.email, '| displayName:', user.displayName);
  }

  // ── Panel DOM ────────────────────────────────────────────────────────────────

  function _syncPanelStatus(role) {
    const statusEl = document.getElementById('_ds_status');
    if (statusEl) statusEl.textContent = role;
    const selectEl = document.getElementById('_ds_select');
    if (selectEl && selectEl.value !== role) selectEl.value = role;
  }

  function _buildPanel() {
    const panel = document.createElement('div');
    panel.id = '_devRoleSwitcher';

    panel.innerHTML =
      '<div id="_ds_hdr">' +
        '<span id="_ds_lbl">&#x1F6E1;&nbsp;DEV</span>' +
        '<button id="_ds_close" title="Dismiss panel">&#x2715;</button>' +
      '</div>' +
      '<div id="_ds_body">' +
        '<label id="_ds_label" for="_ds_select">Switch role</label>' +
        '<select id="_ds_select">' +
          '<option value="landlord">Landlord</option>' +
          '<option value="tenant">Tenant</option>' +
          '<option value="reviewer">Reviewer</option>' +
          '<option value="admin">Admin</option>' +
        '</select>' +
        '<div id="_ds_hint">Active: <span id="_ds_status">—</span></div>' +
      '</div>';

    // ── Inline styles (self-contained, no external CSS dependency) ───────────
    panel.style.cssText =
      'position:fixed;bottom:20px;right:20px;z-index:99999;' +
      'background:#1e293b;border:1px solid rgba(245,158,11,0.6);border-radius:8px;' +
      'box-shadow:0 4px 24px rgba(0,0,0,0.55);font-family:monospace;' +
      'font-size:12px;color:#e2e8f0;min-width:154px;overflow:hidden;user-select:none;';

    const hdr = panel.querySelector('#_ds_hdr');
    hdr.style.cssText =
      'display:flex;align-items:center;justify-content:space-between;' +
      'padding:6px 10px;background:rgba(245,158,11,0.08);' +
      'border-bottom:1px solid rgba(245,158,11,0.3);';

    const lbl = panel.querySelector('#_ds_lbl');
    lbl.style.cssText = 'color:#f59e0b;font-weight:700;letter-spacing:0.08em;font-size:11px;';

    const closeBtn = panel.querySelector('#_ds_close');
    closeBtn.style.cssText =
      'background:none;border:none;color:#64748b;cursor:pointer;' +
      'font-size:12px;padding:0 2px;line-height:1;font-family:monospace;';
    closeBtn.addEventListener('click', function () { panel.style.display = 'none'; });

    const body = panel.querySelector('#_ds_body');
    body.style.cssText = 'padding:8px 10px;display:flex;flex-direction:column;gap:5px;';

    const labelEl = panel.querySelector('#_ds_label');
    labelEl.style.cssText =
      'font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;';

    const sel = panel.querySelector('#_ds_select');
    sel.style.cssText =
      'background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:4px;' +
      'padding:4px 6px;font-family:monospace;font-size:12px;cursor:pointer;width:100%;';
    sel.addEventListener('change', function (e) { _applyRole(e.target.value); });

    const hint = panel.querySelector('#_ds_hint');
    hint.style.cssText = 'font-size:10px;color:#64748b;';
    const statusEl = hint.querySelector('#_ds_status');
    statusEl.style.cssText = 'color:#f59e0b;font-weight:700;';

    return panel;
  }

  // ── Initialise ───────────────────────────────────────────────────────────────

  function _init() {
    if (!window.AuthService) {
      console.warn('[DevSwitcher] AuthService not found — panel skipped');
      return;
    }

    const panel = _buildPanel();
    document.body.appendChild(panel);

    // Reflect whatever role is already active (set by _showApp on page load)
    const currentUser = window.AuthService.getCurrentUser();
    if (currentUser) _syncPanelStatus(currentUser.role);

    // Stay in sync if _showApp fires after us (auth session restores async)
    const appEl = document.getElementById('appContent');
    if (appEl) {
      new MutationObserver(function (mutations) {
        mutations.forEach(function (m) {
          if (m.attributeName === 'data-role') {
            _syncPanelStatus(appEl.getAttribute('data-role') || 'landlord');
          }
        });
      }).observe(appEl, { attributes: true, attributeFilter: ['data-role'] });
    }
  }

  // Defer one tick so all synchronous scripts have finished executing,
  // then wait for the window load event so async auth state has settled.
  window.addEventListener('load', function () { setTimeout(_init, 0); });

})();
