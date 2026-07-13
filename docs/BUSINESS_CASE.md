# MainStreet — Business Case

*The seed-round story. This is a living document: numbers marked (est.) are
founder estimates to be validated in pilots, not measured results. Everything
described as built refers to working, tested software — see the technical docs
in this folder.*

---

## 1. What MainStreet does

MainStreet is an AI-powered operating system for the money side of commercial
real estate leases. It reads leases, reconciles CAM (Common Area Maintenance)
charges, proves every number back to the exact page of the source document,
manages lender reserve reimbursements, analyzes acquisitions, and settles
payments in RLUSD on the XRP Ledger with a permanent, publicly verifiable
audit trail.

One sentence for the elevator: **MainStreet turns the most disputed, most
manual billing process in commercial real estate into a push-button workflow
where every dollar carries its own evidence.**

## 2. The problem

CAM reconciliation is how landlords recover shared operating costs (snow
removal, roof repairs, insurance, taxes) from tenants. Today it is:

- **Manual.** Leases are read by humans, terms live in spreadsheets, and the
  annual reconciliation is weeks of accountant time per property.
- **Error-prone in both directions.** Caps, exclusions, gross-up clauses, and
  amendments get missed. Landlords under-bill (money left on the table) and
  over-bill (disputes, audits, damaged tenant relationships).
- **Adversarial.** An entire consulting industry exists solely to audit
  landlords' CAM statements on behalf of tenants — because the statements are
  so often wrong.
- **Opaque at settlement.** Even when the math is right, "did the money
  actually move, for exactly this reconciliation?" is answered by emails and
  bank statements, not proof.

Adjacent and equally manual: lender reserve draws (landlords routinely leave
reimbursable money sitting in escrow because assembling a draw package is
painful) and acquisition due diligence on rent rolls.

## 3. Who buys it

**Primary (beachhead):** small-to-mid commercial landlords and third-party
property managers — roughly 5 to 100 properties. Large enough that CAM errors
are real money; too small to have a Yardi-scale back office. Today their
"system" is Excel plus an accountant.

