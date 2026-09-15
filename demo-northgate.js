/**
 * demo-northgate.js — the Northgate Exchange demonstration property, as data.
 *
 * WHY THIS IS A FILE AND NOT A LITERAL INSIDE script.js.
 *
 * Three things have to agree about this property and can never be allowed to
 * drift: the seeded tenant and invoice records, the lease PDFs a citation would
 * resolve into, and the invoice PDFs that make the expense pool substantiated.
 * Cascade Commons keeps its numbers inline and its lease document in a separate
 * HTML file, and test-demo-lease.js exists precisely to catch the two drifting
 * apart. Here the numbers are stated once and everything else is generated from
 * them: the seeder (script.js ensureNorthgateDemo), the document generator
 * (tools/build-demo-northgate.js) and the consistency test all read this.
 *
 * WHAT THIS PROPERTY IS FOR. Cascade Commons demonstrates that MainStreet knows
 * when NOT to bill: every one of its invoices lacks a source document, so a red
 * property-wide finding holds every statement, and one Modified Gross tenant is
 * held on top of that. Northgate Exchange is the other half of the same claim —
 * a property whose evidence and lease terms genuinely support billing. It is
 * not engineered around the safeguards; it satisfies them:
 *
 *   · every invoice carries a real generated source document
 *   · every lease is NNN, spans the whole CAM year, and has its own document
 *   · no lease states a provision the CAM engine does not apply (an expense
 *     stop, a gross-up, a base year, an admin fee, a pro-rata method), each of
 *     which blocks billing by design
 *   · the space the leases do not cover is recorded as vacant, so coverage is
 *     accounted for rather than unresolved
 *   · fieldEvidence is EMPTY, exactly as on Cascade. Citations come from running
 *     a document through extraction; seeding them would be fabrication, and the
 *     Evidence Viewer would fail to highlight a quote the PDF does not contain.
 *
 * Nothing here is real. Every party, vendor and address is fictional.
 */
