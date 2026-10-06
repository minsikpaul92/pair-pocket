import { KOREAN_BROKERAGE_HINTS } from "@/lib/banks";
import { CATEGORY, SUB_CATEGORY } from "@/lib/category-values";
import { ApiError, apiErrorFromBody, apiErrorFromEvent } from "@/lib/errors";
import { dayKey } from "./date";

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

const TOKEN_KEY = "pairpocket_token";

export const EXPENSE_CATEGORY_INVESTMENT = CATEGORY.investmentSavings;
export const TRANSFER_CATEGORY = CATEGORY.transfer;
export const TRANSFER_CATEGORY_LEGACY = CATEGORY.transferLegacy;
export const TRANSFER_SUB_CARD_REPAYMENT = SUB_CATEGORY.cardRepayment;
export const TRANSFER_SUB_ACCOUNT_TRANSFER = SUB_CATEGORY.accountTransfer;
export const TRANSFER_SUB_ACCOUNT_TRANSFER_LEGACY = SUB_CATEGORY.accountTransferLegacy;
export const TRANSFER_SUB_INVESTMENT_FUNDING = SUB_CATEGORY.investmentFunding;
export const TRANSFER_SUB_SHARED_FUNDING = SUB_CATEGORY.sharedFunding;
export const TRANSFER_SUB_SHARED_WITHDRAWAL = SUB_CATEGORY.sharedWithdrawal;
export const TRANSFER_SUB_ETRANSFER = SUB_CATEGORY.etransfer;
export const INCOME_CATEGORY_SETTLEMENT = CATEGORY.settlement;
export const SUB_CATEGORY_SETTLEMENT = SUB_CATEGORY.splitSettlement;

const CASHFLOW_TRANSFER_SUBS = new Set([
  TRANSFER_SUB_SHARED_FUNDING,
  TRANSFER_SUB_SHARED_WITHDRAWAL,
  TRANSFER_SUB_ETRANSFER,
]);

/** (sending ledger, receiving ledger) of personal ↔ shared transfers. */
const PAIRED_TRANSFER_LEDGERS: Record<string, ["personal" | "shared", "personal" | "shared"]> = {
  [TRANSFER_SUB_SHARED_FUNDING]: ["personal", "shared"],
  [TRANSFER_SUB_SHARED_WITHDRAWAL]: ["shared", "personal"],
};

export function pairedTransferLedgers(
  subCategory: string
): ["personal" | "shared", "personal" | "shared"] | null {
  return PAIRED_TRANSFER_LEDGERS[normalizeTransferSubCategory(subCategory)] ?? null;
}

export function normalizeTransferCategory(category: string): string {
  return category === TRANSFER_CATEGORY_LEGACY ? TRANSFER_CATEGORY : category;
}

export function normalizeTransferSubCategory(subCategory: string): string {
  return subCategory === TRANSFER_SUB_ACCOUNT_TRANSFER_LEGACY
    ? TRANSFER_SUB_ACCOUNT_TRANSFER
    : subCategory;
}

export function isCashflowTransferSub(subCategory: string): boolean {
  return CASHFLOW_TRANSFER_SUBS.has(normalizeTransferSubCategory(subCategory));
}

export function isSharedFundingSub(subCategory: string): boolean {
  return (
    normalizeTransferSubCategory(subCategory) === TRANSFER_SUB_SHARED_FUNDING
  );
}

export function isEtransferSub(subCategory: string): boolean {
  return normalizeTransferSubCategory(subCategory) === TRANSFER_SUB_ETRANSFER;
}

/** Internal balance-only moves (grey / excluded from cashflow totals). */
export function isTransferTransaction(tx: {
  kind?: TransactionKind | null;
  category: string;
  sub_category?: string | null;
}): boolean {
  const cat = normalizeTransferCategory(tx.category);
  const isTransferCat =
    cat === TRANSFER_CATEGORY || tx.category === TRANSFER_CATEGORY_LEGACY;
  if (!isTransferCat && tx.kind !== "transfer") return false;
  if (tx.sub_category && isCashflowTransferSub(tx.sub_category)) return false;
  return (
    tx.kind === "transfer" ||
    isTransferCat
  );
}

export function isSettlementTransaction(tx: {
  category: string;
  sub_category?: string | null;
}): boolean {
  return (
    tx.category === INCOME_CATEGORY_SETTLEMENT &&
    tx.sub_category === SUB_CATEGORY_SETTLEMENT
  );
}

/** Internal transfers and split settlements: grey, excluded from income/expense totals. */
export function isNonCashflowTransaction(tx: {
  kind?: TransactionKind | null;
  category: string;
  sub_category?: string | null;
}): boolean {
  return isTransferTransaction(tx) || isSettlementTransaction(tx);
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  window.localStorage.removeItem(TOKEN_KEY);
}

export interface CurrentUser {
  id: string;
  google_id: string;
  email: string;
  name: string;
  picture: string | null;
  shared_group_id: string | null;
}

/**
 * Session routes go through this app's own origin (rewritten to the API in
 * next.config.js) so the HttpOnly refresh cookie is first-party.
 */
const SESSION_BASE = "/api/auth";

/** Fired when the session can no longer be renewed and sign-in is required. */
export const SESSION_EXPIRED_EVENT = "pairpocket:session-expired";

/** Store a new access token. Returns false when the server reports no session. */
async function requestSession(path: string, init: RequestInit = {}): Promise<boolean> {
  let res: Response;
  try {
    res = await fetch(`${SESSION_BASE}${path}`, {
      method: "POST",
      credentials: "same-origin",
      ...init,
    });
  } catch {
    throw new ApiError("network");
  }
  if (res.ok) {
    setToken(((await res.json()) as { access_token: string }).access_token);
    return true;
  }
  if ([401, 403, 404, 409].includes(res.status)) return false;
  throw new ApiError("serverUnavailable");
}

let refreshInFlight: Promise<boolean> | null = null;

/**
 * Renew the access token with the refresh cookie. Concurrent callers share one
 * request, and tabs take turns so they do not rotate the same cookie at once.
 */
export function refreshSession(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  const staleToken = getToken();
  const renew = async (): Promise<boolean> => {
    const current = getToken();
    if (current && current !== staleToken) return true; // another tab renewed
    return requestSession("/refresh");
  };
  const locked: Promise<boolean> =
    typeof navigator !== "undefined" && navigator.locks
      ? // request() resolves with the callback's awaited result.
        (navigator.locks.request(
          "pairpocket-session-refresh",
          renew
        ) as unknown as Promise<boolean>)
      : renew();
  const inFlight = locked.finally(() => {
    refreshInFlight = null;
  });
  refreshInFlight = inFlight;
  return inFlight;
}

function expireSession(): void {
  clearToken();
  window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
}

async function sendWithToken(url: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  try {
    return await fetch(url, { ...init, headers });
  } catch {
    throw new ApiError("network");
  }
}

/**
 * fetch() with the access token. On 401 it renews the session once and
 * retries; if renewal fails the session is over. Network and server failures
 * throw ApiError("network" | "serverUnavailable") and keep the session.
 */
async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  let res: Response | null = null;
  if (getToken()) {
    res = await sendWithToken(url, init);
    if (res.status !== 401) return res;
  }
  if (await refreshSession()) {
    res = await sendWithToken(url, init);
    if (res.status !== 401) return res;
  }
  expireSession();
  return res ?? new Response(null, { status: 401 });
}

/** Exchange the OAuth callback's one-time code for a session. */
export function completeSignIn(code: string): Promise<boolean> {
  return requestSession("/session", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
}

/** Tokens issued before renewable sessions carry no session id (`sid`). */
function isLegacyToken(token: string): boolean {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return !("sid" in JSON.parse(atob(payload)));
  } catch {
    return false;
  }
}

