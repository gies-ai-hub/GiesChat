import { z } from 'zod';
import { logger, runAsSystem } from '@librechat/data-schemas';
import type { AdminAnalyticsResponse } from 'librechat-data-provider';
import type { IAgent, IUser } from '@librechat/data-schemas';
import type { AdminUsageDeps, DigestSchedule } from './usage';
import type { TopicsModel } from './topics';
import { findDashboardAgents, isDigestOn, digestSchedule } from './usage';
import { askJsonModel, numberMessages } from './topics';
import { toAnalyticsBody } from './analytics';
import { isLeader } from '~/cluster';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const WINDOW_COUNT = 4;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** One week of activity: `since` inclusive, `until` exclusive. */
export interface DigestWindow {
  since: Date;
  until: Date;
}

const formats = new Map<string, Intl.DateTimeFormat>();

/** One formatter per zone and style, kept: building them is the slow part of a sweep. */
function formatFor(timeZone: string, style: 'wall' | 'day'): Intl.DateTimeFormat {
  const key = `${style}|${timeZone}`;
  let format = formats.get(key);
  if (!format) {
    format =
      style === 'wall'
        ? new Intl.DateTimeFormat('en-US', {
            timeZone,
            hourCycle: 'h23',
            weekday: 'short',
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
            second: 'numeric',
          })
        : new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric' });
    formats.set(key, format);
  }
  return format;
}

