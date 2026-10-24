import type { Response } from 'express';
import type { IUser } from '@librechat/data-schemas';
import type { AgentKeyAuthDeps, AgentKeyRequest } from './agentKeyAuth';
import {
  createAgentKeyAuth,
  createAgentKeyModel,
  resolveAllowedModels,
  agentKeyModelList,
} from './agentKeyAuth';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const AUDIENCE = '11111111-2222-3333-4444-555555555555';
const student = {
  _id: 'u1',
  email: 'sam@illinois.edu',
  idOnTheSource: 'oid-1',
} as unknown as IUser;

function makeDeps(overrides: Partial<AgentKeyAuthDeps> = {}): AgentKeyAuthDeps {
  return {
    validateAgentApiKey: jest.fn().mockResolvedValue({
      userId: 'prof',
      keyId: 'key-1',
      name: 'BADM 350 site',
      agentId: 'agent_a',
      audience: AUDIENCE,
    }),
    getAgent: jest
      .fn()
      .mockResolvedValue({ _id: 'db-a', id: 'agent_a', author: 'prof', createdVia: 'dashboard' }),
    verifyUserToken: jest
      .fn()
      .mockResolvedValue({ oid: 'oid-1', email: 'sam@illinois.edu', name: 'Sam' }),
    findUser: jest.fn(async (filter: Record<string, unknown>) =>
      filter.idOnTheSource === 'oid-1' ? ({ ...student } as IUser) : null,
    ),
    createUser: jest.fn(async (data: Partial<IUser>) => ({ _id: 'new', ...data }) as IUser),
    canViewAgent: jest.fn().mockResolvedValue(false),
    grantAgentView: jest.fn().mockResolvedValue(undefined),
    openidIssuer: 'https://login.microsoftonline.com/tenant/v2.0',
    ...overrides,
  };
}

function makeReq(body: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return {
    headers: {
      authorization: 'Bearer sk-abc',
      'x-gieschat-user-token': 'id-token',
      ...headers,
    },
    body,
  } as unknown as AgentKeyRequest;
}

