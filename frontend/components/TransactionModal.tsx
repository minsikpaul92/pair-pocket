"use client";

import { CalendarDays, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import CategorySelect from "@/components/CategorySelect";
import InstitutionSelect from "@/components/InstitutionSelect";
import SettlementExpenseSelect from "@/components/SettlementExpenseSelect";
import SubCategorySelect from "@/components/SubCategorySelect";
import {
  CategoryPresets,
  Currency,
  EXPENSE_CATEGORY_INVESTMENT,
  INCOME_CATEGORY_SETTLEMENT,
  SUB_CATEGORY_SETTLEMENT,
  SettleableExpense,
  NewTransaction,
  Transaction,
  TransactionType,
  addCustomCategory,
  addCustomSubCategory,
  addInstitution,
  categoriesForType,
  createTransaction,
  fetchInstitutionSuggestions,
  fetchMerchantSuggestions,
  fetchSettleableExpenses,
  effectiveExpenseAmount,
  formatAmount,
  hasSettlement,
  subCategoriesFor,
} from "@/lib/api";
import { dayKey, formatDayLabel } from "@/lib/date";

interface Props {
  currency: Currency;
  allowCurrencyPick?: boolean;
  onCurrencyChange?: (currency: Currency) => void;
  presets: CategoryPresets;
  defaultDate: Date;
  dayTransactions: Transaction[];
  onClose: () => void;
  onCreated: (tx: Transaction) => void;
  onPresetsChange: (presets: CategoryPresets) => void;
}

const LEDGER_LABEL: Record<Currency, string> = {
  CAD: "캐나다 가계부",
  KRW: "한국 가계부",
};

export default function TransactionModal({
  currency,
  allowCurrencyPick = false,
  onCurrencyChange,
  presets,
  defaultDate,
  dayTransactions,
  onClose,
  onCreated,
  onPresetsChange,
}: Props) {
  const [type, setType] = useState<TransactionType>("expense");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [subCategory, setSubCategory] = useState("");
  const [settlesExpenseId, setSettlesExpenseId] = useState("");
  const [merchant, setMerchant] = useState("");
  const [institution, setInstitution] = useState("");
  const [merchantHints, setMerchantHints] = useState<string[]>([]);
  const [institutionOptions, setInstitutionOptions] = useState<string[]>([]);
  const [settleableExpenses, setSettleableExpenses] = useState<SettleableExpense[]>(
    []
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dateStr = dayKey(defaultDate);

  const categoryOptions = useMemo(
    () => categoriesForType(presets, type),
    [presets, type]
  );

  const subCategoryOptions = useMemo(
    () => (category ? subCategoriesFor(presets, type, category) : []),
    [presets, type, category]
  );

  const isInvestment =
    type === "expense" && category === EXPENSE_CATEGORY_INVESTMENT;

  const isSettlement =
    type === "income" &&
    category === INCOME_CATEGORY_SETTLEMENT &&
    subCategory === SUB_CATEGORY_SETTLEMENT;

  const selectedSettleable = settleableExpenses.find(
    (e) => e.id === settlesExpenseId
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!category || !subCategory || isSettlement) {
      setMerchantHints([]);
      return;
    }
    let active = true;
    fetchMerchantSuggestions(category, currency, subCategory).then((list) => {
      if (active) setMerchantHints(list);
    });
    return () => {
      active = false;
    };
  }, [category, subCategory, currency, isSettlement]);

  useEffect(() => {
    if (!isInvestment) {
      setInstitutionOptions([]);
      return;
    }
    let active = true;
    fetchInstitutionSuggestions(currency, subCategory || undefined).then(
      (list) => {
        if (active) setInstitutionOptions(list);
      }
    );
    return () => {
      active = false;
    };
  }, [isInvestment, subCategory, currency]);

  useEffect(() => {
    if (!isSettlement) {
      setSettleableExpenses([]);
      setSettlesExpenseId("");
      return;
    }
    let active = true;
    fetchSettleableExpenses(currency).then((list) => {
      if (active) setSettleableExpenses(list);
    });
    return () => {
      active = false;
    };
  }, [isSettlement, currency]);

  function handleTypeChange(next: TransactionType) {
    setType(next);
    setCategory("");
    setSubCategory("");
    setSettlesExpenseId("");
    setMerchant("");
    setInstitution("");
    setError(null);
  }

  function handleCategoryChange(next: string) {
    setCategory(next);
    setSubCategory("");
    setSettlesExpenseId("");
    setMerchant("");
    setInstitution("");
    setError(null);
  }

  function handleSubCategoryChange(next: string) {
    setSubCategory(next);
    setSettlesExpenseId("");
    setError(null);
  }

  async function handleAddCategory(name: string) {
    const updated = await addCustomCategory(type, name);
    onPresetsChange(updated);
  }

  async function handleAddSubCategory(name: string) {
    const updated = await addCustomSubCategory(type, category, name);
    onPresetsChange(updated);
  }

  async function handleAddInstitution(name: string) {
    const saved = await addInstitution(name);
    const fromApi = await fetchInstitutionSuggestions(
      currency,
      subCategory || undefined
    );
    const merged = [...new Set([...saved, ...fromApi])];
    setInstitutionOptions(merged);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const numericAmount = Number(amount);
    if (!numericAmount || numericAmount <= 0) {
      setError("금액을 올바르게 입력해 주세요.");
      return;
    }
    if (!category) {
      setError("대분류를 선택해 주세요.");
      return;
    }
    if (!subCategory) {
      setError("중분류를 선택해 주세요.");
      return;
    }
    if (isInvestment && !institution.trim()) {
      setError("[투자/저축]은 금융기관/계좌명 선택이 필요합니다.");
      return;
    }
    if (isSettlement && !settlesExpenseId) {
      setError("정산 대상 지출을 선택해 주세요.");
      return;
    }
    if (
      isSettlement &&
      selectedSettleable &&
      numericAmount > selectedSettleable.remaining_amount + 0.001
    ) {
      setError(
        `정산 금액이 남은 지출(${formatAmount(selectedSettleable.remaining_amount, currency)})을 초과합니다.`
      );
      return;
    }

    const payload: NewTransaction = {
      date: `${dateStr}T00:00:00`,
      amount: numericAmount,
      currency,
      type,
      account_type: "personal",
      category,
      sub_category: subCategory,
      merchant: merchant.trim() || (isSettlement ? "미지정" : "미지정"),
      institution: isInvestment ? institution.trim() : null,
      settles_expense_id: isSettlement ? settlesExpenseId : null,
    };

    setSubmitting(true);
    try {
      const created = await createTransaction(payload);
      onCreated(created);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "저장 중 오류가 발생했습니다."
      );
    } finally {
      setSubmitting(false);
    }
  }

  const segmentBase =
    "flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors";

  const settlementField = isSettlement && (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
        정산 대상 지출
      </label>
      <SettlementExpenseSelect
        options={settleableExpenses}
        value={settlesExpenseId}
        onChange={setSettlesExpenseId}
        currency={currency}
      />
          {selectedSettleable && (
        <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
          {selectedSettleable.merchant} 실지출 → 정산 후{" "}
          <span className="font-semibold text-red-500">
            {formatAmount(
              Math.max(
                selectedSettleable.remaining_amount - (Number(amount) || 0),
                0
              ),
              currency
            )}
          </span>
        </p>
      )}
    </div>
  );

  const merchantField = (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
        {isSettlement ? "정산 상대 (누구에게 받았나요)" : "사용처"}
      </label>
      <input
        value={merchant}
        onChange={(e) => setMerchant(e.target.value)}
        placeholder={
          isSettlement
            ? "예: Lucy"
            : subCategory
              ? "사용처 입력"
              : "먼저 중분류를 선택하세요"
        }
        disabled={!isSettlement && !subCategory}
        className="input-field disabled:opacity-50"
      />
      {!isSettlement && merchantHints.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {merchantHints.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMerchant(m)}
              className={`rounded-full px-3 py-1 text-sm transition-colors ${
                merchant === m
                  ? "bg-blue-500 text-white"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const institutionField = isInvestment && (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
        금융기관 / 계좌명
      </label>
      <InstitutionSelect
        options={institutionOptions}
        value={institution}
        onChange={setInstitution}
        onAdd={handleAddInstitution}
        disabled={!subCategory}
      />
    </div>
  );

  const detailFields = () => {
    if (isInvestment) {
      return (
        <>
          {institutionField}
          {merchantField}
        </>
      );
    }
    if (isSettlement) {
      return (
        <>
          {settlementField}
          {merchantField}
        </>
      );
    }
    return merchantField;
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4"
      onMouseDown={onClose}
    >
      <div
        className="w-full sm:max-w-md bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-2xl shadow-xl p-5 max-h-[92dvh] overflow-auto"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xl font-bold tracking-tight">새 거래</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
              {LEDGER_LABEL[currency]} · {currency}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {allowCurrencyPick && onCurrencyChange && (
              <div className="flex rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5">
                {(["CAD", "KRW"] as Currency[]).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => onCurrencyChange(c)}
                    className={`rounded-md px-2 py-1 text-xs font-semibold transition-colors ${
                      currency === c
                        ? "bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-white"
                        : "text-gray-500"
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="닫기"
              className="text-gray-400 hover:text-gray-700 dark:hover:text-white transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3 rounded-2xl bg-blue-50 dark:bg-blue-500/10 px-4 py-3">
          <CalendarDays className="h-5 w-5 text-blue-500 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">
              {formatDayLabel(defaultDate)}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              달력에서 선택한 날짜 · 다른 날짜는 달력에서 클릭하세요
            </p>
          </div>
        </div>

        {dayTransactions.length > 0 && (
          <ul className="mt-3 card-inset divide-y divide-gray-100 dark:divide-gray-700 max-h-32 overflow-auto">
            {dayTransactions.map((tx) => {
              const settled = hasSettlement(tx);
              const displayAmt =
                tx.type === "expense"
                  ? effectiveExpenseAmount(tx)
                  : tx.amount;
              return (
                <li
                  key={tx.id}
                  className="flex items-center justify-between gap-2 px-4 py-2.5"
                >
                  <span className="text-sm truncate">
                    {tx.currency === "CAD" ? "🇨🇦" : "🇰🇷"}{" "}
                    {tx.category} › {tx.sub_category || "—"} · {tx.merchant}
                  </span>
                  <span
                    className={`shrink-0 text-sm font-semibold whitespace-nowrap ${
                      tx.type === "income"
                        ? "text-blue-500"
                        : "text-red-500"
                    }`}
                  >
                    {settled ? (
                      <span className="flex flex-col items-end">
                        <span className="text-[10px] text-gray-400 line-through font-normal">
                          {formatAmount(tx.amount, tx.currency)}
                        </span>
                        <span>{formatAmount(displayAmt, tx.currency)}</span>
                      </span>
                    ) : (
                      <>
                        {tx.type === "income" ? "+" : ""}
                        {formatAmount(displayAmt, tx.currency)}
                      </>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="flex gap-2 rounded-xl bg-gray-100 dark:bg-gray-800 p-1">
            <button
              type="button"
              onClick={() => handleTypeChange("expense")}
              className={`${segmentBase} ${
                type === "expense"
                  ? "bg-white dark:bg-gray-700 text-red-500 shadow-sm"
                  : "text-gray-500 dark:text-gray-400"
              }`}
            >
              지출
            </button>
            <button
              type="button"
              onClick={() => handleTypeChange("income")}
              className={`${segmentBase} ${
                type === "income"
                  ? "bg-white dark:bg-gray-700 text-blue-500 shadow-sm"
                  : "text-gray-500 dark:text-gray-400"
              }`}
            >
              수입
            </button>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
              대분류
            </label>
            <CategorySelect
              categories={categoryOptions}
              value={category}
              onChange={handleCategoryChange}
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
              onChange={handleSubCategoryChange}
              onAdd={handleAddSubCategory}
              disabled={!category}
              placeholder={category ? "중분류 선택" : "먼저 대분류를 선택하세요"}
            />
          </div>

          {detailFields()}

          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
              금액
            </label>
            <div className="relative">
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="input-field pr-14 text-lg font-semibold"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-medium text-gray-400">
                {currency}
              </span>
            </div>
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full btn-primary disabled:opacity-50"
          >
            {submitting ? "저장 중..." : "저장"}
          </button>
        </form>
      </div>
    </div>
  );
}
