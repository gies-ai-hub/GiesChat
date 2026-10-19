import http from 'http';
import type { AddressInfo } from 'net';
import type { ModelTestEndpoint } from '~/admin/modelTest';
import { extractImageMarkdown, isReadableImage, IMAGE_PROMPT } from './image';
import { SCRAPE_MODEL } from '~/sites/extract';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

type Part = { type: string; text?: string; image_url?: { url: string } };
type ChatBody = { model: string; messages: { role: string; content: string | Part[] }[] };

const TABLE = '| Section | Mean |\n|---|---:|\n| AL1 | 78.4 |';
let requests: ChatBody[] = [];
let reply: { status: number; finish_reason?: string; content?: string };
let server: http.Server;
let endpoint: ModelTestEndpoint;

const extract = (filename = 'exam1.jpg') =>
  extractImageMarkdown({ endpoint, image: Buffer.from('jpeg'), mimetype: 'image/jpeg', filename });

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      requests.push(JSON.parse(raw) as ChatBody);
      res.writeHead(reply.status, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [{ finish_reason: reply.finish_reason, message: { content: reply.content } }],
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  endpoint = { baseURL: `http://127.0.0.1:${port}`, apiKey: 'key', models: [SCRAPE_MODEL] };
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  requests = [];
  reply = { status: 200, finish_reason: 'stop', content: `\n${TABLE}\n` };
});

describe('isReadableImage', () => {
  it('accepts JPEG, PNG and WebP only', () => {
    expect(['image/jpeg', 'image/png', 'image/webp'].every(isReadableImage)).toBe(true);
    expect(['image/gif', 'image/heic', 'application/pdf'].some(isReadableImage)).toBe(false);
  });
});

describe('extractImageMarkdown', () => {
  it('sends the image to Luna as a data URL and returns the trimmed Markdown', async () => {
    await expect(extract()).resolves.toBe(TABLE);
    const [body] = requests;
    expect(body.model).toBe(SCRAPE_MODEL);
    expect(body.messages[0]).toEqual({ role: 'system', content: IMAGE_PROMPT });
    const parts = body.messages[1].content as Part[];
    expect(parts[1].image_url?.url).toBe(
      `data:image/jpeg;base64,${Buffer.from('jpeg').toString('base64')}`,
    );
  });

  it.each([
    ['nothing readable', { status: 200, finish_reason: 'stop', content: 'NO_CONTENT' }, /sharper/],
    ['a truncated reply', { status: 200, finish_reason: 'length', content: TABLE }, /cropping/],
    ['an error status', { status: 500 }, /try again/],
  ])('rejects %s with a user-facing message', async (_label, next, reason) => {
    reply = next;
    const error = await extract('IMG_4482.jpg').catch((err: Error) => err);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/^Unable to extract text from "IMG_4482.jpg"/);
    expect((error as Error).message).toMatch(reason);
  });

  it('never calls the model when Luna is not on the endpoint', async () => {
    endpoint = { ...endpoint, models: ['gpt-6.1-sol'] };
    await expect(extract()).rejects.toThrow(/not available/);
    expect(requests).toHaveLength(0);
    endpoint = { ...endpoint, models: [SCRAPE_MODEL] };
  });
});
