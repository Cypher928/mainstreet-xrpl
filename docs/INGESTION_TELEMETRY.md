# Lease Ingestion Telemetry

Operational metrics for the lease ingestion pipeline — enough to answer *"are 90%
of users on the text path?"* and *"are copier scans routinely using
compression?"* without anything invasive.

**No document content.** Every recorded field is operational: which path ran, how
big, how many pages, did it work, how long. No file names, tenant names,
extracted text, or user identifiers.

---

## Where it lives

**No migration was required.** Telemetry is written to the existing
`lease_jobs.debug_summary` (jsonb) under an `ingest` key, alongside the columns
that already existed (`file_size`, `error_message`, `processing_started_at`,
`processing_completed_at`).

> `lease_jobs.extraction_route` keeps its original values (`text` | `pdf-direct` |
> `unknown`) because a CHECK constraint limits it. The finer-grained path lives in
> `debug_summary->'ingest'->>'path'`.

### The recorded shape
```json
{
  "path": "vision-chunked",      // text | vision-direct | vision-compressed | vision-chunked
  "originalBytes": 23068672,     // the PDF the user actually uploaded
  "payloadBytes": 3250585,       // what we sent after downscaling
  "compressionRatio": 0.14,      // payload ÷ original (0.14 = 86% smaller)
  "pages": 38,
  "batches": 4,                  // >1 means the document was split
  "batchFailures": 0,
  "outcome": "success",          // success | failure
  "reason": null,                // short, content-free (e.g. "http-413", "all-batches-failed")
  "ms": 18432
}
```

### The four paths
| Path | Meaning |
|---|---|
| `text` | Embedded PDF text layer — the fast, cheap majority case |
| `vision-direct` | Scanned, small enough to send whole (unchanged legacy behavior) |
| `vision-compressed` | Scanned + downscaled, sent in **one** request |
| `vision-chunked` | Scanned + downscaled + **split across multiple** requests |

---

## Answering the questions

**Path mix — "are 90% on the text path?"**
```sql
select
  coalesce(debug_summary->'ingest'->>'path', 'unrecorded') as path,
  count(*) as runs,
  round(100.0 * count(*) / sum(count(*)) over (), 1) as pct
from public.lease_jobs
where created_at > now() - interval '30 days'
group by 1
order by runs desc;
```

**Are copier scans routinely compressed, and is compression working?**
```sql
select
  debug_summary->'ingest'->>'path'                          as path,
  count(*)                                                  as runs,
  round(avg((debug_summary->'ingest'->>'originalBytes')::numeric)  / 1048576, 1) as avg_original_mb,
  round(avg((debug_summary->'ingest'->>'payloadBytes')::numeric)   / 1048576, 2) as avg_sent_mb,
  round(avg((debug_summary->'ingest'->>'compressionRatio')::numeric), 2)         as avg_ratio,
  round(avg((debug_summary->'ingest'->>'pages')::numeric), 0)                    as avg_pages
from public.lease_jobs
where debug_summary->'ingest'->>'path' like 'vision%'
group by 1;
```

**Reliability — is anything still failing, and why?**
```sql
select
  debug_summary->'ingest'->>'path'    as path,
  debug_summary->'ingest'->>'outcome' as outcome,
  debug_summary->'ingest'->>'reason'  as reason,
  count(*)
from public.lease_jobs
where created_at > now() - interval '30 days'
group by 1,2,3
order by count desc;
```
A reappearance of `http-413` would mean the budget needs lowering. Rising
`all-batches-failed` or `no-readable-pages` would point at document quality
rather than transport.

**Is 150 DPI enough?** (the one open risk from the hardening milestone)
```sql
-- Confidence on compressed runs vs the text baseline. If compressed runs score
-- materially lower, raise DEFAULT_DPI in lease-ingest.js.
select
  debug_summary->'ingest'->>'path' as path,
  count(*) as runs,
  round(avg(confidence_score), 1)  as avg_confidence,
  count(*) filter (where status = 'review_required') as needed_review
from public.lease_jobs
where confidence_score is not null
group by 1
order by runs desc;
```

**Speed by path**
```sql
select
  debug_summary->'ingest'->>'path' as path,
  round(avg((debug_summary->'ingest'->>'ms')::numeric)) as avg_ms,
  max((debug_summary->'ingest'->>'ms')::numeric)        as slowest_ms
from public.lease_jobs
group by 1;
```

---

## In-session, no SQL needed

While the app is open, the browser console gives an immediate read:

```js
LeaseIngest.sessionStats()
// { runs: 13, byPath: {...},
//   pathMix: { text: '54%', 'vision-chunked': '23%', ... },
//   success: 12, failed: 1, avgMs: 8420 }

LeaseIngest.recentRuns()   // the last 200 runs, newest last
ms_extractionDebug.ingest  // telemetry for the most recent extraction
```

Every ingestion also logs one line:
```
[INGEST] vision-chunked | 22.00MB → 3.10MB | pages: 38 | batches: 4 | success | 18432ms
```

---

## Design notes
- **Telemetry never breaks ingestion.** Every entry point is wrapped; a telemetry
  failure cannot fail an upload.
- **Bounded memory** — the in-session buffer keeps the last 200 runs.
- **Failures are recorded too.** `failLeaseJob` writes the in-flight path, so a
  failed upload still tells us which path it died on.
