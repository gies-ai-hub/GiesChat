import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createUsageMethods } from './usage';
import { createModels } from '../models';

let mongoServer: InstanceType<typeof MongoMemoryServer>;
let aggregateAgentUsage: ReturnType<typeof createUsageMethods>['aggregateAgentUsage'];
let aggregateStudentUsage: ReturnType<typeof createUsageMethods>['aggregateStudentUsage'];
let aggregateAgentAnalytics: ReturnType<typeof createUsageMethods>['aggregateAgentAnalytics'];

const HOUR = 60 * 60 * 1000;
const now = new Date('2026-07-01T12:00:00.000Z');
const since = new Date(now.getTime() - 24 * HOUR);
const ago = (ms: number) => new Date(now.getTime() - ms);

interface ConvoFixture {
  conversationId: string;
  user: string;
  agentId: string;
  updatedAt: Date;
  isTemporary?: boolean;
  /** `createdAt` of each student-authored message in this conversation. */
  userMessages?: Date[];
  /** `createdAt` of each assistant-authored message in this conversation. */
  assistantMessages?: Date[];
  /** How many of the assistant messages carry `error: true`, counted from the first. */
  erroredMessages?: number;
  /** Stamped on the conversation and, unless `untenantedMessages`, on its messages. */
  tenantId?: string;
  /** Pre-tenancy data: the conversation carries a tenant but its messages do not. */
  untenantedMessages?: boolean;
  /** Set on conversations an agent API key started. */
  apiKeyId?: string;
}

/**
 * Raw driver inserts: mongoose would stamp its own timestamps and overwrite the
 * `createdAt`/`updatedAt` values the `since` window is being tested against.
 */
