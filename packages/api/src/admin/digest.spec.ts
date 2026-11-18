import type { AgentAnalyticsRaw } from './usage';
import type { AgentWeekFacts } from './digest';
import { weekLabel, weekBoundary, isDigestDue, digestWindows, summarizeAgentWeek } from './digest';
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
