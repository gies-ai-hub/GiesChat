import { RETIRED_MODELS, tConversationSchema } from '../src';
import { adminAgentApiKeys, adminApiKey, adminAgentAnalytics } from '../src/api-endpoints';

describe('agent API contract', () => {
  it('shares the retired list the pickers and the API refuse', () => {
    expect(RETIRED_MODELS.has('claude-opus-4-8')).toBe(true);
    expect(RETIRED_MODELS.has('gpt-6-luna')).toBe(false);
  });

  it('keeps apiKeyName on a parsed conversation', () => {
    const parsed = tConversationSchema.parse({
      conversationId: 'c1',
      endpoint: 'agents',
      title: 't',
      createdAt: '',
      updatedAt: '',
      apiKeyName: 'BADM 350 site',
    });
    expect(parsed.apiKeyName).toBe('BADM 350 site');
  });

  it('builds the key and source URLs', () => {
    expect(adminAgentApiKeys('agent_1')).toBe('/api/admin/usage/agents/agent_1/api-keys');
    expect(adminApiKey('k1')).toBe('/api/admin/usage/api-keys/k1');
    expect(adminAgentAnalytics({ days: 7, source: 'api' })).toContain('source=api');
  });
});
