const { logger } = require('@librechat/data-schemas');
const { checkEmailConfig, startDraftNotify } = require('@librechat/api');
const sendEmail = require('~/server/utils/sendEmail');
const db = require('~/models');

/** What each role may do, in the words the email uses. */
const ROLE_DETAIL = {
  coAdmin:
    'As a co-admin you can edit the agent, post drafts for students, manage its embed link, and see how the class uses it.',
  collaborator:
    'From there you can make your own draft of the agent, share a test link, and hand the draft back to be posted for students.',
};
const ROLE_NAME = { coAdmin: 'co-admin', collaborator: 'collaborator' };

/**
 * Emails one person about a class agent. Sign-in is Illinois SSO, so the email carries no
 * token or link state of its own.
 *
 * @param {object} params
 * @param {string} params.email
 * @param {string} params.subject
 * @param {string} params.agentName
 * @param {string} params.inviterName - who did it
 * @param {string} params.action - the verb phrase before the agent's name
 * @param {string} params.actionEnd - what follows the agent's name, if anything
 * @param {string} params.detail - what the reader can do next
 * @returns {Promise<void>}
 */
const sendAgentEmail = async ({
  email,
  subject,
  agentName,
  inviterName,
  action,
  actionEnd,
  detail,
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
      detail,
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
  sendAgentEmail({
    email,
    agentName,
    inviterName,
    detail: ROLE_DETAIL[role] ?? ROLE_DETAIL.collaborator,
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
  sendAgentEmail({
    email,
    agentName,
    inviterName,
    detail: ROLE_DETAIL[role] ?? ROLE_DETAIL.collaborator,
    action: 'changed your role on',
    actionEnd: ` to ${ROLE_NAME[role] ?? ROLE_NAME.collaborator}`,
    subject: `Your role on “${agentName}” is now ${ROLE_NAME[role] ?? ROLE_NAME.collaborator}`,
  });

/**
 * Tells a draft's owner that production moved on since their draft's base. Throws when the
 * send fails, so the draft stays unmarked and the next pass retries; a missing email
 * provider is not a failure.
 *
 * @param {import('@librechat/api').DraftOutdatedEmail} params
 * @returns {Promise<void>}
 */
const sendDraftOutdated = ({ email, agentName, changedBy, from, to }) =>
  sendAgentEmail({
    email,
    agentName,
    inviterName: changedBy,
    action: 'changed',
    actionEnd: ` (now version ${to}) since you started your draft from version ${from}`,
    detail:
      'Open your draft and choose Update my draft. Your changes stay on top, and anything that clashes is shown for you to choose. You can also keep working on the older version.',
    subject: `“${agentName}” changed since you started your draft`,
  });

/** Starts the leader-only sweep that sends {@link sendDraftOutdated}. */
const startDraftEmails = () =>
  startDraftNotify({
    findAgents: db.getAgents,
    findUsers: db.findUsers,
    setAgentMeta: db.setAgentMeta,
    sendDraftOutdated,
  });

module.exports = { sendCollaboratorInvite, sendRoleChange, sendDraftOutdated, startDraftEmails };
