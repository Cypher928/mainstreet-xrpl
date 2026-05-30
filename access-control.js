/**
 * access-control.js
 * Pure-function RBAC helpers for Mainstreet.
 * No DOM access, no mutable state, no side effects.
 *
 * SECURITY NOTE:
 * These functions are UI-layer guards only. They reduce the surface area of
 * unintentional access by hiding or disabling controls, but they are NOT a
 * security boundary. Supabase Row Level Security (RLS) is the authoritative
 * enforcement layer for all data access. Never rely solely on client-side
 * checks to protect sensitive operations.
 *
 * Role matrix summary:
 *
 * Function              | landlord | tenant | reviewer | admin
 * ──────────────────────┼──────────┼────────┼──────────┼──────
 * canViewPortfolio      | true     | false  | true     | true
 * canViewProperty       | true     | *      | true     | true   (* see below)
 * canEditReview         | true     | false  | true     | true
 * canExportAudit        | true     | false  | false    | true
 * canViewTenant         | true     | *      | true     | true   (* see below)
 * canDeleteDispute      | true     | false  | false    | true
 * canViewReviewQueue    | true     | false  | true     | true
 * canViewAuditLog       | true     | false  | false    | true
 * canAddProperty        | true     | false  | false    | true
 * isTenantPortalMode    | false    | true   | false    | false
 *
 * canViewProperty (tenant): true if propertyIds is empty OR propertyIds includes property.id
 * canViewTenant   (tenant): true if tenant.user_id === user.id OR tenant.id === user.id
 *
 * Exposes: window.AccessControl
 */
window.AccessControl = (() => {
  'use strict';

  // ── Internal helpers ────────────────────────────────────────────────────────

  /**
   * Returns the role string from a user object, or null if user is falsy.
   * @param {object|null|undefined} user
   * @returns {string|null}
   */
  function _role(user) {
    return user ? (user.role || null) : null;
  }

  // ── Role-matrix functions ────────────────────────────────────────────────────

  /**
   * Can the user view the portfolio dashboard?
   * landlord / reviewer / admin: yes  |  tenant: no
   * @param {object|null} user - normalized AuthService user
   * @returns {boolean}
   */
  function canViewPortfolio(user) {
    const r = _role(user);
    if (!r) return false;
    return r === 'landlord' || r === 'reviewer' || r === 'admin';
  }

  /**
   * Can the user view a specific property?
   * landlord / reviewer / admin: always yes
   * tenant: yes if propertyIds is empty (no restriction configured yet)
   *         OR propertyIds explicitly includes the property's id
   * @param {object|null} user - normalized AuthService user
   * @param {object|null} property - property object with at least { id: string }
   * @returns {boolean}
   */
  function canViewProperty(user, property) {
    const r = _role(user);
    if (!r) return false;
    if (r === 'landlord' || r === 'reviewer' || r === 'admin') return true;
    if (r === 'tenant') {
      const ids = Array.isArray(user.propertyIds) ? user.propertyIds : [];
      // Empty list means no restriction has been configured yet — allow all
      if (ids.length === 0) return true;
      return ids.includes(property ? property.id : undefined);
    }
    return false;
  }

  /**
   * Can the user edit a review (approve/dispute a line item)?
   * landlord / reviewer / admin: yes  |  tenant: no
   * @param {object|null} user
   * @returns {boolean}
   */
  function canEditReview(user) {
    const r = _role(user);
    if (!r) return false;
    return r === 'landlord' || r === 'reviewer' || r === 'admin';
  }

  /**
   * Can the user export the audit log?
   * landlord / admin: yes  |  tenant / reviewer: no
   * @param {object|null} user
   * @returns {boolean}
   */
  function canExportAudit(user) {
    const r = _role(user);
    if (!r) return false;
    return r === 'landlord' || r === 'admin';
  }

  /**
   * Can the user view a specific tenant record?
   * landlord / reviewer / admin: always yes
   * tenant: yes if the tenant record belongs to this user
   *         (tenant.user_id === user.id OR tenant.id === user.id)
   * @param {object|null} user - normalized AuthService user
   * @param {object|null} tenant - tenant record with optional user_id and id fields
   * @returns {boolean}
   */
  function canViewTenant(user, tenant) {
    const r = _role(user);
    if (!r) return false;
    if (r === 'landlord' || r === 'reviewer' || r === 'admin') return true;
    if (r === 'tenant') {
      if (!tenant) return false;
      return tenant.user_id === user.id || tenant.id === user.id;
    }
    return false;
  }

  /**
   * Can the user permanently delete a dispute?
   * landlord / admin: yes  |  tenant / reviewer: no
   * @param {object|null} user
   * @returns {boolean}
   */
  function canDeleteDispute(user) {
    const r = _role(user);
    if (!r) return false;
    return r === 'landlord' || r === 'admin';
  }

  /**
   * Can the user view the review queue panel?
   * landlord / reviewer / admin: yes  |  tenant: no
   * @param {object|null} user
   * @returns {boolean}
   */
  function canViewReviewQueue(user) {
    const r = _role(user);
    if (!r) return false;
    return r === 'landlord' || r === 'reviewer' || r === 'admin';
  }

  /**
   * Can the user view the audit log?
   * landlord / admin: yes  |  tenant / reviewer: no
   * @param {object|null} user
   * @returns {boolean}
   */
  function canViewAuditLog(user) {
    const r = _role(user);
    if (!r) return false;
    return r === 'landlord' || r === 'admin';
  }

  /**
   * Can the user add a new property?
   * landlord / admin: yes  |  tenant / reviewer: no
   * @param {object|null} user
   * @returns {boolean}
   */
  function canAddProperty(user) {
    const r = _role(user);
    if (!r) return false;
    return r === 'landlord' || r === 'admin';
  }

  /**
   * Should the app enter tenant portal mode (limited read-only view)?
   * Only true for the 'tenant' role.
   * @param {object|null} user
   * @returns {boolean}
   */
  function isTenantPortalMode(user) {
    const r = _role(user);
    if (!r) return false;
    return r === 'tenant';
  }

  // ── Exports ──────────────────────────────────────────────────────────────────

  return {
    canViewPortfolio,
    canViewProperty,
    canEditReview,
    canExportAudit,
    canViewTenant,
    canDeleteDispute,
    canViewReviewQueue,
    canViewAuditLog,
    canAddProperty,
    isTenantPortalMode,
  };
})();
