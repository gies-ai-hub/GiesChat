const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { createModels } = require('@librechat/data-schemas');
const { PrincipalType, PrincipalModel, ResourceType } = require('librechat-data-provider');

/**
 * Seam test for the admin usage routes.
 *
 * Every dependency `usage.js` injects is exercised through the REAL module —
 * real `~/models` methods, the real `PermissionService` wrapper, real MongoDB.
 * Substituting `jest.fn()` fakes here is precisely what let the wrong
 * `findAccessibleResources` (positional db method vs. object-form service) ship
 * green: the handler calls it with `{ userId, role, ... }`, so the db method
 * blows up on `principalsList.map` and the handler's `try` turns it into a 500.
 *
 * Only auth/capability middleware is stubbed, because a real JWT and real
 * capability grants are orthogonal to the wiring being verified.
 */

jest.mock('~/server/middleware', () => ({
  requireJwtAuth: (_req, _res, next) => next(),
}));

/** Capabilities the caller lacks; empty means every check passes. */
const mockDenied = new Set();
jest.mock('~/server/middleware/roles/capabilities', () => ({
  requireCapability: (capability) => (_req, res, next) =>
    mockDenied.has(capability) ? res.status(403).json({ message: 'Forbidden' }) : next(),
}));

let mongoServer;
let db;
let caller;
let colleague;
let sharedAgent;
let classGroup;

const STUDENT_GUID = 'e2b9c1a4-1111-4000-8000-0000000000a1';

async function seedWorld() {
  const { User, Group, Agent, AclEntry, Conversation, Message } = mongoose.models;

  caller = await User.create({
    name: 'Professor Caller',
    email: 'prof@illinois.edu',
    provider: 'openid',
    role: 'ADMIN',
    idOnTheSource: 'e2b9c1a4-1111-4000-8000-0000000000c0',
  });
  colleague = await User.create({
    name: 'Professor Colleague',
    email: 'colleague@illinois.edu',
    provider: 'openid',
    role: 'ADMIN',
  });
  const student = await User.create({
    name: 'Sam Student',
    email: 'sam@illinois.edu',
    provider: 'openid',
    role: 'USER',
    idOnTheSource: STUDENT_GUID,
  });

  /** The professor reaches `sharedAgent` only through this group's ACL grant. */
  classGroup = await Group.create({
    name: 'BADM 350',
    source: 'local',
    memberIds: [STUDENT_GUID, caller.idOnTheSource],
  });

  await Agent.create({
    id: 'agent_owned',
    name: 'Owned Agent',
    author: caller._id,
    provider: 'anthropic',
    model: 'claude',
    createdVia: 'dashboard',
  });
  sharedAgent = await Agent.create({
    id: 'agent_shared',
    name: 'Shared Agent',
    author: colleague._id,
    provider: 'anthropic',
    model: 'claude',
    createdVia: 'dashboard',
  });

  await AclEntry.create({
    principalType: PrincipalType.GROUP,
    principalId: classGroup._id,
    principalModel: PrincipalModel.GROUP,
    resourceType: ResourceType.AGENT,
    resourceId: sharedAgent._id,
    permBits: 3,
    grantedBy: colleague._id,
  });

  await Conversation.collection.insertMany([
    {
      conversationId: 'convo-1',
      user: student._id.toString(),
      agent_id: 'agent_shared',
      isTemporary: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]);
  await Message.collection.insertMany([
    {
      messageId: 'msg-1',
      conversationId: 'convo-1',
      user: student._id.toString(),
      isCreatedByUser: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      messageId: 'msg-2',
      conversationId: 'convo-1',
      user: student._id.toString(),
      isCreatedByUser: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]);

  return student;
}

let student;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  db = require('~/models');
  student = await seedWorld();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = caller;
    next();
  });
  app.use('/api/admin/usage', require('~/server/routes/admin/usage'));
  return app;
}

