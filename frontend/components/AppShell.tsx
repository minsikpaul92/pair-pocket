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
import { useEscapeKey } from "@/lib/useEscapeKey";
import { useCallback, useEffect, useMemo, useState, useRef } from "react";

import {
  ScanDraft,
  deleteDrafts,
  listDrafts,
  markDone,
  purgeOldDone,
  saveDrafts,
  DONE_KEEP_DAYS,
} from "@/lib/scan-drafts";
import AppUpdateWatcher from "@/components/AppUpdateWatcher";
import { salesTaxPercent } from "@/lib/canada-tax";
import CalendarView from "@/components/CalendarView";
import DashboardView from "@/components/DashboardView";
import InviteModal from "@/components/InviteModal";
import ListView from "@/components/ListView";
import NotificationBell from "@/components/NotificationBell";
import NotificationsView from "@/components/NotificationsView";
import PullToRefresh from "@/components/PullToRefresh";
import ThemeToggle from "@/components/ThemeToggle";
import SubscriptionOffer from "@/components/SubscriptionOffer";
import SubscriptionsView from "@/components/SubscriptionsView";
import TransactionModal from "@/components/TransactionModal";
import StocksView from "@/components/StocksView";
import SettingsView, { type SettingsTab } from "@/components/SettingsView";
import ImportView from "@/components/ImportView";
import MonthPicker from "@/components/MonthPicker";
import FloatingActionStack, { type FabCorner } from "@/components/FloatingActionStack";
import TourProvider, {
  type TourApi,
  type TourSetupHandlers,
} from "@/components/tour/TourProvider";
import { signal } from "@/lib/tour/signals";
import { LineChart, Sparkles } from "lucide-react";
import {
  AccountType,
  CategoryPresets,
  Currency,
  AppNotification,
  CurrentUser,
  LedgerScope,
  PartnerSummary,
  SubscriptionOccurrence,
  Transaction,
  fetchAllPendingOccurrences,
  fetchAllTransactions,
  fetchCategoryPresets,
  fetchCurrentUser,
  fetchInvitationMe,
  fetchPendingOccurrences,
  fetchSubscriptions,
  fetchTransaction,
  fetchTransactions,
  fetchUnreadNotificationCount,
  fetchUserSettings,
  preferredLocalesList,
  signOut,
  skipSubscriptionOccurrence,
  syncSubscriptions,
  parseReceiptsOrStatements,
  Subscription,
  SubscriptionDraft,
} from "@/lib/api";
import { addMonths, dayKey, isoDayKey, monthKey, monthLabel, parseDate } from "@/lib/date";
import { translateError } from "@/lib/errors";
import { formatSubscriptionDate } from "@/lib/subscription-i18n";
import { hasUnseenWhatsNew } from "@/lib/whats-new";
import {
  enabledCountriesFromSettings,
  ledgerScopesForCountries,
} from "@/lib/locale-countries";

type View =
  | "calendar"
  | "list"
  | "dashboard"
  | "subscriptions"
  | "stocks"
  | "settings"
  | "import"
  | "notifications";

const ACTIVE_VIEW_KEY = "pairpocket.activeView";

