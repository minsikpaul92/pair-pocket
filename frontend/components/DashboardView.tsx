"use client";

import {
  CreditCard,
  Landmark,
  Plus,
  RefreshCw,
  Wallet,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";

import AccountRegisterModal from "@/components/AccountRegisterModal";
import DashboardAnalytics from "@/components/DashboardAnalytics";
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
  fetchAccounts,
  fetchExchangeRate,
  fetchNetWorth,
  fetchStatsSummary,
  fetchStockHoldings,
  StockHolding,
  formatAmount,
  resolveAccountCountry,
} from "@/lib/api";
import type { BankCountry } from "@/lib/banks";
import { translateCategory } from "@/lib/category-i18n";
import { monthKey, monthLabel } from "@/lib/date";

type StockTotalMode = "both" | "KRW" | "USD";
type CreatingKind = FinancialAccountKind | null;

interface Props {
  month: Date;
  version: number;
  scope: LedgerScope;
  accountType?: AccountType;
  onChanged?: () => void;
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
  onChanged,
}: Props) {
  const locale = useLocale();
  const tDashboard = useTranslations("dashboard");
  const tLedger = useTranslations("ledger");
  const tCommon = useTranslations("common");
  const tAccountKinds = useTranslations("accountKinds");
  const tCategories = useTranslations("categories");
  const tAccount = useTranslations("account");

  const [cadStats, setCadStats] = useState<StatsSummary | null>(null);
  const [krwStats, setKrwStats] = useState<StatsSummary | null>(null);
  const [cadWorth, setCadWorth] = useState<NetWorthSummary | null>(null);
  const [krwWorth, setKrwWorth] = useState<NetWorthSummary | null>(null);
  const [allWorth, setAllWorth] = useState<NetWorthSummary | null>(null);
  const [rate, setRate] = useState<ExchangeRate | null>(null);
  const [display, setDisplay] = useState<Currency>("CAD");
  const [stockTotalMode, setStockTotalMode] = useState<StockTotalMode>("both");
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [holdings, setHoldings] = useState<StockHolding[]>([]);
  const [editingAccount, setEditingAccount] = useState<FinancialAccount | null>(
    null
  );
  const [creatingKind, setCreatingKind] = useState<CreatingKind>(null);

  const monthStr = monthKey(month);

  useEffect(() => {
    setLoading(true);

    const statsJobs: Promise<StatsSummary | null>[] = [];
    const worthJobs: Promise<NetWorthSummary | null>[] = [];

    if (scope === "CAD" || scope === "ALL") {
      statsJobs.push(
        fetchStatsSummary({
          currency: "CAD",
          month: monthStr,
          accountType,
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
        }).catch(() => null)
      );
      worthJobs.push(
        fetchNetWorth({ currency: "KRW", accountType }).catch(() => null)
      );
    } else {
      statsJobs.push(Promise.resolve(null));
      worthJobs.push(Promise.resolve(null));
    }

    const accountJobs: Promise<FinancialAccount[]>[] = [
      fetchAccounts({ accountType }).catch(() => []),
    ];

    Promise.all([
      ...statsJobs,
      ...worthJobs,
      fetchNetWorth({ accountType }).catch(() => null),
      fetchExchangeRate().catch(() => null),
      Promise.all(accountJobs).then((lists) => lists.flat()),
      fetchStockHoldings(accountType).catch(() => []),
    ])
      .then(([cadS, krwS, cadW, krwW, allW, r, accountList, holdingsList]) => {
        setCadStats(cadS as StatsSummary | null);
        setKrwStats(krwS as StatsSummary | null);
        setCadWorth(cadW as NetWorthSummary | null);
        setKrwWorth(krwW as NetWorthSummary | null);
        setAllWorth(allW as NetWorthSummary | null);
        setRate(r as ExchangeRate | null);
        setAccounts(accountList as FinancialAccount[]);
        setHoldings(holdingsList as StockHolding[]);
        if (scope === "CAD") setDisplay("CAD");
        else if (scope === "KRW") setDisplay("KRW");
      })
      .finally(() => setLoading(false));
  }, [monthStr, version, scope, accountType]);

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
  const scopedBalances = useMemo(() => {
    const list = allWorth?.accounts ?? [];
    return list.filter(
      (a) =>
        !a.account_id.startsWith("virtual_stocks") &&
        accountMatchesScope(a.account_id, a.currency)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allWorth, accounts, scope, scopeCountry]);

  // Calculate stock account stats by country tab.
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

    const totalKrw = list.reduce(
      (sum, item) =>
        sum +
        convertNative(item.total, item.account.currency, "KRW"),
      0
    );
    const totalUsd = list.reduce(
      (sum, item) =>
        sum +
        convertNative(item.total, item.account.currency, "USD"),
      0
    );

    return {
      accounts: list,
      totalKrw,
      totalUsd,
    };
  }, [scopedBalances, accountHoldingsMap, convertNative]);

  const hasCadAccounts = useMemo(
    () =>
      stockAccountsStats.accounts.some((a) => a.account.currency === "CAD") ||
      scopedBalances.some((a) => a.currency === "CAD"),
    [stockAccountsStats, scopedBalances]
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
  const liabilityAccounts = scopedBalances.filter((a) => a.is_liability);
  const hasCashAccount = assetAccounts.some((a) => a.kind === "cash");
  const createCountry: BankCountry | null = scopeCountry;
  const createCurrency: Currency =
    scope === "KRW" ? "KRW" : scope === "CAD" ? "CAD" : display;
  const cardBalancesLabel =
    tDashboard("cardBalances") ||
    translateCategory(TRANSFER_CATEGORY, tCategories);

  // Removed old duplicate position of hooks
  return (
    <div className="space-y-4">
      {/* Net worth */}
      <section className="card-inset p-5">
        <div className="flex items-center justify-between gap-2">
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

      {/* Monthly cashflow */}
      <section className="rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 p-6 text-white shadow-sm">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-blue-100">
            {tDashboard("monthlyFlow", {
              month: monthLabel(month, locale),
              scope: scopeLabel,
            })}
          </p>
          {showCombinedToggle && (
            <div className="flex rounded-lg bg-white/20 p-0.5">
              {(["CAD", "KRW"] as Currency[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setDisplay(c)}
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                    display === c ? "bg-white text-blue-600" : "text-blue-50"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
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

      <DashboardAnalytics
        month={month}
        version={version}
        scope={scope}
        accountType={accountType}
        displayCurrency={heroCurrency}
        rate={rate}
        cadStats={cadStats}
        krwStats={krwStats}
      />

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
              return (
                <li key={acc.account_id}>
                  <button
                    type="button"
                    onClick={() => openAccountEdit(acc.account_id)}
                    className="w-full rounded-xl bg-gray-50 dark:bg-gray-900/50 px-3 py-3 text-left hover:bg-gray-100 dark:hover:bg-gray-800/70 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
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

      <section className="card-inset p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 dark:border-gray-800 pb-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">
              {tDashboard("stockAccounts")}
            </p>
            <button
              type="button"
              onClick={() => setCreatingKind("investment")}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40"
            >
              <Plus className="h-3.5 w-3.5" />
              {tDashboard("addGeneric")}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5">
              {(
                [
                  ["both", tDashboard("stockTotalBoth")],
                  ["KRW", "KRW"],
                  ["USD", "USD"],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setStockTotalMode(mode)}
                  className={`rounded-md px-2 py-1 text-[10px] font-semibold transition-colors whitespace-nowrap ${
                    stockTotalMode === mode
                      ? "bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-white"
                      : "text-gray-500"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="text-sm font-black text-blue-600 dark:text-blue-400 tabular-nums">
              {stockTotalMode === "both" ? (
                <div className="flex flex-col items-end gap-0.5">
                  <span>{fmt(stockAccountsStats.totalKrw, "KRW")}</span>
                  <span>{fmt(stockAccountsStats.totalUsd, "USD")}</span>
                </div>
              ) : stockTotalMode === "KRW" ? (
                fmt(stockAccountsStats.totalKrw, "KRW")
              ) : (
                fmt(stockAccountsStats.totalUsd, "USD")
              )}
            </div>
          </div>
        </div>
        <ul className="mt-3.5 grid grid-cols-1 sm:grid-cols-3 gap-3">
          {stockAccountsStats.accounts.length === 0 ? (
            <li className="col-span-full rounded-xl border border-dashed border-gray-200 dark:border-gray-700 px-3 py-6 text-center text-xs text-gray-400">
              {tDashboard("emptyBrokers")}
            </li>
          ) : (
            stockAccountsStats.accounts.map(
              ({ account, cash, stockValuation, total }) => {
                const fullAcc = accountById.get(account.account_id);
                const inst = fullAcc?.institution;
                const label =
                  fullAcc?.nickname?.trim() ||
                  account.nickname?.trim() ||
                  account.name;
                return (
                  <li key={account.account_id}>
                    <button
                      type="button"
                      onClick={() => openAccountEdit(account.account_id)}
                      className="w-full rounded-xl bg-gray-50 dark:bg-gray-900/50 p-3 text-left hover:shadow-sm hover:bg-gray-100 dark:hover:bg-gray-800/70 transition-all border border-gray-100 dark:border-gray-800/80"
                    >
                      <div className="flex items-center justify-between gap-2 min-w-0">
                        <span className="text-[11px] font-bold text-gray-700 dark:text-gray-300 truncate">
                          {inst ? `[${inst}] ` : ""}
                          {label}
                        </span>
                        <span className="text-[9px] bg-gray-200 dark:bg-gray-850 text-gray-500 dark:text-gray-400 px-1.5 py-0.5 rounded font-black uppercase tracking-wider">
                          {account.currency}
                        </span>
                      </div>
                      <div className="mt-2.5 flex items-baseline justify-between">
                        <span className="text-[10px] text-gray-400">
                          {tDashboard("stockPlusCash")}
                        </span>
                        <span className="text-base font-black text-gray-900 dark:text-white tabular-nums">
                          {fmt(total, account.currency as Currency)}
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-center justify-between text-[10px] text-gray-400 border-t border-gray-100 dark:border-gray-800 pt-1.5">
                        <span>
                          {tDashboard("stocksLabel")}:{" "}
                          {fmt(
                            stockValuation,
                            account.currency as Currency
                          )}
                        </span>
                        <span>
                          {tDashboard("cashLabel")}:{" "}
                          {fmt(cash, account.currency as Currency)}
                        </span>
                      </div>
                    </button>
                  </li>
                );
              }
            )
          )}
        </ul>
      </section>

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

      {scope === "ALL" && (
        <div className="grid grid-cols-2 gap-3">
          {cadStats && (
            <LedgerStatsCard
              title={tLedger("canadaLedgerShort")}
              currency="CAD"
              stats={cadStats}
              expenseLabel={tDashboard("expense")}
              incomeLabel={tDashboard("income")}
              investmentSavingsLabel={tDashboard("investmentSavings")}
            />
          )}
          {krwStats && (
            <LedgerStatsCard
              title={tLedger("koreaLedgerShort")}
              currency="KRW"
              stats={krwStats}
              expenseLabel={tDashboard("expense")}
              incomeLabel={tDashboard("income")}
              investmentSavingsLabel={tDashboard("investmentSavings")}
            />
          )}
        </div>
      )}
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

function LedgerStatsCard({
  title,
  currency,
  stats,
  expenseLabel,
  incomeLabel,
  investmentSavingsLabel,
}: {
  title: string;
  currency: Currency;
  stats: StatsSummary;
  expenseLabel: string;
  incomeLabel: string;
  investmentSavingsLabel: string;
}) {
  return (
    <div className="card-inset p-5">
      <p className="text-sm text-gray-500 dark:text-gray-400">{title}</p>
      <p
        className={`mt-1 text-xl font-bold tracking-tight truncate ${
          stats.net_cashflow < 0
            ? "text-red-500"
            : "text-gray-900 dark:text-white"
        }`}
      >
        {formatAmount(stats.net_cashflow, currency)}
      </p>
      <div className="mt-3 space-y-1 text-xs">
        <div className="flex justify-between">
          <span className="text-gray-400">{incomeLabel}</span>
          <span className="text-blue-500">
            +{formatAmount(stats.total_income, currency)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{expenseLabel}</span>
          <span className="text-gray-600 dark:text-gray-300">
            -{formatAmount(stats.adjusted_expense, currency)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">{investmentSavingsLabel}</span>
          <span className="text-gray-600 dark:text-gray-300">
            {formatAmount(stats.investment_savings_total, currency)}
          </span>
        </div>
      </div>
    </div>
  );
}
