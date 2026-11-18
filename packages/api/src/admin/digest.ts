import type { IUser } from '@librechat/data-schemas';

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
