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

  // Where a magic link must land. Mirrors script.js's PUBLIC_APP_URL/APP_ENTRY_URL
  // pattern, and exists for the same reason that file's constants do: MainStreet
  // has already shipped a bug where an auth redirect pointed at the marketing
  // root, which loads no Supabase client, so the token fragment was dropped and
  // the user stayed signed out. The portal must be its own target.
  // test-routing.js resolves this constant and fetches it to prove the document
  // it serves can actually complete a sign-in.
  var PORTAL_URL = /^(localhost|127\.0\.0\.1)/.test(window.location.hostname)
    ? window.location.origin + '/portal.html'
    : window.location.origin + '/portal';

  var $ = function (id) { return document.getElementById(id); };

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function show(id) {
    ['pViewAuth', 'pViewSent', 'pViewSpace', 'pViewEmpty'].forEach(function (v) {
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
  //
  // It is held in memory instead, and re-attached to the magic-link redirect so
  // it survives the round trip through email. Without that the token would be
  // lost the moment the tenant asked for a sign-in link, and the invitation
  // would have to be re-sent.
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

  // Tenants sign in with a magic link, not a password.
  //
  // This is not a workaround for HaveIBeenPwned checking being unavailable on
  // the pilot's plan — it is the better control for this surface. A password
  // check reduces the chance a weak secret is chosen; a magic link means there
  // is no tenant password to choose, reuse, leak or rotate at all. It also fits
  // how the portal is actually used: a CAM statement is a quarterly or annual
  // event, and password auth at that frequency reliably produces forgotten
  // passwords, reset flows, and passwords reused from somewhere else.
  //
  // Landlords keep password auth in script.js. They sign in daily, and that is a
  // different usage pattern deserving a different mechanism.
  //
  // shouldCreateUser stays at its default (true) so a first-time tenant gets an
  // account from the invitation itself. That does mean anyone can mint an
  // account by requesting a link — which is already true of the landlord signUp
  // path, and harmless here: an account with no accepted membership reads zero
  // rows from every table and lands on the "no space linked yet" view.
  async function requestLink(e) {
    e.preventDefault();
    if (!db) { status('Portal is not configured.', 'error'); return; }
    var email = $('pEmail').value.trim();
    if (!email) { status('Enter the email your invitation was sent to.', 'error'); return; }

    var btn = $('pSignIn');
    btn.disabled = true;
    status('Sending your sign-in link…');

    // Carry the invitation through the round trip — see takeToken().
    var redirect = PORTAL_URL + (pendingInvite ? '?invite=' + encodeURIComponent(pendingInvite) : '');

    var r = await db.auth.signInWithOtp({
      email: email,
      options: { emailRedirectTo: redirect },
    });
    btn.disabled = false;

    if (r.error) {
      // Rate limiting is the likely cause on a small plan, and "try again" with
      // no interval is the kind of error message that sends people in circles.
      status(/rate|limit|seconds/i.test(r.error.message || '')
        ? 'Too many sign-in links requested. Wait a minute, then try again.'
        : 'Could not send the link. Check the address and try again.', 'error');
      return;
    }
    show('pViewSent');
    $('pSentTo').textContent = email;
    status('');
  }

  async function signOut() {
    if (db) await db.auth.signOut();
    if (window.AuthService && typeof window.AuthService.clear === 'function') window.AuthService.clear();
    show('pViewAuth');
    status('');
  }

  async function init() {
    if (!db) { status('Portal is not configured.', 'error'); show('pViewAuth'); return; }

    $('pAuthForm').addEventListener('submit', requestLink);
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
      if (pendingInvite) status('Enter your email and we will send a link to accept your invitation.');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
