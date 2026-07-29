"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { monthLabel } from "@/lib/date";
import { cn } from "@/lib/utils";

type Props = {
  value: Date;
  onChange: (next: Date) => void;
  locale?: string;
  /** Extra classes for the title trigger button. */
  triggerClassName?: string;
  /** Title text size/style for the large page heading look. */
  titleClassName?: string;
};

function monthNames(locale: string): string[] {
  return Array.from({ length: 12 }, (_, i) =>
    new Intl.DateTimeFormat(locale, { month: "short" }).format(
      new Date(2000, i, 1)
    )
  );
}

/**
 * Shared year/month picker (no day).
 * Trigger shows the current month label; popover has year steppers and a 3×4 month grid.
 */
export default function MonthPicker({
  value,
  onChange,
  locale = "ko",
  triggerClassName,
  titleClassName,
}: Props) {
  const t = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(value.getFullYear());
  const labels = useMemo(() => monthNames(locale), [locale]);

  useEffect(() => {
    if (open) setViewYear(value.getFullYear());
  }, [open, value]);

  const selectedYear = value.getFullYear();
  const selectedMonth = value.getMonth();

  function selectMonth(monthIndex: number) {
    onChange(new Date(viewYear, monthIndex, 1));
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("selectMonth")}
          className={cn(
            "rounded-xl px-1 -mx-1 text-left transition-colors hover:bg-gray-100 dark:hover:bg-gray-800/60",
            triggerClassName
          )}
        >
          <span
            className={cn(
              "text-3xl font-bold tracking-tight text-gray-900 dark:text-white",
              titleClassName
            )}
          >
            {monthLabel(value, locale)}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-3" align="start">
        <div className="mb-3 flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("previousYear")}
            onClick={() => setViewYear((y) => y - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <p className="text-sm font-semibold tabular-nums text-gray-900 dark:text-white">
            {viewYear}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("nextYear")}
            onClick={() => setViewYear((y) => y + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {labels.map((label, index) => {
            const selected =
              viewYear === selectedYear && index === selectedMonth;
            return (
              <Button
                key={label}
                type="button"
                variant={selected ? "default" : "secondary"}
                size="sm"
                className={cn(
                  "h-10 w-full font-medium",
                  selected && "shadow-sm"
                )}
                onClick={() => selectMonth(index)}
              >
                {label}
              </Button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
