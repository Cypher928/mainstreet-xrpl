'use strict';
/**
 * cam-exclusions.js — resolving lease exclusion prose into invoice categories.
 *
 * F-02 (evidence/FINDINGS-excluded-categories.md): `excluded_categories` is
 * free text from the model, and the allocation filter compared it to the
 * nine-value invoice vocabulary with exact string equality. Across Runs 1-3,
 * 3 of 55 extracted phrases could ever match. The other 52 were inert — and a
 * non-matching exclusion fails open, so the tenant was billed for expenses
 * their lease excludes while the statement told them otherwise.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO
 *
 * It does not guess. The plan's first draft proposed mapping "capital
 * expenditures" onto `repairs`, which is the only bucket that could hold it.
 * But `repairs` is also where ordinary recoverable repairs land, so that
 * mapping would exclude routine repairs the tenant does owe — an under-billing
 * error introduced by the fix, opposite in direction to the defect. Those
 * phrases resolve to `ambiguous` and are NOT applied.
 *
 * Only `exact` and hand-reviewed `mapped` entries ever affect a dollar. The
 * synonym table below is additive-only: no stemming, no fuzzy matching, no
 * substring containment. Substring containment is precisely how
 * "capital expenditures" becomes "repairs".
 *
 * Exposes: window.CamExclusions (browser) and module.exports (Node tests).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CamExclusions = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  // Mirrors CATEGORIES in script.js:696 and the enum the invoice classifier is
  // constrained to (api/_claude-tasks.js:169). If that list changes, change this
  // with it — a category here that the classifier never emits can never match.
  const CANONICAL_CATEGORIES = [
    'insurance', 'landscaping', 'snow', 'repairs', 'utilities',
    'janitorial', 'security', 'management', 'other',
  ];

  // Hand-reviewed synonyms. Each entry must name a phrase that is NARROWER THAN
  // OR EQUAL TO its category, never broader — otherwise applying it excludes
  // expenses the lease does not exclude. Add only with that check made.
  const SAFE_SYNONYMS = {
    'management fee':          'management',
    'management fees':         'management',
    'property management fee': 'management',
    'property management fees':'management',
    'administrative fee':      'management',
    'administrative fees':     'management',
    'admin fee':               'management',
    'admin fees':              'management',
    'snow removal':            'snow',
    'snow plowing':            'snow',
    'snow and ice removal':    'snow',
    'grounds care':            'landscaping',
    'grounds maintenance':     'landscaping',
    'landscape maintenance':   'landscaping',
    'janitorial services':     'janitorial',
    'cleaning services':       'janitorial',
    'security services':       'security',
    'insurance premiums':      'insurance',
    'utility charges':         'utilities',
  };

  // Phrases whose only possible bucket is broader than the phrase itself.
  // Applying these would over-exclude. They are surfaced, never applied.
  const AMBIGUOUS_RULES = [
    { test: /\bcapital\b/i,                    candidates: ['repairs'],
      reason: 'Capital expenditure exclusions have no capital/operating axis in the invoice vocabulary. The only candidate bucket is "repairs", which also holds ordinary recoverable repairs, so applying this would exclude repairs the tenant does owe.' },
    { test: /\bstructural\b/i,                 candidates: ['repairs'],
      reason: 'Structural exclusions would have to map to "repairs", which also holds ordinary recoverable repairs.' },
    { test: /\broof\b/i,                       candidates: ['repairs'],
      reason: 'Roof work would have to map to "repairs", which also holds ordinary recoverable repairs.' },
    { test: /\bfoundation(s)?\b/i,             candidates: ['repairs'],
      reason: 'Foundation work would have to map to "repairs", which also holds ordinary recoverable repairs.' },
  ];

  function normalizePhrase(phrase) {
    return String(phrase == null ? '' : phrase).trim().toLowerCase().replace(/\s+/g, ' ');
  }

  /**
   * Resolve a single exclusion phrase.
   * @returns {{raw:string, category:string|null, status:'exact'|'mapped'|'ambiguous'|'unmapped', candidates:string[], reason:string}}
   */
  function canonicalizeExclusion(phrase) {
    const raw  = String(phrase == null ? '' : phrase).trim();
    const norm = normalizePhrase(phrase);

    if (!norm) {
      return { raw, category: null, status: 'unmapped', candidates: [], reason: 'Empty phrase.' };
    }
    if (CANONICAL_CATEGORIES.indexOf(norm) !== -1) {
      return { raw, category: norm, status: 'exact', candidates: [], reason: 'Exact match to an invoice category.' };
    }
    // Ambiguity is checked BEFORE synonyms so a future synonym entry cannot
    // quietly override a known over-exclusion risk.
    for (const rule of AMBIGUOUS_RULES) {
      if (rule.test.test(norm)) {
        return { raw, category: null, status: 'ambiguous', candidates: rule.candidates.slice(), reason: rule.reason };
      }
    }
    if (Object.prototype.hasOwnProperty.call(SAFE_SYNONYMS, norm)) {
      return { raw, category: SAFE_SYNONYMS[norm], status: 'mapped', candidates: [], reason: 'Hand-reviewed synonym, narrower than or equal to its category.' };
    }
    return {
      raw, category: null, status: 'unmapped', candidates: [],
      reason: 'No invoice category corresponds to this exclusion. The vocabulary classifies what an invoice is for; this exclusion is about recoverability.',
    };
  }

  /** Split a stored comma-separated exclusion string and resolve each phrase. */
  function resolveExclusions(rawString) {
    if (rawString == null) return [];
    return String(rawString)
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .map(canonicalizeExclusion);
  }

  /** Categories that may affect allocation. Only 'exact' and 'mapped'. */
  function appliedCategories(resolved) {
    const out = [];
    (resolved || []).forEach(r => {
      if (r && (r.status === 'exact' || r.status === 'mapped') && r.category && out.indexOf(r.category) === -1) {
        out.push(r.category);
      }
    });
    return out;
  }

  /** Entries that were extracted but cannot be applied. These must be surfaced. */
  function unappliedExclusions(resolved) {
    return (resolved || []).filter(r => r && r.status !== 'exact' && r.status !== 'mapped');
  }

  /**
   * Stable fingerprint of a raw exclusion string, used to invalidate a
   * landlord's acknowledgement when the underlying exclusions change.
   * FNV-1a — deterministic and synchronous; not a security hash.
   */
  function exclusionFingerprint(rawString) {
    // Keyed on the semantic SET of phrases, not the literal string: re-spacing
    // or reordering the same exclusions must not invalidate an acknowledgement,
    // because the applied categories are identical. Adding or removing one must.
    const s = Array.from(new Set(
      String(rawString == null ? '' : rawString)
        .split(',').map(normalizePhrase).filter(Boolean)
    )).sort().join('|');
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ('00000000' + h.toString(16)).slice(-8);
  }

  /**
   * One call for a tenant's exclusion state.
   * `rawString` null/undefined means the field was never extracted; '' means
   * extraction ran and found no exclusion schedule. Those are different and
   * the caller is told which.
   */
  function tenantExclusionState(rawString) {
    const resolved = resolveExclusions(rawString);
    return {
      resolved,
      applied:     appliedCategories(resolved),
      notApplied:  unappliedExclusions(resolved),
      fingerprint: exclusionFingerprint(rawString),
      extracted:   rawString !== null && rawString !== undefined,
      empty:       rawString === '',
    };
  }

  return {
    CANONICAL_CATEGORIES,
    SAFE_SYNONYMS,
    AMBIGUOUS_RULES,
    normalizePhrase,
    canonicalizeExclusion,
    resolveExclusions,
    appliedCategories,
    unappliedExclusions,
    exclusionFingerprint,
    tenantExclusionState,
  };
});
