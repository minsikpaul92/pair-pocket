"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, FileSpreadsheet, Loader2, UploadCloud, X } from "lucide-react";
import { useTranslations } from "next-intl";
import Dropdown from "@/components/ui/dropdown";
import {
  AccountType,
  BankPreview,
  BankPreviewRow,
  CategoryPresets,
  Currency,
  FinancialAccount,
  LedgerScope,
  accountPickerLabel,
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
import {
  ImportDraft,
  listImportDrafts,
  removeImportDraft,
  saveImportDraft,
} from "@/lib/import-drafts";

interface Props {
  scope: LedgerScope;
  accountType: AccountType;
  presets: CategoryPresets | null;
  onChanged: () => void;
}

interface RowState {
  row: BankPreviewRow;
  /** Where the row sits now; the user can move it between "review" and "duplicate". */
  bucket: BankPreviewRow["bucket"];
  include: boolean;
  merchant: string;
  note: string;
  category: string;
  subCategory: string;
  cardPayment: boolean;
  cardId: string;
  accountMove: boolean;
  moveId: string;
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
    bucket: row.bucket,
    include: row.bucket === "auto",
    merchant: s?.merchant ?? row.description,
    note: "",
    category: s?.category ?? "",
    subCategory: s?.sub_category ?? "",
    cardPayment: isBankSideCardPayment,
    cardId: cards.length === 1 ? cards[0].id : "",
    accountMove: row.hint === "account_transfer",
    moveId: "",
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
  const [fileRows, setFileRows] = useState<number | null>(null);

  useEffect(() => {
    setFileRows(null);
    if (!file) return;
    let cancelled = false;
    file
      .text()
      .then((text) => {
        if (!cancelled) setFileRows(text.split(/\r?\n/).filter((l) => l.trim()).length);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [file]);
  const [preview, setPreview] = useState<BankPreview | null>(null);
  const [rows, setRows] = useState<RowState[]>([]);
  const [sourceName, setSourceName] = useState("");
  const [otherLedgerAccounts, setOtherLedgerAccounts] = useState<FinancialAccount[]>([]);
  const [drafts, setDrafts] = useState<ImportDraft<RowState>[]>([]);
  const [confirmUndo, setConfirmUndo] = useState(false);
  const tAccountType = useTranslations("accountType");

  useEffect(() => {
    setDrafts(listImportDrafts<RowState>());
  }, []);

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
    // Money can also move to or from the other ledger (personal <-> shared).
    fetchAccounts({ accountType: accountType === "shared" ? "personal" : "shared" })
      .then((list) => {
        if (!cancelled) setOtherLedgerAccounts(list);
      })
      .catch(() => {
        if (!cancelled) setOtherLedgerAccounts([]);
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
  const moveTargets = [...accounts, ...otherLedgerAccounts].filter(
    (a) => a.id !== accountId && a.currency === currency && a.kind !== "credit_card"
  );
  const sameLedgerTarget = (id: string) => accounts.some((a) => a.id === id);

  async function analyze() {
    if (!file || !accountId) return;
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const result = await previewBankCsv(accountId, file);
      setPreview(result);
      setSourceName(file.name);
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
    if (!saved) return;
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
      setConfirmUndo(false);
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
    if (r.accountMove) {
      // A move inside one ledger is entered from the sending account only.
      if (r.row.direction === "in" && sameLedgerTarget(r.moveId)) return false;
      return Boolean(r.moveId && r.merchant.trim());
    }
    return Boolean(r.category && r.subCategory && r.merchant.trim());
  }

  const chosen = rows.filter((r) => r.include && r.bucket !== "duplicate");
  const incomplete = chosen.filter((r) => !isComplete(r)).length;
  const waiting = rows.filter((r) => r.bucket === "review" && !r.include).length;

  function reset() {
    setPreview(null);
    setRows([]);
    setFile(null);
    setSourceName("");
    setError(null);
  }

  function saveForLater() {
    if (!preview) return;
    setDrafts(
      saveImportDraft<RowState>({
        accountId: preview.account_id,
        accountName: account ? accountPickerLabel(account) : "",
        fileName: sourceName,
        rows,
      })
    );
    reset();
  }

  function resume(draft: ImportDraft<RowState>) {
    setDrafts(removeImportDraft<RowState>(draft.id));
    setAccountId(draft.accountId);
    setSaved(null);
    setFile(null);
    setSourceName(draft.fileName);
    setPreview({
      account_id: draft.accountId,
      rows: draft.rows.map((r) => r.row),
      summary: { auto: 0, review: 0, duplicate: 0 },
    });
    setRows(draft.rows);
  }

  function moveName(targetId: string): string {
    const label = (a?: FinancialAccount | null) => a?.nickname || a?.name || "";
    const target = moveTargets.find((a) => a.id === targetId);
    return `${label(account)} → ${label(target)}`;
  }

  function pickMoveTarget(r: RowState, targetId: string) {
    const generated = !r.merchant.trim() || r.merchant === r.row.description || r.merchant.includes(" → ");
    patch(r.row.index, {
      moveId: targetId,
      ...(generated ? { merchant: moveName(targetId) } : {}),
    });
  }

  async function save() {
    if (!preview || chosen.length === 0 || incomplete > 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await commitBankRows(
        preview.account_id,
        chosen.map((r) => {
          const base = {
            date: r.row.date,
            amount: r.row.amount,
            direction: r.row.direction,
            merchant: r.merchant.trim(),
            note: r.note.trim() || undefined,
          };
          if (r.accountMove) {
            return { ...base, kind: "account_move" as const, counter_account_id: r.moveId };
          }
          if (r.cardPayment) {
            return { ...base, kind: "card_repayment" as const, counter_account_id: r.cardId };
          }
          return { ...base, category: r.category, sub_category: r.subCategory };
        })
      );
      const done = { count: result.created, batchId: result.batch_id };
      setSaved(done);
      try {
        window.sessionStorage.setItem(SAVED_KEY, JSON.stringify(done));
      } catch {
        /* storage unavailable; the message only shows until the refresh */
      }
      reset();
      onChanged();
    } catch {
      setError(t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  function renderRow(r: RowState) {
    const { row } = r;
    const isDuplicate = r.bucket === "duplicate";
    const options = categoryOptions(row.direction);
    const subs = options.find((g) => g.category === r.category)?.sub_categories ?? [];
    const hintNote =
      row.hint === "card_repayment" && row.direction === "in"
        ? t("cardSideNote")
        : row.hint === "account_transfer"
          ? row.direction === "out"
            ? t("transferNote")
            : t("transferInNote")
          : row.hint === "e_transfer"
            ? t("etransferNote")
            : null;
    const matchAmount =
      row.match?.amount != null ? formatAmount(row.match.amount, currency) : "";
    const matchNote = row.match
      ? isDuplicate
        ? t("matchedEntry", {
            merchant: row.match.merchant ?? "",
            date: row.match.date,
            amount: matchAmount,
          })
        : row.bucket !== "auto"
          ? t("similarTo", {
              merchant: row.match.merchant ?? "",
              date: row.match.date,
              amount: matchAmount,
            })
          : null
      : null;
    const moveBlocked =
      r.accountMove &&
      row.direction === "in" &&
      r.moveId !== "" &&
      sameLedgerTarget(r.moveId);
    return (
      <li
        key={row.index}
        className="space-y-2 rounded-xl border border-gray-150 p-3 dark:border-gray-800"
      >
        <div className="flex items-start gap-2">
          {!isDuplicate && (
            <input
              type="checkbox"
              checked={r.include}
              onChange={(e) => patch(row.index, { include: e.target.checked })}
              aria-label={t("includeRow")}
              className="mt-0.5 rounded text-indigo-600"
            />
          )}
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
        </div>
        {hintNote && !isDuplicate && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400">{hintNote}</p>
        )}
        {matchNote && (
          <p
            className={`text-[11px] font-semibold ${
              isDuplicate
                ? "text-gray-600 dark:text-gray-300"
                : "text-amber-600 dark:text-amber-400"
            }`}
          >
            {matchNote}
          </p>
        )}
        {!isDuplicate && (
          <div className="space-y-2">
            {row.hint === "account_transfer" && (
              <label className="flex items-center gap-2 text-[11px] font-semibold text-gray-700 dark:text-gray-200">
                <input
                  type="checkbox"
                  checked={r.accountMove}
                  onChange={(e) => patch(row.index, { accountMove: e.target.checked })}
                  className="rounded text-indigo-600"
                />
                {t("ownMove")}
              </label>
            )}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {r.accountMove ? (
                <Dropdown
                  value={r.moveId}
                  onChange={(v) => pickMoveTarget(r, v)}
                  ariaLabel={row.direction === "out" ? t("moveTarget") : t("moveSource")}
                  placeholder={row.direction === "out" ? t("pickMoveTarget") : t("pickMoveSource")}
                  size="sm"
                  className="sm:col-span-3"
                  options={moveTargets.map((a) => ({
                    value: a.id,
                    label: `${tAccountType(a.account_type)} · ${accountPickerLabel(a)}`,
                  }))}
                />
              ) : r.cardPayment ? (
                <Dropdown
                  value={r.cardId}
                  onChange={(v) => patch(row.index, { cardId: v })}
                  ariaLabel={t("card")}
                  placeholder={t("pickCard")}
                  size="sm"
                  className="sm:col-span-3"
                  options={cards.map((c) => ({ value: c.id, label: accountPickerLabel(c) }))}
                />
              ) : (
                <>
                  <Dropdown
                    value={r.category}
                    onChange={(v) => patch(row.index, { category: v, subCategory: "" })}
                    ariaLabel={t("category")}
                    placeholder={t("category")}
                    size="sm"
                    className="sm:col-span-1"
                    options={options.map((g) => ({
                      value: g.category,
                      label: translateCategory(g.category, tCategories),
                    }))}
                  />
                  <Dropdown
                    value={r.subCategory}
                    onChange={(v) => patch(row.index, { subCategory: v })}
                    ariaLabel={t("subCategory")}
                    placeholder={t("subCategory")}
                    disabled={!r.category}
                    size="sm"
                    className="sm:col-span-2"
                    options={subs.map((sub) => ({
                      value: sub,
                      label: translateSubCategory(sub, tSubCategories),
                    }))}
                  />
                </>
              )}
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input
                value={r.merchant}
                onChange={(e) => patch(row.index, { merchant: e.target.value })}
                placeholder={t("merchant")}
                aria-label={t("merchant")}
                className="min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              />
              <input
                value={r.note}
                onChange={(e) => patch(row.index, { note: e.target.value })}
                placeholder={t("note")}
                aria-label={t("note")}
                maxLength={200}
                className="min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>
          </div>
        )}
        {moveBlocked && (
          <p className="text-[11px] text-red-500">{t("moveSameLedgerIn")}</p>
        )}
        {r.include && !isDuplicate && !isComplete(r) && !moveBlocked && (
          <p className="text-[11px] text-red-500">{t("needsChoice")}</p>
        )}
        {r.bucket !== "auto" && (
          <button
            type="button"
            onClick={() =>
              isDuplicate
                ? patch(row.index, { bucket: "review", include: false })
                : patch(row.index, { bucket: "duplicate", include: false })
            }
            className="rounded-lg bg-gray-100 px-2.5 py-1.5 text-[11px] font-semibold text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            {isDuplicate ? t("notDuplicate") : t("isDuplicate")}
          </button>
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
    const list = rows.filter((r) => r.bucket === bucket);
    if (list.length === 0) return null;
    const allOn = list.every((r) => r.include);
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
        {bucket === "review" && (
          <button
            type="button"
            onClick={() =>
              setRows((prev) =>
                prev.map((r) => (r.bucket === bucket ? { ...r, include: !allOn } : r))
              )
            }
            className="mt-3 rounded-lg bg-gray-100 px-2.5 py-1.5 text-[11px] font-semibold text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            {allOn ? t("clearAll") : t("selectAll")}
          </button>
        )}
        <ul className="mt-3 space-y-2">{list.map((r) => renderRow(r))}</ul>
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
          <div className="space-y-1">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">
              {t("account")}
            </span>
            <Dropdown
              value={accountId}
              onChange={setAccountId}
              ariaLabel={t("account")}
              options={accounts.map((a) => ({ value: a.id, label: accountPickerLabel(a) }))}
            />
          </div>
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
              : file
                ? "border-emerald-300 bg-emerald-50/30 dark:border-emerald-800 dark:bg-emerald-950/10"
                : "border-gray-300 bg-gray-50/50 dark:border-gray-700 dark:bg-gray-800/10"
          }`}
        >
          {file ? (
            <div className="flex w-full items-center gap-3 text-left">
              <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">
                <FileSpreadsheet className="h-6 w-6" />
                <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-white">
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-gray-800 dark:text-gray-100">
                  {file.name}
                </span>
                <span className="block text-[11px] text-gray-500 dark:text-gray-400">
                  CSV · {Math.max(1, Math.round(file.size / 1024))} KB
                  {fileRows !== null ? ` · ${t("fileRows", { count: fileRows })}` : ""}
                </span>
              </span>
              <label className="shrink-0 cursor-pointer rounded-lg bg-gray-100 px-3 py-2 text-xs font-semibold text-gray-800 hover:bg-gray-200 dark:bg-gray-700 dark:text-white">
                {t("changeFile")}
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => pickFile(e.target.files?.[0])}
                  className="hidden"
                />
              </label>
              <button
                type="button"
                onClick={() => setFile(null)}
                aria-label={t("removeFile")}
                className="shrink-0 rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <>
              <UploadCloud className="h-7 w-7 text-gray-400" />
              <span className="max-w-full truncate text-xs font-semibold text-gray-600 dark:text-gray-300">
                {t("dropHere")}
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
            </>
          )}
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
          {confirmUndo ? (
            <span className="flex shrink-0 items-center gap-1.5">
              <span className="font-normal">{t("undoConfirm", { count: saved.count })}</span>
              <button
                type="button"
                onClick={() => void undo()}
                disabled={busy}
                className="rounded-lg bg-emerald-600 px-2.5 py-1 text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {t("undo")}
              </button>
              <button
                type="button"
                onClick={() => setConfirmUndo(false)}
                className="rounded-lg border border-emerald-300 px-2.5 py-1 hover:bg-emerald-100 dark:border-emerald-800 dark:hover:bg-emerald-950"
              >
                {t("keep")}
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmUndo(true)}
              disabled={busy}
              className="shrink-0 rounded-lg border border-emerald-300 px-2.5 py-1 hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-800 dark:hover:bg-emerald-950"
            >
              {t("undo")}
            </button>
          )}
        </div>
      )}

      {!preview && drafts.some((d) => accounts.some((a) => a.id === d.accountId)) && (
        <div className="space-y-2 rounded-2xl border border-gray-150 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <p className="text-sm font-bold text-gray-900 dark:text-white">{t("draftsTitle")}</p>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("draftsHint")}</p>
          <ul className="space-y-2">
            {drafts
              .filter((d) => accounts.some((a) => a.id === d.accountId))
              .map((d) => (
                <li
                  key={d.id}
                  className="flex items-center gap-2 rounded-xl border border-gray-150 p-3 dark:border-gray-800"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-gray-800 dark:text-gray-100">
                      {d.fileName || d.accountName}
                    </span>
                    <span className="block truncate text-[11px] text-gray-500 dark:text-gray-400">
                      {d.accountName} · {d.savedAt.slice(0, 10)} ·{" "}
                      {t("draftLeft", { count: d.rows.filter((r) => r.bucket !== "duplicate").length })}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => resume(d)}
                    className="shrink-0 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
                  >
                    {t("draftResume")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDrafts(removeImportDraft<RowState>(d.id))}
                    className="shrink-0 rounded-lg bg-gray-100 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                  >
                    {t("draftDelete")}
                  </button>
                </li>
              ))}
          </ul>
        </div>
      )}

      {preview && (
        <>
          {sourceName && (
            <p className="truncate text-xs font-semibold text-gray-600 dark:text-gray-300">
              {t("workingOn", { name: sourceName })}
            </p>
          )}
          {section("review", t("reviewTitle"), t("reviewHint"), true)}
          {section("auto", t("autoTitle"), t("autoHint"), false)}
          {section("duplicate", t("duplicateTitle"), t("duplicateHint"), false)}

          <div className="space-y-2 rounded-2xl border border-gray-150 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
            {waiting > 0 && (
              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                {t("waiting", { count: waiting })}
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={reset}
                disabled={busy}
                className="shrink-0 rounded-xl bg-gray-100 px-3.5 py-3 text-xs font-semibold text-gray-700 hover:bg-gray-200 disabled:opacity-50 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                onClick={saveForLater}
                disabled={busy}
                className="shrink-0 rounded-xl bg-gray-100 px-3.5 py-3 text-xs font-semibold text-gray-700 hover:bg-gray-200 disabled:opacity-50 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                {t("later")}
              </button>
              <button
                type="button"
                onClick={() => void save()}
                disabled={busy || chosen.length === 0 || incomplete > 0}
                className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl bg-indigo-600 py-3 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {t("save", { count: chosen.length })}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
