"use client";

import { Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import AccountRegisterModal from "@/components/AccountRegisterModal";
import AccountSelect, { ACCOUNT_NONE } from "@/components/AccountSelect";
import CategorySelect from "@/components/CategorySelect";
import SubCategorySelect from "@/components/SubCategorySelect";
import {
  BILLING_CYCLE_LABEL,
  BillingCycle,
  CategoryPresets,
  Currency,
  FinancialAccount,
  NewSubscription,
  Subscription,
  SubscriptionHistory,
  addCustomCategory,
  addCustomSubCategory,
  addMonthsToDateKey,
  categoriesForType,
  createSubscription,
  defaultAccountId,
  deleteSubscription,
  fetchAccounts,
  fetchSubscriptionHistory,
  formatAmount,
  formatAmountInput,
  monthsBetweenDates,
  parseAmountInput,
  subCategoriesFor,
  updateSubscription,
} from "@/lib/api";
import { dayKey } from "@/lib/date";

interface Props {
  currency: Currency;
  presets: CategoryPresets;
  editing?: Subscription | null;
  userEmail?: string | null;
  onClose: () => void;
  onSaved: () => void;
  onPresetsChange: (presets: CategoryPresets) => void;
}

const CYCLES: BillingCycle[] = ["monthly", "yearly", "installment"];

function dateInputFromIso(iso: string | null | undefined): string {
  if (!iso) return "";
  return dayKey(new Date(iso));
}

export default function SubscriptionRegisterModal({
  currency,
  presets,
  editing = null,
  userEmail = null,
  onClose,
  onSaved,
  onPresetsChange,
}: Props) {
  const isEditing = Boolean(editing);

  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [startDate, setStartDate] = useState(dayKey(new Date()));
  const [installmentStartDate, setInstallmentStartDate] = useState("");
  const [showEndDate, setShowEndDate] = useState(false);
  const [endDate, setEndDate] = useState("");
  const [totalInstallments, setTotalInstallments] = useState("12");
  const [completedInstallments, setCompletedInstallments] = useState("");
  const [showPromo, setShowPromo] = useState(false);
  const [promoAmount, setPromoAmount] = useState("");
  const [promoEndDate, setPromoEndDate] = useState("");
  const [promoReminderEnabled, setPromoReminderEnabled] = useState(false);
  const [endReminderEnabled, setEndReminderEnabled] = useState(false);
  const [history, setHistory] = useState<SubscriptionHistory | null>(null);
  const [category, setCategory] = useState("문화/취미");
  const [subCategory, setSubCategory] = useState("정기 구독");
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [accountId, setAccountId] = useState(ACCOUNT_NONE);
  const [showAccountRegister, setShowAccountRegister] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const categoryOptions = useMemo(
    () => categoriesForType(presets, "expense"),
    [presets]
  );
  const subCategoryOptions = useMemo(
    () => (category ? subCategoriesFor(presets, "expense", category) : []),
    [presets, category]
  );

  const computedInstallmentEnd = useMemo(() => {
    if (cycle !== "installment") return null;
    const total = Number(totalInstallments);
    if (!total || total < 1) return null;
    const base = installmentStartDate || startDate;
    return addMonthsToDateKey(base, total - 1);
  }, [cycle, totalInstallments, installmentStartDate, startDate]);

  const autoCompletedInstallments = useMemo(() => {
    if (cycle !== "installment") return 0;
    const instStart = installmentStartDate || startDate;
    if (!instStart || startDate <= instStart) return 0;
    return monthsBetweenDates(new Date(instStart), new Date(startDate));
  }, [cycle, installmentStartDate, startDate]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!editing) return;
    setName(editing.name);
    setAmount(formatAmountInput(String(editing.amount), editing.currency));
    setCycle(editing.cycle);
    setStartDate(dateInputFromIso(editing.start_date));
    setInstallmentStartDate(dateInputFromIso(editing.installment_start_date));
    setShowEndDate(Boolean(editing.end_date) && editing.cycle !== "installment");
    setEndDate(dateInputFromIso(editing.end_date));
    setTotalInstallments(
      editing.total_installments != null
        ? String(editing.total_installments)
        : "12"
    );
    setCompletedInstallments(String(editing.completed_installments));
    const hasPromo =
      editing.promo_amount != null && Boolean(editing.promo_end_date);
    setShowPromo(hasPromo);
    setPromoAmount(
      hasPromo
        ? formatAmountInput(String(editing.promo_amount), editing.currency)
        : ""
    );
    setPromoEndDate(dateInputFromIso(editing.promo_end_date));
    setPromoReminderEnabled(editing.promo_reminder_enabled);
    setEndReminderEnabled(editing.end_reminder_enabled);
    setCategory(editing.category);
    setSubCategory(editing.sub_category);
    setAccountId(editing.account_id);
  }, [editing]);

  useEffect(() => {
    if (!editing) {
      setHistory(null);
      return;
    }
    fetchSubscriptionHistory(editing.id)
      .then(setHistory)
      .catch(() => setHistory(null));
  }, [editing]);

  useEffect(() => {
    fetchAccounts({ currency })
      .then((list) => {
        setAccounts(list);
        if (!editing) {
          setAccountId(defaultAccountId(list, "expense") || ACCOUNT_NONE);
        }
      })
      .catch(() => setAccounts([]));
  }, [currency, editing]);

  async function handleAddCategory(catName: string) {
    const updated = await addCustomCategory("expense", catName);
    onPresetsChange(updated);
  }

  async function handleAddSubCategory(subName: string) {
    const updated = await addCustomSubCategory("expense", category, subName);
    onPresetsChange(updated);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const numericAmount = parseAmountInput(amount);
    if (!name.trim()) {
      setError("이름을 입력해 주세요.");
      return;
    }
    if (numericAmount < 0 || !Number.isFinite(numericAmount)) {
      setError("금액을 올바르게 입력해 주세요.");
      return;
    }
    if (!accountId) {
      setError("결제 계좌를 선택해 주세요.");
      return;
    }
    if (!category || !subCategory) {
      setError("대분류와 중분류를 선택해 주세요.");
      return;
    }
    const installments =
      cycle === "installment" ? Number(totalInstallments) : null;
    if (cycle === "installment" && (!installments || installments < 1)) {
      setError("할부 총 회차를 입력해 주세요.");
      return;
    }
    if (cycle === "installment" && !installmentStartDate) {
      setError("첫 할부 시작일을 입력해 주세요.");
      return;
    }
    if (cycle !== "installment" && showEndDate) {
      if (!endDate) {
        setError("종료일을 입력해 주세요.");
        return;
      }
      if (endDate < startDate) {
        setError("종료일은 시작일 이후여야 합니다.");
        return;
      }
    }

    let resolvedPromoAmount: number | null = null;
    let resolvedPromoEnd: string | null = null;
    if (showPromo) {
      const promoNumeric = parseAmountInput(promoAmount);
      if (promoNumeric < 0 || !Number.isFinite(promoNumeric)) {
        setError("프로모션 금액을 올바르게 입력해 주세요.");
        return;
      }
      if (!promoEndDate) {
        setError("프로모션 종료일을 입력해 주세요.");
        return;
      }
      if (promoEndDate < startDate) {
        setError("프로모션 종료일은 시작일 이후여야 합니다.");
        return;
      }
      if (numericAmount > 0 && promoNumeric >= numericAmount) {
        setError("프로모션 금액은 정상 금액보다 작아야 합니다.");
        return;
      }
      resolvedPromoAmount = promoNumeric;
      resolvedPromoEnd = `${promoEndDate}T00:00:00`;
    }

    const trimmedName = name.trim();
    const resolvedCompleted =
      cycle === "installment"
        ? completedInstallments.trim() !== ""
          ? Number(completedInstallments)
          : autoCompletedInstallments
        : 0;

    if (
      cycle === "installment" &&
      installments != null &&
      resolvedCompleted >= installments
    ) {
      setError("이미 납부 회차는 총 회차보다 작아야 합니다.");
      return;
    }

    const payload: NewSubscription = {
      name: trimmedName,
      amount: numericAmount,
      currency,
      account_type: "personal",
      cycle,
      start_date: `${startDate}T00:00:00`,
      end_date:
        cycle === "installment"
          ? computedInstallmentEnd
            ? `${computedInstallmentEnd}T00:00:00`
            : null
          : showEndDate && endDate
            ? `${endDate}T00:00:00`
            : null,
      installment_start_date:
        cycle === "installment" && installmentStartDate
          ? `${installmentStartDate}T00:00:00`
          : null,
      total_installments: installments,
      completed_installments:
        cycle === "installment" ? resolvedCompleted : undefined,
      account_id: accountId,
      category,
      sub_category: subCategory,
      merchant: trimmedName,
      promo_amount: resolvedPromoAmount,
      promo_end_date: resolvedPromoEnd,
      promo_reminder_enabled: showPromo ? promoReminderEnabled : false,
      end_reminder_enabled:
        cycle !== "installment" && showEndDate ? endReminderEnabled : false,
    };

    setSubmitting(true);
    try {
      if (editing) {
        await updateSubscription(editing.id, payload);
      } else {
        await createSubscription(payload);
      }
      onSaved();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "저장 중 오류가 발생했습니다."
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!editing) return;
    if (!window.confirm(`"${editing.name}" 구독을 삭제할까요?`)) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteSubscription(editing.id);
      onSaved();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "삭제 중 오류가 발생했습니다."
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full sm:max-w-md bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-2xl shadow-xl p-5 max-h-[92dvh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold tracking-tight">
              {isEditing ? "구독 / 할부 수정" : "구독 / 할부 등록"}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {currency} · 결제일이 되면 자동으로 지출이 기록됩니다
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="text-gray-400 hover:text-gray-700 dark:hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {isEditing && history && (
          <div className="mt-4 rounded-xl bg-gray-50 dark:bg-gray-800/60 p-4 space-y-2 text-sm">
            <p className="font-semibold text-gray-800 dark:text-gray-100">
              구독 이력
            </p>
            <p className="text-gray-600 dark:text-gray-300">
              {new Date(history.start_date).toLocaleDateString("ko-KR")}
              {" ~ "}
              {history.end_date
                ? new Date(history.end_date).toLocaleDateString("ko-KR")
                : "현재"}
              {" · "}
              {history.months_active}개월
            </p>
            {history.payment_count > 0 && (
              <p className="text-gray-600 dark:text-gray-300">
                총 결제: {formatAmount(history.total_paid, history.currency)}
              </p>
            )}
            {history.total_saved > 0 && (
              <>
                <p className="text-emerald-600 dark:text-emerald-400">
                  프로모션 절약 (월평균):{" "}
                  {formatAmount(history.avg_saved_per_month, history.currency)}
                </p>
                <p className="text-emerald-600 dark:text-emerald-400">
                  프로모션 절약 (총):{" "}
                  {formatAmount(history.total_saved, history.currency)}
                </p>
              </>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
              이름
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: Netflix, iPhone 할부"
              className="input-field"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
              주기
            </label>
            <div className="flex gap-2 rounded-xl bg-gray-100 dark:bg-gray-800 p-1">
              {CYCLES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCycle(c)}
                  className={`flex-1 rounded-lg px-2 py-2 text-sm font-medium transition-colors ${
                    cycle === c
                      ? "bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-white"
                      : "text-gray-500"
                  }`}
                >
                  {BILLING_CYCLE_LABEL[c]}
                </button>
              ))}
            </div>
          </div>

          {cycle === "installment" && (
            <>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
                  첫 할부 시작일
                </label>
                <input
                  type="date"
                  value={installmentStartDate}
                  onChange={(e) => setInstallmentStartDate(e.target.value)}
                  className="input-field"
                />
                <p className="mt-1 text-[11px] text-gray-400">
                  중간부터 추적할 때 실제 첫 결제일을 입력하세요
                </p>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
                  총 회차
                </label>
                <input
                  inputMode="numeric"
                  value={totalInstallments}
                  onChange={(e) =>
                    setTotalInstallments(e.target.value.replace(/\D/g, ""))
                  }
                  placeholder="12"
                  className="input-field"
                />
                {computedInstallmentEnd && (
                  <p className="mt-1 text-[11px] text-blue-500 font-medium">
                    종료 예정:{" "}
                    {(() => {
                      const [y, m, d] = computedInstallmentEnd
                        .split("-")
                        .map(Number);
                      return new Date(y, m - 1, d).toLocaleDateString("ko-KR");
                    })()}
                  </p>
                )}
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
                  이미 납부 회차
                </label>
                <input
                  inputMode="numeric"
                  value={completedInstallments}
                  onChange={(e) =>
                    setCompletedInstallments(e.target.value.replace(/\D/g, ""))
                  }
                  placeholder={String(autoCompletedInstallments)}
                  className="input-field"
                />
                <p className="mt-1 text-[11px] text-gray-400">
                  비우면 시작일 기준 자동 계산 ({autoCompletedInstallments}회)
                </p>
              </div>
            </>
          )}

          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
              {cycle === "installment" ? "다음 결제일" : "시작 / 다음 결제일"}
            </label>
            <div className="flex gap-2">
              {cycle !== "installment" && (
                <button
                  type="button"
                  onClick={() => {
                    setShowEndDate((v) => {
                      if (v) {
                        setEndDate("");
                        setEndReminderEnabled(false);
                      }
                      return !v;
                    });
                  }}
                  className={`shrink-0 rounded-xl w-11 flex items-center justify-center text-lg font-semibold transition-colors ${
                    showEndDate
                      ? "bg-blue-500 text-white"
                      : "bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700"
                  }`}
                  aria-label={showEndDate ? "종료일 제거" : "종료일 추가"}
                >
                  {showEndDate ? "−" : "+"}
                </button>
              )}
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="input-field flex-1 min-w-0"
              />
            </div>
          </div>

          {cycle !== "installment" && showEndDate && (
            <div className="space-y-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
                  종료일
                </label>
                <input
                  type="date"
                  value={endDate}
                  min={startDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="input-field"
                />
              </div>
              <label className="flex items-center justify-between gap-3 rounded-xl bg-gray-50 dark:bg-gray-800/60 px-3 py-2.5 cursor-pointer">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-100">
                    종료 1주일 전 이메일 알림
                  </p>
                  {userEmail && (
                    <p className="text-[11px] text-gray-400 truncate">
                      {userEmail} 으로 발송
                    </p>
                  )}
                </div>
                <input
                  type="checkbox"
                  checked={endReminderEnabled}
                  onChange={(e) => setEndReminderEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-blue-500 focus:ring-blue-500"
                />
              </label>
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
              {showPromo ? "정상 금액 (프로모션 종료 후)" : "금액"}
            </label>
            <div className="relative">
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) =>
                  setAmount(formatAmountInput(e.target.value, currency))
                }
                placeholder="0"
                className="input-field pr-14 text-lg font-semibold"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-medium text-gray-400">
                {currency}
              </span>
            </div>
          </div>

          <div>
            <button
              type="button"
              onClick={() => {
                setShowPromo((v) => {
                  if (v) {
                    setPromoAmount("");
                    setPromoEndDate("");
                    setPromoReminderEnabled(false);
                  }
                  return !v;
                });
              }}
              className={`w-full rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                showPromo
                  ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300"
              }`}
            >
              {showPromo ? "프로모션 적용 중" : "+ 프로모션 (선택)"}
            </button>
          </div>

          {showPromo && (
            <>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
                  프로모션 금액
                </label>
                <div className="relative">
                  <input
                    inputMode="decimal"
                    value={promoAmount}
                    onChange={(e) =>
                      setPromoAmount(
                        formatAmountInput(e.target.value, currency)
                      )
                    }
                    placeholder="0"
                    className="input-field pr-14"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-medium text-gray-400">
                    {currency}
                  </span>
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
                  프로모션 종료일
                </label>
                <input
                  type="date"
                  value={promoEndDate}
                  min={startDate}
                  onChange={(e) => setPromoEndDate(e.target.value)}
                  className="input-field"
                />
                <p className="mt-1 text-[11px] text-gray-400">
                  종료일 이후에는 정상 금액이 자동 적용됩니다
                </p>
              </div>
              <label className="flex items-center justify-between gap-3 rounded-xl bg-emerald-50/80 dark:bg-emerald-500/10 px-3 py-2.5 cursor-pointer">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
                    프로모션 종료 1주일 전 이메일 알림
                  </p>
                  {userEmail && (
                    <p className="text-[11px] text-emerald-700/70 dark:text-emerald-300/70 truncate">
                      {userEmail} 으로 발송
                    </p>
                  )}
                </div>
                <input
                  type="checkbox"
                  checked={promoReminderEnabled}
                  onChange={(e) => setPromoReminderEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                />
              </label>
            </>
          )}

          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
              결제 계좌
            </label>
            <AccountSelect
              accounts={accounts}
              value={accountId}
              onChange={setAccountId}
              onRegister={() => setShowAccountRegister(true)}
              allowNone={false}
              placeholder="결제 계좌 선택"
              variant="field"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
              대분류
            </label>
            <CategorySelect
              categories={categoryOptions}
              value={category}
              onChange={(next) => {
                setCategory(next);
                setSubCategory("");
              }}
              onAdd={handleAddCategory}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
              중분류
            </label>
            <SubCategorySelect
              options={subCategoryOptions}
              value={subCategory}
              onChange={setSubCategory}
              onAdd={handleAddSubCategory}
              disabled={!category}
              placeholder={category ? "중분류 선택" : "먼저 대분류를 선택하세요"}
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex gap-2">
            {isEditing && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={submitting || deleting}
                className="flex items-center justify-center gap-1.5 rounded-xl px-4 py-3 text-sm font-semibold text-red-500 bg-red-50 dark:bg-red-500/10 hover:bg-red-100 dark:hover:bg-red-500/20 transition-colors disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
                {deleting ? "삭제 중..." : "삭제"}
              </button>
            )}
            <button
              type="submit"
              disabled={submitting || deleting}
              className="flex-1 btn-primary disabled:opacity-50"
            >
              {submitting ? "저장 중..." : isEditing ? "저장" : "등록"}
            </button>
          </div>
        </form>
      </div>

      {showAccountRegister && (
        <AccountRegisterModal
          currency={currency}
          preferredType="expense"
          onClose={() => setShowAccountRegister(false)}
          onCreated={(created) => {
            setAccounts((prev) => [...prev, created]);
            setAccountId(created.id);
            setShowAccountRegister(false);
          }}
        />
      )}
    </div>
  );
}
