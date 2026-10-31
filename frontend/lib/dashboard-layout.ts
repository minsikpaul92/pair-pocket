import type { DashboardLayout, LedgerScope } from "@/lib/api";

export type BudgetCurrency = "CAD" | "KRW";

/** Ledger currencies a scope covers: both for ALL, otherwise just that country. */
export function scopeCurrencies(scope: LedgerScope): BudgetCurrency[] {
  if (scope === "ALL") return ["CAD", "KRW"];
  return scope === "KRW" ? ["KRW"] : ["CAD"];
}

export const DASHBOARD_CARD_IDS = [
  "balance",
  "budget",
  "spent",
  "expenseRatio",
  "fixedList",
  "expenseList",
  "netWorth",
  "monthlyFlow",
  "trend",
  "cards",
  "assets",
  "stocks",
] as const;

export type DashboardCardId = (typeof DASHBOARD_CARD_IDS)[number];

/** Cards shown side by side (two per row); everything else is full width. */
export const HALF_WIDTH_CARDS: ReadonlySet<DashboardCardId> = new Set([
  "budget",
  "spent",
  "fixedList",
  "expenseList",
]);

/** Cards that stay hidden until the user turns them on in Settings. */
const DEFAULT_HIDDEN: readonly DashboardCardId[] = [
  "netWorth",
  "monthlyFlow",
  "trend",
  "cards",
  "assets",
  "stocks",
];

export type CardSize = "half" | "full";

export interface ResolvedLayout {
  order: DashboardCardId[];
  hidden: DashboardCardId[];
  sizes: Partial<Record<DashboardCardId, CardSize>>;
}

/** Whether a card is shown at half width, honoring the user's override. */
export function isHalfWidth(layout: ResolvedLayout, id: DashboardCardId): boolean {
  const size = layout.sizes[id];
  return size ? size === "half" : HALF_WIDTH_CARDS.has(id);
}

const isCardId = (id: string): id is DashboardCardId =>
  (DASHBOARD_CARD_IDS as readonly string[]).includes(id);

/** Merge a saved layout with the known cards (unknown ids dropped, new ones appended). */
export function resolveLayout(saved?: DashboardLayout | null): ResolvedLayout {
  if (!saved || (saved.order.length === 0 && saved.hidden.length === 0)) {
    return { order: [...DASHBOARD_CARD_IDS], hidden: [...DEFAULT_HIDDEN], sizes: {} };
  }
  const order = saved.order.filter(isCardId);
  const hidden = saved.hidden.filter(isCardId);
  const sizes: ResolvedLayout["sizes"] = {};
  for (const [id, size] of Object.entries(saved.sizes ?? {})) {
    if (isCardId(id) && (size === "half" || size === "full")) sizes[id] = size;
  }
  for (const id of DASHBOARD_CARD_IDS) {
    if (order.includes(id)) continue;
    order.push(id);
    if (DEFAULT_HIDDEN.includes(id) && !hidden.includes(id)) hidden.push(id);
  }
  return { order, hidden, sizes };
}

export function defaultLayout(): ResolvedLayout {
  return resolveLayout(null);
}