/** The wall clock in `timeZone` at `instant`, written as if it were UTC, and its weekday (0 = Sunday). */
function wallClock(instant: Date, timeZone: string): { wall: number; weekday: number } {
  const parts = Object.fromEntries(
    formatFor(timeZone, 'wall')
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
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

const offsetAt = (instant: Date, timeZone: string): number =>
  wallClock(instant, timeZone).wall - (instant.getTime() - instant.getUTCMilliseconds());

/**
 * The most recent send time on the schedule (`sendDay` at `sendHour`, in `timezone`) at or
 * before `now`. The UTC offset is taken at the boundary itself, not at `now`, so a week that
 * crosses a DST change still lands on the chosen hour.
 */
export function weekBoundary(now: Date, schedule: DigestSchedule): Date {
  const { wall, weekday } = wallClock(now, schedule.timezone);
  const daysSince = (weekday - schedule.sendDay + 7) % 7;
  let sendWall = wall - (wall % DAY_MS) - daysSince * DAY_MS + schedule.sendHour * HOUR_MS;
  if (sendWall > wall) {
    sendWall -= WEEK_MS;
  }
  const guess = new Date(sendWall - offsetAt(now, schedule.timezone));
  return new Date(sendWall - offsetAt(guess, schedule.timezone));
}

/** Four back-to-back weeks ending at `boundary`, newest first. */
export function digestWindows(boundary: Date): DigestWindow[] {
  // ponytail: fixed 7×24 h windows, so the week spanning a DST change is an hour off at one end.
  return Array.from({ length: WINDOW_COUNT }, (_, index) => ({
    since: new Date(boundary.getTime() - (index + 1) * WEEK_MS),
    until: new Date(boundary.getTime() - index * WEEK_MS),
  }));
}

/**
 * "Nov 6 – Nov 13": the local dates of the window's first and last moment. A Friday 5 PM week
 * runs from one Friday afternoon to the next, so both Fridays are named.
 */
export function weekLabel(window: DigestWindow, timeZone: string): string {
  const format = formatFor(timeZone, 'day');
  const lastMoment = new Date(window.until.getTime() - 1);
  return `${format.format(window.since)} – ${format.format(lastMoment)}`;
}

/** Someone with agents and addresses who has not been sent this week's email yet. */
export function isDigestDue(digest: IUser['weeklyDigest'], now: Date): boolean {
  if (!isDigestOn(digest)) {
    return false;
  }
  const boundary = weekBoundary(now, digestSchedule(digest));
  return digest?.lastSentAt == null || new Date(digest.lastSentAt) < boundary;
}

const SUMMARY_MAX = 800;

/**
 * A link, a domain, an address or a phone-length number. Any signed-in user can build an
 * agent, chat with it and list recipients who never asked for this email, so a paragraph that
 * could send a reader somewhere is dropped for "Summary unavailable" rather than mailed.
 */
const POINTS_ELSEWHERE =
  /https?:\/\/|www\.|@|\d{7,}|\b[a-z0-9-]+\.(?:com|net|org|edu|gov|io|co|me|info|biz|xyz|app|dev|ai|ly|us|link|site|online)\b/i;

const SUMMARY_PROMPT = `You write a short weekly note to a professor about one course assistant they built. You get that assistant's dashboard numbers for this week and last week as JSON, and a numbered sample of this week's student messages. Write 2 to 4 plain sentences: first the most notable change between the two weeks, then what students asked about, then one thing worth acting on, only if the data clearly supports it. Use only numbers that appear in the data. Never quote a message and never name or describe a person. Return only JSON of the form {"summary": string}.`;

const summarySchema = z.object({
  summary: z
    .string()
    .trim()
    .min(1)
    .max(SUMMARY_MAX)
    .refine((text) => !POINTS_ELSEWHERE.test(text), 'summary points recipients elsewhere'),
});

/** One agent's week as the dashboard charts it, plus the four-week conversation trend. */
export interface AgentWeekFacts {
  name: string;
  description: string;
  thisWeek: AdminAnalyticsResponse;
  lastWeek: AdminAnalyticsResponse;
  /** Conversations per week, oldest → newest. */
  weeklyConversations: number[];
}

const percent = (share: number): number => Math.round(share * 100);

/**
 * The charts as the model reads them. Rates become whole percentages, the way the dashboard
 * shows them, so the paragraph says "50%" rather than "0.5". `enrolledStudents` is left out:
 * without a class filter it only restates `activeStudents`.
 */
const chartsOf = ({
  enrolledStudents: _enrolled,
  returnRate,
  oneTurnShare,
  errorRate,
  ...charts
}: AdminAnalyticsResponse) => ({
  ...charts,
  returnRatePercent: percent(returnRate),
  oneTurnPercent: percent(oneTurnShare),
  errorRatePercent: percent(errorRate),
});

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

const DEFAULT_INTERVAL_MS = HOUR_MS;
const DIGEST_SAMPLE_LIMIT = 100;
const TREND_MIN_PX = 3;
const TREND_MAX_PX = 22;
const THIS_WEEK = WINDOW_COUNT - 1;
const LAST_WEEK = WINDOW_COUNT - 2;
const TONE_COLORS = { up: '#15803d', down: '#b91c1c', flat: '#666666' } as const;

/** "▲ 6", "▼ 1" or "same", with the colour the email paints it. */
export interface ChangeLabel {
  text: string;
  tone: keyof typeof TONE_COLORS;
  color: string;
}

export interface DigestAgentCard {
  name: string;
  conversations: number;
  conversationsChange: ChangeLabel;
  students: number;
  studentsChange: ChangeLabel;
  /** Conversations per week, oldest → newest, with a bar height in px for the email. */
  trend: { value: number; height: number }[];
  /** `null` when the week was quiet or the model failed; the numbers still go out. */
  summary: string | null;
  sampleSize: number;
  quiet: boolean;
}

export interface WeeklyDigestEmail {
  emails: string[];
  ownerName: string;
  weekLabel: string;
  headline: string;
  agents: DigestAgentCard[];
}

export type WeeklyDigestDeps = Pick<
  AdminUsageDeps,
  | 'findUsers'
  | 'findAgents'
  | 'findAccessibleResources'
  | 'aggregateAgentAnalytics'
  | 'sampleStudentMessages'
  | 'resolveTopicsModel'
> & {
  /** Stamps `lastSentAt` only while it is before `boundary`; `false` means another pass owns the week. */
  claimWeeklyDigest: (userId: string, boundary: Date, at: Date) => Promise<boolean>;
  /** Puts back the previous stamp after a failed send, unless something newer replaced the claim. */
  releaseWeeklyDigest: (userId: string, claimedAt: Date, previous: Date | null) => Promise<void>;
  /** Sends one email per address; a failed address is logged there, not thrown. */
  sendWeeklyDigest: (email: WeeklyDigestEmail) => Promise<void>;
};

export function changeLabel(now: number, before: number): ChangeLabel {
  const delta = now - before;
  if (delta === 0) {
    return { text: 'same', tone: 'flat', color: TONE_COLORS.flat };
  }
  const tone = delta > 0 ? 'up' : 'down';
  return { text: `${delta > 0 ? '▲' : '▼'} ${Math.abs(delta)}`, tone, color: TONE_COLORS[tone] };
}

function toTrend(values: number[]): DigestAgentCard['trend'] {
  const max = Math.max(...values);
  return values.map((value) => ({
    value,
    height:
      max === 0 ? TREND_MIN_PX : Math.max(TREND_MIN_PX, Math.round((value / max) * TREND_MAX_PX)),
  }));
}

function headline(total: number, before: number, agentCount: number): string {
  const delta = total - before;
  const change =
    delta === 0
      ? 'the same as last week'
      : `${delta > 0 ? 'up' : 'down'} ${Math.abs(delta)} from last week`;
  const conversations = total === 1 ? 'conversation' : 'conversations';
  const agents = agentCount === 1 ? 'agent' : 'agents';
  return `${total} ${conversations} across the ${agentCount} ${agents} you picked, ${change}.`;
}

async function buildCard(
  deps: WeeklyDigestDeps,
  agent: IAgent,
  windows: DigestWindow[],
  llm: TopicsModel | null,
): Promise<DigestAgentCard> {
  const scopeOf = (window: DigestWindow) => ({
    agentIds: [agent.id],
    userIds: null,
    since: window.since,
    until: window.until,
  });
  const [messages, ...raws] = await Promise.all([
    deps.sampleStudentMessages(scopeOf(windows[0]), DIGEST_SAMPLE_LIMIT),
    ...windows.map((window) => deps.aggregateAgentAnalytics(scopeOf(window))),
  ]);
  const [thisWeek, lastWeek] = [0, 1].map((index) =>
    toAnalyticsBody(raws[index], windows[index], raws[index].activeStudents),
  );
  const weeklyConversations = raws.map((week) => week.conversationCount).reverse();
  const quiet = thisWeek.conversationCount === 0;

  let summary: string | null = null;
  if (!quiet && llm) {
    summary = await summarizeAgentWeek(
      {
        name: agent.name ?? '',
        description: agent.description ?? '',
        thisWeek,
        lastWeek,
        weeklyConversations,
      },
      messages,
      llm,
    ).catch((error: unknown) => {
      logger.warn(`[digest] summary failed for ${agent.id}`, error);
      return null;
    });
  }

  return {
    name: agent.name ?? '',
    conversations: thisWeek.conversationCount,
    conversationsChange: changeLabel(thisWeek.conversationCount, lastWeek.conversationCount),
    students: thisWeek.activeStudents,
    studentsChange: changeLabel(thisWeek.activeStudents, lastWeek.activeStudents),
    trend: toTrend(weeklyConversations),
    summary,
    sampleSize: quiet ? 0 : messages.length,
    quiet,
  };
}

/**
 * The subscriber's picked agents, re-checked against their dashboard scope, as one email.
 * `null` when none of them is still theirs to see.
 */
export async function buildWeeklyDigest(
  deps: WeeklyDigestDeps,
  user: IUser,
  now: Date,
): Promise<WeeklyDigestEmail | null> {
  const scoped = await findDashboardAgents(deps, user, undefined, 'id name description');
  const byId = new Map(scoped.map((agent) => [agent.id, agent]));
  const agents = (user.weeklyDigest?.agentIds ?? []).flatMap((id) => {
    const agent = byId.get(id);
    return agent ? [agent] : [];
  });
  if (agents.length === 0) {
    return null;
  }

  const schedule = digestSchedule(user.weeklyDigest);
  const windows = digestWindows(weekBoundary(now, schedule));
  const llm = await deps.resolveTopicsModel();
  // ponytail: 4 aggregations per agent per week, agents one after another; batch by `$facet` per window if subscribers grow past a few dozen.
  const cards: DigestAgentCard[] = [];
  for (const agent of agents) {
    cards.push(await buildCard(deps, agent, windows, llm));
  }

  const total = (week: number) => cards.reduce((sum, card) => sum + card.trend[week].value, 0);
  return {
    emails: user.weeklyDigest?.emails ?? [],
    ownerName: user.name || user.email,
    weekLabel: weekLabel(windows[0], schedule.timezone),
    headline: headline(total(THIS_WEEK), total(LAST_WEEK), cards.length),
    agents: cards,
  };
}

/**
 * Sends every subscriber whose week is due. Each one is claimed first with a conditional
 * stamp, so two passes or two servers never both send, and the dialog's saves never touch
 * the stamp. A subscriber with no agents left keeps the claim and gets no email, so the
 * sweep stops retrying; a failed send releases it so the next pass tries again.
 */
export async function sendWeeklyDigests(deps: WeeklyDigestDeps, now: Date): Promise<number> {
  const users = await deps.findUsers(
    { 'weeklyDigest.emails.0': { $exists: true } },
    '_id name email role weeklyDigest',
  );
  let sent = 0;
  for (const user of users.filter((candidate) => isDigestDue(candidate.weeklyDigest, now))) {
    const userId = String(user._id);
    const boundary = weekBoundary(now, digestSchedule(user.weeklyDigest));
    if (!(await deps.claimWeeklyDigest(userId, boundary, now))) {
      continue;
    }
    try {
      const email = await buildWeeklyDigest(deps, user, now);
      if (email) {
        await deps.sendWeeklyDigest(email);
        sent += 1;
      }
    } catch (error) {
      logger.warn(`[digest] weekly email for ${userId} failed; retrying next pass`, error);
      await deps
        .releaseWeeklyDigest(userId, now, user.weeklyDigest?.lastSentAt ?? null)
        .catch((releaseError: unknown) =>
          logger.error(`[digest] could not release ${userId}'s claim`, releaseError),
        );
    }
  }
  return sent;
}

/** Hourly, leader only, never overlapping. `WEEKLY_DIGEST_INTERVAL_MS=0` turns it off. */
export function startWeeklyDigest(deps: WeeklyDigestDeps): NodeJS.Timeout | null {
  const intervalMs = Number(process.env.WEEKLY_DIGEST_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);
  if (!intervalMs) {
    logger.info('[digest] Weekly agent emails disabled by WEEKLY_DIGEST_INTERVAL_MS=0');
    return null;
  }
  let running = false;
  const run = async () => {
    if (running || !(await isLeader())) {
      return;
    }
    running = true;
    try {
      const sent = await runAsSystem(() => sendWeeklyDigests(deps, new Date()));
      if (sent > 0) {
        logger.info(`[digest] emailed ${sent} subscriber(s) their weekly agent summary`);
      }
    } catch (error) {
      logger.error('[digest] weekly email pass failed', error);
    } finally {
      running = false;
    }
  };
  const interval = setInterval(run, intervalMs);
  interval.unref?.();
  return interval;
}
