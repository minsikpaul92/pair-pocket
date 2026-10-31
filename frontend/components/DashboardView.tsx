"use client";

import {
  CreditCard,
  GripVertical,
  Landmark,
  Plus,
  RefreshCw,
  Wallet,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import AccountRegisterModal from "@/components/AccountRegisterModal";
import DashboardAnalytics from "@/components/DashboardAnalytics";
import SortableCardGrid from "@/components/SortableCardGrid";
import {
  ACCOUNT_KIND_KEYS,
  AccountBalance,
  AccountType,
  Currency,
  ExchangeRate,
  FinancialAccount,
  FinancialAccountKind,
  LedgerScope,
  NetWorthSummary,
  StatsSummary,
  TRANSFER_CATEGORY,
  normalizeTransferCategory,
  Transaction,
  fetchAccounts,
  fetchExchangeRate,
  fetchNetWorth,
  fetchStatsSummary,
  fetchStockHoldings,
  fetchSubscriptions,
  fetchUserSettings,
  saveDashboardLayout,
  Subscription,
  UserSettings,
  StockHolding,
  accountLabel,
  formatAmount,
  resolveAccountCountry,
} from "@/lib/api";
import type { BankCountry } from "@/lib/banks";
import { translateCategory } from "@/lib/category-i18n";
import { findDefaultAccountId } from "@/lib/account-defaults";
import {
  BudgetCurrency,
  DashboardCardId,
  ResolvedLayout,
  isHalfWidth,
  resolveLayout,
  scopeCurrencies,
} from "@/lib/dashboard-layout";
import { addMonths, monthKey, monthLabel } from "@/lib/date";

type StockTotalMode = "all" | "KRW" | "CAD" | "USD";
type CreatingKind = FinancialAccountKind | null;

interface Props {
  month: Date;
  version: number;
  scope: LedgerScope;
  accountType?: AccountType;
  transactions?: Transaction[];
  onChanged?: () => void;
  onOpenSettings?: () => void;
  onNavigateToList?: (
    category?: string,
    subCategory?: string,
    fromExpenseChart?: boolean
  ) => void;
}

function ListCard({
  title,
  emptyLabel,
  isEmpty,
  children,
}: {
  title: string;
  emptyLabel: string;
  isEmpty: boolean;
  children: ReactNode;
}) {
  return (
    <section className="card-inset flex h-72 flex-col p-4">
      <h2 className="pr-4 text-sm font-semibold text-gray-700 dark:text-gray-200">
        {title}
      </h2>
      {isEmpty ? (
        <p className="mt-3 text-xs text-gray-400">{emptyLabel}</p>
      ) : (
        <ul className="mt-2 -mr-1 flex-1 divide-y divide-gray-100 overflow-y-auto pr-1 dark:divide-gray-800">
          {children}
        </ul>
      )}
    </section>
  );
}

function KindIcon({ kind }: { kind: FinancialAccountKind }) {
  if (kind === "credit_card") {
    return <CreditCard className="h-4 w-4 text-gray-400 shrink-0" />;
  }
  if (kind === "cash") {
    return <Wallet className="h-4 w-4 text-gray-400 shrink-0" />;
  }
  return <Landmark className="h-4 w-4 text-gray-400 shrink-0" />;
}

export default function DashboardView({
  month,
  version,
  scope,
  accountType = "personal",
  transactions,
  onChanged,
  onOpenSettings,
  onNavigateToList,
}: Props) {
  const locale = useLocale();
  const tDashboard = useTranslations("dashboard");
  const tCommon = useTranslations("common");
  const tAccountKinds = useTranslations("accountKinds");
  const tCategories = useTranslations("categories");
  const tAccount = useTranslations("account");

  const [cadStats, setCadStats] = useState<StatsSummary | null>(null);
  const [krwStats, setKrwStats] = useState<StatsSummary | null>(null);
  const [cadWorth, setCadWorth] = useState<NetWorthSummary | null>(null);
  const [krwWorth, setKrwWorth] = useState<NetWorthSummary | null>(null);
  const [usdWorth, setUsdWorth] = useState<NetWorthSummary | null>(null);
  const [rate, setRate] = useState<ExchangeRate | null>(null);
  const [display, setDisplay] = useState<Currency>("CAD");
  const [stockTotalMode, setStockTotalMode] = useState<StockTotalMode>("all");
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [holdings, setHoldings] = useState<StockHolding[]>([]);
  const [editingAccount, setEditingAccount] = useState<FinancialAccount | null>(
    null
  );
  const [creatingKind, setCreatingKind] = useState<CreatingKind>(null);
  const [cardOrder, setCardOrder] = useState<string[]>([]);
  const [brokerOrder, setBrokerOrder] = useState<string[]>([]);
  const [dragCardId, setDragCardId] = useState<string | null>(null);
  const [dragBrokerId, setDragBrokerId] = useState<string | null>(null);
  const [userSettings, setUserSettings] = useState<UserSettings | null>(null);
  const [layouts, setLayouts] = useState<
    Partial<Record<BudgetCurrency, ResolvedLayout>>
  >({});
  // Card order/visibility is stored per country.
  const layoutCountry = scopeCurrencies(scope)[0];
  const layout =
    layouts[layoutCountry] ??
    resolveLayout(
      userSettings?.dashboard_layouts?.[layoutCountry] ??
        userSettings?.dashboard_layout
    );
  const [prevStats, setPrevStats] = useState<
    Partial<Record<BudgetCurrency, StatsSummary | null>>
  >({});
  const [fixedBills, setFixedBills] = useState<Subscription[]>([]);
  const [settingsReady, setSettingsReady] = useState(false);
  const excluded = useMemo(
    () => userSettings?.spending_excluded_categories ?? [TRANSFER_CATEGORY],
    [userSettings]
  );
  const excludeKey = excluded.join("|");
  const suppressCardClick = useRef(false);
  const suppressBrokerClick = useRef(false);

  const monthStr = monthKey(month);

  useEffect(() => {
    if (!settingsReady) return;
    setLoading(true);

    const statsJobs: Promise<StatsSummary | null>[] = [];
    const worthJobs: Promise<NetWorthSummary | null>[] = [];

    if (scope === "CAD" || scope === "ALL") {
      statsJobs.push(
        fetchStatsSummary({
          currency: "CAD",
          month: monthStr,
          accountType,
          excludeCategories: excluded,
        }).catch(() => null)
      );
      worthJobs.push(
        fetchNetWorth({ currency: "CAD", accountType }).catch(() => null)
      );
    } else {
      statsJobs.push(Promise.resolve(null));
      worthJobs.push(Promise.resolve(null));
    }

    if (scope === "KRW" || scope === "ALL") {
      statsJobs.push(
        fetchStatsSummary({
          currency: "KRW",
          month: monthStr,
          accountType,
          excludeCategories: excluded,
        }).catch(() => null)
      );
      worthJobs.push(
        fetchNetWorth({ currency: "KRW", accountType }).catch(() => null)
      );
    } else {
      statsJobs.push(Promise.resolve(null));
      worthJobs.push(Promise.resolve(null));
    }

    // USD brokerage wallets (e.g. Toss US) are neither CAD nor KRW — always load
    // when the dashboard is visible so country tabs can attach them by country.
    worthJobs.push(
      fetchNetWorth({ currency: "USD", accountType }).catch(() => null)
    );

    const accountJobs: Promise<FinancialAccount[]>[] = [
      fetchAccounts({ accountType }).catch(() => []),
    ];

    Promise.all([
      ...statsJobs,
      ...worthJobs,
      fetchExchangeRate().catch(() => null),
      Promise.all(accountJobs).then((lists) => lists.flat()),
      fetchStockHoldings(accountType).catch(() => []),
    ])
      .then(([cadS, krwS, cadW, krwW, usdW, r, accountList, holdingsList]) => {
        setCadStats(cadS as StatsSummary | null);
        setKrwStats(krwS as StatsSummary | null);
        setCadWorth(cadW as NetWorthSummary | null);
        setKrwWorth(krwW as NetWorthSummary | null);
        setUsdWorth(usdW as NetWorthSummary | null);
        setRate(r as ExchangeRate | null);
        setAccounts(accountList as FinancialAccount[]);
        setHoldings(holdingsList as StockHolding[]);
        if (scope === "CAD") setDisplay("CAD");
        else if (scope === "KRW") setDisplay("KRW");
      })
      .finally(() => setLoading(false));
  }, [monthStr, version, scope, accountType, settingsReady, excludeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchUserSettings()
      .then(setUserSettings)
      .catch(() => {
        /* fall back to the default layout */
      })
      .finally(() => setSettingsReady(true));
  }, []);

  // Previous month's spend (budget carry-over) and this month's fixed bills.
  useEffect(() => {
    if (!settingsReady) return;
    let active = true;
    const currencies = scopeCurrencies(scope);
    const prevMonth = monthKey(addMonths(month, -1));
    Promise.all(
      currencies.map((c) =>
        fetchStatsSummary({
          currency: c,
          month: prevMonth,
          accountType,
          excludeCategories: excluded,
        }).catch(() => null)
      )
    ).then((list) => {
      if (active) {
        setPrevStats(Object.fromEntries(currencies.map((c, i) => [c, list[i]])));
      }
    });
    fetchSubscriptions({
      accountType,
      month: monthStr,
      currency: scope === "ALL" ? undefined : scope,
    })
      .then((list) => active && setFixedBills(list))
      .catch(() => active && setFixedBills([]));
    return () => {
      active = false;
    };
  }, [monthStr, version, scope, accountType, settingsReady, excludeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const accountById = useMemo(
    () => new Map(accounts.map((a) => [a.id, a])),
    [accounts]
  );

  function openAccountEdit(accountId: string) {
    const account = accountById.get(accountId);
    if (account) setEditingAccount(account);
  }

  const flow = useMemo(() => {
    if (scope === "CAD") {
      if (!cadStats) return null;
      return {
        netCashflow: cadStats.net_cashflow,
        expense: cadStats.adjusted_expense,
        income: cadStats.total_income,
        investmentSavings: cadStats.investment_savings_total,
        currency: "CAD" as Currency,
      };
    }
    if (scope === "KRW") {
      if (!krwStats) return null;
      return {
        netCashflow: krwStats.net_cashflow,
        expense: krwStats.adjusted_expense,
        income: krwStats.total_income,
        investmentSavings: krwStats.investment_savings_total,
        currency: "KRW" as Currency,
      };
    }
    // ALL — convert into display currency
    if (!cadStats || !krwStats || !rate) return null;

    const convert = (amount: number, from: Currency, to: Currency) => {
      if (from === to) return amount;
      return from === "CAD" ? amount * rate.cad_krw : amount * rate.krw_cad;
    };
    const toDisplay = (cadVal: number, krwVal: number) =>
      display === "CAD"
        ? cadVal + convert(krwVal, "KRW", "CAD")
        : krwVal + convert(cadVal, "CAD", "KRW");

    return {
      netCashflow: toDisplay(cadStats.net_cashflow, krwStats.net_cashflow),
      expense: toDisplay(cadStats.adjusted_expense, krwStats.adjusted_expense),
      income: toDisplay(cadStats.total_income, krwStats.total_income),
      investmentSavings: toDisplay(
        cadStats.investment_savings_total,
        krwStats.investment_savings_total
      ),
      currency: display,
    };
  }, [scope, cadStats, krwStats, rate, display]);

  const netWorth = useMemo(() => {
    if (scope === "CAD") return cadWorth;
    if (scope === "KRW") return krwWorth;
    if (!cadWorth || !krwWorth || !rate) return null;

    const convert = (amount: number, from: Currency, to: Currency) => {
      if (from === to) return amount;
      return from === "CAD" ? amount * rate.cad_krw : amount * rate.krw_cad;
    };
    const toDisplay = (cadVal: number, krwVal: number) =>
      display === "CAD"
        ? cadVal + convert(krwVal, "KRW", "CAD")
        : krwVal + convert(cadVal, "CAD", "KRW");

    const accounts: AccountBalance[] = [
      ...cadWorth.accounts,
      ...krwWorth.accounts,
    ];

    return {
      account_type: cadWorth.account_type,
      currency: display,
      total_assets: toDisplay(cadWorth.total_assets, krwWorth.total_assets),
      total_liabilities: toDisplay(
        cadWorth.total_liabilities,
        krwWorth.total_liabilities
      ),
      net_worth: toDisplay(cadWorth.net_worth, krwWorth.net_worth),
      accounts,
    } satisfies NetWorthSummary;
  }, [scope, cadWorth, krwWorth, rate, display]);

  // Group holdings by account
  const accountHoldingsMap = useMemo(() => {
    const map: Record<string, StockHolding[]> = {};
    holdings.forEach((h) => {
      if (!map[h.account_id]) map[h.account_id] = [];
      map[h.account_id].push(h);
    });
    return map;
  }, [holdings]);

  // Helper to convert native amounts between CAD / KRW / USD.
  const convertNative = useCallback(
    (amount: number, from: string, to: Currency | "USD"): number => {
      if (!rate) return amount;
      if (from === to) return amount;

      if (to === "CAD") {
        if (from === "USD") return amount * (rate.usd_cad || 1.37);
        if (from === "KRW") return amount * (rate.krw_cad || 0.001);
      } else if (to === "KRW") {
        if (from === "USD") return amount * (rate.usd_krw || 1350);
        if (from === "CAD") return amount * (rate.cad_krw || 980);
      } else if (to === "USD") {
        if (from === "CAD") return amount * (rate.cad_usd || 1 / 1.37);
        if (from === "KRW") return amount * (rate.krw_usd || 1 / 1350);
      }
      return amount;
    },
    [rate]
  );

  const scopeCountry: BankCountry | null =
    scope === "CAD" ? "CA" : scope === "KRW" ? "KR" : null;

  function accountMatchesScope(accountId: string, currency: string): boolean {
    if (scope === "ALL") return true;
    const full = accountById.get(accountId);
    if (full) {
      const country = resolveAccountCountry(full);
      if (country) return country === scopeCountry;
    }
    return currency === scope;
  }

  // Balances filtered by Canada/Korea *country* (not cash currency).
  // Include USD wallets (Toss US, etc.) — they are absent from CAD/KRW net-worth.
  // Exclude virtual stock lumps — equity is shown in the stock section from holdings.
  const scopedBalances = useMemo(() => {
    const rawList =
      scope === "CAD"
        ? (cadWorth?.accounts ?? [])
        : scope === "KRW"
          ? (krwWorth?.accounts ?? [])
          : [
              ...(cadWorth?.accounts ?? []),
              ...(krwWorth?.accounts ?? []),
            ];

    const seen = new Set<string>();
    const uniqueList: AccountBalance[] = [];
    for (const a of rawList) {
      if (!a.account_id || a.account_id.startsWith("virtual_stocks")) continue;
      if (!seen.has(a.account_id)) {
        seen.add(a.account_id);
        uniqueList.push(a);
      }
    }

    return uniqueList.filter((a) => accountMatchesScope(a.account_id, a.currency));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cadWorth, krwWorth, accounts, scope, scopeCountry]);

  // Stock account cards + header totals.
  // "all": native buckets by holding/cash currency (hide zero lines).
  // KRW/CAD/USD: FX-convert every wallet into that currency and sum.
  const stockAccountsStats = useMemo(() => {
    const invAccounts = scopedBalances.filter((a) => a.kind === "investment");

    const list = invAccounts.map((acc) => {
      const cash = acc.balance;
      const accHoldings = accountHoldingsMap[acc.account_id] || [];

      const stockValuation = accHoldings.reduce((sum, h) => {
        const converted = convertNative(
          h.valuation,
          h.currency,
          acc.currency as Currency
        );
        return sum + converted;
      }, 0);

      const total = cash + stockValuation;

      return {
        account: acc,
        cash,
        stockValuation,
        total,
      };
    });

    const native: Record<"KRW" | "CAD" | "USD", number> = {
      KRW: 0,
      CAD: 0,
      USD: 0,
    };

    for (const item of list) {
      const accCur = item.account.currency;
      if (accCur === "KRW" || accCur === "CAD" || accCur === "USD") {
        native[accCur] += item.cash;
      }
      const accHoldings = accountHoldingsMap[item.account.account_id] || [];
      for (const h of accHoldings) {
        const hc = h.currency;
        if (hc === "KRW" || hc === "CAD" || hc === "USD") {
          native[hc] += h.valuation;
        }
      }
    }

    const nativeLines = (
      ["KRW", "CAD", "USD"] as const
    )
      .filter((c) => Math.abs(native[c]) > 0.0001)
      .map((currency) => ({ currency, amount: native[currency] }));

    function convertedTotal(to: "KRW" | "CAD" | "USD") {
      return (["KRW", "CAD", "USD"] as const).reduce(
        (sum, from) => sum + convertNative(native[from], from, to),
        0
      );
    }

    return {
      accounts: list,
      nativeLines,
      totals: {
        KRW: convertedTotal("KRW"),
        CAD: convertedTotal("CAD"),
        USD: convertedTotal("USD"),
      },
    };
  }, [scopedBalances, accountHoldingsMap, convertNative]);

  const hasCadAccounts = useMemo(
    () =>
      stockAccountsStats.accounts.some((a) => a.account.currency === "CAD") ||
      stockAccountsStats.nativeLines.some((l) => l.currency === "CAD") ||
      scopedBalances.some((a) => a.currency === "CAD"),
    [stockAccountsStats, scopedBalances]
  );

  useEffect(() => {
    const cardKey = `pairpocket:dashboardCardOrder:${accountType}:${scope}`;
    const brokerKey = `pairpocket:dashboardBrokerOrder:${accountType}:${scope}`;
    try {
      const cardRaw = localStorage.getItem(cardKey);
      const brokerRaw = localStorage.getItem(brokerKey);
      setCardOrder(cardRaw ? (JSON.parse(cardRaw) as string[]) : []);
      setBrokerOrder(brokerRaw ? (JSON.parse(brokerRaw) as string[]) : []);
    } catch {
      setCardOrder([]);
      setBrokerOrder([]);
    }
  }, [accountType, scope]);

  function orderByIds<T>(
    items: T[],
    idOf: (item: T) => string,
    order: string[]
  ): T[] {
    if (!order.length) return items;
    const orderMap = new Map(order.map((id, i) => [id, i]));
    return [...items].sort((a, b) => {
      const ai = orderMap.get(idOf(a)) ?? 999;
      const bi = orderMap.get(idOf(b)) ?? 999;
      return ai - bi;
    });
  }

  function persistOrder(
    kind: "card" | "broker",
    ids: string[]
  ) {
    const key =
      kind === "card"
        ? `pairpocket:dashboardCardOrder:${accountType}:${scope}`
        : `pairpocket:dashboardBrokerOrder:${accountType}:${scope}`;
    localStorage.setItem(key, JSON.stringify(ids));
    if (kind === "card") setCardOrder(ids);
    else setBrokerOrder(ids);
  }

  function reorderIds(
    orderedIds: string[],
    fromId: string,
    toId: string
  ): string[] | null {
    if (fromId === toId) return null;
    const ids = [...orderedIds];
    const fromIdx = ids.indexOf(fromId);
    const toIdx = ids.indexOf(toId);
    if (fromIdx < 0 || toIdx < 0) return null;
    ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, fromId);
    return ids;
  }

  const budgetCurrencies = scopeCurrencies(scope);

  // Balance of the default expense account for each ledger currency.
  const balance = useMemo(() => {
    const target: Currency = scope === "ALL" ? display : budgetCurrencies[0];
    let total = 0;
    let found = false;
    const labels: string[] = [];
    for (const c of budgetCurrencies) {
      const id = findDefaultAccountId(accounts, c, "expense");
      const list = c === "CAD" ? cadWorth?.accounts : krwWorth?.accounts;
      const bal = list?.find((a) => a.account_id === id)?.balance;
      if (!id || bal === undefined) continue;
      found = true;
      total += convertNative(bal, c, target);
      const account = accountById.get(id);
      if (account) labels.push(accountLabel(account));
    }
    return found
      ? { amount: total, currency: target, label: labels.join(" · ") }
      : null;
  }, [accounts, accountById, cadWorth, krwWorth, scope, display, convertNative]); // eslint-disable-line react-hooks/exhaustive-deps

  // Monthly budget; last month's overspend is deducted from this month.
  const budget = useMemo(() => {
    const target: Currency = scope === "ALL" ? display : budgetCurrencies[0];
    const saved = userSettings?.budgets?.[accountType] ?? {};
    let base = 0;
    let carry = 0;
    let configured = false;
    for (const c of budgetCurrencies) {
      const amount = saved[c] ?? 0;
      if (amount <= 0) continue;
      configured = true;
      const over = Math.max(0, (prevStats[c]?.adjusted_expense ?? 0) - amount);
      base += convertNative(amount, c, target);
      carry += convertNative(over, c, target);
    }
    return {
      configured,
      base,
      carry,
      effective: Math.max(0, base - carry),
      currency: target,
    };
  }, [userSettings, prevStats, accountType, scope, display, convertNative]); // eslint-disable-line react-hooks/exhaustive-deps

  const expenseItems = useMemo(
    () =>
      (transactions ?? [])
        .filter(
          (t) =>
            t.type === "expense" &&
            t.kind !== "transfer" &&
            !t.is_stock_trade &&
            !excluded.includes(normalizeTransferCategory(t.category))
        )
        .sort((a, b) => b.date.localeCompare(a.date)),
    [transactions, excluded]
  );

  const fixedItems = useMemo(
    () =>
      fixedBills
        .filter((s) => s.status === "active" || s.status === "cancel_scheduled")
        .sort((a, b) =>
          (a.next_due_date ?? "9999").localeCompare(b.next_due_date ?? "9999")
        ),
    [fixedBills]
  );

  const fmt = useCallback(
    (amount: number, currency: Currency) =>
      formatAmount(amount, currency, {
        plainUsd: !hasCadAccounts && currency === "USD",
      }),
    [hasCadAccounts]
  );

  if (loading) {
    return (
      <div className="h-40 w-full animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />
    );
  }

  const showCombinedToggle = scope === "ALL";
  const heroCurrency = flow?.currency ?? (scope === "KRW" ? "KRW" : "CAD");
  const scopeLabel =
    scope === "ALL"
      ? tCommon("combined")
      : scope === "CAD"
        ? tCommon("canada")
        : tCommon("korea");

  const assetAccounts = scopedBalances.filter(
    (a) => !a.is_liability && a.kind !== "investment"
  );
  const liabilityAccounts = orderByIds(
    scopedBalances.filter((a) => a.is_liability),
    (a) => a.account_id,
    cardOrder
  );
  const orderedStockAccounts = orderByIds(
    stockAccountsStats.accounts,
    (a) => a.account.account_id,
    brokerOrder
  );
  const hasCashAccount = assetAccounts.some((a) => a.kind === "cash");
  const createCountry: BankCountry | null = scopeCountry;
  const createCurrency: Currency =
    scope === "KRW" ? "KRW" : scope === "CAD" ? "CAD" : display;
  const cardBalancesLabel =
    tDashboard("cardBalances") ||
    translateCategory(TRANSFER_CATEGORY, tCategories);

  function handleCardDrop(toId: string) {
    if (!dragCardId) return;
    const next = reorderIds(
      liabilityAccounts.map((a) => a.account_id),
      dragCardId,
      toId
    );
    if (next) persistOrder("card", next);
    setDragCardId(null);
  }

  function handleBrokerDrop(toId: string) {
    if (!dragBrokerId) return;
    const next = reorderIds(
      orderedStockAccounts.map((a) => a.account.account_id),
      dragBrokerId,
      toId
    );
    if (next) persistOrder("broker", next);
    setDragBrokerId(null);
  }

  // Removed old duplicate position of hooks
  const budgetCurrency = budget.currency;
  const spentAmount = flow?.expense ?? 0;
  const remaining = budget.effective - spentAmount;
  const overBudget = budget.configured && remaining < 0;
  const spentPct =
    budget.effective > 0
      ? Math.min(100, (spentAmount / budget.effective) * 100)
      : spentAmount > 0
        ? 100
        : 0;
  const shortDate = (d: string) => d.slice(5, 10).replace("-", ".");

  const cardNodes: Partial<Record<DashboardCardId, ReactNode>> = {
    balance: (
      <section className="card-inset p-5">
        <div className="flex items-center justify-between gap-2 pr-4">
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
            {tDashboard("balance")}
          </p>
          {showCombinedToggle && (
            <div className="flex rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5">
              {(["CAD", "KRW"] as Currency[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setDisplay(c)}
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                    display === c
                      ? "bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-white"
                      : "text-gray-500"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
        </div>
        <p
          className={`mt-1 text-3xl font-bold tracking-tight ${
            (balance?.amount ?? 0) < 0
              ? "text-red-500"
              : "text-gray-900 dark:text-white"
          }`}
        >
          {balance ? fmt(balance.amount, balance.currency) : "\u2014"}
        </p>
        {balance?.label && (
          <p className="mt-1 truncate text-xs text-gray-400">{balance.label}</p>
        )}
        {!balance && (
          <button
            type="button"
            onClick={onOpenSettings}
            className="mt-1 text-xs font-medium text-blue-600 hover:underline"
          >
            {tDashboard("balanceNoDefault")}
          </button>
        )}
      </section>
    ),
    budget: (
      <section className="card-inset h-full p-4">
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
          {tDashboard("budget")}
        </p>
        <p className="mt-1 text-xl font-bold tracking-tight tabular-nums text-gray-900 dark:text-white">
          {budget.configured ? fmt(budget.effective, budgetCurrency) : "\u2014"}
        </p>
        {!budget.configured ? (
          <button
            type="button"
            onClick={onOpenSettings}
            className="mt-1 text-[11px] font-medium text-blue-600 hover:underline"
          >
            {tDashboard("budgetSet")}
          </button>
        ) : (
          budget.carry > 0 && (
            <p className="mt-1 text-[11px] leading-snug text-red-500">
              {tDashboard("budgetCarry", {
                base: fmt(budget.base, budgetCurrency),
                over: fmt(budget.carry, budgetCurrency),
              })}
            </p>
          )
        )}
      </section>
    ),
    spent: (
      <section className="card-inset h-full p-4">
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
          {tDashboard("expense")}
        </p>
        <p className="mt-1 text-xl font-bold tracking-tight tabular-nums text-gray-900 dark:text-white">
          {flow ? fmt(flow.expense, flow.currency) : "\u2014"}
        </p>
        {flow && budget.configured && (
          <>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
              <div
                className={`h-full rounded-full ${
                  overBudget ? "bg-red-500" : "bg-blue-500"
                }`}
                style={{ width: `${spentPct}%` }}
              />
            </div>
            <p
              className={`mt-1 text-[11px] ${
                overBudget ? "text-red-500" : "text-gray-400"
              }`}
            >
              {overBudget
                ? tDashboard("overBudget", {
                    amount: fmt(-remaining, budgetCurrency),
                  })
                : tDashboard("remaining", {
                    amount: fmt(remaining, budgetCurrency),
                  })}
            </p>
          </>
        )}
      </section>
    ),
    expenseRatio: (
      <div id="expense-ratio-section">
        <DashboardAnalytics
          part="expense"
          month={month}
          version={version}
          scope={scope}
          accountType={accountType}
          displayCurrency={heroCurrency}
          rate={rate}
          cadStats={cadStats}
          krwStats={krwStats}
          transactions={transactions}
          excludeCategories={excluded}
          onCategoryClick={onNavigateToList}
        />
      </div>
    ),
    fixedList: (
      <ListCard
        title={tDashboard("fixedExpenses")}
        emptyLabel={tDashboard("emptyFixed")}
        isEmpty={fixedItems.length === 0}
      >
        {fixedItems.map((s) => (
          <li key={s.id} className="py-2">
            <p className="truncate text-xs font-medium text-gray-800 dark:text-gray-100">
              {s.name}
            </p>
            <div className="mt-0.5 flex items-baseline justify-between gap-1 text-[11px]">
              <span className="text-gray-400">
                {s.next_due_date ? shortDate(s.next_due_date) : ""}
              </span>
              <span className="font-semibold tabular-nums text-gray-700 dark:text-gray-200">
                {fmt(s.amount, s.currency)}
              </span>
            </div>
          </li>
        ))}
      </ListCard>
    ),
    expenseList: (
      <ListCard
        title={tDashboard("expenseHistory")}
        emptyLabel={tDashboard("emptyExpenses")}
        isEmpty={expenseItems.length === 0}
      >
        {expenseItems.map((tx) => (
          <li key={tx.id} className="py-2">
            <p className="truncate text-xs font-medium text-gray-800 dark:text-gray-100">
              {tx.merchant || translateCategory(tx.category, tCategories)}
            </p>
            <div className="mt-0.5 flex items-baseline justify-between gap-1 text-[11px]">
              <span className="text-gray-400">{shortDate(tx.date)}</span>
              <span className="font-semibold tabular-nums text-gray-700 dark:text-gray-200">
                {fmt(tx.effective_amount ?? tx.amount, tx.currency)}
              </span>
            </div>
          </li>
        ))}
      </ListCard>
    ),
    netWorth: (
      <section className="card-inset p-5">
        <div className="flex items-center justify-between gap-2 pr-4">
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
            {tDashboard("netWorth")}
          </p>
          {showCombinedToggle && (
            <div className="flex rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5">
              {(["CAD", "KRW"] as Currency[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setDisplay(c)}
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                    display === c
                      ? "bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-white"
                      : "text-gray-500"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
        </div>
        <p
          className={`mt-1 text-3xl font-bold tracking-tight ${
            (netWorth?.net_worth ?? 0) < 0
              ? "text-red-500"
              : "text-gray-900 dark:text-white"
          }`}
        >
          {netWorth
            ? formatAmount(netWorth.net_worth, heroCurrency)
            : "—"}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
          <div className="rounded-xl bg-gray-50 dark:bg-gray-900/50 px-3 py-2">
            <p className="text-gray-400">{tDashboard("assets")}</p>
            <p className="mt-0.5 font-semibold text-blue-500">
              {netWorth
                ? formatAmount(netWorth.total_assets, heroCurrency)
                : "—"}
            </p>
          </div>
          <div className="rounded-xl bg-gray-50 dark:bg-gray-900/50 px-3 py-2">
            <p className="text-gray-400">{tDashboard("totalLiabilities")}</p>
            {(() => {
              const liabilities = netWorth?.total_liabilities ?? 0;
              const overpaid = liabilities < 0;
              const display = netWorth
                ? formatAmount(
                    overpaid ? Math.abs(liabilities) : liabilities,
                    heroCurrency
                  )
                : "—";
              return (
                <p
                  className={`mt-0.5 font-semibold ${
                    overpaid ? "text-blue-500" : "text-red-500"
                  }`}
                >
                  {overpaid && netWorth ? `+${display}` : display}
                </p>
              );
            })()}
          </div>
        </div>
      </section>
    ),
    monthlyFlow: (
      <div className="space-y-4">
      <section className="rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 p-6 text-white shadow-sm">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-blue-100">
            {tDashboard("monthlyFlow", {
              month: monthLabel(month, locale),
              scope: scopeLabel,
            })}
          </p>
        </div>
        <p className="mt-2 text-3xl font-bold tracking-tight">
          {flow ? formatAmount(flow.netCashflow, flow.currency) : "—"}
        </p>
        {rate && scope === "ALL" && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-blue-100">
            <RefreshCw className="h-3 w-3" />
            {tDashboard("exchangeRate", {
              rate: rate.cad_krw.toLocaleString(locale, {
                maximumFractionDigits: 2,
              }),
            })}{" "}
            · {tCommon("asOf", { date: rate.date ?? "-" })}
            {rate.stale && ` ${tCommon("cached")}`}
            {rate.source && rate.source !== "fallback"
              ? ` · ${rate.source}`
              : ""}
          </p>
        )}
        {rate && scope !== "ALL" && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-blue-100/80">
            <RefreshCw className="h-3 w-3" />
            {tDashboard("exchangeRateReference", {
              rate: rate.cad_krw.toLocaleString(locale, {
                maximumFractionDigits: 2,
              }),
            })}
          </p>
        )}
      </section>
      {flow && (
        <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <MetricCard
            label={tDashboard("expense")}
            value={formatAmount(flow.expense, flow.currency)}
          />
          <MetricCard
            label={tDashboard("income")}
            value={formatAmount(flow.income, flow.currency)}
          />
          <MetricCard
            label={tDashboard("investmentSavings")}
            value={formatAmount(flow.investmentSavings, flow.currency)}
          />
        </section>
      )}
      </div>
    ),
    trend: (
      <DashboardAnalytics
          part="trend"
          month={month}
          version={version}
          scope={scope}
          accountType={accountType}
          displayCurrency={heroCurrency}
          rate={rate}
          cadStats={cadStats}
          krwStats={krwStats}
          transactions={transactions}
          onCategoryClick={onNavigateToList}
        />
    ),
    cards: (
      <section className="card-inset p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">
            {cardBalancesLabel}
          </p>
          <button
            type="button"
            onClick={() => setCreatingKind("credit_card")}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40"
          >
            <Plus className="h-3.5 w-3.5" />
            {tDashboard("addGeneric")}
          </button>
        </div>
        <ul className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
          {liabilityAccounts.length === 0 ? (
            <li className="col-span-full rounded-xl border border-dashed border-gray-200 dark:border-gray-700 px-3 py-6 text-center text-xs text-gray-400">
              {tDashboard("emptyCards")}
            </li>
          ) : (
            liabilityAccounts.map((acc) => {
              const label = acc.nickname?.trim() || acc.name;
              const overpaid = acc.balance < 0;
              const displayAmt = formatAmount(
                overpaid ? Math.abs(acc.balance) : acc.balance,
                acc.currency
              );
              const isDragging = dragCardId === acc.account_id;
              return (
                <li
                  key={acc.account_id}
                  draggable
                  onDragStart={() => setDragCardId(acc.account_id)}
                  onDragEnd={() => {
                    suppressCardClick.current = true;
                    setDragCardId(null);
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleCardDrop(acc.account_id);
                  }}
                  className={isDragging ? "opacity-50" : undefined}
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (suppressCardClick.current) {
                        suppressCardClick.current = false;
                        return;
                      }
                      openAccountEdit(acc.account_id);
                    }}
                    className="w-full rounded-xl bg-gray-50 dark:bg-gray-900/50 px-3 py-3 text-left hover:bg-gray-100 dark:hover:bg-gray-800/70 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <GripVertical className="h-3.5 w-3.5 text-gray-300 shrink-0 cursor-grab" />
                      <KindIcon kind={acc.kind} />
                      <p className="text-sm font-medium truncate flex-1">
                        {scope === "ALL" &&
                          (acc.currency === "CAD"
                            ? "🇨🇦 "
                            : acc.currency === "KRW"
                              ? "🇰🇷 "
                              : "🇺🇸 ")}
                        {label}
                      </p>
                    </div>
                    <p
                      className={`mt-1.5 text-base font-bold tabular-nums truncate ${
                        overpaid ? "text-blue-500" : "text-red-500"
                      }`}
                    >
                      {overpaid ? `+${displayAmt}` : displayAmt}
                    </p>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </section>
    ),
    stocks: (
      <section className="card-inset p-4">
        <div className="flex flex-col gap-2.5 border-b border-gray-100 dark:border-gray-800 pb-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">
              {tDashboard("stockAccounts")}
            </p>
            <button
              type="button"
              onClick={() => setCreatingKind("investment")}
              className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5" />
              {tDashboard("addGeneric")}
            </button>
          </div>
          <div className="flex flex-col gap-2 min-[400px]:flex-row min-[400px]:items-center min-[400px]:justify-between sm:justify-end sm:gap-2">
            <div className="flex w-full min-[400px]:w-auto rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5">
              {(
                [
                  ["all", tDashboard("stockTotalAll")],
                  ["KRW", "KRW"],
                  ["CAD", "CAD"],
                  ["USD", "USD"],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setStockTotalMode(mode)}
                  className={`flex-1 min-[400px]:flex-none rounded-md px-2 py-1 text-[10px] font-semibold transition-colors whitespace-nowrap ${
                    stockTotalMode === mode
                      ? "bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-white"
                      : "text-gray-500"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="text-sm font-black text-blue-600 dark:text-blue-400 tabular-nums self-end min-[400px]:self-auto">
              {stockTotalMode === "all" ? (
                <div className="flex flex-col items-end gap-0.5">
                  {stockAccountsStats.nativeLines.length === 0 ? null : (
                    stockAccountsStats.nativeLines.map((line) => (
                      <span key={line.currency}>
                        {fmt(line.amount, line.currency)}
                      </span>
                    ))
                  )}
                </div>
              ) : stockAccountsStats.accounts.length === 0 ? null : (
                fmt(stockAccountsStats.totals[stockTotalMode], stockTotalMode)
              )}
            </div>
          </div>
        </div>
        <ul className="mt-3.5 grid grid-cols-1 sm:grid-cols-3 gap-3">
          {orderedStockAccounts.length === 0 ? (
            <li className="col-span-full rounded-xl border border-dashed border-gray-200 dark:border-gray-700 px-3 py-6 text-center text-xs text-gray-400">
              {tDashboard("emptyBrokers")}
            </li>
          ) : (
            orderedStockAccounts.map(
              ({ account, cash, stockValuation, total }) => {
                const fullAcc = accountById.get(account.account_id);
                const inst = fullAcc?.institution;
                const label =
                  fullAcc?.nickname?.trim() ||
                  account.nickname?.trim() ||
                  account.name;
                const isDragging = dragBrokerId === account.account_id;
                return (
                  <li
                    key={account.account_id}
                    draggable
                    onDragStart={() => setDragBrokerId(account.account_id)}
                    onDragEnd={() => {
                      suppressBrokerClick.current = true;
                      setDragBrokerId(null);
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      handleBrokerDrop(account.account_id);
                    }}
                    className={isDragging ? "opacity-50" : undefined}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (suppressBrokerClick.current) {
                          suppressBrokerClick.current = false;
                          return;
                        }
                        openAccountEdit(account.account_id);
                      }}
                      className="w-full rounded-xl bg-gray-50 dark:bg-gray-900/50 p-3 text-left hover:shadow-sm hover:bg-gray-100 dark:hover:bg-gray-800/70 transition-all border border-gray-100 dark:border-gray-800/80"
                    >
                      <div className="flex items-center justify-between gap-2 min-w-0">
                        <span className="flex items-center gap-1 min-w-0 text-[11px] font-bold text-gray-700 dark:text-gray-300">
                          <GripVertical className="h-3 w-3 text-gray-300 shrink-0 cursor-grab" />
                          <span className="truncate">
                            {inst ? `[${inst}] ` : ""}
                            {label}
                          </span>
                        </span>
                        <span className="shrink-0 text-[9px] bg-gray-200 dark:bg-gray-850 text-gray-500 dark:text-gray-400 px-1.5 py-0.5 rounded font-black uppercase tracking-wider">
                          {account.currency}
                        </span>
                      </div>
                      <div className="mt-2.5 flex items-baseline justify-between gap-2 min-w-0">
                        <span className="text-[10px] text-gray-400 shrink-0">
                          {tDashboard("stockPlusCash")}
                        </span>
                        <span className="text-base font-black text-gray-900 dark:text-white tabular-nums truncate text-right">
                          {fmt(total, account.currency as Currency)}
                        </span>
                      </div>
                      <div className="mt-1.5 space-y-0.5 text-[10px] text-gray-400 border-t border-gray-100 dark:border-gray-800 pt-1.5">
                        <div className="flex items-center justify-between gap-2 min-w-0">
                          <span className="shrink-0">
                            {tDashboard("stocksLabel")}
                          </span>
                          <span className="tabular-nums truncate text-right">
                            {fmt(
                              stockValuation,
                              account.currency as Currency
                            )}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2 min-w-0">
                          <span className="shrink-0">
                            {tDashboard("cashLabel")}
                          </span>
                          <span className="tabular-nums truncate text-right">
                            {fmt(cash, account.currency as Currency)}
                          </span>
                        </div>
                      </div>
                    </button>
                  </li>
                );
              }
            )
          )}
        </ul>
      </section>
    ),
    assets: (
      <AccountGroup
        title={tDashboard("assets")}
        accounts={assetAccounts}
        scope={scope}
        kindLabel={(kind) => tAccountKinds(ACCOUNT_KIND_KEYS[kind])}
        onEdit={openAccountEdit}
        onAdd={() => setCreatingKind("checking")}
        showCashPlaceholder={!hasCashAccount}
        cashPlaceholderLabel={tDashboard("cashZero")}
        addLabel={tDashboard("addGeneric")}
        formatAmountFn={fmt}
      />
    ),
  };

  const renderableIds = layout.order.filter(
    (id) => !layout.hidden.includes(id) && cardNodes[id]
  );
  const renderable = new Set<string>(renderableIds);
  const visibleItems = renderableIds.map((id) => ({
    id,
    half: isHalfWidth(layout, id),
    node: cardNodes[id],
  }));

  function handleReorder(visibleIds: string[]) {
    let i = 0;
    const order = layout.order.map((id) =>
      renderable.has(id) ? (visibleIds[i++] as DashboardCardId) : id
    );
    commitLayout({ ...layout, order });
  }

  function handleToggleSize(id: string) {
    const cardId = id as DashboardCardId;
    const size = isHalfWidth(layout, cardId) ? "full" : "half";
    commitLayout({ ...layout, sizes: { ...layout.sizes, [cardId]: size } });
  }

  function commitLayout(next: ResolvedLayout) {
    setLayouts((prev) => ({ ...prev, [layoutCountry]: next }));
    saveDashboardLayout(layoutCountry, next).catch(() => {
      /* keep the optimistic layout; it is saved again on the next change */
    });
  }

  return (
    <div className="space-y-4">
      <SortableCardGrid
        items={visibleItems}
        handleLabel={tDashboard("dragHandle")}
        expandLabel={tDashboard("expandCard")}
        shrinkLabel={tDashboard("shrinkCard")}
        onReorder={handleReorder}
        onToggleSize={handleToggleSize}
      />
      {editingAccount && (
        <AccountRegisterModal
          currency={editingAccount.currency}
          accountType={accountType}
          preferredType={
            editingAccount.kind === "investment"
              ? "income"
              : editingAccount.is_default_income
                ? "income"
                : "expense"
          }
          account={editingAccount}
          country={
            resolveAccountCountry(editingAccount) ?? createCountry ?? undefined
          }
          onClose={() => setEditingAccount(null)}
          onCreated={() => {
            setEditingAccount(null);
            onChanged?.();
          }}
          onUpdated={() => {
            setEditingAccount(null);
            onChanged?.();
          }}
          onDeleted={() => {
            setEditingAccount(null);
            onChanged?.();
          }}
        />
      )}
      {creatingKind && (
        <AccountRegisterModal
          currency={
            creatingKind === "investment" && createCountry === "KR"
              ? "USD"
              : createCurrency
          }
          accountType={accountType}
          preferredType={
            creatingKind === "investment" ? "income" : "expense"
          }
          initialKind={creatingKind}
          country={createCountry}
          onClose={() => setCreatingKind(null)}
          onCreated={() => {
            setCreatingKind(null);
            onChanged?.();
          }}
        />
      )}
    </div>
  );
}

function AccountGroup({
  title,
  accounts,
  scope,
  kindLabel,
  onEdit,
  onAdd,
  showCashPlaceholder,
  cashPlaceholderLabel,
  addLabel,
  formatAmountFn = formatAmount,
}: {
  title: string;
  accounts: AccountBalance[];
  scope: LedgerScope;
  kindLabel: (kind: FinancialAccountKind) => string;
  onEdit: (accountId: string) => void;
  onAdd?: () => void;
  showCashPlaceholder?: boolean;
  cashPlaceholderLabel?: string;
  addLabel?: string;
  formatAmountFn?: (amount: number, currency: Currency) => string;
}) {
  return (
    <div className="card-inset overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-100 dark:border-gray-700">
        <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">
          {title}
        </p>
        {onAdd && (
          <button
            type="button"
            onClick={onAdd}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40"
          >
            <Plus className="h-3.5 w-3.5" />
            {addLabel}
          </button>
        )}
      </div>
      <ul className="divide-y divide-gray-100 dark:divide-gray-700">
        {showCashPlaceholder && (
          <li>
            <button
              type="button"
              onClick={onAdd}
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors"
            >
              <Wallet className="h-4 w-4 text-gray-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">
                  {cashPlaceholderLabel}
                </p>
                <p className="text-[11px] text-gray-400 truncate">
                  {kindLabel("cash")}
                </p>
              </div>
              <p className="text-sm font-semibold tabular-nums whitespace-nowrap text-gray-900 dark:text-white">
                {formatAmountFn(0, scope === "KRW" ? "KRW" : "CAD")}
              </p>
            </button>
          </li>
        )}
        {accounts.map((acc) => {
          const label = acc.nickname?.trim() || acc.name;
          const showFlag = scope === "ALL";
          return (
            <li key={acc.account_id}>
              <button
                type="button"
                onClick={() => onEdit(acc.account_id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors"
              >
                <KindIcon kind={acc.kind} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">
                    {showFlag &&
                      (acc.currency === "CAD"
                        ? "🇨🇦 "
                        : acc.currency === "KRW"
                          ? "🇰🇷 "
                          : "🇺🇸 ")}
                    {label}
                  </p>
                  <p className="text-[11px] text-gray-400 truncate">
                    {kindLabel(acc.kind)}
                  </p>
                </div>
                <p className="text-sm font-semibold tabular-nums whitespace-nowrap text-gray-900 dark:text-white">
                  {formatAmount(acc.balance, acc.currency)}
                </p>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card-inset p-4">
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className="mt-1 text-lg font-bold tracking-tight truncate">{value}</p>
    </div>
  );
}
