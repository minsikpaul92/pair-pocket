"use client";

import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  ListOrdered,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Repeat,
  UserPlus,
  Wallet,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import CalendarView from "@/components/CalendarView";
import DashboardView from "@/components/DashboardView";
import ListView from "@/components/ListView";
import SubscriptionsView from "@/components/SubscriptionsView";
import TransactionModal from "@/components/TransactionModal";
import {
  CategoryPresets,
  Currency,
  CurrentUser,
  LedgerScope,
  SubscriptionOccurrence,
  Transaction,
  clearToken,
  fetchAllPendingOccurrences,
  fetchAllTransactions,
  fetchCategoryPresets,
  fetchPendingOccurrences,
  fetchTransactions,
  syncSubscriptions,
} from "@/lib/api";
import { addMonths, dayKey, isoDayKey, monthKey, monthLabel } from "@/lib/date";

type View = "calendar" | "list" | "dashboard" | "subscriptions";

const NAV: {
  id: View;
  labelKey: "calendar" | "list" | "dashboard" | "subscriptions";
  icon: typeof CalendarDays;
}[] = [
  { id: "calendar", labelKey: "calendar", icon: CalendarDays },
  { id: "list", labelKey: "list", icon: ListOrdered },
  { id: "dashboard", labelKey: "dashboard", icon: LayoutDashboard },
  { id: "subscriptions", labelKey: "subscriptions", icon: Repeat },
];

const LEDGERS: { scope: LedgerScope; labelKey: "all" | "canada" | "korea"; flag?: string }[] = [
  { scope: "ALL", labelKey: "all" },
  { scope: "CAD", labelKey: "canada", flag: "🇨🇦" },
  { scope: "KRW", labelKey: "korea", flag: "🇰🇷" },
];

const SCOPE_LABEL_KEY: Record<LedgerScope, "allLedger" | "canadaLedger" | "koreaLedger"> = {
  ALL: "allLedger",
  CAD: "canadaLedger",
  KRW: "koreaLedger",
};

const NAV_COLLAPSED_KEY = "pairpocket_nav_collapsed";

interface Props {
  user: CurrentUser;
  onLogout: () => void;
}

