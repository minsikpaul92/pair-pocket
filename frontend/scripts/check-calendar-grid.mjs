#!/usr/bin/env node
/**
 * Checks buildCalendarGrid row counts: 42 cells by default, and 4 to 6 rows
 * when the trailing empty week is trimmed.
 *
 * Usage: node scripts/check-calendar-grid.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = mkdtempSync(join(tmpdir(), "calendar-check-"));
execFileSync(
  join(root, "node_modules", ".bin", "tsc"),
  ["lib/date.ts", "--outDir", out, "--module", "commonjs", "--target", "es2020",
   "--skipLibCheck", "--strict"],
  { cwd: root, stdio: "inherit" }
);
const { buildCalendarGrid } = createRequire(import.meta.url)(join(out, "date.js"));

const rows = (y, m) => buildCalendarGrid(new Date(y, m, 1), true).length / 7;
assert.equal(rows(2026, 1), 4); // Feb 2026: starts Sunday, 28 days
assert.equal(rows(2026, 11), 5); // Dec 2026
assert.equal(rows(2026, 4), 6); // May 2026: starts Friday, 31 days
assert.equal(rows(2024, 1), 5); // Feb 2024: leap year
assert.equal(buildCalendarGrid(new Date(2026, 11, 1)).length, 42); // default unchanged

// Every trimmed grid still holds the whole month and ends on a Saturday.
for (let m = 0; m < 12; m++) {
  const cells = buildCalendarGrid(new Date(2026, m, 1), true);
  const dim = new Date(2026, m + 1, 0).getDate();
  assert.equal(cells.filter((d) => d.getMonth() === m).length, dim);
  assert.equal(cells[cells.length - 1].getDay(), 6);
  assert.equal(cells[0].getDay(), 0);
}
console.log("calendar grid checks passed");
