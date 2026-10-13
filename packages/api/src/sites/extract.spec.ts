import http from 'http';
import type { AddressInfo } from 'net';
import type { WebsitePage } from 'librechat-data-provider';
import type { ModelTestEndpoint } from '~/admin/modelTest';
import { cleanPages, SCRAPE_MODEL, EXTRACT_PROMPT } from './extract';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

type ChatBody = { model: string; messages: { role: string; content: string }[] };
let requests: ChatBody[] = [];
let server: http.Server;
let endpoint: ModelTestEndpoint;

const page = (url: string, text: string): WebsitePage => ({
  url,
  title: url,
  text,
  words: text.split(' ').length,
  cleaned: false,
});

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const body = JSON.parse(raw) as ChatBody;
      requests.push(body);
      if (body.messages[1].content.includes('BROKEN')) {
        res.writeHead(500);
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({ choices: [{ message: { content: '## Week 5\n\n| Due | Item |' } }] }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  endpoint = {
    baseURL: `http://127.0.0.1:${port}`,
    apiKey: 'key',
    models: ['gpt-6-sol', SCRAPE_MODEL],
  };
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  requests = [];
});

describe('cleanPages', () => {
  it('sends each page to gpt-6-luna with the extraction rules and keeps the order', async () => {
    const pages = [
      page('https://x.edu/a/', 'Home | Week 5 due Tuesday'),
      page('https://x.edu/b/', 'Other'),
    ];

    const cleaned = await cleanPages(pages, endpoint);

    expect(requests).toHaveLength(2);
    expect(requests[0].model).toBe('gpt-6-luna');
    expect(requests[0].messages[0]).toEqual({ role: 'system', content: EXTRACT_PROMPT });
    expect(requests.map((r) => r.messages[1].content).join('\n')).toContain('Week 5 due Tuesday');
    expect(cleaned.map((p) => p.url)).toEqual(['https://x.edu/a/', 'https://x.edu/b/']);
    expect(cleaned[0]).toMatchObject({
      text: '## Week 5\n\n| Due | Item |',
      cleaned: true,
      words: 8,
    });
  });

  it('keeps the plain text for a page Luna fails on', async () => {
    const cleaned = await cleanPages(
      [page('https://x.edu/a/', 'BROKEN page'), page('https://x.edu/b/', 'ok')],
      endpoint,
    );

    expect(cleaned[0]).toMatchObject({ text: 'BROKEN page', cleaned: false });
    expect(cleaned[1].cleaned).toBe(true);
  });

  it('makes no call when Luna is not on the endpoint or no endpoint is configured', async () => {
    const pages = [page('https://x.edu/a/', 'text')];

    expect(await cleanPages(pages, { ...endpoint, models: ['gpt-6-sol'] })).toEqual(pages);
    expect(await cleanPages(pages, null)).toEqual(pages);
    expect(requests).toHaveLength(0);
  });
});
