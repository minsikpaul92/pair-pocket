"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Building2,
  CalendarDays,
  CheckCircle2,
  CreditCard,
  ExternalLink,
  KeyRound,
  Loader2,
  PiggyBank,
  Plus,
  SkipForward,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import LanguagePicker from "@/components/LanguagePicker";
import OnboardingField from "@/components/OnboardingField";
import OnboardingScreenshotScan from "@/components/OnboardingScreenshotScan";
import BankPicker from "@/components/BankPicker";
import AccountRegisterModal from "@/components/AccountRegisterModal";
import CategorySelect from "@/components/CategorySelect";
import SubCategorySelect from "@/components/SubCategorySelect";
import { useRouter } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/locales";
import {
  currencyForCountry,
  currencySymbol,
  type BankCountry,
} from "@/lib/banks";
import {
  CanadaSubscriptionChip,
  CategoryPresets,
  addCustomCategory,
  addCustomSubCategory,
  addInstitution,
  amountToInput,
  categoriesForType,
  createAccount,
  createStockHolding,
  createSubscription,
  completeOnboarding,
  fetchAccounts,
  fetchCanadaSubscriptions,
  fetchCategoryPresets,
  fetchUserSettings,
  formatAmountInput,
  maskAccountNumber,
  normalizeLastFour,
  OnboardingParseResult,
  parseAmountInput,
  removeInstitution,
  saveOnboardingBasics,
  saveOnboardingStep,
  subCategoriesFor,
  TRANSFER_CATEGORY,
  type BillingCycle,
  type Currency,
  type FinancialAccount,
  type FinancialAccountKind,
  type UserSettings,
} from "@/lib/api";

type Step = 0 | 1 | 2 | 3;

type DraftAccount = {
  key: string;
  name: string;
  kind: FinancialAccountKind;
  currency: Currency;
  country: BankCountry;
  opening_balance: string;
  institution: string;
  last_four: string;
  account_number: string;
  is_default_expense: boolean;
  is_default_credit: boolean;
};

type DraftSub = {
  key: string;
  name: string;
  amount: string;
  currency: Currency;
  url?: string;
  billing_day: string;
  sub_kind: "subscription" | "installment" | "fixed";
  cycle: "monthly" | "yearly";
  start_date: string;
  end_date: string;
  promo_enabled: boolean;
  promo_amount: string;
  promo_end_date: string;
  regular_amount: string;
  category: string;
  sub_category: string;
  merchant: string;
  total_installments: string;
};

const FIXED_BILL_OPTIONS = [
  { name: "월세", category: "주거/통신", sub_category: "월세/모기지" },
  { name: "인터넷", category: "주거/통신", sub_category: "인터넷" },
  { name: "핸드폰", category: "주거/통신", sub_category: "휴대폰" },
  { name: "유틸리티", category: "주거/통신", sub_category: "관리비/공과금" },
  { name: "학원비", category: "문화/취미", sub_category: "학원/교육" },
] as const;

function emptyDraftSub(start: string, currency: Currency = "CAD"): DraftSub {
  return {
    key: newKey(),
    name: "",
    amount: "",
    currency,
    billing_day: "1",
    sub_kind: "subscription",
    cycle: "monthly",
    start_date: start,
    end_date: "",
    promo_enabled: false,
    promo_amount: "",
    promo_end_date: "",
    regular_amount: "",
    category: "문화/취미",
    sub_category: "정기 구독",
    merchant: "",
    total_installments: "",
  };
}

type DraftHolding = {
  key: string;
  ticker: string;
  name: string;
  shares: string;
  avg_price: string;
  currency: Currency;
  account_id: string;
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function newKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const STEP_STORAGE_KEY = "pairpocket_onboarding_step";
const LOCALES_STORAGE_KEY = "pairpocket_onboarding_locales";

function readStoredStep(): Step | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(STEP_STORAGE_KEY);
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 3) return null;
  return n as Step;
}

function writeStoredStep(step: Step) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(STEP_STORAGE_KEY, String(step));
}

function clearStoredStep() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(STEP_STORAGE_KEY);
}

function readStoredLocales(): AppLocale[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(LOCALES_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as string[];
    if (!Array.isArray(parsed) || !parsed.length) return null;
    return parsed.slice(0, 2) as AppLocale[];
  } catch {
    return null;
  }
}

function writeStoredLocales(locales: AppLocale[]) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(LOCALES_STORAGE_KEY, JSON.stringify(locales.slice(0, 2)));
}

function clearStoredLocales() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(LOCALES_STORAGE_KEY);
}

