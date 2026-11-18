const { logger } = require('@librechat/data-schemas');
const { checkEmailConfig, startWeeklyDigest, topicsModelFromConfig } = require('@librechat/api');
const { findAccessibleResources } = require('~/server/services/PermissionService');
const { getAppConfig } = require('~/server/services/Config');
const sendEmail = require('~/server/utils/sendEmail');
const db = require('~/models');

/**
 * Emails one weekly digest to each of its addresses and returns how many were sent. A failed
 * address is logged and skipped, never thrown: the subscriber is still marked sent, so the
 * others are not emailed twice. A test email says so in its subject.
 *
 * @param {import('@librechat/api').WeeklyDigestEmail} digest
 * @returns {Promise<number>}
 */
const sendWeeklyDigest = async (digest) => {
  if (!checkEmailConfig()) {
    logger.warn(
      `[WeeklyDigest] No email provider configured; ${digest.emails.join(', ')} were not emailed`,
    );
    return 0;
  }
  const appName = process.env.APP_TITLE || 'GiesChat';
  const subject = `${digest.test ? '[Test] ' : ''}Your ${appName} agents this week: ${digest.weekLabel}`;
  let delivered = 0;
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
      delivered += 1;
    } catch (error) {
      logger.warn(`[WeeklyDigest] could not email ${email}`, error);
    }
  }
  return delivered;
};

/** Starts the leader-only Monday sweep that sends {@link sendWeeklyDigest}. */
const startWeeklyDigestEmails = () =>
  startWeeklyDigest({
    findUsers: db.findUsers,
    claimWeeklyDigest: db.claimWeeklyDigest,
    releaseWeeklyDigest: db.releaseWeeklyDigest,
    findAgents: db.getAgents,
    /** The PermissionService wrapper, same as routes/admin/usage.js: it resolves group and role principals. */
    findAccessibleResources,
    aggregateAgentAnalytics: db.aggregateAgentAnalytics,
    sampleStudentMessages: db.sampleStudentMessages,
    resolveTopicsModel: async () => topicsModelFromConfig(await getAppConfig()),
    sendWeeklyDigest,
  });

module.exports = { sendWeeklyDigest, startWeeklyDigestEmails };
