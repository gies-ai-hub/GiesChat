import { Types } from 'mongoose';
import type { IAgent, IUser } from '@librechat/data-schemas';
import type { AgentWeekFacts, WeeklyDigestDeps, WeeklyDigestEmail } from './digest';
import type { ServerRequest } from '~/types/http';
import type { Response } from 'express';
import type { AgentAnalyticsRaw } from './usage';
import type { TopicsModel } from './topics';
import {
  weekLabel,
  weekBoundary,
  isDigestDue,
  digestWindows,
  sendWeeklyDigests,
  buildWeeklyDigest,
  summarizeAgentWeek,
  sampleWeeklyDigest,
  createWeeklyDigestTestHandler,
} from './digest';
import { toAnalyticsBody } from './analytics';
import { parseDigestSettings, DIGEST_DEFAULTS } from './usage';

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

function raw(conversations: number, students = conversations): AgentAnalyticsRaw {
  return {
    conversationCount: conversations,
    activeStudents: students,
    returningStudents: 0,
    assistantMessageCount: conversations * 2,
    erroredMessageCount: 0,
    turnDistribution: conversations > 0 ? [{ turns: 2, conversations }] : [],
    studentDistribution: students > 0 ? [{ conversations: 1, students }] : [],
    daily: [],
  };
}

const [thisWindow, lastWindow] = digestWindows(new Date('2026-11-16T14:00:00Z'));

const facts: AgentWeekFacts = {
  name: 'ACCY 502A Case Coach',
  description: 'Helps with lease accounting cases',
  thisWeek: toAnalyticsBody(raw(18, 11), thisWindow, 11),
  lastWeek: toAnalyticsBody(raw(12, 8), lastWindow, 8),
  weeklyConversations: [4, 7, 12, 18],
};

describe('summarizeAgentWeek', () => {
  it('gives the model rates as whole percentages, the way the dashboard shows them', async () => {
    const fetchMock = stubFetch(JSON.stringify({ summary: 'Fewer came back.' }));
    const halfReturn = {
      ...facts,
      thisWeek: { ...facts.thisWeek, returnRate: 0.5, oneTurnShare: 0.125, errorRate: 0 },
    };
    await summarizeAgentWeek(halfReturn, ['q'], llm);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const content = (JSON.parse(String(init.body)) as { messages: { content: string }[] })
      .messages[1].content;
    expect(content).toContain('"returnRatePercent":50');
    expect(content).toContain('"oneTurnPercent":13');
    expect(content).toContain('"errorRatePercent":0');
    expect(content).not.toContain('"returnRate":');
  });

  it('sends the chart data and numbered messages, with no enrolledStudents, and returns the summary', async () => {
    const fetchMock = stubFetch(JSON.stringify({ summary: 'Use grew.' }));
    await expect(summarizeAgentWeek(facts, ['how do I classify a lease'], llm)).resolves.toBe(
      'Use grew.',
    );
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as {
      response_format: unknown;
      messages: { content: string }[];
    };
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages[0].content).toContain('Never quote a message');
    expect(body.messages[1].content).toContain('"depthBuckets"');
    expect(body.messages[1].content).not.toContain('enrolledStudents');
    expect(body.messages[1].content).toContain('1. how do I classify a lease');
  });

  it('rejects an empty or over-long summary', async () => {
    stubFetch(JSON.stringify({ summary: '' }));
    await expect(summarizeAgentWeek(facts, ['q'], llm)).rejects.toThrow();
    stubFetch(JSON.stringify({ summary: 'x'.repeat(801) }));
    await expect(summarizeAgentWeek(facts, ['q'], llm)).rejects.toThrow();
  });

  it.each([
    'Your NetID expires; verify at https://illinois-verify.co now.',
    'Students should visit www.netid-check.com this week.',
    'Log in at illinois-verify.com to keep access.',
    'Email help@illinois.edu with questions.',
    'Call 2175551234 to confirm.',
  ])('refuses a summary that could send recipients somewhere: %s', async (summary) => {
    stubFetch(JSON.stringify({ summary }));
    await expect(summarizeAgentWeek(facts, ['q'], llm)).rejects.toThrow();
  });

  it('still accepts ordinary course prose with numbers and abbreviations', async () => {
    const summary =
      'Use rose from 12 to 18 conversations (50% came back). Students asked about ASC 842, e.g. lease terms, and the U.S. GAAP memo.';
    stubFetch(JSON.stringify({ summary }));
    await expect(summarizeAgentWeek(facts, ['q'], llm)).resolves.toBe(summary);
  });
});

