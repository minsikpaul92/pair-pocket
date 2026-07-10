"use client";

import { Check, ChevronDown, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

interface Props {
  options: string[];
  value: string;
  onChange: (value: string) => void;
  onAdd?: (name: string) => Promise<void>;
  placeholder?: string;
  disabled?: boolean;
  addLabel?: string;
  formatOption?: (option: string) => string;
  renderLeading?: (option: string) => React.ReactNode;
}

export default function AddableSelect({
  options,
  value,
  onChange,
  onAdd,
  placeholder,
  disabled = false,
  addLabel,
  formatOption,
  renderLeading,
}: Props) {
  const t = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const resolvedPlaceholder = placeholder ?? t("select");
  const resolvedAddLabel = addLabel ?? t("add");
  const labelFor = (option: string) => formatOption?.(option) ?? option;

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setAdding(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  async function handleAdd() {
    const name = newName.trim();
    if (!name || !onAdd || saving) return;
    setSaving(true);
    try {
      await onAdd(name);
      onChange(name);
      setNewName("");
      setAdding(false);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between input-field text-left disabled:opacity-50"
      >
        <span className="flex items-center gap-2 min-w-0">
          {value ? (
            <>
              {renderLeading?.(value)}
              <span className="truncate">{labelFor(value)}</span>
            </>
          ) : (
            <span className="text-gray-400">{resolvedPlaceholder}</span>
          )}
        </span>
        <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" />
      </button>

      {open && (
        <div className="absolute z-20 mt-2 w-full max-h-72 overflow-auto rounded-xl bg-white dark:bg-gray-800 shadow-lg ring-1 ring-black/5 dark:ring-white/10">
          <ul className="py-1">
            {options.map((opt) => (
              <li key={opt}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(opt);
                    setOpen(false);
                  }}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  {renderLeading?.(opt)}
                  <span className="truncate flex-1">{labelFor(opt)}</span>
                  {value === opt && (
                    <Check className="h-4 w-4 text-blue-500 shrink-0" />
                  )}
                </button>
              </li>
            ))}
          </ul>

          {onAdd && (
            <div className="border-t border-gray-100 dark:border-gray-700 p-2">
              {adding ? (
                <div className="flex gap-2">
                  <input
                    autoFocus
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                    placeholder={t("nameInput")}
                    className="flex-1 bg-gray-50 dark:bg-gray-900 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleAdd}
                    disabled={saving}
                    className="rounded-lg bg-blue-500 hover:bg-blue-600 disabled:opacity-50 px-3 text-sm font-semibold text-white transition-colors"
                  >
                    {t("add")}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  className="w-full flex items-center gap-2 px-2 py-2 text-left text-sm font-medium text-blue-500 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg transition-colors"
                >
                  <Plus className="h-4 w-4" />
                  {resolvedAddLabel}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
