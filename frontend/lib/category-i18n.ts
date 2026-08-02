/**
 * Maps canonical API category/sub-category values (stored in Korean) to stable i18n keys.
 * User-created custom values fall back to the raw string when no key exists.
 */

export const CATEGORY_KEY_BY_VALUE: Record<string, string> = {
  식비: "food",
  "주거/통신": "housing",
  "교통/차량": "transport",
  "생활/쇼핑": "living",
  "건강/의료": "health",
  "문화/취미": "culture",
  "경조사/선물": "gifts",
  "투자/저축": "investmentSavings",
  세금: "tax",
  "자산 이동/카드": "transfer",
  "자산 이동": "transferLegacy",
  급여: "salary",
  부수입: "sideIncome",
  정산: "settlement",
  "금융/기타": "financeOther",
};

export const SUB_CATEGORY_KEY_BY_VALUE: Record<string, string> = {
  "식재료/장보기": "groceries",
  "외식/배달": "diningOut",
  "카페/간식": "cafeSnacks",
  "월세/모기지": "rentMortgage",
  "관리비/공과금": "utilities",
  통신비: "telecom",
  인터넷: "internet",
  휴대폰: "mobilePhone",
  "가정 정비": "homeMaintenance",
  대중교통: "publicTransit",
  "택시/우버": "taxiUber",
  "유류비/충전": "fuelCharging",
  "차량 유지": "vehicleMaintenance",
  생필품: "essentials",
  "의류/잡화": "clothing",
  "미용/뷰티": "beauty",
  반려동물: "pets",
  "병원/약국": "medical",
  "운동/헬스": "fitness",
  영양제: "supplements",
  "문화 생활": "culturalLife",
  "취미/엔터": "hobbyEntertainment",
  "정기 구독": "subscriptions",
  "학원/교육": "academyEducation",
  "여행/숙박": "travelLodging",
  경조사비: "ceremonial",
  "선물/기념일": "giftsAnniversary",
  "모임/회비": "clubFees",
  "주식 매수": "stockPurchase",
  "FHSA 납입": "fhsaContribution",
  "TFSA 납입": "tfsaContribution",
  "저축성 예금": "savingsDeposit",
  세금: "taxPayment",
  "카드 대금 상환": "cardRepayment",
  "내 계좌 이동": "accountTransfer",
  "계좌 이체": "accountTransferLegacy",
  "투자 계좌 입금": "investmentFunding",
  "공용 계좌 입금": "sharedFunding",
  "e-Transfer/계좌이체": "etransfer",
  급여: "salaryMain",
  "주급(Bi-weekly)": "biweeklyPay",
  파트타임: "partTime",
  부업: "sideBusiness",
  중고거래: "resale",
  "팁(Tip)": "tips",
  "N빵 정산/환급": "splitSettlement",
  "주식 판매수익": "stockSale",
  "투자 배당금": "dividends",
  "은행 이자": "bankInterest",
  "정부 환급금(HST/Tax Refund)": "taxRefund",
};

export function categoryI18nKey(value: string): string | null {
  return CATEGORY_KEY_BY_VALUE[value] ?? null;
}

export function subCategoryI18nKey(value: string): string | null {
  return SUB_CATEGORY_KEY_BY_VALUE[value] ?? null;
}

export function translateCategory(
  value: string,
  t: (key: string) => string
): string {
  const key = categoryI18nKey(value);
  return key ? t(key) : value;
}

export function translateSubCategory(
  value: string,
  t: (key: string) => string
): string {
  const key = subCategoryI18nKey(value);
  return key ? t(key) : value;
}

/** English UI labels → canonical Korean values stored in the API/DB. */
const CATEGORY_VALUE_BY_ENGLISH: Record<string, string> = {
  Food: "식비",
  "Housing / telecom": "주거/통신",
  "Transport / vehicle": "교통/차량",
  "Living / shopping": "생활/쇼핑",
  "Health / medical": "건강/의료",
  "Culture / hobbies": "문화/취미",
  "Gifts / events": "경조사/선물",
  "Investment / savings": "투자/저축",
  Tax: "세금",
  "Asset transfer / card": "자산 이동/카드",
  "Asset transfer": "자산 이동",
  Salary: "급여",
  "Side income": "부수입",
  Settlement: "정산",
  "Finance / other": "금융/기타",
};

const SUB_CATEGORY_VALUE_BY_ENGLISH: Record<string, string> = {
  Groceries: "식재료/장보기",
  "Dining / delivery": "외식/배달",
  "Cafe / snacks": "카페/간식",
  "Rent / mortgage": "월세/모기지",
  Utilities: "관리비/공과금",
  Telecom: "통신비",
  Internet: "인터넷",
  "Mobile phone": "휴대폰",
  "Home maintenance": "가정 정비",
  "Public transit": "대중교통",
  "Taxi / Uber": "택시/우버",
  "Fuel / charging": "유류비/충전",
  "Vehicle maintenance": "차량 유지",
  Essentials: "생필품",
  "Clothing / goods": "의류/잡화",
  Beauty: "미용/뷰티",
  Pets: "반려동물",
  "Medical / pharmacy": "병원/약국",
  Fitness: "운동/헬스",
  Supplements: "영양제",
  "Cultural activities": "문화 생활",
  "Hobbies / entertainment": "취미/엔터",
  Subscriptions: "정기 구독",
  "Academy / education": "학원/교육",
  "Travel / lodging": "여행/숙박",
  "Ceremonial expenses": "경조사비",
  "Gifts / anniversaries": "선물/기념일",
  "Club / membership fees": "모임/회비",
  "Stock purchase": "주식 매수",
  "FHSA contribution": "FHSA 납입",
  "TFSA contribution": "TFSA 납입",
  "Savings deposit": "저축성 예금",
  "Card repayment": "카드 대금 상환",
  "Move between my accounts": "내 계좌 이동",
  "Account transfer": "내 계좌 이동",
  "Investment account funding": "투자 계좌 입금",
  "Shared account funding": "공용 계좌 입금",
  "e-Transfer / bank transfer": "e-Transfer/계좌이체",
  "e-Transfer/계좌이체": "e-Transfer/계좌이체",
  Salary: "급여",
  Tax: "세금",
  "Bi-weekly pay": "주급(Bi-weekly)",
  "Part-time": "파트타임",
  "Side business": "부업",
  Resale: "중고거래",
  Tips: "팁(Tip)",
  "Split settlement / refund": "N빵 정산/환급",
  "Stock sale proceeds": "주식 판매수익",
  "Investment dividends": "투자 배당금",
  "Bank interest": "은행 이자",
  "Government refund (HST/Tax)": "정부 환급금(HST/Tax Refund)",
};

/** Map CSV/UI category text (KO or EN) to the canonical Korean value. */
export function canonicalizeCategory(value: string): string {
  const v = value.trim();
  if (!v) return v;
  if (CATEGORY_KEY_BY_VALUE[v]) return v;
  return CATEGORY_VALUE_BY_ENGLISH[v] ?? v;
}

/** Map CSV/UI sub-category text (KO or EN) to the canonical Korean value. */
export function canonicalizeSubCategory(value: string): string {
  const v = value.trim();
  if (!v) return v;
  if (v === "계좌 이체" || v === "Account transfer") return "내 계좌 이동";
  if (SUB_CATEGORY_KEY_BY_VALUE[v]) return v;
  return SUB_CATEGORY_VALUE_BY_ENGLISH[v] ?? v;
}
