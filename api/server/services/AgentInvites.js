const { logger } = require('@librechat/data-schemas');
const { checkEmailConfig } = require('@librechat/api');
const sendEmail = require('~/server/utils/sendEmail');

/**
 * Invites someone to collaborate on a class agent. Sent once, when the address is
 * first invited; the invitee becomes a collaborator when they sign in with Illinois
 * SSO, so the email carries no token or link state of its own.
 *
 * @param {object} params
 * @param {string} params.email - the invited @illinois.edu address
 * @param {string} params.agentName
 * @param {string} params.inviterName
 * @returns {Promise<void>}
 */
const sendCollaboratorInvite = async ({ email, agentName, inviterName }) => {
  if (!checkEmailConfig()) {
    logger.warn(
      `[sendCollaboratorInvite] No email provider configured; ${email} was invited but not emailed`,
    );
    return;
  }
  const appName = process.env.APP_TITLE || 'GiesChat';
  await sendEmail({
    email,
    subject: `${inviterName} invited you to work on “${agentName}” in ${appName}`,
    payload: {
      appName,
      agentName,
      inviterName,
      name: email,
      inviteLink: `${process.env.DOMAIN_CLIENT}/admin`,
      year: new Date().getFullYear(),
    },
    template: 'inviteCollaborator.handlebars',
  });
};

module.exports = { sendCollaboratorInvite };
