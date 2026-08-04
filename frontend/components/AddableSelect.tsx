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
  /** Override trigger button classes (e.g. onboarding inputClass). */
  triggerClassName?: string;
  dropPosition?: "top" | "bottom";
  compact?: boolean;
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
  triggerClassName = "w-full flex items-center justify-between input-field text-left",
  dropPosition = "bottom",
  compact = false,
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

  const dropdownPosClass =
    dropPosition === "top"
      ? "bottom-full mb-1 left-0"
      : "top-full mt-1 left-0";

  const itemPaddingClass = compact ? "px-2.5 py-1.5 text-xs" : "px-4 py-2.5 text-sm";
  const iconSizeClass = compact ? "h-3.5 w-3.5" : "h-4 w-4";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={`${triggerClassName} disabled:opacity-50`}
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
        <ChevronDown className={`${iconSizeClass} text-gray-400 shrink-0`} />
      </button>

      {open && (
        <div
          className={`absolute z-50 ${dropdownPosClass} w-full min-w-[120px] max-h-48 overflow-auto rounded-xl bg-white dark:bg-gray-800 shadow-xl ring-1 ring-black/10 dark:ring-white/10`}
        >
          <ul className="py-1">
            {options.map((opt) => (
              <li key={opt}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(opt);
                    setOpen(false);
                  }}
                  className={`w-full flex items-center gap-2 ${itemPaddingClass} text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors`}
                >
                  {renderLeading?.(opt)}
                  <span className="truncate flex-1">{labelFor(opt)}</span>
                  {value === opt && (
                    <Check className={`${iconSizeClass} text-blue-500 shrink-0`} />
                  )}
                </button>
              </li>
            ))}
          </ul>

          {onAdd && (
            <div className="border-t border-gray-100 dark:border-gray-700 p-1.5">
              {adding ? (
                <div className="flex gap-1.5">
                  <input
                    autoFocus
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                    placeholder={t("nameInput")}
                    className={`flex-1 bg-gray-50 dark:bg-gray-900 rounded-lg px-2 py-1 ${
                      compact ? "text-xs" : "text-sm"
                    } focus:ring-2 focus:ring-blue-500 outline-none min-w-0`}
                  />
                  <button
                    type="button"
                    onClick={handleAdd}
                    disabled={saving}
                    className={`rounded-lg bg-blue-500 hover:bg-blue-600 disabled:opacity-50 px-2.5 py-1 ${
                      compact ? "text-xs" : "text-sm"
                    } font-semibold text-white transition-colors shrink-0`}
                  >
                    {t("add")}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  className={`w-full flex items-center gap-1.5 px-2 py-1 text-left ${
                    compact ? "text-xs" : "text-sm"
                  } font-medium text-blue-500 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg transition-colors`}
                >
                  <Plus className={iconSizeClass} />
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
