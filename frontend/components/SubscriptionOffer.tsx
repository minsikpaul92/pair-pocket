"use client";

import { Repeat, X } from "lucide-react";
import { useTranslations } from "next-intl";

interface Props {
  count: number;
  onStart: () => void;
  onDismiss: () => void;
}

/** Asks whether just-saved subscription entries should also repeat from Fixed expenses. */
export default function SubscriptionOffer({ count, onStart, onDismiss }: Props) {
  const t = useTranslations("subscriptionOffer");
  return (
    <div className="fixed inset-x-4 bottom-24 z-[120] mx-auto max-w-md rounded-2xl border border-indigo-100 bg-white p-4 shadow-xl dark:border-indigo-900/50 dark:bg-gray-900 lg:bottom-6">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-300">
          <Repeat className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-gray-900 dark:text-white">
            {t("title", { count })}
          </p>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{t("hint")}</p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={onStart}
              className="rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
            >
              {t("register")}
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-xl bg-gray-100 px-3.5 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              {t("notNow")}
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t("notNow")}
          className="shrink-0 rounded-lg p-1.5 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
