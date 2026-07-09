"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  Currency,
  ExchangeRate,
  StatsSummary,
  fetchExchangeRate,
  fetchStatsSummary,
  formatAmount,
} from "@/lib/api";
import { monthKey, monthLabel } from "@/lib/date";

interface Props {
  month: Date;
  version: number;
}

export default function DashboardView({ month, version }: Props) {
  const [cadStats, setCadStats] = useState<StatsSummary | null>(null);
  const [krwStats, setKrwStats] = useState<StatsSummary | null>(null);
  const [rate, setRate] = useState<ExchangeRate | null>(null);
  const [display, setDisplay] = useState<Currency>("CAD");
  const [loading, setLoading] = useState(true);

  const monthStr = monthKey(month);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchStatsSummary({ currency: "CAD", month: monthStr }),
      fetchStatsSummary({ currency: "KRW", month: monthStr }),
      fetchExchangeRate().catch(() => null),
    ])
      .then(([cad, krw, r]) => {
        setCadStats(cad);
        setKrwStats(krw);
        setRate(r);
      })
      .catch(() => {
        setCadStats(null);
        setKrwStats(null);
      })
      .finally(() => setLoading(false));
  }, [monthStr, version]);

  const combined = useMemo(() => {
    if (!cadStats || !krwStats || !rate) return null;

    function convert(amount: number, from: Currency, to: Currency) {
      if (from === to) return amount;
      return from === "CAD" ? amount * rate!.cad_krw : amount * rate!.krw_cad;
    }

    const toDisplay = (cadVal: number, krwVal: number) =>
      display === "CAD"
        ? cadVal + convert(krwVal, "KRW", "CAD")
        : krwVal + convert(cadVal, "CAD", "KRW");

    return {
      netCashflow: toDisplay(cadStats.net_cashflow, krwStats.net_cashflow),
      pureConsumption: toDisplay(
        cadStats.pure_consumption,
        krwStats.pure_consumption
      ),
      adjustedExpense: toDisplay(
        cadStats.adjusted_expense,
        krwStats.adjusted_expense
      ),
      settlementRefund: toDisplay(
        cadStats.settlement_refund_total,
        krwStats.settlement_refund_total
      ),
      investmentSavings: toDisplay(
        cadStats.investment_savings_total,
        krwStats.investment_savings_total
      ),
    };
  }, [cadStats, krwStats, rate, display]);

  if (loading) {
    return (
      <div className="h-40 w-full animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 p-6 text-white shadow-sm">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-blue-100">
            {monthLabel(month)} 합산 순흐름
          </p>
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
        </div>
        <p className="mt-2 text-3xl font-bold tracking-tight">
          {combined ? formatAmount(combined.netCashflow, display) : "—"}
        </p>
        {rate && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-blue-100">
            <RefreshCw className="h-3 w-3" />
            1 CAD ={" "}
            {rate.cad_krw.toLocaleString("ko-KR", {
              maximumFractionDigits: 1,
            })}{" "}
            KRW · {rate.date ?? "-"} 기준
            {rate.stale && " (캐시)"}
          </p>
        )}
      </section>

      {combined && (
        <section className="grid grid-cols-2 gap-3">
          <MetricCard
            label="순수 소비"
            hint="투자/저축 제외"
            value={formatAmount(combined.pureConsumption, display)}
          />
          <MetricCard
            label="실제 지출"
            hint="N빵 정산 차감"
            value={formatAmount(combined.adjustedExpense, display)}
          />
          <MetricCard
            label="N빵 환급"
            hint="정산 수입"
            value={formatAmount(combined.settlementRefund, display)}
          />
          <MetricCard
            label="투자/저축"
            hint="계좌 이동"
            value={formatAmount(combined.investmentSavings, display)}
          />
        </section>
      )}

      <div className="grid grid-cols-2 gap-3">
        {cadStats && (
          <LedgerStatsCard
            title="캐나다 가계부"
            currency="CAD"
            stats={cadStats}
          />
        )}
        {krwStats && (
          <LedgerStatsCard title="한국 가계부" currency="KRW" stats={krwStats} />
        )}
      </div>
    </div>
  );
}

function MetricCard({
  label,
  hint,
  value,
}: {
  label: string;
  hint: string;
  value: string;
}) {
  return (
    <div className="card-inset p-4">
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className="text-[10px] text-gray-400 dark:text-gray-500">{hint}</p>
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
          <span className="text-gray-400">수입</span>
          <span className="text-blue-500">
            +{formatAmount(stats.total_income, currency)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">지출</span>
          <span className="text-gray-600 dark:text-gray-300">
            -{formatAmount(stats.total_expense, currency)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">순소비</span>
          <span className="text-gray-600 dark:text-gray-300">
            {formatAmount(stats.pure_consumption, currency)}
          </span>
        </div>
      </div>
    </div>
  );
}
