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
  function shapeEvent(type, title, opts = {}) {
    return {
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

  return { shapeEvent };
})();
