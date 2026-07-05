# MainStreet — Judge Q&A Prep

Prep for a mixed judging panel. For each question: the likely question, a concise verbal
answer (~30–60s), and a deeper follow-up if they push. Written to be **accurate to the
production code and honest about what isn't built** — the goal is to handle hard questions, not
recite a script. Answer in your own words.

**Two honesty guards before you walk in:**
- Answers tagged **[after first settlement]** assume the first real RLUSD mainnet settlement is
  done. Until it is, say so plainly: *"the wallet and RLUSD trust line are live on mainnet and
  verifiable today; the first settlement is imminent — RLUSD is clearing through the exchange."*
- If you don't know something, say "we haven't built/measured that yet." Every judge respects
  that more than a guess, and we've worked hard to keep our claims exact.

---

## 1. Product & Market

**Q: What does MainStreet do, in one sentence?**
- **Concise:** It automates CAM — common area maintenance — reconciliation for commercial real
  estate: it reads leases and invoices with AI, allocates shared building costs to each tenant
  by their lease terms, produces verifiable tenant statements, and settles payments in RLUSD on
  the XRP Ledger so the result can be independently checked.
- **Deeper:** The workflow is lease/invoice extraction with confidence scoring → an allocation
  engine that enforces caps and exclusions and checks the totals balance → tenant statements and
  a dispute workflow → RLUSD settlement with an on-ledger, verifiable record. There's also an
  acquisition due-diligence module and an operational-alerts layer for portfolio managers.

**Q: Who's the customer, and is this a real pain or a nice-to-have?**
- **Concise:** The buyer is the commercial property manager or landlord. CAM reconciliation is a
  real, annual, high-dollar process done in spreadsheets today, and tenants routinely dispute
  charges they have no way to verify. It's a painkiller. I'll be straight, though: we don't have
  paying customers yet — we're pre-pilot.
- **Deeper:** Billions in shared expenses get allocated across commercial tenants every year.
  The work is slow, error-prone, and adversarial because the tenant can't independently check
  the number. That combination — high dollars, low verifiability, recurring annually — is what
  makes it worth automating.

**Q: Is this a real product or a hackathon prototype?**
- **Concise:** It's a working product, not slideware: a live app, a tested allocation engine, AI
  extraction, acquisition due diligence, reporting, a dispute workflow, and a live XRPL mainnet
  wallet. What it doesn't have yet is real users and a live fiat payment processor — I won't
  pretend otherwise.
- **Deeper:** Production today: the full reconciliation and reporting flow, AI extraction with
  confidence scoring, the XRPL settlement architecture, wallet + trust line live on mainnet.
  Pending: the first settlement transaction, a real payment processor, and pilot customers.

---

## 2. Commercial Real Estate

**Q: CAM is messy — caps, exclusions, gross-ups, base years. Does your engine actually handle that?**
- **Concise:** For the core, yes: pro-rata allocation by leased square footage, expense caps,
  category exclusions, and an integrity check that the per-tenant shares balance. We extract
  those terms from the leases. We do **not** yet fully model every exotic structure — things
  like complex gross-ups or base-year expense stops — and where we can't, we flag for manual
  review rather than silently mis-allocate.
- **Deeper:** The allocation engine implements pro-rata, caps, exclusions, and admin fees, with
  a balance/integrity check. Some lease terms we extract but don't yet fully apply in the math;
  those surface in the review queue. The design principle is "flag what we're unsure of," not
  "assume and hide it."

**Q: How does this fit with Yardi / MRI that landlords already run?**
- **Concise:** We're not replacing the system of record. You import your CAM expense data from
  Yardi via CSV, run the reconciliation in MainStreet, and hand tenants a verifiable statement.
  Export back into Yardi is on the roadmap and **not yet validated against a real Yardi import
  format** — so I won't claim round-trip works until it's tested on a real file.
- **Deeper:** Import (vendor/GL/amount/date) works today with fuzzy column matching. The
  honest gap is the export side; a generic CSV isn't guaranteed to match a specific customer's
  Yardi chart of accounts, so we treat that as unproven until we have a real sample.

