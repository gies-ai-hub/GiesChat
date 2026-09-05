import { summarizeTopics, clearTopicsCache, topicsModelFromConfig } from './topics';
import type { AppConfig } from '@librechat/data-schemas';

const llm = { baseURL: 'https://example.test/openai/v1', apiKey: 'k', model: 'm' };

function stubFetch(content: string, ok = true) {
  const fetchMock = jest.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: async () => ({ choices: [{ message: { content } }] }),
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

describe('summarizeTopics', () => {
  beforeEach(() => clearTopicsCache());

  it('skips the model entirely when there are no messages', async () => {
    const fetchMock = stubFetch('{}');
    await expect(summarizeTopics('a', [], llm)).resolves.toEqual({ topics: [], sampleSize: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends text only, sorts topics by count, and reports the sample size', async () => {
    const fetchMock = stubFetch(
      JSON.stringify({
        topics: [
          { label: 'Other', count: 1 },
          { label: 'SQL joins', count: 2 },
        ],
      }),
    );
    const result = await summarizeTopics('b', ['how do joins work', 'inner join?', 'hi'], llm);
    expect(result).toEqual({
      topics: [
        { label: 'SQL joins', count: 2 },
        { label: 'Other', count: 1 },
      ],
      sampleSize: 3,
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://example.test/openai/v1/chat/completions');
    const body = JSON.parse(String(init.body)) as { messages: { content: string }[] };
    expect(body.messages[1].content).toContain('1. how do joins work');
  });

  it('caches by key so a second call does not hit the model', async () => {
    const fetchMock = stubFetch(JSON.stringify({ topics: [{ label: 'x', count: 1 }] }));
    await summarizeTopics('c', ['q'], llm);
    await summarizeTopics('c', ['q'], llm);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed model output instead of rendering it', async () => {
    stubFetch(JSON.stringify({ topics: [{ label: '', count: -1 }] }));
    await expect(summarizeTopics('d', ['q'], llm)).rejects.toThrow();
  });

  it('surfaces a non-200 from the model', async () => {
    stubFetch('', false);
    await expect(summarizeTopics('e', ['q'], llm)).rejects.toThrow('500');
  });
});

describe('topicsModelFromConfig', () => {
  it('uses the custom endpoint that names conversations, resolving env placeholders', () => {
    process.env.TOPICS_TEST_KEY = 'secret';
    const appConfig = {
      endpoints: {
        custom: [
          {
            name: 'Azure OpenAI',
            apiKey: '${TOPICS_TEST_KEY}',
            baseURL: 'https://a.test/v1/',
            titleModel: 'mini',
          },
        ],
      },
    } as unknown as AppConfig;
    expect(topicsModelFromConfig(appConfig)).toEqual({
      baseURL: 'https://a.test/v1',
      apiKey: 'secret',
      model: 'mini',
    });
  });

  it('returns null when nothing is configured', () => {
    expect(topicsModelFromConfig({} as AppConfig)).toBeNull();
  });
});
