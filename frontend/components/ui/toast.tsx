"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, CheckCircle2, X } from "lucide-react";

export interface ToastInput {
  kind: "success" | "error";
  title: string;
  /** Short detail lines under the title (date, amount, merchant, error reason). */
  lines?: string[];
  action?: { label: string; onClick: () => void };
}

interface ToastItem extends ToastInput {
  id: number;
}

// A tiny store so any code can call showToast() and one <Toaster /> renders it.
let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const EMPTY: ToastItem[] = [];

function emit() {
  listeners.forEach((l) => l());
}

export function dismissToast(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

export function showToast(input: ToastInput) {
  const id = nextId++;
  items = [...items.slice(-2), { ...input, id }];
  emit();
  setTimeout(() => dismissToast(id), input.kind === "error" ? 8000 : 4000);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function Toaster() {
  const tCommon = useTranslations("common");
  const toasts = useSyncExternalStore(
    subscribe,
    () => items,
    () => EMPTY
  );
  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-[calc(4.35rem+max(0.5rem,env(safe-area-inset-bottom)))] z-[60] flex flex-col items-center gap-2 md:bottom-8">
      {toasts.map((t) => {
        const ok = t.kind === "success";
        const Icon = ok ? CheckCircle2 : AlertCircle;
        return (
          <div
            key={t.id}
            role={ok ? "status" : "alert"}
            className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-gray-100 bg-white p-3 shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200 motion-reduce:animate-none dark:border-gray-800 dark:bg-gray-900"
          >
            <Icon
              className={`mt-0.5 h-5 w-5 shrink-0 ${ok ? "text-emerald-500" : "text-red-500"}`}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-900 dark:text-white">
                {t.title}
              </p>
              {t.lines?.map((line, i) => (
                <p
                  key={i}
                  className="truncate text-xs tabular-nums text-gray-500 dark:text-gray-400"
                >
                  {line}
                </p>
              ))}
              {t.action && (
                <button
                  type="button"
                  onClick={() => {
                    dismissToast(t.id);
                    t.action?.onClick();
                  }}
                  className="mt-1.5 whitespace-nowrap text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400"
                >
                  {t.action.label}
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismissToast(t.id)}
              className="shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              aria-label={tCommon("close")}
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
