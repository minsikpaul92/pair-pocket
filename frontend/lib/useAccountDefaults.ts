"use client";

import { useCallback, useEffect, useState } from "react";

import {
  AccountDefaults,
  AccountType,
  fetchAccountDefaults,
  setAccountDefault,
} from "@/lib/api";

const LEGACY_STOCK_KEYS = {
  CAD: "default_stock_cad_account_id",
  KRW: "default_stock_krw_account_id",
} as const;

/**
 * One-time move of browser-only stock defaults into the server slot. Only fills
 * an empty brokerage slot with an account the server lists as eligible.
 */
async function migrateLegacyStockDefaults(
  accountType: AccountType,
  defaults: AccountDefaults
): Promise<AccountDefaults> {
  if (accountType !== "personal" || typeof window === "undefined") return defaults;
  let current = defaults;
  for (const currency of ["CAD", "KRW"] as const) {
    const key = LEGACY_STOCK_KEYS[currency];
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(key);
    } catch {
      continue;
    }
    if (!saved) continue;
    const slot = current.slots.find(
      (s) => s.currency === currency && s.role === "brokerage"
    );
    try {
      if (slot && slot.status !== "set" && slot.eligible_account_ids.includes(saved)) {
        current = await setAccountDefault(accountType, currency, "brokerage", saved);
      }
      localStorage.removeItem(key);
    } catch {
      // Keep the key and retry on a later load.
    }
  }
  return current;
}

/** Server-backed default accounts for one ledger, with a manual refresh. */
export function useAccountDefaults(accountType: AccountType, version = 0) {
  const [defaults, setDefaults] = useState<AccountDefaults | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const loaded = await fetchAccountDefaults(accountType);
      setDefaults(await migrateLegacyStockDefaults(accountType, loaded));
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [accountType]);

  useEffect(() => {
    setLoading(true);
    refresh();
  }, [refresh, version]);

  return { defaults, setDefaults, loading, error, refresh };
}
