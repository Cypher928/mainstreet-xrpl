/**
 * portal.js — Phase B1: the tenant portal.
 * ============================================================================
 * A SEPARATE bundle from script.js, on purpose.
 *
 * The landlord application carries the audit engine, the review queue, the
 * dispute workspace, allocation, F-02 and every landlord workflow. Serving that
 * to a tenant and hiding parts of it with CSS is not authorization — the code
 * and the logic embedded in it sit in the tenant's browser either way, and
 * `display:none` is a styling instruction, not a boundary. So the portal ships
 * only what a tenant needs.
 *
 * This file is deliberately small and deliberately dumb about permissions. It
 * asks the database for what the signed-in user may see and renders that.
 * Every restriction is enforced in Postgres by RLS (migrations 012/014):
 *
 *   tenants           tenant sees only ids returned by tenant_ids_for_current_user()
 *   tenant_users      tenant sees only its own membership rows
 *   tenant_invitations NO tenant policy at all — zero rows, always
 *   properties        no tenant policy — zero rows
 *   evidence / audit / lease_documents / cam_reconciliations — zero rows
 *
 * If this file had a bug that asked for the whole properties table, the answer
 * would still be zero rows. That is the property worth preserving: the portal
 * is a view over an authorization boundary, never the boundary itself.
 *
 * B1 scope: sign in, redeem an invitation, see your own space. Statements,
 * documents, payments and questions are B2-B4 and are not present here.
 */
(function () {
  'use strict';

  var cfg = window.__MS_SUPABASE || {};
  var db  = (window.supabase && cfg.url)
    ? window.supabase.createClient(cfg.url, cfg.anonKey)
    : null;

  var $ = function (id) { return document.getElementById(id); };

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function show(id) {
    ['pViewAuth', 'pViewSpace', 'pViewEmpty'].forEach(function (v) {
      var el = $(v); if (el) el.hidden = (v !== id);
    });
  }

  function status(msg, kind) {
    var el = $('pStatus');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'p-status' + (kind ? ' p-status--' + kind : '');
    el.hidden = !msg;
  }

  // The invitation token arrives in the URL. Strip it from the address bar as
  // soon as it is read: a single-use secret should not sit in history, in a
  // bookmark, or in the Referer of anything the page later loads.
  function takeToken() {
    var p = new URLSearchParams(window.location.search);
    var t = p.get('invite');
    if (!t) return null;
    p.delete('invite');
    var q = p.toString();
    window.history.replaceState({}, '', window.location.pathname + (q ? '?' + q : ''));
    return t;
  }
  var pendingInvite = takeToken();

  async function acceptInvite(token, accessToken) {
    var r = await fetch('/api/tenant-accept-invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + accessToken },
      body: JSON.stringify({ token: token }),
    });
    var body = await r.json().catch(function () { return {}; });
    return { ok: r.ok && body.ok === true, error: body.error };
  }

  async function loadSpace() {
    // Two reads, both RLS-scoped. No property id, no landlord table, no filter
    // supplied by this client that the database is trusting.
    var mem = await db.from('tenant_users')
      .select('tenant_id, property_id, accepted_at, revoked_at');
    if (mem.error) { status('Could not load your account.', 'error'); return; }

    var active = (mem.data || []).filter(function (m) {
      return m.accepted_at && !m.revoked_at;
    });

    if (window.AuthService && typeof window.AuthService.setTenantIds === 'function') {
      window.AuthService.setTenantIds(active.map(function (m) { return m.tenant_id; }));
    }

    if (!active.length) { show('pViewEmpty'); return; }

    var sp = await db.from('tenants')
      .select('id, name, sqft, lease_type, start_date, end_date');
    if (sp.error) { status('Could not load your space.', 'error'); return; }

    var rows = sp.data || [];
    if (!rows.length) { show('pViewEmpty'); return; }

    $('pSpaces').innerHTML = rows.map(function (t) {
      var term = (t.start_date && t.end_date)
        ? esc(t.start_date) + ' &ndash; ' + esc(t.end_date)
        : 'Not on file';
      return '<article class="p-card">' +
        '<h2 class="p-card-name">' + esc(t.name || 'Your space') + '</h2>' +
        '<dl class="p-facts">' +
          '<div><dt>Lease type</dt><dd>' + esc(t.lease_type || 'Not on file') + '</dd></div>' +
          '<div><dt>Square feet</dt><dd>' + (t.sqft ? esc(Number(t.sqft).toLocaleString()) : 'Not on file') + '</dd></div>' +
          '<div><dt>Term</dt><dd>' + term + '</dd></div>' +
        '</dl>' +
        '<p class="p-soon">Statements, documents and payments arrive in a later release.</p>' +
      '</article>';
    }).join('');

    show('pViewSpace');
  }

  async function afterSignIn(session) {
    if (pendingInvite) {
      status('Accepting your invitation…');
      var out = await acceptInvite(pendingInvite, session.access_token);
      pendingInvite = null;
      if (!out.ok) { status(out.error || 'This invitation is not valid.', 'error'); }
      else { status('Invitation accepted.', 'ok'); }
    }
    await loadSpace();
  }

  async function signIn(e) {
    e.preventDefault();
    if (!db) { status('Portal is not configured.', 'error'); return; }
    var email = $('pEmail').value.trim();
    var pass  = $('pPassword').value;
    if (!email || !pass) { status('Enter your email and password.', 'error'); return; }

    var btn = $('pSignIn');
    btn.disabled = true;
    status('Signing in…');

    var r = await db.auth.signInWithPassword({ email: email, password: pass });
    btn.disabled = false;

    if (r.error) { status('That email and password did not match.', 'error'); return; }
    status('');
    await afterSignIn(r.data.session);
  }

  async function signOut() {
    if (db) await db.auth.signOut();
    if (window.AuthService && typeof window.AuthService.clear === 'function') window.AuthService.clear();
    show('pViewAuth');
    status('');
  }

  async function init() {
    if (!db) { status('Portal is not configured.', 'error'); show('pViewAuth'); return; }

    $('pAuthForm').addEventListener('submit', signIn);
    $('pSignOut').addEventListener('click', signOut);

    if (cfg.target) {
      var badge = $('pEnv');
      if (badge && cfg.target !== 'production') {
        badge.textContent = cfg.target;
        badge.hidden = false;
      }
    }

    var s = await db.auth.getSession();
    if (s.data && s.data.session) await afterSignIn(s.data.session);
    else {
      show('pViewAuth');
      if (pendingInvite) status('Sign in to accept your invitation.');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
