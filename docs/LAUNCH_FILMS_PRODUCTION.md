# MainStreet — Launch Films, Production Package

Two films, one shoot, one data set.

| | **Film 1 — Hero** | **Film 2 — Product Film** |
|---|---|---|
| Placement | `home.html` hero, muted autoplay loop | Behind "Watch MainStreet in Action" |
| Runtime | **12 s**, seamless loop | **40 s**, plays once |
| Sound | **None.** Must work silent, permanently | Music + sound design |
| Job | Stop the scroll. One idea. | Explain the system. Earn the signup. |
| Captions | Carry 100% of meaning | Support the picture |

Brand statement stays **"The verified memory of your property."** — used as
positioning near the end of Film 2. Closing action line: **"Defend every
number."** (recommendation and alternative in §7.)

---

## 1. The verified data set

Everything on screen comes from the demo property **Cascade Commons**
(26,000 sf, 90% occupied, CAM pool **$188,300**). These figures were derived
from the shipping demo configuration and cross-checked against what the product
actually renders.

### Cap enforcement — the spine of both films

| Tenant | SF | Cap | Base | Ceiling | Uncapped share | **Enforced saving** |
|---|---:|---:|---:|---:|---:|---:|
| **Whole Health Market** | 9,200 | 5% | $33,000 | **$34,650** | $66,629 | **$31,979** |
| Summit Coffee & Provisions | 1,800 | 8% | $6,200 | **$6,696** | $13,036 | $6,340 |
| ProActive Physical Therapy | 4,400 | 6% | $13,000 | $13,780 | $31,866 | $18,086 |
| FitZone Athletics | 6,800 | 4% | $24,000 | $24,960 | $49,248 | $24,288 |
| Harbor Nail & Beauty Studio | 1,200 | — | — | — | $8,691 | **no cap on file** |

> **Cross-check that validates the engine:** Summit Coffee's derived ceiling
> ($6,200 × 1.08 = **$6,696**) is exactly the figure the Command Center displays
> as *"$6,696 annual CAM share at risk."* The cap rule
> (`capBase × (1 + capPct/100)`, script.js:8968) is confirmed against the
> shipping render.

**Whole Health Market is the hero shot.** $66,629 → $34,650 is the largest and
most legible catch in the data set, and it needs no exclusion maths to explain.

### Figures the product displays verbatim

| Surface | Value |
|---|---|
| Value identified | **$99,542** |
| Cap enforcement savings | **$75,549** · 4 tenant caps enforced |
| Exclusion savings | $5,145 |
| Unrecovered CAM (vacancy gap) | $18,849 · *10.0% of CAM has no paying tenant* |
| Open dispute exposure | $201 · disputed exposure $6,252 |
| Disputes | Cascade Handyman Services **$6,051** `docs_requested` · ComfortFirst HVAC **$201** `open` |
| Settlement | *Cascade Commons — settled & verified on the XRP Ledger (RLUSD)* + **View Transaction ↗** |
| Portfolio health | Cascade Commons **47/100** · Risk Critical · Occupancy 90% |
| Confidence scores | 94 / 91 / 88 / 96 / 97 ; per-field capPercentage 95, 93, 91, 94 |

**Capture rule:** the table above is what the product rendered at boarding time.
Re-verify against the live render on capture day. If a number has moved, the
film changes — not the number.

### ⚠ One correction to the original storyboard

The first storyboard's extraction scene called for *"one field at lower
confidence, flagged amber for human review."* **That would be fabricated.** Every
confidence score in the demo data is high (88–97); there is no amber field to
film.

The real uncertainty beat — and a better one — is **Harbor Nail & Beauty
Studio**, which has **no CAM cap on file**. The product says so in its own words:

> "The lease is missing a CAM expense cap. Until it's verified, MainStreet can't
> confirm this tenant isn't being overcharged."
> *estimated risk: **unknown***

Software declining to guess is a stronger trust signal than software scoring
itself 78%. Both films use this instead. Confidence chips still appear — they are
real — but they are texture, not the beat.

---

## 2. Shared production bible

**Palette.** Obsidian `#07090C` → panel `#0F1217`. One accent: gold `#C9973A`.
Success green only as the product renders it. Type `#E9EDF2`. Nothing else.

**Typography.** Inter. Caption type is Inter 700, −2% tracking, sentence case.
Product type is never restyled — it is the evidence.

