"use client";

import { Check, ChevronDown, Globe } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface LanguageOption {
  code: string;
  /** Name in the language itself, shown in the list. */
  native: string;
}

interface Props {
  value: string;
  options: LanguageOption[];
  onChange: (code: string) => void;
  ariaLabel: string;
  disabled?: boolean;
}

/** Dropdown for picking a language; the list is as wide as the button. */
export default function LanguageSelect({
  value,
  options,
  onChange,
  ariaLabel,
  disabled = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.code === value) ?? options[0];

  function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>("[role=option]") ?? []
    );
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
          className="flex w-full items-center gap-3 rounded-2xl bg-blue-50 px-4 py-3 text-left transition-colors hover:bg-blue-100/80 disabled:pointer-events-none disabled:opacity-60 dark:bg-blue-500/10 dark:hover:bg-blue-500/20"
        >
          <Globe className="h-5 w-5 shrink-0 text-blue-500" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900 dark:text-white">
            {selected?.native}
          </span>
          <span className="shrink-0 rounded-md bg-white px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-600 dark:bg-gray-800 dark:text-blue-300">
            {selected?.code}
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
        className="z-[110] w-[var(--radix-popover-trigger-width)] p-1.5"
      >
        <div
          ref={listRef}
          role="listbox"
          aria-label={ariaLabel}
          onKeyDown={moveFocus}
          className="flex flex-col gap-0.5"
        >
          {options.map((option) => {
            const active = option.code === value;
            return (
              <button
                key={option.code}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  setOpen(false);
                  if (!active) onChange(option.code);
                }}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
                  active
                    ? "bg-blue-50 font-semibold text-blue-700 dark:bg-blue-500/15 dark:text-blue-200"
                    : "text-gray-800 hover:bg-gray-50 dark:text-gray-100 dark:hover:bg-gray-800"
                )}
              >
                <span className="min-w-0 flex-1 truncate">{option.native}</span>
                <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-gray-400">
                  {option.code}
                </span>
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
