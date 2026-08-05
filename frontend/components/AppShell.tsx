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
  Settings,
  Camera,
  Loader2,
  UserCheck,
  UserPlus,
  Wallet,
  Play,
  X,
  Trash2,
  ImagePlus,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState, useRef } from "react";

import CalendarView from "@/components/CalendarView";
import DashboardView from "@/components/DashboardView";
import InviteModal from "@/components/InviteModal";
import ListView from "@/components/ListView";
import LocaleToggle from "@/components/LocaleToggle";
import ThemeToggle from "@/components/ThemeToggle";
import SubscriptionsView from "@/components/SubscriptionsView";
import TransactionModal from "@/components/TransactionModal";
import StocksView from "@/components/StocksView";
import SettingsView from "@/components/SettingsView";
import ImportView from "@/components/ImportView";
import MonthPicker from "@/components/MonthPicker";
import FloatingActionStack from "@/components/FloatingActionStack";
import { LineChart, Sparkles } from "lucide-react";
import {
  AccountType,
  CategoryPresets,
  Currency,
  CurrentUser,
  LedgerScope,
  PartnerSummary,
  SubscriptionOccurrence,
  Transaction,
  clearToken,
  fetchAllPendingOccurrences,
  fetchAllTransactions,
  fetchCategoryPresets,
  fetchCurrentUser,
  fetchInvitationMe,
  fetchPendingOccurrences,
  fetchTransactions,
  fetchUserSettings,
  preferredLocalesList,
  skipSubscriptionOccurrence,
  syncSubscriptions,
  parseReceiptsOrStatements,
} from "@/lib/api";
import { addMonths, dayKey, isoDayKey, monthKey, monthLabel, parseDate } from "@/lib/date";
import { translateError } from "@/lib/errors";
import { formatSubscriptionDate } from "@/lib/subscription-i18n";
import {
  countriesForLocales,
  ledgerScopesForCountries,
} from "@/lib/locale-countries";

type View = "calendar" | "list" | "dashboard" | "subscriptions" | "stocks" | "settings" | "import";

const ACTIVE_VIEW_KEY = "pairpocket.activeView";

const VALID_VIEWS: View[] = [
  "calendar",
  "list",
  "dashboard",
  "subscriptions",
  "stocks",
  "settings",
  "import",
];

function isView(value: string | null): value is View {
  return Boolean(value && VALID_VIEWS.includes(value as View));
}

const NAV: {
  id: View;
  labelKey: "calendar" | "list" | "dashboard" | "subscriptions" | "stocks" | "settings" | "smartImport";
  icon: any;
}[] = [
  { id: "dashboard", labelKey: "dashboard", icon: LayoutDashboard },
  { id: "calendar", labelKey: "calendar", icon: CalendarDays },
  { id: "list", labelKey: "list", icon: ListOrdered },
  { id: "subscriptions", labelKey: "subscriptions", icon: Repeat },
  { id: "stocks", labelKey: "stocks", icon: LineChart },
  { id: "import", labelKey: "smartImport", icon: Sparkles },
  { id: "settings", labelKey: "settings", icon: Settings },
];

/** Mobile bottom tabs omit smart import & settings (gear icon toggles settings). */
const MOBILE_NAV = NAV.filter(
  (item) => item.id !== "import" && item.id !== "settings"
);

const LEDGERS: { scope: LedgerScope; labelKey: "all" | "canada" | "korea" }[] = [
  { scope: "ALL", labelKey: "all" },
  { scope: "CAD", labelKey: "canada" },
  { scope: "KRW", labelKey: "korea" },
];

const SCOPE_LABEL_KEY: Record<LedgerScope, "allLedger" | "canadaLedger" | "koreaLedger"> = {
  ALL: "allLedger",
  CAD: "canadaLedger",
  KRW: "koreaLedger",
  USD: "canadaLedger",
};

const NAV_COLLAPSED_KEY = "pairpocket_nav_collapsed";

