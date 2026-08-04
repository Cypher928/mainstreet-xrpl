# MainStreet Roadmap

**Written at the freeze point (`b19caf8`, pilot).** Nothing here is authorised
to be built. The product is frozen for Christy's walkthrough; only bugs she
finds during it get fixed. This document exists so that when the freeze lifts,
the order of work is already decided and not re-argued.

The organising judgement: **the risk is not that MainStreet does too little. It
is that nobody has measured whether what it does is correct, or whether being
correct saves anyone any time.** Every phase below is ordered by that.

Success is **time and confidence gained**, not extraction accuracy. Accuracy is
a means; if it rises and the manager's day does not get shorter, we optimised
the wrong thing.

---

## Phase 0 — Validation (happens first, and is not optional)

Not a phase of building. A phase of measuring. Until it is done, Phase 1 cannot
be scoped, because the benchmark decides what Phase 1 contains.

1. **Build the corpus.** 30–50 real leases from Christy and any other willing
   source. Digitally-native and scanned, in the real proportion she has them.
   Demo documents are worthless here — they were written to be extractable.
2. **Ground truth by hand.** A human abstracts each lease into the same field
   set MainStreet extracts. This is the expensive part and there is no way
   around it.
3. **Score field by field.** Precision and recall per field, not an average.
   "94% accurate" is meaningless; "we miss the cap 1 time in 12" is actionable.
   Segment by document quality — native vs scanned will differ sharply.
4. **Reconciliation parity.** Take reconciliations Christy has already completed
   by hand and re-run them. Match to the dollar, or explain every difference.
   **This number is the product.**
5. **Buy a measuring stick.** Run the same corpus through a commercial
   abstraction service (see *Build vs integrate*). ~$500 buys an external
   baseline and answers "are we behind, and by how much" in a week.

### The metric that actually matters: time and confidence gained

Extraction accuracy is a **proxy**, and optimising a proxy is how products get
technically excellent and commercially useless. A 97% field-accuracy score means
nothing if the manager re-checks every lease by hand anyway — and 88% would be a
triumph if she stops checking. What she is buying is hours back and the nerve to
send a statement without re-deriving it.

So measure the outcome directly, alongside the technical numbers:

6. **Baseline her work FIRST, before she uses MainStreet in anger.** How long
   does a lease abstraction take today? A full reconciliation? This has to be
   captured up front — ask afterwards and you get a remembered number, which is
   always flattering to whichever tool she is currently annoyed by. Without a
   baseline, "17 minutes per lease" is a number with no meaning.
7. **Review time per lease and per reconciliation**, wall-clock, from opening
   the document to accepting the result. The saving is baseline minus this.
8. **Correction count, by field.** How many extracted values did she change?
   This is the bridge between the two kinds of measurement, and the most
   diagnostic number available:
   - high error, high corrections → an extraction problem;
   - **low error, high corrections → a TRUST problem.** She is re-checking a
     field the product got right, which means the presentation has not earned
     her confidence. That is a UX finding wearing an accuracy costume, and it
     would be invisible if we only scored the model.
   - low error, low corrections → the field is done. Stop working on it.
9. **Confidence, asked as a decision rather than a feeling.** After each
   reconciliation: *"Would you send this to the tenant without re-checking it by
   hand?"* Yes or no, and if no, what she checked. That binary is the actual
   purchase decision, and a five-point satisfaction scale would obscure it.
10. **Work avoided, in her words.** What did she not have to do — pull a lease
    from a filing cabinet, email a colleague, rebuild last year's spreadsheet?
    This is anecdotal and it is still the most persuasive material we will have,
    both for the roadmap and for the next sales conversation.

**Instrument this by observation, not by building telemetry.** A stopwatch, a
shared sheet, and sitting with her. Adding analytics is a feature, the product
is frozen, and hand-timing 30 leases is faster than shipping event tracking —
with the side benefit that watching her work will produce findings no event
stream would have captured.

**Exit criterion.** Not a single score. Four results:

- accuracy per field, segmented by document quality;
- reconciliation parity in dollars against her completed work;
- **hours saved per lease and per reconciliation, against a measured baseline;**
- **the send-it-without-checking answer, and what she still checks.**

A ranked list of where the product is wrong falls out of these. If the technical
numbers are good and the time saving is not, the roadmap is wrong — and better
to learn that from 30 leases than from a year of building.

---

## Phase 1 — Required before the first paying customer

Ruthless list. Everything here is either "we cannot honestly take money without
it" or "the benchmark said it is broken".

0. **Three CAM defects** — see `docs/CAM_ENGINE_GAP_ANALYSIS.md`. The
   "CAM eligible" control does not affect the reconciliation; there is no
   estimated-payments ledger so no final balance due/credit; and the cap is
   applied to the tenant's whole total rather than to controllables only. The
   first and third are wrong answers in the money path, and the second means the
   product stops one step before the deliverable. Found by benchmarking against
   CapVeri, but none of them are parity items — they are things we assumed we
   already had.
1. **Whatever Phase 0 found.** This is the largest item and it cannot be scoped
   in advance. Extraction fixes, engine fixes, or an integration decision.
2. **Live extraction proven in production.** As of the freeze, no lease has been
   verified end-to-end through the real pipeline with real credentials. The
   "AI extraction completes" box on the acceptance checklist has never been
   ticked. Everything downstream runs on seeded state.
3. **Their data can leave.** Full export of every property, lease, document,
   reconciliation and timeline entry, in a format a human and a CPA can read.
   Charging for a system of record you cannot get data out of is not defensible.
4. **Backup and restore, verified by drill.** Not "Supabase has backups" —
   an actual restore performed and checked.