async function seed(fixtures: ConvoFixture[]): Promise<void> {
  await mongoose.models.Conversation.collection.deleteMany({});
  await mongoose.models.Message.collection.deleteMany({});

  const convos = fixtures.map((fixture) => ({
    conversationId: fixture.conversationId,
    user: fixture.user,
    agent_id: fixture.agentId,
    isTemporary: fixture.isTemporary ?? false,
    createdAt: fixture.updatedAt,
    updatedAt: fixture.updatedAt,
    ...(fixture.tenantId === undefined ? {} : { tenantId: fixture.tenantId }),
    ...(fixture.apiKeyId === undefined ? {} : { apiKeyId: fixture.apiKeyId }),
  }));

  const messages = fixtures.flatMap((fixture) => {
    const tenant =
      fixture.tenantId === undefined || fixture.untenantedMessages === true
        ? {}
        : { tenantId: fixture.tenantId };
    const suffix = fixture.tenantId === undefined ? '' : `-${fixture.tenantId}`;
    return [
      ...(fixture.userMessages ?? []).map((createdAt, index) => ({
        messageId: `${fixture.conversationId}${suffix}-u${index}`,
        conversationId: fixture.conversationId,
        user: fixture.user,
        isCreatedByUser: true,
        createdAt,
        updatedAt: createdAt,
        ...tenant,
      })),
      ...(fixture.assistantMessages ?? []).map((createdAt, index) => ({
        messageId: `${fixture.conversationId}${suffix}-a${index}`,
        conversationId: fixture.conversationId,
        user: fixture.user,
        isCreatedByUser: false,
        createdAt,
        updatedAt: createdAt,
        error: index < (fixture.erroredMessages ?? 0),
        ...tenant,
      })),
    ];
  });

  await mongoose.models.Conversation.collection.insertMany(convos);
  if (messages.length > 0) {
    await mongoose.models.Message.collection.insertMany(messages);
  }
}

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  Object.assign(mongoose.models, createModels(mongoose));
  const methods = createUsageMethods(mongoose);
  aggregateAgentUsage = methods.aggregateAgentUsage;
  aggregateStudentUsage = methods.aggregateStudentUsage;
  aggregateAgentAnalytics = methods.aggregateAgentAnalytics;
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('aggregateAgentUsage', () => {
  it('counts conversations, distinct users and student messages per agent', async () => {
    await seed([
      {
        conversationId: 'c1',
        user: 'alice',
        agentId: 'agent_a',
        updatedAt: ago(2 * HOUR),
        userMessages: [ago(3 * HOUR), ago(2 * HOUR)],
        assistantMessages: [ago(3 * HOUR), ago(2 * HOUR)],
      },
      {
        conversationId: 'c2',
        user: 'alice',
        agentId: 'agent_a',
        updatedAt: ago(5 * HOUR),
        userMessages: [ago(5 * HOUR)],
      },
      {
        conversationId: 'c3',
        user: 'bob',
        agentId: 'agent_a',
        updatedAt: ago(HOUR),
        userMessages: [ago(HOUR)],
      },
    ]);

    const rows = await aggregateAgentUsage({ agentIds: ['agent_a'], userIds: null, since });

    expect(rows).toEqual([
      {
        agentId: 'agent_a',
        conversationCount: 3,
        userCount: 2,
        messageCount: 4,
        lastActivity: ago(HOUR),
      },
    ]);
  });

  it('omits agents with no activity instead of zero-filling them', async () => {
    await seed([
      {
        conversationId: 'c1',
        user: 'alice',
        agentId: 'agent_a',
        updatedAt: ago(HOUR),
        userMessages: [ago(HOUR)],
      },
    ]);

    const rows = await aggregateAgentUsage({
      agentIds: ['agent_a', 'agent_quiet'],
      userIds: null,
      since,
    });

    expect(rows.map((row) => row.agentId)).toEqual(['agent_a']);
  });

  it('excludes activity older than the since boundary and includes activity on it', async () => {
    await seed([
      {
        conversationId: 'inside',
        user: 'alice',
        agentId: 'agent_a',
        updatedAt: since,
        userMessages: [since],
      },
      {
        conversationId: 'outside',
        user: 'bob',
        agentId: 'agent_a',
        updatedAt: new Date(since.getTime() - 1),
        userMessages: [new Date(since.getTime() - 1)],
      },
    ]);

    const rows = await aggregateAgentUsage({ agentIds: ['agent_a'], userIds: null, since });

    expect(rows).toEqual([
      {
        agentId: 'agent_a',
        conversationCount: 1,
        userCount: 1,
        messageCount: 1,
        lastActivity: since,
      },
    ]);
  });

  it('excludes messages sent before the window from an in-window conversation', async () => {
    await seed([
      {
        conversationId: 'c1',
        user: 'alice',
        agentId: 'agent_a',
        updatedAt: ago(HOUR),
        userMessages: [ago(48 * HOUR), ago(HOUR)],
      },
    ]);

    const [row] = await aggregateAgentUsage({ agentIds: ['agent_a'], userIds: null, since });

    expect(row.messageCount).toBe(1);
  });

  it('excludes temporary conversations', async () => {
    await seed([
      {
        conversationId: 'c1',
        user: 'alice',
        agentId: 'agent_a',
        updatedAt: ago(HOUR),
        isTemporary: true,
        userMessages: [ago(HOUR)],
      },
      {
        conversationId: 'c2',
        user: 'bob',
        agentId: 'agent_a',
        updatedAt: ago(HOUR),
        userMessages: [ago(HOUR)],
      },
    ]);

    const rows = await aggregateAgentUsage({ agentIds: ['agent_a'], userIds: null, since });

    expect(rows).toEqual([
      {
        agentId: 'agent_a',
        conversationCount: 1,
        userCount: 1,
        messageCount: 1,
        lastActivity: ago(HOUR),
      },
    ]);
  });

  it('scopes to the given users, and to every user when userIds is null', async () => {
    await seed([
      {
        conversationId: 'c1',
        user: 'alice',
        agentId: 'agent_a',
        updatedAt: ago(HOUR),
        userMessages: [ago(HOUR)],
      },
      {
        conversationId: 'c2',
        user: 'bob',
        agentId: 'agent_a',
        updatedAt: ago(HOUR),
        userMessages: [ago(HOUR)],
      },
    ]);

    const scoped = await aggregateAgentUsage({
      agentIds: ['agent_a'],
      userIds: ['alice'],
      since,
    });
    const unfiltered = await aggregateAgentUsage({
      agentIds: ['agent_a'],
      userIds: null,
      since,
    });

    expect(scoped[0].userCount).toBe(1);
    expect(scoped[0].conversationCount).toBe(1);
    expect(unfiltered[0].userCount).toBe(2);
    expect(unfiltered[0].conversationCount).toBe(2);
  });

  it('returns no rows for an empty user list rather than every user', async () => {
    await seed([
      {
        conversationId: 'c1',
        user: 'alice',
        agentId: 'agent_a',
        updatedAt: ago(HOUR),
        userMessages: [ago(HOUR)],
      },
      {
        conversationId: 'c2',
        user: 'bob',
        agentId: 'agent_a',
        updatedAt: ago(HOUR),
        userMessages: [ago(HOUR)],
      },
    ]);

    const rows = await aggregateAgentUsage({ agentIds: ['agent_a'], userIds: [], since });

    expect(rows).toEqual([]);
  });

  it('returns no rows when no agent is in scope', async () => {
    await seed([
      {
        conversationId: 'c1',
        user: 'alice',
        agentId: 'agent_a',
        updatedAt: ago(HOUR),
        userMessages: [ago(HOUR)],
      },
    ]);

    expect(await aggregateAgentUsage({ agentIds: [], userIds: null, since })).toEqual([]);
  });

  it('never attributes one agent activity to another', async () => {
    await seed([
      {
        conversationId: 'c1',
        user: 'alice',
        agentId: 'agent_a',
        updatedAt: ago(HOUR),
        userMessages: [ago(HOUR)],
      },
      {
        conversationId: 'c2',
        user: 'bob',
        agentId: 'agent_b',
        updatedAt: ago(2 * HOUR),
        userMessages: [ago(2 * HOUR), ago(3 * HOUR)],
      },
    ]);

    const rows = await aggregateAgentUsage({
      agentIds: ['agent_a', 'agent_b'],
      userIds: null,
      since,
    });
    const byAgent = new Map(rows.map((row) => [row.agentId, row]));

    expect(byAgent.get('agent_a')?.messageCount).toBe(1);
    expect(byAgent.get('agent_b')?.messageCount).toBe(2);
  });
});

