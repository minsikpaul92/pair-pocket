// Keeps ko and en in lockstep. Korean is the source of truth.
//   1. messages/ko.json and messages/en.json must have identical keys and {placeholders}.
//   2. Hangul must not be hardcoded in components. Every string shown to users belongs in messages.
//      scripts/i18n-baseline.json records the existing debt per file; counts may only go down.
// Run `node scripts/check-i18n.mjs --update-baseline` after removing hardcoded strings.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const baselinePath = join(root, "scripts/i18n-baseline.json");
const HANGUL = /[가-힣]/;

function flatten(obj, prefix = "", out = {}) {
  for (const [key, value] of Object.entries(obj)) {
    if (value && typeof value === "object") flatten(value, `${prefix}${key}.`, out);
    else out[`${prefix}${key}`] = String(value);
  }
  return out;
}

const placeholders = (s) =>
  [...s.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort().join(",");

const errors = [];
const ko = flatten(JSON.parse(readFileSync(join(root, "messages/ko.json"), "utf8")));
const en = flatten(JSON.parse(readFileSync(join(root, "messages/en.json"), "utf8")));
for (const key of Object.keys(ko)) {
  if (!(key in en)) errors.push(`missing in en.json: ${key}`);
  else if (placeholders(ko[key]) !== placeholders(en[key]))
    errors.push(`placeholder mismatch: ${key}`);
}
for (const key of Object.keys(en)) if (!(key in ko)) errors.push(`missing in ko.json: ${key}`);

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, files);
    else if (/\.(tsx?)$/.test(name)) files.push(path);
  }
  return files;
}

function hangulLines(source) {
  const noBlock = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ""));
  return noBlock
    .split("\n")
    .filter((line) => HANGUL.test(line.replace(/(^|\s)\/\/.*$/, "")) ).length;
}

const counts = {};
for (const dir of ["app", "components", "lib"]) {
  for (const file of walk(join(root, dir))) {
    const n = hangulLines(readFileSync(file, "utf8"));
    if (n) counts[relative(root, file)] = n;
  }
}

if (process.argv.includes("--update-baseline")) {
  writeFileSync(baselinePath, JSON.stringify(counts, null, 2) + "\n");
  console.log(`baseline updated (${Object.keys(counts).length} files)`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
for (const [file, n] of Object.entries(counts)) {
  const allowed = baseline[file] ?? 0;
  if (n > allowed)
    errors.push(`hardcoded Korean in ${file}: ${n} lines (allowed ${allowed}). Move it to messages/ko.json and en.json.`);
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
const debt = Object.values(baseline).reduce((a, b) => a + b, 0);
console.log(`i18n ok: ${Object.keys(ko).length} keys in sync, ${debt} hardcoded Korean lines remain in baseline`);
