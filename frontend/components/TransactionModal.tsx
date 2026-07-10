"use client";

import { CalendarDays, Trash2, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
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
  SubscriptionOccurrence,
  Transaction,
  TransactionType,
  addCustomCategory,
  addCustomSubCategory,
  addInstitution,
  accountLabel,
  categoriesForType,
  createTransaction,
  defaultAccountId,
  deleteTransaction,
  fetchAccounts,
  fetchInstitutionSuggestions,
  fetchMerchantSuggestions,
  fetchSettleableExpenses,
  effectiveExpenseAmount,
  formatAmount,
  formatAmountInput,
  amountToInput,
  parseAmountInput,
  hasSettlement,
  isNonCashflowTransaction,
  isTransferTransaction,
  normalizeTransferCategory,
  subCategoriesFor,
  subscriptionScheduleAmountClass,
  subscriptionSourceLabel,
  updateTransaction,
} from "@/lib/api";
import { translateCategory, translateSubCategory } from "@/lib/category-i18n";
import { dayKey, formatDayLabel } from "@/lib/date";
import { translateError } from "@/lib/errors";

interface Props {
  currency: Currency;
  allowCurrencyPick?: boolean;
  onCurrencyChange?: (currency: Currency) => void;
  presets: CategoryPresets;
  defaultDate: Date;
  onDateChange: (date: Date) => void;
  dayTransactions: Transaction[];
  dayPendingOccurrences?: SubscriptionOccurrence[];
  editingTransaction?: Transaction | null;
  onClose: () => void;
  onSaved: () => void;
  onSelectTransaction?: (tx: Transaction) => void;
  onSelectPendingOccurrence?: (occ: SubscriptionOccurrence) => void;
  onPresetsChange: (presets: CategoryPresets) => void;
}