describe('aggregateStudentUsage', () => {
  it('counts conversations and student messages per user', async () => {
    await seed([
      {
        conversationId: 'c1',
        user: 'alice',
        agentId: 'agent_a',
        updatedAt: ago(2 * HOUR),
        userMessages: [ago(4 * HOUR), ago(2 * HOUR)],
        assistantMessages: [ago(2 * HOUR)],
      },
      {
        conversationId: 'c2',
        user: 'alice',
        agentId: 'agent_a',
        updatedAt: ago(HOUR),
        userMessages: [ago(HOUR)],
      },
      {
        conversationId: 'c3',
        user: 'bob',
        agentId: 'agent_a',
        updatedAt: ago(6 * HOUR),
        userMessages: [ago(6 * HOUR)],
      },
    ]);

    const rows = await aggregateStudentUsage({ agentId: 'agent_a', userIds: null, since });
    const byUser = new Map(rows.map((row) => [row.userId, row]));

    expect(rows).toHaveLength(2);
    expect(byUser.get('alice')).toEqual({
      userId: 'alice',
      conversationCount: 2,
      messageCount: 3,
      lastActivity: ago(HOUR),
    });
    expect(byUser.get('bob')).toEqual({
      userId: 'bob',
      conversationCount: 1,
      messageCount: 1,
      lastActivity: ago(6 * HOUR),
    });
  });

  it('omits students with no activity instead of zero-filling them', async () => {
    await seed([
      {
        conversationId: 'c1',
        user: 'alice',
        agentId: 'agent_a',
        updatedAt: ago(HOUR),
        userMessages: [ago(HOUR)],
      },
    ]);

    const rows = await aggregateStudentUsage({
      agentId: 'agent_a',
      userIds: ['alice', 'carol'],
      since,
    });

    expect(rows.map((row) => row.userId)).toEqual(['alice']);
  });

  it('excludes activity older than the since boundary and includes activity on it', async () => {
    await seed([
      {
        conversationId: 'inside',
        user: 'alice',
        agentId: 'agent_a',
        updatedAt: since,
        userMessages: [since],
      },
      {
        conversationId: 'outside',
        user: 'bob',
        agentId: 'agent_a',
        updatedAt: new Date(since.getTime() - 1),
        userMessages: [new Date(since.getTime() - 1)],
      },
    ]);

    const rows = await aggregateStudentUsage({ agentId: 'agent_a', userIds: null, since });

    expect(rows).toEqual([
      { userId: 'alice', conversationCount: 1, messageCount: 1, lastActivity: since },
    ]);
  });

  it('excludes temporary conversations', async () => {
    await seed([
      {
        conversationId: 'c1',
        user: 'alice',
        agentId: 'agent_a',
        updatedAt: ago(HOUR),
        isTemporary: true,
        userMessages: [ago(HOUR)],
      },
      {
        conversationId: 'c2',
        user: 'alice',
        agentId: 'agent_a',
        updatedAt: ago(2 * HOUR),
        userMessages: [ago(2 * HOUR)],
      },
    ]);

    const rows = await aggregateStudentUsage({ agentId: 'agent_a', userIds: null, since });

    expect(rows).toEqual([
      { userId: 'alice', conversationCount: 1, messageCount: 1, lastActivity: ago(2 * HOUR) },
    ]);
  });

  it('scopes to the given users, and to every user when userIds is null', async () => {
    await seed([
      {
        conversationId: 'c1',
        user: 'alice',
        agentId: 'agent_a',
        updatedAt: ago(HOUR),
        userMessages: [ago(HOUR)],
      },
      {
        conversationId: 'c2',
        user: 'bob',
        agentId: 'agent_a',
        updatedAt: ago(HOUR),
        userMessages: [ago(HOUR)],
      },
    ]);

    const scoped = await aggregateStudentUsage({
      agentId: 'agent_a',
      userIds: ['bob'],
      since,
    });
    const unfiltered = await aggregateStudentUsage({
      agentId: 'agent_a',
      userIds: null,
      since,
    });

    expect(scoped.map((row) => row.userId)).toEqual(['bob']);
    expect(unfiltered.map((row) => row.userId).sort()).toEqual(['alice', 'bob']);
  });

  it('returns no rows for an empty user list rather than every user', async () => {
    await seed([
      {
        conversationId: 'c1',
        user: 'alice',
        agentId: 'agent_a',
        updatedAt: ago(HOUR),
        userMessages: [ago(HOUR)],
      },
      {
        conversationId: 'c2',
        user: 'bob',
        agentId: 'agent_a',
        updatedAt: ago(HOUR),
        userMessages: [ago(HOUR)],
      },
    ]);

    const rows = await aggregateStudentUsage({ agentId: 'agent_a', userIds: [], since });

    expect(rows).toEqual([]);
  });

  it('only counts the requested agent', async () => {
    await seed([
      {
        conversationId: 'c1',
        user: 'alice',
        agentId: 'agent_a',
        updatedAt: ago(HOUR),
        userMessages: [ago(HOUR)],
      },
      {
        conversationId: 'c2',
        user: 'alice',
        agentId: 'agent_b',
        updatedAt: ago(HOUR),
        userMessages: [ago(HOUR), ago(2 * HOUR)],
      },
    ]);

    const rows = await aggregateStudentUsage({ agentId: 'agent_a', userIds: null, since });

    expect(rows).toEqual([
      { userId: 'alice', conversationCount: 1, messageCount: 1, lastActivity: ago(HOUR) },
    ]);
  });
});

