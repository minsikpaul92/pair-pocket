"use client";

import { useMemo } from "react";

import { Currency, Transaction, formatAmount } from "@/lib/api";
import {
  buildCalendarGrid,
  dayKey,
  isSameDay,
  isSameMonth,
  isoDayKey,
} from "@/lib/date";

interface Props {
  month: Date;
  currency: Currency;
  transactions: Transaction[];
  onDayClick: (date: Date) => void;
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

interface DayTotals {
  income: number;
  expense: number;
  count: number;
}

export default function CalendarView({
  month,
  currency,
  transactions,
  onDayClick,
}: Props) {
  const cells = useMemo(() => buildCalendarGrid(month), [month]);
  const today = new Date();

  const perDay = useMemo(() => {
    const map = new Map<string, DayTotals>();
    for (const tx of transactions) {
      const key = isoDayKey(tx.date);
      const entry = map.get(key) ?? { income: 0, expense: 0, count: 0 };
      if (tx.type === "income") entry.income += tx.amount;
      else entry.expense += tx.amount;
      entry.count += 1;
      map.set(key, entry);
    }
    return map;
  }, [transactions]);

  return (
    <section className="card-inset p-4 sm:p-5">
      <div className="grid grid-cols-7 gap-px mb-2">
        {WEEKDAYS.map((w, i) => (
          <div
            key={w}
            className={`py-2 text-center text-xs font-semibold ${
              i === 0
                ? "text-red-400"
                : i === 6
                  ? "text-blue-400"
                  : "text-gray-400 dark:text-gray-500"
            }`}
          >
            {w}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
        {cells.map((cell) => {
          const key = dayKey(cell);
          const inMonth = isSameMonth(cell, month);
          const isToday = isSameDay(cell, today);
          const totals = perDay.get(key);
          const hasTx = totals !== undefined && totals.count > 0;

          return (
            <button
              key={key}
              type="button"
              onClick={() => onDayClick(cell)}
              className={`group relative flex flex-col items-center rounded-2xl border transition-all active:scale-[0.97] min-h-[5rem] sm:min-h-[6rem] py-2 px-0.5 ${
                inMonth
                  ? "border-transparent hover:border-gray-200 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700/50"
                  : "border-transparent opacity-35"
              } ${hasTx ? "bg-gray-50/80 dark:bg-gray-900/40" : ""}`}
            >
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
                  isToday
                    ? "bg-blue-500 font-bold text-white shadow-sm"
                    : "text-gray-800 dark:text-gray-100"
                }`}
              >
                {cell.getDate()}
              </span>

              {hasTx && totals && (
                <>
                  <span className="mt-0.5 text-[10px] font-medium text-gray-400 dark:text-gray-500">
                    {totals.count}건
                  </span>
                  <div className="mt-auto flex w-full flex-col items-center gap-0.5 px-0.5">
                    {totals.income > 0 && (
                      <span className="max-w-full truncate text-[10px] sm:text-[11px] font-semibold whitespace-nowrap text-blue-500">
                        {formatAmount(totals.income, currency)}
                      </span>
                    )}
                    {totals.expense > 0 && (
                      <span className="max-w-full truncate text-[10px] sm:text-[11px] font-semibold whitespace-nowrap text-red-500">
                        {formatAmount(totals.expense, currency)}
                      </span>
                    )}
                  </div>
                </>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
