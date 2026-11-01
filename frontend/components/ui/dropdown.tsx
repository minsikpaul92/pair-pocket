"use client";

import { Check, ChevronDown } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface DropdownOption {
  value: string;
  label: string;
}

interface Props {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  /** Shown when `value` matches no option (for example an empty choice). */
  placeholder?: string;
  disabled?: boolean;
  /** "sm" for dense rows such as table cells and review lists. */
  size?: "md" | "sm";
  className?: string;
}

/**
 * The one dropdown for choosing a single value. Use it instead of the
 * native select element so every list looks and behaves the same (see CLAUDE.md).
 */
export default function Dropdown({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder = "",
  disabled = false,
  size = "md",
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>("[role=option]") ?? []
    );
    if (items.length === 0) return;
    const index = items.findIndex((el) => el === document.activeElement);
    const next =
      event.key === "ArrowDown"
        ? (index + 1) % items.length
        : (index - 1 + items.length) % items.length;
    items[next]?.focus();
  }

  return (
    <Popover open={disabled ? false : open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={cn(
            "flex w-full min-w-0 items-center gap-2 rounded-xl border border-gray-200 bg-white text-left font-semibold text-gray-800 transition-colors hover:border-gray-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:pointer-events-none disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:border-gray-600",
            size === "sm" ? "px-3 py-2 text-xs" : "px-3.5 py-3 text-sm",
            className
          )}
        >
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              !selected && "font-normal text-gray-400"
            )}
          >
            {selected?.label ?? placeholder}
          </span>
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-gray-400 transition-transform",
              open && "rotate-180"
            )}
            aria-hidden
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="z-[130] w-[var(--radix-popover-trigger-width)] min-w-[10rem] p-1.5"
      >
        <div
          ref={listRef}
          role="listbox"
          aria-label={ariaLabel}
          onKeyDown={moveFocus}
          className="flex max-h-64 flex-col gap-0.5 overflow-y-auto"
        >
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  setOpen(false);
                  if (!active) onChange(option.value);
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
                  active
                    ? "bg-blue-50 font-semibold text-blue-700 dark:bg-blue-500/15 dark:text-blue-200"
                    : "text-gray-800 hover:bg-gray-50 dark:text-gray-100 dark:hover:bg-gray-800"
                )}
              >
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                <Check
                  className={cn(
                    "h-4 w-4 shrink-0 text-blue-600 dark:text-blue-300",
                    active ? "opacity-100" : "opacity-0"
                  )}
                  aria-hidden
                />
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
