"use client";

import { CalendarX2, Plus, Repeat, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";

import SubscriptionRegisterModal from "@/components/SubscriptionRegisterModal";
import {
  BILLING_CYCLE_LABEL,
  CategoryPresets,
  Currency,
  LedgerScope,
  MonthlySubscriptionSummary,
  SUBSCRIPTION_STATUS_LABEL,
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
  subscriptionSourceLabel,
  subscriptionTrackingLabel,
} from "@/lib/api";
import { monthKey } from "@/lib/date";

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
}: {
  scope: LedgerScope;
  summary: MonthlySubscriptionSummary;
}) {
  const currencies: Currency[] =
    scope === "KRW" ? ["KRW"] : scope === "CAD" ? ["CAD"] : ["CAD", "KRW"];

  return (
    <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div className="card-inset p-4">
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
          이번 달 총 구독
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
          이번 달 총 할부
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
}: {
  scope: LedgerScope;
  pending: SubscriptionOccurrence[];
  subscriptions: Subscription[];
  onSelectOccurrence: (occ: SubscriptionOccurrence) => void;
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
                {occ.subscription_name || "구독"}
                {subscriptionSourceLabel(cycle) && (
                  <span className="text-[10px] text-gray-400 font-normal">
                    {" "}
                    {subscriptionSourceLabel(cycle)}
                  </span>
                )}
              </p>
              <p className="text-[11px] text-gray-400">
                {new Date(occ.due_date).toLocaleDateString("ko-KR")}
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
          이번 달 예정
        </p>
      </div>
      <ul className="divide-y divide-gray-100 dark:divide-gray-700">
        {scope === "ALL" ? (
          <>
            {cad.length > 0 && (
              <>
                <li className="px-4 py-2 text-[11px] font-semibold text-gray-400 bg-gray-50/80 dark:bg-gray-800/50">
                  🇨🇦 캐나다
                </li>
                {renderList(cad)}
              </>
            )}
            {krw.length > 0 && (
              <>
                <li className="px-4 py-2 text-[11px] font-semibold text-gray-400 bg-gray-50/80 dark:bg-gray-800/50">
                  🇰🇷 한국
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
  }, [focusSubscriptionId, focusCancelAction, subscriptions, onFocusHandled]);

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

  function renderSubscription(sub: Subscription, showFlag: boolean) {
    const displayAmount = subscriptionDisplayAmount(sub);
    const promoOn = isPromoActive(sub);
    const sourceLabel = subscriptionSourceLabel(sub.cycle);

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
                {SUBSCRIPTION_STATUS_LABEL[sub.status]}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-blue-500 font-medium">
              {subscriptionTrackingLabel(sub)}
            </p>
            <p className="mt-0.5 text-[11px] text-gray-400 truncate">
              {BILLING_CYCLE_LABEL[sub.cycle]}
              {" · "}
              {sub.category} › {sub.sub_category}
              {accountNames[sub.account_id]
                ? ` · ${accountNames[sub.account_id]}`
                : ""}
            </p>
            {sub.next_due_date &&
              (sub.status === "active" ||
                sub.status === "cancel_scheduled") && (
                <p className="mt-0.5 text-[11px] text-gray-400">
                  다음 결제{" "}
                  {new Date(sub.next_due_date).toLocaleDateString("ko-KR")}
                </p>
              )}
            {sub.status === "cancel_scheduled" &&
              sub.cancel_effective_date && (
                <p className="mt-0.5 text-[11px] text-amber-600 dark:text-amber-400">
                  {new Date(sub.cancel_effective_date).toLocaleDateString(
                    "ko-KR"
                  )}{" "}
                  이후 숨김
                </p>
              )}
            {promoOn && sub.promo_end_date && (
              <p className="mt-0.5 text-[11px] text-emerald-600 dark:text-emerald-400">
                프로모션 ~{" "}
                {new Date(sub.promo_end_date).toLocaleDateString("ko-KR")}
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
                <Undo2 className="h-3 w-3" /> 해지 취소
              </>
            ) : (
              <>
                <CalendarX2 className="h-3 w-3" /> 해지하기
              </>
            )}
          </button>
        )}
      </li>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight">구독 / 할부</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            결제일이 되면 자동 지출로 기록됩니다 · 항목을 눌러 수정/삭제
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="flex items-center gap-1.5 rounded-xl bg-blue-500 hover:bg-blue-600 text-white px-3 py-2 text-sm font-semibold transition-colors"
        >
          <Plus className="h-4 w-4" />
          추가
        </button>
      </div>

      <MonthlyTotalsSection scope={scope} summary={summary} />

      <PendingSection
        scope={scope}
        pending={pending}
        subscriptions={subscriptions}
        onSelectOccurrence={openFromOccurrence}
      />

      <section className="card-inset overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">
            등록된 구독
          </p>
        </div>
        {subscriptions.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-gray-400">
            등록된 구독/할부가 없습니다
          </div>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-700">
            {scope === "ALL" ? (
              <>
                {cadSubs.length > 0 && (
                  <>
                    <li className="px-4 py-2 text-[11px] font-semibold text-gray-400 bg-gray-50/80 dark:bg-gray-800/50">
                      🇨🇦 캐나다
                    </li>
                    {cadSubs.map((sub) => renderSubscription(sub, false))}
                  </>
                )}
                {krwSubs.length > 0 && (
                  <>
                    <li className="px-4 py-2 text-[11px] font-semibold text-gray-400 bg-gray-50/80 dark:bg-gray-800/50">
                      🇰🇷 한국
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
