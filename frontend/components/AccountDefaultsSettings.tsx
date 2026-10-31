"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Loader2, Wallet } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  AccountType,
  Currency,
  LedgerScope,
  FinancialAccount,
  accountLabel,
  fetchAccounts,
} from "@/lib/api";
import {
  applyInvestmentDefault,
  applyWalletDefault,
  findDefaultAccountId,
  findDefaultInvestmentAccountId,
  investmentAccountsForCountry,
  accountsForDefaultSlot,
} from "@/lib/account-defaults";
import { scopeCurrencies } from "@/lib/dashboard-layout";

interface Props {
  accountType: AccountType;
  scope: LedgerScope;
  onChanged: () => void;
}


function DefaultSelect({
  id,
  label,
  value,
  disabled,
  accounts,
  noneLabel,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  disabled: boolean;
  accounts: FinancialAccount[];
  noneLabel: string;
  onChange: (nextId: string) => void;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400"
      >
        {label}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="input-field bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl px-3.5 py-2.5 text-sm w-full focus:border-blue-500 focus:outline-none dark:text-white disabled:opacity-50"
      >
        <option value="">{noneLabel}</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {accountLabel(a)}
            {a.institution ? ` · ${a.institution}` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

export default function AccountDefaultsSettings({
  accountType: ledgerTab,
  scope,
  onChanged,
}: Props) {
  const t = useTranslations("settingsPage.accountDefaults");
  const tCommon = useTranslations("common");

  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // `silent` refreshes after a save without swapping the form for a spinner.
  const loadAccounts = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      setError(null);
      const list = await fetchAccounts({
        accountType: ledgerTab,
        activeOnly: true,
      });
      setAccounts(list);
    } catch {
      setError(t("loadError"));
    } finally {
      setLoading(false);
    }
  }, [ledgerTab, t]);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  async function saveWallet(
    currency: Currency,
    role: "expense" | "income" | "credit",
    nextId: string
  ) {
    const key = `${ledgerTab}-${currency}-${role}`;
    setSavingKey(key);
    setError(null);
    try {
      await applyWalletDefault(accounts, currency, role, nextId || null);
      await loadAccounts(true);
      onChanged();
    } catch {
      setError(t("saveError"));
    } finally {
      setSavingKey(null);
    }
  }

  async function saveBroker(country: "CA" | "KR", nextId: string) {
    const key = `${ledgerTab}-broker-${country}`;
    setSavingKey(key);
    setError(null);
    try {
      await applyInvestmentDefault(accounts, country, nextId || null);
      await loadAccounts(true);
      onChanged();
    } catch {
      setError(t("saveError"));
    } finally {
      setSavingKey(null);
    }
  }

  const busy = savingKey !== null;
  const currencies: Currency[] = scopeCurrencies(scope);

  return (
    <section className="card-inset p-5 space-y-4">
      <div className="flex items-center gap-2 border-b border-gray-100 dark:border-gray-800 pb-3">
        <Wallet className="h-5 w-5 text-blue-500 shrink-0" />
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">
            {t("title")}
            <span className="ml-2 rounded-md bg-gray-100 px-1.5 py-0.5 align-middle text-[11px] font-semibold text-gray-500 dark:bg-gray-800 dark:text-gray-400">
              {ledgerTab === "personal" ? t("ledgerPersonal") : t("ledgerShared")}
            </span>
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">
            {t("description")}
          </p>
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-500" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-7 w-7 animate-spin text-blue-500" />
        </div>
      ) : (
        <div className="space-y-6">
          {currencies.map((currency) => (
            <div
              key={currency}
              className="space-y-3 rounded-2xl border border-gray-100 dark:border-gray-800 p-4"
            >
              <p className="text-xs font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                {currency}
              </p>
              <DefaultSelect
                id={`${ledgerTab}-${currency}-expense`}
                label={t("expenseBank")}
                value={findDefaultAccountId(accounts, currency, "expense")}
                disabled={busy}
                accounts={accountsForDefaultSlot(accounts, currency, "expense")}
                noneLabel={tCommon("none")}
                onChange={(id) => void saveWallet(currency, "expense", id)}
              />
              <DefaultSelect
                id={`${ledgerTab}-${currency}-credit`}
                label={t("creditCard")}
                value={findDefaultAccountId(accounts, currency, "credit")}
                disabled={busy}
                accounts={accountsForDefaultSlot(accounts, currency, "credit")}
                noneLabel={tCommon("none")}
                onChange={(id) => void saveWallet(currency, "credit", id)}
              />
              <DefaultSelect
                id={`${ledgerTab}-${currency}-income`}
                label={t("incomeBank")}
                value={findDefaultAccountId(accounts, currency, "income")}
                disabled={busy}
                accounts={accountsForDefaultSlot(accounts, currency, "income")}
                noneLabel={tCommon("none")}
                onChange={(id) => void saveWallet(currency, "income", id)}
              />
            </div>
          ))}

          <div className="space-y-3 rounded-2xl border border-gray-100 dark:border-gray-800 p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500">
              {t("brokerageSection")}
            </p>
            {currencies.includes("CAD") && (
              <DefaultSelect
                id={`${ledgerTab}-broker-ca`}
                label={t("brokerCanada")}
                value={findDefaultInvestmentAccountId(accounts, "CA")}
                disabled={busy}
                accounts={investmentAccountsForCountry(accounts, "CA")}
                noneLabel={tCommon("none")}
                onChange={(id) => void saveBroker("CA", id)}
              />
            )}
            {currencies.includes("KRW") && (
              <DefaultSelect
                id={`${ledgerTab}-broker-kr`}
                label={t("brokerKorea")}
                value={findDefaultInvestmentAccountId(accounts, "KR")}
                disabled={busy}
                accounts={investmentAccountsForCountry(accounts, "KR")}
                noneLabel={tCommon("none")}
                onChange={(id) => void saveBroker("KR", id)}
              />
            )}
          </div>
        </div>
      )}
    </section>
  );
}
