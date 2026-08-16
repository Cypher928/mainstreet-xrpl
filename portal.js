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

  var VIEWS = ['pViewAuth', 'pViewSent', 'pViewSpace', 'pViewStatements',
               'pViewStatementDetail', 'pViewDocuments', 'pViewEmpty'];
  var TABS  = { pViewSpace: 'pTabSpace', pViewStatements: 'pTabStatements',
                pViewDocuments: 'pTabDocuments' };

  function show(id) {
    VIEWS.forEach(function (v) {
      var el = $(v); if (el) el.hidden = (v !== id);
    });
    // The tab bar exists only for a tenant with an active membership; the auth,
    // sent and empty views are states where there is nothing to navigate between.
    var nav = $('pNav');
    if (nav) nav.hidden = !(id in TABS || id === 'pViewStatementDetail');
    Object.keys(TABS).forEach(function (v) {
      var b = $(TABS[v]);
      if (!b) return;
      // The detail view is still "CAM Statements" as far as the tab bar goes.
      var active = (v === id) || (id === 'pViewStatementDetail' && v === 'pViewStatements');
      if (active) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
  }

  var money = function (v) {
    if (v === null || v === undefined || v === '') return '—';
    return '$' + Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  var bytes = function (n) {
    if (!n && n !== 0) return '';
    return n < 1024 ? n + ' B'
         : n < 1048576 ? Math.round(n / 1024) + ' KB'
         : (n / 1048576).toFixed(1) + ' MB';
  };
  var day = function (s) {
    if (!s) return '';
    var d = new Date(s);
    return isNaN(d) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  };

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

    await renderSpace();
    show('pViewSpace');
  }

  // ── B2 · My Space ─────────────────────────────────────────────────────────
  // Reads tenant_space_profiles, NOT properties and NOT properties.data. The
  // landlord published these values; nothing here is derived from a live
  // landlord table, and a fact the landlord has not published simply is not
  // shown. RLS returns published rows only, so an unpublished profile arrives
  // as zero rows rather than as a draft.
  async function renderSpace() {
    var sp = await db.from('tenant_space_profiles')
      .select('property_name, property_address, space_label, rentable_sqft, ' +
              'lease_type, lease_start, lease_end, pro_rata_percent, ' +
              'manager_name, manager_email');
    if (sp.error) { status('Could not load your space.', 'error'); return; }

    var rows = sp.data || [];
    if (!rows.length) {
      $('pSpaces').innerHTML =
        '<div class="p-card"><h1 class="p-card-name">Your space</h1>' +
        '<p class="p-empty">Your property manager hasn&rsquo;t published your space details yet.</p></div>';
      return;
    }

    $('pSpaces').innerHTML = rows.map(function (s) {
      var term = (s.lease_start && s.lease_end)
        ? esc(day(s.lease_start)) + ' &ndash; ' + esc(day(s.lease_end)) : 'Not on file';
      var name = s.property_name + (s.space_label ? ' — ' + s.space_label : '');
      return '<article class="p-card">' +
        '<h2 class="p-card-name">' + esc(name) + '</h2>' +
        '<dl class="p-facts">' +
          (s.property_address ? '<div><dt>Address</dt><dd>' + esc(s.property_address) + '</dd></div>' : '') +
          '<div><dt>Rentable area</dt><dd>' + (s.rentable_sqft ? esc(Number(s.rentable_sqft).toLocaleString()) + ' sq ft' : 'Not on file') + '</dd></div>' +
          '<div><dt>Lease type</dt><dd>' + esc(s.lease_type || 'Not on file') + '</dd></div>' +
          '<div><dt>Term</dt><dd>' + term + '</dd></div>' +
          (s.pro_rata_percent != null ? '<div><dt>Your share</dt><dd>' + esc(s.pro_rata_percent) + '%</dd></div>' : '') +
          (s.manager_name ? '<div><dt>Property manager</dt><dd>' + esc(s.manager_name) + '</dd></div>' : '') +
        '</dl>' +
        (s.manager_email
          ? '<p class="p-soon">Questions about a charge go to ' + esc(s.manager_email) + '.</p>' : '') +
      '</article>';
    }).join('');
  }

  // ── B2 · CAM Statements ───────────────────────────────────────────────────
  // Only published statements exist as far as this client is concerned. The
  // status predicate is in the RLS policy, so this query asking for everything
  // still returns published rows only — the filter below is presentation, not
  // protection.
  var _statements = [];

  async function renderStatements() {
    var r = await db.from('tenant_statements')
      .select('id, cam_year, version, allocated_amount, pro_rata_percent, total_pool, ' +
              'amount_billed, balance_due, currency, statement_json, published_at')
      .order('cam_year', { ascending: false });
    if (r.error) { status('Could not load your statements.', 'error'); return; }

    _statements = r.data || [];
    if (!_statements.length) {
      $('pStatementList').innerHTML =
        '<p class="p-empty">No statements have been published for your space yet.</p>';
      return;
    }

    $('pStatementList').innerHTML = _statements.map(function (s, i) {
      return '<button type="button" class="p-row" data-idx="' + i + '">' +
        '<span><span class="p-row-y">' + esc(s.cam_year) + '</span>' +
          (s.published_at ? '<br><span class="p-row-m">published ' + esc(day(s.published_at)) + '</span>' : '') +
        '</span>' +
        '<span class="p-row-m">' + esc(money(s.allocated_amount)) +
          (s.balance_due != null ? ' &middot; balance ' + esc(money(s.balance_due)) : '') +
        '</span></button>';
    }).join('');

    Array.prototype.forEach.call($('pStatementList').querySelectorAll('.p-row'), function (b) {
      b.addEventListener('click', function () { openStatement(Number(b.dataset.idx)); });
    });
  }

  function openStatement(i) {
    var s = _statements[i];
    if (!s) return;
    var j = s.statement_json || {};
    var items = Array.isArray(j.line_items) ? j.line_items : [];

    $('pStatementDetail').innerHTML =
      '<h1 class="p-card-name">' + esc(s.cam_year) + ' CAM Statement</h1>' +
      '<dl class="p-facts">' +
        '<div><dt>Total pool</dt><dd>' + esc(money(s.total_pool)) + '</dd></div>' +
        '<div><dt>Your share</dt><dd>' + esc(s.pro_rata_percent) + '%</dd></div>' +
        '<div><dt>Your allocation</dt><dd>' + esc(money(s.allocated_amount)) + '</dd></div>' +
        '<div><dt>Already billed</dt><dd>' + esc(money(s.amount_billed)) + '</dd></div>' +
        '<div><dt>Balance due</dt><dd>' + esc(money(s.balance_due)) + '</dd></div>' +
      '</dl>' +
      (items.length
        ? '<div class="p-lines">' + items.map(function (it) {
            return '<div class="p-line"><span>' + esc(it.label || it.category || 'Item') + '</span>' +
              '<span class="p-line-a">pool ' + esc(money(it.pool_amount)) +
              ' &middot; yours ' + esc(money(it.your_share)) + '</span></div>';
          }).join('') + '</div>'
        : '') +
      (j.method_note ? '<p class="p-soon">' + esc(j.method_note) + '</p>' : '');

    show('pViewStatementDetail');
  }

  // ── B2 · Documents ────────────────────────────────────────────────────────
  // The list carries no storage path — that column lives in
  // tenant_document_sources, which has no tenant policy. Downloading means
  // asking the server, which re-checks membership and publication before it
  // signs anything.
  async function renderDocuments() {
    var r = await db.from('tenant_documents')
      .select('id, title, doc_kind, content_type, byte_size, published_at')
      .order('published_at', { ascending: false });
    if (r.error) { status('Could not load your documents.', 'error'); return; }

    var rows = r.data || [];
    if (!rows.length) {
      $('pDocumentList').innerHTML =
        '<p class="p-empty">No documents have been shared with you yet.</p>';
      return;
    }

    $('pDocumentList').innerHTML = rows.map(function (d) {
      var meta = [d.doc_kind, bytes(d.byte_size), day(d.published_at)].filter(Boolean).join(' · ');
      return '<div class="p-doc">' +
        '<span><span class="p-doc-t">' + esc(d.title) + '</span>' +
          '<br><span class="p-doc-m">' + esc(meta) + '</span></span>' +
        '<button type="button" data-doc="' + esc(d.id) + '">Download</button></div>';
    }).join('');

    Array.prototype.forEach.call($('pDocumentList').querySelectorAll('[data-doc]'), function (b) {
      b.addEventListener('click', function () { downloadDoc(b.dataset.doc, b); });
    });
  }

  async function downloadDoc(id, btn) {
    btn.disabled = true;
    status('Preparing your download…');
    try {
      var s = await db.auth.getSession();
      var tok = s.data && s.data.session ? s.data.session.access_token : null;
      var r = await fetch('/api/tenant-document-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
        body: JSON.stringify({ document_id: id }),
      });
      var body = await r.json().catch(function () { return {}; });
      if (!r.ok || !body.url) { status(body.error || 'That document is not available.', 'error'); return; }
      status('');
      window.open(body.url, '_blank', 'noopener');
    } catch (e) {
      status('Could not start the download. Try again.', 'error');
    } finally {
      btn.disabled = false;
    }
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

    // Tabs render on demand. Each loader re-queries rather than caching, so a
    // membership revoked mid-session shows as the empty state on the next tab
    // switch instead of continuing to display data the tenant may no longer read.
    $('pTabSpace').addEventListener('click', async function () {
      await renderSpace(); show('pViewSpace');
    });
    $('pTabStatements').addEventListener('click', async function () {
      await renderStatements(); show('pViewStatements');
    });
    $('pTabDocuments').addEventListener('click', async function () {
      await renderDocuments(); show('pViewDocuments');
    });
    $('pStatementBack').addEventListener('click', function () { show('pViewStatements'); });

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