/** Move a pre-session 7-day sign-in onto a renewable session, best effort. */
async function upgradeLegacySession(): Promise<void> {
  const token = getToken();
  if (!token || !isLegacyToken(token)) return;
  await requestSession("/session/upgrade", {
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => false);
}

export async function signOut(): Promise<void> {
  try {
    await fetch(`${SESSION_BASE}/logout`, {
      method: "POST",
      credentials: "same-origin",
    });
  } catch {
    // Signing out locally still ends this browser's use of the token.
  }
  clearToken();
}

/**
 * The signed-in user, or null when there is no session. Network and server
 * failures throw so callers can offer a retry instead of the sign-in screen.
 */
export async function fetchCurrentUser(): Promise<CurrentUser | null> {
  const res = await apiFetch(`${API_BASE_URL}/api/auth/me`);
  if (res.status === 401) return null;
  if (!res.ok) throw new ApiError("serverUnavailable");
  const user = (await res.json()) as CurrentUser;
  await upgradeLegacySession();
  return user;
}

export const loginUrl = `${API_BASE_URL}/api/auth/login`;

export type Currency = "KRW" | "CAD" | "USD";
export type LedgerScope = Currency | "ALL";
export type TransactionType = "income" | "expense";
export type AccountType = "shared" | "personal";
export type FinancialAccountKind =
  | "checking"
  | "savings"
  | "credit_card"
  | "investment"
  | "cash";
export type TransactionKind = "normal" | "transfer";

export type AccountCountry = "CA" | "KR";

export interface FinancialAccount {
  id: string;
  owner_id: string;
  name: string;
  nickname: string | null;
  kind: FinancialAccountKind;
  currency: Currency;
  account_type: AccountType;
  /** Canada vs Korea registration tab. Null on legacy rows. */
  country: AccountCountry | null;
  opening_balance: number;
  is_liability: boolean;
  /** Default slots this account holds (server-managed). */
  default_roles: DefaultRole[];
  is_active: boolean;
  institution: string | null;
  last_four: string | null;
  account_number: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewFinancialAccount {
  name: string;
  nickname?: string | null;
  kind: FinancialAccountKind;
  currency: Currency;
  account_type?: AccountType;
  country?: AccountCountry | null;
  opening_balance?: number;
  /** Slots to claim; omit to let the server fill only empty slots. */
  default_roles?: DefaultRole[];
  institution?: string | null;
  last_four?: string | null;
  account_number?: string | null;
}

export const ACCOUNT_KIND_KEYS: Record<FinancialAccountKind, string> = {
  checking: "checking",
  savings: "savings",
  credit_card: "credit_card",
  investment: "investment",
  cash: "cash",
};

export interface Transaction {
  id: string;
  date: string;
  amount: number;
  currency: Currency;
  type: TransactionType;
  account_type: AccountType;
  category: string;
  sub_category: string;
  merchant: string;
  institution: string | null;
  settles_expense_id: string | null;
  account_id?: string | null;
  counter_account_id?: string | null;
  linked_transaction_id?: string | null;
  kind?: TransactionKind;
  owner_id: string;
  settled_amount?: number;
  effective_amount?: number;
  subscription_billing_cycle?: BillingCycle | null;
  subscription_id?: string | null;
  is_stock_trade?: boolean;
  trade_type?: "buy" | "sell";
  ticker?: string;
  shares?: number;
  price?: number;
  fee?: number;
  items?: TransactionItem[];
  tip_amount?: number | null;
  tip_percent?: number | null;
  subtotal?: number | null;
  tax_amount?: number | null;
  note?: string | null;
}

export interface TransactionItem {
  name: string;
  standardized_name?: string | null;
  quantity: number;
  unit?: string | null;
  unit_price: number;
  total_price: number;
}

export interface NewTransaction {
  date: string;
  amount: number;
  currency: Currency;
  type: TransactionType;
  account_type: AccountType;
  category: string;
  sub_category: string;
  merchant: string;
  institution?: string | null;
  settles_expense_id?: string | null;
  account_id?: string | null;
  counter_account_id?: string | null;
  linked_transaction_id?: string | null;
  kind?: TransactionKind;
  is_stock_trade?: boolean;
  trade_type?: "buy" | "sell";
  ticker?: string;
  shares?: number;
  price?: number;
  fee?: number;
  items?: TransactionItem[];
  tip_amount?: number | null;
  tip_percent?: number | null;
  subtotal?: number | null;
  tax_amount?: number | null;
  note?: string | null;
}

export interface CategoryGroup {
  category: string;
  sub_categories: string[];
}

export interface CategoryPresets {
  expense: CategoryGroup[];
  income: CategoryGroup[];
}

export interface StatsSummary {
  total_income: number;
  total_expense: number;
  investment_savings_total: number;
  settlement_refund_total: number;
  adjusted_expense: number;
  pure_consumption: number;
  net_cashflow: number;
  breakdown_by_category: { category: string; amount: number }[];
  expense_breakdown_by_category?: { category: string; amount: number }[];
  expense_breakdown_by_sub_category?: {
    category: string;
    sub_category: string;
    amount: number;
  }[];
  breakdown_by_sub_category: { label: string; amount: number }[];
  breakdown_by_merchant_effective?: { merchant: string; amount: number }[];
  settlement_details?: {
    expense_id: string;
    merchant: string;
    original_amount: number;
    settled_amount: number;
    effective_amount: number;
  }[];
}

function authHeaders(): HeadersInit {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface TransactionFilters {
  currency?: Currency;
  month?: string;
  /** Inclusive YYYY-MM-DD range; use instead of month. */
  start?: string;
  end?: string;
  accountType?: AccountType;
  type?: TransactionType;
  category?: string;
  sub_category?: string;
  merchant?: string;
  institution?: string;
}

export async function fetchTransactions(
  filters: TransactionFilters = {}
): Promise<Transaction[]> {
  const params = new URLSearchParams();
  params.set("account_type", filters.accountType ?? "personal");
  if (filters.currency) params.set("currency", filters.currency);
  if (filters.month) params.set("month", filters.month);
  if (filters.start) params.set("start", filters.start);
  if (filters.end) params.set("end", filters.end);
  if (filters.type) params.set("type", filters.type);
  if (filters.category) params.set("category", filters.category);
  if (filters.sub_category) params.set("sub_category", filters.sub_category);
  if (filters.merchant) params.set("merchant", filters.merchant);
  if (filters.institution) params.set("institution", filters.institution);

  const res = await apiFetch(
    `${API_BASE_URL}/api/transactions?${params.toString()}`,
    { headers: authHeaders() }
  );
  if (!res.ok) throw new ApiError("fetchTransactions");
  return (await res.json()) as Transaction[];
}

/** Fetch and merge CAD + KRW transactions for the ALL ledger view. */
export async function fetchAllTransactions(
  filters: Omit<TransactionFilters, "currency"> = {}
): Promise<Transaction[]> {
  const [cad, krw] = await Promise.all([
    fetchTransactions({ ...filters, currency: "CAD" }),
    fetchTransactions({ ...filters, currency: "KRW" }),
  ]);
  return [...cad, ...krw].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
}

/** Expense amount after split settlements (for calendar/list display). */
export function effectiveExpenseAmount(tx: Transaction): number {
  if (tx.type !== "expense") return tx.amount;
  return tx.effective_amount ?? tx.amount;
}

export function hasSettlement(tx: Transaction): boolean {
  return (
    tx.type === "expense" &&
    (tx.settled_amount ?? 0) > 0 &&
    (tx.effective_amount ?? tx.amount) < tx.amount
  );
}

export async function fetchCategoryPresets(): Promise<CategoryPresets> {
  const res = await apiFetch(`${API_BASE_URL}/api/categories`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new ApiError("fetchCategories");
  return (await res.json()) as CategoryPresets;
}

export async function addCustomCategory(
  type: TransactionType,
  category: string
): Promise<CategoryPresets> {
  const res = await apiFetch(`${API_BASE_URL}/api/categories/category`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ type, category }),
  });
  if (!res.ok) throw new ApiError("addCategory");
  return (await res.json()) as CategoryPresets;
}

export async function addCustomSubCategory(
  type: TransactionType,
  category: string,
  sub_category: string
): Promise<CategoryPresets> {
  const res = await apiFetch(`${API_BASE_URL}/api/categories/sub-category`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ type, category, sub_category }),
  });
  if (!res.ok) throw new ApiError("addSubCategory");
  return (await res.json()) as CategoryPresets;
}

