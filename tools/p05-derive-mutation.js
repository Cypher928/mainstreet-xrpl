'use strict';
/**
 * tools/p05-derive-mutation.js — does the P0.5 durability contract bite?
 *
 *   node tools/p05-derive-mutation.js
 *
 * Every mutant here is a one-token edit that would break a promise the design
 * makes: history backfilled with an invented actor, a replayed save
 * duplicating the record, a caller choosing their own identity, a malformed
 * legacy entry turning an ordinary property save into a failure. Each is put
 * to the behaviour suite, which drives a real PostgreSQL — the only thing that
 * can tell a working transactional guarantee from a described one.
 *
 * A FAILING BASELINE IS NOT A PASS.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const M = 'migrations/030_property_events_derive.sql';
const A = 'audit-service.js';

const MUTANTS = [
  // ── the watermark: no invented history ───────────────────────────────────
  { id: 'W01', file: M, why: 'legacy activity entries without an id are derived — history with an invented actor',
    from: "      and nullif(btrim(coalesce(e->>'id', '')), '') is not null",
    to:   "      and true" },
  { id: 'W02', file: M, why: 'the timeline watermark is ignored — every pre-existing entry is backfilled',
    from: "      and not (q.k = any (v_legacy))",
    to:   "      and true" },
  { id: 'W03', file: M, why: 'the watermark is seeded empty, so nothing counts as pre-existing',
    from: "       ), '{}'::text[])\nfrom public.properties p",
    to:   "       ) * 0 + '{}'::text[])\nfrom public.properties p" },
  { id: 'W04', file: M, why: 'no watermark is seeded at all',
    from: "insert into public.property_events_watermark (property_id, legacy_timeline_keys)\nselect p.id,",
    to:   "insert into public.property_events_watermark (property_id, legacy_timeline_keys)\nselect p.id," + "\n-- disabled\nwhere false;\nselect p.id," },

  // ── idempotency ──────────────────────────────────────────────────────────
  { id: 'I01', file: M, why: 'the activity insert drops ON CONFLICT — a replayed save duplicates history',
    from: "      and nullif(btrim(coalesce(e->>'id', '')), '') is not null\n    on conflict (property_id, source_key) where source_key is not null do nothing;",
    to:   "      and nullif(btrim(coalesce(e->>'id', '')), '') is not null;" },
  { id: 'I02', file: M, why: 'the timeline keys on id rather than dedupeKey — a reload duplicates the event',
    from: "             coalesce(\n               nullif(btrim(coalesce(e->'metadata'->>'dedupeKey', '')), ''),\n               nullif(btrim(coalesce(e->>'id', '')), '')\n             ) as k",
    to:   "             nullif(btrim(coalesce(e->>'id', '')), '') as k" },
  { id: 'I03', file: M, why: 'the uniqueness index is gone, so nothing stops a duplicate at the database level',
    from: "create unique index if not exists property_events_source_key_uniq",
    to:   "create index if not exists property_events_source_key_uniq" },
  { id: 'I04', file: M, why: 'source_key is never set, so no event can be matched to its entry',
    from: "      'activity:' || btrim(e->>'id')",
    to:   "      null" },

  // ── identity ─────────────────────────────────────────────────────────────
  { id: 'D01', file: M, why: 'the caller\'s actor_uid is passed through — identity becomes client input',
    from: "      (property_id, action, subject_type, subject_id, detail, client_ts, source_key)\n    select\n      new.id,\n      left(coalesce(nullif(btrim(e->>'type'), ''), 'unknown'), 80),",
    to:   "      (property_id, actor_uid, action, subject_type, subject_id, detail, client_ts, source_key)\n    select\n      new.id,\n      nullif(btrim(coalesce(e->>'actor_uid','')),'')::uuid,\n      left(coalesce(nullif(btrim(e->>'type'), ''), 'unknown'), 80)," },
  // D02 RETIRED — EQUIVALENT. It passed the caller's organization_id into the
  // insert, and the suite stayed green because 028b's stamp trigger derives
  // organization_id from property_id UNCONDITIONALLY and overwrites whatever
  // arrives. The defence is real, it simply lives one layer down. Verified by
  // applying the mutation: F2 still passes because the stamp overrides it.
  // That is defence in depth working, not a hole, so the mutant is retired
  // rather than re-pinned. D01 and D03 still cover 030's own identity inputs.
  { id: 'D03', file: M, why: 'the event is filed against the property the client names, not the row being written',
    from: "    select\n      new.id,\n      left(coalesce(nullif(btrim(e->>'type'), ''), 'unknown'), 80),",
    to:   "    select\n      coalesce(nullif(btrim(coalesce(e->>'propertyId','')),'')::uuid, new.id),\n      left(coalesce(nullif(btrim(e->>'type'), ''), 'unknown'), 80)," },

  // ── totality: a malformed entry must not fail an ordinary save ───────────
  { id: 'T01', file: M, why: 'the action clamp is gone — a long legacy type fails the whole property save',
    from: "      left(coalesce(nullif(btrim(e->>'type'), ''), 'unknown'), 80),",
    to:   "      coalesce(nullif(btrim(e->>'type'), ''), 'unknown')," },
  { id: 'T02', file: M, why: 'the empty-type fallback is gone — a blank legacy type fails the save',
    from: "      left(coalesce(nullif(btrim(e->>'type'), ''), 'unknown'), 80),",
    to:   "      left(coalesce(e->>'type', 'unknown'), 80)," },
  { id: 'T03', file: M, why: 'the timestamp is cast directly — one bad legacy value fails the save',
    from: "      coalesce(public._p05_safe_ts(e->>'timestamp'), now()),",
    to:   "      coalesce((e->>'timestamp')::timestamptz, now())," },
  { id: 'T04', file: M, why: 'the safe cast re-raises instead of returning null',
    from: "exception when others then\n  return null;\nend $$;",
    to:   "exception when others then\n  raise;\nend $$;" },
  // T05 RETIRED — EQUIVALENT. It removed the `jsonb_typeof(e) = 'object'`
  // filter. Measured on PostgreSQL 16: `->>` against a scalar, a number or a
  // JSON null returns NULL rather than raising, so the id/key filter that
  // follows already excludes every non-object element. The typeof guard is
  // redundant belt-and-braces, and a mutant that cannot change behaviour is
  // retired rather than propped up with an assertion about nothing. T06 keeps
  // the guard that IS load-bearing: jsonb_array_elements RAISES on a scalar.
  { id: 'T06', file: M, why: 'the array guard is gone, so a non-array activityLog fails the save',
    from: "  if jsonb_typeof(new.data->'activityLog') = 'array' then",
    to:   "  if true then" },

  // ── the client-side identity the watermark depends on ────────────────────
  { id: 'C01', file: A, why: 'shapeEvent stops assigning an id, so no new activity can ever become history',
    from: "      id:              (typeof opts.id === 'string' && opts.id.trim()) ? opts.id.trim() : newEventId(),",
    to:   "" },
  { id: 'C02', file: A, why: 'the id is derived from mutable display values, so two events in one millisecond collide',
    from: "  function newEventId() {",
    to:   "  function newEventId() {\n    return 'ae-collide';" },
  { id: 'C03', file: A, why: 'a caller-supplied id is discarded, so a replayed event mints a second identity',
    from: "      id:              (typeof opts.id === 'string' && opts.id.trim()) ? opts.id.trim() : newEventId(),",
    to:   "      id:              newEventId()," },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p05mut-'));
fs.cpSync(ROOT, tmp, {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(ROOT, src);
    return !(rel === '.git' || rel.startsWith('.git' + path.sep) || rel === 'node_modules' || rel.startsWith('node_modules' + path.sep));
  },
});
const ORIGINAL = {};
for (const m of MUTANTS) if (!ORIGINAL[m.file]) ORIGINAL[m.file] = fs.readFileSync(path.join(ROOT, m.file), 'utf8');

const SUITES = ['test-030-event-derivation.js'];
function runSuites() {
  const failed = [];
  for (const suite of SUITES) {
    try { execFileSync(process.execPath, [suite], { cwd: tmp, stdio: 'pipe', timeout: 400000 }); }
    catch (_) { failed.push(suite); }
  }
  return failed;
}

const baseline = runSuites();
console.log('Baseline (unmutated copy): ' + (baseline.length ? 'FAIL ' + baseline.join(', ') : 'PASS'));
if (baseline.length) {
  console.error('\nThe unmutated copy does not pass, so every result below would be meaningless. Nothing is mutated.');
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(2);
}

let killed = 0, survived = 0;
const survivors = [];
for (const m of MUTANTS) {
  const src = ORIGINAL[m.file];
  if (src.indexOf(m.from) === -1) {
    console.log(`  ?  ${m.id} anchor not found in ${m.file} — the harness is stale, not the product`);
    survived++; survivors.push(m.id + ' (anchor missing)');
    continue;
  }
  fs.writeFileSync(path.join(tmp, m.file), src.replace(m.from, m.to));
  const failed = runSuites();
  fs.writeFileSync(path.join(tmp, m.file), src);
  if (failed.length) { killed++; console.log(`  \x1b[32m☠\x1b[0m  ${m.id} killed — ${m.why}`); }
  else { survived++; survivors.push(m.id); console.log(`  \x1b[31m✗\x1b[0m  ${m.id} SURVIVED — ${m.why}`); }
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('\n' + '─'.repeat(58));
console.log(`${killed} killed, ${survived} survived of ${MUTANTS.length}`);
if (survived) { survivors.forEach(s => console.log('  · ' + s)); process.exit(1); }
