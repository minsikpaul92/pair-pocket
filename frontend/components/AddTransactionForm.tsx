"use client";

import { useState } from "react";

import {
  Currency,
  NewTransaction,
  Transaction,
  TransactionType,
  createTransaction,
} from "@/lib/api";

interface Props {
  onCreated: (tx: Transaction) => void;
  onCancel: () => void;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function AddTransactionForm({ onCreated, onCancel }: Props) {
  const [type, setType] = useState<TransactionType>("expense");
  const [currency, setCurrency] = useState<Currency>("CAD");
  const [amount, setAmount] = useState("");
  const [merchant, setMerchant] = useState("");
  const [category, setCategory] = useState("");
  const [date, setDate] = useState(todayISO());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const numericAmount = Number(amount);
    if (!numericAmount || numericAmount <= 0) {
      setError("금액을 올바르게 입력해 주세요.");
      return;
    }

    const payload: NewTransaction = {
      date: `${date}T00:00:00`,
      amount: numericAmount,
      currency,
      type,
      account_type: "personal",
      category: category.trim() || "기타",
      merchant: merchant.trim() || "미지정",
    };

    setSubmitting(true);
    try {
      const created = await createTransaction(payload);
      onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장 중 오류가 발생했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  const segmentBase =
    "flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors";

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-4 bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-5 space-y-4"
    >
      {/* Type toggle */}
      <div className="flex gap-2 rounded-xl bg-gray-100 dark:bg-gray-900 p-1">
        <button
          type="button"
          onClick={() => setType("expense")}
          className={`${segmentBase} ${
            type === "expense"
              ? "bg-white dark:bg-gray-700 text-red-500 shadow-sm"
              : "text-gray-500 dark:text-gray-400"
          }`}
        >
          지출
        </button>
        <button
          type="button"
          onClick={() => setType("income")}
          className={`${segmentBase} ${
            type === "income"
              ? "bg-white dark:bg-gray-700 text-blue-500 shadow-sm"
              : "text-gray-500 dark:text-gray-400"
          }`}
        >
          수입
        </button>
      </div>

      {/* Amount + currency */}
      <div className="flex gap-2">
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="금액"
          className="flex-1 bg-gray-50 dark:bg-gray-900 border-0 rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none"
        />
        <div className="flex rounded-xl bg-gray-100 dark:bg-gray-900 p-1">
          {(["CAD", "KRW"] as Currency[]).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCurrency(c)}
              className={`rounded-lg px-3 text-sm font-semibold transition-colors ${
                currency === c
                  ? "bg-white dark:bg-gray-700 text-blue-500 shadow-sm"
                  : "text-gray-500 dark:text-gray-400"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <input
        value={merchant}
        onChange={(e) => setMerchant(e.target.value)}
        placeholder="사용처 (예: Costco)"
        className="w-full bg-gray-50 dark:bg-gray-900 border-0 rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none"
      />
      <input
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        placeholder="카테고리 (예: 식비)"
        className="w-full bg-gray-50 dark:bg-gray-900 border-0 rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none"
      />
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className="w-full bg-gray-50 dark:bg-gray-900 border-0 rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none"
      />

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 bg-gray-100 dark:bg-gray-900 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-900 dark:text-white font-semibold rounded-xl px-4 py-3 transition-colors"
        >
          취소
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="flex-1 bg-blue-500 hover:bg-blue-600 active:bg-blue-700 disabled:opacity-50 text-white font-semibold rounded-xl px-4 py-3 transition-colors"
        >
          {submitting ? "저장 중..." : "저장"}
        </button>
      </div>
    </form>
  );
}
