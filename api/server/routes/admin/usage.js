const express = require('express');
const { nanoid } = require('nanoid');
const {
  crawlSite,
  cleanPages,
  callTestModel,
  topicsModelFromConfig,
  searchAgentDocuments,
  createAdminUsageHandlers,
  createAdminApiKeyHandlers,
  modelTestEndpointFromConfig,
} = require('@librechat/api');
const { SystemCapabilities } = require('@librechat/data-schemas');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { findAccessibleResources } = require('~/server/services/PermissionService');
const { copyAgentDocuments } = require('~/server/services/Files/copy');
const { sendCollaboratorInvite, sendRoleChange } = require('~/server/services/AgentInvites');
const {
  grantAgentAccess,
  revokeAgentAccess,
  grantDashboardAccess,
} = require('~/server/services/AgentAccess');
const { siteStore, replaceWebsiteCopy } = require('~/server/services/Websites');
const { requireJwtAuth } = require('~/server/middleware');
const { getAppConfig } = require('~/server/services/Config');
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
  sampleStudentMessages: db.sampleStudentMessages,
  resolveTopicsModel: async () => topicsModelFromConfig(await getAppConfig()),
  resolveModelTestEndpoint: async () => modelTestEndpointFromConfig(await getAppConfig()),
  searchDocuments: searchAgentDocuments,
  askTestModel: callTestModel,
  updateUser: db.updateUser,
  setAgentEmbed: db.setAgentEmbed,
  getAgent: db.getAgent,
  setAgentMeta: db.setAgentMeta,
  createAgent: db.createAgent,
  updateAgent: db.updateAgent,
  getFiles: db.getFiles,
  copyDocuments: copyAgentDocuments,
  sendCollaboratorInvite,
  createAgentId: () => `agent_${nanoid()}`,
  sendRoleChange,
  grantAgentAccess,
  revokeAgentAccess,
  grantDashboardAccess,
  crawlWebsite: (url) => crawlSite(url),
  cleanWebsitePages: async (pages) => cleanPages(pages, await siteStore.resolveEndpoint()),
  replaceWebsiteCopy,
});

const apiKeyHandlers = createAdminApiKeyHandlers({
  findAgents: db.getAgents,
  createAgentApiKey: db.createAgentApiKey,
  listAgentApiKeysForAgents: db.listAgentApiKeysForAgents,
  deleteAgentApiKeyForAgents: db.deleteAgentApiKeyForAgents,
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
/** Reads student message text server-side; returns topic labels and counts only. */
router.get('/topics', requireReadUsage, requireReadGroups, handlers.listAgentTopics);
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

/**
 * Agent API keys: an author/co-admin decision about an agent; no roster is read, so
 * `access:admin` is the gate, as for embedding.
 */
router.get('/api-keys', apiKeyHandlers.listApiKeys);
router.post('/agents/:agent_id/api-keys', apiKeyHandlers.createApiKey);
router.delete('/api-keys/:key_id', apiKeyHandlers.revokeApiKey);

/**
 * Websites. Test reads a public site and stores nothing; Add/Refresh writes a document onto
 * an agent the caller already edits (usage scope). No roster is read, so `access:admin` is
 * the gate, as for embedding.
 */
router.post('/websites/preview', handlers.previewWebsite);
router.post('/agents/:agent_id/websites', handlers.saveAgentWebsite);

/**
 * Draft collaboration. All of these resolve the agent through the usage scope; the
 * handlers themselves narrow "author only" or "draft owner only" where the design says so.
 */
router.put('/agents/:agent_id/collaborators', handlers.updateAgentCollaborators);
router.get('/agents/:agent_id/drafts', handlers.listAgentDrafts);
router.post('/agents/:agent_id/drafts', handlers.openAgentDraft);
router.post('/agents/:agent_id/drafts/:draft_id/post', handlers.postAgentDraft);
/** The draft's owner brings it up to date with production: preview, then apply with their picks. */
router.get('/agents/:agent_id/drafts/:draft_id/update', handlers.previewDraftUpdate);
router.post('/agents/:agent_id/drafts/:draft_id/update', handlers.updateAgentDraft);

/**
 * Compares two models on an agent the caller can edit (usage scope) or on a new agent's
 * instructions. Reads no class data and writes nothing, so `access:admin` is the gate.
 */
router.post('/model-test', handlers.testAgentModels);

router.get('/layout', handlers.getDashboardLayout);
router.put('/layout', handlers.updateDashboardLayout);

module.exports = router;
