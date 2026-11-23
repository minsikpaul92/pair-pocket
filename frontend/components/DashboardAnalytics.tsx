"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { categoryIcon } from "@/components/CategoryIcon";
import InfoTip from "@/components/InfoTip";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

import {
  AccountType,
  Currency,
  ExchangeRate,
  LedgerScope,
  StatsSummary,
  Transaction,
  effectiveExpenseAmount,
  hiddenSubKey,
  fetchStatsSummary,
  fetchTransactions,
  fetchUserSettings,
  formatAmount,
  setCategoryColor,
} from "@/lib/api";
import { useEscapeKey } from "@/lib/useEscapeKey";
import { translateCategory, translateSubCategory } from "@/lib/category-i18n";
import { realMerchant } from "@/lib/merchant";
import { addDays, addMonths, dayKey, monthKey, weekStart } from "@/lib/date";
import { trendBuckets } from "@/lib/trend-buckets";

/**
 * Category colors are mid-tone system hues: each one is at least 3:1 against
 * white cards and the gray-800/900 dark cards, so a slice never fades into
 * either theme. Users pick custom colors from this same set.
 */
const CATEGORY_PRESET_COLORS = [
  "#DC2626", // Red
  "#E11D48", // Rose
  "#EA580C", // Orange
  "#D97706", // Amber
  "#65A30D", // Lime
  "#16A34A", // Green
  "#059669", // Emerald
  "#0D9488", // Teal
  "#0891B2", // Cyan
  "#0284C7", // Sky
  "#3B82F6", // Blue
  "#6366F1", // Indigo
  "#8B5CF6", // Violet
  "#C026D3", // Fuchsia
  "#EC4899", // Pink
  "#64748B", // Slate
];

/** Group key for expenses with no sub-category; shown as t("uncategorized"). */
const NO_SUB_CATEGORY = "";

// Listed in an order where every neighbor (and last to first) stays easy to
// tell apart, including for red-green color blindness.
const CATEGORY_DEFAULT_COLORS: Record<string, string> = {
  "세금": "#6366F1",       // Indigo
  "경조사/선물": "#EA580C", // Orange
  "교통/차량": "#0891B2",  // Cyan
  "식비": "#D97706",       // Amber
  "이체": "#64748B",       // Slate
  "건강/의료": "#DC2626",  // Red
  "금융/수수료": "#0D9488", // Teal
  "문화/취미": "#8B5CF6",  // Violet
  "투자/저축": "#16A34A",  // Green
  "주거/통신": "#3B82F6",  // Blue
  "교육": "#65A30D",       // Lime
  "생활/쇼핑": "#EC4899",  // Pink
};

/** Show icon inside pie slice only when the slice is large enough. */
const PIE_ICON_MIN_PERCENT = 12;

type PeriodRange = 1 | 3 | 6 | 12;
type ExpenseRange = "week" | PeriodRange;

interface TrendPoint {
  month: string;
  label: string;
  income: number;
  expense: number;
}

interface FlowPoint {
  label: string;
  fullLabel: string;
  start: string;
  end: string;
  income: number;
  expense: number;
  /** Expense by category, counted like the donut (hidden categories left out). */
  categories: Map<string, number>;
}

interface CategorySlice {
  category: string;
  name: string;
  amount: number;
  percent: number;
  color: string;
}

