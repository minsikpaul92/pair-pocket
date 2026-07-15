import { ApiError } from "@/lib/errors";
import { dayKey } from "./date";

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

const TOKEN_KEY = "pairpocket_token";

export const EXPENSE_CATEGORY_INVESTMENT = "투자/저축";
export const TRANSFER_CATEGORY = "자산 이동/카드";
export const TRANSFER_CATEGORY_LEGACY = "자산 이동";
export const TRANSFER_SUB_CARD_REPAYMENT = "카드 대금 상환";
export const TRANSFER_SUB_ACCOUNT_TRANSFER = "계좌 이체";
export const TRANSFER_SUB_INVESTMENT_FUNDING = "투자 계좌 입금";
export const INCOME_CATEGORY_SETTLEMENT = "정산";
export const SUB_CATEGORY_SETTLEMENT = "N빵 정산/환급";

export function normalizeTransferCategory(category: string): string {
  return category === TRANSFER_CATEGORY_LEGACY ? TRANSFER_CATEGORY : category;
}

export function isTransferTransaction(tx: {
  kind?: TransactionKind | null;
  category: string;
}): boolean {
  return (
    tx.kind === "transfer" ||
    tx.category === TRANSFER_CATEGORY ||
    tx.category === TRANSFER_CATEGORY_LEGACY
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

/** Transfers and N빵 settlements — shown grey, excluded from income/expense totals. */
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

export async function fetchCurrentUser(): Promise<CurrentUser | null> {
  const token = getToken();
  if (!token) return null;

  const res = await fetch(`${API_BASE_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    clearToken();
    return null;
  }
  return (await res.json()) as CurrentUser;
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

export interface FinancialAccount {
  id: string;
  owner_id: string;
  name: string;
  nickname: string | null;
  kind: FinancialAccountKind;
  currency: Currency;
  account_type: AccountType;
  opening_balance: number;
  is_liability: boolean;
  is_default_expense: boolean;
  is_default_income: boolean;
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
  opening_balance?: number;
  is_default_expense?: boolean;
  is_default_income?: boolean;
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

/** @deprecated Use accountKinds i18n namespace with ACCOUNT_KIND_KEYS */
export const ACCOUNT_KIND_LABEL: Record<FinancialAccountKind, string> = {
  checking: "입출금",
  savings: "저축",
  credit_card: "신용카드",
  investment: "투자",
  cash: "현금",
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
  kind?: TransactionKind;
  is_stock_trade?: boolean;
  trade_type?: "buy" | "sell";
  ticker?: string;
  shares?: number;
  price?: number;
  fee?: number;
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
  if (filters.type) params.set("type", filters.type);
  if (filters.category) params.set("category", filters.category);
  if (filters.sub_category) params.set("sub_category", filters.sub_category);
  if (filters.merchant) params.set("merchant", filters.merchant);
  if (filters.institution) params.set("institution", filters.institution);

  const res = await fetch(
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

/** Expense amount after N빵 settlements (for calendar/list display). */
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
  const res = await fetch(`${API_BASE_URL}/api/categories`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new ApiError("fetchCategories");
  return (await res.json()) as CategoryPresets;
}

export async function addCustomCategory(
  type: TransactionType,
  category: string
): Promise<CategoryPresets> {
  const res = await fetch(`${API_BASE_URL}/api/categories/category`, {
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
  const res = await fetch(`${API_BASE_URL}/api/categories/sub-category`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ type, category, sub_category }),
  });
  if (!res.ok) throw new ApiError("addSubCategory");
  return (await res.json()) as CategoryPresets;
}

export async function addInstitution(name: string): Promise<string[]> {
  const res = await fetch(`${API_BASE_URL}/api/settings/institutions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new ApiError("addInstitution");
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
  has_gemini_key?: boolean;
}

export async function fetchUserSettings(): Promise<UserSettings> {
  const res = await fetch(`${API_BASE_URL}/api/settings`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new ApiError("fetchUserSettings");
  const data = (await res.json()) as UserSettings;
  return {
    ...data,
    category_colors: data.category_colors ?? {},
  };
}

export async function setCategoryColor(
  category: string,
  color: string
): Promise<UserSettings> {
  const res = await fetch(`${API_BASE_URL}/api/settings/category-colors`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ category, color }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    if (body && typeof body.detail === "string") throw new Error(body.detail);
    throw new ApiError("setCategoryColor");
  }
  const data = (await res.json()) as UserSettings;
  return {
    ...data,
    category_colors: data.category_colors ?? {},
  };
}

export async function fetchSubCategories(
  type: TransactionType,
  category: string
): Promise<string[]> {
  const params = new URLSearchParams({ type, category });
  const res = await fetch(
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
  const res = await fetch(
    `${API_BASE_URL}/api/transactions/merchants?${params.toString()}`,
    { headers: authHeaders() }
  );
  if (!res.ok) return [];
  return (await res.json()) as string[];
}

export async function fetchInstitutionSuggestions(
  currency: Currency,
  subCategory?: string
): Promise<string[]> {
  const params = new URLSearchParams({ currency });
  if (subCategory) params.set("sub_category", subCategory);
  const res = await fetch(
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
  const res = await fetch(
    `${API_BASE_URL}/api/transactions/settleable?${params.toString()}`,
    { headers: authHeaders() }
  );
  if (!res.ok) return [];
  return (await res.json()) as SettleableExpense[];
}

export interface StatsFilters {
  currency?: Currency;
  month?: string;
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
  if (filters.category) params.set("category", filters.category);
  if (filters.sub_category) params.set("sub_category", filters.sub_category);
  if (filters.merchant) params.set("merchant", filters.merchant);
  if (filters.institution) params.set("institution", filters.institution);

  const res = await fetch(
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
  const res = await fetch(`${API_BASE_URL}/api/exchange-rate`, {
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

  const res = await fetch(
    `${API_BASE_URL}/api/accounts/net-worth?${params.toString()}`,
    { headers: authHeaders() }
  );
  if (!res.ok) throw new ApiError("fetchNetWorth");
  return (await res.json()) as NetWorthSummary;
}

async function readApiError(res: Response, fallbackCode: string): Promise<never> {
  const body = await res.json().catch(() => null);
  if (body && typeof body.detail === "string") {
    throw new Error(body.detail);
  }
  throw new ApiError(fallbackCode);
}

export type BillingCycle = "monthly" | "yearly" | "installment";
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
  account_id: string;
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
  end_date?: string | null;
  installment_start_date?: string | null;
  total_installments?: number | null;
  completed_installments?: number | null;
  promo_amount?: number | null;
  promo_end_date?: string | null;
  promo_reminder_enabled?: boolean;
  end_reminder_enabled?: boolean;
  account_id: string;
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
}

export const BILLING_CYCLE_LABEL: Record<BillingCycle, string> = {
  monthly: "매월",
  yearly: "매년",
  installment: "할부",
};

export const SUBSCRIPTION_STATUS_LABEL: Record<SubscriptionStatus, string> = {
  active: "진행중",
  paused: "일시정지",
  cancel_scheduled: "해지 예정",
  completed: "완료",
  cancelled: "해지",
};

export async function fetchSubscriptions(filters: {
  currency?: Currency;
  accountType?: AccountType;
  month?: string;
} = {}): Promise<Subscription[]> {
  const params = new URLSearchParams();
  params.set("account_type", filters.accountType ?? "personal");
  if (filters.currency) params.set("currency", filters.currency);
  if (filters.month) params.set("month", filters.month);
  const res = await fetch(
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
  const res = await fetch(
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
  const res = await fetch(`${API_BASE_URL}/api/subscriptions/${id}/history`, {
    headers: authHeaders(),
  });
  if (!res.ok) return null;
  return (await res.json()) as SubscriptionHistory;
}

export async function createSubscription(
  payload: NewSubscription
): Promise<Subscription> {
  const res = await fetch(`${API_BASE_URL}/api/subscriptions`, {
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
    account_id: string;
    category: string;
    sub_category: string;
    start_date: string;
    installment_start_date: string | null;
    total_installments: number | null;
    completed_installments: number | null;
    cycle: BillingCycle;
    promo_amount: number | null;
    promo_end_date: string | null;
    promo_reminder_enabled?: boolean;
    end_reminder_enabled?: boolean;
  }>
): Promise<Subscription> {
  const res = await fetch(`${API_BASE_URL}/api/subscriptions/${id}`, {
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
  const res = await fetch(
    `${API_BASE_URL}/api/subscriptions/${id}/schedule-cancel`,
    { method: "POST", headers: authHeaders() }
  );
  if (!res.ok) throw await readApiError(res, "scheduleSubscriptionCancel");
  return (await res.json()) as Subscription;
}

export async function deleteSubscription(id: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/subscriptions/${id}`, {
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
  const res = await fetch(
    `${API_BASE_URL}/api/subscriptions/pending?${params.toString()}`,
    { headers: authHeaders() }
  );
  if (!res.ok) return [];
  return (await res.json()) as SubscriptionOccurrence[];
}

export async function skipSubscriptionOccurrence(
  occurrenceId: string
): Promise<SubscriptionOccurrence> {
  const res = await fetch(
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
  const res = await fetch(
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
  const res = await fetch(`${API_BASE_URL}/api/transactions`, {
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
  const res = await fetch(`${API_BASE_URL}/api/transactions/${id}`, {
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
  const res = await fetch(`${API_BASE_URL}/api/transactions/${id}`, {
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

  const res = await fetch(
    `${API_BASE_URL}/api/accounts?${params.toString()}`,
    { headers: authHeaders() }
  );
  if (!res.ok) throw new ApiError("fetchAccounts");
  return (await res.json()) as FinancialAccount[];
}

export async function createAccount(
  payload: NewFinancialAccount
): Promise<FinancialAccount> {
  const res = await fetch(`${API_BASE_URL}/api/accounts`, {
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
    if (body && typeof body.detail === "string") {
      throw new Error(body.detail);
    }
    throw new ApiError("createAccount");
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
      | "is_default_expense"
      | "is_default_income"
      | "is_active"
      | "institution"
      | "last_four"
      | "account_number"
    >
  >
): Promise<FinancialAccount> {
  const res = await fetch(`${API_BASE_URL}/api/accounts/${accountId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new ApiError("updateAccount");
  return (await res.json()) as FinancialAccount;
}

export function defaultAccountId(
  accounts: FinancialAccount[],
  type: TransactionType
): string {
  // Only use the type-specific default. Do not fall back to another account —
  // expense and income defaults are independent; missing means "없음/현금".
  const flag = type === "expense" ? "is_default_expense" : "is_default_income";
  return accounts.find((a) => a[flag])?.id ?? "";
}

export function accountLabel(account: FinancialAccount): string {
  return account.nickname?.trim() || account.name;
}

export function accountDetail(account: FinancialAccount): string {
  const parts = [
    ACCOUNT_KIND_LABEL[account.kind],
    account.kind === "credit_card" && account.last_four
      ? `···${account.last_four}`
      : null,
    account.kind !== "credit_card" && account.account_number
      ? account.account_number
      : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

export function formatAmount(amount: number, currency: Currency): string {
  const locale = currency === "KRW" ? "ko-KR" : "en-CA";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "KRW" ? 0 : 2,
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
export function formatPendingLabel(names: string[]): string {
  const cleaned = names.map((n) => n.trim()).filter(Boolean);
  if (cleaned.length === 0) return "";
  if (cleaned.length === 1) return cleaned[0];
  return `${cleaned[0]}...+${cleaned.length - 1}`;
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

export function subscriptionSourceLabel(
  cycle: BillingCycle | null | undefined
): string | null {
  if (!cycle) return null;
  return cycle === "installment" ? "할부" : "구독";
}

export function subscriptionDisplayAmount(sub: Subscription): number {
  const regular = sub.amount;
  if (sub.promo_amount == null || !sub.promo_end_date) return regular;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const promoEnd = new Date(sub.promo_end_date);
  promoEnd.setHours(0, 0, 0, 0);
  if (today <= promoEnd) return sub.promo_amount;
  return regular;
}

export function isPromoActive(sub: Subscription): boolean {
  if (sub.promo_amount == null || !sub.promo_end_date) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const promoEnd = new Date(sub.promo_end_date);
  promoEnd.setHours(0, 0, 0, 0);
  return today <= promoEnd;
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

export function subscriptionTrackingLabel(
  sub: Subscription,
  viewMonth: Date = new Date()
): string {
  if (sub.cycle === "installment" && sub.total_installments != null) {
    const start = new Date(sub.installment_start_date || sub.start_date);
    const startMonth = new Date(start.getFullYear(), start.getMonth(), 1);
    const view = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
    const schedulePaid = Math.min(
      monthsBetweenDates(startMonth, view),
      sub.total_installments
    );
    const remaining = Math.max(sub.total_installments - schedulePaid, 0);
    const end = sub.end_date
      ? new Date(sub.end_date).toLocaleDateString("ko-KR")
      : "—";
    return `${schedulePaid}/${sub.total_installments}회 · ${remaining}회 남음 · 종료 ${end}`;
  }
  const start = new Date(sub.installment_start_date || sub.start_date);
  const months = monthsBetweenDates(start, new Date());
  if (months < 1) return "첫 달";
  return `${months}개월째 구독`;
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
}

export interface InvitationMe {
  shared_group_id: string | null;
  partner: PartnerSummary | null;
  pending_invite: InvitationOut | null;
}

export async function fetchInvitationMe(): Promise<InvitationMe> {
  const res = await fetch(`${API_BASE_URL}/api/invitations/me`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new ApiError("fetchInvitationMe");
  return (await res.json()) as InvitationMe;
}

export async function createInvitation(
  inviteeEmail: string
): Promise<InvitationOut> {
  const res = await fetch(`${API_BASE_URL}/api/invitations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ invitee_email: inviteeEmail }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    if (body && typeof body.detail === "string") {
      throw new Error(body.detail);
    }
    throw new ApiError("createInvitation");
  }
  return (await res.json()) as InvitationOut;
}

export async function acceptInvitation(token: string): Promise<InvitationMe> {
  const res = await fetch(`${API_BASE_URL}/api/invitations/accept`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    if (body && typeof body.detail === "string") {
      throw new Error(body.detail);
    }
    throw new ApiError("acceptInvitation");
  }
  return (await res.json()) as InvitationMe;
}

export async function revokePendingInvitation(): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/invitations/pending`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    if (body && typeof body.detail === "string") {
      throw new Error(body.detail);
    }
    throw new ApiError("revokePendingInvitation");
  }
}

export async function unlinkPartnership(): Promise<InvitationMe> {
  const res = await fetch(`${API_BASE_URL}/api/invitations/partnership`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    if (body && typeof body.detail === "string") {
      throw new Error(body.detail);
    }
    throw new ApiError("unlinkPartnership");
  }
  return (await res.json()) as InvitationMe;
}

// STOCKS PORTFOLIO API IMPLEMENTATION

export interface StockHolding {
  id: string;
  account_id: string;
  account_name: string;
  institution: string;
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

export async function searchStocks(query: string): Promise<StockSearchResult[]> {
  const res = await fetch(
    `${API_BASE_URL}/api/stocks/search?q=${encodeURIComponent(query)}`,
    { headers: authHeaders() }
  );
  if (!res.ok) return [];
  return (await res.json()) as StockSearchResult[];
}

export async function fetchStockHoldings(
  accountType: AccountType = "personal"
): Promise<StockHolding[]> {
  const res = await fetch(
    `${API_BASE_URL}/api/stocks/holdings?account_type=${accountType}`,
    { headers: authHeaders() }
  );
  if (!res.ok) throw new ApiError("fetchStockHoldings");
  return (await res.json()) as StockHolding[];
}

export async function createStockHolding(
  payload: StockHoldingCreate
): Promise<any> {
  const res = await fetch(`${API_BASE_URL}/api/stocks/holdings`, {
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
  const res = await fetch(`${API_BASE_URL}/api/stocks/holdings/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await readApiError(res, "updateStockHolding");
  return await res.json();
}

export async function deleteStockHolding(id: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/stocks/holdings/${id}`, {
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
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new ApiError("fetchStockSummary");
  return (await res.json()) as StockSummary;
}

export interface ParsedTransaction {
  date: string;
  amount: number;
  currency: "CAD" | "KRW";
  merchant: string;
  category: string;
  sub_category: string;
  file_name: string;
}

export async function parseReceiptsOrStatements(files: File[]): Promise<ParsedTransaction[]> {
  const formData = new FormData();
  files.forEach((file) => {
    formData.append("files", file);
  });
  const res = await fetch(`${API_BASE_URL}/api/ai/parse`, {
    method: "POST",
    headers: { ...authHeaders() },
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.detail || "AI 분석에 실패했습니다.");
  }
  const data = await res.json();
  return data.results as ParsedTransaction[];
}

export async function saveGeminiApiKey(apiKey: string): Promise<UserSettings> {
  const res = await fetch(`${API_BASE_URL}/api/settings/ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ api_key: apiKey }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.detail || "API Key 저장에 실패했습니다.");
  }
  return (await res.json()) as UserSettings;
}

export async function resetUserData(): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/settings/reset`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.detail || "데이터 초기화에 실패했습니다.");
  }
}
