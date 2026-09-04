const express = require('express');
const { createEmbedSessionHandler } = require('@librechat/api');
const { PrincipalType, ResourceType, AccessRoleIds } = require('librechat-data-provider');
const { grantPermission } = require('~/server/services/PermissionService');
const { getAppConfig } = require('~/server/services/Config');
const middleware = require('~/server/middleware');
const db = require('~/models');

const router = express.Router();

const startEmbedSession = createEmbedSessionHandler({
  getAgentByEmbedKey: db.getAgentByEmbedKey,
  getUserById: db.getUserById,
  createUser: db.createUser,
  generateToken: db.generateToken,
  getBalanceConfig: async () => (await getAppConfig()).balance,
  grantAgentView: ({ userId, agentId, grantedBy }) =>
    grantPermission({
      principalType: PrincipalType.USER,
      principalId: userId,
      resourceType: ResourceType.AGENT,
      resourceId: agentId,
      accessRoleId: AccessRoleIds.AGENT_VIEWER,
      grantedBy,
    }),
});

/**
 * Public by design: the unguessable key in the URL is the credential. The login
 * limiter throttles how fast one address can mint anonymous guests.
 */
router.post('/:key', middleware.loginLimiter, middleware.checkBan, startEmbedSession);

module.exports = router;