export default function OnboardingWizard() {
  const t = useTranslations("onboarding");
  const tTx = useTranslations("transaction");
  const locale = useLocale() as AppLocale;
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [step, setStep] = useState<Step>(0);
  const [presets, setPresets] = useState<CategoryPresets | null>(null);

  const [startDate, setStartDate] = useState(todayISO());
  const [apiKey, setApiKey] = useState("");
  const [selectedLocales, setSelectedLocales] = useState<AppLocale[]>([]);

  const [accounts, setAccounts] = useState<DraftAccount[]>([]);
  const [assetCountry, setAssetCountry] = useState<BankCountry>("CA");
  const [customInstitutions, setCustomInstitutions] = useState<string[]>([]);
  const [subs, setSubs] = useState<DraftSub[]>([]);
  const [investmentAccounts, setInvestmentAccounts] = useState<
    FinancialAccount[]
  >([]);
  const [showBrokerRegister, setShowBrokerRegister] = useState(false);
  const [holdings, setHoldings] = useState<DraftHolding[]>([]);

  const [chips, setChips] = useState<{
    top7: CanadaSubscriptionChip[];
    more: CanadaSubscriptionChip[];
  }>({ top7: [], more: [] });
  const [showMoreChips, setShowMoreChips] = useState(false);
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;

    (async () => {
      try {
        const [s, canada, categoryPresets] = await Promise.all([
          fetchUserSettings(),
          fetchCanadaSubscriptions().catch(() => ({ top7: [], more: [] })),
          fetchCategoryPresets().catch(() => null),
        ]);
        setSettings(s);
        setChips(canada);
        if (categoryPresets) setPresets(categoryPresets);
        setCustomInstitutions(s.institutions || []);
        if (s.ledger_start_date) setStartDate(s.ledger_start_date);

        const storedLocales = readStoredLocales();
        const fromSettings = (s.preferred_locales?.length
          ? s.preferred_locales
          : s.preferred_locale
            ? [s.preferred_locale]
            : []) as AppLocale[];
        const initialLocales =
          storedLocales && storedLocales.length
            ? storedLocales
            : fromSettings.length
              ? fromSettings.slice(0, 2)
              : [];
        setSelectedLocales(initialLocales);
        if (initialLocales.length) writeStoredLocales(initialLocales);

        const savedStep = Math.min(
          Math.max(s.onboarding_personal_step ?? 0, 0),
          3
        ) as Step;
        const basicsDone = Boolean(
          s.ledger_start_date &&
            (s.preferred_locales?.length || s.preferred_locale)
        );
        // Locale switch remounts this page; prefer in-session step so the
        // wizard does not jump ahead from stale server progress.
        const sessionStep = readStoredStep();
        let initial: Step = 0;
        if (sessionStep != null) {
          initial = sessionStep;
        } else if (basicsDone) {
          initial = savedStep >= 1 ? savedStep : 1;
        } else {
          initial = 0;
        }
        setStep(initial);
        writeStoredStep(initial);
      } catch (err) {
        console.error(err);
        setError(t("loadError"));
      } finally {
        setLoading(false);
      }
    })();
    // Intentionally run once on mount. Locale switches remount with new `t`
    // and must not re-jump the wizard from server state mid-flow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const progressLabel = useMemo(() => t("stepOf", { current: step + 1, total: 4 }), [step, t]);

  async function goStep(next: Step) {
    setStep(next);
    writeStoredStep(next);
    if (next === 3) {
      try {
        const list = await fetchAccounts({ accountType: "personal" });
        setInvestmentAccounts(list.filter((a) => a.kind === "investment"));
      } catch {
        setInvestmentAccounts([]);
      }
    }
    try {
      await saveOnboardingStep(next);
    } catch {
      // Non-blocking; local step still advances.
    }
  }

  async function refreshInvestmentAccounts() {
    try {
      const list = await fetchAccounts({ accountType: "personal" });
      setInvestmentAccounts(list.filter((a) => a.kind === "investment"));
    } catch {
      setInvestmentAccounts([]);
    }
  }

  async function handleFinishBasics(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedLocales.length) {
      setError(t("languageRequired"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await saveOnboardingBasics({
        preferred_locales: selectedLocales,
        ledger_start_date: startDate,
        api_key: apiKey.trim() || undefined,
      });
      setSettings(updated);
      setApiKey("");
      writeStoredLocales(selectedLocales);
      await goStep(1);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("saveError"));
    } finally {
      setSaving(false);
    }
  }

  async function saveAssetsAndContinue(skip: boolean) {
    setSaving(true);
    setError(null);
    try {
      if (!skip) {
        for (const a of accounts) {
          const balance = parseAmountInput(a.opening_balance || "0");
          const isDefaultExpense =
            a.kind === "credit_card"
              ? a.is_default_credit
              : a.is_default_expense;
          await createAccount({
            name: a.name.trim() || a.institution || t("unnamedAccount"),
            kind: a.kind,
            currency: a.currency,
            account_type: "personal",
            opening_balance: Number.isFinite(balance) ? balance : 0,
            institution: a.kind === "cash" ? null : a.institution || null,
            last_four:
              a.kind === "credit_card"
                ? normalizeLastFour(a.last_four)
                : null,
            account_number:
              a.kind === "cash" || a.kind === "credit_card"
                ? null
                : maskAccountNumber(a.account_number),
            is_default_expense: isDefaultExpense,
            is_default_income: false,
          });
        }
      }
      await goStep(2);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("saveError"));
    } finally {
      setSaving(false);
    }
  }

  function billingStartDate(base: string, dayRaw: string): string {
    const day = Math.min(28, Math.max(1, Number(dayRaw) || 1));
    const parts = (base || startDate || todayISO()).split("-");
    if (parts.length < 3) return `${todayISO().slice(0, 8)}${String(day).padStart(2, "0")}`;
    return `${parts[0]}-${parts[1]}-${String(day).padStart(2, "0")}`;
  }

  async function saveSubsAndContinue(skip: boolean) {
    setSaving(true);
    setError(null);
    try {
      if (!skip && subs.length > 0) {
        const existing = await fetchAccounts({ accountType: "personal" });
        const preferred =
          existing.find((a) => a.is_default_expense) ||
          existing.find((a) => a.kind !== "credit_card") ||
          existing[0];
        let accountId = preferred?.id ?? null;
        if (!accountId) {
          const cash = await createAccount({
            name: t("defaultCashAccount"),
            kind: "cash",
            currency: subs[0]?.currency || "CAD",
            account_type: "personal",
            opening_balance: 0,
            is_default_expense: true,
          });
          accountId = cash.id;
        }

        for (const s of subs) {
          if (!s.name.trim()) continue;
          const regular = parseAmountInput(s.regular_amount || s.amount || "0");
          const promo = parseAmountInput(s.promo_amount || "0");
          const cycle: BillingCycle =
            s.sub_kind === "installment"
              ? "installment"
              : s.cycle === "yearly"
                ? "yearly"
                : "monthly";
          const baseStart = s.start_date || startDate;
          const isFixed = s.sub_kind === "fixed";
          const category = isFixed
            ? s.category || "주거/통신"
            : "문화/취미";
          const subCategory = isFixed
            ? s.sub_category || "관리비/공과금"
            : "정기 구독";
          const merchant =
            (isFixed ? s.merchant : "")?.trim() || s.name.trim();
          const installments = Number(s.total_installments);
          await createSubscription({
            name: s.name.trim(),
            amount: Number.isFinite(regular) && regular > 0 ? regular : promo,
            currency: s.currency,
            cycle,
            start_date: billingStartDate(baseStart, s.billing_day),
            end_date: s.end_date || null,
            account_id: accountId,
            category,
            sub_category: subCategory,
            account_type: "personal",
            merchant,
            promo_amount:
              s.promo_enabled && Number.isFinite(promo) && promo > 0
                ? promo
                : null,
            promo_end_date:
              s.promo_enabled && s.promo_end_date ? s.promo_end_date : null,
            promo_reminder_enabled: Boolean(s.promo_enabled),
            end_reminder_enabled: Boolean(s.end_date),
            total_installments:
              s.sub_kind === "installment" &&
              Number.isFinite(installments) &&
              installments > 0
                ? installments
                : s.sub_kind === "installment"
                  ? 12
                  : null,
          });
        }
      }
      await goStep(3);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("saveError"));
    } finally {
      setSaving(false);
    }
  }

  async function saveBrokerAndFinish(skip: boolean) {
    setSaving(true);
    setError(null);
    try {
      if (!skip) {
        for (const h of holdings) {
          const shares = Number(h.shares || 0);
          const avg = Number(h.avg_price || 0);
          if (
            !h.account_id ||
            !h.ticker.trim() ||
            !Number.isFinite(shares) ||
            shares <= 0
          ) {
            continue;
          }
          await createStockHolding({
            account_id: h.account_id,
            ticker: h.ticker.trim().toUpperCase(),
            name: h.name.trim() || h.ticker.trim().toUpperCase(),
            shares,
            avg_price: Number.isFinite(avg) ? avg : 0,
            currency: h.currency,
          });
        }
      }
      await completeOnboarding(true);
      clearStoredStep();
      clearStoredLocales();
      router.replace("/");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("saveError"));
    } finally {
      setSaving(false);
    }
  }

  function addChipAsSub(chip: CanadaSubscriptionChip) {
    setSubs((prev) => {
      if (prev.some((s) => s.name === chip.name)) return prev;
      return [
        ...prev,
        {
          ...emptyDraftSub(startDate, "CAD"),
          name: chip.name,
          url: chip.url,
        },
      ];
    });
    window.open(chip.url, "_blank", "noopener,noreferrer");
  }

  function addFixedBillOption(opt: (typeof FIXED_BILL_OPTIONS)[number]) {
    setSubs((prev) => {
      if (prev.some((s) => s.name === opt.name && s.sub_kind === "fixed")) {
        return prev;
      }
      return [
        ...prev,
        {
          ...emptyDraftSub(startDate, currencyForCountry(assetCountry)),
          name: opt.name,
          sub_kind: "fixed",
          category: opt.category,
          sub_category: opt.sub_category,
          merchant: opt.name,
        },
      ];
    });
  }

  function addManualSub() {
    setSubs((prev) => [...prev, emptyDraftSub(startDate)]);
  }

  function applyScreenshotResult(result: OnboardingParseResult) {
    if (result.step === "assets") {
      const parsed = result.data.accounts || [];
      setAccounts((prev) => [
        ...prev,
        ...parsed.map((a, index) => {
          const kind = (
            ["checking", "savings", "credit_card", "cash", "investment"].includes(
              String(a.kind)
            )
              ? a.kind
              : "checking"
          ) as FinancialAccountKind;
          const currency = (
            ["CAD", "KRW", "USD"].includes(String(a.currency).toUpperCase())
              ? String(a.currency).toUpperCase()
              : "CAD"
          ) as Currency;
          // Keep results on the active country tab — currency alone is not country.
          return {
            key: newKey(),
            name: a.name || "",
            kind,
            currency,
            country: assetCountry,
            opening_balance:
              a.opening_balance != null
                ? amountToInput(Number(a.opening_balance) || 0, currency)
                : "",
            institution: a.institution || "",
            last_four: normalizeLastFour(a.last_four) || "",
            account_number: maskAccountNumber(a.account_number) || "",
            is_default_expense: prev.length === 0 && index === 0 && kind !== "credit_card",
            is_default_credit: prev.length === 0 && index === 0 && kind === "credit_card",
          };
        }),
      ]);
      return;
    }

    if (result.step === "subscriptions") {
      const parsed = result.data.subscriptions || [];
      setSubs((prev) => [
        ...prev,
        ...parsed.map((s) => {
          const currency = (
            ["CAD", "KRW", "USD"].includes(String(s.currency).toUpperCase())
              ? String(s.currency).toUpperCase()
              : "CAD"
          ) as Currency;
          const kindRaw = String(s.kind || "").toLowerCase();
          const sub_kind: DraftSub["sub_kind"] =
            kindRaw === "installment" || kindRaw === "fixed"
              ? kindRaw
              : String(s.cycle || "").toLowerCase() === "installment"
                ? "installment"
                : "subscription";
          const cycle: DraftSub["cycle"] =
            String(s.cycle || "").toLowerCase() === "yearly"
              ? "yearly"
              : "monthly";
          const dayNum = Number(s.billing_day);
          const billing_day =
            Number.isFinite(dayNum) && dayNum >= 1 && dayNum <= 28
              ? String(Math.floor(dayNum))
              : s.start_date && /^\d{4}-\d{2}-\d{2}/.test(s.start_date)
                ? String(Number(s.start_date.slice(8, 10)) || 1)
                : "1";
          const hasPromo =
            s.promo_amount != null && Number(s.promo_amount) > 0;
          const regular =
            s.regular_amount != null
              ? Number(s.regular_amount)
              : hasPromo && s.amount != null
                ? Number(s.amount)
                : s.amount != null
                  ? Number(s.amount)
                  : 0;
          const charged = hasPromo
            ? Number(s.promo_amount)
            : s.amount != null
              ? Number(s.amount)
              : regular;
          const fixedMatch = FIXED_BILL_OPTIONS.find(
            (o) =>
              o.name === s.name ||
              (s.sub_category && o.sub_category === s.sub_category)
          );
          const category =
            s.category ||
            fixedMatch?.category ||
            (sub_kind === "fixed" ? "주거/통신" : "문화/취미");
          const sub_category =
            s.sub_category ||
            fixedMatch?.sub_category ||
            (sub_kind === "fixed" ? "관리비/공과금" : "정기 구독");
          return {
            ...emptyDraftSub(
              s.start_date && /^\d{4}-\d{2}-\d{2}/.test(s.start_date)
                ? s.start_date.slice(0, 10)
                : startDate,
              currency
            ),
            name: s.name || "",
            amount:
              Number.isFinite(charged) && charged > 0
                ? amountToInput(charged, currency)
                : "",
            regular_amount:
              Number.isFinite(regular) && regular > 0
                ? amountToInput(regular, currency)
                : "",
            billing_day,
            sub_kind,
            cycle: sub_kind === "installment" ? "monthly" : cycle,
            end_date:
              s.end_date && /^\d{4}-\d{2}-\d{2}/.test(s.end_date)
                ? s.end_date.slice(0, 10)
                : "",
            promo_enabled: hasPromo,
            promo_amount:
              hasPromo && Number.isFinite(Number(s.promo_amount))
                ? amountToInput(Number(s.promo_amount), currency)
                : "",
            promo_end_date:
              s.promo_end_date && /^\d{4}-\d{2}-\d{2}/.test(s.promo_end_date)
                ? s.promo_end_date.slice(0, 10)
                : "",
            category,
            sub_category,
            merchant: s.name || "",
          };
        }),
      ]);
      return;
    }

    const brokerage = result.data.brokerage;
    if (!brokerage) return;
    const defaultAccountId = investmentAccounts[0]?.id || "";
    let matchedId = defaultAccountId;
    if (brokerage.name && investmentAccounts.length) {
      const needle = brokerage.name.toLowerCase();
      const hit = investmentAccounts.find(
        (a) =>
          a.name.toLowerCase().includes(needle) ||
          (a.institution || "").toLowerCase().includes(needle) ||
          needle.includes(a.name.toLowerCase())
      );
      if (hit) matchedId = hit.id;
    }
    const holdingsParsed = brokerage.holdings || [];
    if (holdingsParsed.length) {
      setHoldings((prev) => [
        ...prev,
        ...holdingsParsed.map((h) => {
          const currency = (
            ["CAD", "KRW", "USD"].includes(String(h.currency || "").toUpperCase())
              ? String(h.currency).toUpperCase()
              : investmentAccounts.find((a) => a.id === matchedId)?.currency ||
                "CAD"
          ) as Currency;
          return {
            key: newKey(),
            ticker: h.ticker || "",
            name: h.name || "",
            shares: h.shares != null ? String(h.shares) : "",
            avg_price: h.avg_price != null ? String(h.avg_price) : "",
            currency,
            account_id: matchedId,
          };
        }),
      ]);
    }
  }

  const visibleAccounts = accounts.filter((a) => a.country === assetCountry);
  const expenseCategoryOptions = useMemo(() => {
    if (!presets) return [];
    return categoriesForType(presets, "expense").filter(
      (c) => c !== TRANSFER_CATEGORY
    );
  }, [presets]);
  const inputClass =
    "w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-transparent px-3 py-2 text-sm text-gray-900 dark:text-white";

  if (loading) {
    return (
      <main className="min-h-dvh flex items-center justify-center bg-gray-50 dark:bg-black">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-gray-50 dark:bg-black px-4 py-8">
      <div className="mx-auto w-full max-w-lg space-y-6">
        <header className="space-y-1">
          <p className="text-sm font-medium text-blue-500">{progressLabel}</p>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
            {t("title")}
          </h1>
          <p className="text-base text-gray-700 dark:text-gray-300">{t("subtitle")}</p>
        </header>

        {error && (
          <div className="rounded-2xl border border-red-200 dark:border-red-800/50 bg-red-50 dark:bg-red-950/30 p-4 text-sm text-red-700 dark:text-red-400">
            {error}
          </div>
        )}

        {step === 0 && (
          <form onSubmit={handleFinishBasics} className="space-y-5">
            <section className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-5 space-y-3">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                {t("languageTitle")}
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {t("languageHelp")}
              </p>
              <LanguagePicker
                selectedLocales={selectedLocales}
                onSelectedLocalesChange={(next) => {
                  setSelectedLocales(next);
                  writeStoredLocales(next);
                }}
              />
            </section>

            <section className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-5 space-y-3">
              <div className="flex items-center gap-2">
                <CalendarDays className="h-5 w-5 text-blue-500" />
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {t("startDateTitle")}
                </h2>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {t("startDateHelp")}
              </p>
              <OnboardingField label={t("startDateTitle")}>
                <input
                  type="date"
                  required
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className={inputClass}
                />
              </OnboardingField>
            </section>

            <section className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-5 space-y-3">
              <div className="flex items-center gap-2">
                <KeyRound className="h-5 w-5 text-blue-500" />
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {t("apiKeyTitle")}
                </h2>
              </div>
              <ol className="list-decimal list-inside space-y-1 text-sm text-gray-600 dark:text-gray-400">
                <li>{t("apiKeyStep1")}</li>
                <li>{t("apiKeyStep2")}</li>
                <li>{t("apiKeyStep3")}</li>
              </ol>
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm font-medium text-blue-500 hover:underline"
              >
                aistudio.google.com/apikey
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
              {settings?.has_gemini_key ? (
                <p className="text-sm text-green-600 dark:text-green-400 flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4" />
                  {t("apiKeySaved")}
                </p>
              ) : null}
              <OnboardingField label={t("apiKeyTitle")}>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={t("apiKeyPlaceholder")}
                  className={inputClass}
                />
              </OnboardingField>
            </section>

            <button
              type="submit"
              disabled={saving || selectedLocales.length === 0}
              className="w-full rounded-2xl bg-blue-500 hover:bg-blue-600 disabled:opacity-60 text-white font-semibold py-3.5"
            >
              {saving ? t("saving") : t("continue")}
            </button>
          </form>
        )}

        {step === 1 && (
          <section className="space-y-4">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-5 space-y-2">
              <div className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-blue-500" />
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {t("assetsTitle")}
                </h2>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400">{t("assetsHelp")}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{t("assetsSkipHelp")}</p>
            </div>

            <div className="flex rounded-xl bg-gray-100 dark:bg-gray-800 p-0.5">
              {(["CA", "KR"] as BankCountry[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setAssetCountry(c)}
                  className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                    assetCountry === c
                      ? "bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-white"
                      : "text-gray-500 dark:text-gray-400"
                  }`}
                >
                  {c === "CA" ? t("countryCanada") : t("countryKorea")}
                </button>
              ))}
            </div>

            <OnboardingScreenshotScan
              step="assets"
              hasApiKey={Boolean(settings?.has_gemini_key)}
              disabled={saving}
              onParsed={applyScreenshotResult}
            />

            {visibleAccounts.map((a) => (
              <div
                key={a.key}
                className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4 space-y-3"
              >
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() =>
                      setAccounts((prev) => prev.filter((x) => x.key !== a.key))
                    }
                    className="text-gray-400 hover:text-red-500"
                    aria-label={t("remove")}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <OnboardingField label={t("accountName")}>
                  <input
                    value={a.name}
                    onChange={(e) =>
                      setAccounts((prev) =>
                        prev.map((x) =>
                          x.key === a.key ? { ...x, name: e.target.value } : x
                        )
                      )
                    }
                    className={inputClass}
                  />
                </OnboardingField>
                <div className="grid grid-cols-2 gap-2">
                  <OnboardingField label={t("accountKind")}>
                    <select
                      value={a.kind}
                      onChange={(e) =>
                        setAccounts((prev) =>
                          prev.map((x) =>
                            x.key === a.key
                              ? {
                                  ...x,
                                  kind: e.target.value as FinancialAccountKind,
                                  institution:
                                    e.target.value === "cash" ? "" : x.institution,
                                }
                              : x
                          )
                        )
                      }
                      className={inputClass}
                    >
                      <option value="checking">{t("kindChecking")}</option>
                      <option value="savings">{t("kindSavings")}</option>
                      <option value="credit_card">{t("kindCard")}</option>
                      <option value="investment">{t("kindInvestment")}</option>
                      <option value="cash">{t("kindCash")}</option>
                    </select>
                  </OnboardingField>
                  <OnboardingField label={t("currency")}>
                    <select
                      value={a.currency}
                      onChange={(e) => {
                        const currency = e.target.value as Currency;
                        // Currency is independent of country tab (e.g. CAD at a KR bank).
                        setAccounts((prev) =>
                          prev.map((x) =>
                            x.key === a.key
                              ? {
                                  ...x,
                                  currency,
                                  opening_balance: x.opening_balance
                                    ? formatAmountInput(
                                        x.opening_balance,
                                        currency
                                      )
                                    : "",
                                }
                              : x
                          )
                        );
                      }}
                      className={inputClass}
                    >
                      <option value="CAD">CAD</option>
                      <option value="KRW">KRW</option>
                      {a.kind === "investment" && (
                        <option value="USD">USD</option>
                      )}
                    </select>
                  </OnboardingField>
                </div>
                {a.kind !== "cash" && (
                  <OnboardingField label={t("institution")}>
                    <BankPicker
                      value={a.institution}
                      onChange={(value) =>
                        setAccounts((prev) =>
                          prev.map((x) =>
                            x.key === a.key ? { ...x, institution: value } : x
                          )
                        )
                      }
                      country={assetCountry}
                      customInstitutions={customInstitutions}
                      onAddCustom={async (n) => {
                        const next = await addInstitution(n);
                        setCustomInstitutions(next);
                        return next;
                      }}
                      onRemoveCustom={async (n) => {
                        const next = await removeInstitution(n);
                        setCustomInstitutions(next);
                        return next;
                      }}
                      triggerClassName={`${inputClass} flex items-center justify-between text-left`}
                    />
                  </OnboardingField>
                )}
                {a.kind === "credit_card" && (
                  <OnboardingField label={t("lastFour")}>
                    <input
                      value={a.last_four}
                      onChange={(e) =>
                        setAccounts((prev) =>
                          prev.map((x) =>
                            x.key === a.key
                              ? {
                                  ...x,
                                  last_four: e.target.value
                                    .replace(/\D/g, "")
                                    .slice(0, 4),
                                }
                              : x
                          )
                        )
                      }
                      inputMode="numeric"
                      maxLength={4}
                      placeholder="1234"
                      className={inputClass}
                    />
                  </OnboardingField>
                )}
                {a.kind !== "cash" && a.kind !== "credit_card" && (
                  <OnboardingField label={t("accountNumber")}>
                    <input
                      value={a.account_number}
                      onChange={(e) =>
                        setAccounts((prev) =>
                          prev.map((x) =>
                            x.key === a.key
                              ? { ...x, account_number: e.target.value }
                              : x
                          )
                        )
                      }
                      onBlur={() =>
                        setAccounts((prev) =>
                          prev.map((x) =>
                            x.key === a.key
                              ? {
                                  ...x,
                                  account_number:
                                    maskAccountNumber(x.account_number) || "",
                                }
                              : x
                          )
                        )
                      }
                      placeholder={
                        a.country === "CA"
                          ? t("accountNumberPlaceholderCA")
                          : t("accountNumberPlaceholderKR")
                      }
                      className={inputClass}
                    />
                    <p className="text-[10px] text-gray-400 mt-1">
                      {t("accountNumberHint")}
                    </p>
                  </OnboardingField>
                )}
                <OnboardingField
                  label={
                    a.kind === "credit_card" ? t("cardBalance") : t("balance")
                  }
                >
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-sm text-gray-500 dark:text-gray-400">
                      {currencySymbol(a.currency)}
                    </span>
                    <input
                      value={a.opening_balance}
                      onChange={(e) =>
                        setAccounts((prev) =>
                          prev.map((x) =>
                            x.key === a.key
                              ? {
                                  ...x,
                                  opening_balance: formatAmountInput(
                                    e.target.value,
                                    a.currency
                                  ),
                                }
                              : x
                          )
                        )
                      }
                      inputMode="decimal"
                      className={`${inputClass} pl-7`}
                    />
                  </div>
                  {a.kind === "investment" && (
                    <p className="text-[10px] text-gray-400 mt-1">
                      {t("investmentBalanceHint")}
                    </p>
                  )}
                </OnboardingField>
                <div className="flex flex-wrap gap-3 text-xs text-gray-600 dark:text-gray-300">
                  {a.kind !== "credit_card" && a.kind !== "investment" && (
                    <label className="inline-flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={a.is_default_expense}
                        onChange={(e) =>
                          setAccounts((prev) =>
                            prev.map((x) => {
                              if (x.kind === "investment" || x.kind === "credit_card") {
                                return x;
                              }
                              return {
                                ...x,
                                is_default_expense:
                                  x.key === a.key
                                    ? e.target.checked
                                    : e.target.checked
                                      ? false
                                      : x.is_default_expense,
                              };
                            })
                          )
                        }
                      />
                      {t("defaultSpend")}
                    </label>
                  )}
                  {a.kind === "credit_card" && (
                    <label className="inline-flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={a.is_default_credit}
                        onChange={(e) =>
                          setAccounts((prev) =>
                            prev.map((x) => ({
                              ...x,
                              is_default_credit:
                                x.key === a.key
                                  ? e.target.checked
                                  : e.target.checked
                                    ? false
                                    : x.is_default_credit,
                            }))
                          )
                        }
                      />
                      {t("defaultCard")}
                    </label>
                  )}
                  {a.kind === "investment" && (
                    <label className="inline-flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={a.is_default_expense}
                        onChange={(e) =>
                          setAccounts((prev) =>
                            prev.map((x) => {
                              if (x.kind !== "investment") return x;
                              return {
                                ...x,
                                is_default_expense:
                                  x.key === a.key
                                    ? e.target.checked
                                    : e.target.checked
                                      ? false
                                      : x.is_default_expense,
                              };
                            })
                          )
                        }
                      />
                      {t("defaultBroker")}
                    </label>
                  )}
                </div>
              </div>
            ))}

            <button
              type="button"
              onClick={() =>
                setAccounts((prev) => [
                  ...prev,
                  {
                    key: newKey(),
                    name: "",
                    kind: "checking",
                    currency: currencyForCountry(assetCountry),
                    country: assetCountry,
                    opening_balance: "",
                    institution: "",
                    last_four: "",
                    account_number: "",
                    is_default_expense: false,
                    is_default_credit: false,
                  },
                ])
              }
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-gray-300 dark:border-gray-600 py-3 text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              <Plus className="h-4 w-4" />
              {t("addAccount")}
            </button>

            <div className="flex gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => saveAssetsAndContinue(true)}
                className="flex-1 rounded-2xl border border-gray-200 dark:border-gray-700 py-3.5 font-semibold text-gray-700 dark:text-gray-200 inline-flex items-center justify-center gap-1.5"
              >
                <SkipForward className="h-4 w-4" />
                {t("skip")}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => saveAssetsAndContinue(false)}
                className="flex-1 rounded-2xl bg-blue-500 hover:bg-blue-600 disabled:opacity-60 text-white font-semibold py-3.5"
              >
                {saving ? t("saving") : t("continue")}
              </button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="space-y-4">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-5 space-y-2">
              <div className="flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-blue-500" />
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {t("subsTitle")}
                </h2>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400">{t("subsHelp")}</p>
              <p className="text-xs text-blue-600 dark:text-blue-400">{t("subsChipHint")}</p>
            </div>

            <OnboardingScreenshotScan
              step="subscriptions"
              hasApiKey={Boolean(settings?.has_gemini_key)}
              disabled={saving}
              onParsed={applyScreenshotResult}
            />

            <div className="flex flex-wrap gap-2">
              {chips.top7.map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => addChipAsSub(chip)}
                  title={t("subsChipTooltip")}
                  className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 px-3 py-1.5 text-xs font-medium text-blue-700 dark:text-blue-300 whitespace-nowrap underline-offset-2 hover:underline"
                >
                  <ExternalLink className="h-3 w-3 shrink-0" />
                  {chip.name}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setShowMoreChips((v) => !v)}
                className="rounded-full bg-gray-100 dark:bg-gray-700 px-3 py-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200"
              >
                {showMoreChips ? t("less") : t("more")}
              </button>
            </div>
            {showMoreChips && (
              <div className="flex flex-wrap gap-2">
                {chips.more.map((chip) => (
                  <button
                    key={chip.id}
                    type="button"
                    onClick={() => addChipAsSub(chip)}
                    title={t("subsChipTooltip")}
                    className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 px-3 py-1.5 text-xs font-medium text-blue-700 dark:text-blue-300 whitespace-nowrap underline-offset-2 hover:underline"
                  >
                    <ExternalLink className="h-3 w-3 shrink-0" />
                    {chip.name}
                  </button>
                ))}
              </div>
            )}

            <div className="space-y-1.5">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t("fixedBillHint")}
              </p>
              <div className="flex flex-wrap gap-2">
                {FIXED_BILL_OPTIONS.map((opt) => (
                  <button
                    key={opt.name}
                    type="button"
                    onClick={() => addFixedBillOption(opt)}
                    className="rounded-full bg-gray-100 dark:bg-gray-700 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200"
                  >
                    {opt.name}
                  </button>
                ))}
              </div>
            </div>

            {subs.map((s) => (
              <div
                key={s.key}
                className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4 space-y-3"
              >
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setSubs((prev) => prev.filter((x) => x.key !== s.key))}
                    className="text-gray-400 hover:text-red-500"
                    aria-label={t("remove")}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <OnboardingField label={t("subName")}>
                  <input
                    value={s.name}
                    onChange={(e) =>
                      setSubs((prev) =>
                        prev.map((x) =>
                          x.key === s.key ? { ...x, name: e.target.value } : x
                        )
                      )
                    }
                    className={inputClass}
                  />
                </OnboardingField>
                <div className="grid grid-cols-2 gap-2">
                  <OnboardingField label={t("subKind")}>
                    <select
                      value={s.sub_kind}
                      onChange={(e) => {
                        const sub_kind = e.target.value as DraftSub["sub_kind"];
                        setSubs((prev) =>
                          prev.map((x) => {
                            if (x.key !== s.key) return x;
                            if (sub_kind === "fixed") {
                              return {
                                ...x,
                                sub_kind,
                                category: x.category || "주거/통신",
                                sub_category: x.sub_category || "월세/모기지",
                                merchant: x.merchant || x.name,
                              };
                            }
                            return {
                              ...x,
                              sub_kind,
                              category: "문화/취미",
                              sub_category: "정기 구독",
                            };
                          })
                        );
                      }}
                      className={inputClass}
                    >
                      <option value="subscription">{t("subKindSubscription")}</option>
                      <option value="installment">{t("subKindInstallment")}</option>
                      <option value="fixed">{t("subKindFixed")}</option>
                    </select>
                  </OnboardingField>
                  {s.sub_kind === "subscription" ? (
                    <OnboardingField label={t("subCycle")}>
                      <select
                        value={s.cycle}
                        onChange={(e) =>
                          setSubs((prev) =>
                            prev.map((x) =>
                              x.key === s.key
                                ? {
                                    ...x,
                                    cycle: e.target.value as DraftSub["cycle"],
                                  }
                                : x
                            )
                          )
                        }
                        className={inputClass}
                      >
                        <option value="monthly">{t("cycleMonthly")}</option>
                        <option value="yearly">{t("cycleYearly")}</option>
                      </select>
                    </OnboardingField>
                  ) : (
                    <OnboardingField label={t("billingDay")}>
                      <input
                        type="number"
                        min={1}
                        max={28}
                        value={s.billing_day}
                        onChange={(e) =>
                          setSubs((prev) =>
                            prev.map((x) =>
                              x.key === s.key
                                ? { ...x, billing_day: e.target.value }
                                : x
                            )
                          )
                        }
                        className={inputClass}
                      />
                    </OnboardingField>
                  )}
                </div>
                {s.sub_kind === "subscription" && (
                  <OnboardingField label={t("billingDay")}>
                    <input
                      type="number"
                      min={1}
                      max={28}
                      value={s.billing_day}
                      onChange={(e) =>
                        setSubs((prev) =>
                          prev.map((x) =>
                            x.key === s.key
                              ? { ...x, billing_day: e.target.value }
                              : x
                          )
                        )
                      }
                      className={inputClass}
                    />
                  </OnboardingField>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <OnboardingField label={t("subStartDate")}>
                    <input
                      type="date"
                      value={s.start_date}
                      onChange={(e) =>
                        setSubs((prev) =>
                          prev.map((x) =>
                            x.key === s.key
                              ? { ...x, start_date: e.target.value }
                              : x
                          )
                        )
                      }
                      className={inputClass}
                    />
                  </OnboardingField>
                  {(s.sub_kind === "subscription" ||
                    s.sub_kind === "installment") && (
                    <OnboardingField
                      label={
                        s.sub_kind === "installment"
                          ? t("subEndDate")
                          : t("subEndDateOptional")
                      }
                    >
                      <input
                        type="date"
                        value={s.end_date}
                        onChange={(e) =>
                          setSubs((prev) =>
                            prev.map((x) =>
                              x.key === s.key
                                ? { ...x, end_date: e.target.value }
                                : x
                            )
                          )
                        }
                        className={inputClass}
                      />
                    </OnboardingField>
                  )}
                </div>
                {s.sub_kind === "installment" && (
                  <OnboardingField label={t("totalInstallments")}>
                    <input
                      type="number"
                      min={1}
                      value={s.total_installments}
                      onChange={(e) =>
                        setSubs((prev) =>
                          prev.map((x) =>
                            x.key === s.key
                              ? { ...x, total_installments: e.target.value }
                              : x
                          )
                        )
                      }
                      className={inputClass}
                    />
                  </OnboardingField>
                )}
                {s.sub_kind === "fixed" && (
                  <>
                    <OnboardingField label={tTx("category")}>
                      <CategorySelect
                        categories={expenseCategoryOptions}
                        value={s.category}
                        onChange={(next) =>
                          setSubs((prev) =>
                            prev.map((x) =>
                              x.key === s.key
                                ? { ...x, category: next, sub_category: "" }
                                : x
                            )
                          )
                        }
                        onAdd={async (name) => {
                          const updated = await addCustomCategory(
                            "expense",
                            name
                          );
                          setPresets(updated);
                        }}
                      />
                    </OnboardingField>
                    <OnboardingField label={tTx("subCategory")}>
                      <SubCategorySelect
                        options={
                          presets && s.category
                            ? subCategoriesFor(presets, "expense", s.category)
                            : []
                        }
                        value={s.sub_category}
                        onChange={(next) =>
                          setSubs((prev) =>
                            prev.map((x) =>
                              x.key === s.key
                                ? { ...x, sub_category: next }
                                : x
                            )
                          )
                        }
                        onAdd={async (name) => {
                          if (!s.category) return;
                          const updated = await addCustomSubCategory(
                            "expense",
                            s.category,
                            name
                          );
                          setPresets(updated);
                        }}
                        disabled={!s.category}
                        placeholder={
                          s.category
                            ? tTx("selectSubCategory")
                            : tTx("selectSubCategoryFirst")
                        }
                      />
                    </OnboardingField>
                    <OnboardingField label={tTx("merchant")}>
                      <input
                        value={s.merchant}
                        onChange={(e) =>
                          setSubs((prev) =>
                            prev.map((x) =>
                              x.key === s.key
                                ? { ...x, merchant: e.target.value }
                                : x
                            )
                          )
                        }
                        className={inputClass}
                        placeholder={s.name || tTx("selectMerchant")}
                      />
                    </OnboardingField>
                  </>
                )}
                <OnboardingField label={t("regularAmount")}>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-sm text-gray-500">
                      {currencySymbol(s.currency)}
                    </span>
                    <input
                      value={s.regular_amount || s.amount}
                      onChange={(e) =>
                        setSubs((prev) =>
                          prev.map((x) =>
                            x.key === s.key
                              ? {
                                  ...x,
                                  regular_amount: formatAmountInput(
                                    e.target.value,
                                    s.currency
                                  ),
                                  amount: formatAmountInput(
                                    e.target.value,
                                    s.currency
                                  ),
                                }
                              : x
                          )
                        )
                      }
                      inputMode="decimal"
                      className={`${inputClass} pl-7`}
                    />
                  </div>
                </OnboardingField>
                <OnboardingField label={t("currency")}>
                  <select
                    value={s.currency}
                    onChange={(e) =>
                      setSubs((prev) =>
                        prev.map((x) =>
                          x.key === s.key
                            ? { ...x, currency: e.target.value as Currency }
                            : x
                        )
                      )
                    }
                    className={inputClass}
                  >
                    <option value="CAD">CAD</option>
                    <option value="KRW">KRW</option>
                  </select>
                </OnboardingField>
                {s.sub_kind === "subscription" && (
                  <>
                    <label className="inline-flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                      <input
                        type="checkbox"
                        checked={s.promo_enabled}
                        onChange={(e) =>
                          setSubs((prev) =>
                            prev.map((x) =>
                              x.key === s.key
                                ? { ...x, promo_enabled: e.target.checked }
                                : x
                            )
                          )
                        }
                      />
                      {t("promoEnabled")}
                    </label>
                    {s.promo_enabled && (
                      <div className="grid grid-cols-2 gap-2">
                        <OnboardingField label={t("promoAmount")}>
                          <div className="relative">
                            <span className="absolute left-3 top-2.5 text-sm text-gray-500">
                              {currencySymbol(s.currency)}
                            </span>
                            <input
                              value={s.promo_amount}
                              onChange={(e) =>
                                setSubs((prev) =>
                                  prev.map((x) =>
                                    x.key === s.key
                                      ? {
                                          ...x,
                                          promo_amount: formatAmountInput(
                                            e.target.value,
                                            s.currency
                                          ),
                                        }
                                      : x
                                  )
                                )
                              }
                              inputMode="decimal"
                              className={`${inputClass} pl-7`}
                            />
                          </div>
                        </OnboardingField>
                        <OnboardingField label={t("promoEndDate")}>
                          <input
                            type="date"
                            value={s.promo_end_date}
                            onChange={(e) =>
                              setSubs((prev) =>
                                prev.map((x) =>
                                  x.key === s.key
                                    ? { ...x, promo_end_date: e.target.value }
                                    : x
                                )
                              )
                            }
                            className={inputClass}
                          />
                        </OnboardingField>
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}

            <button
              type="button"
              onClick={addManualSub}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-gray-300 dark:border-gray-600 py-3 text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              <Plus className="h-4 w-4" />
              {t("addSub")}
            </button>

            <div className="flex gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => saveSubsAndContinue(true)}
                className="flex-1 rounded-2xl border border-gray-200 dark:border-gray-700 py-3.5 font-semibold text-gray-700 dark:text-gray-200 inline-flex items-center justify-center gap-1.5"
              >
                <SkipForward className="h-4 w-4" />
                {t("skip")}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => saveSubsAndContinue(false)}
                className="flex-1 rounded-2xl bg-blue-500 hover:bg-blue-600 disabled:opacity-60 text-white font-semibold py-3.5"
              >
                {saving ? t("saving") : t("continue")}
              </button>
            </div>
          </section>
        )}

        {step === 3 && (
          <section className="space-y-4">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-5 space-y-2">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-blue-500" />
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {t("brokerTitle")}
                </h2>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400">{t("brokerHelp")}</p>
            </div>

            <OnboardingScreenshotScan
              step="brokerage"
              hasApiKey={Boolean(settings?.has_gemini_key)}
              disabled={saving}
              onParsed={applyScreenshotResult}
            />

            {investmentAccounts.length === 0 ? (
              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4 space-y-3">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {t("noBrokerAccounts")}
                </p>
                <button
                  type="button"
                  onClick={() => setShowBrokerRegister(true)}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-gray-300 dark:border-gray-600 py-3 text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  <Plus className="h-4 w-4" />
                  {t("addBrokerInline")}
                </button>
              </div>
            ) : (
              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4 space-y-2">
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  {t("brokerAccountSelect")}
                </p>
                <ul className="space-y-1.5">
                  {investmentAccounts.map((acc) => (
                    <li
                      key={acc.id}
                      className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200"
                    >
                      <PiggyBank className="h-4 w-4 text-blue-500 shrink-0" />
                      <span className="truncate">
                        {acc.institution ? `[${acc.institution}] ` : ""}
                        {acc.nickname || acc.name} ({acc.currency})
                      </span>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => setShowBrokerRegister(true)}
                  className="text-xs font-semibold text-blue-600 dark:text-blue-400"
                >
                  + {t("addBrokerInline")}
                </button>
              </div>
            )}

            {holdings.map((h) => (
              <div
                key={h.key}
                className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4 space-y-3"
              >
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() =>
                      setHoldings((prev) => prev.filter((x) => x.key !== h.key))
                    }
                    className="text-gray-400 hover:text-red-500"
                    aria-label={t("remove")}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <OnboardingField label={t("brokerAccountPick")}>
                  <select
                    value={h.account_id}
                    onChange={(e) =>
                      setHoldings((prev) =>
                        prev.map((x) =>
                          x.key === h.key
                            ? { ...x, account_id: e.target.value }
                            : x
                        )
                      )
                    }
                    className={inputClass}
                  >
                    <option value="">{t("brokerAccountPick")}</option>
                    {investmentAccounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.institution ? `[${acc.institution}] ` : ""}
                        {acc.nickname || acc.name} ({acc.currency})
                      </option>
                    ))}
                  </select>
                </OnboardingField>
                <div className="grid grid-cols-2 gap-2">
                  <OnboardingField label={t("ticker")}>
                    <input
                      value={h.ticker}
                      onChange={(e) =>
                        setHoldings((prev) =>
                          prev.map((x) =>
                            x.key === h.key ? { ...x, ticker: e.target.value } : x
                          )
                        )
                      }
                      className={inputClass}
                    />
                  </OnboardingField>
                  <OnboardingField label={t("shares")}>
                    <input
                      value={h.shares}
                      onChange={(e) =>
                        setHoldings((prev) =>
                          prev.map((x) =>
                            x.key === h.key ? { ...x, shares: e.target.value } : x
                          )
                        )
                      }
                      inputMode="decimal"
                      className={inputClass}
                    />
                  </OnboardingField>
                </div>
                <OnboardingField label={t("stockName")}>
                  <input
                    value={h.name}
                    onChange={(e) =>
                      setHoldings((prev) =>
                        prev.map((x) =>
                          x.key === h.key ? { ...x, name: e.target.value } : x
                        )
                      )
                    }
                    className={inputClass}
                  />
                </OnboardingField>
                <OnboardingField label={t("avgPrice")}>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-sm text-gray-500">
                      {currencySymbol(h.currency)}
                    </span>
                    <input
                      value={h.avg_price}
                      onChange={(e) =>
                        setHoldings((prev) =>
                          prev.map((x) =>
                            x.key === h.key
                              ? { ...x, avg_price: e.target.value }
                              : x
                          )
                        )
                      }
                      inputMode="decimal"
                      className={`${inputClass} pl-7`}
                    />
                  </div>
                </OnboardingField>
              </div>
            ))}

            <button
              type="button"
              onClick={() =>
                setHoldings((prev) => [
                  ...prev,
                  {
                    key: newKey(),
                    ticker: "",
                    name: "",
                    shares: "",
                    avg_price: "",
                    currency:
                      investmentAccounts[0]?.currency === "USD"
                        ? "USD"
                        : investmentAccounts[0]?.currency === "KRW"
                          ? "KRW"
                          : "CAD",
                    account_id: investmentAccounts[0]?.id || "",
                  },
                ])
              }
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-gray-300 dark:border-gray-600 py-3 text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              <Plus className="h-4 w-4" />
              {t("addHolding")}
            </button>

            <div className="flex gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => saveBrokerAndFinish(true)}
                className="flex-1 rounded-2xl border border-gray-200 dark:border-gray-700 py-3.5 font-semibold text-gray-700 dark:text-gray-200 inline-flex items-center justify-center gap-1.5"
              >
                <SkipForward className="h-4 w-4" />
                {t("skipFinish")}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => saveBrokerAndFinish(false)}
                className="flex-1 rounded-2xl bg-blue-500 hover:bg-blue-600 disabled:opacity-60 text-white font-semibold py-3.5"
              >
                {saving ? t("saving") : t("finish")}
              </button>
            </div>

            {showBrokerRegister && (
              <AccountRegisterModal
                currency={assetCountry === "KR" ? "KRW" : "CAD"}
                accountType="personal"
                preferredType="income"
                initialKind="investment"
                onClose={() => setShowBrokerRegister(false)}
                onCreated={async (acc) => {
                  setShowBrokerRegister(false);
                  await refreshInvestmentAccounts();
                  if (acc.kind === "investment") {
                    setHoldings((prev) =>
                      prev.map((h) =>
                        h.account_id ? h : { ...h, account_id: acc.id }
                      )
                    );
                  }
                }}
              />
            )}
          </section>
        )}
      </div>
    </main>
  );
}
