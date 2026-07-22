"use client";

import React, { useState, useEffect } from "react";
import {
  UploadCloud,
  FileSpreadsheet,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  Loader2,
  ThumbsUp,
  ThumbsDown,
  Trash2,
  Plus,
  Minus,
  Download,
  Calendar,
  Layers,
  HelpCircle,
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
  API_BASE_URL,
} from "@/lib/api";
import { useTranslations } from "next-intl";

interface Props {
  scope: LedgerScope;
  accountType: AccountType;
  presets: CategoryPresets | null;
  onChanged: () => void;
}

interface SSEStatus {
  event: "trying" | "failed" | "success" | "error";
  model?: string;
  error?: string;
  result?: any;
  log_id?: string;
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
  const tCommon = useTranslations("common");
  const tNav = useTranslations("nav");

  const [activeSubTab, setActiveSubTab] = useState<"ai" | "csv" | "logs">("ai");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // AI Tab State
  const [scanningStatus, setScanningStatus] = useState<string | null>(null);
  const [scanningHistory, setScanningHistory] = useState<string[]>([]);
  const [parsedTransactions, setParsedTransactions] = useState<EditableTransaction[]>([]);
  const [currentLogId, setCurrentLogId] = useState<string | null>(null);
  const [rating, setRating] = useState<"thumbs_up" | "thumbs_down" | null>(null);