| Context | Min caption size |
|---|---|
| Film 1 (hero, mobile-first) | **64 px** at 1080-wide master |
| Film 2 desktop | 44 px |
| Film 2 mobile re-block | 56 px |

Nothing meaningful renders below **28 px equivalent at 1× phone width**. This
killed legibility in the first storyboard; it is a hard gate now.

**Camera.** 24 mm equivalent. Slow dolly (2–4% scale per scene) and precise
lateral trucks. UI plane tilt ≤1.5°. Focus pulls are real optical pulls.

**Cursor.** The only actor. It moves like someone who knows the software:
direct, no wander, no hunting. Ease-out on arrival, never ease-in-out.

**Transitions.** Match-cuts on a shared element — a figure, a gold accent, a
document edge. No wipes, glitches, or particle dissolves, in either film.

---

## 3. Real UI vs. motion graphics — the boundary

This is the most important table in the package. **Get this wrong and the films
stop being truthful.**

| Element | Source | Why |
|---|---|---|
| CAM allocation table + cap row | **Real UI, screen-recorded** | The numbers must be the product's |
| Evidence Viewer, clause highlight | **Real UI, screen-recorded** | The entire claim of the film |
| Confidence chips | **Real UI** | Real scores; never re-typed |
| "No cap on file / risk: unknown" | **Real UI** | Product's own admission |
| Property timeline feed | **Real UI** | Real events, real stamps |
| Dispute card + status + hash | **Real UI** | Auditability is the point |
| Settlement row + View Transaction | **Real UI** | On-ledger proof |
| Command Center | **Real UI** (`assets/landing/ui-command-center.png` is a clean capture) | Live-computed figures |
| Scanned lease page (macro) | Motion graphics / practical | Texture only, no data |
| Light, dust, lens bloom, vignette | Motion graphics | Atmosphere |
| Camera moves, focus pulls | Post (AE/Blender) over real captures | |
| Caption typography | Motion graphics | |
| End card, logo draw | Motion graphics | |

**Method for UI shots:** capture the real product at 2×, then animate the
capture in After Effects. Do **not** rebuild UI in AE, and do **not** let any
generative tool render an interface.

---

## 4. Fable production notes — read before spending credits

Generative video **cannot render legible interface text or exact numerals
reliably.** It will hallucinate a plausible-looking dashboard with invented
figures. For these two films that is not a quality problem, it is a truthfulness
failure — it breaks the one rule the brief sets.

**Use Fable for, and only for:**

- The scanned-lease macro texture (paper grain, photocopy artefacts, toner edge)
- Light: the slow warm falloff across a dark surface, dust in a beam
- Abstract depth plates for backgrounds behind UI panes
- The end-card ambience behind the logo draw

**Never use Fable for:** any frame containing a number, a UI control, a chart, a
table, a caption, the logo, or the cursor.

