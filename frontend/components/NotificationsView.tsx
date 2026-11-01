"use client";

import { Loader2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import {
  type AppNotification,
  fetchNotifications,
  formatAmount,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/api";
import { translateCategory } from "@/lib/category-i18n";
import {
  WHATS_NEW,
  hasUnseenWhatsNew,
  markWhatsNewSeen,
} from "@/lib/whats-new";

type Tab = "alerts" | "whatsNew";

interface Props {
  /** Called after any read change with the server's unread count. */
  onUnreadChange: (count: number) => void;
  onOpenNotification: (item: AppNotification) => void;
}

export default function NotificationsView({
  onUnreadChange,
  onOpenNotification,
}: Props) {
  const t = useTranslations("notifications");
  const tNew = useTranslations("whatsNew");
  const tCategories = useTranslations("categories");
  const locale = useLocale();

  const [tab, setTab] = useState<Tab>("alerts");
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [unseenNew, setUnseenNew] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await fetchNotifications());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
    setUnseenNew(hasUnseenWhatsNew());
  }, [load]);

  function showTab(next: Tab) {
    setTab(next);
    if (next === "whatsNew") {
      markWhatsNewSeen();
      setUnseenNew(false);
    }
  }

  async function readAll() {
    await markAllNotificationsRead().catch(() => null);
    setItems((prev) => prev?.map((n) => ({ ...n, is_read: true })) ?? prev);
    onUnreadChange(0);
  }

  async function open(item: AppNotification) {
    if (!item.is_read) {
      setItems((prev) =>
        prev?.map((n) => (n.id === item.id ? { ...n, is_read: true } : n)) ?? prev
      );
      markNotificationRead(item.id)
        .then(onUnreadChange)
        .catch(() => null);
    }
    onOpenNotification(item);
  }

  const dateFmt = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  });
  const unread = items?.filter((n) => !n.is_read).length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          {t("title")}
        </h2>
        {tab === "alerts" && unread > 0 && (
          <button
            type="button"
            onClick={readAll}
            className="shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-semibold text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/30"
          >
            {t("markAllRead")}
          </button>
        )}
      </div>

      <div className="flex rounded-xl bg-gray-100 dark:bg-gray-800 p-1">
        {(["alerts", "whatsNew"] as Tab[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => showTab(k)}
            className={`relative flex-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === k
                ? "bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-white"
                : "text-gray-500 dark:text-gray-400"
            }`}
          >
            {t(k === "alerts" ? "tabAlerts" : "tabWhatsNew")}
            {((k === "alerts" && unread > 0) ||
              (k === "whatsNew" && unseenNew)) && (
              <span
                aria-hidden
                className="absolute right-2 top-1.5 h-1.5 w-1.5 rounded-full bg-red-500"
              />
            )}
          </button>
        ))}
      </div>

      {tab === "alerts" ? (
        items === null && !failed ? (
          <div className="flex justify-center py-10 text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : failed ? (
          <p className="py-10 text-center text-sm text-gray-500 dark:text-gray-400">
            {t("loadFailed")}
          </p>
        ) : items && items.length === 0 ? (
          <p className="py-10 text-center text-sm text-gray-500 dark:text-gray-400">
            {t("empty")}
          </p>
        ) : (
          <ul className="space-y-2">
            {items?.map((n) => {
              const actor = n.actor_name || t("partnerFallback");
              const category = translateCategory(n.category, tCategories);
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => open(n)}
                    className={`flex w-full items-start gap-3 rounded-2xl border px-4 py-3 text-left transition-colors ${
                      n.is_read
                        ? "border-gray-100 bg-white hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-gray-800/60"
                        : "border-blue-100 bg-blue-50/60 hover:bg-blue-50 dark:border-blue-900/40 dark:bg-blue-950/20 dark:hover:bg-blue-950/30"
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                        n.is_read ? "bg-transparent" : "bg-blue-500"
                      }`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-gray-900 dark:text-white">
                        {t(n.tx_type === "income" ? "addedIncome" : "addedExpense", {
                          name: actor,
                        })}
                      </span>
                      <span className="mt-0.5 flex items-baseline justify-between gap-3">
                        <span className="min-w-0 truncate text-sm font-medium text-gray-700 dark:text-gray-200">
                          {n.merchant}
                        </span>
                        <span className="shrink-0 whitespace-nowrap text-sm font-semibold tabular-nums text-gray-900 dark:text-white">
                          {formatAmount(n.amount, n.currency)}
                        </span>
                      </span>
                      <span className="mt-0.5 flex items-center justify-between gap-3 text-xs text-gray-500 dark:text-gray-400">
                        <span className="min-w-0 truncate">{category}</span>
                        <span className="shrink-0 whitespace-nowrap">
                          {dateFmt.format(new Date(`${n.created_at}Z`))}
                        </span>
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )
      ) : (
        <ul className="space-y-3">
          {WHATS_NEW.map((entry) => (
            <li
              key={entry.id}
              className="card-inset space-y-1.5 p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="min-w-0 text-sm font-semibold text-gray-900 dark:text-white">
                  {tNew(`items.${entry.id}.title`)}
                </h3>
                <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-gray-400">
                  v{entry.version}
                </span>
              </div>
              <p className="text-xs leading-relaxed text-gray-600 dark:text-gray-400">
                {tNew(`items.${entry.id}.description`)}
              </p>
              <p className="text-xs tabular-nums text-gray-400">
                {dateFmt.format(new Date(`${entry.date}T00:00:00`))}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
