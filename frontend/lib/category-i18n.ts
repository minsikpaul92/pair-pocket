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
  "계좌 이체": "accountTransfer",
  "투자 계좌 입금": "investmentFunding",
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
