"use client";

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
  placeholder = "사용처 선택",
  disabled = false,
  addLabel = "새 사용처 추가",
}: Props) {
  return (
    <AddableSelect
      options={options}
      value={value}
      onChange={onChange}
      onAdd={onAdd}
      placeholder={placeholder}
      disabled={disabled}
      addLabel={addLabel}
    />
  );
}
