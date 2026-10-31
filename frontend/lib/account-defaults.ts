import {
  AccountCountry,
  AccountType,
  Currency,
  FinancialAccount,
  FinancialAccountKind,
  resolveAccountCountry,
  updateAccount,
} from "@/lib/api";

export type DefaultWalletRole = "expense" | "income" | "credit";

const EXPENSE_KINDS: FinancialAccountKind[] = [
  "checking",
  "savings",
  "cash",
];

function flagForRole(role: DefaultWalletRole): keyof Pick<
  FinancialAccount,
  "is_default_expense" | "is_default_income" | "is_default_credit"
> {
  if (role === "income") return "is_default_income";
  if (role === "credit") return "is_default_credit";
  return "is_default_expense";
}

export function accountsForDefaultSlot(
  accounts: FinancialAccount[],
  currency: Currency,
  role: DefaultWalletRole
): FinancialAccount[] {
  return accounts.filter((a) => {
    if (!a.is_active || a.currency !== currency) return false;
    if (role === "credit") return a.kind === "credit_card";
    if (role === "expense") {
      return EXPENSE_KINDS.includes(a.kind);
    }
    return EXPENSE_KINDS.includes(a.kind) || a.kind === "checking" || a.kind === "savings";
  });
}

export function findDefaultAccountId(
  accounts: FinancialAccount[],
  currency: Currency,
  role: DefaultWalletRole
): string {
  const pool = accountsForDefaultSlot(accounts, currency, role);
  const flag = flagForRole(role);
  return pool.find((a) => a[flag])?.id ?? "";
}

export function investmentAccountsForCountry(
  accounts: FinancialAccount[],
  country: AccountCountry
): FinancialAccount[] {
  return accounts.filter((a) => {
    if (!a.is_active || a.kind !== "investment") return false;
    const c = resolveAccountCountry(a);
    if (c) return c === country;
    if (country === "KR") return a.currency === "KRW" || a.currency === "USD";
    return a.currency === "CAD" || a.currency === "USD";
  });
}

export function findDefaultInvestmentAccountId(
  accounts: FinancialAccount[],
  country: AccountCountry
): string {
  const pool = investmentAccountsForCountry(accounts, country);
  return pool.find((a) => a.is_default_investment)?.id ?? "";
}

/** Set or clear a wallet default; server clears other accounts in the same slot. */
export async function applyWalletDefault(
  accounts: FinancialAccount[],
  currency: Currency,
  role: DefaultWalletRole,
  nextAccountId: string | null
): Promise<void> {
  const flag = flagForRole(role);
  const currentId = findDefaultAccountId(accounts, currency, role);

  if (!nextAccountId) {
    if (currentId) {
      await updateAccount(currentId, { [flag]: false });
    }
    return;
  }

  if (currentId === nextAccountId) return;
  await updateAccount(nextAccountId, { [flag]: true });
}

export async function applyInvestmentDefault(
  accounts: FinancialAccount[],
  country: AccountCountry,
  nextAccountId: string | null
): Promise<void> {
  const currentId = findDefaultInvestmentAccountId(accounts, country);

  if (!nextAccountId) {
    if (currentId) {
      await updateAccount(currentId, { is_default_investment: false });
    }
    return;
  }

  if (currentId === nextAccountId) return;
  await updateAccount(nextAccountId, { is_default_investment: true });
}

export function defaultStockBrokerageAccountId(
  accounts: FinancialAccount[],
  currency: Currency
): string {
  const country: AccountCountry | null =
    currency === "KRW" ? "KR" : currency === "CAD" ? "CA" : null;
  if (country) {
    const scoped = investmentAccountsForCountry(accounts, country);
    return (
      scoped.find((a) => a.is_default_investment)?.id ||
      scoped[0]?.id ||
      ""
    );
  }
  const brokers = accounts.filter((a) => a.kind === "investment" && a.is_active);
  return (
    brokers.find((a) => a.is_default_investment && a.currency === currency)?.id ||
    brokers.find((a) => a.currency === currency)?.id ||
    ""
  );
}

export type LedgerDefaultsTab = AccountType;
