"use client";

import React, { useEffect, useState } from "react";
import {
  UploadCloud,
  FileSpreadsheet,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Trash2,
  Download,
  Calendar,
  ThumbsUp,
  ThumbsDown,
} from "lucide-react";
import {
  CategoryPresets,
  LedgerScope,
  AccountType,
  NewTransaction,
  createTransaction,
  fetchTransactions,
  fetchAllTransactions,
  fetchOCRLogs,
  updateOCRLogFeedback,
  OCRLog,
} from "@/lib/api";
import {
  canonicalizeCategory,
  canonicalizeSubCategory,
} from "@/lib/category-i18n";
import { useTranslations } from "next-intl";

/** Excel needs a UTF-8 BOM to open Korean CSV correctly on macOS/Windows. */
const CSV_UTF8_BOM = "\uFEFF";

function downloadTextCsv(filename: string, body: string) {
  const blob = new Blob([CSV_UTF8_BOM + body], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

interface Props {
  scope: LedgerScope;
  accountType: AccountType;
  presets: CategoryPresets | null;
  onChanged: () => void;
}

interface EditableTransaction {
  id: string; // temp unique key
  date: string;
  amount: number;
  currency: "CAD" | "KRW" | "USD";
  merchant: string;
  category: string;
  sub_category: string;
  items: Array<{
    name: string;
    standardized_name: string;
    quantity: number;
    unit: string;
    unit_price: number;
    total_price: number;
  }>;
  expanded?: boolean;
  selected?: boolean;
}

export default function ImportView({ scope, accountType, presets, onChanged }: Props) {
  const t = useTranslations("importPage");
  const tCommon = useTranslations("common");
  const tNav = useTranslations("nav");

  const [activeSubTab, setActiveSubTab] = useState<"csv" | "logs">("csv");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // CSV Tab State
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvPreview, setCsvPreview] = useState<EditableTransaction[]>([]);
  const [exportCurrency, setExportCurrency] = useState<"ALL" | "CAD" | "KRW">("ALL");
  const [exportAccountType, setExportAccountType] = useState<AccountType>("personal");

  // OCR Logs Tab State
  const [logs, setLogs] = useState<OCRLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  useEffect(() => {
    if (activeSubTab === "logs") {
      loadLogs();
    }
  }, [activeSubTab]);


  async function loadLogs() {
    try {
      setLoadingLogs(true);
      const l = await fetchOCRLogs();
      setLogs(l);
    } catch (err: any) {
      console.error(err);
      setErrorMsg(t("errLoadLogs"));
    } finally {
      setLoadingLogs(false);
    }
  }

  // --- CSV File Processing Handlers ---
  function handleCSVDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.name.endsWith(".csv")) {
      setCsvFile(file);
      parseCSV(file);
    }
  }

  function handleCSVSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file && file.name.endsWith(".csv")) {
      setCsvFile(file);
      parseCSV(file);
    }
  }

  function downloadCSVTemplate() {
    // Valid expense preset pairs only — column order matches parseCSV.
    const csvContent = [
      "date,amount,currency,merchant,category,sub_category",
      "2026-01-15,12.50,CAD,Example Cafe,식비,카페/간식",
      "2026-01-16,45.00,CAD,Grocery Store,식비,식재료/장보기",
      "2026-01-17,28.00,CAD,Shoppers,생활/쇼핑,생필품",
    ].join("\n");

    downloadTextCsv("PairPocket_import_template.csv", csvContent);
  }

  function parseCSV(file: File) {
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = ((event.target?.result as string) || "").replace(/^\uFEFF/, "");
      if (!text) return;

      const rows = text.split(/\r?\n/);
      const mapped: EditableTransaction[] = [];

      // Find header row (skip guide comments if present).
      let dataStart = 1;
      for (let i = 0; i < rows.length; i++) {
        const head = rows[i].trim().toLowerCase();
        if (head.startsWith("date,") || head.startsWith('"date"')) {
          dataStart = i + 1;
          break;
        }
      }

      for (let i = dataStart; i < rows.length; i++) {
        const row = rows[i].trim();
        if (!row || row.startsWith("#")) continue;

        const cols = row.split(",").map((c) => c.replace(/^["']|["']$/g, "").trim());
        if (cols.length < 5) continue;

        const date = cols[0] || new Date().toISOString().split("T")[0];
        const amount = parseFloat(cols[1]) || 0;
        const currency = (cols[2] || "CAD").toUpperCase() as any;
        const merchant = cols[3] || t("unspecified");
        const category = canonicalizeCategory(cols[4] || "식비");
        const sub_category = canonicalizeSubCategory(cols[5] || "카페/간식");

        mapped.push({
          id: `csv-${Date.now()}-${i}`,
          date,
          amount,
          currency,
          merchant,
          category,
          sub_category,
          items: [],
          selected: true,
        });
      }
      setCsvPreview(mapped);
    };
    reader.readAsText(file);
  }

  async function saveCSVTransactions() {
    const toSave = csvPreview.filter((tx) => tx.selected);
    if (toSave.length === 0) {
      setErrorMsg(t("errCsvNoneSelected"));
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    let count = 0;
    try {
      for (const tx of toSave) {
        const payload: NewTransaction = {
          date: new Date(tx.date).toISOString(),
          amount: tx.amount,
          currency: tx.currency as any,
          type: "expense",
          account_type: accountType,
          category: tx.category,
          sub_category: tx.sub_category,
          merchant: tx.merchant,
          items: [],
        };
        await createTransaction(payload);
        count++;
      }
      setSuccessMsg(t("csvSaveSuccess", { count }));
      setCsvPreview([]);
      setCsvFile(null);
      onChanged();
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || t("errCsvImport"));
    } finally {
      setLoading(false);
    }
  }

  // --- Export Ledger to CSV ---
  async function exportToCSV() {
    try {
      setLoading(true);
      setErrorMsg(null);

      let txs = [];
      if (exportCurrency === "ALL") {
        txs = await fetchAllTransactions({ accountType: exportAccountType });
      } else {
        txs = await fetchTransactions({ accountType: exportAccountType, currency: exportCurrency });
      }

      if (txs.length === 0) {
        setErrorMsg(t("errCsvEmptyExport"));
        return;
      }

      // Generate CSV string (UTF-8 BOM added in downloadTextCsv for Excel)
      const headers = "Date,Amount,Currency,Merchant,Category,SubCategory,Type,AccountId\n";
      const csvContent =
        headers +
        txs
          .map((t) => {
            const dateStr = new Date(t.date).toISOString().split("T")[0];
            return `"${dateStr}",${t.amount},"${t.currency}","${t.merchant.replace(/"/g, '""')}","${t.category}","${t.sub_category}","${t.type}","${t.account_id || ""}"`;
          })
          .join("\n");

      downloadTextCsv(
        `PairPocket_${exportAccountType}_${exportCurrency}_${new Date().toISOString().split("T")[0]}.csv`,
        csvContent
      );
      setSuccessMsg(t("csvExportSuccess"));
    } catch (err: any) {
      console.error(err);
      setErrorMsg(t("errCsvExport"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-20">
      {/* Title & Tabs */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-gray-150 dark:border-gray-800 pb-4 min-w-0">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-gray-900 dark:text-white flex items-center gap-2 min-w-0">
            <Sparkles className="h-6 w-6 shrink-0 text-indigo-500 animate-pulse" />
            <span className="break-words min-w-0" title={t("title")}>
              {t("title")}
            </span>
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 break-words whitespace-normal">
            {t("subtitle")}
          </p>
        </div>

        <div className="flex gap-1 rounded-xl bg-gray-100 dark:bg-gray-800/60 p-1 self-start sm:self-auto overflow-x-auto max-w-full">
          <button
            onClick={() => setActiveSubTab("csv")}
            className={`rounded-lg px-3 sm:px-4 py-2 text-xs font-semibold transition-all whitespace-nowrap shrink-0 ${
              activeSubTab === "csv"
                ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
                : "text-gray-500 hover:text-gray-900 dark:hover:text-white"
            }`}
          >
            {t("tabCsv")}
          </button>
          <button
            onClick={() => setActiveSubTab("logs")}
            className={`rounded-lg px-3 sm:px-4 py-2 text-xs font-semibold transition-all whitespace-nowrap shrink-0 ${
              activeSubTab === "logs"
                ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
                : "text-gray-500 hover:text-gray-900 dark:hover:text-white"
            }`}
          >
            {t("tabLogs")}
          </button>
        </div>
      </div>

      {/* Alert Banner */}
      {successMsg && (
        <div className="flex items-center gap-2 rounded-xl bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800/40 p-4 text-sm text-green-700 dark:text-green-400">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="flex items-center gap-2 rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/40 p-4 text-sm text-red-700 dark:text-red-400">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* SUB TAB 2: CSV SYNC */}
      {activeSubTab === "csv" && (
        <div className="grid gap-6 md:grid-cols-2">
          {/* CSV Import */}
          <div className="rounded-2xl border border-gray-150 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 space-y-4">
            <div>
              <h2 className="text-base font-bold text-gray-800 dark:text-white flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5 text-indigo-500" />
                {t("csvImportTitle")}
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {t("csvImportHint")}
              </p>
              <button
                type="button"
                onClick={downloadCSVTemplate}
                title={t("csvDownloadTemplateTooltip")}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-gray-250 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-xs font-semibold px-3.5 py-2 transition-all"
              >
                <Download className="h-3.5 w-3.5 shrink-0" />
                <span className="whitespace-nowrap">{t("csvDownloadTemplate")}</span>
              </button>
              <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1.5 break-words">
                {t("csvDownloadTemplateTooltip")}
              </p>
            </div>

            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleCSVDrop}
              className="rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/10 hover:border-indigo-500 hover:bg-gray-50 dark:hover:bg-gray-800/20 p-8 text-center transition-all flex flex-col items-center justify-center min-h-[150px]"
            >
              <UploadCloud className="h-8 w-8 text-gray-400 mb-2" />
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                {csvFile ? csvFile.name : t("csvDrop")}
              </span>
              <label className="mt-3 rounded-lg bg-gray-150 hover:bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-white text-xs font-semibold px-3.5 py-2 cursor-pointer transition-all">
                {t("csvChoose")}
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleCSVSelect}
                  className="hidden"
                  disabled={loading}
                />
              </label>
            </div>

            {csvPreview.length > 0 && (
              <div className="space-y-3">
                <div className="max-h-[220px] overflow-y-auto border border-gray-150 dark:border-gray-800 rounded-lg">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-gray-50 dark:bg-gray-800/40 text-gray-600 dark:text-gray-300 border-b border-gray-150 dark:border-gray-800">
                      <tr>
                        <th className="p-2 w-8"></th>
                        <th className="p-2">{t("colDate")}</th>
                        <th className="p-2">{t("colMerchant")}</th>
                        <th className="p-2">{t("colAmount")}</th>
                        <th className="p-2">{t("colCategory")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-150 dark:divide-gray-800/50">
                      {csvPreview.map((tx, idx) => (
                        <tr key={tx.id} className="hover:bg-gray-50/50">
                          <td className="p-2">
                            <input
                              type="checkbox"
                              checked={tx.selected || false}
                              onChange={(e) => {
                                const newPrev = [...csvPreview];
                                newPrev[idx].selected = e.target.checked;
                                setCsvPreview(newPrev);
                              }}
                              className="rounded text-indigo-600"
                            />
                          </td>
                          <td className="p-2 font-mono">{tx.date}</td>
                          <td className="p-2 font-semibold">{tx.merchant}</td>
                          <td className="p-2 text-right font-mono">
                            {tx.currency} {tx.amount.toFixed(2)}
                          </td>
                          <td className="p-2 text-gray-500">{tx.category}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => {
                      setCsvPreview([]);
                      setCsvFile(null);
                    }}
                    className="rounded-lg border border-gray-250 hover:bg-gray-50 text-gray-700 text-xs font-semibold px-3.5 py-2"
                  >
                    {t("cancel")}
                  </button>
                  <button
                    onClick={saveCSVTransactions}
                    className="rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-4 py-2 transition-all flex items-center gap-1"
                  >
                    {loading && <Loader2 className="h-3 w-3 animate-spin" />}
                    {t("csvBulkSave")}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* CSV Export */}
          <div className="rounded-2xl border border-gray-150 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 space-y-5">
            <div>
              <h2 className="text-base font-bold text-gray-800 dark:text-white flex items-center gap-2">
                <Download className="h-5 w-5 text-indigo-500" />
                {t("csvExportTitle")}
              </h2>
              <p className="text-xs text-gray-500 mt-1">
                {t("csvExportHint")}
              </p>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t("exportAccountType")}</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setExportAccountType("personal")}
                    className={`flex-1 rounded-xl border p-3 text-xs font-semibold text-center transition-all ${
                      exportAccountType === "personal"
                        ? "bg-indigo-50 dark:bg-indigo-950/20 text-indigo-600 dark:text-indigo-400 border-indigo-200"
                        : "bg-white dark:bg-gray-800 border-gray-250 dark:border-gray-700 text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    {t("exportPersonal")}
                  </button>
                  <button
                    onClick={() => setExportAccountType("shared")}
                    className={`flex-1 rounded-xl border p-3 text-xs font-semibold text-center transition-all ${
                      exportAccountType === "shared"
                        ? "bg-indigo-50 dark:bg-indigo-950/20 text-indigo-600 dark:text-indigo-400 border-indigo-200"
                        : "bg-white dark:bg-gray-800 border-gray-250 dark:border-gray-700 text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    {t("exportShared")}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t("exportCurrency")}</label>
                <div className="flex gap-2">
                  {(["ALL", "CAD", "KRW"] as const).map((curr) => (
                    <button
                      key={curr}
                      onClick={() => setExportCurrency(curr)}
                      className={`flex-1 rounded-xl border p-3 text-xs font-semibold text-center transition-all ${
                        exportCurrency === curr
                          ? "bg-indigo-50 dark:bg-indigo-950/20 text-indigo-600 dark:text-indigo-400 border-indigo-200"
                          : "bg-white dark:bg-gray-800 border-gray-250 dark:border-gray-700 text-gray-600 hover:bg-gray-50"
                      }`}
                    >
                      {curr === "ALL" ? t("exportAll") : curr}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <button
              onClick={exportToCSV}
              className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold py-3 transition-all flex items-center justify-center gap-1 shadow-sm"
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {t("csvDownload")}
            </button>
          </div>
        </div>
      )}

      {/* SUB TAB 3: SCAN LOGS */}
      {activeSubTab === "logs" && (
        <div className="rounded-2xl border border-gray-150 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 space-y-4">
          <div className="flex justify-between items-center border-b border-gray-100 dark:border-gray-800 pb-3">
            <h2 className="text-base font-bold text-gray-800 dark:text-white">{t("logsTitle")}</h2>
            <button
              onClick={loadLogs}
              className="rounded-lg border border-gray-250 hover:bg-gray-50 px-3 py-1.5 text-xs text-gray-700 dark:text-gray-300 font-semibold"
              disabled={loadingLogs}
            >
              {t("refresh")}
            </button>
          </div>

          {loadingLogs ? (
            <div className="flex h-48 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-indigo-600" />
            </div>
          ) : logs.length === 0 ? (
            <div className="text-sm text-gray-400 py-12 text-center italic">
              {t("logsEmpty")}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-gray-500">
                <thead className="bg-gray-50 dark:bg-gray-800/40 text-gray-600 dark:text-gray-300 border-b border-gray-150 dark:border-gray-800">
                  <tr>
                    <th className="p-3">{t("colUploadedAt")}</th>
                    <th className="p-3">{t("colFileName")}</th>
                    <th className="p-3">{t("colModel")}</th>
                    <th className="p-3">{t("colResult")}</th>
                    <th className="p-3">{t("colRating")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-150 dark:divide-gray-800/80">
                  {logs.map((log) => (
                    <tr key={log.id} className="hover:bg-gray-50/50">
                      <td className="p-3 font-mono text-gray-400">
                        {new Date(log.timestamp).toLocaleString()}
                      </td>
                      <td className="p-3 font-semibold text-gray-800 dark:text-white">
                        {log.file_name}
                      </td>
                      <td className="p-3 font-mono text-xs">
                        <span className="rounded bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400 px-2 py-0.5 border border-indigo-100 dark:border-indigo-900/40">
                          {log.model_used || t("unknownModel")}
                        </span>
                      </td>
                      <td className="p-3">
                        {log.status === "success" ? (
                          <span className="text-green-600 font-semibold flex items-center gap-0.5">
                            <CheckCircle2 className="h-3.5 w-3.5" /> {t("success")}
                          </span>
                        ) : (
                          <span className="text-red-500 font-semibold flex items-center gap-0.5" title={log.error_message || ""}>
                            <AlertCircle className="h-3.5 w-3.5" /> {t("failed")}
                          </span>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="flex gap-2">
                          <button
                            onClick={async () => {
                              const newFb = log.feedback === "thumbs_up" ? null : "thumbs_up";
                              await updateOCRLogFeedback(log.id, newFb);
                              loadLogs();
                            }}
                            className={`p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 ${
                              log.feedback === "thumbs_up" ? "text-green-500" : "text-gray-300"
                            }`}
                            title={t("ratingGood")}
                          >
                            <ThumbsUp className="h-4 w-4" />
                          </button>
                          <button
                            onClick={async () => {
                              const newFb = log.feedback === "thumbs_down" ? null : "thumbs_down";
                              await updateOCRLogFeedback(log.id, newFb);
                              loadLogs();
                            }}
                            className={`p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 ${
                              log.feedback === "thumbs_down" ? "text-red-500" : "text-gray-300"
                            }`}
                            title={t("ratingBad")}
                          >
                            <ThumbsDown className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
