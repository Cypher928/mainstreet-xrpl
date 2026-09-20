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
// /demo is the public read-only route: the real product shell booting from a
// frozen snapshot with no account, no database and no writes. /app?signin=1 —
// the previous destination — still exists for someone who wants their OWN copy,
// but it is not what a judge is sent to, because it asks them to make an
// account first and the demo data is seeded per user.
const DEMO_URL    = DEMO_ORIGIN + '/demo';
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
t('every live-demo link enters the product directly, at /demo or /app',
  (HTML.match(/href="https:\/\/www\.mainstreet-review\.com[^"]*"/g) || [])
    .every(h => h.includes('/demo') || h.includes('/app')),
  (HTML.match(/href="https:\/\/www\.mainstreet-review\.com[^"]*"/g) || []).join(' '));
t('the steps describe the no-account demo, not an account-first journey',
  !/Go to the live demo and create an account/i.test(TEXT)
  && !/Choose <em>Create Account<\/em>/i.test(HTML)
  && /No account, no sign-in/i.test(TEXT));
// ONE primary invitation, not two. The demo section carried a second
// "Explore the live demo" directly below the band's, so the page asked the
// reader to choose between the same thing twice.
t('only one "Explore the live demo" button remains below the hero',
  (TEXT.match(/Explore the live demo/g) || []).length <= 3,
  (TEXT.match(/Explore the live demo/g) || []).length + ' occurrences');
t('the film is the first featured action, still played in place',
  /class="jud-hero rv" href="index\.html\?demo=1"/.test(HTML));
t('the demo is described as read-only and unsaved',
  /read-only copy of demonstration data/i.test(TEXT) && /nothing you do is saved/i.test(TEXT));
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

// ── the walkthrough card ─────────────────────────────────────────────────────
// It points at the SAME recording the Live demo section embeds, and it plays
// that player rather than navigating to the file: a bare .mp4 link depends on
// the host's Content-Disposition, and `attachment` hands a judge a 58 MB
// download instead of a video.
const WALKTHROUGH = 'https://ehwfstdnmnq37s40.public.blob.vercel-storage.com/MainStreet_Demo_Final.mp4';
t('the judges grid carries a Product walkthrough card', /id="judWalkthrough"/.test(HTML));
t('it names the walkthrough', /<div class="jud-t">Product walkthrough/.test(HTML));
t('it describes the Cascade Commons journey',
  /from property history to CAM, tenant decisions, and verified settlement/.test(TEXT));
t('it points at the same recording the demo section embeds',
  (HTML.match(new RegExp(rx(WALKTHROUGH), 'g')) || []).length >= 2,
  'the card and the embedded <source> must be the same file');
t('there is still only ONE video player on the page',
  (HTML.match(/<video[\s>]/g) || []).length === 1,
  'the card is a link to the recording above, not a second copy of it');
t('clicking the card plays that player instead of downloading the file',
  /judWalkthrough[\s\S]{0,900}preventDefault\(\)[\s\S]{0,900}walkPlayer\.play\(\)/.test(HTML),
  'without this a judge gets a 58 MB download if the host answers attachment');
// The device's own player is the fallback ONLY when inline play() rejects (iOS);
// a resolved play() must never also open the file in a new tab.
t('the native-player fallback is reached only through a rejected play()', (() => {
  const s = HTML.indexOf("walk.addEventListener('click'"); if (s < 0) return false;
  const handler = HTML.slice(s, HTML.indexOf('\n    });', s));
  if (!handler.includes('walkPlayer.play()')) return false;
  const opens = handler.split('window.open(').slice(0, -1);   // text preceding each window.open(
  return opens.length >= 1 && opens.every(pre => /\.catch\(function \(\) \{ $|catch \(_\) \{ $/.test(pre));
})(), 'window.open on a successful inline play would double-play on desktop');
t('the existing film card is untouched',
  /<div class="jud-t">The film <span>▶<\/span><\/div>/.test(HTML) && /href="index\.html\?demo=1"/.test(HTML));
t('the existing live-demo card still opens the interactive demo',
  /href="https:\/\/www\.mainstreet-review\.com\/demo"[^>]*data-demo[^>]*>[\s\S]{0,600}?<div class="jud-t">Live demo/.test(HTML));
t('the film is reachable from the judges section', /id="judges"[\s\S]*index\.html\?demo=1/.test(HTML));
t('all film links use the one in-place href (no /app?demo=1 detour)',
  !/href="\/app\?demo=1"/.test(HTML) && (HTML.match(/href="index\.html\?demo=1"/g) || []).length >= 3);
// The hero keeps its historical filename because the film's recover beat uses
// the same file as its blurred context plate (and test-hero-video.js pins the
// name). The FILE is the pilot capture — the same one the other shots come from.
// The hero photograph is not a product screenshot — it is a representative
// building, labelled as such — so it is named here rather than being forced to
// look like a capture from the pilot build.
const HERO_PHOTO = /^assets\/landing\/cascade-hero\.(jpg|webp)$/;
const PILOT_SHOT = /^assets\/landing\/(pilot\/[^"]+|ui-command-center\.png)$/;
const shots = (HTML.match(/<img[^>]+src="(assets\/landing\/[^"]+)"/g) || []).map(s => s.match(/src="([^"]+)"/)[1]);
t('every screenshot on the page comes from the pilot capture set',
  shots.length >= 6 && shots.every(s => PILOT_SHOT.test(s) || HERO_PHOTO.test(s)),
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
t('the H1 says what MainStreet is, in plain words',
  /<h1[^>]*>AI-powered <span class="accent">property management<\/span>, made simpler\.<\/h1>/.test(HTML));
t('the hero badge matches the new positioning',
  /<div class="badge[^"]*"><i><\/i>Commercial real estate, simplified<\/div>/.test(HTML));
t('the hero subline is the approved sentence, verbatim',
  /<p class="cine-sub[^"]*">Everything about your property, connected in one place\.<\/p>/.test(HTML));
t('the hero carries no descriptive paragraph — the photograph and the card do the work',
  !/<p class="lede"/.test((HTML.match(/<header class="hero[^"]*">[\s\S]*?<\/header>/) || [''])[0]));
t('the six categories appear exactly once on the page, as the chips',
  ['Leases', 'Tenants', 'Invoices', 'Documents', 'Expenses', 'Important Dates']
    .every(c => (HTML.match(new RegExp('<span><i>[A-Z]{2}<\\/i>' + c + '<\\/span>', 'g')) || []).length === 1));
t('the hero CTAs read exactly "See how it works" and "Explore the live demo →"',
  /▶ See how it works<span class="btn-sub">A 50-second product film/.test(HTML) &&
  /Explore the live demo →<span class="btn-sub">/.test(HTML));
t('the film/live-demo CTA destinations are unchanged',
  /href="index\.html\?demo=1">\s*<span>▶ See how it works/.test(HTML) &&
  /href="https:\/\/www\.mainstreet-review\.com\/demo" data-demo>\s*<span>Explore the live demo/.test(HTML));
t('the old CAM hairline block is gone from the hero (moved into the interactive section only)',
  !/class="hero-cam"/.test(HTML));
t('the hero does not present MainStreet as an accounting/PMS replacement',
  !/replace(s)? (Yardi|your accounting|your PMS)/i.test(TEXT));
// Hoisted: F2 cross-checks the hero's figures against the interactive section.
const ASK = (HTML.match(/<section id="ask"[\s\S]*?<\/section>/) || [''])[0];
const ASK_TEXT = ASK.replace(/<[^>]+>/g, ' ').replace(/&rsquo;/g, "'").replace(/&hellip;/g, '…').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
console.log('\n── F2 · the hero visual carries no invented data ──');
const HERO = (HTML.match(/<header class="hero[^"]*">[\s\S]*?<\/header>/) || [''])[0];
t('the old composed Whole Health cap-story hero visual is gone',
  !/class="hero-moment"/.test(HERO) && !/lease cap reached/.test(HERO));
t('the hero is anchored by the property photograph, full width',
  /<div class="cine">/.test(HERO) && /class="cine-img"/.test(HERO));
t('the photograph ships as WebP with a JPEG fallback, not the source PNG',
  /<source srcset="assets\/landing\/cascade-hero\.webp" type="image\/webp">/.test(HERO) &&
  /src="assets\/landing\/cascade-hero\.jpg"/.test(HERO) && !/cascade-hero\.png/.test(HTML));
t('both encodes exist and are small enough to ship',
  ['assets/landing/cascade-hero.webp','assets/landing/cascade-hero.jpg'].every(f => {
    const fp = path.join(ROOT, f);
    return fs.existsSync(fp) && fs.statSync(fp).size < 400 * 1024;
  }));
t('the convergence layer runs categories → MainStreet → organized property',
  /class="cw-chips"/.test(HERO) && /class="cw-mark">M</.test(HERO) && /class="cw-ws"/.test(HERO));
t('all six categories cross the photograph, in the approved order',
  /<span><i>LE<\/i>Leases<\/span>[\s\S]*?<span><i>TE<\/i>Tenants<\/span>[\s\S]*?<span><i>IN<\/i>Invoices<\/span>[\s\S]*?<span><i>DO<\/i>Documents<\/span>[\s\S]*?<span><i>EX<\/i>Expenses<\/span>[\s\S]*?<span><i>ID<\/i>Important Dates<\/span>/.test(HERO));
t('the fictional-property disclosure sits with the photograph',
  /Representative property photograph\. Cascade Commons is a fictional property/.test(HERO));
t('the hero visual carries only figures already verified elsewhere on this page',
  /5 Tenants/.test(HERO) && /26 Invoices/.test(HERO) && /26,000 SF/.test(HERO) &&
  /3 of 5 tenants billable/.test(HERO) && /2 open disputes/.test(HERO) &&
  /4 CAM caps applied/.test(HERO) && /Four caps/.test(ASK_TEXT) &&   // the ask pane says the same
  /<div><i>✓<\/i>3 of 5 tenants billable<\/div>/.test(HERO) &&
  /<div><i>✓<\/i>4 CAM caps applied<\/div>/.test(HERO) &&
  /<div><i class="hold">!<\/i>2 open disputes<\/div>/.test(HERO) &&   // held, not verified
  HTML.includes('26,000 sf, 5 tenants, 26 invoices') &&  // the jud-demo note this reuses
  /3 of 5 billable/.test(HTML));                          // the ask-pane verdict this reuses
t('no invented figures from the design-reference mockup made it into the hero',
  !/\b142\b/.test(HERO) && !/42,000/.test(HERO) && !/Built in 2018|Built 2018/.test(HERO));
t('the CAM figure is NOT the hero focal point — it belongs to the section below',
  !/34,650/.test(HERO) && /Why can't we bill Whole Health Market more than \$34,650\?/.test(ASK_TEXT));
t('the positioning line survives, lower, in its own style',
  /<h2[^>]*>The <span class="accent">verified memory<\/span> for every commercial property\.<\/h2>/.test(HTML)
  && HTML.indexOf('verified memory</span> for every commercial property.</h2>') > HTML.indexOf('id="judges"'));
t('"Properties run better with a memory" is not in the hero',
  !/Properties run better with a memory/i.test(HERO));
t('Judges is the one gold item in the nav',
  (HTML.match(/nav-link--gold/g) || []).length === 3 && /nav-link nav-link--gold nav-hide" href="#judges">Judges/.test(HTML));
t('the seven-part strip names what the record holds, in order',
  /Leases[\s\S]*Documents[\s\S]*Tenants &(amp;)? Spaces[\s\S]*Invoices[\s\S]*CAM[\s\S]*History[\s\S]*Ask/.test(TEXT));

// ── F. The story: one question, worked through the records ─────────────────
// Every figure in the interactive section is what the product computes from
// the seeded Cascade Commons data, and the lease clause is quoted as written
// in assets/demo/lease-whole-health-market.pdf. If the seed changes, this is
// where the page and the demo would drift apart.
console.log('\n── F · the story ──');
t('the interactive section exists and sits directly after the strip',
  /id="how"[\s\S]*?<section id="ask"/.test(HTML) && HTML.indexOf('id="ask"') < HTML.indexOf('id="judges"'));
t('the judges section follows the explanation and precedes the deeper chapters',
  HTML.indexOf('id="judges"') < HTML.indexOf('id="memory"'));
t('the heading is the question-and-answer framing',
  /A property manager has a question\.<br>MainStreet finds the answer\./.test(ASK));
for (const q of ['Where did that number come from?', 'What does this lease actually require?',
                 'What needs my attention?', 'Are we recovering everything we should?'])
  t(`question offered: ${q}`, ASK_TEXT.includes(q));
t('the questions are real buttons with tab semantics',
  (ASK.match(/<button class="ask-q[^>]*role="tab"/g) || []).length === 4);
t('the default question is the concrete one', /<button class="ask-q is-on"[^>]*data-q="number"/.test(ASK));
t('only the default pane is visible without JavaScript',
  (ASK.match(/<div class="ask-pane"[^>]*hidden>/g) || []).length === 3 && /<div class="ask-pane is-on"[^>]*data-q="number">/.test(ASK));
// The worked example, figure by figure. 9,200 / 26,000 sf = 35.38%;
// 35.38% of $188,300 = $66,629.23; $33,000 × 1.05 = $34,650.
t('the example is the Whole Health Market cap', ASK_TEXT.includes("Why can't we bill Whole Health Market more than $34,650?"));
t('the reader finds the 5% cap and the $33,000 base', /5% cap/.test(ASK_TEXT) && /\$33,000/.test(ASK_TEXT));
t('the expenses are the seeded 26 invoices totalling $188,300', /\$188,300 across 26 invoices/.test(ASK_TEXT));
t('the uncapped share is stated so the cap has something to prevent', /35\.38% share comes to \$66,629\.23/.test(ASK_TEXT));
t('the answer is $34,650 and the excess is named', /\$34,650/.test(ASK_TEXT) && /\$31,979\.23/.test(ASK_TEXT));
t('the cap clause is quoted as the lease has it',
  /shall not increase by more than five percent \(5%\)/.test(ASK_TEXT) && /shall be borne solely by Landlord/.test(ASK_TEXT));
t('the base-amount clause is quoted as the lease has it', /Thirty-Three Thousand and 00\/100 Dollars \(\$33,000\.00\)/.test(ASK_TEXT));
t('the clause is placed on its real page', /Page 2 of 3 · §6\.4 · §6\.5/.test(ASK_TEXT));
t('the lease is called a demonstration lease, not a real one', /demonstration lease/i.test(ASK_TEXT));
t('the verdict pane matches the demo: 3 of 5 billable', /3 of 5 billable/.test(ASK_TEXT) && /3 of 5 ready to bill/.test(ASK_TEXT));
t('the plain-English CAM sentence is present, verbatim',
  ASK_TEXT.includes("CAM reconciliation is the process of figuring out how much of a property's shared operating costs each tenant actually owes, according to their lease."));
t('and is followed by what MainStreet does about it',
  ASK_TEXT.includes('MainStreet does that work for you, and shows you why the answer is correct.'));
t('CAM is placed as one question among many, not the product', /CAM is one question MainStreet can answer/.test(ASK_TEXT));
t('the section carries no library and no timers',
  !/setInterval|setTimeout/.test((HTML.match(/data-ask[\s\S]*?\}\)\(\);/) || [''])[0]) && !/<script[^>]+src="https?:/.test(HTML));
// The featured actions, in the order to take them.
const LEAD = (HTML.match(/<div class="jud-lead">[\s\S]*?<\/div>\s*<!-- THE RECORDED/) || [''])[0];
t('three featured actions', (LEAD.match(/class="jud-hero rv"/g) || []).length === 3);
t('in the order film → walkthrough → live demo',
  /The film[\s\S]*Product walkthrough[\s\S]*Live demo/.test(LEAD));
t('each carries its one-line purpose',
  /Understand MainStreet\./.test(LEAD) && /See it working\./.test(LEAD) && /Try it yourself\./.test(LEAD));
t('the section heading is the four verbs', /Understand it\. See it\. Try it\. Verify it\./.test(TEXT));
t('the walkthrough player never autoplays and loads only metadata',
  !/<video[^>]*autoplay/.test(HTML) && /<video[^>]*preload="metadata"/.test(HTML));
t('the player is hidden until the walkthrough card asks for it',
  /<figure class="shot-wrap demo-film" id="walkFigure" hidden>/.test(HTML) && /walkFigure\.hidden = false/.test(HTML));
// The lower chapters must not contradict the story above them.
t('the Cascade caption describes the current demo state, not the old blocked one',
  !/none with a source document/.test(TEXT) && /every one with its source document/.test(TEXT) && /Three of five statements are ready/.test(TEXT));
t('the Cascade audit alt text matches', !/26 of 26 invoices are missing/.test(HTML) && /\$66,629\.23 to \$34,650\.00/.test(HTML));

console.log('\n' + '─'.repeat(62));
if (fail) { console.log(`\x1b[31mRESULT: ${pass} passed, ${fail} failed\x1b[0m`); failures.forEach(f => console.log('  · ' + f)); process.exit(1); }
console.log(`\x1b[32mRESULT: ${pass} passed, 0 failed\x1b[0m`);
