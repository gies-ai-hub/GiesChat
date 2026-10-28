const fs = require('fs');
const os = require('os');
const path = require('path');
const handlebars = require('handlebars');
const { execFile } = require('child_process');
const { Types } = require('mongoose');

const TEMPLATE = 'platformUpdate.handlebars';
const TEMPLATE_PATH = path.resolve(__dirname, '..', 'api', 'server', 'utils', 'emails', TEMPLATE);
const AUDIENCES = ['faculty', 'all'];
/** Sign-in is Illinois SSO, so any other address is a test or local account. */
const ILLINOIS = /@illinois\.edu$/i;
/** The clip travels inside the email, so Outlook shows it without "download pictures". */
const CLIP_CID = 'update-clip.gif';
const DOCS = path.resolve(__dirname, '..', 'docs', 'site');
/** ACS caps an Azure-managed domain at about 30 emails a minute. */
const SEND_GAP_MS = 2500;

const USAGE = `Usage:
  npm run send-update -- <update.json>                                  dry run: counts and preview, sends nothing
  npm run send-update -- <update.json> --to <you@illinois.edu> [--audience faculty|all]   one test email, not recorded
  npm run send-update -- <update.json> --audience faculty|all --send --confirm <count>    the real send`;

/**
 * Who an update reaches. Faculty hold `access:admin`, granted to them directly (the
 * production pattern) or through their role. Guests and non-Illinois accounts never do.
 */
async function findRecipients({ User, SystemGrant }, audience) {
  const base = { email: ILLINOIS, provider: { $ne: 'guest' } };
  if (audience === 'all') {
    return User.find(base, 'email name').lean();
  }
  const grants = await SystemGrant.find(
    { capability: 'access:admin', tenantId: { $exists: false } },
    'principalType principalId',
  ).lean();
  const userIds = grants
    .filter(
      (grant) =>
        grant.principalType === 'user' && Types.ObjectId.isValid(String(grant.principalId)),
    )
    .map((grant) => new Types.ObjectId(String(grant.principalId)));
  const roles = grants
    .filter((grant) => grant.principalType === 'role')
    .map((grant) => String(grant.principalId));
  return User.find(
    { ...base, $or: [{ _id: { $in: userIds } }, { role: { $in: roles } }] },
    'email name',
  ).lean();
}

/**
 * The template's data for one audience: faculty get the faculty intro and no tags.
 * `inline` points the clip at the attached GIF; a browser preview needs the web address.
 */
function buildPayload(update, audience, baseUrl, { inline = false } = {}) {
  const root = baseUrl.replace(/\/+$/, '');
  const asset = (file) => `${root}/docs/${file}`;
  const everyone = audience === 'all';
  return {
    appName: process.env.APP_TITLE || 'GiesChat',
    subject: update.subject,
    preheader: update.preheader,
    edition: update.edition,
    headline: update.headline,
    intro: everyone ? update.intro.all : update.intro.faculty,
    clip: update.clip
      ? {
          gifUrl: inline ? `cid:${CLIP_CID}` : asset(update.clip.gif),
          mp4Url: asset(update.clip.mp4),
          alt: update.clip.alt,
          caption: update.clip.caption,
        }
      : null,
    changes: update.changes.map((change, index) => ({
      number: index + 1,
      title: change.title,
      body: change.body,
      tagged: everyone && change.faculty === true,
      /** Changes sit two to a row; an odd one out takes the whole row. */
      wide: index === update.changes.length - 1 && update.changes.length % 2 === 1,
    })),
    appUrl: root,
    docsUrl: `${root}/docs/`,
  };
}

/** The clip's GIF as an inline attachment, or none when the update has no clip. */
function clipAttachments(update) {
  if (!update.clip) {
    return [];
  }
  return [
    {
      name: CLIP_CID,
      contentType: 'image/gif',
      contentInBase64: fs.readFileSync(path.join(DOCS, update.clip.gif)).toString('base64'),
      contentId: CLIP_CID,
    },
  ];
}

function renderUpdate(payload) {
  return handlebars.compile(fs.readFileSync(TEMPLATE_PATH, 'utf8'))(payload);
}

/** Throws a plain reason when this update must not go out to this audience. */
function assertSendable(update, { audience, confirm, count }) {
  if (update.sent) {
    throw new Error(
      `"${update.id}" already went to ${update.sent.count} people on ${update.sent.at}`,
    );
  }
  if (!AUDIENCES.includes(audience)) {
    throw new Error(`--audience must be one of ${AUDIENCES.join(', ')}`);
  }
  if (count === 0) {
    throw new Error(`no one is in the ${audience} audience`);
  }
  if (confirm !== count) {
    throw new Error(
      `--confirm ${confirm} does not match the ${count} people in the ${audience} audience`,
    );
  }
}

