"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { categoryIcon } from "@/components/CategoryIcon";
import {
  AccountType,
  Currency,
  ExchangeRate,
  LedgerScope,
  StatsSummary,
  fetchStatsSummary,
  fetchUserSettings,
  formatAmount,
  setCategoryColor,
} from "@/lib/api";
import { translateCategory } from "@/lib/category-i18n";
import { addMonths, monthKey } from "@/lib/date";

const WEB_PRESET_COLORS = [
  "#000000", // Black
  "#808080", // Gray
  "#C0C0C0", // Silver
  "#FFFFFF", // White
  "#FF0000", // Red
  "#800000", // Maroon
  "#FFFF00", // Yellow
  "#808000", // Olive
  "#00FF00", // Lime
  "#008000", // Green
  "#00FFFF", // Aqua / Cyan
  "#008080", // Teal
  "#0000FF", // Blue
  "#000080", // Navy
  "#FF00FF", // Fuchsia / Magenta
  "#800080", // Purple
];

const CATEGORY_DEFAULT_COLORS: Record<string, string> = {
  "식비": "#0000FF",       // Blue
  "주거/통신": "#808000",  // Olive
  "교통/차량": "#008080",  // Teal
  "생활/쇼핑": "#00FFFF",  // Aqua / Cyan
  "건강/의료": "#FF0000",  // Red
  "문화/취미": "#800080",  // Purple
  "경조사/선물": "#800000", // Maroon
  "투자/저축": "#008000",  // Green
  "세금": "#808080",       // Gray
  "이체": "#C0C0C0",       // Silver
};

/** Show icon inside pie slice only when the slice is large enough. */
const PIE_ICON_MIN_PERCENT = 12;

type PeriodRange = 1 | 3 | 6 | 12;

interface TrendPoint {
  month: string;
  label: string;
  income: number;
  expense: number;
}

interface CategorySlice {
  category: string;
  name: string;
  amount: number;
  percent: number;
  color: string;
}

interface Props {
  month: Date;
  version: number;
  scope: LedgerScope;
  accountType: AccountType;
  displayCurrency: Currency;
  rate: ExchangeRate | null;
  cadStats: StatsSummary | null;
  krwStats: StatsSummary | null;
}

function convertAmount(
  amount: number,
  from: Currency,
  to: Currency,
  rate: ExchangeRate | null
): number {
  if (from === to) return amount;
  if (!rate) return 0;
  return from === "CAD" ? amount * rate.cad_krw : amount * rate.krw_cad;
}

/** Stable default color from category name (does not shift when list order changes). */
export function defaultCategoryColor(category: string): string {
  if (CATEGORY_DEFAULT_COLORS[category]) {
    return CATEGORY_DEFAULT_COLORS[category];
  }
  let hash = 0;
  for (let i = 0; i < category.length; i += 1) {
    hash = category.charCodeAt(i) + ((hash << 5) - hash);
  }
  return WEB_PRESET_COLORS[Math.abs(hash) % WEB_PRESET_COLORS.length];
}

export function isLightColor(hex: string): boolean {
  const color = hex.replace("#", "");
  if (color.length !== 6 && color.length !== 3) return false;
  const r = parseInt(color.length === 3 ? color[0] + color[0] : color.substring(0, 2), 16);
  const g = parseInt(color.length === 3 ? color[1] + color[1] : color.substring(2, 4), 16);
  const b = parseInt(color.length === 3 ? color[2] + color[2] : color.substring(4, 6), 16);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness > 150;
}

function resolveColor(
  category: string,
  custom: Record<string, string>
): string {
  return custom[category] || defaultCategoryColor(category);
}

function mergeExpenseMaps(
  maps: Map<string, number>[]
): Map<string, number> {
  const out = new Map<string, number>();
  for (const map of maps) {
    for (const [k, v] of map) {
      out.set(k, (out.get(k) ?? 0) + v);
    }
  }
  return out;
}

function statsToExpenseMap(
  stats: StatsSummary | null,
  currency: Currency,
  display: Currency,
  rate: ExchangeRate | null
): Map<string, number> {
  const map = new Map<string, number>();
  if (!stats) return map;
  for (const row of stats.expense_breakdown_by_category ?? []) {
    if (row.amount <= 0) continue;
    const converted = convertAmount(row.amount, currency, display, rate);
    map.set(row.category, (map.get(row.category) ?? 0) + converted);
  }
  return map;
}

