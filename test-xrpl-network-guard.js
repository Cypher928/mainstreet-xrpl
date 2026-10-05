'use strict';
/**
 * test-xrpl-network-guard.js — the pilot cannot be on XRPL mainnet, and the page
 * says the network the server is on.
 *
 * On 2026-10-05 the Pilot site (www.mainstreet-review.com) showed "live on XRPL
 * mainnet" and linked the Production settlement wallet. Two things made that
 * possible, and this suite pins both shut:
 *
 *   1. api/_pilot-target.js gave non-production deployments
 *      `XRPL_NETWORK || 'testnet'` — testnet only as a fallback — and Vercel had
 *      XRPL_NETWORK=mainnet scoped to Preview as well as Production.
 *   2. script.js wrote "XRPL Mainnet" into the settlement copy by hand, so the
 *      page claimed mainnet whatever the server was on.
 *
 * WHAT IT PROVES (all offline: no network, no Supabase, no XRPL node)
 *   A  the target selector — production → mainnet, exactly as before; every
 *      non-production deployment → testnet, whatever XRPL_NETWORK says
 *   B  the real /api/rlusd-settlement handler reports that network (fetch is
 *      stubbed for the sign-in check; no wallet address → no ledger lookup)
 *   C  the status line, the settlement card and the tenant statement name only
 *      the network the server reported, say "not configured" when there is no
 *      wallet, and never say "live" or "activating" on mainnet for the pilot
 *   D  nothing in the served script names a network on its own any more
 *   E  settled transactions, and the Pay Now explainer, are unaffected in kind
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { fnSource } = require('./test-support/fn-source');

let passed = 0, failed = 0;
const fails = [];
const ok = (cond, name, detail) => {
  if (cond) { passed++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
  else { failed++; fails.push(name); console.log('  \x1b[31m✗\x1b[0m ' + name + (detail ? '  — ' + detail : '')); }
};
const sec = (t) => console.log('\n── ' + t + ' ──');

const ROOT = __dirname;
const TARGET = path.join(ROOT, 'api', '_pilot-target.js');
const HANDLER = path.join(ROOT, 'api', 'rlusd-settlement.js');
const ENV_KEYS = ['VERCEL_ENV', 'XRPL_NETWORK', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
                  'PILOT_SUPABASE_SERVICE_ROLE_KEY', 'XRPL_SETTLEMENT_WALLET_ADDRESS'];

/** Load a module fresh under exactly `env` (other keys unset), then restore process.env. */
function withEnv(env, fn) {
  const saved = {};
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  Object.assign(process.env, env);
  for (const f of [TARGET, HANDLER]) delete require.cache[require.resolve(f)];
  try { return fn(); }
  finally {
    for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    for (const f of [TARGET, HANDLER]) delete require.cache[require.resolve(f)];
  }
}
const targetUnder = (env) => withEnv(env, () => ({ ...require(TARGET) }));
const PROD_ENV = { VERCEL_ENV: 'production', SUPABASE_URL: 'https://prod.invalid', SUPABASE_ANON_KEY: 'prod-anon' };

