# Placeholder / Unfinished-Feature & Credibility Audit

Goal: make MainStreet read as production-ready to a first-time judge — no "coming soon"
cards, no factually false claims, no obvious dead ends.

> **STATUS UPDATE (2026-07-05) — historical audit, partially superseded.** This was a pre-launch
> credibility pass. Since it was written, the **RLUSD mainnet settlement went live** (tx
> `D5F11B5EF7BD9C9BC8062FDA2F6B94BCA1F95DC3417C372548BB5F6082B4D12A`, Payment · Success), the
> production wallet env vars are configured, and the in-app settlement flow renders verified/green.
> Any statements below about "pending funding," "mainnet tx pending," or the testnet anchor being
> the only on-chain proof are **superseded** — see `submission/HACKATHON_SUBMISSION.md` and the
> README's "Live Mainnet Settlement" section for current state.

Scanned: `index.html`, `script.js` (full text), `README.md`, `package.json`, `LICENSE.txt`.

---

## Fixed in this pass

| # | Issue | Where | Fix |
|---|---|---|---|
| 1 | **License contradiction** — `package.json` and README said MIT, but `LICENSE.txt` is proprietary "All Rights Reserved." | `package.json`, `README.md`, `LICENSE.txt` | Resolved toward **proprietary** (the hand-written LICENSE is the deliberate artifact; MIT was boilerplate). `package.json` → `"UNLICENSED"`; README footer/links corrected. **Reversible** — say the word and I'll flip everything to MIT instead. |
| 2 | **Estoppels tab was a pure placeholder** — clicking it showed only "Estoppel certificate generation and tracking is planned for a future update." | `index.html` tab button, `script.js` `WORKSPACE_TABS` | Tab button commented out and `'estoppels'` removed from `WORKSPACE_TABS`, so the tab is gone from the UI. Pane markup left in place (hidden) for easy re-enable. |
| 3 | **README "Security & Privacy" was factually false** — claimed "100% client-side and read-only," documents "never touch a MainStreet server," and the Anthropic key is "used in-browser only." The app now has serverless API routes, a server-side API key, and Supabase auth. | `README.md` | Rewritten to describe the real architecture (server-side secrets, Supabase auth, rate limiting). A judge cross-checking claims against behavior will no longer find a contradiction. |
| 4 | **README "Quick Start" / "No account" was false** — said "Paste your Anthropic API key," "No account," "No data stored." Reality: signup is required (Supabase), the key is server-side, data persists. | `README.md` | Quick Start now matches the real flow: sign up → "Try Live Demo" → seeded Cascade Commons. |
| 5 | **Stale roadmap & tech-stack claims** — RLUSD listed as "(planned)" though it's built; roadmap implied unbuilt phases. | `README.md` | Roadmap/tech-stack updated to current reality; RLUSD shown as built/pending-funding. |
| 6 | **Added a "For Judges" section** at the top of the README with the live link, a 3-minute walkthrough, architecture/code links, and clearly-marked placeholders for the demo video and the real mainnet transaction. | `README.md` | New. |

---

## Verified clean (no action needed)

- **No `coming soon` / `lorem ipsum` / `TBD` / `not implemented` strings** in judge-visible
  copy anywhere in `index.html` or `script.js` (other than the Estoppels card, now hidden).
- The many `:disabled` CSS rules and `placeholder=` input attributes found in the scan are
  normal form/affordance behavior, not unfinished content.

---

## Open items for YOUR live walkthrough (could not verify from the dev environment)

This sandbox is network-blocked from the live URL and from XRPL, so the following need your
incognito walkthrough to confirm — flagging them so they're on your list:

1. **Signup → "Try Live Demo" → seeded property actually works on production.** The code path
   exists (`ensureDemoProperty()` seeds *Cascade Commons*), but it requires a logged-in user
   and a working Supabase connection in prod. Confirm a brand-new account can load the demo
   with no empty states.
2. **The XRPL settlement panel doesn't show an error to a logged-in judge.** Until the wallet
   env vars are set in prod, the panel should show a neutral "not active yet" state, not a red
   500. Confirm it degrades gracefully (the code is written to, but verify in prod).
3. **README model reference.** The old README hard-coded `claude-sonnet-4-20250514`; the server
   default is `claude-sonnet-4-6`. I removed the specific version string from the README rather
   than risk naming the wrong one — no action needed unless you want a specific model named.
4. **`architecture.html` currency.** I linked it from the "For Judges" section but did not audit
   its contents for staleness. Worth a 2-minute skim before submission.

---

## Deliberately NOT changed (and why)

- **The testnet anchor transaction in the README** — kept, but relabeled honestly as a
  development-time / testnet demonstration, with the real mainnet tx marked as pending. Removing
  it would leave zero on-chain proof; misrepresenting it as mainnet would be worse. This is the
  honest middle.
- **The Estoppels pane markup** — left in the HTML (hidden) rather than deleted, so re-enabling
  the feature later is a two-line change. It is fully unreachable by a judge.
