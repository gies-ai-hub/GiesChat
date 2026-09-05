import { Types } from 'mongoose';
import { ResourceType, PermissionBits } from 'librechat-data-provider';
import type { IUser, IAgent, IGroup } from '@librechat/data-schemas';
import type { Response } from 'express';
import type {
  AdminUsageDeps,
  AgentUsageRow,
  AgentUsageScope,
  StudentUsageRow,
  StudentUsageScope,
  AgentAnalyticsRaw,
} from './usage';
import type { ServerRequest } from '~/types/http';
import { createAdminUsageHandlers } from './usage';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const NOW = new Date('2026-07-28T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

const callerId = new Types.ObjectId();
const otherAuthorId = new Types.ObjectId();

const bobId = new Types.ObjectId();
const anaId = new Types.ObjectId();
const zedId = new Types.ObjectId();
const groupId = new Types.ObjectId();

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

function mockAgent(overrides: Partial<IAgent> = {}): IAgent {
  return {
    _id: new Types.ObjectId(),
    id: 'agent_test',
    name: 'Test Agent',
    author: otherAuthorId,
    provider: 'anthropic',
    model: 'claude',
    category: 'general',
    /** The dashboard lists only its own builds, so fixtures are dashboard-built by
     *  default and the scoping tests keep exercising authorship rather than origin. */
    createdVia: 'dashboard',
    ...overrides,
  } as IAgent;
}

function mockUser(overrides: Partial<IUser> = {}): IUser {
  return {
    _id: new Types.ObjectId(),
    name: 'Test Student',
    email: 'student@illinois.edu',
    role: 'USER',
    provider: 'openid',
    ...overrides,
  } as IUser;
}

function mockGroup(overrides: Partial<IGroup> = {}): IGroup {
  return {
    _id: groupId,
    name: 'BADM 350 Section A',
    source: 'local',
    memberIds: [bobId.toString(), anaId.toString()],
    ...overrides,
  } as IGroup;
}

/** One conversation's worth of activity — the raw material both fake aggregators reduce. */
interface ConversationFixture {
  conversationId: string;
  agentId: string;
  userId: string;
  messageCount: number;
  lastActivity: Date;
}

function convo(
  agentId: string,
  userId: Types.ObjectId,
  messageCount: number,
  lastActivity: string,
  conversationId = new Types.ObjectId().toString(),
): ConversationFixture {
  return {
    conversationId,
    agentId,
    userId: userId.toString(),
    messageCount,
    lastActivity: new Date(lastActivity),
  };
}

/* ------------------------------------------------------------------ *
 * A real (tiny) filter evaluator.
 *
 * The fake `findAgents` / `findUsers` deps below run this against fixture
 * documents instead of returning a canned list, so a handler that hands the
 * data layer an unscoped or attacker-shaped filter genuinely leaks rows (or
 * throws) rather than silently passing. Only `$or` and `$in` are supported —
 * anything else is treated as an operator injection and blows up loudly.
 * ------------------------------------------------------------------ */

type FieldReader<T> = (doc: T, key: string) => string | undefined;

function assertPlainStringLike(key: string, value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || value instanceof Types.ObjectId) {
    return String(value);
  }
  throw new Error(
    `Operator/object value reached the database layer for "${key}": ${JSON.stringify(value)}`,
  );
}

function matchesFilter<T>(read: FieldReader<T>, doc: T, filter: unknown): boolean {
  if (filter == null || typeof filter !== 'object') {
    throw new Error(`Filter must be an object, received: ${JSON.stringify(filter)}`);
  }

  const entries = Object.entries(filter as Record<string, unknown>);

  return entries.every(([key, condition]) => {
    if (key === '$or') {
      if (!Array.isArray(condition)) {
        throw new Error('$or must be an array');
      }
      return condition.some((branch) => matchesFilter(read, doc, branch));
    }

    if (key === '$and') {
      if (!Array.isArray(condition)) {
        throw new Error('$and must be an array');
      }
      return condition.every((branch) => matchesFilter(read, doc, branch));
    }

    if (key.startsWith('$')) {
      throw new Error(`Unsupported top-level operator in filter: ${key}`);
    }

    const actual = read(doc, key);

    if (
      condition !== null &&
      typeof condition === 'object' &&
      !(condition instanceof Types.ObjectId)
    ) {
      const ops = Object.keys(condition as Record<string, unknown>);
      if (ops.length !== 1 || ops[0] !== '$in') {
        throw new Error(
          `Unsupported query operator reached the database layer for "${key}": ${JSON.stringify(condition)}`,
        );
      }
      const values = (condition as { $in: unknown }).$in;
      if (!Array.isArray(values)) {
        throw new Error(`$in for "${key}" must be an array`);
      }
      return values.some((value) => assertPlainStringLike(key, value) === actual);
    }

    return assertPlainStringLike(key, condition) === actual;
  });
}

const readAgentField: FieldReader<IAgent> = (doc, key) => {
  if (key === '_id') {
    return String(doc._id);
  }
  if (key === 'id') {
    return doc.id;
  }
  if (key === 'name') {
    return doc.name;
  }
  if (key === 'author') {
    return String(doc.author);
  }
  if (key === 'createdVia') {
    return doc.createdVia;
  }
  throw new Error(`Unknown agent field used in filter: ${key}`);
};

const readUserField: FieldReader<IUser> = (doc, key) => {
  if (key === '_id') {
    return String(doc._id);
  }
  if (key === 'name') {
    return doc.name;
  }
  if (key === 'email') {
    return doc.email;
  }
  if (key === 'idOnTheSource') {
    return doc.idOnTheSource;
  }
  throw new Error(`Unknown user field used in filter: ${key}`);
};

/* ------------------------------------------------------------------ *
 * Fake aggregations — real reductions over ConversationFixture[].
 *
 * Like Mongo's `$group`, they emit rows ONLY for entities with matching
 * activity. Zero-filling agents and non-participating students is therefore
 * the handler's job, which is exactly what the product needs.
 * ------------------------------------------------------------------ */

function withinScope(row: ConversationFixture, userIds: string[] | null, since: Date): boolean {
  if (Number.isNaN(since.getTime())) {
    throw new Error('NaN date reached the aggregation — `days` parsing is broken');
  }
  if (row.lastActivity < since) {
    return false;
  }
  if (userIds === null) {
    return true;
  }
  for (const id of userIds) {
    if (typeof id !== 'string') {
      throw new Error(`Non-string user id reached the aggregation: ${JSON.stringify(id)}`);
    }
  }
  return userIds.includes(row.userId);
}

function fakeAggregateAgentUsage(
  conversations: ConversationFixture[],
): (scope: AgentUsageScope) => Promise<AgentUsageRow[]> {
  return async ({ agentIds, userIds, since }) => {
    for (const id of agentIds) {
      if (typeof id !== 'string') {
        throw new Error(`Non-string agent id reached the aggregation: ${JSON.stringify(id)}`);
      }
    }

    const buckets = new Map<string, { convos: ConversationFixture[]; users: Set<string> }>();

    for (const row of conversations) {
      if (!agentIds.includes(row.agentId) || !withinScope(row, userIds, since)) {
        continue;
      }
      const bucket = buckets.get(row.agentId) ?? { convos: [], users: new Set<string>() };
      bucket.convos.push(row);
      bucket.users.add(row.userId);
      buckets.set(row.agentId, bucket);
    }

    return Array.from(buckets.entries()).map(([agentId, bucket]) => ({
      agentId,
      conversationCount: bucket.convos.length,
      userCount: bucket.users.size,
      messageCount: bucket.convos.reduce((sum, c) => sum + c.messageCount, 0),
      lastActivity: bucket.convos.reduce<Date | null>(
        (latest, c) => (latest === null || c.lastActivity > latest ? c.lastActivity : latest),
        null,
      ),
    }));
  };
}

function fakeAggregateStudentUsage(
  conversations: ConversationFixture[],
): (scope: StudentUsageScope) => Promise<StudentUsageRow[]> {
  return async ({ agentId, userIds, since }) => {
    if (typeof agentId !== 'string') {
      throw new Error(`Non-string agent id reached the aggregation: ${JSON.stringify(agentId)}`);
    }

    const buckets = new Map<string, ConversationFixture[]>();

    for (const row of conversations) {
      if (row.agentId !== agentId || !withinScope(row, userIds, since)) {
        continue;
      }
      buckets.set(row.userId, [...(buckets.get(row.userId) ?? []), row]);
    }

    return Array.from(buckets.entries()).map(([userId, rows]) => ({
      userId,
      conversationCount: rows.length,
      messageCount: rows.reduce((sum, c) => sum + c.messageCount, 0),
      lastActivity: rows.reduce<Date | null>(
        (latest, c) => (latest === null || c.lastActivity > latest ? c.lastActivity : latest),
        null,
      ),
    }));
  };
}

/* ------------------------------------------------------------------ *
 * Test harness
 * ------------------------------------------------------------------ */

interface WorldFixture {
  agents: IAgent[];
  users: IUser[];
  groups: IGroup[];
  conversations: ConversationFixture[];
  /** Agent `_id`s the caller holds an EDIT ACL grant on. */
  editableAgentObjectIds: Types.ObjectId[];
  /** Agent `_id`s the caller holds a DELETE ACL grant on. Defaults to none. */
  deletableAgentObjectIds: Types.ObjectId[];
}

interface TestDeps extends AdminUsageDeps {
  findAgents: jest.Mock;
  findAccessibleResources: jest.Mock;
  findGroupById: jest.Mock;
  findUsers: jest.Mock;
  aggregateAgentUsage: jest.Mock;
  aggregateStudentUsage: jest.Mock;
  aggregateAgentAnalytics: jest.Mock;
  sampleStudentMessages: jest.Mock;
  resolveTopicsModel: jest.Mock;
  updateUser: jest.Mock;
  setAgentEmbed: jest.Mock;
}

