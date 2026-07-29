"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import BankPicker from "@/components/BankPicker";
import {
  ACCOUNT_KIND_KEYS,
  AccountType,
  Currency,
  FinancialAccount,
  FinancialAccountKind,
  NewFinancialAccount,
  TransactionType,
  addInstitution,
  createAccount,
  fetchUserSettings,
  formatAmountInput,
  maskAccountNumber,
  normalizeLastFour,
  parseAmountInput,
  removeInstitution,
  updateAccount,
} from "@/lib/api";
import type { BankCountry } from "@/lib/banks";
import { translateError } from "@/lib/errors";

interface Props {
  currency: Currency;
  accountType?: AccountType;
  preferredType: TransactionType;
  account?: FinancialAccount | null;
  /** Prefill kind when creating (e.g. investment for brokerage). */
  initialKind?: FinancialAccountKind;
  /** Canada/Korea tab for brokerage filtering. */
  country?: BankCountry | null;
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

export default function AccountRegisterModal({
  currency,
  accountType = "personal",
  preferredType,
  account = null,
  initialKind,
  country = null,
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
      initialKind ??
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
  const [customInstitutions, setCustomInstitutions] = useState<string[]>([]);
  const [isDefault, setIsDefault] = useState(() => {
    if (!account) return true;
    if (account.kind === "investment") return Boolean(account.is_default_investment);
    if (account.kind === "credit_card") return Boolean(account.is_default_credit);
    return preferredType === "expense"
      ? Boolean(account.is_default_expense)
      : Boolean(account.is_default_income);
  });
  const [isActive, setIsActive] = useState(account?.is_active ?? true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCreditCard = kind === "credit_card";
  const isCash = kind === "cash";
  const isInvestment = kind === "investment";
  const displayCurrency = account?.currency ?? selectedCurrency;

  useEffect(() => {
    fetchUserSettings()
      .then((s) => setCustomInstitutions(s.institutions || []))
      .catch(() => setCustomInstitutions([]));
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
    const maskedAccount =
      isCash || isCreditCard ? null : maskAccountNumber(accountNumber);
    const cardLastFour = isCreditCard ? normalizeLastFour(lastFour) : null;
    setSubmitting(true);
    try {
      const defaultFlags = {
        is_default_expense:
          !isInvestment && !isCreditCard && preferredType === "expense"
            ? isDefault
            : isEdit && account
              ? account.is_default_expense
              : false,
        is_default_income:
          !isInvestment && !isCreditCard && preferredType === "income"
            ? isDefault
            : isEdit && account
              ? account.is_default_income
              : false,
        is_default_credit: isCreditCard
          ? isDefault
          : isEdit && account
            ? account.is_default_credit
            : false,
        is_default_investment: isInvestment
          ? isDefault
          : isEdit && account
            ? account.is_default_investment
            : false,
      };

      if (isEdit && account) {
        const updated = await updateAccount(account.id, {
          name: trimmed,
          nickname: nick || null,
          opening_balance: balance,
          institution: isCash ? null : institution || null,
          last_four: cardLastFour,
          account_number: maskedAccount,
          ...defaultFlags,
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
        country: country ?? undefined,
        opening_balance: balance,
        institution: isCash ? null : institution || null,
        last_four: cardLastFour,
        account_number: maskedAccount,
        ...defaultFlags,
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
                  onClick={() => {
                    setKind(k);
                    if (k === "cash") setInstitution("");
                  }}
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

          <div className={isCash ? "space-y-3" : "grid grid-cols-2 gap-3"}>
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
                {isCreditCard
                  ? t("cardDebt")
                  : isInvestment
                    ? t("investmentCashOnly")
                    : t("accountBalance")}
              </p>
            </div>
            {!isCash && (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
                {isCreditCard ? t("lastFour") : t("accountNumber")}
              </label>
              {isCreditCard ? (
                <>
                  <input
                    value={lastFour}
                    onChange={(e) =>
                      setLastFour(e.target.value.replace(/\D/g, "").slice(0, 4))
                    }
                    placeholder="1234"
                    className="input-field"
                    inputMode="numeric"
                    maxLength={4}
                  />
                  <p className="mt-1 text-[10px] text-gray-400">
                    {t("lastFourHint")}
                  </p>
                </>
              ) : (
                <>
                  <input
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value)}
                    onBlur={() =>
                      setAccountNumber((v) => maskAccountNumber(v) || "")
                    }
                    placeholder={t("accountNumberPlaceholder")}
                    className="input-field"
                  />
                  <p className="mt-1 text-[10px] text-gray-400">
                    {t("accountNumberHint")}
                  </p>
                </>
              )}
            </div>
            )}
          </div>

          {!isCash && (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
                {t("institution")}
              </label>
              <BankPicker
                value={institution}
                onChange={setInstitution}
                country={country ?? "ALL"}
                customInstitutions={customInstitutions}
                onAddCustom={async (n) => {
                  const next = await addInstitution(n);
                  setCustomInstitutions(next);
                  return next;
                }}
                onRemoveCustom={async (n) => {
                  const next = await removeInstitution(n);
                  setCustomInstitutions(next);
                  return next;
                }}
              />
            </div>
          )}

          <label className="flex items-center gap-3 rounded-xl bg-gray-50 dark:bg-gray-800/60 px-4 py-3 cursor-pointer">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-500 focus:ring-blue-500"
            />
            <span className="text-sm">
              {isInvestment
                ? t("defaultBrokerAccount")
                : isCreditCard
                  ? t("defaultCreditAccount")
                  : preferredType === "expense"
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
