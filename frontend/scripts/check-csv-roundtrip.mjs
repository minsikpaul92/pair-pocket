#!/usr/bin/env node
/**
 * Checks the pure CSV export/import helpers: cell escaping, month splitting,
 * file names, and that every category pair survives an export in English or
 * Korean followed by an import.
 *
 * Usage: node scripts/check-csv-roundtrip.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = mkdtempSync(join(tmpdir(), "csv-check-"));
execFileSync(
  join(root, "node_modules", ".bin", "tsc"),
  ["lib/csv-export.ts", "--outDir", out, "--module", "commonjs", "--target", "es2020",
   "--skipLibCheck", "--strict"],
  { cwd: root, stdio: "inherit" }
);
const require = createRequire(import.meta.url);
const lib = require(join(out, "csv-export.js"));
const cat = require(join(out, "category-i18n.js"));

const messages = {
  ko: JSON.parse(readFileSync(join(root, "messages", "ko.json"), "utf8")),
  en: JSON.parse(readFileSync(join(root, "messages", "en.json"), "utf8")),
};
let checks = 0;
const ok = (fn) => { fn(); checks++; };

// Escaping
ok(() => assert.equal(lib.escapeCsvCell('a,b'), '"a,b"'));
ok(() => assert.equal(lib.escapeCsvCell('say "hi"'), '"say ""hi"""'));
ok(() => assert.equal(lib.escapeCsvCell("l1\nl2"), '"l1\nl2"'));
ok(() => assert.equal(lib.escapeCsvCell(null), ""));
ok(() => assert.equal(lib.escapeCsvCell(12.5), "12.5"));

// Month ranges
ok(() => assert.deepEqual(
  lib.monthRanges({ year: 2026, month: 11 }, { year: 2027, month: 2 }).map((r) => r.start + ".." + r.end),
  ["2026-11-01..2026-11-30", "2026-12-01..2026-12-31", "2027-01-01..2027-01-31", "2027-02-01..2027-02-28"]));
ok(() => assert.equal(lib.monthRanges({ year: 2028, month: 2 }, { year: 2028, month: 2 })[0].end, "2028-02-29"));
ok(() => assert.equal(lib.monthRanges({ year: 2026, month: 3 }, { year: 2026, month: 2 }).length, 0));

// File names
ok(() => assert.equal(
  lib.exportFileName({ accountType: "shared", scope: "CAD", from: { year: 2026, month: 9 }, to: { year: 2026, month: 10 } }),
  "PairPocket_shared_CAD_2026-09_2026-10.csv"));
ok(() => assert.equal(
  lib.exportFileName({ accountType: "personal", scope: "ALL", accountName: "내 카드/Visa", from: { year: 2026, month: 9 }, to: { year: 2026, month: 9 } }),
  "PairPocket_personal_ALL_Visa_2026-09.csv"));
ok(() => assert.equal(
  lib.exportFileName({ accountType: "personal", scope: "KRW" }), "PairPocket_personal_KRW_all.csv"));

// Every category and sub-category value round-trips in both languages
const lookup = (lang, ns) => (key) => {
  const v = messages[lang][ns][key];
  assert.ok(v, `missing ${lang} ${ns}.${key}`);
  return v;
};
for (const lang of ["ko", "en"]) {
  for (const value of Object.keys(cat.CATEGORY_KEY_BY_VALUE)) {
    const shown = cat.translateCategory(value, lookup(lang, "categories"));
    ok(() => assert.equal(cat.canonicalizeCategory(shown), value, `${lang} category ${value} -> ${shown}`));
  }
  for (const value of Object.keys(cat.SUB_CATEGORY_KEY_BY_VALUE)) {
    const shown = cat.translateSubCategory(value, lookup(lang, "subCategories"));
    // "계좌 이체" is a legacy alias that deliberately imports as "내 계좌 이동".
    const expected = value === "계좌 이체" ? "내 계좌 이동" : value;
    ok(() => assert.equal(cat.canonicalizeSubCategory(shown), expected, `${lang} sub ${value} -> ${shown}`));
  }
}

// Full file round trip with awkward values and the extra columns
const txs = [
  { date: "2026-09-03T12:00:00", amount: 12.5, currency: "CAD", type: "expense", category: "식비", sub_category: "카페/간식", merchant: 'Joe\'s "Best", Cafe', account_id: "a1", note: "line1\nline2, with comma" },
  { date: "2026-09-04T00:00:00", amount: 3000000, currency: "KRW", type: "income", category: "급여", sub_category: "급여", merchant: "회사", account_id: "a2", note: null },
];
const names = { a1: "Visa, main", a2: "급여통장" };
for (const lang of ["ko", "en"]) {
  const csv = lib.buildCsv(txs, {
    accountName: (id) => names[id] ?? "",
    tCategories: lookup(lang, "categories"),
    tSubCategories: lookup(lang, "subCategories"),
  });
  const rows = lib.parseCsvRows(csv);
  ok(() => assert.deepEqual(rows[0], [...lib.CSV_EXPORT_HEADERS]));
  ok(() => assert.equal(rows.length, 3));
  const back = lib.parseImportCsv(csv, { merchant: "?", category: "식비", subCategory: "카페/간식", today: "2000-01-01" });
  ok(() => assert.equal(back[0].merchant, 'Joe\'s "Best", Cafe'));
  ok(() => assert.equal(back[0].note, "line1\nline2, with comma"));
  ok(() => assert.equal(back[0].category, "식비"));
  ok(() => assert.equal(back[0].sub_category, "카페/간식"));
  ok(() => assert.equal(back[0].type, "expense"));
  ok(() => assert.equal(back[1].type, "income"));
  ok(() => assert.equal(back[1].category, "급여"));
  ok(() => assert.equal(back[1].amount, 3000000));
  ok(() => assert.equal(rows[1][7], "Visa, main"));
}

// Old template (lower-case header, six columns, guide comments, BOM)
const tpl = "﻿# guide\r\ndate,amount,currency,merchant,category,sub_category\r\n2026-01-15,12.50,CAD,Example Cafe,Food,Cafe / snacks\r\n";
const t = lib.parseImportCsv(tpl, { merchant: "?", category: "식비", subCategory: "카페/간식", today: "2000-01-01" });
ok(() => assert.equal(t.length, 1));
ok(() => assert.equal(t[0].category, "식비"));
ok(() => assert.equal(t[0].sub_category, "카페/간식"));

console.log(`csv-export checks passed: ${checks}`);