**Q: Why would a property manager trust AI to read their leases?**
- **Concise:** They don't have to trust it blindly. Every extracted field gets a 0–100
  confidence score, and anything low-confidence is flagged for human review before allocation
  runs. The human keeps the judgment; the AI removes the grunt work of reading 80-page leases.

---

## 3. AI

**Q: What model is it, and what's it actually doing?**
- **Concise:** We use Anthropic's Claude through a server-side proxy — the API key never touches
  the browser. It extracts structured CAM data from lease and invoice PDFs: square footage,
  caps, exclusions, vendor, amount, category, dates — and returns a per-field confidence score.
- **Deeper:** Calls go through a serverless function so the key stays server-side and we can cap
  cost and model choice. The confidence scores drive a "needs review" queue, so extraction is a
  human-in-the-loop assist, not an autonomous decision-maker.

**Q: How accurate is the extraction? What's your benchmark?**
- **Concise:** Honest answer: we haven't published a formal accuracy benchmark on a labeled
  dataset. We manage extraction error operationally instead — per-field confidence scoring, a
  review queue, duplicate detection, and an allocation integrity check. The system is designed
  on the assumption the AI can be wrong and surfaces it, rather than asserting it's always right.
- **Deeper:** Measuring extraction accuracy against a labeled lease set is on the near-term
  roadmap. Today the safeguard is procedural, not statistical — and I'd rather tell you that
  than quote a number we haven't earned.

**Q: What happens when the AI gets a field wrong?**
- **Concise:** It's caught before it affects a tenant's bill. Low-confidence fields are flagged,
  the user reviews and corrects them, and the allocation won't finalize on unreviewed data. The
  dispute workflow is a second feedback path. Nothing is auto-committed without a reviewable trail.

---

## 4. XRPL / RLUSD

**Q: What does XRPL actually do here? Be specific.**
- **Concise:** One thing, well: settlement. When a tenant pays, we settle the matching amount in
  RLUSD on XRPL mainnet and embed a SHA-256 fingerprint of the settlement record in the
  transaction memo. Both parties get a link to verify the payment — and what it settled — on the
  public ledger. The sensitive lease and CAM data stays off-chain.
- **Deeper:** We chose settlement, not document storage, because the core problem is *trust in a
  number*. A database row can be changed silently; an XRPL transaction can't. The memo ties the
  on-ledger payment to a specific off-chain record without exposing that record.

**Q: You're not putting documents on-chain — so isn't the "blockchain" part just a payment?**
- **Concise:** It's a payment with a verifiable link to what it settled — and that's the point.
  We deliberately keep documents off-chain for tenant and landlord confidentiality, and use the
  ledger for the one thing it's uniquely good at: a tamper-evident, timestamped settlement
  record. We also compute local SHA-256 fingerprints of the reconciliation and dispute records,
  so changes to those are detectable too.
- **Deeper:** Putting confidential lease and CAM data on a public ledger would be the wrong
  architecture for enterprise real estate. The design supports *optionally* anchoring a
  finalized record's fingerprint on-chain later — fingerprint only, never the data — but we
  haven't built that, and we don't claim it.

**Q: Anyone can put any hash in a memo. What does that actually prove?**
- **Concise:** Fair point — the memo hash proves **integrity, not truth**. It proves the
  settlement record hasn't changed since the payment, and binds the on-ledger payment to a
  specific off-chain record. It does not claim the underlying numbers are "correct" — that's
  what the allocation engine, confidence scoring, and dispute workflow are for. The ledger gives
  a tamper-evident settlement trail; it doesn't replace the audit logic.
- **Deeper:** Verification is two-part: the public transaction proves a settlement of a given
  amount happened and is immutable; the local fingerprint proves the off-chain record behind it
  is unchanged. Neither alone is a truth oracle — together they remove the "trust my
  spreadsheet" problem.

