-- ============================================================================
-- 022_payment_management.sql — Phase 1 payment management, record-only
-- ============================================================================
-- TARGET: PILOT PROJECT ONLY (bhmktujbxdbvdmpybmad).
-- NEVER apply to production (zhsuhehgehbzkmzurzyf).
--
-- WHAT THIS IS, AND MORE IMPORTANTLY WHAT IT IS NOT
-- -------------------------------------------------
-- MainStreet records that a payment was authorized, instructed, and later
-- observed to have settled. It never receives, holds, transmits, or routes a
-- cent. Nothing here touches a wallet, an exchange, a bank, or Ripple. There is
-- no fund-moving code in this file and there is no code path from these tables
-- to one. api/rlusd-settlement.js is untouched and remains status-only.
--
-- The tables are deliberately INERT on arrival: no endpoint and no UI reads or
-- writes them. Reachability is a separate, separately-approved phase.
--
-- THE TWO AXES THIS SCHEMA REFUSES TO MERGE
-- -----------------------------------------
-- `payments.state = 'settled'` means: the non-voided settlement rows recorded
-- against this payment sum to at least the authorized amount. It is a statement
-- about MAINSTREET'S RECORDS. It is not a claim that anyone verified that money
-- moved in the world.
--
-- `payment_settlements.evidence_quality` says how well that record is supported
-- — attested < document_backed < externally_verifiable. There is deliberately
-- NO value called 'verified', because MainStreet verifies nothing. The strongest
-- value says the evidence COULD be checked by a third party, which is true,
-- rather than that it WAS, which would not be.
--
-- This is the same discipline as expected_cam_basis = 'cap_ceiling', which
-- describes arithmetic and asserts nothing about whether its input was verified.
-- A consumer that renders state without the weakest evidence quality beside it
-- is reintroducing exactly the conflation these two columns exist to prevent.
--
-- WHY LANDLORDS CANNOT WRITE THESE TABLES DIRECTLY
-- ------------------------------------------------
-- RLS grants SELECT and nothing else, to everyone except service_role. Every
-- mutation goes through a SECURITY DEFINER procedure. That is not defence in
-- depth for its own sake: it is the only arrangement in which "the state change
-- and its audit event succeed together or neither happens" is structurally
-- guaranteed. A direct UPDATE could advance a payment's state without writing
-- the event that explains it, and then the history would be a lie.
--
-- Safe to re-run (idempotent DDL throughout).
-- Run in Supabase: SQL Editor -> New query -> paste -> Run.
-- ============================================================================


-- ─── 1. payments ─────────────────────────────────────────────────────────────
--
-- source_statement_id is DENORMALIZED here, and immutably so, for one reason:
-- the "one active payment per statement version" rule has to be enforced by the
-- database, and a partial unique index cannot reach into a sidecar table. The
-- column is the constraint. payment_sources still owns the hash and the version
-- snapshot; this is the key, not a second copy of the provenance.

create table if not exists public.payments (
  id                  uuid primary key default gen_random_uuid(),
  property_id         uuid not null references public.properties(id) on delete cascade,
  tenant_id           uuid not null,
  cam_year            integer not null,
  currency            text not null default 'USD',

  -- The figure a human authorized. Immutable after insert (see trigger below).
  authorized_amount   numeric not null,

  -- Permanently bound to the statement VERSION it was created from. A later
  -- statement version never moves, cancels or rewrites this payment; the
  -- divergence is surfaced as an attention condition instead.
  source_statement_id uuid not null references public.tenant_statements(id) on delete restrict,

  state               text not null default 'draft',
  authorized_at       timestamptz,

  method              text,
  -- DISPLAY ONLY. A human-readable hint such as "Operating account ••4821".
  -- This is NOT a financial instrument and must never hold routing or account
  -- numbers: MainStreet does not store bank details, in this phase or later.
  destination_label   text,
  due_date            date,

  -- Disputes are ORTHOGONAL to state, not a state. A payment can be disputed
  -- while partially settled, and modelling that as a state would destroy the
  -- information about where the payment actually was.
  disputed_at         timestamptz,
  dispute_resolved_at timestamptz,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint payments_tenant_property_fk
    foreign key (tenant_id, property_id)
    references public.tenants(id, property_id) on delete restrict,

  constraint payments_state_check check (state = any (array[
    'draft','authorized','instructed','partially_settled','settled','cancelled'])),
  constraint payments_amount_positive check (authorized_amount > 0),
  constraint payments_year_sane check (cam_year >= 2000 and cam_year <= 2100),
  constraint payments_currency_usd check (currency = 'USD'),
  constraint payments_method_check check (method is null or method = any (array[
    'ach','wire','check','external_rlusd','other'])),

  -- state => required fields, in the schema rather than only in code.
  -- Mirrors tenant_statements_publish_complete.
  constraint payments_authorized_complete
    check (state = any (array['draft','cancelled']) or authorized_at is not null),
  constraint payments_instructed_complete
    check (state not in ('instructed','partially_settled','settled')
           or (method is not null and destination_label is not null)),

  -- Length-bounded and display-only. Deliberately NOT a digit-run regex: that
  -- would false-positive on legitimate reference numbers. The boundary is held
  -- by review and UI copy, which is where a judgement call belongs.
  constraint payments_destination_label_len
    check (destination_label is null or char_length(destination_label) <= 60),

  constraint payments_dispute_order
    check (dispute_resolved_at is null or disputed_at is not null)
);

