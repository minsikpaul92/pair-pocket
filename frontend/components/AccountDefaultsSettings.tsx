"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, Star } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  AccountType,
  DEFAULT_ROLES,
  DefaultRole,
  FinancialAccount,
  accountLabel,
  fetchAccounts,
  setAccountDefault,
} from "@/lib/api";
import { useAccountDefaults } from "@/lib/useAccountDefaults";

const CURRENCIES = ["CAD", "KRW"] as const;
type SlotCurrency = (typeof CURRENCIES)[number];

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded-md px-3 py-1 text-xs font-semibold transition-colors whitespace-nowrap ${
            value === o.value
              ? "bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-white"
              : "text-gray-500"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function AccountDefaultsSettings({ hasPartner }: { hasPartner: boolean }) {
  const t = useTranslations("settingsPage");
  const tAccount = useTranslations("account");

  const [accountType, setAccountType] = useState<AccountType>("personal");
  const [currency, setCurrency] = useState<SlotCurrency>("CAD");
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [saving, setSaving] = useState<DefaultRole | null>(null);
  const [failed, setFailed] = useState(false);
  const { defaults, setDefaults, loading, error } = useAccountDefaults(accountType);

  useEffect(() => {
    if (!hasPartner) setAccountType("personal");
  }, [hasPartner]);

  useEffect(() => {
    fetchAccounts({ accountType })
      .then(setAccounts)
      .catch(() => setAccounts([]));
  }, [accountType]);

  const accountsById = useMemo(
    () => new Map(accounts.map((a) => [a.id, a])),
    [accounts]
  );

  async function change(role: DefaultRole, accountId: string) {
    setSaving(role);
    setFailed(false);
    try {
      setDefaults(
        await setAccountDefault(accountType, currency, role, accountId || null)
      );
    } catch {
      setFailed(true);
    } finally {
      setSaving(null);
    }
  }

  return (
    <section className="card-inset p-5 space-y-3">
      <div className="flex items-center gap-2 border-b border-gray-100 dark:border-gray-800 pb-3">
        <Star className="h-5 w-5 text-blue-500" />
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">
          {t("accountDefaultsTitle")}
        </h2>
        {(loading || saving) && (
          <Loader2 className="ml-auto h-4 w-4 animate-spin text-blue-500" />
        )}
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
        {t("accountDefaultsHelp")}
      </p>

      <div className="flex flex-col gap-2 min-[420px]:flex-row">
        {hasPartner && (
          <Segmented
            value={accountType}
            onChange={setAccountType}
            options={[
              { value: "personal", label: t("accountDefaultsPersonal") },
              { value: "shared", label: t("accountDefaultsShared") },
            ]}
          />
        )}
        <Segmented
          value={currency}
          onChange={setCurrency}
          options={CURRENCIES.map((c) => ({ value: c, label: c }))}
        />
      </div>
      {accountType === "shared" && (
        <p className="text-[11px] text-gray-400 dark:text-gray-500">
          {t("accountDefaultsSharedHint")}
        </p>
      )}

      {error ? (
        <p className="text-xs text-red-600 dark:text-red-400">
          {t("accountDefaultsLoadError")}
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {DEFAULT_ROLES.map((role) => {
            const slot = defaults?.slots.find(
              (s) => s.currency === currency && s.role === role
            );
            const options = (slot?.eligible_account_ids ?? [])
              .map((id) => accountsById.get(id))
              .filter((a): a is FinancialAccount => Boolean(a));
            const selected = slot?.status === "set" ? slot.account_id ?? "" : "";
            return (
              <li key={role} className="py-2.5 space-y-1">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">
                      {tAccount(`defaultRole.${role}`)}
                    </p>
                    <p className="text-[11px] text-gray-400 dark:text-gray-500">
                      {t(`accountDefaultsRoleHelp.${role}`)}
                    </p>
                  </div>
                  <select
                    value={selected}
                    disabled={saving !== null || options.length === 0}
                    onChange={(e) => change(role, e.target.value)}
                    className="w-40 shrink-0 truncate rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-900 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                  >
                    <option value="">
                      {options.length === 0
                        ? t("accountDefaultsNoAccount")
                        : role === "subscription"
                          ? t("accountDefaultsFollowCard")
                          : t("accountDefaultsNone")}
                    </option>
                    {options.map((a) => (
                      <option key={a.id} value={a.id}>
                        {accountLabel(a)}
                      </option>
                    ))}
                  </select>
                </div>
                {slot?.status === "invalid" && (
                  <p className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="h-3 w-3" />
                    {t("accountDefaultsInvalid")}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {failed && (
        <p className="text-xs text-red-600 dark:text-red-400">
          {tAccount("defaultSaveFailed")}
        </p>
      )}
    </section>
  );
}