  // CSV Tab State
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvPreview, setCsvPreview] = useState<EditableTransaction[]>([]);
  const [exportCurrency, setExportCurrency] = useState<"ALL" | "CAD" | "KRW">("ALL");
  const [exportAccountType, setExportAccountType] = useState<AccountType>("personal");

  // OCR Logs Tab State
  const [logs, setLogs] = useState<OCRLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  const categories = presets?.expense.map((eg) => eg.category) || [
    "식비",
    "생활/쇼핑",
    "문화/취미",
    "교통/차량",
    "주거/통신",
    "투자/저축",
    "건강/의료",
    "경조사/선물",
    "세금",
  ];

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
      setErrorMsg("로그를 가져오는 도중 에러가 발생했습니다.");
    } finally {
      setLoadingLogs(false);
    }
  }

  // --- AI Scan File Handlers ---
  async function handleAIFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    await processAIFile(file);
  }

  async function processAIFile(file: File) {
    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    setScanningHistory([]);
    setRating(null);
    setCurrentLogId(null);
    setParsedTransactions([]);

    const formData = new FormData();
    formData.append("file", file);

    const token = localStorage.getItem("pairpocket_token") || "";

    try {
      setScanningStatus(`${file.name} 분석 대기 중...`);
      // Start streaming SSE connection via POST
      const response = await fetch(`${API_BASE_URL}/api/ai/parse-stream`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => null);
        throw new Error(errJson?.detail || "AI 서버와 연결에 실패했습니다.");
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("스트리밍 리더를 사용할 수 없습니다.");

      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const dataStr = line.slice(6).trim();
            if (!dataStr) continue;

            const statusObj = JSON.parse(dataStr) as SSEStatus;
            handleSSEEvent(statusObj);
          }
        }
      }
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "파일 분석 도중 예기치 못한 에러가 발생했습니다.");
      setScanningStatus(null);
      setLoading(false);
    }
  }

  function handleSSEEvent(statusObj: SSEStatus) {
    if (statusObj.event === "trying") {
      const msg = `⚡ ${statusObj.model}로 분석 중입니다...`;
      setScanningStatus(msg);
      setScanningHistory((prev) => [...prev, msg]);
    } else if (statusObj.event === "failed") {
      const msg = `❌ ${statusObj.model} 분석 실패: ${statusObj.error || "사용량 초과 또는 권한 문제"}`;
      setScanningHistory((prev) => [...prev, msg]);
    } else if (statusObj.event === "error") {
      setErrorMsg(statusObj.error || "모든 AI 모델 분석이 실패했습니다.");
      setScanningStatus(null);
      setLoading(false);
      if (statusObj.log_id) setCurrentLogId(statusObj.log_id);
    } else if (statusObj.event === "success") {
      setSuccessMsg("AI 영수증 분석 성공!");
      setScanningStatus(null);
      setLoading(false);
      if (statusObj.log_id) setCurrentLogId(statusObj.log_id);

      const parsed = statusObj.result;
      if (parsed && parsed.transactions) {
        const mapped: EditableTransaction[] = parsed.transactions.map((tx: any, idx: number) => ({
          id: `tx-${Date.now()}-${idx}`,
          date: tx.date || new Date().toISOString().split("T")[0],
          amount: tx.amount || 0,
          currency: tx.currency || "CAD",
          merchant: tx.merchant || "미지정",
          category: tx.category || "식비",
          sub_category: tx.sub_category || "기타",
          items: (tx.items || []).map((item: any) => ({
            name: item.name || "",
            standardized_name: item.standardized_name || item.name || "",
            quantity: item.quantity || 1,
            unit: item.unit || "개",
            unit_price: item.unit_price || 0,
            total_price: item.total_price || 0,
          })),
          expanded: false,
          selected: true,
        }));
        setParsedTransactions(mapped);
      }
    }
  }

  async function handleFeedback(fb: "thumbs_up" | "thumbs_down") {
    if (!currentLogId) return;
    try {
      await updateOCRLogFeedback(currentLogId, fb);
      setRating(fb);
      setSuccessMsg("피드백을 남겨주셔서 감사합니다!");
    } catch (err: any) {
      console.error(err);
      setErrorMsg("피드백 기록에 실패했습니다.");
    }
  }

  // --- Editable Grid Cells Update Handlers ---
  function updateTxField(txId: string, field: keyof EditableTransaction, value: any) {
    setParsedTransactions((prev) =>
      prev.map((tx) => (tx.id === txId ? { ...tx, [field]: value } : tx))
    );
  }

  function updateItemField(
    txId: string,
    itemIdx: number,
    field: string,
    value: any
  ) {
    setParsedTransactions((prev) =>
      prev.map((tx) => {
        if (tx.id !== txId) return tx;
        const newItems = [...tx.items];
        const item = { ...newItems[itemIdx], [field]: value };

        // Automatic React Calculations
        if (field === "quantity" || field === "unit_price") {
          item.total_price = Number((item.quantity * item.unit_price).toFixed(2));
        } else if (field === "total_price") {
          if (item.quantity > 0) {
            item.unit_price = Number((item.total_price / item.quantity).toFixed(4));
          }
        }

        newItems[itemIdx] = item;

        // Recalculate transaction total amount based on items sum
        const sumTotal = newItems.reduce((acc, it) => acc + it.total_price, 0);
        return {
          ...tx,
          items: newItems,
          amount: sumTotal > 0 ? Number(sumTotal.toFixed(2)) : tx.amount,
        };
      })
    );
  }

  function addSubItem(txId: string) {
    setParsedTransactions((prev) =>
      prev.map((tx) => {
        if (tx.id !== txId) return tx;
        return {
          ...tx,
          items: [
            ...tx.items,
            { name: "", standardized_name: "", quantity: 1, unit: "개", unit_price: 0, total_price: 0 },
          ],
        };
      })
    );
  }

  function removeSubItem(txId: string, itemIdx: number) {
    setParsedTransactions((prev) =>
      prev.map((tx) => {
        if (tx.id !== txId) return tx;
        const newItems = tx.items.filter((_, idx) => idx !== itemIdx);
        const sumTotal = newItems.reduce((acc, it) => acc + it.total_price, 0);
        return {
          ...tx,
          items: newItems,
          amount: sumTotal > 0 ? Number(sumTotal.toFixed(2)) : tx.amount,
        };
      })
    );
  }

  // --- Bulk Save parsed items to DB ---
  async function saveSelectedTransactions() {
    const toSave = parsedTransactions.filter((tx) => tx.selected);
    if (toSave.length === 0) {
      setErrorMsg("선택된 내역이 없습니다.");
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
          items: tx.items.map((it) => ({
            name: it.name,
            standardized_name: it.standardized_name,
            quantity: it.quantity,
            unit: it.unit,
            unit_price: it.unit_price,
            total_price: it.total_price,
          })),
        };
        await createTransaction(payload);
        count++;
      }
      setSuccessMsg(`성공적으로 ${count}건의 거래 내역을 저장했습니다!`);
      setParsedTransactions([]);
      onChanged();
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "거래 저장 도중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
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

  function parseCSV(file: File) {
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (!text) return;

      const rows = text.split("\n");
      const mapped: EditableTransaction[] = [];
      
      // Simple CSV parser
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i].trim();
        if (!row) continue;

        // Split by comma (handles simple cases, does not support quotes with commas)
        const cols = row.split(",").map((c) => c.replace(/^["']|["']$/g, "").trim());
        if (cols.length < 5) continue;

        const date = cols[0] || new Date().toISOString().split("T")[0];
        const amount = parseFloat(cols[1]) || 0;
        const currency = (cols[2] || "CAD").toUpperCase() as any;
        const merchant = cols[3] || "미지정";
        const category = cols[4] || "생활/쇼핑";
        const sub_category = cols[5] || "기타";

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
      setErrorMsg("선택된 CSV 내역이 없습니다.");
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
      setSuccessMsg(`성공적으로 CSV 내역 ${count}건을 가계부에 등록했습니다!`);
      setCsvPreview([]);
      setCsvFile(null);
      onChanged();
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "CSV 가져오기 도중 오류가 발생했습니다.");
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
        setErrorMsg("출력할 거래 내역이 존재하지 않습니다.");
        return;
      }

      // Generate CSV string
      const headers = "Date,Amount,Currency,Merchant,Category,SubCategory,Type,AccountId\n";
      const csvContent =
        headers +
        txs
          .map((t) => {
            const dateStr = new Date(t.date).toISOString().split("T")[0];
            return `"${dateStr}",${t.amount},"${t.currency}","${t.merchant.replace(/"/g, '""')}","${t.category}","${t.sub_category}","${t.type}","${t.account_id || ""}"`;
          })
          .join("\n");

      // Download file
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `PairPocket_${exportAccountType}_${exportCurrency}_${new Date().toISOString().split("T")[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setSuccessMsg("가계부 데이터를 CSV로 성공적으로 내보냈습니다!");
    } catch (err: any) {
      console.error(err);
      setErrorMsg("CSV 내보내기 도중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-20">
      {/* Title & Tabs */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-gray-150 dark:border-gray-800 pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-indigo-500 animate-pulse" />
            스마트 가져오기 & 파일 관리
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            영수증 사진, 청구서 PDF, CSV 내역을 AI로 스마트하게 가계부에 일괄 등록합니다.
          </p>
        </div>

        <div className="flex gap-1 rounded-xl bg-gray-100 dark:bg-gray-800/60 p-1 self-start sm:self-auto">
          <button
            onClick={() => setActiveSubTab("ai")}
            className={`rounded-lg px-4 py-2 text-xs font-semibold transition-all ${
              activeSubTab === "ai"
                ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
                : "text-gray-500 hover:text-gray-900 dark:hover:text-white"
            }`}
          >
            AI 파일 스캐너
          </button>
          <button
            onClick={() => setActiveSubTab("csv")}
            className={`rounded-lg px-4 py-2 text-xs font-semibold transition-all ${
              activeSubTab === "csv"
                ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
                : "text-gray-500 hover:text-gray-900 dark:hover:text-white"
            }`}
          >
            CSV 연동
          </button>
          <button
            onClick={() => setActiveSubTab("logs")}
            className={`rounded-lg px-4 py-2 text-xs font-semibold transition-all ${
              activeSubTab === "logs"
                ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
                : "text-gray-500 hover:text-gray-900 dark:hover:text-white"
            }`}
          >
            AI 분석 로그
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

      {/* SUB TAB 1: AI FILE SCANNER */}
      {activeSubTab === "ai" && (
        <div className="space-y-6">
          {/* Dropzone */}
          <div className="grid gap-6 md:grid-cols-3">
            <div className="md:col-span-1 rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 hover:border-indigo-500 dark:hover:border-indigo-500 p-8 text-center transition-all flex flex-col items-center justify-center min-h-[220px]">
              <UploadCloud className="h-12 w-12 text-gray-400 mb-3" />
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                영수증 사진 & 청구서 PDF 업로드
              </p>
              <p className="text-xs text-gray-400 mt-1 max-w-[180px]">
                HEIC, PNG, JPEG 이미지 파일 및 PDF 지원
              </p>
              <label className="mt-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-4 py-2.5 cursor-pointer shadow-sm">
                파일 선택하기
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={handleAIFileUpload}
                  className="hidden"
                  disabled={loading}
                />
              </label>
            </div>

            {/* SSE streaming history logs */}
            <div className="md:col-span-2 rounded-2xl bg-gray-50 dark:bg-gray-800/30 border border-gray-150 dark:border-gray-800 p-6 flex flex-col justify-between min-h-[220px]">
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">AI 실시간 스캔 정보</h3>
                <div className="max-h-[120px] overflow-y-auto space-y-1.5 pr-2">
                  {scanningHistory.map((h, i) => (
                    <div key={i} className="text-xs text-gray-500 font-mono">
                      {h}
                    </div>
                  ))}
                  {scanningStatus && (
                    <div className="flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 font-semibold font-mono animate-pulse">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      {scanningStatus}
                    </div>
                  )}
                  {scanningHistory.length === 0 && !scanningStatus && (
                    <div className="text-xs text-gray-400 italic">파일을 업로드하면 모델 호출 상태가 여기에 기록됩니다.</div>
                  )}
                </div>
              </div>

              {/* FeedBack 👍/👎 Option */}
              {currentLogId && (
                <div className="flex items-center justify-between border-t border-gray-150 dark:border-gray-800/80 pt-4 mt-2">
                  <span className="text-xs font-semibold text-gray-500 flex items-center gap-1">
                    <HelpCircle className="h-4 w-4" />
                    AI의 스캔 품질이 만족스럽나요?
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleFeedback("thumbs_up")}
                      className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold border transition-all ${
                        rating === "thumbs_up"
                          ? "bg-green-100 dark:bg-green-950/30 text-green-700 dark:text-green-400 border-green-200"
                          : "bg-white dark:bg-gray-800 border-gray-250 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50"
                      }`}
                    >
                      <ThumbsUp className="h-3.5 w-3.5" />
                      최고예요
                    </button>
                    <button
                      onClick={() => handleFeedback("thumbs_down")}
                      className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold border transition-all ${
                        rating === "thumbs_down"
                          ? "bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-400 border-red-200"
                          : "bg-white dark:bg-gray-800 border-gray-250 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50"
                      }`}
                    >
                      <ThumbsDown className="h-3.5 w-3.5" />
                      별로예요
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Cherry-Picking Review Grid */}
          {parsedTransactions.length > 0 && (
            <div className="rounded-2xl border border-gray-150 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 pb-3">
                <h2 className="text-base font-bold text-gray-800 dark:text-white">분석 완료 거래 검토</h2>
                <div className="text-xs text-gray-500">
                  저장할 거래를 체크하고 세부 품목은 <span className="font-semibold text-indigo-600">+</span> 버튼을 눌러 확인 및 편집하세요.
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-gray-500">
                  <thead className="bg-gray-50 dark:bg-gray-800/40 text-xs uppercase text-gray-700 dark:text-gray-300 font-semibold border-b border-gray-150 dark:border-gray-800">
                    <tr>
                      <th className="p-3 w-10">
                        <input
                          type="checkbox"
                          checked={parsedTransactions.every((tx) => tx.selected)}
                          onChange={(e) =>
                            setParsedTransactions((prev) =>
                              prev.map((tx) => ({ ...tx, selected: e.target.checked }))
                            )
                          }
                          className="rounded text-indigo-600"
                        />
                      </th>
                      <th className="p-3">날짜</th>
                      <th className="p-3">가게명</th>
                      <th className="p-3">금액</th>
                      <th className="p-3">통화</th>
                      <th className="p-3">카테고리</th>
                      <th className="p-3">중분류</th>
                      <th className="p-3">세부품목</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-150 dark:divide-gray-800/80">
                    {parsedTransactions.map((tx) => (
                      <React.Fragment key={tx.id}>
                        <tr className="hover:bg-gray-50/50 dark:hover:bg-gray-800/10">
                          <td className="p-3">
                            <input
                              type="checkbox"
                              checked={tx.selected || false}
                              onChange={(e) => updateTxField(tx.id, "selected", e.target.checked)}
                              className="rounded text-indigo-600"
                            />
                          </td>
                          <td className="p-3">
                            <input
                              type="date"
                              value={tx.date}
                              onChange={(e) => updateTxField(tx.id, "date", e.target.value)}
                              className="bg-transparent border-0 border-b border-dashed border-gray-300 focus:border-indigo-500 p-0 text-sm font-medium w-28 text-gray-800 dark:text-white"
                            />
                          </td>
                          <td className="p-3">
                            <input
                              type="text"
                              value={tx.merchant}
                              onChange={(e) => updateTxField(tx.id, "merchant", e.target.value)}
                              className="bg-transparent border-0 border-b border-dashed border-gray-300 focus:border-indigo-500 p-0 text-sm font-medium w-full text-gray-800 dark:text-white"
                            />
                          </td>
                          <td className="p-3 font-semibold text-gray-900 dark:text-white">
                            <input
                              type="number"
                              step="0.01"
                              value={tx.amount}
                              onChange={(e) => updateTxField(tx.id, "amount", parseFloat(e.target.value) || 0)}
                              className="bg-transparent border-0 border-b border-dashed border-gray-300 focus:border-indigo-500 p-0 text-sm font-semibold w-20 text-right text-gray-800 dark:text-white"
                            />
                          </td>
                          <td className="p-3">
                            <select
                              value={tx.currency}
                              onChange={(e) => updateTxField(tx.id, "currency", e.target.value)}
                              className="bg-transparent border-none p-0 text-sm font-semibold w-16"
                            >
                              <option value="CAD">CAD</option>
                              <option value="KRW">KRW</option>
                              <option value="USD">USD</option>
                            </select>
                          </td>
                          <td className="p-3">
                            <select
                              value={tx.category}
                              onChange={(e) => updateTxField(tx.id, "category", e.target.value)}
                              className="bg-transparent border-none p-0 text-sm w-24"
                            >
                              {categories.map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="p-3">
                            <input
                              type="text"
                              value={tx.sub_category}
                              onChange={(e) => updateTxField(tx.id, "sub_category", e.target.value)}
                              className="bg-transparent border-0 border-b border-dashed border-gray-300 focus:border-indigo-500 p-0 text-sm w-24"
                            />
                          </td>
                          <td className="p-3">
                            <button
                              onClick={() => updateTxField(tx.id, "expanded", !tx.expanded)}
                              className="flex items-center gap-1 rounded-lg bg-gray-100 hover:bg-gray-250 dark:bg-gray-800 px-2.5 py-1.5 text-xs text-gray-700 dark:text-gray-300 font-semibold"
                            >
                              <Plus className="h-3 w-3" />
                              품목 ({tx.items.length})
                            </button>
                          </td>
                        </tr>

                        {/* Expandable detailed items calculation list */}
                        {tx.expanded && (
                          <tr>
                            <td colSpan={8} className="bg-gray-50/60 dark:bg-gray-800/20 p-4">
                              <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 space-y-3">
                                <div className="flex justify-between items-center border-b border-gray-100 dark:border-gray-800 pb-2">
                                  <span className="text-xs font-bold text-gray-700 dark:text-gray-300">
                                    영수증 소분류 품목 내역 (단가/총액 연동 계산기)
                                  </span>
                                  <button
                                    onClick={() => addSubItem(tx.id)}
                                    className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 font-semibold"
                                  >
                                    <Plus className="h-3 w-3" />
                                    품목 추가
                                  </button>
                                </div>

                                {tx.items.length === 0 ? (
                                  <div className="text-xs text-gray-400 py-2 italic text-center">
                                    등록된 품목이 없습니다. 우측 품목 추가를 눌러 가격 계산에 맞춰 등록하세요.
                                  </div>
                                ) : (
                                  <div className="space-y-2">
                                    <div className="grid grid-cols-12 gap-2 text-xs font-semibold text-gray-500 px-2">
                                      <div className="col-span-3">품목명 (영수증 표기)</div>
                                      <div className="col-span-3">비교용 표준품목명 (한국어 권장)</div>
                                      <div className="col-span-1">수량</div>
                                      <div className="col-span-1">단위</div>
                                      <div className="col-span-2">단가 (Unit Price)</div>
                                      <div className="col-span-1">합계</div>
                                      <div className="col-span-1"></div>
                                    </div>

                                    {tx.items.map((item, itemIdx) => (
                                      <div key={itemIdx} className="grid grid-cols-12 gap-2 items-center px-1">
                                        <input
                                          type="text"
                                          value={item.name}
                                          onChange={(e) => updateItemField(tx.id, itemIdx, "name", e.target.value)}
                                          placeholder="예: Watermelon"
                                          className="col-span-3 bg-gray-50 dark:bg-gray-800 border-none rounded-lg p-2 text-xs"
                                        />
                                        <input
                                          type="text"
                                          value={item.standardized_name}
                                          onChange={(e) => updateItemField(tx.id, itemIdx, "standardized_name", e.target.value)}
                                          placeholder="예: 수박"
                                          className="col-span-3 bg-gray-50 dark:bg-gray-800 border-none rounded-lg p-2 text-xs"
                                        />
                                        <input
                                          type="number"
                                          step="0.01"
                                          value={item.quantity}
                                          onChange={(e) => updateItemField(tx.id, itemIdx, "quantity", parseFloat(e.target.value) || 0)}
                                          className="col-span-1 bg-gray-50 dark:bg-gray-800 border-none rounded-lg p-2 text-xs text-right"
                                        />
                                        <input
                                          type="text"
                                          value={item.unit}
                                          onChange={(e) => updateItemField(tx.id, itemIdx, "unit", e.target.value)}
                                          placeholder="lb / 개"
                                          className="col-span-1 bg-gray-50 dark:bg-gray-800 border-none rounded-lg p-2 text-xs"
                                        />
                                        <input
                                          type="number"
                                          step="0.0001"
                                          value={item.unit_price}
                                          onChange={(e) => updateItemField(tx.id, itemIdx, "unit_price", parseFloat(e.target.value) || 0)}
                                          className="col-span-2 bg-gray-50 dark:bg-gray-800 border-none rounded-lg p-2 text-xs text-right"
                                        />
                                        <input
                                          type="number"
                                          step="0.01"
                                          value={item.total_price}
                                          onChange={(e) => updateItemField(tx.id, itemIdx, "total_price", parseFloat(e.target.value) || 0)}
                                          className="col-span-1 bg-gray-50 dark:bg-gray-800 border-none rounded-lg p-2 text-xs text-right font-semibold"
                                        />
                                        <button
                                          onClick={() => removeSubItem(tx.id, itemIdx)}
                                          className="col-span-1 text-red-500 hover:text-red-600 flex justify-center"
                                        >
                                          <Trash2 className="h-4 w-4" />
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setParsedTransactions([])}
                  className="rounded-xl border border-gray-250 hover:bg-gray-50 text-gray-700 text-xs font-semibold px-4 py-2.5 transition-all"
                  disabled={loading}
                >
                  초기화
                </button>
                <button
                  onClick={saveSelectedTransactions}
                  className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-5 py-2.5 shadow-sm transition-all flex items-center gap-1"
                  disabled={loading}
                >
                  {loading && <Loader2 className="h-3 w-3 animate-spin" />}
                  선택한 {parsedTransactions.filter((t) => t.selected).length}건 가계부에 등록
                </button>
              </div>
            </div>
          )}
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
                CSV 가계부 가져오기 (파일 업로드)
              </h2>
              <p className="text-xs text-gray-500 mt-1">
                CSV 형식(`날짜, 금액, 통화, 거래처, 대분류, 중분류`)의 파일을 가계부에 일괄 등록합니다.
              </p>
            </div>

            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleCSVDrop}
              className="rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/10 hover:border-indigo-500 hover:bg-gray-50 dark:hover:bg-gray-800/20 p-8 text-center transition-all flex flex-col items-center justify-center min-h-[150px]"
            >
              <UploadCloud className="h-8 w-8 text-gray-400 mb-2" />
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                {csvFile ? csvFile.name : "이곳에 CSV 파일을 끌어놓으세요"}
              </span>
              <label className="mt-3 rounded-lg bg-gray-150 hover:bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-white text-xs font-semibold px-3.5 py-2 cursor-pointer transition-all">
                파일 선택
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
                        <th className="p-2">날짜</th>
                        <th className="p-2">거래처</th>
                        <th className="p-2">금액</th>
                        <th className="p-2">카테고리</th>
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
                    취소
                  </button>
                  <button
                    onClick={saveCSVTransactions}
                    className="rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-4 py-2 transition-all flex items-center gap-1"
                  >
                    {loading && <Loader2 className="h-3 w-3 animate-spin" />}
                    가계부에 일괄 등록
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
                CSV 가계부 내보내기 (다운로드)
              </h2>
              <p className="text-xs text-gray-500 mt-1">
                현재 가계부에 등록된 거래 내역 데이터를 CSV 파일로 다운로드합니다. 백업이나 외부 사용에 적합합니다.
              </p>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">내보낼 장부 구분</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setExportAccountType("personal")}
                    className={`flex-1 rounded-xl border p-3 text-xs font-semibold text-center transition-all ${
                      exportAccountType === "personal"
                        ? "bg-indigo-50 dark:bg-indigo-950/20 text-indigo-600 dark:text-indigo-400 border-indigo-200"
                        : "bg-white dark:bg-gray-800 border-gray-250 dark:border-gray-700 text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    개인 장부 (Personal)
                  </button>
                  <button
                    onClick={() => setExportAccountType("shared")}
                    className={`flex-1 rounded-xl border p-3 text-xs font-semibold text-center transition-all ${
                      exportAccountType === "shared"
                        ? "bg-indigo-50 dark:bg-indigo-950/20 text-indigo-600 dark:text-indigo-400 border-indigo-200"
                        : "bg-white dark:bg-gray-800 border-gray-250 dark:border-gray-700 text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    공용 장부 (Shared)
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">장부 통화 필터</label>
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
                      {curr === "ALL" ? "전체 (ALL)" : curr}
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
              CSV 다운로드하기
            </button>
          </div>
        </div>
      )}

      {/* SUB TAB 3: SCAN LOGS */}
      {activeSubTab === "logs" && (
        <div className="rounded-2xl border border-gray-150 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 space-y-4">
          <div className="flex justify-between items-center border-b border-gray-100 dark:border-gray-800 pb-3">
            <h2 className="text-base font-bold text-gray-800 dark:text-white">AI 스캔 이력 & 피드백 조회</h2>
            <button
              onClick={loadLogs}
              className="rounded-lg border border-gray-250 hover:bg-gray-50 px-3 py-1.5 text-xs text-gray-700 dark:text-gray-300 font-semibold"
              disabled={loadingLogs}
            >
              새로고침
            </button>
          </div>

          {loadingLogs ? (
            <div className="flex h-48 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-indigo-600" />
            </div>
          ) : logs.length === 0 ? (
            <div className="text-sm text-gray-400 py-12 text-center italic">
              아직 처리된 AI 스캔 데이터 로그가 존재하지 않습니다.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-gray-500">
                <thead className="bg-gray-50 dark:bg-gray-800/40 text-gray-600 dark:text-gray-300 border-b border-gray-150 dark:border-gray-800">
                  <tr>
                    <th className="p-3">업로드 시간</th>
                    <th className="p-3">파일명</th>
                    <th className="p-3">사용 모델</th>
                    <th className="p-3">처리 결과</th>
                    <th className="p-3">사용자 평점</th>
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
                          {log.model_used || "미확인"}
                        </span>
                      </td>
                      <td className="p-3">
                        {log.status === "success" ? (
                          <span className="text-green-600 font-semibold flex items-center gap-0.5">
                            <CheckCircle2 className="h-3.5 w-3.5" /> 성공
                          </span>
                        ) : (
                          <span className="text-red-500 font-semibold flex items-center gap-0.5" title={log.error_message || ""}>
                            <AlertCircle className="h-3.5 w-3.5" /> 실패
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
                            title="만족"
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
                            title="불만족"
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
