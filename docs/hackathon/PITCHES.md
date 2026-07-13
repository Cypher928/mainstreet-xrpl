# MainStreet — Pitches (30s / 2min / 5min) + the two narratives that must land

---

## 30-second elevator pitch

> "Commercial landlords bill tenants every year for shared operating costs —
> it's called CAM reconciliation, it runs on spreadsheets and misread leases,
> and it's so error-prone there's a consulting industry that exists just to
> audit the mistakes. MainStreet reads the lease with AI — every extracted
> term keeps a verbatim quote and page number — computes each tenant's share
> deterministically, and settles in RLUSD on the XRP Ledger with a SHA-256
> fingerprint of the exact reconciliation in the payment memo. From the
> sentence in the lease to the hash on the ledger, every dollar is traceable.
> It's live on mainnet — the first settlement is verified on livenet.xrpl.org
> right now."

## 2-minute pitch

> "Here's a number nobody tracks: commercial landlords recover shared
> operating costs — maintenance, insurance, taxes — from tenants through CAM
> reconciliation. Industry estimates put the leakage at 2–5% of recoverable
> expenses, in both directions: landlords leave money on the table, tenants
> get overbilled, and disputes poison ten-year relationships. The root cause
> is simple: the rules live in 80-page lease PDFs, and the process lives in
> Excel.
>
> MainStreet replaces that pipeline end to end. AI reads the lease — but
> unlike every 'AI-powered' tool you've seen, extraction is evidence-first:
> every field carries the verbatim quote, the page number, and a confidence
> score, and a human review gate sits between extraction and any invoice.
> The money math is fully deterministic — same input, same output, always —
> because a hallucinated invoice is a lawsuit, not a feature. Tenants get
> statements where every line item traces to the lease language that
> authorizes it. Disputes get resolved against documents.
>
> Then the part that's only possible on XRPL: settlement in RLUSD, Ripple's
> regulated dollar stablecoin, with a SHA-256 fingerprint of the exact
> reconciliation embedded in the payment memo and MainStreet's Source Tag on
> every transaction. Any party — landlord, tenant, auditor, lender — can
> verify on public infrastructure that this payment settled this statement.
> A wire transfer can't do that. A check can't do that.
>
> It's live on mainnet today with a verified settlement, a full AI workspace,
> reserve and acquisition intelligence, and a regression suite that's held
> green across nine feature phases. CAM is our wedge into the money layer of
> commercial real estate — evidence in, proof out."

## 5-minute pitch

Use the 2-minute pitch as the spine, then extend with these four blocks:

**(+1 min) The deterministic-AI argument.**
> "Let me be precise about the AI, because 'AI-powered' is the most abused
> phrase at this event. MainStreet uses generative AI in exactly one place:
> reading documents. Everything after that — allocation, caps, answers,
> drafted letters — is deterministic computation over verified data. When you
> ask the AI Workspace 'which leases have CAM caps?', it doesn't ask a model;
> it scans the evidence store and answers with citations and a reasoning
> trace. Ask twice, get the same answer twice. That's not a limitation — it's
> the design that makes AI admissible in a financial workflow. The generative
> layer proposes; evidence and humans confirm; deterministic code computes."

**(+1 min) Why XRPL, specifically.**
> "We needed three things from a settlement rail: dollars — CAM obligations
> are dollar-denominated, so RLUSD, a regulated stablecoin, not a volatile
> asset; finality in seconds at negligible cost, because reconciliation
> shouldn't add a settlement float; and a public, permanent record we could
> bind to our data — which XRPL's memos and source tags give us natively.
> The SHA-256 of the reconciliation rides in the payment memo, so the ledger
> entry and the accounting record authenticate each other. We didn't add
> blockchain to a SaaS product. We found the only database that can prove a
> payment settled a specific document, and built the money layer on it."