/**
 * `conversationId` + `user` is unique only *per tenant*, so the `$lookup` cannot
 * rely on the driving pipeline's tenant `$match` alone — it needs its own tenant
 * predicate, without dropping pre-tenancy messages that carry no `tenantId`.
 */
describe('tenant scoping of the message join', () => {
  it('never joins another tenant’s messages onto a colliding conversation', async () => {
    await seed([
      {
        conversationId: 'shared-id',
        user: 'alice',
        agentId: 'agent_a',
        updatedAt: ago(HOUR),
        tenantId: 'tenant-a',
        userMessages: [ago(HOUR), ago(2 * HOUR)],
      },
      {
        conversationId: 'shared-id',
        user: 'alice',
        agentId: 'agent_a',
        updatedAt: ago(HOUR),
        tenantId: 'tenant-b',
        userMessages: [ago(3 * HOUR)],
      },
    ]);

    const rows = await aggregateStudentUsage({ agentId: 'agent_a', userIds: null, since });

    expect(rows).toEqual([
      { userId: 'alice', conversationCount: 2, messageCount: 3, lastActivity: ago(HOUR) },
    ]);
  });

  it('keeps counting pre-tenancy messages that carry no tenantId', async () => {
    await seed([
      {
        conversationId: 'legacy',
        user: 'alice',
        agentId: 'agent_a',
        updatedAt: ago(HOUR),
        tenantId: 'tenant-a',
        untenantedMessages: true,
        userMessages: [ago(HOUR), ago(2 * HOUR)],
      },
    ]);

    const rows = await aggregateStudentUsage({ agentId: 'agent_a', userIds: null, since });

    expect(rows).toEqual([
      { userId: 'alice', conversationCount: 1, messageCount: 2, lastActivity: ago(HOUR) },
    ]);
  });

  it('counts untenanted conversations and messages exactly as before', async () => {
    await seed([
      {
        conversationId: 'c1',
        user: 'alice',
        agentId: 'agent_a',
        updatedAt: ago(HOUR),
        userMessages: [ago(HOUR), ago(2 * HOUR)],
      },
    ]);

    const rows = await aggregateAgentUsage({ agentIds: ['agent_a'], userIds: null, since });

    expect(rows).toEqual([
      {
        agentId: 'agent_a',
        conversationCount: 1,
        userCount: 1,
        messageCount: 2,
        lastActivity: ago(HOUR),
      },
    ]);
  });
});

