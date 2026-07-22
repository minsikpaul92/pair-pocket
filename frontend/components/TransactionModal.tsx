"use client";

import { CalendarDays, SkipForward, Trash2, X, Plus } from "lucide-react";
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
  AccountType,
  CategoryPresets,
  Currency,
  LedgerScope,
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
  updateTransaction,
  searchStocks,
  fetchExchangeRate,
  fetchStockHoldings,
  StockHolding,
  ExchangeRate,
  ParsedTransaction,
  TransactionItem,
} from "@/lib/api";
import { translateCategory, translateSubCategory } from "@/lib/category-i18n";
import { dayKey, formatDayLabel } from "@/lib/date";
import { translateError } from "@/lib/errors";
import { translateSubscriptionSource } from "@/lib/subscription-i18n";

interface Props {
  currency: Currency;
  ledgerScope?: LedgerScope;
  accountType?: AccountType;
  parsedTransaction?: ParsedTransaction | null;
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
  onSkipPendingOccurrence?: (occ: SubscriptionOccurrence) => void;
  onPresetsChange: (presets: CategoryPresets) => void;
}

function convertCurrency(
  amount: number,
  from: Currency,
  to: Currency,
  rate: ExchangeRate | null
): number {
  if (from === to) return amount;
  if (!rate) return amount;

  const key = `${from.toLowerCase()}_${to.toLowerCase()}`;
  if (key === "usd_krw" && rate.usd_krw) return amount * rate.usd_krw;
  if (key === "krw_usd" && rate.krw_usd) return amount * rate.krw_usd;
  if (key === "usd_cad" && rate.usd_cad) return amount * rate.usd_cad;
  if (key === "cad_usd" && rate.cad_usd) return amount * rate.cad_usd;
  if (key === "cad_krw") return amount * rate.cad_krw;
  if (key === "krw_cad") return amount * rate.krw_cad;

  // Cross rate conversion fallback
  if (from === "USD" && to === "KRW" && rate.usd_cad) {
    return amount * rate.usd_cad * rate.cad_krw;
  }
  if (from === "KRW" && to === "USD" && rate.krw_cad && rate.cad_usd) {
    return amount * rate.krw_cad * rate.cad_usd;
  }
  return amount;
}

