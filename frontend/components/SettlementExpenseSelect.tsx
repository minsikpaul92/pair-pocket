"use client";

import { CalendarDays, Check, ChevronDown, Receipt, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";

import DayPicker from "@/components/DayPicker";
import { Currency, SettleableExpense, formatAmount } from "@/lib/api";
import { translateCategory, translateSubCategory } from "@/lib/category-i18n";
import { dayKey, formatDayLabel, isoDayKey, parseDate } from "@/lib/date";

interface Props {
  options: SettleableExpense[];
  value: string;
  onChange: (expenseId: string) => void;
  currency: Currency;
  disabled?: boolean;
}

function formatOptionLabel(
  exp: SettleableExpense,
  currency: Currency,
  locale: string,
  tCommon: (key: string, values?: Record<string, string | number>) => string
): string {
  const dateStr = new Intl.DateTimeFormat(locale, {
    month: "numeric",
    day: "numeric",
  }).format(new Date(exp.date));
  const remaining = formatAmount(exp.remaining_amount, currency);
  const merchant = exp.merchant || tCommon("unspecified");
  return `${dateStr} · ${merchant} · ${tCommon("remaining", { amount: remaining })}`;
}

export default function SettlementExpenseSelect({
  options,
  value,
  onChange,
  currency,
  disabled = false,
}: Props) {
  const locale = useLocale();
  const tCommon = useTranslations("common");
  const tSettlement = useTranslations("settlement");
  const tTx = useTranslations("transaction");
  const tCategories = useTranslations("categories");
  const tSubCategories = useTranslations("subCategories");

  const [open, setOpen] = useState(false);
  const [filterDate, setFilterDate] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.id === value);

  const sortedOptions = useMemo(() => {
    return [...options].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
  }, [options]);

  const filteredOptions = useMemo(() => {
    if (!filterDate) return sortedOptions;
    return sortedOptions.filter((exp) => isoDayKey(exp.date) === filterDate);
  }, [sortedOptions, filterDate]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      const target = e.target as Element;
      // The calendar opens in a popover outside this box; clicking in it is not "outside".
      if (target.closest?.("[data-radix-popper-content-wrapper]")) return;
      if (ref.current && !ref.current.contains(target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function handleDateChange(day: Date) {
    setFilterDate(dayKey(day));
  }

  function clearDateFilter(e: React.MouseEvent) {
    e.stopPropagation();
    setFilterDate(null);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between input-field text-left disabled:opacity-50"
      >
        <span className="flex items-center gap-2 min-w-0">
          {selected ? (
            <>
              <Receipt className="h-5 w-5 text-gray-500 dark:text-gray-400 shrink-0" />
              <span className="truncate">
                {formatOptionLabel(selected, currency, locale, tCommon)}
              </span>
            </>
          ) : (
            <span className="text-gray-400">{tTx("selectSettlementExpense")}</span>
          )}
        </span>
        <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" />
      </button>

      {open && (
        <div className="absolute z-20 mt-2 w-full rounded-xl bg-white dark:bg-gray-800 shadow-lg ring-1 ring-black/5 dark:ring-white/10 overflow-hidden">
          {/* Toolbar: calendar filter */}
          <div className="flex items-center gap-2 border-b border-gray-100 dark:border-gray-700 px-3 py-2">
            <DayPicker
              value={filterDate ? parseDate(filterDate) : new Date()}
              onChange={handleDateChange}
              locale={locale}
              trigger={
                <button
                  type="button"
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    filterDate
                      ? "bg-blue-500 text-white"
                      : "bg-gray-100 dark:bg-gray-900 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                  }`}
                >
                  <CalendarDays className="h-4 w-4" />
                  {tCommon("date")}
                </button>
              }
            />
            {filterDate && (
              <button
                type="button"
                onClick={clearDateFilter}
                className="flex items-center gap-1 rounded-lg bg-blue-50 dark:bg-blue-500/10 px-2.5 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400"
              >
                {formatDayLabel(new Date(`${filterDate}T00:00:00`), locale)}
                <X className="h-3 w-3" />
              </button>
            )}
            <span className="ml-auto text-[11px] text-gray-400">
              {tCommon("latestFirst")} · {tCommon("count", { count: filteredOptions.length })}
            </span>
          </div>

          <div className="max-h-52 overflow-auto">
            {filteredOptions.length === 0 ? (
              <p className="px-4 py-3 text-sm text-gray-400">
                {filterDate
                  ? tSettlement("noExpensesOnDate")
                  : tSettlement("noExpenses")}
              </p>
            ) : (
              <ul className="py-1">
                {filteredOptions.map((exp) => (
                  <li key={exp.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onChange(exp.id);
                        setOpen(false);
                      }}
                      className="w-full flex items-start gap-2 px-4 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                    >
                      <Receipt className="h-5 w-5 text-gray-500 dark:text-gray-400 shrink-0 mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">
                          {exp.merchant || tCommon("unspecified")}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                          {formatDayLabel(new Date(exp.date), locale)} ·{" "}
                          {translateCategory(exp.category, tCategories)} ›{" "}
                          {translateSubCategory(exp.sub_category, tSubCategories)} ·{" "}
                          {tCommon("original")}{" "}
                          {formatAmount(exp.amount, currency)}
                          {exp.settled_amount > 0 &&
                            ` · ${tCommon("settled")} ${formatAmount(exp.settled_amount, currency)}`}
                        </p>
                        <p className="text-xs font-semibold text-red-500">
                          {tCommon("remainingAmount")}{" "}
                          {formatAmount(exp.remaining_amount, currency)}
                        </p>
                      </div>
                      {value === exp.id && (
                        <Check className="h-4 w-4 text-blue-500 shrink-0" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
