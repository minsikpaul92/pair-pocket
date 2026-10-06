/** Country-specific bank presets for onboarding / account registration.

Logo URLs use Google's public favicon service (no API key).
Falls back to a colored badge if the image fails to load.
*/

export type BankCountry = "CA" | "KR";

export type BankOption = {
  /** Stored as the account's institution. */
  id: string;
  /** Message key under `banks` for a name that differs by language. */
  key?: string;
  name: string;
  domain: string | null;
  color: string;
  country: BankCountry;
};

export const CANADA_BANKS: BankOption[] = [
  // Banks
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
    id: "Neo",
    name: "Neo",
    domain: "neofinancial.com",
    color: "#000000",
    country: "CA",
  },
  // Cards
  { id: "Amex", name: "Amex", domain: "americanexpress.com", color: "#006FCF", country: "CA" },
  {
    id: "Neo Card",
    name: "Neo Card",
    domain: "neofinancial.com",
    color: "#000000",
    country: "CA",
  },
  // Brokerages
  {
    id: "Wealthsimple",
    name: "Wealthsimple",
    domain: "wealthsimple.com",
    color: "#09171e",
    country: "CA",
  },
  {
    id: "Questrade",
    name: "Questrade",
    domain: "questrade.com",
    color: "#003366",
    country: "CA",
  },
  {
    id: "Interactive Brokers",
    name: "Interactive Brokers",
    domain: "interactivebrokers.com",
    color: "#D0011B",
    country: "CA",
  },
  {
    id: "TD Direct Investing",
    name: "TD Direct Investing",
    domain: "td.com",
    color: "#34A853",
    country: "CA",
  },
];

