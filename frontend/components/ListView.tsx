"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, Plus, Search } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import SwipeableRow from "@/components/SwipeableRow";
import {
  CategoryPresets,
  Currency,
  EXPENSE_CATEGORY_INVESTMENT,
  INCOME_CATEGORY_SETTLEMENT,
  LedgerScope,
  SubscriptionOccurrence,
  Transaction,
  TransactionType,
  categoriesForType,
  deleteTransaction,
  effectiveExpenseAmount,
  formatAmount,
  hasSettlement,
  isNonCashflowTransaction,
  isSubscriptionDueOrPast,
  isSubscriptionTransaction,
  subCategoriesFor,
} from "@/lib/api";
import { translateCategory, translateSubCategory } from "@/lib/category-i18n";
import { parseDate } from "@/lib/date";
import { translateError } from "@/lib/errors";
import { translateSubscriptionSource } from "@/lib/subscription-i18n";

interface Props {
  scope: LedgerScope;
  presets: CategoryPresets | null;
  transactions: Transaction[];
  pendingOccurrences?: SubscriptionOccurrence[];
  onEditTransaction?: (tx: Transaction) => void;
  onAddTransaction?: () => void;
  onDeleted?: () => void;
  onPendingClick?: (occ: SubscriptionOccurrence) => void;
}

export type UnifiedListItem =
  | {
      id: string;
      kind: "transaction";
      date: string;
      currency: Currency;
      category: string;
      sub_category?: string | null;
      merchant: string;
      type: TransactionType;
      amount: number;
      effectiveAmount: number;
      tx: Transaction;
    }
  | {
      id: string;
      kind: "pending";
      date: string;
      currency: Currency;
      category: string;
      sub_category?: string | null;
      merchant: string;
      type: TransactionType;
      amount: number;
      effectiveAmount: number;
      isDueOrPast: boolean;
      occ: SubscriptionOccurrence;
    };

type TypeFilter = "all" | TransactionType;
type SortKey =
  | "date"
  | "currency"
  | "category"
  | "sub_category"
  | "merchant"
  | "type"
  | "amount";
type SortDir = "asc" | "desc";

