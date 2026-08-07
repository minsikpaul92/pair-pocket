"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Store, Check, Plus } from "lucide-react";

interface Props {
  options: string[];
  value: string;
  onChange: (value: string) => void;
  onAdd?: (name: string) => Promise<void>;
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
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const resolvedPlaceholder = placeholder ?? t("selectMerchant");

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const searchLower = value.trim().toLowerCase();

  const matchingOptions = options.filter((opt) =>
    opt.toLowerCase().includes(searchLower)
  );

  const otherOptions = options.filter(
    (opt) => !opt.toLowerCase().includes(searchLower)
  );

  const isExactMatch = options.some(
    (opt) => opt.toLowerCase() === searchLower
  );

  return (
    <div ref={ref} className="relative w-full">
      <div className="relative flex items-center">
        <input
          type="text"
          disabled={disabled}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={resolvedPlaceholder}
          className="input-field text-sm pr-9 w-full"
        />
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          onClick={() => setOpen((prev) => !prev)}
          className="absolute right-2 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          title="사용처 목록 보기"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>

      {open && (
        <div className="absolute z-50 mt-1 w-full max-h-60 overflow-auto rounded-xl bg-white dark:bg-gray-800 shadow-xl ring-1 ring-black/10 dark:ring-white/10 py-1">
          <div className="px-3 py-1 text-[10px] font-semibold text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-700/60 flex justify-between items-center">
            <span>자주 / 최근 사용한 사용처</span>
            <span className="text-[9px] font-normal text-indigo-500">목록</span>
          </div>

          {matchingOptions.length > 0 || otherOptions.length > 0 ? (
            <ul>
              {matchingOptions.map((opt) => (
                <li key={opt}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(opt);
                      setOpen(false);
                    }}
                    className="w-full flex items-center justify-between px-3 py-2 text-left text-sm hover:bg-indigo-50 dark:hover:bg-indigo-950/40 text-gray-800 dark:text-gray-200 transition-colors"
                  >
                    <span className="flex items-center gap-2 truncate">
                      <Store className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
                      <span className="truncate">{opt}</span>
                    </span>
                    {value === opt && (
                      <Check className="h-4 w-4 text-indigo-600 dark:text-indigo-400 shrink-0 ml-1" />
                    )}
                  </button>
                </li>
              ))}

              {searchLower && otherOptions.length > 0 && (
                <>
                  <li className="px-3 py-1 text-[10px] font-semibold text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-900/50 border-t border-b border-gray-100 dark:border-gray-700/60 mt-1">
                    기타 전체 사용처 ({otherOptions.length})
                  </li>
                  {otherOptions.map((opt) => (
                    <li key={`other-${opt}`}>
                      <button
                        type="button"
                        onClick={() => {
                          onChange(opt);
                          setOpen(false);
                        }}
                        className="w-full flex items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700/60 text-gray-600 dark:text-gray-400 transition-colors"
                      >
                        <span className="flex items-center gap-2 truncate">
                          <Store className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                          <span className="truncate">{opt}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </>
              )}
            </ul>
          ) : (
            <div className="px-3 py-2 text-xs text-gray-400 text-center">
              추천 목록이 없습니다. 직접 입력할 수 있습니다.
            </div>
          )}

          {value.trim() && !isExactMatch && onAdd && (
            <div className="border-t border-gray-100 dark:border-gray-700 p-1">
              <button
                type="button"
                onClick={() => {
                  onAdd(value.trim());
                  setOpen(false);
                }}
                className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 rounded-lg transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                {`"${value.trim()}" (새 사용처 추가)`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