function parseArgs(argv) {
  const args = { file: null, audience: null, send: false, confirm: null, to: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--send') {
      args.send = true;
    } else if (arg === '--audience') {
      args.audience = argv[++i];
    } else if (arg === '--confirm') {
      args.confirm = Number(argv[++i]);
    } else if (arg === '--to') {
      args.to = argv[++i];
    } else if (!arg.startsWith('--')) {
      args.file = arg;
    }
  }
  return args;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The clip's full-quality MP4 is linked from the docs site, so it must be deployed first. */
async function assertClipLive(payload) {
  if (!payload.clip) {
    return;
  }
  for (const url of [payload.clip.mp4Url]) {
    const response = await fetch(url, { method: 'HEAD' }).catch(() => null);
    if (!response?.ok) {
      throw new Error(`${url} is not reachable yet; deploy the docs site first`);
    }
  }
}

function writePreview(update, audience, html) {
  const file = path.join(os.tmpdir(), `platform-update-${update.id}-${audience}.html`);
  fs.writeFileSync(file, html);
  return file;
}

async function main(argv) {
  const args = parseArgs(argv);
  if (!args.file) {
    console.log(USAGE);
    process.exit(1);
  }
  /** Values already in the environment (production's, when sending for real) win over .env. */
  require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
  const updatePath = path.resolve(args.file);
  const update = JSON.parse(fs.readFileSync(updatePath, 'utf8'));
  const baseUrl = process.env.DOMAIN_CLIENT;
  if (!baseUrl) {
    throw new Error('DOMAIN_CLIENT is not set; links and the clip would have no address');
  }

  const mongoose = require('mongoose');
  const models = require('@librechat/data-schemas').createModels(mongoose);
  const connect = require('./connect');
  await connect();

  const counts = {};
  for (const audience of AUDIENCES) {
    counts[audience] = (await findRecipients(models, audience)).length;
  }
  console.log(`Platform update "${update.id}" (${update.edition})`);
  console.log(`  Covers   ${update.commits}`);
  console.log(`  Faculty  ${counts.faculty} people with Agent dashboard access`);
  console.log(`  All      ${counts.all} Illinois accounts (guest and test accounts skipped)`);
  console.log(
    `  Sent     ${update.sent ? `${update.sent.at} to ${update.sent.count} (${update.sent.audience})` : 'not yet'}`,
  );

  const sendEmail = require('../api/server/utils/sendEmail');

  if (args.to) {
    const audience = args.audience ?? 'faculty';
    const payload = buildPayload(update, audience, baseUrl, { inline: true });
    await sendEmail({
      email: args.to,
      subject: update.subject,
      payload: { ...payload, name: args.to },
      template: TEMPLATE,
      attachments: clipAttachments(update),
    });
    console.log(`Test email (${audience} version) sent to ${args.to}. Nothing recorded.`);
    process.exit(0);
  }

  if (!args.send) {
    const previews = AUDIENCES.map((audience) =>
      writePreview(update, audience, renderUpdate(buildPayload(update, audience, baseUrl))),
    );
    console.log(`  Preview  ${previews.join('\n           ')}`);
    console.log('Dry run: nothing was sent.');
    if (process.platform === 'darwin') {
      execFile('open', [previews[0]]);
    }
    process.exit(0);
  }

  assertSendable(update, {
    audience: args.audience,
    confirm: args.confirm,
    count: counts[args.audience],
  });
  const payload = buildPayload(update, args.audience, baseUrl, { inline: true });
  const attachments = clipAttachments(update);
  await assertClipLive(payload);
  const recipients = await findRecipients(models, args.audience);
  const failed = [];
  for (const [index, recipient] of recipients.entries()) {
    try {
      await sendEmail({
        email: recipient.email,
        subject: update.subject,
        payload: { ...payload, name: recipient.name || recipient.email },
        template: TEMPLATE,
        attachments,
      });
      console.log(`  ${index + 1}/${recipients.length} sent`);
    } catch (error) {
      failed.push(recipient.email);
      console.log(
        `  ${index + 1}/${recipients.length} FAILED: ${recipient.email} (${error.message})`,
      );
    }
    await sleep(SEND_GAP_MS);
  }
  update.sent = {
    at: new Date().toISOString(),
    audience: args.audience,
    count: recipients.length - failed.length,
    failed: failed.length,
  };
  fs.writeFileSync(updatePath, `${JSON.stringify(update, null, 2)}\n`);
  console.log(`Sent ${update.sent.count} of ${recipients.length}. Recorded in ${args.file}.`);
  if (failed.length > 0) {
    console.log(`Not delivered, retry each with --to: ${failed.join(', ')}`);
  }
  process.exit(0);
}

module.exports = {
  findRecipients,
  buildPayload,
  clipAttachments,
  renderUpdate,
  assertSendable,
  AUDIENCES,
};

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`send-update: ${error.message}`);
    process.exit(1);
  });
}
