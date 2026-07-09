import {
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

const ICON_MAP: Record<string, LucideIcon> = {
  식비: Utensils,
  "주거/통신": Home,
  "교통/차량": Bus,
  "생활/쇼핑": ShoppingBag,
  "건강/의료": HeartPulse,
  "문화/취미": Popcorn,
  "경조사/선물": Gift,
  "투자/저축": PiggyBank,
  세금: Receipt,
  급여: Wallet,
  부수입: Banknote,
  정산: TrendingUp,
  "금융/기타": Landmark,
  // legacy
  "카페/간식": Utensils,
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