function makeRes() {
  const res = { status: jest.fn(), json: jest.fn() } as unknown as Response & {
    status: jest.Mock;
    json: jest.Mock;
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

const errorCode = (res: ReturnType<typeof makeRes>) => res.json.mock.calls[0][0].error.code;

describe('createAgentKeyAuth', () => {
  it('leaves requests without a bearer key to upstream auth', async () => {
    const next = jest.fn();
    const req = makeReq({}, { authorization: '' });
    await createAgentKeyAuth(makeDeps())(req, makeRes(), next);
    expect(next).toHaveBeenCalled();
    expect(req.agentKey).toBeUndefined();
  });

  it('leaves upstream per-user keys to upstream auth', async () => {
    const deps = makeDeps({
      validateAgentApiKey: jest.fn().mockResolvedValue({ userId: 'u', keyId: 'k', name: 'mine' }),
    });
    const next = jest.fn();
    const req = makeReq();
    await createAgentKeyAuth(deps)(req, makeRes(), next);
    expect(next).toHaveBeenCalled();
    expect(req.agentKey).toBeUndefined();
  });

  it('runs as the student, on the key agent, granting VIEW', async () => {
    const deps = makeDeps();
    const next = jest.fn();
    const req = makeReq({ model: 'gpt-6.1-sol', input: 'hi' });
    await createAgentKeyAuth(deps)(req, makeRes(), next);
    expect(next).toHaveBeenCalled();
    expect(req.user?.id).toBe('u1');
    expect(req.body.model).toBe('agent_a');
    expect(req.agentKey).toMatchObject({
      id: 'key-1',
      name: 'BADM 350 site',
      agentId: 'agent_a',
      requestedModel: 'gpt-6.1-sol',
      model: null,
    });
    expect(deps.verifyUserToken).toHaveBeenCalledWith('id-token', AUDIENCE);
    expect(deps.grantAgentView).toHaveBeenCalledWith({
      userId: 'u1',
      agentDbId: 'db-a',
      grantedBy: 'prof',
    });
  });

  it('never rewrites the grant of someone who can already open the agent', async () => {
    /** The professor testing their own site: an upsert to VIEW would demote their OWNER entry. */
    const deps = makeDeps({ canViewAgent: jest.fn().mockResolvedValue(true) });
    const next = jest.fn();
    await createAgentKeyAuth(deps)(makeReq(), makeRes(), next);
    expect(next).toHaveBeenCalled();
    expect(deps.canViewAgent).toHaveBeenCalledWith({
      userId: 'u1',
      role: undefined,
      agentDbId: 'db-a',
    });
    expect(deps.grantAgentView).not.toHaveBeenCalled();
  });

  it('drops caller fields that would prime skills or reconfigure the agent', async () => {
    const req = makeReq({
      input: 'hi',
      manualSkills: ['read-my-mail'],
      ephemeralAgent: { skills: true, mcp: ['ms365-outlook'] },
    });
    await createAgentKeyAuth(makeDeps())(req, makeRes(), jest.fn());
    expect(req.body).toEqual({ input: 'hi', model: 'agent_a' });
  });

  it("treats the key agent id in `model` as the agent's own model", async () => {
    const req = makeReq({ model: 'agent_a' });
    await createAgentKeyAuth(makeDeps())(req, makeRes(), jest.fn());
    expect(req.agentKey?.requestedModel).toBeNull();
  });

  it('refuses another agent', async () => {
    const res = makeRes();
    await createAgentKeyAuth(makeDeps())(makeReq({ model: 'agent_other' }), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
    expect(errorCode(res)).toBe('key_wrong_agent');
  });

  it('refuses a deleted or non-dashboard agent', async () => {
    const res = makeRes();
    const deps = makeDeps({ getAgent: jest.fn().mockResolvedValue(null) });
    await createAgentKeyAuth(deps)(makeReq(), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(401);
    expect(errorCode(res)).toBe('invalid_api_key');
  });

  it.each([
    ['missing', makeReq({}, { 'x-gieschat-user-token': '' }), makeDeps()],
    [
      'invalid',
      makeReq(),
      makeDeps({ verifyUserToken: jest.fn().mockRejectedValue(new Error('jwt audience invalid')) }),
    ],
    [
      'oid-less',
      makeReq(),
      makeDeps({ verifyUserToken: jest.fn().mockResolvedValue({ email: 'x@illinois.edu' }) }),
    ],
  ])('refuses a %s student token', async (_label, req, deps) => {
    const res = makeRes();
    await createAgentKeyAuth(deps)(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(401);
    expect(errorCode(res)).toBe('invalid_user_token');
  });

  it('creates a first-timer the way a first SSO login would, without openidId', async () => {
    const deps = makeDeps({ findUser: jest.fn().mockResolvedValue(null) });
    const req = makeReq();
    await createAgentKeyAuth(deps)(req, makeRes(), jest.fn());
    const created = (deps.createUser as jest.Mock).mock.calls[0][0];
    expect(created).toMatchObject({
      provider: 'openid',
      email: 'sam@illinois.edu',
      idOnTheSource: 'oid-1',
      openidIssuer: 'https://login.microsoftonline.com/tenant/v2.0',
      emailVerified: true,
    });
    expect(created.openidId).toBeUndefined();
    expect(req.user?.id).toBe('new');
  });

  it('never merges two directory objects that share an email', async () => {
    const deps = makeDeps({
      findUser: jest.fn(async (filter: Record<string, unknown>) =>
        filter.email ? ({ _id: 'other', idOnTheSource: 'oid-2' } as unknown as IUser) : null,
      ),
    });
    const res = makeRes();
    await createAgentKeyAuth(deps)(makeReq(), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(401);
    expect(deps.createUser).not.toHaveBeenCalled();
  });

  it('never attaches a student to a password account that registered their address', async () => {
    const deps = makeDeps({
      findUser: jest.fn(async (filter: Record<string, unknown>) =>
        filter.email ? ({ _id: 'squatter', provider: 'local' } as unknown as IUser) : null,
      ),
    });
    const res = makeRes();
    await createAgentKeyAuth(deps)(makeReq(), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(401);
    expect(deps.createUser).not.toHaveBeenCalled();
  });

  it('applies the same rule when a racing create finds the address taken', async () => {
    let created = false;
    const deps = makeDeps({
      findUser: jest.fn(async (filter: Record<string, unknown>) =>
        created && filter.email
          ? ({ _id: 'squatter', provider: 'local' } as unknown as IUser)
          : null,
      ),
      createUser: jest.fn(async () => {
        created = true;
        throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
      }),
    });
    const res = makeRes();
    await createAgentKeyAuth(deps)(makeReq(), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('survives two first requests racing to create the same student', async () => {
    let created = false;
    const deps = makeDeps({
      findUser: jest.fn(async (filter: Record<string, unknown>) =>
        created && filter.email
          ? ({ _id: 'raced', provider: 'openid', idOnTheSource: 'oid-1' } as unknown as IUser)
          : null,
      ),
      createUser: jest.fn(async () => {
        created = true;
        throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
      }),
    });
    const req = makeReq();
    const next = jest.fn();
    await createAgentKeyAuth(deps)(req, makeRes(), next);
    expect(next).toHaveBeenCalled();
    expect(req.user?.id).toBe('raced');
  });
});

describe('createAgentKeyModel', () => {
  const modelsConfig = {
    'Azure OpenAI': ['gpt-6-luna', 'gpt-6.1-sol', 'gpt-5.5'],
    anthropic: ['claude-sonnet-5-5', 'claude-opus-4-8'],
    openAI: ['gpt-4o'],
  };
  const getModelsConfig = jest.fn().mockResolvedValue(modelsConfig);
  const config = { endpoints: { agents: { allowedProviders: ['Azure OpenAI', 'anthropic'] } } };

  it('lists agent-builder models without retired ones or other providers', () => {
    expect(resolveAllowedModels(modelsConfig, ['Azure OpenAI', 'anthropic'])).toEqual([
      { model: 'gpt-6-luna', provider: 'Azure OpenAI' },
      { model: 'gpt-6.1-sol', provider: 'Azure OpenAI' },
      { model: 'claude-sonnet-5-5', provider: 'anthropic' },
    ]);
  });

  it('resolves an allowed model and 404s a retired one', async () => {
    const ok = {
      agentKey: { requestedModel: 'claude-sonnet-5-5' },
      config,
    } as unknown as AgentKeyRequest;
    const next = jest.fn();
    await createAgentKeyModel({ getModelsConfig })(ok, makeRes(), next);
    expect(next).toHaveBeenCalled();
    expect(ok.agentKey?.model).toEqual({ model: 'claude-sonnet-5-5', provider: 'anthropic' });
    expect(agentKeyModelList(ok.agentKey!).data.map((entry) => entry.id)).toContain('gpt-6-luna');

    const retired = {
      agentKey: { requestedModel: 'claude-opus-4-8' },
      config,
    } as unknown as AgentKeyRequest;
    const res = makeRes();
    await createAgentKeyModel({ getModelsConfig })(retired, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);
    expect(errorCode(res)).toBe('model_not_found');
  });

  it('does nothing for requests that are not agent-key requests', async () => {
    const next = jest.fn();
    await createAgentKeyModel({ getModelsConfig })(
      { config } as unknown as AgentKeyRequest,
      makeRes(),
      next,
    );
    expect(next).toHaveBeenCalled();
  });
});
