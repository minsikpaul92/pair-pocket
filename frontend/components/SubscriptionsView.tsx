"use client";

import { CalendarX2, Plus, Repeat, Undo2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import SubscriptionRegisterModal from "@/components/SubscriptionRegisterModal";
import {
  CategoryPresets,
  Currency,
  LedgerScope,
  MonthlySubscriptionSummary,
  Subscription,
  SubscriptionOccurrence,
  accountLabel,
  fetchAccounts,
  fetchAllPendingOccurrences,
  fetchAllSubscriptionMonthlySummary,
  fetchPendingOccurrences,
  fetchSubscriptionMonthlySummary,
  fetchSubscriptions,
  formatAmount,
  isPromoActive,
  scheduleSubscriptionCancel,
  subscriptionDisplayAmount,
  subscriptionScheduleAmountClass,
} from "@/lib/api";
import { monthKey } from "@/lib/date";
import {
  formatSubscriptionDate,
  translateBillingCycle,
  translateSubscriptionSource,
  translateSubscriptionStatus,
  translateSubscriptionTracking,
} from "@/lib/subscription-i18n";
import { translateCategory, translateSubCategory } from "@/lib/category-i18n";

interface Props {
  scope: LedgerScope;
  month: Date;
  version: number;
  presets: CategoryPresets | null;
  userEmail?: string | null;
  focusSubscriptionId?: string | null;
  focusCancelAction?: boolean;
  onFocusHandled?: () => void;
  onChanged: () => void;
  onPresetsChange: (presets: CategoryPresets) => void;
}

function MonthlyTotalsSection({
  scope,
  summary,
  t,
}: {
  scope: LedgerScope;
  summary: MonthlySubscriptionSummary;
  t: ReturnType<typeof useTranslations<"subscriptions">>;
}) {
  const currencies: Currency[] =
    scope === "KRW" ? ["KRW"] : scope === "CAD" ? ["CAD"] : ["CAD", "KRW"];

  return (
    <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div className="card-inset p-4">
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
          {t("monthlySubscriptionTotal")}
        </p>
        <div className="mt-2 space-y-1">
          {currencies.map((c) => (
            <p
              key={`sub-${c}`}
              className="text-lg font-bold tabular-nums text-gray-900 dark:text-white"
            >
              {scope === "ALL" && (c === "CAD" ? "🇨🇦 " : "🇰🇷 ")}
              {formatAmount(summary.subscription_total[c] ?? 0, c)}
            </p>
          ))}
        </div>
      </div>
      <div className="card-inset p-4">
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
          {t("monthlyInstallmentTotal")}
        </p>
        <div className="mt-2 space-y-1">
          {currencies.map((c) => (
            <p
              key={`inst-${c}`}
              className="text-lg font-bold tabular-nums text-gray-900 dark:text-white"
            >
              {scope === "ALL" && (c === "CAD" ? "🇨🇦 " : "🇰🇷 ")}
              {formatAmount(summary.installment_total[c] ?? 0, c)}
            </p>
          ))}
        </div>
      </div>
    </section>
  );
}

function PendingSection({
  scope,
  pending,
  subscriptions,
  onSelectOccurrence,
  t,
  tCommon,
  locale,
}: {
  scope: LedgerScope;
  pending: SubscriptionOccurrence[];
  subscriptions: Subscription[];
  onSelectOccurrence: (occ: SubscriptionOccurrence) => void;
  t: ReturnType<typeof useTranslations<"subscriptions">>;
  tCommon: ReturnType<typeof useTranslations<"common">>;
  locale: string;
}) {
  if (pending.length === 0) return null;

  const cad = pending.filter((o) => o.currency === "CAD");
  const krw = pending.filter((o) => o.currency === "KRW");
  const subById = new Map(subscriptions.map((s) => [s.id, s]));

  function renderList(items: SubscriptionOccurrence[]) {
    return items.map((occ) => {
      const sub = subById.get(occ.subscription_id);
      const cycle = occ.subscription_billing_cycle ?? sub?.cycle;
      const tone = subscriptionScheduleAmountClass(occ.due_date);
      return (
        <li key={occ.id}>
          <button
            type="button"
            onClick={() => onSelectOccurrence(occ)}
            className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors"
          >
            <div className="min-w-0">
              <p className={`text-sm font-medium truncate ${tone}`}>
                {occ.subscription_name || t("defaultName")}
                {translateSubscriptionSource(cycle, t) && (
                  <span className="text-[10px] text-gray-400 font-normal">
                    {" "}
                    {translateSubscriptionSource(cycle, t)}
                  </span>
                )}
              </p>
              <p className="text-[11px] text-gray-400">
                {formatSubscriptionDate(occ.due_date, locale)}
              </p>
            </div>
            <p className={`text-sm font-semibold tabular-nums whitespace-nowrap ${tone}`}>
              {formatAmount(occ.amount, occ.currency)}
            </p>
          </button>
        </li>
      );
    });
  }

  return (
    <section className="card-inset overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
        <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">
          {t("pendingThisMonth")}
        </p>
      </div>
      <ul className="divide-y divide-gray-100 dark:divide-gray-700">
        {scope === "ALL" ? (
          <>
            {cad.length > 0 && (
              <>
                <li className="px-4 py-2 text-[11px] font-semibold text-gray-400 bg-gray-50/80 dark:bg-gray-800/50">
                  🇨🇦 {tCommon("canada")}
                </li>
                {renderList(cad)}
              </>
            )}
            {krw.length > 0 && (
              <>
                <li className="px-4 py-2 text-[11px] font-semibold text-gray-400 bg-gray-50/80 dark:bg-gray-800/50">
                  🇰🇷 {tCommon("korea")}
                </li>
                {renderList(krw)}
              </>
            )}
          </>
        ) : (
          renderList(pending)
        )}
      </ul>
    </section>
  );
}

const EMPTY_SUMMARY: MonthlySubscriptionSummary = {
  month: "",
  subscription_total: {},
  installment_total: {},
};

export default function SubscriptionsView({
  scope,
  month,
  version,
  presets,
  userEmail = null,
  focusSubscriptionId = null,
  focusCancelAction = false,
  onFocusHandled,
  onChanged,
  onPresetsChange,
}: Props) {
  const t = useTranslations("subscriptions");
  const tCommon = useTranslations("common");
  const tCategories = useTranslations("categories");
  const tSubCategories = useTranslations("subCategories");
  const locale = useLocale();

  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [pending, setPending] = useState<SubscriptionOccurrence[]>([]);
  const [summary, setSummary] = useState<MonthlySubscriptionSummary>(
    EMPTY_SUMMARY
  );
  const [accountNames, setAccountNames] = useState<Record<string, string>>(
    {}
  );
  const [loading, setLoading] = useState(true);
  const [showRegister, setShowRegister] = useState(false);
  const [editing, setEditing] = useState<Subscription | null>(null);
  const [registerCurrency, setRegisterCurrency] = useState<Currency>(
    scope === "KRW" ? "KRW" : "CAD"
  );

  const monthStr = monthKey(month);

  useEffect(() => {
    setLoading(true);
    const loadSubs =
      scope === "ALL"
        ? Promise.all([
            fetchSubscriptions({ currency: "CAD", month: monthStr }),
            fetchSubscriptions({ currency: "KRW", month: monthStr }),
          ]).then(([cad, krw]) => [...cad, ...krw])
        : fetchSubscriptions({ currency: scope, month: monthStr });

    const loadPending =
      scope === "ALL"
        ? fetchAllPendingOccurrences({ month: monthStr })
        : fetchPendingOccurrences({ month: monthStr, currency: scope });

    const loadSummary =
      scope === "ALL"
        ? fetchAllSubscriptionMonthlySummary(monthStr)
        : fetchSubscriptionMonthlySummary({ month: monthStr, currency: scope });

    const loadAccounts =
      scope === "ALL"
        ? Promise.all([
            fetchAccounts({ currency: "CAD" }),
            fetchAccounts({ currency: "KRW" }),
          ]).then(([cad, krw]) => [...cad, ...krw])
        : fetchAccounts({ currency: scope });

    Promise.all([loadSubs, loadPending, loadSummary, loadAccounts])
      .then(([subs, occs, monthlySummary, accounts]) => {
        setSubscriptions(subs);
        setPending(occs);
        setSummary(monthlySummary);
        const map: Record<string, string> = {};
        for (const a of accounts) map[a.id] = accountLabel(a);
        setAccountNames(map);
      })
      .catch(() => {
        setSubscriptions([]);
        setPending([]);
        setSummary({ ...EMPTY_SUMMARY, month: monthStr });
      })
      .finally(() => setLoading(false));
  }, [scope, monthStr, version]);

  async function toggleCancelSchedule(sub: Subscription, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await scheduleSubscriptionCancel(sub.id);
      onChanged();
    } catch {
      // ignore
    }
  }

  function openCreate() {
    setEditing(null);
    setRegisterCurrency(scope === "KRW" ? "KRW" : "CAD");
    setShowRegister(true);
  }

  function openEdit(sub: Subscription) {
    setEditing(sub);
    setRegisterCurrency(sub.currency);
    setShowRegister(true);
  }

  function openFromOccurrence(occ: SubscriptionOccurrence) {
    const sub = subscriptions.find((s) => s.id === occ.subscription_id);
    if (sub) openEdit(sub);
  }

  useEffect(() => {
    if (!focusSubscriptionId || subscriptions.length === 0) return;
    const sub = subscriptions.find((s) => s.id === focusSubscriptionId);
    if (!sub) return;

    if (focusCancelAction && sub.status === "active") {
      scheduleSubscriptionCancel(sub.id)
        .then(() => onChanged())
        .catch(() => openEdit(sub))
        .finally(() => onFocusHandled?.());
      return;
    }

    openEdit(sub);
    onFocusHandled?.();
  }, [focusSubscriptionId, focusCancelAction, subscriptions, onFocusHandled, onChanged]);

  function renderSubscription(sub: Subscription, showFlag: boolean) {
    const displayAmount = subscriptionDisplayAmount(sub);
    const promoOn = isPromoActive(sub);
    const sourceLabel = translateSubscriptionSource(sub.cycle, t);

    return (
      <li
        key={sub.id}
        className="flex items-start gap-2 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors"
      >
        <button
          type="button"
          onClick={() => openEdit(sub)}
          className="flex min-w-0 flex-1 items-start gap-3 text-left"
        >
          <div className="mt-0.5 rounded-lg bg-blue-50 dark:bg-blue-500/10 p-2">
            <Repeat className="h-4 w-4 text-blue-500" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <p className="text-sm font-semibold truncate">
                {showFlag ? (sub.currency === "CAD" ? "🇨🇦 " : "🇰🇷 ") : ""}
                {sub.name}
              </p>
              {sourceLabel && (
                <span className="shrink-0 text-[10px] text-gray-400 font-normal">
                  {sourceLabel}
                </span>
              )}
              <span className="shrink-0 rounded-md bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
                {translateSubscriptionStatus(sub.status, t)}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-blue-500 font-medium">
              {translateSubscriptionTracking(sub, t, locale)}
            </p>
            <p className="mt-0.5 text-[11px] text-gray-400 truncate">
              {translateBillingCycle(sub.cycle, t)}
              {" · "}
              {translateCategory(sub.category, tCategories)} ›{" "}
              {translateSubCategory(sub.sub_category, tSubCategories)}
              {accountNames[sub.account_id]
                ? ` · ${accountNames[sub.account_id]}`
                : ""}
            </p>
            {sub.next_due_date &&
              (sub.status === "active" ||
                sub.status === "cancel_scheduled") && (
                <p className="mt-0.5 text-[11px] text-gray-400">
                  {t("nextPayment")}{" "}
                  {formatSubscriptionDate(sub.next_due_date, locale)}
                </p>
              )}
            {sub.status === "cancel_scheduled" &&
              sub.cancel_effective_date && (
                <p className="mt-0.5 text-[11px] text-amber-600 dark:text-amber-400">
                  {formatSubscriptionDate(sub.cancel_effective_date, locale)}{" "}
                  {t("hiddenAfter")}
                </p>
              )}
            {promoOn && sub.promo_end_date && (
              <p className="mt-0.5 text-[11px] text-emerald-600 dark:text-emerald-400">
                {t("promoUntil")} ~{" "}
                {formatSubscriptionDate(sub.promo_end_date, locale)}
              </p>
            )}
          </div>
          <div className="text-right shrink-0">
            <p className="text-sm font-bold tabular-nums whitespace-nowrap">
              {formatAmount(displayAmount, sub.currency)}
            </p>
            {promoOn && (
              <p className="text-[10px] text-gray-400 line-through tabular-nums">
                {formatAmount(sub.amount, sub.currency)}
              </p>
            )}
          </div>
        </button>
        {(sub.status === "active" || sub.status === "cancel_scheduled") && (
          <button
            type="button"
            onClick={(e) => toggleCancelSchedule(sub, e)}
            className="shrink-0 flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors self-center"
          >
            {sub.status === "cancel_scheduled" ? (
              <>
                <Undo2 className="h-3 w-3" /> {t("undoCancel")}
              </>
            ) : (
              <>
                <CalendarX2 className="h-3 w-3" /> {t("cancel")}
              </>
            )}
          </button>
        )}
      </li>
    );
  }

  function closeModal() {
    setShowRegister(false);
    setEditing(null);
  }

  if (loading) {
    return (
      <div className="h-40 w-full animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />
    );
  }

  const cadSubs = subscriptions.filter((s) => s.currency === "CAD");
  const krwSubs = subscriptions.filter((s) => s.currency === "KRW");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight">{t("title")}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t("subtitle")}
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="flex items-center gap-1.5 rounded-xl bg-blue-500 hover:bg-blue-600 text-white px-3 py-2 text-sm font-semibold transition-colors"
        >
          <Plus className="h-4 w-4" />
          {t("add")}
        </button>
      </div>

      <MonthlyTotalsSection scope={scope} summary={summary} t={t} />

      <PendingSection
        scope={scope}
        pending={pending}
        subscriptions={subscriptions}
        onSelectOccurrence={openFromOccurrence}
        t={t}
        tCommon={tCommon}
        locale={locale}
      />

      <section className="card-inset overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">
            {t("registered")}
          </p>
        </div>
        {subscriptions.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-gray-400">
            {t("empty")}
          </div>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-700">
            {scope === "ALL" ? (
              <>
                {cadSubs.length > 0 && (
                  <>
                    <li className="px-4 py-2 text-[11px] font-semibold text-gray-400 bg-gray-50/80 dark:bg-gray-800/50">
                      🇨🇦 {tCommon("canada")}
                    </li>
                    {cadSubs.map((sub) => renderSubscription(sub, false))}
                  </>
                )}
                {krwSubs.length > 0 && (
                  <>
                    <li className="px-4 py-2 text-[11px] font-semibold text-gray-400 bg-gray-50/80 dark:bg-gray-800/50">
                      🇰🇷 {tCommon("korea")}
                    </li>
                    {krwSubs.map((sub) => renderSubscription(sub, false))}
                  </>
                )}
              </>
            ) : (
              subscriptions.map((sub) => renderSubscription(sub, false))
            )}
          </ul>
        )}
      </section>

      {showRegister && presets && (
        <SubscriptionRegisterModal
          currency={registerCurrency}
          presets={presets}
          editing={editing}
          userEmail={userEmail}
          onClose={closeModal}
          onSaved={() => {
            closeModal();
            onChanged();
          }}
          onPresetsChange={onPresetsChange}
        />
      )}
    </div>
  );
}
