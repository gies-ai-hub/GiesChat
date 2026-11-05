import type { Response } from 'express';
import type { IAgent } from '@librechat/data-schemas';
import type { ServerRequest } from '~/types/http';
import type { AdminApiKeyDeps } from './apiKeys';
import { createAdminApiKeyHandlers } from './apiKeys';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const APP_ID = '11111111-2222-3333-4444-555555555555';
const KEY_ID = '64b7f0c2a1b2c3d4e5f60718';
const created = new Date('2026-10-24T12:00:00Z');

function makeDeps(managed = ['agent_a']): AdminApiKeyDeps {
  return {
    findAgents: jest.fn(async (filter: Record<string, unknown>) =>
      managed
        .filter((id) => filter.id === undefined || filter.id === id)
        .map((id) => ({ id }) as IAgent),
    ),
    createAgentApiKey: jest.fn(async (data) => ({
      id: KEY_ID,
      name: data.name,
      keyPrefix: 'sk-abcde',
      key: 'sk-abcdefsecret',
      createdAt: created,
      agentId: data.agentId,
      audience: data.audience,
    })),
    listAgentApiKeysForAgents: jest.fn(async () => [
      {
        id: KEY_ID,
        name: 'site',
        keyPrefix: 'sk-abcde',
        createdAt: created,
        agentId: 'agent_a',
        audience: APP_ID,
        requestCount: 3,
      },
    ]),
    deleteAgentApiKeyForAgents: jest.fn(async () => true),
    isAgentAdmin: jest.fn(async () => false),
  };
}

const makeReq = (extra: Record<string, unknown> = {}) =>
  ({
    user: { _id: 'prof' },
    params: {},
    query: {},
    body: {},
    ...extra,
  }) as unknown as ServerRequest;

function makeRes() {
  const res = { status: jest.fn(), json: jest.fn() } as unknown as Response & {
    status: jest.Mock;
    json: jest.Mock;
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

describe('admin API key handlers', () => {
  it('lists keys on agents the caller authors or co-runs', async () => {
    const deps = makeDeps();
    const res = makeRes();
    await createAdminApiKeyHandlers(deps).listApiKeys(makeReq(), res);
    expect((deps.findAgents as jest.Mock).mock.calls[0][0]).toMatchObject({
      createdVia: 'dashboard',
      $or: [{ author: 'prof' }, { coAdmins: 'prof' }],
    });
    expect(deps.listAgentApiKeysForAgents).toHaveBeenCalledWith(['agent_a']);
    expect(res.json.mock.calls[0][0].keys[0]).toMatchObject({
      id: KEY_ID,
      requestCount: 3,
      lastUsedAt: null,
      createdAt: created.toISOString(),
    });
  });

  it('lists every owner’s keys in the Admin view for a manage:agents holder, and 403s anyone else', async () => {
    const admin = makeDeps();
    admin.isAgentAdmin = jest.fn(async () => true);
    const res = makeRes();
    await createAdminApiKeyHandlers(admin).listApiKeys(makeReq({ query: { view: 'admin' } }), res);
    expect((admin.findAgents as jest.Mock).mock.calls[0][0]).not.toHaveProperty('$or');
    expect(res.status).toHaveBeenCalledWith(200);

    const professor = makeDeps();
    const refused = makeRes();
    await createAdminApiKeyHandlers(professor).listApiKeys(
      makeReq({ query: { view: 'admin' } }),
      refused,
    );
    expect(refused.status).toHaveBeenCalledWith(403);
    expect(professor.listAgentApiKeysForAgents).not.toHaveBeenCalled();
  });

  it('lets an admin create a key on any dashboard agent, by id', async () => {
    const deps = makeDeps();
    deps.isAgentAdmin = jest.fn(async () => true);
    const res = makeRes();
    await createAdminApiKeyHandlers(deps).createApiKey(
      makeReq({ params: { agent_id: 'agent_a' }, body: { name: 'site', audience: APP_ID } }),
      res,
    );
    expect((deps.findAgents as jest.Mock).mock.calls[0][0]).not.toHaveProperty('$or');
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it.each([
    [{ name: '', audience: APP_ID }, 'name'],
    [{ name: 'x'.repeat(101), audience: APP_ID }, 'name'],
    [{ name: 'site', audience: 'not-a-guid' }, 'audience'],
  ])('refuses %p', async (body, field) => {
    const res = makeRes();
    await createAdminApiKeyHandlers(makeDeps()).createApiKey(
      makeReq({ params: { agent_id: 'agent_a' }, body }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].field).toBe(field);
  });

  it('creates a key once, on a managed agent only', async () => {
    const deps = makeDeps();
    const res = makeRes();
    const body = { name: ' BADM 350 site ', audience: APP_ID.toUpperCase() };
    await createAdminApiKeyHandlers(deps).createApiKey(
      makeReq({ params: { agent_id: 'agent_a' }, body }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(deps.createAgentApiKey).toHaveBeenCalledWith({
      userId: 'prof',
      name: 'BADM 350 site',
      agentId: 'agent_a',
      audience: APP_ID,
    });
    expect(res.json.mock.calls[0][0]).toMatchObject({
      key: 'sk-abcdefsecret',
      apiKey: { agentId: 'agent_a', requestCount: 0 },
    });

    const other = makeRes();
    await createAdminApiKeyHandlers(deps).createApiKey(
      makeReq({ params: { agent_id: 'agent_x' }, body }),
      other,
    );
    expect(other.status).toHaveBeenCalledWith(404);
  });

  it('revokes within managed agents and 404s anything else', async () => {
    const deps = makeDeps();
    const res = makeRes();
    await createAdminApiKeyHandlers(deps).revokeApiKey(
      makeReq({ params: { key_id: KEY_ID } }),
      res,
    );
    expect(deps.deleteAgentApiKeyForAgents).toHaveBeenCalledWith(KEY_ID, ['agent_a']);
    expect(res.status).toHaveBeenCalledWith(200);

    const bad = makeRes();
    await createAdminApiKeyHandlers(deps).revokeApiKey(
      makeReq({ params: { key_id: 'nope' } }),
      bad,
    );
    expect(bad.status).toHaveBeenCalledWith(404);
    expect(deps.deleteAgentApiKeyForAgents).toHaveBeenCalledTimes(1);
  });
});
