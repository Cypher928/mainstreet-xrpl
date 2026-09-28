'use strict';
/**
 * test-property-leaseholds.js — P5-2: the canonical leaseholds of an acquired
 * property, as the Property Workspace reads them.
 *
 * Fixtures are shaped exactly like Maple plaza's live rows (Pilot, 2026-09-28):
 * five families whose ids equal the five tenant ids; eight documents (five
 * live and confirmed, two superseded Prime Wellness copies, one unfiled
 * SafeShield file); 27 decisions split 24 ShopRite / 3 Luxe (represented here
 * by the ones that matter, including leased_sqft 65000 → 67000).
 *
 *   A  the join (tenants.id = families.id)      E  the per-property map
 *   B  documents                                 F  structure of the loader and
 *   C  decisions                                    the Space file (script.js,
 *   D  purity / safety                              tenant-space.js)
 *
 *   node test-property-leaseholds.js
 */
const fs = require('fs'), path = require('path');
const PL = require('./property-leaseholds.js');

let pass = 0, fail = 0; const failures = [];
function t(name, cond, detail) { if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); } else { fail++; failures.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? '  — ' + detail : ''}`); } }
function eq(a, b, name) { const ok = JSON.stringify(a) === JSON.stringify(b); t(name, ok, ok ? '' : `expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); }
function sec(s) { console.log(`\n── ${s} ──`); }

// ── Maple, as the Pilot holds it ────────────────────────────────────────────
const P   = '3dc8a7b8-170c-4a51-b90d-dde831c56ca9';
const RV  = '59af3e99-82dc-4a97-813b-21e4f956aca8';
const OWN = '011df998-bad2-464e-bbcb-28e2d0fee821';
const OTHER_UID = 'aaaaaaaa-0000-4000-8000-000000000bbb';
const OTHER_P   = 'ffffffff-0000-4000-8000-00000000f00d';
const F = { luxe: 'd1fb1d5a-aea0-4305-ad8e-82b14e9fee17', coffee: 'ae6f43fd-eb1e-469f-928e-0caa706914a7',
            prime: 'a4ded336-7195-42d1-9f90-d9f67c6d62d6', shoprite: '8b175124-98c2-46be-a44c-34d622378e44',
            sunrise: 'c99dda4d-b477-4098-a9e3-2af250a6b8af' };
