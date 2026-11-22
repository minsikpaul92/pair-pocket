// Run: node scripts/check-trend-buckets.ts  (Node 22+ strips types)
import assert from "node:assert/strict";
// @ts-ignore Node strips types and needs the .ts extension
import { trendBuckets } from "../lib/trend-buckets.ts";

const span = (b: { start: string; end: string }[]) => b.map((x) => `${x.start}..${x.end}`);

// Week: Sun 2026-09-27 .. Sat 2026-10-03 crosses a month boundary.
const week = trendBuckets("week", new Date(2026, 9, 1), new Date(2026, 8, 27));
assert.equal(week.length, 7);
assert.equal(week[0].start, "2026-09-27");
assert.equal(week[3].start, "2026-09-30");
assert.equal(week[6].end, "2026-10-03");

// Month by week: October 2026 starts on Thursday, ends on Saturday.
assert.deepEqual(span(trendBuckets(1, new Date(2026, 9, 1), new Date())), [
  "2026-10-01..2026-10-03",
  "2026-10-04..2026-10-10",
  "2026-10-11..2026-10-17",
  "2026-10-18..2026-10-24",
  "2026-10-25..2026-10-31",
]);
// Month starting on Sunday (Feb 2026 is Sun..Sat, 4 full weeks) and a month ending mid-week.
assert.equal(trendBuckets(1, new Date(2026, 1, 1), new Date()).length, 4);
const nov = trendBuckets(1, new Date(2026, 10, 1), new Date());
assert.equal(nov[0].start, "2026-11-01");
assert.equal(nov.at(-1)!.end, "2026-11-30");
assert.equal(nov.at(-1)!.start, "2026-11-29");

// Months: quarter ending January crosses the year boundary; leap-year February.
assert.deepEqual(span(trendBuckets(3, new Date(2027, 0, 1), new Date())), [
  "2026-11-01..2026-11-30",
  "2026-12-01..2026-12-31",
  "2027-01-01..2027-01-31",
]);
assert.equal(trendBuckets(1, new Date(2028, 1, 1), new Date()).at(-1)!.end, "2028-02-29");
assert.equal(trendBuckets(12, new Date(2026, 10, 1), new Date())[0].start, "2025-12-01");

console.log("trend buckets ok");