function formatDay(iso: string): string {
  const d = parseDate(iso);
  return `${String(d.getMonth() + 1).padStart(2, "0")}.${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function displayAmount(tx: Transaction): number {
  return tx.type === "expense" ? effectiveExpenseAmount(tx) : tx.amount;
}

export default function ListView({
  scope,
  presets,
  transactions,
  pendingOccurrences = [],
  onEditTransaction,
  onAddTransaction,
  onDeleted,
  onPendingClick,
}: Props) {
  const locale = useLocale();
  const tList = useTranslations("list");
  const tCommon = useTranslations("common");
  const tTx = useTranslations("transaction");
  const tErrors = useTranslations("errors");
  const tCategories = useTranslations("categories");
  const tSubCategories = useTranslations("subCategories");
  const tSub = useTranslations("subscriptions");

  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [subCategoryFilter, setSubCategoryFilter] = useState<string>("all");
  const [merchantQuery, setMerchantQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [localTxs, setLocalTxs] = useState<Transaction[] | null>(null);

  const showCurrencyCol = scope === "ALL";
  const visibleTxs = localTxs ?? transactions;

  useEffect(() => {
    setLocalTxs(null);
  }, [transactions]);

  async function handleDelete(tx: Transaction) {
    if (!window.confirm(tTx("deleteConfirm"))) return;
    try {
      await deleteTransaction(tx.id);
      setLocalTxs((prev) =>
        (prev ?? transactions).filter((t) => t.id !== tx.id)
      );
      onDeleted?.();
    } catch (err) {
      window.alert(translateError(err, tErrors, "deleteTransaction"));
    }
  }

  const combinedItems = useMemo<UnifiedListItem[]>(() => {
    const items: UnifiedListItem[] = [];
    for (const tx of visibleTxs) {
      items.push({
        id: tx.id,
        kind: "transaction",
        date: tx.date,
        currency: tx.currency,
        category: tx.category,
        sub_category: tx.sub_category,
        merchant: tx.merchant,
        type: tx.type,
        amount: tx.amount,
        effectiveAmount: displayAmount(tx),
        tx,
      });
    }
    for (const occ of pendingOccurrences) {
      const merchantName =
        occ.subscription_name || occ.merchant || tSub("defaultName");
      const categoryName = occ.category || "Subscriptions";
      items.push({
        id: `pending-${occ.id}`,
        kind: "pending",
        date: occ.due_date,
        currency: occ.currency,
        category: categoryName,
        sub_category: occ.sub_category,
        merchant: merchantName,
        type: "expense",
        amount: occ.amount,
        effectiveAmount: occ.amount,
        isDueOrPast: isSubscriptionDueOrPast(occ.due_date),
        occ,
      });
    }
    return items;
  }, [visibleTxs, pendingOccurrences, tSub]);

  const allCategories = useMemo(() => {
    if (!presets) return [];
    const set = new Set<string>();
    for (const item of combinedItems) set.add(item.category);
    const expense = categoriesForType(presets, "expense");
    const income = categoriesForType(presets, "income");
    return [...expense, ...income].filter((c) => set.has(c));
  }, [presets, combinedItems]);

  const subCategoryOptions = useMemo(() => {
    if (categoryFilter === "all") {
      const set = new Set<string>(
        combinedItems
          .map((t) => t.sub_category)
          .filter((s): s is string => Boolean(s))
      );
      return [...set].sort((a, b) =>
        translateSubCategory(a, tSubCategories).localeCompare(
          translateSubCategory(b, tSubCategories),
          locale
        )
      );
    }
    const set = new Set<string>(
      combinedItems
        .filter((t) => t.category === categoryFilter)
        .map((t) => t.sub_category)
        .filter((s): s is string => Boolean(s))
    );
    if (presets) {
      const expenseSubs = subCategoriesFor(presets, "expense", categoryFilter);
      const incomeSubs = subCategoriesFor(presets, "income", categoryFilter);
      for (const s of [...expenseSubs, ...incomeSubs]) {
        if (set.has(s) || categoryFilter !== "all") set.add(s);
      }
    }
    return [...set].sort((a, b) =>
      translateSubCategory(a, tSubCategories).localeCompare(
        translateSubCategory(b, tSubCategories),
        locale
      )
    );
  }, [combinedItems, categoryFilter, presets, locale, tSubCategories]);

  const filtered = useMemo(() => {
    const q = merchantQuery.trim().toLowerCase();
    return combinedItems.filter((item) => {
      if (typeFilter !== "all" && item.type !== typeFilter) return false;
      if (categoryFilter !== "all" && item.category !== categoryFilter)
        return false;
      if (
        subCategoryFilter !== "all" &&
        item.sub_category !== subCategoryFilter
      )
        return false;
      if (q && !item.merchant.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [
    combinedItems,
    typeFilter,
    categoryFilter,
    subCategoryFilter,
    merchantQuery,
  ]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "date":
          cmp = new Date(a.date).getTime() - new Date(b.date).getTime();
          break;
        case "currency":
          cmp = a.currency.localeCompare(b.currency);
          break;
        case "amount":
          cmp = a.effectiveAmount - b.effectiveAmount;
          break;
        case "category":
          cmp = translateCategory(a.category, tCategories).localeCompare(
            translateCategory(b.category, tCategories),
            locale
          );
          break;
        case "sub_category":
          cmp = translateSubCategory(
            a.sub_category || "",
            tSubCategories
          ).localeCompare(
            translateSubCategory(b.sub_category || "", tSubCategories),
            locale
          );
          break;
        case "merchant":
          cmp = a.merchant.localeCompare(b.merchant, locale);
          break;
        case "type":
          cmp = tCommon(a.type).localeCompare(tCommon(b.type), locale);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [
    filtered,
    sortKey,
    sortDir,
    locale,
    tCategories,
    tSubCategories,
    tCommon,
  ]);

  const totals = useMemo(() => {
    const byCurrency: Record<
      Currency,
      { income: number; expense: number; count: number }
    > = {
      CAD: { income: 0, expense: 0, count: 0 },
      KRW: { income: 0, expense: 0, count: 0 },
      USD: { income: 0, expense: 0, count: 0 },
    };
    for (const item of sorted) {
      const bucket = byCurrency[item.currency];
      bucket.count += 1;
      if (item.kind === "transaction") {
        if (isNonCashflowTransaction(item.tx)) continue;
        if (item.tx.type === "income") bucket.income += item.tx.amount;
        else bucket.expense += effectiveExpenseAmount(item.tx);
      } else {
        bucket.expense += item.amount;
      }
    }
    return byCurrency;
  }, [sorted]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "date" ? "desc" : "asc");
    }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col)
      return <ArrowUpDown className="inline h-3 w-3 opacity-40" />;
    return sortDir === "asc" ? (
      <ArrowUp className="inline h-3 w-3 text-blue-500" />
    ) : (
      <ArrowDown className="inline h-3 w-3 text-blue-500" />
    );
  }

  const thClass =
    "px-3 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200 transition-colors";

  const colSpan = showCurrencyCol ? 7 : 6;
  const activeCurrencies: Currency[] =
    scope === "ALL"
      ? (["CAD", "KRW"] as Currency[]).filter((c) => totals[c].count > 0)
      : [scope as Currency];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl bg-gray-100 dark:bg-gray-800 p-1">
          {(["all", "expense", "income"] as TypeFilter[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTypeFilter(t)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                typeFilter === t
                  ? "bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-white"
                  : "text-gray-500 dark:text-gray-400"
              }`}
            >
              {tCommon(t)}
            </button>
          ))}
        </div>

        <select
          value={categoryFilter}
          onChange={(e) => {
            setCategoryFilter(e.target.value);
            setSubCategoryFilter("all");
          }}
          className="input-field w-auto py-2 text-sm"
        >
          <option value="all">{tList("allCategories")}</option>
          {allCategories.map((c) => (
            <option key={c} value={c}>
              {translateCategory(c, tCategories)}
            </option>
          ))}
        </select>

        <select
          value={subCategoryFilter}
          onChange={(e) => setSubCategoryFilter(e.target.value)}
          className="input-field w-auto py-2 text-sm"
          disabled={categoryFilter === "all" && subCategoryOptions.length === 0}
        >
          <option value="all">{tList("allSubCategories")}</option>
          {subCategoryOptions.map((s) => (
            <option key={s} value={s}>
              {translateSubCategory(s, tSubCategories)}
            </option>
          ))}
        </select>

        <div className="relative flex-1 min-w-[10rem]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            value={merchantQuery}
            onChange={(e) => setMerchantQuery(e.target.value)}
            placeholder={tList("searchMerchant")}
            className="input-field pl-9 py-2 text-sm"
          />
        </div>

        {onAddTransaction && (
          <button
            type="button"
            onClick={onAddTransaction}
            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-sm font-semibold px-3.5 py-2 transition-colors shrink-0"
          >
            <Plus className="h-4 w-4 shrink-0" />
            <span className="whitespace-nowrap">{tList("add")}</span>
          </button>
        )}
      </div>

      <div className="mt-4 card-inset overflow-hidden">
        <ul className="divide-y divide-gray-100 dark:divide-gray-700 max-h-[28rem] overflow-y-auto">
          {sorted.length === 0 ? (
            <li className="px-4 py-12 text-center text-gray-400 text-sm">
              {tList("noTransactions")}
            </li>
          ) : (
            sorted.map((item) => {
              if (item.kind === "pending") {
                const occ = item.occ;
                const isOverdue = item.isDueOrPast;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => onPendingClick?.(occ)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-amber-50/40 dark:hover:bg-amber-500/5 transition-colors cursor-pointer"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate flex items-center gap-1.5">
                          {showCurrencyCol &&
                            (item.currency === "CAD" ? "🇨🇦 " : "🇰🇷 ")}
                          <span>
                            {translateCategory(item.category, tCategories)}
                          </span>
                          {item.sub_category && (
                            <span className="text-gray-400">
                              ›{" "}
                              {translateSubCategory(
                                item.sub_category,
                                tSubCategories
                              )}
                            </span>
                          )}
                          <span
                            className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                              isOverdue
                                ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                                : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                            }`}
                          >
                            결제예정
                          </span>
                        </p>
                        <p className="text-[11px] text-gray-400 truncate">
                          {formatDay(item.date)} · {item.merchant}
                          {translateSubscriptionSource(
                            occ.subscription_billing_cycle,
                            tSub
                          ) && (
                            <span className="ml-1 text-gray-400 font-normal">
                              (
                              {translateSubscriptionSource(
                                occ.subscription_billing_cycle,
                                tSub
                              )}
                              )
                            </span>
                          )}
                        </p>
                      </div>
                      <p
                        className={`shrink-0 text-sm font-semibold tabular-nums ${
                          isOverdue
                            ? "text-red-500"
                            : "text-amber-600 dark:text-amber-400"
                        }`}
                      >
                        {formatAmount(item.amount, item.currency)}
                      </p>
                    </button>
                  </li>
                );
              }

              const tx = item.tx;
              const settled = hasSettlement(tx);
              const transfer = isNonCashflowTransaction(tx);
              const subscription = isSubscriptionTransaction(tx);
              const effective = item.effectiveAmount;
              return (
                <li key={tx.id}>
                  <SwipeableRow
                    onDelete={() => handleDelete(tx)}
                    deleteLabel={tCommon("delete")}
                  >
                    <button
                      type="button"
                      onClick={() => onEditTransaction?.(tx)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {showCurrencyCol &&
                            (tx.currency === "CAD" ? "🇨🇦 " : "🇰🇷 ")}
                          {translateCategory(tx.category, tCategories)}
                          {tx.sub_category
                            ? ` › ${translateSubCategory(tx.sub_category, tSubCategories)}`
                            : ""}
                        </p>
                        <p className="text-[11px] text-gray-400 truncate">
                          {formatDay(tx.date)} · {tx.merchant}
                        </p>
                      </div>
                      <p
                        className={`shrink-0 text-sm font-semibold tabular-nums ${
                          transfer
                            ? "text-gray-500"
                            : tx.type === "income"
                              ? "text-blue-500"
                              : subscription
                                ? "text-red-500"
                                : "text-gray-900 dark:text-white"
                        }`}
                      >
                        {settled
                          ? formatAmount(effective, tx.currency)
                          : formatAmount(effective, tx.currency)}
                      </p>
                    </button>
                  </SwipeableRow>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}