**Q: Is this actually live on mainnet?**
- **Concise:** Yes — live on XRPL mainnet right now. Here's the first real RLUSD settlement
  transaction, explorer-visible: `D5F11B5EF7BD9C9BC8062FDA2F6B94BCA1F95DC3417C372548BB5F6082B4D12A`
  — a 1 RLUSD Payment to Ripple's official RLUSD issuer trust line, `tesSUCCESS`. You can look
  it up, or run our verifier against it.
- **Deeper:** Settlement wallet `rHLDysh6p6TcJM7QXU15YRLG4mERF5h5pv` → landlord wallet
  `rw97rJThBJtoVRqR4DsoK5kW2taftzQvAX`, RLUSD issuer `rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De`. The
  payment carries a SHA-256 settlement fingerprint in its memo. Verify end-to-end with
  `node scripts/verify-settlement.js rHLDysh6p6TcJM7QXU15YRLG4mERF5h5pv` (checks type, tesSUCCESS,
  RLUSD amount + official issuer, and the memo). We funded and trust-lined deliberately rather
  than rushing real funds — the settlement was the last gated step, now done.

**Q: Why RLUSD instead of XRP or another stablecoin?**
- **Concise:** Because it's USD-denominated — a landlord settling $34,650 of CAM sees $34,650,
  with no volatility and no conversion math. It's issued natively on XRPL, so settlement is fast
  and costs a fraction of a cent, and it preserves the "nobody has to think about crypto"
  property that matters to a real-estate audience.
- **Deeper:** RLUSD is held via a trust line to the issuer; we use the standard 160-bit currency
  encoding. XRP itself would introduce price volatility into a dollar-denominated bill, which is
  exactly what a landlord and tenant don't want.

---

## 5. Security & Privacy

**Q: You're moving money — how is the settlement wallet protected?**
- **Concise:** The wallet seed never touches the production server or the browser. It lives only
  in the operator's local environment and is used by a local admin script to sign settlements.
  The public API is **read-only** — it can report wallet status but cannot sign or move funds.
  So no web request, authenticated or not, can drain the wallet.
- **Deeper:** We actually tightened this during build: an earlier version exposed a settlement
  endpoint that any authenticated user could call. We identified that, removed the fund-moving
  actions from the public endpoint entirely, and moved signing to a local script. That's the
  kind of thing I'd rather catch ourselves than have a judge find.

**Q: Where does sensitive lease and tenant data live, and who can see it?**
- **Concise:** In Supabase — Postgres behind authenticated access — not on-chain. Tenants are
  scoped to their own property, and secrets like the API key and wallet seed are server-side
  environment variables. Confidential data is deliberately kept off the public ledger.
- **Deeper:** Supabase row-level security is the authoritative server-side boundary, with
  client-side checks as defense-in-depth. Honestly, before onboarding real tenants I'd want to
  re-verify every RLS policy is enabled and audited — for a hackathon demo the data is seeded,
  but that's a real pre-production checklist item, not something I'd gloss over.

**Q: What's your biggest security risk right now?**
- **Concise:** Honestly, that we're a small team without a third-party security audit. The
  fund-moving path is locked down and secrets are server-side, but I wouldn't handle real tenant
  money at scale without a proper audit. Our current mainnet exposure is intentionally tiny — a
  small demo settlement amount.
- **Deeper:** The serious threat model for a payments product is the money path and the tenant
  data boundary. We've addressed the obvious ones (read-only endpoint, local signing,
  server-side secrets, auth + RLS); the responsible next step before scale is an external review.

---

## 6. Business Model

**Q: How do you make money?**
- **Concise:** The plan is SaaS — a per-property or per-portfolio subscription paid by the
  property manager, who saves weeks of work per reconciliation cycle. Honest caveat: billing
  isn't implemented, we have no paying customers, and the pricing is a hypothesis we haven't
  validated.
- **Deeper:** The manager is the natural payer because they bear the labor and the dispute cost.
  A per-door or per-property monthly fee is the likely shape, but I'd want pilot data before
  committing to numbers.

**Q: Who pays for the on-chain settlement cost?**
- **Concise:** XRPL transaction fees are negligible — fractions of a cent — so settlement cost
  isn't a real line item. The meaningful cost is the fiat-to-RLUSD conversion, which requires a
  licensed money-transmission partner. We have **not** built or signed that — it's a known,
  named dependency, not something I'm hand-waving.
