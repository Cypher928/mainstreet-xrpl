# MainStreet — Product Vision

_A plain-language statement of what MainStreet is, who it's for, and where it's
going. Not a technical spec. When a feature decision is unclear, this document
is the tie-breaker._

---

## Mission

**Give property managers a trustworthy, single source of truth for every
property they run — so every number, every decision, and every dollar can be
explained and defended.**

Property management runs on scattered PDFs, email threads, spreadsheets, and
memory. MainStreet replaces that with one system where the lease, the documents,
the tenants, the money, and the history of what happened all live together — and
where every answer comes with its receipts.

---

## Target customer

**The regional commercial property manager.** The person responsible for a
portfolio of buildings who is accountable to owners, chased by tenants, and
audited on CAM reconciliations. They are not a developer and not a crypto user.
They are busy, detail-liable, and judged on accuracy.

- **Primary buyer & user:** the regional PM or the small property-management firm
  they work for.
- **Not our customer (yet):** individual landlords with one unit, or enterprise
  REITs with bespoke internal systems. We may serve them later; we design for the
  regional PM first.
- **First pilot user:** Christy — a real property manager whose day-to-day
  workflows drive what we build next.

---

## Core principles

1. **Provenance is the product.** Every figure, reconciliation, and recommendation
   traces back to the source document it came from. Trust is the feature people
   pay for; a number without a receipt is worthless to a PM who has to defend it.
2. **Solve real workflows, not imaginary ones.** We build for tasks a property
   manager actually does — reconciling CAM, reviewing a lease, chasing a tenant,
   settling a balance. We do **not** add technology for its own sake.
3. **The boring parts are the point.** Uploading a document, finding last year's
   invoice, seeing what changed on a property — doing these reliably beats any
   flashy capability that a PM would never use twice.
4. **Never make the customer trust a black box.** Show the work. Every automated
   answer must be explainable and reversible.
5. **Production stability is a feature.** The system a customer depends on daily
   must not wobble. New ideas prove themselves in Pilot before they touch
   Production.
6. **One property, one truth.** Everything about a property — its lease, tenants,
   documents, money, and history — belongs in one coherent place, not five tools.

---

## Current roadmap

**Shipped / in Production (the stable core):**
- Lease intelligence — upload a lease, extract and review its key terms.
- Document handling — upload, store, and reference property documents.
- CAM reconciliation — reconcile common-area-maintenance charges with evidence.
- Invoice review — surface, explain, and dispute invoice line items.
- Evidence & audit trail — every figure links back to its source.
- RLUSD settlement (mainnet) — settle balances on the XRP Ledger.

**Now — Pilot cycle 1:**
- **Property Timeline v1** — a chronological, provenance-linked view of everything
  that has happened at a property (leases, documents, reconciliations, invoices,
  disputes, settlements). First feature built directly from Christy's feedback.
  Reuses the existing document, lease, tenant, and evidence systems rather than
  adding new machinery.

**Next (candidate, pilot-driven — not committed):**
- Deeper tenant view (per-tenant history and balances in one place).
- Faster document → answer flows ("show me the clause behind this charge").
- Whatever the pilot proves customers actually reach for.

The roadmap is deliberately short. We let real pilot feedback — not a wish list —
decide what comes after Property Timeline.

---

## What belongs in Production

Production (`main` → mainstreetcam.com) holds only what is **stable, validated,
and depended upon by real customers.** It carries the real money path (mainnet
RLUSD) and real customer data. The bar to enter Production is:

- The workflow has been validated with a pilot customer.
- It is reliable enough that a PM can depend on it without a fallback.
- It has been intentionally **promoted** from Pilot, never rushed in.

Production changes are limited to **critical bug fixes** and **deliberate
promotions**. Stability here is non-negotiable.

---

## What belongs in Pilot

Pilot (`pilot` → dedicated preview URL) is where **customer validation happens
before anything is trusted in Production.** It holds:

- New features being shaped with real pilot users (starting with Property
  Timeline v1).
- Pilot customer data, kept **separate from Production** — no real money, no
  mainnet transactions, isolated database.
- Fast, frequent iteration: a customer reports something, we fix it, and they see
  it on the same URL within minutes.

If a feature hasn't earned a real customer's trust on Pilot, it does not belong in
Production. Pilot is the proving ground; Production is the promise.

---

## Long-term vision

**MainStreet becomes the operating system for the regional property manager —
the single place they open every morning to understand and run their portfolio.**

Over time, the timeline of what has happened at a property becomes a living model
of the property itself: every document, obligation, dollar, and decision
connected and explainable. From that foundation, MainStreet moves from
_recording_ what happened to _guiding_ what to do next — flagging the lease
renewal, the mis-billed CAM charge, the tenant falling behind — always with the
evidence attached.

The end state is a property manager who trusts MainStreet the way they trust a
great assistant: it knows the properties cold, it never loses the paper trail,
and every recommendation it makes can be defended to an owner or an auditor.

We get there one validated workflow at a time — never by adding technology for
its own sake.
