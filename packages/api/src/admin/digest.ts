import { z } from 'zod';
import type { AdminAnalyticsResponse } from 'librechat-data-provider';
import type { IUser } from '@librechat/data-schemas';
import type { TopicsModel } from './topics';
import { askJsonModel, numberMessages } from './topics';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const DIGEST_HOUR = 8;
const WINDOW_COUNT = 4;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const DIGEST_TIMEZONE = 'America/Chicago';

/** One week of activity: `since` inclusive, `until` exclusive. */
export interface DigestWindow {
  since: Date;
  until: Date;
}

const wallClockFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: DIGEST_TIMEZONE,
  hourCycle: 'h23',
  weekday: 'short',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
});

const dayFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: DIGEST_TIMEZONE,
  month: 'short',
  day: 'numeric',
});

/** Chicago's wall clock at `instant`, written as if it were UTC, and its weekday (0 = Sunday). */
function chicagoWall(instant: Date): { wall: number; weekday: number } {
  const parts = Object.fromEntries(
    wallClockFormat.formatToParts(instant).map((part) => [part.type, part.value]),
  );
  const wall = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return { wall, weekday: WEEKDAYS.indexOf(parts.weekday) };
}

const offsetAt = (instant: Date): number =>
  chicagoWall(instant).wall - (instant.getTime() - instant.getUTCMilliseconds());

/**
 * The most recent Monday 8 AM in Chicago at or before `now`. The UTC offset is taken at
 * the boundary itself, not at `now`, so a week that crosses a DST change still lands on 8 AM.
 */
export function weekBoundary(now: Date): Date {
  const { wall, weekday } = chicagoWall(now);
  const daysSinceMonday = (weekday + 6) % 7;
  let mondayWall = wall - (wall % DAY_MS) - daysSinceMonday * DAY_MS + DIGEST_HOUR * HOUR_MS;
  if (mondayWall > wall) {
    mondayWall -= WEEK_MS;
  }
  const guess = new Date(mondayWall - offsetAt(now));
  return new Date(mondayWall - offsetAt(guess));
}

/** Four back-to-back weeks ending at `boundary`, newest first. */
export function digestWindows(boundary: Date): DigestWindow[] {
  // ponytail: fixed 7×24 h windows, so the week spanning a DST change is an hour off at one end.
  return Array.from({ length: WINDOW_COUNT }, (_, index) => ({
    since: new Date(boundary.getTime() - (index + 1) * WEEK_MS),
    until: new Date(boundary.getTime() - index * WEEK_MS),
  }));
}

/** "Nov 9 – Nov 15": a Monday-8-AM-to-Monday-8-AM week reads as Monday through Sunday. */
export function weekLabel(window: DigestWindow): string {
  const lastDay = new Date(window.until.getTime() - DAY_MS);
  return `${dayFormat.format(window.since)} – ${dayFormat.format(lastDay)}`;
}

/** Someone with agents and addresses who has not been sent this week's email yet. */
export function isDigestDue(digest: IUser['weeklyDigest'], now: Date): boolean {
  if (!digest?.emails?.length || !digest.agentIds?.length) {
    return false;
  }
  return digest.lastSentAt == null || new Date(digest.lastSentAt) < weekBoundary(now);
}

const SUMMARY_MAX = 800;

const SUMMARY_PROMPT = `You write a short weekly note to a professor about one course assistant they built. You get that assistant's dashboard numbers for this week and last week as JSON, and a numbered sample of this week's student messages. Write 2 to 4 plain sentences: first the most notable change between the two weeks, then what students asked about, then one thing worth acting on, only if the data clearly supports it. Use only numbers that appear in the data. Never quote a message and never name or describe a person. Return only JSON of the form {"summary": string}.`;

const summarySchema = z.object({ summary: z.string().trim().min(1).max(SUMMARY_MAX) });

/** One agent's week as the dashboard charts it, plus the four-week conversation trend. */
export interface AgentWeekFacts {
  name: string;
  description: string;
  thisWeek: AdminAnalyticsResponse;
  lastWeek: AdminAnalyticsResponse;
  /** Conversations per week, oldest → newest. */
  weeklyConversations: number[];
}

/** `enrolledStudents` only restates `activeStudents` without a class filter. */
const chartsOf = ({ enrolledStudents: _enrolled, ...charts }: AdminAnalyticsResponse) => charts;

/**
 * The model reads the dashboard's own chart data and authorless message text, and writes
 * prose only: the numbers in the email are rendered from the aggregation, never from this.
 */
export async function summarizeAgentWeek(
  facts: AgentWeekFacts,
  messages: string[],
  llm: TopicsModel,
): Promise<string> {
  const data = {
    agent: { name: facts.name, description: facts.description },
    thisWeek: chartsOf(facts.thisWeek),
    lastWeek: chartsOf(facts.lastWeek),
    weeklyConversations: facts.weeklyConversations,
  };
  const raw = await askJsonModel(
    llm,
    SUMMARY_PROMPT,
    `Dashboard data:\n${JSON.stringify(data)}\n\n${messages.length} student messages:\n${numberMessages(messages)}`,
  );
  return summarySchema.parse(raw).summary;
}
