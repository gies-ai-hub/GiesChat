import type { AdminAnalyticsResponse } from 'librechat-data-provider';
import type { AgentAnalyticsRaw } from './usage';

export interface BucketEdge {
  label: string;
  /** Inclusive lower bound. */
  min: number;
  /** Inclusive upper bound; `Infinity` for the open-ended top bucket. */
  max: number;
}

/** Turns per conversation. A one-turn conversation is its own bucket: it is the signal. */
export const TURN_BUCKETS: BucketEdge[] = [
  { label: '1', min: 1, max: 1 },
  { label: '2', min: 2, max: 2 },
  { label: '3', min: 3, max: 3 },
  { label: '4–5', min: 4, max: 5 },
  { label: '6–9', min: 6, max: 9 },
  { label: '10+', min: 10, max: Infinity },
];

/** Conversations per student. */
export const REACH_BUCKETS: BucketEdge[] = [
  { label: '1', min: 1, max: 1 },
  { label: '2–4', min: 2, max: 4 },
  { label: '5–9', min: 5, max: 9 },
  { label: '10+', min: 10, max: Infinity },
];

export interface AnalyticsBucket {
  label: string;
  count: number;
}

export interface DailyPoint {
  date: string;
  conversationCount: number;
}

/**
 * Collapses a `{ value, weight }` distribution into fixed buckets. Every bucket is
 * present even at zero, so the chart keeps a stable x-axis between windows.
 */
export function toBuckets<V extends string, W extends string>(
  distribution: Array<Record<V | W, number>>,
  valueKey: V,
  weightKey: W,
  edges: BucketEdge[],
): AnalyticsBucket[] {
  const counts = new Map<string, number>(edges.map((edge) => [edge.label, 0]));
  for (const entry of distribution) {
    const value = entry[valueKey];
    const edge = edges.find((candidate) => value >= candidate.min && value <= candidate.max);
    if (edge === undefined) {
      continue;
    }
    counts.set(edge.label, (counts.get(edge.label) ?? 0) + entry[weightKey]);
  }
  return edges.map((edge) => ({ label: edge.label, count: counts.get(edge.label) ?? 0 }));
}

/**
 * Exact median over a weighted distribution — the values arrive already grouped,
 * so there is nothing to expand and no need for `$median` in the pipeline.
 */
export function medianFromDistribution<V extends string, W extends string>(
  distribution: Array<Record<V | W, number>>,
  valueKey: V,
  weightKey: W,
): number {
  const total = distribution.reduce((sum, entry) => sum + entry[weightKey], 0);
  if (total === 0) {
    return 0;
  }
  const sorted = [...distribution].sort((a, b) => a[valueKey] - b[valueKey]);
  const lowerIndex = Math.floor((total - 1) / 2);
  const upperIndex = Math.ceil((total - 1) / 2);

  let seen = 0;
  let lower: number | null = null;
  for (const entry of sorted) {
    seen += entry[weightKey];
    if (lower === null && seen > lowerIndex) {
      lower = entry[valueKey];
    }
    if (seen > upperIndex) {
      return lower === null ? entry[valueKey] : (lower + entry[valueKey]) / 2;
    }
  }
  return lower ?? 0;
}

/** A missing day means no activity, which the chart must draw as zero, not skip. */
export function zeroFillDays(
  daily: { date: string; conversations: number }[],
  since: Date,
  until: Date,
): DailyPoint[] {
  const byDate = new Map(daily.map((entry) => [entry.date, entry.conversations]));
  const points: DailyPoint[] = [];
  const cursor = new Date(
    Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate()),
  );
  const end = Date.UTC(until.getUTCFullYear(), until.getUTCMonth(), until.getUTCDate());

  while (cursor.getTime() <= end) {
    const date = cursor.toISOString().slice(0, 10);
    points.push({ date, conversationCount: byDate.get(date) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return points;
}

/** Guards a rate against a zero denominator so the dashboard never receives NaN. */
export function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

/**
 * Raw pipeline output → what the dashboard's analytics panels draw. The weekly digest
 * feeds the same shape to its summary, so the email and the charts cannot disagree.
 */
export function toAnalyticsBody(
  raw: AgentAnalyticsRaw,
  window: { since: Date; until: Date },
  enrolledStudents: number,
): AdminAnalyticsResponse {
  const oneTurnCount = raw.turnDistribution.find((entry) => entry.turns === 1)?.conversations ?? 0;
  return {
    activeStudents: raw.activeStudents,
    enrolledStudents,
    conversationCount: raw.conversationCount,
    medianTurns: medianFromDistribution(raw.turnDistribution, 'turns', 'conversations'),
    returnRate: rate(raw.returningStudents, raw.activeStudents),
    dailyActivity: zeroFillDays(raw.daily, window.since, window.until),
    reachBuckets: toBuckets(raw.studentDistribution, 'conversations', 'students', REACH_BUCKETS),
    depthBuckets: toBuckets(raw.turnDistribution, 'turns', 'conversations', TURN_BUCKETS),
    oneTurnShare: rate(oneTurnCount, raw.conversationCount),
    errorRate: rate(raw.erroredMessageCount, raw.assistantMessageCount),
  };
}
