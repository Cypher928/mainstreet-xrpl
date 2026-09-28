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
t('F11 the Space file shows the summary and the history only with ≥1 decision, says "by a person" (or "by you"), and says "the value shown has changed since" when it has',
  /_lhC && _lhC\.decisions > 0/.test(TS) && /'a person'/.test(TS) && /'you'/.test(TS) && /Verified by ' \+ by \+ ' \\u2014 ' \+ nV|Verified by ' \+ by \+ ' — ' \+ nV/.test(TS)
  && /the value shown has changed since/.test(TS) && /Verified history \(/.test(TS) && /Verified at acquisition as <b>/.test(TS));
t('F16 P5-3 NEVER replaces a shown value: every lease row is still built from rec.lease.* and rendered from r[1]; the decision only adds the line beneath (r[2])',
  /leaseRows\.push\(\['Lease type', rec\.lease\.type, _provLine\('lease_type'/.test(TS)
  && /leaseRows\.push\(\['Leased area', rec\.lease\.sqft \+ ' sqft', _provLine\('leased_sqft', rec\.lease\.sqft\)\]\)/.test(TS)
  && /leaseRows\.push\(\['CAM cap', String\(rec\.lease\.cap\), _provLine\('cap', rec\.lease\.cap\)\]\)/.test(TS)
  && /<b>' \+ _esc\(r\[1\]\) \+ '<\/b><\/div>' \+ \(r\[2\] \|\| ''\)/.test(TS));
t('F17 the decider is never named from data: no displayName/email/profile read in the Space file\'s P5-3 block; only "you" (the signed-in uid) or "a person"',
  (() => { const blk = TS.slice(TS.indexOf('var _lhV = '), TS.indexOf('var leaseHtml = ')); return blk.length > 0 && !/displayName|email|profile|full_name|_esc\([^)]*decidedBy/.test(blk) && /_signedInUid\(\)/.test(blk) && /_who\(e\.decidedBy\)/.test(blk); })());
t('F12 a document another member uploaded is labelled as on file, without a link (docLinkHtml renders a missing url inert)', /uploadedByOther \? '<span class="ts-doc-when ts-doc-other">on file/.test(TS));
t('F13 PropertyRecord is UNCHANGED and reads rec.leaseDocs on the same path (so Ask AI sees the same documents without wiring)', /for \(const d of _arr\(rec\.leaseDocs\)\)/.test(PR) && !/PropertyLeaseholds|leasehold/.test(PR));
t('F14 field-provenance.js is untouched by P5-2', !/PropertyLeaseholds|acquisition_term_decisions/.test(fs.readFileSync(path.join(__dirname, 'field-provenance.js'), 'utf8')));
t('F15 index.html loads the module before script.js and tenant-space.js', (() => { const H = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'); const a = H.indexOf('property-leaseholds.js'), b = H.indexOf('<script src="script.js">'), c = H.indexOf('<script src="tenant-space.js">'); return a > 0 && a < b && b < c; })());

// ── G  P5-3: what stands, per leasehold ─────────────────────────────────────
sec('G  P5-3: the standing decisions of each leasehold (Maple\'s 27 live rows)');
const { MAPLE_DECISIONS } = require('./test-decision-standing.js');
const AT = require('./acquisition-terms.js');
const AMEND = 'e6a60a25-0c1f-4759-b135-7ed0bcfd67bf', LEASE = '3fc9463f-230e-424c-8bba-7dfacafd6a98';
const G = PL.build(deepFreeze({ propertyId: P, currentUid: OWN, families: FAMILIES, documents: DOCS, decisions: MAPLE_DECISIONS, tenants: TENANTS }));
const gs = G.byLeaseholdId[F.shoprite], gl = G.byLeaseholdId[F.luxe], gsun = G.byLeaseholdId[F.sunrise];
eq(G.decisionCount, 27, 'G1 all 27 decisions load into the projection');
eq(gs.decisions.length, 24, 'G2 ShopRite: 24');
eq(gl.decisions.length, 3, 'G3 Luxe: 3');
const V = gs.verified.byField;
t('G4a ShopRite leased_sqft: the 09-26 correction stands — verified, not entered, value "67000", the amendment cited (linked: this user uploaded it)',
  V.leased_sqft && V.leased_sqft.action === 'correct' && V.leased_sqft.verified === true && V.leased_sqft.entered === false && V.leased_sqft.rejected === false
  && V.leased_sqft.value === '67000' && V.leased_sqft.decisionId === 'ac6c910d-0cd8-40b4-9587-955cb4f215ec'
  && V.leased_sqft.source && V.leased_sqft.source.id === AMEND && V.leased_sqft.source.name === 'Maple_Plaza_Test_Lease_Amendment.pdf' && V.leased_sqft.source.live === true && V.leased_sqft.source.url === sp('Maple_Plaza_Test_Lease_Amendment.pdf')
  && V.leased_sqft.decidedAt === '2026-09-26T16:51:27.322+00:00' && V.leased_sqft.label === 'Leased sq ft');
t('G4b cap: a CONFIRM stands — its value is the reading confirmed (previous_value "3"), amendment p. 1, the quote carried',
  V.cap && V.cap.action === 'confirm' && V.cap.verified && V.cap.value === '3' && V.cap.source.id === AMEND && V.cap.sourcePage === 1 && /3% per year/.test(V.cap.sourceQuote) && V.cap.label === 'CAM cap');
t('G4c suite: correct → reopen → confirm — "Anchor Unit A-1" stands, the ShopRite lease p. 1 cited', V.suite && V.suite.action === 'confirm' && V.suite.value === 'Anchor Unit A-1' && V.suite.source.id === LEASE && V.suite.source.name === 'ShopRite_Anchor_Tenant_Lease.pdf' && V.suite.sourcePage === 1);
t('G4d base_rent: confirm 1251250 stands', V.base_rent && V.base_rent.verified && V.base_rent.value === '1251250');
t('G4e admin_fee_pct: an ENTERED correction stands — verified, entered, value "10", no source, the note carried', V.admin_fee_pct && V.admin_fee_pct.verified && V.admin_fee_pct.entered === true && V.admin_fee_pct.value === '10' && V.admin_fee_pct.source === null && /Entered by a person/.test(V.admin_fee_pct.note));
t('G4f audit_rights: confirm → reopen → REJECT — rejected stands: not verified, not entered', V.audit_rights && V.audit_rights.rejected === true && V.audit_rights.verified === false && V.audit_rights.entered === false && V.audit_rights.actionLabel === 'Rejected');
t('G4g security_deposit: correct → REOPEN — nothing stands: absent from byField, listed as open', !('security_deposit' in V) && JSON.stringify(gs.verified.openFields) === '["security_deposit"]');
eq(gs.verified.fields.map(e => e.field), ['cap', 'audit_rights', 'suite', 'base_rent', 'leased_sqft', 'admin_fee_pct'], 'G4h the standing entries, in order of the field\'s first decision');
t('G4i Luxe end_date: correct → reopen → correct — "2031-07-07" stands, entered', gl.verified.byField.end_date && gl.verified.byField.end_date.value === '2031-07-07' && gl.verified.byField.end_date.entered === true && gl.verified.byField.end_date.label === 'Expiration');
// PARITY with the Acquisition Review's own rule, per family, per field — the
// projection's standing decision IS AcquisitionTerms.latestDecision's row.
let parityN = 0; const parityBad = [];
[[F.shoprite, gs], [F.luxe, gl], [F.sunrise, gsun]].forEach(([fid, entry]) => {
  const rows = MAPLE_DECISIONS.filter(r => r.family_id === fid);
  Object.keys(AT.FIELD_META).forEach(f => {
    parityN++;
    const want = AT.latestDecision(rows, f), got = entry.verified.byField[f] || null;
    if ((want === null) !== (got === null) || (want && got.decisionId !== want.id)) parityBad.push(fid.slice(0, 8) + '/' + f);
  });
});
eq(parityBad, [], `G5 PARITY: for every leasehold × every one of the 27 fields, the standing entry is exactly AcquisitionTerms.latestDecision\'s row (or both null) — ${parityN} comparisons`);
const shuf = MAPLE_DECISIONS.slice(); for (let i = shuf.length - 1, s = 99; i > 0; i--) { s = (s * 1103515245 + 12345) & 0x7fffffff; const j = s % (i + 1); [shuf[i], shuf[j]] = [shuf[j], shuf[i]]; }
const Gsh = PL.build({ propertyId: P, currentUid: OWN, families: FAMILIES, documents: DOCS, decisions: shuf });
t('G5b shuffled input → the same standing entries and the same history order (decided_at, not arrival)',
  JSON.stringify(Gsh.byLeaseholdId[F.shoprite].verified) === JSON.stringify(gs.verified) && JSON.stringify(Gsh.byLeaseholdId[F.shoprite].decisions.map(d => d.id)) === JSON.stringify(gs.decisions.map(d => d.id)));
const reopened = PL.build({ propertyId: P, currentUid: OWN, families: FAMILIES, documents: DOCS, decisions: MAPLE_DECISIONS.concat([dec({ id: 'x-reopen', family_id: F.shoprite, field_key: 'leased_sqft', action: 'reopen', previous_value: '67000', decided_at: '2026-09-27T00:00:00Z', created_at: '2026-09-27T00:00:00Z' })]) });
t('G5c a later reopen of leased_sqft: nothing stands for it (open), the other five still do, the history has 25',
  !('leased_sqft' in reopened.byLeaseholdId[F.shoprite].verified.byField) && reopened.byLeaseholdId[F.shoprite].verified.openFields.includes('leased_sqft') && reopened.byLeaseholdId[F.shoprite].verified.counts.fieldsVerified === 4 && reopened.byLeaseholdId[F.shoprite].decisions.length === 25);
// Same name, another leasehold / another property.
const twin = fam('99999999-9999-4999-8999-999999999999', 'ShopRite Supermarkets, Inc.');
const Gtwin = PL.build({ propertyId: P, currentUid: OWN, families: FAMILIES.concat([twin]), documents: DOCS, decisions: MAPLE_DECISIONS });
t('G6a a second leasehold with the SAME label on this property receives none of the 24 — decisions follow the family id, never the name',
  Gtwin.byLeaseholdId['99999999-9999-4999-8999-999999999999'].decisions.length === 0 && Gtwin.byLeaseholdId['99999999-9999-4999-8999-999999999999'].verified.counts.decisions === 0 && Gtwin.byLeaseholdId[F.shoprite].decisions.length === 24);
const Gforeign = PL.build({ propertyId: P, currentUid: OWN, families: FAMILIES, documents: DOCS, decisions: MAPLE_DECISIONS.concat([dec({ id: 'x-foreign', family_id: F.shoprite, property_id: OTHER_P, field_key: 'leased_sqft', action: 'correct', previous_value: '67000', new_value: '1', decided_at: '2026-09-27T00:00:00Z', created_at: '2026-09-27T00:00:00Z' })]) });
t('G6b a decision that names ANOTHER property is dropped before the rule runs: leased_sqft still stands at 67000', Gforeign.byLeaseholdId[F.shoprite].verified.byField.leased_sqft.value === '67000' && Gforeign.byLeaseholdId[F.shoprite].decisions.length === 24);
// Sources.
const sourced = gs.decisions.filter(d => d.source);
eq([sourced.length, sourced.every(d => !d.source.missing), Array.from(new Set(sourced.map(d => d.source.name))).sort()], [18, true, ['Maple_Plaza_Test_Lease_Amendment.pdf', 'ShopRite_Anchor_Tenant_Lease.pdf']], 'G7a the 18 sourced rows resolve BY ID to the two documents; the 6 unsourced carry null');
const oldCite = PL.build({ propertyId: P, currentUid: OWN, families: FAMILIES, documents: DOCS, decisions: [dec({ id: 'x-old', family_id: F.shoprite, field_key: 'cap', action: 'confirm', previous_value: '3', source_document_id: 'shop-old-version', decided_at: '2026-09-20T01:00:00Z', created_at: '2026-09-20T01:00:00Z' })] }).byLeaseholdId[F.shoprite].verified.byField.cap.source;
eq([oldCite.name, oldCite.live, oldCite.url, oldCite.missing], ['ShopRite_Lease_OLD_SCAN.pdf', false, null, false], 'G7b a source that is SUPERSEDED now resolves by name (that is what was cited) with url null (not on file to open)');
const gone = PL.build({ propertyId: P, currentUid: OWN, families: FAMILIES, documents: DOCS, decisions: [dec({ id: 'x-gone', family_id: F.shoprite, field_key: 'cap', action: 'confirm', previous_value: '3', source_document_id: 'no-such-doc', decided_at: '2026-09-20T01:00:00Z', created_at: '2026-09-20T01:00:00Z' })] }).byLeaseholdId[F.shoprite].verified.byField.cap.source;
eq([gone.missing, gone.url, gone.id], [true, null, 'no-such-doc'], 'G7c a source row that no longer exists is marked missing, never linked, never invented');
const asOther = PL.build({ propertyId: P, currentUid: OTHER_UID, families: FAMILIES, documents: DOCS, decisions: MAPLE_DECISIONS }).byLeaseholdId[F.shoprite].verified.byField.leased_sqft.source;
eq([asOther.name, asOther.live, asOther.url, asOther.uploadedByOther], ['Maple_Plaza_Test_Lease_Amendment.pdf', true, null, true], 'G7d another member sees the cited document\'s NAME but gets no url (the P5-2 uploader rule)');
// Who and when.
t('G8 decidedBy and decidedAt are carried as the row holds them — a uid, never a name (there is no directory to name anyone from); "you"/"a person" is the surface\'s call',
  gs.verified.fields.every(e => e.decidedBy === OWN && typeof e.decidedAt === 'string') && !/displayName|email|name:/.test(JSON.stringify(gs.verified.fields.map(e => Object.assign({}, e, { source: null, label: null })))) );
// matchesShown.
eq([PL.matchesShown('leased_sqft', '67,000', 67000), PL.matchesShown('leased_sqft', '67000', '67,000 '), PL.matchesShown('leased_sqft', '65000', 67000), PL.matchesShown('cap', '3', 3), PL.matchesShown('cap', '3', '3%'), PL.matchesShown('base_rent', '1251250', '$1,251,250.00')],
   [true, true, false, true, true, true], 'G9a quantities compare as numbers: 67,000 = 67000; 65000 ≠ 67000; 3 = 3%; 1251250 = $1,251,250.00');
eq([PL.matchesShown('end_date', '2031-07-07', '2031-07-07'), PL.matchesShown('end_date', '2031-07-07', '2031-07-08'), PL.matchesShown('lease_type', 'NNN', ' nnn'), PL.matchesShown('suite', 'Anchor Unit A-1', 'Anchor Unit A-3')],
   [true, false, true, false], 'G9b dates exact; enums/text trimmed and case-insensitive');
eq([PL.matchesShown('leased_sqft', null, 67000), PL.matchesShown('leased_sqft', '67000', null), PL.matchesShown('end_date', '', ''), PL.matchesShown('leased_sqft', 'abc', 'abc')], [false, false, false, false], 'G9c an absent value never matches (two absences are not "verified as shown"); non-numeric text in a numeric field never matches');
// The projection carries no tenant value and changes none.
const Gedited = PL.build({ propertyId: P, currentUid: OWN, families: FAMILIES, documents: DOCS, decisions: MAPLE_DECISIONS, tenants: [{ id: F.shoprite, tenant_name: 'ShopRite Supermarkets, Inc.', leased_sqft: '70000' }] });
t('G10 the standing value comes from the DECISION, never from the tenant row, and the tenant row is not touched: with the tenant edited to 70000 the projection still says 67000 and carries no tenant',
  Gedited.byLeaseholdId[F.shoprite].verified.byField.leased_sqft.value === '67000' && !('tenant' in Gedited.byLeaseholdId[F.shoprite]) && !('tenants' in Gedited) && TENANTS.find(x => x.id === F.shoprite).leased_sqft === '67000');
t('G11 property-leaseholds.js still touches no storage API and never requires the acquisition resolver (E9 + D8 of the standing suite hold): the `verified` projection is a value, not a store',
  !/localStorage|sessionStorage|indexedDB|properties\.data|\.data\.|JSON\.stringify\(|acquisition-terms|AcquisitionTerms/.test(fs.readFileSync(path.join(__dirname, 'property-leaseholds.js'), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')));
eq(gs.verified.counts, { decisions: 24, fieldsDecided: 7, fieldsVerified: 5, fieldsEntered: 1, fieldsRejected: 1, fieldsOpen: 1 }, 'G12a ShopRite counts: 24 decisions · 7 fields decided · 5 verified · 1 entered · 1 rejected · 1 open');
eq(gl.verified.counts, { decisions: 3, fieldsDecided: 1, fieldsVerified: 1, fieldsEntered: 1, fieldsRejected: 0, fieldsOpen: 0 }, 'G12b Luxe counts: 3 · 1 · 1 · 1 · 0 · 0');
eq([gs.verified.lastAt, gl.verified.lastAt], ['2026-09-26T16:51:27.322+00:00', '2026-09-25T23:29:00.42+00:00'], 'G12c lastAt: the last decided_at of each');
eq([gsun.verified.counts.decisions, gsun.verified.fields.length, gsun.verified.lastAt, gsun.decisions.length], [0, 0, null, 0], 'G12d Sunrise (never decided about): zeros, no fields, no lastAt — the surface shows nothing');
// The history rows.
const h0 = gs.decisions[0], hc = gs.decisions.find(d => d.id === 'ac6c910d-0cd8-40b4-9587-955cb4f215ec'), hr = gs.decisions.find(d => d.action === 'reject');
t('G13 every history row carries its label, its action as a word, the value it fixed and the cited document: cap · Confirmed · "3" · amendment; the correction 65000 → 67000; the rejection of Audit rights',
  h0.label === 'CAM cap' && h0.actionLabel === 'Confirmed' && h0.value === '3' && h0.source.name === 'Maple_Plaza_Test_Lease_Amendment.pdf' && h0.sourcePage === 1
  && hc.actionLabel === 'Corrected' && hc.previousValue === '65000' && hc.newValue === '67000' && hc.value === '67000'
  && hr.label === 'Audit rights' && hr.actionLabel === 'Rejected' && hr.source === null);
const unknownAct = PL.build({ propertyId: P, currentUid: OWN, families: FAMILIES, documents: DOCS, decisions: MAPLE_DECISIONS.concat([dec({ id: 'x-approve', family_id: F.shoprite, field_key: 'leased_sqft', action: 'approve', new_value: '1', decided_at: '2026-09-27T00:00:00Z', created_at: '2026-09-27T00:00:00Z' })]) }).byLeaseholdId[F.shoprite];
t('G14 an unknown action is not a decision: it stands for nothing and is not counted (24, not 25), though the raw row remains in the history list', unknownAct.verified.byField.leased_sqft.value === '67000' && unknownAct.verified.counts.decisions === 24 && unknownAct.decisions.length === 25);
t('G15 D1 still holds after §G: the frozen fixtures are unchanged', DOCS.length === 9 && FAMILIES.length === 5 && MAPLE_DECISIONS.length === 27 && Object.isFrozen(MAPLE_DECISIONS[0]));

console.log(`\n${'─'.repeat(58)}\nRESULT: ${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILED:'); failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
