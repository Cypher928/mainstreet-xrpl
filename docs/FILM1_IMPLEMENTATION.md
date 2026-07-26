# Film 1 (Homepage Hero) — Implementation Report

_Implementation of `LAUNCH_FILMS_PRODUCTION.md` §Film 1, worked through section
by section. The package was treated as the source of truth; where it conflicts
with the shipping product, the conflict is recorded here rather than papered
over._

---

## Summary

| Package section | Status |
|---|---|
| §1 Verified data set | ✅ **Verified against the engine.** Figures confirmed, one corrected |
| §2 Production bible | ✅ Recorded; binds the studio, no code needed |
| §3 Real UI vs. motion graphics | ✅ **Implemented** — `tools/capture-hero-plates.js` produces the real-UI plates |
| §Beat 1 — the catch | ✅ **Plate captured** from a live reconciliation |
| §Beat 2 — the proof | ⛔ **BLOCKED** — not filmable from the product today. See below |
| §Beat 3 — verified settlement | ✅ **Plate captured** |
| §Caption schedule | ✅ Recorded; motion-graphics work |
| §Mobile | ✅ Recorded; re-block rules bind the studio |
| §Integration with `home.html` | ⚠️ **Prepared, not activated** — see below |
| §Deliverables checklist | ⚠️ Video encodes require a motion studio |

---

## ⛔ Conflict 1 — Beat 2 cannot be filmed from the product (blocking)

**The package says:** the cursor clicks `$34,650`, the Evidence Viewer opens the
real lease at the cited page, and a gold highlight draws across the cap clause.
This is the frame the entire film exists to deliver.

**What the product does:** nothing opens. Verified empirically against a live
demo render — for every one of the five demo tenants:

```
EvidenceViewer.fromTenantField(prop, tenant, ['cap','cam_cap','capPercentage'])
  → null      (all 5 tenants)

tenant.fieldEvidence  → {}     (all 5 tenants)
tenant.leaseUrl       → null   (all 5 tenants)
```

`fromTenantField()` requires `fieldEvidence[key].snapshots[]` carrying a `quote`
or a `page`, and `open()` early-returns unless a citation has one of
`quote | page | fileUrl`. The demo property seeds none of these, and no demo
tenant has a lease PDF. **The Evidence Viewer cannot be opened on a cap clause
for the demo property.**

This is working as designed. The architecture deliberately returns `null` rather
than inventing a citation — the same property that makes the frame worth filming
is what makes it unfilmable against seeded data.

### Why this cannot be fixed by seeding a quote

Writing a `quote` into `fieldEvidence` would make the viewer display extracted
lease language for a lease document that does not exist. That is a fabricated
citation rendered as a real one — precisely the failure mode the Evidence Viewer
was built to prevent, and a direct violation of the package's grounding rule.
**Do not do this.**

### Smallest changes that unblock it, in order of preference

1. **Add one real demo lease PDF (recommended).** Author an actual lease
   document for Whole Health Market containing genuine 5% CAM cap language, put
   it through the normal ingestion path, and let extraction populate
   `fieldEvidence.cap` and `leaseUrl` the way it does in production. The film
   then shoots against the real pipeline, and the demo property gains the
   ability to prove its own headline claim — arguably a product gap worth
   closing regardless of the film.
