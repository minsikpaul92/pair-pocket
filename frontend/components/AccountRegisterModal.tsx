"use client";

import { Check, ChevronDown, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import {
  ACCOUNT_KIND_KEYS,
  AccountType,
  Currency,
  FinancialAccount,
  FinancialAccountKind,
  NewFinancialAccount,
  TransactionType,
  createAccount,
  formatAmountInput,
  parseAmountInput,
  updateAccount,
} from "@/lib/api";
import { BANK_OPTIONS, bankLogoUrl } from "@/lib/banks";
import { translateError } from "@/lib/errors";

interface Props {
  currency: Currency;
  accountType?: AccountType;
  preferredType: TransactionType;
  account?: FinancialAccount | null;
  onClose: () => void;
  onCreated: (account: FinancialAccount) => void;
  onUpdated?: (account: FinancialAccount) => void;
}

const KINDS: FinancialAccountKind[] = [
  "checking",
  "credit_card",
  "savings",
  "investment",
  "cash",
];

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

export default function AccountRegisterModal({
  currency,
  accountType = "personal",
  preferredType,
  account = null,
  onClose,
  onCreated,
  onUpdated,
}: Props) {
  const isEdit = Boolean(account);
  const t = useTranslations("account");
  const tKinds = useTranslations("accountKinds");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");

  const [name, setName] = useState(account?.name ?? "");
  const [nickname, setNickname] = useState(account?.nickname ?? "");
  const [selectedCurrency, setSelectedCurrency] = useState<Currency>(account?.currency ?? currency);
  const [kind, setKind] = useState<FinancialAccountKind>(
    account?.kind ??
      (preferredType === "expense" ? "credit_card" : "checking")
  );
  const [openingBalance, setOpeningBalance] = useState(
    account
      ? formatAmountInput(String(account.opening_balance), account.currency)
      : "0"
  );
  const [lastFour, setLastFour] = useState(account?.last_four ?? "");
  const [accountNumber, setAccountNumber] = useState(
    account?.account_number ?? ""
  );
  const [institution, setInstitution] = useState<string>(
    account?.institution ?? ""
  );
  const [bankOpen, setBankOpen] = useState(false);
  const [isDefault, setIsDefault] = useState(
    account
      ? preferredType === "expense"
        ? account.is_default_expense
        : account.is_default_income
      : true
  );
  const [isActive, setIsActive] = useState(account?.is_active ?? true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bankRef = useRef<HTMLDivElement>(null);

  const selectedBank = BANK_OPTIONS.find((b) => b.id === institution);
  const isCreditCard = kind === "credit_card";
  const displayCurrency = account?.currency ?? selectedCurrency;

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (bankRef.current && !bankRef.current.contains(e.target as Node)) {
        setBankOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmed = name.trim();
    if (!trimmed) {
      setError(tErrors("accountNameRequired"));
      return;
    }

    const balance = parseAmountInput(openingBalance);
    if (Number.isNaN(balance)) {
      setError(tErrors("invalidBalance"));
      return;
    }

    const nick = nickname.trim();
    setSubmitting(true);
    try {
      if (isEdit && account) {
        const updated = await updateAccount(account.id, {
          name: trimmed,
          nickname: nick || null,
          opening_balance: balance,
          institution: institution || null,
          last_four: isCreditCard ? lastFour.trim() || null : null,
          account_number: isCreditCard ? null : accountNumber.trim() || null,
          is_default_expense:
            preferredType === "expense" ? isDefault : account.is_default_expense,
          is_default_income:
            preferredType === "income" ? isDefault : account.is_default_income,
          is_active: isActive,
        });
        onUpdated?.(updated);
        onCreated(updated);
        return;
      }

      const payload: NewFinancialAccount = {
        name: trimmed,
        nickname: nick || null,
        kind,
        currency: selectedCurrency,
        account_type: accountType,
        opening_balance: balance,
        institution: institution || null,
        last_four: isCreditCard ? lastFour.trim() || null : null,
        account_number: isCreditCard ? null : accountNumber.trim() || null,
        is_default_expense: preferredType === "expense" ? isDefault : false,
        is_default_income: preferredType === "income" ? isDefault : false,
      };

      const created = await createAccount(payload);
      onCreated(created);
    } catch (err) {
      setError(translateError(err, tErrors, "registerFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full sm:max-w-md bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-2xl shadow-xl p-5 max-h-[90dvh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold tracking-tight">
              {isEdit ? t("editTitle") : t("registerTitle")}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {displayCurrency} ·{" "}
              {preferredType === "expense"
                ? t("defaultForExpense")
                : t("defaultForIncome")}{" "}
              {t("defaultSettingHint")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={tCommon("close")}
            className="text-gray-400 hover:text-gray-700 dark:hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
              {tCommon("name")}
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={
                preferredType === "expense"
                  ? t("namePlaceholderExpense")
                  : t("namePlaceholderIncome")
              }
              className="input-field"
              autoFocus
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
              {t("nickname")}
            </label>
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder={t("nicknamePlaceholder")}
              className="input-field"
            />
            <p className="mt-1 text-[10px] text-gray-400">
              {t("nicknameHint")}
            </p>
          </div>

          {!isEdit && (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
                통화 (Currency)
              </label>
              <select
                value={selectedCurrency}
                onChange={(e) => setSelectedCurrency(e.target.value as Currency)}
                className="input-field bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl px-3.5 py-2 text-sm focus:border-blue-500 focus:outline-none dark:text-white"
              >
                <option value="KRW">KRW (₩)</option>
                <option value="CAD">CAD (C$)</option>
                <option value="USD">USD ($)</option>
              </select>
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
              {t("type")}
            </label>
            <div className="grid grid-cols-2 gap-2">
              {KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  disabled={isEdit}
                  onClick={() => setKind(k)}
                  className={`rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                    kind === k
                      ? "bg-blue-500 text-white"
                      : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300"
                  } ${isEdit ? "opacity-60 cursor-not-allowed" : ""}`}
                >
                  {tKinds(ACCOUNT_KIND_KEYS[k])}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
                {t("currentBalance")}
              </label>
              <input
                inputMode="decimal"
                value={openingBalance}
                onChange={(e) =>
                  setOpeningBalance(
                    formatAmountInput(e.target.value, displayCurrency)
                  )
                }
                className="input-field"
              />
              <p className="mt-1 text-[10px] text-gray-400">
                {isCreditCard ? t("cardDebt") : t("accountBalance")}
              </p>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
                {isCreditCard ? t("lastFour") : t("accountNumber")}
              </label>
              {isCreditCard ? (
                <input
                  value={lastFour}
                  onChange={(e) =>
                    setLastFour(e.target.value.replace(/\D/g, "").slice(0, 4))
                  }
                  placeholder="1234"
                  className="input-field"
                />
              ) : (
                <>
                  <input
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value)}
                    placeholder={tCommon("optionalInput")}
                    className="input-field"
                  />
                  <p className="mt-1 text-[10px] text-gray-400">
                    {tCommon("optional")}
                  </p>
                </>
              )}
            </div>
          </div>

          <div ref={bankRef} className="relative">
            <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
              {t("institution")}
            </label>
            <button
              type="button"
              onClick={() => setBankOpen((v) => !v)}
              className="w-full flex items-center justify-between input-field text-left"
            >
              <span className="flex items-center gap-2 min-w-0">
                {selectedBank ? (
                  <>
                    <BankIcon
                      name={selectedBank.name}
                      color={selectedBank.color}
                      domain={selectedBank.domain}
                    />
                    <span className="truncate">{selectedBank.name}</span>
                  </>
                ) : (
                  <span className="text-gray-400">{t("selectBank")}</span>
                )}
              </span>
              <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" />
            </button>
            {bankOpen && (
              <div className="absolute z-20 mt-2 w-full max-h-52 overflow-auto rounded-xl bg-white dark:bg-gray-800 shadow-lg ring-1 ring-black/5 dark:ring-white/10">
                <ul className="py-1">
                  {BANK_OPTIONS.map((bank) => (
                    <li key={bank.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setInstitution(bank.id);
                          setBankOpen(false);
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                      >
                        <BankIcon
                          name={bank.name}
                          color={bank.color}
                          domain={bank.domain}
                        />
                        <span className="flex-1 truncate">{bank.name}</span>
                        {institution === bank.id && (
                          <Check className="h-4 w-4 text-blue-500 shrink-0" />
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <label className="flex items-center gap-3 rounded-xl bg-gray-50 dark:bg-gray-800/60 px-4 py-3 cursor-pointer">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-500 focus:ring-blue-500"
            />
            <span className="text-sm">
              {preferredType === "expense"
                ? t("defaultExpenseAccount")
                : t("defaultIncomeAccount")}
            </span>
          </label>

          {isEdit && (
            <label className="flex items-center gap-3 rounded-xl bg-gray-50 dark:bg-gray-800/60 px-4 py-3 cursor-pointer">
              <input
                type="checkbox"
                checked={!isActive}
                onChange={(e) => setIsActive(!e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-500 focus:ring-blue-500"
              />
              <span className="text-sm">{t("deactivate")}</span>
            </label>
          )}

          {error && (
            <p className="text-sm text-red-500" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="btn-primary w-full disabled:opacity-50"
          >
            {submitting
              ? t("registering")
              : isEdit
                ? t("saveChanges")
                : t("register")}
          </button>
        </form>
      </div>
    </div>
  );
}
