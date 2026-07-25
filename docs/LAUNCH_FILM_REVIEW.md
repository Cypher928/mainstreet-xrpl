# Creative Director Review — MainStreet Launch Film

_Review of `LAUNCH_FILM_STORYBOARD.md` before production. Brutally honest, as
requested. Written against the revised brief: **homepage centerpiece, optimized
for conversion.**_

---

## Verdict

**Do not shoot the 60-second cut as the homepage centerpiece.** The storyboard is
strong work for the brief it was written against — a keynote film — and it is the
wrong artifact for the brief you just gave me. That difference is not cosmetic.
It invalidates the film's emotional spine.

**Browsers autoplay muted.** The entire emotional architecture I designed — two
load-bearing silences, a suspended chord that resolves six scenes later, one bell
at settlement — is *inaudible* to the large majority of homepage viewers. Scene 6,
which I called the signature shot, is seven seconds in which almost nothing moves
except a highlight drawing itself. Its power was supposed to come from the music
stopping. Muted, it is seven slow seconds of a document sitting still.

That is the single most damaging flaw in the storyboard, and it is mine. A film
whose peak depends on a channel that will not play is not a conversion asset.

**The fix is not a rewrite.** It is a re-cut and a re-open. Roughly 70% of the
existing material survives. What has to change is the order, the entry point, the
ending, and the runtime.

---

## The ten questions

### 1. Where does the film become slow?

Four places, totaling **21 of 60 seconds at low information density** — 35% of the
runtime:

| Scene | Length | Problem |
|---|---|---|
| S1 — Cold open | 4.0 s | A typography card. No product, no data, no motion. |
| S2 — The document | 5.0 s | Beautiful, and it is five seconds of paper. |
| S6 — Evidence | 7.0 s | Muted, this is dead air. Its energy was musical. |
| S7 — Timeline | 5.0 s | A scrolling feed is low visual information; rows look alike. |

S1 and S2 are the worst offenders because they are *consecutive*. Nine seconds
elapse before the product appears. On a stage that is patience. On a homepage it
is the whole attention budget.

### 2. Which scene should be the emotional peak?

Right now the peak is **split, which halves it.** I composed for Scene 6
(evidence), but the money moment — cap enforcement catching an overcharge — sits
in Scene 5 as a 1.5-second row. The proof and the payoff are in different scenes.

For this audience they must be **one scene**: the software catches a charge the
human missed, and in the same breath shows the clause that proves it. That is the
peak. Evidence alone is a *feature*. Evidence attached to recovered money is a
*reason to buy*.

Commercial real estate buyer psychology is specific here. A property manager's
recurring nightmare is not "I lack insight." It is "a tenant or an auditor is
going to challenge this number and I will have to go find the lease." The peak
has to resolve that fear on screen.

### 3. Is the first five seconds strong enough?

**No.** It is the weakest part of the film.

Four seconds of a text card on black, and the line — "Commercial leases hide money
in plain sight" — is a *category statement*, not a hook. It tells the viewer what
kind of company this is. It does not make them need to know what happens next.

For a muted autoplay hero, the first frame must carry meaning with no sound and no
prior context. Open on the number, or open on the catch. Not on a sentence.

### 4. Does the product appear soon enough?

**No.** First product surface is 0:09 — 15% of the runtime spent before the thing
you are selling appears. Target for a homepage film is **product on screen by
0:02**, and ideally in frame one.

### 5. Is there a stronger ending than "The verified memory of your property"?

The line is good *positioning* and weak *conversion*. It is a noun phrase. It
describes a category. It asks nothing of the viewer, and it ends the film on an
abstraction after fifty seconds of concrete proof.

Keep it — but move it into the body, over Scene 10, where it describes what the
viewer is currently looking at. End instead on the emotional payoff of everything
shown:

> **Defend every number.**