const VALID_VIEWS: View[] = [
  "calendar",
  "list",
  "dashboard",
  "subscriptions",
  "stocks",
  "settings",
  "import",
  "notifications",
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

const LAST_COUNTRY_KEY = "pairpocket:lastCountry";

const SCOPE_LABEL_KEY: Record<LedgerScope, "allLedger" | "canadaLedger" | "koreaLedger"> = {
  ALL: "allLedger",
  CAD: "canadaLedger",
  KRW: "koreaLedger",
  USD: "canadaLedger",
};

const NAV_COLLAPSED_KEY = "pairpocket_nav_collapsed";
const ACCOUNT_TYPE_KEY = "pairpocket.accountType";
const SCOPE_KEY = "pairpocket.scope";

const REMEMBERED_SCOPES: LedgerScope[] = ["ALL", "CAD", "KRW"];

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable; the selection just isn't remembered */
  }
}

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
  const tScan = useTranslations("scanQueue");
  const locale = useLocale();

  const [view, setView] = useState<View>(() => {
    if (typeof window === "undefined") return "calendar";
    const stored = window.sessionStorage.getItem(ACTIVE_VIEW_KEY);
    return isView(stored) ? stored : "calendar";
  });
  const [previousView, setPreviousView] = useState<View>("calendar");
  const [unreadCount, setUnreadCount] = useState(0);
  const [whatsNewUnseen, setWhatsNewUnseen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("accounts");
  const [scope, setScope] = useState<LedgerScope>("CAD");
  // The dashboard shows one country at a time; under "All" it falls back to
  // the Canada/Korea tab picked most recently.
  const [lastCountry, setLastCountry] = useState<"CAD" | "KRW">(() => {
    try {
      return window.localStorage.getItem(LAST_COUNTRY_KEY) === "KRW" ? "KRW" : "CAD";
    } catch {
      return "CAD";
    }
  });
  const scopeChanged = useRef(false);
  const [enabledScopes, setEnabledScopes] = useState<LedgerScope[]>([
    "ALL",
    "CAD",
    "KRW",
  ]);
  const dashboardScope: LedgerScope =
    scope !== "ALL"
      ? scope
      : enabledScopes.includes(lastCountry)
        ? lastCountry
        : (enabledScopes.find((s) => s === "CAD" || s === "KRW") ?? "CAD");
  // Account and dashboard settings are per country, so "All" is not offered there.
  const countryOnly =
    view === "settings" &&
    (settingsTab === "dashboard" || settingsTab === "accounts");
  const visibleLedgers = useMemo(
    () =>
      LEDGERS.filter(
        (l) =>
          enabledScopes.includes(l.scope) && !(countryOnly && l.scope === "ALL")
      ),
    [enabledScopes, countryOnly]
  );
  const [accountType, setAccountType] = useState<AccountType>("personal");
  const [currentUser, setCurrentUser] = useState(user);
  // Remembered tabs are read after mount so server and first client render match.
  const [tabsReady, setTabsReady] = useState(false);
  const [partner, setPartner] = useState<PartnerSummary | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const tourRef = useRef<TourApi>(null);
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
  const [listSubCategoryFilter, setListSubCategoryFilter] = useState<string | undefined>(
    undefined
  );
  const [fromExpenseChart, setFromExpenseChart] = useState(false);
  // Bumped when the List tab is opened, so it starts fresh (all accounts and categories).
  const [listKey, setListKey] = useState(0);
  // The list keeps the dashboard's scroll position otherwise, so open it at the top.
  useEffect(() => {
    if (view === "list") window.scrollTo({ top: 0 });
  }, [view]);
  // Going back from a chart's detail list lands on the expense ratio card, not the top.
  const [scrollToExpense, setScrollToExpense] = useState(false);
  useEffect(() => {
    if (!scrollToExpense || view !== "dashboard") return;
    // The card renders after the dashboard data loads, so wait for it.
    let tries = 0;
    const timer = window.setInterval(() => {
      const card = document.getElementById("expense-ratio-card");
      tries += 1;
      if (card) card.scrollIntoView({ block: "start" });
      if (card || tries >= 30) {
        window.clearInterval(timer);
        setScrollToExpense(false);
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [scrollToExpense, view]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [pendingOccurrences, setPendingOccurrences] = useState<
    SubscriptionOccurrence[]
  >([]);
  const [presets, setPresets] = useState<CategoryPresets | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const bumpVersion = useCallback(() => setVersion((v) => v + 1), []);
  const loadingRef = useRef(loading);
  loadingRef.current = loading;

  const handlePullRefresh = useCallback(async () => {
    bumpVersion();
    const started = Date.now();
    let sawLoading = false;
    await new Promise<void>((resolve) => {
      const id = window.setInterval(() => {
        if (loadingRef.current) sawLoading = true;
        const elapsed = Date.now() - started;
        if (sawLoading && !loadingRef.current) {
          window.clearInterval(id);
          resolve();
          return;
        }
        // Dashboard / settings / stocks may refresh without AppShell loading.
        if (!sawLoading && elapsed > 700) {
          window.clearInterval(id);
          resolve();
          return;
        }
        if (elapsed > 8_000) {
          window.clearInterval(id);
          resolve();
        }
      }, 50);
    });
  }, [bumpVersion]);

  const [modalDate, setModalDate] = useState<Date | null>(null);
  const [modalCurrency, setModalCurrency] = useState<Currency>("CAD");
  const [taxPercent, setTaxPercent] = useState(() => salesTaxPercent(null));
  const [editingTransaction, setEditingTransaction] =
    useState<Transaction | null>(null);

  const [scanMenuOpen, setScanMenuOpen] = useState(false);
  const [fabCorner, setFabCorner] = useState<FabCorner>("br");
  const [aiParsing, setAiParsing] = useState(false);
  const [parsedData, setParsedData] = useState<any>(null);
  const [scanQueue, setScanQueue] = useState<
    { id: string; file: File; previewUrl: string | null }[]
  >([]);
  const [scanQueueOpen, setScanQueueOpen] = useState(false);
  useEscapeKey(() => setScanQueueOpen(false), scanQueueOpen && !aiParsing);
  const [scanQueueError, setScanQueueError] = useState<string | null>(null);
  const [recentScans, setRecentScans] = useState<ScanDraft[]>([]);
  const [scanRestored, setScanRestored] = useState(0);

  const cameraInputRef = useRef<HTMLInputElement>(null);
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
      setScanQueueError(tScan("errorUnsupported"));
      return;
    }
    setScanQueueError(null);
    const room = MAX_SCAN_FILES - scanQueue.length;
    if (room <= 0) {
      setScanQueueError(tScan("errorMax", { max: MAX_SCAN_FILES }));
      return;
    }
    if (accepted.length > room) {
      setScanQueueError(tScan("errorMax", { max: MAX_SCAN_FILES }));
    }
    const entries = accepted.slice(0, room).map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
    }));
    setScanQueue((prev) => [...prev, ...entries]);
    void saveDrafts(entries);
    setScanQueueOpen(true);
    if (cameraInputRef.current) cameraInputRef.current.value = "";
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (scanMoreInputRef.current) scanMoreInputRef.current.value = "";
  }

  function clearScanQueue(finished = false) {
    const ids = scanQueue.map((q) => q.id);
    if (finished) {
      void markDone(ids).then(() => listDrafts()).then((all) =>
        setRecentScans(all.filter((d) => d.status === "done"))
      );
    } else {
      void deleteDrafts(ids);
    }
    setScanQueue((prev) => {
      prev.forEach((q) => {
        if (q.previewUrl) URL.revokeObjectURL(q.previewUrl);
      });
      return [];
    });
    setScanQueueError(null);
  }

  function removeScanQueued(id: string) {
    void deleteDrafts([id]);
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
        clearScanQueue(true);
      } else {
        setScanQueueError(tScan("errorInvalidResult"));
      }
    } catch (err: any) {
      console.error(err);
      setScanQueueError(err.message || tScan("errorFailed"));
    } finally {
      setAiParsing(false);
    }
  }

  const scopeLabel = tLedger(SCOPE_LABEL_KEY[scope]);

  // Bring back files from an interrupted or failed scan, and drop old finished ones.
  useEffect(() => {
    let cancelled = false;
    void purgeOldDone()
      .then(() => listDrafts())
      .then((all) => {
        if (cancelled) return;
        const pending = all.filter((d) => d.status === "pending");
        setRecentScans(all.filter((d) => d.status === "done"));
        if (pending.length === 0) return;
        setScanQueue((prev) => [
          ...prev,
          ...pending
            .filter((d) => !prev.some((q) => q.id === d.id))
            .map((d) => ({
              id: d.id,
              file: d.file,
              previewUrl: d.file.type.startsWith("image/")
                ? URL.createObjectURL(d.file)
                : null,
            })),
        ]);
        setScanRestored(pending.length);
        setScanQueueOpen(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function addRecentScans() {
    const files = recentScans.map((d) => d.file);
    void deleteDrafts(recentScans.map((d) => d.id));
    setRecentScans([]);
    enqueueScanFiles(files);
  }

  // Desktop: pasting an image from the clipboard adds it to the scan queue.
  const pasteStateRef = useRef({ blocked: false });
  pasteStateRef.current.blocked = aiParsing || modalDate !== null;
  const enqueueRef = useRef(enqueueScanFiles);
  enqueueRef.current = enqueueScanFiles;

  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      if (pasteStateRef.current.blocked) return;
      const items = Array.from(e.clipboardData?.items ?? []);
      const images = items
        .filter((it) => it.kind === "file" && it.type.startsWith("image/"))
        .map((it) => it.getAsFile())
        .filter((f): f is File => f !== null);
      if (images.length === 0) return;
      e.preventDefault();
      enqueueRef.current(images);
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(NAV_COLLAPSED_KEY);
    if (stored === "true") setNavCollapsed(true);
  }, []);

  useEffect(() => {
    const storedType = readStored(ACCOUNT_TYPE_KEY);
    if (
      storedType === "shared" &&
      currentUser.shared_group_id
    ) {
      setAccountType("shared");
    }
    const storedScope = readStored(SCOPE_KEY) as LedgerScope | null;
    if (storedScope && REMEMBERED_SCOPES.includes(storedScope)) {
      setScope(storedScope);
    }
    setTabsReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!tabsReady) return;
    writeStored(ACCOUNT_TYPE_KEY, accountType);
  }, [tabsReady, accountType]);

  useEffect(() => {
    if (!tabsReady) return;
    writeStored(SCOPE_KEY, scope);
  }, [tabsReady, scope]);

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
        const countries = enabledCountriesFromSettings(s);
        const scopes = ledgerScopesForCountries(countries);
        setEnabledScopes(scopes);
        setTaxPercent(salesTaxPercent(s.sales_tax_province));
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
    // `?tour=<id>` starts a tour from the first step (testing and clip recording).
    const tourParam = params.get("tour");
    if (isView(viewParam)) setView(viewParam);
    if (subId) {
      setSubscriptionFocusId(subId);
      if (action === "cancel") setSubscriptionCancelAction(true);
    }
    if (tourParam) tourRef.current?.start(tourParam);
    if (viewParam || subId || tourParam) {
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

  function toggleNotifications() {
    if (view === "notifications") {
      setView(previousView === "notifications" ? "calendar" : previousView);
    } else {
      setPreviousView(view);
      setView("notifications");
    }
  }

  useEffect(() => {
    setWhatsNewUnseen(hasUnseenWhatsNew());
  }, []);

  // Keep the bell badge fresh: on load, every minute, and when the tab returns.
  useEffect(() => {
    let active = true;
    const refresh = () =>
      fetchUnreadNotificationCount()
        .then((count) => {
          if (active) setUnreadCount(count);
        })
        .catch(() => null);
    void refresh();
    const timer = window.setInterval(refresh, 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  function openNotification(item: AppNotification) {
    const target: LedgerScope = item.currency === "KRW" ? "KRW" : "CAD";
    setAccountType("shared");
    if (enabledScopes.includes(target)) setScope(target);
    if (item.tx_date) setMonth(parseDate(item.tx_date));
    setView("list");
    // Open the entry itself; if it is gone, the list is all there is to show.
    fetchTransaction(item.transaction_id)
      .then(openEdit)
      .catch(() => null);
  }

  function openView(next: View) {
    if (next === "settings") {
      if (view !== "settings") setPreviousView(view);
      setView("settings");
      return;
    }
    if (next === "list") {
      setListCategoryFilter(undefined);
      setListSubCategoryFilter(undefined);
      setFromExpenseChart(false);
      setListKey((k) => k + 1);
      bumpVersion();
    }
    setView(next);
  }

  // Opening the dashboard from "All" switches to the last used country.
  useEffect(() => {
    if (tabsReady && view === "dashboard" && scope === "ALL") {
      setScope(dashboardScope);
    }
  }, [view, tabsReady]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (countryOnly && scope === "ALL") setScope(dashboardScope);
  }, [countryOnly, scope, dashboardScope]);

  useEffect(() => {
    if (!scopeChanged.current) {
      scopeChanged.current = true;
      return;
    }
    if (scope !== "CAD" && scope !== "KRW") return;
    setLastCountry(scope);
    try {
      window.localStorage.setItem(LAST_COUNTRY_KEY, scope);
    } catch {
      /* storage unavailable: keep it in memory only */
    }
  }, [scope]);

  useEffect(() => {
    if (view !== "settings") setSettingsTab("accounts");
  }, [view]);

  // Materialize due subscriptions when ledger type changes (not on every data bump).
  useEffect(() => {
    if (!tabsReady) return;
    syncSubscriptions(accountType).catch(() => {
      /* non-blocking */
    });
  }, [accountType, tabsReady]);

  // Load ledger transactions / pending for the selected month & scope.
  useEffect(() => {
    if (!tabsReady) return;
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
  }, [scope, accountType, month, version, tabsReady]);

  function toggleNavCollapsed() {
    setNavCollapsed((v) => {
      const next = !v;
      window.localStorage.setItem(NAV_COLLAPSED_KEY, String(next));
      return next;
    });
  }

  function handleLogout() {
    void signOut().finally(onLogout);
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

  /** Entries that repeat can also be registered as subscriptions; skip ones that already are. */
  async function offerSubscriptions(drafts: SubscriptionDraft[]) {
    const known: Record<string, Subscription[]> = {};
    const fresh: SubscriptionDraft[] = [];
    for (const draft of drafts) {
      const key = `${draft.accountType}|${draft.currency}`;
      if (!known[key]) {
        known[key] = await fetchSubscriptions({
          accountType: draft.accountType,
          currency: draft.currency,
        }).catch(() => []);
      }
      const name = draft.name.trim().toLowerCase();
      const exists = known[key].some(
        (s) =>
          s.name.trim().toLowerCase() === name ||
          (s.merchant ?? "").trim().toLowerCase() === name
      );
      if (!exists) fresh.push(draft);
    }
    if (fresh.length > 0) setSubscriptionOffer((prev) => [...prev, ...fresh]);
  }

  function startSubscriptionDrafts() {
    const drafts = subscriptionOffer;
    setSubscriptionOffer([]);
    setModalDate(null);
    setEditingTransaction(null);
    setSubscriptionQueue(drafts);
    if (scope !== "ALL" && drafts[0]) setScope(drafts[0].currency);
    setView("subscriptions");
  }

  function handleSaved() {
    setModalDate(null);
    setEditingTransaction(null);
    setParsedData(null);
    bumpVersion();
    signal("txSaved");
  }

  function closeModal() {
    setModalDate(null);
    setEditingTransaction(null);
    setParsedData(null);
  }

  const [subscriptionOffer, setSubscriptionOffer] = useState<SubscriptionDraft[]>([]);
  const [subscriptionQueue, setSubscriptionQueue] = useState<SubscriptionDraft[]>([]);

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

  // Tell a running tour when the entry form opens or closes.
  const entryModalOpen = Boolean(modalDate && presets);
  const entryModalWasOpen = useRef(false);
  useEffect(() => {
    if (entryModalOpen === entryModalWasOpen.current) return;
    entryModalWasOpen.current = entryModalOpen;
    signal(entryModalOpen ? "entryModalOpened" : "entryModalClosed");
  }, [entryModalOpen]);

  // What a tour step may ask the app to do before it is shown.
  const tourSetup: TourSetupHandlers = {
    openView: ({ view: next }) => openView(next),
    setAccountType: ({ accountType: next }) => {
      if (next === "shared" && !currentUser.shared_group_id) return;
      setAccountType(next);
    },
    setScope: ({ scope: next }) => {
      if (enabledScopes.includes(next)) setScope(next);
    },
    openSettingsTab: ({ tab }) => {
      openView("settings");
      setSettingsTab(tab);
    },
    expandFab: () => signal("expandFab"),
    openEntryModal: () => {
      if (!modalDate) openModal(new Date());
    },
    closeModals: () => {
      closeModal();
      setInviteOpen(false);
      setScanMenuOpen(false);
      setScanQueueOpen(false);
    },
  };

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

  const dashboardTransactions =
    scope === "ALL"
      ? transactions.filter((t) => t.currency === dashboardScope)
      : transactions;

  return (
    <div className="min-h-dvh bg-gray-50 dark:bg-black">
      <aside
        className={`hidden md:flex fixed inset-y-0 left-0 ${sidebarWidth} flex-col border-r glass-bar bg-white/60 dark:bg-gray-900/40 backdrop-blur-xl px-3 py-6 transition-[width] duration-200`}
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
            className="rounded-lg p-1.5 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-white transition-colors shrink-0"
          >
            {navCollapsed ? (
              <PanelLeftOpen className="h-5 w-5" />
            ) : (
              <PanelLeftClose className="h-5 w-5" />
            )}
          </button>
        </div>

        <nav data-tour="nav" className="mt-8 space-y-1">
          {NAV.map((item) => {
            const label = tNav(item.labelKey);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => openView(item.id)}
                aria-current={view === item.id ? "page" : undefined}
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
                className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-white transition-colors"
              >
                <LogOut className="h-5 w-5" />
              </button>
            </div>
          )}
        </div>
      </aside>

      <div
        className={`${mainPad} transition-[padding] duration-200 ${
          // Calendar on phones: the page is exactly one screen tall and the grid takes what is left.
          view === "calendar" ? "max-md:flex max-md:min-h-dvh max-md:flex-col" : ""
        }`}
      >
        <header className="sticky top-0 z-40 glass-bar border-b pt-[env(safe-area-inset-top)]">
          <div className="mx-auto max-w-3xl px-3 sm:px-6 py-3 flex items-center gap-2 flex-nowrap">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <Wallet
                className="hidden min-[420px]:block md:hidden h-6 w-6 text-blue-500 shrink-0"
                aria-hidden
              />
              <div
                data-tour="ledger-type"
                className={`flex min-w-0 rounded-xl bg-gray-100 dark:bg-gray-800 p-1 ${
                  visibleLedgers.length > 1 ? "flex-auto sm:flex-1" : "flex-none"
                }`}
              >
                {(["personal", "shared"] as AccountType[]).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setAccountType(type)}
                    className={`flex-1 rounded-lg px-2 sm:px-3 py-1.5 text-xs sm:text-sm font-medium whitespace-nowrap transition-colors ${
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
                <div className="flex min-w-0 flex-[1.4_1_auto] sm:flex-[1.4] rounded-xl bg-gray-100 dark:bg-gray-800 p-1">
                  {visibleLedgers.map((l) => (
                    <button
                      key={l.scope}
                      type="button"
                      onClick={() => setScope(l.scope)}
                      className={`flex-1 rounded-lg px-1.5 sm:px-3 py-1.5 text-xs sm:text-sm font-medium whitespace-nowrap transition-colors ${
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
              <div className="ml-auto flex shrink-0 items-center gap-2">
                <NotificationBell
                  count={unreadCount}
                  dot={whatsNewUnseen}
                  active={view === "notifications"}
                  onClick={toggleNotifications}
                />
                <button
                  type="button"
                  onClick={toggleSettings}
                  aria-label={tNav("settings")}
                  aria-pressed={view === "settings"}
                  className={`md:hidden shrink-0 inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl p-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                    view === "settings"
                      ? "bg-blue-500 text-white"
                      : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-800 dark:hover:text-white"
                  }`}
                >
                  <Settings className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="hidden md:flex items-center gap-2 shrink-0">
              <ThemeToggle />
            </div>
          </div>
        </header>

        <main
          className={`mx-auto w-full max-w-3xl px-4 sm:px-6 ${
            view === "settings" ? "pt-5" : "pt-1 sm:pt-5"
          } md:pb-10 ${
            // Calendar on phones: only clear the fixed tab bar so the grid can fill the screen.
            view === "calendar"
              ? "max-md:flex max-md:min-h-0 max-md:flex-1 max-md:flex-col pb-[calc(4.1rem+max(0.5rem,env(safe-area-inset-bottom)))]"
              : "pb-32"
          }`}
        >
          <PullToRefresh
            className={view === "calendar" ? "max-md:flex max-md:min-h-0 max-md:flex-1 max-md:flex-col" : undefined}
            onRefresh={handlePullRefresh}
            disabled={
              Boolean(modalDate) ||
              Boolean(editingTransaction) ||
              scanMenuOpen ||
              scanQueueOpen ||
              aiParsing
            }
          >
          {view === "notifications" ? null : view === "settings" ? (
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
          <div
            data-tour="ledger-month"
            className="mb-1 sm:mb-4 flex shrink-0 items-center justify-between gap-2"
          >
            <div className="flex min-w-0 items-baseline gap-1.5">
              {view === "calendar" ||
              view === "list" ||
              view === "subscriptions" ||
              view === "stocks" ||
              view === "dashboard" ? (
                <MonthPicker
                  value={month}
                  onChange={setMonth}
                  locale={locale}
                  triggerClassName="shrink-0"
                  titleClassName="whitespace-nowrap text-lg sm:text-3xl"
                />
              ) : (
                <h1 className="shrink-0 whitespace-nowrap text-lg sm:text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
                  {monthLabel(month, locale)}
                </h1>
              )}
              <p className="min-w-0 truncate text-xs sm:text-sm text-gray-500 dark:text-gray-400">
                <span aria-hidden>· </span>
                {scopeLabel}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => setMonth((m) => addMonths(m, -1))}
                aria-label={tCommon("previousMonth")}
                className="rounded-lg p-2 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
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
                className="whitespace-nowrap rounded-lg px-1.5 sm:px-3 py-1.5 text-xs sm:text-sm font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                {tCommon("thisMonth")}
              </button>
              <button
                type="button"
                onClick={() => setMonth((m) => addMonths(m, 1))}
                aria-label={tCommon("nextMonth")}
                className="rounded-lg p-2 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          </div>
          )}

          {view === "notifications" ? (
            <NotificationsView
              onUnreadChange={setUnreadCount}
              onWhatsNewSeen={() => setWhatsNewUnseen(false)}
              onOpenNotification={openNotification}
            />
          ) : accountType === "shared" && !currentUser.shared_group_id ? (
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
          ) : loading &&
          view !== "dashboard" &&
          view !== "subscriptions" &&
          view !== "settings" ? (
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
              key={listKey}
              scope={scope}
              accountType={accountType}
              presets={presets}
              transactions={transactions}
              pendingOccurrences={pendingOccurrences}
              onEditTransaction={openEdit}
              onAddTransaction={() => openModal(new Date())}
              onDeleted={bumpVersion}
              onPendingClick={openSubscriptionFromPending}
              initialCategoryFilter={listCategoryFilter}
              initialSubCategoryFilter={listSubCategoryFilter}
              fromExpenseChart={fromExpenseChart}
              onBackToDashboard={() => {
                setView("dashboard");
                setFromExpenseChart(false);
                setScrollToExpense(true);
              }}
            />
          ) : view === "subscriptions" ? (
            <SubscriptionsView
              scope={scope}
              accountType={accountType}
              hasPartner={Boolean(currentUser.shared_group_id)}
              month={month}
              version={version}
              presets={presets}
              userEmail={currentUser.email}
              focusSubscriptionId={subscriptionFocusId}
              focusCancelAction={subscriptionCancelAction}
              draft={subscriptionQueue[0] ?? null}
              onDraftDone={() => setSubscriptionQueue((q) => q.slice(1))}
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
              month={month}
              onChanged={bumpVersion}
              onSubscriptions={(drafts) => void offerSubscriptions(drafts)}
            />
          ) : view === "settings" ? (
            <SettingsView
              onChanged={bumpVersion}
              onInvite={handleInvite}
              onLogout={handleLogout}
              onUnlinked={handleInviteUnlinked}
              partner={partner}
              accountType={accountType}
              scope={scope}
              tab={settingsTab}
              onTabChange={setSettingsTab}
            />
          ) : (
            <DashboardView
              month={month}
              version={version}
              scope={dashboardScope}
              accountType={accountType}
              transactions={dashboardTransactions}
              onChanged={bumpVersion}
              onOpenSettings={() => {
                setSettingsTab("dashboard");
                setView("settings");
              }}
              onNavigateToList={(cat, subCat, fromChart) => {
                setListCategoryFilter(cat);
                setListSubCategoryFilter(subCat || "all");
                setFromExpenseChart(!!fromChart);
                setView("list");
              }}
            />
          )}
          </PullToRefresh>
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
        ref={fileInputRef}
        onChange={handleFileChange}
        className="hidden"
        accept="image/*,application/pdf"
        multiple
      />

      {scanQueueOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="scan-queue-title"
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
                <h3 id="scan-queue-title" className="text-lg font-bold text-gray-900 dark:text-white">
                  {tScan("title")}
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {tScan("description", { count: scanQueue.length, max: MAX_SCAN_FILES })}
                </p>
              </div>
              <button
                type="button"
                disabled={aiParsing}
                onClick={() => setScanQueueOpen(false)}
                aria-label={tCommon("close")}
                className="inline-flex min-h-11 min-w-11 -m-3 items-center justify-center text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-white"
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
                      <div className="h-full w-full rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-xs font-bold text-gray-500 dark:text-gray-400">
                        PDF
                      </div>
                    )}
                    <button
                      type="button"
                      disabled={aiParsing}
                      onClick={() => removeScanQueued(q.id)}
                      aria-label={tScan("remove")}
                      className="absolute -top-1.5 -right-1.5 rounded-full bg-gray-900/80 text-white p-0.5 after:absolute after:-inset-2"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400">{tScan("empty")}</p>
            )}

            {scanRestored > 0 && (
              <p className="text-xs text-blue-600 dark:text-blue-400">
                {tScan("restored", { count: scanRestored })}
              </p>
            )}
            {scanQueueError && (
              <p className="text-xs text-red-500" role="alert">{scanQueueError}</p>
            )}
            {recentScans.length > 0 && !aiParsing && (
              <button
                type="button"
                onClick={addRecentScans}
                disabled={scanQueue.length >= MAX_SCAN_FILES}
                className="w-full rounded-xl border border-dashed border-gray-300 dark:border-gray-600 py-2 text-xs font-semibold text-gray-600 dark:text-gray-300 disabled:opacity-50"
              >
                {tScan("addRecent", { count: recentScans.length, days: DONE_KEEP_DAYS })}
              </button>
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
                {tScan("add")}
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
                {aiParsing ? tScan("analyzing") : tScan("start")}
              </button>
            </div>
            {scanQueue.length > 0 && !aiParsing && (
              <button
                type="button"
                onClick={() => clearScanQueue()}
                className="w-full inline-flex items-center justify-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-500"
              >
                <Trash2 className="h-3 w-3" />
                {tScan("clear")}
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
        <div className={`fixed ${fabCorner[0] === "t" ? "top-[calc(env(safe-area-inset-top)+15.5rem)]" : "bottom-[calc(14.6rem+max(0.5rem,env(safe-area-inset-bottom)))]"} ${fabCorner[1] === "l" ? "left-4" : "right-4"} md:top-auto md:left-auto md:bottom-28 md:right-5 z-40 w-52 rounded-2xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 shadow-2xl p-1.5 space-y-0.5 animate-in fade-in slide-in-from-bottom-2 duration-200`}>
          <button
            type="button"
            onClick={() => {
              setScanMenuOpen(false);
              cameraInputRef.current?.click();
            }}
            className="w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center gap-2"
          >
            <Camera className="h-4.5 w-4.5 text-blue-500" />
            {tScan("takePhoto")}
          </button>
          <button
            type="button"
            onClick={() => {
              setScanMenuOpen(false);
              fileInputRef.current?.click();
            }}
            className="w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center gap-2"
          >
            <Plus className="h-4.5 w-4.5 text-green-500" />
            {tScan("uploadFile")}
          </button>
          {recentScans.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setScanMenuOpen(false);
                setScanQueueOpen(true);
              }}
              className="w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center gap-2"
            >
              <Repeat className="h-4.5 w-4.5 text-gray-500 dark:text-gray-400" />
              {tScan("openRecent", { count: recentScans.length })}
            </button>
          )}
        </div>
      )}

      <AppUpdateWatcher />
      <TourProvider ref={tourRef} setup={tourSetup} />

      {/* Floating Buttons Group — hidden on stocks/subscriptions (view-specific FAB) */}
      {view !== "stocks" && view !== "subscriptions" && (
        <FloatingActionStack
          key={view} // a new view starts again in the default corner
          onCornerChange={setFabCorner}
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
              <p className="text-sm font-bold text-gray-900 dark:text-white">{tScan("loadingTitle")}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{tScan("loadingBody")}</p>
            </div>
          </div>
        </div>
      )}

      <nav data-tour="nav" className="md:hidden fixed bottom-0 inset-x-0 z-40 glass-bar border-t pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <div className="flex">
          {MOBILE_NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => openView(item.id)}
              aria-current={view === item.id ? "page" : undefined}
              className={`flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-xs font-medium transition-colors ${
                view === item.id
                  ? "text-blue-500"
                  : "text-gray-500 dark:text-gray-400"
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

      {subscriptionOffer.length > 0 && (
        <SubscriptionOffer
          count={subscriptionOffer.length}
          onStart={startSubscriptionDrafts}
          onDismiss={() => setSubscriptionOffer([])}
        />
      )}

      {modalDate && presets && (
        <TransactionModal
          currency={modalCurrency}
          taxPercent={taxPercent}
          ledgerScope={scope}
          accountType={accountType}
          hasPartner={Boolean(partner)}
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
          onSubscriptionEntry={(draft) => void offerSubscriptions([draft])}
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
