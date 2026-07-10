import type { BillingCycle, Subscription, SubscriptionStatus } from "@/lib/api";

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

export function translateSubscriptionTracking(
  sub: Subscription,
  t: TranslateFn,
  locale: string
): string {
  if (sub.cycle === "installment" && sub.total_installments != null) {
    const remaining = Math.max(
      sub.total_installments - sub.completed_installments,
      0
    );
    const end = sub.end_date
      ? formatSubscriptionDate(sub.end_date, locale)
      : "—";
    return t("trackingInstallment", {
      paid: sub.completed_installments,
      total: sub.total_installments,
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