const MONDAY_8_CHICAGO = { sendDay: 1, sendHour: 8, timezone: 'America/Chicago' };

describe('weekBoundary', () => {
  it.each([
    ['2026-11-18T15:00:00Z', '2026-11-16T14:00:00Z'],
    ['2026-11-16T13:59:00Z', '2026-11-09T14:00:00Z'],
    ['2026-11-16T14:00:00Z', '2026-11-16T14:00:00Z'],
    ['2026-07-15T12:00:00Z', '2026-07-13T13:00:00Z'],
    ['2026-11-01T20:00:00Z', '2026-10-26T13:00:00Z'],
  ])('%s → %s (Monday 8 AM Chicago, across CST/CDT)', (now, expected) => {
    expect(weekBoundary(new Date(now), MONDAY_8_CHICAGO).toISOString()).toBe(
      new Date(expected).toISOString(),
    );
  });

  it('defaults to Friday 5 PM Central', () => {
    expect(weekBoundary(new Date('2026-11-18T15:00:00Z'), DIGEST_DEFAULTS).toISOString()).toBe(
      '2026-11-13T23:00:00.000Z',
    );
  });

  it("reads the day and hour in the subscriber's own timezone", () => {
    const london = { sendDay: 3, sendHour: 9, timezone: 'Europe/London' };
    expect(weekBoundary(new Date('2026-11-18T15:00:00Z'), london).toISOString()).toBe(
      '2026-11-18T09:00:00.000Z',
    );
    expect(weekBoundary(new Date('2026-11-18T08:59:00Z'), london).toISOString()).toBe(
      '2026-11-11T09:00:00.000Z',
    );
  });

  it('handles a midnight send', () => {
    const sundayMidnight = { sendDay: 0, sendHour: 0, timezone: 'America/Chicago' };
    expect(weekBoundary(new Date('2026-11-18T15:00:00Z'), sundayMidnight).toISOString()).toBe(
      '2026-11-15T06:00:00.000Z',
    );
  });
});

describe('isDigestDue', () => {
  const now = new Date('2026-11-18T15:00:00Z');

  it('is due when last sent before the latest Friday 5 PM by default, and not after', () => {
    expect(
      isDigestDue(
        {
          agentIds: ['a'],
          emails: ['x@illinois.edu'],
          lastSentAt: new Date('2026-11-10T14:00:00Z'),
        },
        now,
      ),
    ).toBe(true);
    expect(
      isDigestDue(
        {
          agentIds: ['a'],
          emails: ['x@illinois.edu'],
          lastSentAt: new Date('2026-11-14T14:05:00Z'),
        },
        now,
      ),
    ).toBe(false);
  });

  it("follows the subscriber's own day and hour", () => {
    const lastSentAt = new Date('2026-11-14T00:00:00Z');
    const digest = { agentIds: ['a'], emails: ['x@illinois.edu'], lastSentAt };
    expect(isDigestDue(digest, now)).toBe(false);
    expect(isDigestDue({ ...digest, ...MONDAY_8_CHICAGO }, now)).toBe(true);
  });

  it('is never due with no emails or no agents', () => {
    expect(isDigestDue({ agentIds: [], emails: ['x@illinois.edu'] }, now)).toBe(false);
    expect(isDigestDue({ agentIds: ['a'], emails: [] }, now)).toBe(false);
    expect(isDigestDue(undefined, now)).toBe(false);
  });
});

describe('digestWindows', () => {
  it('gives four back-to-back weeks, newest first', () => {
    const windows = digestWindows(new Date('2026-11-16T14:00:00Z'));
    expect(windows).toHaveLength(4);
    expect(windows[0]).toEqual({
      since: new Date('2026-11-09T14:00:00Z'),
      until: new Date('2026-11-16T14:00:00Z'),
    });
    expect(windows[3].since).toEqual(new Date('2026-10-19T14:00:00Z'));
  });
});

describe('weekLabel', () => {
  it('names the local dates the window covers, end date included', () => {
    const friday = digestWindows(new Date('2026-11-13T23:00:00Z'))[0];
    expect(weekLabel(friday, 'America/Chicago')).toBe('Nov 6 – Nov 13');
    const sundayMidnight = digestWindows(new Date('2026-11-15T06:00:00Z'))[0];
    expect(weekLabel(sundayMidnight, 'America/Chicago')).toBe('Nov 8 – Nov 14');
  });
});

