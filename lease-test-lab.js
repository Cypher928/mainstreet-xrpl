/**
 * lease-test-lab.js — Phase 17: Lease Intelligence Test Lab
 *
 * Exposes window.LeaseTestLab as an IIFE.
 * Pure functions — no DOM, no network, no global mutations.
 */
(function () {
  'use strict';

  // ─── Module-level counters per level for deterministic cycling ───────────────
  const _levelCounters = { easy: 0, medium: 0, hard: 0, nightmare: 0 };

  // ─── SCENARIO REGISTRY (20 hardcoded scenarios) ──────────────────────────────
  const SCENARIO_REGISTRY = [

    // ── EASY 1 ─────────────────────────────────────────────────────────────────
    {
      id: 'easy-001',
      level: 'easy',
      title: 'Clear NNN Lease with CAM Cap and Admin Fee',
      description: 'Basic NNN lease with explicit 5% CAM cap and 10% admin fee — tests clean single-document extraction.',
      leaseText: "Tenant shall pay its pro-rata share of Common Area Maintenance expenses. CAM charges shall not increase more than five percent (5%) per year over the prior year's actual CAM charges. Tenant's pro-rata share shall be calculated based on the ratio of Tenant's leased square footage to total leasable square footage of the Shopping Center. Landlord may charge an administrative fee not to exceed ten percent (10%) of total CAM expenses.",
      amendmentText: null,
      tenant: {
        id: 'easy-001-tenant', tenant_name: 'Test Tenant A', leased_sqft: 2000,
        start_date: '2024-01-01', end_date: '2029-12-31',
        lease_type: 'NNN', cap: 5, admin_fee_pct: 10, gross_up_pct: null,
        expense_stop: null, audit_rights: false, pro_rata_method: 'leased',
        renewal_options: null, amendments: [],
        fieldEvidence: {
          cap: { snapshots: [{ value: 5, quote: 'not increase more than five percent (5%)', confidence: 92, source: 'original_lease', timestamp: '2024-01-01T00:00:00Z' }] },
          admin_fee_pct: { snapshots: [{ value: 10, quote: 'administrative fee not to exceed ten percent (10%)', confidence: 90, source: 'original_lease', timestamp: '2024-01-01T00:00:00Z' }] }
        },
        _confidenceScore: 90, _confidence: 'high',
        _edgeCases: { edgeCases: [], totalConfidenceAdjustment: 0 },
        _explainability: { fieldSummaries: {}, reviewNotes: [], overallSummary: 'Clean NNN lease with explicit CAM cap and admin fee.' },
        _multiDocReasoning: null
      },
      property: null, // populated below
      expected: {
        fields: { cap: 5, admin_fee_pct: 10, lease_type: 'NNN', pro_rata_method: 'leased', gross_up_pct: null, expense_stop: null, audit_rights: false },
        confidenceRange: [80, 100],
        warnings: [],
        amendmentPrecedence: null,
        edgeCases: []
      }
    },

    // ── EASY 2 ─────────────────────────────────────────────────────────────────
    {
      id: 'easy-002',
      level: 'easy',
      title: 'Gross Lease with Renewal Option',
      description: 'Gross lease where landlord pays all CAM — tests lease type detection and renewal option extraction.',
      leaseText: 'This is a Gross Lease. Landlord shall pay all operating expenses including Common Area Maintenance. Tenant shall have one (1) option to renew this Lease for a period of two (2) years, exercisable by written notice to Landlord no later than six (6) months prior to the expiration of the initial Lease Term.',
      amendmentText: null,
      tenant: {
        id: 'easy-002-tenant', tenant_name: 'Test Tenant B', leased_sqft: 1500,
        start_date: '2024-01-01', end_date: '2027-12-31',
        lease_type: 'Gross', cap: null, admin_fee_pct: 0, gross_up_pct: null,
        expense_stop: null, audit_rights: false, pro_rata_method: 'leased',
        renewal_options: '1 option to renew for 2 years; notice required 6 months prior',
        amendments: [],
        fieldEvidence: {
          lease_type: { snapshots: [{ value: 'Gross', quote: 'This is a Gross Lease', confidence: 95, source: 'original_lease', timestamp: '2024-01-01T00:00:00Z' }] },
          renewal_options: { snapshots: [{ value: '1 option to renew for 2 years; notice required 6 months prior', quote: 'one (1) option to renew this Lease for a period of two (2) years', confidence: 88, source: 'original_lease', timestamp: '2024-01-01T00:00:00Z' }] }
        },
        _confidenceScore: 88, _confidence: 'high',
        _edgeCases: { edgeCases: [], totalConfidenceAdjustment: 0 },
        _explainability: { fieldSummaries: {}, reviewNotes: [], overallSummary: 'Gross lease with clean renewal option.' },
        _multiDocReasoning: null
      },
      property: null,
      expected: {
        fields: { lease_type: 'Gross', cap: null, renewal_options: '1 option to renew for 2 years; notice required 6 months prior' },
        confidenceRange: [80, 100],
        warnings: [],
        amendmentPrecedence: null,
        edgeCases: []
      }
    },

    // ── EASY 3 ─────────────────────────────────────────────────────────────────
    {
      id: 'easy-003',
      level: 'easy',
      title: 'Expense Stop with Audit Rights',
      description: 'Modified Gross lease with $8.50/sqft expense stop and 12-month audit window — tests expense stop and audit rights extraction.',
      leaseText: "Tenant shall pay all Operating Expenses in excess of Eight Dollars and Fifty Cents ($8.50) per rentable square foot per year (the 'Expense Stop'). Tenant shall have the right to audit Landlord's books and records relating to Operating Expenses within twelve (12) months after receipt of Landlord's annual reconciliation statement.",
      amendmentText: null,
      tenant: {
        id: 'easy-003-tenant', tenant_name: 'Test Tenant C', leased_sqft: 3000,
        start_date: '2024-01-01', end_date: '2028-12-31',
        lease_type: 'Modified Gross', cap: null, admin_fee_pct: 0, gross_up_pct: null,
        expense_stop: 8.5, audit_rights: true, pro_rata_method: 'leased',
        renewal_options: null, amendments: [],
        fieldEvidence: {
          expense_stop: { snapshots: [{ value: 8.5, quote: 'Eight Dollars and Fifty Cents ($8.50) per rentable square foot', confidence: 94, source: 'original_lease', timestamp: '2024-01-01T00:00:00Z' }] },
          audit_rights: { snapshots: [{ value: true, quote: "right to audit Landlord's books and records...within twelve (12) months", confidence: 91, source: 'original_lease', timestamp: '2024-01-01T00:00:00Z' }] }
        },
        _confidenceScore: 92, _confidence: 'high',
        _edgeCases: { edgeCases: [], totalConfidenceAdjustment: 0 },
        _explainability: { fieldSummaries: {}, reviewNotes: [], overallSummary: 'Clear expense stop with audit rights.' },
        _multiDocReasoning: null
      },
      property: null,
      expected: {
        fields: { expense_stop: 8.5, audit_rights: true, lease_type: 'Modified Gross' },
        confidenceRange: [75, 100],
        warnings: [],
        amendmentPrecedence: null,
        edgeCases: []
      }
    },

    // ── EASY 4 ─────────────────────────────────────────────────────────────────
    {
      id: 'easy-004',
      level: 'easy',
      title: '90% Gross-Up with Occupancy Threshold',
      description: 'Explicit 90% gross-up clause with occupancy threshold and occupied-based pro-rata — tests gross-up and pro-rata method extraction.',
      leaseText: 'In the event that the Building is not at least ninety percent (90%) occupied during any calendar year, Operating Expenses shall be \'grossed up\' to reflect the Operating Expenses that would have been incurred had the Building been ninety percent (90%) occupied. The gross-up calculation shall be applied to variable Operating Expenses only.',
      amendmentText: null,
      tenant: {
        id: 'easy-004-tenant', tenant_name: 'Test Tenant D', leased_sqft: 2500,
        start_date: '2024-01-01', end_date: '2029-12-31',
        lease_type: 'NNN', cap: null, admin_fee_pct: 0, gross_up_pct: 90,
        expense_stop: null, audit_rights: false, pro_rata_method: 'occupied',
        renewal_options: null, amendments: [],
        fieldEvidence: {
          gross_up_pct: { snapshots: [{ value: 90, quote: 'ninety percent (90%) occupied', confidence: 89, source: 'original_lease', timestamp: '2024-01-01T00:00:00Z' }] }
        },
        _confidenceScore: 85, _confidence: 'high',
        _edgeCases: { edgeCases: [], totalConfidenceAdjustment: 0 },
        _explainability: { fieldSummaries: {}, reviewNotes: [], overallSummary: 'Explicit 90% gross-up with occupancy threshold.' },
        _multiDocReasoning: null
      },
      property: null,
      expected: {
        fields: { gross_up_pct: 90, pro_rata_method: 'occupied' },
        confidenceRange: [75, 100],
        warnings: [],
        amendmentPrecedence: null,
        edgeCases: []
      }
    },

    // ── EASY 5 ─────────────────────────────────────────────────────────────────
    {
      id: 'easy-005',
      level: 'easy',
      title: 'NNN Lease with CAM Exclusions List',
      description: 'NNN lease with explicit 5-item CAM exclusion schedule — tests CAM exclusion note extraction.',
      leaseText: 'The following items shall be excluded from Common Area Maintenance expenses: (i) capital expenditures; (ii) depreciation of the Shopping Center or equipment; (iii) management fees in excess of five percent (5%) of gross revenues; (iv) costs of repairs caused by Landlord\'s negligence; (v) debt service on any mortgage or deed of trust encumbering the Shopping Center.',
      amendmentText: null,
      tenant: {
        id: 'easy-005-tenant', tenant_name: 'Test Tenant E', leased_sqft: 1800,
        start_date: '2024-01-01', end_date: '2028-12-31',
        lease_type: 'NNN', cap: null, admin_fee_pct: 5, gross_up_pct: null,
        expense_stop: null, audit_rights: false, pro_rata_method: 'leased',
        renewal_options: null, amendments: [],
        fieldEvidence: {
          admin_fee_pct: { snapshots: [{ value: 5, quote: 'management fees in excess of five percent (5%)', confidence: 78, source: 'original_lease', timestamp: '2024-01-01T00:00:00Z' }] }
        },
        _confidenceScore: 82, _confidence: 'high',
        _edgeCases: { edgeCases: [], totalConfidenceAdjustment: 0 },
        _explainability: { fieldSummaries: {}, reviewNotes: ['CAM exclusions list present — verify completeness'], overallSummary: 'NNN lease with explicit CAM exclusion schedule.' },
        _multiDocReasoning: null
      },
      property: null,
      expected: {
        fields: { lease_type: 'NNN', admin_fee_pct: 5 },
        confidenceRange: [75, 100],
        warnings: ['exclusions'],
        amendmentPrecedence: null,
        edgeCases: []
      }
    },

    // ── MEDIUM 1 ───────────────────────────────────────────────────────────────
    {
      id: 'medium-001',
      level: 'medium',
      title: 'Amendment Reduces CAM Cap from 5% to 3%',
      description: 'One amendment overrides the original CAM cap — tests amendment precedence resolution for a single field.',
      leaseText: "CAM charges shall not increase more than five percent (5%) per year.",
      amendmentText: "Section 4.3 of the Lease is hereby amended to provide that CAM charges shall not increase more than three percent (3%) per year over the prior year's actual CAM charges, effective January 1, 2024.",
      tenant: {
        id: 'medium-001-tenant', tenant_name: 'Test Tenant F', leased_sqft: 2200,
        start_date: '2022-01-01', end_date: '2027-12-31',
        lease_type: 'NNN', cap: 3, admin_fee_pct: 10, gross_up_pct: null,
        expense_stop: null, audit_rights: false, pro_rata_method: 'leased',
        renewal_options: null,
        amendments: [{
          amendmentId: 'amd-001', effectiveDate: '2024-01-01', uploadedAt: '2024-01-15T00:00:00Z',
          fileName: 'Amendment_1.pdf', overriddenFields: ['cap'], extractedFields: { cap: 3 }
        }],
        fieldEvidence: {
          cap: {
            snapshots: [
              { value: 5, quote: 'five percent (5%) per year', confidence: 85, source: 'original_lease', timestamp: '2024-01-01T00:00:00Z', supersededBy: 'amd-001' },
              { value: 3, quote: 'three percent (3%) per year', confidence: 90, source: 'amendment', timestamp: '2024-01-15T00:00:00Z' }
            ]
          }
        },
        _confidenceScore: 82, _confidence: 'high',
        _edgeCases: { edgeCases: [], totalConfidenceAdjustment: 0 },
        _explainability: { fieldSummaries: {}, reviewNotes: ['Amendment reduced CAM cap from 5% to 3%'], overallSummary: 'NNN lease amended to reduce CAM cap.' },
        _multiDocReasoning: null
      },
      property: null,
      expected: {
        fields: { cap: 3, lease_type: 'NNN' },
        confidenceRange: [70, 95],
        warnings: [],
        amendmentPrecedence: { winningDocType: 'amendment', governingField: 'cap', expectedValue: 3 },
        edgeCases: []
      }
    },

    // ── MEDIUM 2 ───────────────────────────────────────────────────────────────
    {
      id: 'medium-002',
      level: 'medium',
      title: 'Ambiguous Admin Fee — "Reasonable" Amount',
      description: 'Admin fee clause uses undefined "reasonable" language — tests low-confidence extraction and missing quantity detection.',
      leaseText: 'Landlord may charge a reasonable administrative fee to cover the costs of administering the Common Area Maintenance reconciliation. Such fee shall be consistent with fees charged for comparable shopping centers in the market area.',
      amendmentText: null,
      tenant: {
        id: 'medium-002-tenant', tenant_name: 'Test Tenant G', leased_sqft: 2000,
        start_date: '2024-01-01', end_date: '2028-12-31',
        lease_type: 'NNN', cap: 5, admin_fee_pct: null, gross_up_pct: null,
        expense_stop: null, audit_rights: false, pro_rata_method: 'leased',
        renewal_options: null, amendments: [],
        fieldEvidence: {
          admin_fee_pct: { snapshots: [{ value: null, quote: 'reasonable administrative fee', confidence: 35, source: 'original_lease', timestamp: '2024-01-01T00:00:00Z' }] }
        },
        _confidenceScore: 55, _confidence: 'medium',
        _edgeCases: { edgeCases: [], totalConfidenceAdjustment: 0 },
        _explainability: { fieldSummaries: {}, reviewNotes: ['Admin fee not quantified — requires negotiation or market comparison'], overallSummary: 'Admin fee clause present but amount undefined.' },
        _multiDocReasoning: null
      },
      property: null,
      expected: {
        fields: { admin_fee_pct: null },
        confidenceRange: [40, 70],
        warnings: [],
        amendmentPrecedence: null,
        edgeCases: []
      }
    },

    // ── MEDIUM 3 ───────────────────────────────────────────────────────────────
    {
      id: 'medium-003',
      level: 'medium',
      title: 'Modified Gross — Partial CAM Pass-Through (HVAC Only)',
      description: 'Only HVAC costs passed through in a Modified Gross lease — tests partial CAM structure detection.',
      leaseText: 'This Lease is a Modified Gross Lease. Tenant shall pay its pro-rata share of HVAC maintenance and repair costs only. All other Common Area Maintenance expenses, including but not limited to parking lot maintenance, landscaping, and security, shall be paid by Landlord and shall not be passed through to Tenant.',
      amendmentText: null,
      tenant: {
        id: 'medium-003-tenant', tenant_name: 'Test Tenant H', leased_sqft: 1600,
        start_date: '2024-01-01', end_date: '2027-12-31',
        lease_type: 'Modified Gross', cap: null, admin_fee_pct: 0, gross_up_pct: null,
        expense_stop: null, audit_rights: false, pro_rata_method: 'leased',
        renewal_options: null, amendments: [],
        fieldEvidence: {
          lease_type: { snapshots: [{ value: 'Modified Gross', quote: 'Modified Gross Lease', confidence: 90, source: 'original_lease', timestamp: '2024-01-01T00:00:00Z' }] }
        },
        _confidenceScore: 70, _confidence: 'medium',
        _edgeCases: { edgeCases: [], totalConfidenceAdjustment: 0 },
        _explainability: { fieldSummaries: {}, reviewNotes: ['Partial CAM pass-through: HVAC only — unusual structure requiring detailed tracking'], overallSummary: 'Modified Gross with limited CAM scope.' },
        _multiDocReasoning: null
      },
      property: null,
      expected: {
        fields: { lease_type: 'Modified Gross', cap: null },
        confidenceRange: [60, 85],
        warnings: [],
        amendmentPrecedence: null,
        edgeCases: []
      }
    },

    // ── MEDIUM 4 ───────────────────────────────────────────────────────────────
    {
      id: 'medium-004',
      level: 'medium',
      title: 'Contingent Commencement Date',
      description: 'Lease start date contingent on delivery condition — tests extraction when key dates cannot be determined.',
      leaseText: "The Lease Term shall commence on the earlier of (i) the date Tenant opens for business to the public, or (ii) ninety (90) days following the Delivery Date (as defined herein). The 'Delivery Date' shall mean the date upon which Landlord delivers possession of the Premises to Tenant in the Delivery Condition specified in Exhibit B.",
      amendmentText: null,
      tenant: {
        id: 'medium-004-tenant', tenant_name: 'Test Tenant I', leased_sqft: 2800,
        start_date: null, end_date: '2028-12-31',
        lease_type: 'NNN', cap: 5, admin_fee_pct: 10, gross_up_pct: null,
        expense_stop: null, audit_rights: false, pro_rata_method: 'leased',
        renewal_options: null, amendments: [],
        fieldEvidence: {},
        _confidenceScore: 62, _confidence: 'medium',
        _edgeCases: { edgeCases: [], totalConfidenceAdjustment: 0 },
        _explainability: { fieldSummaries: {}, reviewNotes: ['Commencement date is contingent — cannot be determined from lease text alone'], overallSummary: 'Contingent commencement date requires delivery date confirmation.' },
        _multiDocReasoning: null
      },
      property: null,
      expected: {
        fields: { cap: 5 },
        confidenceRange: [55, 80],
        warnings: [],
        amendmentPrecedence: null,
        edgeCases: []
      }
    },

    // ── MEDIUM 5 ───────────────────────────────────────────────────────────────
    {
      id: 'medium-005',
      level: 'medium',
      title: 'Conditional Renewal Option',
      description: 'Renewal option conditioned on no default and no sublease — tests conditional clause extraction.',
      leaseText: "Tenant shall have one (1) option to renew the Lease for an additional period of three (3) years, at the then-current market rent, provided that: (a) Tenant is not in default under this Lease at the time of exercise or at the commencement of the Renewal Term; and (b) Tenant has not assigned this Lease or sublet more than fifty percent (50%) of the Premises.",
      amendmentText: null,
      tenant: {
        id: 'medium-005-tenant', tenant_name: 'Test Tenant J', leased_sqft: 2100,
        start_date: '2024-01-01', end_date: '2028-12-31',
        lease_type: 'NNN', cap: 5, admin_fee_pct: 10, gross_up_pct: null,
        expense_stop: null, audit_rights: false, pro_rata_method: 'leased',
        renewal_options: '1 option, 3 years, market rent; conditions: no default, no sublease >50%',
        amendments: [],
        fieldEvidence: {
          renewal_options: { snapshots: [{ value: '1 option, 3 years, market rent; conditions: no default, no sublease >50%', quote: 'one (1) option to renew...provided that: (a) Tenant is not in default', confidence: 75, source: 'original_lease', timestamp: '2024-01-01T00:00:00Z' }] }
        },
        _confidenceScore: 72, _confidence: 'medium',
        _edgeCases: { edgeCases: [], totalConfidenceAdjustment: 0 },
        _explainability: { fieldSummaries: {}, reviewNotes: ['Renewal option is conditional — default or sublease could void option'], overallSummary: 'Conditional renewal with market rent reset.' },
        _multiDocReasoning: null
      },
      property: null,
      expected: {
        fields: { renewal_options: '1 option, 3 years, market rent; conditions: no default, no sublease >50%' },
        confidenceRange: [65, 90],
        warnings: [],
        amendmentPrecedence: null,
        edgeCases: []
      }
    },

    // ── HARD 1 ─────────────────────────────────────────────────────────────────
    {
      id: 'hard-001',
      level: 'hard',
      title: 'Two Amendments Conflict on CAM Cap',
      description: 'Amendment 1 sets cap=4%, Amendment 2 sets cap=6% — tests multi-amendment conflict detection and latest-wins resolution.',
      leaseText: "CAM charges shall not increase more than five percent (5%) per year.",
      amendmentText: "Amendment 1 (eff. 2023-01-01): CAM cap reduced to four percent (4%). Amendment 2 (eff. 2024-01-01): CAM cap increased to six percent (6%).",
      tenant: {
        id: 'hard-001-tenant', tenant_name: 'Test Tenant K', leased_sqft: 2400,
        start_date: '2022-01-01', end_date: '2027-12-31',
        lease_type: 'NNN', cap: 6, admin_fee_pct: 10, gross_up_pct: null,
        expense_stop: null, audit_rights: false, pro_rata_method: 'leased',
        renewal_options: null,
        amendments: [
          { amendmentId: 'amd-001', effectiveDate: '2023-01-01', uploadedAt: '2023-01-15T00:00:00Z', fileName: 'Amendment_1.pdf', overriddenFields: ['cap'], extractedFields: { cap: 4 } },
          { amendmentId: 'amd-002', effectiveDate: '2024-01-01', uploadedAt: '2024-01-15T00:00:00Z', fileName: 'Amendment_2.pdf', overriddenFields: ['cap'], extractedFields: { cap: 6 } }
        ],
        fieldEvidence: {
          cap: {
            snapshots: [
              { value: 5, source: 'original_lease', confidence: 85, quote: 'five percent (5%)', timestamp: '2022-01-01T00:00:00Z', supersededBy: 'amd-001' },
              { value: 4, source: 'amendment', confidence: 80, quote: 'four percent (4%)', timestamp: '2023-01-15T00:00:00Z', supersededBy: 'amd-002' },
              { value: 6, source: 'amendment', confidence: 78, quote: 'six percent (6%)', timestamp: '2024-01-15T00:00:00Z' }
            ]
          }
        },
        _confidenceScore: 58, _confidence: 'medium',
        _edgeCases: { edgeCases: [{ type: 'AMENDMENT_CONFLICT', description: 'Multiple amendments modify the same cap field', confidenceAdjustment: -20 }], totalConfidenceAdjustment: -20 },
        _explainability: { fieldSummaries: {}, reviewNotes: ['Amendment conflict detected: cap modified by 2 amendments'], overallSummary: 'Amendment conflict on CAM cap requires manual review.' },
        _multiDocReasoning: null
      },
      property: null,
      expected: {
        fields: { cap: 6 },
        confidenceRange: [30, 70],
        warnings: ['amendments on file'],
        amendmentPrecedence: { winningDocType: 'amendment', governingField: 'cap', expectedValue: 6 },
        edgeCases: ['AMENDMENT_CONFLICT']
      }
    },

    // ── HARD 2 ─────────────────────────────────────────────────────────────────
    {
      id: 'hard-002',
      level: 'hard',
      title: 'Gross-Up Without Occupancy Threshold',
      description: 'Gross-up clause lacks explicit occupancy percentage — triggers AMBIGUOUS_GROSS_UP edge case.',
      leaseText: "In the event the Building is not fully occupied, Operating Expenses shall be grossed up to reflect full occupancy. The gross-up adjustment shall apply to all variable operating costs as determined by Landlord in its reasonable discretion.",
      amendmentText: null,
      tenant: {
        id: 'hard-002-tenant', tenant_name: 'Test Tenant L', leased_sqft: 3200,
        start_date: '2024-01-01', end_date: '2029-12-31',
        lease_type: 'NNN', cap: null, admin_fee_pct: 0, gross_up_pct: null,
        expense_stop: null, audit_rights: false, pro_rata_method: 'occupied',
        renewal_options: null, amendments: [],
        fieldEvidence: {
          gross_up_pct: { snapshots: [{ value: null, quote: 'grossed up to reflect full occupancy', confidence: 30, source: 'original_lease', timestamp: '2024-01-01T00:00:00Z' }] }
        },
        _confidenceScore: 45, _confidence: 'medium',
        _edgeCases: { edgeCases: [{ type: 'AMBIGUOUS_GROSS_UP', description: 'Gross-up clause present but occupancy threshold not specified', confidenceAdjustment: -15 }], totalConfidenceAdjustment: -15 },
        _explainability: { fieldSummaries: {}, reviewNotes: ['Gross-up occupancy threshold undefined — 95%? 90%? 85%? Requires clarification'], overallSummary: 'Ambiguous gross-up clause.' },
        _multiDocReasoning: null
      },
      property: null,
      expected: {
        fields: { gross_up_pct: null },
        confidenceRange: [30, 65],
        warnings: [],
        amendmentPrecedence: null,
        edgeCases: []
      }
    },

    // ── HARD 3 ─────────────────────────────────────────────────────────────────
    {
      id: 'hard-003',
      level: 'hard',
      title: 'Contradictory CAM Cap and Expense Stop',
      description: 'Both 4% CAM cap and $10/sqft expense stop are defined — triggers CONTRADICTORY_CAP_AND_STOP edge case.',
      leaseText: "CAM charges shall not increase more than four percent (4%) per year over the prior year's actual charges. Tenant shall pay all Operating Expenses in excess of Ten Dollars ($10.00) per square foot per year (the 'Expense Stop'). In the event of conflict between the CAM cap and the Expense Stop, the provision most favorable to Tenant shall control.",
      amendmentText: null,
      tenant: {
        id: 'hard-003-tenant', tenant_name: 'Test Tenant M', leased_sqft: 2700,
        start_date: '2024-01-01', end_date: '2028-12-31',
        lease_type: 'Modified Gross', cap: 4, admin_fee_pct: 0, gross_up_pct: null,
        expense_stop: 10, audit_rights: false, pro_rata_method: 'leased',
        renewal_options: null, amendments: [],
        fieldEvidence: {
          cap: { snapshots: [{ value: 4, quote: 'four percent (4%) per year', confidence: 80, source: 'original_lease', timestamp: '2024-01-01T00:00:00Z' }] },
          expense_stop: { snapshots: [{ value: 10, quote: 'Ten Dollars ($10.00) per square foot per year', confidence: 82, source: 'original_lease', timestamp: '2024-01-01T00:00:00Z' }] }
        },
        _confidenceScore: 42, _confidence: 'medium',
        _edgeCases: { edgeCases: [{ type: 'CONTRADICTORY_CAP_AND_STOP', description: 'Both CAM cap and expense stop defined — creates ambiguity', confidenceAdjustment: -20 }], totalConfidenceAdjustment: -20 },
        _explainability: { fieldSummaries: {}, reviewNotes: ['Both CAM cap and expense stop present — requires attorney review to determine controlling provision'], overallSummary: 'Contradictory CAM controls require legal review.' },
        _multiDocReasoning: null
      },
      property: null,
      expected: {
        fields: { cap: 4, expense_stop: 10 },
        confidenceRange: [25, 60],
        warnings: ['protection mechanism'],
        amendmentPrecedence: null,
        edgeCases: ['CONTRADICTORY_CAP_AND_STOP']
      }
    },

    // ── HARD 4 ─────────────────────────────────────────────────────────────────
    {
      id: 'hard-004',
      level: 'hard',
      title: 'Missing Pages in CAM Section',
      description: 'Critical CAM lease sections are absent from extracted text — triggers MISSING_PAGES edge case.',
      leaseText: "Section 4. COMMON AREA MAINTENANCE. Tenant shall pay its pro-rata share of [PAGE MISSING] [TEXT UNREADABLE] ...the foregoing notwithstanding, CAM charges shall not [PAGE MISSING] Landlord's administrative costs shall not exceed [TEXT UNREADABLE].",
      amendmentText: null,
      ocrContext: { ocrChars: 200, usedPdfDirect: false },
      tenant: {
        id: 'hard-004-tenant', tenant_name: 'Test Tenant N', leased_sqft: 1900,
        start_date: '2024-01-01', end_date: '2028-12-31',
        lease_type: 'NNN', cap: null, admin_fee_pct: null, gross_up_pct: null,
        expense_stop: null, audit_rights: false, pro_rata_method: 'leased',
        renewal_options: null, amendments: [],
        fieldEvidence: {},
        _confidenceScore: 30, _confidence: 'low',
        _edgeCases: { edgeCases: [{ type: 'MISSING_PAGES', description: 'Critical CAM sections absent from extracted text', confidenceAdjustment: -25 }], totalConfidenceAdjustment: -25 },
        _explainability: { fieldSummaries: {}, reviewNotes: ['Critical CAM language missing — OCR page extraction failure', 'Cannot determine CAM cap or admin fee without complete document'], overallSummary: 'Document integrity compromised — missing pages in CAM section.' },
        _multiDocReasoning: null
      },
      property: null,
      expected: {
        fields: { cap: null, admin_fee_pct: null },
        confidenceRange: [5, 45],
        warnings: ['missing'],
        amendmentPrecedence: null,
        edgeCases: ['MISSING_PAGES']
      }
    },

    // ── HARD 5 ─────────────────────────────────────────────────────────────────
    {
      id: 'hard-005',
      level: 'hard',
      title: 'Contradictory CAM Exclusion Clauses',
      description: 'Three lease sections produce conflicting CAM exclusion scope — triggers CAM_EXCLUSIONS_UNDEFINED edge case.',
      leaseText: "Section 8.1: CAM exclusions include: capital expenditures, depreciation, and financing costs. Section 8.4: Notwithstanding Section 8.1, Landlord may include roof replacement costs, parking lot resurfacing, and elevator modernization in CAM if such costs are amortized over their useful life. Section 12.2: All capital improvements required by applicable law shall be included in CAM without limitation.",
      amendmentText: null,
      tenant: {
        id: 'hard-005-tenant', tenant_name: 'Test Tenant O', leased_sqft: 3100,
        start_date: '2024-01-01', end_date: '2029-12-31',
        lease_type: 'NNN', cap: 5, admin_fee_pct: 10, gross_up_pct: null,
        expense_stop: null, audit_rights: true, pro_rata_method: 'leased',
        renewal_options: null, amendments: [],
        fieldEvidence: {
          audit_rights: { snapshots: [{ value: true, quote: 'Tenant shall have the right to audit', confidence: 80, source: 'original_lease', timestamp: '2024-01-01T00:00:00Z' }] }
        },
        _confidenceScore: 48, _confidence: 'medium',
        _edgeCases: { edgeCases: [{ type: 'CAM_EXCLUSIONS_UNDEFINED', description: 'Multiple exclusion clauses conflict — capital expenditures both excluded and included under different conditions', confidenceAdjustment: -15 }], totalConfidenceAdjustment: -15 },
        _explainability: { fieldSummaries: {}, reviewNotes: ['Contradictory CAM exclusion language — Sections 8.1 and 8.4 conflict on capital expenditures', 'Section 12.2 may override all exclusions for code-required improvements'], overallSummary: 'CAM exclusion scope is disputed across three lease sections.' },
        _multiDocReasoning: null
      },
      property: null,
      expected: {
        fields: { cap: 5 },
        confidenceRange: [30, 65],
        warnings: ['exclusion'],
        amendmentPrecedence: null,
        edgeCases: ['CAM_EXCLUSIONS_UNDEFINED']
      }
    },

    // ── NIGHTMARE 1 ────────────────────────────────────────────────────────────
    {
      id: 'nightmare-001',
      level: 'nightmare',
      title: 'Side Letter Overrides Amendment on CAM Cap',
      description: 'Side letter (cap=2%) supersedes amendment (cap=7%) — tests side_letter > amendment precedence rule.',
      leaseText: "CAM charges shall not increase more than five percent (5%) per year.",
      amendmentText: "Amendment 1 (eff. 2023-06-01): CAM cap increased to seven percent (7%). Side Letter (eff. 2023-08-01): Notwithstanding Amendment 1, the parties agree that the CAM cap shall not exceed two percent (2%) per year for the duration of the Lease Term.",
      tenant: {
        id: 'nightmare-001-tenant', tenant_name: 'Test Tenant P', leased_sqft: 2600,
        start_date: '2022-01-01', end_date: '2028-12-31',
        lease_type: 'NNN', cap: 2, admin_fee_pct: 10, gross_up_pct: null,
        expense_stop: null, audit_rights: false, pro_rata_method: 'leased',
        renewal_options: null,
        amendments: [
          { amendmentId: 'amd-001', effectiveDate: '2023-06-01', uploadedAt: '2023-06-15T00:00:00Z', fileName: 'Amendment_1.pdf', overriddenFields: ['cap'], extractedFields: { cap: 7 } },
          { amendmentId: 'sl-001', effectiveDate: '2023-08-01', uploadedAt: '2023-08-10T00:00:00Z', fileName: 'Side_Letter.pdf', docType: 'side_letter', overriddenFields: ['cap'], extractedFields: { cap: 2 } }
        ],
        fieldEvidence: {
          cap: {
            snapshots: [
              { value: 5, source: 'original_lease', confidence: 85, quote: 'five percent (5%)', timestamp: '2022-01-01T00:00:00Z', supersededBy: 'amd-001' },
              { value: 7, source: 'amendment', confidence: 75, quote: 'seven percent (7%)', timestamp: '2023-06-15T00:00:00Z', supersededBy: 'sl-001' },
              { value: 2, source: 'side_letter', confidence: 70, quote: 'shall not exceed two percent (2%)', timestamp: '2023-08-10T00:00:00Z' }
            ]
          }
        },
        _confidenceScore: 38, _confidence: 'low',
        _edgeCases: { edgeCases: [{ type: 'AMENDMENT_CONFLICT', description: 'Side letter supersedes amendment on same field', confidenceAdjustment: -20 }], totalConfidenceAdjustment: -20 },
        _explainability: { fieldSummaries: {}, reviewNotes: ['Side letter supersedes Amendment 1 for cap field — side_letter precedence rule applied', 'Governing value: 2% from side letter dated 2023-08-01'], overallSummary: 'Side letter override of amendment on CAM cap.' },
        _multiDocReasoning: null
      },
      property: null,
      expected: {
        fields: { cap: 2 },
        confidenceRange: [15, 50],
        warnings: [],
        amendmentPrecedence: { winningDocType: 'side_letter', governingField: 'cap', expectedValue: 2 },
        edgeCases: ['AMENDMENT_CONFLICT']
      }
    },

    // ── NIGHTMARE 2 ────────────────────────────────────────────────────────────
    {
      id: 'nightmare-002',
      level: 'nightmare',
      title: 'Severe OCR Corruption',
      description: 'Character substitution throughout document — triggers WEAK_OCR and MALFORMED_OCR edge cases.',
      leaseText: "CAM ch@rges sh@ll n0t exce3d f1ve perc3nt (5%) p3r ye@r 0ver the pr10r ye@r's @ctu@l CAM ch@rges. @dmin fee n0t t0 exc33d t3n p3rc3nt (10%) 0f t0t@l C@M 3xp3nses. T3n@nt sh@ll h@ve r1ght t0 @ud1t L@ndl0rd's b00ks @nd rec0rds.",
      amendmentText: null,
      ocrContext: { ocrChars: 150, usedPdfDirect: false },
      tenant: {
        id: 'nightmare-002-tenant', tenant_name: 'Test Tenant Q', leased_sqft: 2300,
        start_date: '2024-01-01', end_date: '2029-12-31',
        lease_type: 'NNN', cap: 5, admin_fee_pct: 10, gross_up_pct: null,
        expense_stop: null, audit_rights: true, pro_rata_method: 'leased',
        renewal_options: null, amendments: [],
        fieldEvidence: {
          cap: { snapshots: [{ value: 5, quote: 'f1ve perc3nt (5%)', confidence: 25, source: 'original_lease', timestamp: '2024-01-01T00:00:00Z' }] }
        },
        _confidenceScore: 28, _confidence: 'low',
        _edgeCases: {
          edgeCases: [
            { type: 'WEAK_OCR', description: 'Character substitution patterns detected throughout document', confidenceAdjustment: -30 },
            { type: 'MALFORMED_OCR', description: 'Systematic OCR corruption across multiple sections', confidenceAdjustment: -15 }
          ],
          totalConfidenceAdjustment: -45
        },
        _explainability: { fieldSummaries: {}, reviewNotes: ['OCR quality severely degraded — character substitution throughout', 'Values extracted from corrupted text — high risk of numeric errors', 'Manual review of original document strongly recommended'], overallSummary: 'OCR corruption compromises extraction reliability.' },
        _multiDocReasoning: null
      },
      property: null,
      expected: {
        fields: {},
        confidenceRange: [10, 45],
        warnings: ['re-scan'],
        amendmentPrecedence: null,
        edgeCases: ['WEAK_OCR']
      }
    },

    // ── NIGHTMARE 3 ────────────────────────────────────────────────────────────
    {
      id: 'nightmare-003',
      level: 'nightmare',
      title: 'Three Amendments, Three Fields, Conflicting Directions',
      description: 'Each of three amendments modifies cap, admin_fee_pct, and gross_up_pct in different directions — tests complex multi-field amendment conflict.',
      leaseText: "NNN lease. CAM cap 5%. Admin fee 10%. Gross-up at 90%.",
      amendmentText: "Amd1 (2022): cap=3%, admin=12%, gross_up=85%. Amd2 (2023): cap=7%, admin=8%, gross_up=95%. Amd3 (2024): cap=4%, admin=15%, gross_up=90%.",
      tenant: {
        id: 'nightmare-003-tenant', tenant_name: 'Test Tenant R', leased_sqft: 2900,
        start_date: '2021-01-01', end_date: '2027-12-31',
        lease_type: 'NNN', cap: 4, admin_fee_pct: 15, gross_up_pct: 90,
        expense_stop: null, audit_rights: false, pro_rata_method: 'leased',
        renewal_options: null,
        amendments: [
          { amendmentId: 'amd-001', effectiveDate: '2022-01-01', uploadedAt: '2022-01-15T00:00:00Z', fileName: 'Amendment_1.pdf', overriddenFields: ['cap', 'admin_fee_pct', 'gross_up_pct'], extractedFields: { cap: 3, admin_fee_pct: 12, gross_up_pct: 85 } },
          { amendmentId: 'amd-002', effectiveDate: '2023-01-01', uploadedAt: '2023-01-15T00:00:00Z', fileName: 'Amendment_2.pdf', overriddenFields: ['cap', 'admin_fee_pct', 'gross_up_pct'], extractedFields: { cap: 7, admin_fee_pct: 8, gross_up_pct: 95 } },
          { amendmentId: 'amd-003', effectiveDate: '2024-01-01', uploadedAt: '2024-01-15T00:00:00Z', fileName: 'Amendment_3.pdf', overriddenFields: ['cap', 'admin_fee_pct', 'gross_up_pct'], extractedFields: { cap: 4, admin_fee_pct: 15, gross_up_pct: 90 } }
        ],
        fieldEvidence: {
          cap: {
            snapshots: [
              { value: 5, source: 'original_lease', confidence: 85, quote: 'five percent', timestamp: '2021-01-01T00:00:00Z', supersededBy: 'amd-001' },
              { value: 3, source: 'amendment', confidence: 78, quote: 'three percent', timestamp: '2022-01-15T00:00:00Z', supersededBy: 'amd-002' },
              { value: 7, source: 'amendment', confidence: 75, quote: 'seven percent', timestamp: '2023-01-15T00:00:00Z', supersededBy: 'amd-003' },
              { value: 4, source: 'amendment', confidence: 72, quote: 'four percent', timestamp: '2024-01-15T00:00:00Z' }
            ]
          }
        },
        _confidenceScore: 25, _confidence: 'low',
        _edgeCases: { edgeCases: [{ type: 'AMENDMENT_CONFLICT', description: 'Three amendments each modify cap, admin_fee_pct, and gross_up_pct in conflicting directions', confidenceAdjustment: -30 }], totalConfidenceAdjustment: -30 },
        _explainability: { fieldSummaries: {}, reviewNotes: ['Three-way amendment conflict on cap, admin fee, and gross-up — each amendment supersedes the prior', 'Governing values per latest amendment (Amd3): cap=4%, admin=15%, gross-up=90%'], overallSummary: 'Triple amendment conflict on three key fields.' },
        _multiDocReasoning: null
      },
      property: null,
      expected: {
        fields: { cap: 4, admin_fee_pct: 15, gross_up_pct: 90 },
        confidenceRange: [10, 40],
        warnings: ['amendments on file'],
        amendmentPrecedence: { winningDocType: 'amendment', governingField: 'cap', expectedValue: 4 },
        edgeCases: ['AMENDMENT_CONFLICT']
      }
    },

    // ── NIGHTMARE 4 ────────────────────────────────────────────────────────────
    {
      id: 'nightmare-004',
      level: 'nightmare',
      title: 'Renewal Date Conflict After Lease Extension',
      description: 'Renewal option deadline not updated when lease term was extended — triggers RENEWAL_DATE_CONFLICT edge case.',
      leaseText: "Lease Term expires December 31, 2025. Tenant's renewal option must be exercised no later than June 30, 2025.",
      amendmentText: "Amendment 2 extends Lease Term expiration to December 31, 2027. Renewal option exercise deadline remains June 30, 2025 per original lease.",
      tenant: {
        id: 'nightmare-004-tenant', tenant_name: 'Test Tenant S', leased_sqft: 2050,
        start_date: '2020-01-01', end_date: '2027-12-31',
        lease_type: 'NNN', cap: 5, admin_fee_pct: 10, gross_up_pct: null,
        expense_stop: null, audit_rights: false, pro_rata_method: 'leased',
        renewal_options: '1 option; exercise by June 30, 2025 (conflict: lease now expires 2027)',
        amendments: [{
          amendmentId: 'amd-002', effectiveDate: '2024-01-01', uploadedAt: '2024-01-15T00:00:00Z',
          fileName: 'Amendment_2.pdf', overriddenFields: ['end_date'], extractedFields: { end_date: '2027-12-31' }
        }],
        fieldEvidence: {
          renewal_options: { snapshots: [{ value: '1 option; exercise by June 30, 2025 (conflict: lease now expires 2027)', quote: 'renewal option must be exercised no later than June 30, 2025', confidence: 40, source: 'original_lease', timestamp: '2024-01-01T00:00:00Z' }] },
          end_date: { snapshots: [{ value: '2025-12-31', quote: 'Lease Term expires December 31, 2025', confidence: 85, source: 'original_lease', timestamp: '2020-01-01T00:00:00Z' }] }
        },
        _confidenceScore: 32, _confidence: 'low',
        _edgeCases: { edgeCases: [{ type: 'RENEWAL_DATE_CONFLICT', description: 'Renewal option deadline precedes extended lease expiration date — deadline may have passed without tenant awareness', confidenceAdjustment: -25 }], totalConfidenceAdjustment: -25 },
        _explainability: { fieldSummaries: {}, reviewNotes: ['Renewal option exercise deadline (June 2025) conflicts with extended expiration (Dec 2027)', 'Tenant may have missed renewal window if deadline was not updated in amendment'], overallSummary: 'Renewal date conflict created by lease extension amendment.' },
        _multiDocReasoning: null
      },
      property: null,
      expected: {
        fields: {},
        confidenceRange: [15, 50],
        warnings: ['renewal'],
        amendmentPrecedence: { winningDocType: 'amendment', governingField: 'end_date', expectedValue: '2027-12-31' },
        edgeCases: ['RENEWAL_DATE_CONFLICT']
      }
    },

    // ── NIGHTMARE 5 ────────────────────────────────────────────────────────────
    {
      id: 'nightmare-005',
      level: 'nightmare',
      title: 'Maximum Complexity — All Edge Cases Active',
      description: 'OCR corruption, missing pages, amendment conflict, ambiguous gross-up, contradictory cap and stop all simultaneously present.',
      leaseText: "C@M ch@rges sh@ll n0t [PAGE MISSING] gross-up to reflect full occupancy [TEXT UNREADABLE] CAM cap four percent (4%) per year [PAGE MISSING] Expense Stop Ten Dollars ($10.00) per square foot.",
      amendmentText: "Three amendments conflict. Side letter present.",
      ocrContext: { ocrChars: 150, usedPdfDirect: false },
      tenant: {
        id: 'nightmare-005-tenant', tenant_name: 'Test Tenant T', leased_sqft: 3500,
        start_date: '2021-01-01', end_date: '2028-12-31',
        lease_type: 'NNN', cap: 4, admin_fee_pct: null, gross_up_pct: 95,
        expense_stop: 10, audit_rights: false, pro_rata_method: 'leased',
        renewal_options: null,
        amendments: [
          { amendmentId: 'amd-001', effectiveDate: '2023-01-01', uploadedAt: '2023-01-15T00:00:00Z', fileName: 'Amendment_1.pdf', overriddenFields: ['cap'], extractedFields: { cap: 6 } },
          { amendmentId: 'sl-001', effectiveDate: '2023-06-01', uploadedAt: '2023-06-15T00:00:00Z', fileName: 'Side_Letter.pdf', docType: 'side_letter', overriddenFields: ['cap'], extractedFields: { cap: 2 } }
        ],
        fieldEvidence: {
          cap: {
            snapshots: [
              { value: 4, source: 'original_lease', confidence: 30, quote: 'four percent (4%)', timestamp: '2022-01-01T00:00:00Z', supersededBy: 'amd-001' },
              { value: 6, source: 'amendment', confidence: 25, quote: 'six percent', timestamp: '2023-01-15T00:00:00Z', supersededBy: 'sl-001' },
              { value: 2, source: 'side_letter', confidence: 20, quote: 'shall not exceed two percent', timestamp: '2023-06-15T00:00:00Z' }
            ]
          },
          expense_stop: { snapshots: [{ value: 10, source: 'original_lease', confidence: 40, quote: 'Ten Dollars ($10.00) per square foot', timestamp: '2022-01-01T00:00:00Z' }] }
        },
        _confidenceScore: 18, _confidence: 'low',
        _edgeCases: {
          edgeCases: [
            { type: 'WEAK_OCR', description: 'OCR corruption throughout', confidenceAdjustment: -30 },
            { type: 'MISSING_PAGES', description: 'Critical sections missing', confidenceAdjustment: -25 },
            { type: 'AMENDMENT_CONFLICT', description: 'Amendment and side letter conflict on cap', confidenceAdjustment: -20 },
            { type: 'AMBIGUOUS_GROSS_UP', description: 'Gross-up present but threshold undefined', confidenceAdjustment: -15 },
            { type: 'CONTRADICTORY_CAP_AND_STOP', description: 'Both cap and expense stop defined', confidenceAdjustment: -20 }
          ],
          totalConfidenceAdjustment: -110
        },
        _explainability: { fieldSummaries: {}, reviewNotes: ['OCR corruption compromises all extracted values', 'Missing pages in critical CAM section', 'Amendment conflict: side letter vs amendment on cap', 'Gross-up threshold undefined', 'Both CAM cap and expense stop present — contradictory', 'This lease requires complete re-extraction from original document'], overallSummary: 'Maximum complexity scenario — all edge cases active.' },
        _multiDocReasoning: null
      },
      property: null,
      expected: {
        fields: { expense_stop: 10 },
        confidenceRange: [5, 35],
        warnings: ['re-scan', 'missing', 'amendments on file', 'gross-up', 'protection mechanism'],
        amendmentPrecedence: { winningDocType: 'side_letter', governingField: 'cap', expectedValue: 2 },
        edgeCases: ['WEAK_OCR', 'MISSING_PAGES', 'AMENDMENT_CONFLICT', 'AMBIGUOUS_GROSS_UP', 'CONTRADICTORY_CAP_AND_STOP']
      }
    }
  ];

  // Attach property to each scenario
  SCENARIO_REGISTRY.forEach(function (s) {
    s.property = {
      id: s.id + '-prop',
      name: s.title,
      totalSqft: 20000,
      tenants: [s.tenant],
      disputes: [],
      activityLog: [],
      timeline: []
    };
  });

  // ─── generateScenario ────────────────────────────────────────────────────────
  function generateScenario(level) {
    // If level matches an explicit id like 'easy-001', return that scenario
    const byId = SCENARIO_REGISTRY.find(function (s) { return s.id === level; });
    if (byId) return byId;

    // Otherwise filter by level and cycle deterministically
    const matching = SCENARIO_REGISTRY.filter(function (s) { return s.level === level; });
    if (!matching.length) {
      throw new Error('LeaseTestLab.generateScenario: unknown level "' + level + '"');
    }
    const idx = _levelCounters[level] % matching.length;
    _levelCounters[level]++;
    return matching[idx];
  }

  // ─── _resolvePrecedence ──────────────────────────────────────────────────────
  // Derives per-field governing-document info from a tenant object's amendments[].
  // Returns { [fieldKey]: { winningDocType, value } } for every field that has
  // multi-document evidence.  Implements: side_letter(4) > estoppel(3) > amendment(2) > original_lease(1).
  // Within the same tier, newer effectiveDate wins.
  var _DOC_TIER = { side_letter: 4, estoppel: 3, amendment: 2, original_lease: 1 };

  function _resolvePrecedence(tenant) {
    if (!tenant || !Array.isArray(tenant.amendments) || tenant.amendments.length === 0) return null;

    // Build a flat list of { docType, docDate, fieldKey, value } entries
    var entries = [];

    // Original lease values from fieldEvidence snapshots without amendmentId
    var fev = tenant.fieldEvidence || {};
    for (var fk in fev) {
      var snaps = (fev[fk].snapshots || []);
      var orig = snaps.find(function(s) { return !s.amendmentId; });
      if (orig && orig.value != null) {
        entries.push({ docType: 'original_lease', docDate: tenant.start_date || null, fieldKey: fk, value: orig.value });
      }
    }

    // Amendment / side-letter entries
    for (var i = 0; i < tenant.amendments.length; i++) {
      var amd = tenant.amendments[i];
      var dType = amd.docType || 'amendment';
      var dDate = amd.effectiveDate || amd.uploadedAt || null;
      var overridden = amd.overriddenFields || [];
      for (var j = 0; j < overridden.length; j++) {
        var f = overridden[j];
        var val = (amd.extractedFields || {})[f];
        if (val != null) {
          entries.push({ docType: dType, docDate: dDate, fieldKey: f, value: val });
        }
      }
    }

    // Group by field, sort each group by (tier desc, date desc), pick winner
    var byField = {};
    for (var k = 0; k < entries.length; k++) {
      var e = entries[k];
      if (!byField[e.fieldKey]) byField[e.fieldKey] = [];
      byField[e.fieldKey].push(e);
    }

    var resolved = {};
    for (var field in byField) {
      var group = byField[field];
      if (group.length < 2) continue; // only care about contested fields
      group.sort(function(a, b) {
        var td = (_DOC_TIER[b.docType] || 0) - (_DOC_TIER[a.docType] || 0);
        if (td !== 0) return td;
        var da = a.docDate ? new Date(a.docDate).getTime() : 0;
        var db = b.docDate ? new Date(b.docDate).getTime() : 0;
        return db - da;
      });
      resolved[field] = { winningDocType: group[0].docType, value: group[0].value };
    }

    if (Object.keys(resolved).length === 0) return null;

    // Return the primary contested field: most amendment entries, else first in CANONICAL_FIELDS order
    var _FIELD_ORDER = ['cap', 'admin_fee_pct', 'gross_up_pct', 'expense_stop', 'audit_rights', 'pro_rata_method', 'renewal_options', 'tenant_name', 'leased_sqft', 'start_date', 'end_date', 'lease_type'];
    var primaryField = null;
    var maxEntries = 0;
    for (var pf in resolved) {
      var cnt = byField[pf].length;
      if (cnt > maxEntries) { maxEntries = cnt; primaryField = pf; }
      else if (cnt === maxEntries && primaryField) {
        if (_FIELD_ORDER.indexOf(pf) < _FIELD_ORDER.indexOf(primaryField)) primaryField = pf;
      }
    }

    return {
      winningDocType: resolved[primaryField].winningDocType,
      governingField: primaryField,
      value: resolved[primaryField].value,
      // full map available for callers that need to check a specific field
      _allFields: resolved,
    };
  }

  // ─── _normalizeResult ────────────────────────────────────────────────────────
  // Accepts tenant, mock result, or packet and extracts common validation fields
  function _normalizeResult(result) {
    if (!result || typeof result !== 'object') {
      return { actualFields: {}, actualConfidenceScore: null, actualWarnings: [], actualAmendmentPrecedence: null, actualEdgeCases: [] };
    }

    var actualFields, actualConfidenceScore, actualWarnings, actualAmendmentPrecedence, actualEdgeCases;

    // ── Fields ────────────────────────────────────────────────────────────────
    if (result.fields && typeof result.fields === 'object') {
      // Mock result shape: { fields:{}, confidenceScore, warnings, amendmentPrecedence, edgeCases }
      actualFields = result.fields;
    } else if (result.extractedLeaseTerms && Array.isArray(result.extractedLeaseTerms) && result.extractedLeaseTerms.length) {
      // Packet shape from LeaseReviewPackets.generateLeaseReviewPacket
      actualFields = result.extractedLeaseTerms[0];
    } else {
      // Tenant object shape — pick known fields
      actualFields = {
        cap: result.cap,
        admin_fee_pct: result.admin_fee_pct,
        gross_up_pct: result.gross_up_pct,
        expense_stop: result.expense_stop,
        audit_rights: result.audit_rights,
        lease_type: result.lease_type,
        pro_rata_method: result.pro_rata_method,
        renewal_options: result.renewal_options
      };
    }

    // ── Confidence score ──────────────────────────────────────────────────────
    if (typeof result.confidenceScore === 'number') {
      actualConfidenceScore = result.confidenceScore;
    } else if (typeof result._confidenceScore === 'number') {
      actualConfidenceScore = result._confidenceScore;
    } else {
      actualConfidenceScore = null;
    }

    // ── Warnings ──────────────────────────────────────────────────────────────
    if (Array.isArray(result.warnings)) {
      actualWarnings = result.warnings;
    } else {
      var warnPool = [];
      if (result._explainability && Array.isArray(result._explainability.reviewNotes)) {
        warnPool = result._explainability.reviewNotes.slice();
      }
      // Include edge case reviewer notes as additional production warning signals
      if (result._edgeCases && Array.isArray(result._edgeCases.edgeCases)) {
        result._edgeCases.edgeCases.forEach(function(ec) {
          if (ec.reviewerNote) warnPool.push(ec.reviewerNote);
        });
      }
      actualWarnings = warnPool.length > 0 ? warnPool : (result.unresolvedWarnings || []);
    }

    // ── Amendment precedence ──────────────────────────────────────────────────
    if (result.amendmentPrecedence && typeof result.amendmentPrecedence === 'object') {
      // Mock result or packet with explicit precedence object
      actualAmendmentPrecedence = result.amendmentPrecedence;
    } else if (result.amendments && result.fieldEvidence) {
      // Tenant object — derive from amendments[] using internal precedence engine
      actualAmendmentPrecedence = _resolvePrecedence(result);
    } else {
      actualAmendmentPrecedence = null;
    }

    // ── Edge cases ────────────────────────────────────────────────────────────
    if (Array.isArray(result.edgeCases)) {
      // Could be array of strings OR array of objects with .type
      actualEdgeCases = result.edgeCases.map(function (e) {
        return (e && typeof e === 'object' && e.type) ? e.type : e;
      });
    } else if (result._edgeCases && Array.isArray(result._edgeCases.edgeCases)) {
      actualEdgeCases = result._edgeCases.edgeCases.map(function (e) { return e.type; });
    } else {
      actualEdgeCases = [];
    }

    return { actualFields: actualFields, actualConfidenceScore: actualConfidenceScore, actualWarnings: actualWarnings, actualAmendmentPrecedence: actualAmendmentPrecedence, actualEdgeCases: actualEdgeCases };
  }

  // ─── validate ────────────────────────────────────────────────────────────────
  function validate(result, expected) {
    var norm = _normalizeResult(result);
    var actualFields = norm.actualFields;
    var actualConfidenceScore = norm.actualConfidenceScore;
    var actualWarnings = norm.actualWarnings;
    var actualAmendmentPrecedence = norm.actualAmendmentPrecedence;
    var actualEdgeCases = norm.actualEdgeCases;

    var fieldScore = 0;
    var confidenceScore = 0;
    var warningScore = 0;
    var amendmentScore = 0;
    var edgeCaseScore = 0;

    var failedFields = [];
    var confidenceIssues = [];
    var warningIssues = [];
    var amendmentIssues = [];
    var edgeCaseIssues = [];

    // ── Fields: 40 pts ────────────────────────────────────────────────────────
    var expectedFieldKeys = Object.keys(expected.fields || {});
    var fieldCount = expectedFieldKeys.length;

    if (fieldCount === 0) {
      fieldScore = 40;
    } else {
      var pointsPerField = 40 / fieldCount;
      expectedFieldKeys.forEach(function (key) {
        var expectedVal = expected.fields[key];
        var actualVal = (actualFields && key in actualFields) ? actualFields[key] : undefined;

        var correct = false;
        if (expectedVal === null || expectedVal === undefined) {
          // Full credit if actual is also null/undefined
          correct = (actualVal === null || actualVal === undefined);
        } else if (typeof expectedVal === 'number') {
          correct = (typeof actualVal === 'number' && Math.abs(actualVal - expectedVal) <= 0.01);
        } else if (typeof expectedVal === 'boolean') {
          correct = (actualVal === expectedVal);
        } else if (typeof expectedVal === 'string') {
          correct = (typeof actualVal === 'string' && actualVal.toLowerCase() === expectedVal.toLowerCase());
        } else {
          correct = (actualVal === expectedVal);
        }

        if (correct) {
          fieldScore += pointsPerField;
        } else {
          failedFields.push({ field: key, expected: expectedVal, actual: actualVal });
        }
      });
    }

    // ── Confidence in range: 20 pts ───────────────────────────────────────────
    if (actualConfidenceScore === null || actualConfidenceScore === undefined) {
      confidenceScore = 0;
      confidenceIssues.push({ issue: 'No confidence score provided', expected: expected.confidenceRange, actual: null });
    } else {
      var lo = expected.confidenceRange[0];
      var hi = expected.confidenceRange[1];
      if (actualConfidenceScore >= lo && actualConfidenceScore <= hi) {
        confidenceScore = 20;
      } else {
        confidenceScore = 0;
        confidenceIssues.push({ issue: 'Score out of range', expected: expected.confidenceRange, actual: actualConfidenceScore });
      }
    }

    // ── Warnings: 20 pts ──────────────────────────────────────────────────────
    var expectedWarnings = expected.warnings || [];
    if (expectedWarnings.length === 0) {
      warningScore = 20;
    } else {
      var pointsPerWarning = 20 / expectedWarnings.length;
      expectedWarnings.forEach(function (expectedWarn) {
        var found = actualWarnings.some(function (aw) {
          return typeof aw === 'string' && aw.toLowerCase().indexOf(expectedWarn.toLowerCase()) !== -1;
        });
        if (found) {
          warningScore += pointsPerWarning;
        } else {
          warningIssues.push({ missingWarning: expectedWarn });
        }
      });
    }

    // ── Amendment precedence: 10 pts ──────────────────────────────────────────
    if (!expected.amendmentPrecedence) {
      amendmentScore = 10;
    } else {
      var expAP = expected.amendmentPrecedence;
      if (actualAmendmentPrecedence &&
          actualAmendmentPrecedence.winningDocType === expAP.winningDocType &&
          actualAmendmentPrecedence.governingField === expAP.governingField) {
        // Check value — numeric within 0.01, string case-insensitive, other exact
        var expVal = expAP.expectedValue;
        var actVal = actualAmendmentPrecedence.expectedValue !== undefined
          ? actualAmendmentPrecedence.expectedValue
          : actualAmendmentPrecedence.value;
        var valMatch = false;
        if (expVal === null || expVal === undefined) {
          valMatch = (actVal === null || actVal === undefined);
        } else if (typeof expVal === 'number') {
          valMatch = (typeof actVal === 'number' && Math.abs(actVal - expVal) <= 0.01);
        } else if (typeof expVal === 'string') {
          valMatch = (typeof actVal === 'string' && actVal.toLowerCase() === expVal.toLowerCase());
        } else {
          valMatch = (actVal === expVal);
        }
        if (valMatch) {
          amendmentScore = 10;
        } else {
          amendmentIssues.push({ issue: 'Wrong amendment value', expected: expAP, actual: actualAmendmentPrecedence });
        }
      } else {
        amendmentIssues.push({ issue: 'Wrong or missing amendment precedence', expected: expAP, actual: actualAmendmentPrecedence });
      }
    }

    // ── Edge cases: 10 pts ────────────────────────────────────────────────────
    var expectedEdgeCases = expected.edgeCases || [];
    if (expectedEdgeCases.length === 0) {
      edgeCaseScore = 10;
    } else {
      var pointsPerEdge = 10 / expectedEdgeCases.length;
      expectedEdgeCases.forEach(function (expectedType) {
        var found = actualEdgeCases.some(function (ae) {
          return ae === expectedType;
        });
        if (found) {
          edgeCaseScore += pointsPerEdge;
        } else {
          edgeCaseIssues.push({ missingEdgeCase: expectedType });
        }
      });
    }

    var totalScore = Math.round(fieldScore + confidenceScore + warningScore + amendmentScore + edgeCaseScore);
    // Veto: cannot pass if a component with non-empty expectations scores zero
    var componentVeto = (
      (expectedWarnings.length > 0 && warningScore === 0) ||
      (expected.amendmentPrecedence && amendmentScore === 0) ||
      (expectedEdgeCases.length > 0 && edgeCaseScore === 0)
    );
    var pass = totalScore >= 80 && !componentVeto;

    return {
      score: totalScore,
      pass: pass,
      breakdown: {
        fields: Math.round(fieldScore),
        confidence: Math.round(confidenceScore),
        warnings: Math.round(warningScore),
        amendment: Math.round(amendmentScore),
        edgeCases: Math.round(edgeCaseScore)
      },
      failedFields: failedFields,
      confidenceIssues: confidenceIssues,
      warningIssues: warningIssues,
      amendmentIssues: amendmentIssues,
      edgeCaseIssues: edgeCaseIssues
    };
  }

  // ─── _processScenario ────────────────────────────────────────────────────────
  // Replaces hardcoded _edgeCases / _explainability / _multiDocReasoning / _confidenceScore
  // with live output from production LeaseIntelligence functions (FP-1/2/3/6 fix).
  function _processScenario(scenarioDef) {
    var LI = typeof window !== 'undefined' ? window.LeaseIntelligence : null;
    var tenant = JSON.parse(JSON.stringify(scenarioDef.tenant));
    // Fail loudly instead of silently reverting to static fixture data. A missing
    // LeaseIntelligence means the benchmark would measure hardcoded values rather
    // than live production functions — the exact tautology Phase 19 eliminated.
    // See Issue #1.
    if (!LI) {
      throw new Error(
        '_processScenario: window.LeaseIntelligence is not loaded. ' +
        'Ensure lease-intelligence.js is evaluated before lease-test-lab.js. ' +
        'Without it, runSuite() would report results derived from static fixture ' +
        'data rather than live production functions.'
      );
    }

    // FP-2: real edge-case detector
    // Use scenario ocrContext when provided; otherwise only pass ocrText (not ocrChars)
    // so OCR-volume detectors (WEAK_OCR/MISSING_PAGES) don't fire on short test text.
    var ocrCtx = scenarioDef.ocrContext || { ocrText: scenarioDef.leaseText || '' };
    tenant._edgeCases = LI.detectLeaseEdgeCases(tenant, ocrCtx);

    // FP-3/FP-4: real explainability → generates reviewNotes from tenant state
    tenant._explainability = LI.generateLeaseExplainability(tenant);

    // FP-3: real multi-doc reasoning if amendments present
    if (Array.isArray(tenant.amendments) && tenant.amendments.length > 0) {
      var docs = LI.buildMultiDocReasoningDocs(tenant);
      tenant._multiDocReasoning = LI.reasonMultiDocumentLease(docs);
    }

    // FP-6: derive confidence from field evidence quality + edge case adjustments
    // Level-appropriate base avoids impossible scores for complex scenarios.
    var _levelBase = { easy: 75, medium: 60, hard: 45, nightmare: 30 };
    var base = _levelBase[scenarioDef.level] || 60;
    var fev = tenant.fieldEvidence || {};
    var fevKeys = Object.keys(fev);
    var quotedWithValue = fevKeys.filter(function(k) {
      return (fev[k].snapshots || []).some(function(s) { return s.quote && s.value != null; });
    }).length;
    var evidenceBonus = fevKeys.length > 0 ? Math.round((quotedWithValue / fevKeys.length) * 20) : 0;
    var edgeAdj = (tenant._edgeCases && tenant._edgeCases.totalConfidenceAdjustment) || 0;
    tenant._confidenceScore = Math.max(10, Math.min(100, base + evidenceBonus + edgeAdj));
    tenant._confidence = tenant._confidenceScore >= 70 ? 'high' : tenant._confidenceScore >= 50 ? 'medium' : 'low';

    return tenant;
  }

  // ─── runSuite ────────────────────────────────────────────────────────────────
  function runSuite(levels) {
    var results = [];
    var filtered = levels && levels.length
      ? SCENARIO_REGISTRY.filter(function (s) { return levels.indexOf(s.level) !== -1; })
      : SCENARIO_REGISTRY;

    filtered.forEach(function (scenarioDef) {
      var scenario = generateScenario(scenarioDef.id);
      var processed = _processScenario(scenarioDef);
      var validation = validate(processed, scenario.expected);
      results.push({ scenario: scenario, result: processed, validation: validation });
    });
    return results;
  }

  // ─── scoreSuite ──────────────────────────────────────────────────────────────
  function scoreSuite(suiteResults) {
    var totalScenarios = suiteResults.length;
    var passed = 0;
    var fieldScoreSum = 0;
    var amendmentCorrect = 0;
    var amendmentTotal = 0;
    var confidenceCorrect = 0;
    var edgeFullyDetected = 0;
    var edgeTotal = 0;

    var byLevel = { easy: { totalScenarios: 0, passed: 0, passRate: 0 }, medium: { totalScenarios: 0, passed: 0, passRate: 0 }, hard: { totalScenarios: 0, passed: 0, passRate: 0 }, nightmare: { totalScenarios: 0, passed: 0, passRate: 0 } };

    suiteResults.forEach(function (sr) {
      var v = sr.validation;
      var s = sr.scenario;
      var level = s.level;

      if (v.pass) passed++;

      // Field score portion (out of 40)
      fieldScoreSum += (v.breakdown.fields / 40);

      // Amendment accuracy
      if (s.expected.amendmentPrecedence) {
        amendmentTotal++;
        if (v.breakdown.amendment === 10) amendmentCorrect++;
      }

      // Confidence calibration
      if (v.breakdown.confidence === 20) confidenceCorrect++;

      // Edge case detection
      if (s.expected.edgeCases && s.expected.edgeCases.length > 0) {
        edgeTotal++;
        if (v.breakdown.edgeCases === 10) edgeFullyDetected++;
      }

      // byLevel
      if (byLevel[level]) {
        byLevel[level].totalScenarios++;
        if (v.pass) byLevel[level].passed++;
      }
    });

    // Compute passRates for byLevel
    Object.keys(byLevel).forEach(function (lvl) {
      var bl = byLevel[lvl];
      bl.passRate = bl.totalScenarios > 0 ? bl.passed / bl.totalScenarios : 0;
    });

    return {
      totalScenarios: totalScenarios,
      passed: passed,
      passRate: totalScenarios > 0 ? passed / totalScenarios : 0,
      extractionAccuracy: totalScenarios > 0 ? fieldScoreSum / totalScenarios : 0,
      amendmentAccuracy: amendmentTotal > 0 ? amendmentCorrect / amendmentTotal : null,
      confidenceCalibration: totalScenarios > 0 ? confidenceCorrect / totalScenarios : 0,
      edgeCaseDetectionRate: edgeTotal > 0 ? edgeFullyDetected / edgeTotal : null,
      amendmentTestedCount: amendmentTotal,
      edgeCaseTestedCount: edgeTotal,
      byLevel: byLevel
    };
  }

  // ─── generateBenchmarkReportHtml ─────────────────────────────────────────────
  function generateBenchmarkReportHtml(suiteResults, stats) {
    var esc = function (str) {
      if (str === null || str === undefined) return '';
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    };
    var pct = function (n) { return n == null ? 'N/A' : (n * 100).toFixed(1) + '%'; };

    // ── 1. Summary stats ──────────────────────────────────────────────────────
    var summaryHtml = '<table class="rpt-table rpt-summary-table"><thead><tr>' +
      '<th>Metric</th><th>Value</th></tr></thead><tbody>' +
      '<tr><td>Pass Rate</td><td class="rpt-val">' + pct(stats.passRate) + ' (' + stats.passed + '/' + stats.totalScenarios + ')</td></tr>' +
      '<tr><td>Extraction Accuracy</td><td class="rpt-val">' + pct(stats.extractionAccuracy) + '</td></tr>' +
      '<tr><td>Amendment Accuracy</td><td class="rpt-val">' + pct(stats.amendmentAccuracy) + (stats.amendmentTestedCount ? ' (' + stats.amendmentTestedCount + ' tested)' : '') + '</td></tr>' +
      '<tr><td>Confidence Calibration</td><td class="rpt-val">' + pct(stats.confidenceCalibration) + '</td></tr>' +
      '<tr><td>Edge Case Detection Rate</td><td class="rpt-val">' + pct(stats.edgeCaseDetectionRate) + (stats.edgeCaseTestedCount ? ' (' + stats.edgeCaseTestedCount + ' tested)' : '') + '</td></tr>' +
      '</tbody></table>';

    // by-level breakdown
    var levelRows = ['easy', 'medium', 'hard', 'nightmare'].map(function (lvl) {
      var bl = stats.byLevel[lvl];
      if (!bl || bl.totalScenarios === 0) return '';
      return '<tr><td>' + esc(lvl.charAt(0).toUpperCase() + lvl.slice(1)) + '</td><td>' + bl.passed + '/' + bl.totalScenarios + '</td><td>' + pct(bl.passRate) + '</td></tr>';
    }).join('');
    summaryHtml += '<table class="rpt-table rpt-level-table"><thead><tr><th>Level</th><th>Passed</th><th>Pass Rate</th></tr></thead><tbody>' + levelRows + '</tbody></table>';

    // ── 2. Per-scenario results table ─────────────────────────────────────────
    var rowsHtml = suiteResults.map(function (sr) {
      var v = sr.validation;
      var s = sr.scenario;
      var failedFieldNames = v.failedFields.map(function (f) { return f.field; }).join(', ');
      var passClass = v.pass ? 'rpt-pass' : 'rpt-fail';
      var passLabel = v.pass ? 'PASS' : 'FAIL';
      return '<tr>' +
        '<td class="rpt-id">' + esc(s.id) + '</td>' +
        '<td class="rpt-level rpt-level-' + esc(s.level) + '">' + esc(s.level) + '</td>' +
        '<td class="rpt-score">' + esc(v.score) + '</td>' +
        '<td class="' + passClass + '">' + passLabel + '</td>' +
        '<td class="rpt-failed-fields">' + esc(failedFieldNames || '—') + '</td>' +
        '</tr>';
    }).join('');

    var scenarioTableHtml = '<table class="rpt-table rpt-scenarios-table"><thead><tr>' +
      '<th>Scenario</th><th>Level</th><th>Score</th><th>Result</th><th>Failed Fields</th>' +
      '</tr></thead><tbody>' + rowsHtml + '</tbody></table>';

    // ── 3. Confidence calibration errors ──────────────────────────────────────
    var confErrors = suiteResults.filter(function (sr) { return sr.validation.confidenceIssues.length > 0; });
    var confHtml = '';
    if (confErrors.length === 0) {
      confHtml = '<p class="rpt-ok">All scenarios within expected confidence range.</p>';
    } else {
      confHtml = confErrors.map(function (sr) {
        var ci = sr.validation.confidenceIssues[0];
        return '<div class="rpt-conf-error"><strong>' + esc(sr.scenario.id) + '</strong> — ' +
          'Expected range: [' + esc(sr.scenario.expected.confidenceRange[0]) + ', ' + esc(sr.scenario.expected.confidenceRange[1]) + '], ' +
          'Actual: ' + esc(ci.actual) + '</div>';
      }).join('');
    }

    // ── 4. Amendment mistakes ─────────────────────────────────────────────────
    var amdErrors = suiteResults.filter(function (sr) { return sr.validation.amendmentIssues.length > 0; });
    var amdHtml = '';
    if (amdErrors.length === 0) {
      amdHtml = '<p class="rpt-ok">All amendment precedence checks passed.</p>';
    } else {
      amdHtml = amdErrors.map(function (sr) {
        var ai = sr.validation.amendmentIssues[0];
        var expAP = sr.scenario.expected.amendmentPrecedence;
        return '<div class="rpt-amd-error"><strong>' + esc(sr.scenario.id) + '</strong> — ' +
          'Expected: ' + (expAP ? esc(expAP.winningDocType) + ' wins on ' + esc(expAP.governingField) + ' = ' + esc(expAP.expectedValue) : 'N/A') + '<br>' +
          'Issue: ' + esc(ai.issue) + '</div>';
      }).join('');
    }

    // ── 5. Recommendations ────────────────────────────────────────────────────
    var recommendations = [];
    if (stats.passRate < 0.5) recommendations.push('Overall pass rate is below 50% — extraction pipeline needs significant improvement.');
    if (stats.extractionAccuracy < 0.7) recommendations.push('Extraction accuracy is below 70% — review field normalization and value parsing logic.');
    if (stats.amendmentAccuracy < 0.8) recommendations.push('Amendment accuracy is below 80% — review precedence resolution: side_letter > estoppel > amendment by date > original_lease.');
    if (stats.confidenceCalibration < 0.6) recommendations.push('Confidence calibration is below 60% — review confidence scoring thresholds and signal weights.');
    if (stats.edgeCaseDetectionRate < 0.7) recommendations.push('Edge case detection rate is below 70% — review detector thresholds and trigger conditions.');
    if (stats.byLevel.nightmare && stats.byLevel.nightmare.passRate < 0.2) recommendations.push('Nightmare scenarios have near-zero pass rate — expected for complex multi-document conflicts, but worth reviewing side letter and OCR handling.');
    if (recommendations.length === 0) recommendations.push('All key metrics are within acceptable thresholds. Continue monitoring extraction quality with each new document type.');

    var recsHtml = '<ul class="rpt-recommendations">' + recommendations.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul>';

    // ── Assemble HTML ─────────────────────────────────────────────────────────
    var css = '<style>' +
      '.rpt-benchmark { font-family: sans-serif; color: #1e293b; max-width: 900px; margin: 0 auto; }' +
      '.rpt-section { margin-bottom: 28px; }' +
      '.rpt-section h2 { font-size: 1rem; font-weight: 700; color: #0f172a; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px; margin-bottom: 12px; }' +
      '.rpt-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; margin-bottom: 12px; }' +
      '.rpt-table th { background: #f1f5f9; text-align: left; padding: 7px 10px; font-weight: 600; border-bottom: 2px solid #cbd5e1; }' +
      '.rpt-table td { padding: 6px 10px; border-bottom: 1px solid #e2e8f0; }' +
      '.rpt-val { font-weight: 600; }' +
      '.rpt-pass { color: #15803d; font-weight: 700; }' +
      '.rpt-fail { color: #b91c1c; font-weight: 700; }' +
      '.rpt-ok { color: #15803d; font-style: italic; }' +
      '.rpt-level-easy { color: #0369a1; }' +
      '.rpt-level-medium { color: #92400e; }' +
      '.rpt-level-hard { color: #9a3412; }' +
      '.rpt-level-nightmare { color: #7e22ce; font-weight: 700; }' +
      '.rpt-conf-error, .rpt-amd-error { background: #fef9c3; border-left: 3px solid #ca8a04; padding: 8px 12px; margin-bottom: 8px; border-radius: 4px; font-size: 0.85rem; }' +
      '.rpt-recommendations li { margin-bottom: 6px; font-size: 0.9rem; color: #1e293b; }' +
      '.rpt-id { font-family: monospace; font-size: 0.8rem; }' +
      '.rpt-score { font-weight: 600; }' +
      '.rpt-failed-fields { font-size: 0.8rem; color: #64748b; font-family: monospace; }' +
      '</style>';

    return css + '<div class="rpt-benchmark">' +
      '<div class="rpt-section"><h2>1. Summary Statistics</h2>' + summaryHtml + '</div>' +
      '<div class="rpt-section"><h2>2. Per-Scenario Results</h2>' + scenarioTableHtml + '</div>' +
      '<div class="rpt-section"><h2>3. Confidence Calibration Errors</h2>' + confHtml + '</div>' +
      '<div class="rpt-section"><h2>4. Amendment Precedence Mistakes</h2>' + amdHtml + '</div>' +
      '<div class="rpt-section"><h2>5. Recommendations</h2>' + recsHtml + '</div>' +
      '</div>';
  }

  // ─── Expose public API ────────────────────────────────────────────────────────
  window.LeaseTestLab = {
    generateScenario: generateScenario,
    validate: validate,
    runSuite: runSuite,
    scoreSuite: scoreSuite,
    generateBenchmarkReportHtml: generateBenchmarkReportHtml,
    _SCENARIO_REGISTRY: SCENARIO_REGISTRY
  };

}());