-- THE INVARIANT: one active payment per statement version. `cancelled` is the
-- only state that frees the slot, so a mistaken authorization is cancelled and
-- replaced rather than edited, and two live payments can never chase one bill.
create unique index if not exists payments_one_active_per_statement
  on public.payments (source_statement_id)
  where state <> 'cancelled';

create index if not exists payments_property_year on public.payments (property_id, cam_year);
create index if not exists payments_tenant       on public.payments (tenant_id);
create index if not exists payments_state        on public.payments (state);


-- ─── 2. payment_sources — 1:1 provenance sidecar, PK = parent ────────────────
-- Shaped exactly like tenant_statement_sources: keyed by its parent, no id of
-- its own. It answers "what figure is this based on", and nothing else. It
-- deliberately does NOT record who authorized the payment — that is an event,
-- not a provenance fact, and a single *_by column on a row that transitions many
-- times cannot say which act it refers to.

create table if not exists public.payment_sources (
  payment_id               uuid primary key references public.payments(id) on delete cascade,
  property_id              uuid not null references public.properties(id) on delete cascade,
  source_statement_id      uuid references public.tenant_statements(id) on delete set null,
  source_statement_version integer,
  source_run_hash          text,
  -- Binds the figure a human saw to this row. If the underlying statement is
  -- recomputed, the payment does not follow: the mismatch surfaces.
  authorized_amount_hash   text not null,
  created_at               timestamptz not null default now()
);


-- ─── 3. payment_settlements — observed settlement, append-only ───────────────
-- Multiple rows per payment: partial payments are ordinary, not exceptional.
-- Corrections are made by VOIDING a row, never by deleting or negating one, so
-- the history of what was believed and when survives the correction.

create table if not exists public.payment_settlements (
  id               uuid primary key default gen_random_uuid(),
  payment_id       uuid not null references public.payments(id) on delete cascade,
  property_id      uuid not null references public.properties(id) on delete cascade,
  amount           numeric not null,
  settled_at       timestamptz not null,
  evidence_kind    text not null,
  evidence_ref     text,
  evidence_quality text not null,
  voided_at        timestamptz,
  voided_reason    text,
  created_at       timestamptz not null default now(),

  constraint ps_amount_positive check (amount > 0),
  constraint ps_evidence_kind_check check (evidence_kind = any (array[
    'landlord_attestation','bank_reference','remittance_doc','onchain_tx'])),
  -- NO 'verified'. See the header.
  constraint ps_evidence_quality_check check (evidence_quality = any (array[
    'attested','document_backed','externally_verifiable'])),
  constraint ps_void_complete check (voided_at is null or voided_reason is not null)
);

-- The classic double-count bug: the same bank reference recorded twice.
create unique index if not exists payment_settlements_ref_uniq
  on public.payment_settlements (payment_id, evidence_ref)
  where evidence_ref is not null and voided_at is null;

create index if not exists payment_settlements_payment on public.payment_settlements (payment_id);


-- ─── 4. payment_events — append-only, the authoritative history ──────────────
-- payments.state is a PROJECTION of this table. The invariant is that
-- payments.state always equals the state_after of the latest event.

