# MainStreet — 100 Hard Judge Questions (with strong answers and traps)

How to use this: for each question, read the **Q**, answer out loud yourself,
then compare to the **A** (the improved answer) and the **✗ trap** (the weak
answer pattern a judge punishes). Rehearse the ten bolded "killer questions"
(marked ★) until the answers are muscle memory.

Universal rules for every answer:
- Numbers beat adjectives. "Verified 6-point on-ledger" beats "very secure."
- Concede honestly, then show the plan. Judges reward "not yet, here's why
  and here's the path" over any bluff.
- Never say "the AI figures it out." Say what is deterministic and what is
  generative — every single time it comes up.

---

## A. Business (1–10)

**1. ★ What exactly do you sell, and who signs the check?**
A: Per-property SaaS (~$99/property/mo starter tier) to commercial landlords
and fee property managers with 5–100 properties. The asset manager/owner
signs; the property accountant uses it daily.
✗ trap: describing features instead of a price and a buyer.

**2. How big is this market really?**
A: Every multi-tenant commercial lease requires annual CAM reconciliation —
in the US alone that's millions of leases across office, retail, industrial.
Our beachhead — small/mid landlords the ERPs ignore — is tens of thousands of
firms; at ~$1k/property/yr the wedge alone is a multi-hundred-million-dollar
segment. The platform play is the money layer of CRE.
✗ trap: quoting "the $X-trillion CRE market" — judges hear TAM theater.

**3. Why will a conservative real-estate owner adopt software with 'AI' and 'blockchain' in it?**
A: They adopt a CAM checkup: we re-run last year's reconciliation and show
them dollars they missed. The AI is packaged as evidence (quotes and page
numbers), the ledger as an audit trail. We lead with recovered money, never
with technology.
✗ trap: "education will drive adoption" — that's a cost, not a strategy.

**4. What does a customer pay you versus what do they recover?**
A: ~$1,200/property/year against an estimated $10–25k/property/year in
leakage on a mid-size center, plus 20–60 accountant-hours saved. One missed
CAM cap pays for years of subscription. These are founder estimates — the
pilot's job is to replace them with measured numbers.
✗ trap: presenting the estimates as measured fact. Say "estimate, to be
validated" — the honesty is more credible.

**5. What's your CAC story — how do you reach these landlords?**
A: Founder-led sales into a niche with dense watering holes (ICSC, IREM/CCIM
chapters), plus fee property managers as multipliers — one firm brings dozens
of properties. The demo is the funnel: upload one lease live.
✗ trap: "content marketing and SEO" for a high-touch B2B niche.

**6. Why hasn't Yardi/MRI already done this?**
A: Their CAM modules are data-entry screens on top of data someone manually
keyed from the lease — they never solved extraction, and their architectures
aren't evidence-first; retrofitting per-field provenance across a 30-year-old
schema is a rewrite. We'll take the segment they price out and meet them
upmarket with an audit story they can't match quickly.
✗ trap: "they're slow and legacy" without naming the structural reason.

**7. What happens when a customer's lease is negotiated in ways your model has never seen?**
A: Extraction confidence drops, the field routes to the review queue, a human
verifies against the highlighted source page, and the correction is stored
with reviewer identity. Weird leases degrade to assisted-manual, never to
silently-wrong.
✗ trap: claiming the model handles everything.

**8. What's the pilot plan?**
A: 3–5 design partners, 90 days, free: onboard their real documents, re-run
their last completed CAM year in parallel with their books, file one reserve
draw, and measure four numbers — dollars recovered, hours saved, dispute
cycle time, draws filed. Those four numbers are the seed deck.
✗ trap: a pilot defined by features shown rather than numbers measured.

**9. Who is this NOT for?**
A: Single-tenant NNN owners (no shared costs to reconcile), residential, and
— today — institutional owners who need SSO and team roles; that's the
enterprise roadmap, not the wedge.
✗ trap: "everyone with commercial property." Focus is credibility.

**10. If I gave you $500k tomorrow, where does it go?**
A: Two hires — an engineer and a CRE-native seller — custody integration for
in-app settlement, and converting the pilot cohort to paid. Not marketing.
✗ trap: vague "scaling the platform."

