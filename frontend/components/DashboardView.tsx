"use client";

import {
  CreditCard,
  Landmark,
  RefreshCw,
  Wallet,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  ACCOUNT_KIND_LABEL,
  AccountBalance,
  Currency,
  ExchangeRate,
  FinancialAccountKind,
  LedgerScope,
  NetWorthSummary,
  StatsSummary,
  fetchExchangeRate,
  fetchNetWorth,
  fetchStatsSummary,
  formatAmount,
} from "@/lib/api";
import { monthKey, monthLabel } from "@/lib/date";

interface Props {
  month: Date;
  version: number;
  scope: LedgerScope;
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

export default function DashboardView({ month, version, scope }: Props) {
  const [cadStats, setCadStats] = useState<StatsSummary | null>(null);
  const [krwStats, setKrwStats] = useState<StatsSummary | null>(null);
  const [cadWorth, setCadWorth] = useState<NetWorthSummary | null>(null);
  const [krwWorth, setKrwWorth] = useState<NetWorthSummary | null>(null);
  const [rate, setRate] = useState<ExchangeRate | null>(null);
  const [display, setDisplay] = useState<Currency>("CAD");
  const [loading, setLoading] = useState(true);

  const monthStr = monthKey(month);

  useEffect(() => {
    setLoading(true);

    const statsJobs: Promise<StatsSummary | null>[] = [];
    const worthJobs: Promise<NetWorthSummary | null>[] = [];

    if (scope === "CAD" || scope === "ALL") {
      statsJobs.push(
        fetchStatsSummary({ currency: "CAD", month: monthStr }).catch(() => null)
      );
      worthJobs.push(fetchNetWorth({ currency: "CAD" }).catch(() => null));
    } else {
      statsJobs.push(Promise.resolve(null));
      worthJobs.push(Promise.resolve(null));
    }

    if (scope === "KRW" || scope === "ALL") {
      statsJobs.push(
        fetchStatsSummary({ currency: "KRW", month: monthStr }).catch(() => null)
      );
      worthJobs.push(fetchNetWorth({ currency: "KRW" }).catch(() => null));
    } else {
      statsJobs.push(Promise.resolve(null));
      worthJobs.push(Promise.resolve(null));
    }

    Promise.all([
      ...statsJobs,
      ...worthJobs,
      fetchExchangeRate().catch(() => null),
    ])
      .then(([cadS, krwS, cadW, krwW, r]) => {
        setCadStats(cadS as StatsSummary | null);
        setKrwStats(krwS as StatsSummary | null);
        setCadWorth(cadW as NetWorthSummary | null);
        setKrwWorth(krwW as NetWorthSummary | null);
        setRate(r as ExchangeRate | null);
        if (scope === "CAD") setDisplay("CAD");
        else if (scope === "KRW") setDisplay("KRW");
      })
      .finally(() => setLoading(false));
  }, [monthStr, version, scope]);

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

  if (loading) {
    return (
      <div className="h-40 w-full animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />
    );
  }

  const showCombinedToggle = scope === "ALL";
  const heroCurrency = flow?.currency ?? (scope === "KRW" ? "KRW" : "CAD");
  const titlePrefix =
    scope === "ALL"
      ? "합산"
      : scope === "CAD"
        ? "캐나다"
        : "한국";

  const assetAccounts =
    netWorth?.accounts.filter((a) => !a.is_liability) ?? [];
  const liabilityAccounts =
    netWorth?.accounts.filter((a) => a.is_liability) ?? [];

  return (
    <div className="space-y-4">
      {/* Net worth */}
      <section className="card-inset p-5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
            총자산
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
            <p className="text-gray-400">자산</p>
            <p className="mt-0.5 font-semibold text-blue-500">
              {netWorth
                ? formatAmount(netWorth.total_assets, heroCurrency)
                : "—"}
            </p>
          </div>
          <div className="rounded-xl bg-gray-50 dark:bg-gray-900/50 px-3 py-2">
            <p className="text-gray-400">총 부채</p>
            <p className="mt-0.5 font-semibold text-red-500">
              {netWorth
                ? formatAmount(netWorth.total_liabilities, heroCurrency)
                : "—"}
            </p>
          </div>
        </div>
      </section>

      {/* Monthly cashflow */}
      <section className="rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 p-6 text-white shadow-sm">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-blue-100">
            {monthLabel(month)} {titlePrefix} 순흐름
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
            1 CAD ={" "}
            {rate.cad_krw.toLocaleString("ko-KR", {
              maximumFractionDigits: 2,
            })}{" "}
            KRW · {rate.date ?? "-"} 기준
            {rate.stale && " (캐시)"}
            {rate.source && rate.source !== "fallback"
              ? ` · ${rate.source}`
              : ""}
          </p>
        )}
        {rate && scope !== "ALL" && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-blue-100/80">
            <RefreshCw className="h-3 w-3" />
            참고 환율 1 CAD ={" "}
            {rate.cad_krw.toLocaleString("ko-KR", {
              maximumFractionDigits: 2,
            })}{" "}
            KRW
          </p>
        )}
      </section>

      {flow && (
        <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <MetricCard
            label="지출"
            value={formatAmount(flow.expense, flow.currency)}
          />
          <MetricCard
            label="소득"
            value={formatAmount(flow.income, flow.currency)}
          />
          <MetricCard
            label="투자/저축"
            value={formatAmount(flow.investmentSavings, flow.currency)}
          />
        </section>
      )}

      {liabilityAccounts.length > 0 && (
        <section className="card-inset p-4">
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">
            카드값
          </p>
          <ul className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
            {liabilityAccounts.map((acc) => {
              const label = acc.nickname?.trim() || acc.name;
              return (
                <li
                  key={acc.account_id}
                  className="rounded-xl bg-gray-50 dark:bg-gray-900/50 px-3 py-3"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <KindIcon kind={acc.kind} />
                    <p className="text-sm font-medium truncate">
                      {scope === "ALL" &&
                        (acc.currency === "CAD" ? "🇨🇦 " : "🇰🇷 ")}
                      {label}
                    </p>
                  </div>
                  <p className="mt-1.5 text-base font-bold tabular-nums text-red-500 truncate">
                    {formatAmount(acc.balance, acc.currency)}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {assetAccounts.length > 0 && (
        <AccountGroup
          title="통장 / 자산"
          accounts={assetAccounts}
          scope={scope}
        />
      )}

      {scope === "ALL" && (
        <div className="grid grid-cols-2 gap-3">
          {cadStats && (
            <LedgerStatsCard
              title="캐나다 가계부"
              currency="CAD"
              stats={cadStats}
            />
          )}
          {krwStats && (
            <LedgerStatsCard
              title="한국 가계부"
              currency="KRW"
              stats={krwStats}
            />
          )}
        </div>
      )}
    </div>
  );
}

function AccountGroup({
  title,
  accounts,
  scope,
}: {
  title: string;
  accounts: AccountBalance[];
  scope: LedgerScope;
}) {
  return (
    <div className="card-inset overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
        <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">
          {title}
        </p>
      </div>
      <ul className="divide-y divide-gray-100 dark:divide-gray-700">
        {accounts.map((acc) => {
          const label = acc.nickname?.trim() || acc.name;
          const showFlag = scope === "ALL";
          return (
            <li
              key={acc.account_id}
              className="flex items-center gap-3 px-4 py-3"
            >
              <KindIcon kind={acc.kind} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">
                  {showFlag && (acc.currency === "CAD" ? "🇨🇦 " : "🇰🇷 ")}
                  {label}
                </p>
                <p className="text-[11px] text-gray-400 truncate">
                  {ACCOUNT_KIND_LABEL[acc.kind]}
                </p>
              </div>
              <p className="text-sm font-semibold tabular-nums whitespace-nowrap text-gray-900 dark:text-white">
                {formatAmount(acc.balance, acc.currency)}
              </p>
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
}: {
  title: string;
  currency: Currency;
  stats: StatsSummary;
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
          <span className="text-gray-400">소득</span>
          <span className="text-blue-500">
            +{formatAmount(stats.total_income, currency)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">지출</span>
          <span className="text-gray-600 dark:text-gray-300">
            -{formatAmount(stats.adjusted_expense, currency)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">투자/저축</span>
          <span className="text-gray-600 dark:text-gray-300">
            {formatAmount(stats.investment_savings_total, currency)}
          </span>
        </div>
      </div>
    </div>
  );
}
