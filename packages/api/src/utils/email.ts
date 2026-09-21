import { logger } from '@librechat/data-schemas';

/**
 * Check if email configuration is set
 * @returns Returns `true` if Azure Communication Services, Mailgun or SMTP is configured
 */
export function checkEmailConfig(): boolean {
  const hasACSConfig = !!process.env.ACS_EMAIL_CONNECTION_STRING && !!process.env.EMAIL_FROM;

  const hasMailgunConfig =
    !!process.env.MAILGUN_API_KEY && !!process.env.MAILGUN_DOMAIN && !!process.env.EMAIL_FROM;

  const hasSMTPConfig =
    (!!process.env.EMAIL_SERVICE || !!process.env.EMAIL_HOST) && !!process.env.EMAIL_FROM;

  if (hasSMTPConfig) {
    const hasUsername = !!process.env.EMAIL_USERNAME;
    const hasPassword = !!process.env.EMAIL_PASSWORD;
    if (hasUsername !== hasPassword) {
      logger.warn(
        '[checkEmailConfig] EMAIL_USERNAME and EMAIL_PASSWORD must both be set for authenticated SMTP, or both omitted for unauthenticated SMTP.',
      );
    }
  }

  return hasACSConfig || hasMailgunConfig || hasSMTPConfig;
}
