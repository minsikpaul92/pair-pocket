/**
 * Canonical category and sub-category values, exactly as the API stores them.
 *
 * These Korean strings are data identifiers, not display text: the database,
 * the backend presets (backend/app/models/category_preset.py) and the AI
 * prompts all use them. Never render them directly; use translateCategory /
 * translateSubCategory from lib/category-i18n, which look up
 * `categories.<key>` and `subCategories.<key>` in the message packs.
 *
 * The object keys are those message keys.
 */

export const CATEGORY = {
  food: "식비",
  housing: "주거/통신",
  transport: "교통/차량",
  living: "생활/쇼핑",
  health: "건강/의료",
  culture: "문화/취미",
  gifts: "경조사/선물",
  investmentSavings: "투자/저축",
  tax: "세금",
  transfer: "자산 이동/카드",
  transferLegacy: "자산 이동",
  salary: "급여",
  sideIncome: "부수입",
  settlement: "정산",
  financeOther: "금융/기타",
};

export const SUB_CATEGORY = {
  groceries: "식재료/장보기",
  diningOut: "외식/배달",
  cafeSnacks: "카페/간식",
  rentMortgage: "월세/모기지",
  utilities: "관리비/공과금",
  telecom: "통신비",
  internet: "인터넷",
  mobilePhone: "휴대폰",
  homeMaintenance: "가정 정비",
  publicTransit: "대중교통",
  taxiUber: "택시/우버",
  fuelCharging: "유류비/충전",
  vehicleMaintenance: "차량 유지",
  essentials: "생필품",
  clothing: "의류/잡화",
  beauty: "미용/뷰티",
  pets: "반려동물",
  medical: "병원/약국",
  fitness: "운동/헬스",
  supplements: "영양제",
  culturalLife: "문화 생활",
  hobbyEntertainment: "취미/엔터",
  subscriptions: "정기 구독",
  academyEducation: "학원/교육",
  travelLodging: "여행/숙박",
  ceremonial: "경조사비",
  giftsAnniversary: "선물/기념일",
  clubFees: "모임/회비",
  stockPurchase: "주식 매수",
  fhsaContribution: "FHSA 납입",
  tfsaContribution: "TFSA 납입",
  savingsDeposit: "저축성 예금",
  taxPayment: "세금",
  cardRepayment: "카드 대금 상환",
  accountTransfer: "내 계좌 이동",
  accountTransferLegacy: "계좌 이체",
  investmentFunding: "투자 계좌 입금",
  sharedFunding: "공용 계좌 입금",
  sharedWithdrawal: "개인 계좌로 인출",
  etransfer: "e-Transfer/계좌이체",
  salaryMain: "급여",
  biweeklyPay: "주급(Bi-weekly)",
  partTime: "파트타임",
  sideBusiness: "부업",
  resale: "중고거래",
  tips: "팁(Tip)",
  splitSettlement: "N빵 정산/환급",
  stockSale: "주식 판매수익",
  dividends: "투자 배당금",
  bankInterest: "은행 이자",
  taxRefund: "정부 환급금(HST/Tax Refund)",
};

export type CategoryKey = keyof typeof CATEGORY;
export type SubCategoryKey = keyof typeof SUB_CATEGORY;

/**
 * Placeholder the API stores when a transaction or subscription has no
 * merchant. Render it with common.unspecified.
 */
export const MERCHANT_PLACEHOLDER = "미지정";

/** Default unit stored on receipt line items. Render it with transaction.unitEach. */
export const DEFAULT_ITEM_UNIT = "개";
