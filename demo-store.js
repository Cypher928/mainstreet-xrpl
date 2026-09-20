/**
 * demo-store.js — the public, read-only MainStreet demo.
 * ============================================================================
 *
 * WHAT THIS IS. On /demo, and ONLY on /demo, this replaces the Supabase client
 * with an in-memory stand-in seeded from demo-snapshot.js, so the real product
 * boots with no account, no session and no database behind it. Everything above
 * this line — the Command Center, the CAM engine, the evidence viewer, the
 * timeline — is the shipping product, unmodified. This is a different backing
 * store, not a different application, and not a mockup.
 *
 * WHY IT EXISTS. The demo data is seeded per user, and every RLS policy on it
 * is FOR ALL to `authenticated`; there is no read-only grant anywhere in the
 * schema. So any session that can SHOW a judge the demo can also let them
 * delete it, and a client-side "read-only mode" is not a boundary when the
 * token is sitting in the browser. The only way to show the product to the
 * public without handing out write access to real rows is to have no rows.
 *
 * THE GUARANTEE, AND HOW IT IS ENFORCED.
 *
 *   No credentials       nothing authenticates; there is no key to leak.
 *   No connection        window.supabase is replaced before script.js
 *                        destructures createClient from it (script.js:46).
 *   No writes escape     every mutation lands in a per-tab JavaScript object
 *                        that dies with the tab.
 *   Nothing persists     no localStorage, no IndexedDB, no cookies. Reload and
 *                        the visitor is back to the seeded state.
 *   Belt and braces      fetch and XMLHttpRequest refuse Supabase and /api
 *                        outright, so a path this file did not anticipate
 *                        fails closed rather than reaching the network.
 *
 * Loaded from index.html between the Supabase CDN and supabase-config.js. It
 * self-detects the route and returns immediately anywhere else, so the pilot
 * and production apps are untouched by its presence.
 */