// ── A · the target selector ────────────────────────────────────────────────
sec('A · production resolves to mainnet; nothing else can');
{
  ok(targetUnder({ ...PROD_ENV }).network === 'mainnet', 'A1 production with XRPL_NETWORK unset → mainnet (the default it always had)');
  ok(targetUnder({ ...PROD_ENV, XRPL_NETWORK: 'mainnet' }).network === 'mainnet', 'A2 production with XRPL_NETWORK=mainnet → mainnet');
  ok(targetUnder({ ...PROD_ENV, XRPL_NETWORK: ' mainnet ' }).network === 'mainnet', 'A3 production still trims the value, as before');
  ok(targetUnder({ ...PROD_ENV }).name === 'production', 'A4 and it is the production target');
  ok(targetUnder({ VERCEL_ENV: 'preview' }).network === 'testnet', 'A5 preview (the pilot) with XRPL_NETWORK unset → testnet');
  ok(targetUnder({ VERCEL_ENV: 'preview', XRPL_NETWORK: 'mainnet' }).network === 'testnet',
     'A6 preview with XRPL_NETWORK=mainnet → STILL testnet (the 2026-10-05 misconfiguration can no longer reach mainnet)');
  ok(targetUnder({ VERCEL_ENV: 'preview', XRPL_NETWORK: 'MAINNET' }).network === 'testnet', 'A7 preview with any spelling of mainnet → testnet');
  ok(targetUnder({ XRPL_NETWORK: 'mainnet' }).network === 'testnet', 'A8 local / unset VERCEL_ENV with XRPL_NETWORK=mainnet → testnet');
  ok(targetUnder({ VERCEL_ENV: 'development', XRPL_NETWORK: 'mainnet' }).network === 'testnet', 'A9 development with XRPL_NETWORK=mainnet → testnet');
  ok(targetUnder({ VERCEL_ENV: 'Production', XRPL_NETWORK: 'mainnet' }).network === 'testnet', 'A10 a near-miss VERCEL_ENV ("Production") is not production → testnet');
  const nonProd = [{}, { VERCEL_ENV: 'preview' }, { VERCEL_ENV: 'development' }, { VERCEL_ENV: 'staging' }, { VERCEL_ENV: '' }]
    .flatMap(e => ['mainnet', 'testnet', 'devnet', '', ' mainnet'].map(n => ({ ...e, XRPL_NETWORK: n })));
  const leaks = nonProd.filter(e => targetUnder(e).network !== 'testnet');
  ok(leaks.length === 0, `A11 none of ${nonProd.length} non-production combinations resolves to anything but testnet`, JSON.stringify(leaks.slice(0, 2)));

  const src = fs.readFileSync(TARGET, 'utf8');
  const pilotBlock = src.slice(src.indexOf("name:           'pilot'"), src.indexOf('};', src.indexOf("name:           'pilot'")));
  ok(pilotBlock.length > 0 && !/XRPL_NETWORK/.test(pilotBlock), 'A12 the pilot branch does not read XRPL_NETWORK at all');
  // The production branch must be byte-for-byte what it was before this change.
  const PROD_BLOCK_BEFORE = [
    "  name:           'production',",
    "  url:            (process.env.SUPABASE_URL              || '').trim(),",
    "  anonKey:        (process.env.SUPABASE_ANON_KEY         || '').trim(),",
    "  serviceRoleKey: (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim(),",
    "  network:        (process.env.XRPL_NETWORK              || 'mainnet').trim(),",
  ].join('\n');
  ok(src.includes('var target = IS_PROD ? {\n' + PROD_BLOCK_BEFORE + '\n} : {'), 'A13 the production branch is unchanged, line for line');
  ok(/var IS_PROD = process\.env\.VERCEL_ENV === 'production';/.test(src), 'A14 production is still selected only by an exact VERCEL_ENV match');
}

