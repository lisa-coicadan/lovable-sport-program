import { AppData } from './types';

const REMINDER_INTERVAL_DAYS = 21;
const SNOOZE_DAYS = 7;

function toISODate(d: Date): string {
  return d.toISOString().split('T')[0];
}

function daysBetween(fromISO: string, toDate: Date): number {
  const from = new Date(fromISO + 'T00:00:00');
  return Math.floor((toDate.getTime() - from.getTime()) / 86_400_000);
}

export function shouldShowBodyweightReminder(
  data: Pick<AppData, 'bodyWeightLogs' | 'bodyweightReminderSnoozedUntil'>,
  now = new Date()
): boolean {
  const todayISO = toISODate(now);
  if (data.bodyweightReminderSnoozedUntil && data.bodyweightReminderSnoozedUntil > todayISO) {
    return false;
  }
  const logs = data.bodyWeightLogs || [];
  if (logs.length === 0) return true;
  const latest = logs.reduce((a, b) => (a.date > b.date ? a : b));
  return daysBetween(latest.date, now) >= REMINDER_INTERVAL_DAYS;
}

export function buildBodyweightReminderSnoozePatch(now = new Date()): Pick<AppData, 'bodyweightReminderSnoozedUntil'> {
  const snoozeDate = new Date(now);
  snoozeDate.setDate(snoozeDate.getDate() + SNOOZE_DAYS);
  return { bodyweightReminderSnoozedUntil: toISODate(snoozeDate) };
}

// "Dernier : X kg" caption in Réglages — precise enough to be useful (days under a week,
// weeks+days up to a month) without turning into visual noise once it's been a while (past
// ~4 weeks, day-level precision stops being meaningful and just clutters the label).
export function formatDaysSince(dateISO: string, now = new Date()): string {
  const days = daysBetween(dateISO, now);
  if (days <= 0) return 'aujourd\'hui';
  if (days === 1) return 'hier';
  if (days < 7) return `il y a ${days} jours`;
  const weeks = Math.floor(days / 7);
  const remDays = days % 7;
  if (remDays === 0 || weeks >= 4) return `il y a ${weeks} sem`;
  return `il y a ${weeks} sem, ${remDays} jours`;
}