/** The shape the analytics pipeline returns when nothing happened in the window. */
const EMPTY_ANALYTICS_RAW: AgentAnalyticsRaw = {
  conversationCount: 0,
  activeStudents: 0,
  returningStudents: 0,
  assistantMessageCount: 0,
  erroredMessageCount: 0,
  turnDistribution: [],
  studentDistribution: [],
  daily: [],
};

type DepOverrides = Partial<Record<keyof AdminUsageDeps, jest.Mock>>;

function createDeps(world: Partial<WorldFixture> = {}, overrides: DepOverrides = {}): TestDeps {
  const agents = world.agents ?? [];
  const users = world.users ?? [];
  const groups = world.groups ?? [];
  const conversations = world.conversations ?? [];
  const editable = world.editableAgentObjectIds ?? [];
  const deletable = world.deletableAgentObjectIds ?? [];

  const deps: TestDeps = {
    findAgents: jest.fn(async (filter: unknown) =>
      agents.filter((agent) => matchesFilter(readAgentField, agent, filter)),
    ),
    /** Honours the permission bit — EDIT scopes the list, DELETE decides `canDelete`. */
    findAccessibleResources: jest.fn(
      async ({ requiredPermissions }: { requiredPermissions: number }) =>
        requiredPermissions === PermissionBits.DELETE ? deletable : editable,
    ),
    findGroupById: jest.fn(async (id: unknown) => {
      if (typeof id !== 'string') {
        throw new Error(`Non-string groupId reached the database layer: ${JSON.stringify(id)}`);
      }
      return groups.find((group) => String(group._id) === id) ?? null;
    }),
    findUsers: jest.fn(async (filter: unknown) =>
      users.filter((user) => matchesFilter(readUserField, user, filter)),
    ),
    aggregateAgentUsage: jest.fn(fakeAggregateAgentUsage(conversations)),
    aggregateStudentUsage: jest.fn(fakeAggregateStudentUsage(conversations)),
    aggregateAgentAnalytics: jest.fn(async () => EMPTY_ANALYTICS_RAW),
    sampleStudentMessages: jest.fn(async () => []),
    resolveTopicsModel: jest.fn(async () => null),
    updateUser: jest.fn(async () => null),
    setAgentEmbed: jest.fn(async () => null),
    ...overrides,
  };

  return deps;
}

function createReqRes(
  overrides: {
    params?: ServerRequest['params'];
    query?: ServerRequest['query'];
    body?: ServerRequest['body'];
    user?: IUser | undefined;
  } = {},
) {
  const req = {
    params: overrides.params ?? {},
    query: overrides.query ?? {},
    body: overrides.body ?? {},
    user: 'user' in overrides ? overrides.user : mockUser({ _id: callerId, role: 'ADMIN' }),
  } as ServerRequest;

  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const partial: Pick<Response, 'status' | 'json'> = { status, json };
  const res = partial as Response;

  return { req, res, status, json };
}

interface AgentUsageResponseItem {
  agent_id: string;
  name: string;
  conversationCount: number;
  userCount: number;
  messageCount: number;
  lastActivity: string | null;
  canDelete: boolean;
}

interface StudentUsageResponseItem {
  userId: string;
  name: string;
  email: string;
  conversationCount: number;
  messageCount: number;
  lastActivity: string | null;
}

function agentBody(json: jest.Mock): { agents: AgentUsageResponseItem[] } {
  return json.mock.calls[0][0] as { agents: AgentUsageResponseItem[] };
}

function studentBody(json: jest.Mock): { agent_id: string; students: StudentUsageResponseItem[] } {
  return json.mock.calls[0][0] as { agent_id: string; students: StudentUsageResponseItem[] };
}

interface AnalyticsResponseBody {
  activeStudents: number;
  enrolledStudents: number;
  conversationCount: number;
  medianTurns: number;
  returnRate: number;
  dailyActivity: { date: string; conversationCount: number }[];
  reachBuckets: { label: string; count: number }[];
  depthBuckets: { label: string; count: number }[];
  oneTurnShare: number;
  errorRate: number;
}

function analyticsBody(json: jest.Mock): AnalyticsResponseBody {
  return json.mock.calls[0][0] as AnalyticsResponseBody;
}

function errorBody(json: jest.Mock): { error?: string; stack?: string; message?: string } {
  return json.mock.calls[0][0] as { error?: string; stack?: string; message?: string };
}

/* ------------------------------------------------------------------ *
 * Shared world: 4 agents, 3 students, 1 group
 * ------------------------------------------------------------------ */

const alpha = mockAgent({ id: 'agent_alpha', name: 'Alpha', author: callerId });
const beta = mockAgent({ id: 'agent_beta', name: 'Beta', author: otherAuthorId });
const gamma = mockAgent({ id: 'agent_gamma', name: 'Gamma', author: otherAuthorId });
const delta = mockAgent({ id: 'agent_delta', name: 'Delta', author: callerId });

const bob = mockUser({ _id: bobId, name: 'Bob Member', email: 'bob@illinois.edu' });
const ana = mockUser({ _id: anaId, name: 'Ana Member', email: 'ana@illinois.edu' });
const zed = mockUser({ _id: zedId, name: 'Zed Outsider', email: 'zed@illinois.edu' });

function baseWorld(overrides: Partial<WorldFixture> = {}): WorldFixture {
  return {
    agents: [alpha, beta, gamma, delta],
    users: [bob, ana, zed],
    groups: [mockGroup()],
    conversations: [],
    /** caller can EDIT `beta` via ACL; authors `alpha` and `delta`; `gamma` is off-limits. */
    editableAgentObjectIds: [beta._id as Types.ObjectId],
    /** No DELETE grants by default — EDIT scope must not imply deletability. */
    deletableAgentObjectIds: [],
    ...overrides,
  };
}

