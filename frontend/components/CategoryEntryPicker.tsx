"use client";

import { useState } from "react";
import { ChevronDown, EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";

import { categoryIcon } from "@/components/CategoryIcon";
import { CategoryGroup, hiddenSubKey } from "@/lib/api";
import { translateCategory, translateSubCategory } from "@/lib/category-i18n";

interface Props {
  groups: CategoryGroup[];
  /** Picked entries: a category, or one sub-category written with `hiddenSubKey`. */
  entries: string[];
  onToggle: (entry: string) => void;
  disabled?: boolean;
  /** Label of the button that opens a category's sub-categories. */
  subToggleLabel: string;
  /** Label of that button once some sub-categories are picked. */
  subCountLabel: (count: number) => string;
}

function chipClass(picked: boolean): string {
  return `flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap disabled:opacity-60 ${
    picked
      ? "border-gray-300 bg-gray-100 text-gray-500 line-through dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400"
      : "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-300"
  }`;
}

/** Category chips that each open into their sub-category chips. */
export default function CategoryEntryPicker({
  groups,
  entries,
  onToggle,
  disabled = false,
  subToggleLabel,
  subCountLabel,
}: Props) {
  const tCategories = useTranslations("categories");
  const tSubCategories = useTranslations("subCategories");
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <ul className="divide-y divide-gray-100 dark:divide-gray-800">
      {groups.map(({ category, sub_categories }) => {
        const categoryPicked = entries.includes(category);
        const pickedSubs = sub_categories.filter((sub) =>
          entries.includes(hiddenSubKey(category, sub))
        ).length;
        const isOpen = expanded === category;
        const Icon = categoryIcon(category);
        return (
          <li key={category} className="py-2">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => onToggle(category)}
                disabled={disabled}
                aria-pressed={categoryPicked}
                className={chipClass(categoryPicked)}
              >
                {categoryPicked ? (
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
                  {pickedSubs > 0 ? subCountLabel(pickedSubs) : subToggleLabel}
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
                  const subPicked = categoryPicked || entries.includes(key);
                  return (
                    <li key={sub}>
                      <button
                        type="button"
                        onClick={() => onToggle(key)}
                        disabled={disabled || categoryPicked}
                        aria-pressed={subPicked}
                        className={chipClass(subPicked)}
                      >
                        {subPicked && <EyeOff className="h-3.5 w-3.5" />}
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
  );
}
