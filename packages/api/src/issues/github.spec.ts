import {
  buildIssueBody,
  buildIssueTitle,
  fileIssue,
  isTargetPrivate,
  resetIssueTargetCache,
  type GithubIssueReport,
} from './github';

const report: GithubIssueReport = {
  reportId: 'ISS-ABC1234567',
  userId: '6a45d19c969a71753a17a005',
  description: 'The deck builder ignored my uploaded template and used the default one.',
  route: '/c/4d3f60ec-66da-46a4-baa4-6eb492192e4f',
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
  occurredAt: new Date('2026-08-16T16:55:57.000Z'),
  diagnosis: 'Recent server activity indicates: upload_ready was never called',
  confidence: 'high',
  evidence: [
    { timestamp: '2026-08-16T16:55:40.000Z', level: 'warn', message: 'design shell empty' },
    {
      timestamp: '2026-08-16T16:55:52.000Z',
      level: 'error',
      message: 'create_presentation failed',
      requestId: 'req-91',
    },
  ],
};

const okResponse = (body: unknown): Response =>
  ({ ok: true, status: 200, statusText: 'OK', json: async () => body }) as Response;

describe('buildIssueTitle', () => {
  it('prefixes the title and truncates at 70 characters with newlines collapsed', () => {
    const title = buildIssueTitle(`line one\nline two ${'x'.repeat(200)}`);
    expect(title.startsWith('[Report] ')).toBe(true);
    expect(title).toContain('line one line two');
    expect(title.length).toBe('[Report] '.length + 70);
  });
});

describe('buildIssueBody', () => {
  it('carries the evidence a maintainer needs when the repository is private', () => {
    const body = buildIssueBody(report, true);
    expect(body).toContain('ISS-ABC1234567');
    expect(body).toContain(report.description);
    expect(body).toContain('/c/4d3f60ec-66da-46a4-baa4-6eb492192e4f');
    expect(body).toContain('upload_ready was never called');
    expect(body).toContain('create_presentation failed');
    expect(body).toContain('request req-91');
    expect(body).toContain('<details>');
  });

  it('identifies the user by Mongo id and never by email', () => {
    const body = buildIssueBody(report, true);
    expect(body).toContain('6a45d19c969a71753a17a005');
    expect(body).not.toMatch(/@/);
  });

  it('withholds every identifying detail when the repository is public', () => {
    const body = buildIssueBody(report, false);
    expect(body).toContain('ISS-ABC1234567');
    expect(body).toContain(report.description);
    expect(body).not.toContain(report.route);
    expect(body).not.toContain(report.userAgent);
    expect(body).not.toContain(report.userId);
    expect(body).not.toContain('create_presentation failed');
    expect(body).not.toContain('design shell empty');
  });

  it('neutralises a fence in a log line so it cannot restructure the issue', () => {
    const body = buildIssueBody(
      { ...report, evidence: [{ timestamp: 't', level: 'error', message: '``` then markdown' }] },
      true,
    );
    expect(body).not.toContain('``` then markdown');
    expect(body).toContain("''' then markdown");
  });
});

describe('the GitHub target', () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
    delete process.env.GITHUB_ISSUES_REPO;
    delete process.env.GITHUB_ISSUES_TOKEN;
    resetIssueTargetCache();
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env = env;
  });

  it('files nothing and calls nothing when the vars are unset', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    await expect(fileIssue(report)).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('files nothing when only one of the two vars is set', async () => {
    process.env.GITHUB_ISSUES_REPO = 'gies-ai-hub/GiesChat';
    const fetchSpy = jest.spyOn(global, 'fetch');
    await expect(fileIssue(report)).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('treats a failed visibility lookup as public — fails closed', async () => {
    process.env.GITHUB_ISSUES_REPO = 'gies-ai-hub/GiesChat';
    process.env.GITHUB_ISSUES_TOKEN = 'token';
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));
    await expect(isTargetPrivate()).resolves.toBe(false);
  });

  it('treats a non-OK visibility lookup as public — fails closed', async () => {
    process.env.GITHUB_ISSUES_REPO = 'gies-ai-hub/GiesChat';
    process.env.GITHUB_ISSUES_TOKEN = 'token';
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' } as Response);
    await expect(isTargetPrivate()).resolves.toBe(false);
  });

  it('looks the visibility up once per process', async () => {
    process.env.GITHUB_ISSUES_REPO = 'gies-ai-hub/GiesChat';
    process.env.GITHUB_ISSUES_TOKEN = 'token';
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(okResponse({ private: true }));
    await isTargetPrivate();
    await isTargetPrivate();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('fileIssue', () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env, GITHUB_ISSUES_REPO: 'gies-ai-hub/GiesChat', GITHUB_ISSUES_TOKEN: 'tk' };
    resetIssueTargetCache();
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env = env;
  });

  it('posts a full body to a private repository and returns the issue', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(okResponse({ private: true }))
      .mockResolvedValueOnce(
        okResponse({ number: 42, html_url: 'https://github.com/gies-ai-hub/GiesChat/issues/42' }),
      );

    await expect(fileIssue(report)).resolves.toEqual({
      number: 42,
      url: 'https://github.com/gies-ai-hub/GiesChat/issues/42',
    });

    const [url, init] = fetchSpy.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/gies-ai-hub/GiesChat/issues');
    expect(init.method).toBe('POST');
    const sent = JSON.parse(init.body as string) as { labels: string[]; body: string };
    expect(sent.labels).toEqual(['user-report']);
    expect(sent.body).toContain('create_presentation failed');
  });

  it('redacts the body when the repository reads public', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(okResponse({ private: false }))
      .mockResolvedValueOnce(okResponse({ number: 7, html_url: 'https://example.test/7' }));

    await fileIssue(report);

    const sent = JSON.parse((fetchSpy.mock.calls[1][1] as RequestInit).body as string) as {
      body: string;
    };
    expect(sent.body).toContain('ISS-ABC1234567');
    expect(sent.body).not.toContain('create_presentation failed');
    expect(sent.body).not.toContain(report.userId);
  });

  it('returns null and swallows a rejected POST', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(okResponse({ private: true }))
      .mockResolvedValueOnce({ ok: false, status: 401, statusText: 'Unauthorized' } as Response);
    await expect(fileIssue(report)).resolves.toBeNull();
  });

  it('returns null and swallows a network failure', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(okResponse({ private: true }))
      .mockRejectedValueOnce(new Error('socket hang up'));
    await expect(fileIssue(report)).resolves.toBeNull();
  });

  it('returns null when GitHub accepts but answers without an issue number', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(okResponse({ private: true }))
      .mockResolvedValueOnce(okResponse({ ok: 'sure' }));
    await expect(fileIssue(report)).resolves.toBeNull();
  });
});
