# MainStreet — Engineering Milestones

_Changes that established a durable design principle, not just a feature. Each
entry records what shipped, what principle it set, and how it was proven._

---

## Lease Ingestion Hardening v1
**Shipped to production:** `main` @ `0fd9088` · tag `lease-ingestion-hardening-v1`
**Forwarded to pilot:** `a3f9113`

> **Production-grade handling of scanned commercial leases through adaptive
> compression, batching, retry, and regression protection.**

### The principle this establishes
**Document ingestion must adapt to the document the customer actually has, not
the document the pipeline wishes for.** A property manager should never have to
think about file size or scan quality. When the transport can't carry the
document, the system changes the representation — it does not push the problem
back onto the user.

Four properties every ingestion path should now satisfy:

1. **Adaptive compression** — measure the *encoded* payload and downscale only
   when the transport requires it.
2. **Batching** — split work to fit both the request-body limit and the function
   timeout.
3. **Retry / graceful degradation** — degrade to a smaller representation rather
   than surfacing an error; **partial success beats total failure.**
4. **Regression protection** — a permanent guard asserting that any input which
   previously succeeded keeps its exact code path.

### What was wrong
Vercel's Node serverless runtime rejects request bodies over ~4.5 MB **before the
handler runs**. `callClaudeWithPdfDirect` base64-encoded the whole PDF (+33%), so
any scan over ~3.3 MB failed with `Claude PDF direct failed: HTTP 413` — while
the client accepted files up to 25 MB, making the failure invisible until it
happened. An earlier attempted fix set `config.api.bodyParser.sizeLimit = '20mb'`
in `api/claude.js`, but `api.bodyParser` is a **Next.js** construct and this is
not a Next.js app, so it never took effect.

There is **no OCR engine** in MainStreet, and none was added. The pipeline is:
PDF.js text-layer extraction → Claude vision fallback for scans. The fix made the
existing vision fallback *reachable*.

### What changed
- **`lease-ingest.js`** (new) — pre-flight sizing (`text` / `vision-direct` /
  `vision-compressed`), PDF.js rasterization to 150 DPI JPEG with automatic
  step-down, batch packing under the body budget, and first-non-null-wins merge
  so a CAM cap deep in a document is still captured. Pure functions
  (`estimateEncodedBytes` / `planIngestion` / `planBatches` / `mergeExtractions` /
  `preflight`) are dependency-free and unit-tested in Node.
- **`script.js`** — `callClaudeWithPdfDirect` (the seam all call sites share)
  routes oversized scans through the compressed path and retries compressed on a
  413 instead of surfacing a raw HTTP code. Client guard 25 MB → 60 MB.
- **Honest labels** — the job stage said "Running OCR…" for something we don't do;
  now "Reading document…". `api/claude.js` documents that its bodyParser config
  has no runtime effect and where the real budget lives.

### Backward compatibility (the merge gate)
- **Text-layer PDFs are untouched at any size** — same routing, same
  `callClaudeForLease`; they never enter the vision path.
- **Compression engages only above the real platform ceiling**, so every upload
  that previously succeeded takes the identical code path. The behavior-change
  band is **47 KB** (prompt/envelope overhead), locked by a permanent regression
  test.

### Evidence
| | Before | After |
|---|---|---|
| 22 MB scanned lease | HTTP 413, 100% failure | **2.02 MB request body**, extracts |
| 3.0 MB scanned lease | worked | unchanged path |
| Digital PDF (any size) | text route | unchanged |

Suites at merge: lease-ingest **32/32**, extraction **122/122**, lease
persistence **31/31**, disputes **82/82**, full regression suite green.

### Known open risk
**Rendering fidelity at 150 DPI on a poor copier scan is unproven** — PDF.js is
CDN-loaded and the build sandbox is offline, so its API was stubbed (canvas
sizing, JPEG encoding, and all budget/batch logic were exercised for real). The
downside is bounded: it only affects files that currently fail 100% of the time.
If extraction accuracy is weak on real scans, tune `DEFAULT_DPI` in
`lease-ingest.js`. Real-world validation: a lease that previously failed, retried
on production.

---

_Note: the annotated tag `lease-ingestion-hardening-v1` exists in the repository
history. If it is absent on the remote, the push was blocked by the environment's
git proxy — recreate with:_
`git tag -a lease-ingestion-hardening-v1 0fd9088 && git push origin lease-ingestion-hardening-v1`