export async function addInstitution(name: string): Promise<string[]> {
  const res = await apiFetch(`${API_BASE_URL}/api/settings/institutions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new ApiError("addInstitution");
  const data = await res.json();
  return data.institutions as string[];
}

export async function removeInstitution(name: string): Promise<string[]> {
  const res = await apiFetch(
    `${API_BASE_URL}/api/settings/institutions?name=${encodeURIComponent(name)}`,
    {
      method: "DELETE",
      headers: authHeaders(),
    }
  );
  if (!res.ok) throw new ApiError("removeInstitution");
  const data = await res.json();
  return data.institutions as string[];
}

export interface UserSettings {
  merchants: string[];
  institutions: string[];
  custom_categories: {
    expense: Record<string, string[]>;
    income: Record<string, string[]>;
  };
  category_colors: Record<string, string>;
  expense_ratio_hidden_categories: string[];
  has_gemini_key?: boolean;
  has_effective_gemini_key?: boolean;
  partner_has_gemini_key?: boolean;
  partner_using_my_key?: boolean;
  using_partner_key?: boolean;
  share_gemini_api_key?: boolean;
  preferred_locale?: string | null;
  preferred_locales?: string[];
  ledger_start_date?: string | null;
  shared_ledger_start_date?: string | null;
  ledger_start_date_locked?: boolean;
  onboarding_personal_completed?: boolean;
  onboarding_personal_step?: number;
}

/** Preferred UI languages from settings (primary first). */
export function preferredLocalesList(
  settings: Pick<UserSettings, "preferred_locales" | "preferred_locale"> | null | undefined
): string[] {
  if (!settings) return [];
  if (settings.preferred_locales?.length) {
    return settings.preferred_locales.slice(0, 2);
  }
  if (settings.preferred_locale) return [settings.preferred_locale];
  return [];
}

export async function fetchUserSettings(): Promise<UserSettings> {
  const res = await apiFetch(`${API_BASE_URL}/api/settings`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new ApiError("fetchUserSettings");
  const data = (await res.json()) as UserSettings;
  return {
    ...data,
    category_colors: data.category_colors ?? {},
    expense_ratio_hidden_categories: data.expense_ratio_hidden_categories ?? [],
  };
}

export async function setCategoryColor(
  category: string,
  color: string
): Promise<UserSettings> {
  const res = await apiFetch(`${API_BASE_URL}/api/settings/category-colors`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ category, color }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw apiErrorFromBody(body, "setCategoryColor");
  }
  const data = (await res.json()) as UserSettings;
  return {
    ...data,
    category_colors: data.category_colors ?? {},
    expense_ratio_hidden_categories: data.expense_ratio_hidden_categories ?? [],
  };
}

/** Hidden expense-ratio entry for one sub-category (matches the backend format). */
export function hiddenSubKey(category: string, subCategory: string): string {
  return `${category} › ${subCategory}`;
}

export async function setExpenseRatioHiddenCategories(
  categories: string[]
): Promise<UserSettings> {
  const res = await apiFetch(
    `${API_BASE_URL}/api/settings/expense-ratio-hidden-categories`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ categories }),
    }
  );
  if (!res.ok) throw new ApiError("setExpenseRatioHiddenCategories");
  const data = (await res.json()) as UserSettings;
  return {
    ...data,
    category_colors: data.category_colors ?? {},
    expense_ratio_hidden_categories: data.expense_ratio_hidden_categories ?? [],
  };
}

export async function fetchSubCategories(
  type: TransactionType,
  category: string
): Promise<string[]> {
  const params = new URLSearchParams({ type, category });
  const res = await apiFetch(
    `${API_BASE_URL}/api/categories/sub-categories?${params.toString()}`,
    { headers: authHeaders() }
  );
  if (!res.ok) return [];
  return (await res.json()) as string[];
}

export async function fetchMerchantSuggestions(
  category: string,
  currency: Currency,
  subCategory?: string,
  accountType: AccountType = "personal"
): Promise<string[]> {
  const params = new URLSearchParams({
    category,
    currency,
    account_type: accountType,
  });
  if (subCategory) params.set("sub_category", subCategory);
  const res = await apiFetch(
    `${API_BASE_URL}/api/transactions/merchants?${params.toString()}`,
    { headers: authHeaders() }
  );
  if (!res.ok) return [];
  return (await res.json()) as string[];
}

export async function fetchAllMerchants(
  accountType: AccountType = "personal"
): Promise<string[]> {
  const params = new URLSearchParams({ account_type: accountType });
  const res = await apiFetch(
    `${API_BASE_URL}/api/transactions/merchants/all?${params.toString()}`,
    { headers: authHeaders() }
  );
  if (!res.ok) return [];
  return (await res.json()) as string[];
}

export async function lookupMerchant(
  name: string,
  accountType: AccountType = "personal"
): Promise<{ found: boolean; category?: string; sub_category?: string }> {
  if (!name.trim()) return { found: false };
  const params = new URLSearchParams({ name: name.trim(), account_type: accountType });
  const res = await apiFetch(
    `${API_BASE_URL}/api/transactions/merchants/lookup?${params.toString()}`,
    { headers: authHeaders() }
  );
  if (!res.ok) return { found: false };
  return await res.json();
}

export async function fetchInstitutionSuggestions(
  currency: Currency,
  subCategory?: string
): Promise<string[]> {
  const params = new URLSearchParams({ currency });
  if (subCategory) params.set("sub_category", subCategory);
  const res = await apiFetch(
    `${API_BASE_URL}/api/transactions/institutions?${params.toString()}`,
    { headers: authHeaders() }
  );
  if (!res.ok) return [];
  return (await res.json()) as string[];
}

export interface SettleableExpense {
  id: string;
  date: string;
  merchant: string;
  amount: number;
  settled_amount: number;
  remaining_amount: number;
  category: string;
  sub_category: string;
}

export async function fetchSettleableExpenses(
  currency: Currency,
  excludeSettlementId?: string,
  accountType: AccountType = "personal"
): Promise<SettleableExpense[]> {
  const params = new URLSearchParams({
    currency,
    account_type: accountType,
  });
  if (excludeSettlementId) {
    params.set("exclude_settlement_id", excludeSettlementId);
  }
  const res = await apiFetch(
    `${API_BASE_URL}/api/transactions/settleable?${params.toString()}`,
    { headers: authHeaders() }
  );
  if (!res.ok) return [];
  return (await res.json()) as SettleableExpense[];
}

export interface StatsFilters {
  currency?: Currency;
  month?: string;
  /** Inclusive YYYY-MM-DD range; use instead of month. */
  start?: string;
  end?: string;
  accountType?: AccountType;
  category?: string;
  sub_category?: string;
  merchant?: string;
  institution?: string;
}

export async function fetchStatsSummary(
  filters: StatsFilters = {}
): Promise<StatsSummary> {
  const params = new URLSearchParams();
  params.set("account_type", filters.accountType ?? "personal");
  if (filters.currency) params.set("currency", filters.currency);
  if (filters.month) params.set("month", filters.month);
  if (filters.start) params.set("start", filters.start);
  if (filters.end) params.set("end", filters.end);
  if (filters.category) params.set("category", filters.category);
  if (filters.sub_category) params.set("sub_category", filters.sub_category);
  if (filters.merchant) params.set("merchant", filters.merchant);
  if (filters.institution) params.set("institution", filters.institution);

  const res = await apiFetch(
    `${API_BASE_URL}/api/stats/summary?${params.toString()}`,
    { headers: authHeaders() }
  );
  if (!res.ok) throw new ApiError("fetchStats");
  return (await res.json()) as StatsSummary;
}

export interface ExchangeRate {
  cad_krw: number;
  krw_cad: number;
  usd_krw?: number;
  krw_usd?: number;
  usd_cad?: number;
  cad_usd?: number;
  date: string | null;
  stale: boolean;
  source?: string;
}

export async function fetchExchangeRate(): Promise<ExchangeRate> {
  const res = await apiFetch(`${API_BASE_URL}/api/exchange-rate`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new ApiError("fetchExchangeRate");
  return (await res.json()) as ExchangeRate;
}

export interface AccountBalance {
  account_id: string;
  name: string;
  nickname: string | null;
  kind: FinancialAccountKind;
  currency: Currency;
  account_type: AccountType;
  is_liability: boolean;
  balance: number;
  net_worth_contribution: number;
}

export interface NetWorthSummary {
  account_type: AccountType;
  currency: Currency | null;
  total_assets: number;
  total_liabilities: number;
  net_worth: number;
  accounts: AccountBalance[];
}

export async function fetchNetWorth(filters: {
  currency?: Currency;
  accountType?: AccountType;
} = {}): Promise<NetWorthSummary> {
  const params = new URLSearchParams();
  params.set("account_type", filters.accountType ?? "personal");
  if (filters.currency) params.set("currency", filters.currency);

  const res = await apiFetch(
    `${API_BASE_URL}/api/accounts/net-worth?${params.toString()}`,
    { headers: authHeaders() }
  );
  if (!res.ok) throw new ApiError("fetchNetWorth");
  return (await res.json()) as NetWorthSummary;
}

async function readApiError(res: Response, fallbackCode: string): Promise<never> {
  const body = await res.json().catch(() => null);
  throw apiErrorFromBody(body, fallbackCode);
}

export type BillingCycle =
  | "monthly"
  | "yearly"
  | "every_x_days"
  | "weekly"
  | "biweekly"
  | "installment";
export type SubscriptionStatus =
  | "active"
  | "paused"
  | "cancel_scheduled"
  | "completed"
  | "cancelled";
export type OccurrenceStatus = "pending" | "completed" | "skipped";

export interface Subscription {
  id: string;
  owner_id: string;
  name: string;
  amount: number;
  currency: Currency;
  account_type: AccountType;
  cycle: BillingCycle;
  start_date: string;
  end_date: string | null;
  installment_start_date: string | null;
  total_installments: number | null;
  promo_amount: number | null;
  promo_end_date: string | null;
  promo_reminder_enabled: boolean;
  end_reminder_enabled: boolean;
  is_fixed_bill?: boolean;
  interval_days?: number | null;
  account_id: string;
  counter_account_id?: string | null;
  category: string;
  sub_category: string;
  merchant: string;
  status: SubscriptionStatus;
  next_due_date: string | null;
  completed_installments: number;
  cancel_effective_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewSubscription {
  name: string;
  amount: number;
  currency: Currency;
  account_type?: AccountType;
  cycle: BillingCycle;
  start_date: string;
  next_due_date?: string | null;
  end_date?: string | null;
  installment_start_date?: string | null;
  total_installments?: number | null;
  completed_installments?: number | null;
  promo_amount?: number | null;
  promo_end_date?: string | null;
  promo_reminder_enabled?: boolean;
  end_reminder_enabled?: boolean;
  is_fixed_bill?: boolean;
  interval_days?: number | null;
  account_id: string;
  counter_account_id?: string | null;
  category: string;
  sub_category: string;
  merchant?: string;
}

export interface SubscriptionHistory {
  subscription_id: string;
  start_date: string;
  end_date: string | null;
  months_active: number;
  payment_count: number;
  total_paid: number;
  currency: Currency;
  regular_total: number;
  total_saved: number;
  avg_saved_per_month: number;
}

export interface MonthlySubscriptionSummary {
  month: string;
  subscription_total: Partial<Record<Currency, number>>;
  installment_total: Partial<Record<Currency, number>>;
}

export interface SubscriptionOccurrence {
  id: string;
  subscription_id: string;
  due_date: string;
  amount: number;
  currency: Currency;
  status: OccurrenceStatus;
  transaction_id: string | null;
  subscription_name: string | null;
  subscription_billing_cycle?: BillingCycle | null;
  category?: string | null;
  sub_category?: string | null;
  merchant?: string | null;
}

export async function fetchSubscriptions(filters: {
  currency?: Currency;
  accountType?: AccountType;
  month?: string;
} = {}): Promise<Subscription[]> {
  const params = new URLSearchParams();
  params.set("account_type", filters.accountType ?? "personal");
  if (filters.currency) params.set("currency", filters.currency);
  if (filters.month) params.set("month", filters.month);
  const res = await apiFetch(
    `${API_BASE_URL}/api/subscriptions?${params.toString()}`,
    { headers: authHeaders() }
  );
  if (!res.ok) throw new ApiError("fetchSubscriptions");
  return (await res.json()) as Subscription[];
}

export async function fetchSubscriptionMonthlySummary(filters: {
  month: string;
  currency?: Currency;
  accountType?: AccountType;
}): Promise<MonthlySubscriptionSummary> {
  const params = new URLSearchParams();
  params.set("account_type", filters.accountType ?? "personal");
  params.set("month", filters.month);
  if (filters.currency) params.set("currency", filters.currency);
  const res = await apiFetch(
    `${API_BASE_URL}/api/subscriptions/summary?${params.toString()}`,
    { headers: authHeaders() }
  );
  if (!res.ok) {
    return { month: filters.month, subscription_total: {}, installment_total: {} };
  }
  return (await res.json()) as MonthlySubscriptionSummary;
}

export async function fetchAllSubscriptionMonthlySummary(
  month: string,
  accountType: AccountType = "personal"
): Promise<MonthlySubscriptionSummary> {
  const [cad, krw] = await Promise.all([
    fetchSubscriptionMonthlySummary({ month, currency: "CAD", accountType }),
    fetchSubscriptionMonthlySummary({ month, currency: "KRW", accountType }),
  ]);
  const subscription_total: Partial<Record<Currency, number>> = {
    CAD: cad.subscription_total.CAD ?? 0,
    KRW: krw.subscription_total.KRW ?? 0,
  };
  const installment_total: Partial<Record<Currency, number>> = {
    CAD: cad.installment_total.CAD ?? 0,
    KRW: krw.installment_total.KRW ?? 0,
  };
  return { month, subscription_total, installment_total };
}

export async function fetchSubscriptionHistory(
  id: string
): Promise<SubscriptionHistory | null> {
  const res = await apiFetch(`${API_BASE_URL}/api/subscriptions/${id}/history`, {
    headers: authHeaders(),
  });
  if (!res.ok) return null;
  return (await res.json()) as SubscriptionHistory;
}

export async function createSubscription(
  payload: NewSubscription
): Promise<Subscription> {
  const res = await apiFetch(`${API_BASE_URL}/api/subscriptions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await readApiError(res, "saveSubscription");
  return (await res.json()) as Subscription;
}

export async function updateSubscription(
  id: string,
  payload: Partial<{
    name: string;
    amount: number;
    status: SubscriptionStatus;
    end_date: string | null;
    account_type: AccountType;
    account_id: string;
    counter_account_id: string | null;
    category: string;
    sub_category: string;
    merchant?: string;
    start_date: string;
    installment_start_date: string | null;
    total_installments: number | null;
    completed_installments: number | null;
    cycle: BillingCycle;
    promo_amount: number | null;
    promo_end_date: string | null;
    promo_reminder_enabled?: boolean;
    end_reminder_enabled?: boolean;
    is_fixed_bill?: boolean;
  }>
): Promise<Subscription> {
  const res = await apiFetch(`${API_BASE_URL}/api/subscriptions/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await readApiError(res, "updateSubscription");
  return (await res.json()) as Subscription;
}

export async function scheduleSubscriptionCancel(
  id: string
): Promise<Subscription> {
  const res = await apiFetch(
    `${API_BASE_URL}/api/subscriptions/${id}/schedule-cancel`,
    { method: "POST", headers: authHeaders() }
  );
  if (!res.ok) throw await readApiError(res, "scheduleSubscriptionCancel");
  return (await res.json()) as Subscription;
}

export async function deleteSubscription(id: string): Promise<void> {
  const res = await apiFetch(`${API_BASE_URL}/api/subscriptions/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw await readApiError(res, "deleteSubscription");
}

export async function fetchPendingOccurrences(filters: {
  month?: string;
  currency?: Currency;
  accountType?: AccountType;
} = {}): Promise<SubscriptionOccurrence[]> {
  const params = pendingQueryParams(filters);
  const res = await apiFetch(
    `${API_BASE_URL}/api/subscriptions/pending?${params.toString()}`,
    { headers: authHeaders() }
  );
  if (!res.ok) return [];
  return (await res.json()) as SubscriptionOccurrence[];
}

export async function skipSubscriptionOccurrence(
  occurrenceId: string
): Promise<SubscriptionOccurrence> {
  const res = await apiFetch(
    `${API_BASE_URL}/api/subscriptions/occurrences/${occurrenceId}/skip`,
    { method: "POST", headers: authHeaders() }
  );
  if (!res.ok) throw await readApiError(res, "skipSubscriptionOccurrence");
  return (await res.json()) as SubscriptionOccurrence;
}

export async function syncSubscriptions(
  accountType: AccountType = "personal"
): Promise<number> {
  const params = new URLSearchParams({
    account_type: accountType,
    as_of: dayKey(new Date()),
  });
  const res = await apiFetch(
    `${API_BASE_URL}/api/subscriptions/sync?${params.toString()}`,
    { method: "POST", headers: authHeaders() }
  );
  if (!res.ok) return 0;
  const body = (await res.json()) as { materialized?: number };
  return body.materialized ?? 0;
}

function pendingQueryParams(filters: {
  month?: string;
  currency?: Currency;
  accountType?: AccountType;
}): URLSearchParams {
  const params = new URLSearchParams();
  params.set("account_type", filters.accountType ?? "personal");
  params.set("as_of", dayKey(new Date()));
  if (filters.month) params.set("month", filters.month);
  if (filters.currency) params.set("currency", filters.currency);
  return params;
}

export async function fetchAllPendingOccurrences(filters: {
  month?: string;
  accountType?: AccountType;
} = {}): Promise<SubscriptionOccurrence[]> {
  const [cad, krw] = await Promise.all([
    fetchPendingOccurrences({ ...filters, currency: "CAD" }),
    fetchPendingOccurrences({ ...filters, currency: "KRW" }),
  ]);
  return [...cad, ...krw].sort(
    (a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime()
  );
}

export async function createTransaction(
  tx: NewTransaction
): Promise<Transaction> {
  const res = await apiFetch(`${API_BASE_URL}/api/transactions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(tx),
  });
  if (!res.ok) {
    throw await readApiError(res, "saveTransaction");
  }
  return (await res.json()) as Transaction;
}

export async function updateTransaction(
  id: string,
  tx: NewTransaction
): Promise<Transaction> {
  const res = await apiFetch(`${API_BASE_URL}/api/transactions/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(tx),
  });
  if (!res.ok) {
    throw await readApiError(res, "updateTransaction");
  }
  return (await res.json()) as Transaction;
}

export async function deleteTransaction(id: string): Promise<void> {
  const res = await apiFetch(`${API_BASE_URL}/api/transactions/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) {
    throw await readApiError(res, "deleteTransaction");
  }
}

export async function fetchAccounts(filters: {
  currency?: Currency;
  accountType?: AccountType;
  activeOnly?: boolean;
} = {}): Promise<FinancialAccount[]> {
  const params = new URLSearchParams();
  params.set("account_type", filters.accountType ?? "personal");
  if (filters.currency) params.set("currency", filters.currency);
  if (filters.activeOnly === false) params.set("active_only", "false");

  const res = await apiFetch(
    `${API_BASE_URL}/api/accounts?${params.toString()}`,
    { headers: authHeaders() }
  );
  if (!res.ok) throw new ApiError("fetchAccounts");
  return (await res.json()) as FinancialAccount[];
}

export async function createAccount(
  payload: NewFinancialAccount
): Promise<FinancialAccount> {
  const res = await apiFetch(`${API_BASE_URL}/api/accounts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      opening_balance: 0,
      account_type: "personal",
      ...payload,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw apiErrorFromBody(body, "createAccount");
  }
  return (await res.json()) as FinancialAccount;
}

export async function updateAccount(
  accountId: string,
  payload: Partial<
    Pick<
      FinancialAccount,
      | "name"
      | "nickname"
      | "opening_balance"
      | "default_roles"
      | "is_active"
      | "institution"
      | "last_four"
      | "account_number"
    >
  >
): Promise<FinancialAccount> {
  const res = await apiFetch(`${API_BASE_URL}/api/accounts/${accountId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new ApiError("updateAccount");
  return (await res.json()) as FinancialAccount;
}

export async function deleteAccount(accountId: string): Promise<void> {
  const res = await apiFetch(`${API_BASE_URL}/api/accounts/${accountId}`, {
    method: "DELETE",
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new ApiError("deleteAccount");
}

export type DefaultRole = "bank" | "card" | "income" | "subscription" | "brokerage";
export const DEFAULT_ROLES: DefaultRole[] = [
  "card",
  "bank",
  "income",
  "subscription",
  "brokerage",
];
/** What a form is choosing an account for; the server maps it to slot order. */
export type DefaultPurpose = "expense" | "transfer" | "income" | "subscription" | "stock";

export interface DefaultSlot {
  currency: "CAD" | "KRW";
  role: DefaultRole;
  account_id: string | null;
  status: "set" | "missing" | "invalid";
  eligible_account_ids: string[];
}

export interface ResolvedDefault {
  account_id: string | null;
  source: DefaultRole | "only_option" | null;
  reason: "not_set" | "no_account" | null;
}

export interface AccountDefaults {
  account_type: AccountType;
  slots: DefaultSlot[];
  resolved: Partial<Record<"CAD" | "KRW", Record<DefaultPurpose, ResolvedDefault>>>;
}

export async function fetchAccountDefaults(
  accountType: AccountType
): Promise<AccountDefaults> {
  const res = await apiFetch(
    `${API_BASE_URL}/api/account-defaults?account_type=${accountType}`,
    { headers: authHeaders() }
  );
  if (!res.ok) throw new ApiError("fetchAccountDefaults");
  return (await res.json()) as AccountDefaults;
}

export async function setAccountDefault(
  accountType: AccountType,
  currency: "CAD" | "KRW",
  role: DefaultRole,
  accountId: string | null
): Promise<AccountDefaults> {
  const res = await apiFetch(
    `${API_BASE_URL}/api/account-defaults/${accountType}/${currency}/${role}`,
    accountId
      ? {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ account_id: accountId }),
        }
      : { method: "DELETE", headers: authHeaders() }
  );
  if (!res.ok) throw new ApiError("setAccountDefault");
  return (await res.json()) as AccountDefaults;
}

/**
 * Account a form should pre-select, or "" when none applies. Only returns ids
 * present in `accounts` so a stale default never selects a hidden account.
 */
export function resolveDefaultAccountId(
  defaults: AccountDefaults | null,
  currency: Currency,
  purpose: DefaultPurpose,
  accounts: FinancialAccount[]
): string {
  if (currency !== "CAD" && currency !== "KRW") return "";
  const id = defaults?.resolved[currency]?.[purpose]?.account_id;
  return id && accounts.some((a) => a.id === id) ? id : "";
}

/** Why no default applies, for an actionable hint ("not_set" | "no_account"). */
export function defaultMissingReason(
  defaults: AccountDefaults | null,
  currency: Currency,
  purpose: DefaultPurpose
): ResolvedDefault["reason"] {
  if (currency !== "CAD" && currency !== "KRW") return null;
  return defaults?.resolved[currency]?.[purpose]?.reason ?? null;
}

/**
 * Slot roles an account could hold, mirroring the server rules. Brokerages
 * follow the country tab; other kinds need a CAD or KRW account.
 */
export function applicableDefaultRoles(account: {
  kind: FinancialAccountKind;
  currency: Currency;
}): DefaultRole[] {
  if (account.kind === "investment") return ["brokerage"];
  if (account.currency !== "CAD" && account.currency !== "KRW") return [];
  return account.kind === "credit_card"
    ? ["card", "subscription"]
    : ["bank", "income", "subscription"];
}

export function accountLabel(account: FinancialAccount): string {
  return account.nickname?.trim() || account.name;
}


/** Keep only last 4 digits for card PAN / display. */
export function normalizeLastFour(raw: string | null | undefined): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return null;
  return digits.slice(-4);
}

/**
 * Account numbers are sensitive. Store/display only a masked form ending in last 4.
 * e.g. "123-456-789012" -> "••••9012"
 */
export function maskAccountNumber(raw: string | null | undefined): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return null;
  const last4 = digits.slice(-4);
  if (digits.length <= 4) return `••••${last4}`;
  return `••••${last4}`;
}

export function formatAmount(
  amount: number,
  currency: Currency,
  options?: { plainUsd?: boolean }
): string {
  // CAD → $… ; USD → US$… so Canada holdings never look identical.
  // `plainUsd` kept for call-site compat but USD always uses the US$ prefix.
  void options?.plainUsd;
  if (currency === "USD") {
    return (
      "US$" +
      amount.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  }
  if (currency === "CAD") {
    return (
      "$" +
      amount.toLocaleString("en-CA", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  }
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(amount);
}

/** Format a typed amount string with thousands separators (e.g. 12,900). */
export function formatAmountInput(value: string, currency: Currency): string {
  if (currency === "KRW") {
    const digits = value.replace(/\D/g, "");
    if (!digits) return "";
    return Number(digits).toLocaleString("en-US");
  }
  const cleaned = value.replace(/[^\d.]/g, "");
  if (!cleaned) return "";
  const hasDot = cleaned.includes(".");
  const [intRaw, ...rest] = cleaned.split(".");
  const decimals = rest.join("").slice(0, 2);
  const intFormatted = intRaw
    ? Number(intRaw).toLocaleString("en-US")
    : "0";
  return hasDot ? `${intFormatted}.${decimals}` : intFormatted;
}

/** Share quantities may need more than 2 decimal places (fractional shares). */
export function formatSharesInput(value: string): string {
  const cleaned = value.replace(/[^\d.]/g, "");
  if (!cleaned) return "";
  const hasDot = cleaned.includes(".");
  const [intRaw, ...rest] = cleaned.split(".");
  const decimals = rest.join("").slice(0, 6);
  const intFormatted = intRaw ? Number(intRaw).toLocaleString("en-US") : "0";
  return hasDot ? `${intFormatted}.${decimals}` : intFormatted;
}

export function parseAmountInput(value: string): number {
  const n = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function amountToInput(amount: number, currency: Currency): string {
  if (currency === "KRW") {
    return Math.round(amount).toLocaleString("en-US");
  }
  const fixed = amount.toFixed(2);
  const [intPart, dec] = fixed.split(".");
  const intFormatted = Number(intPart).toLocaleString("en-US");
  return dec === "00" ? intFormatted : `${intFormatted}.${dec}`;
}

/** Compact calendar label for pending subscription names on a day. */
const PENDING_NAME_MAX = 10;

function truncatePendingName(name: string, max = PENDING_NAME_MAX): string {
  if (name.length <= max) return name;
  return `${name.slice(0, max)}...`;
}

export function formatPendingLabel(names: string[]): string {
  const cleaned = names.map((n) => n.trim()).filter(Boolean);
  if (cleaned.length === 0) return "";
  const head = truncatePendingName(cleaned[0]);
  if (cleaned.length === 1) return head;
  return `${head} +${cleaned.length - 1}`;
}

export function formatPendingDayLabels(
  items: { currency: Currency; name: string }[],
  scope: LedgerScope
): string[] {
  if (items.length === 0) return [];
  if (scope === "ALL") {
    const cad = items
      .filter((i) => i.currency === "CAD")
      .map((i) => i.name);
    const krw = items
      .filter((i) => i.currency === "KRW")
      .map((i) => i.name);
    const lines: string[] = [];
    const cadLabel = formatPendingLabel(cad);
    const krwLabel = formatPendingLabel(krw);
    if (cadLabel) lines.push(cadLabel);
    if (krwLabel) lines.push(krwLabel);
    return lines;
  }
  return [formatPendingLabel(items.map((i) => i.name))];
}

export function monthsBetweenDates(start: Date, end: Date): number {
  return Math.max(
    0,
    (end.getFullYear() - start.getFullYear()) * 12 +
      (end.getMonth() - start.getMonth())
  );
}

export function addMonthsToDateKey(dateKey: string, months: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(y, m - 1 + months, d);
  const ny = date.getFullYear();
  const nm = String(date.getMonth() + 1).padStart(2, "0");
  const nd = String(date.getDate()).padStart(2, "0");
  return `${ny}-${nm}-${nd}`;
}

export function subscriptionDisplayAmount(sub: Subscription): number {
  const regular = sub.amount;
  if (sub.promo_amount == null) return regular;
  // No end date → promo stays on until the user sets one.
  if (!sub.promo_end_date) return sub.promo_amount;
  const today = localDateKey(new Date());
  const end = String(sub.promo_end_date).slice(0, 10);
  if (today <= end) return sub.promo_amount;
  return regular;
}

export function isPromoActive(sub: Subscription): boolean {
  if (sub.promo_amount == null) return false;
  if (!sub.promo_end_date) return true;
  const today = localDateKey(new Date());
  const end = String(sub.promo_end_date).slice(0, 10);
  return today <= end;
}

/** Infer listing currency from Yahoo exchange suffix. */
export function inferCurrencyFromTicker(ticker: string): Currency | null {
  const t = ticker.trim().toUpperCase();
  if (t.endsWith(".KS") || t.endsWith(".KQ")) return "KRW";
  if (
    t.endsWith(".TO") ||
    t.endsWith(".V") ||
    t.endsWith(".NE") ||
    t.endsWith(".CN")
  ) {
    return "CAD";
  }
  return null;
}

function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Infer CA/KR tab for legacy accounts without country. */
export function resolveAccountCountry(
  account: Pick<FinancialAccount, "country" | "currency" | "institution" | "name">
): AccountCountry | null {
  if (account.country === "CA" || account.country === "KR") return account.country;
  const hay = `${account.institution || ""} ${account.name || ""}`.toLowerCase();
  if (
    KOREAN_BROKERAGE_HINTS.test(hay)
  ) {
    return "KR";
  }
  if (
    /wealthsimple|questrade|td direct|rbc direct|cibc investor|national bank direct|interactive brokers/.test(
      hay
    )
  ) {
    return "CA";
  }
  if (account.currency === "KRW") return "KR";
  if (account.currency === "CAD") return "CA";
  return null;
}

/** True when subscription charge is due today or already past (show red). */
export function isSubscriptionDueOrPast(
  dueDate: string,
  asOf: Date = new Date()
): boolean {
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  const today = new Date(asOf);
  today.setHours(0, 0, 0, 0);
  return due.getTime() <= today.getTime();
}

export function subscriptionScheduleAmountClass(
  dueDate: string,
  asOf: Date = new Date()
): string {
  return isSubscriptionDueOrPast(dueDate, asOf)
    ? "text-red-500"
    : "text-amber-600 dark:text-amber-400";
}

export function isSubscriptionTransaction(tx: Transaction): boolean {
  return Boolean(tx.subscription_id || tx.subscription_billing_cycle);
}

export interface PendingMonthlyTotals {
  subscription: Partial<Record<Currency, number>>;
  installment: Partial<Record<Currency, number>>;
}

export function pendingMonthlyTotals(
  pending: SubscriptionOccurrence[]
): PendingMonthlyTotals {
  const subscription: Partial<Record<Currency, number>> = {};
  const installment: Partial<Record<Currency, number>> = {};
  for (const occ of pending) {
    const bucket =
      occ.subscription_billing_cycle === "installment" ? installment : subscription;
    bucket[occ.currency] = (bucket[occ.currency] ?? 0) + occ.amount;
  }
  return { subscription, installment };
}


export function categoriesForType(
  presets: CategoryPresets,
  type: TransactionType
): string[] {
  const groups = type === "expense" ? presets.expense : presets.income;
  return groups.map((g) => g.category);
}

export function subCategoriesFor(
  presets: CategoryPresets,
  type: TransactionType,
  category: string
): string[] {
  const groups = type === "expense" ? presets.expense : presets.income;
  return groups.find((g) => g.category === category)?.sub_categories ?? [];
}

export interface PartnerSummary {
  id: string;
  email: string;
  name: string;
  picture: string | null;
}

export interface InvitationOut {
  id: string;
  invitee_email: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  created_at: string;
  expires_at: string;
  email_sent?: boolean;
  accept_url?: string | null;
  shared_ledger_start_date?: string | null;
}

export interface InvitationMe {
  shared_group_id: string | null;
  partner: PartnerSummary | null;
  pending_invite: InvitationOut | null;
}

export async function fetchInvitationMe(): Promise<InvitationMe> {
  const res = await apiFetch(`${API_BASE_URL}/api/invitations/me`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new ApiError("fetchInvitationMe");
  return (await res.json()) as InvitationMe;
}

export async function createInvitation(
  inviteeEmail: string,
  sharedLedgerStartDate: string
): Promise<InvitationOut> {
  const res = await apiFetch(`${API_BASE_URL}/api/invitations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      invitee_email: inviteeEmail,
      shared_ledger_start_date: sharedLedgerStartDate,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw apiErrorFromBody(body, "createInvitation");
  }
  return (await res.json()) as InvitationOut;
}

export async function acceptInvitation(token: string): Promise<InvitationMe> {
  const res = await apiFetch(`${API_BASE_URL}/api/invitations/accept`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw apiErrorFromBody(body, "acceptInvitation");
  }
  return (await res.json()) as InvitationMe;
}

export async function revokePendingInvitation(): Promise<void> {
  const res = await apiFetch(`${API_BASE_URL}/api/invitations/pending`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw apiErrorFromBody(body, "revokePendingInvitation");
  }
}

export async function unlinkPartnership(): Promise<InvitationMe> {
  const res = await apiFetch(`${API_BASE_URL}/api/invitations/partnership`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw apiErrorFromBody(body, "unlinkPartnership");
  }
  return (await res.json()) as InvitationMe;
}

// STOCKS PORTFOLIO API IMPLEMENTATION

export interface StockHolding {
  id: string;
  account_id: string;
  account_name: string;
  institution: string;
  account_country?: AccountCountry | null;
  ticker: string;
  name: string;
  shares: number;
  avg_price: number;
  price: number;
  prev_close: number;
  currency: string;
  invested: number;
  valuation: number;
  profit: number;
  yield: number;
  daily_change: number;
  daily_change_percent: number;
  updated_at: string;
}

export interface StockHoldingCreate {
  account_id: string;
  ticker: string;
  name: string;
  avg_price: number;
  shares: number;
  currency: Currency;
}

export interface StockHoldingUpdate {
  avg_price?: number;
  shares?: number;
}

export interface StockSummary {
  display_currency: Currency;
  total_invested: number;
  total_valuation: number;
  total_profit: number;
  total_yield: number;
  cash_balances: {
    account_id: string;
    name: string;
    institution: string;
    balance: number;
    currency: Currency;
  }[];
}

export interface StockSearchResult {
  ticker: string;
  name: string;
  exchange: string;
  quote_type: string;
}

export interface MarketIndexQuote {
  id: string;
  symbol: string;
  price: number;
  prev_close: number;
  change_percent: number;
  currency: string;
}

export async function fetchMarketIndices(): Promise<MarketIndexQuote[]> {
  const res = await apiFetch(`${API_BASE_URL}/api/stocks/market-indices`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new ApiError("fetchMarketIndices");
  const data = (await res.json()) as { indices: MarketIndexQuote[] };
  return data.indices ?? [];
}

export async function searchStocks(query: string): Promise<StockSearchResult[]> {
  const res = await apiFetch(
    `${API_BASE_URL}/api/stocks/search?q=${encodeURIComponent(query)}`,
    { headers: authHeaders() }
  );
  if (!res.ok) return [];
  return (await res.json()) as StockSearchResult[];
}

export async function fetchStockHoldings(
  accountType: AccountType = "personal"
): Promise<StockHolding[]> {
  const res = await apiFetch(
    `${API_BASE_URL}/api/stocks/holdings?account_type=${accountType}`,
    { headers: authHeaders() }
  );
  if (!res.ok) throw new ApiError("fetchStockHoldings");
  return (await res.json()) as StockHolding[];
}

export async function createStockHolding(
  payload: StockHoldingCreate
): Promise<any> {
  const res = await apiFetch(`${API_BASE_URL}/api/stocks/holdings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await readApiError(res, "createStockHolding");
  return await res.json();
}

export async function updateStockHolding(
  id: string,
  payload: StockHoldingUpdate
): Promise<any> {
  const res = await apiFetch(`${API_BASE_URL}/api/stocks/holdings/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await readApiError(res, "updateStockHolding");
  return await res.json();
}

export async function deleteStockHolding(id: string): Promise<void> {
  const res = await apiFetch(`${API_BASE_URL}/api/stocks/holdings/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw await readApiError(res, "deleteStockHolding");
}

export async function fetchStockSummary(
  accountType: AccountType = "personal",
  displayCurrency: Currency = "CAD",
  accountId?: string
): Promise<StockSummary> {
  let url = `${API_BASE_URL}/api/stocks/summary?account_type=${accountType}&display_currency=${displayCurrency}`;
  if (accountId) {
    url += `&account_id=${accountId}`;
  }
  const res = await apiFetch(url, { headers: authHeaders() });
  if (!res.ok) throw new ApiError("fetchStockSummary");
  return (await res.json()) as StockSummary;
}

export interface ParsedTransaction {
  date: string;
  amount: number;
  currency: "CAD" | "KRW" | "USD";
  merchant: string;
  category: string;
  sub_category: string;
  file_name: string;
  items?: TransactionItem[];
  subtotal?: number | null;
  tax_amount?: number | null;
  tip_amount?: number | null;
  tip_percent?: number | null;
}

export async function parseReceiptsOrStatements(
  files: File[],
  options?: { flowType?: "expense" | "income"; retryCount?: number; forceModel?: string }
): Promise<ParsedTransaction[]> {
  const formData = new FormData();
  files.forEach((file) => {
    formData.append("files", file);
  });
  const flowType = options?.flowType ?? "expense";
  const retryCount = options?.retryCount ?? 0;
  let url = `${API_BASE_URL}/api/ai/parse?flow_type=${encodeURIComponent(flowType)}&retry_count=${retryCount}`;
  if (options?.forceModel) {
    url += `&force_model=${encodeURIComponent(options.forceModel)}`;
  }
  const res = await apiFetch(url, {
    method: "POST",
    headers: { ...authHeaders() },
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw apiErrorFromBody(err, "aiScanFailed");
  }
  const data = await res.json();
  return data.results as ParsedTransaction[];
}

export async function parseReceiptItems(
  file: File
): Promise<TransactionItem[]> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await apiFetch(`${API_BASE_URL}/api/ai/parse-items`, {
    method: "POST",
    headers: { ...authHeaders() },
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw apiErrorFromBody(err, "itemsScanFailed");
  }
  const data = await res.json();
  return (data.items || []) as TransactionItem[];
}

export async function saveGeminiApiKey(apiKey: string): Promise<UserSettings> {
  const res = await apiFetch(`${API_BASE_URL}/api/settings/ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ api_key: apiKey }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw apiErrorFromBody(err, "saveApiKey");
  }
  return (await res.json()) as UserSettings;
}

export async function setShareGeminiApiKey(
  share: boolean
): Promise<UserSettings> {
  const res = await apiFetch(`${API_BASE_URL}/api/settings/ai/share`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ share }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw apiErrorFromBody(err, "shareApiKey");
  }
  return (await res.json()) as UserSettings;
}

export async function updateLedgerStartDate(
  ledgerStartDate: string,
  kind: "personal" | "shared" = "personal"
): Promise<UserSettings> {
  const res = await apiFetch(`${API_BASE_URL}/api/settings/ledger-start-date`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      ledger_start_date: ledgerStartDate,
      kind,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw apiErrorFromBody(err, "updateLedgerStartDate");
  }
  return (await res.json()) as UserSettings;
}

export async function saveOnboardingBasics(payload: {
  preferred_locales: string[];
  ledger_start_date: string;
  api_key?: string | null;
  preferred_locale?: string;
}): Promise<UserSettings> {
  const res = await apiFetch(`${API_BASE_URL}/api/settings/onboarding/basics`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      preferred_locales: payload.preferred_locales,
      preferred_locale: payload.preferred_locales[0] ?? payload.preferred_locale,
      ledger_start_date: payload.ledger_start_date,
      api_key: payload.api_key,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw apiErrorFromBody(err, "saveOnboardingBasics");
  }
  return (await res.json()) as UserSettings;
}

export async function updatePreferredLocales(
  preferred_locales: string[]
): Promise<UserSettings> {
  const res = await apiFetch(`${API_BASE_URL}/api/settings/locales`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      preferred_locales,
      preferred_locale: preferred_locales[0],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw apiErrorFromBody(err, "updateLanguage");
  }
  return (await res.json()) as UserSettings;
}

export async function saveOnboardingStep(step: number): Promise<UserSettings> {
  const res = await apiFetch(`${API_BASE_URL}/api/settings/onboarding/step`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ step }),
  });
  if (!res.ok) throw new ApiError("saveOnboardingStep");
  return (await res.json()) as UserSettings;
}