That is truthful — it is nearly verbatim from the homepage lede ("so you can
defend any figure to a tenant, an owner, or an auditor") — it is a verb, it names
the buyer's actual fear, and it earns the CTA card that follows it.

### 6. Which scenes could be shortened?

| Scene | Now | Proposed | Rationale |
|---|---|---|---|
| S1 Cold open | 4.0 s | **0.0 s** | Fold the line into the new opening over live product. |
| S2 Document | 5.0 s | **2.0 s** | Keep the clause close-up. Lose the lateral truck. |
| S6 Evidence | 7.0 s | merged | Absorbed into the new peak (see Q7). |
| S7 Timeline | 5.0 s | **3.0 s** | Faster scroll, fewer rows, one row highlighted. |
| S8 Dispute | 6.0 s | **4.0 s** | The status progression reads at 600 ms/step; it does not need three. |

### 7. Which scenes deserve more screen time?

- **The catch (new peak).** Currently ~1.5 s inside S5. Give it **7 s** as a
  single merged scene: the row hits its cap, the enforced delta lands, the cursor
  clicks it, the clause opens and highlights. One continuous move.
- **S10 Command Center.** 5 s → **6 s**. This is the "I want that" frame for an
  executive or an investor. It is also the only scene that shows scope rather than
  mechanism. It can hold a beat longer.

### 8. What is missing that would create a genuine "wow"?

Three things. The first two are available today; the third is a limitation you
should know about.

**(a) The catch, staged as a reveal.** Covered above. Right now the most
persuasive thing the product does is a table row.

**(b) Speed, made visible — and we already instrument it.** The film never shows
*time*, which is the thing this buyer feels most. `docs/INGESTION_TELEMETRY.md`
records `pages`, `path`, `outcome`, and `ms` per ingestion. A frame that reads
*"38-page scanned lease · 18 seconds"* against S2's photocopied page would be the
single most visceral moment in the film for someone who currently bills hours to
this work.

**Do not put a number on screen until we query it.** The telemetry exists
precisely so this claim can be made from data instead of estimated. Pull the p50
for `path = 'vision-chunked'` and `path = 'text'` from
`lease_jobs.debug_summary->'ingest'` before the studio boards this frame. If the
data is thin, cut the frame rather than approximating it.

**(c) Scale — and an honest limitation.** Scene 10's copy says "your whole
portfolio," but the demo property is **one building**. On screen that reads
"1 property · 5 leases," which undercuts the word *portfolio* for an owner with
forty assets. Either seed a credible multi-property demo set before shooting, or
change the line to something the frame can support. Do not let the caption write a
cheque the data does not cover.

### 9. What would Apple, Stripe, or Juniper Square do differently?

**Apple** would delete Act I. Apple opens on the object, in motion, always — never
on a problem statement. The product *is* the argument. Cut S1 and most of S2.

**Stripe** would put real numbers on screen inside two seconds and keep the frame
dense. Stripe films are information-rich; this storyboard is information-sparse in
its first third. Stripe would also show the ledger hash bigger, not smaller —
verifiable detail is the brand.

**Linear** would ship it at 30 seconds and cut the problem-setup act entirely.
Linear's discipline is that the viewer already knows the problem; respecting that
is the flattery.

**Juniper Square** would move the trust signal earlier. For institutional CRE, the
on-chain verification is not a closing flourish — it is the credential that makes
everything before it believable. Consider a two-second flash of the verified
settlement state in the first act as a promise, then pay it off in full at S9.

### 10. Truthful-only recommendations

Every change above is grounded in a shipping surface: cap enforcement, the
Evidence Viewer, the timeline, the dispute history and hash, the settlement panel,
the Command Center, and the ingestion telemetry. Two carry explicit conditions:

- The **speed frame** requires querying telemetry first. Not before.
- The **portfolio language** requires either multi-property demo data or a
  narrower caption.

---

## Recommended structure — 40 seconds, homepage cut

Not a rewrite. A re-cut of existing material.

```
0:00  ACT I — THE CATCH (0:00–0:14)
      S-A  0:00–0:03  Product in frame one. A CAM allocation table, mid-run.
                      Rows resolving. One row hits its cap: the enforced
                      delta lands in green.
                      TEXT: "This charge exceeded the lease cap."
      S-B  0:03–0:10  THE PEAK. Cursor clicks the figure. Evidence Viewer
                      opens the lease at the cited page. Clause highlights.
                      TEXT: "MainStreet found the clause that proves it."
      S-C  0:10–0:14  Hard cut to the photocopied page from S2. Pull back:
                      it is one of 1,800.
                      TEXT: "It read every page to find it."
                      [Optional speed frame here — pending telemetry.]

0:14  ACT II — HOW (0:14–0:26)   Compressed originals, unchanged in kind.
      Upload (3 s) → Extraction with the low-confidence flag (5 s)
      → Reconciliation completing (4 s)

0:26  ACT III — IT HOLDS (0:26–0:36)
      Timeline (3 s) → Dispute resolving with its hash (4 s)
      → Settlement verified on-ledger (3 s)

0:36  ACT IV — SCOPE + CTA (0:36–0:40)
      Command Center, pull back.
      TEXT (over): "The verified memory of your property."
      END CARD: "Defend every number."  +  CTA
```

**What this changes.** Product is in frame one instead of at 0:09. The peak moves
from 0:27 to 0:03 and is a single continuous idea instead of two half-scenes. The
problem setup becomes a *payoff* — you see the catch first, then learn it required
reading 1,800 pages, which is far stronger than being told about the pages up
front. The film ends on a verb and a CTA.

**Keep the 60-second cut for the keynote.** The silences, the suspended chord, the
slower evidence scene — all of that works in a dark room with a sound system. Two
cuts, one shoot. Board them together.

---

## Mobile — three practical failures to fix before boarding

1. **2.0:1 letterboxed inside 16:9 is wrong for a phone.** On a 390 px-wide
   viewport that is a stripe. Deliver a re-blocked 9:16 and 4:5, not a centre-crop.
2. **Product type will be illegible.** Confidence chips (S4) and the settlement
   hash (S8/S9) render at UI scale. At 390 px they are sub-pixel. Every frame that
   carries meaning must be shot at hero-crop zoom, with no on-screen text below
   ~28 px equivalent at 1× phone width.
3. **Design muted-first.** Captions carry the entire narrative when sound is off.
   Fewer, larger, longer-held. If a scene only works with music, it does not work.

---

## Two contradictions to resolve before spending anything

**1. "Request a Demo" does not exist on the homepage.** The brief asks the film to
drive a click on "Request a Demo" or "Sign In." The page has *Watch MainStreet in
Action*, *See how it works*, *Watch the demo* (×3), and *Log in* — and the demo
CTA was written that way deliberately, because you rejected "Book a Demo" in the
original brief.

This needs a decision, and the two options pull in opposite directions:

- **Keep it self-serve.** The film ends on *Defend every number* → **Log in** /
  **See it on your own leases**. The film *is* the demo; there is nothing to
  request. This matches what is built.
- **Add a demo request.** Then the CTA has to be added to the page, and the
  original "no Book a Demo" instruction is reversed.

My recommendation is the first. A product that can show itself in forty seconds
should not ask permission to be seen.

**2. Keynote brief vs. homepage brief.** The original brief said "shown on stage
before a keynote." The new one says "homepage centerpiece, optimize for
conversion." Those are different films. Board both cuts from one shoot rather than
compromising into a film that serves neither.

---

## One strategic note

A 60-second film as the homepage *centerpiece* is a heavy ask of a first-time
visitor. The stronger pattern for this page: a **15-second muted loop in the hero**
— the catch, the evidence, the verified settlement, no captions needed — with the
full 40-second cut behind the existing "Watch MainStreet in Action" CTA.

That gives the hero motion and proof without demanding forty seconds from someone
who arrived nine seconds ago, and it costs nothing extra: the loop is three scenes
already in the boards.
