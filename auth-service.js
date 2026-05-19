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

    const email = sbUser.email || '';
    const role  = _normalizeRole(meta.role);

    // property_ids must be an array of strings; default to empty array
    let propertyIds = [];
    if (Array.isArray(meta.property_ids)) {
      propertyIds = meta.property_ids.filter(v => typeof v === 'string');
    }

    _currentUser = {
      id:          sbUser.id   || '',
      email,
      role,
      displayName: _deriveDisplayName(meta, email),
      propertyIds,
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

  // ── Exports ─────────────────────────────────────────────────────────────────

  return {
    VALID_ROLES,
    hydrateFromSupabaseUser,
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