export default function TransactionModal({
  currency,
  allowCurrencyPick = false,
  onCurrencyChange,
  presets,
  defaultDate,
  onDateChange,
  dayTransactions,
  dayPendingOccurrences = [],
  editingTransaction = null,
  onClose,
  onSaved,
  onSelectTransaction,
  onSelectPendingOccurrence,
  onPresetsChange,
}: Props) {
  const locale = useLocale();
  const tTx = useTranslations("transaction");
  const tLedger = useTranslations("ledger");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const tCategories = useTranslations("categories");
  const tSubCategories = useTranslations("subCategories");

  const isEditing = Boolean(editingTransaction);

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
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hydratedEditId, setHydratedEditId] = useState<string | null>(null);
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

  // Hydrate form when opening an existing transaction for edit.
  // Reset to blank create form when editingTransaction is cleared.
  useEffect(() => {
    if (!editingTransaction) {
      if (hydratedEditId !== null) {
        setType("expense");
        setAmount("");
        setCategory("");
        setSubCategory("");
        setSettlesExpenseId("");
        setMerchant("");
        setInstitution("");
        setAccountId(ACCOUNT_NONE);
        setCounterAccountId(ACCOUNT_NONE);
        setError(null);
        setHydratedEditId(null);
      }
      return;
    }
    if (hydratedEditId === editingTransaction.id) return;

    const tx = editingTransaction;
    setType(tx.type);
    setAmount(amountToInput(tx.amount, tx.currency));
    setCategory(normalizeTransferCategory(tx.category));
    setSubCategory(tx.sub_category || "");
    setSettlesExpenseId(tx.settles_expense_id || "");
    setMerchant(tx.merchant || "");
    setInstitution(tx.institution || "");
    setAccountId(tx.account_id || ACCOUNT_NONE);
    setCounterAccountId(tx.counter_account_id || ACCOUNT_NONE);
    setError(null);
    setHydratedEditId(tx.id);
  }, [editingTransaction, hydratedEditId]);

  useEffect(() => {
    // Always re-apply the default for the active type (expense vs income).
    // Skip while editing — keep the transaction's own account.
    if (isEditing || isTransfer) return;
    setAccountId(defaultAccountId(accounts, type));
  }, [type, accounts, isTransfer, isEditing]);

  useEffect(() => {
    // Never wipe transfer accounts while editing — keep the saved from/to cards.
    if (isEditing) return;
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
  }, [isTransfer, accounts, isEditing]);

  useEffect(() => {
    if (!isTransfer || isEditing) return;
    setCounterAccountId(ACCOUNT_NONE);
  }, [subCategory, isTransfer, isEditing]);

  // Re-apply saved transfer accounts once the account list finishes loading.
  useEffect(() => {
    if (!editingTransaction || accountsLoading) return;
    if (!isTransferTransaction(editingTransaction)) return;
    setAccountId(editingTransaction.account_id || ACCOUNT_NONE);
    setCounterAccountId(editingTransaction.counter_account_id || ACCOUNT_NONE);
  }, [editingTransaction, accountsLoading, accounts]);

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
      if (!isEditing) setSettlesExpenseId("");
      return;
    }
    let active = true;
    fetchSettleableExpenses(
      currency,
      editingTransaction?.id
    ).then((list) => {
      if (active) setSettleableExpenses(list);
    });
    return () => {
      active = false;
    };
  }, [isSettlement, currency, isEditing, editingTransaction?.id]);

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
    // Keep saved transfer accounts when editing; only clear on create.
    if (!isEditing) setCounterAccountId(ACCOUNT_NONE);
    setError(null);
  }

  function handleSubCategoryChange(next: string) {
    setSubCategory(next);
    setSettlesExpenseId("");
    setMerchant("");
    if (category === TRANSFER_CATEGORY && !isEditing) {
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

    const numericAmount = parseAmountInput(amount);
    if (!numericAmount || numericAmount <= 0) {
      setError(tErrors("invalidAmount"));
      return;
    }
    if (!category) {
      setError(tErrors("categoryRequired"));
      return;
    }
    if (!subCategory) {
      setError(tErrors("subCategoryRequired"));
      return;
    }
    if (isInvestment && !institution.trim()) {
      setError(tErrors("institutionRequired"));
      return;
    }
    if (isSettlement && !settlesExpenseId) {
      setError(tErrors("settlementExpenseRequired"));
      return;
    }
    if (isTransfer) {
      if (!accountId) {
        setError(tErrors("fromAccountRequired"));
        return;
      }
      if (!counterAccountId) {
        setError(tErrors("toAccountRequired"));
        return;
      }
      if (accountId === counterAccountId) {
        setError(tErrors("accountsMustDiffer"));
        return;
      }
    }
    if (
      isSettlement &&
      selectedSettleable &&
      numericAmount > selectedSettleable.remaining_amount + 0.001
    ) {
      setError(
        tErrors("settlementExceedsRemaining", {
          amount: formatAmount(selectedSettleable.remaining_amount, currency),
        })
      );
      return;
    }

    const fromLabel = accounts.find((a) => a.id === accountId);
    const toLabel = accounts.find((a) => a.id === counterAccountId);
    const transferFallbackMerchant = translateCategory(
      TRANSFER_CATEGORY,
      tCategories
    );
    const transferMerchant =
      fromLabel && toLabel
        ? `${accountLabel(fromLabel)} → ${accountLabel(toLabel)}`
        : transferFallbackMerchant;

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
        : merchant.trim() || tCommon("unspecified"),
      institution: isInvestment ? institution.trim() : null,
      settles_expense_id: isSettlement ? settlesExpenseId : null,
      account_id: accountId || null,
      counter_account_id: isTransfer ? counterAccountId || null : null,
      kind: isTransfer ? "transfer" : "normal",
    };

    setSubmitting(true);
    try {
      if (editingTransaction) {
        await updateTransaction(editingTransaction.id, payload);
      } else {
        await createTransaction(payload);
      }
      onSaved();
    } catch (err) {
      setError(
        translateError(
          err,
          tErrors,
          editingTransaction ? "updateTransaction" : "saveTransaction"
        )
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!editingTransaction) return;
    const ok = window.confirm(tTx("deleteConfirm"));
    if (!ok) return;

    setDeleting(true);
    setError(null);
    try {
      await deleteTransaction(editingTransaction.id);
      onSaved();
    } catch (err) {
      setError(translateError(err, tErrors, "deleteTransaction"));
    } finally {
      setDeleting(false);
    }
  }

  const segmentBase =
    "flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors";

  const settlementField = isSettlement && (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
        {tTx("settlementExpense")}
      </label>
      <SettlementExpenseSelect
        options={settleableExpenses}
        value={settlesExpenseId}
        onChange={setSettlesExpenseId}
        currency={currency}
      />
      {selectedSettleable && (
        <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
          {tTx("settlementAfter", {
            merchant: selectedSettleable.merchant || tCommon("unspecified"),
          })}{" "}
          <span className="font-semibold text-red-500">
            {formatAmount(
              Math.max(
                selectedSettleable.remaining_amount - (parseAmountInput(amount) || 0),
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
        {tTx("settlementCounterparty")}
      </label>
      <input
        value={merchant}
        onChange={(e) => setMerchant(e.target.value)}
        placeholder={tTx("settlementCounterpartyPlaceholder")}
        className="input-field"
      />
    </div>
  ) : (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
        {tTx("merchant")}
      </label>
      <MerchantSelect
        options={merchantHints}
        value={merchant}
        onChange={setMerchant}
        onAdd={handleAddMerchant}
        disabled={!subCategory}
        placeholder={
          subCategory ? tTx("selectMerchant") : tTx("selectSubCategoryForMerchant")
        }
        addLabel={tTx("addMerchant")}
      />
    </div>
  );

  const institutionField = isInvestment && (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
        {tTx("institution")}
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
          {tTx("fromAccount")}
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
          placeholder={tTx("selectFromAccount")}
          variant="field"
          filterAccounts={fromAccountFilter}
        />
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
          {isCardRepayment ? tTx("repayCard") : tTx("toAccount")}
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
          placeholder={isCardRepayment ? tTx("selectCard") : tTx("selectToAccount")}
          variant="field"
          filterAccounts={toAccountFilter}
        />
      </div>
      <p className="text-xs text-gray-400">
        {tTx("transferNote")}
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
            <h2 className="text-xl font-bold tracking-tight">
              {isEditing ? tTx("edit") : tTx("new")}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
              {currency === "CAD"
                ? tLedger("canadaLedgerShort")
                : tLedger("koreaLedgerShort")}{" "}
              · {currency}
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
              aria-label={tCommon("close")}
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
                {formatDayLabel(defaultDate, locale)}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {tTx("dateHint")}
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
            aria-label={tTx("transactionDate")}
          />
        </div>

        {dayPendingOccurrences.length > 0 && (
          <ul className="mt-3 card-inset divide-y divide-gray-100 dark:divide-gray-700 max-h-28 overflow-auto">
            {dayPendingOccurrences.map((occ) => {
              const tone = subscriptionScheduleAmountClass(occ.due_date);
              return (
              <li key={occ.id}>
                <button
                  type="button"
                  onClick={() => onSelectPendingOccurrence?.(occ)}
                  className="w-full flex items-center justify-between gap-2 px-4 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800/80 transition-colors"
                >
                  <span className={`text-sm truncate ${tone}`}>
                    {occ.subscription_name || "구독"}
                    {subscriptionSourceLabel(occ.subscription_billing_cycle) && (
                      <span className="text-[10px] text-gray-400 font-normal">
                        {" "}
                        {subscriptionSourceLabel(occ.subscription_billing_cycle)}
                      </span>
                    )}
                  </span>
                  <span
                    className={`shrink-0 text-sm font-semibold whitespace-nowrap ${tone}`}
                  >
                    {formatAmount(occ.amount, occ.currency)}
                  </span>
                </button>
              </li>
            );
            })}
          </ul>
        )}

        {dayTransactions.length > 0 && (
          <ul className="mt-3 card-inset divide-y divide-gray-100 dark:divide-gray-700 max-h-32 overflow-auto">
            {dayTransactions.map((tx) => {
              const settled = hasSettlement(tx);
              const nonCashflow = isNonCashflowTransaction(tx);
              const isSubscription = Boolean(tx.subscription_id);
              const displayAmt =
                tx.type === "expense"
                  ? effectiveExpenseAmount(tx)
                  : tx.amount;
              const isActive = editingTransaction?.id === tx.id;
              return (
                <li key={tx.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (tx.subscription_id && onSelectPendingOccurrence) {
                        onSelectPendingOccurrence({
                          id: tx.id,
                          subscription_id: tx.subscription_id,
                          due_date: tx.date,
                          amount: tx.amount,
                          currency: tx.currency,
                          status: "completed",
                          transaction_id: tx.id,
                          subscription_name: tx.merchant,
                          subscription_billing_cycle:
                            tx.subscription_billing_cycle,
                        });
                        return;
                      }
                      onSelectTransaction?.(tx);
                    }}
                    className={`w-full flex items-center justify-between gap-2 px-4 py-2.5 text-left transition-colors ${
                      isActive
                        ? "bg-blue-50 dark:bg-blue-500/10"
                        : "hover:bg-gray-50 dark:hover:bg-gray-800/80"
                    }`}
                  >
                    <span
                      className={`text-sm truncate ${
                      isSubscription
                        ? "text-red-500"
                        : ""
                    }`}
                    >
                      {tx.currency === "CAD" ? "🇨🇦" : "🇰🇷"}{" "}
                      {translateCategory(tx.category, tCategories)} ›{" "}
                      {tx.sub_category
                        ? translateSubCategory(tx.sub_category, tSubCategories)
                        : tCommon("none")}{" "}
                      · {tx.merchant || tCommon("unspecified")}
                      {subscriptionSourceLabel(tx.subscription_billing_cycle) && (
                        <span className="text-[10px] text-gray-400 font-normal">
                          {" "}
                          {subscriptionSourceLabel(tx.subscription_billing_cycle)}
                        </span>
                      )}
                    </span>
                    <span
                      className={`shrink-0 text-sm font-semibold whitespace-nowrap ${
                        isSubscription
                          ? "text-red-500"
                          : nonCashflow
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
                  </button>
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
              {tCommon("expense")}
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
              {tCommon("income")}
            </button>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
              {tTx("category")}
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
              {tTx("subCategory")}
            </label>
            <SubCategorySelect
              options={subCategoryOptions}
              value={subCategory}
              onChange={handleSubCategoryChange}
              onAdd={handleAddSubCategory}
              disabled={!category}
              placeholder={
                category ? tTx("selectSubCategory") : tTx("selectSubCategoryFirst")
              }
            />
          </div>

          {detailFields()}

          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
              {tCommon("amount")}
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
                  ? tTx("editSave")
                  : tCommon("save")}
            </button>
          </div>
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
