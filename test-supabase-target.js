'use strict';
/**
 * test-supabase-target.js — a live test must never quietly reach production.
 *
 *   node test-supabase-target.js
 *
 * THE DEFECT THIS EXISTS FOR
 *
 * Three suites verify security and persistence against a real database.
 * test-tenant-authz.js pins itself to the PILOT project and aborts if the URL
 * is anything else. The other two carried the PRODUCTION url and anon key as
 * plain literals:
 *
 *   test-rls-cross-user.js        read the customer database
 *   test-supabase-integration.js  INSERTED into it, via ms_debug_dualwrite()
 *
 * Nobody had run either — they were in the unregistered pile — so nothing said
 * so. Handing them pilot credentials would not have changed where they went;
 * the accounts would have been ignored and the writes would have landed in the
 * customer database.
 *
 * WHAT THIS PINS
 *
 * That the resolver has no path to production that is not deliberate, and no
 * fallback of any kind. Every refusal case matters more than the happy one:
 * the damage in the original defect came from a test going somewhere quietly,
 * and every branch below is about removing a way to be quiet.
 *
 * It also pins the two things that let the defect exist in the first place:
 * the project details are READ from supabase-config.js rather than copied
 * (a copied key is a key that drifts), and neither suite may contain a
 * hard-coded project ref again.
 *
 * OFFLINE. It resolves configuration and reads source; it opens no sockets and
 * needs no credentials.
 */

const fs   = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const T = require('./test-support/supabase-target.js');

let pass = 0, fail = 0;
const failures = [];
function t(name, fn) {
  try { fn(); pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  catch (e) { fail++; failures.push(`${name}: ${e.message}`); console.log(`  \x1b[31m✗\x1b[0m ${name}\n      → ${e.message}`); }
}
const ok = (c, m) => { if (!c) throw new Error(m || 'expected truthy'); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m || ''} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
function refuses(env, why) {
  let got = null;
  try { got = T.resolveTarget(env); }
  catch (e) {
    ok(e.refused === true, `threw, but not as a refusal: ${e.message}`);
    return e;
  }
  throw new Error(`${why} — it resolved to ${got.name} (${got.url}) instead of refusing`);
}

const ROOT = __dirname;
const PROD_REF  = 'zhsuhehgehbzkmzurzyf';
const PILOT_REF = 'bhmktujbxdbvdmpybmad';

console.log('\n══ Which database does a live test talk to? ══');

console.log('\n── The default direction is pilot ──');

t('with nothing set at all, the target is pilot', () => {
  const r = T.resolveTarget({});
  eq(r.name, 'pilot');
  eq(r.isProduction, false);
  ok(r.url.includes(PILOT_REF), `resolved to ${r.url}`);
});

t('an empty value is still pilot, not a refusal and not production', () => {
  const r = T.resolveTarget({ MS_TEST_SUPABASE_TARGET: '' });
  eq(r.name, 'pilot');
});

t('pilot named explicitly is pilot', () => {
  const r = T.resolveTarget({ MS_TEST_SUPABASE_TARGET: 'pilot' });
  eq(r.name, 'pilot');
  ok(r.url.includes(PILOT_REF), r.url);
});

t('the pilot target is never the production project', () => {
  const r = T.resolveTarget({});
  ok(!r.url.includes(PROD_REF), `pilot resolved to the production project: ${r.url}`);
  ok(r.anonKey !== T.productionConfig().anonKey, 'pilot is carrying the production anon key');
});

console.log('\n── Production requires an explicit, exact act ──');

t('asking for production without the force variable is refused', () => {
  const e = refuses({ MS_TEST_SUPABASE_TARGET: 'production' },
                    'production was reachable with nothing but a target name');
  ok(/MS_TEST_ALLOW_PRODUCTION/.test(e.message), e.message);
});

t('a plausible-looking force value is not the force value', () => {
  for (const v of ['1', 'true', 'yes', 'i-understand', T.FORCE_TOKEN + 'x', T.FORCE_TOKEN.toUpperCase()]) {
    refuses({ MS_TEST_SUPABASE_TARGET: 'production', MS_TEST_ALLOW_PRODUCTION: v },
            `"${v}" was accepted as the production force token`);
  }
});

t('the exact token, and only then, reaches production', () => {
  const r = T.resolveTarget({ MS_TEST_SUPABASE_TARGET: 'production',
                              MS_TEST_ALLOW_PRODUCTION: T.FORCE_TOKEN });
  eq(r.name, 'production');
  eq(r.isProduction, true);
  eq(r.forced, true);
  ok(r.url.includes(PROD_REF), r.url);
});

t('the force variable alone does not move the target', () => {
  // Someone leaves MS_TEST_ALLOW_PRODUCTION set in a shell and forgets. That
  // must not be enough on its own — it authorises, it does not select.
  const r = T.resolveTarget({ MS_TEST_ALLOW_PRODUCTION: T.FORCE_TOKEN });
  eq(r.name, 'pilot', 'the force token by itself selected production —');
});

console.log('\n── There is no fallback. Anywhere. ──');

t('an unrecognised target is refused, not defaulted', () => {
  // The tempting bug is `want === "production" ? prod : pilot`, which turns
  // every typo into a silent pilot run. That is friendlier and wrong: the
  // person asked for something this resolver does not understand, and guessing
  // is how a test ends up somewhere nobody intended.
  for (const v of ['prod', 'staging', 'live', 'pilot2', 'production!', 'pilotproduction']) {
    refuses({ MS_TEST_SUPABASE_TARGET: v }, `"${v}" was silently interpreted`);
  }
});

t('case and stray whitespace are normalised, not guessed at', () => {
  // "PILOT " is not an unrecognised value being defaulted — it is the same
  // value, spelled by a human. Normalising it is fine. What matters is that
  // normalisation cannot become a route INTO production: the uppercase and
  // padded spellings of production must still demand the force token.
  eq(T.resolveTarget({ MS_TEST_SUPABASE_TARGET: 'PILOT ' }).name, 'pilot');
  eq(T.resolveTarget({ MS_TEST_SUPABASE_TARGET: '  pilot' }).name, 'pilot');
  for (const v of ['PRODUCTION', ' production ', 'Production']) {
    refuses({ MS_TEST_SUPABASE_TARGET: v },
            `"${v}" reached production without the force token`);
    eq(T.resolveTarget({ MS_TEST_SUPABASE_TARGET: v,
                         MS_TEST_ALLOW_PRODUCTION: T.FORCE_TOKEN }).name, 'production');
  }
});

t('a refusal is a refusal, not a null the caller might ignore', () => {
  const e = refuses({ MS_TEST_SUPABASE_TARGET: 'production' }, 'no refusal');
  eq(e.name, 'TargetRefused');
  eq(e.refused, true);
});

console.log('\n── A refusal ends the process, non-zero ──');

t('resolveOrAbort exits 2 rather than continuing', () => {
  // Spawned for real: the value of the fail-safe is that the suite STOPS, and
  // a thrown-and-caught error inside this process would not prove that.
  let code = 0, out = '';
  try {
    execFileSync(process.execPath,
      ['-e', "require('./test-support/supabase-target.js').resolveOrAbort('probe')"],
      { cwd: ROOT, encoding: 'utf8', stdio: 'pipe',
        env: { ...process.env, MS_TEST_SUPABASE_TARGET: 'production', MS_TEST_ALLOW_PRODUCTION: '' } });
  } catch (err) {
    code = err.status;
    out = (err.stdout || '') + (err.stderr || '');
  }
  eq(code, 2, 'a refused target did not exit 2 —');
  ok(/ABORT/.test(out), out.slice(0, 200));
});

t('and a permitted target reports which database it chose', () => {
  const out = execFileSync(process.execPath,
    ['-e', "require('./test-support/supabase-target.js').resolveOrAbort('probe')"],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, MS_TEST_SUPABASE_TARGET: 'pilot' } });
  ok(/TARGET: pilot/.test(out), `a live test ran without saying where: ${out}`);
  ok(out.includes(PILOT_REF), out);
});

