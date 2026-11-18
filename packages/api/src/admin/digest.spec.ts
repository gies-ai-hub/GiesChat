import { Types } from 'mongoose';
import type { IAgent, IUser } from '@librechat/data-schemas';
import type { AgentWeekFacts, WeeklyDigestDeps } from './digest';
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
} from './digest';
import { toAnalyticsBody } from './analytics';
import { parseDigestSettings } from './usage';

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
    expect(body.messages[1].content).toContain('"oneTurnShare"');
    expect(body.messages[1].content).not.toContain('enrolledStudents');
    expect(body.messages[1].content).toContain('1. how do I classify a lease');
  });

  it('rejects an empty or over-long summary', async () => {
    stubFetch(JSON.stringify({ summary: '' }));
    await expect(summarizeAgentWeek(facts, ['q'], llm)).rejects.toThrow();
    stubFetch(JSON.stringify({ summary: 'x'.repeat(801) }));
    await expect(summarizeAgentWeek(facts, ['q'], llm)).rejects.toThrow();
  });
});

describe('weekBoundary', () => {
  it.each([
    ['2026-11-18T15:00:00Z', '2026-11-16T14:00:00Z'],
    ['2026-11-16T13:59:00Z', '2026-11-09T14:00:00Z'],
    ['2026-11-16T14:00:00Z', '2026-11-16T14:00:00Z'],
    ['2026-07-15T12:00:00Z', '2026-07-13T13:00:00Z'],
    ['2026-11-01T20:00:00Z', '2026-10-26T13:00:00Z'],
  ])('%s → %s (Monday 8 AM Chicago, across CST/CDT)', (now, expected) => {
    expect(weekBoundary(new Date(now)).toISOString()).toBe(new Date(expected).toISOString());
  });
});

describe('isDigestDue', () => {
  const now = new Date('2026-11-18T15:00:00Z');

  it('is due when last sent before this Monday 8 AM, and not after', () => {
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
          lastSentAt: new Date('2026-11-16T14:05:00Z'),
        },
        now,
      ),
    ).toBe(false);
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
  it('names the Chicago dates the window covers', () => {
    expect(weekLabel(digestWindows(new Date('2026-11-16T14:00:00Z'))[0])).toBe('Nov 9 – Nov 15');
  });
});

describe('parseDigestSettings', () => {
  it('lowercases Illinois emails, drops others, dedupes ids', () => {
    expect(
      parseDigestSettings({
        agentIds: ['a', 'a', 'b'],
        emails: ['TA@Illinois.edu', 'x@gmail.com'],
      }),
    ).toEqual({ agentIds: ['a', 'b'], emails: ['ta@illinois.edu'] });
  });

  it('rejects more than 10 addresses, or non-arrays', () => {
    const emails = Array.from({ length: 11 }, (_, i) => `p${i}@illinois.edu`);
    expect(parseDigestSettings({ agentIds: [], emails })).toBeNull();
    expect(parseDigestSettings({ agentIds: 'a', emails: [] })).toBeNull();
  });
});

describe('weekly digest run', () => {
  type Args<K extends keyof WeeklyDigestDeps> = Parameters<WeeklyDigestDeps[K]>;

  const now = new Date('2026-11-18T15:00:00Z');
  const windows = digestWindows(weekBoundary(now));
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
      updateUser: jest.fn<Promise<IUser | null>, Args<'updateUser'>>(async () => null),
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
      sendWeeklyDigest: jest.fn<Promise<void>, Args<'sendWeeklyDigest'>>(async () => undefined),
    };
  }

  it('builds one card per picked agent still in scope, summarizing only busy ones', async () => {
    const d = deps();
    const email = await buildWeeklyDigest(d, subscriber, now);
    expect(email?.emails).toEqual(['prof@illinois.edu', 'ta@illinois.edu']);
    expect(email?.weekLabel).toBe('Nov 9 – Nov 15');
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
        until: new Date('2026-11-16T14:00:00Z'),
      }),
    );
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

  it('sends due digests once and marks them; a second pass the same week sends nothing', async () => {
    const d = deps();
    expect(await sendWeeklyDigests(d, now)).toBe(1);
    expect(d.sendWeeklyDigest).toHaveBeenCalledTimes(1);
    expect(d.updateUser).toHaveBeenCalledWith(String(subscriber._id), {
      weeklyDigest: expect.objectContaining({ lastSentAt: now }),
    });
    d.findUsers.mockResolvedValueOnce([
      {
        ...subscriber,
        weeklyDigest: { agentIds: ['agent_a'], emails: ['prof@illinois.edu'], lastSentAt: now },
      } as IUser,
    ]);
    expect(await sendWeeklyDigests(d, now)).toBe(0);
    expect(d.sendWeeklyDigest).toHaveBeenCalledTimes(1);
  });

  it('marks without sending when no picked agent is in scope any more', async () => {
    const d = deps();
    d.findAgents.mockResolvedValue([]);
    expect(await sendWeeklyDigests(d, now)).toBe(0);
    expect(d.sendWeeklyDigest).not.toHaveBeenCalled();
    expect(d.updateUser).toHaveBeenCalled();
  });

  it('leaves a failed send unmarked so the next pass retries', async () => {
    const d = deps();
    d.sendWeeklyDigest.mockRejectedValueOnce(new Error('ACS down'));
    expect(await sendWeeklyDigests(d, now)).toBe(0);
    expect(d.updateUser).not.toHaveBeenCalled();
  });
});
