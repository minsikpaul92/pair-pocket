"use client";

import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import {
  type Currency,
  type UserSettings,
  formatAmount,
  updateBudget,
  updateBudgetCarry,
} from "@/lib/api";
import type { AccountType } from "@/lib/api";
import type { BudgetCurrency } from "@/lib/dashboard-layout";
import { useEscapeKey } from "@/lib/useEscapeKey";

interface Props {
  accountType: AccountType;
  /** One input per currency: just the ledger's own, or CAD and KRW on All. */
  currencies: BudgetCurrency[];
  settings: UserSettings | null;
  /** The month being viewed (YYYY-MM); the carry choice applies to it. */
  month: string;
  /** Last month's overspend that would be deducted, in `currency`. */
  overspend: number;
  currency: Currency;
  onSaved: (settings: UserSettings) => void;
  onClose: () => void;
}

export default function BudgetQuickModal({
  accountType,
  currencies,
  settings,
  month,
  overspend,
  currency,
  onSaved,
  onClose,
}: Props) {
  const t = useTranslations("dashboard");
  const titleId = useId();
  useEscapeKey(onClose);
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      currencies.map((c) => {
        const saved = settings?.budgets?.[accountType]?.[c];
        return [c, saved ? String(saved) : ""];
      })
    )
  );
  const wasSkipped = (
    settings?.budget_carry_skipped?.[accountType] ?? []
  ).includes(month);
  const [carry, setCarry] = useState(!wasSkipped);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(false);
    try {
      let next = settings;
      for (const currency of currencies) {
        const amount = Number(drafts[currency] || 0);
        const current = settings?.budgets?.[accountType]?.[currency] ?? 0;
        if (!Number.isFinite(amount) || amount < 0 || amount === current) continue;
        next = await updateBudget({ kind: accountType, currency, amount });
      }
      if (carry === wasSkipped) {
        next = await updateBudgetCarry({ kind: accountType, month, carry });
      }
      if (next) onSaved(next);
      onClose();
    } catch {
      setError(true);
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={submit}
        className="w-full max-w-xs space-y-4 rounded-2xl bg-white p-5 shadow-xl dark:bg-gray-900"
      >
        <h3 id={titleId} className="text-base font-bold tracking-tight text-gray-900 dark:text-white">
          {t("budgetModalTitle")}
        </h3>
        <div className="space-y-2">
          {currencies.map((c, i) => (
            <label key={c} className="flex items-center gap-2">
              <span className="w-10 shrink-0 text-xs font-semibold text-gray-500 dark:text-gray-400">
                {c}
              </span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                autoFocus={i === 0}
                value={drafts[c]}
                onChange={(e) => setDrafts((d) => ({ ...d, [c]: e.target.value }))}
                className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-right text-base tabular-nums text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
              />
            </label>
          ))}
        </div>
        {(overspend > 0 || wasSkipped) && (
          <label className="flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              checked={carry}
              onChange={(e) => setCarry(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-blue-600"
            />
            <span className="text-xs leading-snug text-gray-600 dark:text-gray-300">
              {t("budgetCarryOption")}
              {overspend > 0 && (
                <span className="block text-gray-500 dark:text-gray-400">
                  {t("budgetCarryAmount", {
                    over: formatAmount(overspend, currency),
                  })}
                </span>
              )}
            </span>
          </label>
        )}
        {error && (
          <p className="text-xs text-red-500" role="alert">{t("budgetSaveError")}</p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="whitespace-nowrap rounded-xl px-4 py-2 text-sm font-medium text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            {t("budgetCancel")}
          </button>
          <button
            type="submit"
            disabled={saving}
            className="whitespace-nowrap rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {t("budgetOk")}
          </button>
        </div>
      </form>
    </div>
  );
}
