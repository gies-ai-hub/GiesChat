const { logger } = require('@librechat/data-schemas');
const { checkEmailConfig, startWeeklyDigest, topicsModelFromConfig } = require('@librechat/api');
const { findAccessibleResources } = require('~/server/services/PermissionService');
const { getAppConfig } = require('~/server/services/Config');
const sendEmail = require('~/server/utils/sendEmail');
const db = require('~/models');

/**
 * Emails one weekly digest to each of its addresses. A failed address is logged and skipped,
 * never thrown: the subscriber is still marked sent, so the others are not emailed twice.
 *
 * @param {import('@librechat/api').WeeklyDigestEmail} digest
 * @returns {Promise<void>}
 */
const sendWeeklyDigest = async (digest) => {
  if (!checkEmailConfig()) {
    logger.warn(
      `[WeeklyDigest] No email provider configured; ${digest.emails.join(', ')} were not emailed`,
    );
    return;
  }
  const appName = process.env.APP_TITLE || 'GiesChat';
  const subject = `Your ${appName} agents this week: ${digest.weekLabel}`;
  for (const email of digest.emails) {
    try {
      await sendEmail({
        email,
        subject,
        payload: {
          ...digest,
          subject,
          appName,
          name: email,
          dashboardUrl: `${process.env.DOMAIN_CLIENT}/admin`,
          year: new Date().getFullYear(),
        },
        template: 'weeklyDigest.handlebars',
      });
    } catch (error) {
      logger.warn(`[WeeklyDigest] could not email ${email}`, error);
    }
  }
};

/** Starts the leader-only Monday sweep that sends {@link sendWeeklyDigest}. */
const startWeeklyDigestEmails = () =>
  startWeeklyDigest({
    findUsers: db.findUsers,
    updateUser: db.updateUser,
    findAgents: db.getAgents,
    /** The PermissionService wrapper, same as routes/admin/usage.js: it resolves group and role principals. */
    findAccessibleResources,
    aggregateAgentAnalytics: db.aggregateAgentAnalytics,
    sampleStudentMessages: db.sampleStudentMessages,
    resolveTopicsModel: async () => topicsModelFromConfig(await getAppConfig()),
    sendWeeklyDigest,
  });

module.exports = { sendWeeklyDigest, startWeeklyDigestEmails };
