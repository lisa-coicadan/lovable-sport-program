import { describe, it, expect } from 'vitest';
import { shouldShowBodyweightReminder, buildBodyweightReminderSnoozePatch, formatDaysSince } from './bodyweightReminder';

describe('shouldShowBodyweightReminder', () => {
  it('shows the reminder when there are no logs at all', () => {
    expect(shouldShowBodyweightReminder({ bodyWeightLogs: [] })).toBe(true);
  });

  it('hides the reminder when the latest log is recent', () => {
    const now = new Date('2026-08-02T12:00:00');
    const data = { bodyWeightLogs: [{ date: '2026-07-20', weight: 60 }] };
    expect(shouldShowBodyweightReminder(data, now)).toBe(false);
  });

  it('shows the reminder once the latest log is 21+ days old', () => {
    const now = new Date('2026-08-02T12:00:00');
    const data = { bodyWeightLogs: [{ date: '2026-07-01', weight: 60 }] };
    expect(shouldShowBodyweightReminder(data, now)).toBe(true);
  });

  it('stays hidden just under the 21-day mark, shows right at it', () => {
    const data = { bodyWeightLogs: [{ date: '2026-07-12', weight: 60 }] };
    expect(shouldShowBodyweightReminder(data, new Date('2026-08-01T12:00:00'))).toBe(false); // 20 days
    expect(shouldShowBodyweightReminder(data, new Date('2026-08-02T12:00:00'))).toBe(true); // 21 days
  });

  it('picks the most recent log when several exist', () => {
    const now = new Date('2026-08-02T12:00:00');
    const data = {
      bodyWeightLogs: [
        { date: '2026-01-01', weight: 62 },
        { date: '2026-07-25', weight: 60 },
      ],
    };
    expect(shouldShowBodyweightReminder(data, now)).toBe(false);
  });

  it('stays hidden while snoozed even if the interval elapsed', () => {
    const now = new Date('2026-08-02T12:00:00');
    const data = {
      bodyWeightLogs: [{ date: '2026-07-01', weight: 60 }],
      bodyweightReminderSnoozedUntil: '2026-08-05',
    };
    expect(shouldShowBodyweightReminder(data, now)).toBe(false);
  });

  it('shows again once the snooze date has passed', () => {
    const now = new Date('2026-08-06T12:00:00');
    const data = {
      bodyWeightLogs: [{ date: '2026-07-01', weight: 60 }],
      bodyweightReminderSnoozedUntil: '2026-08-05',
    };
    expect(shouldShowBodyweightReminder(data, now)).toBe(true);
  });
});

describe('buildBodyweightReminderSnoozePatch', () => {
  it('snoozes 7 days ahead', () => {
    const now = new Date('2026-08-02T12:00:00');
    expect(buildBodyweightReminderSnoozePatch(now)).toEqual({ bodyweightReminderSnoozedUntil: '2026-08-09' });
  });
});

describe('formatDaysSince', () => {
  const now = new Date('2026-08-11T12:00:00');

  it('says "aujourd\'hui" / "hier" for the first two days', () => {
    expect(formatDaysSince('2026-08-11', now)).toBe('aujourd\'hui');
    expect(formatDaysSince('2026-08-10', now)).toBe('hier');
  });

  it('counts in plain days under a week', () => {
    expect(formatDaysSince('2026-08-06', now)).toBe('il y a 5 jours');
  });

  it('switches to weeks (+ leftover days) from a week on, up to a month', () => {
    expect(formatDaysSince('2026-08-04', now)).toBe('il y a 1 sem'); // exactly 7 days
    expect(formatDaysSince('2026-07-28', now)).toBe('il y a 2 sem'); // exactly 14 days
    expect(formatDaysSince('2026-07-25', now)).toBe('il y a 2 sem, 3 jours'); // 17 days
  });

  it('drops the leftover days past ~4 weeks to avoid false precision', () => {
    expect(formatDaysSince('2026-07-01', now)).toBe('il y a 5 sem'); // 41 days, would be 5w6d
  });
});
