import {
  toBuckets,
  zeroFillDays,
  toAnalyticsBody,
  medianFromDistribution,
  TURN_BUCKETS,
  REACH_BUCKETS,
} from './analytics';

describe('toAnalyticsBody', () => {
  it('shapes raw analytics the way the dashboard draws them', () => {
    const body = toAnalyticsBody(
      {
        conversationCount: 4,
        activeStudents: 2,
        returningStudents: 1,
        assistantMessageCount: 10,
        erroredMessageCount: 1,
        turnDistribution: [
          { turns: 1, conversations: 2 },
          { turns: 5, conversations: 2 },
        ],
        studentDistribution: [{ conversations: 2, students: 2 }],
        daily: [{ date: '2026-11-10', conversations: 4 }],
      },
      { since: new Date('2026-11-10T14:00:00Z'), until: new Date('2026-11-12T14:00:00Z') },
      2,
    );
    expect(body).toMatchObject({
      activeStudents: 2,
      enrolledStudents: 2,
      conversationCount: 4,
      returnRate: 0.5,
      oneTurnShare: 0.5,
      errorRate: 0.1,
    });
    expect(body.dailyActivity.map((point) => point.conversationCount)).toEqual([4, 0, 0]);
  });
});

describe('medianFromDistribution', () => {
  it('returns 0 for an empty distribution', () => {
    expect(medianFromDistribution([], 'turns', 'conversations')).toBe(0);
  });

  it('picks the middle value of an odd count', () => {
    const distribution = [
      { turns: 1, conversations: 1 },
      { turns: 4, conversations: 1 },
      { turns: 9, conversations: 1 },
    ];
    expect(medianFromDistribution(distribution, 'turns', 'conversations')).toBe(4);
  });

  it('averages the two middle values of an even count', () => {
    const distribution = [
      { turns: 2, conversations: 1 },
      { turns: 5, conversations: 1 },
    ];
    expect(medianFromDistribution(distribution, 'turns', 'conversations')).toBe(3.5);
  });

  it('respects repeated values', () => {
    const distribution = [
      { turns: 1, conversations: 5 },
      { turns: 8, conversations: 1 },
    ];
    expect(medianFromDistribution(distribution, 'turns', 'conversations')).toBe(1);
  });

  it('does not assume the distribution arrives sorted', () => {
    const distribution = [
      { turns: 9, conversations: 1 },
      { turns: 1, conversations: 1 },
      { turns: 4, conversations: 1 },
    ];
    expect(medianFromDistribution(distribution, 'turns', 'conversations')).toBe(4);
  });
});

describe('toBuckets', () => {
  it('places values at their bucket edges', () => {
    const distribution = [
      { turns: 1, conversations: 3 },
      { turns: 2, conversations: 4 },
      { turns: 3, conversations: 1 },
      { turns: 5, conversations: 2 },
      { turns: 9, conversations: 1 },
      { turns: 40, conversations: 1 },
    ];
    expect(toBuckets(distribution, 'turns', 'conversations', TURN_BUCKETS)).toEqual([
      { label: '1', count: 3 },
      { label: '2', count: 4 },
      { label: '3', count: 1 },
      { label: '4–5', count: 2 },
      { label: '6–9', count: 1 },
      { label: '10+', count: 1 },
    ]);
  });

  it('sums several values that share a bucket', () => {
    const distribution = [
      { conversations: 2, students: 3 },
      { conversations: 4, students: 5 },
    ];
    expect(toBuckets(distribution, 'conversations', 'students', REACH_BUCKETS)).toEqual([
      { label: '1', count: 0 },
      { label: '2–4', count: 8 },
      { label: '5–9', count: 0 },
      { label: '10+', count: 0 },
    ]);
  });

  it('returns zeroed buckets for an empty distribution', () => {
    expect(toBuckets([], 'conversations', 'students', REACH_BUCKETS)).toEqual([
      { label: '1', count: 0 },
      { label: '2–4', count: 0 },
      { label: '5–9', count: 0 },
      { label: '10+', count: 0 },
    ]);
  });

  it('drops values below the first bucket rather than miscounting them', () => {
    const distribution = [
      { turns: 0, conversations: 7 },
      { turns: 2, conversations: 1 },
    ];
    const buckets = toBuckets(distribution, 'turns', 'conversations', TURN_BUCKETS);
    expect(buckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(1);
  });
});

describe('zeroFillDays', () => {
  it('fills gaps between the window start and end', () => {
    const filled = zeroFillDays(
      [{ date: '2026-07-02', conversations: 2 }],
      new Date('2026-07-01T00:00:00.000Z'),
      new Date('2026-07-03T00:00:00.000Z'),
    );
    expect(filled).toEqual([
      { date: '2026-07-01', conversationCount: 0 },
      { date: '2026-07-02', conversationCount: 2 },
      { date: '2026-07-03', conversationCount: 0 },
    ]);
  });

  it('spans month boundaries', () => {
    const filled = zeroFillDays(
      [],
      new Date('2026-06-30T18:00:00.000Z'),
      new Date('2026-07-01T06:00:00.000Z'),
    );
    expect(filled.map((point) => point.date)).toEqual(['2026-06-30', '2026-07-01']);
  });

  it('returns a single day when the window opens and closes on one date', () => {
    const filled = zeroFillDays(
      [{ date: '2026-07-01', conversations: 5 }],
      new Date('2026-07-01T01:00:00.000Z'),
      new Date('2026-07-01T23:00:00.000Z'),
    );
    expect(filled).toEqual([{ date: '2026-07-01', conversationCount: 5 }]);
  });
});
