# Pilot UX Review

_Findings from driving the application, not from reading it. Every item below
was measured in a live browser session; where I could not confirm a user path, I
say so._

**Verdict: three items should be fixed before the pilot.** The rest can wait.

---

## Priority 1 — Modal layering, scrolling, focus

### 1.1 The Dispute Packet opens *behind* the Dispute Workspace ⛔ BUG

**Measured.** `#disputeWorkspace` is `z-index: 1060`. `#reportOverlay`, which
renders the packet, is `z-index: 1000`. The "📄 Dispute Packet" button lives
*inside* the workspace (script.js:12227), and `generateDisputePacket()` never
hides it — I checked the whole function body for any reference to
`disputeWorkspace` and there is none.

So the sequence a property manager will actually perform — open a dispute, click
Dispute Packet — renders the packet underneath the panel they clicked from.

**Why it matters.** This is the artefact Christy would send to a tenant or an
auditor. Appearing to do nothing, or flashing something behind the current
panel, reads as broken software at the exact moment the product is meant to look
most authoritative.

**Type:** Bug · **Scope:** Small (raise the overlay above the workspace, or close
the workspace when the packet opens) · **Before pilot.**

### 1.2 Evidence Viewer sits below two other panels ⚠️ LATENT BUG

**Measured z-order:**

| Surface | z-index |
|---|---|
| `#explainPanel` | 9999 |
| `#tenantDetailPanel` | 9998 |
| `#evidenceViewer` | **2500** |
| `#draftingModal`, `#invFileViewer` | 2000 |
| `#disputeWorkspace` | 1060 |
| `#reportOverlay` | 1000 |
| `#allocModal` | 500 |

The Evidence Viewer — the surface the whole product argument rests on — is
**7,499 below** the explain panel and 7,498 below the tenant detail panel. If
either is open when a citation is followed, the evidence renders invisibly
behind it.

**Honest caveat:** I did not confirm a user path that opens both simultaneously.
`EvidenceViewer.explainClause()` closes the viewer before opening the workspace,
which suggests the collision was anticipated in one direction. I am flagging the
ordering itself as the risk, not a reproduced failure.

**Why it matters.** The stack has no deliberate hierarchy — values range from 500
to 9999 with no documented tiers, so the next modal added inherits the problem.

**Type:** Bug (latent) · **Scope:** Small (define three tiers — surface, modal,
critical — and assign) · **Before pilot.**

### 1.3 The page scrolls behind open modals ⛔ UX ISSUE

**Measured.** `document.body` stays `overflow: visible` when the Evidence Viewer
or the report overlay opens. Both were checked; neither locks the background.

**Why it matters.** A property manager reading a lease page in the Evidence
Viewer scrolls with the wheel or trackpad, and the *page behind* moves instead.
When they close the modal they have lost their place in the reconciliation. It
is the single most common "this feels cheap" signal in enterprise software.

Notably the codebase already does this correctly elsewhere — the landing film
sets `document.body.style.overflow = 'hidden'` while it plays. The pattern
exists; it is just not applied to the application's own modals.

**Type:** UX issue · **Scope:** Small (lock on open, restore on close, shared
helper) · **Before pilot.**

### 1.4 Dialog semantics are inconsistent ⚠️ ENHANCEMENT

Only `#evidenceViewer` and `#draftingModal` carry `role="dialog"` +
`aria-modal="true"`. `#reportOverlay`, `#explainPanel`, `#disputeWorkspace`,
`#tenantDetailPanel`, `#invFileViewer` and `#allocModal` carry neither.

Escape-to-close is likewise partial — implemented in the Evidence Viewer and the
landing film; I did not verify it on the others.

**Why it matters.** Keyboard users get trapped; a property manager who hits
Escape out of habit and sees nothing happen learns not to trust the interface.
Less urgent than the three above because a mouse user is unaffected.

**Type:** Enhancement · **Scope:** Medium · **Defer** — unless the pilot has an
accessibility requirement.

---

## Priority 2 — Workflow clarity

### 2.1 The first-run screen does not offer the first step ⛔ UX ISSUE

**Measured.** Signed in with no property, the visible calls to action in the
first viewport are:

> Sign out · ▶ Guided Tour · Portfolio · Go to Portfolio · Start Tour ·
> Terms of Service · Privacy Policy · ✕

