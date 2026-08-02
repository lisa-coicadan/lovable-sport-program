import { describe, it, expect } from 'vitest';
import { shouldShowBodyweightReminder, buildBodyweightReminderSnoozePatch } from './bodyweightReminder';

describe('shouldShowBodyweightReminder', () => {
  it('shows the reminder when there are no logs at all', () => {
    expect(shouldShowBodyweightReminder({ bodyWeightLogs: [] })).toBe(true);
  });

  it('hides the reminder when the latest log is recent', () => {
    const now = new Date('2026-08-02T12:00:00');
    const data = { bodyWeightLogs: [{ date: '2026-07-20', weight: 60 }] };
    expect(shouldShowBodyweightReminder(data, now)).toBe(false);
  });

  it('shows the reminder once the latest log is 30+ days old', () => {
    const now = new Date('2026-08-02T12:00:00');
    const data = { bodyWeightLogs: [{ date: '2026-07-01', weight: 60 }] };
    expect(shouldShowBodyweightReminder(data, now)).toBe(true);
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
