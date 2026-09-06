'use strict';
/**
 * test-regression.js — Orchestrates all regression test suites.
 *
 * Runs each suite as a child process so failures in one don't abort others.
 * Exit code 0 = all suites passed. Non-zero = at least one failure.
 *
 * Run: node test-regression.js
 *      npm run test:regression
 */

const { execSync } = require('child_process');

const SUITES = [
  { label: 'Allocation engine',       cmd: 'node test-allocation.js' },
  { label: 'Tenant dispute pipeline', cmd: 'node test-disputes.js' },
  { label: 'Extraction quality',      cmd: 'node test-extraction.js' },
  { label: 'Invoice dashboard counts',cmd: 'node test-invoices.js'   },
  { label: 'Derived metrics layer',   cmd: 'node test-metrics.js'    },
  { label: 'Property activity timeline', cmd: 'node test-timeline.js' },
  { label: 'Lease intelligence benchmark', cmd: 'node test-benchmark.js' },
  { label: 'Lease review packets',         cmd: 'node test-packets.js'   },
  { label: 'Lease test lab',               cmd: 'node test-testlab.js'   },
  { label: 'Normalized read migration',    cmd: 'node test-normalized-reads.js' },
  { label: 'CAM reconciliation persistence', cmd: 'node test-cam-persistence.js' },
  // When the snapshot blob is missing, the reconciliation is rebuilt from the
  // normalized cam_reconciliations rows — and that rebuild took each tenant's
  // dollar figure from the stored actual_cam while RECOMPUTING its pro-rata
  // share from current square footage. Two numbers from two different moments,
  // printed side by side. The stored pro_rata_percent column had been there
  // since migration 003; the rebuild never read it. Fixed here, ahead of T2,
  // where the same contradiction would have carried a prorated amount.
  { label: 'Rebuilt-record fidelity',        cmd: 'node test-cam-rebuild-fidelity.js' },
  { label: 'Lease document persistence',     cmd: 'node test-lease-persistence.js' },
  { label: 'Ask the Lease API',              cmd: 'node test-ask-lease.js' },
  { label: 'Lease Validation (Phase 23)',    cmd: 'node test-validate-lease.js' },
  { label: 'Escrow & Reserve engine (Phase 21)', cmd: 'node test-reserve-engine.js' },
  // Lease readiness. "Ready for CAM" is a claim about what the reconciliation
  // engine will accept, and this screen has now been wrong in both directions —
  // once counting a lease with no square footage as ready, then once telling
  // the reader two leases could not be reconciled on the run that reconciled
  // them. Nothing covered it either time, which is why both shipped.
  { label: 'Lease CAM readiness',               cmd: 'node test-lease-readiness.js' },
  // Test 3, replayed end to end in a real browser: real sign-in, real
  // runAllocation, real report renderers, real billing gate, real statement.
  // Every defect Test 3 found was a rendering defect that the unit suites were
  // green through, so this one asserts against what is on screen. It is the
  // only registered suite that drives a browser; with no browser available it
  // fails loudly rather than passing, and SKIP_BROWSER_TESTS=1 is the explicit
  // opt-out.
  { label: 'Test 3 workflow replay (e2e)',      cmd: 'node test-e2e-test3.js' },
  // The happy path. Every other e2e suite drives a property with problems,
  // which is where the defects were — and left the most common real case
  // untested. A system tuned only on failure cases cries wolf, so this one is
  // mostly negative assertions: no exceptions, no coverage gap, no manufactured
  // "needs review" on a lease that scores 100, and a statement that issues.
  { label: 'Clean property, happy path (e2e)',  cmd: 'node test-e2e-clean-property.js' },
  // The lease review flow: Needs Review must lead somewhere. A "Mark reviewed"
  // button turned the card green while the CAM blocker stood, and a confirmed
  // property mismatch could never clear Needs Review at all because the status
  // derivation read the raw detector. Both are pinned here, on the real path a
  // person takes rather than on the functions underneath it.
  { label: 'Lease review flow (e2e)',           cmd: 'node test-e2e-lease-review-flow.js' },
  // Where the pool-vs-billed difference went. The banner could state a $63,690.70
  // gap and then close with "Re-check invoice amounts" — advice that was wrong,
  // on a run where every amount was right — and clicking it did nothing. The
  // unit half pins the identity that keeps the panel from inventing arithmetic:
  // every dollar of the gap lands in a named bucket or in a visible residual.
  // ONE interpretation of every number read off a document. Four predicates for
  // "does this lease have square footage?" let a lease with a formatted area
  // vanish from CAM with its card reading "verified"; two parsers for "what is
  // this invoice worth?" let $1,250 be allocated out of a pool that counted it
  // as $0. The load-bearing assertion is the INVARIANT — for every value in a
  // corpus of real extraction output, the eligibility gate and every warning
  // surface must reach the same conclusion.
  { label: 'Source values (sqft + money)',      cmd: 'node test-source-values.js' },
  // Per-tenant billing readiness. billingReadiness branched on property-wide
  // red counts and every tenant statement asked it, so one anchor holding over
  // on a month-to-month made four clean inline tenants unbillable. The model
  // this pins: severity says how alarming a finding is, the Tenant: marker says
  // who it is about, and blocksBilling says whether billing may proceed — three
  // questions that were being answered by one field.
  { label: 'Billing readiness (per tenant)',    cmd: 'node test-billing-readiness.js' },
  // I-12. I-4 answered "can I bill this tenant" correctly and reported it
  // nowhere: the results table's last column read "Calc verified" for every
  // tenant — a statement about the arithmetic — and the only billing signal was
  // a property badge, true of the property and false of the tenants under it. A
  // manager had to generate every statement to find the ones that work. This
  // pins the chip, the roster line, the card button and the refusal all reading
  // ONE derivation; each has at some point been the surface that disagreed.
  { label: 'Tenant billing status (I-12)',      cmd: 'node test-tenant-billing-status.js' },
  { label: 'Variance breakdown',                cmd: 'node test-variance-breakdown.js' },
  // What is IN the CAM pool, defined once. The concentration detector's own
  // sentence said "% of total CAM" and it divided by the gross expense total,
  // so a $70,000 roof the manager had correctly held out of CAM still blocked
  // every tenant on the property — and unticking it, the exact remedy, cleared
  // nothing. Two quantities have to stay distinct here (the gross pool is what
  // the variance panel exists to explain), so the assertions are about which
  // one each surface uses, not about collapsing them into one number.
  { label: 'CAM pool definition',               cmd: 'node test-cam-pool.js' },
  // T1. A lease term and a CAM period are two intervals, and one endpoint was
  // standing in for the overlap: an ordinary expiry inside the period was
  // reported as "a lease that ENDED", past tense about a future date, and
  // blocked — while a lease that COMMENCED inside the period was never tested
  // at all and billed twelve months as "Calc verified". Classification and
  // wording only; the suite pins that no allocation moved and that nothing here
  // apportions, because how a partial period is billed is still an open
  // question and a helper returning a factor would answer it by accident.
  { label: 'Lease term vs CAM period (T1)',     cmd: 'node test-lease-period.js' },
  // WHOSE CAM YEAR IS IT. `_camYear` is a per-USER localStorage preference and
  // selecting a property did not touch it, so a fresh property carrying 2025
  // invoices was reconciled as 2026 — $8,280.00 of a $217,900.00 pool, internally
  // consistent and wrong. The property is authoritative now; this holds it there.
  { label: 'CAM year authority',               cmd: 'node test-cam-year-authority.js' },
  // A SAVED RECONCILIATION MUST COME BACK MEANING THE SAME THING. Every dollar
  // survived a reload and nothing that says what the dollars MEAN did: the Needs
  // Review rollup vanished, the CAM Pool KPI reported the gross invoiced figure,
  // and the variance panel attributed nothing and told the manager to re-check
  // the register on a run that had reconciled to one cent.
  // THE SIGN-IN THE BROWSER SUITES SHARE. Three suites — restore-completeness,
  // partial-basis-persistence and cap-base-persistence — each failed a full run
  // on the same post-click wait and each passed standalone straight after. The
  // cause is mechanical: submitAuth disables the button before it awaits, so an
  // attempt that never resolves leaves a dead control and the retry the
  // surviving copies relied on could not have worked. test-support/e2e-login.js
  // re-enables before retrying and reports the app's own state instead of a bare
  // timeout; this drives it against pages built to fail that way, because a
  // helper exercised only on the happy path proves nothing about a flake.
  { label: 'Shared e2e sign-in helper',        cmd: 'node test-e2e-login-helper.js' },
  { label: 'Restore completeness',             cmd: 'node test-restore-completeness.js' },
  // WHAT THE STATEMENT TELLS A TENANT MUST BE TRUE OF WHAT IT BILLED THEM. A
  // $3,100 lease cap was described as a "rounding adjustment", contradicted two
  // paragraphs later by the statement's own cap note; and a $9,000 invoice that
  // carries no date was billed across six tenants with nothing on any statement
  // to say its CAM year could not be established.
  { label: 'Tenant statement truthfulness',    cmd: 'node test-tenant-statement-truthfulness.js' },
  // THE PRINTED EQUATION MUST MULTIPLY OUT. "$12,500.00 × 33.33% = $1,678.08"
  // was on the charge detail of a tenant who occupied 245 of 365 days: the left
  // side is $4,166.25, the right side is the engine's answer, and the second
  // multiplicand was not on the page. This parses every rendered operand back
  // out of the DOM and asserts the product to the cent, on a fixture where one
  // tenant holds exactly a third of the building so no rounded percentage can
  // reproduce the bill. It also holds the two coverage figures apart — space,
  // and space × time — which one number was doing the work of.
  { label: 'Partial-period explanation',       cmd: 'node test-partial-period-explanation.js' },
  // EVERY CENT HAS AN HONEST ATTRIBUTION, and the panel cannot buy that by
  // moving a tenant's charge. A fully-leased property reported $0.03 of vacancy
  // and a −$0.03 "Not attributed" line, because three tenants at one third each
  // sum to 99.99%; on a larger fixture the same mechanism printed −$1.06 under
  // "Excluded by a lease". This pins the integer-cent identity, the split
  // between a real exclusion and a rounding residue, and — in three independent
  // ways including deep-frozen inputs — that the decomposition never writes to
  // an allocation.
  { label: 'Cent policy and variance separation', cmd: 'node test-cent-policy.js' },
  // A WARNING MUST NAME SOMETHING THAT COULD BE WRONG. `matchConfidence` is a
  // routing signal with three reachable values (0, 75, 90), and two consumers
  // read it as a continuous score: the per-invoice flag fired on `< 75`, which
  // is the definition of a shared invoice, so 16 of 17 charge rows carried "Low
  // confidence invoice match"; the audit detector fired on `> 0 && < 75`, an
  // empty band, so it never fired at all. The real uncertainty is what the
  // matcher discards — a TIE decided by tenant-array order, and a near miss the
  // CAM-4 length guard suppressed. Both are now recorded and reported.
  { label: 'Invoice match confidence (F-14)',   cmd: 'node test-invoice-match-confidence.js' },
  { label: 'Match warnings on screen (e2e)',    cmd: 'node test-e2e-match-warnings.js' },
  // WHOSE NAME IS ON THE CHARGE, AND WHAT COMES BACK WHEN YOU REOPEN THE RUN.
  // Statement charge rows rendered `inv.vendor`, a field the engine's Invoice
  // objects do not have — 17 of 17 rows across four tenants showed a blank
  // vendor on a document a tenant is asked to pay. And the restored result card
  // was a second, thinner renderer that emitted no invoice breakdown at all,
  // though `includedInvoices` restores intact: 36,103 rendered characters became
  // 3,610. One shared builder now serves both cards; the reduced-fidelity
  // disclosure is reserved for a record that genuinely stored no detail, and
  // this pins that it neither fabricates one nor leaves the absence unexplained.
  { label: 'Statement + restore completeness', cmd: 'node test-e2e-statement-restore-completeness.js' },
  // AND WHETHER THE BLOCK ABOVE SURVIVES BEING SAVED. It did not. The tie lives
  // on the invoice register, which is the list _stripBlobs rebuilds from an
  // allow-list on the way to storage — and the allow-list did not name it. So a
  // reconciliation that refused to issue a statement for a $5,000 charge nobody
  // had established, refused it only until the page was reloaded: 1 ambiguous
  // invoice and 2 blocking findings became 0 and 0, and both tied tenants read
  // as billable. This walks the whole chain — register, persisted bytes, a real
  // reload, the audit summary, the exposure gate and generateTenantStatement
  // itself — and requires the restored path to be indistinguishable from the
  // fresh one, without inventing a tie for any invoice that never had one.
  { label: 'Ambiguity survives save/reload',   cmd: 'node test-e2e-ambiguity-persistence.js' },
  // T2. A tenant's CAM share has two independent multiplicands — how much of the
  // BUILDING, and how much of the PERIOD — and the product had only the first,
  // so a tenant who took occupancy on 1 September was billed twelve months. The
  // four things this pins are the four ways it can go wrong: the factor
  // multiplying a DIRECT invoice (a specific charge is not smaller because the
  // tenant arrived late), proRataPercent quietly absorbing the factor, one
  // tenant's unoccupied share being redistributed to the others, and the decimal
  // being stored instead of the rational that replays exactly.
  { label: 'Occupancy allocation (T2)',         cmd: 'node test-occupancy-allocation.js' },
  { label: 'Lease period cases on screen (e2e)', cmd: 'node test-e2e-lease-period.js' },
  // D-2. A manager's confirmation has to survive a reload AS A CONFIRMATION.
  // It did not: the value came back and its provenance did not, so the answer
  // the manager gave read as the lease's own language — the one claim this flow
  // exists to prevent. Four separate save-boundary defects produced it, and the
  // only way to see any of them is a real page load, because every in-session
  // check passes. The last section takes the blob copy away and leaves the
  // evidence row, because the two writes are not one transaction and the state
  // where they disagree is the state that was shipped.
  { label: 'Confirmation survives a reload (e2e)', cmd: 'node test-e2e-partial-basis-persistence.js' },
  // B. The two fields T2's arithmetic will read, followed from the prompt to the
  // resolver with /api/claude intercepted: prompt asks -> normaliser stores ->
  // clause becomes fieldEvidence -> normalizeTenant's ALLOW-LIST keeps it ->
  // obligationTerm() resolves it. Asserting the field name appears in a schema
  // proves none of those five links, and this codebase has broken every one.
  // The negative half matters as much: a lease silent about partial periods
  // must read as source 'default' and never as lease-confirmed.
  { label: 'Lease extraction chain (e2e)',      cmd: 'node test-e2e-lease-extraction.js' },
  // D-3. The recovery panel, which is what a person reaches for when they think
  // their data is wrong. "Rebuild Reconciliation State" called a function that
  // has never existed, so it threw on every property that HAD results to
  // rebuild — the modal closed, nothing happened, and the confirmation never
  // ran, so there was not even a failure to see. The panel above it reported a
  // permanent, always-false integrity ERROR built on a field no reconciliation
  // row carries. This clicks the real button, from a screen deliberately put out
  // of step with the saved record, and checks the dollars that come back.
  { label: 'Rebuild reconciliation state (e2e)', cmd: 'node test-e2e-rebuild-state.js' },
  // D-4. Two renderers write to #resultsBody, and the one a landlord gets when
  // they OPEN a saved reconciliation was two generations behind the one that
  // produced it: no summary panel, no KPIs, no variance banner, no findings, no
  // per-tenant billing chip and no roster — everything that says whether the
  // money on screen may be sent. This compares the fresh screen against the
  // reopened one rather than listing selectors, because a surface the fresh run
  // gains and the restore does not is exactly the defect, and asserts the
  // dollars are identical to the cent: the saved record is reported, not
  // recomputed.
  { label: 'Restored reconciliation surface (e2e)', cmd: 'node test-e2e-restored-surface.js' },
  // The same defect as the loop a manager actually walks: mark the roof not
  // CAM-eligible through the real register checkbox, re-run, and the blocker
  // must clear, the tenants must bill, and the statements must issue — then
  // re-tick it and the blocker must come back, because a deleted detector
  // would pass the first half perfectly.
  { label: 'CAM-eligibility remediation loop (e2e)', cmd: 'node test-e2e-cam-pool-loop.js' },
  // The same thing on screen, plus the blocked statement's Scope column, which
  // printed an em dash against property-level exceptions and matched a tenant
  // whose name appeared as an invoice VENDOR.
  { label: 'Variance flow + exception scope (e2e)', cmd: 'node test-e2e-variance-flow.js' },
  // XRPL/RLUSD settlement configuration. Offline only: it asserts the issuer,
  // currency code, Make Waves source tag and memo payload, and SKIPS (does not
  // fail) the live ledger reads when the network is unreachable — so it is safe
  // in CI and in sandboxes with no egress. It was absent from this list, which
  // is why a missing `xrpl` dependency went unnoticed.
  // The Riverside Commons walkthrough, asserted on RENDERED statements: an
  // anchor holding over, a Gross lease taking shared CAM, three clean tenants
  // that must bill anyway, and a property headline that survives all of it.
  { label: 'Riverside billing readiness (e2e)', cmd: 'node test-e2e-billing-readiness.js' },
  // ────────────────────────────────────────────────────────────────────────
  // BROUGHT IN FROM THE UNREGISTERED PILE.
  //
  // An audit found 74 of 110 test files running nowhere. Two were broken and
  // nobody knew, which is what prompted the audit; the rest of these were
  // passing all along and had simply never been asked. Everything below passed
  // on the audit run and covers real product behaviour, so it is asked now.
  //
  // What stays out — live-credential suites, network suites, the marketing-film
  // contracts, and the ones failing on a diagnosed entry-point drift — is listed
  // with a category and a reason in test-support/coverage-manifest.js, and
  // test-suite-registration.js fails if a test file is in neither place.
  // ────────────────────────────────────────────────────────────────────────
  { label: 'Test accounting (registered vs excluded)',  cmd: 'node test-suite-registration.js' },
  // Which database a LIVE test talks to. Two suites carried the PRODUCTION url
  // and anon key as literals — one read the customer database, the other
  // INSERTED into it — so pilot credentials would have been ignored and the
  // writes would have landed in production. Neither had ever been run, so
  // nothing said so. This pins that the resolver has no undeliberate path to
  // production and no fallback of any kind, and that neither suite can go back
  // to naming a project. Offline: it resolves config and reads source.
  { label: 'Live-test Supabase target (fail-safe)',     cmd: 'node test-supabase-target.js' },
  { label: 'Pilot smoke fixes (guards + labelling)',    cmd: 'node test-smoke-fixes.js' },
  { label: 'Restore/fresh renderer parity',             cmd: 'node test-restore-renderer-parity.js' },
  { label: 'Property mismatch confirmation',            cmd: 'node test-property-confirmation.js' },
  { label: 'Cross-report consistency',                  cmd: 'node test-cross-report.js' },
  { label: 'Cross-report fixture (Test 2)',             cmd: 'node test-cross-report-fixture.js' },
  { label: 'Audit summary self-consistency',            cmd: 'node test-audit-consistency.js' },
  { label: 'Allocation/statement consistency',          cmd: 'node test-allocation-consistency.js' },
  { label: 'CAM exclusions (F-02)',                     cmd: 'node test-cam-exclusions.js' },
  { label: 'Phase 0 remediation (M1a, M5, P1b)',        cmd: 'node test-phase0-remediation.js' },
  { label: 'Acquisition due diligence',                 cmd: 'node test-acquisition.js' },
  { label: 'Acquisition orphan repair',                 cmd: 'node test-acq-orphan-repair.js' },
  { label: 'Escrow reserve extraction',                 cmd: 'node test-escrow.js' },
  { label: 'Demo lease document contract',              cmd: 'node test-demo-lease.js' },
  { label: 'Vercel routing contract',                   cmd: 'node test-routing.js' },
  { label: 'Extraction field preservation',             cmd: 'node test-tenant-field-preservation.js' },
  { label: 'Spaces list refresh after upload',          cmd: 'node test-spaces-refresh.js' },
  { label: 'Security (Part 4)',                         cmd: 'node test-security.js' },
  { label: 'A lease is data, not instructions',         cmd: 'node test-untrusted-lease-text.js' },
  { label: 'Explain prompt control (AI-2)',             cmd: 'node test-explain-prompt-control.js' },
  { label: 'Request limits',                            cmd: 'node test-request-limits.js' },
  { label: 'Evidence honesty',                          cmd: 'node test-evidence-honesty.js' },
  { label: 'AI citation & confidence integrity',        cmd: 'node test-ai-citation-integrity.js' },
  { label: 'PropertyRecord canonical read model',        cmd: 'node test-property-record.js' },
  { label: 'AI reads the canonical record',              cmd: 'node test-ai-property-record.js' },
  { label: 'AI truthfulness & failure handling',         cmd: 'node test-ai-truthfulness.js' },
  { label: 'Evidence persisted as PENDING',             cmd: 'node test-evidence-persistence.js' },
  { label: 'AI confidence surfaces',                    cmd: 'node test-ai-confidence.js' },
  { label: 'Tenant matching on lease upload',           cmd: 'node test-tenant-matching.js' },
  { label: 'Lease job lifecycle',                       cmd: 'node test-lease-job-lifecycle.js' },
  { label: 'Live extraction walk',                      cmd: 'node test-live-extraction-walk.js' },
  // D2 PREREQUISITES. A cap percentage is not a testable statement until you
  // know what it is a percentage OF: $20,000 of a $100,000 pool is 20.0%, and
  // 25.0% against a base excluding the fee from itself. So the base is captured
  // as its own field with its own provenance — lease, manual, default,
  // unrecognised — and a product assumption can never read as a lease term.
  // Every management-fee cap in the pilot dataset predates the field and
  // resolves default/not-stated, which is what keeps a future billing gate off
  // them. No gate is implemented: D2-2 stays unbuilt until this evidence exists.
  { label: 'Management fee cap basis',          cmd: 'node test-admin-fee-basis.js' },
  // AND THE CLAUSE ITSELF. Extraction returned a verbatim quote for every field
  // and normalizeTenant wrote it into a snapshot — then _stripBlobs deleted the
  // blob copy and the evidence row had no column to keep it in. A row is written
  // only when it HAS a quote (script.js:5038), and that was the one thing it
  // could not store. Migration 019 adds the nullable column; this drives the
  // real writer and reader through a save and a reload.
  { label: 'Evidence quote round trip (e2e)',   cmd: 'node test-e2e-evidence-quote.js' },
  // THE HISTORY HAS TO SURVIVE BEING LOADED. saveProperty wrote `timeline` into
  // properties.data on every save and loadPropertyData read it back; nothing in
  // between assigned it. So selectProperty appended sync_restored to an empty
  // array and the next save wrote that array over the record — two manual
  // entries in both stores before a reload, zero in either after the save that
  // followed. Across the pilot: 27 properties, 27 sync_restored events, one
  // each, and not a single manual entry, attachment or lease reference in 91
  // events. The unit suite pins the merge; the e2e suite drives the real app
  // through four reloads and asserts no allocation moved.
  { label: 'Timeline merge',                    cmd: 'node test-timeline-merge.js' },
  { label: 'Timeline persistence (e2e)',        cmd: 'node test-e2e-timeline-persistence.js' },
  // A LABEL MAY NOT OUTRUN ITS EVIDENCE. getFieldConfidence decided "verified"
  // from non-emptiness for `cap` and for the default branch, so a cap typed by
  // hand into a property with no document rendered byte-identically to one read
  // off a 25,824-character lease — and identically again to one carrying a
  // verbatim clause and a page number. Across Pilot, 530 field values asserted a
  // document nothing pointed at while the 52 that could cite one were
  // indistinguishable. The rule was not invented for this: the lender packet's
  // _lenderVerification has always computed it correctly, at tenant granularity.
  { label: 'Field provenance',                  cmd: 'node test-field-provenance.js' },
  { label: 'Cap base provenance',               cmd: 'node test-cap-base-provenance.js' },
  { label: 'Cap base writer',                   cmd: 'node test-cap-base-writer.js' },
  { label: 'Quick-confirm provenance',          cmd: 'node test-quick-confirm-provenance.js' },
  { label: 'Cap base extraction',               cmd: 'node test-cap-base-extraction.js' },
  { label: 'CAM row classification (S5)',       cmd: 'node test-cam-row-classification.js' },
  { label: 'CAM remediation preflight (S5.1)',  cmd: 'node test-cam-remediation-preflight.js' },
  { label: 'Orphan identity lifecycle (S6)',    cmd: 'node test-orphan-identity-lifecycle.js' },
  { label: 'Tenant identity prevention (S6.2)', cmd: 'node test-tenant-identity-prevention.js' },
  { label: 'Tenant normalize extraction (M1a)', cmd: 'node test-tenant-normalize-extraction.js' },
  { label: 'Payment state machine (P1a)',       cmd: 'node test-payment-state-machine.js' },
  { label: 'Payment schema contract (P1a)',     cmd: 'node test-payment-schema-contract.js' },
  { label: 'Server PropertyRecord hydrator (M1b)', cmd: 'node test-property-record-hydrator.js' },
  { label: 'Server runtime harness (M2)',        cmd: 'node test-m2-runtime-harness.js' },
  { label: 'Dependency hardening (M3)',         cmd: 'node test-m3-dependency-hardening.js' },
  { label: 'Read-only MCP capabilities (M4)',   cmd: 'node test-m4-mcp-capabilities.js' },
  { label: 'Property Memory capabilities (M5)', cmd: 'node test-m5-property-memory.js' },
  { label: 'Field provenance (e2e)',            cmd: 'node test-e2e-field-provenance.js' },
  { label: 'Lease validator: management fee cap',       cmd: 'node test-mgmt-fee-cap.js' },
  // D2-1 — AND THE SAME CHECK ON THE PANEL, WITH ARGUMENTS IT DID NOT BUILD.
  // The suite above pins _tier1LeaseChecks against hand-built inputs, and that
  // is how two defects survived it: it fed `category: 'management fee'`, a
  // string the product never writes (every invoice leaves the categoriser as
  // 'management', which no keyword matched), and a `totalExpenses` that happened
  // to equal the sum of its own line items, so the gross-vs-pool denominator was
  // never exercised. This drives runAllocation and the real coordinator, with a
  // $100,000 non-CAM-eligible invoice separating the two denominators: 20% of
  // the pool, 10% of gross, against a 15% cap. It also pins what D2-1 must NOT
  // do — allocations, audit findings and the billing verdict are asserted
  // identical either side of the breach.
  { label: 'Management fee cap on the panel (e2e)',     cmd: 'node test-e2e-mgmt-fee-cap.js' },
  { label: 'Lease validator: audit rights',             cmd: 'node test-audit-rights.js' },
  { label: 'Property workspace',                        cmd: 'node test-property-workspace.js' },
  { label: 'Property lifecycle',                        cmd: 'node test-property-lifecycle.js' },
  { label: 'Space activity',                            cmd: 'node test-space-activity.js' },
  { label: 'Space lease chip (no Invalid Date)',        cmd: 'node test-space-lease-chip.js' },
  { label: 'Dispute lifecycle',                         cmd: 'node test-dispute-lifecycle.js' },
  { label: 'Prior-year CAM base persistence',           cmd: 'node test-cap-base-persistence.js' },
  { label: 'Expected CAM is a dollar ceiling',          cmd: 'node test-cam-expected-variance.js' },
  { label: 'Activity timeline (e2e)',                   cmd: 'node test-e2e-activity-timeline.js' },
  { label: 'Needs Review rollup (e2e)',                 cmd: 'node test-e2e-cam-needs-review.js' },
  { label: 'Inline handlers',                           cmd: 'node test-inline-handlers.js' },
  { label: 'Broken promises (dead controls)',           cmd: 'node test-broken-promises.js' },
  { label: 'First run experience',                      cmd: 'node test-first-run.js' },
  { label: 'First run walkthrough',                     cmd: 'node test-first-run-walkthrough.js' },
  { label: 'Sign-in walkthrough',                       cmd: 'node test-signin-walkthrough.js' },
  { label: 'Pilot readiness',                           cmd: 'node test-pilot-readiness.js' },
  { label: 'Mobile reports',                            cmd: 'node test-mobile-reports.js' },
  { label: 'Mobile sqft input',                         cmd: 'node test-mobile-sqft-input.js' },
  { label: 'XRPL RLUSD settlement config',      cmd: 'node test-rlusd.js' },
];

let anyFailed = false;

console.log('═'.repeat(56));
console.log('  Mainstreet Regression Suite');
console.log('═'.repeat(56));

for (const { label, cmd } of SUITES) {
  console.log(`\n▶  ${label}`);
  console.log('─'.repeat(56));
  try {
    execSync(cmd, { stdio: 'inherit' });
    console.log(`\x1b[32m   ✓ ${label} — passed\x1b[0m`);
  } catch (_) {
    console.error(`\x1b[31m   ✗ ${label} — FAILED\x1b[0m`);
    anyFailed = true;
  }
}

console.log('\n' + '═'.repeat(56));
if (anyFailed) {
  console.error('\x1b[31m  REGRESSION SUITE FAILED — see failures above\x1b[0m');
  console.log('═'.repeat(56));
  process.exit(1);
} else {
  console.log('\x1b[32m  ALL SUITES PASSED\x1b[0m');
  console.log('═'.repeat(56));
}
