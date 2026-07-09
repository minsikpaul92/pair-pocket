"use client";

import CategoryIcon from "@/components/CategoryIcon";
import AddableSelect from "@/components/AddableSelect";

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
  placeholder = "대분류 선택",
  disabled = false,
}: Props) {
  return (
    <AddableSelect
      options={categories}
      value={value}
      onChange={onChange}
      onAdd={onAdd}
      placeholder={placeholder}
      disabled={disabled}
      addLabel="새 대분류 추가"
      renderLeading={(cat) => (
        <CategoryIcon
          category={cat}
          className="h-5 w-5 text-gray-500 dark:text-gray-400 shrink-0"
        />
      )}
    />
  );
}
