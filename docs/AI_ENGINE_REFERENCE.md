# MainStreet — AI Engine Reference

The complete reference for every AI capability in MainStreet: what it does, how
it decides, why it can be trusted, and where it deliberately refuses to guess.

**The one-sentence philosophy:** MainStreet's AI is deterministic wherever an
answer must be *correct*, and generative only where a human verifies the output
(document extraction). No LLM sits in any answer path.

---

## 1. The two AI layers

| Layer | Technology | Where | Verified by |
|---|---|---|---|
| **Extraction** (generative) | Claude via server proxy (`api/`) | Lease / mortgage / invoice PDF intake | Human review queue + verbatim-quote evidence + confidence scores |
| **Intelligence** (deterministic) | Pure JS engines + intent registry | Workspace answers, Command Center, Explain Mode, Drafting, narratives | Regression test suites; same input → same output, always |

Extraction is the only place generative AI runs, and its output never becomes
"truth" silently: every extracted field carries a verbatim quote, page number,
and confidence, and flows through the review engine (`verified / needs_review /
incomplete`) before it drives money math.

---

## 2. Intent routing (ai-workspace.js)

The Workspace is **not a chatbot**. A question is routed through:

1. **Follow-up pre-pass** — if the question references the prior answer
   ("which of those…", "draft it", "show me the evidence", "open it", "why?"),
   the Workspace Context (§4) is consulted first and the follow-up intent
   handles it against the carried result set.
2. **Deterministic intent registry** — ~25 intents, each a
   `{id, match(question, ctx, env), handle(question, ctx, env)}` object.
   Matching is keyword/pattern-based, scored, first-best-wins, and fully
   inspectable in source. There is no classifier model.
3. **Fallback intent** — if nothing matches, the answer says so honestly and
   offers real suggestions. It never free-associates.

### Intent inventory

| Intent | Answers | Engines consulted |
|---|---|---|
| `cam_caps` | Which leases have CAM caps, terms, evidence | tenant fieldEvidence scan |
| `audit_rights` | Audit-right clauses across leases | fieldEvidence scan |
| `expirations` | Lease expirations / renewal risk | Selectors, AcquisitionEngine pipeline |
| `tenant_charge` | What a specific tenant owes and why | recon snapshot + allocation results |
| `explain_recon` | Explain a reconciliation line-by-line | ReconciliationExplainer |
| `disputes` | Open/resolved disputes, amounts | dispute records |
| `compare_costs` | Cost/PSF comparisons across properties | Selectors, recon snapshots |
| `recovered_most` | Recovered-revenue ranking | computeRecoveredRevenue |
| `reserve_balances` | Reserve balances, committed vs available | EscrowEngine.computeReserveBalance |
| `reserve_rules` | Reserve terms (rates, floors, conditions) | reserve.evidence fields |
| `draw_ready` | Which draws are ready / what's missing | validateDrawRequest, EscrowReadiness |
| `acquisitions` | Acquisition review status & findings | AcquisitionEngine |
| `settlements` | Settlement status, tx hashes, explorer links | property.settlement records |
| `forecast` | Revenue forecast | computeRevenueForecast |
| `balances` / `rent_roll` | Portfolio balances, rent roll | Selectors |
| `navigation` | "Where do I…" — takes the user there | view registry |
| `lease_terms` | Any lease field with its evidence | fieldEvidence via `_scanEvidence` |
| `knowledge_search` | Free-text scan across all evidence | `_scanEvidence` |
| `explain_property` | Full property briefing | Selectors + all engines |
| `draft_document` | Routes to Drafting Studio with context | DocumentDrafting |
| `followup_filter` / `followup_draft` / `followup_evidence` / `followup_open` / `followup_why` | Operate on the previous result set | Workspace Context |
| `fallback` | Honest "I can't answer that" + suggestions | — |

### Adding an intent

```js
window.AIWorkspace.registerIntent({
  id: 'my_intent',
  match(q, ctx, env) { /* return score > 0 to claim */ },
  handle(q, ctx, env) { /* return the standard answer shape */ }
});
```

The standard answer shape:

```js
{ intent, heading, bullets[], paragraphs[], citations[], actions[],
  confidence, trace[], resultSet, context }
```

Anything missing simply doesn't render — no field is required to fake.

---

## 3. Deterministic reasoning

Every answer is assembled from **engine outputs**, not generated text:

- Numbers come from `allocation-engine`, `escrow-reserve-engine`,
  `acquisition-engine`, `selectors`, `computeRecoveredRevenue` — the same
  functions the UI renders from. The Workspace can never disagree with a
  report, because they share one computation.
- Narrative sentences are template-assembled from computed values
  (e.g. `buildReserveNarrative`, `buildReconciliationSummaryNarrative`).
  Phrasing is fixed in source; only the data varies.
- The **reasoning trace** (`trace[]`) records each consultation step
  ("scanned 12 leases", "found 3 with caps", "excluded 1 expired") and renders
  as *How I got this answer* — the audit log of the answer itself.