// ── B · the real status endpoint ───────────────────────────────────────────
sec('B · /api/rlusd-settlement reports the network the target resolved');
async function callStatus(env) {
  return withEnv(env, async () => {
    const realFetch = global.fetch;
    const calls = [];
    global.fetch = async (url) => { calls.push(String(url)); return { ok: true, json: async () => ({ id: 'user-1' }) }; };
    try {
      const handler = require(HANDLER);
      require('./api/_rate-limit')._resetForTests && require('./api/_rate-limit')._resetForTests();
      let code = 0, body = null;
      const res = { status(c) { code = c; return this; }, json(b) { body = b; return this; }, setHeader() {} };
      await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { action: 'status' } }, res);
      return { code, body, calls };
    } finally { global.fetch = realFetch; }
  });
}
(async () => {
  const pilotNoWallet = await callStatus({ VERCEL_ENV: 'preview' });
  ok(pilotNoWallet.code === 200 && pilotNoWallet.body.configured === false && pilotNoWallet.body.network === 'testnet',
     'B1 pilot, no wallet address → 200, configured:false, network:"testnet"', JSON.stringify(pilotNoWallet.body));
  const pilotMainnetEnv = await callStatus({ VERCEL_ENV: 'preview', XRPL_NETWORK: 'mainnet' });
  ok(pilotMainnetEnv.body && pilotMainnetEnv.body.network === 'testnet',
     'B2 pilot with XRPL_NETWORK=mainnet set → the endpoint still reports testnet', JSON.stringify(pilotMainnetEnv.body));
  ok(pilotNoWallet.calls.length === 1 && /bhmktujbxdbvdmpybmad\.supabase\.co\/auth\/v1\/user$/.test(pilotNoWallet.calls[0]),
     'B3 the pilot asked only the PILOT project who the caller is — no ledger call without a wallet', pilotNoWallet.calls.join(' '));
  const prodNoWallet = await callStatus({ ...PROD_ENV });
  ok(prodNoWallet.body && prodNoWallet.body.network === 'mainnet' && prodNoWallet.body.configured === false,
     'B4 production, no wallet address → network:"mainnet" (production unchanged)', JSON.stringify(prodNoWallet.body));
  const refused = await withEnv({ VERCEL_ENV: 'preview' }, async () => {
    const handler = require(HANDLER);
    let code = 0, body = null;
    const res = { status(c) { code = c; return this; }, json(b) { body = b; return this; }, setHeader() {} };
    const realFetch = global.fetch;
    global.fetch = async () => ({ ok: true, json: async () => ({ id: 'user-1' }) });
    try { await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { action: 'settle' } }, res); }
    finally { global.fetch = realFetch; }
    return { code, body };
  });
  ok(refused.code === 403, 'B5 settlement actions are still refused (403) — transaction behaviour untouched');

  // ── C · the UI, built from the real functions in script.js ────────────────
  sec('C · the settlement UI names only the network the server reported');
  const SCRIPT = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
  const toasts = [];
  const ctx = { console, Number, String, isNaN, showToast: (m) => toasts.push(m), _rlusdRailStatus: null };
  vm.createContext(ctx);
  // esc and fmt as script.js defines them (fn-source cannot brace-match esc: its
  // regex literal /'/g holds a quote). The functions under test are the real ones.
  vm.runInContext(`function esc(v) { if (v === null || v === undefined) return '';
      return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }`, ctx);
  vm.runInContext(fnSource(SCRIPT, 'fmt'), ctx);
  for (const name of ['_xrplNetworkLabel', '_buildRlusdStatusHtml', '_settlementRailPhrase', '_buildSettlementFlowHtml', 'payRentNow']) {
    vm.runInContext(fnSource(SCRIPT, name), ctx);
  }
  const text = (h) => String(h).replace(/<[^>]+>/g, ' ').replace(/&middot;/g, '·').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  const statusLine = (s) => text(ctx._buildRlusdStatusHtml(s));
  const card = (state, rail) => text(ctx._buildSettlementFlowHtml(state, { rail }));
  const PENDING = { status: 'pending', amountUsd: null, txHash: null, explorerLink: null };

  // the reply the pilot now gets (B1), rendered
  const noWallet = statusLine(pilotNoWallet.body);
  ok(/not configured/i.test(noWallet) && /XRPL Testnet/.test(noWallet), 'C1 no wallet on the pilot → "not configured … XRPL Testnet"', noWallet);
  ok(!/mainnet/i.test(noWallet) && !/\blive\b|activating/i.test(noWallet), 'C2 …and no "live", no "activating", no mainnet', noWallet);
  const noWalletMainnet = statusLine({ configured: false, network: 'mainnet' });
  ok(/not configured/i.test(noWalletMainnet) && /XRPL Mainnet/.test(noWalletMainnet) && !/\blive\b|activating/i.test(noWalletMainnet),
     'C3 no wallet on mainnet → "not configured … XRPL Mainnet", still not "live"/"activating"', noWalletMainnet);
  for (const [label, s] of [['null', null], ['an error reply', { error: 'Invalid or expired token' }], ['no network', { configured: false }], ['an unknown network', { configured: true, network: 'devnet' }]]) {
    const t = statusLine(s);
    ok(/status unavailable/.test(t) && !/mainnet|testnet/i.test(t), `C4 ${label} → "status unavailable", no network named`, t);
  }
  const liveTest = { configured: true, exists: true, trustLineEstablished: true, network: 'testnet', rlusdBalance: '5', address: 'rTEST', explorerBase: 'https://testnet.xrpl.org/transactions/' };
  const lt = ctx._buildRlusdStatusHtml(liveTest);
  ok(/live on XRPL Testnet/.test(text(lt)) && !/mainnet/i.test(text(lt)) && lt.includes('https://testnet.xrpl.org/accounts/rTEST'),
     'C5 configured on testnet → "live on XRPL Testnet", wallet link on the testnet explorer', text(lt));
  const liveMain = { configured: true, exists: true, trustLineEstablished: true, network: 'mainnet', rlusdBalance: '1', address: 'rMAIN', explorerBase: 'https://livenet.xrpl.org/transactions/' };
  const lm = ctx._buildRlusdStatusHtml(liveMain);
  ok(/live on XRPL Mainnet/.test(text(lm)) && !/testnet/i.test(text(lm)) && lm.includes('https://livenet.xrpl.org/accounts/rMAIN'),
     'C6 configured on mainnet (production) → "live on XRPL Mainnet", wallet link on livenet', text(lm));
  ok(/funding the XRPL Testnet wallet/.test(statusLine({ configured: true, exists: false, network: 'testnet' }))
     && /funding the XRPL Mainnet wallet/.test(statusLine({ configured: true, exists: false, network: 'mainnet' })),
     'C7 an unfunded wallet is described on its own network');
  ok(/trust line on XRPL Testnet/.test(statusLine({ configured: true, exists: true, trustLineEstablished: false, network: 'testnet' })),
     'C8 a missing trust line is described on its own network');

  // the settlement card
  const c0 = card(PENDING, null);
  ok(!/mainnet|testnet/i.test(c0) && /This charge has no settlement transaction yet/.test(c0),
     'C9 before the server has answered, the card names no network and still says this charge has no transaction', c0);
  const c1 = card(PENDING, pilotNoWallet.body);
  ok(/not configured on XRPL Testnet/.test(c1) && /not configured in this environment \(XRPL Testnet\)/.test(c1) && !/mainnet/i.test(c1) && !/\blive\b/.test(c1),
     'C10 the pilot card (no wallet) → "not configured on XRPL Testnet", never live or mainnet', c1);
  const c2 = card(PENDING, liveTest);
  ok(/— live on XRPL Testnet/.test(c2) && /RLUSD settlement is live on XRPL Testnet\./.test(c2) && !/mainnet/i.test(c2),
     'C11 a configured testnet rail → the card says Testnet', c2);
  const c3 = card(PENDING, liveMain);
  ok(/Verifiable payment settlement on the XRP Ledger \(RLUSD\) — live on XRPL Mainnet/.test(c3)
     && /RLUSD settlement is live on XRPL Mainnet\. This charge has no settlement transaction yet\./.test(c3) && !/testnet/i.test(c3),
     'C12 production (live on mainnet) → the card still reads "— live on XRPL Mainnet", as it did', c3);
  ok(/being set up on XRPL Testnet/.test(card(PENDING, { configured: true, exists: false, network: 'testnet' })),
     'C13 a rail that exists but is not live → "being set up", on its own network');

  // ── E · what must not change ───────────────────────────────────────────────
  sec('E · settled transactions and Pay Now are unchanged in kind');
  const SETTLED = { status: 'settled', amountUsd: null, txHash: 'ABC', explorerLink: 'https://livenet.xrpl.org/transactions/ABC', network: 'mainnet' };
  const s0 = ctx._buildSettlementFlowHtml(SETTLED, {});
  const s1 = ctx._buildSettlementFlowHtml(SETTLED, { rail: liveTest });
  ok(s0 === s1 && /Payment settled &amp; verified on the XRP Ledger/.test(s0) && s0.includes('https://livenet.xrpl.org/transactions/ABC'),
     'E1 a recorded settlement renders identically whatever the rail says, with its own transaction link');
  ctx.payRentNow();
  ok(toasts.length === 1 && /nothing has been charged/i.test(toasts[0]) && /verifiable transaction link/.test(toasts[0]) && !/mainnet|testnet|launching/i.test(toasts[0]),
     'E2 Pay Now still charges nothing and says so — and names no network', toasts[0]);

  // ── D · nothing names a network on its own ────────────────────────────────
  sec('D · the served script no longer writes a network into the copy');
  const code = SCRIPT.split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');
  for (const phrase of ['live on XRPL Mainnet', 'activating on XRPL mainnet', 'funding the XRPL mainnet wallet', 'XRPL mainnet is launching soon', 'RLUSD settlement is live on XRPL Mainnet']) {
    ok(!code.includes(phrase), `D1 "${phrase}" is not written into the code`);
  }
  ok(/live on XRPL \$\{net\}/.test(code), 'D2 the "live on XRPL …" wording is built from the server\'s network');
  ok(/_rlusdRailStatus = status;/.test(code) && /_settlementRailPhrase\(_rlusdRailStatus\)/.test(code),
     'D3 the tenant statement takes its network from the last server reply, not from this file');
  const handlerSrc = fs.readFileSync(HANDLER, 'utf8');
  ok(/return _t\.network;/.test(handlerSrc) && !/action === 'settle'[\s\S]{0,200}submit/.test(handlerSrc),
     'D4 the endpoint still takes its network from the target and still cannot submit');

  console.log('\n' + '─'.repeat(64));
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  if (failed) { console.log('FAILED:'); fails.forEach(f => console.log('  - ' + f)); process.exit(1); }
})().catch(e => { console.error(e); process.exit(1); });