describe('aggregateAgentAnalytics', () => {
  it('narrows every count to a source match, alongside a roster', async () => {
    await seed([
      {
        conversationId: 'api-1',
        user: 'alice',
        agentId: 'agent_a',
        updatedAt: ago(HOUR),
        apiKeyId: 'key-1',
        userMessages: [ago(HOUR)],
      },
      {
        conversationId: 'chat-1',
        user: 'bob',
        agentId: 'agent_a',
        updatedAt: ago(HOUR),
        userMessages: [ago(HOUR)],
      },
      {
        conversationId: 'api-2',
        user: 'carol',
        agentId: 'agent_a',
        updatedAt: ago(HOUR),
        apiKeyId: 'key-1',
        userMessages: [ago(HOUR)],
      },
    ]);

    const raw = await aggregateAgentAnalytics({
      agentIds: ['agent_a'],
      userIds: ['alice', 'bob'],
      since,
      match: { apiKeyId: 'key-1', user: { $nin: ['nobody'] } },
    });
    expect(raw.conversationCount).toBe(1);
    expect(raw.activeStudents).toBe(1);
  });

  it('returns distributions, totals, and error counts for the scoped window', async () => {
    await seed([
      {
        conversationId: 'c1',
        user: 'alice',
        agentId: 'agent_a',
        updatedAt: ago(2 * HOUR),
        userMessages: [ago(3 * HOUR), ago(2 * HOUR)],
        assistantMessages: [ago(3 * HOUR), ago(2 * HOUR)],
        erroredMessages: 1,
      },
      {
        /** The previous UTC day, still inside the window: alice is a returning student. */
        conversationId: 'c2',
        user: 'alice',
        agentId: 'agent_a',
        updatedAt: ago(20 * HOUR),
        userMessages: [ago(20 * HOUR)],
        assistantMessages: [ago(20 * HOUR)],
      },
      {
        conversationId: 'c3',
        user: 'bob',
        agentId: 'agent_a',
        updatedAt: ago(HOUR),
        userMessages: [ago(HOUR), ago(HOUR), ago(HOUR), ago(HOUR), ago(HOUR)],
        assistantMessages: [ago(HOUR), ago(HOUR), ago(HOUR), ago(HOUR), ago(HOUR)],
      },
    ]);

    const result = await aggregateAgentAnalytics({
      agentIds: ['agent_a'],
      userIds: null,
      since,
    });

    expect(result.conversationCount).toBe(3);
    expect(result.activeStudents).toBe(2);
    expect(result.returningStudents).toBe(1);
    expect(result.assistantMessageCount).toBe(8);
    expect(result.erroredMessageCount).toBe(1);
    expect(result.turnDistribution).toEqual([
      { turns: 1, conversations: 1 },
      { turns: 2, conversations: 1 },
      { turns: 5, conversations: 1 },
    ]);
    expect(result.studentDistribution).toEqual([
      { conversations: 1, students: 1 },
      { conversations: 2, students: 1 },
    ]);
    expect(result.daily).toEqual([
      { date: '2026-06-30', conversations: 1 },
      { date: '2026-07-01', conversations: 2 },
    ]);
  });

  it('returns an empty result for an empty class', async () => {
    await seed([
      {
        conversationId: 'c1',
        user: 'alice',
        agentId: 'agent_a',
        updatedAt: ago(HOUR),
        userMessages: [ago(HOUR)],
      },
    ]);

    const result = await aggregateAgentAnalytics({
      agentIds: ['agent_a'],
      userIds: [],
      since,
    });

    expect(result).toEqual({
      conversationCount: 0,
      activeStudents: 0,
      returningStudents: 0,
      assistantMessageCount: 0,
      erroredMessageCount: 0,
      turnDistribution: [],
      studentDistribution: [],
      daily: [],
    });
  });

  it('excludes conversations that fall outside the window', async () => {
    await seed([
      {
        conversationId: 'old',
        user: 'alice',
        agentId: 'agent_a',
        updatedAt: ago(48 * HOUR),
        userMessages: [ago(48 * HOUR)],
        assistantMessages: [ago(48 * HOUR)],
      },
    ]);

    const result = await aggregateAgentAnalytics({
      agentIds: ['agent_a'],
      userIds: null,
      since,
    });

    expect(result.conversationCount).toBe(0);
    expect(result.daily).toEqual([]);
  });
});
