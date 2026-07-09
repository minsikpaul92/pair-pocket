"use client";

import { CalendarDays, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import AccountRegisterModal from "@/components/AccountRegisterModal";
import AccountSelect, { ACCOUNT_NONE } from "@/components/AccountSelect";
import CategorySelect from "@/components/CategorySelect";
import InstitutionSelect from "@/components/InstitutionSelect";
import MerchantSelect from "@/components/MerchantSelect";
import SettlementExpenseSelect from "@/components/SettlementExpenseSelect";
import SubCategorySelect from "@/components/SubCategorySelect";
import {
  CategoryPresets,
  Currency,
  EXPENSE_CATEGORY_INVESTMENT,
  FinancialAccount,
  INCOME_CATEGORY_SETTLEMENT,
  SUB_CATEGORY_SETTLEMENT,
  TRANSFER_CATEGORY,
  TRANSFER_SUB_CARD_REPAYMENT,
  TRANSFER_SUB_INVESTMENT_FUNDING,
  SettleableExpense,
  NewTransaction,
  Transaction,
  TransactionType,
  addCustomCategory,
  addCustomSubCategory,
  addInstitution,
  accountLabel,
  categoriesForType,
  createTransaction,
  defaultAccountId,
  fetchAccounts,
  fetchInstitutionSuggestions,
  fetchMerchantSuggestions,
  fetchSettleableExpenses,
  effectiveExpenseAmount,
  formatAmount,
  hasSettlement,
  isNonCashflowTransaction,
  subCategoriesFor,
} from "@/lib/api";
import { dayKey, formatDayLabel } from "@/lib/date";

interface Props {
  currency: Currency;
  allowCurrencyPick?: boolean;
  onCurrencyChange?: (currency: Currency) => void;
  presets: CategoryPresets;
  defaultDate: Date;
  onDateChange: (date: Date) => void;
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
  onDateChange,
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
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [accountId, setAccountId] = useState(ACCOUNT_NONE);
  const [counterAccountId, setCounterAccountId] = useState(ACCOUNT_NONE);
  const [showAccountRegister, setShowAccountRegister] = useState(false);
  const [accountRegisterTarget, setAccountRegisterTarget] = useState<
    "primary" | "counter"
  >("primary");
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);

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

  const isTransfer = type === "expense" && category === TRANSFER_CATEGORY;
  const isCardRepayment =
    isTransfer && subCategory === TRANSFER_SUB_CARD_REPAYMENT;
  const isInvestmentFunding =
    isTransfer && subCategory === TRANSFER_SUB_INVESTMENT_FUNDING;

  const selectedSettleable = settleableExpenses.find(
    (e) => e.id === settlesExpenseId
  );

  const fromAccountFilter = (acc: FinancialAccount) => !acc.is_liability;
  const toAccountFilter = (acc: FinancialAccount) => {
    if (isCardRepayment) return acc.is_liability;
    if (isInvestmentFunding) return acc.kind === "investment";
    return !acc.is_liability;
  };

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let active = true;
    setAccountsLoading(true);
    fetchAccounts({ currency })
      .then((list) => {
        if (!active) return;
        setAccounts(list);
      })
      .catch(() => {
        if (active) setAccounts([]);
      })
      .finally(() => {
        if (active) setAccountsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [currency]);

  useEffect(() => {
    // Always re-apply the default for the active type (expense vs income).
    // If that type has no default, clear to "없음/현금".
    if (isTransfer) return;
    setAccountId(defaultAccountId(accounts, type));
  }, [type, accounts, isTransfer]);

  useEffect(() => {
    if (!isTransfer) {
      setCounterAccountId(ACCOUNT_NONE);
      return;
    }
    setCounterAccountId(ACCOUNT_NONE);
    setAccountId((prev) => {
      const stillValid = accounts.some(
        (a) => a.id === prev && !a.is_liability
      );
      if (stillValid) return prev;
      const preferred = defaultAccountId(accounts, "expense");
      const preferredOk = accounts.some(
        (a) => a.id === preferred && !a.is_liability
      );
      return preferredOk ? preferred : ACCOUNT_NONE;
    });
  }, [isTransfer, accounts]);

  useEffect(() => {
    if (!isTransfer) return;
    setCounterAccountId(ACCOUNT_NONE);
  }, [subCategory, isTransfer]);

  useEffect(() => {
    if (!category || !subCategory || isTransfer || isSettlement) {
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
  }, [category, subCategory, currency, isTransfer, isSettlement]);

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
    setMerchantHints([]);
    setInstitution("");
    setCounterAccountId(ACCOUNT_NONE);
    setError(null);
  }

  function handleSubCategoryChange(next: string) {
    setSubCategory(next);
    setSettlesExpenseId("");
    setMerchant("");
    if (category === TRANSFER_CATEGORY) {
      setCounterAccountId(ACCOUNT_NONE);
    }
    setError(null);
  }

  async function handleAddMerchant(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setMerchantHints((prev) => [
      trimmed,
      ...prev.filter((m) => m !== trimmed),
    ]);
    setMerchant(trimmed);
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
    if (isTransfer) {
      if (!accountId) {
        setError("출금 계좌를 선택해 주세요.");
        return;
      }
      if (!counterAccountId) {
        setError("입금 계좌를 선택해 주세요.");
        return;
      }
      if (accountId === counterAccountId) {
        setError("출금 계좌와 입금 계좌는 서로 달라야 합니다.");
        return;
      }
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

    const fromLabel = accounts.find((a) => a.id === accountId);
    const toLabel = accounts.find((a) => a.id === counterAccountId);
    const transferMerchant =
      fromLabel && toLabel
        ? `${accountLabel(fromLabel)} → ${accountLabel(toLabel)}`
        : "자산 이동/카드";

    const payload: NewTransaction = {
      date: `${dateStr}T00:00:00`,
      amount: numericAmount,
      currency,
      type,
      account_type: "personal",
      category,
      sub_category: subCategory,
      merchant: isTransfer
        ? transferMerchant
        : merchant.trim() || "미지정",
      institution: isInvestment ? institution.trim() : null,
      settles_expense_id: isSettlement ? settlesExpenseId : null,
      account_id: accountId || null,
      counter_account_id: isTransfer ? counterAccountId || null : null,
      kind: isTransfer ? "transfer" : "normal",
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

  const merchantField = isSettlement ? (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
        정산 상대 (누구에게 받았나요)
      </label>
      <input
        value={merchant}
        onChange={(e) => setMerchant(e.target.value)}
        placeholder="예: Lucy"
        className="input-field"
      />
    </div>
  ) : (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
        사용처
      </label>
      <MerchantSelect
        options={merchantHints}
        value={merchant}
        onChange={setMerchant}
        onAdd={handleAddMerchant}
        disabled={!subCategory}
        placeholder={
          subCategory ? "사용처 선택" : "먼저 중분류를 선택하세요"
        }
        addLabel="새 사용처 추가"
      />
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

  const transferFields = isTransfer && (
    <div className="space-y-3">
      <div>
        <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
          출금 계좌
        </label>
        <AccountSelect
          accounts={accounts}
          value={accountId}
          onChange={setAccountId}
          onRegister={() => {
            setAccountRegisterTarget("primary");
            setShowAccountRegister(true);
          }}
          disabled={accountsLoading || !subCategory}
          allowNone={false}
          placeholder="출금 계좌 선택"
          variant="field"
          filterAccounts={fromAccountFilter}
        />
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
          {isCardRepayment ? "상환할 카드" : "입금 계좌"}
        </label>
        <AccountSelect
          accounts={accounts}
          value={counterAccountId}
          onChange={setCounterAccountId}
          onRegister={() => {
            setAccountRegisterTarget("counter");
            setShowAccountRegister(true);
          }}
          disabled={accountsLoading || !subCategory}
          allowNone={false}
          placeholder={isCardRepayment ? "카드 선택" : "입금 계좌 선택"}
          variant="field"
          filterAccounts={toAccountFilter}
        />
      </div>
      <p className="text-xs text-gray-400">
        자산 이동/카드는 지출/수입 합계에 포함되지 않고, 계좌 잔액만 이동합니다.
      </p>
    </div>
  );

  const detailFields = () => {
    if (isTransfer) return transferFields;
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
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full sm:max-w-md bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-2xl shadow-xl p-5 max-h-[92dvh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
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
            {!isTransfer && (
              <AccountSelect
                accounts={accounts}
                value={accountId}
                onChange={setAccountId}
                onRegister={() => {
                  setAccountRegisterTarget("primary");
                  setShowAccountRegister(true);
                }}
                disabled={accountsLoading}
              />
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

        <div className="mt-4 relative">
          <button
            type="button"
            onClick={() => {
              const input = dateInputRef.current;
              if (!input) return;
              if (typeof input.showPicker === "function") input.showPicker();
              else input.click();
            }}
            className="w-full flex items-center gap-3 rounded-2xl bg-blue-50 dark:bg-blue-500/10 px-4 py-3 text-left hover:bg-blue-100/80 dark:hover:bg-blue-500/20 transition-colors"
          >
            <CalendarDays className="h-5 w-5 text-blue-500 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                {formatDayLabel(defaultDate)}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                달력 아이콘을 눌러 날짜를 변경할 수 있어요
              </p>
            </div>
          </button>
          <input
            ref={dateInputRef}
            type="date"
            value={dateStr}
            onChange={(e) => {
              if (!e.target.value) return;
              const [y, m, d] = e.target.value.split("-").map(Number);
              onDateChange(new Date(y, m - 1, d));
            }}
            className="sr-only"
            tabIndex={-1}
            aria-label="거래 날짜"
          />
        </div>

        {dayTransactions.length > 0 && (
          <ul className="mt-3 card-inset divide-y divide-gray-100 dark:divide-gray-700 max-h-32 overflow-auto">
            {dayTransactions.map((tx) => {
              const settled = hasSettlement(tx);
              const nonCashflow = isNonCashflowTransaction(tx);
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
                      nonCashflow
                        ? "text-gray-500 dark:text-gray-400"
                        : tx.type === "income"
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
                        {nonCashflow
                          ? ""
                          : tx.type === "income"
                            ? "+"
                            : ""}
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

      {showAccountRegister && (
        <AccountRegisterModal
          currency={currency}
          preferredType={type}
          onClose={() => setShowAccountRegister(false)}
          onCreated={(created) => {
            setAccounts((prev) => {
              const cleared = prev.map((a) => ({
                ...a,
                is_default_expense: created.is_default_expense
                  ? false
                  : a.is_default_expense,
                is_default_income: created.is_default_income
                  ? false
                  : a.is_default_income,
              }));
              return [...cleared, created];
            });
            if (accountRegisterTarget === "counter") {
              setCounterAccountId(created.id);
            } else {
              setAccountId(created.id);
            }
            setShowAccountRegister(false);
          }}
        />
      )}
    </div>
  );
}
