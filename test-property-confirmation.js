'use strict';
/**
 * test-property-confirmation.js — the landlord's property-mismatch confirmation.
 *
 * Two states have to hold, and the second must not be reachable by accident:
 *
 *   UNCONFIRMED  a lease whose document names a different property is detected,
 *                held out of CAM, and shown as a high-severity review warning.
 *   CONFIRMED    after an explicit per-lease confirmation by the property owner,
 *                the same lease takes part in CAM — while the finding itself,
 *                and every extracted value, stays exactly as it was.
 *
 * The interesting assertions are the invalidation ones. A confirmation that
 * survives a re-upload, or one that travels to another property, would turn a
 * human verification step into a permanent bypass, so those are tested harder
 * than the happy path.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
const ok  = (m) => { console.log('  \x1b[32m✓\x1b[0m ' + m); pass++; };
const bad = (m, d) => { console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? ' — ' + d : '')); fail++; };
const eq  = (label, actual, expected) => actual === expected
  ? ok(`${label} → ${actual}`)
  : bad(label, `expected ${expected}, got ${actual}`);

// ── Load the two pure modules the way the browser does ─────────────────────
const sandbox = { window: {}, console, module: {}, Date };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of ['lease-intelligence.js', 'review-engine.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), sandbox, { filename: f });
}
const LI = sandbox.window.LeaseIntelligence;
const RE = sandbox.window.ReviewEngine;

// A lease uploaded into "Lakeview Plaza" whose document says "Harbor Point".
// No shared token, which is what the detector flags on.
const CTX = { currentPropertyName: 'Lakeview Plaza' };
function baseTenant(over) {
  return Object.assign({
    tenant_name: 'Bright Coffee Co',
    property_name: 'Harbor Point Center',
    leased_sqft: 2400, lease_type: 'NNN', cap: 5,
    start_date: '2023-01-01', end_date: '2027-12-31',
    leaseUrl: 'https://storage.example/landlord-1/harbor-lease.pdf',
  }, over || {});
}
const withEdgeCases = (t, ctx) => {
  const copy = { ...t };
  copy._edgeCases = LI.detectLeaseEdgeCases(copy, ctx || CTX);
  return copy;
};

console.log('\n── Detection is unchanged: the mismatch is always found ──');
{
  const t = withEdgeCases(baseTenant());
  const types = t._edgeCases.edgeCases.map(e => e.type);
  types.includes('PROPERTY_NAME_MISMATCH')
    ? ok('a lease naming a different property is flagged PROPERTY_NAME_MISMATCH')
    : bad('the mismatch was not detected', types.join(',') || 'none');

  // The confirmation must not touch detection. Same tenant, now confirmed.
  const confirmed = { ...t, _propertyConfirm: {
    extractedName: 'Harbor Point Center',
    documentKey: 'https://storage.example/landlord-1/harbor-lease.pdf',
    propertyId: 'prop-1', propertyName: 'Lakeview Plaza',
    at: new Date().toISOString(), by: 'owner@example.com' } };
  const stillFlagged = LI.detectLeaseEdgeCases(confirmed, CTX)
    .edgeCases.map(e => e.type).includes('PROPERTY_NAME_MISMATCH');
  stillFlagged
    ? ok('after confirmation the mismatch is STILL detected — the finding is not erased')
    : bad('confirmation suppressed the detector', 'detection must be independent of resolution');

  // A matching property name must never be flagged, confirmed or not.
  const sameProp = withEdgeCases(baseTenant({ property_name: 'Lakeview Plaza' }));
  !sameProp._edgeCases.edgeCases.map(e => e.type).includes('PROPERTY_NAME_MISMATCH')
    ? ok('a lease naming the same property is not flagged')
    : bad('false positive on a matching property name');
}

console.log('\n── isPropertyMismatchConfirmed: fails closed ──');
{
  const t = withEdgeCases(baseTenant());
  const good = { extractedName: 'Harbor Point Center',
                 documentKey: 'https://storage.example/landlord-1/harbor-lease.pdf',
                 propertyId: 'prop-1', propertyName: 'Lakeview Plaza',
                 at: '2026-01-01T00:00:00Z', by: 'owner@example.com' };

  eq('no confirmation at all',            LI.isPropertyMismatchConfirmed(t), false);
  eq('a valid confirmation',              LI.isPropertyMismatchConfirmed({ ...t, _propertyConfirm: good }), true);

  // Each invalidation below is a way a confirmation could otherwise outlive the
  // thing it vouched for.
  eq('lease re-extracted, now names a THIRD property',
     LI.isPropertyMismatchConfirmed({ ...t, property_name: 'Riverside Mall', _propertyConfirm: good }), false);
  eq('a DIFFERENT lease document was uploaded',
     LI.isPropertyMismatchConfirmed({ ...t, leaseUrl: 'https://storage.example/landlord-1/other.pdf', _propertyConfirm: good }), false);
  eq('confirmation records an empty property name',
     LI.isPropertyMismatchConfirmed({ ...t, _propertyConfirm: { ...good, extractedName: '' } }), false);
  eq('confirmation is not an object',
     LI.isPropertyMismatchConfirmed({ ...t, _propertyConfirm: true }), false);
  eq('confirmation with a missing documentKey',
     LI.isPropertyMismatchConfirmed({ ...t, _propertyConfirm: { ...good, documentKey: undefined } }), false);

  // Truthiness is not confirmation: the values must actually correspond.
  eq('a confirmation naming the wrong lease entirely',
     LI.isPropertyMismatchConfirmed({ ...t, _propertyConfirm: {
       ...good, extractedName: 'Somewhere Else', documentKey: 'x' } }), false);
}

console.log('\n── Review status: warned when unconfirmed, resolved when confirmed ──');
{
  const unconfirmed = withEdgeCases(baseTenant());
  const s1 = RE.deriveTenantReviewState(unconfirmed);
  const w1 = s1.warnings.map(w => w.type);
  w1.includes('property_name_mismatch')
    ? ok('unconfirmed → high-severity property_name_mismatch warning')
    : bad('unconfirmed lease produced no mismatch warning', w1.join(',') || 'none');
  (s1.warnings.find(w => w.type === 'property_name_mismatch') || {}).severity === 'high'
    ? ok('  …and its severity is high')
    : bad('the unconfirmed warning is not high severity');

  const confirmed = { ...unconfirmed, _propertyConfirm: {
    extractedName: 'Harbor Point Center',
    documentKey: 'https://storage.example/landlord-1/harbor-lease.pdf',
    propertyId: 'prop-1', propertyName: 'Lakeview Plaza',
    at: '2026-01-01T00:00:00Z', by: 'owner@example.com' } };
  const s2 = RE.deriveTenantReviewState(confirmed);
  const w2 = s2.warnings.map(w => w.type);
  !w2.includes('property_name_mismatch')
    ? ok('confirmed → the blocking warning is gone')
    : bad('the blocking warning survived confirmation');
  w2.includes('property_name_confirmed')
    ? ok('confirmed → replaced by a low-severity "confirmed by the owner" note, not silence')
    : bad('confirmation left no trace in the review state', w2.join(',') || 'none');
  (s2.warnings.find(w => w.type === 'property_name_confirmed') || {}).severity === 'low'
    ? ok('  …at low severity')
    : bad('the confirmed note is not low severity');

  s2.score > s1.score
    ? ok(`the -30 mismatch penalty lifts once verified (${s1.score} → ${s2.score})`)
    : bad('confirming the lease did not improve the review score', `${s1.score} → ${s2.score}`);

  // Confirmation answers ONE question. It must not paper over anything else.
  const alsoBroken = withEdgeCases(baseTenant({ leased_sqft: null, lease_type: null }));
  const s3 = RE.deriveTenantReviewState({ ...alsoBroken, _propertyConfirm: {
    extractedName: 'Harbor Point Center',
    documentKey: 'https://storage.example/landlord-1/harbor-lease.pdf',
    propertyId: 'prop-1', propertyName: 'Lakeview Plaza',
    at: '2026-01-01T00:00:00Z', by: 'owner@example.com' } });
  const w3 = s3.warnings.map(w => w.type);
  (w3.includes('missing_sqft') && w3.includes('missing_lease_type'))
    ? ok('other review warnings are untouched by a property confirmation')
    : bad('confirming the property cleared unrelated warnings', w3.join(',') || 'none');
}

console.log('\n── The confirmation preserves every extracted value ──');
{
  const before = withEdgeCases(baseTenant());
  const after = { ...before, _propertyConfirm: {
    extractedName: before.property_name,
    documentKey: before.leaseUrl,
    propertyId: 'prop-1', propertyName: 'Lakeview Plaza',
    at: '2026-01-01T00:00:00Z', by: 'owner@example.com' } };
  const fields = ['tenant_name', 'property_name', 'leased_sqft', 'lease_type',
                  'cap', 'start_date', 'end_date', 'leaseUrl'];
  const changed = fields.filter(f => JSON.stringify(before[f]) !== JSON.stringify(after[f]));
  changed.length === 0
    ? ok(`all ${fields.length} extracted fields are byte-identical after confirmation`)
    : bad('confirmation altered an extracted value', changed.join(', '));
  // Most important of all: the AI's reading of the property name is preserved,
  // NOT rewritten to the property it was confirmed into.
  after.property_name === 'Harbor Point Center'
    ? ok('property_name still holds what the AI read, not the confirmed property')
    : bad('property_name was overwritten', after.property_name);
}

console.log('\n── Source wiring: the CAM gate and the UI ──');
{
  const src = fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8');

  /function getValidTenants\(\)[\s\S]{0,320}?!_propertyMismatchBlockReason\(t\)/.test(src)
    ? ok('getValidTenants() gates on the BLOCK reason, so a confirmed lease enters CAM')
    : bad('getValidTenants() does not consult _propertyMismatchBlockReason');

  /function _hasPropertyMismatch\(t\)[\s\S]{0,260}?edgeCaseTypes\.includes\('PROPERTY_NAME_MISMATCH'\)/.test(src)
    ? ok('_hasPropertyMismatch() is still the raw detector, unchanged')
    : bad('the raw detector was modified');

  // The handler must refuse to record a confirmation for an unflagged lease, or
  // the audit trail fills with reviews of findings that never existed.
  /if \(!_hasPropertyMismatch\(t\)\) \{[\s\S]{0,220}?return;/.test(src)
    ? ok('confirmLeaseBelongsToProperty() refuses when no mismatch was flagged')
    : bad('the handler will record a confirmation for an unflagged lease');

  /if \(!extractedName\) \{[\s\S]{0,260}?return;/.test(src)
    ? ok('…and refuses when the extracted property name is empty (nothing to invalidate against)')
    : bad('the handler accepts an unidentifiable confirmation');

  /logActivity\('property_confirmed'/.test(src)
    ? ok('the confirmation is written to the activity log (auditable)')
    : bad('the confirmation is not logged');

  /_propertyConfirm: \{[\s\S]{0,400}?propertyId:\s*activePropId/.test(src)
    ? ok('the record is tied to the property it was made in')
    : bad('the confirmation does not record its property');

  // Per-lease only. A bulk override is the one shape that would defeat the point.
  const bulk = /confirmAllProperty|confirmAllLeases|bulkConfirmProperty|confirm_all/i.test(src);
  !bulk ? ok('no blanket "confirm all" path exists')
        : bad('a bulk confirmation path exists — confirmation must be per lease');

  /onclick="confirmLeaseBelongsToProperty\(\$\{i\}\)"/.test(src)
    ? ok('the card button confirms one specific lease by index')
    : bad('the card button is not wired per lease');

  /role === 'tenant'[\s\S]{0,200}?Only the property owner can confirm/.test(src)
    ? ok('the handler refuses a tenant-role caller')
    : bad('the handler has no landlord guard');

  /Property confirmed<\/strong>/.test(src)
    ? ok('the confirmed card state renders "Property confirmed"')
    : bad('the card does not show a confirmed state');

  /This lease was confirmed before, but the document or the/.test(src)
    ? ok('a stale confirmation tells the landlord why they are being asked again')
    : bad('no stale-confirmation message');
}

console.log('\n── The card renderer actually runs, in both states ──');
{
  // Asserting the source contains the right strings proves they were typed, not
  // that the function produces them. So the real renderer is lifted out of
  // script.js and executed against both states with the few globals it touches
  // stubbed. A template-literal or scope error would pass a grep and fail here.
  const src = fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8');
  const start = src.indexOf('function _leaseEdgeCaseAndReviewNotesHtml');
  const end = src.indexOf('\n}', src.indexOf('return `<div class="lease-edge-notes">', start)) + 2;
  const fnSrc = src.slice(start, end);

  const box = {
    console,
    esc: (v) => String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
    Date, Array, String, JSON,
    // The real predicate from lease-intelligence, so this exercises the shipped
    // resolution rule rather than a convenient stand-in.
    _hasPropertyMismatch: (t) => ((t && t._edgeCases && t._edgeCases.edgeCases) || [])
      .map(e => e.type).includes('PROPERTY_NAME_MISMATCH'),
  };
  box._propertyMismatchBlockReason = (t) => {
    if (!box._hasPropertyMismatch(t)) return null;
    if (LI.isPropertyMismatchConfirmed(t)) return null;
    return { tenantName: t.tenant_name, extractedName: (t.property_name || '').trim(),
             propertyName: 'Lakeview Plaza', hasConfirm: !!t._propertyConfirm,
             staleConfirm: !!t._propertyConfirm };
  };
  vm.createContext(box);
  vm.runInContext(fnSrc + '\nthis.render = _leaseEdgeCaseAndReviewNotesHtml;', box);

  const unconfirmed = withEdgeCases(baseTenant());
  const htmlU = box.render(unconfirmed, 2);
  /Confirm lease belongs to this property/.test(htmlU)
    ? ok('UNCONFIRMED → renders the confirm button')
    : bad('the confirm button did not render', htmlU.slice(0, 160));
  /onclick="confirmLeaseBelongsToProperty\(2\)"/.test(htmlU)
    ? ok('  …wired to this lease\'s own index')
    : bad('the button is not bound to the right index');
  /Harbor Point Center/.test(htmlU) && /Lakeview Plaza/.test(htmlU)
    ? ok('  …and states both names, so the decision is made on facts')
    : bad('the unresolved state does not show what conflicts with what');
  !/Property confirmed<\/strong>/.test(htmlU)
    ? ok('  …and does NOT claim the property is confirmed')
    : bad('the unconfirmed card claims confirmation');

  const confirmed = { ...unconfirmed, _propertyConfirm: {
    extractedName: 'Harbor Point Center',
    documentKey: 'https://storage.example/landlord-1/harbor-lease.pdf',
    propertyId: 'prop-1', propertyName: 'Lakeview Plaza',
    at: '2026-01-01T00:00:00Z', by: 'owner@example.com' } };
  const htmlC = box.render(confirmed, 2);
  /Property confirmed<\/strong>/.test(htmlC)
    ? ok('CONFIRMED → renders "Property confirmed"')
    : bad('the confirmed state did not render', htmlC.slice(0, 200));
  /owner@example\.com/.test(htmlC)
    ? ok('  …naming who confirmed it (auditable on the card itself)')
    : bad('the confirmed state does not say who confirmed it');
  !/Confirm lease belongs to this property/.test(htmlC)
    ? ok('  …and the button is gone, so it cannot be re-clicked')
    : bad('the confirm button is still present after confirmation');
  // Read the expected note off the detected edge case rather than hardcoding a
  // phrase: an earlier version of this assertion looked for wording that lives
  // in `description` while the renderer emits `reviewerNote`, and failed on
  // correct output. Sourcing it from the module means the check follows the copy.
  const mismatchNote = unconfirmed._edgeCases.edgeCases
    .find(e => e.type === 'PROPERTY_NAME_MISMATCH').reviewerNote;
  (/AI Review Notes/.test(htmlC) && htmlC.includes(mismatchNote))
    ? ok('  …while the original AI finding is still shown verbatim, not erased')
    : bad('confirmation hid the underlying finding', mismatchNote);

  // A lease with no mismatch must be untouched by any of this.
  const clean = withEdgeCases(baseTenant({ property_name: 'Lakeview Plaza' }));
  const htmlN = box.render(clean, 0);
  !/confirmLeaseBelongsToProperty/.test(htmlN)
    ? ok('a lease with no mismatch renders no confirmation control')
    : bad('the confirm button appears on a lease that was never flagged');
}

console.log('\n' + (fail ? '\x1b[31m' : '\x1b[32m') + 'RESULT: ' + pass + ' passed, ' + fail + ' failed\x1b[0m');
process.exit(fail ? 1 : 0);
