"use client";

import { CheckCircle2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import {
  AccountType,
  LedgerScope,
  UserSettings,
  CategoryGroup,
  TRANSFER_CATEGORY,
  fetchCategoryPresets,
  fetchUserSettings,
  normalizeTransferCategory,
  saveDashboardLayout,
  saveSpendingExclusions,
  updateBudget,
} from "@/lib/api";
import { translateCategory } from "@/lib/category-i18n";
import {
  BudgetCurrency,
  ResolvedLayout,
  resolveLayout,
  scopeCurrencies,
} from "@/lib/dashboard-layout";

const CURRENCIES: { currency: BudgetCurrency; labelKey: string }[] = [
  { currency: "CAD", labelKey: "budgetCanada" },
  { currency: "KRW", labelKey: "budgetKorea" },
];

interface Props {
  accountType: AccountType;
  scope: LedgerScope;
}

export default function DashboardSettings({ accountType, scope }: Props) {
  const t = useTranslations("settingsPage");
  const tDashboard = useTranslations("dashboard");
  const tCategories = useTranslations("categories");

  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [layouts, setLayouts] = useState<
    Partial<Record<BudgetCurrency, ResolvedLayout>>
  >({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<CategoryGroup[]>([]);

  useEffect(() => {
    fetchUserSettings()
      .then((s) => {
        setSettings(s);
        setLayouts({
          CAD: resolveLayout(s.dashboard_layouts?.CAD ?? s.dashboard_layout),
          KRW: resolveLayout(s.dashboard_layouts?.KRW ?? s.dashboard_layout),
        });
        const next: Record<string, string> = {};
        for (const kind of ["personal", "shared"] as AccountType[]) {
          for (const { currency } of CURRENCIES) {
            const v = s.budgets?.[kind]?.[currency];
            next[`${kind}:${currency}`] = v ? String(v) : "";
          }
        }
        setDrafts(next);
      })
      .catch(() => setError(t("budgetError")));
  }, [t]);

  useEffect(() => {
    fetchCategoryPresets()
      .then((p) => setCategories(p.expense))
      .catch(() => setError(t("budgetError")));
  }, [t]);

  const excluded = settings?.spending_excluded_categories ?? [TRANSFER_CATEGORY];

  async function toggleExcluded(category: string) {
    const next = excluded.includes(category)
      ? excluded.filter((c) => c !== category)
      : [...excluded, category];
    try {
      setSettings(await saveSpendingExclusions(next));
      setError(null);
    } catch {
      setError(t("budgetError"));
    }
  }

  async function commitBudget(kind: AccountType, currency: BudgetCurrency) {
    const key = `${kind}:${currency}`;
    const amount = Number(drafts[key] || 0);
    const current = settings?.budgets?.[kind]?.[currency] ?? 0;
    if (!Number.isFinite(amount) || amount < 0 || amount === current) return;
    try {
      setSettings(await updateBudget({ kind, currency, amount }));
      setError(null);
      setSavedKey(key);
      setTimeout(() => setSavedKey((k) => (k === key ? null : k)), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("budgetError"));
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
        <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </p>
      )}

      <section className="card-inset space-y-4 p-5">
        <div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">
            {t("budgetTitle")}
          </h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {t("budgetHelp")}
          </p>
        </div>
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">
            {accountType === "personal" ? t("budgetPersonal") : t("budgetShared")}
          </p>
          {CURRENCIES.filter((c) => scopeCurrencies(scope).includes(c.currency)).map(({ currency, labelKey }) => {
            const key = `${accountType}:${currency}`;
            return (
              <label key={key} className="flex items-center gap-3">
                <span className="w-28 shrink-0 text-sm text-gray-700 dark:text-gray-200">
                  {t(labelKey)}
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  value={drafts[key] ?? ""}
                  placeholder="0"
                  disabled={!settings}
                  onChange={(e) =>
                    setDrafts((d) => ({ ...d, [key]: e.target.value }))
                  }
                  onBlur={() => commitBudget(accountType, currency)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                  className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm tabular-nums dark:border-gray-700 dark:bg-gray-900"
                />
                {savedKey === key && (
                  <span className="flex items-center gap-1 text-xs text-green-600">
                    <CheckCircle2 className="h-4 w-4" />
                    {t("budgetSaved")}
                  </span>
                )}
              </label>
            );
          })}
        </div>
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
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {categories.map(({ category }) => {
            const name = normalizeTransferCategory(category);
            return (
              <li key={category}>
                <label className="flex cursor-pointer items-center justify-between gap-3 py-2.5">
                  <span className="text-sm text-gray-800 dark:text-gray-100">
                    {translateCategory(name, tCategories)}
                  </span>
                  <input
                    type="checkbox"
                    checked={excluded.includes(name)}
                    disabled={!settings}
                    onChange={() => toggleExcluded(name)}
                    className="h-4 w-4 accent-blue-600"
                  />
                </label>
              </li>
            );
          })}
        </ul>
      </section>

      {scopeCurrencies(scope).map((country) => {
        const layout = layouts[country];
        return (
          <section key={country} className="card-inset space-y-3 p-5">
            <div>
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                {t("layoutTitle")}
                {scope === "ALL" && (
                  <span className="ml-2 text-sm font-medium text-gray-500">
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
              className="text-xs font-semibold text-blue-600 hover:underline"
            >
              {t("layoutReset")}
            </button>
          </section>
        );
      })}
    </div>
  );
}
