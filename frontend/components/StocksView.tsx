"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { 
  Briefcase, 
  Camera,
  ChevronDown,
  Filter,
  GripVertical,
  Loader2,
  Plus, 
  Search, 
  TrendingDown, 
  TrendingUp, 
  Trash2, 
  X 
} from "lucide-react";

import AccountRegisterModal from "@/components/AccountRegisterModal";
import FloatingActionStack from "@/components/FloatingActionStack";
import OnboardingScreenshotScan from "@/components/OnboardingScreenshotScan";

import {
  AccountType,
  Currency,
  ExchangeRate,
  FinancialAccount,
  LedgerScope,
  OnboardingParseResult,
  StockHolding,
  StockSummary,
  StockSearchResult,
  MarketIndexQuote,
  searchStocks,
  fetchStockHoldings,
  createStockHolding,
  updateStockHolding,
  deleteStockHolding,
  defaultInvestmentAccountId,
  fetchStockSummary,
  fetchAccounts,
  fetchExchangeRate,
  fetchMarketIndices,
  fetchUserSettings,
  formatAmount,
  inferCurrencyFromTicker,
  parseOnboardingScreenshots,
  resolveAccountCountry,
} from "@/lib/api";

interface Props {
  accountType: "personal" | "shared";
  ledgerScope: LedgerScope;
  version: number;
  onChanged?: () => void;
}

type SortOption = "yield" | "valuation" | "shares";
type ViewMode = "price" | "valuation";

