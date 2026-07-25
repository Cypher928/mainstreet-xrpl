# MainStreet — Launch Film Storyboard

**Working title:** *The Property That Remembers*
**Runtime:** 60 seconds · **Format:** 3840×2160 (UHD), 24 fps, 2.0:1 letterboxed inside 16:9 · **Audio:** music + sound design only. No narration. No dialogue.

---

## 0. Creative platform

One idea carries the film: **software that can prove what it says.**

Every AI company shows glowing particles and promises magic. MainStreet's difference
is the opposite of magic — every number on screen can be traced to a clause, a page,
a document, a ledger entry. So the film's visual grammar is *the trace itself*: we
follow one dollar amount from a scanned lease all the way to a public blockchain
record, and the camera never cuts away from the chain of evidence.

The emotional progression:

| Act | Feeling | Scenes |
|---|---|---|
| I — Weight | Quiet recognition: "this is my Tuesday." | 1–3 |
| II — Comprehension | Calm competence: the system reads, allocates, explains. | 4–6 |
| III — Memory | Trust deepening: it remembers, it defends, it settles. | 7–9 |
| IV — Command | Elevation: the whole portfolio, understood. | 10–11 |

**Hard rule carried from the brief:** every frame is a real product surface. The
"Grounding" line under each scene names the exact screen in the shipping product
that the motion team must recreate. Nothing is invented; UI may be re-set in the
demo property's data (Cascade Commons) but never fabricated.

---

## 1. Design system for the film

**Palette.** Obsidian field `#07090C` → panel `#0F1217`. One accent: MainStreet
gold `#C9973A`. Success states only ever use the product's own green. White type
`#E9EDF2`. Nothing else. Light behaves like it does in the key art: a low warm
glow that reads as dusk on glass, never neon.

**Typography.** Inter. Two voices only:
- *Statement type* — Inter 700, −2% tracking, sentence case, white; the film's "voice."
- *Product type* — whatever the UI itself renders; never restyled, because the UI is the proof.

Statement lines fade up 300 ms, hold, fade 240 ms. No slides, no typewriter effects.

**Camera.** A single virtual camera on a 24 mm equivalent, moving in slow dolly
pushes (2–4% scale over a scene) and precise lateral trucks. UI is mounted on a
plane with 1.5° max tilt — enough for dimension, never "floating glass" cliché.
Focus is real: shallow depth pulls between document and interface.

**Transitions.** Match-cuts on shared elements — a dollar figure, a gold accent, a
document edge. One element from scene N persists into scene N+1 and becomes its
anchor. No wipes, no glitches, no particle dissolves.

**Sound.** Felt piano and a low sub pulse at ~92 BPM. The pulse is the "heartbeat"
of processing; it thins to silence twice (scenes 6 and 11) — silence is where trust
lands. UI sounds are physical and tiny: paper, a soft tick per ledger row, one
low bell at settlement. Mix mastered −16 LUFS; the film must feel quiet in a keynote hall.

---

## 2. Scene-by-scene

Timecodes are cumulative. Each scene lists: camera, UI motion, on-screen text
(exact), transition out, music, and grounding.

---

### SCENE 1 — Cold open · 0:00–0:04 (4.0 s)

**Frame.** Pure obsidian. Center: one statement line.

**Text.**
> Commercial leases hide money in plain sight.

**Camera.** Locked. The line breathes — 1% scale over 4 s.

**Music.** Room tone, then a single felt-piano note at 0:02.

**Transition.** The final period of the sentence glows gold and expands into the
scan light of Scene 2.

**Grounding.** Statement card; no UI claimed.

---

### SCENE 2 — The document · 0:04–0:09 (5.0 s)

**Frame.** A scanned commercial lease fills the frame — dense, rasterized,
slightly skewed, visibly a photocopy. Extreme close-up on clause text:
*"Tenant's Proportionate Share of Common Area Maintenance costs shall not
increase by more than five percent (5%)…"*

**Camera.** Slow lateral truck across the page, shallow focus; most of the page
is a blur of legalese. It should feel like the 40th page of the day.

**UI motion.** None yet. Paper only.

**Text** (lower third, small):
> 1,800 pages. 5 leases. One building.

**Music.** Second piano note; sub pulse fades in underneath.

**Transition.** The page lifts — becomes a PDF tile falling into Scene 3's drop zone.

**Grounding.** Real ingestion input: scanned/copier PDFs are an explicit supported
path (vision fallback in the ingestion pipeline). The clause echoes the demo
property's real cap terms.

---

### SCENE 3 — Upload · 0:09–0:15 (6.0 s)

**Frame.** The MainStreet upload surface. The drop zone pulses once as files
arrive in sequence, each named tile landing with a paper *tick*:
`Lease — Whole Health Market.pdf` · `Lease — Summit Coffee & Provisions.pdf` ·
`Q4 Invoices.pdf`

**Camera.** Dolly in 3% over the scene, centered on the drop zone.

**UI motion.** The product's real flying-document animation; progress bar fills
left to right in gold.

**Text.**
> Upload what you already have.

**Music.** Pulse establishes. Each file landing is a soft tick on the beat.

