const { PrincipalType, ResourceType, AccessRoleIds } = require('librechat-data-provider');
const { grantPermission } = require('~/server/services/PermissionService');
const db = require('~/models');

/** ACL roles per grant: `owner` mirrors `createAgentHandler` (agent + remote agent). */
const GRANTS = {
  owner: [
    [ResourceType.AGENT, AccessRoleIds.AGENT_OWNER],
    [ResourceType.REMOTE_AGENT, AccessRoleIds.REMOTE_AGENT_OWNER],
  ],
  editor: [[ResourceType.AGENT, AccessRoleIds.AGENT_EDITOR]],
  viewer: [[ResourceType.AGENT, AccessRoleIds.AGENT_VIEWER]],
};

/**
 * Grants a user one role on a class agent: `owner` of their own draft, `editor` of
 * production as a co-admin, `viewer` of a draft so the author and co-admins can open it.
 *
 * @param {{ userId: string, agentDbId: string, role: 'owner'|'editor'|'viewer', grantedBy?: string }} params
 * @returns {Promise<void>}
 */
const grantAgentAccess = async ({ userId, agentDbId, role, grantedBy }) => {
  await Promise.all(
    GRANTS[role].map(([resourceType, accessRoleId]) =>
      grantPermission({
        principalType: PrincipalType.USER,
        principalId: userId,
        resourceType,
        resourceId: agentDbId,
        accessRoleId,
        grantedBy: grantedBy ?? userId,
      }),
    ),
  );
};

/**
 * Removes the user's grant on one agent, whatever its role.
 *
 * @param {{ userId: string, agentDbId: string }} params
 * @returns {Promise<void>}
 */
const revokeAgentAccess = async ({ userId, agentDbId }) => {
  await db.revokePermission(PrincipalType.USER, userId, ResourceType.AGENT, agentDbId);
};

module.exports = { grantAgentAccess, revokeAgentAccess };
