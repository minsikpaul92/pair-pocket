export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

const TOKEN_KEY = "pairpocket_token";

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
  merchant: string;
  owner_id: string;
}

export interface NewTransaction {
  date: string;
  amount: number;
  currency: Currency;
  type: TransactionType;
  account_type: AccountType;
  category: string;
  merchant: string;
}

function authHeaders(): HeadersInit {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchTransactions(
  accountType: AccountType = "personal"
): Promise<Transaction[]> {
  const res = await fetch(
    `${API_BASE_URL}/api/transactions?account_type=${accountType}`,
    { headers: authHeaders() }
  );
  if (!res.ok) throw new Error("거래 내역을 불러오지 못했습니다.");
  return (await res.json()) as Transaction[];
}

export async function createTransaction(
  tx: NewTransaction
): Promise<Transaction> {
  const res = await fetch(`${API_BASE_URL}/api/transactions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(tx),
  });
  if (!res.ok) throw new Error("거래를 저장하지 못했습니다.");
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
