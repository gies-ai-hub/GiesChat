import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createModels } from '@librechat/data-schemas';
import { resetIssueTargetCache } from './github';
import { submitIssue } from './service';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), debug: jest.fn(), info: jest.fn() },
}));

let mongoServer: MongoMemoryServer;
const env = process.env;

const okResponse = (body: unknown): Response =>
  ({ ok: true, status: 200, statusText: 'OK', json: async () => body }) as Response;

const findReport = async (reportId: string) => {
  const { IssueReport } = createModels(mongoose);
  return IssueReport.findOne({ reportId }).lean();
};

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
  process.env = env;
});

beforeEach(() => {
  process.env = { ...env, GITHUB_ISSUES_REPO: 'gies-ai-hub/GiesChat', GITHUB_ISSUES_TOKEN: 'tk' };
  resetIssueTargetCache();
  jest.restoreAllMocks();
});

describe('submitIssue with GitHub mirroring', () => {
  it('records the issue number and url on the document', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(okResponse({ private: true }))
      .mockResolvedValueOnce(
        okResponse({ number: 12, html_url: 'https://github.com/gies-ai-hub/GiesChat/issues/12' }),
      );

    const result = await submitIssue({
      userId: new Types.ObjectId().toString(),
      description: 'Work mode did not switch to the deck builder.',
      route: '/c/new',
    });

    const stored = await findReport(result.reportId);
    expect(stored?.githubIssueNumber).toBe(12);
    expect(stored?.githubIssueUrl).toBe('https://github.com/gies-ai-hub/GiesChat/issues/12');
  });

  it('still returns a usable report when GitHub fails, leaving the document intact', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('github is down'));

    const result = await submitIssue({
      userId: new Types.ObjectId().toString(),
      description: 'The preview panel rendered an empty page.',
    });

    expect(result.reportId).toMatch(/^ISS-/);
    expect(result.confidence).toBe('low');

    const stored = await findReport(result.reportId);
    expect(stored?.description).toBe('The preview panel rendered an empty page.');
    expect(stored?.githubIssueNumber).toBeUndefined();
    expect(stored?.githubIssueUrl).toBeUndefined();
  });

  it('attempts no GitHub call at all when the vars are unset', async () => {
    delete process.env.GITHUB_ISSUES_REPO;
    delete process.env.GITHUB_ISSUES_TOKEN;
    const fetchSpy = jest.spyOn(global, 'fetch');

    const result = await submitIssue({
      userId: new Types.ObjectId().toString(),
      description: 'Everything is fine, just testing the quiet path.',
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    const stored = await findReport(result.reportId);
    expect(stored?.githubIssueNumber).toBeUndefined();
  });
});
