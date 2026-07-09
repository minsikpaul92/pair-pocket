"use client";

import { useTranslations } from "next-intl";

import AddableSelect from "@/components/AddableSelect";
import { translateSubCategory } from "@/lib/category-i18n";

interface Props {
  options: string[];
  value: string;
  onChange: (value: string) => void;
  onAdd?: (name: string) => Promise<void>;
  placeholder?: string;
  disabled?: boolean;
}

export default function SubCategorySelect({
  options,
  value,
  onChange,
  onAdd,
  placeholder,
  disabled = false,
}: Props) {
  const t = useTranslations("subCategories");
  const tTx = useTranslations("transaction");

  return (
    <AddableSelect
      options={options}
      value={value}
      onChange={onChange}
      onAdd={onAdd}
      placeholder={placeholder ?? tTx("selectSubCategory")}
      disabled={disabled}
      addLabel={tTx("addSubCategory")}
      formatOption={(sub) => translateSubCategory(sub, t)}
    />
  );
}
