"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, FileSpreadsheet, Loader2, UploadCloud } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  AccountType,
  BankPreview,
  BankPreviewRow,
  CategoryPresets,
  Currency,
  FinancialAccount,
  LedgerScope,
  accountLabel,
  commitBankRows,
  fetchAccounts,
  formatAmount,
  previewBankCsv,
  undoBankImport,
} from "@/lib/api";
import {
  categoryI18nKey,
  translateCategory,
  translateSubCategory,
} from "@/lib/category-i18n";

interface Props {
  scope: LedgerScope;
  accountType: AccountType;
  presets: CategoryPresets | null;
  onChanged: () => void;
}

interface RowState {
  row: BankPreviewRow;
  include: boolean;
  merchant: string;
  category: string;
  subCategory: string;
  cardPayment: boolean;
  cardId: string;
}

const SAVED_KEY = "pairpocket.bankImportSaved";

const isTransferCategory = (category: string) =>
  ["transfer", "transferLegacy"].includes(categoryI18nKey(category) ?? "");

function initialState(row: BankPreviewRow, cards: FinancialAccount[]): RowState {
  const s = row.suggestion;
  const isBankSideCardPayment =
    row.hint === "card_repayment" && row.direction === "out";
  return {
    row,
    include: row.bucket === "auto",
    merchant: s?.merchant ?? row.description,
    category: s?.category ?? "",
    subCategory: s?.sub_category ?? "",
    cardPayment: isBankSideCardPayment,
    cardId: cards.length === 1 ? cards[0].id : "",
  };
}

