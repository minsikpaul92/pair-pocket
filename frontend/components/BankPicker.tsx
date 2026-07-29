"use client";

import { Check, ChevronDown, Minus, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  BANK_OPTIONS,
  CANADA_BANKS,
  KOREA_BANKS,
  bankLogoUrl,
  type BankCountry,
  type BankOption,
} from "@/lib/banks";

function BankIcon({
  name,
  color,
  domain,
}: {
  name: string;
  color: string;
  domain: string | null;
}) {
  const [failed, setFailed] = useState(false);
  const src = bankLogoUrl(domain);

  if (!src || failed) {
    return (
      <span
        className="flex h-6 w-6 items-center justify-center rounded-md text-[9px] font-bold text-white shrink-0"
        style={{ backgroundColor: color }}
        aria-hidden
      >
        {name.slice(0, 2).toUpperCase()}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={24}
      height={24}
      className="h-6 w-6 rounded-md object-contain bg-white shrink-0"
      onError={() => setFailed(true)}
    />
  );
}

function findPreset(value: string): BankOption | undefined {
  return BANK_OPTIONS.find((b) => b.id === value || b.name === value);
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Filter presets by country. Omit or "ALL" to show both sections. */
  country?: BankCountry | "ALL";
  customInstitutions: string[];
  onAddCustom: (name: string) => Promise<string[]>;
  onRemoveCustom: (name: string) => Promise<string[]>;
  placeholder?: string;
  disabled?: boolean;
  /** Use input-field class (AccountRegisterModal) or plain Tailwind (onboarding). */
  triggerClassName?: string;
}

export default function BankPicker({
  value,
  onChange,
  country = "ALL",
  customInstitutions,
  onAddCustom,
  onRemoveCustom,
  placeholder,
  disabled = false,
  triggerClassName = "w-full flex items-center justify-between input-field text-left",
}: Props) {
  const t = useTranslations("account");
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selectedPreset = findPreset(value);
  const isCustomSelected =
    Boolean(value) && !selectedPreset && customInstitutions.includes(value);

  const canadaList = useMemo(
    () => (country === "KR" ? [] : CANADA_BANKS),
    [country]
  );
  const koreaList = useMemo(
    () => (country === "CA" ? [] : KOREA_BANKS),
    [country]
  );
  const customs = useMemo(
    () =>
      customInstitutions.filter(
        (name) => !BANK_OPTIONS.some((b) => b.id === name || b.name === name)
      ),
    [customInstitutions]
  );

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
    if (!name || busy) return;
    setBusy(true);
    try {
      await onAddCustom(name);
      onChange(name);
      setNewName("");
      setAdding(false);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(name: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      await onRemoveCustom(name);
      if (value === name) onChange("");
    } finally {
      setBusy(false);
    }
  }

  function pick(id: string) {
    onChange(id);
    setOpen(false);
    setAdding(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={`${triggerClassName} disabled:opacity-50`}
      >
        <span className="flex items-center gap-2 min-w-0">
          {selectedPreset ? (
            <>
              <BankIcon
                name={selectedPreset.name}
                color={selectedPreset.color}
                domain={selectedPreset.domain}
              />
              <span className="truncate">{selectedPreset.name}</span>
            </>
          ) : isCustomSelected || value ? (
            <>
              <BankIcon name={value} color="#6B7280" domain={null} />
              <span className="truncate">{value}</span>
            </>
          ) : (
            <span className="text-gray-400">
              {placeholder ?? t("selectBank")}
            </span>
          )}
        </span>
        <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" />
      </button>

      {open && (
        <div className="absolute z-30 mt-2 w-full max-h-64 overflow-auto rounded-xl bg-white dark:bg-gray-800 shadow-lg ring-1 ring-black/5 dark:ring-white/10">
          <ul className="py-1">
            {canadaList.length > 0 && (
              <>
                <li className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                  Canada
                </li>
                {canadaList.map((bank) => (
                  <li key={bank.id}>
                    <button
                      type="button"
                      onClick={() => pick(bank.id)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                    >
                      <BankIcon
                        name={bank.name}
                        color={bank.color}
                        domain={bank.domain}
                      />
                      <span className="flex-1 truncate">{bank.name}</span>
                      {value === bank.id && (
                        <Check className="h-4 w-4 text-blue-500 shrink-0" />
                      )}
                    </button>
                  </li>
                ))}
              </>
            )}

            {koreaList.length > 0 && (
              <>
                <li
                  className={`px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400 ${
                    canadaList.length > 0
                      ? "border-t border-gray-100 dark:border-gray-700 mt-1 pt-2"
                      : ""
                  }`}
                >
                  Korea
                </li>
                {koreaList.map((bank) => (
                  <li key={bank.id}>
                    <button
                      type="button"
                      onClick={() => pick(bank.id)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                    >
                      <BankIcon
                        name={bank.name}
                        color={bank.color}
                        domain={bank.domain}
                      />
                      <span className="flex-1 truncate">{bank.name}</span>
                      {value === bank.id && (
                        <Check className="h-4 w-4 text-blue-500 shrink-0" />
                      )}
                    </button>
                  </li>
                ))}
              </>
            )}

            {customs.length > 0 && (
              <>
                <li className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400 border-t border-gray-100 dark:border-gray-700 mt-1 pt-2">
                  {t("customBanks")}
                </li>
                {customs.map((name) => (
                  <li key={name}>
                    <div className="flex items-center gap-1 px-1">
                      <button
                        type="button"
                        onClick={() => pick(name)}
                        className="flex-1 flex items-center gap-2.5 px-2 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg transition-colors min-w-0"
                      >
                        <BankIcon name={name} color="#6B7280" domain={null} />
                        <span className="flex-1 truncate">{name}</span>
                        {value === name && (
                          <Check className="h-4 w-4 text-blue-500 shrink-0" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => handleRemove(name, e)}
                        disabled={busy}
                        className="p-2 text-gray-400 hover:text-red-500 shrink-0"
                        aria-label={tCommon("delete")}
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                    </div>
                  </li>
                ))}
              </>
            )}
          </ul>

          <div className="border-t border-gray-100 dark:border-gray-700 p-2">
            {adding ? (
              <div className="flex gap-2">
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleAdd();
                    }
                  }}
                  placeholder={t("addBankPlaceholder")}
                  className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2.5 py-1.5 text-sm text-gray-900 dark:text-white"
                />
                <button
                  type="button"
                  disabled={busy || !newName.trim()}
                  onClick={() => void handleAdd()}
                  className="rounded-lg bg-blue-500 hover:bg-blue-600 disabled:opacity-50 px-2.5 text-xs font-semibold text-white"
                >
                  {tCommon("add")}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="w-full flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30"
              >
                <Plus className="h-3.5 w-3.5" />
                {t("addBank")}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
