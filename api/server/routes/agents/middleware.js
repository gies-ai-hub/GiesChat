const {
  Permissions,
  ResourceType,
  PermissionBits,
  PrincipalType,
  AccessRoleIds,
  PermissionTypes,
} = require('librechat-data-provider');
const {
  skipIfAgentKey,
  verifyIssuerToken,
  createAgentKeyAuth,
  createAgentKeyModel,
  generateCheckAccess,
  normalizeOpenIdIssuer,
  preAuthTenantMiddleware,
  createRequireApiKeyAuth,
  createRemoteAgentAuth,
  createCheckRemoteAgentAccess,
} = require('@librechat/api');
const {
  checkPermission,
  grantPermission,
  getEffectivePermissions,
} = require('~/server/services/PermissionService');
const { getModelsConfig } = require('~/server/controllers/ModelController');
const { getAppConfig } = require('~/server/services/Config');
const db = require('~/models');

const apiKeyMiddleware = createRequireApiKeyAuth({
  validateAgentApiKey: db.validateAgentApiKey,
  findUser: db.findUser,
});

const requireRemoteAgentAuth = createRemoteAgentAuth({
  apiKeyMiddleware,
  findUser: db.findUser,
  getRolesByNames: db.findRolesByNames,
  updateUser: db.updateUser,
  getAppConfig,
});

const checkRemoteAgentsFeature = generateCheckAccess({
  permissionType: PermissionTypes.REMOTE_AGENTS,
  permissions: [Permissions.USE],
  getRoleByName: db.getRoleByName,
});

const checkAgentPermission = createCheckRemoteAgentAccess({
  getAgent: db.getAgent,
  getEffectivePermissions,
});

/**
 * Per-agent keys from the dashboard. The student's ID token is checked against GiesChat's
 * own tenant (`OPENID_ISSUER`) and the site app the key names.
 */
const agentKeyAuth = createAgentKeyAuth({
  validateAgentApiKey: db.validateAgentApiKey,
  getAgent: db.getAgent,
  verifyUserToken: (token, audience) =>
    verifyIssuerToken(token, process.env.OPENID_ISSUER ?? '', audience),
  findUser: db.findUser,
  createUser: (data) => db.createUser(data, undefined, true, true),
  canViewAgent: ({ userId, role, agentDbId }) =>
    checkPermission({
      userId,
      role,
      resourceType: ResourceType.AGENT,
      resourceId: agentDbId,
      requiredPermission: PermissionBits.VIEW,
    }),
  grantAgentView: ({ userId, agentDbId, grantedBy }) =>
    grantPermission({
      principalType: PrincipalType.USER,
      principalId: userId,
      resourceType: ResourceType.AGENT,
      resourceId: agentDbId,
      accessRoleId: AccessRoleIds.AGENT_VIEWER,
      grantedBy,
    }),
  openidIssuer: normalizeOpenIdIssuer(process.env.OPENID_ISSUER),
});

const agentKeyModel = createAgentKeyModel({ getModelsConfig });

module.exports = {
  agentKeyAuth,
  agentKeyModel,
  skipIfAgentKey,
  checkAgentPermission,
  preAuthTenantMiddleware,
  requireRemoteAgentAuth,
  checkRemoteAgentsFeature,
};
