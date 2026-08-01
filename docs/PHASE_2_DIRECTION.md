# Phase 2 — Build the Product Property Managers Use Every Day

_Phase 1 proved the platform works. Phase 2 makes it indispensable to the
commercial property manager's daily workflow. This document sets how we develop
in Phase 2. It complements [PRODUCT_VISION.md](./PRODUCT_VISION.md) (why we
build) and [BRANCHING_AND_DEPLOYMENT.md](./BRANCHING_AND_DEPLOYMENT.md) (how code
flows)._

---

## The one question

Every Phase 2 decision is filtered through a single question:

> **Does this make a commercial property manager's day easier?**

If the honest answer isn't a clear "yes," it doesn't ship — no matter how
technically interesting it is. We do not add features because we can.

## Where features come from

1. **Real customer feedback** — especially Christy, using it in a real-world workflow.
2. **Workflow improvements** — removing friction from tasks a PM already does.
3. **The long-term vision** — an AI operating system for commercial real estate,
   approached one validated workflow at a time.

## Development model — pilot-first

The pilot is now the **product lab**. All new feature development starts there;
production stays stable and only receives features that have proven themselves.

```
Idea
  ↓
Build in Pilot        (claude/* branch off pilot → merge into pilot)
  ↓
Internal testing
  ↓
Christy tests it in a real-world workflow   (pilot preview URL)
  ↓
Refine based on feedback                    (fast loop, same URL)
  ↓
Promote to main — only when polished        (pilot → main, deliberate)
```

- Production (`main` → mainstreetcam.com) changes only via **critical bug fixes**
  and **deliberate promotions**. It never destabilizes while the pilot moves fast.
- Nothing reaches production until Christy's real-world use says it's ready.

## Phase 2 priorities

In focus order — each evaluated against the one question above:

1. **Property Timeline / Property History** — one chronological, provenance-linked
   record of everything that happened at a property. _(Design ready:
   [designs/PROPERTY_TIMELINE_V1.md](./designs/PROPERTY_TIMELINE_V1.md).)_
2. **Better CAM workflow** — make the core reconciliation loop faster and clearer.
3. **Proactive AI** — assistance that surfaces what needs attention, not only AI
   that answers when asked.
4. **Connected workflows** — modules that flow into each other, not isolated tools.
5. **Explainability & lease-grounded AI** — continued: every figure and answer
   traces to its source document.

## Guardrails

- **Evolution, not a rewrite.** The foundation is solid; we refine and connect,
  we don't tear down. Resist redesigning everything at once.
- **Cohesive, intuitive, indispensable.** The bar for Phase 2 is how the whole
  experience *feels* to a property manager — not feature count.
- **Small, shippable increments.** Each change is a `claude/*` branch off pilot,
  validated, merged to pilot. Promotions to main happen in deliberate batches.
- **Stability is a feature.** Production reliability is non-negotiable while the
  pilot evolves quickly.

---

_Phase 2 is measured not by what we add, but by whether a property manager opens
MainStreet every morning because it makes their job easier._
