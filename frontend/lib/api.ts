export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

const TOKEN_KEY = "pairpocket_token";

export const EXPENSE_CATEGORY_INVESTMENT = "투자/저축";
export const INCOME_CATEGORY_SETTLEMENT = "정산";
export const SUB_CATEGORY_SETTLEMENT = "N빵 정산/환급";

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

export type Currency = "KRW" | "CAD";
export type LedgerScope = Currency | "ALL";
export type TransactionType = "income" | "expense";
export type AccountType = "shared" | "personal";

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
  owner_id: string;
  settled_amount?: number;
  effective_amount?: number;
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
  if (!res.ok) throw new Error("거래 내역을 불러오지 못했습니다.");
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
  if (!res.ok) throw new Error("카테고리를 불러오지 못했습니다.");
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
  if (!res.ok) throw new Error("대분류를 추가하지 못했습니다.");
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
  if (!res.ok) throw new Error("중분류를 추가하지 못했습니다.");
  return (await res.json()) as CategoryPresets;
}

export async function addInstitution(name: string): Promise<string[]> {
  const res = await fetch(`${API_BASE_URL}/api/settings/institutions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error("금융기관을 추가하지 못했습니다.");
  const data = await res.json();
  return data.institutions as string[];
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
  subCategory?: string
): Promise<string[]> {
  const params = new URLSearchParams({ category, currency });
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
  currency: Currency
): Promise<SettleableExpense[]> {
  const params = new URLSearchParams({ currency });
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
  if (!res.ok) throw new Error("통계를 불러오지 못했습니다.");
  return (await res.json()) as StatsSummary;
}

export interface ExchangeRate {
  cad_krw: number;
  krw_cad: number;
  date: string | null;
  stale: boolean;
}

export async function fetchExchangeRate(): Promise<ExchangeRate> {
  const res = await fetch(`${API_BASE_URL}/api/exchange-rate`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("환율을 불러오지 못했습니다.");
  return (await res.json()) as ExchangeRate;
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
    const body = await res.json().catch(() => null);
    const detail =
      body && typeof body.detail === "string"
        ? body.detail
        : "거래를 저장하지 못했습니다.";
    throw new Error(detail);
  }
  return (await res.json()) as Transaction;
}

export function formatAmount(amount: number, currency: Currency): string {
  const locale = currency === "KRW" ? "ko-KR" : "en-CA";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "KRW" ? 0 : 2,
  }).format(amount);
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