export const KOREA_BANKS: BankOption[] = [
  // Banks
  { id: "신한", key: "shinhan", name: "신한", domain: "shinhan.com", color: "#0046FF", country: "KR" },
  { id: "국민", key: "kookmin", name: "국민", domain: "kbstar.com", color: "#FFBC00", country: "KR" },
  { id: "하나", key: "hana", name: "하나", domain: "hanabank.com", color: "#009490", country: "KR" },
  { id: "우리", key: "woori", name: "우리", domain: "wooribank.com", color: "#0067AC", country: "KR" },
  {
    id: "카카오뱅크",
    key: "kakaoBank",
    name: "카카오뱅크",
    domain: "kakaobank.com",
    color: "#FFE812",
    country: "KR",
  },
  { id: "토스뱅크", key: "tossBank", name: "토스뱅크", domain: "tossbank.com", color: "#0064FF", country: "KR" },
  {
    id: "케이뱅크",
    key: "kBank",
    name: "케이뱅크",
    domain: "kbanknow.com",
    color: "#1A1A1A",
    country: "KR",
  },
  { id: "NH", key: "nonghyup", name: "농협", domain: "nonghyup.com", color: "#1B9E3E", country: "KR" },
  { id: "IBK", key: "ibk", name: "기업", domain: "ibk.co.kr", color: "#0056A4", country: "KR" },
  // Cards
  {
    id: "신한카드",
    key: "shinhanCard",
    name: "신한카드",
    domain: "shinhancard.com",
    color: "#0046FF",
    country: "KR",
  },
  {
    id: "삼성카드",
    key: "samsungCard",
    name: "삼성카드",
    domain: "samsungcard.com",
    color: "#1428A0",
    country: "KR",
  },
  {
    id: "현대카드",
    key: "hyundaiCard",
    name: "현대카드",
    domain: "hyundaicard.com",
    color: "#000000",
    country: "KR",
  },
  {
    id: "KB국민카드",
    key: "kbCard",
    name: "KB국민카드",
    domain: "kbcard.com",
    color: "#FFBC00",
    country: "KR",
  },
  {
    id: "롯데카드",
    key: "lotteCard",
    name: "롯데카드",
    domain: "lottecard.co.kr",
    color: "#E60012",
    country: "KR",
  },
  {
    id: "우리카드",
    key: "wooriCard",
    name: "우리카드",
    domain: "wooricard.com",
    color: "#0067AC",
    country: "KR",
  },
  {
    id: "하나카드",
    key: "hanaCard",
    name: "하나카드",
    domain: "hanacard.co.kr",
    color: "#009490",
    country: "KR",
  },
  {
    id: "NH농협카드",
    key: "nhCard",
    name: "NH농협카드",
    domain: "card.nonghyup.com",
    color: "#1B9E3E",
    country: "KR",
  },
  {
    id: "BC카드",
    key: "bcCard",
    name: "BC카드",
    domain: "bccard.com",
    color: "#E31937",
    country: "KR",
  },
  // Brokerages
  {
    id: "토스증권",
    key: "tossSecurities",
    name: "토스증권",
    domain: "tossinvest.com",
    color: "#0064FF",
    country: "KR",
  },
  {
    id: "키움",
    key: "kiwoom",
    name: "키움증권",
    domain: "kiwoom.com",
    color: "#D31145",
    country: "KR",
  },
  {
    id: "삼성증권",
    key: "samsungSecurities",
    name: "삼성증권",
    domain: "samsungpop.com",
    color: "#1428A0",
    country: "KR",
  },
  {
    id: "미래에셋",
    key: "miraeAsset",
    name: "미래에셋증권",
    domain: "miraeasset.com",
    color: "#F15A22",
    country: "KR",
  },
  {
    id: "KB증권",
    key: "kbSecurities",
    name: "KB증권",
    domain: "kbsec.com",
    color: "#FFBC00",
    country: "KR",
  },
  {
    id: "한국투자",
    key: "koreaInvestment",
    name: "한국투자증권",
    domain: "truefriend.com",
    color: "#0033A0",
    country: "KR",
  },
  {
    id: "NH투자",
    key: "nhInvestment",
    name: "NH투자증권",
    domain: "nhqv.com",
    color: "#1B9E3E",
    country: "KR",
  },
  {
    id: "신한투자",
    key: "shinhanInvestment",
    name: "신한투자증권",
    domain: "shinhansec.com",
    color: "#0046FF",
    country: "KR",
  },
  {
    id: "하나증권",
    key: "hanaSecurities",
    name: "하나증권",
    domain: "hanaw.com",
    color: "#009490",
    country: "KR",
  },
  {
    id: "대신증권",
    key: "daishin",
    name: "대신증권",
    domain: "daishin.com",
    color: "#003882",
    country: "KR",
  },
  {
    id: "메리츠",
    key: "meritz",
    name: "메리츠증권",
    domain: "meritz.com",
    color: "#C8102E",
    country: "KR",
  },
];

/** Institution names (lowercased) that identify a Korean brokerage account. */
export const KOREAN_BROKERAGE_HINTS =
  /toss|토스|키움|kiwoom|미래에셋|mirae|삼성증권|한국투자|kb증권|nh투자|나무|shinhan invest|한투/;

/** Flat list kept for legacy pickers (AccountRegisterModal, etc.). */
export const BANK_OPTIONS = [...CANADA_BANKS, ...KOREA_BANKS] as const;

export type BankId = (typeof BANK_OPTIONS)[number]["id"];

export function findBank(value: string | null | undefined): BankOption | undefined {
  if (!value) return undefined;
  return BANK_OPTIONS.find((b) => b.id === value || b.name === value);
}

type BankTranslator = { (key: string): string; has(key: string): boolean };

/**
 * Display name for a stored institution value, translated with the `banks`
 * namespace for presets that have one. Custom names are shown as typed.
 */
export function institutionLabel(value: string, t: BankTranslator): string {
  const bank = findBank(value);
  if (bank?.key && t.has(bank.key)) return t(bank.key);
  return bank?.name ?? value;
}

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