export default function BankImportPanel({
  scope,
  accountType,
  presets,
  onChanged,
}: Props) {
  const t = useTranslations("bankImport");
  const tCategories = useTranslations("categories");
  const tSubCategories = useTranslations("subCategories");

  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [accountId, setAccountId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Saving refreshes the app, which remounts this panel, so the result survives via sessionStorage.
  const [saved, setSaved] = useState<{ count: number; batchId: string } | null>(() => {
    try {
      const stored = window.sessionStorage.getItem(SAVED_KEY);
      return stored ? (JSON.parse(stored) as { count: number; batchId: string }) : null;
    } catch {
      return null;
    }
  });
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<BankPreview | null>(null);
  const [rows, setRows] = useState<RowState[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchAccounts({
      accountType,
      currency: scope === "ALL" ? undefined : (scope as Currency),
    })
      .then((list) => {
        if (cancelled) return;
        const usable = list.filter((a) => a.kind !== "investment");
        setAccounts(usable);
        setAccountId((prev) => prev || usable[0]?.id || "");
      })
      .catch(() => {
        if (!cancelled) setAccounts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [accountType, scope]);

  const account = accounts.find((a) => a.id === accountId) ?? null;
  const cards = useMemo(
    () =>
      accounts.filter(
        (a) => a.kind === "credit_card" && a.currency === account?.currency
      ),
    [accounts, account?.currency]
  );
  const currency: Currency = account?.currency ?? "CAD";

  async function analyze() {
    if (!file || !accountId) return;
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const result = await previewBankCsv(accountId, file);
      setPreview(result);
      setRows(result.rows.map((r) => initialState(r, cards)));
    } catch {
      setPreview(null);
      setRows([]);
      setError(t("previewFailed"));
    } finally {
      setBusy(false);
    }
  }

  function pickFile(picked: File | undefined | null) {
    if (!picked) return;
    if (!picked.name.toLowerCase().endsWith(".csv")) {
      setError(t("csvOnly"));
      return;
    }
    setError(null);
    setFile(picked);
  }

  async function undo() {
    if (!saved || !window.confirm(t("undoConfirm", { count: saved.count }))) return;
    setBusy(true);
    setError(null);
    try {
      await undoBankImport(saved.batchId);
      window.sessionStorage.removeItem(SAVED_KEY);
      setSaved(null);
      onChanged();
    } catch {
      setError(t("undoFailed"));
    } finally {
      setBusy(false);
    }
  }

  function patch(index: number, change: Partial<RowState>) {
    setRows((prev) =>
      prev.map((r) => (r.row.index === index ? { ...r, ...change } : r))
    );
  }

  const groups = (presets ? presets : { expense: [], income: [] }) as CategoryPresets;
  function categoryOptions(direction: "out" | "in") {
    return (direction === "out" ? groups.expense : groups.income).filter(
      (g) => !isTransferCategory(g.category)
    );
  }

  function isComplete(r: RowState): boolean {
    if (r.cardPayment) return Boolean(r.cardId);
    return Boolean(r.category && r.subCategory && r.merchant.trim());
  }

  const chosen = rows.filter((r) => r.include);
  const incomplete = chosen.filter((r) => !isComplete(r)).length;
  const waiting = rows.filter(
    (r) => r.row.bucket === "review" && !r.include
  ).length;

  async function save() {
    if (!preview || chosen.length === 0 || incomplete > 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await commitBankRows(
        preview.account_id,
        chosen.map((r) =>
          r.cardPayment
            ? {
                date: r.row.date,
                amount: r.row.amount,
                direction: r.row.direction,
                merchant: r.merchant.trim(),
                kind: "card_repayment" as const,
                counter_account_id: r.cardId,
              }
            : {
                date: r.row.date,
                amount: r.row.amount,
                direction: r.row.direction,
                merchant: r.merchant.trim(),
                category: r.category,
                sub_category: r.subCategory,
              }
        )
      );
      const done = { count: result.created, batchId: result.batch_id };
      setSaved(done);
      try {
        window.sessionStorage.setItem(SAVED_KEY, JSON.stringify(done));
      } catch {
        /* storage unavailable; the message only shows until the refresh */
      }
      setPreview(null);
      setRows([]);
      setFile(null);
      onChanged();
    } catch {
      setError(t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  function renderRow(r: RowState, editable: boolean) {
    const { row } = r;
    const options = categoryOptions(row.direction);
    const subs = options.find((g) => g.category === r.category)?.sub_categories ?? [];
    const note =
      row.hint === "card_repayment" && row.direction === "in"
        ? t("cardSideNote")
        : row.hint === "account_transfer"
          ? t("transferNote")
          : row.hint === "e_transfer"
            ? t("etransferNote")
            : row.match && row.bucket !== "auto"
              ? t("similarTo", {
                  merchant: row.match.merchant ?? "",
                  date: row.match.date,
                })
              : null;
    return (
      <li
        key={row.index}
        className="space-y-2 rounded-xl border border-gray-150 p-3 dark:border-gray-800"
      >
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={r.include}
            onChange={(e) => patch(row.index, { include: e.target.checked })}
            className="mt-0.5 rounded text-indigo-600"
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold text-gray-800 dark:text-gray-100">
              {row.description}
            </span>
            <span className="block text-[11px] text-gray-500 dark:text-gray-400">
              {row.date}
            </span>
          </span>
          <span
            className={`shrink-0 text-xs font-bold ${
              row.direction === "out"
                ? "text-red-500"
                : "text-emerald-600 dark:text-emerald-400"
            }`}
          >
            {row.direction === "out" ? "-" : "+"}
            {formatAmount(row.amount, currency)}
          </span>
        </label>
        {note && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400">{note}</p>
        )}
        {editable && r.include && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <input
              value={r.merchant}
              onChange={(e) => patch(row.index, { merchant: e.target.value })}
              placeholder={t("merchant")}
              aria-label={t("merchant")}
              className="input-field min-w-0 text-xs"
            />
            {r.cardPayment ? (
              <select
                value={r.cardId}
                onChange={(e) => patch(row.index, { cardId: e.target.value })}
                aria-label={t("card")}
                className="input-field min-w-0 text-xs sm:col-span-2"
              >
                <option value="">{t("pickCard")}</option>
                {cards.map((c) => (
                  <option key={c.id} value={c.id}>
                    {accountLabel(c)}
                  </option>
                ))}
              </select>
            ) : (
              <>
                <select
                  value={r.category}
                  onChange={(e) =>
                    patch(row.index, { category: e.target.value, subCategory: "" })
                  }
                  aria-label={t("category")}
                  className="input-field min-w-0 text-xs"
                >
                  <option value="">{t("category")}</option>
                  {options.map((g) => (
                    <option key={g.category} value={g.category}>
                      {translateCategory(g.category, tCategories)}
                    </option>
                  ))}
                </select>
                <select
                  value={r.subCategory}
                  onChange={(e) => patch(row.index, { subCategory: e.target.value })}
                  aria-label={t("subCategory")}
                  disabled={!r.category}
                  className="input-field min-w-0 text-xs"
                >
                  <option value="">{t("subCategory")}</option>
                  {subs.map((s) => (
                    <option key={s} value={s}>
                      {translateSubCategory(s, tSubCategories)}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
        )}
        {editable && r.include && !isComplete(r) && (
          <p className="text-[11px] text-red-500">{t("needsChoice")}</p>
        )}
      </li>
    );
  }

  function section(
    bucket: BankPreviewRow["bucket"],
    title: string,
    hint: string,
    open: boolean
  ) {
    const list = rows.filter((r) => r.row.bucket === bucket);
    if (list.length === 0) return null;
    return (
      <details open={open} className="group rounded-2xl border border-gray-150 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
          <span className="min-w-0">
            <span className="block text-sm font-bold text-gray-900 dark:text-white">
              {title} · {list.length}
            </span>
            <span className="block text-[11px] text-gray-500 dark:text-gray-400">
              {hint}
            </span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-gray-400 transition-transform group-open:rotate-180" />
        </summary>
        <ul className="mt-3 space-y-2">
          {list.map((r) => renderRow(r, bucket !== "duplicate"))}
        </ul>
      </details>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-4 rounded-2xl border border-gray-150 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold text-gray-800 dark:text-white">
            <FileSpreadsheet className="h-5 w-5 shrink-0 text-indigo-500" />
            {t("title")}
          </h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t("subtitle")}</p>
        </div>
        <div className="grid gap-3">
          <label className="space-y-1">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">
              {t("account")}
            </span>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="input-field w-full text-xs"
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {accountLabel(a)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            pickFile(e.dataTransfer.files?.[0]);
          }}
          className={`flex min-h-[130px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-5 text-center transition-all ${
            dragging
              ? "border-indigo-500 bg-indigo-50/60 dark:bg-indigo-950/20"
              : "border-gray-300 bg-gray-50/50 dark:border-gray-700 dark:bg-gray-800/10"
          }`}
        >
          <UploadCloud className="h-7 w-7 text-gray-400" />
          <span className="max-w-full truncate text-xs font-semibold text-gray-600 dark:text-gray-300">
            {file ? file.name : t("dropHere")}
          </span>
          <label className="cursor-pointer rounded-lg bg-gray-100 px-3.5 py-2 text-xs font-semibold text-gray-800 hover:bg-gray-200 dark:bg-gray-700 dark:text-white">
            {t("choose")}
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => pickFile(e.target.files?.[0])}
              className="hidden"
            />
          </label>
        </div>
        <button
          type="button"
          onClick={() => void analyze()}
          disabled={busy || !file || !accountId}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-indigo-600 py-3 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy && !preview ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {t("analyze")}
        </button>
        {accounts.length === 0 && (
          <p className="text-xs text-gray-500">{t("noAccounts")}</p>
        )}
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}
      {saved !== null && (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-emerald-50 p-3 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
          <span>{t("saved", { count: saved.count })}</span>
          <button
            type="button"
            onClick={() => void undo()}
            disabled={busy}
            className="shrink-0 rounded-lg border border-emerald-300 px-2.5 py-1 hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-800 dark:hover:bg-emerald-950"
          >
            {t("undo")}
          </button>
        </div>
      )}

      {preview && (
        <>
          {section("review", t("reviewTitle"), t("reviewHint"), true)}
          {section("auto", t("autoTitle"), t("autoHint"), false)}
          {section("duplicate", t("duplicateTitle"), t("duplicateHint"), false)}

          <div className="sticky bottom-20 space-y-2 lg:bottom-3 rounded-2xl border border-gray-150 bg-white/95 p-3 shadow-lg backdrop-blur dark:border-gray-800 dark:bg-gray-900/95">
            {waiting > 0 && (
              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                {t("waiting", { count: waiting })}
              </p>
            )}
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy || chosen.length === 0 || incomplete > 0}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-indigo-600 py-3 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t("save", { count: chosen.length })}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
