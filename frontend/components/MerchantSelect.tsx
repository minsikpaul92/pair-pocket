"use client";

import { useTranslations } from "next-intl";

import AddableSelect from "@/components/AddableSelect";

interface Props {
  options: string[];
  value: string;
  onChange: (value: string) => void;
  onAdd: (name: string) => Promise<void>;
  placeholder?: string;
  disabled?: boolean;
  addLabel?: string;
}

export default function MerchantSelect({
  options,
  value,
  onChange,
  onAdd,
  placeholder,
  disabled = false,
  addLabel,
}: Props) {
  const t = useTranslations("transaction");

  return (
    <AddableSelect
      options={options}
      value={value}
      onChange={onChange}
      onAdd={onAdd}
      placeholder={placeholder ?? t("selectMerchant")}
      disabled={disabled}
      addLabel={addLabel ?? t("addMerchant")}
    />
  );
}
