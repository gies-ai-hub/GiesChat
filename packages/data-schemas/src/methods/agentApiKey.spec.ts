import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createAgentApiKeyMethods } from './agentApiKey';
import { createModels } from '../models';

let mongoServer: InstanceType<typeof MongoMemoryServer>;
let methods: ReturnType<typeof createAgentApiKeyMethods>;
const professor = new mongoose.Types.ObjectId();

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  methods = createAgentApiKeyMethods(mongoose);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await mongoose.models.AgentApiKey.deleteMany({});
});

describe('per-agent API keys', () => {
  it('validates to the agent scope and counts each use', async () => {
    const created = await methods.createAgentApiKey({
      userId: professor,
      name: 'BADM 350 site',
      agentId: 'agent_a',
      audience: '11111111-2222-3333-4444-555555555555',
    });
    const validation = await methods.validateAgentApiKey(created.key);
    expect(validation).toMatchObject({
      name: 'BADM 350 site',
      agentId: 'agent_a',
      audience: '11111111-2222-3333-4444-555555555555',
    });
    await methods.validateAgentApiKey(created.key);
    const [listed] = await methods.listAgentApiKeysForAgents(['agent_a']);
    expect(listed.requestCount).toBe(2);
    expect(listed.lastUsedAt).toBeInstanceOf(Date);
  });

  it('keeps per-agent keys out of the upstream per-user list', async () => {
    await methods.createAgentApiKey({ userId: professor, name: 'site', agentId: 'agent_a' });
    await methods.createAgentApiKey({ userId: professor, name: 'personal' });
    const upstream = await methods.listAgentApiKeys(professor);
    expect(upstream.map((key) => key.name)).toEqual(['personal']);
  });

  it('lists and deletes only within the given agents', async () => {
    const a = await methods.createAgentApiKey({ userId: professor, name: 'a', agentId: 'agent_a' });
    await methods.createAgentApiKey({ userId: professor, name: 'b', agentId: 'agent_b' });
    expect((await methods.listAgentApiKeysForAgents(['agent_a'])).map((k) => k.name)).toEqual([
      'a',
    ]);
    expect(await methods.listAgentApiKeysForAgents([])).toEqual([]);
    expect(await methods.deleteAgentApiKeyForAgents(a.id, ['agent_b'])).toBe(false);
    expect(await methods.deleteAgentApiKeyForAgents(a.id, ['agent_a'])).toBe(true);
    expect(await methods.validateAgentApiKey(a.key)).toBeNull();
  });
});
