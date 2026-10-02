"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Star } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  AccountType,
  DefaultRole,
  FinancialAccount,
  applicableDefaultRoles,
  resolveAccountCountry,
  setAccountDefault,
} from "@/lib/api";

/** Ledger tab (CAD/KRW) whose slot an account fills for a role. */
export function defaultSlotCurrency(
  account: FinancialAccount,
  role: DefaultRole
): "CAD" | "KRW" | null {
  if (role === "brokerage") {
    return resolveAccountCountry(account) === "KR" ? "KRW" : "CAD";
  }
  return account.currency === "CAD" || account.currency === "KRW"
    ? account.currency
    : null;
}

export function DefaultRoleBadges({ roles }: { roles: DefaultRole[] }) {
  const t = useTranslations("account");
  if (!roles.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {roles.map((role) => (
        <span
          key={role}
          className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-600 dark:bg-blue-950/50 dark:text-blue-300 whitespace-nowrap"
        >
          {t(`defaultBadge.${role}`)}
        </span>
      ))}
    </span>
  );
}

/** Star button that toggles this account's default roles in place. */
export function DefaultRoleMenu({
  account,
  accountType,
  onChanged,
}: {
  account: FinancialAccount;
  accountType: AccountType;
  onChanged: () => void;
}) {
  const t = useTranslations("account");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<DefaultRole | null>(null);
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const roles = applicableDefaultRoles(account).filter((role) =>
    defaultSlotCurrency(account, role)
  );

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (!account.is_active || roles.length === 0) return null;

  async function toggle(role: DefaultRole) {
    const currency = defaultSlotCurrency(account, role);
    if (!currency) return;
    setBusy(role);
    setFailed(false);
    try {
      const held = account.default_roles.includes(role);
      await setAccountDefault(accountType, currency, role, held ? null : account.id);
      onChanged();
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  }

  const hasAny = account.default_roles.length > 0;
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t("defaultMenuLabel")}
        aria-expanded={open}
        className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-amber-500 dark:hover:bg-gray-800"
      >
        <Star
          className={`h-4 w-4 ${hasAny ? "fill-amber-400 text-amber-400" : ""}`}
        />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-xl border border-gray-100 bg-white p-1.5 shadow-xl dark:border-gray-800 dark:bg-gray-900">
          <p className="px-2 py-1 text-[11px] font-semibold text-gray-400 dark:text-gray-500">
            {t("defaultMenuLabel")}
          </p>
          {roles.map((role) => {
            const held = account.default_roles.includes(role);
            return (
              <button
                key={role}
                type="button"
                disabled={busy !== null}
                onClick={() => toggle(role)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                  {busy === role ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : held ? (
                    <Check className="h-3.5 w-3.5 text-blue-500" />
                  ) : null}
                </span>
                <span className="truncate">{t(`defaultRole.${role}`)}</span>
              </button>
            );
          })}
          {failed && (
            <p className="px-2 py-1 text-xs text-red-600 dark:text-red-400">
              {t("defaultSaveFailed")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
