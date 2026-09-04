import { isEmbedRequestAllowed } from './guard';

const AGENT = 'agent_abc';
const allowed = (method: string, url: string, bodyAgentId?: unknown) =>
  isEmbedRequestAllowed({ method, url, agentId: AGENT, bodyAgentId });

describe('isEmbedRequestAllowed', () => {
  it('lets the guest chat with its own agent only', () => {
    expect(allowed('POST', '/api/agents/chat/agents', AGENT)).toBe(true);
    expect(allowed('POST', '/api/agents/chat/agents', 'agent_other')).toBe(false);
    expect(allowed('POST', '/api/agents/chat/agents')).toBe(false);
    expect(allowed('POST', '/api/agents/chat/abort')).toBe(true);
    expect(allowed('POST', '/api/agents/chat/resume')).toBe(true);
    expect(allowed('GET', '/api/agents/chat/stream/conv-1?resume=true')).toBe(true);
  });

  it('allows the reads the chat shell needs to boot', () => {
    expect(allowed('GET', '/api/user')).toBe(true);
    expect(allowed('GET', '/api/config')).toBe(true);
    expect(allowed('GET', `/api/agents/${AGENT}`)).toBe(true);
    expect(allowed('GET', '/api/convos?cursor=abc')).toBe(true);
    expect(allowed('GET', '/api/messages/conv-1')).toBe(true);
  });

  it('allows writes to the guest own conversations and messages', () => {
    expect(allowed('DELETE', '/api/convos')).toBe(true);
    expect(allowed('PUT', '/api/messages/conv-1/msg-1')).toBe(true);
    expect(allowed('POST', '/api/auth/logout')).toBe(true);
  });

  it('blocks everything else', () => {
    expect(allowed('POST', '/api/files')).toBe(false);
    expect(allowed('POST', '/api/agents')).toBe(false);
    expect(allowed('PATCH', `/api/agents/${AGENT}`)).toBe(false);
    expect(allowed('PATCH', '/api/user')).toBe(false);
    expect(allowed('GET', '/api/admin/usage/agents')).toBe(false);
    expect(allowed('GET', '/api/userX')).toBe(false);
    expect(allowed('GET', '/api/memories')).toBe(false);
  });
});
