import { weekLabel, weekBoundary, isDigestDue, digestWindows } from './digest';
import { parseDigestSettings } from './usage';

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
