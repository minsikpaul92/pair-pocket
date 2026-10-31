"use client";

import { useEffect, useState } from "react";
import { ChevronDown, EyeOff, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { categoryIcon } from "@/components/CategoryIcon";
import {
  CategoryGroup,
  EXPENSE_CATEGORY_INVESTMENT,
  TRANSFER_CATEGORY,
  TRANSFER_CATEGORY_LEGACY,
  UserSettings,
  fetchCategoryPresets,
  hiddenSubKey,
  setExpenseRatioHiddenCategories,
} from "@/lib/api";
import { translateCategory, translateSubCategory } from "@/lib/category-i18n";

/** Never shown in the expense ratio, so there is nothing to hide. */
const ALWAYS_EXCLUDED = new Set([
  EXPENSE_CATEGORY_INVESTMENT,
  TRANSFER_CATEGORY,
  TRANSFER_CATEGORY_LEGACY,
]);

interface Props {
  settings: UserSettings | null;
  onSaved: (settings: UserSettings) => void;
}

function chipClass(isHidden: boolean): string {
  return `flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap disabled:opacity-60 ${
    isHidden
      ? "border-gray-300 bg-gray-100 text-gray-400 line-through dark:border-gray-700 dark:bg-gray-800 dark:text-gray-500"
      : "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-300"
  }`;
}

export default function ExpenseRatioHiddenSettings({ settings, onSaved }: Props) {
  const t = useTranslations("settingsPage");
  const tCategories = useTranslations("categories");
  const tSubCategories = useTranslations("subCategories");

  const [groups, setGroups] = useState<CategoryGroup[]>([]);
  const [hidden, setHidden] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    setHidden(settings?.expense_ratio_hidden_categories ?? []);
  }, [settings]);

  useEffect(() => {
    fetchCategoryPresets()
      .then((presets) =>
        setGroups(presets.expense.filter((g) => !ALWAYS_EXCLUDED.has(g.category)))
      )
      .catch(() => setGroups([]));
  }, []);

  async function toggle(entry: string) {
    const previous = hidden;
    const next = hidden.includes(entry)
      ? hidden.filter((c) => c !== entry)
      : [...hidden, entry];
    setHidden(next);
    setSaving(true);
    setError(false);
    try {
      onSaved(await setExpenseRatioHiddenCategories(next));
    } catch {
      setHidden(previous);
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card-inset p-5 space-y-3">
      <div className="flex items-center gap-2 border-b border-gray-100 dark:border-gray-800 pb-3">
        <EyeOff className="h-5 w-5 text-blue-500" />
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">
          {t("expenseRatioHiddenTitle")}
        </h2>
        {saving && <Loader2 className="ml-auto h-4 w-4 animate-spin text-blue-500" />}
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
        {t("expenseRatioHiddenHelp")}
      </p>
      <ul className="divide-y divide-gray-100 dark:divide-gray-800">
        {groups.map(({ category, sub_categories }) => {
          const categoryHidden = hidden.includes(category);
          const hiddenSubs = sub_categories.filter((sub) =>
            hidden.includes(hiddenSubKey(category, sub))
          ).length;
          const isOpen = expanded === category;
          const Icon = categoryIcon(category);
          return (
            <li key={category} className="py-2">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => toggle(category)}
                  disabled={saving}
                  aria-pressed={categoryHidden}
                  className={chipClass(categoryHidden)}
                >
                  {categoryHidden ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Icon className="h-3.5 w-3.5" />
                  )}
                  {translateCategory(category, tCategories)}
                </button>
                {sub_categories.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : category)}
                    aria-expanded={isOpen}
                    className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 whitespace-nowrap"
                  >
                    {hiddenSubs > 0
                      ? t("expenseRatioHiddenSubCount", { count: hiddenSubs })
                      : t("expenseRatioHiddenSubToggle")}
                    <ChevronDown
                      className={`h-3.5 w-3.5 transition-transform ${
                        isOpen ? "rotate-180" : ""
                      }`}
                    />
                  </button>
                )}
              </div>
              {isOpen && (
                <ul className="mt-2 flex flex-wrap gap-2 pl-2">
                  {sub_categories.map((sub) => {
                    const key = hiddenSubKey(category, sub);
                    const subHidden = categoryHidden || hidden.includes(key);
                    return (
                      <li key={sub}>
                        <button
                          type="button"
                          onClick={() => toggle(key)}
                          disabled={saving || categoryHidden}
                          aria-pressed={subHidden}
                          className={chipClass(subHidden)}
                        >
                          {subHidden && <EyeOff className="h-3.5 w-3.5" />}
                          {translateSubCategory(sub, tSubCategories)}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">
          {t("expenseRatioHiddenError")}
        </p>
      )}
    </section>
  );
}
