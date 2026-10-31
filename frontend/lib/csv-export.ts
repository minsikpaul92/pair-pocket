/**
 * Pure helpers for the CSV export and import screens. No React, no network,
 * so they can be checked with `scripts/check-csv-roundtrip.mjs`.
 */
import {
  canonicalizeCategory,
  canonicalizeSubCategory,
  translateCategory,
  translateSubCategory,
} from "./category-i18n";

export const CSV_EXPORT_HEADERS = [
  "Date",
  "Amount",
  "Currency",
  "Merchant",
  "Category",
  "SubCategory",
  "Type",
  "Account",
  "Note",
] as const;

export interface ExportableTransaction {
  date: string;
  amount: number;
  currency: string;
  type: string;
  category: string;
  sub_category: string;
  merchant: string;
  account_id?: string | null;
  counter_account_id?: string | null;
  note?: string | null;
}

/** Quote a cell when it holds a comma, quote or line break. */
export function escapeCsvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildCsv(
  txs: ExportableTransaction[],
  opts: {
    accountName: (id: string | null | undefined) => string;
    tCategories: (key: string) => string;
    tSubCategories: (key: string) => string;
  }
): string {
  const lines = txs.map((tx) =>
    [
      tx.date.slice(0, 10),
      tx.amount,
      tx.currency,
      tx.merchant,
      translateCategory(tx.category, opts.tCategories),
      translateSubCategory(tx.sub_category, opts.tSubCategories),
      tx.type,
      opts.accountName(tx.account_id),
      tx.note ?? "",
    ]
      .map(escapeCsvCell)
      .join(",")
  );
  return [CSV_EXPORT_HEADERS.join(","), ...lines].join("\r\n");
}

/** Does the transaction touch the account on either side of a transfer? */
export function matchesAccount(
  tx: Pick<ExportableTransaction, "account_id" | "counter_account_id">,
  accountId: string
): boolean {
  return tx.account_id === accountId || tx.counter_account_id === accountId;
}

export interface YearMonth {
  year: number;
  /** 1-12 */
  month: number;
}

export function compareYearMonth(a: YearMonth, b: YearMonth): number {
  return a.year * 12 + a.month - (b.year * 12 + b.month);
}

const pad2 = (n: number) => String(n).padStart(2, "0");

export function formatYearMonth(ym: YearMonth): string {
  return `${ym.year}-${pad2(ym.month)}`;
}

export function addYearMonths(ym: YearMonth, delta: number): YearMonth {
  const index = ym.year * 12 + (ym.month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** One inclusive YYYY-MM-DD range per calendar month (each is far below the API's 366 day cap). */
export function monthRanges(
  from: YearMonth,
  to: YearMonth
): Array<{ start: string; end: string }> {
  const out: Array<{ start: string; end: string }> = [];
  for (let cur = from; compareYearMonth(cur, to) <= 0; cur = addYearMonths(cur, 1)) {
    const lastDay = new Date(cur.year, cur.month, 0).getDate();
    out.push({
      start: `${formatYearMonth(cur)}-01`,
      end: `${formatYearMonth(cur)}-${pad2(lastDay)}`,
    });
  }
  return out;
}

function safeFilePart(text: string): string {
  return text.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "");
}

/** e.g. PairPocket_shared_CAD_2026-09_2026-10.csv */
export function exportFileName(opts: {
  accountType: string;
  scope: string;
  accountName?: string | null;
  from?: YearMonth | null;
  to?: YearMonth | null;
}): string {
  const parts = ["PairPocket", opts.accountType, opts.scope];
  if (opts.accountName) parts.push(safeFilePart(opts.accountName) || "account");
  if (opts.from && opts.to) {
    parts.push(formatYearMonth(opts.from));
    if (compareYearMonth(opts.from, opts.to) !== 0) parts.push(formatYearMonth(opts.to));
  } else {
    parts.push("all");
  }
  return `${parts.join("_")}.csv`;
}

/** RFC 4180 reader: quoted cells may hold commas, doubled quotes and line breaks. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const endRow = () => {
    row.push(cell);
    cell = "";
    if (row.some((c) => c.trim() !== "")) rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      endRow();
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  endRow();
  return rows;
}

export interface ImportedRow {
  date: string;
  amount: number;
  currency: string;
  merchant: string;
  category: string;
  sub_category: string;
  type: "income" | "expense";
  note: string;
}

const HEADER_ALIASES: Record<string, string> = {
  date: "date",
  amount: "amount",
  currency: "currency",
  merchant: "merchant",
  category: "category",
  subcategory: "sub_category",
  sub_category: "sub_category",
  type: "type",
  note: "note",
};

const DEFAULT_HEADER = ["date", "amount", "currency", "merchant", "category", "sub_category"];

/**
 * Read the template or an exported file. Columns are found by header name
 * (any case, any order, extra columns such as Account are ignored). Lines
 * starting with # before the header are guide comments.
 */
export function parseImportCsv(
  text: string,
  fallbacks: { merchant: string; category: string; subCategory: string; today: string }
): ImportedRow[] {
  const rows = parseCsvRows(text.replace(/^﻿/, "")).filter(
    (r) => !r[0].trim().startsWith("#")
  );
  if (rows.length === 0) return [];

  const first = rows[0].map((c) => c.trim().toLowerCase().replace(/[\s_-]+/g, "_"));
  const hasHeader = first.some((c) => c === "date");
  const columns = (hasHeader ? first : DEFAULT_HEADER).map((c) => HEADER_ALIASES[c.replace(/_/g, "")] ?? "");
  const body = hasHeader ? rows.slice(1) : rows;

  const out: ImportedRow[] = [];
  for (const cells of body) {
    const get = (key: string) => {
      const idx = columns.indexOf(key);
      return idx >= 0 ? (cells[idx] ?? "").trim() : "";
    };
    if (cells.length < 5 && !hasHeader) continue;
    const typeText = get("type").toLowerCase();
    out.push({
      date: get("date") || fallbacks.today,
      amount: parseFloat(get("amount")) || 0,
      currency: (get("currency") || "CAD").toUpperCase(),
      merchant: get("merchant") || fallbacks.merchant,
      category: canonicalizeCategory(get("category") || fallbacks.category),
      sub_category: canonicalizeSubCategory(get("sub_category") || fallbacks.subCategory),
      type: typeText === "income" ? "income" : "expense",
      note: get("note"),
    });
  }
  return out;
}
