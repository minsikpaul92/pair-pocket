export function monthKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseDate(iso: string | Date | null | undefined): Date {
  if (!iso) return new Date();
  if (iso instanceof Date) return isNaN(iso.getTime()) ? new Date() : iso;
  const str = String(iso).trim();
  if (!str || str === "null" || str === "undefined") return new Date();

  // Extract YYYY-MM-DD component to construct Date in local timezone without UTC shift
  const dateMatch = str.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (dateMatch) {
    const y = parseInt(dateMatch[1], 10);
    const m = parseInt(dateMatch[2], 10) - 1;
    const d = parseInt(dateMatch[3], 10);

    const timeMatch = str.match(/T(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
    if (timeMatch) {
      const hh = parseInt(timeMatch[1], 10);
      const mm = parseInt(timeMatch[2], 10);
      const ss = parseInt(timeMatch[3] || "0", 10);
      const localWithTime = new Date(y, m, d, hh, mm, ss);
      return isNaN(localWithTime.getTime()) ? new Date() : localWithTime;
    }

    const localDate = new Date(y, m, d);
    return isNaN(localDate.getTime()) ? new Date() : localDate;
  }

  const normalized = str.includes(" ") && !str.includes("T") ? str.replace(" ", "T") : str;
  const parsed = new Date(normalized);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
}

/** A scanned receipt date: today when it is missing or unreadable, never in the future. */
export function scanDate(raw: string | null | undefined): Date {
  const d = parseDate(raw);
  return d.getTime() > Date.now() ? new Date() : d;
}

export function isoDayKey(iso: string): string {
  // Transaction dates come back as ISO strings; take the local day key.
  return dayKey(parseDate(iso));
}

export function monthLabel(date: Date, locale = "ko"): string {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
  }).format(date);
}

export function addMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

/**
 * Build a 6-row (42 cell) calendar grid for the month containing `date`,
 * padded with the trailing/leading days so weeks are complete.
 * With `trimEmptyWeek`, weeks after the last day of the month are dropped
 * (4 to 6 rows).
 */
export function buildCalendarGrid(date: Date, trimEmptyWeek = false): Date[] {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay()); // back to Sunday

  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    cells.push(d);
  }
  if (!trimEmptyWeek) return cells;
  const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return cells.slice(0, Math.ceil((first.getDay() + daysInMonth) / 7) * 7);
}

export function isSameDay(a: Date, b: Date): boolean {
  return dayKey(a) === dayKey(b);
}

export function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

export function formatDayLabel(date: Date, locale = "ko"): string {
  return date.toLocaleDateString(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

export function addDays(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + delta);
}

/** Sunday that starts the Sunday–Saturday week containing `date` (local time). */
export function weekStart(date: Date): Date {
  return addDays(date, -date.getDay());
}
