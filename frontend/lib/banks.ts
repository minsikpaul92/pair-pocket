/** Canadian major banks + common KR options for institution picker.

Logo URLs use Google's public favicon service (no API key).
Falls back to a colored badge if the image fails to load.
*/
export const BANK_OPTIONS = [
  { id: "TD", name: "TD", domain: "td.com", color: "#34A853" },
  { id: "RBC", name: "RBC", domain: "rbcroyalbank.com", color: "#003DA5" },
  { id: "BMO", name: "BMO", domain: "bmo.com", color: "#0079C1" },
  {
    id: "Scotiabank",
    name: "Scotiabank",
    domain: "scotiabank.com",
    color: "#EC111A",
  },
  { id: "CIBC", name: "CIBC", domain: "cibc.com", color: "#C41F3E" },
  {
    id: "National Bank",
    name: "National Bank",
    domain: "nbc.ca",
    color: "#E31837",
  },
  {
    id: "Tangerine",
    name: "Tangerine",
    domain: "tangerine.ca",
    color: "#FF7900",
  },
  { id: "EQ Bank", name: "EQ Bank", domain: "eqbank.ca", color: "#6C2BD9" },
  {
    id: "Wealthsimple",
    name: "Wealthsimple",
    domain: "wealthsimple.com",
    color: "#09171e",
  },
  { id: "Amex", name: "Amex", domain: "americanexpress.com", color: "#006FCF" },
  { id: "Costco", name: "Costco", domain: "costco.com", color: "#E31837" },
  { id: "신한", name: "신한", domain: "shinhan.com", color: "#0046FF" },
  { id: "국민", name: "국민", domain: "kbstar.com", color: "#FFBC00" },
  { id: "하나", name: "하나", domain: "hanabank.com", color: "#009490" },
  { id: "우리", name: "우리", domain: "wooribank.com", color: "#0067AC" },
  {
    id: "카카오뱅크",
    name: "카카오뱅크",
    domain: "kakaobank.com",
    color: "#FFE812",
  },
  { id: "토스", name: "토스", domain: "toss.im", color: "#0064FF" },
  { id: "기타", name: "기타", domain: null, color: "#6B7280" },
] as const;

export type BankId = (typeof BANK_OPTIONS)[number]["id"];

export function bankLogoUrl(domain: string | null | undefined): string | null {
  if (!domain) return null;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
}