- **Deeper:** We are not a money transmitter and don't intend to become one. Real fiat rails
  would come through a licensed partner (e.g., Ripple Payments or a licensed MSB). That's the
  gating dependency between today's demo and an end-to-end production payment loop.

**Q: What's the path to your first dollar of revenue?**
- **Concise:** Land one pilot property manager, run their real CAM reconciliation, prove the
  time saved and disputes avoided, and convert to paid. We're pre-pilot today — zero paying
  users — and I'd rather state that than inflate it.

---

## 7. Competition / Differentiation

**Q: Yardi, MRI, AppFolio exist. Why won't they just build this?**
- **Concise:** They could build the reconciliation math — but those are systems of record built
  for the landlord, not for transparency to the tenant. Our wedge is tenant-verifiable
  settlement on a public ledger, which is culturally and architecturally not what an ERP does.
  We integrate alongside them rather than trying to rip them out.
- **Deeper:** Incumbents optimize for the paying landlord and have little incentive to make
  charges independently verifiable by tenants. Our defensibility, to be honest, isn't the XRPL
  call — it's the CAM domain logic and becoming the trusted layer between the two parties.

**Q: What actually stops a competitor from copying the XRPL settlement?**
- **Concise:** Nothing — the XRPL mechanic is a memo plus an RLUSD payment; it's not
  proprietary. The defensibility is the CAM domain logic, the lease extraction, the dispute
  workflow, and the trust relationship — not the ledger call. The ledger is a feature, not the
  moat, and I won't pretend it is one.
- **Deeper:** If the only thing we had was "we put a payment on XRPL," we'd have no business.
  The work is in correctly handling caps, exclusions, and disputes, and in being the neutral
  party both landlord and tenant rely on.

**Q: Isn't this a blockchain solution looking for a problem?**
- **Concise:** The problem — disputed, unverifiable CAM charges — is real and predates
  blockchain entirely. We didn't start with "put real estate on-chain." We started with the
  dispute problem and used the ledger only where it genuinely helps: letting a tenant
  independently verify a settlement. The honest test is simple — with a database, a tenant
  cannot independently verify a payment; on a public ledger, they can.

---

## 8. Future Roadmap

**Q: What's next after the hackathon?**
- **Concise:** Three things: a real fiat payment processor plus a licensed conversion partner so
  the settlement loop is end-to-end; first pilot customers; and a deeper Yardi round-trip.
  Alongside that, measuring extraction accuracy on a labeled dataset.
- **Deeper:** The payment/licensing piece is gated on partnerships, not engineering; the pilot
  piece is sales; the Yardi and accuracy pieces are engineering we can do ourselves. I'd
  sequence the licensed-partner conversation first, because it unblocks the real revenue loop.

**Q: What would you do with prize money or funding?**
- **Concise:** Fund the licensed-partner integration and the cost of real settlement volume
  during a pilot, and pay for a proper security audit before handling real tenant money. It's
  about reaching the first real end-to-end settlement with a real customer — not marketing.

**Q: What's most likely to kill this?**
- **Concise:** Honestly, distribution and the payments/regulatory dependency. The technology
  works; the open risks are whether property managers adopt it and whether we can stand up
  compliant fiat rails through a licensed partner. I'd rather name those now than pretend it's
  all upside.

---

## Quick honesty cheat-sheet (what NOT to overstate)
- **No paying users / no pilots yet.** Pre-pilot. Say it plainly.
- **No live fiat payment processor.** The in-app "Pay Now" is a placeholder; real fiat↔RLUSD
  needs a licensed partner we haven't signed.
- **Documents are NOT on-chain** — local SHA-256 fingerprints + on-ledger settlement memo only.
- **No published AI accuracy benchmark** — confidence scoring + human review instead.
- **Yardi export/round-trip is unproven** — import works.
- **Make Waves attribution mechanism not yet verified** — confirm from official rules.
- **No third-party security audit yet.**