function ledgerTabLabel(
  labelKey: "all" | "canada" | "korea",
  tLedger: (key: string) => string,
  tCommon: (key: string) => string
): string {
  if (labelKey === "all") return tLedger("all");
  return tCommon(labelKey);
}

interface Props {
  user: CurrentUser;
  onLogout: () => void;
}

export default function AppShell({ user, onLogout }: Props) {
  const tNav = useTranslations("nav");
  const tLedger = useTranslations("ledger");
  const tCommon = useTranslations("common");
  const tInvite = useTranslations("invite");
  const tAccountType = useTranslations("accountType");
  const tSub = useTranslations("subscriptions");
  const tErrors = useTranslations("errors");
  const locale = useLocale();

  const [view, setView] = useState<View>(() => {
    if (typeof window === "undefined") return "calendar";
    const stored = window.sessionStorage.getItem(ACTIVE_VIEW_KEY);
    return isView(stored) ? stored : "calendar";
  });
  const [previousView, setPreviousView] = useState<View>("calendar");
  const [scope, setScope] = useState<LedgerScope>("CAD");
  const [enabledScopes, setEnabledScopes] = useState<LedgerScope[]>([
    "ALL",
    "CAD",
    "KRW",
  ]);
  const visibleLedgers = useMemo(
    () => LEDGERS.filter((l) => enabledScopes.includes(l.scope)),
    [enabledScopes]
  );
  const [accountType, setAccountType] = useState<AccountType>("personal");
  const [currentUser, setCurrentUser] = useState(user);
  const [partner, setPartner] = useState<PartnerSummary | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
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
  const [listCategoryFilter, setListCategoryFilter] = useState<string | undefined>(
    undefined
  );
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [pendingOccurrences, setPendingOccurrences] = useState<
    SubscriptionOccurrence[]
  >([]);
  const [presets, setPresets] = useState<CategoryPresets | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const bumpVersion = useCallback(() => setVersion((v) => v + 1), []);

  const [modalDate, setModalDate] = useState<Date | null>(null);
  const [modalCurrency, setModalCurrency] = useState<Currency>("CAD");
  const [editingTransaction, setEditingTransaction] =
    useState<Transaction | null>(null);

  const [scanMenuOpen, setScanMenuOpen] = useState(false);
  const [aiParsing, setAiParsing] = useState(false);
  const [parsedData, setParsedData] = useState<any>(null);
  const [scanQueue, setScanQueue] = useState<
    { id: string; file: File; previewUrl: string | null }[]
  >([]);
  const [scanQueueOpen, setScanQueueOpen] = useState(false);
  const [scanQueueError, setScanQueueError] = useState<string | null>(null);

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scanMoreInputRef = useRef<HTMLInputElement>(null);
  const MAX_SCAN_FILES = 15;

  function enqueueScanFiles(fileList: FileList | File[] | null) {
    if (!fileList) return;
    const list = Array.from(fileList as FileList | File[]);
    const accepted = list.filter(
      (f) => f.type.startsWith("image/") || f.type === "application/pdf"
    );
    if (!accepted.length) {
      setScanQueueError("지원하지 않는 파일 형식입니다.");
      return;
    }
    setScanQueueError(null);
    setScanQueue((prev) => {
      const room = MAX_SCAN_FILES - prev.length;
      if (room <= 0) {
        setScanQueueError(`최대 ${MAX_SCAN_FILES}장까지 올릴 수 있습니다.`);
        return prev;
      }
      const slice = accepted.slice(0, room);
      if (accepted.length > room) {
        setScanQueueError(`최대 ${MAX_SCAN_FILES}장까지 올릴 수 있습니다.`);
      }
      return [
        ...prev,
        ...slice.map((file) => ({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          file,
          previewUrl: file.type.startsWith("image/")
            ? URL.createObjectURL(file)
            : null,
        })),
      ];
    });
    setScanQueueOpen(true);
    if (cameraInputRef.current) cameraInputRef.current.value = "";
    if (photoInputRef.current) photoInputRef.current.value = "";
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (scanMoreInputRef.current) scanMoreInputRef.current.value = "";
  }

  function clearScanQueue() {
    setScanQueue((prev) => {
      prev.forEach((q) => {
        if (q.previewUrl) URL.revokeObjectURL(q.previewUrl);
      });
      return [];
    });
    setScanQueueError(null);
  }

  function removeScanQueued(id: string) {
    setScanQueue((prev) => {
      const target = prev.find((q) => q.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((q) => q.id !== id);
    });
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    enqueueScanFiles(e.target.files);
  }

  async function startScanQueueAnalysis() {
    if (aiParsing || scanQueue.length === 0) return;
    try {
      setAiParsing(true);
      setScanQueueError(null);
      const files = scanQueue.map((q) => q.file);
      const results = await parseReceiptsOrStatements(files);
      const flat: any[] = [];
      for (const r of results as any[]) {
        if (Array.isArray(r?.transactions)) {
          for (const tx of r.transactions) {
            flat.push({
              ...tx,
              file_name: r.file_name,
              items: tx.items || [],
            });
          }
        } else if (r?.date != null) {
          flat.push(r);
        }
      }
      if (flat.length > 0) {
        const parsed = flat[0];
        setParsedData(parsed);
        const txDate = parseDate(parsed.date);
        setModalDate(txDate);
        setModalCurrency(parsed.currency || "CAD");
        setScanQueueOpen(false);
        clearScanQueue();
      } else {
        setScanQueueError("AI 분석 결과가 올바르지 않습니다.");
      }
    } catch (err: any) {
      console.error(err);
      setScanQueueError(err.message || "AI 분석 중 오류가 발생했습니다.");
    } finally {
      setAiParsing(false);
    }
  }

  const scopeLabel = tLedger(SCOPE_LABEL_KEY[scope]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(NAV_COLLAPSED_KEY);
    if (stored === "true") setNavCollapsed(true);
  }, []);

  useEffect(() => {
    fetchInvitationMe()
      .then((status) => {
        setPartner(status.partner);
      })
      .catch(() => setPartner(null));
  }, []);

  useEffect(() => {
    fetchCategoryPresets()
      .then(setPresets)
      .catch(() => setPresets(null));
  }, []);

  useEffect(() => {
    let active = true;
    fetchUserSettings()
      .then((s) => {
        if (!active) return;
        const countries = countriesForLocales(preferredLocalesList(s));
        const scopes = ledgerScopesForCountries(countries);
        setEnabledScopes(scopes);
        setScope((prev) => (scopes.includes(prev) ? prev : scopes[0]));
        if (scopes[0] === "CAD" || scopes[0] === "KRW") {
          const firstCurrency: Currency = scopes[0];
          setModalCurrency((prev) =>
            scopes.includes(prev) ? prev : firstCurrency
          );
        }
      })
      .catch(() => {
        /* keep defaults */
      });
    return () => {
      active = false;
    };
  }, [version]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const viewParam = params.get("view");
    const subId = params.get("subscription");
    const action = params.get("action");
    if (isView(viewParam)) setView(viewParam);
    if (subId) {
      setSubscriptionFocusId(subId);
      if (action === "cancel") setSubscriptionCancelAction(true);
    }
    if (viewParam || subId) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(ACTIVE_VIEW_KEY, view);
  }, [view]);

  function toggleSettings() {
    if (view === "settings") {
      setView(previousView === "settings" ? "calendar" : previousView);
    } else {
      setPreviousView(view);
      setView("settings");
    }
  }

  function openView(next: View) {
    if (next === "settings") {
      if (view !== "settings") setPreviousView(view);
      setView("settings");
      return;
    }
    setView(next);
  }

  // Materialize due subscriptions when ledger type changes (not on every data bump).
  useEffect(() => {
    syncSubscriptions(accountType).catch(() => {
      /* non-blocking */
    });
  }, [accountType]);

  // Load ledger transactions / pending for the selected month & scope.
  useEffect(() => {
    let active = true;
    setLoading(true);
    const monthStr = monthKey(month);
    const txFilters = { month: monthStr, accountType };
    const pendingFilters = { month: monthStr, accountType };
    const txLoader =
      scope === "ALL"
        ? fetchAllTransactions(txFilters)
        : fetchTransactions({ ...txFilters, currency: scope });
    const pendingLoader =
      scope === "ALL"
        ? fetchAllPendingOccurrences(pendingFilters)
        : fetchPendingOccurrences({ ...pendingFilters, currency: scope });

    Promise.allSettled([txLoader, pendingLoader])
      .then(([txRes, pendingRes]) => {
        if (!active) return;
        setTransactions(txRes.status === "fulfilled" ? txRes.value : []);
        setPendingOccurrences(pendingRes.status === "fulfilled" ? pendingRes.value : []);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [scope, accountType, month, version]);

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
    setInviteOpen(true);
  }

  function handleInviteLinked() {
    fetchCurrentUser().then((u) => {
      if (u) setCurrentUser(u);
    });
    fetchInvitationMe().then((status) => {
      setPartner(status.partner);
    });
  }

  function handleInviteUnlinked() {
    setPartner(null);
    setCurrentUser((prev) => ({ ...prev, shared_group_id: null }));
    if (accountType === "shared") {
      setAccountType("personal");
    }
    bumpVersion();
  }

  function handleSaved() {
    setModalDate(null);
    setEditingTransaction(null);
    setParsedData(null);
    bumpVersion();
  }

  function closeModal() {
    setModalDate(null);
    setEditingTransaction(null);
    setParsedData(null);
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
    setEditingTransaction(tx);
    setModalCurrency(tx.currency);
    setModalDate(parseDate(tx.date));
  }

  function openSubscriptionFromPending(occ: SubscriptionOccurrence) {
    openSubscriptionById(occ.subscription_id, occ.currency);
  }

  async function handleSkipPendingOccurrence(occ: SubscriptionOccurrence) {
    const name = occ.subscription_name || tSub("defaultName");
    const dateLabel = formatSubscriptionDate(occ.due_date, locale);
    if (!window.confirm(tSub("skipConfirm", { name, date: dateLabel }))) {
      return;
    }
    try {
      await skipSubscriptionOccurrence(occ.id);
      bumpVersion();
    } catch (err) {
      alert(translateError(err, tErrors, "skipSubscriptionOccurrence"));
    }
  }

  const modalDayTransactions = modalDate
    ? transactions.filter(
        (tx) => dayKey(parseDate(tx.date)) === dayKey(modalDate)
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
                onClick={() => openView(item.id)}
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
          {partner ? (
            <button
              type="button"
              onClick={handleInvite}
              title={navCollapsed ? partner.name : undefined}
              className={`w-full flex items-center gap-2 rounded-xl py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors ${
                navCollapsed ? "justify-center px-2" : "px-3"
              }`}
            >
              {partner.picture ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={partner.picture}
                  alt={partner.name}
                  className="h-8 w-8 rounded-full object-cover shrink-0"
                />
              ) : (
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 dark:bg-gray-700 shrink-0">
                  <UserCheck className="h-4 w-4 text-green-500" />
                </span>
              )}
              {!navCollapsed && (
                <span className="flex-1 truncate text-left text-sm">
                  {partner.name}
                </span>
              )}
            </button>
          ) : (
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
          )}
          {!navCollapsed && (
            <div className="flex items-center gap-2 rounded-xl px-3 py-2">
              {currentUser.picture && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={currentUser.picture}
                  alt={currentUser.name}
                  className="h-8 w-8 rounded-full"
                />
              )}
              <span className="flex-1 truncate text-sm">{currentUser.name}</span>
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
        <header className="sticky top-0 z-40 glass-bar border-b pt-[env(safe-area-inset-top)]">
          <div className="mx-auto max-w-3xl px-4 sm:px-6 py-3 flex items-center gap-2 flex-nowrap">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <Wallet
                className="md:hidden h-6 w-6 text-blue-500 shrink-0"
                aria-hidden
              />
              <div className="flex flex-1 min-w-0 rounded-xl bg-gray-100 dark:bg-gray-800 p-1">
                {(["personal", "shared"] as AccountType[]).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setAccountType(type)}
                    className={`flex-1 rounded-lg px-2.5 sm:px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors ${
                      accountType === type
                        ? "bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-white"
                        : "text-gray-500 dark:text-gray-400"
                    }`}
                  >
                    {tAccountType(type)}
                  </button>
                ))}
              </div>
              {visibleLedgers.length > 1 && (
                <div className="flex flex-[1.4] min-w-0 rounded-xl bg-gray-100 dark:bg-gray-800 p-1">
                  {visibleLedgers.map((l) => (
                    <button
                      key={l.scope}
                      type="button"
                      onClick={() => setScope(l.scope)}
                      className={`flex-1 rounded-lg px-1.5 sm:px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors ${
                        scope === l.scope
                          ? "bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-white"
                          : "text-gray-500 dark:text-gray-400"
                      }`}
                    >
                      {ledgerTabLabel(l.labelKey, tLedger, tCommon)}
                    </button>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={toggleSettings}
                aria-label={tNav("settings")}
                aria-pressed={view === "settings"}
                className={`md:hidden shrink-0 rounded-xl p-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                  view === "settings"
                    ? "bg-blue-500 text-white"
                    : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-800 dark:hover:text-white"
                }`}
              >
                <Settings className="h-5 w-5" />
              </button>
            </div>

            <div className="hidden md:flex items-center gap-2 shrink-0">
              <LocaleToggle />
              <ThemeToggle />
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-3xl px-4 sm:px-6 py-5 pb-32 md:pb-10">
          {view === "settings" ? (
            <div className="mb-4">
              <div className="flex md:hidden items-center gap-2.5">
                <Wallet
                  className="h-7 w-7 text-blue-500 shrink-0"
                  aria-hidden
                />
                <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white whitespace-nowrap">
                  {tCommon("appName")}
                </h1>
                <div className="ml-auto flex items-center">
                  {currentUser.picture ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={currentUser.picture}
                      alt={currentUser.name}
                      title={currentUser.name}
                      className="h-9 w-9 rounded-full object-cover ring-2 ring-white dark:ring-gray-900"
                    />
                  ) : (
                    <span
                      title={currentUser.name}
                      className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs font-bold ring-2 ring-white dark:ring-gray-900"
                    >
                      {(currentUser.name || "?").slice(0, 1)}
                    </span>
                  )}
                </div>
              </div>
              <h1 className="hidden md:block text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
                {tNav("settings")}
              </h1>
            </div>
          ) : (
          <div className="mb-4 flex items-center justify-between">
            <div>
              {view === "calendar" ||
              view === "list" ||
              view === "subscriptions" ||
              view === "stocks" ||
              view === "dashboard" ? (
                <MonthPicker
                  value={month}
                  onChange={setMonth}
                  locale={locale}
                />
              ) : (
                <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
                  {monthLabel(month, locale)}
                </h1>
              )}
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
          )}

          {accountType === "shared" && !currentUser.shared_group_id ? (
            <div className="card-inset p-6 text-center space-y-4">
              <p className="text-base text-gray-700 dark:text-gray-300">
                {tInvite("sharedEmpty")}
              </p>
              <button
                type="button"
                onClick={handleInvite}
                className="bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white font-semibold rounded-xl px-4 py-3 transition-colors"
              >
                {tInvite("sharedEmptyCta")}
              </button>
            </div>
          ) : loading && view !== "dashboard" && view !== "subscriptions" ? (
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
              pendingOccurrences={pendingOccurrences}
              onEditTransaction={openEdit}
              onAddTransaction={() => openModal(new Date())}
              onDeleted={bumpVersion}
              onPendingClick={openSubscriptionFromPending}
              initialCategoryFilter={listCategoryFilter}
            />
          ) : view === "subscriptions" ? (
            <SubscriptionsView
              scope={scope}
              accountType={accountType}
              month={month}
              version={version}
              presets={presets}
              userEmail={currentUser.email}
              focusSubscriptionId={subscriptionFocusId}
              focusCancelAction={subscriptionCancelAction}
              onFocusHandled={() => {
                setSubscriptionFocusId(null);
                setSubscriptionCancelAction(false);
              }}
              onChanged={bumpVersion}
              onPresetsChange={setPresets}
            />
          ) : view === "stocks" ? (
            <StocksView
              accountType={accountType}
              ledgerScope={scope}
              version={version}
              onChanged={bumpVersion}
            />
          ) : view === "import" ? (
            <ImportView
              scope={scope}
              accountType={accountType}
              presets={presets}
              onChanged={bumpVersion}
            />
          ) : view === "settings" ? (
            <SettingsView
              onChanged={bumpVersion}
              onInvite={handleInvite}
              onLogout={handleLogout}
              partner={partner}
            />
          ) : (
            <DashboardView
              month={month}
              version={version}
              scope={scope}
              accountType={accountType}
              onChanged={bumpVersion}
              onNavigateToList={(cat) => {
                setListCategoryFilter(cat);
                setView("list");
              }}
            />
          )}
        </main>
      </div>

      {/* Hidden File Inputs for Scanning */}
      <input
        type="file"
        ref={cameraInputRef}
        onChange={handleFileChange}
        className="hidden"
        accept="image/*"
        capture="environment"
      />
      <input
        type="file"
        ref={photoInputRef}
        onChange={handleFileChange}
        className="hidden"
        accept="image/*"
        multiple
      />
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        className="hidden"
        accept="image/*,application/pdf"
        multiple
      />

      {scanQueueOpen && (
        <div
          className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4"
          onClick={() => {
            if (!aiParsing) {
              setScanQueueOpen(false);
            }
          }}
        >
          <div
            className="w-full sm:max-w-md bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-2xl shadow-xl p-5 space-y-4 max-h-[88dvh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                  AI 스캔 대기열
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  사진을 모은 뒤 분석을 시작하세요. ({scanQueue.length} /{" "}
                  {MAX_SCAN_FILES})
                </p>
              </div>
              <button
                type="button"
                disabled={aiParsing}
                onClick={() => setScanQueueOpen(false)}
                className="text-gray-400 hover:text-gray-700 dark:hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {scanQueue.length > 0 ? (
              <ul className="grid grid-cols-4 gap-2">
                {scanQueue.map((q) => (
                  <li key={q.id} className="relative aspect-square">
                    {q.previewUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={q.previewUrl}
                        alt=""
                        className="h-full w-full rounded-lg object-cover border border-gray-200 dark:border-gray-700"
                      />
                    ) : (
                      <div className="h-full w-full rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-[10px] font-bold text-gray-500">
                        PDF
                      </div>
                    )}
                    <button
                      type="button"
                      disabled={aiParsing}
                      onClick={() => removeScanQueued(q.id)}
                      className="absolute -top-1.5 -right-1.5 rounded-full bg-gray-900/80 text-white p-0.5"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-gray-500">아직 파일이 없습니다.</p>
            )}

            {scanQueueError && (
              <p className="text-xs text-red-500">{scanQueueError}</p>
            )}

            <input
              ref={scanMoreInputRef}
              type="file"
              accept="image/*,application/pdf"
              multiple
              className="hidden"
              onChange={(e) => enqueueScanFiles(e.target.files)}
            />

            <div className="flex gap-2">
              <button
                type="button"
                disabled={aiParsing || scanQueue.length >= MAX_SCAN_FILES}
                onClick={() => scanMoreInputRef.current?.click()}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-gray-100 dark:bg-gray-800 py-2.5 text-sm font-semibold text-gray-800 dark:text-gray-100 disabled:opacity-50"
              >
                <ImagePlus className="h-4 w-4" />
                추가
              </button>
              <button
                type="button"
                disabled={aiParsing || scanQueue.length === 0}
                onClick={() => void startScanQueueAnalysis()}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-blue-500 hover:bg-blue-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {aiParsing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                {aiParsing ? "분석 중…" : "분석 시작"}
              </button>
            </div>
            {scanQueue.length > 0 && !aiParsing && (
              <button
                type="button"
                onClick={clearScanQueue}
                className="w-full inline-flex items-center justify-center gap-1 text-xs text-gray-500 hover:text-red-500"
              >
                <Trash2 className="h-3 w-3" />
                대기열 비우기
              </button>
            )}
          </div>
        </div>
      )}

      {/* Backdrop to close scan menu */}
      {scanMenuOpen && (
        <div
          className="fixed inset-0 z-30"
          onClick={() => setScanMenuOpen(false)}
        />
      )}

      {/* Scan Options Popover */}
      {scanMenuOpen && (
        <div className="fixed bottom-56 md:bottom-40 right-5 z-40 w-52 rounded-2xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 shadow-2xl p-1.5 space-y-0.5 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <button
            type="button"
            onClick={() => {
              setScanMenuOpen(false);
              cameraInputRef.current?.click();
            }}
            className="w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center gap-2"
          >
            <Camera className="h-4.5 w-4.5 text-blue-500" />
            사진 촬영 (Take Photo)
          </button>
          <button
            type="button"
            onClick={() => {
              setScanMenuOpen(false);
              photoInputRef.current?.click();
            }}
            className="w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center gap-2"
          >
            <Plus className="h-4.5 w-4.5 text-green-500" />
            사진 올리기 (갤러리)
          </button>
          <button
            type="button"
            onClick={() => {
              setScanMenuOpen(false);
              fileInputRef.current?.click();
            }}
            className="w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center gap-2"
          >
            <Repeat className="h-4.5 w-4.5 text-indigo-500" />
            파일 올리기 (PDF/이미지)
          </button>
        </div>
      )}

      {/* Floating Buttons Group — hidden on stocks/subscriptions (view-specific FAB) */}
      {view !== "stocks" && view !== "subscriptions" && (
        <FloatingActionStack
          onCamera={() => setScanMenuOpen((o) => !o)}
          onAdd={() => openModal(new Date())}
          cameraLabel={tNav("scanReceipt")}
          addLabel={tNav("addTransaction")}
          CameraIcon={Camera}
          AddIcon={Plus}
        />
      )}
      {aiParsing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-2xl flex flex-col items-center space-y-4 max-w-xs text-center border border-gray-100 dark:border-gray-700">
            <Loader2 className="h-10 w-10 animate-spin text-blue-500" />
            <div>
              <p className="text-sm font-bold text-gray-900 dark:text-white">AI 영수증 분석 중...</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Gemini가 항목을 판별하고 있습니다. 잠시만 기다려 주세요.</p>
            </div>
          </div>
        </div>
      )}

      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 glass-bar border-t pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <div className="flex">
          {MOBILE_NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => openView(item.id)}
              className={`flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-xs font-medium transition-colors ${
                view === item.id
                  ? "text-blue-500"
                  : "text-gray-400 dark:text-gray-500"
              }`}
            >
              <item.icon className="h-6 w-6" />
              <span className="whitespace-nowrap truncate max-w-full px-0.5">
                {tNav(item.labelKey)}
              </span>
            </button>
          ))}
        </div>
      </nav>

      {modalDate && presets && (
        <TransactionModal
          currency={modalCurrency}
          ledgerScope={scope}
          accountType={accountType}
          parsedTransaction={parsedData}
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
          onSkipPendingOccurrence={handleSkipPendingOccurrence}
          onPresetsChange={setPresets}
        />
      )}

      {inviteOpen && (
        <InviteModal
          onClose={() => setInviteOpen(false)}
          onLinked={handleInviteLinked}
          onUnlinked={handleInviteUnlinked}
        />
      )}
    </div>
  );
}