## B. AI (11–20)

**11. ★ How do you prevent hallucinations in something that produces invoices?**
A: Structurally, not with filters. Generative AI runs only at document
extraction; every extracted field must carry a verbatim quote and page
number, and passes a human review gate before it can drive money math. All
answers, letters, and calculations are deterministic code over that verified
data. There is no model in any answer path to hallucinate.
✗ trap: "we use low temperature / good prompts." That's mitigation theater.

**12. Which model do you use and what happens when it's deprecated?**
A: Claude via a server-side proxy; the model is a config constant, and
extraction quality is regression-tested against fixture leases, so a model
swap is a test-suite run, not a rewrite. The evidence contract — quote, page,
confidence — is model-agnostic.
✗ trap: not knowing your own model name or having no swap story.

**13. Why should I believe 'deterministic AI' isn't just marketing for 'if-statements'?**
A: Partly it IS structured computation — that's the point. The intelligence
is in extraction (genuinely hard, genuinely generative) and in the evidence
architecture. We're proud that the answer layer is inspectable: ask the same
question twice, get the same answer with the same reasoning trace. In
invoicing, reproducibility is the feature.
✗ trap: getting defensive. Own it — determinism is the pitch, not the
embarrassment.

**14. What's your extraction accuracy?**
A: On our fixture corpus, high-confidence fields are extraction-route-tested
in the regression suite; on scanned documents we route through a vision path
with deliberately penalized confidence. But the honest answer is: accuracy is
per-field with a confidence score, and anything below the bar routes to human
review. The design assumes imperfect extraction — that's why the review gate
and evidence exist. Pilot metric #1 is field-level accuracy on customer
corpora.
✗ trap: inventing a precision number you can't back.

**15. Isn't the review queue just admitting your AI doesn't work?**
A: It's admitting no extraction is 100% — including human paralegals. The
product's promise isn't 'no humans'; it's 'one hour of verification instead
of forty hours of reading, with every field pre-located and quoted.'
✗ trap: minimizing the human role. Judges respect the gate.

**16. Could a malicious lease PDF manipulate your AI? (prompt injection)**
A: A crafted document could try to skew extraction — which is why extraction
output can't reach money math without verbatim-quote evidence and human
review, and why the vision path carries penalized confidence. Injection can
make extraction wrong; the architecture stops wrong from becoming billed.
✗ trap: "we sanitize inputs" — you can't sanitize semantics; the gate is the
answer.

**17. Why not fine-tune your own model?**
A: Our moat isn't the model — it's the evidence pipeline and workflow around
any model. Frontier models plus our evidence contract beat a fine-tune we'd
have to maintain, on cost and on capability trajectory.
✗ trap: implying a fine-tune is on the roadmap because it sounds impressive.

**18. What did the AI Workspace answer actually consult just now?**
A: The reasoning trace on screen shows it: which engines ran, how many leases
were scanned, what was excluded. It's an audit log per answer.
✗ trap: hand-waving "it looks at the data."

**19. How does the drafting feature avoid writing something legally dangerous?**
A: Documents are assembled from computed values and evidence; anything
requiring judgment is a literal [bracketed placeholder] the human must fill.
Output is watermarked DRAFT, is never auto-sent, and returns null rather than
fabricate when data is insufficient.
✗ trap: "the user should review it" as the only safeguard.

**20. What AI capability is deliberately missing?**
A: Open-ended chat. If a question doesn't match a deterministic intent, the
Workspace says so and offers what it can answer. We chose a smaller, honest
surface over an impressive, occasionally-wrong one.
✗ trap: apologizing for it. It's a decision, not a gap.

## C. Commercial real estate domain (21–30)

**21. ★ Walk me through a CAM reconciliation like I'm not in real estate.**
A: Tenants in a shopping center share costs — parking-lot repairs, insurance,
snow removal. Each lease defines that tenant's share and its limits: caps on
increases, excluded cost types. Once a year the landlord totals actual
expenses, computes each tenant's true share against what they prepaid, and
bills or credits the difference. Five leases, 26 invoices, each lease with
different rules — that's the demo property, and that's the two-week
spreadsheet job MainStreet computes.
✗ trap: using CAM/NNN/gross-up jargon in the explanation of the jargon.

