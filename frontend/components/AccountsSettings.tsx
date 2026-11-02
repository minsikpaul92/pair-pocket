"use client";

import { Landmark, Loader2, Plus, Scale } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import AccountRegisterModal from "@/components/AccountRegisterModal";
import {
  ACCOUNT_KIND_KEYS,
  AccountType,
  Currency,
  FinancialAccount,
  LedgerScope,
  accountLabel,
  fetchAccounts,
  fetchNetWorth,
  formatAmount,
  formatAmountInput,
  maskAccountNumber,
  parseAmountInput,
  updateAccount,
} from "@/lib/api";

interface Props {
  accountType: AccountType;
  scope: LedgerScope;
  onChanged: () => void;
}

function roundFor(value: number, currency: Currency): number {
  return currency === "KRW" ? Math.round(value) : Math.round(value * 100) / 100;
}

function formatSigned(value: number, currency: Currency): string {
  return (value < 0 ? "\u2212" : "") + formatAmount(Math.abs(value), currency);
}

function BalanceMatchModal({
  account,
  balance,
  onClose,
  onSaved,
}: {
  account: FinancialAccount;
  balance: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("settingsPage");
  const tCommon = useTranslations("common");
  const [actual, setActual] = useState("");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const entered = actual.trim() !== "";
  const target = parseAmountInput(actual);
  const diff = roundFor(target - balance, account.currency);
  const nextOpening = roundFor(account.opening_balance + diff, account.currency);

  async function save() {
    if (!entered || saving) return;
    setSaving(true);
    setFailed(false);
    try {
      await updateAccount(account.id, { opening_balance: nextOpening });
      onSaved();
    } catch {
      setFailed(true);
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="match-balance-title"
        className="w-full max-w-md space-y-4 rounded-2xl bg-white p-5 shadow-xl dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-1">
          <h3
            id="match-balance-title"
            className="text-base font-semibold text-gray-900 dark:text-white"
          >
            {t("matchTitle", { name: accountLabel(account) })}
          </h3>
          <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
            {account.is_liability ? t("matchHelpCard") : t("matchHelp")}
          </p>
        </div>

        <div>
          <label
            htmlFor="match-balance-input"
            className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400"
          >
            {account.is_liability ? t("matchActualCard") : t("matchActual")}
          </label>
          <input
            id="match-balance-input"
            inputMode="decimal"
            autoFocus
            value={actual}
            onChange={(e) =>
              setActual(formatAmountInput(e.target.value, account.currency))
            }
            className="input-field"
          />
        </div>

        <dl className="space-y-1.5 rounded-xl bg-gray-50 p-3 text-xs tabular-nums dark:bg-gray-800/60">
          <div className="flex justify-between gap-3">
            <dt className="text-gray-500 dark:text-gray-400">
              {t("matchAppBalance")}
            </dt>
            <dd className="font-semibold text-gray-900 dark:text-white">
              {formatAmount(balance, account.currency)}
            </dd>
          </div>
          {entered && (
            <>
              <div className="flex justify-between gap-3">
                <dt className="text-gray-500 dark:text-gray-400">
                  {t("matchDiff")}
                </dt>
                <dd className="font-semibold text-gray-900 dark:text-white">
                  {formatSigned(diff, account.currency)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-gray-500 dark:text-gray-400">
                  {t("matchOpening")}
                </dt>
                <dd className="font-semibold text-gray-900 dark:text-white">
                  {formatAmount(account.opening_balance, account.currency)}
                  {" → "}
                  {formatAmount(nextOpening, account.currency)}
                </dd>
              </div>
            </>
          )}
        </dl>

        <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
          {t("matchNote")}
        </p>
        {failed && <p className="text-xs text-red-500">{t("matchError")}</p>}

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-xl bg-gray-100 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            {tCommon("close")}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!entered || saving || diff === 0}
            className="flex items-center justify-center gap-2 rounded-xl bg-blue-500 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-600 disabled:bg-gray-200 disabled:text-gray-400 dark:disabled:bg-gray-800"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {tCommon("save")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AccountsSettings({
  accountType,
  scope,
  onChanged,
}: Props) {
  const t = useTranslations("settingsPage");
  const tKinds = useTranslations("accountKinds");
  const currency: Currency = scope === "KRW" ? "KRW" : "CAD";
  const country = currency === "KRW" ? "KR" : "CA";

  const [accounts, setAccounts] = useState<FinancialAccount[] | null>(null);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [editing, setEditing] = useState<FinancialAccount | null>(null);
  const [adding, setAdding] = useState(false);
  const [matching, setMatching] = useState<FinancialAccount | null>(null);

  const load = useCallback(async () => {
    const [list, worth] = await Promise.all([
      fetchAccounts({ currency, accountType, activeOnly: false }),
      fetchNetWorth({ currency, accountType }).catch(() => null),
    ]);
    setAccounts(list);
    setBalances(
      Object.fromEntries(
        (worth?.accounts ?? []).map((a) => [a.account_id, a.balance])
      )
    );
  }, [currency, accountType]);

  useEffect(() => {
    setAccounts(null);
    load().catch(() => setAccounts([]));
  }, [load]);

  function refreshed() {
    setEditing(null);
    setAdding(false);
    setMatching(null);
    onChanged();
    load().catch(() => null);
  }

  return (
    <section className="card-inset space-y-3 p-5">
      <div className="flex items-center gap-2 border-b border-gray-100 pb-3 dark:border-gray-800">
        <Landmark className="h-5 w-5 text-blue-500" />
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">
          {t("accountsTitle")}
        </h2>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="ml-auto flex items-center gap-1 whitespace-nowrap rounded-lg bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-100 dark:bg-blue-950/30 dark:text-blue-200 dark:hover:bg-blue-900/40"
        >
          <Plus className="h-3.5 w-3.5" />
          {t("accountsAdd")}
        </button>
      </div>
      <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
        {t("accountsHelp")}
      </p>

      {accounts === null ? (
        <div className="flex h-20 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
        </div>
      ) : accounts.length === 0 ? (
        <p className="py-4 text-center text-sm text-gray-400">
          {t("accountsEmpty")}
        </p>
      ) : (
        <ul className="space-y-2">
          {accounts.map((a) => {
            const balance = balances[a.id];
            const number = a.last_four
              ? `···${a.last_four}`
              : maskAccountNumber(a.account_number);
            const canMatch = a.kind !== "investment" && balance !== undefined;
            return (
              <li
                key={a.id}
                className={`flex items-center gap-2 rounded-xl bg-gray-50 p-1.5 dark:bg-gray-900/50 ${
                  a.is_active ? "" : "opacity-60"
                }`}
              >
                <button
                  type="button"
                  onClick={() => setEditing(a)}
                  className="min-w-0 flex-1 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-gray-100 dark:hover:bg-gray-800/70"
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-gray-900 dark:text-white">
                      {accountLabel(a)}
                    </span>
                    {!a.is_active && (
                      <span className="shrink-0 rounded-full bg-gray-200 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                        {t("accountInactive")}
                      </span>
                    )}
                  </div>
                  <p className="truncate text-[11px] text-gray-500 dark:text-gray-400">
                    {[a.institution, number, tKinds(ACCOUNT_KIND_KEYS[a.kind])]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </button>
                <div className="flex shrink-0 flex-col items-end gap-1 pr-1.5">
                  <span className="text-sm font-semibold tabular-nums text-gray-900 dark:text-white">
                    {balance === undefined
                      ? "—"
                      : formatAmount(balance, a.currency)}
                  </span>
                  {canMatch && (
                    <button
                      type="button"
                      onClick={() => setMatching(a)}
                      className="flex items-center gap-1 whitespace-nowrap text-[11px] font-semibold text-blue-600 hover:underline dark:text-blue-300"
                    >
                      <Scale className="h-3 w-3" />
                      {t("matchBalance")}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {editing && (
        <AccountRegisterModal
          currency={editing.currency}
          accountType={accountType}
          preferredType={
            editing.kind === "investment" ||
            editing.default_roles.includes("income")
              ? "income"
              : "expense"
          }
          account={editing}
          country={country}
          onClose={() => setEditing(null)}
          onCreated={refreshed}
          onUpdated={refreshed}
          onDeleted={refreshed}
        />
      )}
      {adding && (
        <AccountRegisterModal
          currency={currency}
          accountType={accountType}
          preferredType="expense"
          initialKind="checking"
          country={country}
          onClose={() => setAdding(false)}
          onCreated={refreshed}
        />
      )}
      {matching && (
        <BalanceMatchModal
          account={matching}
          balance={balances[matching.id] ?? 0}
          onClose={() => setMatching(null)}
          onSaved={refreshed}
        />
      )}
    </section>
  );
}