**There is no "Add your first property."** The primary action for a brand-new
account is not among the buttons on screen. What is offered is navigation to an
empty portfolio and a tour.

**Why it matters.** This is the first thirty seconds of Christy's experience.
The product's own thesis is that the next action should always be obvious; here,
at the one moment the user has no context at all, the next action is the one
thing missing. A tour explains the product — it does not start the work.

**Type:** UX issue · **Scope:** Small (a primary CTA in the empty state)
· **Before pilot.**

### 2.2 The seven-step arc is not visible as an arc ⚠️ ENHANCEMENT

Property setup → lease upload → invoice upload → reconciliation → review →
statements → settlement is a real, working pipeline, but nothing on screen tells
a first-timer where they are in it or what remains. Each step is discoverable
once you know the product; none announces the next.

The Command Center's "NEXT STEP" pattern already solves this beautifully **for a
populated property**. The gap is the cold-start path before there is anything to
compute priorities from.

**Type:** Enhancement · **Scope:** Medium · **Defer** — 2.1 captures most of the
value for a fraction of the work.

---

## Priority 3 — Loading, empty and waiting states

### 3.1 The audit-rights class of failure is now fixed, but is worth a sweep ⚠️

The AUDIT_RIGHTS check reported "no clause extracted" when the clause was
present and correctly extracted — a confident, wrong, absence claim. That
specific bug is fixed, but it came from a general shape: **a deterministic check
reading a field it does not own.**

I have not audited the other Tier-1 checks (MGMT_FEE_CAP, cap enforcement,
exclusions) for the same pattern.

**Why it matters.** The product's credibility rests on never asserting something
it cannot support. An incorrect "not found" is as damaging as an incorrect
finding — arguably worse, because it looks like diligence.

**Type:** Enhancement (audit) · **Scope:** Medium · **Before pilot** — this is
the one deferred item I would argue hardest for. It is the product's core
promise.

### 3.2 Waiting states not assessed ⚠️

Extraction and AI calls are the longest waits a user will experience, and I
could not exercise them: outbound HTTPS is blocked here, so every `/api/**` call
was stubbed. **I cannot tell you what the product looks like during a 20-second
lease extraction**, which is precisely the moment a first-time user decides
whether it is working.

**Type:** Unknown · **Scope:** Unknown · **Before pilot — needs a human pass on
the pilot**, where the real API latency exists. This is a genuine gap in this
review, not an absence of problems.

---

## Priority 4 — Visual polish

Not separately assessed. The surfaces I captured for the film work
(reconciliation table, Command Center, timeline, evidence index, settlement) are
consistent in spacing, type and colour, and read as one product. I found nothing
that undermines the enterprise impression.

One observation from capture: framing wider than the allocation table pulls in a
red **"Reconciliation variance detected"** banner and a green **"CAM
Reconciliation Complete"** toast that overlaps a button. The banner is truthful
(the real vacancy gap), but a toast overlapping an action is a small polish
defect.

**Type:** UX issue (minor) · **Scope:** Small · **Defer.**

---

## Priority 5 — First-time onboarding

Covered by 2.1 and 2.2. The pipeline works end to end — the film work exercised
every stage against real data — but the **entry** to it is the weak point, not
the stages themselves.

---

## Recommendation

**Before the pilot — four items, all small except one:**

| # | Item | Type | Scope |
|---|---|---|---|
| 1.1 | Dispute Packet renders behind the workspace | Bug | Small |
| 1.3 | Lock background scroll while modals are open | UX | Small |
| 2.1 | Give the empty state a primary "add your first property" action | UX | Small |
| 1.2 | Define z-index tiers and reseat the Evidence Viewer | Bug (latent) | Small |

Together these are roughly one focused session, and they address the three
moments most likely to make Christy hesitate: the first screen, the first modal,
and the artefact she would send to a tenant.

**Strongly recommended, larger:**

- **3.1** — sweep the remaining Tier-1 checks for the field-contract bug class.
  Medium scope; directly protects the product's central claim.
- **3.2** — a human pass over loading and waiting states on the pilot, where real
  API latency exists. I could not do this and it should not be skipped.

**Defer:** 1.4 (dialog semantics), 2.2 (visible pipeline), 4 (toast overlap).

Nothing here is architectural, and nothing requires a new feature.
