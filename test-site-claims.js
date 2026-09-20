'use strict';
/**
 * test-site-claims.js — every public claim on the marketing site is one the
 * product can back, and the judge path is intact.
 *
 *   node test-site-claims.js
 *
 * WHAT THIS PREVENTS
 *
 * The homepage once said "a 40-second film" over a 51-second film, "balances
 * settle in RLUSD" over a rail that is operator-signed, and the film's ledger
 * card read "$34,650 RLUSD" under a real transaction of 1 RLUSD. None of that
 * was caught, because nothing compared the page's words to the facts. This
 * suite is that comparison, held in one place:
 *
 *   A  share-card metadata is absolute and canonical
 *   B  the XRPL proof is the REAL transaction, stated truthfully
 *   C  the film's verification card matches the ledger
 *   D  the judge path exists and points where it should
 *   E  nothing internal-only is linked, and nothing stale survives
 *
 * Offline. Reads home.html and product-film.js as text; no browser.
 */
const fs   = require('fs');
const path = require('path');

const ROOT = __dirname;
const HTML = fs.readFileSync(path.join(ROOT, 'home.html'), 'utf8');
const FILM = fs.readFileSync(path.join(ROOT, 'product-film.js'), 'utf8');
const SITEMAP = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');

// The facts. These are the ONLY places the marketing surfaces may get them.
const TX        = '7FA730B2B78819AE34B3D1B458721FBC52B9CD25E980ED42DD1B15E9F9FC724A';
const EXPLORER  = 'https://livenet.xrpl.org/transactions/' + TX;
const ISSUER    = 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De';
const WALLET    = 'rHLDysh6p6TcJM7QXU15YRLG4mERF5h5pv';
const LANDLORD  = 'rw97rJThBJtoVRqR4DsoK5kW2taftzQvAX';
const SOURCE_TAG= '2606290001';
// WHERE A JUDGE ACTUALLY LANDS, WHICH IS NOT THE SAME AS WHERE THE PILOT LIVES.
//
// The bare origin redirects to /home — the pilot's OWN marketing page — so
// "Explore the live demo" answered a pitch with a second pitch. /app is the
// product. `?signin=1` is the pilot's own documented path for someone who has
// already decided: landing-experience.js `maybeShow()` returns early on it, so
// the pre-login hero never mounts, and script.js `_maybeShowLoginFromIntent()`
// reveals the auth card with the email field focused. Its comment names the
// failure this avoids — "Marketing page → hero → form is the three-screen
// sign-in. Explicit intent wins over the pitch."
const DEMO_ORIGIN = 'https://www.mainstreet-review.com';
const DEMO_URL    = DEMO_ORIGIN + '/app?signin=1';
const rx = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const REPO      = 'https://github.com/Cypher928/mainstreet-xrpl';
const OG_IMAGE  = 'https://www.mainstreetcam.com/assets/brand/og-image.png';
const CANONICAL = 'https://www.mainstreetcam.com/home';

let pass = 0, fail = 0;
const failures = [];
function t(name, cond, detail) {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { fail++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`  \x1b[31m✗ ${name}\x1b[0m${detail ? ` — ${detail}` : ''}`); }
}
// Markup without HTML comments: what the browser acts on. A comment that names
// a test file or an old claim is documentation, not a link or a claim.
const MARKUP = HTML.replace(/<!--[\s\S]*?-->/g, '');
// Visible text only: strip tags, scripts, styles and HTML comments so a claim
// hiding in a comment is not counted, and a claim in copy is not hidden by markup.
const TEXT = MARKUP.replace(/<script[\s\S]*?<\/script>/g, '')
                 .replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&rsquo;|&#39;/g, "'")
                 .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
const count = (re) => (TEXT.match(re) || []).length;

// ── A. Share card and canonical ──────────────────────────────────────────────
console.log('\n── A · share-card metadata ──');
t('og:image is absolute', HTML.includes(`<meta property="og:image" content="${OG_IMAGE}">`),
  'a relative og:image renders a blank preview card wherever the link is shared');