const fam = (id, label, suite) => ({ id, review_id: RV, property_id: P, label, family_kind: 'lease', tenant_hint: label, suite_hint: suite || null, created_at: '2026-09-22T15:13:23Z', updated_at: '2026-09-27T03:27:53Z' });
const FAMILIES = [fam(F.shoprite, 'ShopRite Supermarkets, Inc.'), fam(F.luxe, 'Luxe Nails'), fam(F.coffee, 'Maple Coffee Co.', 'B-2'), fam(F.prime, 'Prime Wellness Spa', 'C-1'), fam(F.sunrise, 'Sunrise Cafe & Bakery LLC')];
const sp = (name, uid) => `leases/${uid || OWN}/acq_${RV}_1789993792724-${name}`;
const doc = (o) => Object.assign({ review_id: RV, property_id: P, user_id: OWN, content_type: 'application/pdf', byte_size: 1000, doc_type_status: 'confirmed', confirmed_by: OWN, superseded_by_document_id: null, doc_date: null }, o);
const DOCS = [
  doc({ id: '440d3294-d97d-4248-ae6e-8af6facdd8d3', file_name: 'SafeShield_Insurance_Lease.pdf', storage_path: sp('SafeShield_Insurance_Lease.pdf'), family_id: null, family_status: 'unfiled', doc_type: null, doc_type_status: 'unclassified', confirmed_by: null, confirmed_at: null, created_at: '2026-09-21T12:29:52Z' }),
  doc({ id: 'ed5abee6-b156-4617-b412-31f7a910161a', file_name: 'Prime_Wellness_Spa_Lease.pdf', storage_path: sp('Prime_Wellness_Spa_Lease.pdf'), family_id: null, family_status: 'unfiled', doc_type: null, confirmed_by: null, confirmed_at: null, superseded_by_document_id: 'cb91e8fc-58ba-43bc-95dd-f3ceb9df93ec', created_at: '2026-09-21T12:30:54Z' }),
  doc({ id: '3fc9463f-230e-424c-8bba-7dfacafd6a98', file_name: 'ShopRite_Anchor_Tenant_Lease.pdf', storage_path: sp('ShopRite_Anchor_Tenant_Lease.pdf'), family_id: F.shoprite, family_status: 'confirmed', doc_type: 'renewal', doc_type_status: 'corrected', confirmed_at: '2026-09-26T00:06:07Z', created_at: '2026-09-21T12:31:02Z' }),
  doc({ id: 'e6a60a25-0c1f-4759-b135-7ed0bcfd67bf', file_name: 'Maple_Plaza_Test_Lease_Amendment.pdf', storage_path: sp('Maple_Plaza_Test_Lease_Amendment.pdf'), family_id: F.shoprite, family_status: 'confirmed', doc_type: 'amendment', doc_date: '2027-01-01', confirmed_at: '2026-09-22T15:14:14Z', created_at: '2026-09-22T03:15:36Z' }),
  doc({ id: 'd11215d4-1035-4f73-958a-5a260fb339e7', file_name: 'Luxe_Nails_Lease.pdf', storage_path: sp('Luxe_Nails_Lease.pdf'), family_id: F.luxe, family_status: 'confirmed', doc_type: 'original_lease', confirmed_at: '2026-09-22T20:12:34Z', created_at: '2026-09-22T20:12:10Z' }),
  doc({ id: 'cb91e8fc-58ba-43bc-95dd-f3ceb9df93ec', file_name: 'Prime_Wellness_Spa_Lease.pdf', storage_path: sp('Prime_Wellness_Spa_Lease.pdf'), family_id: null, family_status: 'unfiled', doc_type: null, confirmed_by: null, confirmed_at: null, superseded_by_document_id: 'ebc3f7b1-69cc-431a-8beb-9c123b07265d', created_at: '2026-09-22T20:12:24Z' }),
  doc({ id: 'c50c30e8-5c7c-43c0-91fa-378437e2d9d3', file_name: 'maple_plaza_messy_lease.pdf', storage_path: sp('maple_plaza_messy_lease.pdf'), family_id: F.coffee, family_status: 'confirmed', doc_type: 'original_lease', doc_date: '2024-03-01', confirmed_at: '2026-09-26T00:06:23Z', created_at: '2026-09-23T00:01:18Z' }),
  doc({ id: 'ebc3f7b1-69cc-431a-8beb-9c123b07265d', file_name: 'Prime_Wellness_Spa_Lease.pdf', storage_path: sp('Prime_Wellness_Spa_Lease.pdf'), family_id: F.prime, family_status: 'confirmed', doc_type: 'original_lease', doc_date: '2024-03-01', confirmed_at: '2026-09-26T00:06:25Z', created_at: '2026-09-23T02:06:18Z' }),
  // A lease that WAS filed into ShopRite's leasehold and confirmed, then replaced by
  // a later upload: superseded, so no longer on file even though it kept its family.
  doc({ id: 'shop-old-version', file_name: 'ShopRite_Lease_OLD_SCAN.pdf', storage_path: sp('ShopRite_Lease_OLD_SCAN.pdf'), family_id: F.shoprite, family_status: 'confirmed', doc_type: 'original_lease', confirmed_at: '2026-09-20T00:00:00Z', superseded_by_document_id: '3fc9463f-230e-424c-8bba-7dfacafd6a98', created_at: '2026-09-20T00:00:00Z' }),
];
const dec = (o) => Object.assign({ review_id: RV, property_id: P, user_id: OWN, action: 'confirm', previous_value: null, new_value: null, source_document_id: null, source_quote: null, source_page: null, decided_by: OWN, note: null }, o);
const DECISIONS = [
  dec({ id: 'ac6c910d-0cd8-40b4-9587-955cb4f215ec', family_id: F.shoprite, field_key: 'leased_sqft', action: 'correct', previous_value: '65000', new_value: '67000', source_document_id: 'e6a60a25-0c1f-4759-b135-7ed0bcfd67bf', decided_at: '2026-09-26T16:51:27Z', created_at: '2026-09-26T16:51:29Z' }),
  dec({ id: 'dec-shop-2', family_id: F.shoprite, field_key: 'leased_sqft', action: 'confirm', new_value: '65000', decided_at: '2026-09-25T10:00:00Z', created_at: '2026-09-25T10:00:00Z' }),
  dec({ id: 'dec-shop-3', family_id: F.shoprite, field_key: 'cap', action: 'confirm', new_value: '4', decided_at: '2026-09-25T10:01:00Z', created_at: '2026-09-25T10:01:00Z' }),
  dec({ id: 'd045e5e7-58a2-4561-9bce-26aaa6fd54ed', family_id: F.luxe, field_key: 'end_date', action: 'correct', new_value: '2031-07-07', note: 'Entered by a person. No document on file supports it.', decided_at: '2026-09-25T23:29:00Z', created_at: '2026-09-25T23:29:00Z' }),
];
const TENANTS = [
  { id: F.luxe, tenant_name: 'Luxe Nails', leased_sqft: '3000' }, { id: F.coffee, tenant_name: 'Maple Coffee Co.', leased_sqft: '3000' },
  { id: F.prime, tenant_name: 'Prime Wellness Spa', leased_sqft: '4500' }, { id: F.shoprite, tenant_name: 'ShopRite Supermarkets, Inc.', leased_sqft: '67000' },
  { id: F.sunrise, tenant_name: 'Sunrise Cafe & Bakery LLC', leased_sqft: null },
];
const deepFreeze = (o) => { if (o && typeof o === 'object') { Object.freeze(o); Object.keys(o).forEach(k => deepFreeze(o[k])); } return o; };
const INPUT = () => ({ propertyId: P, currentUid: OWN, families: FAMILIES, documents: DOCS, decisions: DECISIONS, tenants: TENANTS });

