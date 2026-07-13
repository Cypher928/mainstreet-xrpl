# MainStreet — Known Limitations

The honest register. Every item here is real, acknowledged, and either
accepted by design or queued in `FUTURE_ROADMAP.md`. This document exists so
nobody — developer, pilot customer, or judge — has to discover these the hard
way.

---

## 1. Current product limitations

- **Single-user portfolios.** One landlord account owns a portfolio; no teams,
  no shared access, no delegation. Tenant portal is the only second role.
- **English only** — UI, intents, drafting, and extraction prompts.
- **No notifications.** Disputes, draw status changes, and expirations surface
  in-app only; nothing emails or pushes.
- **Reports are print-window HTML→PDF**, not server-rendered files; layout
  fidelity depends on the browser's print engine.
- **Demo data is per-user seeded** — a fresh account always contains the demo
  property until deleted. Deliberate (first-run experience) but surprising if
  unexpected.
- **No undo beyond the last snapshot.** `recoverLastSnapshot()` restores one
  save-generation back; there is no full history.

## 2. AI & extraction limitations

- **Intent matching is keyword-based.** Heavily rephrased or compound
  questions can fall to the fallback intent. Honest, but a miss.
- **~25 intents, not open-ended analysis.** The Workspace answers the
  product's core questions; it cannot do arbitrary hypotheticals beyond the
  forecast intent.
- **No cross-session memory** (by design — Workspace Context is
  session-scoped and deterministic).
- **Extraction is bounded by document quality.** Scanned/image PDFs route
  through the Claude vision path with penalized confidence; handwriting,
  exotic layouts, and very long documents degrade results.
- **>50-page extraction truncation** — marked in the text (never silent), but
  content past the cap is not extracted.
- **Extraction is generative** — the one place an LLM runs. Mitigated by
  verbatim-quote evidence, confidence scores, and the human review gate; not
  eliminated.
- **Quote highlighting can fail honestly.** If `locateQuoteInItems` can't find
  the quote confidently in the pdf.js text layer, the viewer jumps to the page
  and says so rather than guessing a highlight.

## 3. XRPL / settlement limitations

- **Operator-CLI settlement.** No in-app "settle" button; a landlord cannot
  self-serve payment. Security-motivated (seeds never touch the server), but a
  real product gap until custody is solved.
- **One settlement wallet for all properties** — no per-property fund
  isolation yet.
- **One-directional flow** (tenant-side wallet → landlord). No refunds,
  credits, partial payments, or payment plans on-ledger.
- **Manual prerequisites:** trust-line setup and XRP funding per wallet.
- **No fiat on/off-ramp** — RLUSD acquisition is out of band.
- **Make Waves 300-active-account prize threshold is out of reach** for a
  two-wallet architecture. Acknowledged; not gamed with synthetic accounts.

## 4. Scale & performance

- **Compute is proven fine to 500 properties** (all measured paths 4–53 ms).
  Beyond that is unmeasured, not known-good.
- **DOM is the real ceiling** — handled by render caps (top-6 recs, ≤50
  collapsed rows, 24-property health grid), which means at scale the UI
  intentionally shows the *worst/most actionable* subset, not everything.
- **`loadPropertyData` pulls the whole property blob** — very large properties
  (thousands of invoices) would fatten every load; nothing pages within a
  property.
- **localStorage mirror has browser quota limits**; extremely large portfolios
  could exceed it (DB remains authoritative, so this degrades, not corrupts).

## 5. Enterprise gaps (pilot-blocking, see roadmap)

- No SSO (SAML/OIDC), no team roles, no audit-log export, no data
  export/deletion tooling, no SLA-grade observability, no CI gate on the
  regression suite (run by discipline today).
- Integrations: Yardi is CSV-import only; no MRI/API sync; no accounting
  system integration.

## 6. Architectural risks (accepted, with mitigations)

| Risk | Mitigation in place |
|---|---|
| 4-hop persistence invariant is manual | Documented (DATABASE_REFERENCE.md §4), round-trip tests, the settlement bug as institutional memory |
| `script.js` monolith blast radius | All new logic in pure modules; monolith only accretes glue |
| Regression gate depends on developer discipline | 15 wired suites, single command, loud failure output — CI is the roadmap fix |
| Migrations applied by hand | Idempotent SQL + verification queries (008b) |
| Single maintainer knowledge | This /docs set |

## 7. Deferred items (not bugs — decisions)

Workflow automation, LLM paraphrase middleware, per-property wallets, inbound
payment detection, cross-property analytics queries, notifications, team
accounts — all catalogued with rationale in `FUTURE_ROADMAP.md` §2.
