"use client";

import { Check, ChevronDown, Plus, Wallet } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import {
  ACCOUNT_KIND_KEYS,
  FinancialAccount,
  accountLabel,
} from "@/lib/api";

/** Empty string means none / cash — no linked financial account. */
export const ACCOUNT_NONE = "";

interface Props {
  accounts: FinancialAccount[];
  value: string;
  onChange: (accountId: string) => void;
  onRegister: () => void;
  disabled?: boolean;
  allowNone?: boolean;
  placeholder?: string;
  variant?: "compact" | "field";
  filterAccounts?: (account: FinancialAccount) => boolean;
}

export default function AccountSelect({
  accounts,
  value,
  onChange,
  onRegister,
  disabled = false,
  allowNone = true,
  placeholder,
  variant = "compact",
  filterAccounts,
}: Props) {
  const t = useTranslations("account");
  const tKinds = useTranslations("accountKinds");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const visible = filterAccounts ? accounts.filter(filterAccounts) : accounts;
  const selected =
    visible.find((a) => a.id === value) ??
    accounts.find((a) => a.id === value);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function formatAccountDetail(account: FinancialAccount): string {
    const parts = [
      tKinds(ACCOUNT_KIND_KEYS[account.kind]),
      account.kind === "credit_card" && account.last_four
        ? `···${account.last_four}`
        : null,
      account.kind !== "credit_card" && account.account_number
        ? account.account_number
        : null,
    ].filter(Boolean);
    return parts.join(" · ");
  }

  const triggerLabel = selected
    ? accountLabel(selected)
    : value === ACCOUNT_NONE && allowNone
      ? t("noneCash")
      : (placeholder ?? t("select"));

  const triggerClass =
    variant === "field"
      ? "w-full flex items-center justify-between gap-2 rounded-xl bg-gray-50 dark:bg-gray-900 px-4 py-3 text-sm font-medium text-gray-900 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
      : "flex items-center gap-1 rounded-lg bg-gray-100 dark:bg-gray-800 px-2.5 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 max-w-[9rem]";

  const menuClass =
    variant === "field"
      ? "absolute left-0 right-0 z-30 mt-1.5 max-h-64 overflow-auto rounded-xl bg-white dark:bg-gray-800 shadow-lg ring-1 ring-black/5 dark:ring-white/10"
      : "absolute right-0 z-30 mt-1.5 w-56 max-h-64 overflow-auto rounded-xl bg-white dark:bg-gray-800 shadow-lg ring-1 ring-black/5 dark:ring-white/10";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={triggerClass}
      >
        <span className="truncate">{triggerLabel}</span>
        <ChevronDown className="h-3.5 w-3.5 text-gray-400 shrink-0" />
      </button>

      {open && (
        <div className={menuClass}>
          <ul className="py-1">
            {allowNone && (
              <li>
                <button
                  type="button"
                  onClick={() => {
                    onChange(ACCOUNT_NONE);
                    setOpen(false);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  <Wallet className="h-4 w-4 text-gray-400 shrink-0" />
                  <span className="flex-1">{t("noneCashLong")}</span>
                  {value === ACCOUNT_NONE && (
                    <Check className="h-4 w-4 text-blue-500 shrink-0" />
                  )}
                </button>
              </li>
            )}
            {visible.map((acc) => (
              <li key={acc.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(acc.id);
                    setOpen(false);
                  }}
                  className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">
                      {accountLabel(acc)}
                    </p>
                    <p className="text-[11px] text-gray-400 truncate">
                      {formatAccountDetail(acc)}
                    </p>
                  </div>
                  {value === acc.id && (
                    <Check className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
                  )}
                </button>
              </li>
            ))}
            {visible.length === 0 && (
              <li className="px-3 py-2 text-sm text-gray-400">
                {t("noAccounts")}
              </li>
            )}
          </ul>
          <div className="border-t border-gray-100 dark:border-gray-700 p-1">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onRegister();
              }}
              className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors"
            >
              <Plus className="h-4 w-4" />
              {t("addCardBank")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
