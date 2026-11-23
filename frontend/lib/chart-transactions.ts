import {
  AccountType,
  Currency,
  EXPENSE_CATEGORY_INVESTMENT,
  Transaction,
  TRANSFER_CATEGORY,
  fetchAccounts,
  fetchTransactions,
  fetchUserSettings,
  hiddenSubKey,
  isNonCashflowTransaction,
  isSpendingExcluded,
  normalizeTransferCategory,
} from "@/lib/api";
import { dayKey } from "@/lib/date";

/** A day range (inclusive YYYY-MM-DD) that a chart slice and its entries cover. */
export interface ChartPeriod {
  start: string;
  end: string;
  currency?: Currency;
}

export interface ChartRules {
  excludedCategories: string[];
  excludedAccounts: string[];
  hidden: ReadonlySet<string>;
}

/** The settings behind what the expense chart counts, the same ones the stats use. */
export async function loadChartRules(accountType: AccountType): Promise<ChartRules> {
  const settings = await fetchUserSettings().catch(() => null);
  // Without a choice, savings accounts are left out (same default as the backend).
  const excludedAccounts =
    settings?.spending_excluded_accounts ??
    (await fetchAccounts({ accountType }).catch(() => [])).filter(
      (a) => a.kind === "savings"
    ).map((a) => a.id);
  return {
    excludedCategories: [
      ...new Set([TRANSFER_CATEGORY, ...(settings?.spending_excluded_categories ?? [])]),
    ],
    excludedAccounts,
    hidden: new Set(settings?.expense_ratio_hidden_categories ?? []),
  };
}

/** True when an entry is counted in the expense chart's slices. */
export function isChartExpense(tx: Transaction, rules: ChartRules): boolean {
  return (
    tx.type === "expense" &&
    tx.kind !== "transfer" &&
    tx.category !== EXPENSE_CATEGORY_INVESTMENT &&
    normalizeTransferCategory(tx.category) !== TRANSFER_CATEGORY &&
    !isNonCashflowTransaction(tx) &&
    !isSpendingExcluded(rules.excludedCategories, tx.category, tx.sub_category) &&
    !(tx.account_id && rules.excludedAccounts.includes(tx.account_id)) &&
    !rules.hidden.has(tx.category) &&
    !rules.hidden.has(hiddenSubKey(tx.category, tx.sub_category))
  );
}

/**
 * Chart entries of a period. The API returns at most 500 entries per call, so a
 * long period is read one month at a time, like the stats behind the slices.
 */
export async function fetchChartTransactions(
  accountType: AccountType,
  period: ChartPeriod,
  rules: ChartRules
): Promise<Transaction[]> {
  const last = new Date(`${period.end}T00:00:00`);
  const chunks: { start: string; end: string }[] = [];
  let from = new Date(`${period.start}T00:00:00`);
  while (from <= last) {
    const monthEnd = new Date(from.getFullYear(), from.getMonth() + 1, 0);
    const to = monthEnd < last ? monthEnd : last;
    chunks.push({ start: dayKey(from), end: dayKey(to) });
    from = new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1);
  }
  const rows = await Promise.all(
    chunks.map((c) =>
      fetchTransactions({ accountType, currency: period.currency, ...c })
    )
  );
  return rows.flat().filter((tx) => isChartExpense(tx, rules));
}