console.log('\n── The projects are read, not copied ──');

t('both projects come from supabase-config.js', () => {
  const cfgSrc = fs.readFileSync(path.join(ROOT, 'supabase-config.js'), 'utf8');
  const pilot = T.pilotConfig(), prod = T.productionConfig();
  ok(cfgSrc.includes(pilot.url),     'the pilot url is not the one supabase-config.js ships');
  ok(cfgSrc.includes(pilot.anonKey), 'the pilot anon key is not the one supabase-config.js ships');
  ok(cfgSrc.includes(prod.url),      'the production url is not the one supabase-config.js ships');
  eq(prod.isProduction, true, 'supabase-config.js no longer labels the prod host as production —');
});

t('the resolver holds no project literals of its own', () => {
  const src = fs.readFileSync(path.join(ROOT, 'test-support/supabase-target.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(!src.includes(PROD_REF),  'the production project ref is written into the resolver');
  ok(!src.includes(PILOT_REF), 'the pilot project ref is written into the resolver');
});

console.log('\n── Neither suite can go back to a hard-coded project ──');

for (const f of ['test-rls-cross-user.js', 'test-supabase-integration.js']) {
  t(`${f} resolves its target instead of naming one`, () => {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    ok(!src.includes(PROD_REF),
       `${f} still contains the production project ref — this is the exact defect`);
    ok(!src.includes(PILOT_REF),
       `${f} hard-codes the pilot ref; it must RESOLVE the target so the fail-safe applies`);
    ok(/require\(['"]\.\/test-support\/supabase-target\.js['"]\)/.test(src),
       `${f} does not go through the target resolver`);
    ok(/resolveOrAbort\(/.test(src),
       `${f} resolves without the abort wrapper — a refusal would not stop it`);
    ok(!/supabase\.co/.test(src.replace(/resolveOrAbort[\s\S]{0,200}/, '')),
       `${f} names a supabase host directly somewhere`);
  });
}

t('test-tenant-authz.js remains pinned to pilot on its own terms', () => {
  // Untouched by this change, and it should stay untouched: it already refuses
  // to run against anything but the pilot ref. Asserted so a later "tidy-up"
  // does not route it through the resolver and hand it a production switch.
  const src = fs.readFileSync(path.join(ROOT, 'test-tenant-authz.js'), 'utf8');
  ok(src.includes(PILOT_REF), 'test-tenant-authz.js no longer pins the pilot project');
  ok(!src.includes(PROD_REF), 'test-tenant-authz.js gained a production project ref');
  ok(/abort\('URL is not the pilot project\.'\)/.test(src),
     'test-tenant-authz.js lost its own pilot guard');
});

const TOTAL_EXPECTED = 19;
t(`suite runs all ${TOTAL_EXPECTED} checks`, () => {
  eq(pass + fail + 1, TOTAL_EXPECTED, 'test count changed — update TOTAL_EXPECTED deliberately');
});

console.log('\n' + '─'.repeat(58));
if (fail) {
  console.log(`\x1b[31mRESULT: ${pass} passed, ${fail} failed\x1b[0m`);
  failures.forEach(f => console.log(`  · ${f}`));
  process.exit(1);
}
console.log(`\x1b[32mRESULT: ${pass} passed, 0 failed\x1b[0m`);