**Prompt discipline** for the permitted plates: no interfaces, no text, no
screens, no charts in the prompt at all — ask for material and light only
("close macro, photocopied legal document, toner texture, shallow depth, warm
low-key light from left, no text legible"). Deliver plates as clean loops with
no burned-in motion, so the camera move happens in post where it can be matched
to the UI plates.

**Budget guidance.** Roughly 6–8 seconds of Fable plate material serves both
films. Everything else is screen capture plus After Effects. If a vendor quotes
you mostly-generative delivery for these films, they have misunderstood the
brief.

---

# FILM 1 — Homepage Hero · 12 seconds · muted, looping

**Master:** 1920×1080 and 1080×1350 and 1080×1920, 24 fps, no audio track at
all. Loops seamlessly.

**Its only job:** make a scrolling stranger understand that this software finds
money and proves it. One idea. Three beats.

---

### BEAT 1 — The catch · 0:00–0:04.5

**Frame one is product.** No logo, no title card, no black. The CAM allocation
table for Cascade Commons, already mid-run — rows resolving down the table.
Composition: table fills 80% of frame, slightly right of centre; caption zone
reserved lower-left.

**0:00–0:02** Rows resolve top-down, each locking with a tick of gold. Camera
holds.

**0:02–0:04.5** The **Whole Health Market** row arrives. Its uncapped share
`$66,629` renders — then the cap fires: the figure crosses down to **`$34,650`**
and the enforced delta **`−$31,979`** lands in green beside it. Camera dollies
in 3% on that row alone. Everything else drops a stop in exposure.

**Caption** (in at 0:02.6, holds to 0:04.5):
> **This charge exceeded the lease cap.**

**Motion.** The number crossover is the single most important animation in the
film: `$66,629` → `$34,650` in 500 ms with a hard stop, no bounce, no easing
flourish. It should feel like a gate closing, not a slot machine.

**Grounding.** Cap enforcement engine; figures in §1.

---

### BEAT 2 — The proof · 0:04.5–0:09

**0:04.5** The cursor arrives at `$34,650` and clicks. No hesitation.

**0:05–0:07.5** The Evidence Viewer opens over the table — the real lease, at
the cited page. The camera pushes 4% toward the clause as the **gold highlight
draws itself left-to-right across the cap language in 900 ms.** Table falls out
of focus behind.

**0:07.5–0:09** Hold. The verbatim clause sits beside the number it justifies.
This is the frame the whole film exists to deliver — let it breathe for a full
second and a half with no new motion.

**Caption** (in at 0:06.4):
> **Here's the clause that proves it.**

**Grounding.** The Evidence Viewer resolves an event to *document + page +
supporting language*, and produces a citation **only when real extracted
evidence exists** (`doc-viewer.js`). It cannot fabricate one — which is why this
beat is filmable at all.

---

### BEAT 3 — Verified, and the mark · 0:09–0:12

**0:09–0:10.8** Hard cut to the settlement row: the balance settles in RLUSD,
the green verified state lands, **View Transaction ↗** sits beside it. Locked
camera. One gold accent line under the row.

**Caption** (0:09.2–0:10.8):
> **Settled. Verified on-ledger.**

**0:10.8–0:12** Everything but the gold recedes. The **M** mark draws in one
stroke; **MainStreet** sets beneath it. Hold 0.8 s.

**Loop join.** The final frame's obsidian field matches beat 1's background
exactly, so the cut back to frame one is invisible. **Design the loop, don't
crossfade it** — a dissolve on a hero loop reads as a mistake.

---

### Film 1 caption schedule (the whole narrative, silent)

| In | Out | Caption |
|---|---|---|
| 0:02.6 | 0:04.5 | This charge exceeded the lease cap. |
| 0:06.4 | 0:09.0 | Here's the clause that proves it. |
| 0:09.2 | 0:10.8 | Settled. Verified on-ledger. |

Three lines, 14 words. If a viewer reads only the first, they still understand
the product. That is the test.

---

### Film 1 mobile

- **9:16 is re-blocked, not centre-cropped.** Vertical: table occupies the top
  60%, caption sits in the lower third where a thumb isn't covering it.
- The Evidence Viewer beat in 9:16 crops to **the clause only** — the document
  chrome is thrown away. On a phone the highlight *is* the shot.
- Captions at 64 px minimum on the 1080-wide master.
- No frame requires the viewer to read a table row. The one number that must
  read on a phone is **$34,650**, so it gets its own scale bump in the vertical
  cut.

---

### Film 1 — integration with `home.html`

```html
<video autoplay muted loop playsinline
       poster="assets/landing/hero-poster.png"
       width="1440" height="900">
  <source src="assets/landing/hero-loop.webm" type="video/webm">
  <source src="assets/landing/hero-loop.mp4"  type="video/mp4">
  <img src="assets/landing/ui-command-center.png" alt="…">
</video>
```

- `muted` + `playsinline` are **required** or iOS Safari refuses to autoplay.
- **Budget ≤ 2.5 MB** for the MP4. This sits above the fold; it competes with
  LCP. If it can't be hit at 12 s, cut to 10 s rather than degrade the encode.
- **`prefers-reduced-motion`:** show the poster still, no video. The homepage
  already honours this pattern for its scroll reveals — match it.
- The poster frame should be **beat 2's held clause**, not frame one. If the
  video never plays, the still that remains should still show the proof.

---

# FILM 2 — Product Film · 40 seconds

Behind "Watch MainStreet in Action". Sound on, plays once, viewer chose to be
here. Roughly 70% of the original storyboard survives; the changes are order,
entry point, and ending.

**Master:** 3840×2160, 24 fps, 2.0:1 within 16:9 for desktop; separate 4:5 and
9:16 re-blocks. Music + sound design, no narration.

---

## ACT I — THE CATCH (0:00–0:13)

### S1 · Cold open on the catch · 0:00–0:05

Identical staging to Film 1's beat 1, held slightly longer. Frame one is the
allocation table mid-run. Whole Health Market resolves; the cap fires;
`$66,629 → $34,650`, delta `−$31,979` in green.

**Camera.** Dolly in 3% on the row.
**Text:** *This charge exceeded the lease cap.*
**Music.** Opens on the sub pulse already running at ~92 BPM — the film starts
mid-motion, no ramp-in. Felt piano enters at 0:03.
**Grounding.** §1.

### S2 · The proof — *the merged peak* · 0:05–0:13

The two half-scenes from the original storyboard become **one continuous move**,
which is the central fix from the review.

**0:05–0:06** Cursor clicks `$34,650`.
**0:06–0:09** Evidence Viewer opens at the cited page; gold highlight draws
across the cap clause; camera pushes 4%; table defocuses.
**0:09–0:11** Hold on the verbatim clause beside the number.
**0:11–0:13** Pull back 6% to reveal the clause is one paragraph on one page of a
dense photocopied lease. Fable plate provides the paper texture at the edges of
frame; the centre remains the real captured document.

**Text:** *Here's the clause that proves it.* → (at 0:11.4) *It read 1,800 pages
to find it.*

**Music.** The pulse **stops** at 0:06 as the viewer opens. Silence under the
highlight. Piano returns alone at 0:11 on the pull-back. This silence survives
here — Film 2 is sound-on by choice, so the device works as designed.

**Why this is the peak.** Evidence alone is a feature. Evidence attached to
recovered money is a reason to buy. The original split these across two scenes
and halved both.

---

## ACT II — HOW IT KNOWS (0:13–0:25)

### S3 · Upload · 0:13–0:16

Real drop-zone flow. Files land in sequence with a paper tick each:
`Lease — Whole Health Market.pdf` · `Lease — Summit Coffee & Provisions.pdf` ·
`Q4 Invoices.pdf`. Progress fills gold.

**Text:** *Upload what you already have.*
**Music.** Pulse resumes, ticks land on the beat.
**Grounding.** The shipping cinematic's `upload` scene; real demo documents.

### S4 · Extraction + the honest gap · 0:16–0:21

Fields populate in the review queue — base rent, CAM share, expense cap, term
dates — each with its real confidence chip (94, 91, 96…). Rack focus from source
PDF to extracted field.

Then **Harbor Nail & Beauty Studio**: the cap field resolves to **no cap on
file**, and the product states its own limit —

> *estimated risk: **unknown***

**Camera.** Locked; hold 1.8 s on the unknown state. Do not push in; stillness
reads as candour.
**Text:** *AI reads every term — and says when a document doesn't have one.*
**Music.** Pulse thins to a single note under the unknown state.
**Grounding.** §1 correction. Confidence scoring is real and stays; the
uncertainty beat is the missing cap, which is also real.

### S5 · Reconciliation completing · 0:21–0:25

Pull out from the single row to the whole allocation table resolving across all
five tenants, exclusions applying, the total settling last. Opportunity Center
totals compose: **Cap enforcement $75,549 · 4 tenant caps enforced.**

**Camera.** Slow vertical truck ahead of the resolving rows.
**Text:** *Every charge checked against what the lease permits.*
**Music.** Pulse + piano build; chord suspends, unresolved — it pays off at S8.

---

## ACT III — IT HOLDS UP (0:25–0:36)

### S6 · Property memory · 0:25–0:28

The timeline feed. Real events, real stamps, months compressing into three
seconds: *Q2 invoices imported · Q3 invoices imported · Dispute opened — Whole
Health Market · Q4 invoices imported · CAM reconciliation run · Settlement
completed.*

**Camera.** Locked frame; the content moves. Time flows through a still window.
**Text:** *Everything that happens to the property, remembered.*
**Grounding.** Real emitters (reconciliation, document upload, reserve update,
settlement), each idempotent and subject-tagged.

### S7 · Disputes · 0:28–0:32

The dispute workspace. **Cascade Handyman Services — $6,051** advances
`open` → `docs requested`, timestamped into its history, short hash rendering
beneath. **ComfortFirst HVAC — $201** sits `open` behind it.

**Camera.** Lateral truck following the status progression.
**Text:** *Every decision recorded. Every step auditable.*
**Music.** Low woodwind doubles the piano — the film's most human texture,
because disputes are human.
**Grounding.** Real dispute model (`status`, `history[]`, `hash`); Command
Center copy: *"each decision is recorded with an audit hash."*

### S8 · Settlement · 0:32–0:36

The reconciled balance settles in RLUSD. Transaction row appears with its ledger
hash — **rendered large**, not at UI scale. Green verified state lands with
**View Transaction ↗**.

**Camera.** Dolly in 2%, then full stop for the verified state.
**Text:** *Settled in RLUSD. Verified on the XRP Ledger.*
**Music.** The suspended chord from S5 resolves to its tonic **here**, eleven
seconds later. Settlement is resolution, musically and literally. One low bell —
the film's only bell.
**Grounding.** Real settlement panel and demo settlement state.

---

## ACT IV — SCOPE, BRAND, ACTION (0:36–0:40)

### S9 · Command Center + brand statement · 0:36–0:38.5

Pull back — the film's only retreat — to the whole Command Center. Live totals:
**$99,542 value identified · 4 priorities today.** Executive summary composing at
reading speed. Footnote visible: *Computed live from your portfolio data.*

**Text** (over, as the pull-back completes):
> **The verified memory of your property.**

**Music.** Full theme, widest voicing.

### S10 · End card · 0:38.5–0:40

Obsidian. **M** mark draws in one stroke. Then, alone:

> # Defend every number.

CTA beneath, sized for the player's end frame.

**Music.** Everything exits but one felt-piano note. Cut on room tone, not a
downbeat.

---

## 5. Film 2 pacing map

```
0:00        0:05              0:13      0:16    0:21    0:25  0:28  0:32   0:36  0:40
│  CATCH    │   THE PEAK      │ upload  │ extract│ recon │ time │ disp │ settle│ cmd │
│    S1     │      S2         │   S3    │   S4   │  S5   │  S6  │  S7  │  S8   │S9 S10
   pulse       SILENCE→piano    pulse     thins    build   theme  +winds  TONIC   full→one note
```

Product on screen at **0:00**. Peak at **0:05** instead of 0:27. The problem
setup (1,800 pages) has become a **payoff** at 0:11 rather than a preamble — you
see the catch first, then learn what it took. Strictly stronger.

---

## 6. Mobile — both films

1. **Re-block, never centre-crop.** 9:16 and 4:5 are separate compositions.
2. **Hard legibility gate:** nothing meaningful below 28 px equivalent at 1×
   phone width. In practice this means the settlement hash (S8) and confidence
   chips (S4) must be shot at hero-crop zoom, not UI scale.
3. **Film 1 must survive with no sound, forever.** Film 2 must survive its first
   five seconds muted, because players often start muted even on click.
4. First frame of each vertical cut must be legible as a **static thumbnail** —
   that is what a paused or slow-loading player shows.

---

## 7. The closing line

**Recommendation: keep "Defend every number."**

It is a verb, it names the buyer's actual fear — being challenged by a tenant,
an owner, or an auditor — and it is already the homepage's own language, so film
and page reinforce each other rather than introducing a second vocabulary.

**The one alternative worth testing: "Prove every number."**

*Defend* is reactive — it accepts that you are on the back foot. *Prove* is what
the product actually does: it produces the citation. It also rhymes with the
film's peak, which is literally an act of proof.

My call: ship **Defend**, because it meets the buyer where their anxiety already
is, and anxiety converts. Test **Prove** as the A/B variant on the end card —
it is a one-word change, so it costs nothing to try.

Both are truthful. Do not use anything implying guaranteed recovery amounts,
audit outcomes, or savings percentages — none of that is substantiated.

---

## 8. Deliverables checklist

| Asset | Spec |
|---|---|
| Film 1 master | 1920×1080, 12 s, no audio track |
| Film 1 vertical | 1080×1920, re-blocked |
| Film 1 square | 1080×1350, re-blocked |
| Film 1 web encodes | MP4 (H.264) **≤2.5 MB** + WebM (VP9) |
| Film 1 poster | Beat 2 held clause, PNG, matches first frame dimensions |
| Film 2 master | 3840×2160, 40 s, 2.0:1 in 16:9 |
| Film 2 vertical + square | Re-blocked |
| Film 2 stems | Music, SFX, and UI-sound stems delivered separately |
| Film 2 15 s cutdown | S2 + S8 + end card — the peak and the proof |
| Source project | AE project + all screen captures, so figures can be re-shot when demo data changes |

**Last note for the studio:** if any frame looks better than the product, the
frame is wrong. These films are persuasive because they are literal.