t('the og:image file exists', fs.existsSync(path.join(ROOT, 'assets/brand/og-image.png')));
t('canonical names the hop-free URL', HTML.includes(`<link rel="canonical" href="${CANONICAL}">`));
t('og:url matches the canonical', HTML.includes(`<meta property="og:url" content="${CANONICAL}">`));
t('the sitemap names the same URL', SITEMAP.includes(`<loc>${CANONICAL}</loc>`));
t('og:title carries the positioning', /og:title" content="[^"]*verified memory[^"]*"/.test(HTML));

// ── B. The XRPL proof is real and truthful ──────────────────────────────────
console.log('\n── B · the XRPL proof ──');
t('the real transaction hash is on the page, in full', TEXT.includes(TX));
t('the explorer link is the real one', HTML.includes(`href="${EXPLORER}"`));
t('the explorer link opens in a new tab with noopener',
  new RegExp(`href="${EXPLORER}"[^>]*target="_blank"[^>]*rel="noopener"`).test(HTML));
t('the amount is stated as 1 RLUSD', /1 RLUSD/.test(TEXT));
t('the network is stated as mainnet, never testnet',
  /XRPL mainnet|XRP Ledger mainnet/i.test(TEXT) && !/testnet/i.test(TEXT), 'testnet must not appear on the public site');
t('the RLUSD issuer is the official mainnet issuer', TEXT.includes(ISSUER));
t('both wallets are named', TEXT.includes(WALLET) && TEXT.includes(LANDLORD));
t('the Source Tag is stated', TEXT.includes(SOURCE_TAG));
t('the memo fingerprint is explained as SHA-256', /SHA-256/.test(TEXT));
t('"what is not — yet" is stated beside "what is on the ledger"',
  /What is on the ledger today/.test(TEXT) && /What is not/.test(TEXT));
t('operator-signed settlement is disclosed', /operator[- ]signed/i.test(TEXT));
t('the app is described as read-only against the ledger', /cannot sign|only reads the ledger|it cannot sign/i.test(TEXT));
t('records are described as off-chain', /stay off-chain/i.test(TEXT));
t('no present-tense "balances settle" overclaim', !/balances settle/i.test(TEXT));
t('no "on-chain audit trail" overclaim', !/on-chain audit trail|tamper-evident/i.test(TEXT));
t('no in-app payment claim', !/pay now|one[- ]click settle|click to settle|settle in the app/i.test(TEXT));
t('the verify script is linked', HTML.includes(`${REPO}/blob/main/scripts/verify-settlement.js`));

// ── C. The film's verification card matches the ledger ─────────────────────
console.log('\n── C · the film ──');
const verifyScene = FILM.slice(FILM.indexOf("id: 'verify'"), FILM.indexOf("id: 'brand'"));
t("the verify card reads Amount · 1 RLUSD", /\['Amount', '1 RLUSD[^']*'\]/.test(verifyScene), verifyScene.match(/\['Amount'[^\]]*\]/) + '');
t('the verify card no longer carries the $34,650 demo figure', !/34,650/.test(verifyScene),
  'a demo amount under a real transaction misstates the ledger');
t('the verify card keeps Ledger · validated and Proof · publicly verifiable',
  /\['Ledger', 'validated'\]/.test(verifyScene) && /\['Proof', 'publicly verifiable'\]/.test(verifyScene));
const reconScene = FILM.slice(FILM.indexOf("id: 'recon'"), FILM.indexOf("id: 'recover'"));
t('$34,650 lives in the cap story, where it belongs', /34,650/.test(reconScene));
t('the film verify button opens the real transaction', FILM.includes(`'${EXPLORER}'`));
// MATCHED ON THE ORIGIN, NOT THE FULL PATH. The film is a separate surface and
// its end card still carries the bare origin, so it drops a viewer on the pilot
// marketing page the way every page link used to. That is a known outstanding
// item, deliberately left for a decision rather than changed inside a task
// scoped to the page. Asserting the origin keeps the link covered without
// declaring the current destination correct.
t('the film end card offers the live demo', /pfEndDemo/.test(FILM) && FILM.includes(DEMO_ORIGIN));
t('the film end card "Request a Pilot" reaches the modal, not a mailto',
  /querySelector\('\[data-pilot\]'\)/.test(FILM));
t('the film runtime on the page is stated as ~50 seconds, not 40',
  /50-second|Fifty seconds/.test(TEXT) && !/40-second|forty seconds/i.test(TEXT));

// ── D. The judge path ───────────────────────────────────────────────────────
console.log('\n── D · the judge path ──');
t('the live demo is linked', HTML.includes(`href="${DEMO_URL}"`));
t('every live-demo link is marked data-demo (opens in a new tab)',
  (HTML.match(new RegExp(`href="${rx(DEMO_URL)}"`, 'g')) || []).every(Boolean) &&
  !new RegExp(`href="${rx(DEMO_URL)}"(?![^>]*data-demo)`).test(HTML));
// THE DETOUR MUST NOT COME BACK. A link to the bare origin lands a judge on
// the pilot's marketing homepage, which is the bug this guards: every
// live-demo link goes to the product, or none of them can be trusted to.
t('no live-demo link drops a judge on the pilot marketing homepage',
  !new RegExp(`href="${rx(DEMO_ORIGIN)}/?"`).test(HTML),
  'the bare origin redirects to /home — the pilot pitch, not the product');
t('every live-demo link enters the product at /app',
  (HTML.match(/href="https:\/\/www\.mainstreet-review\.com[^"]*"/g) || [])
    .every(h => h.includes('/app')),
  (HTML.match(/href="https:\/\/www\.mainstreet-review\.com[^"]*"/g) || []).join(' '));
t('the steps no longer promise an account-first journey that starts on a pitch',
  !/Go to the live demo and create an account/i.test(TEXT) && /no marketing page in between/i.test(TEXT));
t('the demo environment is named plainly', /pilot environment/i.test(TEXT) && /demonstration data/i.test(TEXT));
t('the demo properties are the fictional pair', /Cascade Commons/.test(TEXT) && /Northgate Exchange/.test(TEXT));
t('the judges section exists', /id="judges"/.test(HTML));
for (const [what, href] of [
  ['repository', REPO], ['README', `${REPO}/blob/main/README.md`],
  ['XRPL architecture', `${REPO}/blob/pilot/docs/XRPL_ARCHITECTURE.md`],
  ['system architecture', `${REPO}/blob/pilot/docs/MAINSTREET_ARCHITECTURE.md`],
  ['pitch deck', 'assets/hackathon/pitch-deck.pdf'],
]) t(`judges link: ${what}`, HTML.includes(`href="${href}"`));
t('the pitch deck file is present', fs.existsSync(path.join(ROOT, 'assets/hackathon/pitch-deck.pdf')));
t('the film is reachable from the judges section', /id="judges"[\s\S]*index\.html\?demo=1/.test(HTML));
t('all film links use the one in-place href (no /app?demo=1 detour)',
  !/href="\/app\?demo=1"/.test(HTML) && (HTML.match(/href="index\.html\?demo=1"/g) || []).length >= 3);
// The hero keeps its historical filename because the film's recover beat uses
// the same file as its blurred context plate (and test-hero-video.js pins the
// name). The FILE is the pilot capture — the same one the other shots come from.
const PILOT_SHOT = /^assets\/landing\/(pilot\/[^"]+|ui-command-center\.png)$/;
const shots = (HTML.match(/<img[^>]+src="(assets\/landing\/[^"]+)"/g) || []).map(s => s.match(/src="([^"]+)"/)[1]);
t('every screenshot on the page comes from the pilot capture set',
  shots.length >= 6 && shots.every(s => PILOT_SHOT.test(s)),
  'old-build screenshots must not sit beside the live-demo link: ' + shots.filter(s => !PILOT_SHOT.test(s)).join(', '));
for (const img of shots) t(`screenshot exists: ${img}`, fs.existsSync(path.join(ROOT, img)));

// ── E. Nothing internal, nothing stale, nothing unshipped ───────────────────
console.log('\n── E · scope honesty ──');
t('no internal-only pages are linked', !/qa\.html|fixtures\/|test-[a-z-]+\.js|PHASE0_ENGINEERING|PILOT_ACCEPTANCE|OPERATIONAL_RUNBOOK/.test(MARKUP));
t('Acquisition Review is not presented as shipped', !/acquisition review/i.test(TEXT));
t('Production /app is not credited with pilot-only capabilities',
  !/production (has|now has|includes)/i.test(TEXT));
t('"Log in" points at the app root, not an inert query', /href="\/app">Log in</.test(HTML));
t('the pilot request modal is intact', /id="pilotModal"/.test(HTML) && /\/api\/pilot-request/.test(HTML));
t('the positioning line is the H1', /<h1>The <span class="accent">verified memory<\/span> for every commercial property\.<\/h1>/.test(HTML));
t('the six-step progression is present, in order',
  /Upload[\s\S]*Read with evidence[\s\S]*Reconcile[\s\S]*Remember[\s\S]*Settle[\s\S]*Verify/.test(TEXT));

console.log('\n' + '─'.repeat(62));
if (fail) { console.log(`\x1b[31mRESULT: ${pass} passed, ${fail} failed\x1b[0m`); failures.forEach(f => console.log('  · ' + f)); process.exit(1); }
console.log(`\x1b[32mRESULT: ${pass} passed, 0 failed\x1b[0m`);
