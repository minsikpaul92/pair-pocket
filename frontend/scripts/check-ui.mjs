#!/usr/bin/env node
/**
 * Keeps dropdowns consistent: single-choice lists use components/ui/dropdown.tsx,
 * not a raw <select>. Existing raw <select> elements are counted per file in
 * scripts/ui-baseline.json and may only go down.
 *
 * Keeps calendars consistent: dates are picked with components/DayPicker.tsx,
 * never a native date input.
 *
 * Usage: node scripts/check-ui.mjs [--update]
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = join(root, "scripts", "ui-baseline.json");
const update = process.argv.includes("--update");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== "node_modules" && name !== ".next") walk(full, out);
    } else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const counts = {};
const nativeDates = [];
for (const dir of ["components", "app"]) {
  for (const file of walk(join(root, dir))) {
    const text = readFileSync(file, "utf8");
    const n = (text.match(/<select[\s>]/g) ?? []).length;
    if (n) counts[relative(root, file)] = n;
    if (/type=["']date["']/.test(text)) nativeDates.push(relative(root, file));
  }
}

if (update) {
  writeFileSync(baselinePath, JSON.stringify(counts, null, 2) + "\n");
  console.log("ui baseline updated");
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
const errors = Object.entries(counts)
  .filter(([file, n]) => n > (baseline[file] ?? 0))
  .map(
    ([file, n]) =>
      `${file}: ${n} raw <select> (allowed ${baseline[file] ?? 0}). Use components/ui/dropdown.tsx instead.`
  );

for (const file of nativeDates) {
  errors.push(`${file}: native date input. Use components/DayPicker.tsx instead.`);
}

if (errors.length) {
  console.error("ui check failed:\n  - " + errors.join("\n  - "));
  process.exit(1);
}
console.log("ui check passed");
