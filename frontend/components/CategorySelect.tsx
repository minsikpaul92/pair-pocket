"use client";

import { useTranslations } from "next-intl";

import CategoryIcon from "@/components/CategoryIcon";
import AddableSelect from "@/components/AddableSelect";
import { translateCategory } from "@/lib/category-i18n";

interface Props {
  categories: string[];
  value: string;
  onChange: (category: string) => void;
  onAdd?: (name: string) => Promise<void>;
  placeholder?: string;
  disabled?: boolean;
}

export default function CategorySelect({
  categories,
  value,
  onChange,
  onAdd,
  placeholder,
  disabled = false,
}: Props) {
  const t = useTranslations("categories");
  const tTx = useTranslations("transaction");

  return (
    <AddableSelect
      options={categories}
      value={value}
      onChange={onChange}
      onAdd={onAdd}
      placeholder={placeholder ?? tTx("selectCategory")}
      disabled={disabled}
      addLabel={tTx("addCategory")}
      formatOption={(cat) => translateCategory(cat, t)}
      renderLeading={(cat) => (
        <CategoryIcon
          category={cat}
          className="h-5 w-5 text-gray-500 dark:text-gray-400 shrink-0"
        />
      )}
    />
  );
}
