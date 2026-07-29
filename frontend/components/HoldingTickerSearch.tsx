"use client";

import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import {
  Currency,
  StockSearchResult,
  inferCurrencyFromTicker,
  searchStocks,
} from "@/lib/api";

interface Props {
  ticker: string;
  name: string;
  currency: Currency;
  onSelect: (next: {
    ticker: string;
    name: string;
    currency: Currency;
  }) => void;
  /** Extra class for the search input (onboarding alignment). */
  inputClassName?: string;
}

/** Yahoo Finance ticker/name autocomplete — same flow as StocksView add modal. */
export default function HoldingTickerSearch({
  ticker,
  name,
  currency,
  onSelect,
  inputClassName,
}: Props) {
  const t = useTranslations("stocks");
  const [query, setQuery] = useState(
    ticker ? (name ? `${name} (${ticker})` : ticker) : ""
  );
  const [suggestions, setSuggestions] = useState<StockSearchResult[]>([]);

  useEffect(() => {
    setQuery(ticker ? (name ? `${name} (${ticker})` : ticker) : "");
  }, [ticker, name]);

  useEffect(() => {
    const q = query.trim();
    // Skip searching after a selection like "Name (TICKER)".
    if (!q || q.includes("(") || q.length < 1) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(() => {
      searchStocks(q)
        .then((list) => setSuggestions(list))
        .catch(() => setSuggestions([]));
    }, 350);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div className="relative space-y-1">
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onBlur={() => {
            const q = query.trim();
            if (!q || q.includes("(")) return;
            if (!/^[A-Za-z0-9.\-]+$/.test(q)) return;
            const nextTicker = q.toUpperCase();
            if (nextTicker === ticker) return;
            onSelect({
              ticker: nextTicker,
              name: name || nextTicker,
              currency: inferCurrencyFromTicker(nextTicker) || currency,
            });
          }}
          placeholder={t("searchPlaceholder")}
          className={
            inputClassName ??
            "w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-transparent pl-9 pr-3 py-2 text-sm text-gray-900 dark:text-white"
          }
          autoComplete="off"
        />
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400 pointer-events-none" />
      </div>

      {suggestions.length > 0 && (
        <div className="absolute left-0 right-0 z-50 mt-1 max-h-48 overflow-y-auto rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-950 p-1 shadow-2xl">
          {suggestions.map((s) => (
            <button
              key={s.ticker}
              type="button"
              onClick={() => {
                const nextCurrency = inferCurrencyFromTicker(s.ticker) || currency;
                onSelect({
                  ticker: s.ticker,
                  name: s.name || s.ticker,
                  currency: nextCurrency,
                });
                setQuery(`${s.name || s.ticker} (${s.ticker})`);
                setSuggestions([]);
              }}
              className="w-full text-left px-3 py-2.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors flex items-center justify-between gap-2"
            >
              <span className="font-bold text-gray-800 dark:text-gray-200 shrink-0">
                {s.ticker}
              </span>
              <span className="text-[10px] text-gray-400 truncate min-w-0">
                {s.name}
              </span>
            </button>
          ))}
        </div>
      )}

      {ticker && (
        <p className="text-[11px] text-blue-500 font-medium truncate">
          {name || ticker} · {ticker} · {currency}
        </p>
      )}
    </div>
  );
}