export default function AppShell({ user, onLogout }: Props) {
  const tNav = useTranslations("nav");
  const tLedger = useTranslations("ledger");
  const tCommon = useTranslations("common");
  const tInvite = useTranslations("invite");
  const locale = useLocale();

  const [view, setView] = useState<View>("calendar");
  const [scope, setScope] = useState<LedgerScope>("CAD");
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [month, setMonth] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const [subscriptionFocusId, setSubscriptionFocusId] = useState<string | null>(
    null
  );
  const [subscriptionCancelAction, setSubscriptionCancelAction] =
    useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [pendingOccurrences, setPendingOccurrences] = useState<
    SubscriptionOccurrence[]
  >([]);
  const [presets, setPresets] = useState<CategoryPresets | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);

  const [modalDate, setModalDate] = useState<Date | null>(null);
  const [modalCurrency, setModalCurrency] = useState<Currency>("CAD");
  const [editingTransaction, setEditingTransaction] =
    useState<Transaction | null>(null);

  const scopeLabel = tLedger(SCOPE_LABEL_KEY[scope]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(NAV_COLLAPSED_KEY);
    if (stored === "true") setNavCollapsed(true);
  }, []);

  useEffect(() => {
    fetchCategoryPresets()
      .then(setPresets)
      .catch(() => setPresets(null));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const viewParam = params.get("view");
    const subId = params.get("subscription");
    const action = params.get("action");
    if (viewParam === "subscriptions") setView("subscriptions");
    if (subId) {
      setSubscriptionFocusId(subId);
      if (action === "cancel") setSubscriptionCancelAction(true);
    }
    if (viewParam || subId) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  // Materialize due subscriptions, then load ledger data.
  useEffect(() => {
    let active = true;
    setLoading(true);
    const monthStr = monthKey(month);
    const txLoader =
      scope === "ALL"
        ? fetchAllTransactions({ month: monthStr })
        : fetchTransactions({ currency: scope, month: monthStr });
    const pendingLoader =
      scope === "ALL"
        ? fetchAllPendingOccurrences({ month: monthStr })
        : fetchPendingOccurrences({ month: monthStr, currency: scope });

    syncSubscriptions()
      .then(() => {
        if (!active) return null;
        return Promise.all([txLoader, pendingLoader]);
      })
      .then((result) => {
        if (!active || !result) return;
        const [txs, pending] = result;
        setTransactions(txs);
        setPendingOccurrences(pending);
      })
      .catch(() => {
        if (!active) return;
        setTransactions([]);
        setPendingOccurrences([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [scope, month, version]);

  function toggleNavCollapsed() {
    setNavCollapsed((v) => {
      const next = !v;
      window.localStorage.setItem(NAV_COLLAPSED_KEY, String(next));
      return next;
    });
  }

  function handleLogout() {
    clearToken();
    onLogout();
  }

  function handleInvite() {
    alert(tInvite("comingSoon"));
  }

  function handleSaved() {
    setModalDate(null);
    setEditingTransaction(null);
    setVersion((v) => v + 1);
  }

  function closeModal() {
    setModalDate(null);
    setEditingTransaction(null);
  }

  function openModal(date: Date) {
    setEditingTransaction(null);
    setModalDate(date);
    if (scope !== "ALL") setModalCurrency(scope);
  }

  function openSubscriptionById(subscriptionId: string, currency?: Currency) {
    setModalDate(null);
    setEditingTransaction(null);
    setSubscriptionFocusId(subscriptionId);
    setSubscriptionCancelAction(false);
    if (currency && scope !== "ALL") {
      setScope(currency);
    }
    setView("subscriptions");
  }

  function openEdit(tx: Transaction) {
    if (tx.subscription_id) {
      openSubscriptionById(tx.subscription_id, tx.currency);
      return;
    }
    setEditingTransaction(tx);
    setModalCurrency(tx.currency);
    setModalDate(new Date(tx.date));
  }

  function openSubscriptionFromPending(occ: SubscriptionOccurrence) {
    openSubscriptionById(occ.subscription_id, occ.currency);
  }

  const modalDayTransactions = modalDate
    ? transactions.filter(
        (tx) => dayKey(new Date(tx.date)) === dayKey(modalDate)
      )
    : [];

  const modalDayPending = modalDate
    ? pendingOccurrences.filter(
        (occ) => isoDayKey(occ.due_date) === dayKey(modalDate)
      )
    : [];

  const sidebarWidth = navCollapsed ? "md:w-16" : "md:w-60";
  const mainPad = navCollapsed ? "md:pl-16" : "md:pl-60";

  return (
    <div className="min-h-dvh bg-gray-50 dark:bg-black">
      <aside
        className={`hidden md:flex fixed inset-y-0 left-0 ${sidebarWidth} flex-col border-r glass-bar bg-white/60 dark:bg-gray-900/40 backdrop-blur-xl px-3 py-6 transition-all duration-200`}
      >
        <div
          className={`flex ${navCollapsed ? "flex-col items-center gap-2" : "items-center gap-2"} px-1`}
        >
          <Wallet className="h-6 w-6 text-blue-500 shrink-0" />
          {!navCollapsed && (
            <span className="text-lg font-semibold tracking-tight truncate flex-1">
              {tCommon("appName")}
            </span>
          )}
          <button
            type="button"
            onClick={toggleNavCollapsed}
            aria-label={
              navCollapsed ? tNav("expandSidebar") : tNav("collapseSidebar")
            }
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-white transition-colors shrink-0"
          >
            {navCollapsed ? (
              <PanelLeftOpen className="h-5 w-5" />
            ) : (
              <PanelLeftClose className="h-5 w-5" />
            )}
          </button>
        </div>

        <nav className="mt-8 space-y-1">
          {NAV.map((item) => {
            const label = tNav(item.labelKey);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setView(item.id)}
                title={navCollapsed ? label : undefined}
                className={`w-full flex items-center gap-3 rounded-xl py-2.5 text-sm font-medium transition-colors ${
                  navCollapsed ? "justify-center px-2" : "px-3"
                } ${
                  view === item.id
                    ? "bg-blue-500 text-white"
                    : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                }`}
              >
                <item.icon className="h-5 w-5 shrink-0" />
                {!navCollapsed && label}
              </button>
            );
          })}
        </nav>

        <div className="mt-auto space-y-1">
          <button
            type="button"
            onClick={handleInvite}
            title={navCollapsed ? tNav("invite") : undefined}
            className={`w-full flex items-center gap-3 rounded-xl py-2.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors ${
              navCollapsed ? "justify-center px-2" : "px-3"
            }`}
          >
            <UserPlus className="h-5 w-5 shrink-0" />
            {!navCollapsed && tNav("invite")}
          </button>
          {!navCollapsed && (
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
                aria-label={tNav("logout")}
                className="text-gray-400 hover:text-gray-700 dark:hover:text-white transition-colors"
              >
                <LogOut className="h-5 w-5" />
              </button>
            </div>
          )}
        </div>
      </aside>

      <div className={`${mainPad} transition-all duration-200`}>
        <header className="sticky top-0 z-40 glass-bar border-b">
          <div className="mx-auto max-w-3xl px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
            <div className="flex rounded-xl bg-gray-100 dark:bg-gray-800 p-1">
              {LEDGERS.map((l) => (
                <button
                  key={l.scope}
                  type="button"
                  onClick={() => setScope(l.scope)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    scope === l.scope
                      ? "bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-white"
                      : "text-gray-500 dark:text-gray-400"
                  }`}
                >
                  {l.flag && <span className="mr-1">{l.flag}</span>}
                  {tLedger(l.labelKey)}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3 md:hidden">
              <button
                type="button"
                onClick={handleInvite}
                aria-label={tNav("invite")}
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
                aria-label={tNav("logout")}
                className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
              >
                <LogOut className="h-5 w-5" />
              </button>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-3xl px-4 sm:px-6 py-5 pb-28 md:pb-10">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
                {monthLabel(month, locale)}
              </h1>
              <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                {scopeLabel}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setMonth((m) => addMonths(m, -1))}
                aria-label={tCommon("previousMonth")}
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
                {tCommon("thisMonth")}
              </button>
              <button
                type="button"
                onClick={() => setMonth((m) => addMonths(m, 1))}
                aria-label={tCommon("nextMonth")}
                className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          </div>

          {loading && view !== "dashboard" && view !== "subscriptions" ? (
            <div className="h-64 w-full animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />
          ) : view === "calendar" ? (
            <CalendarView
              month={month}
              scope={scope}
              transactions={transactions}
              pendingOccurrences={pendingOccurrences}
              onDayClick={openModal}
              onPendingClick={openSubscriptionFromPending}
            />
          ) : view === "list" ? (
            <ListView
              scope={scope}
              presets={presets}
              transactions={transactions}
              onEditTransaction={openEdit}
            />
          ) : view === "subscriptions" ? (
            <SubscriptionsView
              scope={scope}
              month={month}
              version={version}
              presets={presets}
              userEmail={user.email}
              focusSubscriptionId={subscriptionFocusId}
              focusCancelAction={subscriptionCancelAction}
              onFocusHandled={() => {
                setSubscriptionFocusId(null);
                setSubscriptionCancelAction(false);
              }}
              onChanged={() => setVersion((v) => v + 1)}
              onPresetsChange={setPresets}
            />
          ) : (
            <DashboardView month={month} version={version} scope={scope} />
          )}
        </main>
      </div>

      <button
        type="button"
        onClick={() => openModal(new Date())}
        aria-label={tNav("addTransaction")}
        className="fixed bottom-24 md:bottom-8 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-blue-500 text-white shadow-lg hover:bg-blue-600 active:bg-blue-700 transition-colors"
      >
        <Plus className="h-6 w-6" />
      </button>

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
              {tNav(item.labelKey)}
            </button>
          ))}
        </div>
      </nav>

      {modalDate && presets && (
        <TransactionModal
          currency={modalCurrency}
          allowCurrencyPick={scope === "ALL" && !editingTransaction}
          onCurrencyChange={setModalCurrency}
          presets={presets}
          defaultDate={modalDate}
          onDateChange={setModalDate}
          dayTransactions={modalDayTransactions}
          dayPendingOccurrences={modalDayPending}
          editingTransaction={editingTransaction}
          onClose={closeModal}
          onSaved={handleSaved}
          onSelectTransaction={openEdit}
          onSelectPendingOccurrence={openSubscriptionFromPending}
          onPresetsChange={setPresets}
        />
      )}
    </div>
  );
}