(function () {
  'use strict';

  // ── 1 · Route gate ────────────────────────────────────────────────────────
  // Anything but /demo and this file does nothing at all. The check is on the
  // PATH, not a query string, so a stray ?demo= on the real app cannot trip it.
  var ON_DEMO = /^\/demo(\/|$)/i.test(window.location.pathname);
  if (!ON_DEMO) return;

  var SNAP = window.__MS_DEMO_SNAPSHOT;
  if (!SNAP || !SNAP.properties || !SNAP.properties.length) {
    console.error('[demo] snapshot missing — refusing to boot a demo with no data');
    return;
  }

  // Deep copy per tab. Two judges on two laptops, or the same judge in two
  // tabs, get their own copy and cannot see each other's clicks.
  var STORE = JSON.parse(JSON.stringify({
    properties: SNAP.properties || [],
    tenants:    SNAP.tenants    || [],
  }));
  var USER_ID = (STORE.properties[0] && STORE.properties[0].user_id) || 'demo-public';
  var USER = { id: USER_ID, email: 'demo@mainstreet.invalid',
               user_metadata: { full_name: 'Demonstration' } };

  // ── 2 · The network is closed ─────────────────────────────────────────────
  // Not decoration. If some path in the app reaches for Supabase or /api in a
  // way the stand-in below does not model, this is what stops it leaving the
  // browser — and makes the failure visible in the console instead of silently
  // contacting a real service.
  var BLOCKED = /supabase\.co|supabase\.in|\/api\//i;
  var _fetch = window.fetch && window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = (typeof input === 'string') ? input : (input && input.url) || '';
    if (BLOCKED.test(String(url))) {
      console.warn('[demo] blocked network call:', String(url));
      // Shaped like the app's own failure path so callers degrade rather than throw.
      return Promise.resolve(new Response(JSON.stringify({ error: 'demo_offline', data: null }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }));
    }
    return _fetch ? _fetch(input, init) : Promise.reject(new Error('fetch unavailable'));
  };
  var _open = window.XMLHttpRequest && window.XMLHttpRequest.prototype.open;
  if (_open) {
    window.XMLHttpRequest.prototype.open = function (m, url) {
      if (BLOCKED.test(String(url || ''))) {
        console.warn('[demo] blocked XHR:', String(url));
        arguments[1] = 'data:application/json,' + encodeURIComponent('{"error":"demo_offline"}');
      }
      return _open.apply(this, arguments);
    };
  }

  // ── 3 · The stand-in ──────────────────────────────────────────────────────
  // Implements the slice of the supabase-js builder the app actually calls.
  // Writes are honoured against the in-memory copy — the product must behave
  // like itself — but the copy is all there is.
  function P(v) { return Promise.resolve(v); }
  function table(name) { STORE[name] = STORE[name] || []; return STORE[name]; }
  function matches(row, filters) {
    return filters.every(function (f) {
      var v = row[f[1]];
      if (f[0] === 'eq')  return v === f[2];
      if (f[0] === 'in')  return (f[2] || []).indexOf(v) >= 0;
      if (f[0] === 'is')  return v == null;
      if (f[0] === 'neq') return v !== f[2];
      return true;
    });
  }
  function Q(name) {
    var filters = [], limit = null, q = {};
    q.select = function () { return q; };
    q.eq  = function (c, v) { filters.push(['eq', c, v]);  return q; };
    q.in  = function (c, v) { filters.push(['in', c, v]);  return q; };
    q.is  = function (c, v) { filters.push(['is', c, v]);  return q; };
    q.neq = function (c, v) { filters.push(['neq', c, v]); return q; };
    q.not = function () { return q; };
    q.ilike = q.like = q.gte = q.lte = q.gt = q.lt = function () { return q; };
    q.order = function () { return q; };
    q.range = function () { return q; };
    q.limit = function (n) { limit = n; return q; };
    function rows() {
      var r = table(name).filter(function (x) { return matches(x, filters); });
      return limit ? r.slice(0, limit) : r;
    }
    q.single = q.maybeSingle = function () { var r = rows(); return P({ data: r[0] || null, error: null }); };
    q.upsert = q.insert = function (row) {
      var arr = Array.isArray(row) ? row : [row], t = table(name);
      arr.forEach(function (r) {
        var i = t.findIndex(function (x) { return x.id === r.id; });
        if (i >= 0) t[i] = Object.assign({}, t[i], r); else t.push(Object.assign({}, r));
      });
      var p = P({ data: arr, error: null });
      p.select = function () { var s = P({ data: arr, error: null }); s.single = function () { return P({ data: arr[0], error: null }); }; return s; };
      p.single = function () { return P({ data: arr[0], error: null }); };
      return p;
    };
    q.update = function (patch) {
      var t = table(name), changed = [];
      t.forEach(function (x, i) { if (matches(x, filters)) { t[i] = Object.assign({}, x, patch); changed.push(t[i]); } });
      var p = P({ data: changed, error: null });
      p.select = function () { return P({ data: changed, error: null }); };
      p.eq = function (c, v) { filters.push(['eq', c, v]); return p; };
      p.in = function (c, v) { filters.push(['in', c, v]); return p; };
      return p;
    };
    q.delete = function () {
      var d = {};
      d.eq = d.in = function (c, v) {
        filters.push(['eq', c, v]);
        STORE[name] = table(name).filter(function (x) { return !matches(x, filters); });
        return P({ error: null });
      };
      return d;
    };
    q.then = function (res, rej) { return P({ data: rows(), error: null }).then(res, rej); };
    return q;
  }

  window.supabase = {
    createClient: function () {
      return {
        auth: {
          getUser:    function () { return P({ data: { user: USER }, error: null }); },
          getSession: function () { return P({ data: { session: { user: USER } }, error: null }); },
          onAuthStateChange: function (cb) {
            setTimeout(function () { try { cb('SIGNED_IN', { user: USER }); } catch (_) {} }, 30);
            return { data: { subscription: { unsubscribe: function () {} } } };
          },
          signOut: function () { return P({ error: null }); },
          signInWithPassword: function () { return P({ data: {}, error: { message: 'Demo is read-only.' } }); },
          signUp: function () { return P({ data: {}, error: { message: 'Demo is read-only.' } }); },
        },
        from: Q,
        rpc: function () { return P({ data: null, error: null }); },
        storage: { from: function () { return {
          upload:        function () { return P({ data: null, error: { message: 'Demo is read-only.' } }); },
          getPublicUrl:  function (p) { return { data: { publicUrl: p } }; },
          createSignedUrl: function (p) { return P({ data: { signedUrl: p }, error: null }); },
        }; } },
      };
    },
  };

  // ── 4 · Nothing outlives the tab ──────────────────────────────────────────
  //
  // Taking the database away was not enough. The app keeps local caches keyed
  // by user id — _ms_props_v2_<uid>, mainstreet_ckpt_v1_<uid>, ms_camYear_<uid>
  // — and those were landing in real localStorage. So a judge's edits survived
  // a reload on their machine, which makes "read-only demonstration data" a
  // half-truth, and the next visitor on a shared laptop would inherit them.
  //
  // localStorage is therefore replaced, for this route only, with a Storage
  // that lives in a JavaScript object. Every caller keeps working — same API,
  // same synchronous semantics — and closing the tab is a full reset. Real
  // localStorage is untouched, so nothing the visitor has from another origin
  // or another MainStreet route is read or overwritten.
  function memoryStorage() {
    var m = Object.create(null);
    return {
      get length() { return Object.keys(m).length; },
      key: function (i) { return Object.keys(m)[i] != null ? Object.keys(m)[i] : null; },
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, String(k)) ? m[String(k)] : null; },
      setItem: function (k, v) { m[String(k)] = String(v); },
      removeItem: function (k) { delete m[String(k)]; },
      clear: function () { m = Object.create(null); },
    };
  }
  try {
    var mem = memoryStorage(), memSession = memoryStorage();
    Object.defineProperty(window, 'localStorage',   { configurable: true, get: function () { return mem; } });
    Object.defineProperty(window, 'sessionStorage', { configurable: true, get: function () { return memSession; } });
  } catch (e) {
    console.warn('[demo] could not replace storage; falling back to clearing our own keys', e && e.message);
    try {
      Object.keys(window.localStorage).forEach(function (k) {
        if (/^_ms_props|^mainstreet_|^ms_cam|^__mockdb/.test(k)) window.localStorage.removeItem(k);
      });
    } catch (_) {}
  }

  window.__MS_DEMO = { store: STORE, user: USER, readOnly: true, snapshot: SNAP };
})();