**Secondary:** fee-based property management firms (CAM reconciliation is a
billable service they'd love to do in a tenth of the time), and CRE lenders
(who want visibility into reserves and clean draw packages).

**Eventually:** institutional owners, where the evidence chain and audit trail
become a compliance product, not just a convenience.

The buyer is the owner/asset manager; the daily user is the property
accountant or manager. Tenants use a free portal (statements, disputes) —
they're not the customer, but tenant-facing transparency is part of what the
landlord is buying.

## 4. Why they buy — the ROI

| Value | Mechanism | Rough sizing (est., to validate in pilot) |
|---|---|---|
| **Recovered revenue** | Missed caps, misapplied exclusions, un-billed recoverable expenses found by correct allocation | Industry lore puts CAM leakage at 2–5% of recoverable expenses; on a center recovering $500k/yr that's $10–25k/yr per property |
| **Reserve reimbursements** | Draw packages assembled automatically; readiness score tells you when to file | Money already owed to the landlord, sitting in lender escrow, unfiled |
| **Labor** | Weeks of annual reconciliation → hours; lease abstraction in minutes | 20–60 accountant-hours per property per year (est.) |
| **Dispute reduction** | Tenant statements ship with page-cited evidence; disputes resolve against documents, not arguments | Fewer audits, faster resolution, preserved relationships |
| **Acquisition speed** | Rent-roll analysis and revenue-at-risk in minutes instead of analyst-days | Better bids, fewer surprises post-close |

The honest pitch: **MainStreet pays for itself if it finds one missed CAM cap
or files one forgotten reserve draw per year.** Everything else is margin.

## 5. Competitive landscape

| Competitor | What they are | Where MainStreet wins |
|---|---|---|
| **Excel + the accountant** | The true incumbent for the beachhead segment | Not a feature war — it's automation vs. weeks of manual work |
| **Yardi / MRI / RealPage** | Full-stack ERPs for large owners | Overkill and overpriced for 5–100 property owners; CAM modules are data-entry tools, not intelligence — they don't read the lease |
| **AppFolio / Buildium** | SMB property management (heavily residential) | Weak/no commercial CAM logic, no evidence chain |
| **Prophia, Leverton-style AI abstraction** | AI lease abstraction as a data product | They stop at extraction; MainStreet extracts *and then runs the money workflow the extraction feeds* |
| **CAM audit consultants** | Humans who find landlords' mistakes after the fact (usually hired by tenants) | MainStreet is the pre-emptive version, working for the landlord, continuously |
| **STRATAFOLIO, Occupier, Leasecake** | Lease admin / tracking | Tracking dates ≠ computing money with document-level proof |

Nobody in this list connects lease evidence → allocation math → tenant-facing
proof → on-ledger settlement. That end-to-end chain is the product.

## 6. Competitive advantages & defensibility

1. **The evidence chain.** Every number traces to a verbatim quote, page, and
   confidence score, from extraction through reconciliation to an on-ledger
   SHA-256 fingerprint. Competitors would need to rebuild their pipelines
   around evidence-first data structures — it's architectural, not a feature
   toggle.
2. **Deterministic AI = auditable AI.** Answers, explanations, and drafted
   documents come from inspectable computation, not a model's plausible
   guess. In a domain where the output is a legal invoice, "we can show our
   work, always" is a moat against AI-washing incumbents whose chatbots
   hallucinate.
3. **Workflow depth over data breadth.** Reserve draws, disputes, acquisition
   reviews, and settlement all consume the same lease intelligence — each
   module makes the others harder to rip out.
4. **Data compounding (future).** Anonymized CAM benchmarks across the
   portfolio base ("your janitorial cost/SF is 84th percentile") is a data
   product only accumulating customers can build.
5. **Speed.** The build history in this repo (Phases 1–27 with a
   continuously-green regression gate) is itself the argument that this team
   ships faster than incumbents' roadmap cycles.

What is *not* defensible and shouldn't be claimed: LLM extraction itself
(commodity within a couple of years) and XRPL access (open network). The moat
is the verified workflow wrapped around them.

## 7. Why XRPL matters

- **Settlement with proof.** An RLUSD payment on XRPL carries a SHA-256
  fingerprint of the exact reconciliation it settles — anyone can verify, on
  public infrastructure, that *this* payment settled *this* statement.
  Wire transfers and checks can't do that.
- **RLUSD specifically:** a regulated, dollar-backed stablecoin — settlement
  is in dollars, which is what CAM obligations are, without crypto price
  exposure.
- **Finality and cost:** 3–5 second settlement, sub-cent fees, no
  chargebacks.
- **Honest framing for investors:** today, XRPL settlement is a *proof-of-
  concept differentiator* (live on mainnet, first settlement independently
  verified), not the reason customers sign. The wedge is CAM intelligence;
  on-ledger settlement is the roadmap payoff — per-property wallets,
  tenant-initiated payment, and an audit trail that becomes the industry's
  cleanest record of who paid what for what.

## 8. Why AI matters — and why this AI

The single blocker to automating CAM has always been that **the rules live in
unstructured lease PDFs.** LLMs finally make extraction economical — but a
generative system that invoices tenants from hallucinated lease terms is a
lawsuit. MainStreet's split — generative AI *only* for extraction, with
verbatim-quote evidence and human review; deterministic computation for every
answer and every dollar — is the version of AI a CFO can sign off on.

## 9. Why now

1. **LLM extraction crossed the viability line** (~2023–24). Reading a lease
   with page-cited evidence was impossible to automate before; now it's a
   solved input problem.
2. **RLUSD launched** (Dec 2024) — the first time a regulated dollar
   stablecoin existed on a ledger cheap and fast enough for B2B settlement.
3. **CRE margin pressure.** Higher rates and soft demand mean owners are
   hunting recoverable dollars they used to leave behind; expense recovery is
   suddenly a board topic.
4. **Incumbent trust gap on AI.** Big platforms are bolting chatbots onto old
   data models; the window to define "auditable AI for CRE money" is open and
   won't stay open.

## 10. Business & revenue model

**Core: per-property SaaS subscription** (monthly, annual discount):

| Tier (illustrative, est.) | Price | Includes |
|---|---|---|
| Starter — up to 10 properties | ~$99/property/mo | CAM engine, lease intelligence, tenant portal |
| Professional — up to 50 | ~$79/property/mo | + reserves/draws, drafting studio, acquisitions |
| Portfolio — 50+ | custom | + SSO, team roles, integrations, SLA |

**Expansion revenue:**
- **Settlement fees** — small flat fee or bps on RLUSD settlement volume once
  in-app settlement ships.
- **Acquisition reviews** — per-review pricing for deal teams (usable before a
  property is ever onboarded — a natural top-of-funnel).
- **Draw-package success pricing** — optional % of reimbursements filed
  through MainStreet (aligns perfectly with "we found you money").
- **Data products** — CAM benchmarking, later.

Anchor logic: if the product recovers $10–25k/yr per property (est., §4),
~$1k/property/yr is a 10–25× ROI story with room to move upmarket.

## 11. Go-to-market

**Phase 1 — founder-led, niche-first (now → first 10 customers):**
- Direct outreach to small commercial landlords and fee managers (the
  segment's watering holes: ICSC, local CCIM/IREM chapters, CRE Twitter/
  LinkedIn, property management podcasts).
- The demo *is* the funnel: upload one real lease live, watch terms +
  evidence appear, run a reconciliation in minutes.
- "Free CAM checkup": run last year's reconciliation through MainStreet;
  if it finds missed recoveries, the product just sold itself.

**Phase 2 — channel:**
- Fee-based property managers as multipliers (one firm = dozens of
  properties; MainStreet makes their billable service dramatically cheaper to
  deliver).
- CPA firms serving CRE owners; lenders who want cleaner draw packages.

**Phase 3 — upmarket:** SSO, team roles, integrations (Yardi/MRI sync), and
the compliance/audit story for institutional owners.

## 12. Pilot strategy

3–5 design partners, 90 days, free or near-free in exchange for data and a
case study:

1. **Onboard their real documents** — extraction robustness against a real
   corpus is both product hardening and the trust moment.
2. **Re-run their last completed CAM year** in parallel with their books —
   every discrepancy found is either recovered money (sale closed) or a
   product fix.
3. **File one reserve draw** through the platform.
4. **Measure four numbers from day one:** dollars recovered, hours saved,
   dispute cycle time, draws filed. These four numbers *are* the seed deck's
   traction slide.

Settlement during pilots stays "MainStreet reconciles and records; customer
pays through existing rails" until custody UX ships — no pilot should be
blocked on crypto operations.

## 13. Risks (and what we do about them)

| Risk | Reality check | Mitigation |
|---|---|---|
| **Long CRE sales cycles** | Owners move slowly; trust is everything | Free CAM checkup shortens time-to-value to one meeting; land per-property, not enterprise-wide |
| **Incumbents add AI** | Yardi/MRI will ship "AI CAM" features | Their data models aren't evidence-first; compete on auditability and speed of iteration; be an acquisition target worth a premium if it comes to that |
| **Extraction errors → liability** | A wrong invoice is a real harm | Human review gate before money math, confidence scoring, evidence on every field; errors are catchable *before* billing — that's the architecture, not a promise |
| **Crypto perception** | "Blockchain" can scare a conservative buyer | Lead with CAM ROI; RLUSD settlement is opt-in and dollar-denominated; the word that matters in the pitch is *audit trail*, not crypto |
| **Regulatory (stablecoin)** | Rules are still forming | RLUSD is the regulated-issuer path; settlement remains optional rails, so the core business never depends on it |
| **Single-founder execution** | Bus factor is real | The /docs set + regression gate exist precisely to make the codebase transferable; seed hiring plan starts with one engineer + one CRE-native seller |
| **Data security** | Leases are sensitive | Per-user row isolation (RLS) is already enforced and tested; SOC 2 is on the enterprise roadmap |

## 14. Future expansion

- **In-app settlement + per-property wallets** — the fee-bearing rail.
- **Inbound payment detection** — tenants pay from their own wallets;
  MainStreet verifies by tag + fingerprint (the transaction format was
  designed for this from day one).
- **CAM budgeting & estimates** (monthly billing, not just annual true-up).
- **Benchmarking data products** across the customer base.
- **Adjacent documents:** loan agreements, insurance, vendor contracts — the
  evidence-first extraction pipeline generalizes.
- **The audit product:** the quote → field → reconciliation → on-ledger hash
  chain, packaged for auditors, lenders, and eventually tenant-side
  verification — turning today's adversarial CAM audit industry into a
  feature.

## 15. The seed story in five sentences

Commercial landlords lose billable money every year because CAM
reconciliation runs on spreadsheets and misread leases — an entire consulting
industry exists just to catch the mistakes. MainStreet reads the lease,
computes the money, and proves every number back to the page it came from —
with working software that already settles in regulated stablecoin on a
public ledger, independently verifiable by anyone. The wedge is a 10–25×
ROI (est.) on recovered revenue and labor for the 5–100-property owners the
big platforms ignore; the moat is an evidence-first architecture that
AI-washing incumbents can't retrofit. AI just made lease intelligence
possible, RLUSD just made dollar settlement on-ledger possible, and margin
pressure just made owners care — the window is now. Seed capital buys design
partners into paying customers, the custody rail for in-app settlement, and
the two hires (engineer, CRE-native seller) that turn a working product into
a growing one.
