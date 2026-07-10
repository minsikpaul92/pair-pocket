"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, Search } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import {
  CategoryPresets,
  Currency,
  EXPENSE_CATEGORY_INVESTMENT,
  INCOME_CATEGORY_SETTLEMENT,
  LedgerScope,
  Transaction,
  TransactionType,
  categoriesForType,
  effectiveExpenseAmount,
  formatAmount,
  hasSettlement,
  isNonCashflowTransaction,
  isSubscriptionTransaction,
  subCategoriesFor,
} from "@/lib/api";
import { translateCategory, translateSubCategory } from "@/lib/category-i18n";
import { translateSubscriptionSource } from "@/lib/subscription-i18n";

interface Props {
  scope: LedgerScope;
  presets: CategoryPresets | null;
  transactions: Transaction[];
  onEditTransaction?: (tx: Transaction) => void;
}

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
  const d = new Date(iso);
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
  onEditTransaction,
}: Props) {
  const locale = useLocale();
  const tList = useTranslations("list");
  const tCommon = useTranslations("common");
  const tCategories = useTranslations("categories");
  const tSubCategories = useTranslations("subCategories");
  const tSub = useTranslations("subscriptions");

  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [subCategoryFilter, setSubCategoryFilter] = useState<string>("all");
  const [merchantQuery, setMerchantQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const showCurrencyCol = scope === "ALL";

  const allCategories = useMemo(() => {
    if (!presets) return [];
    const set = new Set<string>();
    for (const tx of transactions) set.add(tx.category);
    const expense = categoriesForType(presets, "expense");
    const income = categoriesForType(presets, "income");
    return [...expense, ...income].filter((c) => set.has(c));
  }, [presets, transactions]);

  const subCategoryOptions = useMemo(() => {
    if (categoryFilter === "all") {
      const set = new Set(transactions.map((t) => t.sub_category).filter(Boolean));
      return [...set].sort((a, b) =>
        translateSubCategory(a, tSubCategories).localeCompare(
          translateSubCategory(b, tSubCategories),
          locale
        )
      );
    }
    const set = new Set(
      transactions
        .filter((t) => t.category === categoryFilter)
        .map((t) => t.sub_category)
        .filter(Boolean)
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
  }, [transactions, categoryFilter, presets, locale, tSubCategories]);

  const filtered = useMemo(() => {
    const q = merchantQuery.trim().toLowerCase();
    return transactions.filter((tx) => {
      if (typeFilter !== "all" && tx.type !== typeFilter) return false;
      if (categoryFilter !== "all" && tx.category !== categoryFilter) return false;
      if (subCategoryFilter !== "all" && tx.sub_category !== subCategoryFilter)
        return false;
      if (q && !tx.merchant.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [transactions, typeFilter, categoryFilter, subCategoryFilter, merchantQuery]);

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
          cmp = displayAmount(a) - displayAmount(b);
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
    };
    for (const tx of sorted) {
      const bucket = byCurrency[tx.currency];
      bucket.count += 1;
      if (isNonCashflowTransaction(tx)) continue;
      if (tx.type === "income") bucket.income += tx.amount;
      else bucket.expense += effectiveExpenseAmount(tx);
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
      </div>

      <div className="mt-4 card-inset overflow-hidden">
        <div className="overflow-x-auto max-h-[28rem] overflow-y-auto">
          <table className="min-w-full text-sm border-collapse">
            <thead className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-900/95 backdrop-blur-sm">
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className={thClass} onClick={() => toggleSort("date")}>
                  {tCommon("date")} <SortIcon col="date" />
                </th>
                {showCurrencyCol && (
                  <th className={thClass} onClick={() => toggleSort("currency")}>
                    {tCommon("currency")} <SortIcon col="currency" />
                  </th>
                )}
                <th className={thClass} onClick={() => toggleSort("category")}>
                  {tList("category")} <SortIcon col="category" />
                </th>
                <th className={thClass} onClick={() => toggleSort("sub_category")}>
                  {tList("subCategory")} <SortIcon col="sub_category" />
                </th>
                <th className={thClass} onClick={() => toggleSort("merchant")}>
                  {tList("merchant")} <SortIcon col="merchant" />
                </th>
                <th className={thClass} onClick={() => toggleSort("type")}>
                  {tList("type")} <SortIcon col="type" />
                </th>
                <th
                  className={`${thClass} text-right`}
                  onClick={() => toggleSort("amount")}
                >
                  {tCommon("amount")} <SortIcon col="amount" />
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td
                    colSpan={colSpan}
                    className="px-4 py-12 text-center text-gray-400"
                  >
                    {tList("noTransactions")}
                  </td>
                </tr>
              ) : (
                sorted.map((tx, i) => {
                  const settled = hasSettlement(tx);
                  const transfer = isNonCashflowTransaction(tx);
                  const subscription = isSubscriptionTransaction(tx);
                  const effective = displayAmount(tx);
                  return (
                    <tr
                      key={tx.id}
                      onClick={() => onEditTransaction?.(tx)}
                      className={`border-b border-gray-100 dark:border-gray-700/60 hover:bg-blue-50/50 dark:hover:bg-blue-500/5 transition-colors ${
                        onEditTransaction ? "cursor-pointer" : ""
                      } ${
                        i % 2 === 0
                          ? "bg-white dark:bg-gray-800"
                          : "bg-gray-50/50 dark:bg-gray-800/60"
                      }`}
                    >
                      <td className="px-3 py-2.5 whitespace-nowrap text-gray-500 dark:text-gray-400 tabular-nums">
                        {formatDay(tx.date)}
                      </td>
                      {showCurrencyCol && (
                        <td className="px-3 py-2.5 whitespace-nowrap text-xs font-medium text-gray-500">
                          {tx.currency === "CAD" ? "🇨🇦" : "🇰🇷"} {tx.currency}
                        </td>
                      )}
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {translateCategory(tx.category, tCategories)}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap max-w-[7rem] truncate">
                        {tx.sub_category
                          ? translateSubCategory(tx.sub_category, tSubCategories)
                          : tCommon("none")}
                      </td>
                      <td className="px-3 py-2.5 max-w-[8rem] truncate">
                        {tx.merchant}
                        {translateSubscriptionSource(tx.subscription_billing_cycle, tSub) && (
                          <span className="ml-1 text-[10px] text-gray-400 font-normal">
                            {translateSubscriptionSource(tx.subscription_billing_cycle, tSub)}
                          </span>
                        )}
                        {tx.category === EXPENSE_CATEGORY_INVESTMENT &&
                          tx.institution && (
                            <span className="block text-xs text-gray-400 truncate">
                              {tx.institution}
                            </span>
                          )}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span
                          className={`text-xs font-medium ${
                            transfer
                              ? "text-gray-500"
                              : tx.type === "income"
                                ? "text-blue-500"
                                : "text-gray-500"
                          }`}
                        >
                          {transfer
                            ? tx.category === INCOME_CATEGORY_SETTLEMENT
                              ? tCommon("settlement")
                              : tCommon("transfer")
                            : tx.type === "income"
                              ? tCommon("income")
                              : tCommon("expense")}
                        </span>
                      </td>
                      <td
                        className={`px-3 py-2.5 whitespace-nowrap text-right tabular-nums ${
                          transfer
                            ? "text-gray-500 dark:text-gray-400 font-semibold"
                            : tx.type === "income"
                              ? "text-blue-500 font-semibold"
                              : subscription
                                ? "text-red-500 font-semibold"
                                : "text-gray-900 dark:text-white font-semibold"
                        }`}
                      >
                        {settled ? (
                          <div className="flex flex-col items-end gap-0.5">
                            <span className="text-xs text-gray-400 line-through font-normal">
                              {formatAmount(tx.amount, tx.currency)}
                            </span>
                            <span className="text-red-500">
                              {formatAmount(effective, tx.currency)}
                            </span>
                          </div>
                        ) : (
                          <>
                            {transfer
                              ? ""
                              : tx.type === "income"
                                ? "+"
                                : ""}
                            {formatAmount(effective, tx.currency)}
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {sorted.length > 0 && (
              <tfoot className="sticky bottom-0 bg-gray-100 dark:bg-gray-900 border-t-2 border-gray-200 dark:border-gray-600">
                {activeCurrencies.map((cur) => {
                  const t = totals[cur];
                  const net = t.income - t.expense;
                  return (
                    <tr key={cur}>
                      <td
                        colSpan={showCurrencyCol ? 5 : 4}
                        className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400"
                      >
                        {tCommon("totalCount", { count: t.count })}
                        {showCurrencyCol && (
                          <span className="ml-1">
                            {cur === "CAD" ? "🇨🇦" : "🇰🇷"} {cur}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs whitespace-nowrap">
                        <span className="text-blue-500">
                          +{formatAmount(t.income, cur)}
                        </span>
                        <span className="mx-1 text-gray-300">/</span>
                        <span className="text-red-500">
                          -{formatAmount(t.expense, cur)}
                        </span>
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-bold whitespace-nowrap tabular-nums text-xs ${
                          net < 0 ? "text-red-500" : "text-gray-900 dark:text-white"
                        }`}
                      >
                        {formatAmount(net, cur)}
                      </td>
                    </tr>
                  );
                })}
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
