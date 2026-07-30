"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  addMonths,
  buildCalendarGrid,
  formatDayLabel,
  isSameDay,
  isSameMonth,
  monthLabel,
} from "@/lib/date";
import { cn } from "@/lib/utils";

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

type Props = {
  value: Date;
  onChange: (next: Date) => void;
  locale?: string;
  /** Extra classes for the trigger button. */
  triggerClassName?: string;
  /** Show calendar icon to the left of the date label. */
  showIcon?: boolean;
  /** Disable opening the calendar (locked / read-only). */
  disabled?: boolean;
};

/**
 * Shared day picker (MonthPicker-style popover).
 * Trigger shows the selected date; popover has month steppers and a day grid.
 */
export default function DayPicker({
  value,
  onChange,
  locale = "ko",
  triggerClassName,
  showIcon = true,
  disabled = false,
}: Props) {
  const t = useTranslations("common");
  const tCal = useTranslations("calendar");
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(
    () => new Date(value.getFullYear(), value.getMonth(), 1)
  );

  const weekdays = useMemo(
    () => WEEKDAY_KEYS.map((key) => tCal(`weekdays.${key}`)),
    [tCal]
  );
  const cells = useMemo(() => buildCalendarGrid(viewMonth), [viewMonth]);
  const today = useMemo(() => new Date(), []);

  useEffect(() => {
    if (open) {
      setViewMonth(new Date(value.getFullYear(), value.getMonth(), 1));
    }
  }, [open, value]);

  function selectDay(day: Date) {
    onChange(new Date(day.getFullYear(), day.getMonth(), day.getDate()));
    setOpen(false);
  }

  return (
    <Popover
      open={disabled ? false : open}
      onOpenChange={(next) => {
        if (!disabled) setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={t("selectDate")}
          className={cn(
            "w-full flex items-center gap-3 rounded-2xl bg-blue-50 dark:bg-blue-500/10 px-4 py-3 text-left hover:bg-blue-100/80 dark:hover:bg-blue-500/20 transition-colors disabled:opacity-60 disabled:pointer-events-none",
            triggerClassName
          )}
        >
          {showIcon && (
            <CalendarDays className="h-5 w-5 text-blue-500 shrink-0" />
          )}
          <p className="min-w-0 flex-1 text-sm font-semibold text-gray-900 dark:text-white truncate">
            {formatDayLabel(value, locale)}
          </p>
        </button>
      </PopoverTrigger>
      <PopoverContent className="z-[110] w-[300px] p-3" align="start">
        <div className="mb-3 flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("previousMonth")}
            onClick={() => setViewMonth((m) => addMonths(m, -1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <p className="text-sm font-semibold tabular-nums text-gray-900 dark:text-white">
            {monthLabel(viewMonth, locale)}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("nextMonth")}
            onClick={() => setViewMonth((m) => addMonths(m, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="mb-1 grid grid-cols-7 gap-0.5">
          {weekdays.map((label, i) => (
            <div
              key={WEEKDAY_KEYS[i]}
              className={cn(
                "py-1 text-center text-[10px] font-semibold",
                i === 0
                  ? "text-red-400"
                  : i === 6
                    ? "text-blue-400"
                    : "text-gray-400 dark:text-gray-500"
              )}
            >
              {label}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-0.5">
          {cells.map((cell) => {
            const inMonth = isSameMonth(cell, viewMonth);
            const selected = isSameDay(cell, value);
            const isToday = isSameDay(cell, today);
            return (
              <button
                key={cell.toISOString()}
                type="button"
                onClick={() => selectDay(cell)}
                className={cn(
                  "h-9 w-full rounded-lg text-sm font-medium tabular-nums transition-colors",
                  !inMonth && "opacity-35",
                  selected
                    ? "bg-blue-500 text-white shadow-sm"
                    : isToday
                      ? "bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400"
                      : "text-gray-800 hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-gray-800"
                )}
              >
                {cell.getDate()}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