create table if not exists public.payment_events (
  id            uuid primary key default gen_random_uuid(),
  payment_id    uuid not null references public.payments(id) on delete cascade,
  property_id   uuid not null references public.properties(id) on delete cascade,
  -- Idempotency as a constraint, following tenant_review_audit_dedup.
  request_id    uuid not null,
  action        text not null,
  state_before  text,
  state_after   text,
  actor_uid     uuid,
  actor_email   text,
  reason        text,
  settlement_id uuid references public.payment_settlements(id) on delete set null,
  client_ts     timestamptz,
  server_ts     timestamptz not null default now(),

  constraint pe_action_check check (action = any (array[
    'create','authorize','issue','record_settlement','void_settlement',
    'cancel','dispute_open','dispute_resolve'])),
  constraint pe_reason_required
    check (action not in ('cancel','void_settlement','dispute_open')
           or reason is not null)
);

create unique index if not exists payment_events_request_uniq
  on public.payment_events (payment_id, request_id);
create index if not exists payment_events_payment
  on public.payment_events (payment_id, server_ts);


-- ─── 5. Immutability guard ───────────────────────────────────────────────────
-- The authorized amount and the statement binding are the two facts a human
-- relied on. Neither may drift after the fact, so neither is editable — not by
-- a procedure, not by service_role, not by anyone.

create or replace function public._payments_immutable_guard()
returns trigger language plpgsql as $$
begin
  if new.authorized_amount   is distinct from old.authorized_amount   then
    raise exception 'payments.authorized_amount is immutable'; end if;
  if new.source_statement_id is distinct from old.source_statement_id then
    raise exception 'payments.source_statement_id is immutable'; end if;
  if new.property_id is distinct from old.property_id then
    raise exception 'payments.property_id is immutable'; end if;
  if new.tenant_id   is distinct from old.tenant_id   then
    raise exception 'payments.tenant_id is immutable'; end if;
  if new.cam_year    is distinct from old.cam_year    then
    raise exception 'payments.cam_year is immutable'; end if;
  if new.currency    is distinct from old.currency    then
    raise exception 'payments.currency is immutable'; end if;
  if new.created_at  is distinct from old.created_at  then
    raise exception 'payments.created_at is immutable'; end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists payments_immutable on public.payments;
create trigger payments_immutable before update on public.payments
  for each row execute function public._payments_immutable_guard();


-- ─── 6. Derived money — computed, never stored ───────────────────────────────
-- Two stored sources of truth for money is how a figure comes to disagree with
-- itself, so amount_settled and balance_remaining exist only here.

