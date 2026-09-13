export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function isSameDay(a: Date, b: Date): boolean {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}

// 6 rows x 7 cols, null padding cells before day 1 / after the last day.
export function monthMatrix(year: number, month: number): (Date | null)[][] {
  const firstDay = new Date(year, month, 1);
  const startWeekday = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (Date | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export function formatDateLong(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatMonthYear(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export type TimeSlot = { label: string; hour: number; minute: number };

// 30-minute slots for the given date; when that date is today, slots at or
// before the current time are excluded (no picking a time already passed).
export function timeSlotsFor(forDate: Date, now: Date): TimeSlot[] {
  const slots: TimeSlot[] = [];
  const sameDay = isSameDay(forDate, now);
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 30) {
      if (sameDay) {
        const candidate = new Date(forDate.getFullYear(), forDate.getMonth(), forDate.getDate(), h, m);
        if (candidate.getTime() <= now.getTime()) continue;
      }
      const period = h < 12 ? 'AM' : 'PM';
      const h12 = h % 12 === 0 ? 12 : h % 12;
      slots.push({ label: `${h12}:${m.toString().padStart(2, '0')} ${period}`, hour: h, minute: m });
    }
  }
  return slots;
}
