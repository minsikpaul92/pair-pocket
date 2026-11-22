/**
 * X-axis buckets for the dashboard line chart. Each bucket is an inclusive
 * [start, end] day range that can be sent to /api/stats/summary as-is, so the
 * chart uses the same aggregation as the pie and the summary cards.
 * Weeks run Sunday to Saturday, like the rest of the dashboard.
 */
export type TrendUnit = "day" | "week" | "month";

export interface TrendBucket {
  unit: TrendUnit;
  /** Local date the bucket starts on (used for the axis label). */
  date: Date;
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
}

const pad = (n: number) => String(n).padStart(2, "0");
const key = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const plusDays = (d: Date, n: number) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

function bucket(unit: TrendUnit, from: Date, to: Date): TrendBucket {
  return { unit, date: from, start: key(from), end: key(to) };
}

/**
 * range "week": the 7 days of the week starting `weekStart`.
 * range 1: the weeks of `month`, clipped to the month's first and last day.
 * range 3 | 6 | 12: that many months ending at `month`.
 */
export function trendBuckets(
  range: "week" | 1 | 3 | 6 | 12,
  month: Date,
  weekStart: Date
): TrendBucket[] {
  if (range === "week") {
    return Array.from({ length: 7 }, (_, i) => {
      const d = plusDays(weekStart, i);
      return bucket("day", d, d);
    });
  }
  const y = month.getFullYear();
  const m = month.getMonth();
  if (range === 1) {
    const last = new Date(y, m + 1, 0);
    const out: TrendBucket[] = [];
    let from = new Date(y, m, 1);
    while (from <= last) {
      const sat = plusDays(from, 6 - from.getDay());
      out.push(bucket("week", from, sat < last ? sat : last));
      from = plusDays(sat, 1);
    }
    return out;
  }
  return Array.from({ length: range }, (_, i) => {
    const first = new Date(y, m - (range - 1 - i), 1);
    return bucket("month", first, new Date(first.getFullYear(), first.getMonth() + 1, 0));
  });
}
