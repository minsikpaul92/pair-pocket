"use client";

import AddableSelect from "@/components/AddableSelect";

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
  placeholder = "중분류 선택",
  disabled = false,
}: Props) {
  return (
    <AddableSelect
      options={options}
      value={value}
      onChange={onChange}
      onAdd={onAdd}
      placeholder={placeholder}
      disabled={disabled}
      addLabel="새 중분류 추가"
    />
  );
}
