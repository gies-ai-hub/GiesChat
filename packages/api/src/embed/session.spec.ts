import jwt from 'jsonwebtoken';
import type { Request, Response } from 'express';
import type { IAgent, IUser } from '@librechat/data-schemas';
import type { EmbedSessionDeps } from './session';
import { createEmbedSessionHandler } from './session';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const SECRET = 'embed-test-secret';
const author = {
  _id: 'author1',
  provider: 'openid',
  role: 'USER',
  name: 'Prof',
} as unknown as IUser;
const agent = {
  _id: 'agentdb1',
  id: 'agent_x',
  name: 'ACCY 502A',
  author: 'author1',
  embed: { key: 'k1', audience: 'illinois' },
} as unknown as IAgent;

function makeDeps(canView: boolean): EmbedSessionDeps {
  return {
    getAgentByEmbedKey: jest.fn(async () => agent),
    getUserById: jest.fn(async () => author),
    createUser: jest.fn(),
    generateToken: jest.fn(async () => 'token'),
    getBalanceConfig: jest.fn(async () => undefined),
    canViewAgent: jest.fn(async () => canView),
    grantAgentView: jest.fn(async () => undefined),
  };
}

const makeReq = () =>
  ({
    params: { key: 'k1' },
    headers: { authorization: `Bearer ${jwt.sign({ id: 'author1' }, SECRET)}` },
  }) as unknown as Request;

function makeRes() {
  const res = { status: jest.fn(), json: jest.fn() } as unknown as Response & {
    status: jest.Mock;
    json: jest.Mock;
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

describe('startEmbedSession — Illinois sign-in', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = SECRET;
  });

  it('leaves an owner’s rights alone when they open their own embed link', async () => {
    const deps = makeDeps(true);
    const res = makeRes();
    await createEmbedSessionHandler(deps)(makeReq(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(deps.grantAgentView).not.toHaveBeenCalled();
  });

  it('grants view to a student who cannot open the agent yet', async () => {
    const deps = makeDeps(false);
    const res = makeRes();
    await createEmbedSessionHandler(deps)(makeReq(), res);
    expect(deps.grantAgentView).toHaveBeenCalledWith({
      userId: 'author1',
      agentId: 'agentdb1',
      grantedBy: 'author1',
    });
  });
});
