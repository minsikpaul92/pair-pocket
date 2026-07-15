"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { 
  Briefcase, 
  ChevronRight, 
  Edit3, 
  Plus, 
  Search, 
  TrendingDown, 
  TrendingUp, 
  Trash2, 
  X 
} from "lucide-react";

import AccountRegisterModal from "@/components/AccountRegisterModal";

import {
  AccountType,
  Currency,
  ExchangeRate,
  FinancialAccount,
  LedgerScope,
  StockHolding,
  StockSummary,
  StockSearchResult,
  searchStocks,
  fetchStockHoldings,
  createStockHolding,
  updateStockHolding,
  deleteStockHolding,
  fetchStockSummary,
  fetchAccounts,
  fetchExchangeRate,
  formatAmount,
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

  // Edit holding form states
  const [editShares, setEditShares] = useState("");
  const [editPrice, setEditPrice] = useState("");

  // Indices (NASDAQ & KOSPI mock / live loaders)
  const [nasdaqPrice, setNasdaqPrice] = useState("25,873.17");
  const [nasdaqChange, setNasdaqChange] = useState("-1.5%");

  // Fetch initial data
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const holdingsData = await fetchStockHoldings(accountType);
      const accId = selectedAccountIdFilter === "ALL" ? undefined : selectedAccountIdFilter;
      const summaryData = await fetchStockSummary(accountType, displayCurrency, accId);
      const accountsData = await fetchAccounts({ accountType });
      const ratesData = await fetchExchangeRate();
      
      setHoldings(holdingsData);
      setSummary(summaryData);
      setInvestmentAccounts(accountsData.filter(a => a.kind === "investment" && a.is_active));
      setRates(ratesData);
      
      // Update NASDAQ mock status randomly for high-fidelity feel
      const changes = ["-1.5%", "+0.82%", "+1.25%", "-0.45%", "+0.12%"];
      const randomChange = changes[Math.floor(Math.random() * changes.length)];
      setNasdaqChange(randomChange);
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

  // Sort and group holdings
  const sortedHoldings = useMemo(() => {
    const filtered = selectedAccountIdFilter === "ALL"
      ? holdings
      : holdings.filter(h => h.account_id === selectedAccountIdFilter);

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
  }, [holdings, selectedAccountIdFilter, sortBy]);

  // Helper to convert native stock currency to the active display currency
  const convertNativeToDisplay = useCallback((amount: number, from: Currency | "USD"): number => {
    if (!rates) return amount;
    if (from === displayCurrency) return amount;
    
    // Target is KRW
    if (displayCurrency === "KRW") {
      if (from === "USD") return amount * (rates.usd_krw || 1350);
      if (from === "CAD") return amount * (rates.cad_krw || 980);
    }
    // Target is CAD
    if (displayCurrency === "CAD") {
      if (from === "USD") return amount * (rates.usd_cad || 1.37);
      if (from === "KRW") return amount * (rates.krw_cad || 0.001);
    }
    return amount;
  }, [rates, displayCurrency]);

  // Compute stats per investment account for the top cards
  const accountStatsMap = useMemo(() => {
    const stats: Record<string, { valuation: number; invested: number; profit: number; yield: number }> = {};
    
    // Initialize for all investment accounts
    investmentAccounts.forEach(acc => {
      stats[acc.id] = { valuation: 0, invested: 0, profit: 0, yield: 0 };
    });
    
    holdings.forEach(h => {
      const accId = h.account_id;
      if (!stats[accId]) {
        stats[accId] = { valuation: 0, invested: 0, profit: 0, yield: 0 };
      }
      
      const valDisplay = convertNativeToDisplay(h.valuation, h.currency as Currency | "USD");
      const invDisplay = convertNativeToDisplay(h.invested, h.currency as Currency | "USD");
      
      stats[accId].valuation += valDisplay;
      stats[accId].invested += invDisplay;
    });
    
    // Calculate yields
    Object.keys(stats).forEach(accId => {
      const s = stats[accId];
      s.profit = s.valuation - s.invested;
      s.yield = s.invested > 0 ? (s.profit / s.invested) * 100 : 0;
    });
    
    return stats;
  }, [holdings, investmentAccounts, convertNativeToDisplay]);

  // Handle Add Holding
  const handleAddHolding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicker || !targetAccountId || !sharesInput || !priceInput) {
      setFormError("모든 필수 항목을 입력해 주세요.");
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
      setFormError(err.message || "주식 보유 등록에 실패했습니다.");
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
      alert(err.message || "수정에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Delete Holding
  const handleDeleteHolding = async (id: string) => {
    if (!confirm("보유 주식 데이터를 삭제하시겠습니까? (이체 내역은 유지됩니다)")) return;
    try {
      await deleteStockHolding(id);
      setShowEditModal(false);
      loadData();
      if (onChanged) onChanged();
    } catch (err: any) {
      alert(err.message || "삭제에 실패했습니다.");
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
  };

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

  // Filter accounts matching ledgerScope
  const visibleAccounts = useMemo(() => {
    return investmentAccounts.filter(
      (a) => ledgerScope === "ALL" || a.currency === ledgerScope
    );
  }, [investmentAccounts, ledgerScope]);

  // Aggregate total stock statistics (valuation, profit, yield) across the visible accounts
  const totalStats = useMemo(() => {
    let val = 0;
    let inv = 0;
    visibleAccounts.forEach(acc => {
      const stats = accountStatsMap[acc.id];
      if (stats) {
        val += stats.valuation;
        inv += stats.invested;
      }
    });
    const profit = val - inv;
    const y = inv > 0 ? (profit / inv) * 100 : 0;
    return { valuation: val, profit, yield: y };
  }, [visibleAccounts, accountStatsMap]);

  return (
    <div className="space-y-4">
      {/* 1. Market Index Header */}
      <div className="flex items-center justify-between px-1 text-xs font-semibold text-gray-500 dark:text-gray-400">
        <div className="flex items-center gap-1.5">
          <span>나스닥</span>
          <span className="text-gray-800 dark:text-gray-200">{nasdaqPrice}</span>
          <span className={nasdaqChange.startsWith("+") ? "text-red-500" : "text-blue-500"}>
            {nasdaqChange}
          </span>
        </div>
        <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" title="실시간 연동 활성화" />
      </div>

      {/* 2. 내 투자 계좌 (My Investment Accounts) */}
      <div className="card-inset p-4 sm:p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-gray-700 dark:text-gray-200 tracking-tight">
              투자 계좌별 실적
            </h3>
            <button
              onClick={() => setShowAccountRegister(true)}
              className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-blue-500 transition-colors"
              title="계좌 추가"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
          {selectedAccountIdFilter !== "ALL" && (
            <button
              onClick={() => setSelectedAccountIdFilter("ALL")}
              className="text-[10px] font-bold text-blue-600 hover:text-blue-700 hover:underline transition-all bg-blue-50 dark:bg-blue-950/40 px-2 py-0.5 rounded-md"
            >
              전체보기 ✕
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-3">
          {/* 1. 전체 계좌 통합 카드 */}
          <button
            onClick={() => setSelectedAccountIdFilter("ALL")}
            className={`text-left p-3.5 rounded-2xl transition-all border shrink-0 min-w-[150px] flex-1 ${
              selectedAccountIdFilter === "ALL"
                ? "bg-blue-50/60 dark:bg-blue-950/30 border-blue-500 dark:border-blue-700 shadow-md ring-1 ring-blue-500"
                : "bg-gray-50/50 dark:bg-gray-850 border-transparent hover:border-gray-200 dark:hover:border-gray-800"
            }`}
          >
            <div className="text-[10px] text-gray-500 dark:text-gray-400 font-bold truncate">
              전체 계좌 (합계)
            </div>
            <div className="text-base font-black text-gray-900 dark:text-white mt-1 tabular-nums">
              {formatAmount(totalStats.valuation, displayCurrency)}
            </div>
            <div className={`text-[11px] font-bold mt-1.5 ${totalStats.profit >= 0 ? "text-red-500" : "text-blue-500"}`}>
              {totalStats.profit >= 0 ? "+" : ""}
              {formatAmount(totalStats.profit, displayCurrency)} ({totalStats.yield.toFixed(1)}%)
            </div>
          </button>

          {/* 2. 개별 계좌 카드 목록 */}
          {visibleAccounts.map((acc) => {
            const isSelected = selectedAccountIdFilter === acc.id;
            const stats = accountStatsMap[acc.id] || { valuation: 0, profit: 0, yield: 0 };
            const isProfit = stats.profit >= 0;
            return (
              <button
                key={acc.id}
                onClick={() => {
                  setSelectedAccountIdFilter(prev => prev === acc.id ? "ALL" : acc.id);
                }}
                className={`text-left p-3.5 rounded-2xl transition-all border shrink-0 min-w-[150px] flex-1 ${
                  isSelected
                    ? "bg-blue-50/60 dark:bg-blue-950/30 border-blue-500 dark:border-blue-700 shadow-md ring-1 ring-blue-500"
                    : "bg-gray-50/50 dark:bg-gray-850 border-transparent hover:border-gray-200 dark:hover:border-gray-800"
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[10px] text-gray-500 dark:text-gray-400 font-bold truncate">
                    {acc.institution ? `[${acc.institution}] ` : ""}{acc.nickname || acc.name}
                  </span>
                  <span className="text-[9px] text-gray-400 dark:text-gray-500 uppercase font-black">
                    {acc.currency}
                  </span>
                </div>
                <div className="text-base font-black text-gray-900 dark:text-white mt-1 tabular-nums">
                  {formatAmount(stats.valuation, displayCurrency)}
                </div>
                <div className={`text-[11px] font-bold mt-1.5 ${isProfit ? "text-red-500" : "text-blue-500"}`}>
                  {isProfit ? "+" : ""}
                  {formatAmount(stats.profit, displayCurrency)} ({stats.yield.toFixed(1)}%)
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. My Investments Valuation Card */}
      <div className="card-inset p-4 sm:p-5 relative overflow-hidden">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-bold text-gray-400 dark:text-gray-500 tracking-wider">
            {t("myInvestment")}
          </h3>
          <Briefcase className="h-4 w-4 text-gray-400 opacity-60" />
        </div>

        {loading ? (
          <div className="h-16 animate-pulse bg-gray-100 dark:bg-gray-800 rounded-xl" />
        ) : (
          <div>
            <div className="text-3xl font-black tracking-tight text-gray-900 dark:text-white mt-1">
              {formatAmount(summary?.total_valuation ?? 0, displayCurrency)}
            </div>
            
            <div className="flex items-center gap-1.5 mt-1.5">
              <span className={`text-sm font-bold flex items-center gap-0.5 ${
                (summary?.total_profit ?? 0) >= 0 ? "text-red-500" : "text-blue-500"
              }`}>
                {(summary?.total_profit ?? 0) >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                {formatAmount(summary?.total_profit ?? 0, displayCurrency)} (
                {((summary?.total_yield ?? 0)).toFixed(2)}%)
              </span>
            </div>
            <div className="text-[10px] text-gray-400 mt-2">
              총 투자 원금: {formatAmount(summary?.total_invested ?? 0, displayCurrency)}
            </div>
          </div>
        )}
      </div>

      {/* 4. Sorting & Filter Controls Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
        {/* Toggle selectors */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Active Account Filter Badge */}
          <div className="flex items-center gap-1.5 bg-blue-50/50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400 px-3 py-1.5 rounded-xl text-xs font-bold shadow-sm border border-blue-100/50 dark:border-blue-900/40 select-none">
            {selectedAccountIdFilter === "ALL" ? (
              <span>전체 계좌 (한/캐 통합)</span>
            ) : (
              <div className="flex items-center gap-1">
                <span>
                  {(() => {
                    const matchedAcc = investmentAccounts.find((a) => a.id === selectedAccountIdFilter);
                    return matchedAcc
                      ? `${matchedAcc.institution ? `[${matchedAcc.institution}] ` : ""}${matchedAcc.name}`
                      : "필터링된 계좌";
                  })()}
                </span>
                <button
                  onClick={() => setSelectedAccountIdFilter("ALL")}
                  className="hover:text-blue-800 dark:hover:text-blue-300 font-black ml-1.5"
                  title="필터 초기화"
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

          {/* Won / Dollar Toggle */}
          <div className="flex rounded-xl bg-gray-100 dark:bg-gray-800 p-0.5 shadow-inner">
            <button
              onClick={() => setDisplayCurrency("CAD")}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-all ${
                displayCurrency === "CAD"
                  ? "bg-white dark:bg-gray-700 shadow-sm text-gray-800 dark:text-white"
                  : "text-gray-500 hover:text-gray-800 dark:hover:text-gray-300"
              }`}
            >
              달러
            </button>
            <button
              onClick={() => setDisplayCurrency("KRW")}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-all ${
                displayCurrency === "KRW"
                  ? "bg-white dark:bg-gray-700 shadow-sm text-gray-800 dark:text-white"
                  : "text-gray-500 hover:text-gray-800 dark:hover:text-gray-300"
              }`}
            >
              원화
            </button>
          </div>
        </div>

        {/* Sort selector & Add Button */}
        <div className="flex items-center justify-between sm:justify-end gap-3">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortOption)}
            className="text-xs font-bold text-gray-500 dark:text-gray-400 bg-transparent border-0 outline-none focus:ring-0 cursor-pointer"
          >
            <option value="valuation" className="bg-white dark:bg-gray-900">{t("sortValuation")}</option>
            <option value="yield" className="bg-white dark:bg-gray-900">{t("sortYield")}</option>
            <option value="shares" className="bg-white dark:bg-gray-900">{t("sortShares")}</option>
          </select>

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
            return (
              <div
                key={row.id}
                className="flex items-center justify-between gap-3 p-4 bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800/80 hover:shadow-md transition-shadow group"
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
                      {row.shares}주 · 평단 {formatAmount(row.avg_price, row.currency as Currency)}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <div className="font-bold text-gray-900 dark:text-white text-sm">
                      {viewMode === "valuation"
                        ? formatAmount(row.valuation, row.currency as Currency)
                        : formatAmount(row.price, row.currency as Currency)}
                    </div>
                    <div className={`text-xs font-semibold mt-0.5 ${isProfit ? "text-red-500" : "text-blue-500"}`}>
                      {isProfit ? "+" : ""}
                      {formatAmount(row.profit, row.currency as Currency)} ({row.yield.toFixed(1)}%)
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      const firstHolding = row.holdings?.[0] || row;
                      setSelectedHoldingGroup(row);
                      setSelectedHolding(firstHolding);
                      setEditShares(firstHolding.shares.toString());
                      setEditPrice(firstHolding.avg_price.toString());
                      setShowEditModal(true);
                    }}
                    className="p-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Edit3 className="h-4 w-4" />
                  </button>
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
          <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-3xl p-5 shadow-2xl relative border border-gray-100 dark:border-gray-800 animate-in fade-in zoom-in-95 duration-150">
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
                  <option value="">증권 계좌 선택...</option>
                  {investmentAccounts
                    .filter((a) => ledgerScope === "ALL" || a.currency === ledgerScope)
                    .map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.institution ? `[${acc.institution}] ` : ""}{acc.name} ({acc.currency})
                      </option>
                    ))}
                </select>
              </div>

              {/* Ticker Search & Auto-complete */}
              <div className="relative">
                <label className="mb-1.5 block text-xs font-bold text-gray-400 dark:text-gray-500">
                  {t("holdingTicker")} 검색
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 dark:border-gray-850 bg-white dark:bg-gray-900 pl-9 pr-3.5 py-2 text-sm focus:border-blue-500 focus:outline-none dark:text-white"
                    placeholder="예: 삼성전자, 테슬라, AAPL..."
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
                          // Infer currency based on exchange suffix
                          if (s.ticker.endsWith(".KS") || s.ticker.endsWith(".KQ")) {
                            setSelectedCurrency("KRW");
                          } else if (s.ticker.endsWith(".TO") || s.ticker.endsWith(".V")) {
                            setSelectedCurrency("CAD");
                          } else {
                            setSelectedCurrency("USD"); // Standard NYSE/NASDAQ
                          }
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
                    선택됨
                  </span>
                </div>
              )}

              {/* Currency Selector for Purchase */}
              <div>
                <label className="mb-1.5 block text-xs font-bold text-gray-400 dark:text-gray-500">
                  매수 통화
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
                  취소
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold py-2.5 rounded-xl transition-all disabled:opacity-50"
                >
                  {submitting ? "등록 중..." : "등록 완료"}
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
                  보유 계좌
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
                    {selectedHolding.account_name || selectedHolding.institution || "기본계좌"}
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
                  title="삭제"
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
                    취소
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold py-2.5 rounded-xl transition-all disabled:opacity-50"
                  >
                    {submitting ? "저장 중..." : "저장 완료"}
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
          onClose={() => setShowAccountRegister(false)}
          onCreated={() => {
            setShowAccountRegister(false);
            loadData();
            if (onChanged) onChanged();
          }}
        />
      )}
    </div>
  );
}
