'use strict';
/**
 * test-payment-schema-contract.js — Phase 1a: the migration encodes the decisions.
 *
 *   node test-payment-schema-contract.js
 *
 * Read-only. No database: migration 022 has NOT been applied, and this suite
 * exists precisely so it can be reviewed before it is. It reads the SQL as text
 * and asserts that each approved decision is actually in it.
 *
 * COMMENTS ARE STRIPPED FIRST. 022's header explains the rules it enforces and
 * names the values it forbids — including the word `verified` — so an unstripped
 * pin would match the explanation and pass for the wrong reason. That trap has
 * caught source assertions in this repo before; it does not get to do it again.
 */

const fs = require('fs');

let pass = 0, fail = 0;
const ok  = (m, d) => { console.log('  \x1b[32m✓\x1b[0m ' + m + (d ? '  — ' + d : '')); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '  — ' + d : '')); fail++; };
const is  = (c, m, d) => (c ? ok(m, d) : bad(m, d));
const eq  = (a, b, m) => (a === b ? ok(m, JSON.stringify(a))
                                  : bad(m, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`));
const sec = (t) => console.log('\n\x1b[1m── ' + t + ' ──\x1b[0m');

const RAW  = fs.readFileSync('./migrations/022_payment_management.sql', 'utf8');
const SQL  = RAW.replace(/^\s*--.*$/gm, '');
const BACK = fs.readFileSync('./migrations/022_payment_management_rollback.sql', 'utf8')
               .replace(/^\s*--.*$/gm, '');
const M    = require('./tools/payment-state-machine.js');

// ── A. Target and blast radius ─────────────────────────────────────────────
sec('A. Pilot only, and nothing outside the payment tables');
{
  is(/PILOT PROJECT ONLY \(bhmktujbxdbvdmpybmad\)/.test(RAW), 'A1 header names Pilot as the target');
  is(/NEVER apply to production \(zhsuhehgehbzkmzurzyf\)/.test(RAW), 'A2 and names production as forbidden');

  // The only tables it may create.
  const created = [...SQL.matchAll(/create table if not exists public\.(\w+)/g)].map(m => m[1]).sort();
  eq(JSON.stringify(created),
     JSON.stringify(['payment_events','payment_settlements','payment_sources','payments']),
     'A3 exactly four tables are created');

  // It must not touch the settlement rail, the wallet, or anything Ripple.
  // 'external_rlusd' is a METHOD LABEL — a record of how a landlord says a
  // payment was made outside MainStreet. It is not an integration, and the
  // distinction is the whole point of the phase, so the pin excludes it by name
  // rather than by loosening the rule.
  is(!/rlusd|xrpl|xrp\b|wallet|ripple/i.test(SQL.replace(/'external_rlusd'/g, '')),
     'A4 no wallet, ledger, or Ripple object anywhere in the SQL — only the external_rlusd label');
  is(/'external_rlusd'/.test(SQL) && !/http|api|endpoint|secret|credential/i.test(SQL),
     'A4b and that label reaches no API, endpoint, or credential');
  is(!/drop table/i.test(SQL), 'A5 it drops no table');
  is(!/alter table public\.(properties|tenants|cam_reconciliations|tenant_statements|tenant_field_evidence)/i.test(SQL),
     'A6 and alters no existing table');
}

// ── B. Decision: source_statement_id denormalized, immutable, and the key ──
sec('B. Bound to a statement version, permanently');
{
  is(/source_statement_id uuid not null references public\.tenant_statements\(id\) on delete restrict/.test(SQL),
     'B1 payments.source_statement_id is NOT NULL and restricts deletion of its statement');
  is(/create unique index if not exists payments_one_active_per_statement\s*\n\s*on public\.payments \(source_statement_id\)\s*\n\s*where state <> 'cancelled'/.test(SQL),
     'B2 one ACTIVE payment per statement version, enforced by a partial unique index');
  is(/if new\.source_statement_id is distinct from old\.source_statement_id then\s*\n\s*raise exception/.test(SQL),
     'B3 and the binding is immutable — a trigger raises on any attempt to move it');
  is(/if new\.authorized_amount\s+is distinct from old\.authorized_amount\s+then\s*\n\s*raise exception/.test(SQL),
     'B4 as is the authorized amount');
  // Nothing may auto-follow a superseded statement.
  is(!/update public\.payments[\s\S]{0,400}?tenant_statements/i.test(SQL),
     'B5 no statement of any kind updates a payment from tenant_statements');
  is(/\(st\.status = 'superseded'\)\s*as source_superseded/.test(SQL),
     'B6 supersession is EXPOSED as a flag instead');
}

// ── C. Decision: settled vs evidence quality ───────────────────────────────
sec('C. `verified` exists nowhere, and settled is only a record');
{
  is(/ps_evidence_quality_check check \(evidence_quality = any \(array\[\s*\n?\s*'attested','document_backed','externally_verifiable'\]\)\)/.test(SQL),
     'C1 the evidence-quality enum is exactly the three approved values');
  is(!/'verified'/.test(SQL),
     'C2 the literal \'verified\' appears NOWHERE in the executable SQL');
  is(!/'verified'/.test(BACK), 'C3 nor in the rollback');
  eq(M.EVIDENCE_QUALITY.indexOf('verified'), -1, 'C4 nor in the module enum');
  is(/min\(case s\.evidence_quality/.test(SQL) && /as verification_floor_rank/.test(SQL),
     'C5 the view exposes the MINIMUM evidence quality, not the best row');
  is(/_payment_derive_state/.test(SQL),
     'C6 and state is derived by a single named function');
}

// ── D. Decision: state computed transactionally from real rows ─────────────
sec('D. No caller can assert a settled state');
{
  const derive = SQL.slice(SQL.indexOf('function public._payment_derive_state'),
                           SQL.indexOf('create or replace view public.payment_balances'));
  is(/select coalesce\(sum\(s\.amount\), 0\)/.test(SQL) && /s\.voided_at is null/.test(SQL),
     'D1 the settled total sums only non-voided rows');
  is(/v_total := public\._payment_settled_total\(p_payment_id\)/.test(derive),
     'D2 derive_state reads the rows itself');
  // Word-bounded: p_statement_id and p_statement_version are legitimate and must
  // not be mistaken for a caller-supplied state.
  is(!/\bp_state\b|\bp_new_state\b|\bp_resulting_state\b|\bp_evidence_state\b/.test(SQL),
     'D3 no procedure takes a state as a parameter');
  is(/\bp_statement_id\b/.test(SQL),
     'D3b (the near-miss token p_statement_id is present and is not a state)');

  // Both settlement-changing procedures must recompute rather than assign.
  for (const fn of ['payment_record_settlement', 'payment_void_settlement']) {
    const body = SQL.slice(SQL.indexOf('function public.' + fn), SQL.indexOf('function public.' + fn) + 2200);
    is(/v_after := public\._payment_derive_state\(/.test(body),
       'D4 ' + fn + ' recomputes the state inside its own transaction');
  }
}

// ── E. Decision: six state procedures, two dispute procedures, kept apart ──
sec('E. Disputes cannot move a payment');
{
  const procs = [...SQL.matchAll(/create or replace function public\.(payment_\w+)\(/g)].map(m => m[1]);
  eq(procs.length, 8, 'E1 eight payment procedures');
  const state = procs.filter(p => !/dispute/.test(p));
  const disp  = procs.filter(p => /dispute/.test(p));
  eq(state.length, 6, 'E2 six change state');
  eq(disp.length, 2,  'E3 two are dispute attributes');

  // The decisive assertion: neither dispute procedure writes state.
  for (const fn of disp) {
    const start = SQL.indexOf('function public.' + fn);
    const body  = SQL.slice(start, SQL.indexOf('$$;', start));
    is(!/update public\.payments set[\s\S]*?\bstate\s*=/.test(body),
       'E4 ' + fn + ' never assigns payments.state');
    is(/state_before, state_after[\s\S]{0,400}?v_p\.state, v_p\.state/.test(body),
       'E5 ' + fn + ' records the state unchanged on both sides of its event');
  }
  is(/disputed_at\s+timestamptz/.test(SQL) && !/'disputed'/.test(SQL),
     'E6 dispute is an attribute; there is no `disputed` state value');
  is(/payments_state_check check \(state = any \(array\[\s*\n?\s*'draft','authorized','instructed','partially_settled','settled','cancelled'\]\)\)/.test(SQL),
     'E7 the state enum is exactly the six approved values');
}

// ── F. Decision: landlord SELECT-only; tenants cannot act at all ───────────
sec('F. Every mutation is behind a SECURITY DEFINER procedure');
{
  const policies = [...SQL.matchAll(/create policy (\w+) on public\.(\w+) for (\w+)/g)]
    .map(m => ({ name: m[1], table: m[2], cmd: m[3].toLowerCase() }));
  eq(policies.length, 10, 'F1 ten policies');

  const nonService = policies.filter(p => !/service_role/.test(p.name));
  is(nonService.every(p => p.cmd === 'select'),
     'F2 every non-service_role policy is SELECT — no INSERT, UPDATE or DELETE for anyone else');
  eq(policies.filter(p => /service_role/.test(p.name) && p.cmd === 'all').length, 4,
     'F3 only service_role holds ALL, on all four tables');

  const tenantPolicies = policies.filter(p => /tenant_select/.test(p.name));
  eq(tenantPolicies.length, 2, 'F4 tenants have exactly two policies');
  is(tenantPolicies.every(p => ['payments','payment_settlements'].indexOf(p.table) !== -1),
     'F5 on payments and payment_settlements only');
  is(!/payment_events_tenant|payment_sources_tenant/.test(SQL),
     'F6 tenants have NO policy on payment_events or payment_sources at all');
  // Required in BOTH tenant policies. The predicate appears twice, so counting
  // one occurrence would let the other be widened unnoticed.
  const gate = (SQL.match(/state in \('instructed','partially_settled','settled'\)/g) || []).length;
  eq(gate, 2, 'F7 the instructed-or-later gate appears in both tenant policies');
  for (const pol of ['payments_tenant_select', 'payment_settlements_tenant_select']) {
    const start = SQL.indexOf('create policy ' + pol);
    const body  = SQL.slice(start, SQL.indexOf(';', start));
    is(/state in \('instructed','partially_settled','settled'\)/.test(body),
       'F7b ' + pol + ' gates on instructed-or-later');
  }

  // Privileges, not just policies.
  is(/revoke all on public\.payments\s+from anon, authenticated/.test(SQL),
     'F8 write privileges are revoked outright, so no policy oversight can grant them');
  is(!/grant (insert|update|delete)[\s\S]{0,80}to authenticated/i.test(SQL),
     'F9 authenticated is granted select and nothing else');
  is(!/for delete/i.test(SQL), 'F10 there is no DELETE policy anywhere — records are voided');

  // Every procedure is a definer with an ownership check that raises.
  const bodies = SQL.split('create or replace function public.payment_').slice(1);
  eq(bodies.length, 8, 'F11 eight procedure bodies to check');
  is(bodies.every(b => /security definer/.test(b) && /set search_path = ''/.test(b)),
     'F12 all are SECURITY DEFINER with an empty search_path');
  is(bodies.every(b => /_payment_assert_owner\(/.test(b)),
     'F13 and all call the ownership assertion');
  // Scoped to _payment_assert_owner: the 021 resync procedure carries the same
  // sentence, so an unscoped pin would pass while this assertion had been gutted.
  const assertOwner = SQL.slice(SQL.indexOf('function public._payment_assert_owner'),
                                SQL.indexOf('function public._payment_replay'));
  is(/raise exception 'Not authorized[\s\S]{0,140}?insufficient_privilege/.test(assertOwner),
     'F14 which RAISES rather than returning a falsy result');
  is(!/\breturn;/.test(assertOwner),
     'F14b and does not simply return when the caller does not own the property');
}

// ── G. Decision: idempotency, append-only, loud failure ────────────────────
sec('G. Retries, history, and atomicity');
{
  is(/create unique index if not exists payment_events_request_uniq\s*\n\s*on public\.payment_events \(payment_id, request_id\)/.test(SQL),
     'G1 idempotency is a unique constraint, following tenant_review_audit_dedup');
  is(/_payment_replay\(/.test(SQL), 'G2 and a replay returns the prior result instead of transitioning');
  const bodies = SQL.split('create or replace function public.payment_').slice(1);
  const replayed = bodies.filter(b => /_payment_replay\(/.test(b)).length;
  eq(replayed, 7, 'G3 seven procedures check for a replay (create is keyed by its own insert)');

  is(/create unique index if not exists payment_settlements_ref_uniq/.test(SQL),
     'G4 the same bank reference cannot be recorded twice');
  is(/where evidence_ref is not null and voided_at is null/.test(SQL),
     'G5 unless the earlier one was voided');

  // Every state procedure inserts its event in the same body as its update.
  for (const fn of ['payment_authorize','payment_issue','payment_record_settlement',
                    'payment_void_settlement','payment_cancel']) {
    const start = SQL.indexOf('function public.' + fn);
    const body  = SQL.slice(start, SQL.indexOf('$$;', start));
    is(/update public\.payments/.test(body) && /insert into public\.payment_events/.test(body),
       'G6 ' + fn + ' writes its state change and its event in one transaction');
  }
  is(/voided_at/.test(SQL) && !/delete from public\.payment_settlements/.test(SQL),
     'G7 settlements are voided, never deleted');
}

// ── H. Decision: 021 retention extended for payments ───────────────────────
sec('H. A tenant with payment history is retained by the resync');
{
  const idx = SQL.indexOf('create or replace function public.resync_property_tenants');
  is(idx > -1, 'H1 022 replaces the resync procedure');
  const body = SQL.slice(idx);
  const payClauses = (body.match(/exists \(select 1 from public\.payments pm where pm\.tenant_id = t\.id\)/g) || []).length;
  eq(payClauses, 2, 'H2 the payments clause appears in BOTH the retention count and the delete');
  is(/or exists \(select 1 from public\.payments pm where pm\.tenant_id = t\.id\)\);/.test(body),
     'H3 retained when referenced by a payment');
  is(/and not exists \(select 1 from public\.payments pm where pm\.tenant_id = t\.id\);/.test(body),
     'H4 and excluded from the delete for the same reason');

  // 021's own safety behaviour must survive verbatim.
  is(/jsonb_array_length\(p_rows\) = 0/.test(body) && /empty_roster/.test(body),
     'H5 the empty-roster no-op is preserved');
  is(/no_usable_rows/.test(body), 'H6 the no-usable-rows guard is preserved');
  is(!/coalesce\(v_tenant_id, gen_random_uuid\(\)\)/.test(body),
     'H7 it still refuses to mint ids server-side');
  is(!/delete from public\.tenants\s*\n\s*where property_id = p_property_id;/.test(body),
     'H8 and 009\'s unconditional delete does not come back');
  is(/retained_referenced/.test(body), 'H9 the retention count is still reported');

  is(/payments_tenant_property_fk[\s\S]{0,160}?on delete restrict/.test(SQL),
     'H10 which matters because the payments FK is RESTRICT, not CASCADE');
}

// ── I. The rollback is honest ──────────────────────────────────────────────
sec('I. The rollback restores 021 rather than reverting to 009');
{
  is(/drop table if exists public\.payment_events/.test(BACK)
     && /drop table if exists public\.payments/.test(BACK),
     'I1 it drops the four tables');
  is(BACK.indexOf('drop table if exists public.payment_events')
     < BACK.indexOf('drop table if exists public.payments'),
     'I2 children before parent');
  const drops = (BACK.match(/drop function if exists public\.payment_/g) || []).length;
  eq(drops, 8, 'I3 and all eight procedures');
  is(/create or replace function public\.resync_property_tenants/.test(BACK),
     'I4 it restores the resync procedure');
  is(!/exists \(select 1 from public\.payments/.test(BACK),
     'I5 without the payments clause, which would not compile once the table is gone');
  is(!/delete from public\.tenants\s*\n\s*where property_id = p_property_id;/.test(BACK),
     'I6 and WITHOUT 009\'s destructive delete — this is a restore, not a reversion');
  is(/DESTRUCTIVE/.test(fs.readFileSync('./migrations/022_payment_management_rollback.sql', 'utf8')),
     'I7 the file says plainly that it destroys financial history');
}

// ── J. The module and the SQL agree ────────────────────────────────────────
sec('J. One lifecycle, defined twice, in agreement');
{
  for (const s of M.STATES) {
    is(new RegExp("'" + s + "'").test(SQL), 'J1 SQL knows state ' + s);
  }
  for (const q of M.EVIDENCE_QUALITY) {
    is(new RegExp("'" + q + "'").test(SQL), 'J2 SQL knows evidence quality ' + q);
  }
  for (const m of M.METHODS) {
    is(new RegExp("'" + m + "'").test(SQL), 'J3 SQL knows method ' + m);
  }
  const sqlActions = (SQL.match(/pe_action_check check \(action = any \(array\[([\s\S]*?)\]\)\)/) || [,''])[1];
  is(M.ACTIONS.every(a => sqlActions.indexOf("'" + a + "'") !== -1),
     'J4 every module action is in the SQL action enum');
  eq((sqlActions.match(/'/g) || []).length / 2, M.ACTIONS.length,
     'J5 and the SQL enum has no actions the module does not know about');
}

console.log(`\n${fail ? '\x1b[31m' : '\x1b[32m'}RESULT: ${pass} passed, ${fail} failed\x1b[0m`);
process.exit(fail ? 1 : 0);
