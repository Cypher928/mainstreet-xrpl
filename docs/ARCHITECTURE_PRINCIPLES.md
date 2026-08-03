# Architecture Principles

Invariants. Not implementation, not style — the things that stay true across
features, and that a new feature can break without anyone noticing until a
customer does.

Every one was earned by a specific defect. Each carries the shape of its
violation, because recognising the shape is the point: nobody sets out to break
these, they get broken by a change that looks reasonable in isolation.

Related, and deliberately separate:
[PRODUCT_CHARTER.md](./PRODUCT_CHARTER.md) is what the product is for;
[CONTRIBUTING.md](./CONTRIBUTING.md) is how to write code here. This document is
what the system must not stop doing.

---

### 1. The Lease Review Engine never compares multiple leases

One lease, one tenant. Any question requiring two leases is out of scope for it,
no matter how much the text seems to relate.

*Earned by:* "who pays the most rent?" returned a pro-rata allocation clause —
the nearest semantic match, cited, presented as an answer.

*Violation shape:* an answer that is true of some lease but not of the one that
was asked. Cross-lease questions **route** to Portfolio Intelligence before this
engine is consulted; they never make this engine answer more.

*Enforced by:* `test-ask-lease.js` (prompt + parser).

### 2. Every AI answer declares its evidence scope

An answer states what it was derived from, and refusal is a first-class outcome
rather than a phrasing. When an engine cannot answer, it says so **and carries no
citations**.

*Earned by:* the same defect. A refusal wearing a citation spends the product's
entire claim — that every figure traces to a document — on the closest
paragraph.

*Violation shape:* evidence attached to something it does not support. Also: a
scope guarantee that lives only in a prompt. Prompts ask; code guarantees.

*Enforced by:* `test-ask-lease.js`, `test-evidence-honesty.js`.

### 3. Portfolio answers report coverage

An answer computed across many records states how many it actually read, and
names the ones it could not.

*Earned by:* `base_rent` is null when unextracted, and every aggregate silently
skips those tenants. Tolerable for a dashboard average; wrong for "who pays the
most", where the skipped tenant may be the answer.

*Violation shape:* a ranking, total or superlative with no denominator. "9 of 11
leases; 2 have no extracted rent schedule" is an answer. "Coastal Outfitters" on
its own is a guess with good posture.

### 4. Archive is the normal lifecycle

Things stop being active far more often than they stop being real. The default
end state of a property, a lease, a record is archived — removed from active
surfaces, fully intact, restorable.

*Earned by:* the product had only Delete, so the only way to tidy a portfolio was
to destroy years of history.

*Violation shape:* a new object type that ships with a delete action and no
archive. Archived things are also **excluded from every aggregate** — a building
you no longer manage that still moves your occupancy number is a wrong number,
not a preserved memory.

### 5. Delete is exceptional and destructive

Delete exists for mistakes: a duplicate, a wrong address, a test record, a bad
import. It is never the end of something's life.

*Earned by:* `confirmDeleteProperty()` destroyed leases, timelines,
reconciliations and evidence by cascade behind one unconditional modal.

*Violation shape:* Delete presented as the primary action, or a confirmation that
does not name what will be destroyed. Where there is real history the dialog
requires the name typed and **explains why Archive is recommended** — hiding
Delete would be weaker, because it steers instead of informing.

### 6. Every recovery path preserves history

Repairing, superseding or correcting a record never erases what it replaced. The
prior state moves into a history with a reason, and stays readable.

*Earned by:* Space activities were mutated in place; the orphan repair could have
overwritten the conversion it replaced.

*Violation shape:* an in-place overwrite on a user-visible record. Also
`obj.data = {...}` where `Object.assign({}, obj.data, {...})` was meant — that
one line is how an analysis silently disappears.

*Enforced by:* `test-space-activity.js`, `test-acq-orphan-repair.js`,
`test-property-workspace.js`.

### 7. Recovery mechanisms remain even after prevention exists

A repair path is not made redundant by the fix that stops producing the state it
repairs. It becomes the backstop that fix falls back to.

*Earned by:* the orphaned-acquisition repair, kept and frozen while prevention is
built. Concretely: deleting a converted property is two writes to two tables with
no transaction. Ordered delete-then-revert, a failure of the second leaves an
orphan — which the repair path detects. There is no ordering in which nothing can
go wrong; there is only the ordering whose failure is recoverable.

*Violation shape:* removing a recovery path in the same change that adds
prevention. Prevention is best-effort in any system with more than one write.

### 8. Absence of evidence is not evidence of absence

Before the product tells a user that something is missing, gone, or unanswerable,
it must know the lookup actually succeeded. A failed read and an empty result are
different facts, and only one of them is safe to report.

*Earned by:* four surfaces now, which is why it is here rather than in a comment.
`_acqOrphaned()` is gated on `_propsLoadedOk` — without it a failed properties
load makes every converted review look orphaned, and the product announces that
someone's buildings were deleted because the network blipped. The same distinction
is what separates a lease refusal ("this document does not cover that") from a
lookup that never ran; what makes the Evidence Viewer say a citation carries no
page rather than that the page is wrong; and what stops a truncated read being
reported as a complete one.

*Violation shape:* an empty collection read as a deletion. Also `if (!x.length)`
branching straight to a user-facing "none found" with no state saying the fetch
returned. Silence is the correct output until the read is known to have
succeeded — a wrong "it's gone" costs more trust than a slow "loading".

*Enforced by:* `test-acq-orphan-repair.js` (two checks assert silence on a failed
load), `test-ask-lease.js`.

---

## Candidates — proposed, not adopted

Recorded here rather than promoted, so the list above stays the set we actually
hold ourselves to. A candidate is promoted once it has earned its place across
another feature or two — not because it sounds right.

**When the product cannot do something, it names the thing it could not do.**
"Jumped to page 1 — the exact paragraph couldn't be automatically identified"
blamed navigation, which had not failed; the quote was verbatim, and what failed
was mapping it onto a rendered page. *Violation shape:* an error message
describing the symptom's location rather than its cause, and blank fields where
"Not available for this document" is the true statement.

---

## How these hold

Each principle above names the suite that enforces it, and every fix in this
repo is mutation-tested: revert the fix, and its test must fail. A principle
with no failing mutation is decoration.

Two failure modes have cost real time here and are worth naming, because a test
that proves nothing is worse than no test — it reports safety:

- **A test that reimplements the thing it tests.** `test-ask-lease.js` carried a
  hand-maintained "inline replica" of the parser and passed while the shipped
  parser knew nothing about refusals.
- **A test that calls the handler instead of clicking the control.** Restore
  shipped completely dead — a truncated `onclick` attribute compiles to null, so
  clicking ran nothing and nothing could report it. The suite passed throughout,
  because it called `restoreProperty()` directly. Proving a function works says
  nothing about whether a user can reach it. This is the same miss as Archive
  having no entry point, one release earlier.
- **A test that passes vacuously.** The evidence banner test passed on its first
  run by finding no banner at all, because the pdf.js worker was stubbed and the
  code path never ran. Checks that cannot run must **fail**, never skip.

When adding a principle: it needs a defect that produced it, a violation shape a
reviewer can recognise, and a test that fails when it is broken. Otherwise it is
a preference, and belongs in [CONTRIBUTING.md](./CONTRIBUTING.md).
