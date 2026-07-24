# Design — The Connected Property Workspace (Phase 2)

**Status:** Internal build (accumulate toward a cohesive whole; present to Christy
once the overall workflow is polished — not per-increment).
**Branch:** `claude/property-workspace` off `pilot` → merge into `pilot` when the
connected experience is cohesive.
**Purpose:** Make MainStreet *feel* like an AI operating system for a commercial
property — one place where a property manager **sees, understands, and acts** on
everything about a property, connected — without adding disconnected features or
rewriting anything.

---

## The idea in one line

We already have the parts (leases, CAM, reserves, disputes, documents,
settlement, timeline, evidence). Phase 2 makes them feel like **one workspace**
by giving them a **spine** (the Property Timeline), **explainable links**
(everything traces to its source), and a **proactive surface** (what needs
attention) — all by connecting systems that already exist.

## Design principles (unchanged)
- **Reuse over rebuild** — connect existing modules; add no parallel systems.
- **Evolution over rewrite** — the panes stay; we thread them together.
- **Explainability first** — every number/event links to the document or record behind it.
- **Complete workflows** — see → understand → act, without leaving the property.
- **Pilot first** — build here; Christy validates the whole workflow, once, when cohesive.

---

## The spine: the Property Timeline registry

Property Timeline v1 already introduced the event-type **registry** and the
`property.timeline` store. That is the connective tissue: **every workflow event
flows into the timeline, and every timeline event links back to its source.** The
workspace is the timeline made central, surrounded by the panes it points at.

## The four connective moves (ordered build plan)

Each is an increment; together they are the cohesive workspace. All reuse
existing systems.

**1. Timeline as the map — every event is click-through to its source.**
Give timeline rows a "View" action that opens the thing behind them: lease/review
events → the Evidence Viewer (document + page); CAM events → the CAM pane; dispute
events → the dispute; settlement → the on-ledger transaction; documents → the file.
Reuses `EvidenceViewer.open`, `switchWorkspaceTab`, and existing deep-links. This
is explainability + connection in one move.

**2. Complete the event coverage — the real workflows all land on the timeline.**
Emit registered timeline events at the success paths that don't yet log: CAM
reconciliation completed, settlement completed, document uploaded, reserve
updated. One-line `appendPropertyTimelineEvent` additions at existing handlers
(reads results only; never alters settlement/CAM logic). Now the timeline is a
true, complete record — the workspace's memory.

**3. Proactive surface — "What needs your attention."**
A compact panel at the top of the workspace that reads state the app *already
computes* — lease expirations, open disputes, CAM variance, unfunded reserves —
and turns each into an explainable, click-through item ("2 leases expire in 90
days → view"). This is "AI that assists, not just answers," done honestly: no new
model, no predictions — it surfaces and links what MainStreet already knows,
grounded in the source. (Reuses `Selectors.derivePropertyReadiness`,
`derivePropertyTimeline`, existing dispute/CAM/reserve state.)

**4. Cohesive shell — the panes feel like one workspace.**
Consistent property header + cross-pane navigation so overview / CAM / reserves /
reports / documents / timeline read as one operating system, not separate tabs.
Reuses `renderPropertyKpiHeader`, `WORKSPACE_TABS`, `switchWorkspaceTab`; polish
only, no new routes.

---

## What this is NOT
- **Not** new modules, new AI models, or new databases.
- **Not** a redesign of the existing panes.
- **Not** speculative capability — every item connects something a property
  manager already does.

## How Christy's time is used
She validates the **overall workflow** — "can I run a property from this one
screen, and does everything trace to its source?" — not individual components. We
present the connected workspace when moves 1–4 form a polished whole.

## Build order & rollout
1. `claude/property-workspace` off `pilot`.
2. Build moves 1 → 4 internally, each tested (unit + the local Playwright +
   mocked-Supabase harness), accumulating on the branch.
3. When the connected experience is cohesive and polished, merge → `pilot`.
4. Christy validates the whole workflow on the pilot. Her feedback orders what's next.

_The measure of success: a property manager opens the workspace and everything
they need is one screen away and one click from its proof._