(function (root, factory) {
  const api = factory();
  if (root) root.DemoNorthgate = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const CAM_YEAR     = 2025;
  // Bumping this re-seeds the property once for every user holding an older
  // copy, the same contract Cascade's _demoV carries.
  const DEMO_VERSION = 1;

  const PROPERTY = {
    name:      'Northgate Exchange',
    address:   '1820 Northgate Boulevard, Boise, ID 83704',
    parcel:    'ADA-31-2208-1140',
    owner:     'Northgate Exchange Partners, LLC',
    manager:   'Halloran Property Management',
    // Rentable area of the whole centre. Leases cover 20,100 of it; the
    // remaining 3,900 is Suite 150, recorded vacant below, so the two account
    // for the building exactly.
    totalSqft: 24000,
  };

  // A neighbourhood retail centre: one apparel anchor, a café, a dental
  // practice, a dry cleaner and a veterinary clinic. Every lease is NNN and
  // runs through the whole of 2025, so no tenant is billed for a period its
  // lease did not cover.
  //
  // CAPS. Three leases carry a percentage cap over a stated prior-year base.
  // Two of them bite this year and one does not, which is the honest picture:
  // a cap is a ceiling, not a discount, and a year inside the ceiling shows the
  // cap being respected rather than applied.
  const TENANTS = [
    {
      key: 'ridgeline',
      tenant_name: 'Ridgeline Outfitters',
      suite: '100', leased_sqft: 8400,
      start_date: '2020-06-01', end_date: '2030-05-31',
      lease_type: 'NNN',
      cap: 5, capBaseAmount: 33400,
      excluded_categories: '',
      audit_rights: true, auditDays: 120,
      signedOn: 'April 28, 2020',
      // Rent figures appear in the lease document and nowhere in the CAM path.
      base_rent: 176400, security_deposit: 29400,
      use: 'retail sale of outdoor apparel and equipment',
    },
    {
      key: 'cornerpost',
      tenant_name: 'Corner Post Café',
      suite: '110', leased_sqft: 2100,
      start_date: '2022-09-01', end_date: '2027-08-31',
      lease_type: 'NNN',
      cap: null, capBaseAmount: null,
      // THE EXCLUSION THIS PROPERTY DEMONSTRATES. A small tenant that
      // negotiated the management fee out of its CAM obligation. It is applied
      // by the engine, so the café's share is struck from a pool with the
      // management invoices removed, and the explanation says so.
      excluded_categories: 'management',
      audit_rights: true, auditDays: 90,
      signedOn: 'July 15, 2022',
      base_rent: 63000, security_deposit: 10500,
      use: 'a coffee house and bakery',
    },
    {
      key: 'dental',
      tenant_name: 'Northgate Family Dental',
      suite: '120', leased_sqft: 3600,
      start_date: '2021-04-01', end_date: '2029-03-31',
      lease_type: 'NNN',
      cap: 4, capBaseAmount: 14900,
      excluded_categories: '',
      audit_rights: true, auditDays: 90,
      signedOn: 'February 19, 2021',
      base_rent: 97200, security_deposit: 16200,
      use: 'a general and family dental practice',
    },
    {
      key: 'brightlane',
      tenant_name: 'Bright Lane Cleaners',
      suite: '130', leased_sqft: 1800,
      start_date: '2023-01-01', end_date: '2028-12-31',
      lease_type: 'NNN',
      cap: null, capBaseAmount: null,
      excluded_categories: '',
      audit_rights: true, auditDays: 90,
      signedOn: 'November 8, 2022',
      base_rent: 48600, security_deposit: 8100,
      use: 'a retail dry cleaning and laundry outlet',
    },
    {
      key: 'lakeside',
      tenant_name: 'Lakeside Veterinary Clinic',
      suite: '140', leased_sqft: 4200,
      start_date: '2022-03-01', end_date: '2027-02-28',
      lease_type: 'NNN',
      // This cap does NOT bite in 2025 — the year lands inside the ceiling.
      cap: 6, capBaseAmount: 18200,
      excluded_categories: '',
      audit_rights: true, auditDays: 90,
      signedOn: 'January 12, 2022',
      base_rent: 109200, security_deposit: 18200,
      use: 'a small animal veterinary clinic',
    },
  ];

  // The space no lease covers, recorded as vacant rather than left unresolved.
  // 20,100 leased + 3,900 vacant = 24,000, so the coverage finding can account
  // for the whole building and reads green instead of amber.
  const VACANCY = { suite: '150', leased_sqft: 3900 };

  // A plausible 2025 operating year: $107,900 over 24,000 sqft is $4.50/sqft,
  // which is ordinary for neighbourhood retail. Insurance is the largest single
  // bill at 24.5% of the pool, comfortably inside the 40% concentration
  // threshold that would otherwise raise a materiality finding.
  //
  // Recurring vendors repeat by quarter with different dates and amounts, so
  // nothing here reads as a duplicate invoice.
  const INVOICES = [
    { n: 'NE-2025-0001', vendorName: 'Cedar Ridge Insurance Group',  amount: 26400, category: 'insurance',   invoiceDate: '2025-01-10', desc: 'Commercial property and general liability premium, policy year 2025' },
    { n: 'NE-2025-0002', vendorName: 'Halloran Property Management', amount:  6000, category: 'management',  invoiceDate: '2025-03-31', desc: 'Property management fee, first quarter 2025' },
    { n: 'NE-2025-0003', vendorName: 'Northgate Utilities Co-op',    amount:  6900, category: 'utilities',   invoiceDate: '2025-03-31', desc: 'Common area electricity and water, first quarter 2025' },
    { n: 'NE-2025-0004', vendorName: 'PureStart Facility Services',  amount:  4500, category: 'janitorial',  invoiceDate: '2025-03-31', desc: 'Common area porter and restroom service, first quarter 2025' },
    { n: 'NE-2025-0005', vendorName: 'Evergreen Grounds Care',       amount:  3600, category: 'landscaping', invoiceDate: '2025-04-15', desc: 'Spring bed preparation, mulch and irrigation start-up' },
    { n: 'NE-2025-0006', vendorName: 'Halloran Property Management', amount:  6000, category: 'management',  invoiceDate: '2025-06-30', desc: 'Property management fee, second quarter 2025' },
    { n: 'NE-2025-0007', vendorName: 'Northgate Utilities Co-op',    amount:  7400, category: 'utilities',   invoiceDate: '2025-06-30', desc: 'Common area electricity and water, second quarter 2025' },
    { n: 'NE-2025-0008', vendorName: 'PureStart Facility Services',  amount:  4500, category: 'janitorial',  invoiceDate: '2025-06-30', desc: 'Common area porter and restroom service, second quarter 2025' },
    { n: 'NE-2025-0009', vendorName: 'Evergreen Grounds Care',       amount:  4400, category: 'landscaping', invoiceDate: '2025-07-31', desc: 'Summer mowing, shrub trimming and irrigation repair' },
    { n: 'NE-2025-0010', vendorName: 'Summit Mechanical Services',   amount:  2800, category: 'maintenance', invoiceDate: '2025-08-14', desc: 'Rooftop unit service, filters and belt replacement, four units' },
    { n: 'NE-2025-0011', vendorName: 'Halloran Property Management', amount:  6000, category: 'management',  invoiceDate: '2025-09-30', desc: 'Property management fee, third quarter 2025' },
    { n: 'NE-2025-0012', vendorName: 'Northgate Utilities Co-op',    amount:  8100, category: 'utilities',   invoiceDate: '2025-09-30', desc: 'Common area electricity and water, third quarter 2025' },
    { n: 'NE-2025-0013', vendorName: 'PureStart Facility Services',  amount:  4500, category: 'janitorial',  invoiceDate: '2025-09-30', desc: 'Common area porter and restroom service, third quarter 2025' },
    { n: 'NE-2025-0014', vendorName: 'Beacon Parking Lot Services',  amount:  5200, category: 'repairs',     invoiceDate: '2025-10-15', desc: 'Parking field seal coat and restriping, 96 stalls' },
    { n: 'NE-2025-0015', vendorName: 'Halloran Property Management', amount:  6000, category: 'management',  invoiceDate: '2025-12-31', desc: 'Property management fee, fourth quarter 2025' },
    { n: 'NE-2025-0016', vendorName: 'Northgate Utilities Co-op',    amount:  5600, category: 'utilities',   invoiceDate: '2025-12-31', desc: 'Common area electricity and water, fourth quarter 2025' },
  ];

  // ── Derivations every reader shares, so none of them recomputes it ─────────
  function leasedSqft()  { return TENANTS.reduce((s, t) => s + t.leased_sqft, 0); }
  function poolTotal()   { return INVOICES.reduce((s, i) => s + i.amount, 0); }
  // Each lease's share of the BUILDING, to two decimals — the same figure the
  // engine strikes and the lease document states.
  function proRataPct(t) {
    return Math.round((t.leased_sqft / PROPERTY.totalSqft) * 10000) / 100;
  }
  function leaseFileName(t) { return 'lease-northgate-' + t.key + '.pdf'; }
  function leasePath(t)     { return 'assets/demo/northgate/' + leaseFileName(t); }
  function invoiceFileName(inv) { return 'invoice-' + inv.n.toLowerCase() + '.pdf'; }
  function invoicePath(inv) { return 'assets/demo/northgate/invoices/' + invoiceFileName(inv); }

  return {
    CAM_YEAR, DEMO_VERSION, PROPERTY, TENANTS, VACANCY, INVOICES,
    leasedSqft, poolTotal, proRataPct,
    leaseFileName, leasePath, invoiceFileName, invoicePath,
  };
});