// ── A  the join ──────────────────────────────────────────────────────────────
sec('A  the join: tenants.id = families.id, property-scoped');
const B = PL.build(deepFreeze(INPUT()));
eq(B.leaseholdIds.slice().sort(), Object.values(F).sort(), 'A1 five leaseholds, ids = the five tenant ids');
eq([B.tenantsMatched, B.tenantsWithoutLeasehold], [5, 0], 'A2 every one of the five tenants resolves to its leasehold; none is left over');
t('A3 no duplicate tenant is manufactured: the projection has exactly one entry per family and no tenant objects at all',
  Object.keys(B.byLeaseholdId).length === 5 && !('tenants' in B));
const withForeign = PL.build({ propertyId: P, currentUid: OWN, families: FAMILIES.concat([fam('ffffffff-0000-4000-8000-000000000001', 'Elsewhere Tenant')].map(f => Object.assign(f, { property_id: OTHER_P }))), documents: DOCS, decisions: DECISIONS });
eq(withForeign.familyCount, 5, 'A4 a family that names ANOTHER property is dropped even if handed in — one property\'s leaseholds cannot surface on another');
const sameName = PL.build({ propertyId: P, currentUid: OWN, families: [fam('11111111-1111-4111-8111-111111111111', 'Vacant'), fam('22222222-2222-4222-8222-222222222222', 'Vacant')],
  documents: [doc({ id: 'dv', file_name: 'v.pdf', storage_path: sp('v.pdf'), family_id: '22222222-2222-4222-8222-222222222222', family_status: 'confirmed', doc_type: 'original_lease', confirmed_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z' })], decisions: [] });
t('A5 same-name collision: two leaseholds both labelled "Vacant" never share a document — it sits on the id it was filed under only',
  sameName.byLeaseholdId['11111111-1111-4111-8111-111111111111'].documents.length === 0 && sameName.byLeaseholdId['22222222-2222-4222-8222-222222222222'].documents.length === 1);
const shop = B.byLeaseholdId[F.shoprite];
eq([shop.family.label, shop.propertyId, shop.leaseholdId], ['ShopRite Supermarkets, Inc.', P, F.shoprite], 'A6 the ShopRite leasehold carries its family label, its property and its id');
t('A7 ShopRite\'s area is the tenant row\'s 67,000 (035 wrote it from the decided value) and the decision behind it is locatable: leased_sqft 65000 → 67000, source = the amendment',
  TENANTS.find(x => x.id === F.shoprite).leased_sqft === '67000'
  && shop.decisionSummary.latestByField.leased_sqft.newValue === '67000'
  && shop.decisionSummary.latestByField.leased_sqft.previousValue === '65000'
  && shop.decisionSummary.latestByField.leased_sqft.sourceDocumentId === 'e6a60a25-0c1f-4759-b135-7ed0bcfd67bf');

// ── B  documents ────────────────────────────────────────────────────────────
sec('B  documents: live, confirmed, filed into THIS leasehold');
eq(shop.documents.map(d => d.name), ['ShopRite_Anchor_Tenant_Lease.pdf', 'Maple_Plaza_Test_Lease_Amendment.pdf'], 'B1 ShopRite: the renewal lease and the amendment, oldest first');
eq(shop.documents.map(d => d.docType), ['renewal', 'amendment'], 'B2 each with its confirmed document type');
eq(B.byLeaseholdId[F.luxe].documents.map(d => d.name), ['Luxe_Nails_Lease.pdf'], 'B3 Luxe: one lease');
eq(B.byLeaseholdId[F.coffee].documents.map(d => d.name), ['maple_plaza_messy_lease.pdf'], 'B4 Maple Coffee: one lease');
eq(B.byLeaseholdId[F.prime].documents.map(d => d.id), ['ebc3f7b1-69cc-431a-8beb-9c123b07265d'], 'B5 Prime Wellness: ONE live document — the two superseded copies are excluded');
eq(B.byLeaseholdId[F.sunrise].documents, [], 'B6 Sunrise (an entered leasehold): no document, and none invented');
t('B7 the unfiled SafeShield file appears on NO tenant', Object.values(B.byLeaseholdId).every(e => e.documents.every(d => !/SafeShield/.test(d.name))));
eq([B.documentCount, B.unattachedDocumentCount], [5, 4], 'B8 five documents on file across the leaseholds; four (unfiled + three superseded) counted apart, attached to nobody');
t('B8b a confirmed, family-filed lease that was later REPLACED is not on file: ShopRite shows the renewal and the amendment, never the old scan',
  shop.documents.length === 2 && shop.documents.every(d => d.id !== 'shop-old-version') && DOCS.some(d => d.id === 'shop-old-version' && d.family_status === 'confirmed' && d.superseded_by_document_id));
const unconfirmed = PL.build({ propertyId: P, currentUid: OWN, families: [FAMILIES[0]], documents: [Object.assign({}, DOCS[2], { family_status: 'proposed' })], decisions: [] });
eq(unconfirmed.byLeaseholdId[F.shoprite].documents.length, 0, 'B9 a document only PROPOSED for a leasehold (no human confirmation) is not on file for it');
t('B10 the uploader gets the link: url = the storage path, uploadedByOther false',
  shop.documents.every(d => d.url === d.storagePath && d.uploadedByOther === false && d.ownerUid === OWN));
const asMember = PL.build({ propertyId: P, currentUid: OTHER_UID, families: FAMILIES, documents: DOCS, decisions: DECISIONS });
t('B11 another member sees the same documents ON FILE but gets NO url (the signed-url check is the uploader\'s)',
  asMember.byLeaseholdId[F.shoprite].documents.length === 2 && asMember.byLeaseholdId[F.shoprite].documents.every(d => d.url === null && d.uploadedByOther === true));
const noUid = PL.build({ propertyId: P, families: FAMILIES, documents: DOCS, decisions: [] });
t('B12 with no signed-in uid nothing links', noUid.byLeaseholdId[F.luxe].documents.every(d => d.url === null));
eq([PL.pathOwner('leases/' + OWN + '/acq_x.pdf'), PL.pathOwner('/storage/v1/object/public/leases/' + OWN + '/acq_x.pdf?x=1'), PL.pathOwner('invoices/u9/f.pdf'), PL.pathOwner(''), PL.pathOwner(null)],
   [OWN, OWN, 'u9', null, null], 'B13 pathOwner reads the uid segment in every stored form, as api/document-url does');
eq(shop.documents[1].when, '2027-01-01', 'B14 a document\'s date is its doc_date when it has one');
eq(shop.documents[0].when, '2026-09-26T00:06:07Z', 'B15 …else the confirmation time');

// ── C  decisions ────────────────────────────────────────────────────────────
sec('C  decisions: grouped per leasehold, located');
eq([shop.decisions.length, B.byLeaseholdId[F.luxe].decisions.length, B.byLeaseholdId[F.coffee].decisions.length, B.byLeaseholdId[F.sunrise].decisions.length], [3, 1, 0, 0], 'C1 grouped by family: 3 ShopRite, 1 Luxe, 0 elsewhere');
eq(shop.decisions.map(d => d.id), ['dec-shop-2', 'dec-shop-3', 'ac6c910d-0cd8-40b4-9587-955cb4f215ec'], 'C2 oldest first');
eq([shop.decisionSummary.count, shop.decisionSummary.lastAt, shop.decisionSummary.byField], [3, '2026-09-26T16:51:27Z', { leased_sqft: 2, cap: 1 }], 'C3 the summary: count, last decided_at, per field');
t('C4 the latest decision per field wins: leased_sqft → 67000 (the correction), not the earlier confirm of 65000', shop.decisionSummary.latestByField.leased_sqft.id === 'ac6c910d-0cd8-40b4-9587-955cb4f215ec');
const lux = B.byLeaseholdId[F.luxe].decisions[0];
eq([lux.fieldKey, lux.newValue, lux.decidedBy, lux.note], ['end_date', '2031-07-07', OWN, 'Entered by a person. No document on file supports it.'], 'C5 a decision carries who, what and the note a person left');
eq(B.decisionCount, 4, 'C6 the total');
const foreignDec = PL.build({ propertyId: P, currentUid: OWN, families: FAMILIES, documents: [], decisions: DECISIONS.concat([dec({ id: 'x-other', family_id: F.shoprite, property_id: OTHER_P, field_key: 'cap', decided_at: '2026-09-27T00:00:00Z' })]) });
eq(foreignDec.byLeaseholdId[F.shoprite].decisions.length, 3, 'C7 a decision that names another property is dropped even when its family_id matches');

// ── D  purity / safety ──────────────────────────────────────────────────────
sec('D  purity and safety');
t('D1 build() never mutated a frozen input (it threw nothing and the fixtures are unchanged)', DOCS.length === 9 && FAMILIES.length === 5 && Object.isFrozen(FAMILIES[0]));
eq(PL.build(null).familyCount, 0, 'D2 null → an empty projection, no throw');
eq(PL.build({ propertyId: P, families: 'nope', documents: {}, decisions: 7 }).familyCount, 0, 'D3 garbage → empty');
t('D4 the loader\'s select lists never ask for the document text or the abstracted evidence',
  !/extracted_text|abstracted_fields|classification_history/.test(PL.SELECT.documents + PL.SELECT.families + PL.SELECT.decisions));
t('D5 every select carries property_id so the loader can scope and build() can double-check', ['families', 'documents', 'decisions'].every(k => PL.SELECT[k].split(', ').includes('property_id')));

// ── E  the per-property map ─────────────────────────────────────────────────
sec('E  the map: one property\'s leaseholds never surface on another; a load replaces; nothing durable');
PL._reset();
t('E1 empty at start', PL.get(P) === undefined && !PL.has(P) && PL.forTenant(P, F.shoprite) === null);
t('E2 set() stores under the property uuid; forTenant resolves by tenant id', PL.set(P, B) === true && PL.forTenant(P, F.shoprite) === shop);
t('E3 the same tenant id asked under ANOTHER property returns null — the map is keyed by property first', PL.forTenant(OTHER_P, F.shoprite) === null);
t('E4 set() refuses a projection built for a different property', PL.set(OTHER_P, B) === false && PL.get(OTHER_P) === undefined);
const otherBuilt = PL.build({ propertyId: OTHER_P, currentUid: OWN, families: [fam('33333333-3333-4333-8333-333333333333', 'Other Tenant')].map(f => Object.assign(f, { property_id: OTHER_P })), documents: [], decisions: [] });
PL.set(OTHER_P, otherBuilt);
t('E5 two properties side by side: each answers only for its own leaseholds', PL.forTenant(OTHER_P, '33333333-3333-4333-8333-333333333333') !== null && PL.forTenant(OTHER_P, F.shoprite) === null && PL.forTenant(P, '33333333-3333-4333-8333-333333333333') === null);
PL.clear(P);
t('E6 clear() empties the property before a fresh read: nothing stale is answered while the query is pending', PL.get(P) === undefined && PL.forTenant(P, F.shoprite) === null && PL.has(OTHER_P));
PL.set(P, PL.build({ propertyId: P, currentUid: OWN, families: [FAMILIES[1]], documents: [], decisions: [] }));
t('E7 a later set() REPLACES the entry rather than merging: the old leaseholds are gone', PL.forTenant(P, F.shoprite) === null && PL.forTenant(P, F.luxe) !== null);
t('E8 a tenant with no leasehold (every legacy tenant) → null', PL.forTenant(P, 'legacy-tenant-1') === null && PL.forTenant(P, null) === null && PL.forTenant(P, '') === null);
t('E9 the map is not on the property object, the blob or localStorage: the module exposes no serialiser and touches no storage API',
  !/localStorage|sessionStorage|indexedDB|properties\.data|\.data\.|JSON\.stringify\(/.test(fs.readFileSync(path.join(__dirname, 'property-leaseholds.js'), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')));
PL._reset();

// ── F  structure: the loader and the Space file ─────────────────────────────
sec('F  structure: script.js loader and tenant-space.js');
const S  = fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8');
const TS = fs.readFileSync(path.join(__dirname, 'tenant-space.js'), 'utf8');
const PR = fs.readFileSync(path.join(__dirname, 'property-record.js'), 'utf8');
const loaderStart = S.indexOf('async function loadPropertyLeaseholds(');
const loader = S.slice(loaderStart, S.indexOf('\nasync function loadPropertyData(', loaderStart));
t('F1 loadPropertyLeaseholds exists and is defined before loadPropertyData', loaderStart > 0 && loader.length > 0);
t('F2 all three reads are scoped .eq(\'property_id\', propertyId)', (loader.match(/\.eq\('property_id', propertyId\)/g) || []).length === 3);
t('F3 none of them filters on user_id: membership RLS decides, as for tenants and evidence', !/user_id/.test(loader));
t('F3b each read asks for exactly its column list (PL.SELECT.*), never "*": the document text and the abstracted evidence stay out of the workspace load',
  /\.from\('acquisition_document_families'\)\.select\(PL\.SELECT\.families\)/.test(loader)
  && /\.from\('acquisition_documents'\)\.select\(PL\.SELECT\.documents\)/.test(loader)
  && /\.from\('acquisition_term_decisions'\)\.select\(PL\.SELECT\.decisions\)/.test(loader)
  && !/select\('\*'\)/.test(loader));
t('F4 the property\'s entry is cleared BEFORE the read (stale set never shown while pending), and set() after', loader.indexOf('PL.clear(propertyId)') > 0 && loader.indexOf('PL.clear(propertyId)') < loader.indexOf('await Promise.all') && loader.indexOf('PL.set(propertyId, built)') > loader.indexOf('await Promise.all'));
t('F5 the loader writes nothing: no insert/upsert/update/delete/rpc, no localStorage', !/\.(insert|upsert|update|delete|rpc)\(|localStorage|_lsSave|savePropert/.test(loader));
const lpd = S.slice(S.indexOf('\nasync function loadPropertyData('), S.indexOf('\nasync function loadPropertyData(') + 12000);
const callIdx = lpd.indexOf('await loadPropertyLeaseholds(id, uid)');
t('F6 loadPropertyData calls it exactly once, for a row that is in _props and managed (acquired), and clears otherwise',
  (lpd.match(/loadPropertyLeaseholds\(/g) || []).length === 1 && /_props \|\| \[\]\)\.find\(p => p && p\.id === id\)/.test(lpd) && /isManaged/.test(lpd) && /else window\.PropertyLeaseholds\.clear\(id\)/.test(lpd) && callIdx > 0);
t('F7 the projection is never assigned onto the property object (no `property._leaseholds`, `property.leaseholds`, `data.leaseholds`)', !/(property|data|prop)\.(_)?leaseholds?\s*=/.test(S));
t('F8 PROPERTY_DATA_CLIENT_KEYS is untouched (16 keys, no leasehold key)', /'tenants', 'escrowReserves', 'drawRequests', 'info',\n\]\);/.test(S) && !/leasehold/i.test(S.slice(S.indexOf('const PROPERTY_DATA_CLIENT_KEYS'), S.indexOf('const PROPERTY_DATA_CLIENT_KEYS') + 600)));
t('F9 assemble() consults PropertyLeaseholds.forTenant(property.id, tenantId) — the property being rendered, never a global "current" one', /_PL\.forTenant\(property\.id, tenantId\)/.test(TS));
t('F10 assemble() unions the leasehold documents into leaseDocs and exposes `leasehold`; the records count text is untouched',
  /fromAcquisition: true/.test(TS) && /leasehold: leasehold,/.test(TS) && /function _countsText\(c\) \{\n    var bits = \[\];\n    if \(c\.events\)/.test(TS) && !/leaseDocs/.test(TS.slice(TS.indexOf('function _countsText'), TS.indexOf('function _countsText') + 600)));
t('F11 the Space file shows the verification line only with ≥1 decision, and says "by a person"', /_lhSum && _lhSum\.count > 0/.test(TS) && /Verified at acquisition/.test(TS) && /by a person/.test(TS));
t('F12 a document another member uploaded is labelled as on file, without a link (docLinkHtml renders a missing url inert)', /uploadedByOther \? '<span class="ts-doc-when ts-doc-other">on file/.test(TS));
t('F13 PropertyRecord is UNCHANGED and reads rec.leaseDocs on the same path (so Ask AI sees the same documents without wiring)', /for \(const d of _arr\(rec\.leaseDocs\)\)/.test(PR) && !/PropertyLeaseholds|leasehold/.test(PR));
t('F14 field-provenance.js is untouched by P5-2', !/PropertyLeaseholds|acquisition_term_decisions/.test(fs.readFileSync(path.join(__dirname, 'field-provenance.js'), 'utf8')));
t('F15 index.html loads the module before script.js and tenant-space.js', (() => { const H = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'); const a = H.indexOf('property-leaseholds.js'), b = H.indexOf('<script src="script.js">'), c = H.indexOf('<script src="tenant-space.js">'); return a > 0 && a < b && b < c; })());

console.log(`\n${'─'.repeat(58)}\nRESULT: ${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILED:'); failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
