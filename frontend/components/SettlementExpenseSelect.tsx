"use client";

import { CalendarDays, Check, ChevronDown, Receipt, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Currency, SettleableExpense, formatAmount } from "@/lib/api";
import { dayKey, formatDayLabel, isoDayKey } from "@/lib/date";

interface Props {
  options: SettleableExpense[];
  value: string;
  onChange: (expenseId: string) => void;
  currency: Currency;
  disabled?: boolean;
}

function formatOptionLabel(exp: SettleableExpense, currency: Currency): string {
  const d = new Date(exp.date);
  const dateStr = `${d.getMonth() + 1}/${d.getDate()}`;
  const remaining = formatAmount(exp.remaining_amount, currency);
  return `${dateStr} · ${exp.merchant} · ${remaining} 남음`;
}

export default function SettlementExpenseSelect({
  options,
  value,
  onChange,
  currency,
  disabled = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [filterDate, setFilterDate] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);

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
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setShowDatePicker(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function handleCalendarClick(e: React.MouseEvent) {
    e.stopPropagation();
    setShowDatePicker((v) => !v);
    if (!showDatePicker) {
      setTimeout(() => dateInputRef.current?.showPicker?.(), 0);
    }
  }

  function handleDateChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value || null;
    setFilterDate(next);
    setShowDatePicker(false);
  }

  function clearDateFilter(e: React.MouseEvent) {
    e.stopPropagation();
    setFilterDate(null);
    setShowDatePicker(false);
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
                {formatOptionLabel(selected, currency)}
              </span>
            </>
          ) : (
            <span className="text-gray-400">정산 대상 지출 선택</span>
          )}
        </span>
        <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" />
      </button>

      {open && (
        <div className="absolute z-20 mt-2 w-full rounded-xl bg-white dark:bg-gray-800 shadow-lg ring-1 ring-black/5 dark:ring-white/10 overflow-hidden">
          {/* Toolbar: calendar filter */}
          <div className="flex items-center gap-2 border-b border-gray-100 dark:border-gray-700 px-3 py-2">
            <button
              type="button"
              onClick={handleCalendarClick}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                filterDate || showDatePicker
                  ? "bg-blue-500 text-white"
                  : "bg-gray-100 dark:bg-gray-900 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
              }`}
            >
              <CalendarDays className="h-4 w-4" />
              날짜
            </button>
            {filterDate && (
              <button
                type="button"
                onClick={clearDateFilter}
                className="flex items-center gap-1 rounded-lg bg-blue-50 dark:bg-blue-500/10 px-2.5 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400"
              >
                {formatDayLabel(new Date(`${filterDate}T00:00:00`))}
                <X className="h-3 w-3" />
              </button>
            )}
            <span className="ml-auto text-[11px] text-gray-400">
              최신순 · {filteredOptions.length}건
            </span>
          </div>

          {/* Hidden date input triggered by calendar button */}
          {showDatePicker && (
            <div className="border-b border-gray-100 dark:border-gray-700 px-3 py-2">
              <input
                ref={dateInputRef}
                type="date"
                value={filterDate ?? dayKey(new Date())}
                onChange={handleDateChange}
                className="w-full rounded-lg bg-gray-50 dark:bg-gray-900 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
          )}

          <div className="max-h-52 overflow-auto">
            {filteredOptions.length === 0 ? (
              <p className="px-4 py-3 text-sm text-gray-400">
                {filterDate
                  ? "선택한 날짜에 정산 가능한 지출이 없습니다."
                  : "정산 가능한 지출이 없습니다."}
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
                        setShowDatePicker(false);
                      }}
                      className="w-full flex items-start gap-2 px-4 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                    >
                      <Receipt className="h-5 w-5 text-gray-500 dark:text-gray-400 shrink-0 mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">
                          {exp.merchant}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                          {formatDayLabel(new Date(exp.date))} · {exp.category}{" "}
                          › {exp.sub_category} · 원래{" "}
                          {formatAmount(exp.amount, currency)}
                          {exp.settled_amount > 0 &&
                            ` · 정산됨 ${formatAmount(exp.settled_amount, currency)}`}
                        </p>
                        <p className="text-xs font-semibold text-red-500">
                          남은 금액{" "}
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