5. **A dead-control sweep.** Four controls were found shipped completely
   non-functional in a single session (Restore, both View in Lease, Archive's
   entry point). `test-inline-handlers.js` covers one cause. The others need
   the same treatment: every interactive surface exercised by a real click.
6. **Commercial minimum.** A written scope of what the product does and does not
   do, a simple agreement, a support channel with a response commitment you can
   actually keep, and a named path for incidents.

**Deliberately NOT in Phase 1:** multi-user, integrations, gross-up/base-year,
dispute packages. One manager can run a pilot alone, and a design partner
tolerates gaps they were told about in advance.

---

## Phase 2 — High-value improvements

After paying pilots, ordered by customer value per unit of work.

1. **Dispute / audit response package.** The wedge. When a tenant disputes CAM,
   produce the cited defence: the clause, the invoices, the calculation, the
   prior year's treatment. Acute, expensive, dreaded, and the evidence model is
   already the right architecture for it. Nobody buys reconciliation software
   enthusiastically; people buy the thing that saves them from a fight.
2. **CAM depth, if and only if customers need it.** Gross-up, base year stops,
   expense pools, cap carry-forward, admin fee on controllables — ranked in
   `docs/CAM_ENGINE_GAP_ANALYSIS.md`. Today the math
   is `proRata = sqFt / totalSqFt` (`script.js:9282`), with caps and exclusions;
   base year exists as a warning code, not a computation. That is correct for
   retail and industrial NNN and wrong for office. Let the customer mix decide,
   and do not build it speculatively.
3. **Multi-user with review.** CAM season is a team activity: an analyst
   prepares, a manager approves. Roles, assignment, an approval step.
4. **One accounting integration and a CPA-acceptable export.** Today MainStreet
   is a data island beside Yardi/MRI/AppFolio/QuickBooks. One good export beats
   three half integrations.
5. **Proactive intelligence.** CAM season opens and the product says which
   leases changed, which caps expire, which invoices have no category — without
   being asked. This is the first step from "tool" to "assistant".
6. **Prior-year comparison.** Reconciliation against last year's, with
   variances explained. Managers do this every year and hate it.

---

## Phase 3 — Long-term vision

The bet: **CAM is the wedge, not the category.** The category is being the
verified memory of a property.

1. **Portfolio Intelligence.** Cross-lease questions routed above the
   single-lease engine, answering with coverage stated and a citation from every
   lease compared (`docs/BACKLOG_CROSS_LEASE_QUESTIONS.md`).
2. **Memory that survives ownership.** A building changes managers and owners;
   its history should not restart. A verified, portable record that transfers on
   sale is something no incumbent offers, and it is the strongest lock-in that
   is also genuinely good for the customer.
3. **Due-diligence handoff.** The acquisition module already half-points here.
   A buyer receives the verified record instead of a data room of PDFs.
4. **Tenant-facing evidence.** Let the tenant see the cited basis of their
   charge. Disputes fall when the evidence is visible, and it makes the landlord
   look rigorous rather than defensive.
5. **Benchmarking across the customer base.** Anonymised operating-expense
   comparisons — the only real data network effect available here. Requires
   scale and explicit consent; do not design for it early.

---

## Build vs integrate

Researched August 2026. Vendor accuracy claims below are **self-reported and
unaudited**; several comparison pages are published by vendors comparing
themselves to rivals. Treat them as a reason to measure, not as measurements.

**The state of the market.** Commercial lease abstraction is a solved, crowded
category. Vendors claim 90–97% on standard lease terms and 95–99% with human
validation in the loop. Kira reports 93–97% across 1,000+ provisions.
Lextract sells per-lease at ~$10 with 126 fields, per-field confidence scores,
and Yardi/MRI/ARGUS integrations. Prophia is ~$20/document or an enterprise
contract, with an API. Everyone agrees on the failure mode: **scanned documents
are where accuracy collapses**, because OCR error precedes extraction error.

**Where we should NOT build.** The OCR and layout layer. That is commodity, it
is where scanned-lease accuracy is actually won or lost, and specialists
(Azure Document Intelligence, LandingAI, LlamaParse-class parsers) beat a
general vision model on it. If Phase 0 shows scanned leases dragging the number
down, the fix is a parse layer in front of extraction — not better prompts.

**Where we should NOT integrate.** A full abstraction *product* — Prophia, MRI
Contract Intelligence, Trullion. They are competitors, not suppliers. Embedding
one puts the layer that owns the customer relationship inside someone else's
roadmap and pricing.

**The interesting middle.** Two moves, in this order:

1. **Use a commercial service as an oracle before deciding anything.** Run the
   Phase 0 corpus through Lextract or equivalent at ~$10/lease. Compare
   field-by-field against our own output and against ground truth. Roughly $500
   and a week. Three outcomes, all useful: we are competitive (stop worrying and
   build the differentiators), we are behind on scans only (buy a parse layer),
   or we are behind everywhere (integrate extraction wholesale).
2. **Put extraction behind an interface now, so the decision is reversible.**
   Extraction should be a swappable provider — ours, a vendor's, or both. That
   is a small refactor today and an expensive one later.

**Ensemble as a product feature, not just a hedge.** Running two extractors and
routing disagreements to the review queue turns an accuracy weakness into a
defensible confidence signal — which is exactly what the evidence model already
sells. "Two independent readings agreed" is a stronger claim than any single
vendor's percentage.

**Where we must build, because it is the whole company:** the evidence and
citation model, verified memory and revision history, CAM reconciliation
correctness, dispute response, and property intelligence. Nobody else is
selling *provenance*. Extraction is a component; being trustworthy is the
product.

---

## The one-line version

Measure first — hours and confidence, not just accuracy. Fix what the
measurement finds. Charge a small number of design partners. Buy the commodity
layers. Spend every remaining hour on the parts that make a property's history
verifiable — because that, not lease reading, is what nobody else has.