**(+1 min) Traction and honesty.**
> "What's real today: mainnet settlement, verified — here's the transaction
> hash. A working product: lease intelligence, reconciliation, disputes with
> audit hashes, lender reserve draws, acquisition analysis, an AI command
> center. What's deliberately not built yet: in-app payment initiation — keys
> never touch our servers, settlement is operator-signed until we integrate
> custody — and per-property wallets, which our transaction format was
> designed for from day one. I'd rather show you a small thing that's real
> than a big thing that's a video."

**(+1 min) The market and the ask.**
> "The beachhead is the 5-to-100-property owner — big enough that CAM errors
> are real money, too small for a Yardi back office. Their current tool is
> Excel and an accountant-week per property per year. MainStreet's ROI case
> is one missed CAM cap or one unfiled reserve draw per year — everything
> else is margin. The wedge is CAM; the platform is the money layer of
> commercial real estate: budgeting, estoppels, lender reporting, and
> tenant-initiated RLUSD payment with on-ledger verification. We're raising a
> pilot cohort now — three to five landlords running their real portfolio
> through it."

---

## Narrative #8 — Why XRPL is essential (not bolted on)

The test a judge applies: *"Would this product lose something real if you
swapped XRPL for Stripe?"* Your answer, in escalating strength:

1. **Stripe moves money; it can't prove *what for*.** MainStreet's whole
   product is a chain of evidence — quote → field → computation → invoice.
   The last link needs a settlement record that *binds to the reconciliation
   itself*. XRPL memos carry our SHA-256 fingerprint in the transaction; the
   payment and the accounting record authenticate each other, publicly,
   forever. No payment API exposes that.
2. **Neutral verification.** Landlord and tenant are adversaries in a
   dispute. Both can verify settlement on livenet.xrpl.org — infrastructure
   neither party (nor MainStreet) controls. "Trust me" becomes "check the
   ledger."
3. **RLUSD makes it a dollars product.** The obligation is in dollars; the
   settlement is in regulated, dollar-backed RLUSD. No volatility exposure,
   no crypto mental model required from the customer.
4. **The economics fit B2B invoicing.** 3–5 second finality, sub-cent fees,
   no chargebacks — cross-border-capable by default for foreign-owned
   properties (a real segment in US CRE).
5. **The roadmap is native.** Source Tags and Destination Tags give us
   per-property and per-tenant payment routing without new infrastructure —
   tenant-initiated payment that MainStreet *detects and verifies* rather
   than executes. That end-state is only cheap because the rail is XRPL.

One-liner to memorize:
> "We use the ledger as an audit layer that happens to move the money —
> not a payment rail that happens to have a memo field."

## Narrative #9 — Why this is a real business problem today

1. **It's mandatory.** CAM reconciliation isn't optional workflow software —
   every commercial lease requires it annually. The market is every
   multi-tenant commercial property in existence.
2. **The pain is quantified in both directions.** Under-recovery is lost NOI
   (2–5% of recoverable expenses, per industry audit lore); over-billing is
   disputes, audits, legal exposure, and tenant churn. Landlords currently
   choose which way to be wrong.
3. **A whole industry monetizes the errors.** Tenant-side CAM audit firms
   exist *solely* because landlord statements are unreliable. When
   consultants make a living off a process's mistakes, the process is broken
   enough to be a software category.
4. **The blocker just fell.** Automating CAM was impossible while the rules
   lived in unstructured PDFs. LLM extraction made lease terms machine-
   readable in 2023–24; RLUSD made dollar settlement on-ledger possible in
   Dec 2024. MainStreet exists at the intersection — that's the "why now."
5. **The buyer feels it this quarter.** Rate pressure has CRE owners hunting
   recoverable dollars they used to shrug off. Expense recovery went from
   back-office chore to board topic.

One-liner:
> "This isn't a blockchain looking for a use case. It's a hundred-year-old
> accounting obligation, done in Excel, finally meeting the two technologies
> it was waiting for."
