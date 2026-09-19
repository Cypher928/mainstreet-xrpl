/**
 * audit-service.js
 * Event shaping for the activity log — deterministic, append-only record construction.
 * No DOM access. No array mutation. No persistence calls.
 * Callers (script.js logActivity) handle array prepend and savePropertyData.
 *
 * Exposes: window.AuditService
 */
window.AuditService = (() => {
  'use strict';

  const VALID_SEVERITIES = new Set(['info', 'success', 'warning', 'error']);

  /**
   * Shapes a raw activity log entry into a canonical AuditEvent record.
   * Every field has a defined default — callers never produce partial records.
   *
   * @param {string} type  - Immutable event type identifier (e.g. 'field_override')
   * @param {string} title - Human-readable summary (< 120 chars)
   * @param {object} opts  - { detail, severity, actor, relatedEntity, financialImpact, propertyId, tenantId }
   * @returns {AuditEvent}
   */
  // P0.5 — a stable identity, assigned once, at creation.
  //
  // The activity log is rewritten whole into properties.data on every save, so
  // the database cannot tell a newly added entry from the 199 already there
  // unless the entry carries its own identity. It is generated HERE rather
  // than derived later from type/title/timestamp, because those are mutable
  // display values and two events can share all three within one millisecond.
  //
  // Its presence is also the P0.5 watermark: every entry written before this
  // change lacks the field, and migration 030 derives a durable event only for
  // entries that have one. So an id is what makes an entry eligible to become
  // real history, and nothing that predates P0.5 can acquire one.
  function newEventId() {
    try {
      if (typeof crypto !== 'undefined' && crypto && typeof crypto.randomUUID === 'function') {
        return 'ae-' + crypto.randomUUID();
      }
    } catch (_) { /* fall through to the time+random form */ }
    return 'ae-' + Date.now().toString(36) + '-' +
           Math.random().toString(36).slice(2, 10) +
           Math.random().toString(36).slice(2, 10);
  }

  function shapeEvent(type, title, opts = {}) {
    return {
      // An id supplied by the caller is kept — replaying a shaped event (a
      // retry, a restored snapshot) must not mint a second identity for what
      // is one event.
      id:              (typeof opts.id === 'string' && opts.id.trim()) ? opts.id.trim() : newEventId(),
      type:            String(type  || 'unknown'),
      title:           String(title || ''),
      detail:          String(opts.detail          || ''),
      severity:        VALID_SEVERITIES.has(opts.severity) ? opts.severity : 'info',
      timestamp:       new Date().toISOString(),
      actor:           String(opts.actor           || 'System'),
      relatedEntity:   String(opts.relatedEntity   || ''),
      financialImpact: String(opts.financialImpact || ''),
      propertyId:      opts.propertyId  ?? null,
      tenantId:        opts.tenantId    ?? null,
    };
  }

  return { shapeEvent, newEventId };
})();
