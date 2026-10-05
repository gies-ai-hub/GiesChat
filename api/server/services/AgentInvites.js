const { logger } = require('@librechat/data-schemas');
const { checkEmailConfig } = require('@librechat/api');
const sendEmail = require('~/server/utils/sendEmail');

/** What each role may do, in the words the email uses. */
const ROLE_DETAIL = {
  coAdmin:
    'As a co-admin you can edit the agent, post drafts for students, manage its embed link, and see how the class uses it.',
  collaborator:
    'From there you can make your own draft of the agent, share a test link, and hand the draft back to be posted for students.',
};
const ROLE_NAME = { coAdmin: 'co-admin', collaborator: 'collaborator' };

/**
 * Emails one person about their role on a class agent. Sign-in is Illinois SSO, so the
 * email carries no token or link state of its own.
 *
 * @param {object} params
 * @param {string} params.email
 * @param {string} params.subject
 * @param {string} params.agentName
 * @param {string} params.inviterName
 * @param {string} params.action - the verb phrase before the agent's name
 * @param {string} params.actionEnd - what follows the agent's name, if anything
 * @param {'coAdmin'|'collaborator'} params.role
 * @returns {Promise<void>}
 */
const sendRoleEmail = async ({
  email,
  subject,
  agentName,
  inviterName,
  action,
  actionEnd,
  role,
}) => {
  if (!checkEmailConfig()) {
    logger.warn(`[AgentInvites] No email provider configured; ${email} was not emailed`);
    return;
  }
  const appName = process.env.APP_TITLE || 'GiesChat';
  await sendEmail({
    email,
    subject: `${subject} in ${appName}`,
    payload: {
      appName,
      agentName,
      inviterName,
      action,
      actionEnd,
      detail: ROLE_DETAIL[role] ?? ROLE_DETAIL.collaborator,
      name: email,
      inviteLink: `${process.env.DOMAIN_CLIENT}/admin`,
      year: new Date().getFullYear(),
    },
    template: 'inviteCollaborator.handlebars',
  });
};

/**
 * Invites someone newly added to a class agent, naming their role. Sent once; the
 * invitee joins in that role when they sign in with Illinois SSO.
 *
 * @param {{ email: string, agentName: string, inviterName: string, role?: 'coAdmin'|'collaborator' }} params
 * @returns {Promise<void>}
 */
const sendCollaboratorInvite = ({ email, agentName, inviterName, role = 'collaborator' }) =>
  sendRoleEmail({
    email,
    agentName,
    inviterName,
    role,
    action: role === 'coAdmin' ? 'made you a co-admin of' : 'invited you to collaborate on',
    actionEnd: '',
    subject:
      role === 'coAdmin'
        ? `${inviterName} made you a co-admin of “${agentName}”`
        : `${inviterName} invited you to work on “${agentName}”`,
  });

/**
 * Tells someone already on a class agent that their role changed.
 *
 * @param {{ email: string, agentName: string, inviterName: string, role: 'coAdmin'|'collaborator' }} params
 * @returns {Promise<void>}
 */
const sendRoleChange = ({ email, agentName, inviterName, role }) =>
  sendRoleEmail({
    email,
    agentName,
    inviterName,
    role,
    action: 'changed your role on',
    actionEnd: ` to ${ROLE_NAME[role] ?? ROLE_NAME.collaborator}`,
    subject: `Your role on “${agentName}” is now ${ROLE_NAME[role] ?? ROLE_NAME.collaborator}`,
  });

module.exports = { sendCollaboratorInvite, sendRoleChange };
