"use client";

import { useEffect, useState } from "react";
import { EyeOff, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import CategoryEntryPicker from "@/components/CategoryEntryPicker";
import {
  CategoryGroup,
  EXPENSE_CATEGORY_INVESTMENT,
  TRANSFER_CATEGORY,
  TRANSFER_CATEGORY_LEGACY,
  UserSettings,
  fetchCategoryPresets,
  setExpenseRatioHiddenCategories,
} from "@/lib/api";

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

export default function ExpenseRatioHiddenSettings({ settings, onSaved }: Props) {
  const t = useTranslations("settingsPage");

  const [groups, setGroups] = useState<CategoryGroup[]>([]);
  const [hidden, setHidden] = useState<string[]>([]);
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
      <CategoryEntryPicker
        groups={groups}
        entries={hidden}
        onToggle={toggle}
        disabled={saving}
        subToggleLabel={t("expenseRatioHiddenSubToggle")}
        subCountLabel={(count) => t("expenseRatioHiddenSubCount", { count })}
      />
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400" role="alert">
          {t("expenseRatioHiddenError")}
        </p>
      )}
    </section>
  );
}
