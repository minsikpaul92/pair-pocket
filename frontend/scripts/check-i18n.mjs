#!/usr/bin/env node
/**
 * Guards the language rules in docs/i18n-and-layout.md.
 *
 *  1. messages/ko.json and messages/en.json have the same keys and the same
 *     {placeholders} for every key.
 *  2. No new hardcoded Korean in components, app, lib or i18n. Existing lines
 *     are counted per file in scripts/i18n-baseline.json and may only go down.
 *  3. No new rendering that branches on the UI language. What is shown must
 *     not depend on whether the user picked Korean or English.
 *
 * Usage: node scripts/check-i18n.mjs [--update]
 *   --update  rewrite the baseline to the current counts (use after removing
 *             hardcoded text, never to hide new text).
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = join(root, "scripts", "i18n-baseline.json");
const update = process.argv.includes("--update");
const errors = [];

// 1. Message files -------------------------------------------------------

function flatten(obj, prefix = "") {
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object") Object.assign(out, flatten(value, path));
    else out[path] = String(value);
  }
  return out;
}

const placeholders = (text) =>
  [...text.matchAll(/\{\s*(\w+)\s*[,}]/g)].map((m) => m[1]).sort().join(",");

const ko = flatten(JSON.parse(readFileSync(join(root, "messages", "ko.json"), "utf8")));
const en = flatten(JSON.parse(readFileSync(join(root, "messages", "en.json"), "utf8")));

for (const key of Object.keys(ko)) {
  if (!(key in en)) errors.push(`messages: "${key}" is missing in en.json`);
}
for (const key of Object.keys(en)) {
  if (!(key in ko)) errors.push(`messages: "${key}" is missing in ko.json`);
}
for (const key of Object.keys(ko)) {
  if (key in en && placeholders(ko[key]) !== placeholders(en[key])) {
    errors.push(
      `messages: "${key}" uses different placeholders ` +
        `(ko: {${placeholders(ko[key])}} en: {${placeholders(en[key])}})`
    );
  }
}

// 2 + 3. Source scan -----------------------------------------------------

const SCAN_DIRS = ["components", "app", "lib", "i18n"];
const HANGUL = /[\u3131-\u318e\uac00-\ud7a3]/;
const LOCALE_BRANCH = /\blocale\s*(===|!==|==|!=)\s*["'`]|["'`](ko|en)["'`]\s*(===|!==)\s*locale/;

function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(name)) files.push(full);
  }
  return files;
}

function codeLines(source) {
  const noBlocks = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  return noBlocks
    .split("\n")
    .map((line) => line.replace(/(^|\s)\/\/.*$/, "$1"));
}

const counts = { hangul: {}, localeBranch: {} };
for (const dir of SCAN_DIRS) {
  for (const file of walk(join(root, dir))) {
    const rel = relative(root, file).split("\\").join("/");
    let hangul = 0;
    let branches = 0;
    for (const line of codeLines(readFileSync(file, "utf8"))) {
      if (HANGUL.test(line)) hangul += 1;
      if (LOCALE_BRANCH.test(line)) branches += 1;
    }
    if (hangul) counts.hangul[rel] = hangul;
    if (branches) counts.localeBranch[rel] = branches;
  }
}

if (update) {
  writeFileSync(baselinePath, JSON.stringify(counts, null, 2) + "\n");
  console.log(`i18n baseline updated: ${baselinePath}`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
const hints = {
  hangul:
    "hardcoded Korean. Put the text in messages/ko.json and messages/en.json and use useTranslations()",
  localeBranch:
    "rendering that depends on the UI language. Show the same things in every language; only the text may change",
};
let improved = 0;
for (const kind of Object.keys(counts)) {
  for (const [file, count] of Object.entries(counts[kind])) {
    const allowed = baseline[kind]?.[file] ?? 0;
    if (count > allowed) {
      errors.push(`${file}: ${count - allowed} new line(s) with ${hints[kind]}`);
    }
  }
  for (const [file, allowed] of Object.entries(baseline[kind] ?? {})) {
    if ((counts[kind][file] ?? 0) < allowed) improved += 1;
  }
}

if (errors.length) {
  console.error("i18n check failed:\n" + errors.map((e) => `  - ${e}`).join("\n"));
  console.error("\nSee docs/i18n-and-layout.md for the rules.");
  process.exit(1);
}
console.log(
  "i18n check passed" +
    (improved ? ` (${improved} file(s) improved: run "npm run check:i18n -- --update" to lock it in)` : "")
);
