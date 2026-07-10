import type { BillingCycle, Subscription, SubscriptionStatus } from "@/lib/api";
import { monthsBetweenDates } from "@/lib/api";

type TranslateFn = (
  key: string,
  values?: Record<string, string | number>
) => string;

export function formatSubscriptionDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(
    locale === "ko" ? "ko-KR" : "en-CA"
  );
}

export function translateBillingCycle(
  cycle: BillingCycle,
  t: TranslateFn
): string {
  return t(`cycle.${cycle}`);
}

export function translateSubscriptionStatus(
  status: SubscriptionStatus,
  t: TranslateFn
): string {
  return t(`status.${status}`);
}

export function translateSubscriptionSource(
  cycle: BillingCycle | null | undefined,
  t: TranslateFn
): string | null {
  if (!cycle) return null;
  return cycle === "installment" ? t("sourceInstallment") : t("sourceSubscription");
}

/** Installment progress for the month being viewed (not only materialized payments). */
export function installmentProgressAtMonth(
  sub: Subscription,
  viewMonth: Date
): { paid: number; remaining: number; total: number } {
  const total = sub.total_installments ?? 0;
  if (total <= 0) return { paid: 0, remaining: 0, total: 0 };

  const start = new Date(sub.installment_start_date || sub.start_date);
  const startMonth = new Date(start.getFullYear(), start.getMonth(), 1);
  const view = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);

  const schedulePaid = Math.min(monthsBetweenDates(startMonth, view), total);
  const remaining = Math.max(total - schedulePaid, 0);

  return { paid: schedulePaid, remaining, total };
}

export function translateSubscriptionTracking(
  sub: Subscription,
  t: TranslateFn,
  locale: string,
  viewMonth: Date = new Date()
): string {
  if (sub.cycle === "installment" && sub.total_installments != null) {
    const { paid, remaining, total } = installmentProgressAtMonth(
      sub,
      viewMonth
    );
    const end = sub.end_date
      ? formatSubscriptionDate(sub.end_date, locale)
      : "—";
    return t("trackingInstallment", {
      paid,
      total,
      remaining,
      end,
    });
  }
  const start = new Date(sub.installment_start_date || sub.start_date);
  const today = new Date();
  const months = Math.max(
    0,
    (today.getFullYear() - start.getFullYear()) * 12 +
      (today.getMonth() - start.getMonth())
  );
  if (months < 1) return t("trackingFirstMonth");
  return t("trackingMonths", { months });
}
