/**
 * auth-service.js
 * In-memory authentication state for Mainstreet.
 * Normalizes Supabase user objects into a consistent shape and exposes
 * role-check helpers used throughout the application.
 *
 * SECURITY NOTES:
 * - Role is read from user_metadata (client-writable in Supabase).
 *   In production, authoritative role assignment must use app_metadata
 *   (server-side only) and be enforced by Supabase Row Level Security (RLS).
 *   These helpers are UI-layer conveniences only.
 * - _currentUser is held in memory only — never written to localStorage
 *   or any other persistent store.
 *
 * Exposes: window.AuthService
 */
window.AuthService = (() => {
  'use strict';

  // ── Constants ───────────────────────────────────────────────────────────────

  /** Set of valid role strings; anything else normalizes to 'landlord'. */
  const VALID_ROLES = new Set(['landlord', 'tenant', 'reviewer', 'admin']);

  // ── Private mutable state ───────────────────────────────────────────────────
  // This is the ONE piece of mutable state this module holds.
  // It is never persisted to localStorage.

  let _currentUser = null;

  // ── Internal helpers ────────────────────────────────────────────────────────

  /**
   * Derives a display name from Supabase user metadata.
   * Priority: display_name → full_name → email prefix (part before @).
   * @param {object} meta - user_metadata object (may be empty)
   * @param {string} email - user's email address
   * @returns {string}
   */
  function _deriveDisplayName(meta, email) {
    if (meta.display_name && typeof meta.display_name === 'string' && meta.display_name.trim()) {
      return meta.display_name.trim();
    }
    if (meta.full_name && typeof meta.full_name === 'string' && meta.full_name.trim()) {
      return meta.full_name.trim();
    }
    // Fall back to the part of the email address before '@'
    if (typeof email === 'string' && email.includes('@')) {
      return email.split('@')[0];
    }
    return email || '';
  }

  /**
   * Validates a role string; returns 'landlord' for any unrecognized value.
   * @param {*} raw - raw role value from user_metadata
   * @returns {'landlord'|'tenant'|'reviewer'|'admin'}
   */
  function _normalizeRole(raw) {
    return VALID_ROLES.has(raw) ? raw : 'landlord';
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Normalizes a raw Supabase user object into the app's user shape,
   * stores it in _currentUser, and returns it.
   * If sbUser is null or undefined, clears _currentUser and returns null.
   *
   * Normalized shape:
   * {
   *   id:          string,
   *   email:       string,
   *   role:        'landlord'|'tenant'|'reviewer'|'admin',
   *   displayName: string,
   *   propertyIds: string[],
   *   createdAt:   string|null
   * }
   *
   * @param {object|null|undefined} sbUser - raw Supabase auth user object
   * @returns {object|null}
   */
  function hydrateFromSupabaseUser(sbUser) {
    if (sbUser == null) {
      _currentUser = null;
      return null;
    }

    const meta = (sbUser.user_metadata && typeof sbUser.user_metadata === 'object')
      ? sbUser.user_metadata
      : {};
    const appMeta = (sbUser.app_metadata && typeof sbUser.app_metadata === 'object')
      ? sbUser.app_metadata
      : {};

    const email = sbUser.email || '';

    // Phase A — role provenance.
    // user_metadata is writable by the client that owns the session: a user can
    // PATCH /auth/v1/user and set role:'landlord' on themselves. app_metadata is
    // writable only with the service role. So app_metadata wins when present,
    // and `roleTrusted` records which source was used.
    //
    // This does NOT make role an authorization input. Tenant authorization is
    // the tenant_users table and public.tenant_ids_for_current_user() in the
    // database (migration 012); RLS never reads a role claim, and a forged
    // landlord role returns zero rows. Role here drives UI affordances only.
    const roleTrusted = typeof appMeta.role === 'string';
    const role = _normalizeRole(roleTrusted ? appMeta.role : meta.role);

    // property_ids must be an array of strings; default to empty array
    let propertyIds = [];
    if (Array.isArray(meta.property_ids)) {
      propertyIds = meta.property_ids.filter(v => typeof v === 'string');
    }

    // Tenant memberships. Server-derived only — populated by setTenantIds()
    // from a SELECT against tenant_users, which RLS restricts to the caller's
    // own rows. Never read from a client-supplied claim. Empty means "no
    // membership known yet", and every consumer must fail closed on empty.
    let tenantIds = [];
    if (Array.isArray(appMeta.tenant_ids)) {
      tenantIds = appMeta.tenant_ids.filter(v => typeof v === 'string');
    }

    _currentUser = {
      id:          sbUser.id   || '',
      email,
      role,
      roleTrusted,
      displayName: _deriveDisplayName(meta, email),
      propertyIds,
      tenantIds,
      createdAt:   sbUser.created_at || null,
    };

    return _currentUser;
  }

  /**
   * Returns the currently authenticated normalized user, or null.
   * @returns {object|null}
   */
  function getCurrentUser() {
    return _currentUser;
  }

  /**
   * Returns true if a user is currently authenticated (non-null).
   * @returns {boolean}
   */
  function isAuthenticated() {
    return _currentUser !== null;
  }

  /**
   * Returns the role string of the current user, or null if not authenticated.
   * @returns {'landlord'|'tenant'|'reviewer'|'admin'|null}
   */
  function getUserRole() {
    return _currentUser ? _currentUser.role : null;
  }

  /**
   * Returns true if the current user has the 'landlord' role.
   * @returns {boolean}
   */
  function isLandlord() {
    return _currentUser?.role === 'landlord';
  }

  /**
   * Returns true if the current user has the 'tenant' role.
   * @returns {boolean}
   */
  function isTenant() {
    return _currentUser?.role === 'tenant';
  }

  /**
   * Returns true if the current user has the 'reviewer' role.
   * @returns {boolean}
   */
  function isReviewer() {
    return _currentUser?.role === 'reviewer';
  }

  /**
   * Returns true if the current user has the 'admin' role.
   * @returns {boolean}
   */
  function isAdmin() {
    return _currentUser?.role === 'admin';
  }

  /**
   * Clears the current user from in-memory state.
   * Call on sign-out.
   */
  function clear() {
    _currentUser = null;
  }

  /**
   * Directly sets the current user from a pre-normalized user object.
   * Validates role (unknown → 'landlord') and coerces propertyIds to array.
   * Intended for dev tooling and testing — in production, prefer
   * hydrateFromSupabaseUser() which normalizes from a raw Supabase object.
   * @param {object|null} normalizedUser
   * @returns {object|null}
   */
  function setUser(normalizedUser) {
    if (normalizedUser == null) {
      _currentUser = null;
      return null;
    }
    const role = VALID_ROLES.has(normalizedUser.role) ? normalizedUser.role : 'landlord';
    const email = normalizedUser.email || '';
    _currentUser = {
      id:          normalizedUser.id          || '',
      email,
      role,
      roleTrusted: normalizedUser.roleTrusted === true,
      displayName: normalizedUser.displayName || email.split('@')[0] || '',
      propertyIds: Array.isArray(normalizedUser.propertyIds) ? normalizedUser.propertyIds.filter(v => typeof v === 'string') : [],
      tenantIds:   Array.isArray(normalizedUser.tenantIds)   ? normalizedUser.tenantIds.filter(v => typeof v === 'string')   : [],
      createdAt:   normalizedUser.createdAt   || null,
    };
    return _currentUser;
  }

  /**
   * Records the tenant memberships the DATABASE reported for this session.
   *
   * The caller must obtain these by selecting from tenant_users while
   * authenticated — RLS (policy tenant_users_self_select) restricts that read
   * to the caller's own rows, which is what makes the result trustworthy.
   * Never populate this from a client-supplied claim or a URL parameter.
   *
   * Authorization does not depend on this value: the database enforces tenant
   * scope on every query regardless of what the client believes. This exists so
   * the UI can avoid rendering affordances that would only fail server-side.
   *
   * @param {string[]} ids - tenant_ids from tenant_users
   * @returns {string[]} the stored list (empty if no user / bad input)
   */
  function setTenantIds(ids) {
    if (!_currentUser) return [];
    _currentUser.tenantIds = Array.isArray(ids) ? ids.filter(v => typeof v === 'string') : [];
    return _currentUser.tenantIds;
  }

  // ── Exports ─────────────────────────────────────────────────────────────────

  return {
    VALID_ROLES,
    hydrateFromSupabaseUser,
    setUser,
    setTenantIds,
    getCurrentUser,
    isAuthenticated,
    getUserRole,
    isLandlord,
    isTenant,
    isReviewer,
    isAdmin,
    clear,
  };
})();
