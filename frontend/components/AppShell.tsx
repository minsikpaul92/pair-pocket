"use client";

import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  ListOrdered,
  LogOut,
  Plus,
  UserPlus,
  Wallet,
} from "lucide-react";
import { useEffect, useState } from "react";

import CalendarView from "@/components/CalendarView";
import DashboardView from "@/components/DashboardView";
import ListView from "@/components/ListView";
import TransactionModal from "@/components/TransactionModal";
import {
  CategoryPresets,
  Currency,
  CurrentUser,
  Transaction,
  clearToken,
  fetchCategoryPresets,
  fetchTransactions,
} from "@/lib/api";
import { addMonths, dayKey, monthKey, monthLabel } from "@/lib/date";

type View = "calendar" | "list" | "dashboard";

const NAV: { id: View; label: string; icon: typeof CalendarDays }[] = [
  { id: "calendar", label: "달력", icon: CalendarDays },
  { id: "list", label: "목록", icon: ListOrdered },
  { id: "dashboard", label: "대시보드", icon: LayoutDashboard },
];

const LEDGERS: { currency: Currency; label: string; flag: string }[] = [
  { currency: "CAD", label: "캐나다", flag: "🇨🇦" },
  { currency: "KRW", label: "한국", flag: "🇰🇷" },
];

interface Props {
  user: CurrentUser;
  onLogout: () => void;
}

export default function AppShell({ user, onLogout }: Props) {
  const [view, setView] = useState<View>("calendar");
  const [currency, setCurrency] = useState<Currency>("CAD");
  const [month, setMonth] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [presets, setPresets] = useState<CategoryPresets | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);

  const [modalDate, setModalDate] = useState<Date | null>(null);

  useEffect(() => {
    fetchCategoryPresets()
      .then(setPresets)
      .catch(() => setPresets(null));
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchTransactions({ currency, month: monthKey(month) })
      .then(setTransactions)
      .catch(() => setTransactions([]))
      .finally(() => setLoading(false));
  }, [currency, month, version]);

  function handleLogout() {
    clearToken();
    onLogout();
  }

  function handleInvite() {
    alert("파트너 초대 기능은 곧 제공될 예정입니다. 지금은 개인 가계부를 사용할 수 있어요.");
  }

  function handleCreated() {
    setModalDate(null);
    setVersion((v) => v + 1);
  }

  const modalDayTransactions = modalDate
    ? transactions.filter((tx) => dayKey(new Date(tx.date)) === dayKey(modalDate))
    : [];

  return (
    <div className="min-h-dvh bg-gray-50 dark:bg-black">
      {/* Sidebar (tablet & desktop) */}
      <aside className="hidden md:flex fixed inset-y-0 left-0 w-60 flex-col border-r glass-bar bg-white/60 dark:bg-gray-900/40 backdrop-blur-xl px-4 py-6">
        <div className="flex items-center gap-2 px-2">
          <Wallet className="h-6 w-6 text-blue-500" />
          <span className="text-lg font-semibold tracking-tight">PairPocket</span>
        </div>

        <nav className="mt-8 space-y-1">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setView(item.id)}
              className={`w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                view === item.id
                  ? "bg-blue-500 text-white"
                  : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
              }`}
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="mt-auto space-y-1">
          <button
            type="button"
            onClick={handleInvite}
            className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <UserPlus className="h-5 w-5" />
            초대하기
          </button>
          <div className="flex items-center gap-2 rounded-xl px-3 py-2">
            {user.picture && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.picture}
                alt={user.name}
                className="h-8 w-8 rounded-full"
              />
            )}
            <span className="flex-1 truncate text-sm">{user.name}</span>
            <button
              type="button"
              onClick={handleLogout}
              aria-label="로그아웃"
              className="text-gray-400 hover:text-gray-700 dark:hover:text-white transition-colors"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main column */}
      <div className="md:pl-60">
        {/* Header */}
        <header className="sticky top-0 z-40 glass-bar border-b">
          <div className="mx-auto max-w-3xl px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
            <div className="flex rounded-xl bg-gray-100 dark:bg-gray-800 p-1">
              {LEDGERS.map((l) => (
                <button
                  key={l.currency}
                  type="button"
                  onClick={() => setCurrency(l.currency)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    currency === l.currency
                      ? "bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-white"
                      : "text-gray-500 dark:text-gray-400"
                  }`}
                >
                  <span className="mr-1">{l.flag}</span>
                  {l.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3 md:hidden">
              <button
                type="button"
                onClick={handleInvite}
                aria-label="초대하기"
                className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
              >
                <UserPlus className="h-5 w-5" />
              </button>
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

        <main className="mx-auto max-w-3xl px-4 sm:px-6 py-5 pb-28 md:pb-10">
          {/* Month navigation */}
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
                {monthLabel(month)}
              </h1>
              <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                {currency === "CAD" ? "🇨🇦 캐나다 가계부" : "🇰🇷 한국 가계부"}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setMonth((m) => addMonths(m, -1))}
                aria-label="이전 달"
                className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() =>
                  setMonth(() => {
                    const n = new Date();
                    return new Date(n.getFullYear(), n.getMonth(), 1);
                  })
                }
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                오늘
              </button>
              <button
                type="button"
                onClick={() => setMonth((m) => addMonths(m, 1))}
                aria-label="다음 달"
                className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          </div>

          {loading && view !== "dashboard" ? (
            <div className="h-64 w-full animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />
          ) : view === "calendar" ? (
            <CalendarView
              month={month}
              currency={currency}
              transactions={transactions}
              onDayClick={(d) => setModalDate(d)}
            />
          ) : view === "list" ? (
            <ListView
              currency={currency}
              presets={presets}
              transactions={transactions}
            />
          ) : (
            <DashboardView month={month} version={version} />
          )}
        </main>
      </div>

      {/* Floating add button */}
      <button
        type="button"
        onClick={() => setModalDate(new Date())}
        aria-label="거래 추가"
        className="fixed bottom-24 md:bottom-8 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-blue-500 text-white shadow-lg hover:bg-blue-600 active:bg-blue-700 transition-colors"
      >
        <Plus className="h-6 w-6" />
      </button>

      {/* Bottom tab bar (mobile) */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 glass-bar border-t">
        <div className="flex">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setView(item.id)}
              className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors ${
                view === item.id
                  ? "text-blue-500"
                  : "text-gray-400 dark:text-gray-500"
              }`}
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </button>
          ))}
        </div>
      </nav>

      {modalDate && presets && (
        <TransactionModal
          currency={currency}
          presets={presets}
          defaultDate={modalDate}
          dayTransactions={modalDayTransactions}
          onClose={() => setModalDate(null)}
          onCreated={handleCreated}
          onPresetsChange={setPresets}
        />
      )}
    </div>
  );
}
