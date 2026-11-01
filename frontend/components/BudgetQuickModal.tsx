"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { type UserSettings, updateBudget } from "@/lib/api";
import type { AccountType } from "@/lib/api";
import type { BudgetCurrency } from "@/lib/dashboard-layout";

interface Props {
  accountType: AccountType;
  /** One input per currency: just the ledger's own, or CAD and KRW on All. */
  currencies: BudgetCurrency[];
  settings: UserSettings | null;
  onSaved: (settings: UserSettings) => void;
  onClose: () => void;
}

export default function BudgetQuickModal({
  accountType,
  currencies,
  settings,
  onSaved,
  onClose,
}: Props) {
  const t = useTranslations("dashboard");
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      currencies.map((c) => {
        const saved = settings?.budgets?.[accountType]?.[c];
        return [c, saved ? String(saved) : ""];
      })
    )
  );
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
      if (next) onSaved(next);
      onClose();
    } catch {
      setError(true);
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={submit}
        className="w-full max-w-xs space-y-4 rounded-2xl bg-white p-5 shadow-xl dark:bg-gray-900"
      >
        <h3 className="text-base font-bold tracking-tight text-gray-900 dark:text-white">
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
        {error && (
          <p className="text-xs text-red-500">{t("budgetSaveError")}</p>
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
