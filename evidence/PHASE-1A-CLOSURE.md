# Phase 1a — Payment Management: CLOSED

Accepted 2026-09-05. **Final state, re-verified at closure.**

Nothing below may change without a new explicit approval: no payment schema
changes, cleanup, FK changes, tenant remapping, UI, endpoints, or Ripple
integration.

---

## The boundary this phase established

> MainStreet records that a payment was authorized, instructed, and later
> observed to have settled. It never receives, holds, transmits, or routes a cent.

The web tier remains incapable of moving funds. `api/rlusd-settlement.js` is
status-only and 403s `settle`; fund movement stays out-of-band in
`scripts/send-settlement.js`, dry-run by default. Phase 1a added **zero** new
fund-moving capability, so that posture is preserved by construction rather than
by policy.

## Final state

| | |
|---|---|
| Commit | **9b5dae0** (branch `claude/validation-runs-analysis-ji1zb3`, tree clean, pushed) |
| Migration | **022 applied to Pilot `bhmktujbxdbvdmpybmad` only** |
| Tables | **4** — `payments`, `payment_sources`, `payment_settlements`, `payment_events` |
| View | **`payment_balances`** (security_invoker) |
| Procedures | **8** — 6 state + 2 dispute, kept separate |
| Policies | **10** |
| Payment rows | **0** across all four tables |
| Production `zhsuhehgehbzkmzurzyf` | **untouched** |
| `origin/main` | **9c6d905**, untouched — no commit from this session is an ancestor |
| Ripple / XRPL / wallet / credentials | **untouched** |
| Phase 1b | **not started** |

### Pilot data unchanged (measured at closure)

```
tenants                84   9570c59cfdbcc864f77e65fd12e1643d
tenant_field_evidence 423   eaea9277697568e05122ada5de621d6c
cam target columns          adc94703ead4dbb5f3bcb55cf005b61f
cam billing columns         6acf22e57bca6a60359a29256b9e15eb
```

`resync_property_tenants` = `e733e321df4d44c6101afb0182990d05` — changed from
`ac6c864f` **only** to add the payments retention clause.

### 021 lifecycle protection preserved and extended

The payments clause appears in **both** the retention count and the delete
predicate. 021's own guarantees survive verbatim: ownership check, empty-roster
no-op, `no_usable_rows` guard, refusal to mint ids server-side, upsert-not-
replace, and the `retained_referenced` report. A tenant referenced by payment
history is now retained rather than colliding with the `ON DELETE RESTRICT` FK.

## Doctrine carried into the schema

`state = 'settled'` means the non-voided settlements sum to at least the
authorized amount — a statement about **MainStreet's records**, not about the
world. `evidence_quality` says how well that record is supported, and there is
deliberately **no value called `verified`**, because MainStreet verifies
nothing. `verification_floor` is the **minimum** across settlements: a payment
is only as verified as its weakest evidence. This is the same separation as
`expected_cam_basis`, which describes arithmetic and asserts nothing about
whether its input was verified.

## Known baseline, deliberately not fixed

**`test-broken-promises.js` fails (10 passed, 1 failed).** Long-standing,
pre-existing, unrelated to payments, and confirmed failing before any of this
work. It is preserved as a known baseline regression by explicit instruction —
do not fix or re-pin it as part of this work.

Regression at closure: **113 passed / 114 suites.**
`test-payment-state-machine.js` 63/0 · `test-payment-schema-contract.js` 95/0.

## Open items requiring separate approval

- Phase 1b — the write path (endpoint + UI). The tables are inert without it.
- The `lease_documents.tenant_id` rename (it references no tenant; 0 of 73 resolve).
- Any FK on `cam_reconciliations.tenant_id` — still blocked by 6 dangling rows.
- The 6 orphan reconciliations and 15 dangling evidence rows — preserved, unrepaired.
- Maple Coffee `275d2435` — held for human review, still the only CAM row with a
  value and no basis.
- Ripple Payments Direct — research only. The gating dependency is the
  money-transmission analysis, not the technology.

## Cosmetic inaccuracy noted, not corrected

`test-payment-schema-contract.js` opens with "migration 022 has NOT been
applied". That was true when written and is now stale. Left alone deliberately,
since this phase is closed; worth a one-line fix whenever the file is next
touched under approval.