function toSlices(
  map: Map<string, number>,
  translate: (category: string) => string,
  colors: Record<string, string>
): CategorySlice[] {
  const total = [...map.values()].reduce((s, v) => s + v, 0);
  if (total <= 0) return [];
  return [...map.entries()]
    .map(([category, amount]) => ({
      category,
      name: translate(category),
      amount,
      percent: (amount / total) * 100,
      color: resolveColor(category, colors),
    }))
    .sort((a, b) => b.amount - a.amount);
}

function shortMonthLabel(monthStr: string, locale: string): string {
  const [y, m] = monthStr.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  return new Intl.DateTimeFormat(locale, { month: "short" }).format(d);
}

function periodLabelKey(range: PeriodRange): "periodMonth" | "periodQuarter" | "periodHalf" | "periodYear" {
  if (range === 1) return "periodMonth";
  if (range === 3) return "periodQuarter";
  if (range === 6) return "periodHalf";
  return "periodYear";
}

function PieSliceIcon({
  cx,
  cy,
  midAngle,
  innerRadius,
  outerRadius,
  percent,
  category,
  color,
}: {
  cx: number;
  cy: number;
  midAngle: number;
  innerRadius: number;
  outerRadius: number;
  percent: number;
  category: string;
  color: string;
}) {
  if (percent * 100 < PIE_ICON_MIN_PERCENT) return null;
  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  const Icon = categoryIcon(category);
  const isLight = isLightColor(color);
  return (
    <g transform={`translate(${x - 8},${y - 8})`}>
      <foreignObject width={16} height={16}>
        <div className={`flex h-4 w-4 items-center justify-center ${isLight ? "text-gray-950" : "text-white"}`}>
          <Icon className="h-3.5 w-3.5" strokeWidth={2.25} />
        </div>
      </foreignObject>
    </g>
  );
}

