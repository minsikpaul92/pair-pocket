"use client";

import { useMemo } from "react";

import {
  Currency,
  LedgerScope,
  Transaction,
  effectiveExpenseAmount,
  formatAmount,
} from "@/lib/api";
import {
  buildCalendarGrid,
  dayKey,
  isSameDay,
  isSameMonth,
  isoDayKey,
} from "@/lib/date";

interface Props {
  month: Date;
  scope: LedgerScope;
  transactions: Transaction[];
  onDayClick: (date: Date) => void;
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

interface SingleDayTotals {
  income: number;
  expense: number;
  count: number;
}

interface AllDayTotals {
  cadIncome: number;
  krwIncome: number;
  cadExpense: number;
  krwExpense: number;
  count: number;
}

function accumulate(
  map: Map<string, SingleDayTotals | AllDayTotals>,
  key: string,
  tx: Transaction,
  scope: LedgerScope
) {
  if (scope === "ALL") {
    const entry = (map.get(key) as AllDayTotals | undefined) ?? {
      cadIncome: 0,
      krwIncome: 0,
      cadExpense: 0,
      krwExpense: 0,
      count: 0,
    };
    const amt =
      tx.type === "expense" ? effectiveExpenseAmount(tx) : tx.amount;
    if (tx.type === "income") {
      if (tx.currency === "CAD") entry.cadIncome += amt;
      else entry.krwIncome += amt;
    } else {
      if (tx.currency === "CAD") entry.cadExpense += amt;
      else entry.krwExpense += amt;
    }
    entry.count += 1;
    map.set(key, entry);
    return;
  }

  const entry = (map.get(key) as SingleDayTotals | undefined) ?? {
    income: 0,
    expense: 0,
    count: 0,
  };
  if (tx.type === "income") entry.income += tx.amount;
  else entry.expense += effectiveExpenseAmount(tx);
  entry.count += 1;
  map.set(key, entry);
}

export default function CalendarView({
  month,
  scope,
  transactions,
  onDayClick,
}: Props) {
  const cells = useMemo(() => buildCalendarGrid(month), [month]);
  const today = new Date();
  const displayCurrency = scope === "ALL" ? "CAD" : scope;

  const perDay = useMemo(() => {
    const map = new Map<string, SingleDayTotals | AllDayTotals>();
    for (const tx of transactions) {
      accumulate(map, isoDayKey(tx.date), tx, scope);
    }
    return map;
  }, [transactions, scope]);

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
              className={`group relative flex flex-col items-center rounded-2xl border transition-all active:scale-[0.97] min-h-[5.5rem] sm:min-h-[7rem] py-2 px-0.5 ${
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
                    {scope === "ALL" ? (
                      <>
                        {(totals as AllDayTotals).cadIncome > 0 && (
                          <span className="max-w-full truncate text-[9px] sm:text-[10px] font-semibold whitespace-nowrap text-blue-500">
                            {formatAmount((totals as AllDayTotals).cadIncome, "CAD")}
                          </span>
                        )}
                        {(totals as AllDayTotals).krwIncome > 0 && (
                          <span className="max-w-full truncate text-[9px] sm:text-[10px] font-semibold whitespace-nowrap text-blue-500">
                            {formatAmount((totals as AllDayTotals).krwIncome, "KRW")}
                          </span>
                        )}
                        {(totals as AllDayTotals).cadExpense > 0 && (
                          <span className="max-w-full truncate text-[9px] sm:text-[10px] font-semibold whitespace-nowrap text-red-500">
                            {formatAmount((totals as AllDayTotals).cadExpense, "CAD")}
                          </span>
                        )}
                        {(totals as AllDayTotals).krwExpense > 0 && (
                          <span className="max-w-full truncate text-[9px] sm:text-[10px] font-semibold whitespace-nowrap text-red-500">
                            {formatAmount((totals as AllDayTotals).krwExpense, "KRW")}
                          </span>
                        )}
                      </>
                    ) : (
                      <>
                        {(totals as SingleDayTotals).income > 0 && (
                          <span className="max-w-full truncate text-[10px] sm:text-[11px] font-semibold whitespace-nowrap text-blue-500">
                            {formatAmount((totals as SingleDayTotals).income, displayCurrency)}
                          </span>
                        )}
                        {(totals as SingleDayTotals).expense > 0 && (
                          <span className="max-w-full truncate text-[10px] sm:text-[11px] font-semibold whitespace-nowrap text-red-500">
                            {formatAmount((totals as SingleDayTotals).expense, displayCurrency)}
                          </span>
                        )}
                      </>
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
