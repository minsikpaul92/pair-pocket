"use client";

import { Bell } from "lucide-react";
import { useTranslations } from "next-intl";

interface Props {
  count: number;
  active: boolean;
  onClick: () => void;
}

export default function NotificationBell({ count, active, onClick }: Props) {
  const t = useTranslations("notifications");
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t("open")}
      aria-pressed={active}
      className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
        active
          ? "bg-blue-500 text-white"
          : "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-white"
      }`}
    >
      <Bell className="h-5 w-5" />
      {count > 0 && (
        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center whitespace-nowrap rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none tabular-nums text-white">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </button>
  );
}