describe('createAdminUsageHandlers', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /* ================================================================ *
   * listAgentUsage
   * ================================================================ */

  describe('listAgentUsage', () => {
    describe('security — agent scoping', () => {
      it('returns only agents the caller authored or holds EDIT ACL on', async () => {
        const deps = createDeps(baseWorld());
        const handlers = createAdminUsageHandlers(deps);
        const { req, res, status, json } = createReqRes();

        await handlers.listAgentUsage(req, res);

        expect(status).toHaveBeenCalledWith(200);
        const ids = agentBody(json).agents.map((a) => a.agent_id);
        expect(ids).toHaveLength(3);
        expect(ids).toEqual(expect.arrayContaining(['agent_alpha', 'agent_beta', 'agent_delta']));
      });

      it('never exposes an agent the caller neither authored nor can edit', async () => {
        const deps = createDeps(baseWorld());
        const handlers = createAdminUsageHandlers(deps);
        const { req, res, json } = createReqRes();

        await handlers.listAgentUsage(req, res);

        const ids = agentBody(json).agents.map((a) => a.agent_id);
        expect(ids).not.toContain('agent_gamma');
      });

      it('does not aggregate usage for agents outside the caller scope', async () => {
        const deps = createDeps(baseWorld());
        const handlers = createAdminUsageHandlers(deps);
        const { req, res } = createReqRes();

        await handlers.listAgentUsage(req, res);

        const scope = deps.aggregateAgentUsage.mock.calls[0][0] as AgentUsageScope;
        expect(scope.agentIds).not.toContain('agent_gamma');
        expect(scope.agentIds.sort()).toEqual(['agent_alpha', 'agent_beta', 'agent_delta']);
      });

      it('requests EDIT permission (not VIEW) on agent resources for the calling user', async () => {
        const deps = createDeps(baseWorld());
        const handlers = createAdminUsageHandlers(deps);
        const { req, res } = createReqRes();

        await handlers.listAgentUsage(req, res);

        expect(deps.findAccessibleResources).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: callerId.toString(),
            resourceType: ResourceType.AGENT,
            requiredPermissions: PermissionBits.EDIT,
          }),
        );
      });

      /**
       * DELETE is a distinct bit from the EDIT that scopes the list. Reporting it per row is
       * what stops the dashboard rendering a delete control that comes back 403.
       */
      describe('canDelete', () => {
        it('is true for an agent the caller authored', async () => {
          const deps = createDeps(baseWorld());
          const handlers = createAdminUsageHandlers(deps);
          const { req, res, json } = createReqRes();

          await handlers.listAgentUsage(req, res);

          const byId = new Map(agentBody(json).agents.map((a) => [a.agent_id, a.canDelete]));
          expect(byId.get('agent_alpha')).toBe(true);
          expect(byId.get('agent_delta')).toBe(true);
        });

        it('is false for an agent reachable only through an EDIT grant', async () => {
          const deps = createDeps(baseWorld());
          const handlers = createAdminUsageHandlers(deps);
          const { req, res, json } = createReqRes();

          await handlers.listAgentUsage(req, res);

          const beta_ = agentBody(json).agents.find((a) => a.agent_id === 'agent_beta');
          expect(beta_?.canDelete).toBe(false);
        });

        it('is true for an agent the caller holds a DELETE grant on', async () => {
          const deps = createDeps(
            baseWorld({ deletableAgentObjectIds: [beta._id as Types.ObjectId] }),
          );
          const handlers = createAdminUsageHandlers(deps);
          const { req, res, json } = createReqRes();

          await handlers.listAgentUsage(req, res);

          const beta_ = agentBody(json).agents.find((a) => a.agent_id === 'agent_beta');
          expect(beta_?.canDelete).toBe(true);
        });

        it('requests the DELETE bit separately from the EDIT scoping call', async () => {
          const deps = createDeps(baseWorld());
          const handlers = createAdminUsageHandlers(deps);
          const { req, res } = createReqRes();

          await handlers.listAgentUsage(req, res);

          expect(deps.findAccessibleResources).toHaveBeenCalledWith(
            expect.objectContaining({
              userId: callerId.toString(),
              resourceType: ResourceType.AGENT,
              requiredPermissions: PermissionBits.DELETE,
            }),
          );
        });

        it('never grants delete on an agent outside the caller scope', async () => {
          const deps = createDeps(
            baseWorld({ deletableAgentObjectIds: [gamma._id as Types.ObjectId] }),
          );
          const handlers = createAdminUsageHandlers(deps);
          const { req, res, json } = createReqRes();

          await handlers.listAgentUsage(req, res);

          const ids = agentBody(json).agents.map((a) => a.agent_id);
          expect(ids).not.toContain('agent_gamma');
        });
      });

      it('returns an empty list when the caller authors nothing and has no grants', async () => {
        const deps = createDeps(
          baseWorld({
            agents: [gamma],
            editableAgentObjectIds: [],
          }),
        );
        const handlers = createAdminUsageHandlers(deps);
        const { req, res, status, json } = createReqRes();

        await handlers.listAgentUsage(req, res);

        expect(status).toHaveBeenCalledWith(200);
        expect(agentBody(json).agents).toEqual([]);
      });

      it('rejects an unauthenticated caller without touching any data dependency', async () => {
        const deps = createDeps(baseWorld());
        const handlers = createAdminUsageHandlers(deps);
        const { req, res, status } = createReqRes({ user: undefined });

        await handlers.listAgentUsage(req, res);

        expect(status).toHaveBeenCalledWith(401);
        expect(deps.findAccessibleResources).not.toHaveBeenCalled();
        expect(deps.findAgents).not.toHaveBeenCalled();
        expect(deps.aggregateAgentUsage).not.toHaveBeenCalled();
      });
    });

    /**
     * The dashboard lists only what was built there. This is a presentation filter,
     * not a permission — authorship still bounds what is reachable at all.
     */
    describe('createdVia filter', () => {
      it('excludes an agent the caller authored but did not build in the dashboard', async () => {
        const deps = createDeps(
          baseWorld({
            agents: [
              mockAgent({
                id: 'agent_elsewhere',
                name: 'Built In The Marketplace',
                author: callerId,
                createdVia: undefined,
              }),
              mockAgent({ id: 'agent_built', name: 'Built Here', author: callerId }),
            ],
          }),
        );
        const handlers = createAdminUsageHandlers(deps);
        const { req, res, json } = createReqRes();

        await handlers.listAgentUsage(req, res);

        const ids = agentBody(json).agents.map((a) => a.agent_id);
        expect(ids).toEqual(['agent_built']);
      });

      it('returns nothing when every agent the caller authored was built elsewhere', async () => {
        const deps = createDeps(
          baseWorld({
            agents: [
              mockAgent({ id: 'agent_a', name: 'A', author: callerId, createdVia: undefined }),
              mockAgent({ id: 'agent_b', name: 'B', author: callerId, createdVia: undefined }),
            ],
          }),
        );
        const handlers = createAdminUsageHandlers(deps);
        const { req, res, json } = createReqRes();

        await handlers.listAgentUsage(req, res);

        expect(agentBody(json).agents).toHaveLength(0);
      });

      it('asks the data layer to filter on createdVia', async () => {
        const deps = createDeps(baseWorld());
        const handlers = createAdminUsageHandlers(deps);
        const { req, res } = createReqRes();

        await handlers.listAgentUsage(req, res);

        const [filter] = deps.findAgents.mock.calls[0];
        expect(filter).toMatchObject({ createdVia: 'dashboard' });
      });
    });

    /**
     * The dashboard's card strip renders agent identity, which only reaches the client
     * if the projection asks for it. An agent with no avatar or description is the
     * normal case, not an error — it must arrive as an explicit null.
     */
    describe('identity fields', () => {
      it('projects description, avatar, and category from the agent document', async () => {
        const deps = createDeps(
          baseWorld({
            agents: [
              mockAgent({
                id: 'agent_alpha',
                name: 'Alpha',
                author: callerId,
                description: 'Coaches students through case studies.',
                avatar: { filepath: '/images/alpha.png', source: 'local' },
                category: 'course',
                course: 'BADM 350',
              }),
            ],
          }),
        );
        const handlers = createAdminUsageHandlers(deps);
        const { req, res, json } = createReqRes();

        await handlers.listAgentUsage(req, res);

        const [agent] = agentBody(json).agents;
        expect(agent.description).toBe('Coaches students through case studies.');
        expect(agent.avatar).toEqual({ filepath: '/images/alpha.png', source: 'local' });
        expect(agent.category).toBe('course');
        expect(agent.course).toBe('BADM 350');
      });

      it('reports null for an agent with no description or avatar', async () => {
        const deps = createDeps(baseWorld({ agents: [alpha] }));
        const handlers = createAdminUsageHandlers(deps);
        const { req, res, json } = createReqRes();

        await handlers.listAgentUsage(req, res);

        const [agent] = agentBody(json).agents;
        expect(agent.description).toBeNull();
        expect(agent.avatar).toBeNull();
        expect(agent.category).toBe('general');
        expect(agent.course).toBeNull();
      });

      it('asks the data layer for the identity fields', async () => {
        const deps = createDeps(baseWorld());
        const handlers = createAdminUsageHandlers(deps);
        const { req, res } = createReqRes();

        await handlers.listAgentUsage(req, res);

        const [, fields] = deps.findAgents.mock.calls[0];
        expect(fields).toContain('description');
        expect(fields).toContain('avatar');
        expect(fields).toContain('category');
        expect(fields).toContain('course');
      });
    });

    describe('security — group scoping', () => {
      it('restricts aggregation to the group memberIds', async () => {
        const deps = createDeps(baseWorld());
        const handlers = createAdminUsageHandlers(deps);
        const { req, res } = createReqRes({ query: { groupId: groupId.toString() } });

        await handlers.listAgentUsage(req, res);

        const scope = deps.aggregateAgentUsage.mock.calls[0][0] as AgentUsageScope;
        expect(scope.userIds).toEqual(expect.arrayContaining([bobId.toString(), anaId.toString()]));
        expect(scope.userIds).toHaveLength(2);
        expect(scope.userIds).not.toContain(zedId.toString());
      });

      it('excludes a non-member’s activity from the counts', async () => {
        const world = baseWorld({
          conversations: [
            convo('agent_alpha', bobId, 4, '2026-07-20T10:00:00.000Z'),
            convo('agent_alpha', zedId, 9, '2026-07-21T10:00:00.000Z'),
          ],
        });
        const deps = createDeps(world);
        const handlers = createAdminUsageHandlers(deps);
        const { req, res, json } = createReqRes({ query: { groupId: groupId.toString() } });

        await handlers.listAgentUsage(req, res);

        const row = agentBody(json).agents.find((a) => a.agent_id === 'agent_alpha');
        expect(row).toBeDefined();
        expect(row?.conversationCount).toBe(1);
        expect(row?.userCount).toBe(1);
        expect(row?.messageCount).toBe(4);
      });

      it('counts every user when no groupId is supplied', async () => {
        const world = baseWorld({
          conversations: [
            convo('agent_alpha', bobId, 4, '2026-07-20T10:00:00.000Z'),
            convo('agent_alpha', zedId, 9, '2026-07-21T10:00:00.000Z'),
          ],
        });
        const deps = createDeps(world);
        const handlers = createAdminUsageHandlers(deps);
        const { req, res, json } = createReqRes();

        await handlers.listAgentUsage(req, res);

        const row = agentBody(json).agents.find((a) => a.agent_id === 'agent_alpha');
        expect(row?.conversationCount).toBe(2);
        expect(row?.userCount).toBe(2);
        expect(row?.messageCount).toBe(13);
      });

      it('returns 404 for a groupId that does not exist and never aggregates', async () => {
        const deps = createDeps(baseWorld());
        const handlers = createAdminUsageHandlers(deps);
        const missingGroupId = new Types.ObjectId().toString();
        const { req, res, status, json } = createReqRes({ query: { groupId: missingGroupId } });

        await handlers.listAgentUsage(req, res);

        expect(status).toHaveBeenCalledWith(404);
        expect(errorBody(json).error).toEqual(expect.any(String));
        expect(deps.aggregateAgentUsage).not.toHaveBeenCalled();
      });

      it('does not silently fall back to unfiltered results for a missing group', async () => {
        const deps = createDeps(baseWorld());
        const handlers = createAdminUsageHandlers(deps);
        const { req, res, status, json } = createReqRes({
          query: { groupId: new Types.ObjectId().toString() },
        });

        await handlers.listAgentUsage(req, res);

        expect(status).not.toHaveBeenCalledWith(200);
        expect(json.mock.calls[0][0]).not.toHaveProperty('agents');
      });

      it('returns an empty group as an empty scope, not an unscoped one', async () => {
        const deps = createDeps(
          baseWorld({
            groups: [mockGroup({ memberIds: [] })],
            conversations: [convo('agent_alpha', zedId, 5, '2026-07-20T10:00:00.000Z')],
          }),
        );
        const handlers = createAdminUsageHandlers(deps);
        const { req, res, status, json } = createReqRes({ query: { groupId: groupId.toString() } });

        await handlers.listAgentUsage(req, res);

        expect(status).toHaveBeenCalledWith(200);
        const row = agentBody(json).agents.find((a) => a.agent_id === 'agent_alpha');
        expect(row?.conversationCount).toBe(0);
        expect(row?.userCount).toBe(0);
      });
    });

    describe('security — NoSQL operator injection', () => {
      it('rejects an object-shaped groupId before it reaches any query', async () => {
        const deps = createDeps(baseWorld());
        const handlers = createAdminUsageHandlers(deps);
        const { req, res, status, json } = createReqRes({ query: { groupId: { $ne: '' } } });

        await handlers.listAgentUsage(req, res);

        expect(status).toHaveBeenCalledWith(400);
        expect(errorBody(json).error).toEqual(expect.any(String));
        expect(deps.findGroupById).not.toHaveBeenCalled();
        expect(deps.aggregateAgentUsage).not.toHaveBeenCalled();
      });

      it('rejects a nested operator groupId such as ?groupId[$gt]=', async () => {
        const deps = createDeps(baseWorld());
        const handlers = createAdminUsageHandlers(deps);
        const { req, res, status } = createReqRes({ query: { groupId: { $gt: '' } } });

        await handlers.listAgentUsage(req, res);

        expect(status).toHaveBeenCalledWith(400);
        expect(deps.findGroupById).not.toHaveBeenCalled();
      });

      it('rejects an array-shaped groupId', async () => {
        const deps = createDeps(baseWorld());
        const handlers = createAdminUsageHandlers(deps);
        const { req, res, status } = createReqRes({
          query: { groupId: [groupId.toString(), new Types.ObjectId().toString()] },
        });

        await handlers.listAgentUsage(req, res);

        expect(status).toHaveBeenCalledWith(400);
        expect(deps.findGroupById).not.toHaveBeenCalled();
      });

      it.each<string>(['notanid', 'zzz', '123', '  ', 'agent_alpha', `${groupId.toString()}x`])(
        'answers 404 — never 500 — for the malformed groupId %p',
        async (malformed) => {
          const deps = createDeps(baseWorld());
          const handlers = createAdminUsageHandlers(deps);
          const { req, res, status, json } = createReqRes({ query: { groupId: malformed } });

          await handlers.listAgentUsage(req, res);

          expect(status).toHaveBeenCalledWith(404);
          expect(status).not.toHaveBeenCalledWith(500);
          expect(errorBody(json).error).toEqual(expect.any(String));
          expect(deps.findGroupById).not.toHaveBeenCalled();
          expect(deps.aggregateAgentUsage).not.toHaveBeenCalled();
        },
      );

      it('does not fall back to unfiltered results for a malformed groupId', async () => {
        const deps = createDeps(
          baseWorld({
            conversations: [convo('agent_alpha', zedId, 5, '2026-07-20T10:00:00.000Z')],
          }),
        );
        const handlers = createAdminUsageHandlers(deps);
        const { req, res, status, json } = createReqRes({ query: { groupId: 'notanid' } });

        await handlers.listAgentUsage(req, res);

        expect(status).not.toHaveBeenCalledWith(200);
        expect(json.mock.calls[0][0]).not.toHaveProperty('agents');
      });

      it('passes the groupId through as a plain string when valid', async () => {
        const deps = createDeps(baseWorld());
        const handlers = createAdminUsageHandlers(deps);
        const { req, res } = createReqRes({ query: { groupId: groupId.toString() } });

        await handlers.listAgentUsage(req, res);

        expect(deps.findGroupById).toHaveBeenCalled();
        const passed = deps.findGroupById.mock.calls[0][0];
        expect(typeof passed).toBe('string');
        expect(passed).toBe(groupId.toString());
      });
    });

    describe('input validation — days', () => {
      function sinceOf(deps: TestDeps): Date {
        return (deps.aggregateAgentUsage.mock.calls[0][0] as AgentUsageScope).since;
      }

      it('defaults to 30 days when absent', async () => {
        const deps = createDeps(baseWorld());
        const handlers = createAdminUsageHandlers(deps);
        const { req, res } = createReqRes();

        await handlers.listAgentUsage(req, res);

        expect(sinceOf(deps).getTime()).toBe(NOW.getTime() - 30 * DAY_MS);
      });

      it.each<[string, number]>([
        ['7', 7],
        ['1', 1],
        ['365', 365],
        ['0', 1],
        ['-5', 1],
        ['99999', 365],
        ['366', 365],
        ['abc', 30],
        ['', 30],
        ['NaN', 30],
        ['30.9', 30],
      ])('resolves days=%p to %p effective days', async (raw, expected) => {
        const deps = createDeps(baseWorld());
        const handlers = createAdminUsageHandlers(deps);
        const { req, res, status } = createReqRes({ query: { days: raw } });

        await handlers.listAgentUsage(req, res);

        expect(status).toHaveBeenCalledWith(200);
        expect(sinceOf(deps).getTime()).toBe(NOW.getTime() - expected * DAY_MS);
      });

      it.each<string>(['0', '-5', '99999', 'abc', '', 'NaN', 'Infinity', '1e400'])(
        'never lets a NaN or out-of-range window reach the aggregation for days=%p',
        async (raw) => {
          const deps = createDeps(baseWorld());
          const handlers = createAdminUsageHandlers(deps);
          const { req, res } = createReqRes({ query: { days: raw } });

          await handlers.listAgentUsage(req, res);

          const since = sinceOf(deps);
          expect(since).toBeInstanceOf(Date);
          expect(Number.isNaN(since.getTime())).toBe(false);
          const days = (NOW.getTime() - since.getTime()) / DAY_MS;
          expect(days).toBeGreaterThanOrEqual(1);
          expect(days).toBeLessThanOrEqual(365);
        },
      );

      it('rejects an object-shaped days param rather than coercing it', async () => {
        const deps = createDeps(baseWorld());
        const handlers = createAdminUsageHandlers(deps);
        const { req, res } = createReqRes({ query: { days: { $gt: '1' } } });

        await handlers.listAgentUsage(req, res);

        if (deps.aggregateAgentUsage.mock.calls.length > 0) {
          const since = sinceOf(deps);
          expect(Number.isNaN(since.getTime())).toBe(false);
          const days = (NOW.getTime() - since.getTime()) / DAY_MS;
          expect(days).toBe(30);
        }
      });

      it('actually filters activity older than the window', async () => {
        const world = baseWorld({
          conversations: [
            convo('agent_alpha', bobId, 3, '2026-07-27T10:00:00.000Z'),
            convo('agent_alpha', bobId, 50, '2026-01-01T10:00:00.000Z'),
          ],
        });
        const deps = createDeps(world);
        const handlers = createAdminUsageHandlers(deps);
        const { req, res, json } = createReqRes({ query: { days: '7' } });

        await handlers.listAgentUsage(req, res);

        const row = agentBody(json).agents.find((a) => a.agent_id === 'agent_alpha');
        expect(row?.conversationCount).toBe(1);
        expect(row?.messageCount).toBe(3);
      });
    });

    describe('correctness', () => {
      it('counts DISTINCT users, not conversations', async () => {
        const world = baseWorld({
          conversations: [
            convo('agent_alpha', bobId, 2, '2026-07-20T10:00:00.000Z'),
            convo('agent_alpha', bobId, 3, '2026-07-21T10:00:00.000Z'),
            convo('agent_alpha', bobId, 4, '2026-07-22T10:00:00.000Z'),
          ],
        });
        const deps = createDeps(world);
        const handlers = createAdminUsageHandlers(deps);
        const { req, res, json } = createReqRes();

        await handlers.listAgentUsage(req, res);

        const row = agentBody(json).agents.find((a) => a.agent_id === 'agent_alpha');
        expect(row?.conversationCount).toBe(3);
        expect(row?.userCount).toBe(1);
        expect(row?.messageCount).toBe(9);
      });

      it('includes agents with zero activity, fully zero-filled', async () => {
        const world = baseWorld({
          conversations: [convo('agent_alpha', bobId, 2, '2026-07-20T10:00:00.000Z')],
        });
        const deps = createDeps(world);
        const handlers = createAdminUsageHandlers(deps);
        const { req, res, json } = createReqRes();

        await handlers.listAgentUsage(req, res);

        const row = agentBody(json).agents.find((a) => a.agent_id === 'agent_delta');
        expect(row).toBeDefined();
        expect(row?.conversationCount).toBe(0);
        expect(row?.userCount).toBe(0);
        expect(row?.messageCount).toBe(0);
        expect(row?.lastActivity).toBeNull();
      });

      it('reports lastActivity as the most recent ISO timestamp', async () => {
        const world = baseWorld({
          conversations: [
            convo('agent_alpha', bobId, 1, '2026-07-10T08:00:00.000Z'),
            convo('agent_alpha', anaId, 1, '2026-07-24T09:30:00.000Z'),
            convo('agent_alpha', bobId, 1, '2026-07-18T08:00:00.000Z'),
          ],
        });
        const deps = createDeps(world);
        const handlers = createAdminUsageHandlers(deps);
        const { req, res, json } = createReqRes();

        await handlers.listAgentUsage(req, res);

        const row = agentBody(json).agents.find((a) => a.agent_id === 'agent_alpha');
        expect(row?.lastActivity).toBe('2026-07-24T09:30:00.000Z');
      });

      it('orders by conversationCount desc, then name asc', async () => {
        const world = baseWorld({
          conversations: [
            convo('agent_beta', bobId, 1, '2026-07-20T10:00:00.000Z'),
            convo('agent_beta', anaId, 1, '2026-07-20T10:00:00.000Z'),
            convo('agent_beta', zedId, 1, '2026-07-20T10:00:00.000Z'),
            convo('agent_delta', bobId, 1, '2026-07-20T10:00:00.000Z'),
            convo('agent_delta', anaId, 1, '2026-07-20T10:00:00.000Z'),
            convo('agent_alpha', bobId, 1, '2026-07-20T10:00:00.000Z'),
            convo('agent_alpha', anaId, 1, '2026-07-20T10:00:00.000Z'),
          ],
        });
        const deps = createDeps(world);
        const handlers = createAdminUsageHandlers(deps);
        const { req, res, json } = createReqRes();

        await handlers.listAgentUsage(req, res);

        expect(agentBody(json).agents.map((a) => a.agent_id)).toEqual([
          'agent_beta',
          'agent_alpha',
          'agent_delta',
        ]);
      });

      it('places zero-activity agents last, name-sorted among themselves', async () => {
        const world = baseWorld({
          agents: [alpha, delta],
          editableAgentObjectIds: [],
          conversations: [],
        });
        const deps = createDeps(world);
        const handlers = createAdminUsageHandlers(deps);
        const { req, res, json } = createReqRes();

        await handlers.listAgentUsage(req, res);

        expect(agentBody(json).agents.map((a) => a.name)).toEqual(['Alpha', 'Delta']);
      });

      it('returns exactly the documented item shape', async () => {
        const world = baseWorld({
          agents: [alpha],
          editableAgentObjectIds: [],
          conversations: [convo('agent_alpha', bobId, 2, '2026-07-20T10:00:00.000Z')],
        });
        const deps = createDeps(world);
        const handlers = createAdminUsageHandlers(deps);
        const { req, res, json } = createReqRes();

        await handlers.listAgentUsage(req, res);

        const [row] = agentBody(json).agents;
        expect(Object.keys(row).sort()).toEqual([
          'agent_id',
          'avatar',
          'canDelete',
          'category',
          'conversationCount',
          'course',
          'description',
          'embed',
          'lastActivity',
          'messageCount',
          'name',
          'userCount',
        ]);
        expect(row.agent_id).toBe('agent_alpha');
        expect(row.name).toBe('Alpha');
      });

      it('does not crash on an agent with no name', async () => {
        const nameless = mockAgent({ id: 'agent_nameless', name: undefined, author: callerId });
        const deps = createDeps(
          baseWorld({ agents: [nameless], editableAgentObjectIds: [], conversations: [] }),
        );
        const handlers = createAdminUsageHandlers(deps);
        const { req, res, status, json } = createReqRes();

        await handlers.listAgentUsage(req, res);

        expect(status).toHaveBeenCalledWith(200);
        expect(agentBody(json).agents[0].agent_id).toBe('agent_nameless');
        expect(typeof agentBody(json).agents[0].name).toBe('string');
      });

      it('handles unicode agent names without mangling them', async () => {
        const unicode = mockAgent({
          id: 'agent_ünicode',
          name: '日本語 エージェント',
          author: callerId,
        });
        const deps = createDeps(
          baseWorld({ agents: [unicode], editableAgentObjectIds: [], conversations: [] }),
        );
        const handlers = createAdminUsageHandlers(deps);
        const { req, res, json } = createReqRes();

        await handlers.listAgentUsage(req, res);

        expect(agentBody(json).agents[0].name).toBe('日本語 エージェント');
      });

      it('does not double-count when an agent is both authored and ACL-granted', async () => {
        const deps = createDeps(
          baseWorld({
            agents: [alpha],
            editableAgentObjectIds: [alpha._id as Types.ObjectId],
            conversations: [convo('agent_alpha', bobId, 2, '2026-07-20T10:00:00.000Z')],
          }),
        );
        const handlers = createAdminUsageHandlers(deps);
        const { req, res, json } = createReqRes();

        await handlers.listAgentUsage(req, res);

        expect(agentBody(json).agents).toHaveLength(1);
        expect(agentBody(json).agents[0].conversationCount).toBe(1);
        expect(agentBody(json).agents[0].messageCount).toBe(2);
        expect(agentBody(json).agents[0].userCount).toBe(1);
      });
    });

    describe('error handling', () => {
      const leaky = new Error('ECONNREFUSED mongodb://root:pa55w0rd@10.0.0.7:27017/LibreChat');

      it.each<[string, () => DepOverrides]>([
        [
          'findAccessibleResources',
          () => ({ findAccessibleResources: jest.fn().mockRejectedValue(leaky) }),
        ],
        ['findAgents', () => ({ findAgents: jest.fn().mockRejectedValue(leaky) })],
        [
          'aggregateAgentUsage',
          () => ({ aggregateAgentUsage: jest.fn().mockRejectedValue(leaky) }),
        ],
      ])('returns 500 without leaking internals when %s rejects', async (_name, makeOverride) => {
        const deps = createDeps(baseWorld(), makeOverride());
        const handlers = createAdminUsageHandlers(deps);
        const { req, res, status, json } = createReqRes();

        await handlers.listAgentUsage(req, res);

        expect(status).toHaveBeenCalledWith(500);
        const body = errorBody(json);
        expect(typeof body.error).toBe('string');
        expect(body).not.toHaveProperty('stack');
        expect(JSON.stringify(body)).not.toContain('pa55w0rd');
        expect(JSON.stringify(body)).not.toContain('ECONNREFUSED');
      });

      it('returns 500 when the group lookup rejects', async () => {
        const deps = createDeps(baseWorld(), {
          findGroupById: jest.fn().mockRejectedValue(leaky),
        });
        const handlers = createAdminUsageHandlers(deps);
        const { req, res, status, json } = createReqRes({
          query: { groupId: groupId.toString() },
        });

        await handlers.listAgentUsage(req, res);

        expect(status).toHaveBeenCalledWith(500);
        expect(JSON.stringify(errorBody(json))).not.toContain('pa55w0rd');
      });
    });
  });

  /* ================================================================ *
   * listAgentStudentUsage
   * ================================================================ */

  describe('listAgentStudentUsage', () => {
    const params = { agent_id: 'agent_alpha' };

    describe('security', () => {
      it('returns 403 and performs no aggregation for an agent the caller cannot edit', async () => {
        const deps = createDeps(baseWorld());
        const handlers = createAdminUsageHandlers(deps);
        const { req, res, status, json } = createReqRes({ params: { agent_id: 'agent_gamma' } });

        await handlers.listAgentStudentUsage(req, res);

        expect(status).toHaveBeenCalledWith(403);
        expect(errorBody(json).error).toEqual(expect.any(String));
        expect(deps.aggregateStudentUsage).not.toHaveBeenCalled();
      });

      it('returns 403 — never 404 or an empty 200 — for an agent that does not exist', async () => {
        const deps = createDeps(baseWorld());
        const handlers = createAdminUsageHandlers(deps);
        const { req, res, status, json } = createReqRes({ params: { agent_id: 'agent_nope' } });

        await handlers.listAgentStudentUsage(req, res);

        expect(status).toHaveBeenCalledWith(403);
        expect(status).not.toHaveBeenCalledWith(404);
        expect(status).not.toHaveBeenCalledWith(200);
        expect(json.mock.calls[0][0]).not.toHaveProperty('students');
        expect(deps.aggregateStudentUsage).not.toHaveBeenCalled();
      });

      it('allows an ACL-granted (non-authored) agent', async () => {
        const deps = createDeps(baseWorld());
        const handlers = createAdminUsageHandlers(deps);
        const { req, res, status } = createReqRes({ params: { agent_id: 'agent_beta' } });

        await handlers.listAgentStudentUsage(req, res);

        expect(status).toHaveBeenCalledWith(200);
        expect(deps.aggregateStudentUsage).toHaveBeenCalled();
      });

      it('rejects an unauthenticated caller before any lookup', async () => {
        const deps = createDeps(baseWorld());
        const handlers = createAdminUsageHandlers(deps);
        const { req, res, status } = createReqRes({ params, user: undefined });

        await handlers.listAgentStudentUsage(req, res);

        expect(status).toHaveBeenCalledWith(401);
        expect(deps.findAgents).not.toHaveBeenCalled();
        expect(deps.aggregateStudentUsage).not.toHaveBeenCalled();
      });

      it('rejects a non-string agent_id without querying', async () => {
        const deps = createDeps(baseWorld());
        const handlers = createAdminUsageHandlers(deps);
        const { req, res, status } = createReqRes({
          params: { agent_id: ['agent_alpha', 'agent_gamma'] },
        });

        await handlers.listAgentStudentUsage(req, res);

        expect(status).toHaveBeenCalledWith(400);
        expect(deps.aggregateStudentUsage).not.toHaveBeenCalled();
      });

      it('passes agent_id to the aggregation as a plain string', async () => {
        const deps = createDeps(baseWorld());
        const handlers = createAdminUsageHandlers(deps);
        const { req, res } = createReqRes({ params });

        await handlers.listAgentStudentUsage(req, res);

        const scope = deps.aggregateStudentUsage.mock.calls[0][0] as StudentUsageScope;
        expect(typeof scope.agentId).toBe('string');
        expect(scope.agentId).toBe('agent_alpha');
      });

      it('rejects an object-shaped groupId before it reaches any query', async () => {
        const deps = createDeps(baseWorld());
        const handlers = createAdminUsageHandlers(deps);
        const { req, res, status } = createReqRes({ params, query: { groupId: { $ne: '' } } });

        await handlers.listAgentStudentUsage(req, res);

        expect(status).toHaveBeenCalledWith(400);
        expect(deps.findGroupById).not.toHaveBeenCalled();
        expect(deps.aggregateStudentUsage).not.toHaveBeenCalled();
      });

      it('returns 404 for a groupId that does not exist and never aggregates', async () => {
        const deps = createDeps(baseWorld());
        const handlers = createAdminUsageHandlers(deps);
        const { req, res, status } = createReqRes({
          params,
          query: { groupId: new Types.ObjectId().toString() },
        });

        await handlers.listAgentStudentUsage(req, res);

        expect(status).toHaveBeenCalledWith(404);
        expect(deps.aggregateStudentUsage).not.toHaveBeenCalled();
      });

      it.each<string>(['notanid', 'zzz', '123', '  ', 'agent_alpha', `${groupId.toString()}x`])(
        'answers 404 — never 500 — for the malformed groupId %p',
        async (malformed) => {
          const deps = createDeps(baseWorld());
          const handlers = createAdminUsageHandlers(deps);
          const { req, res, status, json } = createReqRes({
            params,
            query: { groupId: malformed },
          });

          await handlers.listAgentStudentUsage(req, res);

          expect(status).toHaveBeenCalledWith(404);
          expect(status).not.toHaveBeenCalledWith(500);
          expect(errorBody(json).error).toEqual(expect.any(String));
          expect(deps.findGroupById).not.toHaveBeenCalled();
          expect(deps.aggregateStudentUsage).not.toHaveBeenCalled();
        },
      );

      it('does not fall back to an unfiltered student list for a malformed groupId', async () => {
        const deps = createDeps(
          baseWorld({
            conversations: [convo('agent_alpha', zedId, 5, '2026-07-20T10:00:00.000Z')],
          }),
        );
        const handlers = createAdminUsageHandlers(deps);
        const { req, res, status, json } = createReqRes({
          params,
          query: { groupId: 'notanid' },
        });

        await handlers.listAgentStudentUsage(req, res);

        expect(status).not.toHaveBeenCalledWith(200);
        expect(json.mock.calls[0][0]).not.toHaveProperty('students');
      });
    });

    describe('group membership', () => {
      it('includes a group member with ZERO activity, zero-filled', async () => {
        const world = baseWorld({
          conversations: [convo('agent_alpha', bobId, 6, '2026-07-20T10:00:00.000Z')],
        });
        const deps = createDeps(world);
        const handlers = createAdminUsageHandlers(deps);
        const { req, res, status, json } = createReqRes({
          params,
          query: { groupId: groupId.toString() },
        });

        await handlers.listAgentStudentUsage(req, res);

        expect(status).toHaveBeenCalledWith(200);
        const { students } = studentBody(json);
        const nonParticipant = students.find((s) => s.userId === anaId.toString());
        expect(nonParticipant).toBeDefined();
        expect(nonParticipant?.conversationCount).toBe(0);
        expect(nonParticipant?.messageCount).toBe(0);
        expect(nonParticipant?.lastActivity).toBeNull();
        expect(nonParticipant?.name).toBe('Ana Member');
        expect(nonParticipant?.email).toBe('ana@illinois.edu');
      });

      it('lists every group member even when nobody used the agent', async () => {
        const deps = createDeps(baseWorld({ conversations: [] }));
        const handlers = createAdminUsageHandlers(deps);
        const { req, res, json } = createReqRes({
          params,
          query: { groupId: groupId.toString() },
        });

        await handlers.listAgentStudentUsage(req, res);

        const ids = studentBody(json)
          .students.map((s) => s.userId)
          .sort();
        expect(ids).toEqual([bobId.toString(), anaId.toString()].sort());
        expect(studentBody(json).students.every((s) => s.conversationCount === 0)).toBe(true);
      });

      it('excludes a non-member even when they used the agent', async () => {
        const world = baseWorld({
          conversations: [
            convo('agent_alpha', bobId, 2, '2026-07-20T10:00:00.000Z'),
            convo('agent_alpha', zedId, 20, '2026-07-21T10:00:00.000Z'),
          ],
        });
        const deps = createDeps(world);
        const handlers = createAdminUsageHandlers(deps);
        const { req, res, json } = createReqRes({
          params,
          query: { groupId: groupId.toString() },
        });

        await handlers.listAgentStudentUsage(req, res);

        const ids = studentBody(json).students.map((s) => s.userId);
        expect(ids).not.toContain(zedId.toString());
        expect(ids).toHaveLength(2);
      });

      it('restricts the aggregation scope to plain-string member ids', async () => {
        const deps = createDeps(baseWorld());
        const handlers = createAdminUsageHandlers(deps);
        const { req, res } = createReqRes({ params, query: { groupId: groupId.toString() } });

        await handlers.listAgentStudentUsage(req, res);

        const scope = deps.aggregateStudentUsage.mock.calls[0][0] as StudentUsageScope;
        expect(scope.userIds).toEqual(expect.arrayContaining([bobId.toString(), anaId.toString()]));
        expect(scope.userIds?.every((id) => typeof id === 'string')).toBe(true);
      });

      it('returns an empty student list for an empty group', async () => {
        const deps = createDeps(
          baseWorld({
            groups: [mockGroup({ memberIds: [] })],
            conversations: [convo('agent_alpha', zedId, 5, '2026-07-20T10:00:00.000Z')],
          }),
        );
        const handlers = createAdminUsageHandlers(deps);
        const { req, res, status, json } = createReqRes({
          params,
          query: { groupId: groupId.toString() },
        });

        await handlers.listAgentStudentUsage(req, res);

        expect(status).toHaveBeenCalledWith(200);
        expect(studentBody(json).students).toEqual([]);
      });

      it('without a groupId, lists only users with activity', async () => {
        const world = baseWorld({
          conversations: [
            convo('agent_alpha', bobId, 2, '2026-07-20T10:00:00.000Z'),
            convo('agent_alpha', zedId, 3, '2026-07-21T10:00:00.000Z'),
          ],
        });
        const deps = createDeps(world);
        const handlers = createAdminUsageHandlers(deps);
        const { req, res, json } = createReqRes({ params });

        await handlers.listAgentStudentUsage(req, res);

        const ids = studentBody(json)
          .students.map((s) => s.userId)
          .sort();
        expect(ids).toEqual([bobId.toString(), zedId.toString()].sort());
      });
    });

    describe('correctness', () => {
      it('returns the documented envelope and item shape', async () => {
        const world = baseWorld({
          conversations: [convo('agent_alpha', bobId, 4, '2026-07-20T10:00:00.000Z')],
        });
        const deps = createDeps(world);
        const handlers = createAdminUsageHandlers(deps);
        const { req, res, json } = createReqRes({ params });

        await handlers.listAgentStudentUsage(req, res);

        const body = studentBody(json);
        expect(body.agent_id).toBe('agent_alpha');
        expect(body.students).toHaveLength(1);
        expect(Object.keys(body.students[0]).sort()).toEqual([
          'conversationCount',
          'email',
          'lastActivity',
          'messageCount',
          'name',
          'userId',
        ]);
      });

      it('sums messages across a student’s conversations', async () => {
        const world = baseWorld({
          conversations: [
            convo('agent_alpha', bobId, 2, '2026-07-20T10:00:00.000Z'),
            convo('agent_alpha', bobId, 5, '2026-07-22T10:00:00.000Z'),
          ],
        });
        const deps = createDeps(world);
        const handlers = createAdminUsageHandlers(deps);
        const { req, res, json } = createReqRes({ params });

        await handlers.listAgentStudentUsage(req, res);

        const row = studentBody(json).students.find((s) => s.userId === bobId.toString());
        expect(row?.conversationCount).toBe(2);
        expect(row?.messageCount).toBe(7);
      });

      it('reports lastActivity as the most recent ISO timestamp', async () => {
        const world = baseWorld({
          conversations: [
            convo('agent_alpha', bobId, 1, '2026-07-11T05:00:00.000Z'),
            convo('agent_alpha', bobId, 1, '2026-07-25T16:45:00.000Z'),
          ],
        });
        const deps = createDeps(world);
        const handlers = createAdminUsageHandlers(deps);
        const { req, res, json } = createReqRes({ params });

        await handlers.listAgentStudentUsage(req, res);

        const row = studentBody(json).students.find((s) => s.userId === bobId.toString());
        expect(row?.lastActivity).toBe('2026-07-25T16:45:00.000Z');
      });

      it('orders by conversationCount desc, then name asc', async () => {
        const carl = mockUser({ name: 'Carl Member', email: 'carl@illinois.edu' });
        const world = baseWorld({
          users: [bob, ana, carl],
          groups: [
            mockGroup({
              memberIds: [bobId.toString(), anaId.toString(), String(carl._id)],
            }),
          ],
          conversations: [
            convo('agent_alpha', bobId, 1, '2026-07-20T10:00:00.000Z'),
            convo('agent_alpha', anaId, 1, '2026-07-20T10:00:00.000Z'),
            convo('agent_alpha', anaId, 1, '2026-07-21T10:00:00.000Z'),
          ],
        });
        const deps = createDeps(world);
        const handlers = createAdminUsageHandlers(deps);
        const { req, res, json } = createReqRes({
          params,
          query: { groupId: groupId.toString() },
        });

        await handlers.listAgentStudentUsage(req, res);

        expect(studentBody(json).students.map((s) => s.name)).toEqual([
          'Ana Member',
          'Bob Member',
          'Carl Member',
        ]);
      });

      it('defaults the window to 30 days and clamps it to 1..365', async () => {
        const cases: Array<[string | undefined, number]> = [
          [undefined, 30],
          ['0', 1],
          ['-5', 1],
          ['99999', 365],
          ['abc', 30],
          ['', 30],
          ['14', 14],
        ];

        for (const [raw, expected] of cases) {
          const deps = createDeps(baseWorld());
          const handlers = createAdminUsageHandlers(deps);
          const { req, res } = createReqRes({
            params,
            query: raw === undefined ? {} : { days: raw },
          });

          await handlers.listAgentStudentUsage(req, res);

          const scope = deps.aggregateStudentUsage.mock.calls[0][0] as StudentUsageScope;
          expect(Number.isNaN(scope.since.getTime())).toBe(false);
          expect(scope.since.getTime()).toBe(NOW.getTime() - expected * DAY_MS);
        }
      });

      it('excludes activity older than the window', async () => {
        const world = baseWorld({
          conversations: [
            convo('agent_alpha', bobId, 1, '2026-07-27T10:00:00.000Z'),
            convo('agent_alpha', bobId, 99, '2025-01-01T10:00:00.000Z'),
          ],
        });
        const deps = createDeps(world);
        const handlers = createAdminUsageHandlers(deps);
        const { req, res, json } = createReqRes({ params, query: { days: '7' } });

        await handlers.listAgentStudentUsage(req, res);

        const row = studentBody(json).students.find((s) => s.userId === bobId.toString());
        expect(row?.conversationCount).toBe(1);
        expect(row?.messageCount).toBe(1);
      });

      it('still lists a student whose user record no longer resolves', async () => {
        const ghostId = new Types.ObjectId();
        const world = baseWorld({
          users: [bob],
          groups: [mockGroup({ memberIds: [bobId.toString(), ghostId.toString()] })],
          conversations: [convo('agent_alpha', ghostId, 3, '2026-07-20T10:00:00.000Z')],
        });
        const deps = createDeps(world);
        const handlers = createAdminUsageHandlers(deps);
        const { req, res, status, json } = createReqRes({
          params,
          query: { groupId: groupId.toString() },
        });

        await handlers.listAgentStudentUsage(req, res);

        expect(status).toHaveBeenCalledWith(200);
        const ghost = studentBody(json).students.find((s) => s.userId === ghostId.toString());
        expect(ghost).toBeDefined();
        expect(typeof ghost?.name).toBe('string');
        expect(typeof ghost?.email).toBe('string');
        expect(ghost?.conversationCount).toBe(1);
        expect(ghost?.messageCount).toBe(3);
      });
    });

    describe('error handling', () => {
      const leaky = new Error('ECONNREFUSED mongodb://root:pa55w0rd@10.0.0.7:27017/LibreChat');

      it.each<[string, () => DepOverrides]>([
        ['findAgents', () => ({ findAgents: jest.fn().mockRejectedValue(leaky) })],
        [
          'aggregateStudentUsage',
          () => ({ aggregateStudentUsage: jest.fn().mockRejectedValue(leaky) }),
        ],
        ['findUsers', () => ({ findUsers: jest.fn().mockRejectedValue(leaky) })],
      ])('returns 500 without leaking internals when %s rejects', async (_name, makeOverride) => {
        const world = baseWorld({
          conversations: [convo('agent_alpha', bobId, 3, '2026-07-20T10:00:00.000Z')],
        });
        const deps = createDeps(world, makeOverride());
        const handlers = createAdminUsageHandlers(deps);
        const { req, res, status, json } = createReqRes({ params });

        await handlers.listAgentStudentUsage(req, res);

        expect(status).toHaveBeenCalledWith(500);
        const body = errorBody(json);
        expect(typeof body.error).toBe('string');
        expect(body).not.toHaveProperty('stack');
        expect(JSON.stringify(body)).not.toContain('pa55w0rd');
        expect(JSON.stringify(body)).not.toContain('ECONNREFUSED');
      });

      it('returns 500 when the group lookup rejects', async () => {
        const deps = createDeps(baseWorld(), {
          findGroupById: jest.fn().mockRejectedValue(leaky),
        });
        const handlers = createAdminUsageHandlers(deps);
        const { req, res, status, json } = createReqRes({
          params,
          query: { groupId: groupId.toString() },
        });

        await handlers.listAgentStudentUsage(req, res);

        expect(status).toHaveBeenCalledWith(500);
        expect(JSON.stringify(errorBody(json))).not.toContain('pa55w0rd');
      });
    });
  });

  /* ================================================================ *
   * Federated rosters.
   *
   * Every GiesChat user signs in through Illinois SSO, so `memberIds`
   * holds `idOnTheSource` (an Entra GUID) while conversations key on the
   * mongo `_id`. Treating a memberId as a user id therefore matches zero
   * activity and resolves zero names — a silently blank roster rather
   * than an error, which is the worse failure for a professor.
   * ================================================================ */

  describe('federated (SSO) group rosters', () => {
    const params = { agent_id: 'agent_alpha' };
    const federatedGroupId = new Types.ObjectId();

    const samGuid = '6f1b1e2a-1111-4000-8000-0000000000aa';
    const kimGuid = '6f1b1e2a-1111-4000-8000-0000000000bb';
    const unknownGuid = '6f1b1e2a-1111-4000-8000-0000000000ff';

    const samId = new Types.ObjectId();
    const kimId = new Types.ObjectId();

    const sam = mockUser({
      _id: samId,
      name: 'Sam Federated',
      email: 'sam@illinois.edu',
      idOnTheSource: samGuid,
    });
    const kim = mockUser({
      _id: kimId,
      name: 'Kim Federated',
      email: 'kim@illinois.edu',
      idOnTheSource: kimGuid,
    });

    function federatedWorld(
      memberIds: string[],
      conversations: ConversationFixture[] = [],
      users: IUser[] = [sam, kim, zed],
    ): WorldFixture {
      return baseWorld({
        users,
        groups: [mockGroup({ _id: federatedGroupId, memberIds })],
        conversations,
      });
    }

    const query = { groupId: federatedGroupId.toString() };

    it('resolves GUID members to their user ids before aggregating student usage', async () => {
      const deps = createDeps(
        federatedWorld(
          [samGuid, kimGuid],
          [convo('agent_alpha', samId, 5, '2026-07-20T10:00:00Z')],
        ),
      );
      const handlers = createAdminUsageHandlers(deps);
      const { req, res } = createReqRes({ params, query });

      await handlers.listAgentStudentUsage(req, res);

      const scope = deps.aggregateStudentUsage.mock.calls[0][0] as StudentUsageScope;
      expect(scope.userIds).toEqual(expect.arrayContaining([samId.toString(), kimId.toString()]));
      expect(scope.userIds).toHaveLength(2);
      expect(scope.userIds).not.toContain(samGuid);
      expect(scope.userIds).not.toContain(kimGuid);
    });

    it('returns real names, emails and counts for a GUID roster', async () => {
      const deps = createDeps(
        federatedWorld(
          [samGuid, kimGuid],
          [
            convo('agent_alpha', samId, 5, '2026-07-20T10:00:00Z'),
            convo('agent_alpha', samId, 2, '2026-07-22T10:00:00Z'),
          ],
        ),
      );
      const handlers = createAdminUsageHandlers(deps);
      const { req, res, status, json } = createReqRes({ params, query });

      await handlers.listAgentStudentUsage(req, res);

      expect(status).toHaveBeenCalledWith(200);
      const { students } = studentBody(json);
      expect(students).toHaveLength(2);

      const active = students.find((s) => s.userId === samId.toString());
      expect(active?.name).toBe('Sam Federated');
      expect(active?.email).toBe('sam@illinois.edu');
      expect(active?.conversationCount).toBe(2);
      expect(active?.messageCount).toBe(7);
      expect(active?.lastActivity).toBe('2026-07-22T10:00:00.000Z');

      const inactive = students.find((s) => s.userId === kimId.toString());
      expect(inactive?.name).toBe('Kim Federated');
      expect(inactive?.email).toBe('kim@illinois.edu');
      expect(inactive?.conversationCount).toBe(0);
    });

    it('does not report a whole GUID class as inactive on the agent view', async () => {
      const deps = createDeps(
        federatedWorld(
          [samGuid, kimGuid],
          [
            convo('agent_alpha', samId, 4, '2026-07-20T10:00:00Z'),
            convo('agent_alpha', kimId, 3, '2026-07-21T10:00:00Z'),
            convo('agent_alpha', zedId, 9, '2026-07-21T10:00:00Z'),
          ],
        ),
      );
      const handlers = createAdminUsageHandlers(deps);
      const { req, res, status, json } = createReqRes({ query });

      await handlers.listAgentUsage(req, res);

      expect(status).toHaveBeenCalledWith(200);
      const row = agentBody(json).agents.find((a) => a.agent_id === 'agent_alpha');
      expect(row?.conversationCount).toBe(2);
      expect(row?.userCount).toBe(2);
      expect(row?.messageCount).toBe(7);
    });

    it('resolves a roster that mixes GUIDs and raw ObjectIds', async () => {
      const deps = createDeps(
        federatedWorld(
          [samGuid, bobId.toString()],
          [convo('agent_alpha', bobId, 6, '2026-07-20T10:00:00Z')],
          [sam, bob, zed],
        ),
      );
      const handlers = createAdminUsageHandlers(deps);
      const { req, res, status, json } = createReqRes({ params, query });

      await handlers.listAgentStudentUsage(req, res);

      expect(status).toHaveBeenCalledWith(200);
      const { students } = studentBody(json);
      expect(students.map((s) => s.name).sort()).toEqual(['Bob Member', 'Sam Federated']);
      const bobRow = students.find((s) => s.userId === bobId.toString());
      expect(bobRow?.email).toBe('bob@illinois.edu');
      expect(bobRow?.conversationCount).toBe(1);
      expect(bobRow?.messageCount).toBe(6);
    });

    it('does not collapse two member ids that name the same user into two rows', async () => {
      const deps = createDeps(
        federatedWorld(
          [samGuid, samId.toString()],
          [convo('agent_alpha', samId, 3, '2026-07-20T10:00:00Z')],
        ),
      );
      const handlers = createAdminUsageHandlers(deps);
      const { req, res, json } = createReqRes({ params, query });

      await handlers.listAgentStudentUsage(req, res);

      const { students } = studentBody(json);
      expect(students).toHaveLength(1);
      expect(students[0].userId).toBe(samId.toString());
      expect(students[0].conversationCount).toBe(1);
    });

    it('still lists a member GUID that resolves to no user', async () => {
      const deps = createDeps(federatedWorld([samGuid, unknownGuid]));
      const handlers = createAdminUsageHandlers(deps);
      const { req, res, status, json } = createReqRes({ params, query });

      await handlers.listAgentStudentUsage(req, res);

      expect(status).toHaveBeenCalledWith(200);
      const { students } = studentBody(json);
      expect(students).toHaveLength(2);
      const orphan = students.find((s) => s.userId === unknownGuid);
      expect(orphan).toBeDefined();
      expect(orphan?.name).toBe('');
      expect(orphan?.conversationCount).toBe(0);
    });

    it('reads the roster once, not once per handler stage', async () => {
      const deps = createDeps(
        federatedWorld(
          [samGuid, kimGuid],
          [convo('agent_alpha', samId, 1, '2026-07-20T10:00:00Z')],
        ),
      );
      const handlers = createAdminUsageHandlers(deps);
      const { req, res } = createReqRes({ params, query });

      await handlers.listAgentStudentUsage(req, res);

      expect(deps.findUsers).toHaveBeenCalledTimes(1);
    });

    it('never reads the roster for an empty group', async () => {
      const deps = createDeps(federatedWorld([]));
      const handlers = createAdminUsageHandlers(deps);
      const { req, res, status, json } = createReqRes({ params, query });

      await handlers.listAgentStudentUsage(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(studentBody(json).students).toEqual([]);
      expect(deps.findUsers).not.toHaveBeenCalled();
    });
  });
  /* ================================================================ *
   * listAgentAnalytics
   * ================================================================ */

  describe('listAgentAnalytics', () => {
    const populatedRaw: AgentAnalyticsRaw = {
      conversationCount: 10,
      activeStudents: 4,
      returningStudents: 3,
      assistantMessageCount: 100,
      erroredMessageCount: 5,
      turnDistribution: [
        { turns: 1, conversations: 2 },
        { turns: 4, conversations: 8 },
      ],
      studentDistribution: [
        { conversations: 1, students: 1 },
        { conversations: 3, students: 3 },
      ],
      daily: [{ date: '2026-07-28', conversations: 10 }],
    };

    it('shapes raw distributions into the dashboard response', async () => {
      const deps = createDeps(baseWorld(), {
        aggregateAgentAnalytics: jest.fn(async () => populatedRaw),
      });
      const handlers = createAdminUsageHandlers(deps);
      const { req, res, status, json } = createReqRes({ query: { days: '7' } });

      await handlers.listAgentAnalytics(req, res);

      expect(status).toHaveBeenCalledWith(200);
      const body = analyticsBody(json);
      expect(body.conversationCount).toBe(10);
      expect(body.activeStudents).toBe(4);
      expect(body.medianTurns).toBe(4);
      expect(body.returnRate).toBeCloseTo(0.75);
      expect(body.oneTurnShare).toBeCloseTo(0.2);
      expect(body.errorRate).toBeCloseTo(0.05);
      expect(body.depthBuckets).toEqual([
        { label: '1', count: 2 },
        { label: '2', count: 0 },
        { label: '3', count: 0 },
        { label: '4\u20135', count: 8 },
        { label: '6\u20139', count: 0 },
        { label: '10+', count: 0 },
      ]);
      expect(body.reachBuckets).toEqual([
        { label: '1', count: 1 },
        { label: '2\u20134', count: 3 },
        { label: '5\u20139', count: 0 },
        { label: '10+', count: 0 },
      ]);
    });

    it('zero-fills every day of the window, inclusive of both ends', async () => {
      const deps = createDeps(baseWorld(), {
        aggregateAgentAnalytics: jest.fn(async () => populatedRaw),
      });
      const handlers = createAdminUsageHandlers(deps);
      const { req, res, json } = createReqRes({ query: { days: '7' } });

      await handlers.listAgentAnalytics(req, res);

      const { dailyActivity } = analyticsBody(json);
      expect(dailyActivity).toHaveLength(8);
      expect(dailyActivity[dailyActivity.length - 1]).toEqual({
        date: '2026-07-28',
        conversationCount: 10,
      });
      expect(dailyActivity[0]).toEqual({ date: '2026-07-21', conversationCount: 0 });
    });

    it('reports enrolled size from the class roster', async () => {
      const deps = createDeps(baseWorld(), {
        aggregateAgentAnalytics: jest.fn(async () => ({
          ...EMPTY_ANALYTICS_RAW,
          conversationCount: 1,
          activeStudents: 1,
          assistantMessageCount: 2,
          turnDistribution: [{ turns: 1, conversations: 1 }],
          studentDistribution: [{ conversations: 1, students: 1 }],
        })),
      });
      const handlers = createAdminUsageHandlers(deps);
      const { req, res, status, json } = createReqRes({
        query: { groupId: groupId.toString(), days: '30' },
      });

      await handlers.listAgentAnalytics(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(analyticsBody(json).enrolledStudents).toBe(2);
      expect(analyticsBody(json).activeStudents).toBe(1);
    });

    it('falls back to the active count for enrolled when no class is selected', async () => {
      const deps = createDeps(baseWorld(), {
        aggregateAgentAnalytics: jest.fn(async () => populatedRaw),
      });
      const handlers = createAdminUsageHandlers(deps);
      const { req, res, json } = createReqRes();

      await handlers.listAgentAnalytics(req, res);

      expect(analyticsBody(json).enrolledStudents).toBe(4);
    });

    it('returns zeros rather than NaN when nothing happened', async () => {
      const deps = createDeps(baseWorld());
      const handlers = createAdminUsageHandlers(deps);
      const { req, res, status, json } = createReqRes();

      await handlers.listAgentAnalytics(req, res);

      expect(status).toHaveBeenCalledWith(200);
      const body = analyticsBody(json);
      expect(body.returnRate).toBe(0);
      expect(body.errorRate).toBe(0);
      expect(body.oneTurnShare).toBe(0);
      expect(body.medianTurns).toBe(0);
    });

    it('never aggregates agents outside the caller scope', async () => {
      const deps = createDeps(baseWorld());
      const handlers = createAdminUsageHandlers(deps);
      const { req, res } = createReqRes();

      await handlers.listAgentAnalytics(req, res);

      const scope = deps.aggregateAgentAnalytics.mock.calls[0][0] as { agentIds: string[] };
      expect(scope.agentIds).not.toContain('agent_gamma');
      expect([...scope.agentIds].sort()).toEqual(['agent_alpha', 'agent_beta', 'agent_delta']);
    });

    it('404s an unknown group without touching the aggregation', async () => {
      const deps = createDeps(baseWorld());
      const handlers = createAdminUsageHandlers(deps);
      const { req, res, status } = createReqRes({
        query: { groupId: new Types.ObjectId().toString() },
      });

      await handlers.listAgentAnalytics(req, res);

      expect(status).toHaveBeenCalledWith(404);
      expect(deps.aggregateAgentAnalytics).not.toHaveBeenCalled();
    });

    it('401s an unauthenticated caller', async () => {
      const deps = createDeps(baseWorld());
      const handlers = createAdminUsageHandlers(deps);
      const { req, res, status } = createReqRes({ user: undefined });

      await handlers.listAgentAnalytics(req, res);

      expect(status).toHaveBeenCalledWith(401);
    });

    it('400s a non-string groupId', async () => {
      const deps = createDeps(baseWorld());
      const handlers = createAdminUsageHandlers(deps);
      const { req, res, status } = createReqRes({
        query: { groupId: ['a', 'b'] as unknown as string },
      });

      await handlers.listAgentAnalytics(req, res);

      expect(status).toHaveBeenCalledWith(400);
    });

    it('500s when the aggregation throws, without leaking the error', async () => {
      const deps = createDeps(baseWorld(), {
        aggregateAgentAnalytics: jest.fn(async () => {
          throw new Error('pipeline exploded');
        }),
      });
      const handlers = createAdminUsageHandlers(deps);
      const { req, res, status, json } = createReqRes();

      await handlers.listAgentAnalytics(req, res);

      expect(status).toHaveBeenCalledWith(500);
      expect(errorBody(json).error).toBe('Failed to load analytics');
      expect(JSON.stringify(errorBody(json))).not.toContain('pipeline exploded');
    });
  });

  /* ================================================================ *
   * dashboard layout
   * ================================================================ */

  describe('dashboard layout', () => {
    it('returns an empty layout for a professor who has never customized', async () => {
      const deps = createDeps(baseWorld());
      const handlers = createAdminUsageHandlers(deps);
      const { req, res, status, json } = createReqRes();

      await handlers.getDashboardLayout(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith({ panels: [] });
    });

    it('returns the stored layout, dropping ids this build no longer knows', async () => {
      const deps = createDeps(baseWorld());
      const handlers = createAdminUsageHandlers(deps);
      const { req, res, json } = createReqRes({
        user: mockUser({
          _id: callerId,
          role: 'ADMIN',
          dashboardPanels: [
            { id: 'signals', visible: false },
            { id: 'retired-panel', visible: true },
          ],
        }),
      });

      await handlers.getDashboardLayout(req, res);

      expect(json).toHaveBeenCalledWith({ panels: [{ id: 'signals', visible: false }] });
    });

    it('rejects a body whose panels is not an array', async () => {
      const deps = createDeps(baseWorld());
      const handlers = createAdminUsageHandlers(deps);
      const { req, res, status } = createReqRes({ body: { panels: 'kpi' } });

      await handlers.updateDashboardLayout(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(deps.updateUser).not.toHaveBeenCalled();
    });

    it('saves a sanitized layout to the caller and nobody else', async () => {
      const deps = createDeps(baseWorld());
      const handlers = createAdminUsageHandlers(deps);
      const { req, res, status } = createReqRes({
        body: {
          userId: otherAuthorId.toString(),
          panels: [
            { id: 'depth', visible: false },
            { id: 'bogus', visible: true },
            { id: 'depth', visible: true },
          ],
        },
      });

      await handlers.updateDashboardLayout(req, res);

      expect(deps.updateUser).toHaveBeenCalledTimes(1);
      expect(deps.updateUser).toHaveBeenCalledWith(callerId.toString(), {
        dashboardPanels: [{ id: 'depth', visible: false }],
      });
      expect(status).toHaveBeenCalledWith(200);
    });

    it('answers 401 when there is no authenticated caller', async () => {
      const deps = createDeps(baseWorld());
      const handlers = createAdminUsageHandlers(deps);
      const { req, res, status } = createReqRes({ user: undefined, body: { panels: [] } });

      await handlers.updateDashboardLayout(req, res);

      expect(status).toHaveBeenCalledWith(401);
      expect(deps.updateUser).not.toHaveBeenCalled();
    });

    it('answers 500 when the write fails', async () => {
      const deps = createDeps(baseWorld(), {
        updateUser: jest.fn(async () => {
          throw new Error('mongo down');
        }),
      });
      const handlers = createAdminUsageHandlers(deps);
      const { req, res, status } = createReqRes({ body: { panels: [] } });

      await handlers.updateDashboardLayout(req, res);

      expect(status).toHaveBeenCalledWith(500);
    });
  });
});
