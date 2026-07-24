# Design — The Property Operating System (Phase 2)

**Internal goal name:** the **Property Operating System** — not for marketing, for
design. We build the workspace as the OS for a property, not a connected UI.
**Status:** Internal build (accumulate toward a cohesive whole; present to Christy
once the overall workflow is polished — not per-increment).
**Branch:** `claude/property-workspace` off `pilot` → merge into `pilot` when the
connected experience is cohesive.
**Purpose:** Make MainStreet the place a property manager opens to *run* a
property — see, understand, and act — by connecting systems that already exist.
No disconnected features, no rewrite.

---

## The design filter

Every screen, object, and connection must answer one question:

> **"If I were responsible for this property today, what would I need to know,
> what should I do next, and why?"**

If a screen or a link doesn't help answer that, it doesn't earn its place.

## Permanent principle: reduce cognitive load, not visibility

**The Property Operating System exists to reduce cognitive load, not increase
visibility.** Connecting modules is *not* about exposing more information — it is
about helping a property manager understand **what matters today, why it matters,
and what to do next.**

- Optimize for **prioritization**, not information density.
- If a feature makes the user **think harder**, we've missed the goal.
- If it helps them make a **confident decision faster**, we've succeeded.

This governs every screen — most of all Move #3 (the attention surface): show the
few things that matter, ranked, each with its reason and one clear action. Never
a wall of data.

## Every object answers three questions

The core principle of the Property Operating System. Every important object —
lease, invoice, CAM reconciliation, dispute, payment, reserve item, timeline
event — naturally connects to:

1. **What is it?** — the underlying record or document.
2. **Why does it matter?** — AI explanation, citations, confidence, lease references.
3. **What should I do next?** — the suggested action (pay, dispute, review,
   acknowledge, follow up).

That is the line between software that *stores* information and software that
*helps people work*. These three questions guide navigation, AI explanations, and
every future workflow decision.

## Don't over-connect

Connections must always help answer one of the three questions. A useful link:

> Timeline entry **"Roof replaced"** → invoice · warranty · vendor · photos · lease responsibility

Each of those answers what / why / what-next. Do **not** add links just because
they are technically possible — links everywhere is noise, not an operating system.

## The architecture (how the layers stack)

```
Property
   │
   ▼
Verified Record        Documents + Timeline + CAM + Payments
   │
   ▼
Explainability Layer   Citations + Evidence + Confidence
   │
   ▼
AI Advisor
   │
   ▼
Recommended Action
```

**AI is not the center — the verified record is.** AI sits on top of it, explains
it, and advises the next action. The four moves build this stack: moves 1–2 make
the verified record navigable and complete ("what is it"); the explainability
layer threads through all of them ("why does it matter"); move 3 (attention) is
the advisor surfacing recommended actions ("what should I do next").

---

## The idea in one line

We already have the parts (leases, CAM, reserves, disputes, documents,
settlement, timeline, evidence). Phase 2 makes them feel like **one operating
system** via a **spine** (the Property Timeline), **explainable links**
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
