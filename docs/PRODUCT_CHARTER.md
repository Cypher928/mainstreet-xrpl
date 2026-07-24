# MainStreet — Product Charter

_The few principles the product must never violate. When a decision is unclear,
this document — with [PRODUCT_VISION.md](./PRODUCT_VISION.md) — is the tie-breaker._

---

## Mission

**MainStreet becomes the verified memory for every commercial property** —
allowing property managers to retrieve any information, understand what happened,
and respond with confidence in **seconds instead of half an hour** searching
emails and files.

This describes the **outcome**, not the technology. Property history, photos,
warranties, documents, reminders, AI-drafted replies — everything fits under this
one job: **making the knowledge about a property instantly accessible and usable.**

## The problem we actually solve

A property manager shouldn't have to remember where something is — or who
remembers it. Today, answering one tenant question ("wasn't the HVAC replaced two
years ago — isn't it under warranty?") means digging through Outlook, a network
drive, invoices, contractor records, warranties, photos, and the lease. Thirty
minutes, five systems, one answer.

**MainStreet is the memory that makes that instant.**

---

## Principle 1 — One system, never five

**No property manager should ever have to search multiple systems to understand a
property.** Everything about a property must be:

- **Connected** — records relate (Property → Suite → work → invoice/warranty/photos/vendor).
- **Searchable** — any fact is retrievable in seconds.
- **Explainable** — every figure and answer traces to its source.
- **Actionable** — the next step (reply, pay, dispute, review) is one click away.
- **Grounded in evidence** — nothing is asserted without its receipt.

## Principle 2 — AI answers from verified memory, never general knowledge

**Every AI response is generated from the property's verified record — the lease,
timeline, invoices, photos, warranties, notes (and, later, connected emails) —
not from a model's general knowledge.** Responses carry citations.

This is the difference between a tool users trust and one they double-check. The
AI isn't valuable because it can write an email — Copilot, Gemini, and ChatGPT all
do that. **MainStreet is valuable because it already knows the property's history
and grounds the response in verified records.** That grounding is the moat.

> Rule for every AI feature we build: if it can't cite the record it read, it
> doesn't answer. No ungrounded generation.

---

## What success looks like (the standard to build toward)

A tenant emails Christy: *"Didn't you replace the HVAC two years ago? Wasn't it
under warranty?"*

She opens **Suite 210.** MainStreet already knows, from the record:
HVAC replaced May 2025 · warranty to May 2030 · installed by ABC Mechanical ·
invoice attached · photos attached · tenant-responsible after year one ·
three service calls since.

She asks: **"Reply to the tenant."** MainStreet drafts a reply **grounded in that
record**, cites the lease (§8.3), and **pre-selects the attachments** — warranty
PDF, invoice, photos, lease section, service history. She reviews, clicks **Send.**

Thirty minutes → thirty seconds. That is the product.

---

## How today's build serves this mission

The Property Operating System work is the substrate this mission requires — we are
building the memory, not bolting on AI:

- **Timeline (the spine)** = the property's memory of what happened.
- **Subjects (Property / Suite / Asset)** = memory organized the way managers think
  ("everything about Suite 210").
- **Attachments (invoice / warranty / photos / docs)** = the receipts, attached to
  the record.
- **Explainability layer (citations, lease refs, confidence)** = why an answer is
  trustworthy.
- **Attention surface (advisor)** = what to do next, prioritized.
- **Capstone (future): grounded AI response** = ask a question or "reply to the
  tenant," and MainStreet answers *from the verified record, with citations and
  attachments pre-selected.* This is the apex the four moves build toward — and it
  is bound by Principle 2.

The mission doesn't change the roadmap. It sharpens why each move matters: every
one makes the property's memory more complete, more connected, and more instantly
usable.