/** Recharts tooltip that matches card-inset (light + dark). */
function ChartTooltipBox({
  active,
  label,
  rows,
}: {
  active?: boolean;
  label?: string;
  rows: { name: string; value: string; color?: string }[];
}) {
  if (!active || rows.length === 0) return null;
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 shadow-lg min-w-[9rem]">
      {label ? (
        <p className="mb-1.5 text-xs font-semibold text-gray-900 dark:text-white">
          {label}
        </p>
      ) : null}
      <ul className="space-y-1">
        {rows.map((row) => (
          <li
            key={row.name}
            className="flex items-center justify-between gap-3 text-xs text-gray-700 dark:text-gray-200"
          >
            <span className="flex items-center gap-1.5 min-w-0">
              {row.color ? (
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: row.color }}
                />
              ) : null}
              <span className="truncate">{row.name}</span>
            </span>
            <span className="shrink-0 tabular-nums font-medium text-gray-900 dark:text-white">
              {row.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PieExpenseTooltip({
  active,
  payload,
  totalExpense,
  displayCurrency,
  monthTransactions,
  tCategories,
}: {
  active?: boolean;
  payload?: Array<{ payload?: CategorySlice; color?: string }>;
  totalExpense: number;
  displayCurrency: Currency;
  monthTransactions?: Transaction[];
  tCategories?: any;
}) {
  const t = useTranslations("dashboard");
  if (!active || !payload?.length) return null;
  const slice = payload[0]?.payload;
  if (!slice) return null;

  const percentText = slice.percent.toFixed(1);
  const swatch =
    typeof payload[0]?.color === "string" ? payload[0].color : slice.color;

  const topItems = (() => {
    if (!monthTransactions?.length) return [];
    const map: Record<string, number> = {};
    let catSum = 0;
    monthTransactions.forEach((tx) => {
      if (tx.type !== "expense") return;
      const isMatch =
        tx.category === slice.category ||
        (tCategories &&
          translateCategory(tx.category, tCategories) === slice.name);
      if (isMatch) {
        const name = realMerchant(tx.merchant) || tx.sub_category?.trim() || t("otherSpending");
        const amt = effectiveExpenseAmount(tx);
        map[name] = (map[name] || 0) + amt;
        catSum += amt;
      }
    });

    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([name, amt]) => ({
        name,
        amount: amt,
        percent: catSum > 0 ? Math.round((amt / catSum) * 100) : 0,
      }));
  })();

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-700/80 bg-white/95 dark:bg-gray-900/95 backdrop-blur-md p-3.5 shadow-2xl min-w-[13.5rem] transition-all">
      <div className="flex items-center justify-between gap-3 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="h-3 w-3 shrink-0 rounded-full ring-2 ring-white dark:ring-gray-800"
            style={{ backgroundColor: swatch }}
          />
          <p className="text-sm font-extrabold text-gray-900 dark:text-white truncate">
            {slice.name}
          </p>
        </div>
        <span className="text-xs font-black text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/80 px-2 py-0.5 rounded-full tabular-nums">
          {percentText}%
        </span>
      </div>

      <div className="mt-2.5 border-t border-gray-100 dark:border-gray-800/80 pt-2">
        <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
          {t("topSpending")}
        </p>
        {topItems.length > 0 ? (
          <div className="space-y-1">
            {topItems.map((item) => (
              <div
                key={item.name}
                className="flex items-center justify-between text-xs gap-2"
              >
                <span className="truncate font-medium text-gray-700 dark:text-gray-300 max-w-[9rem]">
                  {item.name}
                </span>
                <span className="font-bold tabular-nums text-gray-900 dark:text-white text-xs">
                  {item.percent}%
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs font-semibold tabular-nums text-gray-700 dark:text-gray-200">
            {formatAmount(slice.amount, displayCurrency)}
          </p>
        )}
      </div>

      <div className="mt-2.5 flex items-center justify-between border-t border-gray-100 dark:border-gray-800/80 pt-1.5 text-xs">
        <span className="font-semibold text-gray-500 dark:text-gray-400 tabular-nums">
          {formatAmount(slice.amount, displayCurrency)}
        </span>
        <span className="text-xs font-black tracking-widest text-indigo-500 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/80 px-1.5 py-0.5 rounded uppercase">
          CLICK
        </span>
      </div>
    </div>
  );
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
  transactions?: Transaction[];
  /** Expense categories left out of the charts. */
  excludeCategories?: string[];
  /** Render only one chart; both when omitted. */
  part?: "expense" | "trend";
  onCategoryClick?: (
    category: string,
    subCategory?: string,
    fromExpenseChart?: boolean
  ) => void;
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
  return CATEGORY_PRESET_COLORS[Math.abs(hash) % CATEGORY_PRESET_COLORS.length];
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
  rate: ExchangeRate | null,
  hidden: ReadonlySet<string>
): Map<string, number> {
  const map = new Map<string, number>();
  if (!stats) return map;
  const add = (category: string, amount: number) => {
    if (amount <= 0) return;
    const converted = convertAmount(amount, currency, display, rate);
    map.set(category, (map.get(category) ?? 0) + converted);
  };
  const subRows = stats.expense_breakdown_by_sub_category;
  if (subRows) {
    for (const row of subRows) {
      if (
        hidden.has(row.category) ||
        hidden.has(hiddenSubKey(row.category, row.sub_category))
      ) {
        continue;
      }
      add(row.category, row.amount);
    }
    return map;
  }
  for (const row of stats.expense_breakdown_by_category ?? []) {
    if (!hidden.has(row.category)) add(row.category, row.amount);
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

function periodLabelKey(
  range: ExpenseRange
): "periodWeek" | "periodMonth" | "periodQuarter" | "periodHalf" | "periodYear" {
  if (range === "week") return "periodWeek";
  if (range === 1) return "periodMonth";
  if (range === 3) return "periodQuarter";
  if (range === 6) return "periodHalf";
  return "periodYear";
}

/** Drawn geometry of one donut slice, captured from the label render. Angles are recharts degrees (0 = 3 o'clock, counter-clockwise). */
interface SliceGeom {
  cx: number;
  cy: number;
  innerRadius: number;
  outerRadius: number;
  startAngle: number;
  endAngle: number;
}

// Every slice gets at least this much angle to aim at, so a 0.5% slice is still easy to hit.
const PIE_HIT_MIN_HALF_ANGLE = 7;
// The ring's hit area reaches a little past the drawn ring on both sides.
const PIE_HIT_RING_PAD = 14;

/** Index of the slice under a point in the chart box, or -1. Works on the icons, the gaps and thin slices. */
export function pieSliceAt(geoms: (SliceGeom | undefined)[], x: number, y: number): number {
  let best = -1;
  let bestDist = Infinity;
  geoms.forEach((g, i) => {
    if (!g) return;
    const dx = x - g.cx;
    const dy = g.cy - y;
    const r = Math.hypot(dx, dy);
    if (r < g.innerRadius - PIE_HIT_RING_PAD || r > g.outerRadius + PIE_HIT_RING_PAD) return;
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    const mid = (g.startAngle + g.endAngle) / 2;
    const half = Math.max(Math.abs(g.endAngle - g.startAngle) / 2, PIE_HIT_MIN_HALF_ANGLE);
    const dist = Math.abs((((angle - mid) % 360) + 540) % 360 - 180);
    // Nearest slice centre wins, so a thin slice beats the edge of its big neighbour.
    if (dist <= half && dist < bestDist) {
      best = i;
      bestDist = dist;
    }
  });
  return best;
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
    <g transform={`translate(${x - 8},${y - 8})`} pointerEvents="none">
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
  transactions,
  excludeCategories,
  part,
  onCategoryClick,
}: Props) {
  const excludeKey = (excludeCategories ?? []).join("|");
  const showExpense = !part || part === "expense";
  const showTrend = !part || part === "trend";
  const locale = useLocale();
  const t = useTranslations("dashboard");
  const tCategories = useTranslations("categories");
  const tSubCategories = useTranslations("subCategories");
  const tCommon = useTranslations("common");

  const [expenseRange, setExpenseRange] = useState<ExpenseRange>(1);
  const [selectedWeekStart, setSelectedWeekStart] = useState<Date>(() =>
    weekStart(new Date())
  );
  const [weekTransactions, setWeekTransactions] = useState<Transaction[]>([]);
  const [trendRange, setTrendRange] = useState<PeriodRange>(6);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [trendLoading, setTrendLoading] = useState(true);
  const [expenseSlices, setExpenseSlices] = useState<CategorySlice[]>([]);
  const [expenseLoading, setExpenseLoading] = useState(false);
  const [flow, setFlow] = useState<FlowPoint[]>([]);
  const [flowLoading, setFlowLoading] = useState(true);
  const [chartView, setChartView] = useState<"donut" | "line">("donut");
  const [flowSeries, setFlowSeries] = useState<"expense" | "income">("expense");
  const [flowSelected, setFlowSelected] = useState<number | null>(null);
  // Transactions of the tapped line point; they feed the row hover card and the sub-category popover.
  const [pointTxs, setPointTxs] = useState<Transaction[] | null>(null);
  const [categoryColors, setCategoryColors] = useState<Record<string, string>>(
    {}
  );
  const [hiddenCategories, setHiddenCategories] = useState<Set<string>>(
    () => new Set()
  );
  const [activeColorPicker, setActiveColorPicker] = useState<string | null>(null);
  const [popoverCategory, setPopoverCategory] = useState<string | null>(null);
  const pieGeoms = useRef<(SliceGeom | undefined)[]>([]);
  const pieBoxRef = useRef<HTMLDivElement>(null);
  const [pieHover, setPieHover] = useState<{ index: number; x: number; y: number } | null>(null);
  useEscapeKey(() => setPopoverCategory(null), popoverCategory !== null);

  const isWeek = expenseRange === "week";
  const weekStartKey = dayKey(selectedWeekStart);
  const weekEndKey = dayKey(addDays(selectedWeekStart, 6));
  const isCurrentWeek = weekStartKey === dayKey(weekStart(new Date()));
  // Tooltip / sub-category popover read the shown period, minus hidden entries.
  const periodTransactions = useMemo(
    () =>
      (isWeek ? weekTransactions : transactions ?? []).filter(
        (tx) =>
          !hiddenCategories.has(tx.category) &&
          !hiddenCategories.has(hiddenSubKey(tx.category, tx.sub_category))
      ),
    [isWeek, weekTransactions, transactions, hiddenCategories]
  );

  const flowPoint = flowSelected !== null ? flow[flowSelected] : undefined;
  const flowPointTxs = useMemo(
    () =>
      (pointTxs ?? []).filter(
        (tx) =>
          !hiddenCategories.has(tx.category) &&
          !hiddenCategories.has(hiddenSubKey(tx.category, tx.sub_category))
      ),
    [pointTxs, hiddenCategories]
  );
  const popoverSourceTxs =
    chartView === "line" ? flowPointTxs : periodTransactions;

  const subCategoryGroupMap = useMemo(() => {
    if (!popoverCategory) return [];
    const catTxs = (popoverSourceTxs || []).filter(
      (tx) => tx.category === popoverCategory && tx.type === "expense"
    );
    const map = new Map<string, { total: number; txs: Transaction[] }>();
    for (const tx of catTxs) {
      const sub = tx.sub_category || NO_SUB_CATEGORY;
      const existing = map.get(sub) || { total: 0, txs: [] };
      existing.total += effectiveExpenseAmount(tx);
      existing.txs.push(tx);
      map.set(sub, existing);
    }
    return Array.from(map.entries()).map(([sub, data]) => ({
      subCategory: sub,
      total: data.total,
      txs: data.txs,
    }));
  }, [popoverCategory, popoverSourceTxs]);

  const translate = (cat: string) => translateCategory(cat, tCategories);

  // Current-month slices from props (fast path for "이번 달").
  const monthSlices = useMemo(() => {
    const maps: Map<string, number>[] = [];
    if (scope === "CAD" || scope === "ALL") {
      maps.push(
        statsToExpenseMap(cadStats, "CAD", displayCurrency, rate, hiddenCategories)
      );
    }
    if (scope === "KRW" || scope === "ALL") {
      maps.push(
        statsToExpenseMap(krwStats, "KRW", displayCurrency, rate, hiddenCategories)
      );
    }
    return toSlices(mergeExpenseMaps(maps), translate, categoryColors);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    cadStats,
    krwStats,
    scope,
    displayCurrency,
    rate,
    categoryColors,
    hiddenCategories,
    tCategories,
  ]);

  const displaySlices = expenseRange === 1 ? monthSlices : expenseSlices;
  const pieData = useMemo(() => displaySlices.slice(0, 8), [displaySlices]);
  const pieTotalExpense = useMemo(
    () => displaySlices.reduce((sum, row) => sum + row.amount, 0),
    [displaySlices]
  );

  useEffect(() => {
    fetchUserSettings()
      .then((s) => {
        setCategoryColors(s.category_colors ?? {});
        setHiddenCategories(new Set(s.expense_ratio_hidden_categories ?? []));
      })
      .catch(() => {
        setCategoryColors({});
        setHiddenCategories(new Set());
      });
  }, [version]);

  // Week (Sun–Sat, independent of month) or multi-month breakdown.
  useEffect(() => {
    if (expenseRange === 1) {
      setExpenseSlices([]);
      setExpenseLoading(false);
      return;
    }

    let active = true;
    setExpenseLoading(true);

    type Period = { month?: string; start?: string; end?: string };
    const periods: Period[] = [];
    if (expenseRange === "week") {
      periods.push({ start: weekStartKey, end: weekEndKey });
      fetchTransactions({
        accountType,
        start: weekStartKey,
        end: weekEndKey,
        currency: scope === "ALL" ? undefined : scope,
      })
        .then((rows) => {
          if (active) setWeekTransactions(rows);
        })
        .catch(() => {
          if (active) setWeekTransactions([]);
        });
    } else {
      for (let i = expenseRange - 1; i >= 0; i -= 1) {
        periods.push({ month: monthKey(addMonths(month, -i)) });
      }
    }

    async function loadPeriodMaps(period: Period): Promise<Map<string, number>[]> {
      const maps: Map<string, number>[] = [];
      if (scope === "CAD" || scope === "ALL") {
        const cad = await fetchStatsSummary({
          ...period,
          currency: "CAD",
          accountType,
          excludeCategories,
        }).catch(() => null);
        maps.push(
          statsToExpenseMap(cad, "CAD", displayCurrency, rate, hiddenCategories)
        );
      }
      if (scope === "KRW" || scope === "ALL") {
        const krw = await fetchStatsSummary({
          ...period,
          currency: "KRW",
          accountType,
          excludeCategories,
        }).catch(() => null);
        maps.push(
          statsToExpenseMap(krw, "KRW", displayCurrency, rate, hiddenCategories)
        );
      }
      return maps;
    }

    Promise.all(periods.map(loadPeriodMaps))
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
    weekStartKey,
    weekEndKey,
    month,
    version,
    scope,
    accountType,
    displayCurrency,
    rate,
    categoryColors,
    excludeKey,
    hiddenCategories,
  ]);

  useEffect(() => {
    setPointTxs(null);
    if (!flowPoint) return;
    let active = true;
    fetchTransactions({
      accountType,
      start: flowPoint.start,
      end: flowPoint.end,
      currency: scope === "ALL" ? undefined : scope,
    })
      .then((rows) => {
        if (active) setPointTxs(rows);
      })
      .catch(() => {
        if (active) setPointTxs([]);
      });
    return () => {
      active = false;
    };
  }, [flowPoint, accountType, scope]);

  // Income / expense line chart: same period as the pie, one summary per bucket.
  useEffect(() => {
    if (!showExpense || chartView !== "line") return;
    let active = true;
    setFlowLoading(true);

    const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, o);
    const dayLabel = fmt({ weekday: "short" });
    const dateLabel = fmt({ month: "short", day: "numeric" });
    const monthLabel = fmt({ month: "short" });
    const fullMonthLabel = fmt({ year: "numeric", month: "short" });
    const buckets = trendBuckets(expenseRange, month, selectedWeekStart);

    async function loadBucket(b: (typeof buckets)[number]): Promise<FlowPoint> {
      let income = 0;
      const maps: Map<string, number>[] = [];
      for (const cur of ["CAD", "KRW"] as const) {
        if (scope !== "ALL" && scope !== cur) continue;
        const stats = await fetchStatsSummary({
          start: b.start,
          end: b.end,
          currency: cur,
          accountType,
          excludeCategories,
        }).catch(() => null);
        if (!stats) continue;
        income += convertAmount(stats.total_income, cur, displayCurrency, rate);
        maps.push(statsToExpenseMap(stats, cur, displayCurrency, rate, hiddenCategories));
      }
      // Same total as the donut, so a tapped point adds up to its breakdown.
      const categories = mergeExpenseMaps(maps);
      const expense = [...categories.values()].reduce((sum, v) => sum + v, 0);
      const label =
        b.unit === "day"
          ? dayLabel.format(b.date)
          : b.unit === "week"
            ? dateLabel.format(b.date)
            : monthLabel.format(b.date);
      const fullLabel =
        b.unit === "month"
          ? fullMonthLabel.format(b.date)
          : b.unit === "week"
            ? `${dateLabel.format(b.date)} – ${dateLabel.format(new Date(b.end + "T00:00:00"))}`
            : `${dateLabel.format(b.date)} ${dayLabel.format(b.date)}`;
      return { label, fullLabel, start: b.start, end: b.end, income, expense, categories };
    }

    setFlowSelected(null);
    Promise.all(buckets.map(loadBucket))
      .then((rows) => {
        if (active) setFlow(rows);
      })
      .catch(() => {
        if (active) setFlow([]);
      })
      .finally(() => {
        if (active) setFlowLoading(false);
      });

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenseRange, weekStartKey, month, version, scope, accountType, displayCurrency, rate, locale, excludeKey, showExpense, chartView, hiddenCategories]);

  useEffect(() => {
    let active = true;
    setTrendLoading(true);

    const months: string[] = [];
    const offset = Math.floor(trendRange / 2);
    for (let i = -offset; i < trendRange - offset; i += 1) {
      months.push(monthKey(addMonths(month, i)));
    }

    async function loadMonth(monthStr: string): Promise<TrendPoint> {
      const jobs: Promise<StatsSummary | null>[] = [];
      if (scope === "CAD" || scope === "ALL") {
        jobs.push(
          fetchStatsSummary({
            currency: "CAD",
            month: monthStr,
            accountType,
            excludeCategories,
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
            excludeCategories,
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
  }, [month, version, scope, accountType, displayCurrency, rate, trendRange, locale, excludeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleColorChange(category: string, color: string) {
    setCategoryColors((prev) => ({ ...prev, [category]: color }));
    try {
      const updated = await setCategoryColor(category, color);
      setCategoryColors(updated.category_colors ?? {});
    } catch {
      // Keep optimistic color; user can retry.
    }
  }

  const expensePeriods: ExpenseRange[] = ["week", 1, 3, 6, 12];
  const weekDayFormat = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  });
  const weekRangeLabel = `${weekDayFormat.format(
    selectedWeekStart
  )} – ${weekDayFormat.format(addDays(selectedWeekStart, 6))}`;
  const trendPeriods: PeriodRange[] = [3, 6, 12];

  return (
    <div className="space-y-4">
      {showExpense && (
      <section id="expense-ratio-card" className="card-inset p-4 sm:p-5 scroll-mt-20">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="flex items-center gap-1 text-sm font-semibold text-gray-700 dark:text-gray-200">
            {t("expenseRatio")}
            <InfoTip label={t("expenseRatioInfoLabel")} icon="info">
              {t("expenseRatioInfo")}
            </InfoTip>
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
                    : "text-gray-500 dark:text-gray-400"
                }`}
              >
                {t(periodLabelKey(r))}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 flex rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5 w-fit">
          {(["donut", "line"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setChartView(v)}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                chartView === v
                  ? "bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-white"
                  : "text-gray-500 dark:text-gray-400"
              }`}
            >
              {t(v === "donut" ? "chartDonut" : "chartLine")}
            </button>
          ))}
        </div>

        {isWeek && (
          <div className="mt-3 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedWeekStart((d) => addDays(d, -7))}
              className="rounded-lg p-1.5 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
              aria-label={t("previousWeek")}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[9rem] text-center text-xs font-semibold tabular-nums text-gray-700 dark:text-gray-200 whitespace-nowrap">
              {weekRangeLabel}
              {isCurrentWeek ? ` · ${t("thisWeek")}` : ""}
            </span>
            <button
              type="button"
              onClick={() => setSelectedWeekStart((d) => addDays(d, 7))}
              disabled={isCurrentWeek}
              className="rounded-lg p-1.5 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:hover:bg-transparent"
              aria-label={t("nextWeek")}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}

        {hiddenCategories.size > 0 && (
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            {t("hiddenCategoriesNote", { count: hiddenCategories.size })}
          </p>
        )}

        {chartView === "donut" && (expenseLoading ? (
          <div className="mt-4 h-48 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
        ) : pieData.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
            {t("noExpenseData")}
          </p>
        ) : (
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
            <div
              ref={pieBoxRef}
              className="relative h-56 w-full flex items-center justify-center"
            >
              {/* Centered Total Summary (z-0 so tooltip floats on top) */}
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-0">
                <span className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  {t("expenseMixTotal")}
                </span>
                <span className="text-sm font-black text-gray-900 dark:text-white tabular-nums mt-0.5">
                  {formatAmount(pieTotalExpense, displayCurrency)}
                </span>
              </div>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="amount"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={52}
                    outerRadius={78}
                    paddingAngle={3}
                    minAngle={3}
                    cornerRadius={4}
                    stroke="none"
                    labelLine={false}
                    label={(props: {
                      index: number;
                      cx: number;
                      cy: number;
                      midAngle: number;
                      innerRadius: number;
                      outerRadius: number;
                      startAngle: number;
                      endAngle: number;
                      percent: number;
                      category?: string;
                      payload?: CategorySlice;
                    }) => {
                      pieGeoms.current[props.index] = {
                        cx: props.cx,
                        cy: props.cy,
                        innerRadius: props.innerRadius,
                        outerRadius: props.outerRadius,
                        startAngle: props.startAngle,
                        endAngle: props.endAngle,
                      };
                      return (
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
                      );
                    }}
                  >
                    {pieData.map((entry, i) => (
                      <Cell
                        key={entry.category}
                        fill={entry.color}
                        fillOpacity={pieHover && pieHover.index !== i ? 0.45 : 1}
                      />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              {/* One hit layer over the whole ring: slices, their icons and the gaps all respond the same way. */}
              <div
                className={`absolute inset-0 z-10 ${pieHover ? "cursor-pointer" : ""}`}
                data-testid="pie-hit-layer"
                onPointerMove={(e) => {
                  const box = e.currentTarget.getBoundingClientRect();
                  const x = e.clientX - box.left;
                  const y = e.clientY - box.top;
                  const index = pieSliceAt(pieGeoms.current, x, y);
                  setPieHover(index >= 0 ? { index, x, y } : null);
                }}
                onPointerLeave={() => setPieHover(null)}
                onClick={(e) => {
                  const box = e.currentTarget.getBoundingClientRect();
                  const index = pieSliceAt(
                    pieGeoms.current,
                    e.clientX - box.left,
                    e.clientY - box.top,
                  );
                  const slice = pieData[index];
                  if (slice) setPopoverCategory(slice.category);
                }}
              />
              {pieHover && pieData[pieHover.index] && (
                <div
                  className="pointer-events-none absolute z-[100] w-max max-w-[16rem]"
                  style={{
                    left: Math.min(pieHover.x + 12, Math.max(0, (pieBoxRef.current?.clientWidth ?? 0) - 220)),
                    top: pieHover.y + 12,
                  }}
                >
                  <PieExpenseTooltip
                    active
                    payload={[
                      {
                        payload: pieData[pieHover.index],
                        color: pieData[pieHover.index].color,
                      },
                    ]}
                    totalExpense={pieTotalExpense}
                    displayCurrency={displayCurrency}
                    monthTransactions={periodTransactions}
                    tCategories={tCategories}
                  />
                </div>
              )}
            </div>
            <ul className="space-y-0 max-h-56 overflow-y-auto pr-1">
              {displaySlices.map((row) => {
                const Icon = categoryIcon(row.category);
                return (
                  <li
                    key={row.category}
                    onClick={() => setPopoverCategory(row.category)}
                    className="flex items-center justify-between gap-3 min-w-0 px-1.5 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800/80 cursor-pointer transition-colors group"
                  >
                    <div className="flex items-center gap-2 min-w-0 relative">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveColorPicker(
                            activeColorPicker === row.category ? null : row.category
                          );
                        }}
                        className="relative h-5 w-5 shrink-0 rounded-full ring-1 ring-black/10 dark:ring-white/20 flex items-center justify-center transition-transform hover:scale-110 active:scale-95"
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
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveColorPicker(null);
                            }}
                          />
                          {/* 16-color preset modal popover (fixed and centered to prevent clipping) */}
                          <div
                            className="fixed inset-0 z-50 flex items-center justify-center p-4"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="w-56 rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 shadow-2xl">
                              <div className="flex items-center justify-between mb-3">
                                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                                  {row.name} {t("pickColor")}
                                </p>
                                <button
                                  type="button"
                                  onClick={() => setActiveColorPicker(null)}
                                  aria-label={tCommon("close")}
                                  className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 text-xs font-bold"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </div>
                              <div className="grid grid-cols-4 gap-2">
                                {CATEGORY_PRESET_COLORS.map((color) => (
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

                      <span className="truncate text-sm font-medium text-gray-700 dark:text-gray-200 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                        {row.name}
                      </span>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-bold tabular-nums text-gray-900 dark:text-white">
                        {formatAmount(row.amount, displayCurrency)}
                      </p>
                      <p className="text-xs tabular-nums text-gray-500 dark:text-gray-400 font-medium">
                        {row.percent.toFixed(0)}%
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        {chartView === "line" && (
        <div className="mt-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
              {t("flowTitle")}
            </h3>
            <div className="flex rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5">
              {(["expense", "income"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setFlowSeries(k)}
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                    flowSeries === k
                      ? "bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-white"
                      : "text-gray-500 dark:text-gray-400"
                  }`}
                >
                  {t(k)}
                </button>
              ))}
            </div>
          </div>
          {flowLoading ? (
            <div className="mt-3 h-48 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
          ) : (
            <div className="mt-3 h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={flow}
                  margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                  onClick={(state) => {
                    const i = state?.activeTooltipIndex;
                    if (typeof i === "number") setFlowSelected(i === flowSelected ? null : i);
                  }}
                  className="cursor-pointer"
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    className="stroke-gray-200 dark:stroke-gray-700"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="label"
                    interval="preserveStartEnd"
                    minTickGap={14}
                    tick={{ fontSize: 11, fill: "currentColor" }}
                    className="text-gray-500 dark:text-gray-400"
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "currentColor" }}
                    className="text-gray-500 dark:text-gray-400"
                    width={40}
                    tickFormatter={(v: number) =>
                      v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)
                    }
                  />
                  <Tooltip
                    content={({ active, payload }) => (
                      <ChartTooltipBox
                        active={active}
                        label={(payload?.[0]?.payload as FlowPoint | undefined)?.fullLabel}
                        rows={(payload ?? []).map((p) => ({
                          name: p.dataKey === "income" ? t("income") : t("expense"),
                          value: formatAmount(Number(p.value ?? 0), displayCurrency),
                          color: typeof p.color === "string" ? p.color : undefined,
                        }))}
                      />
                    )}
                  />
                  <Line
                    type="monotone"
                    dataKey={flowSeries}
                    stroke={`var(--flow-${flowSeries})`}
                    strokeWidth={2}
                    dot={(props: { cx?: number; cy?: number; index?: number }) => (
                      <circle
                        key={props.index}
                        cx={props.cx}
                        cy={props.cy}
                        r={props.index === flowSelected ? 5 : 2.5}
                        fill={props.index === flowSelected ? `var(--flow-${flowSeries})` : "white"}
                        stroke={`var(--flow-${flowSeries})`}
                        strokeWidth={2}
                      />
                    )}
                    activeDot={{ r: 5 }}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
          {!flowLoading && (() => {
            const point = flowSelected !== null ? flow[flowSelected] : undefined;
            if (!point) {
              return (
                <p className="mt-2 text-center text-xs text-gray-500 dark:text-gray-400">
                  {t("flowTapHint")}
                </p>
              );
            }
            const rows = toSlices(point.categories, translate, categoryColors);
            return (
              <div className="mt-3 rounded-xl bg-gray-50 dark:bg-gray-800/60 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">
                    {point.fullLabel}
                  </p>
                  <p className="text-sm font-semibold tabular-nums text-[color:var(--flow-expense)]">
                    {formatAmount(point.expense, displayCurrency)}
                  </p>
                </div>
                {rows.length > 0 ? (
                  <ul className="mt-2 space-y-1.5">
                    {rows.map((row) => {
                      const Icon = categoryIcon(row.category);
                      return (
                        <li key={row.category} className="group relative">
                          <button
                            type="button"
                            onClick={() => setPopoverCategory(row.category)}
                            className="flex w-full items-center justify-between gap-2 rounded-lg px-1 py-1 text-left text-xs hover:bg-gray-100 dark:hover:bg-gray-800"
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <span
                                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                                  isLightColor(row.color) ? "text-gray-950" : "text-white"
                                }`}
                                style={{ backgroundColor: row.color }}
                              >
                                <Icon className="h-3 w-3" strokeWidth={2.25} />
                              </span>
                              <span className="truncate text-gray-700 dark:text-gray-200">{row.name}</span>
                            </span>
                            <span className="shrink-0 tabular-nums text-gray-600 dark:text-gray-300">
                              {formatAmount(row.amount, displayCurrency)}
                              <span className="ml-1.5 text-gray-400 dark:text-gray-500">
                                {Math.round(row.percent)}%
                              </span>
                            </span>
                          </button>
                          <div className="pointer-events-none absolute bottom-full left-1/2 z-20 hidden -translate-x-1/2 pb-1 group-hover:block">
                            <PieExpenseTooltip
                              active
                              payload={[{ payload: row, color: row.color }]}
                              totalExpense={point.expense}
                              displayCurrency={displayCurrency}
                              monthTransactions={flowPointTxs}
                              tCategories={tCategories}
                            />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{t("flowNoExpense")}</p>
                )}
              </div>
            );
          })()}
        </div>
        )}
      </section>
      )}

      {showTrend && (
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
                    : "text-gray-500 dark:text-gray-400"
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
                  tick={{ fontSize: 12, fill: "currentColor" }}
                  className="text-gray-500 dark:text-gray-400"
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "currentColor" }}
                  className="text-gray-500 dark:text-gray-400"
                  width={48}
                  tickFormatter={(v: number) =>
                    v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)
                  }
                />
                <Tooltip
                  content={({ active, payload, label }) => (
                    <ChartTooltipBox
                      active={active}
                      label={typeof label === "string" ? label : undefined}
                      rows={(payload ?? []).map((p) => ({
                        name:
                          p.dataKey === "income" ? t("income") : t("expense"),
                        value: formatAmount(
                          Number(p.value ?? 0),
                          displayCurrency
                        ),
                        color:
                          typeof p.color === "string" ? p.color : undefined,
                      }))}
                    />
                  )}
                />
                <Legend
                  formatter={(value) => (
                    <span className="text-gray-700 dark:text-gray-200">
                      {value === "income" ? t("income") : t("expense")}
                    </span>
                  )}
                />
                <Bar
                  dataKey="income"
                  name="income"
                  fill="#16A34A"
                  radius={[6, 6, 0, 0]}
                  maxBarSize={28}
                />
                <Bar
                  dataKey="expense"
                  name="expense"
                  fill="#3B82F6"
                  radius={[6, 6, 0, 0]}
                  maxBarSize={28}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>
      )}

      {showExpense && popoverCategory && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={() => setPopoverCategory(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="category-breakdown-title"
            className="w-full max-w-sm bg-white dark:bg-gray-900 rounded-2xl shadow-xl p-5 border border-gray-100 dark:border-gray-800 space-y-4 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 pb-3">
              <div className="flex items-center gap-2">
                <span id="category-breakdown-title" className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 font-bold text-sm">
                  {translateCategory(popoverCategory, tCategories)}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">{t("subCategoryBreakdown")}</span>
              </div>
              <button
                type="button"
                onClick={() => setPopoverCategory(null)}
                aria-label={tCommon("close")}
                className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 p-1 rounded-lg"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3">
              {subCategoryGroupMap.length === 0 ? (
                <p className="text-xs text-gray-500 dark:text-gray-400 text-center py-4">{t("noExpenseData")}</p>
              ) : (
                subCategoryGroupMap.map(({ subCategory, total, txs }) => (
                  <div
                    key={subCategory}
                    onClick={() => {
                      const subVal = subCategory === NO_SUB_CATEGORY ? undefined : subCategory;
                      onCategoryClick?.(popoverCategory, subVal, true);
                      setPopoverCategory(null);
                    }}
                    className="p-3 rounded-xl bg-gray-50 hover:bg-indigo-50/60 dark:bg-gray-800/60 dark:hover:bg-gray-800 transition-colors cursor-pointer border border-gray-100 dark:border-gray-700/60 group"
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-bold text-gray-800 dark:text-gray-200 group-hover:text-indigo-600 dark:group-hover:text-indigo-400">
                        {subCategory === NO_SUB_CATEGORY
                          ? t("uncategorized")
                          : translateSubCategory(subCategory, tSubCategories)} ›
                      </span>
                      <span className="text-xs font-bold tabular-nums text-gray-900 dark:text-white">
                        {formatAmount(total, displayCurrency)}
                      </span>
                    </div>
                    <ul className="space-y-1 pl-1 border-t border-gray-100 dark:border-gray-700/40 pt-1.5 mt-1">
                      {txs.slice(0, 3).map((tx) => (
                        <li key={tx.id} className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
                          <span className="truncate max-w-[170px]">{tx.note?.trim() || realMerchant(tx.merchant) || tx.sub_category}</span>
                          <span className="tabular-nums shrink-0 font-medium">{formatAmount(effectiveExpenseAmount(tx), tx.currency)}</span>
                        </li>
                      ))}
                      {txs.length > 3 && (
                        <li className="text-xs text-indigo-500 font-semibold text-right pt-0.5">
                          {t("moreTransactions", { count: txs.length - 3 })}
                        </li>
                      )}
                    </ul>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