describe('admin usage routes — real dependency wiring', () => {
  it('exposes every injected dependency under the name the route uses', () => {
    const { findAccessibleResources } = require('~/server/services/PermissionService');

    expect(typeof db.getAgents).toBe('function');
    expect(typeof db.findGroupById).toBe('function');
    expect(typeof db.findUsers).toBe('function');
    expect(typeof db.aggregateAgentUsage).toBe('function');
    expect(typeof db.aggregateStudentUsage).toBe('function');
    expect(typeof findAccessibleResources).toBe('function');
  });

  /**
   * The db-level `findAccessibleResources` takes `(principalsList, resourceType,
   * requiredPermBit)`; the handler passes a single object. Calling the wrong one
   * throws `principalsList.map is not a function`, which the handler swallows
   * into a 500 — so this assertion is the difference between the two.
   */
  it('resolves accessible resources from the object-form call the handler makes', async () => {
    const { findAccessibleResources } = require('~/server/services/PermissionService');

    const ids = await findAccessibleResources({
      userId: caller._id.toString(),
      role: caller.role,
      resourceType: ResourceType.AGENT,
      requiredPermissions: 1,
    });

    expect(Array.isArray(ids)).toBe(true);
    expect(ids.map(String)).toContain(sharedAgent._id.toString());
  });

  it('rejects the positional db-method shape the route must not inject', async () => {
    await expect(
      db.findAccessibleResources(
        {
          userId: caller._id.toString(),
          role: caller.role,
          resourceType: ResourceType.AGENT,
          requiredPermissions: 1,
        },
        ResourceType.AGENT,
        1,
      ),
    ).rejects.toThrow();
  });

  it('answers 200 with the caller’s agents, not 500', async () => {
    const res = await request(createApp()).get('/api/admin/usage/agents');

    expect(res.status).toBe(200);
    const ids = res.body.agents.map((agent) => agent.agent_id).sort();
    expect(ids).toEqual(['agent_owned', 'agent_shared']);
  });

  it('keeps an agent shared through a group grant in the caller’s own dashboard', async () => {
    const res = await request(createApp()).get('/api/admin/usage/agents');

    expect(res.status).toBe(200);
    const shared = res.body.agents.find((agent) => agent.agent_id === 'agent_shared');
    expect(shared).toBeDefined();
    expect(shared.conversationCount).toBe(1);
    expect(shared.messageCount).toBe(2);
    expect(shared.userCount).toBe(1);
  });

  it('resolves a GUID roster to real students on the per-student route', async () => {
    const res = await request(createApp()).get(
      `/api/admin/usage/agents/agent_shared/students?groupId=${classGroup._id.toString()}`,
    );

    expect(res.status).toBe(200);
    const row = res.body.students.find((s) => s.userId === student._id.toString());
    expect(row).toBeDefined();
    expect(row.name).toBe('Sam Student');
    expect(row.email).toBe('sam@illinois.edu');
    expect(row.conversationCount).toBe(1);
    expect(row.messageCount).toBe(2);
  });

  it('scopes the agent view by a GUID roster without zeroing it out', async () => {
    const res = await request(createApp()).get(
      `/api/admin/usage/agents?groupId=${classGroup._id.toString()}`,
    );

    expect(res.status).toBe(200);
    const shared = res.body.agents.find((agent) => agent.agent_id === 'agent_shared');
    expect(shared.conversationCount).toBe(1);
    expect(shared.messageCount).toBe(2);
  });

  it('opens to a caller with no dashboard capabilities, except the class filter', async () => {
    ['access:admin', 'read:usage', 'read:groups'].forEach((cap) => mockDenied.add(cap));
    try {
      const own = await request(createApp()).get('/api/admin/usage/agents');
      expect(own.status).toBe(200);
      expect(own.body.agents.map((agent) => agent.agent_id).sort()).toEqual([
        'agent_owned',
        'agent_shared',
      ]);

      const roster = await request(createApp()).get(
        `/api/admin/usage/agents/agent_shared/students?groupId=${classGroup._id.toString()}`,
      );
      expect(roster.status).toBe(403);
    } finally {
      mockDenied.clear();
    }
  });

  it('answers 404 for a group that does not exist', async () => {
    const res = await request(createApp()).get(
      `/api/admin/usage/agents?groupId=${new mongoose.Types.ObjectId().toString()}`,
    );

    expect(res.status).toBe(404);
  });
});
