"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import CategoryEntryPicker from "@/components/CategoryEntryPicker";
import {
  AccountType,
  LedgerScope,
  UserSettings,
  CategoryGroup,
  FinancialAccount,
  TRANSFER_CATEGORY,
  accountLabel,
  fetchAccounts,
  fetchCategoryPresets,
  fetchUserSettings,
  TRANSFER_CATEGORY_LEGACY,
  saveDashboardLayout,
  saveSpendingAccountExclusions,
  saveSpendingExclusions,
} from "@/lib/api";
import {
  BudgetCurrency,
  ResolvedLayout,
  resolveLayout,
  scopeCurrencies,
} from "@/lib/dashboard-layout";

interface Props {
  accountType: AccountType;
  scope: LedgerScope;
}

export default function DashboardSettings({ accountType, scope }: Props) {
  const t = useTranslations("settingsPage");
  const tDashboard = useTranslations("dashboard");

  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [layouts, setLayouts] = useState<
    Partial<Record<BudgetCurrency, ResolvedLayout>>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<CategoryGroup[]>([]);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);

  useEffect(() => {
    fetchUserSettings()
      .then((s) => {
        setSettings(s);
        setLayouts({
          CAD: resolveLayout(s.dashboard_layouts?.CAD ?? s.dashboard_layout),
          KRW: resolveLayout(s.dashboard_layouts?.KRW ?? s.dashboard_layout),
        });
      })
      .catch(() => setError(t("budgetError")));
  }, [t]);

  useEffect(() => {
    fetchCategoryPresets()
      .then((p) =>
        // Asset moves and card payments are never spending, so they are not a choice.
        setCategories(
          p.expense.filter(
            (g) => g.category !== TRANSFER_CATEGORY && g.category !== TRANSFER_CATEGORY_LEGACY
          )
        )
      )
      .catch(() => setError(t("budgetError")));
  }, [t]);

  useEffect(() => {
    fetchAccounts({ accountType })
      .then(setAccounts)
      .catch(() => setError(t("budgetError")));
  }, [accountType, t]);

  const budgetAccounts = accounts.filter(
    (a) => a.kind !== "investment" && (scope === "ALL" || a.currency === scope)
  );

  const excluded = settings?.spending_excluded_categories ?? [TRANSFER_CATEGORY];

  async function toggleExcluded(entry: string) {
    const toggled = excluded.includes(entry)
      ? excluded.filter((c) => c !== entry)
      : [...excluded, entry];
    // The transfer category stays in the saved list: the backend relies on it.
    const next = toggled.includes(TRANSFER_CATEGORY)
      ? toggled
      : [TRANSFER_CATEGORY, ...toggled];
    try {
      setSettings(await saveSpendingExclusions(next));
      setError(null);
    } catch {
      setError(t("budgetError"));
    }
  }

  // Until the user chooses, savings accounts are the ones left out.
  const excludedAccounts =
    settings?.spending_excluded_accounts ??
    accounts.filter((a) => a.kind === "savings").map((a) => a.id);

  async function toggleAccount(accountId: string) {
    const next = excludedAccounts.includes(accountId)
      ? excludedAccounts.filter((id) => id !== accountId)
      : [...excludedAccounts, accountId];
    try {
      setSettings(await saveSpendingAccountExclusions(next));
      setError(null);
    } catch {
      setError(t("budgetError"));
    }
  }

  async function persistLayout(country: BudgetCurrency, next: ResolvedLayout) {
    setLayouts((prev) => ({ ...prev, [country]: next }));
    try {
      await saveDashboardLayout(country, next);
    } catch {
      setError(t("budgetError"));
    }
  }

  function toggleCard(
    country: BudgetCurrency,
    id: ResolvedLayout["order"][number]
  ) {
    const layout = layouts[country];
    if (!layout) return;
    const hidden = layout.hidden.includes(id)
      ? layout.hidden.filter((h) => h !== id)
      : [...layout.hidden, id];
    persistLayout(country, { ...layout, hidden });
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400" role="alert">
          {error}
        </p>
      )}

      <section className="card-inset space-y-3 p-5">
        <div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">
            {t("budgetAccountsTitle")}
          </h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {t("budgetAccountsHelp")}
          </p>
        </div>
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {budgetAccounts.map((a) => (
            <li key={a.id}>
              <label className="flex cursor-pointer items-center justify-between gap-3 py-2.5">
                <span className="min-w-0 truncate text-sm text-gray-800 dark:text-gray-100">
                  {accountLabel(a)}
                </span>
                <input
                  type="checkbox"
                  checked={!excludedAccounts.includes(a.id)}
                  disabled={!settings}
                  onChange={() => toggleAccount(a.id)}
                  className="h-4 w-4 shrink-0 accent-blue-600"
                />
              </label>
            </li>
          ))}
        </ul>
      </section>

      <section className="card-inset space-y-3 p-5">
        <div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">
            {t("excludeTitle")}
          </h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {t("excludeHelp")}
          </p>
        </div>
        <CategoryEntryPicker
          groups={categories}
          entries={excluded}
          onToggle={toggleExcluded}
          disabled={!settings}
          subToggleLabel={t("expenseRatioHiddenSubToggle")}
          subCountLabel={(count) => t("excludeSubCount", { count })}
        />
      </section>

      {scopeCurrencies(scope).map((country) => {
        const layout = layouts[country];
        return (
          <section key={country} className="card-inset space-y-3 p-5">
            <div>
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                {t("layoutTitle")}
                {scope === "ALL" && (
                  <span className="ml-2 text-sm font-medium text-gray-500 dark:text-gray-400">
                    {t(country === "CAD" ? "budgetCanada" : "budgetKorea")}
                  </span>
                )}
              </h2>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t("layoutHelp")}
              </p>
            </div>
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {layout?.order.map((id) => (
                <li key={id}>
                  <label className="flex cursor-pointer items-center justify-between gap-3 py-2.5">
                    <span className="text-sm text-gray-800 dark:text-gray-100">
                      {tDashboard(`cardNames.${id}`)}
                    </span>
                    <input
                      type="checkbox"
                      checked={!layout.hidden.includes(id)}
                      onChange={() => toggleCard(country, id)}
                      className="h-4 w-4 accent-blue-600"
                    />
                  </label>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => persistLayout(country, resolveLayout(null))}
              className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
            >
              {t("layoutReset")}
            </button>
          </section>
        );
      })}
    </div>
  );
}