**22. What's a CAM cap and why does missing one cost money?**
A: A lease clause limiting how much a tenant's shared-cost bill can grow
year over year — say 5%. Miss an existing cap and you overbill (dispute,
audit, refund with interest); fail to track a cap correctly and you can
underbill and eat the difference. It's the single highest-leverage lease term
in this workflow, which is why our Command Center flags NNN leases missing
one.
✗ trap: only explaining one direction of the error.

**23. Gross-up clauses — do you handle them?**
A: We extract and evidence them; automated gross-up computation is roadmap.
Today the reconciliation applies pro-rata, caps, and exclusions, and flags
occupancy-sensitive terms for the accountant. I'd rather tell you what the
engine doesn't do yet than have you find out.
✗ trap: claiming full coverage of every lease mechanic. Judges with CRE
background will probe until something honest comes out — volunteer it first.

**24. Landlords and tenants both use this? Whose side are you on?**
A: The landlord pays us; the tenant portal makes the landlord's numbers
defensible — statements with lease citations, disputes resolved against
documents with an audit hash. Transparency is what the landlord is buying:
fewer audits, faster collections, kept relationships.
✗ trap: "we're neutral" — you have a customer; transparency is their weapon.

**25. Why would a tenant trust the landlord's software?**
A: Because it cites the tenant's own lease back to them, page and paragraph —
and because settlement verification lives on a public ledger neither party
controls. Adversarial verifiability is the design goal.
✗ trap: "because it's accurate."

**26. What's a reserve draw and why is it in a CAM product?**
A: Lenders hold escrowed reserves for repairs; landlords routinely leave
reimbursements unclaimed because assembling the draw package — invoices,
lien waivers, photos, certifications per the loan agreement — is painful.
Same skill as CAM: read a document, extract requirements, assemble evidence.
Different document, same engine, found money.
✗ trap: it sounding like feature sprawl. Frame it as the same competency.

**27. How do you handle a lease amendment that changes terms mid-year?**
A: Multi-document intelligence: amendments supersede base-lease fields with
provenance kept for both, and the effective term drives the math. The
evidence panel shows which document won and why.
✗ trap: "we take the newest file" — supersedence is per-field, not per-file.

**28. What about mixed-use properties with different expense pools?**
A: Today: one pool per property with per-lease exclusions; multi-pool
allocation is a known enterprise requirement on the roadmap. Small-portfolio
retail/office — our beachhead — is predominantly single-pool.
✗ trap: pretending pools don't exist.

**29. Do you integrate with Yardi/MRI/QuickBooks?**
A: CSV import from Yardi today; API sync is post-pilot roadmap prioritized by
what design partners actually run. We deliberately built the system of
intelligence, not a replacement system of record.
✗ trap: promising integrations by name and date.

**30. Estoppel certificates — you have a hidden tab for it. Why?**
A: Same evidence engine — an estoppel is basically a signed summary of lease
facts we already extract with citations. It's hidden because it's not
finished, and we don't demo what isn't real.
✗ trap: demoing or overselling it. The honest answer earns more than the
feature would.

## D. Blockchain / XRPL (31–40)

**31. ★ Why do you need a blockchain at all? This could be Postgres + Stripe.**
A: Postgres + Stripe can move the money; they can't prove — to an adversarial
counterparty — WHAT the payment settled. Our payment carries a SHA-256 of the
exact reconciliation in the XRPL memo; landlord, tenant, or auditor verifies
on public infrastructure neither we nor the landlord controls. In a workflow
whose core problem is two parties disputing numbers, neutral verifiability
isn't a nice-to-have — it's the product's last mile. Stripe gives you a
receipt from us. XRPL gives you a proof that outlives us.
✗ trap: latency/fees as the lead answer — Stripe is fast too. Lead with
*bound proof*, then economics.