export async function completeOnboarding(
  completed = true
): Promise<UserSettings> {
  const res = await apiFetch(`${API_BASE_URL}/api/settings/onboarding/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ completed }),
  });
  if (!res.ok) throw new ApiError("completeOnboarding");
  return (await res.json()) as UserSettings;
}

export type OnboardingParseStep = "assets" | "subscriptions" | "brokerage";

export interface OnboardingParsedAccount {
  name?: string;
  institution?: string;
  kind?: string;
  currency?: string;
  opening_balance?: number;
  /** Credit cards only — last 4 digits. */
  last_four?: string;
  /** Bank/broker — may be full or already masked; client masks before save. */
  account_number?: string;
}

export interface OnboardingParsedSubscription {
  name?: string;
  amount?: number;
  regular_amount?: number;
  currency?: string;
  kind?: string;
  cycle?: string;
  billing_day?: number;
  start_date?: string;
  end_date?: string;
  total_installments?: number;
  promo_amount?: number;
  promo_end_date?: string;
  category?: string;
  sub_category?: string;
}

export interface OnboardingParsedHolding {
  ticker?: string;
  name?: string;
  shares?: number;
  avg_price?: number;
  currency?: string;
}

export interface OnboardingParseResult {
  step: OnboardingParseStep;
  data: {
    accounts?: OnboardingParsedAccount[];
    subscriptions?: OnboardingParsedSubscription[];
    brokerage?: {
      name?: string;
      currency?: string;
      cash_balance?: number;
      holdings?: OnboardingParsedHolding[];
    };
  };
  models_used?: string[];
  notes?: string[];
  errors?: string[] | null;
  batch_count?: number;
  image_count?: number;
}

export async function parseOnboardingScreenshots(
  step: OnboardingParseStep,
  files: File[],
  onEvent?: (event: {
    event: string;
    model?: string;
    fallback_model?: string;
    resume_at?: string;
    message?: string;
    count?: number;
    batch?: number;
    batch_count?: number;
    error?: string;
  }) => void
): Promise<OnboardingParseResult> {
  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file);
  }
  const res = await apiFetch(
    `${API_BASE_URL}/api/ai/onboarding-parse-stream?step=${encodeURIComponent(step)}`,
    {
      method: "POST",
      headers: authHeaders(),
      body: formData,
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw apiErrorFromBody(err, "screenshotScanFailed");
  }
  if (!res.body) {
    throw new ApiError("screenshotScanFailed");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult: OnboardingParseResult | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() || "";
    for (const chunk of chunks) {
      const line = chunk
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l.startsWith("data:"));
      if (!line) continue;
      const raw = line.replace(/^data:\s*/, "");
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        continue;
      }
      const eventName = String(payload.event || "");
      if (
        eventName === "trying" ||
        eventName === "scanning" ||
        eventName === "quota_fallback" ||
        eventName === "batch_done"
      ) {
        onEvent?.({
          event: eventName,
          model: payload.model as string | undefined,
          fallback_model: payload.fallback_model as string | undefined,
          resume_at: payload.resume_at as string | undefined,
          message: payload.message as string | undefined,
          count: payload.count as number | undefined,
          batch: payload.batch as number | undefined,
          batch_count: payload.batch_count as number | undefined,
        });
      } else if (eventName === "error") {
        throw apiErrorFromEvent(payload, "screenshotScanFailed");
      } else if (eventName === "success") {
        finalResult = {
          step: payload.step as OnboardingParseStep,
          data: payload.data as OnboardingParseResult["data"],
          models_used: payload.models_used as string[] | undefined,
          notes: payload.notes as string[] | undefined,
          errors: (payload.errors as string[] | null | undefined) ?? null,
          batch_count: payload.batch_count as number | undefined,
          image_count: payload.image_count as number | undefined,
        };
      }
    }
  }

  if (!finalResult) {
    throw new ApiError("screenshotScanFailed");
  }
  return finalResult;
}

export interface CanadaSubscriptionChip {
  id: string;
  name: string;
  url: string;
}

export async function fetchCanadaSubscriptions(): Promise<{
  top7: CanadaSubscriptionChip[];
  more: CanadaSubscriptionChip[];
}> {
  const res = await apiFetch(`${API_BASE_URL}/api/settings/canada-subscriptions`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new ApiError("fetchCanadaSubscriptions");
  return (await res.json()) as {
    top7: CanadaSubscriptionChip[];
    more: CanadaSubscriptionChip[];
  };
}

export async function fetchKoreaSubscriptions(): Promise<{
  top7: CanadaSubscriptionChip[];
  more: CanadaSubscriptionChip[];
}> {
  const res = await apiFetch(`${API_BASE_URL}/api/settings/korea-subscriptions`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new ApiError("fetchKoreaSubscriptions");
  return (await res.json()) as {
    top7: CanadaSubscriptionChip[];
    more: CanadaSubscriptionChip[];
  };
}

export type ResetScope = "all" | "ledger" | "subscriptions" | "stocks";
export type ResetAccountType = "all" | "personal" | "shared";

export async function resetUserData(
  scope: ResetScope = "all",
  accountType: ResetAccountType = "all"
): Promise<{ status: string; scope: string; detail: string }> {
  const params = new URLSearchParams({
    scope,
    account_type: accountType,
  });
  const res = await apiFetch(
    `${API_BASE_URL}/api/settings/reset?${params.toString()}`,
    {
      method: "POST",
      headers: authHeaders(),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw apiErrorFromBody(err, "resetData");
  }
  return (await res.json()) as {
    status: string;
    scope: string;
    detail: string;
  };
}

export interface OCRLog {
  id: string;
  timestamp: string;
  file_name: string;
  model_used: string | null;
  parsed_data: any;
  feedback: "thumbs_up" | "thumbs_down" | null;
  status: "success" | "failed";
  error_message: string | null;
  owner_id: string;
}

export async function fetchOCRLogs(): Promise<OCRLog[]> {
  const res = await apiFetch(`${API_BASE_URL}/api/ai/logs`, {
    method: "GET",
    headers: authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw apiErrorFromBody(err, "fetchOcrLogs");
  }
  return (await res.json()) as OCRLog[];
}

export async function updateOCRLogFeedback(logId: string, feedback: "thumbs_up" | "thumbs_down" | null): Promise<void> {
  const res = await apiFetch(`${API_BASE_URL}/api/ai/logs/${logId}/feedback`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ feedback }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw apiErrorFromBody(err, "updateOcrFeedback");
  }
}

