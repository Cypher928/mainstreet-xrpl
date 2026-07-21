/**
 * dev-console.js — XRPL Developer Console (DEV-ONLY, TESTNET-ONLY)
 * ============================================================================
 * A self-contained developer tool for demonstrating XRPL tooling. It is fully
 * ISOLATED from MainStreet's production settlement path:
 *   - Talks ONLY to XRPL Testnet (wss://s.altnet.rippletest.net:51233).
 *   - Never imports/references the mainnet settlement wallet, seed, api/rlusd-*
 *     endpoints, or any production RLUSD logic.
 *   - Generates ephemeral testnet wallets in memory only. No secrets are stored
 *     in the database or localStorage; nothing leaves the browser except signed
 *     TESTNET transactions the user explicitly triggers.
 *
 * Gating (mirrors dev-switcher.js): activates ONLY on localhost / 127.0.0.1, or
 * on a *.vercel.app preview when ?devtools=1 is present. It NEVER activates on
 * the production custom domain — so CRE users never see it, judges enable it.
 * Loaded via <script src="dev-console.js"> and is completely inert unless gated.
 */
(function () {
  'use strict';

  // ── Gate ──────────────────────────────────────────────────────────────────
  var host = window.location.hostname;
  var params = new URLSearchParams(window.location.search);
  if (params.get('devtools') === '1') { try { localStorage.setItem('ms-devtools', '1'); } catch (_) {} }
  if (params.get('devtools') === '0') { try { localStorage.removeItem('ms-devtools'); } catch (_) {} }
  var isLocal = host === 'localhost' || host === '127.0.0.1' || host === '';
  var flagOn = false; try { flagOn = localStorage.getItem('ms-devtools') === '1'; } catch (_) {}
  var isPreview = host.endsWith('.vercel.app') && flagOn;
  if (!isLocal && !isPreview) return;      // zero production exposure

  // ── Testnet config (NEVER mainnet) ──────────────────────────────────────────
  var TESTNET_WS = 'wss://s.altnet.rippletest.net:51233';
  var EXPLORER = 'https://testnet.xrpl.org';
  // "RLUSD" as a 160-bit hex currency (codes > 3 chars must be hex): 52 4C 55 53 44 padded.
  var RLUSD_HEX = '524C555344000000000000000000000000000000';
  var RLUSD_TESTNET_ISSUER_DEFAULT = 'rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV'; // editable in the UI

  var xrplLib = null, client = null, connected = false;
  var wallet = null, lastTx = null;

  // ── xrpl SDK (lazy CDN load — jsdelivr is already allow-listed by the app) ───
  function loadXrpl() {
    if (window.xrpl) { xrplLib = window.xrpl; return Promise.resolve(xrplLib); }
    if (loadXrpl._p) return loadXrpl._p;
    loadXrpl._p = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/xrpl@2.14.0/build/xrpl-latest-min.js';
      s.onload = function () { xrplLib = window.xrpl; xrplLib ? resolve(xrplLib) : reject(new Error('xrpl global missing')); };
      s.onerror = function () { reject(new Error('failed to load xrpl SDK from CDN')); };
      document.head.appendChild(s);
    });
    return loadXrpl._p;
  }
  async function ensureClient() {
    await loadXrpl();
    if (!client) client = new xrplLib.Client(TESTNET_WS);
    if (!client.isConnected()) { await client.connect(); }
    connected = client.isConnected();
    return client;
  }

  // ── Tiny helpers ────────────────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function toast(msg, kind) {
    var t = document.createElement('div');
    t.className = 'dc-toast dc-toast--' + (kind || 'info');
    t.textContent = msg;
    $('dc-toasts').appendChild(t);
    setTimeout(function () { t.style.opacity = '0'; }, 3200);
    setTimeout(function () { t.remove(); }, 3800);
  }
  function setText(id, v) { var el = $(id); if (el) el.textContent = v; }
  function busy(btn, on, label) {
    if (!btn) return;
    if (on) { btn.dataset._t = btn.textContent; btn.textContent = label || 'Working…'; btn.disabled = true; }
    else { btn.textContent = btn.dataset._t || btn.textContent; btn.disabled = false; }
  }

  // ── Styles (design-system tokens only) ──────────────────────────────────────
  function injectStyles() {
    if ($('dc-styles')) return;
    var css = [
      '.dc-launch{position:fixed;left:16px;bottom:16px;z-index:99500;display:flex;align-items:center;gap:8px;padding:9px 14px;border-radius:10px;cursor:pointer;font:600 0.82rem/1 inherit;color:#C9973A;background:var(--theme-card,#0F1217);border:1px solid rgba(201,151,58,0.4);box-shadow:0 8px 24px rgba(0,0,0,0.4);}',
      '.dc-launch:hover{border-color:#C9973A;}',
      '.dc-badge{font-size:0.62rem;font-weight:800;text-transform:uppercase;letter-spacing:0.06em;color:#C9973A;background:rgba(201,151,58,0.14);border:1px solid rgba(201,151,58,0.35);border-radius:5px;padding:2px 6px;}',
      '.dc-overlay{position:fixed;inset:0;z-index:99600;display:none;background:rgba(0,0,0,0.55);overflow-y:auto;}',
      '.dc-overlay.open{display:block;}',
      '.dc-panel{max-width:720px;margin:32px auto;background:var(--theme-bg,#07090C);border:1px solid rgba(var(--line-rgb,255,255,255),0.1);border-radius:16px;box-shadow:0 30px 80px rgba(0,0,0,0.6);overflow:hidden;}',
      '.dc-head{display:flex;align-items:center;gap:10px;padding:16px 20px;border-bottom:1px solid rgba(var(--line-rgb,255,255,255),0.08);background:var(--theme-card,#0F1217);position:sticky;top:0;}',
      '.dc-title{font-size:1.02rem;font-weight:800;color:var(--text-1,#E2E8F0);}',
      '.dc-net{margin-left:auto;font-size:0.7rem;font-weight:700;color:var(--c-4ade80,#4ade80);}',
      '.dc-x{background:none;border:none;color:var(--text-3,#94A3B8);font-size:1.2rem;cursor:pointer;padding:4px 8px;}',
      '.dc-body{padding:14px 16px 22px;}',
      '.dc-card{background:var(--theme-card,#0F1217);border:1px solid rgba(var(--line-rgb,255,255,255),0.08);border-radius:12px;margin-bottom:12px;overflow:hidden;}',
      '.dc-card-h{display:flex;align-items:center;gap:9px;padding:12px 14px;cursor:pointer;user-select:none;font-weight:700;font-size:0.9rem;color:var(--text-1,#E2E8F0);}',
      '.dc-card-h .dc-chev{margin-left:auto;color:var(--text-4,#64748B);transition:transform 0.2s;}',
      '.dc-card.open .dc-card-h .dc-chev{transform:rotate(180deg);}',
      '.dc-card-b{display:none;padding:4px 14px 16px;}',
      '.dc-card.open .dc-card-b{display:block;}',
      '.dc-row{display:flex;justify-content:space-between;gap:12px;padding:6px 0;font-size:0.82rem;border-bottom:1px solid rgba(var(--line-rgb,255,255,255),0.05);}',
      '.dc-row:last-child{border-bottom:none;}',
      '.dc-row .k{color:var(--text-4,#64748B);flex:none;}',
      '.dc-row .v{color:var(--text-2,#CBD5E1);font-family:ui-monospace,Menlo,monospace;word-break:break-all;text-align:right;}',
      '.dc-btns{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;}',
      '.dc-btn{flex:1 1 auto;min-height:38px;padding:8px 12px;border-radius:8px;font:700 0.8rem/1 inherit;cursor:pointer;border:1px solid rgba(var(--line-rgb,255,255,255),0.14);background:var(--theme-panel,#0A0D12);color:var(--text-2,#CBD5E1);white-space:nowrap;}',
      '.dc-btn:hover:not(:disabled){border-color:#C9973A;color:var(--text-1,#E2E8F0);}',
      '.dc-btn:disabled{opacity:0.5;cursor:default;}',
      '.dc-btn--gold{background:#C9973A;color:#07090C;border-color:#C9973A;}',
      '.dc-btn--gold:hover:not(:disabled){filter:brightness(1.08);color:#07090C;}',
      '.dc-input{width:100%;box-sizing:border-box;margin-top:6px;padding:8px 10px;border-radius:8px;font:0.8rem ui-monospace,Menlo,monospace;background:var(--theme-panel,#0A0D12);border:1px solid rgba(var(--line-rgb,255,255,255),0.14);color:var(--text-1,#E2E8F0);}',
      '.dc-label{font-size:0.72rem;color:var(--text-4,#64748B);margin-top:10px;text-transform:uppercase;letter-spacing:0.04em;}',
      '.dc-link{color:var(--c-7dd3fc,#7dd3fc);text-decoration:none;font-size:0.8rem;font-weight:600;}',
      '.dc-note{font-size:0.72rem;color:var(--text-4,#64748B);margin-top:8px;line-height:1.5;}',
      '.dc-warn{font-size:0.72rem;color:var(--c-fbbf24,#fbbf24);margin-top:8px;line-height:1.5;}',
      '.dc-toasts{position:fixed;right:16px;bottom:16px;z-index:99700;display:flex;flex-direction:column;gap:8px;}',
      '.dc-toast{padding:10px 14px;border-radius:8px;font-size:0.8rem;font-weight:600;color:#fff;box-shadow:0 6px 20px rgba(0,0,0,0.4);transition:opacity 0.5s;max-width:320px;}',
      '.dc-toast--info{background:#334155;}.dc-toast--ok{background:#166534;}.dc-toast--err{background:#7f1d1d;}',
    ].join('\n');
    var s = document.createElement('style'); s.id = 'dc-styles'; s.textContent = css; document.head.appendChild(s);
  }

  // ── Markup ──────────────────────────────────────────────────────────────────
  function card(id, title, bodyHtml, open) {
    return '<div class="dc-card' + (open ? ' open' : '') + '" id="' + id + '">' +
      '<div class="dc-card-h" data-toggle="' + id + '">' + title + '<span class="dc-chev">&#x25BE;</span></div>' +
      '<div class="dc-card-b">' + bodyHtml + '</div></div>';
  }
  function build() {
    injectStyles();
    if ($('dc-launch')) return;

    var launch = document.createElement('button');
    launch.id = 'dc-launch'; launch.className = 'dc-launch';
    launch.innerHTML = '&#x2699;&#xFE0F; XRPL Dev Console <span class="dc-badge">Developer Mode</span>';
    launch.onclick = openPanel;
    document.body.appendChild(launch);

    var toasts = document.createElement('div'); toasts.id = 'dc-toasts'; toasts.className = 'dc-toasts';
    document.body.appendChild(toasts);

    var ov = document.createElement('div'); ov.id = 'dc-overlay'; ov.className = 'dc-overlay';
    ov.innerHTML =
      '<div class="dc-panel">' +
        '<div class="dc-head"><span class="dc-badge">Developer Mode</span>' +
          '<span class="dc-title">XRPL Developer Console</span>' +
          '<span class="dc-net" id="dc-netlabel">Testnet</span>' +
          '<button class="dc-x" id="dc-close">&#x2715;</button></div>' +
        '<div class="dc-body">' +
          card('dc-c-net', '&#x1F310; Network Status',
            '<div class="dc-row"><span class="k">Network</span><span class="v" id="dc-net">XRPL Testnet</span></div>' +
            '<div class="dc-row"><span class="k">Server</span><span class="v">' + esc(TESTNET_WS) + '</span></div>' +
            '<div class="dc-row"><span class="k">Connection</span><span class="v" id="dc-conn">Not connected</span></div>' +
            '<div class="dc-row"><span class="k">Validated ledger</span><span class="v" id="dc-ledger">—</span></div>' +
            '<div class="dc-btns"><button class="dc-btn" id="dc-connect">Connect / Refresh</button></div>', true) +
          card('dc-c-wallet', '&#x1F511; XRPL Test Wallet',
            '<div class="dc-row"><span class="k">Classic address</span><span class="v" id="dc-addr">—</span></div>' +
            '<div class="dc-row"><span class="k">X-Address</span><span class="v" id="dc-xaddr">—</span></div>' +
            '<div class="dc-row"><span class="k">XRP balance</span><span class="v" id="dc-bal">—</span></div>' +
            '<div class="dc-row"><span class="k">Ledger index</span><span class="v" id="dc-wledger">—</span></div>' +
            '<div class="dc-btns">' +
              '<button class="dc-btn dc-btn--gold" id="dc-gen">Generate Wallet</button>' +
              '<button class="dc-btn" id="dc-copy">Copy Address</button>' +
              '<button class="dc-btn" id="dc-refresh">Refresh Balance</button></div>' +
            '<div class="dc-warn">Ephemeral testnet wallet, held in memory for this session only. Never a production wallet or seed.</div>', true) +
          card('dc-c-fund', '&#x1F4B0; Auto Fund (Testnet Faucet)',
            '<div class="dc-note">Requests test XRP from the official XRPL Testnet faucet via the xrpl SDK.</div>' +
            '<div class="dc-btns"><button class="dc-btn dc-btn--gold" id="dc-fund">Fund Wallet</button></div>' +
            '<div class="dc-row" style="margin-top:8px"><span class="k">Faucet result</span><span class="v" id="dc-fundres">—</span></div>') +
          card('dc-c-trust', '&#x1F517; RLUSD Trust Line (Testnet)',
            '<div class="dc-label">RLUSD issuer (testnet)</div>' +
            '<input class="dc-input" id="dc-issuer" value="' + esc(RLUSD_TESTNET_ISSUER_DEFAULT) + '" spellcheck="false">' +
            '<div class="dc-btns"><button class="dc-btn" id="dc-trust">Create RLUSD Trust Line</button></div>' +
            '<div class="dc-row" style="margin-top:8px"><span class="k">Result</span><span class="v" id="dc-trustres">—</span></div>' +
            '<div class="dc-note">Builds a TrustSet for RLUSD (currency ' + RLUSD_HEX.slice(0, 10) + '… hex) on <b>testnet</b>. If the issuer isn’t active on testnet the ledger will return an error — the tooling still demonstrates correct trust-line construction.</div>') +
          card('dc-c-pay', '&#x1F4B8; Send Test Payment (Testnet XRP)',
            '<div class="dc-label">Destination address</div>' +
            '<input class="dc-input" id="dc-dest" placeholder="r… (generate creates one automatically)" spellcheck="false">' +
            '<div class="dc-label">Amount (XRP)</div>' +
            '<input class="dc-input" id="dc-amt" value="10" spellcheck="false">' +
            '<div class="dc-btns">' +
              '<button class="dc-btn" id="dc-newdest">New Destination</button>' +
              '<button class="dc-btn dc-btn--gold" id="dc-send">Send Payment</button></div>' +
            '<div class="dc-row" style="margin-top:8px"><span class="k">Tx hash</span><span class="v" id="dc-txhash">—</span></div>') +
          card('dc-c-explore', '&#x1F50E; Live Ledger Explorer',
            '<div class="dc-row"><span class="k">Account</span><span class="v"><a class="dc-link" id="dc-exp-acct" href="#" target="_blank" rel="noopener">—</a></span></div>' +
            '<div class="dc-row"><span class="k">Last transaction</span><span class="v"><a class="dc-link" id="dc-exp-tx" href="#" target="_blank" rel="noopener">—</a></span></div>') +
          '<div class="dc-btns" style="margin-top:6px"><button class="dc-btn" id="dc-reset">Reset Developer Session</button></div>' +
          '<div class="dc-note">Isolated from production: testnet only, no production settlement / wallet / RLUSD code is touched.</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);

    // wire events
    ov.addEventListener('click', function (e) { if (e.target === ov) closePanel(); });
    $('dc-close').onclick = closePanel;
    ov.querySelectorAll('[data-toggle]').forEach(function (h) {
      h.onclick = function () { $(h.getAttribute('data-toggle')).classList.toggle('open'); };
    });
    $('dc-connect').onclick = refreshNetwork;
    $('dc-gen').onclick = generateWallet;
    $('dc-copy').onclick = copyAddress;
    $('dc-refresh').onclick = refreshBalance;
    $('dc-fund').onclick = fundWallet;
    $('dc-trust').onclick = createTrustLine;
    $('dc-newdest').onclick = function () { newDestination(); };
    $('dc-send').onclick = sendPayment;
    $('dc-reset').onclick = resetSession;
  }

  function openPanel() { build(); $('dc-overlay').classList.add('open'); refreshNetwork(); }
  function closePanel() { var o = $('dc-overlay'); if (o) o.classList.remove('open'); }

  // ── Actions ─────────────────────────────────────────────────────────────────
  async function refreshNetwork() {
    var btn = $('dc-connect');
    try {
      busy(btn, true, 'Connecting…');
      await ensureClient();
      setText('dc-conn', 'Connected ✓');
      var idx = await client.getLedgerIndex();
      setText('dc-ledger', String(idx));
      toast('Connected to XRPL Testnet', 'ok');
    } catch (e) {
      setText('dc-conn', 'Error');
      toast('Network: ' + e.message, 'err');
    } finally { busy(btn, false); }
  }

  async function generateWallet() {
    var btn = $('dc-gen');
    try {
      busy(btn, true, 'Generating…');
      await loadXrpl();
      wallet = xrplLib.Wallet.generate();
      setText('dc-addr', wallet.classicAddress);
      try { setText('dc-xaddr', xrplLib.classicAddressToXAddress(wallet.classicAddress, false, true)); }
      catch (_) { setText('dc-xaddr', '(unavailable)'); }
      setText('dc-bal', '0 (unfunded)');
      updateExplorer();
      toast('New testnet wallet generated', 'ok');
    } catch (e) { toast('Generate: ' + e.message, 'err'); }
    finally { busy(btn, false); }
  }

  function copyAddress() {
    if (!wallet) { toast('Generate a wallet first', 'info'); return; }
    (navigator.clipboard ? navigator.clipboard.writeText(wallet.classicAddress) : Promise.reject())
      .then(function () { toast('Address copied', 'ok'); })
      .catch(function () { toast(wallet.classicAddress, 'info'); });
  }

  async function refreshBalance() {
    if (!wallet) { toast('Generate a wallet first', 'info'); return; }
    var btn = $('dc-refresh');
    try {
      busy(btn, true, 'Refreshing…');
      await ensureClient();
      var bal = await client.getXrpBalance(wallet.classicAddress);
      setText('dc-bal', bal + ' XRP');
      setText('dc-wledger', String(await client.getLedgerIndex()));
    } catch (e) {
      if (/Account not found/i.test(e.message)) { setText('dc-bal', '0 (unfunded)'); toast('Account not funded yet', 'info'); }
      else toast('Balance: ' + e.message, 'err');
    } finally { busy(btn, false); }
  }

  async function fundWallet() {
    var btn = $('dc-fund');
    try {
      busy(btn, true, 'Funding…');
      await ensureClient();
      var res;
      if (wallet) res = await client.fundWallet(wallet);
      else { res = await client.fundWallet(); wallet = res.wallet; setText('dc-addr', wallet.classicAddress); try { setText('dc-xaddr', xrplLib.classicAddressToXAddress(wallet.classicAddress, false, true)); } catch (_) {} }
      setText('dc-bal', (res.balance != null ? res.balance : '—') + ' XRP');
      setText('dc-fundres', 'Funded ✓ balance ' + (res.balance != null ? res.balance : '—'));
      updateExplorer();
      toast('Wallet funded from testnet faucet', 'ok');
    } catch (e) { setText('dc-fundres', 'Error'); toast('Fund: ' + e.message, 'err'); }
    finally { busy(btn, false); }
  }

  async function createTrustLine() {
    if (!wallet) { toast('Generate & fund a wallet first', 'info'); return; }
    var btn = $('dc-trust');
    try {
      busy(btn, true, 'Submitting…');
      await ensureClient();
      var issuer = ($('dc-issuer').value || '').trim();
      var tx = { TransactionType: 'TrustSet', Account: wallet.classicAddress,
        LimitAmount: { currency: RLUSD_HEX, issuer: issuer, value: '1000000' } };
      var prepared = await client.autofill(tx);
      var signed = wallet.sign(prepared);
      var r = await client.submitAndWait(signed.tx_blob);
      var code = r.result.meta && r.result.meta.TransactionResult;
      lastTx = r.result.hash; updateExplorer();
      setText('dc-trustres', code || 'submitted');
      toast('TrustSet result: ' + code, code === 'tesSUCCESS' ? 'ok' : 'info');
    } catch (e) { setText('dc-trustres', 'Error'); toast('TrustSet: ' + e.message, 'err'); }
    finally { busy(btn, false); }
  }

  async function newDestination() {
    await loadXrpl();
    var d = xrplLib.Wallet.generate();
    $('dc-dest').value = d.classicAddress;
    toast('New destination address generated', 'info');
    return d.classicAddress;
  }

  async function sendPayment() {
    if (!wallet) { toast('Generate & fund a wallet first', 'info'); return; }
    var btn = $('dc-send');
    try {
      busy(btn, true, 'Sending…');
      await ensureClient();
      var dest = ($('dc-dest').value || '').trim() || (await newDestination());
      var amt = ($('dc-amt').value || '10').trim();
      var tx = { TransactionType: 'Payment', Account: wallet.classicAddress,
        Destination: dest, Amount: xrplLib.xrpToDrops(amt) };
      var prepared = await client.autofill(tx);
      var signed = wallet.sign(prepared);
      var r = await client.submitAndWait(signed.tx_blob);
      var code = r.result.meta && r.result.meta.TransactionResult;
      lastTx = r.result.hash; updateExplorer();
      setText('dc-txhash', r.result.hash);
      await refreshBalance();
      toast('Payment ' + code + (code === 'tesSUCCESS' ? ' ✓' : ''), code === 'tesSUCCESS' ? 'ok' : 'err');
    } catch (e) { toast('Payment: ' + e.message, 'err'); }
    finally { busy(btn, false); }
  }

  function updateExplorer() {
    var a = $('dc-exp-acct'), t = $('dc-exp-tx');
    if (a && wallet) { a.textContent = wallet.classicAddress; a.href = EXPLORER + '/accounts/' + wallet.classicAddress; }
    if (t && lastTx) { t.textContent = lastTx.slice(0, 20) + '…'; t.href = EXPLORER + '/transactions/' + lastTx; }
  }

  async function resetSession() {
    try { if (client && client.isConnected()) await client.disconnect(); } catch (_) {}
    client = null; connected = false; wallet = null; lastTx = null;
    ['dc-addr', 'dc-xaddr', 'dc-bal', 'dc-wledger', 'dc-fundres', 'dc-trustres', 'dc-txhash', 'dc-ledger'].forEach(function (id) { setText(id, id === 'dc-bal' ? '—' : '—'); });
    setText('dc-conn', 'Not connected');
    ['dc-exp-acct', 'dc-exp-tx'].forEach(function (id) { var el = $(id); if (el) { el.textContent = '—'; el.href = '#'; } });
    if ($('dc-dest')) $('dc-dest').value = '';
    toast('Developer session reset', 'ok');
  }

  // ── Init ────────────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