2. **Shoot beat 2 against a pilot lease.** Film the Evidence Viewer on a real
   uploaded lease (Christy's, with written permission), with tenant-identifying
   detail cropped or blurred.
3. **Re-cut beat 2** to something the demo can prove today. Weakest option — it
   removes the film's reason to exist.

**Until one of these is done, Film 1 cannot be completed.** Beats 1 and 3 are
ready; beat 2 is the middle 40% of the runtime and the entire argument.

---

## ⚠️ Conflict 2 — the `$66,629 → $34,650` crossover is not on screen

**The package says:** "the uncapped share `$66,629` renders — then the cap fires:
the figure crosses down to `$34,650`."

**What the product renders** (`_buildReconciliationSummaryHtml`, script.js:10510):

| TENANT | SQFT | PRO-RATA | CAP ADJ | ALLOCATED |
|---|---|---|---|---|
| Whole Health Market | 9,200 | 35.38% | **−$31,979.23** | **$34,650.00** |

The table shows the **reduction** and the **final allocation**. It never
displays the pre-cap figure. `$66,629` is derivable (`allocated + adjustment`)
but is not a number the product puts on screen.

**Smallest change: drop the crossover; animate what is actually rendered.** The
row resolves, `−$31,979.23` lands in the CAP ADJ column, `$34,650.00` locks in
ALLOCATED, and the `VERIFIED` chip appears. That is a stronger frame anyway —
the reduction is the drama, and it needs no invented intermediate state.

Animating a `$66,629` that the UI never shows would put a motion-graphics number
in a frame the package requires to be real UI.

---

## ✅ Corrections to §1, found by verifying against the engine

Running the real reconciliation confirmed most derived figures and corrected one.

| Tenant | Package said | Engine computes | |
|---|---:|---:|---|
| Whole Health Market | $31,979 | **$31,979.23** | ✅ |
| Summit Coffee & Provisions | $6,340 | **$6,340.15** | ✅ |
| FitZone Athletics | $24,288 | **$24,287.69** | ✅ |
| ProActive Physical Therapy | $18,086 | **$12,941.54** | ❌ **corrected** |
| Total caps applied | $75,549 | **−$75,548.61** | ✅ |

ProActive was wrong in the package because the derivation didn't apply the
tenant's `management` category exclusion before the cap. The engine does. This
is exactly why the package carries a "re-verify against the live render on
capture day" rule — **it earned its keep on the first run.**

The captured `assets/landing/hero-plates.json` records the engine's own figures
alongside each plate so the studio checks captions against the render, not
against a document.

### Two states in this view the studio must frame out

Capturing wider than the allocation table pulls in:

- a red **"Reconciliation variance detected"** banner (the real vacancy gap —
  total billed $88,776.77 vs. pool $188,300.00), and
- a green **"CAM Reconciliation Complete"** toast that overlaps a button.

Both are truthful product states and neither belongs in a marketing hero. The
plate is framed on the table for this reason.

---

## ✅ What was implemented

### `tools/capture-hero-plates.js` (new)

Produces the real-UI plates from a live render of the demo property, so the
studio animates genuine captures rather than rebuilding the interface — §3 of
the package, enforced in code.

```
node tools/capture-hero-plates.js [--out DIR]
```

Outputs to `assets/landing/`:

| File | Content | Size |
|---|---|---|
| `beat1-cap-catch.png` | Allocation table, Whole Health Market cap row | 641×212 @2× |
| `beat3-settlement.png` | Settlement row, verified on the XRP Ledger | 711×63 @2× |
| `hero-poster.png` | Poster frame for the `<video>` | 641×212 @2× |
| `hero-plates.json` | The engine's computed figures, per run | — |

Notes on how it works, and why:

- It **runs a real reconciliation** (`runAllocation()`) rather than reading a
  stored result. The allocation table is written by a run, not by loading — and
  a live run is literally what beat 1 depicts.
- It strips the localhost-only DEV role switcher, the demo banner, and the
  personalised greeting before every capture. A plate carrying dev chrome is not
  shippable.
- A plate that can't be captured is **reported in the JSON**, not thrown. A
  capture tool that dies halfway leaves you guessing which plates are stale.

### Poster frame — deviation from the package

The package specifies the poster should be **beat 2's held clause**: "if the
video never plays, the still that remains should still show the proof."

Beat 2 is blocked, so the poster is **beat 1's cap catch** instead. It still
shows a real, provable number — the reduction and the allocation — so the
still carries meaning on its own. **Revert the poster to beat 2 once conflict 1
is resolved.**

### `test-hero-video.js` (new)

Guards the hero integration. It asserts the current state honestly — the hero is
still the static screenshot because the film does not exist — and flips to
asserting the full `<video>` contract the moment the assets land, so the swap
cannot ship half-done. It checks `autoplay`/`muted`/`playsinline` (iOS refuses
autoplay without all three), the poster, both encodes, the 2.5 MB budget, and
the `prefers-reduced-motion` still.

---

## ⚠️ §Integration — prepared, not activated

The package's `<video>` block is **not** in `home.html` yet, deliberately.

`hero-loop.mp4` and `hero-loop.webm` do not exist. A `<video>` whose sources all
404 renders an empty box: the inner `<img>` fallback only displays when the
browser lacks `<video>` support, not when the sources fail. Shipping it today
would replace a working hero with a blank rectangle.

**The swap, once the studio delivers.** Replace the hero `<img>` in
`home.html` (line ~283) with:

```html
<video class="hero-film" autoplay muted loop playsinline
       poster="assets/landing/hero-poster.png"
       width="1440" height="900"
       aria-label="MainStreet catching a CAM overcharge and showing the lease clause that proves it">
  <source src="assets/landing/hero-loop.webm" type="video/webm">
  <source src="assets/landing/hero-loop.mp4"  type="video/mp4">
  <img src="assets/landing/hero-poster.png" alt="…">
</video>
```

and add:

```css
.hero-film{width:100%;height:auto;display:block}
@media (prefers-reduced-motion: reduce){
  .hero-film{display:none}
  .hero-film-still{display:block}
}
```

`test-hero-video.js` will detect the `<video>` and enforce the rest of the
contract automatically.

---

## Cannot be implemented here

| Item | Why |
|---|---|
| `hero-loop.mp4` / `.webm` | Requires a motion studio: camera moves, number animation, highlight draw, typography, grade. No `ffmpeg` in this environment |
| 9:16 and 1:1 re-blocks | Motion design |
| Beat 2 plate | Blocked by conflict 1 |
| Fable atmosphere plates | External tool, and scoped to texture/light only |

---

## Recommended order from here

1. **Decide conflict 1.** Nothing else about Film 1 can finish until beat 2 can
   be shot. Option 1 (one real demo lease) also closes a genuine product gap.
2. Apply conflict 2's fix to the package (drop the crossover) before the studio
   boards beat 1.
3. Re-run `tools/capture-hero-plates.js` on capture day; treat
   `hero-plates.json` as the caption source of truth.
4. Commission the film. Swap in the `<video>`; `test-hero-video.js` gates it.
