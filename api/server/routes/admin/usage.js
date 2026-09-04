const express = require('express');
const { createAdminUsageHandlers } = require('@librechat/api');
const { SystemCapabilities } = require('@librechat/data-schemas');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { findAccessibleResources } = require('~/server/services/PermissionService');
const { requireJwtAuth } = require('~/server/middleware');
const db = require('~/models');

const router = express.Router();

const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);
const requireReadUsage = requireCapability(SystemCapabilities.READ_USAGE);
const requireReadGroups = requireCapability(SystemCapabilities.READ_GROUPS);

const handlers = createAdminUsageHandlers({
  findAgents: db.getAgents,
  /**
   * The service wrapper, not `db.findAccessibleResources`: the db method takes a
   * positional principals list, while the handler passes `{ userId, role, ... }`.
   * The service resolves the caller's full principal set (user + groups + role +
   * public) first, so agents shared with a professor via a group stay in scope.
   */
  findAccessibleResources,
  findGroupById: db.findGroupById,
  findUsers: db.findUsers,
  aggregateAgentUsage: db.aggregateAgentUsage,
  aggregateStudentUsage: db.aggregateStudentUsage,
  aggregateAgentAnalytics: db.aggregateAgentAnalytics,
  updateUser: db.updateUser,
  setAgentEmbed: db.setAgentEmbed,
});

router.use(requireJwtAuth, requireAdminAccess);

/**
 * Both routes read class rosters: `/agents/:agent_id/students` returns the name
 * and email of every group member, and `/agents` filters *by* a roster while
 * distinguishing a real group (200) from a nonexistent one (404), which makes
 * group ids enumerable. `read:groups` is the established boundary for roster
 * data and is required alongside `read:usage` on both, otherwise usage access
 * alone would enumerate or read another instructor's roster.
 */
router.get('/agents', requireReadUsage, requireReadGroups, handlers.listAgentUsage);
/** Reports class roster size, so it carries the same `read:groups` requirement as the others. */
router.get('/analytics', requireReadUsage, requireReadGroups, handlers.listAgentAnalytics);
router.get(
  '/agents/:agent_id/students',
  requireReadUsage,
  requireReadGroups,
  handlers.listAgentStudentUsage,
);

/**
 * A personal display preference for this dashboard — no class or student data is
 * read, so `access:admin` from `router.use` above is the whole gate. Deliberately
 * NOT `read:usage`/`read:groups`: requiring roster permissions to save a checkbox
 * would be a boundary that means nothing.
 */
/**
 * Embedding is a share decision about an agent the caller already edits, so the
 * usage scope (author-or-EDIT) is the whole gate — no roster is read.
 */
router.put('/agents/:agent_id/embed', handlers.updateAgentEmbed);
router.delete('/agents/:agent_id/embed', handlers.revokeAgentEmbed);

router.get('/layout', handlers.getDashboardLayout);
router.put('/layout', handlers.updateDashboardLayout);

module.exports = router;