export default function DashboardAnalytics({
  month,
  version,
  scope,
  accountType,
  displayCurrency,
  rate,
  cadStats,
  krwStats,
}: Props) {
  const locale = useLocale();
  const t = useTranslations("dashboard");
  const tCategories = useTranslations("categories");

  const [expenseRange, setExpenseRange] = useState<PeriodRange>(1);
  const [trendRange, setTrendRange] = useState<PeriodRange>(6);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [trendLoading, setTrendLoading] = useState(true);
  const [expenseSlices, setExpenseSlices] = useState<CategorySlice[]>([]);
  const [expenseLoading, setExpenseLoading] = useState(false);
  const [categoryColors, setCategoryColors] = useState<Record<string, string>>(
    {}
  );
  const [activeColorPicker, setActiveColorPicker] = useState<string | null>(null);

  const translate = (cat: string) => translateCategory(cat, tCategories);

  // Current-month slices from props (fast path for "이번 달").
  const monthSlices = useMemo(() => {
    const maps: Map<string, number>[] = [];
    if (scope === "CAD" || scope === "ALL") {
      maps.push(statsToExpenseMap(cadStats, "CAD", displayCurrency, rate));
    }
    if (scope === "KRW" || scope === "ALL") {
      maps.push(statsToExpenseMap(krwStats, "KRW", displayCurrency, rate));
    }
    return toSlices(mergeExpenseMaps(maps), translate, categoryColors);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cadStats, krwStats, scope, displayCurrency, rate, categoryColors, tCategories]);

  const displaySlices = expenseRange === 1 ? monthSlices : expenseSlices;
  const pieData = useMemo(() => displaySlices.slice(0, 8), [displaySlices]);

  useEffect(() => {
    fetchUserSettings()
      .then((s) => setCategoryColors(s.category_colors ?? {}))
      .catch(() => setCategoryColors({}));
  }, [version]);

  // Multi-month expense breakdown for quarter / half / year.
  useEffect(() => {
    if (expenseRange === 1) {
      setExpenseSlices([]);
      setExpenseLoading(false);
      return;
    }

    let active = true;
    setExpenseLoading(true);

    const months: string[] = [];
    for (let i = expenseRange - 1; i >= 0; i -= 1) {
      months.push(monthKey(addMonths(month, -i)));
    }

    async function loadMonthMaps(monthStr: string): Promise<Map<string, number>[]> {
      const maps: Map<string, number>[] = [];
      if (scope === "CAD" || scope === "ALL") {
        const cad = await fetchStatsSummary({
          currency: "CAD",
          month: monthStr,
          accountType,
        }).catch(() => null);
        maps.push(statsToExpenseMap(cad, "CAD", displayCurrency, rate));
      }
      if (scope === "KRW" || scope === "ALL") {
        const krw = await fetchStatsSummary({
          currency: "KRW",
          month: monthStr,
          accountType,
        }).catch(() => null);
        maps.push(statsToExpenseMap(krw, "KRW", displayCurrency, rate));
      }
      return maps;
    }

    Promise.all(months.map(loadMonthMaps))
      .then((nested) => {
        if (!active) return;
        const flat = nested.flat();
        setExpenseSlices(
          toSlices(mergeExpenseMaps(flat), translate, categoryColors)
        );
      })
      .catch(() => {
        if (active) setExpenseSlices([]);
      })
      .finally(() => {
        if (active) setExpenseLoading(false);
      });

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    expenseRange,
    month,
    version,
    scope,
    accountType,
    displayCurrency,
    rate,
    categoryColors,
  ]);

  useEffect(() => {
    let active = true;
    setTrendLoading(true);

    const months: string[] = [];
    for (let i = trendRange - 1; i >= 0; i -= 1) {
      months.push(monthKey(addMonths(month, -i)));
    }

    async function loadMonth(monthStr: string): Promise<TrendPoint> {
      const jobs: Promise<StatsSummary | null>[] = [];
      if (scope === "CAD" || scope === "ALL") {
        jobs.push(
          fetchStatsSummary({
            currency: "CAD",
            month: monthStr,
            accountType,
          }).catch(() => null)
        );
      } else {
        jobs.push(Promise.resolve(null));
      }
      if (scope === "KRW" || scope === "ALL") {
        jobs.push(
          fetchStatsSummary({
            currency: "KRW",
            month: monthStr,
            accountType,
          }).catch(() => null)
        );
      } else {
        jobs.push(Promise.resolve(null));
      }

      const [cad, krw] = await Promise.all(jobs);
      let income = 0;
      let expense = 0;
      if (cad) {
        income += convertAmount(cad.total_income, "CAD", displayCurrency, rate);
        expense += convertAmount(
          cad.adjusted_expense,
          "CAD",
          displayCurrency,
          rate
        );
      }
      if (krw) {
        income += convertAmount(krw.total_income, "KRW", displayCurrency, rate);
        expense += convertAmount(
          krw.adjusted_expense,
          "KRW",
          displayCurrency,
          rate
        );
      }
      return {
        month: monthStr,
        label: shortMonthLabel(monthStr, locale),
        income,
        expense,
      };
    }

    Promise.all(months.map(loadMonth))
      .then((rows) => {
        if (active) setTrend(rows);
      })
      .catch(() => {
        if (active) setTrend([]);
      })
      .finally(() => {
        if (active) setTrendLoading(false);
      });

    return () => {
      active = false;
    };
  }, [month, version, scope, accountType, displayCurrency, rate, trendRange, locale]);

  async function handleColorChange(category: string, color: string) {
    setCategoryColors((prev) => ({ ...prev, [category]: color }));
    try {
      const updated = await setCategoryColor(category, color);
      setCategoryColors(updated.category_colors ?? {});
    } catch {
      // Keep optimistic color; user can retry.
    }
  }

  const expensePeriods: PeriodRange[] = [1, 3, 6, 12];
  const trendPeriods: PeriodRange[] = [3, 6, 12];

  return (
    <div className="space-y-4">
      <section className="card-inset p-4 sm:p-5">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
            {t("expenseRatio")}
          </h2>
          <div className="flex rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5">
            {expensePeriods.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setExpenseRange(r)}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                  expenseRange === r
                    ? "bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-white"
                    : "text-gray-500"
                }`}
              >
                {t(periodLabelKey(r))}
              </button>
            ))}
          </div>
        </div>

        {expenseLoading ? (
          <div className="mt-4 h-48 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
        ) : pieData.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
            {t("noExpenseData")}
          </p>
        ) : (
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="amount"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={48}
                    outerRadius={78}
                    paddingAngle={2}
                    stroke="none"
                    labelLine={false}
                    label={(props: {
                      cx: number;
                      cy: number;
                      midAngle: number;
                      innerRadius: number;
                      outerRadius: number;
                      percent: number;
                      category?: string;
                      payload?: CategorySlice;
                    }) => (
                      <PieSliceIcon
                        cx={props.cx}
                        cy={props.cy}
                        midAngle={props.midAngle}
                        innerRadius={props.innerRadius}
                        outerRadius={props.outerRadius}
                        percent={props.percent}
                        category={
                          props.category ?? props.payload?.category ?? ""
                        }
                        color={
                          props.payload?.color ?? "#ffffff"
                        }
                      />
                    )}
                  >
                    {pieData.map((entry) => (
                      <Cell key={entry.category} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number) =>
                      formatAmount(value, displayCurrency)
                    }
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="space-y-2.5 max-h-56 overflow-y-auto">
              {displaySlices.map((row) => {
                const Icon = categoryIcon(row.category);
                return (
                  <li
                    key={row.category}
                    className="flex items-center justify-between gap-3 min-w-0"
                  >
                    <div className="flex items-center gap-2 min-w-0 relative">
                      <button
                        type="button"
                        onClick={() =>
                          setActiveColorPicker(
                            activeColorPicker === row.category ? null : row.category
                          )
                        }
                        className="relative h-5 w-5 shrink-0 rounded-full ring-1 ring-black/10 dark:ring-white/20 flex items-center justify-center transition-transform hover:scale-105 active:scale-95"
                        style={{ backgroundColor: row.color }}
                        title={t("pickColor")}
                      >
                        <Icon
                          className={`h-3 w-3 drop-shadow ${
                            isLightColor(row.color) ? "text-gray-950" : "text-white"
                          }`}
                        />
                      </button>

                      {activeColorPicker === row.category && (
                        <>
                          {/* Fullscreen transparent click-outside handler */}
                          <div
                            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm cursor-default"
                            onClick={() => setActiveColorPicker(null)}
                          />
                          {/* 16-color preset modal popover (fixed and centered to prevent clipping) */}
                          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                            <div className="w-56 rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 shadow-2xl">
                              <div className="flex items-center justify-between mb-3">
                                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                                  {row.name} {t("pickColor")}
                                </p>
                                <button
                                  type="button"
                                  onClick={() => setActiveColorPicker(null)}
                                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xs font-bold"
                                >
                                  ✕
                                </button>
                              </div>
                              <div className="grid grid-cols-4 gap-2">
                                {WEB_PRESET_COLORS.map((color) => (
                                  <button
                                    key={color}
                                    type="button"
                                    onClick={() => {
                                      handleColorChange(row.category, color);
                                      setActiveColorPicker(null);
                                    }}
                                    className={`h-9 w-9 rounded-full border border-black/10 dark:border-white/10 transition-all hover:scale-110 active:scale-90 ${
                                      row.color.toLowerCase() === color.toLowerCase()
                                        ? "ring-2 ring-blue-500 ring-offset-2 dark:ring-offset-gray-950 scale-105"
                                        : ""
                                    }`}
                                    style={{ backgroundColor: color }}
                                    aria-label={color}
                                  />
                                ))}
                              </div>
                            </div>
                          </div>
                        </>
                      )}

                      <span className="truncate text-sm text-gray-700 dark:text-gray-200">
                        {row.name}
                      </span>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-medium tabular-nums text-gray-900 dark:text-white">
                        {formatAmount(row.amount, displayCurrency)}
                      </p>
                      <p className="text-xs tabular-nums text-gray-400">
                        {row.percent.toFixed(0)}%
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>

      <section className="card-inset p-4 sm:p-5">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
            {t("trendTitle")}
          </h2>
          <div className="flex rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5">
            {trendPeriods.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setTrendRange(r)}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                  trendRange === r
                    ? "bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-white"
                    : "text-gray-500"
                }`}
              >
                {t(periodLabelKey(r))}
              </button>
            ))}
          </div>
        </div>
        {trendLoading ? (
          <div className="mt-4 h-48 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
        ) : trend.every((p) => p.income === 0 && p.expense === 0) ? (
          <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
            {t("noTrendData")}
          </p>
        ) : (
          <div className="mt-4 h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trend} barGap={4}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  className="stroke-gray-200 dark:stroke-gray-700"
                  vertical={false}
                />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 12 }}
                  className="fill-gray-500"
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  width={48}
                  tickFormatter={(v: number) =>
                    v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)
                  }
                />
                <Tooltip
                  formatter={(value: number, name: string) => [
                    formatAmount(value, displayCurrency),
                    name === "income" ? t("income") : t("expense"),
                  ]}
                />
                <Legend
                  formatter={(value) =>
                    value === "income" ? t("income") : t("expense")
                  }
                />
                <Bar
                  dataKey="income"
                  fill="#22C55E"
                  radius={[6, 6, 0, 0]}
                  maxBarSize={28}
                />
                <Bar
                  dataKey="expense"
                  fill="#3B82F6"
                  radius={[6, 6, 0, 0]}
                  maxBarSize={28}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>
    </div>
  );
}
