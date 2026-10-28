const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { createModels } = require('@librechat/data-schemas');
const {
  findRecipients,
  buildPayload,
  clipAttachments,
  renderUpdate,
  assertSendable,
} = require('../send-update');

const update = {
  id: '2026-10',
  edition: 'October 2026',
  subject: "What's new in GiesChat",
  preheader: 'Drafts keep up with your changes.',
  headline: 'Drafts now keep up with your changes',
  intro: { faculty: 'For the agents you run.', all: 'Items marked Faculty are for teachers.' },
  clip: {
    gif: 'updates/2026-10/main.gif',
    mp4: 'updates/2026-10/main.mp4',
    alt: 'Before and after',
    caption: 'Before: silent. After: told.',
  },
  changes: [
    { title: 'Drafts keep up', body: 'TAs see the change.', faculty: true },
    { title: 'Newer models', body: 'Chat runs on GPT-6 Luna.' },
  ],
  commits: '5f2935877..cde97da4c',
};

let mongod;
let models;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  models = createModels(mongoose);
  const { User, SystemGrant } = models;
  const [prof, , , , tester] = await User.create([
    { email: 'mchen@illinois.edu', name: 'Maria Chen', provider: 'openid', role: 'USER' },
    { email: 'admin@illinois.edu', name: 'Admin', provider: 'openid', role: 'ADMIN' },
    { email: 'sortiz2@illinois.edu', name: 'Sam Ortiz', provider: 'openid', role: 'USER' },
    { email: 'visitor@illinois.edu', name: 'Embed guest', provider: 'guest', role: 'USER' },
    { email: 'prof-embed@example.com', name: 'Prof Embed', provider: 'local', role: 'USER' },
  ]);
  await SystemGrant.create([
    { principalType: 'user', principalId: prof._id, capability: 'access:admin' },
    { principalType: 'user', principalId: tester._id, capability: 'access:admin' },
    { principalType: 'role', principalId: 'ADMIN', capability: 'access:admin' },
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe('findRecipients', () => {
  it('reaches faculty by direct grant or by role, and never guests or non-Illinois accounts', async () => {
    const faculty = await findRecipients(models, 'faculty');
    expect(faculty.map((user) => user.email).sort()).toEqual([
      'admin@illinois.edu',
      'mchen@illinois.edu',
    ]);
  });

  it('reaches every Illinois account for "all"', async () => {
    const all = await findRecipients(models, 'all');
    expect(all.map((user) => user.email).sort()).toEqual([
      'admin@illinois.edu',
      'mchen@illinois.edu',
      'sortiz2@illinois.edu',
    ]);
  });
});

describe('buildPayload', () => {
  it('gives faculty their intro and no tags, and everyone else tags on teacher-only items', () => {
    const faculty = buildPayload(update, 'faculty', 'https://gieschat.azurewebsites.net/');
    expect(faculty.intro).toBe('For the agents you run.');
    expect(faculty.changes.map((change) => change.tagged)).toEqual([false, false]);
    expect(faculty.clip.gifUrl).toBe(
      'https://gieschat.azurewebsites.net/docs/updates/2026-10/main.gif',
    );

    const all = buildPayload(update, 'all', 'https://gieschat.azurewebsites.net');
    expect(all.intro).toBe('Items marked Faculty are for teachers.');
    expect(all.changes.map((change) => [change.number, change.tagged, change.wide])).toEqual([
      [1, true, false],
      [2, false, false],
    ]);
    const odd = buildPayload(
      { ...update, changes: [...update.changes, { title: 'Third', body: 'Spans the row.' }] },
      'all',
      'https://gieschat.azurewebsites.net',
    );
    expect(odd.changes.map((change) => change.wide)).toEqual([false, false, true]);
  });
});

describe('inline clip', () => {
  it('points the sent email at the attached GIF, which is the published clip', () => {
    const payload = buildPayload(update, 'faculty', 'https://gieschat.azurewebsites.net', {
      inline: true,
    });
    expect(payload.clip.gifUrl).toBe('cid:update-clip.gif');
    expect(payload.clip.mp4Url).toBe(
      'https://gieschat.azurewebsites.net/docs/updates/2026-10/main.mp4',
    );
    const [gif] = clipAttachments(update);
    expect(gif).toMatchObject({ contentId: 'update-clip.gif', contentType: 'image/gif' });
    expect(Buffer.from(gif.contentInBase64, 'base64').subarray(0, 6).toString()).toBe('GIF89a');
    expect(clipAttachments({ ...update, clip: undefined })).toEqual([]);
  });
});

describe('renderUpdate', () => {
  it('escapes every value, so update text cannot inject markup', () => {
    const payload = buildPayload(
      { ...update, headline: '<script>alert(1)</script>' },
      'all',
      'https://gieschat.azurewebsites.net',
    );
    const html = renderUpdate(payload);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Faculty</span>');
    expect(html).toContain('alt="Before and after"');
  });
});

describe('assertSendable', () => {
  it('refuses an update already sent, an unknown audience, an empty one, and a wrong head count', () => {
    const sent = {
      ...update,
      sent: { at: '2026-10-25T15:00:00.000Z', count: 11, audience: 'faculty' },
    };
    expect(() => assertSendable(sent, { audience: 'faculty', confirm: 11, count: 11 })).toThrow(
      /already went to 11/,
    );
    expect(() => assertSendable(update, { audience: 'students', confirm: 3, count: 3 })).toThrow(
      /--audience/,
    );
    expect(() => assertSendable(update, { audience: 'faculty', confirm: 0, count: 0 })).toThrow(
      /no one/,
    );
    expect(() => assertSendable(update, { audience: 'all', confirm: 30, count: 31 })).toThrow(
      /does not match the 31/,
    );
    expect(() => assertSendable(update, { audience: 'all', confirm: 31, count: 31 })).not.toThrow();
  });
});
