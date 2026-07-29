/** Country-specific bank presets for onboarding / account registration.

Logo URLs use Google's public favicon service (no API key).
Falls back to a colored badge if the image fails to load.
*/

export type BankCountry = "CA" | "KR";

export type BankOption = {
  id: string;
  name: string;
  domain: string | null;
  color: string;
  country: BankCountry;
};

export const CANADA_BANKS: BankOption[] = [
  { id: "TD", name: "TD", domain: "td.com", color: "#34A853", country: "CA" },
  { id: "RBC", name: "RBC", domain: "rbcroyalbank.com", color: "#003DA5", country: "CA" },
  { id: "BMO", name: "BMO", domain: "bmo.com", color: "#0079C1", country: "CA" },
  {
    id: "Scotiabank",
    name: "Scotiabank",
    domain: "scotiabank.com",
    color: "#EC111A",
    country: "CA",
  },
  { id: "CIBC", name: "CIBC", domain: "cibc.com", color: "#C41F3E", country: "CA" },
  {
    id: "National Bank",
    name: "National Bank",
    domain: "nbc.ca",
    color: "#E31837",
    country: "CA",
  },
  {
    id: "Tangerine",
    name: "Tangerine",
    domain: "tangerine.ca",
    color: "#FF7900",
    country: "CA",
  },
  { id: "EQ Bank", name: "EQ Bank", domain: "eqbank.ca", color: "#6C2BD9", country: "CA" },
  {
    id: "Wealthsimple",
    name: "Wealthsimple",
    domain: "wealthsimple.com",
    color: "#09171e",
    country: "CA",
  },
  { id: "Amex", name: "Amex", domain: "americanexpress.com", color: "#006FCF", country: "CA" },
  { id: "Costco", name: "Costco", domain: "costco.com", color: "#E31837", country: "CA" },
];

export const KOREA_BANKS: BankOption[] = [
  { id: "신한", name: "신한", domain: "shinhan.com", color: "#0046FF", country: "KR" },
  { id: "국민", name: "국민", domain: "kbstar.com", color: "#FFBC00", country: "KR" },
  { id: "하나", name: "하나", domain: "hanabank.com", color: "#009490", country: "KR" },
  { id: "우리", name: "우리", domain: "wooribank.com", color: "#0067AC", country: "KR" },
  {
    id: "카카오뱅크",
    name: "카카오뱅크",
    domain: "kakaobank.com",
    color: "#FFE812",
    country: "KR",
  },
  { id: "토스뱅크", name: "토스뱅크", domain: "tossbank.com", color: "#0064FF", country: "KR" },
  { id: "NH", name: "농협", domain: "nonghyup.com", color: "#1B9E3E", country: "KR" },
  { id: "IBK", name: "기업", domain: "ibk.co.kr", color: "#0056A4", country: "KR" },
  // Cards
  {
    id: "신한카드",
    name: "신한카드",
    domain: "shinhancard.com",
    color: "#0046FF",
    country: "KR",
  },
  {
    id: "삼성카드",
    name: "삼성카드",
    domain: "samsungcard.com",
    color: "#1428A0",
    country: "KR",
  },
  {
    id: "현대카드",
    name: "현대카드",
    domain: "hyundaicard.com",
    color: "#000000",
    country: "KR",
  },
  {
    id: "KB국민카드",
    name: "KB국민카드",
    domain: "kbcard.com",
    color: "#FFBC00",
    country: "KR",
  },
  {
    id: "롯데카드",
    name: "롯데카드",
    domain: "lottecard.co.kr",
    color: "#E60012",
    country: "KR",
  },
  {
    id: "우리카드",
    name: "우리카드",
    domain: "wooricard.com",
    color: "#0067AC",
    country: "KR",
  },
  {
    id: "하나카드",
    name: "하나카드",
    domain: "hanacard.co.kr",
    color: "#009490",
    country: "KR",
  },
  {
    id: "NH농협카드",
    name: "NH농협카드",
    domain: "card.nonghyup.com",
    color: "#1B9E3E",
    country: "KR",
  },
  {
    id: "BC카드",
    name: "BC카드",
    domain: "bccard.com",
    color: "#E31937",
    country: "KR",
  },
  // Brokerages
  {
    id: "토스증권",
    name: "토스증권",
    domain: "tossinvest.com",
    color: "#0064FF",
    country: "KR",
  },
  {
    id: "키움",
    name: "키움증권",
    domain: "kiwoom.com",
    color: "#D31145",
    country: "KR",
  },
  {
    id: "삼성증권",
    name: "삼성증권",
    domain: "samsungpop.com",
    color: "#1428A0",
    country: "KR",
  },
  {
    id: "미래에셋",
    name: "미래에셋증권",
    domain: "miraeasset.com",
    color: "#F15A22",
    country: "KR",
  },
  {
    id: "KB증권",
    name: "KB증권",
    domain: "kbsec.com",
    color: "#FFBC00",
    country: "KR",
  },
  {
    id: "한국투자",
    name: "한국투자증권",
    domain: "truefriend.com",
    color: "#0033A0",
    country: "KR",
  },
  {
    id: "NH투자",
    name: "NH투자증권",
    domain: "nhqv.com",
    color: "#1B9E3E",
    country: "KR",
  },
  {
    id: "신한투자",
    name: "신한투자증권",
    domain: "shinhansec.com",
    color: "#0046FF",
    country: "KR",
  },
  {
    id: "하나증권",
    name: "하나증권",
    domain: "hanaw.com",
    color: "#009490",
    country: "KR",
  },
  {
    id: "대신증권",
    name: "대신증권",
    domain: "daishin.com",
    color: "#003882",
    country: "KR",
  },
  {
    id: "메리츠",
    name: "메리츠증권",
    domain: "meritz.com",
    color: "#C8102E",
    country: "KR",
  },
];

/** Flat list kept for legacy pickers (AccountRegisterModal, etc.). */
export const BANK_OPTIONS = [...CANADA_BANKS, ...KOREA_BANKS] as const;

export type BankId = (typeof BANK_OPTIONS)[number]["id"];

export function banksForCountry(country: BankCountry): BankOption[] {
  return country === "CA" ? CANADA_BANKS : KOREA_BANKS;
}

export function currencyForCountry(country: BankCountry): "CAD" | "KRW" {
  return country === "CA" ? "CAD" : "KRW";
}

export function currencySymbol(currency: string): string {
  switch (currency) {
    case "CAD":
    case "USD":
      return "$";
    case "KRW":
      return "₩";
    default:
      return "";
  }
}

export function bankLogoUrl(domain: string | null | undefined): string | null {
  if (!domain) return null;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
}