describe('parseDigestSettings', () => {
  it('lowercases Illinois emails, drops others, dedupes ids, and fills the default schedule', () => {
    expect(
      parseDigestSettings({
        agentIds: ['a', 'a', 'b'],
        emails: ['TA@Illinois.edu', 'x@gmail.com'],
      }),
    ).toEqual({ agentIds: ['a', 'b'], emails: ['ta@illinois.edu'], ...DIGEST_DEFAULTS });
  });

  it('keeps a chosen day, hour and timezone', () => {
    expect(
      parseDigestSettings({
        agentIds: [],
        emails: [],
        ...MONDAY_8_CHICAGO,
        timezone: 'Asia/Tokyo',
      }),
    ).toMatchObject({ sendDay: 1, sendHour: 8, timezone: 'Asia/Tokyo' });
  });

  it('rejects more than 10 addresses, non-arrays, or a schedule that is not real', () => {
    const emails = Array.from({ length: 11 }, (_, i) => `p${i}@illinois.edu`);
    expect(parseDigestSettings({ agentIds: [], emails })).toBeNull();
    expect(parseDigestSettings({ agentIds: 'a', emails: [] })).toBeNull();
    expect(parseDigestSettings({ agentIds: [], emails: [], sendDay: 7 })).toBeNull();
    expect(parseDigestSettings({ agentIds: [], emails: [], sendHour: 24 })).toBeNull();
    expect(parseDigestSettings({ agentIds: [], emails: [], sendHour: 8.5 })).toBeNull();
    expect(parseDigestSettings({ agentIds: [], emails: [], timezone: 'Mars/Olympus' })).toBeNull();
  });
});

