# Lease amendments

A commercial lease is rarely one document. The original is amended, extended,
renewed and assigned, and the question a manager actually has is *which
document controls this term today, and can I see it*.

This file records what MainStreet does about that now, and — just as
deliberately — what it does not.

## The amendment is a preserved document

An amendment is uploaded from the master report's per-tenant expansion
(`openAmendmentUpload`), read by the same extraction pipeline the original
lease uses, and applied by `applyAmendmentOverrides` onto the existing tenant
record. It has always attached to the right lease: it creates no second tenant,
no second lease, and it leaves the original's values in the evidence chain.

What it did not do was keep the document. There was no storage upload, no
`lease_documents` row and no extracted text, so the file that changed the lease
could not be opened, listed or asked — while the original it amended was
preserved all three ways. A manager was told the cap was now 3% by a document
MainStreet no longer had.

`handleAmendmentUpload` now does exactly what Lease Intake does, through the
same two functions:

- `uploadLeaseToStorage` puts the PDF in the `leases` bucket;
- `saveLeaseDocument` writes a `lease_documents` row carrying this tenant's id,
  the file url, and the extracted text. A scanned amendment gets the same
  second transcription pass intake uses (`extractTextFromPdfDirect`), so
  Ask-the-Lease works on it rather than finding an empty column.

The returned url and row id are stored on the `amendments[]` entry as `fileUrl`
and `leaseDocumentId`. They survive a reload because that array is part of the
property record and `_stripBlobs` does not touch it. The Space file lists the
amendment beside the lease it amended, and only when the file was really
stored — an entry with no url is a record that filing failed, and offering a
link that opens nothing would be worse than saying so. When filing does fail
the upload says so plainly instead of implying the document is on file.

Nothing new is modelled. An amendment is an ordinary `lease_documents` row
with a tenant id, which is what makes every existing document surface work on
it for free.

## A superseded clause is not evidence

The sharper defect was what the card said afterwards. `applyAmendmentOverrides`
writes the amended value onto the tenant but persists no evidence for it;
`tenant_field_evidence` has no `amendment_id` or `superseded` column; and
`_stripBlobs` drops the in-memory copy on the first save because
`ms_useNormalizedEvidence` is true. So after a reload the only snapshot that
survives is the original lease's — and the card rendered

```
CAM Cap: 3%
“CAM cap shall not exceed five percent (5%) per annum.”
```

the amended number above the clause that says five.

`field-provenance.js` already owns this rule. `_evidenceContradicts` is the M8d
decision that a snapshot stating a different value cannot certify this one, and
it is why `fieldProvenance` refuses to report such a field as `lease_confirmed`.
`_citationChip` was the last surface still deciding alone: it took the first
snapshot not flagged superseded and printed its quote beside whatever the field
currently said.

The chip now asks the authority. `FieldProvenance.latestSnapshot` picks the
snapshot, `fieldProvenance().evidenceStale` says whether it describes the value
on screen, and when it does not the chip renders as superseded rather than as a
citation. It names the governing amendment when one exists
(`_governingAmendment`, the same lookup the amendment provenance chip uses, so
the two cannot disagree) and says plainly that the clause is not evidence for
the value shown. The superseded wording is kept in the tooltip, labelled as
superseded, so the record is not lost and cannot be read as support.

No migration was needed: the refusal is derivable from what already persists.

While rewriting that function, every HTML attribute delimiter in its cited
branch turned out to be a curly `”`, so `class=”fe-chip` had been parsed as the
whole attribute value and the cited chip had never carried its classes or its
tooltip. They are straight quotes now.

## Not decided here

These are open questions, not oversights, and none of them is answered by this
work:

- **Which amendment governs.** `applyAmendmentOverrides` writes the live value
  in upload order; the display chips order by latest effective date. Uploading
  Amendment 1 after Amendment 2 therefore leaves the older terms in force.
  Reconciling the two changes which terms CAM bills on and is its own slice.
- **Durable evidence lineage.** `amendment_id` and `superseded` columns on
  `tenant_field_evidence` would let the amendment's own clause be cited after a
  reload instead of the chip refusing. The refusal is truthful; a citation
  would be better.
- **Renewal, extension, assignment.** Not document types anywhere.
  `DOC_TYPE_TIER` knows `original_lease`, `amendment`, `estoppel` and
  `side_letter`; `renewal_options` is a lease term, not a document.
- **Reachability.** The only amendment control sits behind a completed CAM run,
  in the master report. Amendments logically precede reconciliation.
- **`reasonMultiDocumentLease`.** The real precedence engine, with tier and date
  ordering, supersession and contradiction detection, is computed after every
  amendment and then only logged. Nothing in production reads its output.

## Verification

- `test-lease-amendment.js` executes `applyAmendmentOverrides`,
  `_citationChip`, `_governingAmendment` and `TenantSpace.assemble` for real:
  the amendment entry carries its document reference, multiple amended fields
  stay associated with the amendment that changed them, the original lease and
  its snapshot are untouched, no second tenant appears, and the chip refuses a
  superseded clause while leaving an unamended field citing normally.
- `test-e2e-lease-amendment.js` uploads an amendment on the real page, asserts
  the file reached storage and the row was written with the tenant's id and the
  document's text, reloads, and proves the document is still listed, still
  fetchable at its url, and still answerable through Ask-the-Lease from its own
  text — then that the amended field does not cite the clause it replaced.
- `tools/lease-amendment-mutation.js` covers both halves.
