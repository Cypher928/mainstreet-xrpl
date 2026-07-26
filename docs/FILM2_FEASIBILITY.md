# Film 2 — Scene Feasibility Report

_Package #2, step one: probe every scene against the shipping product before
boarding or building anything. This is the check Package #1 taught us to run
first — it found two blockers there, and it has found three here._

**Status: paused for a decision on three conflicts.** Nothing has been built.

---

## Scene-by-scene

| Scene | Surface | Capturable? |
|---|---|---|
| S1 · Cold open — the catch | CAM allocation table, cap row | ✅ **Proven** (Package #1 plate) |
| S2 · The proof (merged peak) | Evidence Viewer on §6.4 | ⏸ **Pending ingestion** — the known Package #1 step |
| S3 · Upload | Drop zone | ⚠️ **Needs the right view** — see below |
| S4 · Extraction + honest gap | Review queue / Command Center | ⚠️ **Conflict 1** — wrong surface in the package |
| S5 · Reconciliation completing | Allocation table + Opportunity Center | ✅ **Proven** |
| S6 · Property memory | Property Timeline | ✅ **Renders — 20 events** |
| S7 · Disputes | Dispute workspace | ⛔ **Conflict 2** — the hash does not exist |
| S8 · Settlement | Settlement row + View Transaction | ✅ **Proven** (Package #1 plate) |
| S9 · Command Center | Command Center | ✅ **Proven** |
| S10 · End card | Motion graphics | n/a |

Six of ten scenes are confirmed capturable. One is the already-documented,
already-approved ingestion step. Three need a decision.

---

## ⛔ Conflict 2 — the dispute hash does not exist (most serious)

**The package says** (S7): "…timestamped into its history, short hash rendering
beneath… `open` → `docs requested` → `resolved`."

**What the product does.** Three separate problems:

1. **The dispute card renders no hash.** The card markup (script.js:11969) uses
   `d.id`, `d.tenantName`, `d.vendor`, `d.category`, `d.tenantShare`, `d.reason`
   and `d.timestamp`. There is no hash on it, and no status-progression
   animation — a card shows one status, it does not advance on screen.

2. **The hash lives somewhere else entirely** — inside the **Dispute Packet**'s
   Evidence Index (`generateDisputePacket()`, script.js:14757), as one row of a
   provenance table.

3. **The demo has no hash to show.** Both seeded disputes carry `hash: null`.
   The product is explicit about why:

   > Audit fingerprint — *"Generated when the dispute is resolved"*

   So the Evidence Index currently renders it as **"Not attached."**

Filming a hash today would mean inventing one. Same category of error as a
fabricated citation.

### Smallest truthful solution — and it is a better scene

**Film the Dispute Packet's Evidence Index instead of a hash.** It is a real
surface that makes the auditability claim visible far better than a hex string:

| Supporting record | Status | Reference |
|---|---|---|
| Lease clause | On file / Not attached | Cited in this packet |
| Supporting invoice | On file | *n* invoices listed above |
| Calculation basis | On file | Calculation breakdown included |
| Reviewer notes | … | |
| Resolution history | On file | *n* entries logged |
| Audit fingerprint | … | SHA-256 recorded below |

…closing on the product's own line:

> *"Every conclusion in this packet traces to a record above. Items marked
> 'Not attached' are gaps to close before the packet is sent."*

That is the film's thesis stated by the product itself, including its honesty
about gaps — which is stronger than a hash nobody can verify by looking at it.

**If a real hash on screen is wanted**, resolve a dispute through the normal
resolve flow during capture. That generates a genuine hash via the product's own
path — no seeding, no special-case logic — and the Evidence Index then reads
"SHA-256 recorded below". This is the recommended addition, not a requirement.

**Caption stays true either way:** *"Every decision recorded. Every step
auditable."*

---

## ⚠️ Conflict 1 — the honest gap is on a different surface

**The package says** (S4): during extraction, "Harbor Nail & Beauty Studio: the
cap field resolves to **no cap on file**… *estimated risk: unknown*."

**Where it actually renders:** not the extraction or review queue. Those strings
come from `command-center.js:155–159` — they are the **Command Center priority
card**:

> "The lease is missing a CAM expense cap. Until it's verified, MainStreet can't
> confirm this tenant isn't being overcharged."
> *estimated risk: unknown* · `Lease — Harbor Nail & Beauty Studio (NNN, no cap on file)`

**Smallest fix: film it where it lives.** Keep the beat and the caption; stage it
on the Command Center priority card rather than mid-extraction. Costs nothing —
S9 already visits the Command Center, so this is a framing change, not a new
scene.

**Confidence scoring is real and stays.** The review workspace renders
`rw-conf-chip` as High / Medium / Low (script.js:16257–16265). Note every demo
tenant scores High (88–97), so the chips are texture — exactly as Package #1
established. The uncertainty beat is the missing cap, not a low score.

---

## ⚠️ Conflict 3 — the upload surface needs its own view

The drop zone exists in the DOM but measured **0 × 0** on the property workspace:
it is not on that view. S3 is almost certainly capturable, but the capture tool
has to navigate to the upload surface first rather than assuming it is present.

**Not a blocker** — a capture-path question, resolvable when the tool is built.
Recorded so it is not discovered mid-shoot.

---

## Note on S6 — Property Timeline

The timeline renders and reports **20 events**, so the scene is real. My probe's
row selectors returned 0 because the feed does not use the markup I guessed; the
capture tool will need the actual selectors. The content is there.

---

## Recommended decisions

1. **S7 → film the Dispute Packet Evidence Index.** Optionally resolve one
   dispute through the normal flow first so the audit fingerprint is genuinely
   present rather than "Not attached."
2. **S4 → stage the honest gap on the Command Center priority card.** Keep the
   caption; keep the confidence chips as texture.
3. **S3 → treat as a capture-path detail**, resolved when the tool is built.

None of these require new features, demo-only logic, or seeded data. Two of the
three make the film more truthful; the first arguably makes it better.

**Awaiting approval before building.**