**Transition.** The last file's row highlights → match-cut to the same row inside
the extraction queue.

**Grounding.** The shipping cinematic's `upload` scene (`landing-experience.js`),
which recreates the real drop-zone flow. File names are the demo property's actual
documents.

---

### SCENE 4 — Extraction · 0:15–0:21 (6.0 s)

**Frame.** The lease review queue. Fields populate one by one — *Base rent. CAM
share. Expense cap. Exclusions. Term dates.* Each field arrives with a confidence
score. One field — an expense cap — lands at lower confidence and is flagged
amber for human review, and we *hold on that*: the machine showing its
uncertainty is the most trustworthy frame in the act.

**Camera.** Locked, tight on the field column; a rack focus from the source PDF
(left) to the extracted field (right).

**UI motion.** Values type themselves in product type; confidence chips fade in;
the flagged field pulses once, gently.

**Text.**
> AI reads every term. And says so when it isn't sure.

**Music.** Pulse continues; a quiet ascending three-note figure.

**Transition.** The CAM-share percentage (`10.0%`) lifts off the field and
carries into Scene 5 as the anchor element.

**Grounding.** Real extraction + review-gate workflow (`ai` scene in the shipping
cinematic; review queue and confidence scoring in the product; "flagged for
review, never hidden" is existing product copy).

---

### SCENE 5 — Reconciliation · 0:21–0:27 (6.0 s)

**Frame.** The CAM allocation table for Cascade Commons. Rows allocate across
tenants in a cascade; each row resolves with a tick. One row hits its cap and the
enforced amount renders in the product's green with the delta shown. Total line
settles last.

**Camera.** Slow vertical truck down the table, timed so rows resolve just ahead
of the camera.

**UI motion.** The product's real allocation animation — numbers count up in
≤400 ms, then lock. The cap-enforcement row gets 1.5 s of the scene alone.

**Text.**
> Every charge checked against what the lease actually permits.

**Music.** Pulse + piano figure resolve to a suspended chord — held, unresolved,
into Scene 6.

**Transition.** One allocated figure — `$6,696` — scales up slightly under a
cursor hover.

**Grounding.** `recon` scene in the shipping cinematic; cap enforcement is a real
engine feature (demo property: 4 tenant caps enforced, $75,549 cap savings).

---

### SCENE 6 — Evidence · 0:27–0:34 (7.0 s) — *the signature shot*

**Frame.** The cursor clicks `$6,696`. The Evidence Viewer opens: the source
lease at the cited page, the supporting clause highlighted in gold, the verbatim
quote rendered beside the number it justifies.

**Camera.** This is the film's slowest moment. Dolly in 4% toward the highlighted
clause. Everything else falls out of focus.

**UI motion.** Document opens to the exact page (real viewer behavior); the
highlight draws itself across the clause left-to-right in 900 ms.

**Text** (only after the highlight completes; 2 s of quiet first):
> Click any number. See the clause behind it.

**Music.** *Silence.* The pulse stops the moment the document opens. The
suspended chord from Scene 5 hangs in reverb, unaccompanied. This silence is the
film's thesis: proof doesn't need a soundtrack.

**Transition.** The highlighted clause compresses into a citation chip; the chip
drops downward into a feed — Scene 7's timeline.

**Grounding.** The Evidence Viewer resolves an event to *document + page + the
supporting language* (`doc-viewer.js`), and citations appear **only when real
extracted evidence exists** — the product never fabricates one. That honesty is
why the scene can exist.

---

### SCENE 7 — Property memory · 0:34–0:39 (5.0 s)

**Frame.** The property timeline. Events accrue in chronological order, each
stamped and attributed: *Q3 invoices imported · CAM reconciliation run · Document
uploaded — Roof warranty · Reserve updated · Dispute opened — Whole Health
Market.* The feed scrolls slowly as months compress into seconds.

**Camera.** Locked frame; the *content* moves — time flows through a still window.

**UI motion.** Rows arrive top-down with the product's real feed styling; date
stamps advance visibly (Jul 7 → Jul 15 → Jul 22 → Jul 24).

**Text.**
> Everything that happens to the property, remembered.

**Music.** Pulse returns, warmer — piano now plays the film's main theme fully
for the first time.

**Transition.** The `Dispute opened` row highlights and expands to fill the frame.

**Grounding.** The property timeline and Recent Activity feed — real event
emitters for reconciliations, document uploads, reserve updates, and settlements,
each idempotent, each carrying its subject. The listed events are the demo
property's actual feed.

---

### SCENE 8 — The dispute · 0:39–0:45 (6.0 s)

**Frame.** The dispute workspace. A tenant dispute card — vendor, amount, tenant
share, reason. Status advances before us: `open` → `docs requested` →
`resolved`, each step timestamped into the card's history with its hash. The
final state shows the resolution note and the evidence attached.

**Camera.** Slight lateral truck following the status progression left-to-right.

**UI motion.** Status chips advance with 600 ms between states; the history rows
stack beneath; a short hash renders in product type under the final state.

**Text.**
> Every decision recorded. Every step auditable.

**Music.** Theme continues; a low woodwind doubles the piano — the film's most
"human" texture, because disputes are human.

**Transition.** The resolved amount match-cuts to the same figure on Scene 9's
settlement line.

**Grounding.** The dispute engine's real shape — `status`, `resolution`,
`history[]`, `hash` per dispute — and the Command Center's shipping copy: *"each
decision is recorded with an audit hash."*

---

### SCENE 9 — Settlement · 0:45–0:51 (6.0 s)

**Frame.** The settlement surface. The reconciled balance settles in RLUSD; a
transaction row appears with its ledger hash; a green verified state lands with
**View Transaction ↗** beside it. For the final second, the frame holds on the
words *publicly verifiable*.

**Camera.** Dolly in 2%, then full stop — locked for the verified state.

**UI motion.** The product's real settlement sequence: amount → transaction →
confirmation. One low bell as the verified state lands (the film's only bell).

**Text.**
> Settled in RLUSD. Verified on the XRP Ledger.

**Music.** The theme resolves — the suspended tension from Scene 5 finally lands
its tonic here, six scenes later. Settlement *is* resolution, musically.

**Transition.** The green verified dot becomes a data point in Scene 10's
portfolio view — the smallest match-cut in the film, one pixel of continuity.

**Grounding.** `settle` and `verify` scenes in the shipping cinematic; the real
settlement panel with **View Transaction ↗** (demo property: *settled & verified
on the XRP Ledger (RLUSD)*).

---

### SCENE 10 — Command · 0:51–0:56 (5.0 s)

**Frame.** Pull back to the AI Command Center, whole. The greeting, the live
totals — **$99,542 value identified · 4 priorities today** — the executive
summary composing itself line by line, the priority cards with their next steps,
the footnote that matters: *Computed live from your portfolio data.*

**Camera.** The film's only pull-*out* — a 6% retreat that reveals the full
surface, mirroring the viewer's own widening understanding.

**UI motion.** The summary types at reading speed; priority cards are already
present (nothing "assembles" — command is a state, not an event).

**Text.**
> Your whole portfolio. Understood.

**Music.** Full theme, widest voicing — piano, sub, strings entering for the
final 3 s.

**Transition.** Everything but the gold fades; the interface recedes into black.

**Grounding.** The AI Command Center as shipped — every figure computed live from
the demo portfolio; the greeting, totals, executive summary, priorities, and
next-step buttons are the real render (see `assets/landing/ui-command-center.png`,
captured from the running product).

---

### SCENE 11 — End frame · 0:56–1:00 (4.0 s)

**Frame.** Obsidian. The gold M mark draws itself in a single stroke.
**MainStreet** sets beneath it. Then the closing line, alone:

**Text.**
> **MainStreet**
> The verified memory of your property.

**Camera.** Locked.

**Music.** Everything exits except one felt-piano note — the same note the film
opened on. Two seconds of near-silence under the final frame. Cut to black on
the room tone, not on a downbeat.

**Grounding.** The closing line is the product's charter — "MainStreet becomes
the verified memory for every commercial property" — not ad copy written for the
film.

---

## 3. Pacing map

```
0:00      0:09      0:15      0:21      0:27       0:34      0:39      0:45      0:51      0:56  1:00
│ weight  │ weight  │ motion  │ motion  │ SILENCE  │ memory  │ human   │ resolve │ command │ mark │
│ S1  S2  │   S3    │   S4    │   S5    │   S6     │   S7    │   S8    │   S9    │  S10    │ S11  │
   piano      +pulse    +figure   suspend    (stop)     theme     +winds    tonic      full     one note
```

Two silences (S6, S11) are load-bearing. Protect them in the mix.

## 4. Production notes for the studio

- **UI is sacred.** Recreate surfaces at 2× from the shipping product against the
  demo property (Cascade Commons). Do not restyle, re-kern, or "improve" the UI.
  If a frame looks better than the product, the frame is wrong.
- **Data continuity.** One dollar figure should be traceable across scenes 5→6
  and 8→9. Use the demo property's real numbers; never invent a figure for
  rhythm.
- **No people, no offices, no stock.** The only "actor" is a cursor, and it
  moves like a person who knows the software: deliberate, no wander.
- **Claims discipline.** Every caption above is either existing product copy or
  describes verified behavior. Marketing may not add captions without a
  grounding line.
- **Deliverables.** 60 s master (2.0:1 in 16:9, UHD, 24 fps); 30 s cutdown (drop
  S2, S8; tighten S3–S5); 15 s teaser (S6 + S9 + end frame — evidence and
  settlement are the film in miniature); 4:5 and 9:16 social crops re-blocked, not
  center-cut. Stems delivered separately for stage playback.

## 5. Why this film is honest

The brief's audience finishes the film believing *"this understands my property
better than any software I've ever used"* — and the reason the belief survives a
demo is that the film never shows anything the demo can't repeat. The 40-second
in-product cinematic already walks upload → extraction → reconciliation →
settlement with recreated UI; this film is that spine, shot with a better camera,
plus the three surfaces that make MainStreet an operating system rather than a
calculator: **evidence, memory, and disputes.**
