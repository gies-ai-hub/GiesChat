const express = require('express');
const { createAdminGrantsHandlers, getCachedPrincipals } = require('@librechat/api');
const { SystemCapabilities } = require('@librechat/data-schemas');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { requireJwtAuth } = require('~/server/middleware');
const db = require('~/models');

const router = express.Router();

const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);

const handlers = createAdminGrantsHandlers({
  listGrants: db.listGrants,
  countGrants: db.countGrants,
  getCapabilitiesForPrincipal: db.getCapabilitiesForPrincipal,
  getCapabilitiesForPrincipals: db.getCapabilitiesForPrincipals,
  grantCapability: db.grantCapability,
  revokeCapability: db.revokeCapability,
  getUserPrincipals: db.getUserPrincipals,
  hasCapabilityForPrincipals: db.hasCapabilityForPrincipals,
  getHeldCapabilities: db.getHeldCapabilities,
  getCachedPrincipals,
  checkRoleExists: async (name) => (await db.getRoleByName(name)) != null,
  recordAuditEntry: db.recordAuditEntry,
  /** Opt-in: fail the grant request if its audit entry can't be persisted. */
  auditFailClosed: process.env.AUDIT_LOG_FAIL_CLOSED === 'true',
});

/**
 * Self-scoped: it reports only the caller's own capabilities, and an empty list
 * for anyone holding none. Gating it on ACCESS_ADMIN is circular — the sidebar
 * has to ask this to learn whether a user-level grant exists at all.
 */
router.get('/effective', requireJwtAuth, handlers.getEffectiveCapabilities);

router.use(requireJwtAuth, requireAdminAccess);

router.get('/', handlers.listGrants);
router.get('/:principalType/:principalId', handlers.getPrincipalGrants);
router.post('/', handlers.assignGrant);
/** Callers should encodeURIComponent the capability for client compatibility (e.g. manage%3Aconfigs%3Aendpoints). */
router.delete('/:principalType/:principalId/:capability', handlers.revokeGrant);

module.exports = router;