**32. Why XRPL and not Ethereum/Solana/Base?**
A: We needed a regulated dollar stablecoin (RLUSD, issuer-native, not a
bridged asset), deterministic sub-cent fees (no gas auctions on B2B
invoices), 3–5s finality, and native transaction metadata — memos and
source/destination tags — without deploying or auditing smart contracts.
XRPL's payment-first design is exactly the shape of our problem; we use the
ledger, we don't program it.
✗ trap: ecosystem/prize-driven reasoning. Give the four requirements.

**33. Aren't you barely using XRPL? It's just a payment with a memo.**
A: The primitive is simple; the binding is the product. Fingerprinted memos +
source tags turn the ledger into the audit layer of an evidence chain that
starts at a sentence in a PDF. And that simplicity is deliberate: no
contracts to audit, nothing exotic to break, a straight path to per-property
destination-tag routing and tenant-initiated payment detection.
✗ trap: getting defensive or inventing complexity. Simple + real beats
complex + demo-ware; say the roadmap makes the ledger load-bearing.

**34. What happens if XRPL is down or congested?**
A: Settlement degrades gracefully — the reconciliation, statements, and
workflow don't depend on the ledger; a payment waits. Historically XRPL
finality is seconds with negligible fee variance; our verify tooling already
does multi-endpoint fallback.
✗ trap: claiming the app doesn't care — say *which* part doesn't care.

**35. Where are the private keys?**
A: Never on our servers, never in the browser, never in the repo. Settlement
today is operator-signed via CLI with hidden-prompt seed entry and dry-run
default; the deployed API is read-only. A full server compromise cannot move
funds. In-app settlement ships only when a custody integration preserves
that property.
✗ trap: any answer that includes the word "encrypted" as the safety story.

**36. What's actually in the memo — is tenant data on a public ledger?**
A: A SHA-256 hash only. No names, no amounts breakdown, no lease data — you
can verify the fingerprint if you hold the underlying record, but you can't
reverse it. Privacy-preserving by construction.
✗ trap: not knowing this cold. It's a guaranteed question.

**37. Why RLUSD instead of XRP?**
A: The obligation is denominated in dollars; settling in a volatile asset
adds FX risk to an accounting product. RLUSD is a regulated, issuer-backed
dollar on the same rail. XRP still matters — reserves and fees — but the
value moves in dollars.
✗ trap: dodging XRP as if it's a dirty word; explain both roles.

