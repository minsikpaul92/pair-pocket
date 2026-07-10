"use client";

import { Landmark } from "lucide-react";
import { useTranslations } from "next-intl";

import AddableSelect from "@/components/AddableSelect";

interface Props {
  options: string[];
  value: string;
  onChange: (value: string) => void;
  onAdd?: (name: string) => Promise<void>;
  disabled?: boolean;
}

export default function InstitutionSelect({
  options,
  value,
  onChange,
  onAdd,
  disabled = false,
}: Props) {
  const t = useTranslations("transaction");

  return (
    <AddableSelect
      options={options}
      value={value}
      onChange={onChange}
      onAdd={onAdd}
      placeholder={t("selectInstitution")}
      disabled={disabled}
      addLabel={t("addInstitution")}
      renderLeading={() => (
        <Landmark className="h-5 w-5 text-gray-500 dark:text-gray-400 shrink-0" />
      )}
    />
  );
}