## 4. Follow-up context (Workspace Context)

`wctx` is deterministic conversation state — **not chat memory, not embeddings**:

- Each answer that produces a list stores a `resultSet`
  (`{kind, ids, label, filters}`).
- Follow-up intents (`followup_*`) operate on that set: filter it further,
  draft from it, open evidence for an item, navigate to an item, or explain
  the reasoning again.
- Context is scoped to the session (`_aiwWctx`), capped, and rebuilt from
  scratch on each answer — no accumulated drift.
- If a follow-up references something not in context, the answer says so
  rather than guessing an antecedent.

## 5. Citations

Every claim that came from a document carries a citation:

```js
{ source, detail, page, quote, fileUrl }
```

- `quote` is **verbatim** from the extraction snapshot — never paraphrased.
- Citations render as chips carrying a `data-evd` payload; clicking one opens
  the Evidence Viewer (§8).
- Citations flow end-to-end: extraction → `fieldEvidence` /
  `reserve.evidence` → answer → draft document → Evidence Viewer.

## 6. Confidence

- **Extraction confidence** is produced at extraction time per field
  (and penalized for the vision path on scanned PDFs), stored with the
  evidence snapshot, and shown wherever the field appears.
- **Answer confidence** is derived, not vibes: full evidence + verified
  fields → high; partial evidence or needs-review fields → medium, with the
  reason stated; missing data → the answer *says what's missing* instead of
  answering anyway.
- **Draft confidence** aggregates the confidence of every input the document
  consumed.

## 7. Explain Mode

"Explain this" on a reconciliation, reserve, recommendation, or property routes
into the same intent registry (`explain_recon`, `explain_property`, …) and
produces the same answer shape — bullets, citations, trace. Explain Mode is not
a separate system; it is the Workspace invoked from context, which is why its
explanations always match the numbers on screen.

## 8. Drafting (document-drafting.js)

Six deterministic document builders (recovery letter, tenant CAM explanation,
lender reimbursement request, dispute response, lease review summary,
acquisition executive summary):

- Assembled from engine outputs and evidence; **no generative text**.
- Anything requiring human judgment is a literal `[bracketed placeholder]` —
  the document refuses to make decisions for the user.
- Insufficient data → `build()` returns `null` and the UI says why. A
  half-fabricated letter is never produced.
- Output is always **DRAFT**-labeled, editable, exported manually — never sent
  automatically.

## 9. Evidence Viewer (evidence-viewer.js)

The proof layer: any citation opens the source PDF at the cited page with the
quote highlighted. Three tiers of **honest degradation**:

1. Evidence panel (quote + page + confidence + reason) — always available.
2. PDF rendered at the cited page — when the file is fetchable.
3. Quote highlight via text-layer location (`locateQuoteInItems`) — when the
   quote can be found *confidently*; low-confidence matches are refused and a
   banner says "jumped to page N; quote could not be located" instead of
   highlighting the wrong text.

## 10. Hallucination avoidance — the design, not a filter

MainStreet doesn't post-filter hallucinations; the architecture makes them
structurally impossible in answer paths:

1. **No LLM in answer paths.** Deterministic code cannot invent facts.
2. **Verbatim-quote evidence.** Extraction must cite the exact document text;
   quotes that can't be located reduce confidence and surface in review.
3. **Human review gate.** Extracted fields drive money math only after the
   review engine passes them.
4. **Null over fabrication.** Drafts return `null`, answers say "I don't have
   that," the viewer refuses uncertain highlights.
5. **Single source of computation.** Answers, reports, and drafts read the
   same engines — no parallel "AI version" of the numbers.

## 11. Known limitations

- Intent matching is keyword-based: heavily rephrased questions can fall to
  the fallback intent (which is honest about it, but still a miss).
- No cross-session memory: Workspace Context resets per session by design.
- English-only intents and documents.
- Extraction quality is bounded by document quality; scanned PDFs route
  through the vision path with penalized confidence.
- The Workspace answers from *persisted, computed* state — it cannot reason
  about hypotheticals ("what if CAM rose 10%?") beyond the forecast intent.
- ~25 intents cover the product's core questions, not open-ended analysis.

(Full product-level limitations: `KNOWN_LIMITATIONS.md`.)

## 12. Extension points

| To add | Do this | Don't do this |
|---|---|---|
| A new question type | `registerIntent(...)` consuming existing engines | Re-derive numbers inside the intent |
| A new document type | One builder + `DOC_TYPES` entry in document-drafting.js | Generative assembly |
| A new evidence source | Emit `{source, detail, page, quote, fileUrl}` citations | A second viewer |
| Voice / LLM paraphrase | Middleware **around** `answer()` (in: transcription, out: rephrase) | LLM inside `answer()` |
| A new recommendation | One builder in command-center.js emitting the standard rec shape | A separate "AI insights" surface |

The invariant to preserve in every extension: **the deterministic core
computes; anything generative sits outside it and is human-verified.**
