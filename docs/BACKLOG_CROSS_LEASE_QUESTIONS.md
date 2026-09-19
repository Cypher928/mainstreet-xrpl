# Backlog — cross-lease questions belong to Portfolio Intelligence

**Status:** agreed direction, not scheduled. The pilot behaviour is correct and
should not be changed to make this land sooner.

---

## What happens today, and why it is right

Ask the Lease answers from **one** lease. Asked "who pays the most rent?", it now
refuses:

> This lease covers a single tenant, so it cannot say which tenant pays the most
> rent. Comparing tenants needs the rent roll for the whole property.

The refusal is not a placeholder for a missing feature — it is the correct answer
from that engine, and it stays correct after the feature below ships. A single
lease genuinely cannot answer a portfolio question, and the engine saying so is
what stops the product citing the nearest pro-rata clause and calling it an
answer. (See `api/_ask-lease-contract.js`; that failure is what the refusal
contract was built for.)

**Do not weaken the refusal to reach this feature.** The routing described below
happens *before* the Lease Review Engine is consulted, not inside it.

---

## Where it should go instead

A cross-lease question should route to **Portfolio Intelligence**, which already
exists: `AcquisitionEngine.computePortfolioIntelligence(props, refDate, preRar)`
(`acquisition-engine.js:906`), used by the dashboard at `script.js:17338` and
`script.js:17780`.

It should:

1. search across every lease in the portfolio,
2. compare the extracted rent schedules,
3. return the highest-paying tenant,
4. **with a citation from each lease it compared** — not just from the winner.

Point 4 is the one that carries the product's claim. "Coastal Outfitters pays
the most" is an assertion; "Coastal Outfitters pays the most, and here is the
rent clause from each of the eleven leases that were compared" is a verified
memory. A ranked answer whose losing entries are uncited is a ranking the user
cannot check.

## What already exists, and what does not

**Exists:** normalized tenants carry `base_rent` as annual dollars
(`acquisition-engine.js:491`, and the comment at :771 confirming the unit), and
the aggregate functions already read it. So the comparison itself is close to
free.

**Does not exist, and is the actual work:**

- **`base_rent` is null when it was not extracted.** Every aggregate that uses it
  today silently skips those tenants — fine for a dashboard average, wrong for
  "who pays the most", where a skipped tenant may be the answer. A ranked result
  must state its own coverage: *"comparing 9 of 11 leases; 2 have no extracted
  rent schedule"*, and name them.
- **No per-lease citation for rent.** The dashboard aggregates numbers; it does
  not keep the clause each number came from. Ranking with citations means
  carrying the evidence through the aggregation, not re-deriving it afterwards.
- **Escalations.** "Pays the most" is ambiguous once leases escalate on different
  schedules — most *this year*, most *at expiry*, most *per square foot*. Pick
  one and say which was used, in the answer.
- **No router.** Something has to decide a question is cross-lease before it
  reaches the single-lease engine. The refusal contract already identifies these
  questions in prose; that judgement needs to move ahead of the dispatch.

## Acceptance, when it is built

- ☐ "Who pays the most rent?" returns a named tenant, not a refusal.
- ☐ The answer cites the rent clause from **every lease compared**, not only the
      winner's.
- ☐ It states how many leases were compared and names any it could not read.
- ☐ It says which basis was used (this year / at expiry / per square foot).
- ☐ Asking the same question of a single lease still refuses — routing decides
      the engine; it does not make the Lease Review Engine answer things it
      cannot.
