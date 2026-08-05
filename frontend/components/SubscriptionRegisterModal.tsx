"use client";

import { Trash2, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import AccountRegisterModal from "@/components/AccountRegisterModal";
import AccountSelect, { ACCOUNT_NONE } from "@/components/AccountSelect";
import CategorySelect from "@/components/CategorySelect";
import OnboardingScreenshotScan from "@/components/OnboardingScreenshotScan";
import SubCategorySelect from "@/components/SubCategorySelect";
import {
  AccountType,
  BillingCycle,
  CategoryPresets,
  Currency,
  FinancialAccount,
  NewSubscription,
  OnboardingParseResult,
  Subscription,
  SubscriptionHistory,
  TRANSFER_CATEGORY,
  TRANSFER_SUB_CARD_REPAYMENT,
  TRANSFER_SUB_INVESTMENT_FUNDING,
  addCustomCategory,
  addCustomSubCategory,
  addMonthsToDateKey,
  categoriesForType,
  createSubscription,
  defaultPaymentAccountId,
  deleteSubscription,
  fetchAccounts,
  fetchSubscriptionHistory,
  fetchUserSettings,
  formatAmount,
  formatAmountInput,
  isEtransferSub,
  monthsBetweenDates,
  parseAmountInput,
  subCategoriesFor,
  updateSubscription,
} from "@/lib/api";
import { dayKey } from "@/lib/date";
import { translateError } from "@/lib/errors";
import {
  formatSubscriptionDate,
  translateBillingCycle,
} from "@/lib/subscription-i18n";

interface Props {
  currency: Currency;
  accountType?: AccountType;
  presets: CategoryPresets;
  editing?: Subscription | null;
  initialParse?: OnboardingParseResult | null;
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
  accountType = "personal",
  presets,
  editing = null,
  initialParse = null,
  userEmail = null,
  onClose,
  onSaved,
  onPresetsChange,
}: Props) {
  const t = useTranslations("subscriptions");
  const tCommon = useTranslations("common");
  const tTx = useTranslations("transaction");
  const tErrors = useTranslations("errors");
  const locale = useLocale();

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
  const [isFixedBill, setIsFixedBill] = useState(false);
  const [history, setHistory] = useState<SubscriptionHistory | null>(null);
  const [category, setCategory] = useState("문화/취미");
  const [subCategory, setSubCategory] = useState("정기 구독");
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [accountId, setAccountId] = useState(ACCOUNT_NONE);
  const [counterAccountId, setCounterAccountId] = useState(ACCOUNT_NONE);
  const [merchant, setMerchant] = useState("");
  const [showAccountRegister, setShowAccountRegister] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasGeminiKey, setHasGeminiKey] = useState(false);
  const [aiHint, setAiHint] = useState<string | null>(null);

  const isEtransfer =
    category === TRANSFER_CATEGORY && isEtransferSub(subCategory);
  const isTransfer = category === TRANSFER_CATEGORY && !isEtransfer;

  const transferFromAccounts = useMemo(() => {
    return accounts.filter((a) => !a.is_liability);
  }, [accounts]);

  const transferToAccounts = useMemo(() => {
    if (subCategory === TRANSFER_SUB_CARD_REPAYMENT) {
      return accounts.filter((a) => a.is_liability);
    }
    if (subCategory === TRANSFER_SUB_INVESTMENT_FUNDING) {
      return accounts.filter((a) => a.kind === "investment");
    }
    return accounts.filter((a) => !a.is_liability);
  }, [accounts, subCategory]);

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
    setIsFixedBill(Boolean(editing.is_fixed_bill));
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
      editing.promo_amount != null;
    setShowPromo(hasPromo);
    setPromoAmount(
      hasPromo
        ? formatAmountInput(String(editing.promo_amount), editing.currency)
        : ""
    );
    setPromoEndDate(dateInputFromIso(editing.promo_end_date));
    // Reminder only makes sense with an end date; keep off otherwise.
    setPromoReminderEnabled(
      Boolean(editing.promo_end_date) && editing.promo_reminder_enabled
    );
    setEndReminderEnabled(editing.end_reminder_enabled);
    setCategory(editing.category);
    setSubCategory(editing.sub_category);
    setMerchant(editing.merchant || editing.name);
    setAccountId(editing.account_id);
    setCounterAccountId(editing.counter_account_id || ACCOUNT_NONE);
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
    fetchAccounts({ currency, accountType })
      .then((list) => {
        setAccounts(list);
        if (!editing) {
          setAccountId(defaultPaymentAccountId(list) || ACCOUNT_NONE);
        }
      })
      .catch(() => setAccounts([]));
  }, [currency, accountType, editing]);

  useEffect(() => {
    if (editing) return;
    fetchUserSettings()
      .then((s) => setHasGeminiKey(Boolean(s.has_effective_gemini_key ?? s.has_gemini_key)))
      .catch(() => setHasGeminiKey(false));
  }, [editing]);

  useEffect(() => {
    if (initialParse && !editing) {
      applyAiParse(initialParse);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialParse, editing]);

  function applyAiParse(result: OnboardingParseResult) {
    const list = result.data.subscriptions || [];
    const first = list[0];
    if (!first) {
      setAiHint(t("aiEmpty"));
      return;
    }
    if (first.name) {
      setName(first.name);
      setMerchant(first.name);
    }
    if (first.amount != null) {
      setAmount(formatAmountInput(String(first.amount), currency));
    }
    const cycleRaw = String(first.cycle || "").toLowerCase();
    if (cycleRaw === "yearly" || cycleRaw === "annual") setCycle("yearly");
    else if (cycleRaw === "installment") setCycle("installment");
    else setCycle("monthly");
    setAiHint(
      list.length > 1 ? t("aiFilledMany", { count: list.length }) : t("aiFilled")
    );
  }

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
      setError(tErrors("nameRequired"));
      return;
    }
    if (numericAmount < 0 || !Number.isFinite(numericAmount)) {
      setError(tErrors("invalidAmount"));
      return;
    }
    if (!accountId) {
      setError(tErrors("accountRequired"));
      return;
    }
    if (!category || !subCategory) {
      setError(tErrors("categoriesRequired"));
      return;
    }
    const installments =
      cycle === "installment" ? Number(totalInstallments) : null;
    if (cycle === "installment" && (!installments || installments < 1)) {
      setError(tErrors("totalInstallmentsRequired"));
      return;
    }
    if (cycle === "installment" && !installmentStartDate) {
      setError(tErrors("installmentStartRequired"));
      return;
    }
    if (cycle !== "installment" && showEndDate) {
      if (!endDate) {
        setError(tErrors("endDateRequired"));
        return;
      }
      if (endDate < startDate) {
        setError(tErrors("endDateAfterStart"));
        return;
      }
    }

    let resolvedPromoAmount: number | null = null;
    let resolvedPromoEnd: string | null = null;
    if (showPromo) {
      const promoNumeric = parseAmountInput(promoAmount);
      if (promoNumeric < 0 || !Number.isFinite(promoNumeric)) {
        setError(tErrors("promoAmountInvalid"));
        return;
      }
      if (!promoEndDate) {
        // Optional — leave open-ended so promo stays on until user sets an end.
        resolvedPromoEnd = null;
      } else if (promoEndDate < startDate) {
        setError(tErrors("promoEndAfterStart"));
        return;
      } else {
        resolvedPromoEnd = `${promoEndDate}T00:00:00`;
      }
      if (numericAmount > 0 && promoNumeric >= numericAmount) {
        setError(tErrors("promoAmountLessThanRegular"));
        return;
      }
      resolvedPromoAmount = promoNumeric;
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
      setError(tErrors("completedLessThanTotal"));
      return;
    }

    const payload: NewSubscription = {
      name: trimmedName,
      amount: numericAmount,
      currency,
      account_type: accountType,
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
      counter_account_id: isTransfer ? counterAccountId || null : null,
      category,
      sub_category: subCategory,
      merchant: merchant.trim() || trimmedName,
      promo_amount: resolvedPromoAmount,
      promo_end_date: resolvedPromoEnd,
      promo_reminder_enabled:
        showPromo && resolvedPromoEnd ? promoReminderEnabled : false,
      end_reminder_enabled:
        cycle !== "installment" && showEndDate ? endReminderEnabled : false,
      is_fixed_bill: isFixedBill && cycle === "monthly",
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
      setError(translateError(err, tErrors, editing ? "updateSubscription" : "saveSubscription"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!editing) return;
    if (!window.confirm(t("deleteConfirm", { name: editing.name }))) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteSubscription(editing.id);
      onSaved();
    } catch (err) {
      setError(translateError(err, tErrors, "deleteSubscription"));
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
              {isEditing ? t("editTitle") : t("registerTitle")}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t("registerSubtitle", { currency })}
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

        {isEditing && history && (
          <div className="mt-4 rounded-xl bg-gray-50 dark:bg-gray-800/60 p-4 space-y-2 text-sm">
            <p className="font-semibold text-gray-800 dark:text-gray-100">
              {isFixedBill
                ? t("historyFixedBill")
                : cycle === "installment"
                  ? t("historyInstallment")
                  : t("history")}
            </p>
            <p className="text-gray-600 dark:text-gray-300">
              {formatSubscriptionDate(history.start_date, locale)}
              {" ~ "}
              {history.end_date
                ? formatSubscriptionDate(history.end_date, locale)
                : t("present")}
              {" · "}
              {t("monthsActive", { count: history.months_active })}
            </p>
            {history.payment_count > 0 && (
              <p className="text-gray-600 dark:text-gray-300">
                {t("totalPaid", {
                  amount: formatAmount(history.total_paid, history.currency),
                })}
              </p>
            )}
            {history.total_saved > 0 && (
              <>
                <p className="text-emerald-600 dark:text-emerald-400">
                  {t("promoSavedMonthly", {
                    amount: formatAmount(
                      history.avg_saved_per_month,
                      history.currency
                    ),
                  })}
                </p>
                <p className="text-emerald-600 dark:text-emerald-400">
                  {t("promoSavedTotal", {
                    amount: formatAmount(history.total_saved, history.currency),
                  })}
                </p>
              </>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {!isEditing && (
            <div className="space-y-2">
              <OnboardingScreenshotScan
                step="subscriptions"
                hasApiKey={hasGeminiKey}
                disabled={submitting}
                onParsed={applyAiParse}
              />
              {aiHint && (
                <p className="text-xs text-blue-600 dark:text-blue-400">{aiHint}</p>
              )}
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
              {t("name")}
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("namePlaceholder")}
              className="input-field"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
              {t("cycleLabel")}
            </label>
            <div className="flex gap-2 rounded-xl bg-gray-100 dark:bg-gray-800 p-1">
              {([...CYCLES, "fixed"] as const).map((c) => {
                const selected =
                  c === "fixed" ? isFixedBill : cycle === c && !isFixedBill;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => {
                      if (c === "fixed") {
                        setIsFixedBill(true);
                        setCycle("monthly");
                        setShowEndDate(false);
                        if (!category || category === "문화/취미") {
                          setCategory("주거/통신");
                          setSubCategory("관리비/공과금");
                        }
                      } else {
                        setIsFixedBill(false);
                        setCycle(c);
                        if (c === "installment") setShowEndDate(false);
                        if (
                          (category === "주거/통신" || !category) &&
                          (subCategory === "관리비/공과금" || !subCategory)
                        ) {
                          setCategory("문화/취미");
                          setSubCategory("정기 구독");
                        }
                      }
                    }}
                    className={`flex-1 rounded-lg px-1.5 py-2 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
                      selected
                        ? "bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-white"
                        : "text-gray-500"
                    }`}
                  >
                    {c === "fixed" ? t("cycle.fixed") : translateBillingCycle(c, t)}
                  </button>
                );
              })}
            </div>
          </div>

          {cycle === "installment" && (
            <>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
                  {t("installmentStartDate")}
                </label>
                <input
                  type="date"
                  value={installmentStartDate}
                  onChange={(e) => setInstallmentStartDate(e.target.value)}
                  className="input-field"
                />
                <p className="mt-1 text-[11px] text-gray-400">
                  {t("installmentStartHint")}
                </p>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
                  {t("totalInstallments")}
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
                    {t("installmentEndPreview")}{" "}
                    {(() => {
                      const [y, m, d] = computedInstallmentEnd
                        .split("-")
                        .map(Number);
                      return formatSubscriptionDate(
                        new Date(y, m - 1, d).toISOString(),
                        locale
                      );
                    })()}
                  </p>
                )}
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
                  {t("completedInstallments")}
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
                  {t("completedAutoHint", { count: autoCompletedInstallments })}
                </p>
              </div>
            </>
          )}

          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
              {tTx("category")}
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
              {tTx("subCategory")}
            </label>
            <SubCategorySelect
              options={subCategoryOptions}
              value={subCategory}
              onChange={setSubCategory}
              onAdd={handleAddSubCategory}
              disabled={!category}
              placeholder={
                category ? tTx("selectSubCategory") : tTx("selectSubCategoryFirst")
              }
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
              {tTx("merchant")}
            </label>
            <input
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              placeholder={name.trim() || tTx("selectMerchant")}
              className="input-field"
            />
          </div>

          {isTransfer ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
                  {tTx("fromAccount") || "보내는 계좌 (출금)"}
                </label>
                <AccountSelect
                  accounts={transferFromAccounts}
                  value={accountId}
                  onChange={setAccountId}
                  onRegister={() => setShowAccountRegister(true)}
                  allowNone={false}
                  placeholder={tTx("selectFromAccount") || "출금 계좌 선택"}
                  variant="field"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
                  {tTx("toAccount") || "받는 계좌 (입금)"}
                </label>
                <AccountSelect
                  accounts={transferToAccounts}
                  value={counterAccountId}
                  onChange={setCounterAccountId}
                  onRegister={() => setShowAccountRegister(true)}
                  allowNone={false}
                  placeholder={tTx("selectToAccount") || "입금 계좌 선택"}
                  variant="field"
                />
              </div>
            </div>
          ) : (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
                {t("paymentAccount")}
              </label>
              <AccountSelect
                accounts={accounts}
                value={accountId}
                onChange={setAccountId}
                onRegister={() => setShowAccountRegister(true)}
                allowNone={false}
                placeholder={t("selectPaymentAccount")}
                variant="field"
              />
            </div>
          )}

          <div>
            <div className="mb-1.5 flex items-end justify-between gap-2">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">
                {cycle === "installment"
                  ? t("nextPaymentDate")
                  : t("startNextPaymentDate")}
              </label>
              {cycle !== "installment" && (
                <span className="text-[11px] font-medium text-gray-400 whitespace-nowrap">
                  {t("endDateOptional")}
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="input-field flex-1 min-w-0"
              />
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
                  aria-label={showEndDate ? t("removeEndDate") : t("addEndDate")}
                >
                  {showEndDate ? "−" : "+"}
                </button>
              )}
            </div>
          </div>

          {cycle !== "installment" && showEndDate && (
            <div className="space-y-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
                  {t("endDate")}
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
                    {t("endReminder")}
                  </p>
                  {userEmail && (
                    <p className="text-[11px] text-gray-400 truncate">
                      {t("emailTo", { email: userEmail })}
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
              {showPromo ? t("regularAmountPromo") : t("regularAmount")}
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
              {showPromo ? t("promoActive") : t("promoAdd")}
            </button>
          </div>

          {showPromo && (
            <>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
                  {t("promoAmount")}
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
                  {t("promoEndDate")}
                </label>
                <input
                  type="date"
                  value={promoEndDate}
                  min={startDate}
                  onChange={(e) => {
                    const next = e.target.value;
                    setPromoEndDate(next);
                    if (!next) setPromoReminderEnabled(false);
                  }}
                  className="input-field"
                />
                <p className="mt-1 text-[11px] text-gray-400">
                  {t("promoEndHint")}
                </p>
              </div>
              <label
                className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 ${
                  promoEndDate
                    ? "bg-emerald-50/80 dark:bg-emerald-500/10 cursor-pointer"
                    : "bg-gray-50 dark:bg-gray-800/60 cursor-not-allowed opacity-60"
                }`}
              >
                <div className="min-w-0">
                  <p
                    className={`text-sm font-medium ${
                      promoEndDate
                        ? "text-emerald-800 dark:text-emerald-200"
                        : "text-gray-500 dark:text-gray-400"
                    }`}
                  >
                    {t("promoReminder")}
                  </p>
                  {userEmail && promoEndDate && (
                    <p className="text-[11px] text-emerald-700/70 dark:text-emerald-300/70 truncate">
                      {t("emailTo", { email: userEmail })}
                    </p>
                  )}
                  {!promoEndDate && (
                    <p className="text-[11px] text-gray-400 truncate">
                      {t("promoReminderNeedsEnd")}
                    </p>
                  )}
                </div>
                <input
                  type="checkbox"
                  checked={promoReminderEnabled && Boolean(promoEndDate)}
                  disabled={!promoEndDate}
                  onChange={(e) => setPromoReminderEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 disabled:opacity-40"
                />
              </label>
            </>
          )}

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
                {deleting ? tCommon("deleting") : tCommon("delete")}
              </button>
            )}
            <button
              type="submit"
              disabled={submitting || deleting}
              className="flex-1 btn-primary disabled:opacity-50"
            >
              {submitting
                ? tCommon("saving")
                : isEditing
                  ? tCommon("save")
                  : t("add")}
            </button>
          </div>
        </form>
      </div>

      {showAccountRegister && (
        <AccountRegisterModal
          currency={currency}
          accountType={accountType}
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