export default function TransactionModal({
  currency,
  ledgerScope = "ALL",
  accountType = "personal",
  parsedTransaction = null,
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
  onSkipPendingOccurrence,
  onPresetsChange,
}: Props) {
  const locale = useLocale();
  const tTx = useTranslations("transaction");
  const tLedger = useTranslations("ledger");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const tCategories = useTranslations("categories");
  const tSubCategories = useTranslations("subCategories");
  const tSub = useTranslations("subscriptions");

  const isEditing = Boolean(editingTransaction);

  const [type, setType] = useState<TransactionType>("expense");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [subCategory, setSubCategory] = useState("");
  const [settlesExpenseId, setSettlesExpenseId] = useState("");
  const [merchant, setMerchant] = useState("");
  const [institution, setInstitution] = useState("");

  // Stock trading states
  const [isStockTrade, setIsStockTrade] = useState(false);
  const [tradeType, setTradeType] = useState<"buy" | "sell">("buy");
  const [ticker, setTicker] = useState("");
  const [tickerSearch, setTickerSearch] = useState("");
  const [tickerSuggestions, setTickerSuggestions] = useState<{ ticker: string; name: string }[]>([]);
  const [shares, setShares] = useState("");
  const [price, setPrice] = useState("");
  const [fee, setFee] = useState("");
  const [stockName, setStockName] = useState("");
  const [txCurrency, setTxCurrency] = useState<Currency>(currency);
  const [transactionCurrency, setTransactionCurrency] = useState<Currency>(currency);
  const [exchangeRate, setExchangeRate] = useState<ExchangeRate | null>(null);
  const [dummyTrigger, setDummyTrigger] = useState(0);
  const [merchantHints, setMerchantHints] = useState<string[]>([]);
  const [institutionOptions, setInstitutionOptions] = useState<string[]>([]);
  const [settleableExpenses, setSettleableExpenses] = useState<SettleableExpense[]>(
    []
  );
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [ownedHoldings, setOwnedHoldings] = useState<StockHolding[]>([]);
  const [selectedHoldingId, setSelectedHoldingId] = useState("");
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
  const [items, setItems] = useState<TransactionItem[]>([]);
  const [showItems, setShowItems] = useState(false);
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

  const isStockBuy = type === "expense" && category === "투자/저축" && subCategory === "주식 매수";
  const isStockSell = type === "income" && category === "금융/기타" && subCategory === "주식 판매수익";
  const isStock = isStockBuy || isStockSell;

  // Filter owned holdings by active ledger currency scope and payment account
  const visibleHoldings = useMemo(() => {
    return ownedHoldings.filter((h) => {
      // 1. If account is selected, show holdings under that account
      if (accountId && accountId !== ACCOUNT_NONE) {
        return h.account_id === accountId;
      }
      // 2. Otherwise, check if account currency matches ledger currency (unless ALL)
      if (ledgerScope === "ALL") return true;
      const acc = accounts.find((a) => a.id === h.account_id);
      return acc ? acc.currency === ledgerScope : true;
    });
  }, [ownedHoldings, accountId, ledgerScope, accounts]);

  const currentCurrency = isStock ? transactionCurrency : currency;

  // Autocomplete ticker search effect
  useEffect(() => {
    if (!tickerSearch || tickerSearch.trim().length < 1) {
      setTickerSuggestions([]);
      return;
    }
    if (tickerSearch.toUpperCase() === ticker.toUpperCase()) {
      return;
    }
    const timer = setTimeout(() => {
      searchStocks(tickerSearch).then((list) => {
        setTickerSuggestions(list.map(s => ({ ticker: s.ticker, name: s.name })));
      }).catch(err => console.error("Search error", err));
    }, 400);
    return () => clearTimeout(timer);
  }, [tickerSearch, ticker]);

  // Amount auto-calculator effect
  useEffect(() => {
    if (isStock) {
      const s = parseFloat(shares);
      const p = parseFloat(price);
      if (!isNaN(s) && !isNaN(p)) {
        const tradeTotal = s * p;
        const converted = convertCurrency(tradeTotal, txCurrency, transactionCurrency, exchangeRate);
        setAmount(amountToInput(converted, transactionCurrency));
      }
    }
  }, [isStock, shares, price, txCurrency, transactionCurrency, exchangeRate]);

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
    fetchExchangeRate()
      .then(setExchangeRate)
      .catch((err) => console.error("Failed to fetch exchange rate in modal", err));
  }, []);

  useEffect(() => {
    fetchStockHoldings(accountType)
      .then(setOwnedHoldings)
      .catch((err) => console.error("Failed to fetch holdings in modal", err));
  }, [accountType]);

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
    const filterCurrency = ledgerScope === "ALL" ? undefined : (ledgerScope as Currency);
    fetchAccounts({ currency: filterCurrency, accountType })
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
  }, [ledgerScope, accountType]);

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
        setIsStockTrade(false);
        setTradeType("buy");
        setTicker("");
        setTickerSearch("");
        setShares("");
        setPrice("");
        setFee("");
        setStockName("");
        setTxCurrency(currency);
        setItems([]);
        setShowItems(false);
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
    setIsStockTrade(tx.is_stock_trade || false);
    setTradeType(tx.trade_type || "buy");
    setTicker(tx.ticker || "");
    setTickerSearch(tx.ticker || "");
    setShares(tx.shares ? tx.shares.toString() : "");
    setPrice(tx.price ? tx.price.toString() : "");
    setFee(tx.fee ? tx.fee.toString() : "");
    setTxCurrency(tx.currency);
    setItems(tx.items || []);
    setShowItems((tx.items || []).length > 0);
    setError(null);
    setHydratedEditId(tx.id);
  }, [editingTransaction, hydratedEditId, currency]);

  useEffect(() => {
    if (!parsedTransaction) return;
    setAmount(amountToInput(parsedTransaction.amount, parsedTransaction.currency));
    setMerchant(parsedTransaction.merchant || "");
    setTxCurrency(parsedTransaction.currency);
    setCategory(parsedTransaction.category || "");
    setSubCategory(parsedTransaction.sub_category || "");
    setItems(parsedTransaction.items || []);
    setShowItems((parsedTransaction.items || []).length > 0);
    if (parsedTransaction.date) {
      onDateChange(new Date(parsedTransaction.date));
    }
  }, [parsedTransaction, currency, onDateChange]);

  useEffect(() => {
    if (isEditing || isTransfer) return;
    if (isStock) {
      const key = currency === "CAD" ? "default_stock_cad_account_id" : "default_stock_krw_account_id";
      const saved = localStorage.getItem(key);
      if (saved) {
        setAccountId(saved);
        const selected = accounts.find((a) => a.id === saved);
        if (selected) {
          setInstitution(selected.institution || selected.name);
        }
      } else {
        const firstInv = accounts.find((a) => a.kind === "investment" && a.currency === currency);
        if (firstInv) {
          setAccountId(firstInv.id);
          setInstitution(firstInv.institution || firstInv.name);
        } else {
          setAccountId(ACCOUNT_NONE);
        }
      }
    } else {
      setAccountId(defaultAccountId(accounts, type));
    }
  }, [type, accounts, isTransfer, isEditing, isStock, currency]);

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
    fetchMerchantSuggestions(category, currency, subCategory, accountType).then((list) => {
      if (active) setMerchantHints(list);
    });
    return () => {
      active = false;
    };
  }, [category, subCategory, currency, accountType, isTransfer, isSettlement]);

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
      editingTransaction?.id,
      accountType
    ).then((list) => {
      if (active) setSettleableExpenses(list);
    });
    return () => {
      active = false;
    };
  }, [isSettlement, currency, accountType, isEditing, editingTransaction?.id]);

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
    if (isStock) {
      if (!ticker.trim()) {
        setError("주식 티커를 입력해 주세요.");
        return;
      }
      const numShares = parseFloat(shares);
      if (isNaN(numShares) || numShares <= 0) {
        setError("올바른 주식 수량을 입력해 주세요.");
        return;
      }
      const numPrice = parseFloat(price);
      if (isNaN(numPrice) || numPrice <= 0) {
        setError("올바른 주가 단가를 입력해 주세요.");
        return;
      }
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

    let finalInstitution = institution.trim();
    if ((isInvestment || isStock) && !finalInstitution && accountId) {
      const selected = accounts.find((a) => a.id === accountId);
      if (selected) {
        finalInstitution = (selected.institution || selected.name).trim();
      }
    }

    const finalTicker = isStock ? (ticker.trim() || tickerSearch.trim()) : "";
    if (isStock && !finalTicker) {
      setError("종목(티커)을 입력하거나 선택해 주세요.");
      return;
    }

    let finalMerchant = merchant.trim();
    if (isStock && !finalMerchant && finalTicker) {
      finalMerchant = `${stockName || finalTicker} (${finalTicker.toUpperCase()})`;
    }

    const payload: NewTransaction = {
      date: `${dateStr}T00:00:00`,
      amount: numericAmount,
      currency: currentCurrency,
      type,
      account_type: accountType,
      category,
      sub_category: subCategory,
      merchant: isTransfer
        ? transferMerchant
        : finalMerchant || tCommon("unspecified"),
      institution: (isInvestment || isStock) ? finalInstitution : null,
      settles_expense_id: isSettlement ? settlesExpenseId : null,
      account_id: accountId || null,
      counter_account_id: isTransfer ? counterAccountId || null : null,
      kind: isTransfer ? "transfer" : "normal",
      is_stock_trade: isStock,
      trade_type: isStock ? (isStockBuy ? "buy" : "sell") : undefined,
      ticker: isStock ? finalTicker.toUpperCase() : undefined,
      shares: isStock ? parseFloat(shares) : undefined,
      price: isStock ? parseFloat(price) : undefined,
      fee: undefined,
      items: showItems ? items : undefined,
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

  const stockFields = isStock && (
    <div className="space-y-4">
      <div>
        <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
          결제 계좌 (증권사 계좌)
        </label>
        <AccountSelect
          accounts={accounts}
          value={accountId}
          onChange={(val) => {
            setAccountId(val);
            const selected = accounts.find((a) => a.id === val);
            if (selected) {
              setInstitution(selected.institution || selected.name);
            }
          }}
          onRegister={() => {
            setAccountRegisterTarget("primary");
            setShowAccountRegister(true);
          }}
          disabled={accountsLoading || !subCategory}
          allowNone={false}
          placeholder="결제할 계좌 선택"
          variant="field"
          filterAccounts={(acc) => acc.kind === "investment"}
        />
        {accountId && accountId !== ACCOUNT_NONE && (
          <label className="flex items-center gap-1.5 mt-2 text-xs text-gray-500 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={
                currency === "CAD"
                  ? accountId === localStorage.getItem("default_stock_cad_account_id")
                  : accountId === localStorage.getItem("default_stock_krw_account_id")
              }
              onChange={(e) => {
                const key = currency === "CAD" ? "default_stock_cad_account_id" : "default_stock_krw_account_id";
                if (e.target.checked) {
                  localStorage.setItem(key, accountId);
                } else {
                  localStorage.removeItem(key);
                }
                setDummyTrigger((p) => p + 1);
              }}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            {currency === "CAD" ? "기본 캐나다 주식 계좌로 설정" : "기본 한국 주식 계좌로 설정"}
          </label>
        )}
      </div>

      {isStockSell ? (
        <div className="relative">
          <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
            보유종목 선택
          </label>
          <select
            value={selectedHoldingId}
            onChange={(e) => {
              const val = e.target.value;
              setSelectedHoldingId(val);
              const h = ownedHoldings.find(x => x.id === val);
              if (h) {
                setTicker(h.ticker);
                setStockName(h.name);
                setTickerSearch(h.ticker);
                setMerchant(`${h.name} (${h.ticker})`);
                
                // Auto select account
                setAccountId(h.account_id);
                
                // Set native currency
                setTxCurrency(h.currency as Currency);
              } else {
                setTicker("");
                setStockName("");
                setTickerSearch("");
                setMerchant("");
              }
            }}
            className="w-full rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3.5 py-2 text-sm focus:border-blue-500 focus:outline-none dark:text-white"
            required
          >
            <option value="">보유 주식 선택...</option>
            {visibleHoldings.map((h) => {
              const acc = accounts.find((a) => a.id === h.account_id);
              const accName = acc ? (acc.nickname || acc.name) : "알 수 없는 계좌";
              return (
                <option key={h.id} value={h.id}>
                  {accName} - {h.name} ({h.ticker}) - 보유: {h.shares}주
                </option>
              );
            })}
          </select>
          {selectedHoldingId && (() => {
            const h = ownedHoldings.find(x => x.id === selectedHoldingId);
            if (!h) return null;
            return (
              <div className="mt-1.5 text-xs text-blue-600 dark:text-blue-400 font-bold bg-blue-50 dark:bg-blue-950/30 px-3 py-1.5 rounded-lg flex items-center justify-between">
                <span>보유 수량: {h.shares} 주</span>
                <span>평균 단가: {formatAmount(h.avg_price, h.currency as Currency)}</span>
              </div>
            );
          })()}
        </div>
      ) : (
        <div className="relative">
          <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
            종목 검색 (티커/회사명)
          </label>
          <input
            type="text"
            value={tickerSearch}
            onChange={(e) => {
              setTickerSearch(e.target.value);
            }}
            className="w-full rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3.5 py-2 text-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none dark:text-white"
            placeholder="예: AAPL, 삼성전자"
            required
          />
          {tickerSuggestions.length > 0 && (
            <div className="absolute left-0 right-0 z-50 mt-1 max-h-48 overflow-y-auto rounded-lg border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-950 p-1 shadow-lg">
              {tickerSuggestions.map((s) => (
                <button
                  key={s.ticker}
                  type="button"
                  onClick={() => {
                    setTicker(s.ticker);
                    setStockName(s.name);
                    setTickerSearch(s.ticker);
                    setMerchant(`${s.name} (${s.ticker})`);
                    setTickerSuggestions([]);

                    // Auto-infer currency based on ticker suffix
                    if (s.ticker.endsWith(".KS") || s.ticker.endsWith(".KQ")) {
                      setTxCurrency("KRW");
                    } else if (s.ticker.endsWith(".TO") || s.ticker.endsWith(".V")) {
                      setTxCurrency("CAD");
                    } else {
                      setTxCurrency("USD");
                    }
                  }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 rounded-md transition-colors flex items-center justify-between"
                >
                  <span className="font-semibold text-gray-800 dark:text-gray-200">{s.ticker}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[200px]">{s.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div>
        <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
          결제 통화
        </label>
        <div className="flex rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5 max-w-[12rem]">
          {(["USD", "CAD", "KRW"] as Currency[]).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setTxCurrency(c)}
              className={`flex-1 rounded-md py-1 text-xs font-semibold transition-colors ${
                txCurrency === c
                  ? "bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-white"
                  : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
            수량
          </label>
          <input
            type="number"
            step="any"
            value={shares}
            onChange={(e) => setShares(e.target.value)}
            className="w-full rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3.5 py-2 text-sm focus:border-blue-500 focus:outline-none dark:text-white"
            placeholder="0"
            required
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
            단가 ({txCurrency === "KRW" ? "원" : txCurrency === "CAD" ? "C$" : "$"})
          </label>
          <input
            type="number"
            step="any"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="w-full rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3.5 py-2 text-sm focus:border-blue-500 focus:outline-none dark:text-white"
            placeholder="0.00"
            required
          />
        </div>
      </div>
    </div>
  );

  const detailFields = () => {
    if (isTransfer) return transferFields;
    if (isStock) return stockFields;
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
            {!isTransfer && !isStock && (
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
              <li key={occ.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onSelectPendingOccurrence?.(occ)}
                  className="flex flex-1 items-center justify-between gap-2 px-4 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800/80 transition-colors min-w-0"
                >
                  <span className={`text-sm truncate ${tone}`}>
                    {occ.subscription_name || tSub("defaultName")}
                    {translateSubscriptionSource(occ.subscription_billing_cycle, tSub) && (
                      <span className="text-[10px] text-gray-400 font-normal">
                        {" "}
                        {translateSubscriptionSource(occ.subscription_billing_cycle, tSub)}
                      </span>
                    )}
                  </span>
                  <span
                    className={`shrink-0 text-sm font-semibold whitespace-nowrap ${tone}`}
                  >
                    {formatAmount(occ.amount, occ.currency)}
                  </span>
                </button>
                {onSkipPendingOccurrence && occ.status === "pending" && (
                  <button
                    type="button"
                    onClick={() => onSkipPendingOccurrence(occ)}
                    title={tSub("skipPayment")}
                    aria-label={tSub("skipPayment")}
                    className="shrink-0 mr-2 rounded-lg p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/40 transition-colors"
                  >
                    <SkipForward className="h-4 w-4" />
                  </button>
                )}
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
                      {translateSubscriptionSource(tx.subscription_billing_cycle, tSub) && (
                        <span className="text-[10px] text-gray-400 font-normal">
                          {" "}
                          {translateSubscriptionSource(tx.subscription_billing_cycle, tSub)}
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
                  setAmount(formatAmountInput(e.target.value, transactionCurrency))
                }
                placeholder="0"
                className="input-field pr-20 text-lg font-semibold"
              />
              {isStock ? (
                <select
                  value={transactionCurrency}
                  onChange={(e) => setTransactionCurrency(e.target.value as Currency)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 bg-gray-50 dark:bg-gray-800 text-xs font-bold text-gray-700 dark:text-gray-200 border-0 rounded-lg py-1.5 px-2 focus:ring-0 focus:outline-none"
                >
                  <option value="KRW">KRW</option>
                  <option value="CAD">CAD</option>
                  <option value="USD">USD</option>
                </select>
              ) : (
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-medium text-gray-400">
                  {transactionCurrency}
                </span>
              )}
            </div>
          </div>

          {/* Sub-items (소분류 세부항목) Expandable Section */}
          <div className="border-t border-gray-100 dark:border-gray-800/80 pt-4 mt-2">
            {!showItems ? (
              <button
                type="button"
                onClick={() => {
                  setShowItems(true);
                  if (items.length === 0) {
                    setItems([{ name: "", standardized_name: "", quantity: 1, unit: "개", unit_price: 0, total_price: 0 }]);
                  }
                }}
                className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 font-semibold"
              >
                <Plus className="h-3.5 w-3.5" />
                소분류 세부 항목 추가하기
              </button>
            ) : (
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-gray-700 dark:text-gray-300">
                    소분류 세부 품목 내역 (단가/총액 자동 연동 계산)
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setItems([...items, { name: "", standardized_name: "", quantity: 1, unit: "개", unit_price: 0, total_price: 0 }]);
                      }}
                      className="text-xs text-indigo-600 hover:text-indigo-700 font-semibold flex items-center gap-0.5"
                    >
                      <Plus className="h-3 w-3" />
                      추가
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowItems(false);
                      }}
                      className="text-xs text-gray-500 hover:text-gray-700 font-semibold"
                    >
                      숨기기
                    </button>
                  </div>
                </div>

                <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1">
                  {items.map((item, itemIdx) => {
                    const updateItem = (field: keyof TransactionItem, val: any) => {
                      const newItems = [...items];
                      const updatedItem = { ...newItems[itemIdx], [field]: val };

                      // Auto calculation logic
                      if (field === "quantity" || field === "unit_price") {
                        updatedItem.total_price = Number((updatedItem.quantity * updatedItem.unit_price).toFixed(2));
                      } else if (field === "total_price") {
                        if (updatedItem.quantity > 0) {
                          updatedItem.unit_price = Number((updatedItem.total_price / updatedItem.quantity).toFixed(4));
                        }
                      }

                      newItems[itemIdx] = updatedItem;
                      setItems(newItems);

                      // Update overall transaction amount based on sum of items
                      const sumTotal = newItems.reduce((acc, it) => acc + it.total_price, 0);
                      if (sumTotal > 0) {
                        setAmount(amountToInput(sumTotal, transactionCurrency));
                      }
                    };

                    return (
                      <div key={itemIdx} className="flex flex-col sm:flex-row gap-2 items-center border border-gray-100 dark:border-gray-800 p-2.5 rounded-xl bg-gray-50/50 dark:bg-gray-800/10">
                        <div className="grid grid-cols-2 gap-2 w-full sm:flex-1">
                          <input
                            type="text"
                            placeholder="품목명 (예: 수박)"
                            value={item.name}
                            onChange={(e) => updateItem("name", e.target.value)}
                            className="bg-white dark:bg-gray-900 border-gray-250 dark:border-gray-700 rounded-lg p-2 text-xs w-full focus:ring-0 focus:outline-none border text-gray-850 dark:text-gray-100"
                            required
                          />
                          <input
                            type="text"
                            placeholder="표준품목명"
                            value={item.standardized_name || ""}
                            onChange={(e) => updateItem("standardized_name", e.target.value)}
                            className="bg-white dark:bg-gray-900 border-gray-250 dark:border-gray-700 rounded-lg p-2 text-xs w-full focus:ring-0 focus:outline-none border text-gray-850 dark:text-gray-100"
                          />
                        </div>
                        <div className="grid grid-cols-4 gap-1 w-full sm:w-[240px]">
                          <input
                            type="number"
                            step="0.01"
                            placeholder="수량"
                            value={item.quantity || ""}
                            onChange={(e) => updateItem("quantity", parseFloat(e.target.value) || 0)}
                            className="bg-white dark:bg-gray-900 border-gray-250 dark:border-gray-700 rounded-lg p-2 text-xs w-full text-right focus:ring-0 focus:outline-none border text-gray-850 dark:text-gray-100"
                            required
                          />
                          <input
                            type="text"
                            placeholder="단위"
                            value={item.unit || ""}
                            onChange={(e) => updateItem("unit", e.target.value)}
                            className="bg-white dark:bg-gray-900 border-gray-250 dark:border-gray-700 rounded-lg p-2 text-xs w-full focus:ring-0 focus:outline-none border text-gray-850 dark:text-gray-100"
                          />
                          <input
                            type="number"
                            step="0.0001"
                            placeholder="단가"
                            value={item.unit_price || ""}
                            onChange={(e) => updateItem("unit_price", parseFloat(e.target.value) || 0)}
                            className="bg-white dark:bg-gray-900 border-gray-250 dark:border-gray-700 rounded-lg p-2 text-xs w-full text-right focus:ring-0 focus:outline-none border text-gray-850 dark:text-gray-100"
                            required
                          />
                          <input
                            type="number"
                            step="0.01"
                            placeholder="합계"
                            value={item.total_price || ""}
                            onChange={(e) => updateItem("total_price", parseFloat(e.target.value) || 0)}
                            className="bg-white dark:bg-gray-900 border-gray-250 dark:border-gray-700 rounded-lg p-2 text-xs w-full text-right font-semibold focus:ring-0 focus:outline-none border text-gray-850 dark:text-gray-100"
                            required
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const newItems = items.filter((_, idx) => idx !== itemIdx);
                            setItems(newItems);
                            const sumTotal = newItems.reduce((acc, it) => acc + it.total_price, 0);
                            if (sumTotal > 0) {
                              setAmount(amountToInput(sumTotal, transactionCurrency));
                            }
                          }}
                          className="text-red-500 hover:text-red-600 p-1"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
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
          accountType={accountType}
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