describe('weekly digest run', () => {
  type Args<K extends keyof WeeklyDigestDeps> = Parameters<WeeklyDigestDeps[K]>;

  const now = new Date('2026-11-18T15:00:00Z');
  const windows = digestWindows(weekBoundary(now, DIGEST_DEFAULTS));
  const subscriber = {
    _id: new Types.ObjectId(),
    name: 'Dana Whitfield',
    email: 'dwhitfield@illinois.edu',
    role: 'USER',
    weeklyDigest: {
      agentIds: ['agent_a', 'agent_gone', 'agent_quiet'],
      emails: ['prof@illinois.edu', 'ta@illinois.edu'],
      lastSentAt: new Date('2026-11-09T14:00:00Z'),
    },
  } as IUser;
  const agents = [
    { id: 'agent_quiet', name: 'Resume Reviewer', description: '' },
    { id: 'agent_a', name: 'ACCY 502A Case Coach', description: 'Lease cases' },
  ] as IAgent[];
  /** Conversations per window, newest first, the order `digestWindows` returns. */
  const weekly: Record<string, number[]> = { agent_a: [18, 12, 7, 4], agent_quiet: [0, 0, 0, 0] };

  let fetchMock: jest.Mock;
  beforeEach(() => {
    fetchMock = stubFetch(JSON.stringify({ summary: 'Use grew.' }));
  });

  function deps() {
    return {
      findUsers: jest.fn<Promise<IUser[]>, Args<'findUsers'>>(async () => [subscriber]),
      claimWeeklyDigest: jest.fn<Promise<boolean>, Args<'claimWeeklyDigest'>>(async () => true),
      releaseWeeklyDigest: jest.fn<Promise<void>, Args<'releaseWeeklyDigest'>>(
        async () => undefined,
      ),
      findAgents: jest.fn<Promise<IAgent[]>, Args<'findAgents'>>(async () => agents),
      findAccessibleResources: jest.fn<Promise<Types.ObjectId[]>, Args<'findAccessibleResources'>>(
        async () => [],
      ),
      aggregateAgentAnalytics: jest.fn<Promise<AgentAnalyticsRaw>, Args<'aggregateAgentAnalytics'>>(
        async (scope) => {
          const index = windows.findIndex((w) => w.since.getTime() === scope.since.getTime());
          return raw(weekly[scope.agentIds[0]][index]);
        },
      ),
      sampleStudentMessages: jest.fn<Promise<string[]>, Args<'sampleStudentMessages'>>(async () => [
        'how do I classify a lease',
      ]),
      resolveTopicsModel: jest.fn<Promise<TopicsModel | null>, []>(async () => llm),
      sendWeeklyDigest: jest.fn<Promise<number>, Args<'sendWeeklyDigest'>>(async () => 2),
    };
  }

  it('builds one card per picked agent still in scope, summarizing only busy ones', async () => {
    const d = deps();
    const email = await buildWeeklyDigest(d, subscriber, now);
    expect(email?.emails).toEqual(['prof@illinois.edu', 'ta@illinois.edu']);
    expect(email?.weekLabel).toBe('Nov 6 – Nov 13');
    expect(email?.headline).toBe(
      '18 conversations across the 2 agents you picked, up 6 from last week.',
    );
    expect(email?.agents.map((card) => card.name)).toEqual([
      'ACCY 502A Case Coach',
      'Resume Reviewer',
    ]);
    expect(email?.agents[0]).toMatchObject({
      conversations: 18,
      conversationsChange: { text: '▲ 6', tone: 'up' },
      summary: 'Use grew.',
      quiet: false,
      sampleSize: 1,
    });
    expect(email?.agents[0].trend.map((point) => point.value)).toEqual([4, 7, 12, 18]);
    expect(email?.agents[1]).toMatchObject({ quiet: true, summary: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(d.aggregateAgentAnalytics).toHaveBeenCalledWith(
      expect.objectContaining({
        agentIds: ['agent_a'],
        userIds: null,
        until: new Date('2026-11-13T23:00:00Z'),
      }),
    );
  });

  it("measures the weeks that end at the subscriber's own send time", async () => {
    const d = deps();
    const london = {
      ...subscriber,
      weeklyDigest: {
        ...subscriber.weeklyDigest,
        sendDay: 3,
        sendHour: 9,
        timezone: 'Europe/London',
      },
    } as IUser;
    const email = await buildWeeklyDigest(d, london, now);
    expect(d.aggregateAgentAnalytics).toHaveBeenCalledWith(
      expect.objectContaining({ until: new Date('2026-11-18T09:00:00Z') }),
    );
    expect(email?.weekLabel).toBe('Nov 11 – Nov 18');
  });

  it('keeps the numbers when the model is missing or fails', async () => {
    const d = deps();
    d.resolveTopicsModel.mockResolvedValueOnce(null);
    expect((await buildWeeklyDigest(d, subscriber, now))?.agents[0]).toMatchObject({
      conversations: 18,
      summary: null,
    });
    stubFetch('not json');
    expect((await buildWeeklyDigest(d, subscriber, now))?.agents[0].summary).toBeNull();
  });

  it('claims the week before sending; a second pass the same week sends nothing', async () => {
    const d = deps();
    expect(await sendWeeklyDigests(d, now)).toBe(1);
    expect(d.sendWeeklyDigest).toHaveBeenCalledTimes(1);
    expect(d.claimWeeklyDigest).toHaveBeenCalledWith(
      String(subscriber._id),
      new Date('2026-11-13T23:00:00Z'),
      now,
    );
    expect(d.claimWeeklyDigest.mock.invocationCallOrder[0]).toBeLessThan(
      d.sendWeeklyDigest.mock.invocationCallOrder[0],
    );
    d.findUsers.mockResolvedValueOnce([
      {
        ...subscriber,
        weeklyDigest: { agentIds: ['agent_a'], emails: ['prof@illinois.edu'], lastSentAt: now },
      } as IUser,
    ]);
    expect(await sendWeeklyDigests(d, now)).toBe(0);
    expect(d.sendWeeklyDigest).toHaveBeenCalledTimes(1);
  });

  it('sends nothing when another pass or server already claimed the week', async () => {
    const d = deps();
    d.claimWeeklyDigest.mockResolvedValueOnce(false);
    expect(await sendWeeklyDigests(d, now)).toBe(0);
    expect(d.sendWeeklyDigest).not.toHaveBeenCalled();
    expect(d.aggregateAgentAnalytics).not.toHaveBeenCalled();
  });

  it('keeps the claim without sending when no picked agent is in scope any more', async () => {
    const d = deps();
    d.findAgents.mockResolvedValue([]);
    expect(await sendWeeklyDigests(d, now)).toBe(0);
    expect(d.sendWeeklyDigest).not.toHaveBeenCalled();
    expect(d.claimWeeklyDigest).toHaveBeenCalled();
    expect(d.releaseWeeklyDigest).not.toHaveBeenCalled();
  });

  it('counts a subscriber as emailed only when at least one address was reached', async () => {
    const d = deps();
    d.sendWeeklyDigest.mockResolvedValueOnce(0);
    expect(await sendWeeklyDigests(d, now)).toBe(0);
    expect(d.releaseWeeklyDigest).not.toHaveBeenCalled();
  });

  it('releases the claim when the send fails, so the next pass retries', async () => {
    const d = deps();
    d.sendWeeklyDigest.mockRejectedValueOnce(new Error('ACS down'));
    expect(await sendWeeklyDigests(d, now)).toBe(0);
    expect(d.releaseWeeklyDigest).toHaveBeenCalledWith(
      String(subscriber._id),
      now,
      new Date('2026-11-09T14:00:00Z'),
    );
  });
});

describe('sampleWeeklyDigest', () => {
  const now = new Date('2026-11-18T15:00:00Z');

  it('builds a test email for one address, with made-up numbers on the named agents', () => {
    const email = sampleWeeklyDigest(
      { name: 'Dana Whitfield', email: 'dwhitfield@illinois.edu' },
      ['ACCY 502A Case Coach', 'FIN 300 Office Hours'],
      DIGEST_DEFAULTS,
      now,
    );
    expect(email.test).toBe(true);
    expect(email.emails).toEqual(['dwhitfield@illinois.edu']);
    expect(email.weekLabel).toBe('Nov 6 – Nov 13');
    expect(email.agents.map((card) => card.name)).toEqual([
      'ACCY 502A Case Coach',
      'FIN 300 Office Hours',
    ]);
    expect(email.agents.every((card) => card.summary && !card.quiet)).toBe(true);
    expect(email.headline).toMatch(/^\d+ conversations across the 2 agents you picked/);
  });

  it('still shows a card when no agent is picked yet', () => {
    const email = sampleWeeklyDigest({ email: 'me@illinois.edu' }, [], DIGEST_DEFAULTS, now);
    expect(email.agents).toHaveLength(1);
    expect(email.ownerName).toBe('me@illinois.edu');
  });
});

describe('createWeeklyDigestTestHandler', () => {
  const owner = {
    _id: new Types.ObjectId(),
    name: 'Dana Whitfield',
    email: 'dwhitfield@illinois.edu',
    role: 'USER',
  } as IUser;

  function testDeps() {
    return {
      findAgents: jest.fn(
        async () =>
          [
            { id: 'agent_a', name: 'ACCY 502A Case Coach' },
            { id: 'agent_b', name: 'Resume Reviewer' },
          ] as IAgent[],
      ),
      findAccessibleResources: jest.fn(async () => [] as Types.ObjectId[]),
      sendWeeklyDigest: jest.fn(async (_email: WeeklyDigestEmail) => 1),
    };
  }

  async function call(
    handler: ReturnType<typeof createWeeklyDigestTestHandler>,
    body: unknown,
    user: IUser | null = owner,
  ) {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const partial: Pick<Response, 'status' | 'json'> = { status, json };
    await handler({ body, user: user ?? undefined } as ServerRequest, partial as Response);
    return { status, json };
  }

  it('sends a marked sample to my own address only, naming the agents I picked', async () => {
    const d = testDeps();
    const { status, json } = await call(createWeeklyDigestTestHandler(d), {
      agentIds: ['agent_a', 'agent_not_mine'],
      emails: ['ta@illinois.edu'],
    });
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({ email: 'dwhitfield@illinois.edu' });
    const email = d.sendWeeklyDigest.mock.calls[0][0];
    expect(email).toMatchObject({ emails: ['dwhitfield@illinois.edu'], test: true });
    expect(email.agents.map((card) => card.name)).toEqual(['ACCY 502A Case Coach']);
  });

  it('asks for a minute between tests', async () => {
    const d = testDeps();
    const handler = createWeeklyDigestTestHandler(d);
    await call(handler, { agentIds: [] });
    const { status } = await call(handler, { agentIds: [] });
    expect(status).toHaveBeenCalledWith(429);
    expect(d.sendWeeklyDigest).toHaveBeenCalledTimes(1);
  });

  it('reports a test that reached nobody, and lets them try again straight away', async () => {
    const d = testDeps();
    d.sendWeeklyDigest.mockResolvedValueOnce(0);
    const handler = createWeeklyDigestTestHandler(d);
    expect((await call(handler, { agentIds: [] })).status).toHaveBeenCalledWith(502);
    expect((await call(handler, { agentIds: [] })).status).toHaveBeenCalledWith(200);
  });

  it('refuses without a signed-in user', async () => {
    const d = testDeps();
    const { status } = await call(createWeeklyDigestTestHandler(d), {}, null);
    expect(status).toHaveBeenCalledWith(401);
    expect(d.sendWeeklyDigest).not.toHaveBeenCalled();
  });
});
