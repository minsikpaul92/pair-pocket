"use client";

import { Camera, Loader2, SkipForward, Trash2, X, Plus, ImagePlus, Play } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import AccountRegisterModal from "@/components/AccountRegisterModal";
import AccountSelect, { ACCOUNT_NONE } from "@/components/AccountSelect";
import CategorySelect from "@/components/CategorySelect";
import DayPicker from "@/components/DayPicker";
import InstitutionSelect from "@/components/InstitutionSelect";
import MerchantSelect from "@/components/MerchantSelect";
import SettlementExpenseSelect from "@/components/SettlementExpenseSelect";
import SubCategorySelect from "@/components/SubCategorySelect";
import SwipeableRow from "@/components/SwipeableRow";
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
  TRANSFER_SUB_ETRANSFER,
  TRANSFER_SUB_INVESTMENT_FUNDING,
  TRANSFER_SUB_SHARED_FUNDING,
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
  isEtransferSub,
  isNonCashflowTransaction,
  isSharedFundingSub,
  normalizeTransferCategory,
  normalizeTransferSubCategory,
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
  parseReceiptsOrStatements,
  parseReceiptItems,
} from "@/lib/api";
import { translateCategory, translateSubCategory } from "@/lib/category-i18n";
import { dayKey, parseDate } from "@/lib/date";
import { translateError } from "@/lib/errors";
import { translateSubscriptionSource } from "@/lib/subscription-i18n";

const TIP_SUB_CATEGORIES = new Set(["외식/배달", "카페/간식"]);
const NO_SPIN =
  "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";
