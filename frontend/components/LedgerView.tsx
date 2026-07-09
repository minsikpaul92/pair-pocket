"use client";

import { LogOut, Plus, UserPlus, Wallet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import AddTransactionForm from "@/components/AddTransactionForm";
import {
  Currency,
  CurrentUser,
  Transaction,
  clearToken,
  fetchTransactions,
  formatAmount,
} from "@/lib/api";

interface Props {
  user: CurrentUser;
  onLogout: () => void;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ko-KR", {
    month: "long",
    day: "numeric",
  });
}

export default function LedgerView({ user, onLogout }: Props) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    fetchTransactions("personal")
      .then(setTransactions)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "불러오기 실패")
      )
      .finally(() => setLoading(false));
  }, []);

  // Per-currency net balance (income - expense) for the personal ledger.
  const balances = useMemo(() => {
    const totals: Record<Currency, number> = { CAD: 0, KRW: 0 };
    for (const tx of transactions) {
      const signed = tx.type === "income" ? tx.amount : -tx.amount;
      totals[tx.currency] += signed;
    }
    return totals;
  }, [transactions]);

  function handleLogout() {
    clearToken();
    onLogout();
  }

  function handleCreated(tx: Transaction) {
    setTransactions((prev) => [tx, ...prev]);
    setShowForm(false);
  }

  function handleInvite() {
    alert("파트너 초대 기능은 곧 제공될 예정입니다. 지금은 개인 가계부를 사용할 수 있어요.");
  }

  return (
    <main className="min-h-dvh bg-gray-50 dark:bg-black pb-10">
      <header className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-md border-b border-gray-200/50 dark:border-gray-800/50 sticky top-0 z-50">
        <div className="mx-auto max-w-2xl px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wallet className="h-6 w-6 text-blue-500" />
            <span className="text-lg font-semibold tracking-tight">
              PairPocket
            </span>
          </div>
          <div className="flex items-center gap-3">
            {user.picture && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.picture}
                alt={user.name}
                className="h-8 w-8 rounded-full"
              />
            )}
            <button
              type="button"
              onClick={handleLogout}
              aria-label="로그아웃"
              className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-5 py-8">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
              개인 가계부
            </h1>
            <p className="mt-1 text-base text-gray-700 dark:text-gray-300 truncate">
              {user.name}님의 지갑
            </p>
          </div>
          <button
            type="button"
            onClick={handleInvite}
            className="shrink-0 flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 shadow-sm transition-colors hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            <UserPlus className="h-4 w-4" />
            초대하기
          </button>
        </div>

        {/* Balance summary */}
        <section className="mt-6 grid grid-cols-2 gap-3">
          {(["CAD", "KRW"] as Currency[]).map((c) => (
            <div
              key={c}
              className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm px-5 py-4"
            >
              <p className="text-sm text-gray-500 dark:text-gray-400">{c} 잔액</p>
              <p
                className={`mt-1 text-xl font-bold tracking-tight truncate ${
                  balances[c] < 0
                    ? "text-red-500"
                    : "text-gray-900 dark:text-white"
                }`}
              >
                {formatAmount(balances[c], c)}
              </p>
            </div>
          ))}
        </section>

        {/* Add transaction */}
        {showForm ? (
          <AddTransactionForm
            onCreated={handleCreated}
            onCancel={() => setShowForm(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="mt-6 w-full flex items-center justify-center gap-2 bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white font-semibold rounded-xl px-4 py-3 transition-colors"
          >
            <Plus className="h-5 w-5" />
            거래 추가
          </button>
        )}

        {/* Transaction list */}
        <h2 className="mt-8 mb-3 px-1 text-sm font-semibold text-gray-500 dark:text-gray-400">
          최근 거래
        </h2>

        {loading ? (
          <div className="h-24 w-full animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />
        ) : error ? (
          <p className="text-sm text-red-500">{error}</p>
        ) : transactions.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm px-5 py-10 text-center">
            <p className="text-base text-gray-500 dark:text-gray-400">
              아직 거래 내역이 없습니다.
            </p>
            <p className="mt-1 text-sm text-gray-400 dark:text-gray-500">
              위의 &quot;거래 추가&quot;로 첫 지출을 기록해 보세요.
            </p>
          </div>
        ) : (
          <ul className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm divide-y divide-gray-100 dark:divide-gray-700">
            {transactions.map((tx) => (
              <li
                key={tx.id}
                className="flex items-center justify-between gap-3 px-5 py-4"
              >
                <div className="min-w-0">
                  <p className="text-base font-medium truncate">
                    {tx.merchant}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                    {tx.category} · {formatDate(tx.date)}
                  </p>
                </div>
                <p
                  className={`shrink-0 text-base font-semibold whitespace-nowrap ${
                    tx.type === "income" ? "text-blue-500" : "text-gray-900 dark:text-white"
                  }`}
                >
                  {tx.type === "income" ? "+" : "-"}
                  {formatAmount(tx.amount, tx.currency)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