create or replace function public._payment_settled_total(p_payment_id uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(sum(s.amount), 0)
  from public.payment_settlements s
  where s.payment_id = p_payment_id and s.voided_at is null;
$$;

-- The single definition of settlement-derived state. Every procedure that can
-- change the settled total calls THIS; none of them accepts a state from a
-- caller. A client cannot assert that a payment is settled.
create or replace function public._payment_derive_state(p_payment_id uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v_auth numeric; v_total numeric;
begin
  select authorized_amount into v_auth from public.payments where id = p_payment_id;
  v_total := public._payment_settled_total(p_payment_id);
  if v_total <= 0            then return 'instructed';
  elsif v_total < v_auth     then return 'partially_settled';
  else                            return 'settled';
  end if;
end $$;

create or replace view public.payment_balances
with (security_invoker = true) as
select
  p.id            as payment_id,
  p.property_id, p.tenant_id, p.cam_year, p.currency,
  p.source_statement_id, p.state, p.authorized_amount,
  coalesce(sum(s.amount) filter (where s.voided_at is null), 0)                     as amount_settled,
  p.authorized_amount
    - coalesce(sum(s.amount) filter (where s.voided_at is null), 0)                 as balance_remaining,
  -- A payment is only as verified as its WEAKEST evidence, so the floor is the
  -- minimum, never the best row. Null when nothing has been recorded.
  min(case s.evidence_quality
        when 'attested'              then 1
        when 'document_backed'       then 2
        when 'externally_verifiable' then 3 end)
    filter (where s.voided_at is null)                                              as verification_floor_rank,
  (p.disputed_at is not null and p.dispute_resolved_at is null)                     as in_dispute,
  -- Decision 2: supersession is surfaced, never auto-reconciled.
  (st.status = 'superseded')                                                        as source_superseded
from public.payments p
left join public.payment_settlements s on s.payment_id = p.id
left join public.tenant_statements   st on st.id = p.source_statement_id
group by p.id, st.status;


-- ─── 7. Row level security — SELECT only, for everyone but service_role ──────

alter table public.payments            enable row level security;
alter table public.payment_sources     enable row level security;
alter table public.payment_settlements enable row level security;
alter table public.payment_events      enable row level security;

-- Landlord: read. All mutation goes through the procedures below.
drop policy if exists payments_landlord_select on public.payments;
create policy payments_landlord_select on public.payments for select
  using (property_id in (select id from public.properties where user_id = auth.uid()));

drop policy if exists payment_sources_landlord_select on public.payment_sources;
create policy payment_sources_landlord_select on public.payment_sources for select
  using (property_id in (select id from public.properties where user_id = auth.uid()));

drop policy if exists payment_settlements_landlord_select on public.payment_settlements;
create policy payment_settlements_landlord_select on public.payment_settlements for select
  using (property_id in (select id from public.properties where user_id = auth.uid()));

drop policy if exists payment_events_landlord_select on public.payment_events;
create policy payment_events_landlord_select on public.payment_events for select
  using (property_id in (select id from public.properties where user_id = auth.uid()));

-- Tenant: read only, and only once the payment has been instructed. Drafts and
-- unissued authorizations are invisible. There is deliberately NO tenant policy
-- on payment_events or payment_sources at all.
drop policy if exists payments_tenant_select on public.payments;
create policy payments_tenant_select on public.payments for select
  using (tenant_id in (select public.tenant_ids_for_current_user())
         and state in ('instructed','partially_settled','settled'));

drop policy if exists payment_settlements_tenant_select on public.payment_settlements;
create policy payment_settlements_tenant_select on public.payment_settlements for select
  using (payment_id in (
    select id from public.payments
    where tenant_id in (select public.tenant_ids_for_current_user())
      and state in ('instructed','partially_settled','settled')));

drop policy if exists payments_service_role_all on public.payments;
create policy payments_service_role_all on public.payments for all
  using (true) with check (true);
drop policy if exists payment_sources_service_role_all on public.payment_sources;
create policy payment_sources_service_role_all on public.payment_sources for all
  using (true) with check (true);
drop policy if exists payment_settlements_service_role_all on public.payment_settlements;
create policy payment_settlements_service_role_all on public.payment_settlements for all
  using (true) with check (true);
drop policy if exists payment_events_service_role_all on public.payment_events;
create policy payment_events_service_role_all on public.payment_events for all
  using (true) with check (true);

-- Belt and braces: Supabase grants table privileges to authenticated by default
-- in some projects, and RLS only filters rows for privileges the role holds.
-- Remove the write privileges outright so no policy oversight can grant them,
-- and remove anon entirely — none of this is public.
revoke all on public.payments            from anon, authenticated;
revoke all on public.payment_sources     from anon, authenticated;
revoke all on public.payment_settlements from anon, authenticated;
revoke all on public.payment_events      from anon, authenticated;
revoke all on public.payment_balances    from anon, authenticated;
grant select on public.payments            to authenticated;
grant select on public.payment_sources     to authenticated;
grant select on public.payment_settlements to authenticated;
grant select on public.payment_events      to authenticated;
grant select on public.payment_balances    to authenticated;

-- NOTE: no DELETE is granted to anyone but service_role, by policy or by grant.
-- A financial record is voided, never deleted.


-- ─── 8. Shared guards for the procedures ─────────────────────────────────────

create or replace function public._payment_assert_owner(p_property_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.properties
                 where id = p_property_id and user_id = auth.uid()) then
    raise exception 'Not authorized: caller does not own property %', p_property_id
      using errcode = 'insufficient_privilege';
  end if;
end $$;

-- Idempotency: a retry with the same request_id returns the prior event instead
-- of transitioning a second time.
create or replace function public._payment_replay(p_payment_id uuid, p_request_id uuid)
returns public.payment_events language sql stable security definer set search_path = '' as $$
  select * from public.payment_events
  where payment_id = p_payment_id and request_id = p_request_id limit 1;
$$;


-- ═══ 9. THE SIX STATE PROCEDURES ═════════════════════════════════════════════
-- These, and only these, may change payments.state. They are kept separate from
-- the two dispute procedures in section 10 precisely so that separation is
-- visible in the schema rather than merely intended.

-- 9.1 create -> draft
create or replace function public.payment_create(
  p_property_id uuid, p_tenant_id uuid, p_cam_year integer,
  p_statement_id uuid, p_amount numeric, p_amount_hash text,
  p_request_id uuid, p_actor_email text default null,
  p_source_run_hash text default null, p_statement_version integer default null
) returns public.payments language plpgsql security definer set search_path = '' as $$
declare v_p public.payments;
begin
  perform public._payment_assert_owner(p_property_id);
  if p_amount is null or p_amount <= 0 then
    raise exception 'authorized amount must be positive'; end if;
  if p_statement_id is null then
    raise exception 'a payment must be created from a statement version'; end if;

  insert into public.payments (property_id, tenant_id, cam_year, authorized_amount,
                               source_statement_id, state)
  values (p_property_id, p_tenant_id, p_cam_year, p_amount, p_statement_id, 'draft')
  returning * into v_p;

  insert into public.payment_sources (payment_id, property_id, source_statement_id,
                                      source_statement_version, source_run_hash,
                                      authorized_amount_hash)
  values (v_p.id, p_property_id, p_statement_id, p_statement_version,
          p_source_run_hash, p_amount_hash);

  insert into public.payment_events (payment_id, property_id, request_id, action,
                                     state_before, state_after, actor_uid, actor_email)
  values (v_p.id, p_property_id, p_request_id, 'create', null, 'draft',
          auth.uid(), p_actor_email);
  return v_p;
end $$;

-- 9.2 draft -> authorized
create or replace function public.payment_authorize(
  p_payment_id uuid, p_request_id uuid, p_amount_hash text,
  p_actor_email text default null
) returns public.payments language plpgsql security definer set search_path = '' as $$
declare v_p public.payments; v_src public.payment_sources;
begin
  select * into v_p from public.payments where id = p_payment_id for update;
  if v_p.id is null then raise exception 'payment not found'; end if;
  perform public._payment_assert_owner(v_p.property_id);
  if public._payment_replay(p_payment_id, p_request_id) is not null then return v_p; end if;
  if v_p.state <> 'draft' then
    raise exception 'cannot authorize from state %', v_p.state; end if;

  select * into v_src from public.payment_sources where payment_id = p_payment_id;
  if v_src.authorized_amount_hash is distinct from p_amount_hash then
    raise exception 'authorized amount hash mismatch — the figure changed since it was proposed';
  end if;

  update public.payments set state = 'authorized', authorized_at = now()
   where id = p_payment_id returning * into v_p;
  insert into public.payment_events (payment_id, property_id, request_id, action,
                                     state_before, state_after, actor_uid, actor_email)
  values (p_payment_id, v_p.property_id, p_request_id, 'authorize', 'draft', 'authorized',
          auth.uid(), p_actor_email);
  return v_p;
end $$;

-- 9.3 authorized -> instructed
create or replace function public.payment_issue(
  p_payment_id uuid, p_request_id uuid, p_method text,
  p_destination_label text, p_due_date date, p_actor_email text default null
) returns public.payments language plpgsql security definer set search_path = '' as $$
declare v_p public.payments;
begin
  select * into v_p from public.payments where id = p_payment_id for update;
  if v_p.id is null then raise exception 'payment not found'; end if;
  perform public._payment_assert_owner(v_p.property_id);
  if public._payment_replay(p_payment_id, p_request_id) is not null then return v_p; end if;
  if v_p.state <> 'authorized' then
    raise exception 'cannot issue from state %', v_p.state; end if;
  if p_method is null or p_destination_label is null then
    raise exception 'method and destination_label are required to issue'; end if;

  update public.payments
     set state = 'instructed', method = p_method,
         destination_label = p_destination_label, due_date = p_due_date
   where id = p_payment_id returning * into v_p;
  insert into public.payment_events (payment_id, property_id, request_id, action,
                                     state_before, state_after, actor_uid, actor_email)
  values (p_payment_id, v_p.property_id, p_request_id, 'issue', 'authorized', 'instructed',
          auth.uid(), p_actor_email);
  return v_p;
end $$;

-- 9.4 record a settlement; state is DERIVED, never supplied
create or replace function public.payment_record_settlement(
  p_payment_id uuid, p_request_id uuid, p_amount numeric, p_settled_at timestamptz,
  p_evidence_kind text, p_evidence_quality text, p_evidence_ref text default null,
  p_actor_email text default null
) returns public.payments language plpgsql security definer set search_path = '' as $$
declare v_p public.payments; v_before text; v_after text; v_sid uuid;
begin
  select * into v_p from public.payments where id = p_payment_id for update;
  if v_p.id is null then raise exception 'payment not found'; end if;
  perform public._payment_assert_owner(v_p.property_id);
  if public._payment_replay(p_payment_id, p_request_id) is not null then return v_p; end if;
  if v_p.state not in ('instructed','partially_settled','settled') then
    raise exception 'cannot record a settlement from state %', v_p.state; end if;

  v_before := v_p.state;
  insert into public.payment_settlements (payment_id, property_id, amount, settled_at,
                                          evidence_kind, evidence_quality, evidence_ref)
  values (p_payment_id, v_p.property_id, p_amount, p_settled_at,
          p_evidence_kind, p_evidence_quality, p_evidence_ref)
  returning id into v_sid;

  -- Recomputed inside this transaction from the actual non-voided rows.
  v_after := public._payment_derive_state(p_payment_id);
  update public.payments set state = v_after where id = p_payment_id returning * into v_p;

  insert into public.payment_events (payment_id, property_id, request_id, action,
                                     state_before, state_after, actor_uid, actor_email,
                                     settlement_id)
  values (p_payment_id, v_p.property_id, p_request_id, 'record_settlement',
          v_before, v_after, auth.uid(), p_actor_email, v_sid);
  return v_p;
end $$;

-- 9.5 void a settlement; state recomputes DOWNWARD from the remaining rows
create or replace function public.payment_void_settlement(
  p_settlement_id uuid, p_request_id uuid, p_reason text, p_actor_email text default null
) returns public.payments language plpgsql security definer set search_path = '' as $$
declare v_p public.payments; v_s public.payment_settlements; v_before text; v_after text;
begin
  select * into v_s from public.payment_settlements where id = p_settlement_id for update;
  if v_s.id is null then raise exception 'settlement not found'; end if;
  select * into v_p from public.payments where id = v_s.payment_id for update;
  perform public._payment_assert_owner(v_p.property_id);
  if public._payment_replay(v_p.id, p_request_id) is not null then return v_p; end if;
  if p_reason is null then raise exception 'a reason is required to void a settlement'; end if;
  if v_s.voided_at is not null then raise exception 'settlement is already voided'; end if;

  v_before := v_p.state;
  update public.payment_settlements set voided_at = now(), voided_reason = p_reason
   where id = p_settlement_id;
  v_after := public._payment_derive_state(v_p.id);
  update public.payments set state = v_after where id = v_p.id returning * into v_p;

  insert into public.payment_events (payment_id, property_id, request_id, action,
                                     state_before, state_after, actor_uid, actor_email,
                                     reason, settlement_id)
  values (v_p.id, v_p.property_id, p_request_id, 'void_settlement', v_before, v_after,
          auth.uid(), p_actor_email, p_reason, p_settlement_id);
  return v_p;
end $$;

-- 9.6 cancel — terminal, and refused once money has been recorded against it
create or replace function public.payment_cancel(
  p_payment_id uuid, p_request_id uuid, p_reason text, p_actor_email text default null
) returns public.payments language plpgsql security definer set search_path = '' as $$
declare v_p public.payments; v_before text; v_settled numeric;
begin
  select * into v_p from public.payments where id = p_payment_id for update;
  if v_p.id is null then raise exception 'payment not found'; end if;
  perform public._payment_assert_owner(v_p.property_id);
  if public._payment_replay(p_payment_id, p_request_id) is not null then return v_p; end if;
  if p_reason is null then raise exception 'a reason is required to cancel'; end if;
  if v_p.state = 'cancelled' then raise exception 'payment is already cancelled'; end if;

  v_settled := public._payment_settled_total(p_payment_id);
  if v_settled > 0 then
    raise exception 'cannot cancel a payment with recorded settlements — void them first';
  end if;

  v_before := v_p.state;
  update public.payments set state = 'cancelled' where id = p_payment_id returning * into v_p;
  insert into public.payment_events (payment_id, property_id, request_id, action,
                                     state_before, state_after, actor_uid, actor_email, reason)
  values (p_payment_id, v_p.property_id, p_request_id, 'cancel', v_before, 'cancelled',
          auth.uid(), p_actor_email, p_reason);
  return v_p;
end $$;


-- ═══ 10. THE TWO DISPUTE PROCEDURES ══════════════════════════════════════════
-- Kept apart from section 9 on purpose. A dispute is an ATTRIBUTE, not a state:
-- a payment can be disputed while partially settled, and folding that into the
-- state column would erase where the payment actually stood. Neither of these
-- writes payments.state, and the tests assert that they cannot.

create or replace function public.payment_dispute_open(
  p_payment_id uuid, p_request_id uuid, p_reason text, p_actor_email text default null
) returns public.payments language plpgsql security definer set search_path = '' as $$
declare v_p public.payments;
begin
  select * into v_p from public.payments where id = p_payment_id for update;
  if v_p.id is null then raise exception 'payment not found'; end if;
  perform public._payment_assert_owner(v_p.property_id);
  if public._payment_replay(p_payment_id, p_request_id) is not null then return v_p; end if;
  if p_reason is null then raise exception 'a reason is required to open a dispute'; end if;
  if v_p.disputed_at is not null and v_p.dispute_resolved_at is null then
    raise exception 'a dispute is already open on this payment'; end if;

  update public.payments set disputed_at = now(), dispute_resolved_at = null
   where id = p_payment_id returning * into v_p;
  insert into public.payment_events (payment_id, property_id, request_id, action,
                                     state_before, state_after, actor_uid, actor_email, reason)
  values (p_payment_id, v_p.property_id, p_request_id, 'dispute_open',
          v_p.state, v_p.state, auth.uid(), p_actor_email, p_reason);
  return v_p;
end $$;

create or replace function public.payment_dispute_resolve(
  p_payment_id uuid, p_request_id uuid, p_reason text default null,
  p_actor_email text default null
) returns public.payments language plpgsql security definer set search_path = '' as $$
declare v_p public.payments;
begin
  select * into v_p from public.payments where id = p_payment_id for update;
  if v_p.id is null then raise exception 'payment not found'; end if;
  perform public._payment_assert_owner(v_p.property_id);
  if public._payment_replay(p_payment_id, p_request_id) is not null then return v_p; end if;
  if v_p.disputed_at is null or v_p.dispute_resolved_at is not null then
    raise exception 'no open dispute on this payment'; end if;

  update public.payments set dispute_resolved_at = now()
   where id = p_payment_id returning * into v_p;
  insert into public.payment_events (payment_id, property_id, request_id, action,
                                     state_before, state_after, actor_uid, actor_email, reason)
  values (p_payment_id, v_p.property_id, p_request_id, 'dispute_resolve',
          v_p.state, v_p.state, auth.uid(), p_actor_email, p_reason);
  return v_p;
end $$;


-- ─── 11. Grants on the procedures ────────────────────────────────────────────
grant execute on function public.payment_create(uuid,uuid,integer,uuid,numeric,text,uuid,text,text,integer) to authenticated, service_role;
grant execute on function public.payment_authorize(uuid,uuid,text,text)                     to authenticated, service_role;
grant execute on function public.payment_issue(uuid,uuid,text,text,date,text)               to authenticated, service_role;
grant execute on function public.payment_record_settlement(uuid,uuid,numeric,timestamptz,text,text,text,text) to authenticated, service_role;
grant execute on function public.payment_void_settlement(uuid,uuid,text,text)               to authenticated, service_role;
grant execute on function public.payment_cancel(uuid,uuid,text,text)                        to authenticated, service_role;
grant execute on function public.payment_dispute_open(uuid,uuid,text,text)                  to authenticated, service_role;
grant execute on function public.payment_dispute_resolve(uuid,uuid,text,text)               to authenticated, service_role;


-- ═══ 12. MIGRATION 021 RETENTION, EXTENDED FOR PAYMENTS ══════════════════════
--
-- payments.tenant_id carries ON DELETE RESTRICT, deliberately: a statement can
-- be regenerated, a payment cannot. Without this change a resync that omits a
-- tenant with payment history would hit that FK and fail loudly — correct, but
-- avoidable. 021's retention predicate gains a third clause so such a tenant is
-- RETAINED and counted, exactly as one referenced by a reconciliation or a piece
-- of evidence already is.
--
-- This lives in 022 rather than in 021 because it references public.payments,
-- which does not exist until this migration runs. The 021 file is left as the
-- historical record of what was applied to Pilot on 2026-09-05.
--
-- Everything else about 021 is preserved verbatim: the ownership check, the
-- empty-roster no-op, the no_usable_rows guard, the refusal to mint ids
-- server-side, the upsert, and the returned counts.

create or replace function public.resync_property_tenants(
  p_property_id  uuid,
  p_rows         jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_owns_property boolean;
  v_upserted   integer := 0;
  v_skipped    integer := 0;
  v_deleted    integer := 0;
  v_retained   integer := 0;
  v_row        jsonb;
  v_tenant_id  uuid;
  v_incoming   uuid[] := array[]::uuid[];
begin
  select exists(
    select 1 from public.properties
    where id = p_property_id and user_id = auth.uid()
  ) into v_caller_owns_property;

  if not v_caller_owns_property then
    raise exception 'Not authorized: caller does not own property %', p_property_id
      using errcode = 'insufficient_privilege';
  end if;

  if p_rows is null or jsonb_array_length(p_rows) = 0 then
    return jsonb_build_object('ok', true, 'property_id', p_property_id,
      'upserted', 0, 'skipped', 0, 'deleted', 0, 'retained_referenced', 0,
      'noop_reason', 'empty_roster');
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    if v_row->>'name' is null or trim(v_row->>'name') = '' then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    begin
      v_tenant_id := (v_row->>'id')::uuid;
    exception when invalid_text_representation then
      v_tenant_id := null;
    end;
    if v_tenant_id is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_incoming := v_incoming || v_tenant_id;

    insert into public.tenants (
      id, property_id, name, sqft, cap, start_date, end_date, lease_url, lease_type
    ) values (
      v_tenant_id,
      p_property_id,
      nullif(trim(v_row->>'name'), ''),
      (v_row->>'sqft')::numeric,
      (v_row->>'cap')::numeric,
      nullif(v_row->>'start_date', '')::date,
      nullif(v_row->>'end_date',   '')::date,
      nullif(v_row->>'lease_url',  ''),
      nullif(v_row->>'lease_type', '')
    )
    on conflict (id) do update set
      property_id = excluded.property_id,
      name        = excluded.name,
      sqft        = excluded.sqft,
      cap         = excluded.cap,
      start_date  = excluded.start_date,
      end_date    = excluded.end_date,
      lease_url   = excluded.lease_url,
      lease_type  = excluded.lease_type;

    v_upserted := v_upserted + 1;
  end loop;

  if v_upserted = 0 then
    return jsonb_build_object('ok', true, 'property_id', p_property_id,
      'upserted', 0, 'skipped', v_skipped, 'deleted', 0, 'retained_referenced', 0,
      'noop_reason', 'no_usable_rows');
  end if;

  select count(*) into v_retained
  from public.tenants t
  where t.property_id = p_property_id
    and not (t.id = any(v_incoming))
    and (exists (select 1 from public.cam_reconciliations c where c.tenant_id = t.id)
      or exists (select 1 from public.tenant_field_evidence e where e.tenant_id = t.id::text)
      or exists (select 1 from public.payments pm where pm.tenant_id = t.id));

  delete from public.tenants t
  where t.property_id = p_property_id
    and not (t.id = any(v_incoming))
    and not exists (select 1 from public.cam_reconciliations c where c.tenant_id = t.id)
    and not exists (select 1 from public.tenant_field_evidence e where e.tenant_id = t.id::text)
    and not exists (select 1 from public.payments pm where pm.tenant_id = t.id);
  get diagnostics v_deleted = row_count;

  return jsonb_build_object(
    'ok', true, 'property_id', p_property_id,
    'upserted', v_upserted, 'skipped', v_skipped,
    'deleted', v_deleted, 'retained_referenced', v_retained,
    'inserted', v_upserted
  );

exception
  when insufficient_privilege then
    return jsonb_build_object('ok', false, 'error', sqlerrm, 'code', 'not_authorized');
  when others then
    raise;
end;
$$;

grant execute on function public.resync_property_tenants(uuid, jsonb) to authenticated;
grant execute on function public.resync_property_tenants(uuid, jsonb) to service_role;


-- ─── 13. Verify ──────────────────────────────────────────────────────────────
select
  (select count(*) from information_schema.tables
     where table_schema='public'
       and table_name in ('payments','payment_sources','payment_settlements','payment_events')) as tables_created,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname like 'payment_%')                                   as payment_procs,
  (select count(*) from pg_policies where schemaname='public'
     and tablename in ('payments','payment_sources','payment_settlements','payment_events'))    as policies;
-- Expected: tables_created 4 | payment_procs 8 | policies 10


-- ─── Rollback ────────────────────────────────────────────────────────────────
-- See migrations/022_payment_management_rollback.sql