const ITEM_GRID =
  "grid grid-cols-[minmax(6rem,2fr)_minmax(5rem,1.5fr)_minmax(3.5rem,0.75fr)_minmax(3rem,0.65fr)_minmax(4.5rem,1fr)_minmax(4.5rem,1fr)_2rem] gap-2";

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
  const [sharedAccounts, setSharedAccounts] = useState<FinancialAccount[]>([]);
  const [personalAccounts, setPersonalAccounts] = useState<FinancialAccount[]>(
    []
  );
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
  const [subtotal, setSubtotal] = useState("");
  const [taxAmount, setTaxAmount] = useState("");
  type QueuedScanImage = {
    id: string;
    file: File;
    previewUrl: string;
  };

  const MAX_IMAGES = 15;
  const [scanQueue, setScanQueue] = useState<QueuedScanImage[]>([]);
  const [scannedFile, setScannedFile] = useState<File | null>(null);
  const [dragOverModal, setDragOverModal] = useState(false);
  const dragDepthRef = useRef(0);
  const [tipPercent, setTipPercent] = useState("");
  const [tipAmount, setTipAmount] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanHint, setScanHint] = useState<string | null>(null);
  const scanInputRef = useRef<HTMLInputElement>(null);
  const [itemsScanning, setItemsScanning] = useState(false);
  const itemsScanInputRef = useRef<HTMLInputElement>(null);

  const [availableUnits, setAvailableUnits] = useState<string[]>([
    "개",
    "g",
    "kg",
    "ml",
    "L",
    "lb",
    "pack",
    "ea",
  ]);

  function handleAddCustomUnit(itemIdx: number) {
    const input = window.prompt(
      "새로운 단위를 입력하세요 (예: 박스, 봉, 병, 캔, 롤):"
    );
    if (!input) return;
    const trimmed = input.trim();
    if (!trimmed) return;
    if (!availableUnits.includes(trimmed)) {
      setAvailableUnits((prev) => [...prev, trimmed]);
    }
    const newItems = [...items];
    newItems[itemIdx] = { ...newItems[itemIdx], unit: trimmed };
    setItems(newItems);
  }

  function clearScanQueue() {
    setScanQueue((prev) => {
      prev.forEach((q) => {
        if (q.previewUrl) URL.revokeObjectURL(q.previewUrl);
      });
      return [];
    });
  }

  function addScanQueueFiles(fileList: FileList | File[] | null) {
    if (!fileList) return;
    setError(null);
    const list = Array.from(fileList as FileList | File[]);
    const valid = list.filter(
      (f) => f.type.startsWith("image/") || f.type === "application/pdf"
    );
    if (!valid.length) {
      setError("지원되는 이미지 또는 PDF 파일을 선택하세요.");
      return;
    }

    setScanQueue((prev) => {
      const room = MAX_IMAGES - prev.length;
      if (room <= 0) {
        setError(`최대 ${MAX_IMAGES}장까지 채울 수 있습니다.`);
        return prev;
      }
      const accepted = valid.slice(0, room);
      if (valid.length > room) {
        setError(`최대 ${MAX_IMAGES}장까지 채울 수 있습니다.`);
      }
      const next = accepted.map((file) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        previewUrl: file.type.startsWith("image/")
          ? URL.createObjectURL(file)
          : "",
      }));
      return [...prev, ...next];
    });

    if (scanInputRef.current) scanInputRef.current.value = "";
  }

  function removeQueuedScan(id: string) {
    setScanQueue((prev) => {
      const target = prev.find((q) => q.id === id);
      if (target && target.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((q) => q.id !== id);
    });
    setError(null);
  }

  async function startBatchModalScan() {
    if (scanning || scanQueue.length === 0) return;
    setScanning(true);
    setScanHint(null);
    setError(null);
    const files = scanQueue.map((q) => q.file);
    try {
      const results = await parseReceiptsOrStatements(files, { flowType: type });
      const flat: ParsedTransaction[] = [];
      for (const r of results as Array<ParsedTransaction & { transactions?: ParsedTransaction[] }>) {
        if (Array.isArray((r as { transactions?: ParsedTransaction[] }).transactions)) {
          for (const tx of (r as { transactions: ParsedTransaction[] }).transactions) {
            flat.push({ ...tx, file_name: r.file_name, items: tx.items || [] });
          }
        } else if (r?.date != null) {
          flat.push(r);
        }
      }
      const parsed = flat[0];
      if (!parsed) {
        setError(tTx("scanEmpty"));
        return;
      }
      setScannedFile(files[0] || null);
      applyParsedTransaction(parsed);
      setScanHint(tTx("scanFilled"));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : tTx("scanFailed"));
    } finally {
      setScanning(false);
    }
  }

  async function handleItemsScan(file: File) {
    setItemsScanning(true);
    setError(null);
    try {
      setScannedFile(file);
      const extracted = await parseReceiptItems(file);
      if (extracted && extracted.length > 0) {
        setItems(extracted);
        setShowItems(true);
      } else {
        setError("세부 품목을 인식하지 못했습니다.");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "세부 품목 분석 중 오류가 발생했습니다.");
    } finally {
      setItemsScanning(false);
      if (itemsScanInputRef.current) itemsScanInputRef.current.value = "";
    }
  }

  async function handleReParseItemsFromExisting() {
    if (!scannedFile) return;
    setItemsScanning(true);
    setError(null);
    try {
      const extracted = await parseReceiptItems(scannedFile);
      if (extracted && extracted.length > 0) {
        setItems(extracted);
        setShowItems(true);
      } else {
        setError("기존 영수증 사진에서 세부 품목을 인식하지 못했습니다.");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "세부 품목 분석 중 오류가 발생했습니다.");
    } finally {
      setItemsScanning(false);
    }
  }

  const dateStr = dayKey(defaultDate);

  const categoryOptions = useMemo(() => {
    const raw = categoriesForType(presets, type);
    if (type === "income") {
      const editingSharedFunding =
        isEditing &&
        editingTransaction &&
        normalizeTransferCategory(editingTransaction.category) ===
          TRANSFER_CATEGORY &&
        isSharedFundingSub(editingTransaction.sub_category || "");
      if (!editingSharedFunding) {
        return raw.filter((c) => c !== TRANSFER_CATEGORY);
      }
    }
    return raw;
  }, [presets, type, isEditing, editingTransaction]);

  const subCategoryOptions = useMemo(() => {
    if (!category) return [];
    const raw = subCategoriesFor(presets, type, category);
    if (
      category === TRANSFER_CATEGORY &&
      type === "expense" &&
      accountType !== "personal"
    ) {
      return raw.filter((s) => !isSharedFundingSub(s));
    }
    return raw;
  }, [presets, type, category, accountType]);

  const isInvestment =
    type === "expense" && category === EXPENSE_CATEGORY_INVESTMENT;

  const isSettlement =
    type === "income" &&
    category === INCOME_CATEGORY_SETTLEMENT &&
    subCategory === SUB_CATEGORY_SETTLEMENT;

  const normalizedSub = normalizeTransferSubCategory(subCategory);
  const isSharedFunding =
    category === TRANSFER_CATEGORY && isSharedFundingSub(normalizedSub);
  const isEtransfer =
    type === "expense" &&
    category === TRANSFER_CATEGORY &&
    isEtransferSub(normalizedSub);
  const isCardRepayment =
    type === "expense" &&
    category === TRANSFER_CATEGORY &&
    subCategory === TRANSFER_SUB_CARD_REPAYMENT;
  const isInvestmentFunding =
    type === "expense" &&
    category === TRANSFER_CATEGORY &&
    subCategory === TRANSFER_SUB_INVESTMENT_FUNDING;
  // From/to account UI for internal moves + shared funding (not e-Transfer).
  const isTransfer =
    (type === "expense" && category === TRANSFER_CATEGORY && !isEtransfer) ||
    (type === "income" && isSharedFunding);
  const isTransferCategory =
    category === TRANSFER_CATEGORY && (type === "expense" || isSharedFunding);

  const isStockBuy = type === "expense" && category === "투자/저축" && subCategory === "주식 매수";
  const isStockSell = type === "income" && category === "금융/기타" && subCategory === "주식 판매수익";
  const isStock = isStockBuy || isStockSell;

  const TAX_EXEMPT_SUB_CATEGORIES = useMemo(
    () =>
      new Set([
        "월세/모기지",
        "대중교통",
        "경조사비",
        "주식 매수",
        "FHSA 납입",
        "TFSA 납입",
        "저축성 예금",
        "세금",
        "카드 대금 결제",
        "계좌 이체",
        "투자 계좌 이체",
        "공용 계좌 입금",
        "e-Transfer",
      ]),
    []
  );

  const isTaxExemptCategory =
    category === "투자/저축" ||
    category === "세금" ||
    category === TRANSFER_CATEGORY ||
    TAX_EXEMPT_SUB_CATEGORIES.has(subCategory);

  const showTax =
    type === "expense" &&
    transactionCurrency !== "KRW" &&
    !isTaxExemptCategory;

  const ALL_TIP_SUB_CATEGORIES = useMemo(
    () => new Set(["외식/배달", "카페/간식", "택시/우버", "미용/뷰티"]),
    []
  );

  const showTip =
    type === "expense" &&
    transactionCurrency !== "KRW" &&
    ALL_TIP_SUB_CATEGORIES.has(subCategory) &&
    !isTransferCategory;

  const HST_RATE = 0.13;

  function round2(val: number): number {
    return Math.round((val + Number.EPSILON) * 100) / 100;
  }

  function handleSubtotalChange(raw: string) {
    const formatted = formatAmountInput(raw, transactionCurrency);
    setSubtotal(formatted);
    const sub = parseAmountInput(formatted);
    if (sub > 0 && showTax) {
      const tax = round2(sub * HST_RATE);
      setTaxAmount(amountToInput(tax, transactionCurrency));
      const preTip = sub + tax;
      const pct = parseFloat(tipPercent) || 0;
      let tip = parseAmountInput(tipAmount) || 0;
      if (pct > 0) {
        tip = round2(preTip * (pct / 100));
        setTipAmount(amountToInput(tip, transactionCurrency));
      }
      const tot = round2(preTip + tip);
      setAmount(amountToInput(tot, transactionCurrency));
    }
  }

  function handleTaxChange(raw: string) {
    const formatted = formatAmountInput(raw, transactionCurrency);
    setTaxAmount(formatted);
    const tax = parseAmountInput(formatted);
    const sub = parseAmountInput(subtotal);
    const tip = parseAmountInput(tipAmount);
    if (sub > 0) {
      const tot = round2(sub + tax + tip);
      setAmount(amountToInput(tot, transactionCurrency));
    }
  }

  function handleTipPercentChange(pctStr: string) {
    const cleanPct = pctStr.replace(/[^\d.]/g, "");
    setTipPercent(cleanPct);
    const pct = parseFloat(cleanPct) || 0;
    const sub = parseAmountInput(subtotal);
    const tax = parseAmountInput(taxAmount);
    const preTip = sub + tax;
    if (preTip > 0 && pct > 0) {
      const tip = round2(preTip * (pct / 100));
      setTipAmount(amountToInput(tip, transactionCurrency));
      setAmount(amountToInput(round2(preTip + tip), transactionCurrency));
    } else if (pct === 0) {
      setTipAmount("");
      setAmount(amountToInput(round2(preTip), transactionCurrency));
    }
  }

  function handleTipAmountChange(raw: string) {
    const formatted = formatAmountInput(raw, transactionCurrency);
    setTipAmount(formatted);
    const tip = parseAmountInput(formatted);
    const sub = parseAmountInput(subtotal);
    const tax = parseAmountInput(taxAmount);
    const preTip = sub + tax;
    if (preTip > 0) {
      const pct = round2((tip / preTip) * 100);
      setTipPercent(pct > 0 ? String(pct) : "");
      setAmount(amountToInput(round2(preTip + tip), transactionCurrency));
    }
  }

  function handleTotalChange(raw: string) {
    const formatted = formatAmountInput(raw, transactionCurrency);
    setAmount(formatted);
    const tot = parseAmountInput(formatted);
    if (tot > 0 && showTax) {
      const pct = parseFloat(tipPercent) || 0;
      const tipRate = pct > 0 ? pct / 100 : 0;
      const preTip = round2(tot / (1 + tipRate));
      const sub = round2(preTip / 1.13);
      const tax = round2(preTip - sub);
      const tip = round2(tot - preTip);
      setSubtotal(amountToInput(sub, transactionCurrency));
      setTaxAmount(amountToInput(tax, transactionCurrency));
      if (pct > 0) {
        setTipAmount(amountToInput(tip, transactionCurrency));
      }
    }
  }

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
  const transferToAccounts = isSharedFunding
    ? type === "income"
      ? personalAccounts
      : sharedAccounts
    : accounts;
  const transferFromAccounts = isSharedFunding
    ? type === "income"
      ? sharedAccounts
      : accountType === "personal"
        ? accounts
        : personalAccounts
    : accounts;

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

  useEffect(() => {
    if (!isSharedFunding) {
      setSharedAccounts([]);
      setPersonalAccounts([]);
      return;
    }
    let active = true;
    const filterCurrency =
      ledgerScope === "ALL" ? undefined : (ledgerScope as Currency);
    Promise.all([
      fetchAccounts({ currency: filterCurrency, accountType: "shared" }),
      fetchAccounts({ currency: filterCurrency, accountType: "personal" }),
    ])
      .then(([shared, personal]) => {
        if (!active) return;
        setSharedAccounts(shared);
        setPersonalAccounts(personal);
      })
      .catch(() => {
        if (!active) return;
        setSharedAccounts([]);
        setPersonalAccounts([]);
      });
    return () => {
      active = false;
    };
  }, [isSharedFunding, ledgerScope]);

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
        setSubtotal("");
        setTaxAmount("");
        setTipPercent("");
        setTipAmount("");
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
    setSubCategory(normalizeTransferSubCategory(tx.sub_category || ""));
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
    setSubtotal(
      tx.subtotal != null && tx.subtotal > 0
        ? amountToInput(tx.subtotal, tx.currency)
        : ""
    );
    setTaxAmount(
      tx.tax_amount != null && tx.tax_amount > 0
        ? amountToInput(tx.tax_amount, tx.currency)
        : ""
    );
    setTipPercent(
      tx.tip_percent != null && tx.tip_percent > 0
        ? String(tx.tip_percent)
        : ""
    );
    setTipAmount(
      tx.tip_amount != null && tx.tip_amount > 0
        ? amountToInput(tx.tip_amount, tx.currency)
        : ""
    );
    setError(null);
    setHydratedEditId(tx.id);
  }, [editingTransaction, hydratedEditId, currency]);

  const applyParsedTransaction = useCallback(
    (parsed: ParsedTransaction) => {
      const txCurr = parsed.currency || transactionCurrency || currency;
      const totAmount = parsed.amount || 0;
      setAmount(totAmount > 0 ? amountToInput(totAmount, txCurr) : "");
      setMerchant(parsed.merchant || "");
      setTxCurrency(txCurr);
      setCategory(parsed.category || "");
      setSubCategory(parsed.sub_category || "");
      setItems(parsed.items || []);
      setShowItems((parsed.items || []).length > 0);

      const parsedSub = parsed.subtotal;
      const parsedTax = parsed.tax_amount;
      const parsedTipAmt = parsed.tip_amount;
      const parsedTipPct = parsed.tip_percent;

      if (parsedSub != null && parsedSub > 0) {
        setSubtotal(amountToInput(parsedSub, txCurr));
        setTaxAmount(
          parsedTax != null && parsedTax > 0
            ? amountToInput(parsedTax, txCurr)
            : amountToInput(round2(parsedSub * HST_RATE), txCurr)
        );
        setTipAmount(
          parsedTipAmt != null && parsedTipAmt > 0
            ? amountToInput(parsedTipAmt, txCurr)
            : ""
        );
        setTipPercent(
          parsedTipPct != null && parsedTipPct > 0
            ? String(parsedTipPct)
            : ""
        );
      } else if (totAmount > 0 && txCurr !== "KRW") {
        // Auto-calculate Subtotal, Tax (and Tip if tip_percent is provided) from parsed Total Amount
        const tipPctNum = parsedTipPct || 0;
        const tipRate = tipPctNum > 0 ? tipPctNum / 100 : 0;
        const preTip = round2(totAmount / (1 + tipRate));
        const sub = round2(preTip / 1.13);
        const tax = round2(preTip - sub);
        const tip = round2(totAmount - preTip);

        setSubtotal(amountToInput(sub, txCurr));
        setTaxAmount(amountToInput(tax, txCurr));
        setTipAmount(
          parsedTipAmt != null && parsedTipAmt > 0
            ? amountToInput(parsedTipAmt, txCurr)
            : tip > 0
            ? amountToInput(tip, txCurr)
            : ""
        );
        setTipPercent(tipPctNum > 0 ? String(tipPctNum) : "");
      } else {
        setSubtotal("");
        setTaxAmount("");
        setTipAmount("");
        setTipPercent("");
      }

      if (parsed.date) {
        onDateChange(parseDate(parsed.date));
      }
    },
    [transactionCurrency, currency, onDateChange]
  );

  useEffect(() => {
    if (!parsedTransaction) return;
    applyParsedTransaction(parsedTransaction);
  }, [parsedTransaction, applyParsedTransaction]);

  async function handleModalScan(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files?.length) return;
    setScanning(true);
    setScanHint(null);
    setError(null);
    try {
      const results = await parseReceiptsOrStatements(Array.from(files), {
        flowType: type,
      });
      const flat: ParsedTransaction[] = [];
      for (const r of results as Array<ParsedTransaction & { transactions?: ParsedTransaction[] }>) {
        if (Array.isArray((r as { transactions?: ParsedTransaction[] }).transactions)) {
          for (const tx of (r as { transactions: ParsedTransaction[] }).transactions) {
            flat.push({ ...tx, file_name: r.file_name, items: tx.items || [] });
          }
        } else if (r?.date != null) {
          flat.push(r);
        }
      }
      const parsed = flat[0];
      if (!parsed) {
        setError(tTx("scanEmpty"));
        return;
      }
      applyParsedTransaction(parsed);
      setScanHint(tTx("scanFilled"));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : tTx("scanFailed"));
    } finally {
      setScanning(false);
      if (scanInputRef.current) scanInputRef.current.value = "";
    }
  }

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
    const cat = normalizeTransferCategory(editingTransaction.category);
    if (cat !== TRANSFER_CATEGORY && editingTransaction.kind !== "transfer") {
      return;
    }
    setAccountId(editingTransaction.account_id || ACCOUNT_NONE);
    setCounterAccountId(editingTransaction.counter_account_id || ACCOUNT_NONE);
  }, [editingTransaction, accountsLoading, accounts, sharedAccounts]);

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
    if (isEtransfer) {
      if (!accountId) {
        setError(tErrors("fromAccountRequired"));
        return;
      }
    } else if (isTransfer) {
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

    const fromLabel = transferFromAccounts.find((a) => a.id === accountId);
    const toLabel = transferToAccounts.find((a) => a.id === counterAccountId);
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

    const useTransferMerchant = isTransfer && !isEtransfer;
    const payload: NewTransaction = {
      date: `${dateStr}T00:00:00`,
      amount: numericAmount,
      currency: currentCurrency,
      type,
      account_type: accountType,
      category,
      sub_category: normalizeTransferSubCategory(subCategory),
      merchant: useTransferMerchant
        ? transferMerchant
        : finalMerchant || tCommon("unspecified"),
      institution: (isInvestment || isStock) ? finalInstitution : null,
      settles_expense_id: isSettlement ? settlesExpenseId : null,
      account_id: accountId || null,
      counter_account_id:
        isTransfer && !isEtransfer ? counterAccountId || null : null,
      kind: isTransfer && !isSharedFunding && !isEtransfer ? "transfer" : "normal",
      is_stock_trade: isStock,
      trade_type: isStock ? (isStockBuy ? "buy" : "sell") : undefined,
      ticker: isStock ? finalTicker.toUpperCase() : undefined,
      shares: isStock ? parseFloat(shares) : undefined,
      price: isStock ? parseFloat(price) : undefined,
      items: items && items.length > 0 ? items : undefined,
      subtotal: showTax && subtotal ? parseAmountInput(subtotal) || null : null,
      tax_amount: showTax && taxAmount ? parseAmountInput(taxAmount) || null : null,
      tip_percent: showTip && tipPercent
        ? parseFloat(tipPercent) || null
        : null,
      tip_amount: showTip && tipAmount
        ? parseAmountInput(tipAmount)
        : null,
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

  const transferFields = (isTransfer || isEtransfer) && (
    <div className="space-y-3">
      <div>
        <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
          {tTx("fromAccount")}
        </label>
        <AccountSelect
          accounts={transferFromAccounts}
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
      {!isEtransfer && (
        <div>
          <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
            {isCardRepayment
              ? tTx("repayCard")
              : isSharedFunding
                ? tTx("sharedToAccount")
                : tTx("toAccount")}
          </label>
          <AccountSelect
            accounts={transferToAccounts}
            value={counterAccountId}
            onChange={setCounterAccountId}
            onRegister={() => {
              setAccountRegisterTarget("counter");
              setShowAccountRegister(true);
            }}
            disabled={accountsLoading || !subCategory}
            allowNone={false}
            placeholder={
              isCardRepayment
                ? tTx("selectCard")
                : isSharedFunding
                  ? tTx("selectSharedToAccount")
                  : tTx("selectToAccount")
            }
            variant="field"
            filterAccounts={toAccountFilter}
          />
        </div>
      )}
      {isEtransfer && (
        <div>
          <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
            {tTx("etransferRecipient")}
          </label>
          <input
            type="text"
            value={merchant}
            onChange={(e) => setMerchant(e.target.value)}
            placeholder={tTx("etransferRecipientPlaceholder")}
            className="w-full rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3.5 py-2.5 text-sm focus:border-blue-500 focus:outline-none dark:text-white"
          />
        </div>
      )}
      <p className="text-xs text-gray-400">
        {isEtransfer
          ? tTx("transferNoteEtransfer")
          : isSharedFunding
            ? tTx("transferNoteSharedFunding")
            : tTx("transferNote")}
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
    if (isTransfer || isEtransfer) return transferFields;
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
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-lg sm:text-xl font-bold tracking-tight whitespace-nowrap">
                {isEditing ? tTx("edit") : tTx("new")}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                {currency === "CAD"
                  ? tLedger("canadaLedgerShort")
                  : tLedger("koreaLedgerShort")}{" "}
                · {currency}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={tCommon("close")}
              className="shrink-0 text-gray-400 hover:text-gray-700 dark:hover:text-white transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          {(allowCurrencyPick || (!isTransfer && !isStock)) && (
            <div className="flex items-center gap-2 min-w-0">
              {allowCurrencyPick && onCurrencyChange && (
                <div className="flex shrink-0 rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5">
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
                <div className="min-w-0 flex-1">
                  <AccountSelect
                    accounts={accounts}
                    value={accountId}
                    onChange={setAccountId}
                    onRegister={() => {
                      setAccountRegisterTarget("primary");
                      setShowAccountRegister(true);
                    }}
                    disabled={accountsLoading}
                    triggerClassName="w-full flex items-center justify-between gap-2 rounded-lg bg-gray-100 dark:bg-gray-800 px-2.5 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                  />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-4">
          <DayPicker
            value={defaultDate}
            onChange={onDateChange}
            locale={locale}
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
          <ul className="mt-3 card-inset divide-y divide-gray-100 dark:divide-gray-700 max-h-40 overflow-auto">
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
                  <SwipeableRow
                    onDelete={async () => {
                      if (!window.confirm(tTx("deleteConfirm"))) return;
                      try {
                        await deleteTransaction(tx.id);
                        onSaved();
                      } catch (err) {
                        setError(
                          translateError(err, tErrors, "deleteTransaction")
                        );
                      }
                    }}
                    deleteLabel={tCommon("delete")}
                  >
                    <button
                      type="button"
                      onClick={() => {
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
                          isSubscription ? "text-red-500" : ""
                        }`}
                      >
                        {tx.currency === "CAD" ? "🇨🇦" : "🇰🇷"}{" "}
                        {translateCategory(tx.category, tCategories)} ›{" "}
                        {tx.sub_category
                          ? translateSubCategory(
                              tx.sub_category,
                              tSubCategories
                            )
                          : tCommon("none")}{" "}
                        · {tx.merchant || tCommon("unspecified")}
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
                        {formatAmount(displayAmt, tx.currency)}
                      </span>
                    </button>
                  </SwipeableRow>
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

          {!isEditing && (
            <div
              onDragEnter={(e) => {
                e.preventDefault();
                e.stopPropagation();
                dragDepthRef.current += 1;
                setDragOverModal(true);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                e.stopPropagation();
                dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
                if (dragDepthRef.current === 0) setDragOverModal(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                dragDepthRef.current = 0;
                setDragOverModal(false);
                addScanQueueFiles(e.dataTransfer.files);
              }}
              className={`relative rounded-2xl border-2 border-dashed p-3 space-y-2.5 transition-all duration-150 ${
                dragOverModal
                  ? "border-blue-500 bg-blue-50 dark:bg-blue-900/40 ring-2 ring-blue-500/30 scale-[1.01]"
                  : "border-purple-200 dark:border-purple-800/60 bg-purple-50/40 dark:bg-purple-950/20"
              }`}
            >
              {dragOverModal && (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-blue-500/10 dark:bg-blue-400/10">
                  <span className="rounded-full bg-blue-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm">
                    영수증/명세서 이미지를 여기에 놓으세요
                  </span>
                </div>
              )}

              <input
                ref={scanInputRef}
                type="file"
                accept="image/*,application/pdf"
                multiple
                className="hidden"
                onChange={(e) => addScanQueueFiles(e.target.files)}
              />

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Camera className="h-4 w-4 text-purple-600 dark:text-purple-400 shrink-0" />
                  <span className="text-xs font-bold text-gray-800 dark:text-gray-200">
                    스크린샷 / 영수증으로 채우기
                  </span>
                </div>
                <span className="text-xs font-bold text-purple-600 dark:text-purple-400">
                  {scanQueue.length} / {MAX_IMAGES}장
                </span>
              </div>

              {scanQueue.length === 0 ? (
                <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-tight">
                  사진이나 PDF 명세서를 이곳으로 드래그하거나 아래 [사진 추가] 버튼을 눌러 선택하세요. (최대 15장)
                </p>
              ) : (
                <ul className="grid grid-cols-5 gap-1.5 pt-1">
                  {scanQueue.map((q) => (
                    <li key={q.id} className="relative aspect-square">
                      {q.previewUrl ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={q.previewUrl}
                          alt=""
                          className="h-full w-full rounded-lg object-cover border border-purple-200 dark:border-purple-800"
                        />
                      ) : (
                        <div className="h-full w-full rounded-lg bg-purple-100 dark:bg-purple-900/50 flex items-center justify-center text-[10px] font-bold text-purple-700 dark:text-purple-300">
                          PDF
                        </div>
                      )}
                      <button
                        type="button"
                        disabled={scanning}
                        onClick={() => removeQueuedScan(q.id)}
                        className="absolute -top-1 -right-1 rounded-full bg-gray-900/80 text-white p-0.5 disabled:opacity-50"
                        aria-label="삭제"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  disabled={scanning || scanQueue.length >= MAX_IMAGES}
                  onClick={() => scanInputRef.current?.click()}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-purple-100/80 dark:bg-purple-900/40 hover:bg-purple-200 dark:hover:bg-purple-800/60 text-purple-700 dark:text-purple-300 text-xs font-semibold py-2 transition-colors disabled:opacity-50"
                >
                  <ImagePlus className="h-3.5 w-3.5" />
                  사진 추가
                </button>

                <button
                  type="button"
                  disabled={scanning || scanQueue.length === 0}
                  onClick={() => void startBatchModalScan()}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold py-2 transition-colors disabled:opacity-50"
                >
                  {scanning ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Play className="h-3.5 w-3.5" />
                  )}
                  {scanning ? tTx("scanning") : "분석 시작"}
                </button>
              </div>

              {scanQueue.length > 0 && !scanning && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={clearScanQueue}
                    className="inline-flex items-center gap-1 text-[10px] text-gray-400 hover:text-red-500"
                  >
                    <Trash2 className="h-3 w-3" />
                    초기화
                  </button>
                </div>
              )}

              {scanHint && (
                <p className="text-xs text-purple-600 dark:text-purple-400 font-medium">
                  {scanHint}
                </p>
              )}
            </div>
          )}

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

          {showTax && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
                  {tTx("subtotalLabel")}
                </label>
                <input
                  inputMode="decimal"
                  value={subtotal}
                  onChange={(e) => handleSubtotalChange(e.target.value)}
                  placeholder="0.00"
                  className={`input-field ${NO_SPIN}`}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
                  {tTx("taxLabel")}
                </label>
                <input
                  inputMode="decimal"
                  value={taxAmount}
                  onChange={(e) => handleTaxChange(e.target.value)}
                  placeholder="0.00"
                  className={`input-field ${NO_SPIN}`}
                />
              </div>
            </div>
          )}

          {showTip && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">
                  {tTx("tipLabel")}
                </label>
                <div className="flex items-center gap-1.5">
                  {["15", "18", "20"].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => handleTipPercentChange(pct)}
                      className={`px-2.5 py-1 text-xs font-semibold rounded-lg border transition-colors ${
                        tipPercent === pct
                          ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                          : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                      }`}
                    >
                      {pct}%
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <input
                    inputMode="decimal"
                    value={tipPercent}
                    onChange={(e) => handleTipPercentChange(e.target.value)}
                    placeholder={tTx("tipPercent")}
                    className={`input-field ${NO_SPIN}`}
                  />
                </div>
                <div>
                  <input
                    inputMode="decimal"
                    value={tipAmount}
                    onChange={(e) => handleTipAmountChange(e.target.value)}
                    placeholder={tTx("tipAmount")}
                    className={`input-field ${NO_SPIN}`}
                  />
                </div>
              </div>
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
              {tTx("totalLabel")}
            </label>
            <div className="relative">
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => handleTotalChange(e.target.value)}
                placeholder="0"
                className="input-field pr-20 text-lg font-bold"
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
            <input
              ref={itemsScanInputRef}
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleItemsScan(f);
              }}
              className="hidden"
            />
            {!showItems ? (
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowItems(true);
                    if (items.length === 0) {
                      setItems([
                        {
                          name: "",
                          standardized_name: "",
                          quantity: 1,
                          unit: "개",
                          unit_price: 0,
                          total_price: 0,
                        },
                      ]);
                    }
                  }}
                  className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 font-semibold shrink-0"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {tTx("itemsAdd")}
                </button>

                <div className="flex items-center gap-1.5 flex-wrap justify-end">
                  {scannedFile && (
                    <button
                      type="button"
                      disabled={itemsScanning}
                      onClick={handleReParseItemsFromExisting}
                      className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition-colors"
                      title="기존 스캔 영수증 사진으로 세부 품목 재추출"
                    >
                      {itemsScanning ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Camera className="h-3.5 w-3.5" />
                      )}
                      기존 영수증 재분석
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={itemsScanning}
                    onClick={() => itemsScanInputRef.current?.click()}
                    className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors"
                    title="세부 품목 전용 새 사진 스캔"
                  >
                    {itemsScanning ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ImagePlus className="h-3.5 w-3.5" />
                    )}
                    {scannedFile ? "새 영수증 사진 선택" : tTx("itemsScanAi")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                  <span className="text-xs font-bold text-gray-700 dark:text-gray-300 shrink-0">
                    {tTx("itemsTitle")}
                  </span>
                  <div className="flex items-center gap-2 flex-wrap">
                    {scannedFile && (
                      <button
                        type="button"
                        disabled={itemsScanning}
                        onClick={handleReParseItemsFromExisting}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700"
                        title="기존 영수증 재분석"
                      >
                        {itemsScanning ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Camera className="h-3 w-3" />
                        )}
                        기존 영수증 재분석
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={itemsScanning}
                      onClick={() => itemsScanInputRef.current?.click()}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700"
                      title="새 영수증 스캔"
                    >
                      {itemsScanning ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <ImagePlus className="h-3 w-3" />
                      )}
                      {scannedFile ? "새 사진 선택" : tTx("itemsScanAi")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setItems([
                          ...items,
                          {
                            name: "",
                            standardized_name: "",
                            quantity: 1,
                            unit: "개",
                            unit_price: 0,
                            total_price: 0,
                          },
                        ]);
                      }}
                      className="text-xs text-indigo-600 hover:text-indigo-700 font-semibold flex items-center gap-0.5"
                    >
                      <Plus className="h-3 w-3" />
                      {tCommon("add")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowItems(false)}
                      className="text-xs text-gray-500 hover:text-gray-700 font-semibold"
                    >
                      {tTx("itemsHide")}
                    </button>
                  </div>
                </div>

                <div className="rounded-xl border border-gray-100 dark:border-gray-800 overflow-x-auto">
                  <div className="min-w-[540px]">
                    <div className={`${ITEM_GRID} bg-gray-50 dark:bg-gray-900/60 px-2 py-1.5 text-[10px] font-semibold text-gray-500`}>
                      <span>{tTx("itemName")}</span>
                      <span>{tTx("itemStandard")}</span>
                      <span className="text-right">{tTx("itemQty")}</span>
                      <span className="text-center">{tTx("itemUnit")}</span>
                      <span className="text-right">{tTx("itemUnitPrice")}</span>
                      <span className="text-right">{tTx("itemTotal")}</span>
                      <span />
                    </div>
                    <div className="max-h-[220px] overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800">
                      {items.map((item, itemIdx) => {
                        const updateItem = (
                          field: keyof TransactionItem,
                          val: string | number
                        ) => {
                          const newItems = [...items];
                          const updatedItem = {
                            ...newItems[itemIdx],
                          };

                          if (field === "unit_price") {
                            const unitP = typeof val === "number" ? val : (parseFloat(String(val)) || 0);
                            updatedItem.unit_price = unitP;
                            const qty = Number(updatedItem.quantity) > 0 ? Number(updatedItem.quantity) : 1;
                            updatedItem.total_price = Number((unitP * qty).toFixed(2));
                          } else if (field === "total_price") {
                            const totalP = typeof val === "number" ? val : (parseFloat(String(val)) || 0);
                            updatedItem.total_price = totalP;
                            const qty = Number(updatedItem.quantity) > 0 ? Number(updatedItem.quantity) : 1;
                            updatedItem.unit_price = Number((totalP / qty).toFixed(2));
                          } else if (field === "quantity") {
                            const qty = typeof val === "number" ? val : (parseFloat(String(val)) || 1);
                            updatedItem.quantity = qty;
                            const safeQty = qty > 0 ? qty : 1;
                            if (Number(updatedItem.unit_price) > 0) {
                              updatedItem.total_price = Number((Number(updatedItem.unit_price) * safeQty).toFixed(2));
                            } else if (Number(updatedItem.total_price) > 0) {
                              updatedItem.unit_price = Number((Number(updatedItem.total_price) / safeQty).toFixed(2));
                            }
                          } else {
                            (updatedItem as any)[field] = val;
                          }

                          newItems[itemIdx] = updatedItem;
                          setItems(newItems);

                          const sumTotal = newItems.reduce(
                            (acc, it) => acc + (it.total_price || 0),
                            0
                          );
                          if (sumTotal > 0) {
                            setAmount(
                              amountToInput(sumTotal, transactionCurrency)
                            );
                          }
                        };

                        return (
                          <div
                            key={itemIdx}
                            className={`${ITEM_GRID} px-2 py-1.5 items-center`}
                          >
                            <input
                              type="text"
                              placeholder={tTx("itemNamePlaceholder")}
                              value={item.name}
                              onChange={(e) =>
                                updateItem("name", e.target.value)
                              }
                              className="input-field py-1.5 text-xs"
                            />
                            <input
                              type="text"
                              placeholder={tTx("itemStandardPlaceholder")}
                              value={item.standardized_name || ""}
                              onChange={(e) =>
                                updateItem("standardized_name", e.target.value)
                              }
                              className="input-field py-1.5 text-xs"
                            />
                            <input
                              type="text"
                              inputMode="decimal"
                              value={item.quantity || ""}
                              onChange={(e) =>
                                updateItem(
                                  "quantity",
                                  parseFloat(e.target.value) || 0
                                )
                              }
                              className={`input-field py-1.5 text-xs text-right ${NO_SPIN}`}
                            />
                            <div className="flex items-center gap-0.5 min-w-0">
                              <select
                                value={item.unit || "개"}
                                onChange={(e) => {
                                  if (e.target.value === "__add__") {
                                    handleAddCustomUnit(itemIdx);
                                  } else {
                                    updateItem("unit", e.target.value);
                                  }
                                }}
                                className="input-field py-1.5 px-1 text-xs shrink min-w-0"
                              >
                                {availableUnits.map((u) => (
                                  <option key={u} value={u}>
                                    {u}
                                  </option>
                                ))}
                                <option value="__add__">+ 단위 추가</option>
                              </select>
                              <button
                                type="button"
                                onClick={() => handleAddCustomUnit(itemIdx)}
                                className="p-0.5 text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 shrink-0"
                                title="단위 추가"
                              >
                                <Plus className="h-3 w-3" />
                              </button>
                            </div>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={item.unit_price || ""}
                              onChange={(e) =>
                                updateItem(
                                  "unit_price",
                                  parseFloat(e.target.value) || 0
                                )
                              }
                              className={`input-field py-1.5 text-xs text-right ${NO_SPIN}`}
                            />
                            <input
                              type="text"
                              inputMode="decimal"
                              value={item.total_price || ""}
                              onChange={(e) =>
                                updateItem(
                                  "total_price",
                                  parseFloat(e.target.value) || 0
                                )
                              }
                              className={`input-field py-1.5 text-xs text-right font-semibold ${NO_SPIN}`}
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const newItems = items.filter(
                                  (_, idx) => idx !== itemIdx
                                );
                                setItems(newItems);
                                const sumTotal = newItems.reduce(
                                  (acc, it) => acc + it.total_price,
                                  0
                                );
                                if (sumTotal > 0) {
                                  setAmount(
                                    amountToInput(sumTotal, transactionCurrency)
                                  );
                                }
                              }}
                              className="text-red-500 hover:text-red-600 p-1"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
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
          accountType={
            isSharedFunding
              ? accountRegisterTarget === "counter"
                ? type === "income"
                  ? "personal"
                  : "shared"
                : type === "income"
                  ? "shared"
                  : "personal"
              : accountType
          }
          preferredType={type}
          onClose={() => setShowAccountRegister(false)}
          onCreated={(created) => {
            const bump = (prev: FinancialAccount[]) => {
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
            };
            setAccounts(bump);
            if (created.account_type === "shared") {
              setSharedAccounts(bump);
            } else {
              setPersonalAccounts(bump);
            }
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
