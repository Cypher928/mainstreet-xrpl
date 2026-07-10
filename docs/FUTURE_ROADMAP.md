# MainStreet — Roadmap & Phase History

Where the product has been (Phases 1–27), what was deliberately deferred, the
known technical debt, and the road ahead.

---

## 1. Phase history — what was actually built

| Phase(s) | Delivered |
|---|---|
| 1–10 (foundation) | Core CAM engine: property/tenant/invoice management, pro-rata allocation with caps & exclusions, reconciliation runs, reports (Master, Reconciliation Summary, Tenant Statements, CSV), Supabase auth + persistence, tenant portal with disputes |
| 11–15 (intelligence) | Claude-powered lease extraction with verbatim-quote evidence + confidence, review engine (verified / needs_review / incomplete), multi-document lease intelligence (amendments, supersedence), normalized evidence & audit tables, lease jobs pipeline |
| 16–19 (breadth) | Acquisition Intelligence (rent-roll analysis, revenue-at-risk, decision reports), lease review packets, activity timeline, Yardi CSV import, recovered-revenue tracking |
| 20 | Normalized evidence reads (`tenant_field_evidence` authoritative), RLS + database hardening (migrations 005–009) |
| XRPL track | RLUSD settlement on mainnet: trust lines, SHA-256 memo fingerprints, Source Tag `2606290001`, dry-run-default CLI signing, 6-point on-ledger verification, wallet rotation after compromise, **first live settlement verified 6/6** |
| 21 (A–E) | AI Command Center (executive summary, ranked dollar-quantified recommendations, portfolio health, opportunity center) + Reserve & Escrow Intelligence (extraction → readiness score → draw packages → lifecycle) + integration polish + UX/language audit |
| 22 | AI Workspace — deterministic conversational layer (~25 intents), citations, reasoning trace, suggestions |
| 23 | Drafting Studio (6 deterministic document types), Explain Mode, Workspace Context (deterministic follow-ups), production hardening, guided tour, demo mode |
| 24 | Interactive Evidence Viewer — 3-tier citation → PDF page → quote highlight |
| 25 | AI UX refinement — intent recognition breadth, mobile formatting, contextual actions, dead-click audit |
| 26 | Production readiness review — top-25 friction fixes, empty states, loading, terminology |
| 27 | Enterprise readiness — 500-property scale audit (render caps; compute proven 4–53 ms), real-document robustness (per-page extraction fault tolerance, truncation markers), pilot UX, accessibility (focus traps) |
| 28 | This documentation set |

**Accomplishments worth stating plainly:** real money settled on XRPL mainnet
and independently verified; a deterministic AI layer with zero hallucination
surface in answer paths; an evidence chain from PDF quote to on-ledger hash;
and a regression gate (15 suites) that has held green through seven
consecutive feature phases with settlement/auth/api untouched.

## 2. Deferred ideas (consciously not built yet)

- **In-app settlement initiation** — settlement stays operator-CLI until a
  custody answer exists (see XRPL_ARCHITECTURE.md §8).
- **Per-property / per-tenant wallets** with DestinationTags and inbound
  payment detection.
- **Workflow automation** (Phase 23 scope trimmed): auto-generated task
  queues, scheduled reconciliation reminders.
- **LLM paraphrase middleware** around the Workspace (voice in, friendlier
  phrasing out) — designed for, not built.
- **Cross-property analytics** on `cam_reconciliations` rows (the table
  exists; the queries don't).
- **Budgeting / CAM estimates vs actuals** (forecast intent is the seed).
- **Tenant-side self-service** beyond disputes (statements exist; payment
  initiation doesn't).
- **Team/multi-user landlord orgs** — auth is single-user-per-portfolio.
- **Notifications** (email/push) for disputes, draw status, expirations.

## 3. Technical debt (honest register)

| Debt | Risk | Suggested payoff |
|---|---|---|
| `script.js` monolith (~21k lines of view glue + persistence + legacy flows) | Slows onboarding; wide blast radius for edits | Keep extracting: persistence pipeline and report generators are next candidates for pure modules |
| Blob-first persistence with a manual 4-hop invariant | One missed hop silently loses data | A single declarative field registry all four hops read from |
| Legacy `results` shape kept alongside `camReconciliation` | Dual-read (`??`) everywhere | One-time migration + remove the fallback |
| No CI — regression suite is run by discipline | A rushed commit can skip the gate | GitHub Action running `npm run test:regression` on PRs |
| Migrations applied by hand via SQL editor | Environment drift risk | Adopt supabase CLI migration flow |
| E2E suites not in the regression gate | Flow regressions rely on memory | Fold stable e2e suites into `SUITES` |
| Demo seed versioning is manual (`_demoV`) | Forgotten bump = stale demos | Derive version from a hash of the seed payload |
| pdf.js pinned at 3.11.174 | Ages over time | Scheduled upgrade with Evidence Viewer regression pass |

## 4. Enterprise roadmap (pilot-blocking first)

1. **CI gate** (regression suite on every PR) — cheapest risk reduction
   available.
2. **Team accounts & roles** — enterprise landlords are teams; current RBAC is
   landlord/tenant only.
3. **SSO** (SAML/OIDC) — a Fortune 500 IT requirement, non-negotiable.
4. **Observability** — server-side error tracking + extraction failure-rate
   dashboards (lease_jobs already records the data).
5. **Data export / deletion** — contractual + compliance requirement.
6. **Yardi/MRI deeper integration** — CSV import exists; API sync is the ask.

## 5. Pilot roadmap (first real customer)

1. Onboarding with **their** documents — extraction robustness against a real
   document corpus, with failure-rate reporting.
2. **Import at scale** — bulk lease intake with progress + review queue triage.
3. **Settlement custody decision** — pilot can run "MainStreet reconciles,
   customer pays off-platform, MainStreet records" while custody is resolved.
4. Success metrics instrumented from day one: recovered revenue, hours saved,
   dispute cycle time.

## 6. Long-term

- **Inbound settlement detection** — tenants pay from their own wallets;
  MainStreet verifies by SourceTag/DestinationTag + memo fingerprint (the
  transaction anatomy was designed for this).
- **The evidence chain as a product** — quote → field → reconciliation →
  on-ledger hash is an auditable trail no incumbent CAM tool offers; expose it
  to auditors/lenders directly.
- **Reserve intelligence as a wedge** — lender draw packages are painful
  industry-wide and mostly unserved by software.
- **Multi-currency settlement** as RLUSD-adjacent stablecoins mature.