export default function StocksView({ accountType, ledgerScope, version, onChanged }: Props) {
  const t = useTranslations("stocks");

  // State controls
  const [displayCurrency, setDisplayCurrency] = useState<Currency>("CAD");
  const [viewMode, setViewMode] = useState<ViewMode>("valuation");
  const [sortBy, setSortBy] = useState<SortOption>("valuation");
  const [showAccountRegister, setShowAccountRegister] = useState(false);
  const [editingAccount, setEditingAccount] = useState<FinancialAccount | null>(null);
  const [accountOrder, setAccountOrder] = useState<string[]>([]);
  const [dragAccountId, setDragAccountId] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const stockCameraRef = useRef<HTMLInputElement>(null);

  // Data states
  const [holdings, setHoldings] = useState<StockHolding[]>([]);
  const [summary, setSummary] = useState<StockSummary | null>(null);
  const [investmentAccounts, setInvestmentAccounts] = useState<FinancialAccount[]>([]);
  const [rates, setRates] = useState<ExchangeRate | null>(null);
  const [loading, setLoading] = useState(true);

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedHolding, setSelectedHolding] = useState<StockHolding | null>(null);
  const [selectedHoldingGroup, setSelectedHoldingGroup] = useState<any>(null);
  const [selectedAccountIdFilter, setSelectedAccountIdFilter] = useState<string>("ALL");

  // Add holding form states
  const [searchQuery, setSearchQuery] = useState("");
  const [searchSuggestions, setSearchSuggestions] = useState<StockSearchResult[]>([]);
  const [selectedTicker, setSelectedTicker] = useState("");
  const [selectedName, setSelectedName] = useState("");
  const [selectedCurrency, setSelectedCurrency] = useState<Currency>("USD");
  const [sharesInput, setSharesInput] = useState("");
  const [priceInput, setPriceInput] = useState("");
  const [targetAccountId, setTargetAccountId] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [hasGeminiKey, setHasGeminiKey] = useState(false);
  const [aiHint, setAiHint] = useState<string | null>(null);

  // Edit holding form states
  const [editShares, setEditShares] = useState("");
  const [editPrice, setEditPrice] = useState("");

  // Indices + FX rotating strip
  const [marketIndices, setMarketIndices] = useState<MarketIndexQuote[]>([]);
  const [tickerIndex, setTickerIndex] = useState(0);

  // Fetch initial data
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const accId =
        selectedAccountIdFilter === "ALL" ? undefined : selectedAccountIdFilter;
      const [holdingsData, accountsData, ratesData, indicesData, summaryData] =
        await Promise.all([
          fetchStockHoldings(accountType),
          fetchAccounts({ accountType }),
          fetchExchangeRate(),
          fetchMarketIndices().catch(() => [] as MarketIndexQuote[]),
          fetchStockSummary(accountType, displayCurrency, accId),
        ]);

      setHoldings(holdingsData);
      setSummary(summaryData);
      setInvestmentAccounts(
        accountsData.filter((a) => a.kind === "investment" && a.is_active)
      );
      setRates(ratesData);
      setMarketIndices(indicesData);
    } catch (err) {
      console.error("Failed to load stocks data", err);
    } finally {
      setLoading(false);
    }
  }, [accountType, displayCurrency, selectedAccountIdFilter]);

  useEffect(() => {
    if (ledgerScope !== "ALL") {
      setDisplayCurrency(ledgerScope);
    }
  }, [ledgerScope]);

  useEffect(() => {
    loadData();
  }, [loadData, ledgerScope, version]);

  useEffect(() => {
    if (!showAddModal) return;
    fetchUserSettings()
      .then((s) => setHasGeminiKey(Boolean(s.has_gemini_key)))
      .catch(() => setHasGeminiKey(false));
  }, [showAddModal]);

  // Debounced Search suggestions
  useEffect(() => {
    if (!searchQuery || searchQuery.trim().length < 1) {
      setSearchSuggestions([]);
      return;
    }
    const timer = setTimeout(() => {
      searchStocks(searchQuery)
        .then((list) => setSearchSuggestions(list))
        .catch((err) => console.error("Search failed", err));
    }, 350);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Filter investment accounts by Canada/Korea tab (country), not cash currency.
  const visibleAccounts = useMemo(() => {
    if (ledgerScope === "ALL") return investmentAccounts;
    const want = ledgerScope === "CAD" ? "CA" : "KR";
    return investmentAccounts.filter((a) => {
      const country = resolveAccountCountry(a);
      if (country) return country === want;
      return a.currency === ledgerScope;
    });
  }, [investmentAccounts, ledgerScope]);

  useEffect(() => {
    const key = `pairpocket:stockAccountOrder:${accountType}:${ledgerScope}`;
    try {
      const raw = localStorage.getItem(key);
      if (raw) setAccountOrder(JSON.parse(raw) as string[]);
    } catch {
      setAccountOrder([]);
    }
  }, [accountType, ledgerScope]);

  const orderedVisibleAccounts = useMemo(() => {
    if (!accountOrder.length) return visibleAccounts;
    const orderMap = new Map(accountOrder.map((id, i) => [id, i]));
    return [...visibleAccounts].sort((a, b) => {
      const ai = orderMap.get(a.id) ?? 999;
      const bi = orderMap.get(b.id) ?? 999;
      return ai - bi;
    });
  }, [visibleAccounts, accountOrder]);

  function persistAccountOrder(ids: string[]) {
    const key = `pairpocket:stockAccountOrder:${accountType}:${ledgerScope}`;
    localStorage.setItem(key, JSON.stringify(ids));
    setAccountOrder(ids);
  }

  function reorderAccounts(fromId: string, toId: string) {
    if (fromId === toId) return;
    const ids = orderedVisibleAccounts.map((a) => a.id);
    const fromIdx = ids.indexOf(fromId);
    const toIdx = ids.indexOf(toId);
    if (fromIdx < 0 || toIdx < 0) return;
    ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, fromId);
    persistAccountOrder(ids);
  }

  const cashBalanceMap = useMemo(() => {
    const map: Record<string, number> = {};
    summary?.cash_balances?.forEach((cb) => {
      map[cb.account_id] = cb.balance;
    });
    return map;
  }, [summary]);

  useEffect(() => {
    if (!showAddModal) return;
    if (targetAccountId) return;
    const preferred = defaultInvestmentAccountId(visibleAccounts);
    if (preferred) setTargetAccountId(preferred);
  }, [showAddModal, targetAccountId, visibleAccounts]);

  const visibleAccountIds = useMemo(
    () => new Set(visibleAccounts.map((a) => a.id)),
    [visibleAccounts]
  );

  useEffect(() => {
    if (selectedAccountIdFilter === "ALL") return;
    if (!visibleAccountIds.has(selectedAccountIdFilter)) {
      setSelectedAccountIdFilter("ALL");
    }
  }, [visibleAccountIds, selectedAccountIdFilter]);

  const allAccountsLabel =
    ledgerScope === "ALL"
      ? t("allAccountsIntegrated")
      : ledgerScope === "CAD"
        ? t("allAccountsCanada")
        : t("allAccountsKorea");

  type TickerItem = {
    key: string;
    label: string;
    value: string;
    change?: string;
    positive?: boolean;
  };

  const tickerItems = useMemo((): TickerItem[] => {
    const byId = new Map(marketIndices.map((i) => [i.id, i]));
    const indexIds =
      ledgerScope === "CAD"
        ? ["nasdaq", "sp500", "dow", "tsx"]
        : ledgerScope === "KRW"
          ? ["nasdaq", "sp500", "dow", "kospi"]
          : ["nasdaq", "sp500", "dow", "kospi", "tsx"];

    const items: TickerItem[] = [];
    for (const id of indexIds) {
      const quote = byId.get(id);
      if (!quote) continue;
      const pct = quote.change_percent;
      items.push({
        key: id,
        label: t(id as "nasdaq" | "sp500" | "dow" | "kospi" | "tsx"),
        value: quote.price.toLocaleString(undefined, {
          maximumFractionDigits: quote.price >= 1000 ? 2 : 2,
        }),
        change: `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`,
        positive: pct >= 0,
      });
    }

    if (ledgerScope === "KRW" || ledgerScope === "ALL") {
      const usdKrw = rates?.usd_krw;
      if (usdKrw) {
        items.push({
          key: "fx-usd-krw",
          label: t("fxUsdKrw"),
          value: usdKrw.toLocaleString(undefined, {
            maximumFractionDigits: 2,
          }),
        });
      }
    }
    if (ledgerScope === "CAD" || ledgerScope === "ALL") {
      const usdCad = rates?.usd_cad;
      if (usdCad) {
        items.push({
          key: "fx-usd-cad",
          label: t("fxUsdCad"),
          value: usdCad.toLocaleString(undefined, {
            maximumFractionDigits: 4,
          }),
        });
      }
    }
    return items;
  }, [marketIndices, rates, ledgerScope, t]);

  useEffect(() => {
    setTickerIndex(0);
  }, [ledgerScope, tickerItems.length]);

  useEffect(() => {
    if (tickerItems.length <= 1) return;
    const id = window.setInterval(() => {
      setTickerIndex((i) => (i + 1) % tickerItems.length);
    }, 4000);
    return () => window.clearInterval(id);
  }, [tickerItems.length]);

  const activeTicker = tickerItems[tickerIndex] ?? tickerItems[0] ?? null;

  // Sort and group holdings
  const sortedHoldings = useMemo(() => {
    const filtered = holdings.filter((h) => {
      if (!visibleAccountIds.has(h.account_id)) return false;
      if (selectedAccountIdFilter === "ALL") return true;
      return h.account_id === selectedAccountIdFilter;
    });

    const groups: { [ticker: string]: StockHolding[] } = {};
    filtered.forEach((h) => {
      const t = h.ticker.toUpperCase();
      if (!groups[t]) groups[t] = [];
      groups[t].push(h);
    });

    const aggregatedList = Object.keys(groups).map((ticker) => {
      const items = groups[ticker];
      const first = items[0];
      const totalShares = items.reduce((acc, h) => acc + h.shares, 0);
      const totalInvested = items.reduce((acc, h) => acc + (h.shares * h.avg_price), 0);
      const avgPrice = totalShares > 0 ? totalInvested / totalShares : 0;
      
      const totalValuation = items.reduce((acc, h) => acc + h.valuation, 0);
      const totalProfit = items.reduce((acc, h) => acc + h.profit, 0);
      const totalYield = totalInvested > 0 ? (totalValuation - totalInvested) / totalInvested * 100 : 0;
      
      const totalDailyChange = items.reduce((acc, h) => acc + h.daily_change, 0);
      const totalPrevValuation = items.reduce((acc, h) => acc + (h.shares * h.prev_close), 0);
      const dailyChangePercent = totalPrevValuation > 0 ? (totalValuation - totalPrevValuation) / totalPrevValuation * 100 : 0;

      return {
        ...first,
        shares: totalShares,
        avg_price: avgPrice,
        invested: totalInvested,
        valuation: totalValuation,
        profit: totalProfit,
        yield: totalYield,
        daily_change: totalDailyChange,
        daily_change_percent: dailyChangePercent,
        holdings: items
      };
    });

    if (sortBy === "yield") {
      return aggregatedList.sort((a, b) => b.yield - a.yield);
    }
    if (sortBy === "valuation") {
      return aggregatedList.sort((a, b) => b.valuation - a.valuation);
    }
    if (sortBy === "shares") {
      return aggregatedList.sort((a, b) => b.shares - a.shares);
    }
    return aggregatedList;
  }, [holdings, selectedAccountIdFilter, sortBy, visibleAccountIds]);

  // Convert between CAD / KRW / USD. Account cards use account currency (Toss-style);
  // ALL-tab rollup still converts into displayCurrency.
  const convertBetween = useCallback(
    (amount: number, from: string, to: Currency): number => {
      if (!rates || from === to) return amount;
      if (to === "KRW") {
        if (from === "USD") return amount * (rates.usd_krw || 1350);
        if (from === "CAD") return amount * (rates.cad_krw || 980);
      }
      if (to === "CAD") {
        if (from === "USD") return amount * (rates.usd_cad || 1.37);
        if (from === "KRW") return amount * (rates.krw_cad || 0.001);
      }
      if (to === "USD") {
        if (from === "CAD") return amount / (rates.usd_cad || 1.37);
        if (from === "KRW") return amount / (rates.usd_krw || 1350);
      }
      return amount;
    },
    [rates]
  );

  function formatStockAmount(amount: number, currency: Currency) {
    return formatAmount(amount, currency, { plainUsd: currency === "USD" });
  }

  // Per-account stats in the account's own currency (USD wallet stays $).
  const accountStatsMap = useMemo(() => {
    const stats: Record<
      string,
      {
        valuation: number;
        invested: number;
        profit: number;
        yield: number;
        currency: Currency;
      }
    > = {};

    investmentAccounts.forEach((acc) => {
      stats[acc.id] = {
        valuation: 0,
        invested: 0,
        profit: 0,
        yield: 0,
        currency: acc.currency,
      };
    });

    holdings.forEach((h) => {
      const acc = investmentAccounts.find((a) => a.id === h.account_id);
      const target = (acc?.currency ?? h.currency) as Currency;
      if (!stats[h.account_id]) {
        stats[h.account_id] = {
          valuation: 0,
          invested: 0,
          profit: 0,
          yield: 0,
          currency: target,
        };
      }
      stats[h.account_id].valuation += convertBetween(
        h.valuation,
        h.currency,
        target
      );
      stats[h.account_id].invested += convertBetween(
        h.invested,
        h.currency,
        target
      );
    });

    Object.keys(stats).forEach((accId) => {
      const s = stats[accId];
      s.profit = s.valuation - s.invested;
      s.yield = s.invested > 0 ? (s.profit / s.invested) * 100 : 0;
    });

    return stats;
  }, [holdings, investmentAccounts, convertBetween]);

  // Handle Add Holding
  const handleAddHolding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicker || !targetAccountId || !sharesInput || !priceInput) {
      setFormError(t("formRequired"));
      return;
    }

    setSubmitting(true);
    setFormError(null);
    try {
      await createStockHolding({
        account_id: targetAccountId,
        ticker: selectedTicker,
        name: selectedName || selectedTicker,
        shares: parseFloat(sharesInput),
        avg_price: parseFloat(priceInput),
        currency: selectedCurrency,
      });
      setShowAddModal(false);
      resetAddForm();
      loadData();
      if (onChanged) onChanged();
    } catch (err: any) {
      setFormError(err.message || t("addFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Edit Holding
  const handleEditHolding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedHolding || !editShares || !editPrice) return;

    setSubmitting(true);
    try {
      await updateStockHolding(selectedHolding.id, {
        shares: parseFloat(editShares),
        avg_price: parseFloat(editPrice),
      });
      setShowEditModal(false);
      loadData();
      if (onChanged) onChanged();
    } catch (err: any) {
      alert(err.message || t("editFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Delete Holding
  const handleDeleteHolding = async (id: string) => {
    if (!confirm(t("deleteConfirm"))) return;
    try {
      await deleteStockHolding(id);
      setShowEditModal(false);
      loadData();
      if (onChanged) onChanged();
    } catch (err: any) {
      alert(err.message || t("deleteFailed"));
    }
  };

  const resetAddForm = () => {
    setSearchQuery("");
    setSearchSuggestions([]);
    setSelectedTicker("");
    setSelectedName("");
    setSharesInput("");
    setPriceInput("");
    setFormError(null);
    setAiHint(null);
  };

  async function applyAiParse(result: OnboardingParseResult) {
    const holdingsParsed = result.data.brokerage?.holdings || [];
    if (!holdingsParsed.length) {
      setAiHint(t("aiEmpty"));
      return;
    }

    const normalizeCurrency = (raw?: string): Currency => {
      const c = String(raw || "").toUpperCase();
      if (c === "KRW" || c === "CAD" || c === "USD") return c;
      return selectedCurrency;
    };

    // Multiple holdings + account selected: batch create.
    if (holdingsParsed.length > 1 && targetAccountId) {
      setSubmitting(true);
      setFormError(null);
      let ok = 0;
      try {
        for (const h of holdingsParsed) {
          const ticker = (h.ticker || "").trim().toUpperCase();
          const shares = Number(h.shares);
          if (!ticker || !Number.isFinite(shares) || shares <= 0) continue;
          await createStockHolding({
            account_id: targetAccountId,
            ticker,
            name: (h.name || ticker).trim(),
            shares,
            avg_price: Number(h.avg_price) || 0,
            currency: normalizeCurrency(h.currency),
          });
          ok += 1;
        }
        if (ok === 0) {
          setAiHint(t("aiEmpty"));
        } else {
          setAiHint(t("aiBatchSuccess", { count: ok }));
          setShowAddModal(false);
          resetAddForm();
          loadData();
          if (onChanged) onChanged();
        }
      } catch {
        setFormError(ok > 0 ? t("aiPartialFail") : t("addFailed"));
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (holdingsParsed.length > 1 && !targetAccountId) {
      setFormError(t("aiNeedAccount"));
    }

    const first = holdingsParsed[0];
    const ticker = (first.ticker || "").trim().toUpperCase();
    setSelectedTicker(ticker);
    setSelectedName((first.name || ticker).trim());
    setSearchQuery(ticker);
    setSharesInput(first.shares != null ? String(first.shares) : "");
    setPriceInput(first.avg_price != null ? String(first.avg_price) : "");
    setSelectedCurrency(normalizeCurrency(first.currency));
    setAiHint(
      holdingsParsed.length > 1
        ? t("aiFilled") + ` (${holdingsParsed.length})`
        : t("aiFilled")
    );
  }

  async function handleStockCameraFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files?.length) return;
    setScanning(true);
    setFormError(null);
    try {
      const preferred = defaultInvestmentAccountId(visibleAccounts);
      if (preferred) setTargetAccountId(preferred);
      setShowAddModal(true);
      const result = await parseOnboardingScreenshots(
        "brokerage",
        Array.from(files)
      );
      await applyAiParse(result);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : t("addFailed"));
    } finally {
      setScanning(false);
      e.target.value = "";
    }
  }

  function openEditHolding(row: (typeof sortedHoldings)[number]) {
    const firstHolding = row.holdings?.[0] || row;
    setSelectedHoldingGroup(row);
    setSelectedHolding(firstHolding);
    setEditShares(firstHolding.shares.toString());
    setEditPrice(firstHolding.avg_price.toString());
    setShowEditModal(true);
  }

  // Helpers
  const tickerGradient = (ticker: string) => {
    const colors = [
      "from-blue-500 to-indigo-600",
      "from-purple-500 to-pink-600",
      "from-teal-500 to-emerald-600",
      "from-orange-500 to-amber-600",
      "from-rose-500 to-red-600",
      "from-sky-500 to-cyan-600",
    ];
    let sum = 0;
    for (let i = 0; i < ticker.length; i++) sum += ticker.charCodeAt(i);
    return colors[sum % colors.length];
  };

  /** Country-tab totals by account currency — stock only (cash excluded from yield). */
  const totalsByCurrency = useMemo(() => {
    const map = new Map<Currency, { valuation: number; invested: number }>();
    visibleAccounts.forEach((acc) => {
      const cur = acc.currency;
      const bucket = map.get(cur) ?? { valuation: 0, invested: 0 };
      const stats = accountStatsMap[acc.id];
      if (stats) {
        bucket.valuation += stats.valuation;
        bucket.invested += stats.invested;
      }
      map.set(cur, bucket);
    });
    const order: Currency[] = ["KRW", "USD", "CAD"];
    return order
      .filter((c) => map.has(c))
      .map((currency) => {
        const v = map.get(currency)!;
        const profit = v.valuation - v.invested;
        return {
          currency,
          valuation: v.valuation,
          invested: v.invested,
          profit,
          yield: v.invested > 0 ? (profit / v.invested) * 100 : 0,
        };
      });
  }, [visibleAccounts, accountStatsMap]);

  /** Korea + All tabs: roll holdings into displayCurrency. Canada keeps native wallets. */
  const useFxRollup = ledgerScope === "ALL" || ledgerScope === "KRW";

  // Stock-only rollup (no cash) into displayCurrency.
  const totalStats = useMemo(() => {
    let val = 0;
    let inv = 0;
    visibleAccounts.forEach((acc) => {
      const stats = accountStatsMap[acc.id];
      if (!stats) return;
      if (useFxRollup) {
        val += convertBetween(stats.valuation, stats.currency, displayCurrency);
        inv += convertBetween(stats.invested, stats.currency, displayCurrency);
      } else {
        val += stats.valuation;
        inv += stats.invested;
      }
    });
    const profit = val - inv;
    const y = inv > 0 ? (profit / inv) * 100 : 0;
    return {
      valuation: val,
      profit,
      yield: y,
      invested: inv,
      currency: useFxRollup
        ? displayCurrency
        : ((totalsByCurrency[0]?.currency ?? displayCurrency) as Currency),
    };
  }, [
    visibleAccounts,
    accountStatsMap,
    useFxRollup,
    displayCurrency,
    convertBetween,
    totalsByCurrency,
  ]);

  const headerLines = useMemo(() => {
    if (selectedAccountIdFilter !== "ALL") {
      const acc = investmentAccounts.find(
        (a) => a.id === selectedAccountIdFilter
      );
      const stats = accountStatsMap[selectedAccountIdFilter] || {
        valuation: 0,
        invested: 0,
        profit: 0,
        yield: 0,
        currency: (acc?.currency ?? displayCurrency) as Currency,
      };
      if (useFxRollup) {
        const valuation = convertBetween(
          stats.valuation,
          stats.currency,
          displayCurrency
        );
        const invested = convertBetween(
          stats.invested,
          stats.currency,
          displayCurrency
        );
        const profit = valuation - invested;
        return [
          {
            currency: displayCurrency,
            valuation,
            invested,
            profit,
            yield: invested > 0 ? (profit / invested) * 100 : 0,
          },
        ];
      }
      return [
        {
          currency: stats.currency,
          valuation: stats.valuation,
          invested: stats.invested,
          profit: stats.profit,
          yield: stats.yield,
        },
      ];
    }
    if (useFxRollup) {
      return [
        {
          currency: displayCurrency,
          valuation: totalStats.valuation,
          invested: totalStats.invested,
          profit: totalStats.profit,
          yield: totalStats.yield,
        },
      ];
    }
    return totalsByCurrency;
  }, [
    selectedAccountIdFilter,
    investmentAccounts,
    accountStatsMap,
    useFxRollup,
    displayCurrency,
    convertBetween,
    totalStats,
    totalsByCurrency,
  ]);

  const cashTotalLines = useMemo(() => {
    const map = new Map<Currency, number>();
    const accounts =
      selectedAccountIdFilter === "ALL"
        ? visibleAccounts
        : visibleAccounts.filter((a) => a.id === selectedAccountIdFilter);
    accounts.forEach((acc) => {
      const cash = cashBalanceMap[acc.id] ?? 0;
      if (Math.abs(cash) < 0.0001) return;
      if (useFxRollup) {
        const converted = convertBetween(cash, acc.currency, displayCurrency);
        map.set(
          displayCurrency,
          (map.get(displayCurrency) ?? 0) + converted
        );
      } else {
        map.set(acc.currency, (map.get(acc.currency) ?? 0) + cash);
      }
    });
    return Array.from(map.entries()).map(([currency, amount]) => ({
      currency,
      amount,
    }));
  }, [
    selectedAccountIdFilter,
    visibleAccounts,
    cashBalanceMap,
    useFxRollup,
    displayCurrency,
    convertBetween,
  ]);

  return (
    <div className="space-y-4">
      {/* 1. Market Index Header (rotates indices + FX) */}
      <div className="flex items-center justify-between px-1 text-xs font-semibold text-gray-500 dark:text-gray-400">
        <div className="flex min-w-0 items-center gap-1.5 transition-opacity duration-300">
          {activeTicker ? (
            <>
              <span className="shrink-0">{activeTicker.label}</span>
              <span className="truncate text-gray-800 dark:text-gray-200 tabular-nums">
                {activeTicker.value}
              </span>
              {activeTicker.change != null && (
                <span
                  className={
                    activeTicker.positive ? "text-red-500" : "text-blue-500"
                  }
                >
                  {activeTicker.change}
                </span>
              )}
            </>
          ) : (
            <span>{t("liveSync")}</span>
          )}
        </div>
        <div
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500 animate-pulse"
          title={t("liveSync")}
        />
      </div>

      {/* 2. 내 투자 계좌 (My Investment Accounts) */}
      <div className="card-inset p-4 sm:p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-gray-700 dark:text-gray-200 tracking-tight">
              {t("performanceByAccount")}
            </h3>
            <button
              onClick={() => setShowAccountRegister(true)}
              className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-blue-500 transition-colors"
              title={t("addAccount")}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
          {selectedAccountIdFilter !== "ALL" && (
            <button
              onClick={() => setSelectedAccountIdFilter("ALL")}
              className="text-[10px] font-bold text-blue-600 hover:text-blue-700 hover:underline transition-all bg-blue-50 dark:bg-blue-950/40 px-2 py-0.5 rounded-md"
            >
              {t("showAll")}
            </button>
          )}
        </div>

        <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1 snap-x snap-mandatory">
          {/* 1. 전체 계좌 통합 카드 */}
          <button
            onClick={() => setSelectedAccountIdFilter("ALL")}
            className={`text-left p-3.5 rounded-2xl transition-all border shrink-0 w-[148px] sm:w-[160px] snap-start ${
              selectedAccountIdFilter === "ALL"
                ? "bg-blue-50/60 dark:bg-blue-950/30 border-blue-500 dark:border-blue-700 shadow-md ring-1 ring-blue-500"
                : "bg-gray-50 dark:bg-gray-900 border-transparent hover:border-gray-200 dark:hover:border-gray-700"
            }`}
          >
            <div className="text-[10px] text-gray-500 dark:text-gray-400 font-bold truncate whitespace-nowrap">
              {allAccountsLabel}
            </div>
            {useFxRollup ? (
              <>
                <div className="text-base font-black text-gray-900 dark:text-white mt-1 tabular-nums">
                  {formatStockAmount(totalStats.valuation, displayCurrency)}
                </div>
                <div
                  className={`text-[11px] font-bold mt-1.5 ${
                    totalStats.profit >= 0 ? "text-red-500" : "text-blue-500"
                  }`}
                >
                  {totalStats.profit >= 0 ? "+" : ""}
                  {formatStockAmount(totalStats.profit, displayCurrency)} (
                  {totalStats.yield.toFixed(1)}%)
                </div>
              </>
            ) : (
              <div className="mt-1 space-y-1">
                {totalsByCurrency.map((line) => (
                  <div key={line.currency}>
                    <div className="text-base font-black text-gray-900 dark:text-white tabular-nums">
                      {formatStockAmount(line.valuation, line.currency)}
                    </div>
                    <div
                      className={`text-[11px] font-bold ${
                        line.profit >= 0 ? "text-red-500" : "text-blue-500"
                      }`}
                    >
                      {line.profit >= 0 ? "+" : ""}
                      {formatStockAmount(line.profit, line.currency)} (
                      {line.yield.toFixed(1)}%)
                    </div>
                  </div>
                ))}
                {totalsByCurrency.length === 0 && (
                  <div className="text-base font-black text-gray-900 dark:text-white mt-1 tabular-nums">
                    {formatStockAmount(0, "CAD")}
                  </div>
                )}
              </div>
            )}
          </button>

          {/* 2. 개별 계좌 카드 목록 */}
          {orderedVisibleAccounts.map((acc) => {
            const isSelected = selectedAccountIdFilter === acc.id;
            const stats = accountStatsMap[acc.id] || {
              valuation: 0,
              invested: 0,
              profit: 0,
              yield: 0,
              currency: acc.currency,
            };
            const cash = cashBalanceMap[acc.id] ?? 0;
            const cardCurrency = useFxRollup ? displayCurrency : acc.currency;
            const cardValuation = useFxRollup
              ? convertBetween(stats.valuation, stats.currency, displayCurrency)
              : stats.valuation;
            const cardInvested = useFxRollup
              ? convertBetween(stats.invested, stats.currency, displayCurrency)
              : stats.invested;
            const cardProfit = cardValuation - cardInvested;
            const cardYield =
              cardInvested > 0 ? (cardProfit / cardInvested) * 100 : 0;
            const cashDisplay = useFxRollup
              ? convertBetween(cash, acc.currency, displayCurrency)
              : cash;
            const isProfit = cardProfit >= 0;
            const isDragging = dragAccountId === acc.id;
            return (
              <div
                key={acc.id}
                draggable
                onDragStart={() => setDragAccountId(acc.id)}
                onDragEnd={() => setDragAccountId(null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragAccountId) reorderAccounts(dragAccountId, acc.id);
                  setDragAccountId(null);
                }}
                className={`relative shrink-0 w-[148px] sm:w-[160px] snap-start ${isDragging ? "opacity-50" : ""}`}
              >
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setEditingAccount(acc)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") setEditingAccount(acc);
                  }}
                  className={`text-left p-3.5 rounded-2xl transition-all border w-full cursor-pointer ${
                    isSelected
                      ? "bg-blue-50/60 dark:bg-blue-950/30 border-blue-500 dark:border-blue-700 shadow-md ring-1 ring-blue-500"
                      : "bg-gray-50 dark:bg-gray-900 border-transparent hover:border-gray-200 dark:hover:border-gray-700"
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 min-w-0">
                    <GripVertical className="h-3 w-3 text-gray-300 shrink-0 cursor-grab" />
                    <span className="text-[10px] sm:text-[11px] text-gray-500 dark:text-gray-400 font-bold truncate whitespace-nowrap flex-1" title={`${acc.institution ? `[${acc.institution}] ` : ""}${acc.nickname || acc.name}`}>
                      {acc.institution ? `[${acc.institution}] ` : ""}{acc.nickname || acc.name}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedAccountIdFilter((prev) =>
                          prev === acc.id ? "ALL" : acc.id
                        );
                      }}
                      className={`p-0.5 rounded-md shrink-0 ${
                        isSelected
                          ? "text-blue-600"
                          : "text-gray-300 hover:text-blue-500"
                      }`}
                      title={t("filterAccount")}
                    >
                      <Filter className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="text-[9px] font-black uppercase tracking-wider text-gray-400 mt-0.5">
                    {acc.currency}
                    {useFxRollup && acc.currency !== displayCurrency
                      ? ` → ${displayCurrency}`
                      : ""}
                  </div>
                  <div className="text-base font-black text-gray-900 dark:text-white mt-0.5 tabular-nums">
                    {formatStockAmount(cardValuation, cardCurrency)}
                  </div>
                  <div className={`text-[11px] font-bold mt-1 ${isProfit ? "text-red-500" : "text-blue-500"}`}>
                    {isProfit ? "+" : ""}
                    {formatStockAmount(cardProfit, cardCurrency)} ({cardYield.toFixed(1)}%)
                  </div>
                  <div className="text-[10px] text-gray-400 mt-1 tabular-nums">
                    {t("cashBalance")}: {formatStockAmount(cashDisplay, cardCurrency)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. My Investments Valuation Card */}
      <div className="card-inset p-4 sm:p-5 relative overflow-hidden">
        <div className="flex items-center justify-between mb-2 gap-2">
          <h3 className="text-sm font-bold text-gray-400 dark:text-gray-500 tracking-wider">
            {t("myInvestment")}
          </h3>
          <div className="flex items-center gap-2">
            {ledgerScope === "KRW" && (
              <div className="flex rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5">
                <button
                  type="button"
                  onClick={() => setDisplayCurrency("KRW")}
                  className={`rounded-md px-2 py-1 text-[10px] font-semibold transition-colors ${
                    displayCurrency === "KRW"
                      ? "bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-white"
                      : "text-gray-500"
                  }`}
                >
                  {t("displayKrw")}
                </button>
                <button
                  type="button"
                  onClick={() => setDisplayCurrency("USD")}
                  className={`rounded-md px-2 py-1 text-[10px] font-semibold transition-colors ${
                    displayCurrency === "USD"
                      ? "bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-white"
                      : "text-gray-500"
                  }`}
                >
                  {t("displayUsd")}
                </button>
              </div>
            )}
            <Briefcase className="h-4 w-4 text-gray-400 opacity-60" />
          </div>
        </div>

        {loading ? (
          <div className="h-16 animate-pulse bg-gray-100 dark:bg-gray-800 rounded-xl" />
        ) : (
          <div className="space-y-3">
            {headerLines.map((line) => (
              <div key={line.currency}>
                <div className="text-3xl font-black tracking-tight text-gray-900 dark:text-white mt-1 tabular-nums">
                  {formatStockAmount(line.valuation, line.currency)}
                </div>
                <div className="flex items-center gap-1.5 mt-1.5">
                  <span
                    className={`text-sm font-bold flex items-center gap-0.5 ${
                      line.profit >= 0 ? "text-red-500" : "text-blue-500"
                    }`}
                  >
                    {line.profit >= 0 ? (
                      <TrendingUp className="h-3.5 w-3.5" />
                    ) : (
                      <TrendingDown className="h-3.5 w-3.5" />
                    )}
                    {formatStockAmount(line.profit, line.currency)} (
                    {line.yield.toFixed(2)}%)
                  </span>
                </div>
                <div className="text-[10px] text-gray-400 mt-2">
                  {t("totalInvestedLabel", {
                    amount: formatStockAmount(line.invested, line.currency),
                  })}
                </div>
              </div>
            ))}
            {cashTotalLines.length > 0 && (
              <div className="text-[11px] text-gray-400 tabular-nums space-y-0.5">
                {cashTotalLines.map((line) => (
                  <div key={line.currency}>
                    {t("cashBalance")}:{" "}
                    {formatStockAmount(line.amount, line.currency)}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>      {/* 4. Sorting & Filter Controls Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
        {/* Toggle selectors */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Active Account Filter Badge */}
          <div className="flex items-center gap-1.5 bg-blue-50/50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400 px-3 py-1.5 rounded-xl text-xs font-bold shadow-sm border border-blue-100/50 dark:border-blue-900/40 select-none">
            {selectedAccountIdFilter === "ALL" ? (
              <span className="truncate max-w-[10rem] sm:max-w-none">{allAccountsLabel}</span>
            ) : (
              <div className="flex items-center gap-1">
                <span>
                  {(() => {
                    const matchedAcc = investmentAccounts.find((a) => a.id === selectedAccountIdFilter);
                    return matchedAcc
                      ? `${matchedAcc.institution ? `[${matchedAcc.institution}] ` : ""}${matchedAcc.name}`
                      : t("filteredAccount");
                  })()}
                </span>
                <button
                  onClick={() => setSelectedAccountIdFilter("ALL")}
                  className="hover:text-blue-800 dark:hover:text-blue-300 font-black ml-1.5"
                  title={t("clearFilter")}
                >
                  ✕
                </button>
              </div>
            )}
          </div>

          {/* Ticker / Valuation Toggle */}
          <div className="flex rounded-xl bg-gray-100 dark:bg-gray-800 p-0.5 shadow-inner">
            <button
              onClick={() => setViewMode("valuation")}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-all ${
                viewMode === "valuation"
                  ? "bg-white dark:bg-gray-700 shadow-sm text-gray-800 dark:text-white"
                  : "text-gray-500 hover:text-gray-800 dark:hover:text-gray-300"
              }`}
            >
              {t("evaluatedAmount")}
            </button>
            <button
              onClick={() => setViewMode("price")}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-all ${
                viewMode === "price"
                  ? "bg-white dark:bg-gray-700 shadow-sm text-gray-800 dark:text-white"
                  : "text-gray-500 hover:text-gray-800 dark:hover:text-gray-300"
              }`}
            >
              {t("currentPrice")}
            </button>
          </div>

          {/* CAD / KRW on ALL; KRW / USD on Korea */}
          {ledgerScope === "ALL" && (
          <div className="flex rounded-xl bg-gray-100 dark:bg-gray-800 p-0.5 shadow-inner">
            <button
              onClick={() => setDisplayCurrency("CAD")}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-all ${
                displayCurrency === "CAD"
                  ? "bg-white dark:bg-gray-700 shadow-sm text-gray-800 dark:text-white"
                  : "text-gray-500 hover:text-gray-800 dark:hover:text-gray-300"
              }`}
            >
              {t("displayCad")}
            </button>
            <button
              onClick={() => setDisplayCurrency("KRW")}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-all ${
                displayCurrency === "KRW"
                  ? "bg-white dark:bg-gray-700 shadow-sm text-gray-800 dark:text-white"
                  : "text-gray-500 hover:text-gray-800 dark:hover:text-gray-300"
              }`}
            >
              {t("displayKrw")}
            </button>
          </div>
          )}
          {ledgerScope === "KRW" && (
          <div className="flex rounded-xl bg-gray-100 dark:bg-gray-800 p-0.5 shadow-inner">
            <button
              onClick={() => setDisplayCurrency("KRW")}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-all ${
                displayCurrency === "KRW"
                  ? "bg-white dark:bg-gray-700 shadow-sm text-gray-800 dark:text-white"
                  : "text-gray-500 hover:text-gray-800 dark:hover:text-gray-300"
              }`}
            >
              {t("displayKrw")}
            </button>
            <button
              onClick={() => setDisplayCurrency("USD")}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-all ${
                displayCurrency === "USD"
                  ? "bg-white dark:bg-gray-700 shadow-sm text-gray-800 dark:text-white"
                  : "text-gray-500 hover:text-gray-800 dark:hover:text-gray-300"
              }`}
            >
              {t("displayUsd")}
            </button>
          </div>
          )}
        </div>

        {/* Sort selector & Add Button */}
        <div className="flex items-center justify-between sm:justify-end gap-3">
          <div className="relative">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              aria-label={t("sortLabel")}
              className="appearance-none cursor-pointer rounded-lg bg-transparent border-0 outline-none focus:ring-0 pr-5 text-xs font-bold text-gray-500 dark:text-gray-400"
            >
              <option value="valuation" className="bg-white dark:bg-gray-900">{t("sortValuation")}</option>
              <option value="yield" className="bg-white dark:bg-gray-900">{t("sortYield")}</option>
              <option value="shares" className="bg-white dark:bg-gray-900">{t("sortShares")}</option>
            </select>
            <ChevronDown
              className="pointer-events-none absolute right-0 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400"
              aria-hidden
            />
          </div>

          <button
            onClick={() => {
              resetAddForm();
              setShowAddModal(true);
            }}
            className="flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-3 py-1.5 rounded-xl shadow-md transition-all active:scale-95"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("addHolding")}
          </button>
        </div>
      </div>

      {/* 5. Holdings List */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-16 animate-pulse bg-gray-100 dark:bg-gray-800 rounded-2xl" />
          ))}
        </div>
      ) : sortedHoldings.length === 0 ? (
        <div className="text-center py-10 card-inset">
          <p className="text-sm text-gray-500 dark:text-gray-400">{t("noHoldings")}</p>
          <button
            onClick={() => setShowAddModal(true)}
            className="mt-3 text-xs font-bold text-blue-600 hover:underline"
          >
            {t("addFirstHolding")}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {sortedHoldings.map((row) => {
            const isProfit = row.profit >= 0;
            const rowCurrency = row.currency as Currency;
            const listCurrency = useFxRollup ? displayCurrency : rowCurrency;
            const listValuation = useFxRollup
              ? convertBetween(row.valuation, rowCurrency, displayCurrency)
              : row.valuation;
            const listPrice = useFxRollup
              ? convertBetween(row.price, rowCurrency, displayCurrency)
              : row.price;
            const listProfit = useFxRollup
              ? convertBetween(row.profit, rowCurrency, displayCurrency)
              : row.profit;
            const listAvg = useFxRollup
              ? convertBetween(row.avg_price, rowCurrency, displayCurrency)
              : row.avg_price;
            return (
              <div
                key={row.id}
                role="button"
                tabIndex={0}
                onClick={() => openEditHolding(row)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") openEditHolding(row);
                }}
                className="flex items-center justify-between gap-3 p-4 bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800/80 hover:shadow-md transition-shadow group cursor-pointer"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {/* Circle initial gradient logo */}
                  <div className={`h-10 w-10 shrink-0 rounded-full bg-gradient-to-tr ${tickerGradient(row.ticker)} flex items-center justify-center text-white font-black text-xs shadow-sm`}>
                    {row.ticker.substring(0, 2)}
                  </div>
                  
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-gray-900 dark:text-white text-sm truncate">{row.name}</span>
                      <span className="text-[10px] bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 px-1.5 py-0.5 rounded-md font-bold uppercase tracking-wider">{row.ticker}</span>
                    </div>
                    <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                      {t("sharesAvg", {
                        shares: row.shares,
                        avg: formatStockAmount(listAvg, listCurrency),
                      })}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <div className="font-bold text-gray-900 dark:text-white text-sm">
                      {viewMode === "valuation"
                        ? formatStockAmount(listValuation, listCurrency)
                        : formatStockAmount(listPrice, listCurrency)}
                    </div>
                    <div className={`text-xs font-semibold mt-0.5 ${isProfit ? "text-red-500" : "text-blue-500"}`}>
                      {isProfit ? "+" : ""}
                      {formatStockAmount(listProfit, listCurrency)} ({row.yield.toFixed(1)}%)
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 6. Manually Add Stock Holding Modal */}
      {showAddModal && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowAddModal(false);
            }
          }}
        >
          <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-3xl p-5 shadow-2xl relative border border-gray-100 dark:border-gray-800 animate-in fade-in zoom-in-95 duration-150 max-h-[92dvh] overflow-y-auto">
            <button
              onClick={() => setShowAddModal(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              <X className="h-5 w-5" />
            </button>
            <h3 className="text-lg font-black tracking-tight text-gray-900 dark:text-white mb-4">
              {t("addHolding")}
            </h3>

            <form onSubmit={handleAddHolding} className="space-y-4">
              {formError && (
                <div className="bg-red-50 dark:bg-red-950/30 text-red-500 text-xs px-3 py-2 rounded-xl">
                  {formError}
                </div>
              )}

              {/* Brokerage Account Select */}
              <div>
                <label className="mb-1.5 block text-xs font-bold text-gray-400 dark:text-gray-500">
                  {t("brokerageAccount")}
                </label>
                <select
                  value={targetAccountId}
                  onChange={(e) => setTargetAccountId(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 dark:border-gray-850 bg-white dark:bg-gray-900 px-3.5 py-2 text-sm focus:border-blue-500 focus:outline-none dark:text-white"
                  required
                >
                  <option value="">{t("selectBrokerage")}</option>
                  {visibleAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.institution ? `[${acc.institution}] ` : ""}
                      {acc.name} ({acc.currency})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <OnboardingScreenshotScan
                  step="brokerage"
                  hasApiKey={hasGeminiKey}
                  disabled={submitting}
                  onParsed={applyAiParse}
                />
                {aiHint && (
                  <p className="text-xs text-blue-600 dark:text-blue-400">{aiHint}</p>
                )}
              </div>

              {/* Ticker Search & Auto-complete */}
              <div className="relative">
                <label className="mb-1.5 block text-xs font-bold text-gray-400 dark:text-gray-500">
                  {t("searchTicker")}
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 dark:border-gray-850 bg-white dark:bg-gray-900 pl-9 pr-3.5 py-2 text-sm focus:border-blue-500 focus:outline-none dark:text-white"
                    placeholder={t("searchPlaceholder")}
                  />
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                </div>

                {searchSuggestions.length > 0 && (
                  <div className="absolute left-0 right-0 z-50 mt-1 max-h-48 overflow-y-auto rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-950 p-1 shadow-2xl">
                    {searchSuggestions.map((s) => (
                      <button
                        key={s.ticker}
                        type="button"
                        onClick={() => {
                          setSelectedTicker(s.ticker);
                          setSelectedName(s.name);
                          setSearchQuery(`${s.name} (${s.ticker})`);
                          setSelectedCurrency(
                            inferCurrencyFromTicker(s.ticker) || "USD"
                          );
                          setSearchSuggestions([]);
                        }}
                        className="w-full text-left px-3 py-2.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors flex items-center justify-between"
                      >
                        <span className="font-bold text-gray-800 dark:text-gray-200">{s.ticker}</span>
                        <span className="text-[10px] text-gray-400 truncate max-w-[200px]">{s.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {selectedTicker && (
                <div className="bg-blue-50/50 dark:bg-blue-950/20 p-3 rounded-xl flex justify-between items-center text-xs">
                  <div>
                    <div className="font-bold text-blue-600 dark:text-blue-400">{selectedName}</div>
                    <div className="text-[10px] text-gray-400 mt-0.5">{selectedTicker} · {selectedCurrency}</div>
                  </div>
                  <span className="bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 font-black px-2 py-0.5 rounded text-[10px]">
                    {t("selected")}
                  </span>
                </div>
              )}

              {/* Currency Selector for Purchase */}
              <div>
                <label className="mb-1.5 block text-xs font-bold text-gray-400 dark:text-gray-500">
                  {t("purchaseCurrency")}
                </label>
                <div className="flex rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5 max-w-[12rem]">
                  {(["USD", "CAD", "KRW"] as Currency[]).map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setSelectedCurrency(c)}
                      className={`flex-1 rounded-md py-1 text-xs font-semibold transition-colors ${
                        selectedCurrency === c
                          ? "bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-white"
                          : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>

              {/* Shares and Avg Price Input */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-xs font-bold text-gray-400 dark:text-gray-500">
                    {t("holdingShares")}
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={sharesInput}
                    onChange={(e) => setSharesInput(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 dark:border-gray-850 bg-white dark:bg-gray-900 px-3.5 py-2 text-sm focus:border-blue-500 focus:outline-none dark:text-white"
                    placeholder="예: 10"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-bold text-gray-400 dark:text-gray-500">
                    {t("holdingAvgPrice")} ({selectedCurrency})
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={priceInput}
                    onChange={(e) => setPriceInput(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 dark:border-gray-850 bg-white dark:bg-gray-900 px-3.5 py-2 text-sm focus:border-blue-500 focus:outline-none dark:text-white"
                    placeholder="0.00"
                    required
                  />
                </div>
              </div>

              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 bg-gray-100 hover:bg-gray-200 dark:bg-gray-850 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300 text-sm font-bold py-2.5 rounded-xl transition-all"
                >
                  {t("cancel")}
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold py-2.5 rounded-xl transition-all disabled:opacity-50"
                >
                  {submitting ? t("submitting") : t("submitAdd")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 7. Manually Edit Stock Holding Modal */}
      {showEditModal && selectedHolding && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowEditModal(false);
            }
          }}
        >
          <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-3xl p-5 shadow-2xl relative border border-gray-100 dark:border-gray-800 animate-in fade-in zoom-in-95 duration-150">
            <button
              onClick={() => setShowEditModal(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              <X className="h-5 w-5" />
            </button>
            <h3 className="text-lg font-black tracking-tight text-gray-900 dark:text-white mb-2">
              {t("editHolding")}
            </h3>
            <p className="text-xs text-gray-400 mb-4">{selectedHolding.name} ({selectedHolding.ticker})</p>

            <form onSubmit={handleEditHolding} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-bold text-gray-400 dark:text-gray-500">
                  {t("ownedAccount")}
                </label>
                {selectedHoldingGroup?.holdings && selectedHoldingGroup.holdings.length > 1 ? (
                  <select
                    value={selectedHolding.id}
                    onChange={(e) => {
                      const found = selectedHoldingGroup.holdings.find((h: any) => h.id === e.target.value);
                      if (found) {
                        setSelectedHolding(found);
                        setEditShares(found.shares.toString());
                        setEditPrice(found.avg_price.toString());
                      }
                    }}
                    className="w-full rounded-xl border border-gray-200 dark:border-gray-850 bg-white dark:bg-gray-900 px-3.5 py-2 text-sm focus:border-blue-500 focus:outline-none dark:text-white"
                  >
                    {selectedHoldingGroup.holdings.map((h: any) => (
                      <option key={h.id} value={h.id}>
                        {h.account_name || h.institution} ({h.shares}주)
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="text-sm font-semibold text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 px-3.5 py-2 rounded-xl">
                    {selectedHolding.account_name || selectedHolding.institution || t("defaultAccount")}
                  </div>
                )}
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-bold text-gray-400 dark:text-gray-500">
                  {t("holdingShares")}
                </label>
                <input
                  type="number"
                  step="any"
                  value={editShares}
                  onChange={(e) => setEditShares(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 dark:border-gray-850 bg-white dark:bg-gray-900 px-3.5 py-2 text-sm focus:border-blue-500 focus:outline-none dark:text-white"
                  required
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-bold text-gray-400 dark:text-gray-500">
                  {t("holdingAvgPrice")} ({selectedHolding.currency})
                </label>
                <input
                  type="number"
                  step="any"
                  value={editPrice}
                  onChange={(e) => setEditPrice(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 dark:border-gray-850 bg-white dark:bg-gray-900 px-3.5 py-2 text-sm focus:border-blue-500 focus:outline-none dark:text-white"
                  required
                />
              </div>

              <div className="pt-2 flex justify-between items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleDeleteHolding(selectedHolding.id)}
                  className="bg-red-50 hover:bg-red-100 dark:bg-red-950/20 dark:hover:bg-red-950/40 text-red-500 p-2.5 rounded-xl transition-all"
                  title={t("delete")}
                >
                  <Trash2 className="h-5 w-5" />
                </button>
                <div className="flex gap-2 flex-1">
                  <button
                    type="button"
                    onClick={() => {
                      setShowEditModal(false);
                      setSelectedHoldingGroup(null);
                    }}
                    className="flex-1 bg-gray-100 hover:bg-gray-200 dark:bg-gray-850 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300 text-sm font-bold py-2.5 rounded-xl transition-all"
                  >
                    {t("cancel")}
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold py-2.5 rounded-xl transition-all disabled:opacity-50"
                  >
                    {submitting ? t("submitting") : t("submitSave")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowEditModal(false);
                      setSelectedHoldingGroup(null);
                      resetAddForm();
                      setShowAddModal(true);
                    }}
                    className="shrink-0 bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/30 dark:hover:bg-blue-950/50 text-blue-600 p-2.5 rounded-xl transition-all"
                    title={t("addHolding")}
                  >
                    <Plus className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {showAccountRegister && (
        <AccountRegisterModal
          currency={displayCurrency}
          accountType={accountType}
          preferredType="expense"
          country={ledgerScope === "KRW" ? "KR" : ledgerScope === "CAD" ? "CA" : null}
          initialKind="investment"
          onClose={() => setShowAccountRegister(false)}
          onCreated={() => {
            setShowAccountRegister(false);
            loadData();
            if (onChanged) onChanged();
          }}
        />
      )}

      {editingAccount && (
        <AccountRegisterModal
          currency={editingAccount.currency}
          accountType={accountType}
          preferredType="income"
          account={editingAccount}
          country={resolveAccountCountry(editingAccount)}
          onClose={() => setEditingAccount(null)}
          onCreated={() => {
            setEditingAccount(null);
            loadData();
            if (onChanged) onChanged();
          }}
          onUpdated={() => {
            setEditingAccount(null);
            loadData();
            if (onChanged) onChanged();
          }}
        />
      )}

      <input
        ref={stockCameraRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void handleStockCameraFiles(e)}
      />

      <FloatingActionStack
        onCamera={() => stockCameraRef.current?.click()}
        onAdd={() => {
          resetAddForm();
          setShowAddModal(true);
        }}
        cameraLabel={t("scanPhoto")}
        addLabel={t("addHolding")}
        cameraBusy={scanning}
        CameraIcon={Camera}
        AddIcon={Plus}
        cameraBusyIcon={<Loader2 className="h-6 w-6 animate-spin" />}
      />
    </div>
  );
}
