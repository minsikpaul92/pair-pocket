"use client";

import { Landmark } from "lucide-react";

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
  return (
    <AddableSelect
      options={options}
      value={value}
      onChange={onChange}
      onAdd={onAdd}
      placeholder="금융기관 / 계좌명 선택"
      disabled={disabled}
      addLabel="새 금융기관 추가"
      renderLeading={() => (
        <Landmark className="h-5 w-5 text-gray-500 dark:text-gray-400 shrink-0" />
      )}
    />
  );
}
