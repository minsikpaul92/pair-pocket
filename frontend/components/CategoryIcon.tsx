import {
  ArrowLeftRight,
  Banknote,
  Bus,
  Gift,
  HeartPulse,
  Home,
  Landmark,
  LucideIcon,
  PiggyBank,
  Popcorn,
  Receipt,
  ShoppingBag,
  Tag,
  TrendingUp,
  Utensils,
  Wallet,
} from "lucide-react";

import { CATEGORY, SUB_CATEGORY } from "@/lib/category-values";

const ICON_MAP: Record<string, LucideIcon> = {
  [CATEGORY.food]: Utensils,
  [CATEGORY.housing]: Home,
  [CATEGORY.transport]: Bus,
  [CATEGORY.living]: ShoppingBag,
  [CATEGORY.health]: HeartPulse,
  [CATEGORY.culture]: Popcorn,
  [CATEGORY.gifts]: Gift,
  [CATEGORY.investmentSavings]: PiggyBank,
  [CATEGORY.tax]: Receipt,
  [CATEGORY.transfer]: ArrowLeftRight,
  [CATEGORY.salary]: Wallet,
  [CATEGORY.sideIncome]: Banknote,
  [CATEGORY.settlement]: TrendingUp,
  [CATEGORY.financeOther]: Landmark,
  // legacy
  [CATEGORY.transferLegacy]: ArrowLeftRight,
  [SUB_CATEGORY.cafeSnacks]: Utensils,
};

export function categoryIcon(category: string): LucideIcon {
  return ICON_MAP[category] ?? Tag;
}

export default function CategoryIcon({
  category,
  className,
}: {
  category: string;
  className?: string;
}) {
  const Icon = categoryIcon(category);
  return <Icon className={className} />;
}