**38. What did you actually execute on mainnet?**
A: Trust lines to the RLUSD issuer, funded wallets, and a live RLUSD
settlement with our Source Tag 2606290001 and reconciliation fingerprint —
verified by an independent 6-point on-ledger check (validated, sender,
destination, currency/issuer, amount, memo hash). Here's the hash: D5F11B…
It's on livenet.xrpl.org right now.
✗ trap: rounding a testnet up to "live." (You don't need to — it IS mainnet.)

**39. How do refunds or partial payments work on-ledger?**
A: They don't yet — one reconciliation, one payment, one direction. Partial
payments, plans, and credits are modeled off-ledger today and are exactly
what destination-tag + fingerprint routing is designed to support next.
✗ trap: improvising a design live. "Not yet, designed for" is the answer.

**40. If Ripple or RLUSD failed, what happens to MainStreet?**
A: The company survives — settlement is the last mile, not the engine.
We'd re-point the settlement layer at another regulated dollar instrument;
the evidence-to-proof architecture is rail-agnostic even though XRPL is the
best rail for it today.
✗ trap: "that won't happen." Contingency answers signal maturity.

## E. RLUSD specifics (41–50)

**41. Who issues RLUSD and what backs it?**
A: Ripple, under a NYDFS trust charter, backed by dollar deposits and
short-term US treasuries with attestations. It's the regulated-issuer path —
which is precisely why a conservative CFO can touch it.
✗ trap: fuzzy on the regulator. Know "NYDFS trust company" cold.

**42. What's the trust-line requirement and why does it exist?**
A: XRPL accounts must explicitly opt in to hold an issued asset — a TrustSet
to the RLUSD issuer with a limit. It's consumer protection at the protocol
level: nobody can airdrop you an obligation. Our setup scripts handle it as
a one-time step per wallet.

**43. How does a landlord actually get RLUSD today?**
A: Exchanges that list it or Ripple's institutional partners; that
acquisition step is out-of-band today and is part of why pilots can run
"reconcile on MainStreet, pay on existing rails" until custody UX ships.
✗ trap: pretending on/off-ramp friction doesn't exist.

**44. What if RLUSD depegs?**
A: Settlement is near-instant — exposure is seconds of transit, not custody.
We don't hold customer RLUSD balances; the product records and verifies.
✗ trap: defending the peg itself; defend your exposure window instead.

**45. Could you support USDC or another stablecoin?**
A: Architecturally yes — the settlement layer takes an issuer + currency
pair. RLUSD-on-XRPL is first because regulated issuer + native memo/tag
support in one rail is the rare combination we need.

**46. Are there compliance/KYC implications to settling in RLUSD?**
A: Both wallet parties are the landlord's own entities today, and RLUSD's
issuer enforces its compliance perimeter. When tenant-initiated payment
ships, custody partners bring KYC — that's a reason custody is a partner,
not us rolling our own.
✗ trap: "we're just software" — judges want to hear you've thought about it.

**47. Precision — can RLUSD represent $12,345.67 exactly?**
A: Yes; XRPL issued amounts carry ample precision for 2-decimal dollar
values. Our pipeline formats amounts to cents before building the
transaction. (And the amount is also asserted by the 6-point verifier.)

**48. Why is there XRP in the wallets if you settle in RLUSD?**
A: Protocol requirements: account reserves and per-transaction fees are XRP.
Think of it as postage; value moves in RLUSD.

**49. What does a settlement cost you, all-in?**
A: A fraction of a cent per transaction. Wire: $15–30. ACH: days.
That delta at portfolio scale is a line item worth naming to a CFO.

**50. Is the Source Tag just hackathon branding?**
A: It started as Make Waves attribution, but it's load-bearing roadmap:
source/destination tags are how per-property and per-tenant payment routing
works without new infrastructure — the same field that identifies us today
routes money tomorrow.

## F. Security (51–60)

**51. ★ What's your worst security risk right now, honestly?**
A: The same as every document SaaS: sensitive lease documents and the trust
customers place in our access controls. We run per-user row-level security
enforced in Postgres with cross-user tests, keys never touch servers, and
the deployed settlement API is read-only. We also just completed an external-
style code review of the whole codebase, and the findings — including
storage-URL hardening — are triaged into the pre-pilot fix list. I can name
our known weaknesses because we wrote them down.
✗ trap: "we're very secure." Name a real risk + control + process.

**52. You had a wallet compromised before. Tell me about that.**
A: Early on, a seed was exposed through our own operational mistake. We
detected it, drained to a safe wallet, abandoned the address, rotated to
fresh wallets with hidden-prompt-only seed handling, and rewrote the ops
scripts so the mistake is structurally hard to repeat. It's why our key
discipline is now the strictest part of the codebase.
✗ trap: hiding it. If provenance is your pitch, own your incident like an
adult company — judges may know, and honesty here wins the room.

**53. What can a malicious authenticated user do to another user's data?**
A: RLS scopes every row to its owner and we test cross-user isolation.
Our recent review flagged one server-side proxy needing stricter row
validation — it's top of the pre-pilot fix list. Defense in depth means the
review process is the security feature.
✗ trap: absolute claims ("nothing, ever") — the honest version is stronger.

**54. XSS — you render HTML from extracted documents everywhere.**
A: Every render path goes through HTML-escape helpers, and our review pass
specifically audited interpolations; the rare gaps found are catalogued for
the hardening sprint. Document-derived text is treated as untrusted input,
same as user input.

**55. Where do uploaded leases live and who can fetch them?**
A: Supabase Storage behind auth; URL-hardening (private buckets + signed
URLs) is a known pre-pilot item from our review. Documents are the crown
jewels and get treated that way.

**56. Do you log sensitive data?**
A: The review flagged verbose extraction logging to scrub before pilot —
it's on the list with an owner. Production target: structured logs, no
document content, no PII.

**57. Rate limiting and abuse on your AI endpoints?**
A: Authenticated-only, per-user limits, size caps; hardening beyond
per-instance limits (shared store) is queued. Cost abuse is bounded by
auth + caps today.

**58. Supply chain — what runs in the browser?**
A: Deliberately boring: vanilla JS, pdf.js pinned, Supabase client, no
framework tree of transitive dependencies. The npm surface is tests and CLI
tooling, not the shipped page.

**59. Who has access to production?**
A: One operator today; secrets in Vercel env, DB behind Supabase auth,
wallet seeds offline. Small-team honesty: process (reviews, regression gate,
read-only money API) substitutes for org structure until there's an org.

**60. If I handed you a pen-test report tomorrow, what would you do with it?**
A: Triage into the same pipeline our internal review produced this week —
severity-ranked, pre-pilot blockers first, each fix landing with a
regression test. We'd welcome it; we already run the internal version.

## G. Scalability (61–70)

**61. ★ Does this scale past a demo — say 500 properties?**
A: Measured, not guessed: we benchmarked the full compute path at 500
properties — every engine runs in 4–53ms; the real ceiling was DOM size, so
list surfaces render bounded views (top-N by urgency). Compute isn't the
bottleneck for years of growth; the next real work is pagination within
huge properties.
✗ trap: "it's just JavaScript, it scales." Cite the benchmark.

**62. The whole app is one 21k-line file. Seriously?**
A: The glue is monolithic; the logic isn't — money math, reserves,
acquisition, AI surfaces are pure, dependency-injected modules tested in
Node with 15 regression suites. We know exactly what the monolith costs us
(our own review says it first), and extraction continues module by module.
Boring architecture with tests beats a fashionable rewrite mid-traction.
✗ trap: defending the monolith as good. Concede + show the containment.

**63. What breaks first at 10x users?**
A: Nothing exotic — Supabase connection and storage quotas, then the blob-
per-property read path fattening on very large properties. Both have
standard fixes (pooling, pagination, normalized reads we've already begun).
The settlement path scales trivially — XRPL does that part.

**64. Extraction throughput — 500 leases on day one of a pilot?**
A: Async job pipeline with per-file status and retry; the constraint is API
throughput and cost, so bulk onboarding runs as a batched background queue
with a review-queue triage view. That's a pilot-shaped problem we've built
the pieces for.

**65. Multi-region? Offline?**
A: Single region + localStorage mirror for offline resilience of the working
set. Fine for the segment; multi-region is an enterprise conversation.

**66. Per-property wallets at 1,000 properties — key management how?**
A: That's exactly why in-app settlement waits for custody integration —
platform-managed keys via a custodian or user-held via Xaman, never
MainStreet holding a thousand seeds. Destination tags may serve better than
wallet-per-property for routing; the design keeps both open.

**67. What's your uptime story?**
A: Vercel + Supabase managed infra; the app degrades readable (localStorage
mirror) if the DB blips; settlement operations are asynchronous by design.
No SLA promises until there's an SLA customer.

**68. Database — one JSONB blob per property? That's a scaling smell.**
A: Deliberate: the schema iterates fast while normalized tables exist where
queries need them (evidence, audit, reconciliation rows). The blob's
four-hop persistence discipline is documented and tested; fields graduate to
tables when cross-property queries demand it. It's a staged normalization
strategy, not an accident.

**69. Concurrent edits — two accountants, one property?**
A: Generation-guarded saves prevent stale-write clobbering; true multi-user
merge is an enterprise feature we've scoped but not built — single-operator
portfolios are the wedge.

**70. Cost per customer?**
A: Cents: serverless compute, Postgres rows, sub-cent settlements. The only
meaningful variable cost is extraction API calls, front-loaded at
onboarding — and cacheable per document. Gross margin is a software margin.

## H. Competition (71–80)

**71. ★ Prophia (or any AI lease-abstraction startup) adds a CAM module next quarter. Now what?**
A: Abstraction is our input, not our product. The defensible part is the
workflow after extraction — allocation with caps/exclusions, disputes with
audit hashes, tenant statements, reserve draws, on-ledger settlement — all
bound by per-field evidence. A CAM module bolted onto an abstraction tool
starts where we started two years of product ago. And our wedge segment
isn't their enterprise ICP.
✗ trap: dismissing them. Respect + moat specifics.

**72. What does Yardi charge and why are you cheaper AND better here?**
A: Yardi is an ERP sold in five figures with implementation; its CAM module
computes what humans keyed in. We're ~$1k/property/year and we read the
lease ourselves with provenance. Different product category: system of
intelligence vs system of record.

**73. Who's your real competitor?**
A: Excel plus the accountant's forty hours. Beating incumbents' features
matters less than beating the spreadsheet's inertia — that's why the CAM
checkup (find money in their last year) is the sales motion.

**74. What about the CAM audit consultants — do you kill their business?**
A: We move it pre-emptive and landlord-side. Some become channel: a
consultancy running MainStreet does ten audits in the time one took. The
adversarial version of them (tenant-side auditors) becomes our tenant
portal's audience — they get citations instead of stonewalling.

**75. Anyone else doing CRE settlement on-chain?**
A: Tokenized-asset plays and payment rails exist; we've found nobody binding
document-level evidence to stablecoin settlement for an operating workflow.
The combination — not any single piece — is the empty space.

**76. What stops a well-funded copy?**
A: Nothing stops the attempt. The compounding assets are: evidence-first
data structures throughout (architectural, painful to retrofit), workflow
depth (five modules sharing one intelligence layer), the pilot corpus of
real-lease edge cases, and eventually cross-portfolio benchmarks. Speed is
the rest — this codebase ships nine phases with a green gate.

**77. Why won't Ripple just build this?**
A: Ripple builds rails and instruments, not vertical CRE accounting
software; RLUSD needs exactly a thousand of us building the use-case layer.
We're the kind of company their ecosystem exists to enable — that's an
alliance, not a threat.

**78. AppFolio/Buildium serve small landlords already.**
A: Residential-first with thin commercial CAM; no lease intelligence, no
evidence chain. Our beachhead is specifically the commercial owner they
underserve.

**79. What's your pricing power story?**
A: Value-anchored: the product's own recovered-dollars report justifies
renewal and expansion (reserve draws, acquisition reviews are natural
upsells). When your software emails the CFO "found $18k this year," churn is
a strange decision.

**80. If you lose, why did you lose?**
A: Distribution, not product — the risk is sales cycles outlasting runway in
a conservative niche. That's why pilots are designed to produce ROI numbers
fast and why fee managers (one sale, many properties) are the channel bet.
✗ trap: "we won't lose." Naming your true risk is the most senior answer in
this list.

## I. Adoption / GTM (81–90)

**81. ★ Your demo is polished. How much is real versus staged?**
A: Everything you saw computes live from data in the database — the demo
property is seeded data, the engines are the production engines, and the
settlement is a real mainnet transaction you can verify on livenet.xrpl.org
right now, independent of anything I control. The staged part is exactly
one thing: the demo property's leases are fixtures. Upload your own lease
and the same pipeline runs.
✗ trap: any hedging. This answer must be instant and specific.

**82. Who's your first customer and when?**
A: Pilot cohort recruitment is the current phase — targeting 3–5 landlords
in the 5–100 property band, 90-day design partnerships measured on four
numbers. (If you have a name by demo day, say the name.)

**83. What's onboarding friction, truthfully?**
A: Gathering the documents. The software part is drag-and-drop plus a
review pass; the organizational part — finding every lease and amendment —
is real, so pilots start with one property end-to-end in week one, not the
whole portfolio.

**84. How long until a landlord sees value?**
A: The CAM checkup is same-week: re-run last year, show the delta. That
delta is the sales close, the onboarding motivation, and the case study,
all in one artifact.

**85. Do property accountants feel replaced?**
A: They're the power user — we delete their worst week, not their job. The
review queue makes them the human the AI reports to; in demos, accountants
are the ones who lean in.

**86. What's the tenant-side adoption story?**
A: Zero-friction: a portal link on their statement — no account needed
beyond that, statements cited to their lease, disputes filed in two clicks.
Tenant experience is a landlord selling point, not a separate sale.

**87. Churn risk — what makes this sticky?**
A: The evidence corpus. After a year, MainStreet holds the verified,
cited, amendment-aware record of every lease term and every reconciliation
decision — leaving means abandoning your own audit trail.

**88. Seasonality — CAM is annual. Why do they log in monthly?**
A: The Command Center: expirations, disputes, reserve runway, draw
deadlines, acquisition reviews. Reconciliation is the wedge; the daily
briefing is the retention.

**89. International?**
A: Service-charge reconciliation in the UK/EU is the same problem with
different vocabulary — and XRPL settlement is naturally cross-border. Not
before US product-market fit.

**90. What did you cut to be honest for this demo?**
A: The estoppel module is hidden because it's unfinished; in-app payment is
absent because custody isn't solved; nothing on screen is a mock. We
demonstrate what's real — the roadmap is spoken, not clicked.

## J. Technical architecture (91–100)

**91. ★ Sketch the architecture in 30 seconds.**
A: Vanilla-JS client; pure business-logic modules (allocation, reserves,
acquisition, AI surfaces) dependency-injected and Node-tested; Supabase for
auth, Postgres with RLS, and document storage; Vercel serverless proxying
Claude for extraction; XRPL via operator-signed CLI for settlement with a
read-only status API. Evidence — quote, page, confidence — flows through
every layer, ending as a SHA-256 in the payment memo.
✗ trap: rambling. Thirty seconds, five layers, one sentence each.

**92. Why vanilla JS and no framework?**
A: Startup pragmatism: zero build step, zero dependency churn, one file to
deploy, and testability came from module discipline instead of tooling.
The cost is glue verbosity — contained by pure modules — and we'd introduce
a framework only with a team to amortize it.

**93. How do you test money math?**
A: A 15-suite regression gate in Node running the actual engine files —
same code the browser executes — including 182 assertions on the reserve
engine alone, persistence round-trips, and RLS cross-user checks. It's held
green through nine feature phases; a red gate blocks merge.

**94. What was your hardest bug?**
A: A settlement record that vanished on refresh: the field survived three of
the four persistence hops but not the whitelist. We fixed it, then encoded
the lesson — the "four-hop invariant" is now documented, tested, and part of
onboarding docs. Bugs that produce process are the useful kind.

**95. Walk me through what happens the moment I click 'settle.'**
A: Today you don't click — that's deliberate. The app surfaces
"ready to settle"; an operator runs the CLI: hidden-prompt seed, dry-run
build/validate first, then --live signs an RLUSD Payment carrying source tag
and reconciliation hash, submits, waits for validation, records
hash + explorer link back onto the property, and the 6-point verifier
confirms on-ledger. Every step is inspectable; nothing signs on a server.

**96. How does the Evidence Viewer find a quote inside a PDF?**
A: pdf.js text layer + normalization-tolerant quote location; if the match
confidence is low it refuses to highlight and says so — jumping to the page
instead. Honest degradation over confident nonsense, three tiers deep.

**97. What's your deploy pipeline?**
A: Git push → Vercel; regression gate run before merge (discipline, not CI —
CI is literally the top ROI item on our own review). Migrations are
idempotent SQL applied to Supabase. Small-team honest, and we wrote the gap
down before you asked.

**98. What technical debt scares you most?**
A: The manual four-hop persistence whitelist — it's the one place a missed
edit silently loses data. Mitigated by docs + round-trip tests; the real fix
(a declarative field registry) is scoped in our review. Naming your scariest
debt precisely is the point of doing the review.

**99. If you rebuilt from scratch, what changes?**
A: Persistence-field registry from day one, the api/ helpers as a shared lib
instead of copies, and TypeScript for the engines. What stays: evidence-
first data structures, deterministic answer layer, pure-module testing, and
keys-never-on-server. The architecture's bones are the part we got right.

**100. What's the one thing you want us to remember?**
A: The chain: a sentence on page 14 of a lease → a verified field → a
deterministic allocation → a tenant statement with citations → an RLUSD
payment on XRPL whose memo fingerprints the whole thing. Nobody else closes
that loop. That's MainStreet.

---

## The ten killer questions to drill (★)
1, 11, 21, 31, 51, 61, 71, 81, 91, 100 — rehearse until each answer is
under 45 seconds without looking.
