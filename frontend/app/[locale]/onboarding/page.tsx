"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import Link from "next/link";

import OnboardingWizard from "@/components/OnboardingWizard";
import { TEST_LOGIN_FLAG } from "@/components/TestLoginPanel";
import { useRouter } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/locales";
import { fetchCurrentUser, fetchUserSettings } from "@/lib/api";

const ONBOARDING_LOCALES_KEY = "pairpocket_onboarding_locales";

function readSessionLocales(): AppLocale[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(ONBOARDING_LOCALES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || !parsed.length) return [];
    return parsed.filter((x): x is AppLocale => typeof x === "string");
  } catch {
    return [];
  }
}

/** After a test sign-in: a way back to the test page, which has no other exit. */
function TestPageLink() {
  const t = useTranslations("auth.testLogin");
  const locale = useLocale();
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      setShow(window.localStorage.getItem(TEST_LOGIN_FLAG) === "1");
    } catch {
      /* storage unavailable */
    }
  }, []);
  if (!show) return null;
  return (
    <Link
      href={`/${locale}/auth/test`}
      className="fixed right-4 top-[max(env(safe-area-inset-top),1rem)] z-50 whitespace-nowrap rounded-full bg-gray-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-gray-900"
    >
      {t("backToTest")}
    </Link>
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const locale = useLocale() as AppLocale;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      // Home shows the retry screen when the server is unreachable.
      const user = await fetchCurrentUser().catch(() => null);
      if (!user) {
        router.replace("/");
        return;
      }
      const settings = await fetchUserSettings().catch(() => null);
      if (settings?.onboarding_personal_completed) {
        router.replace("/");
        return;
      }

      // In-progress LanguagePicker picks (session) beat a previously saved
      // preferred_locale — otherwise EN from an earlier Continue snaps the UI
      // back when the user re-picks Korean as Primary on step 0.
      const sessionLocales = readSessionLocales();
      const sessionPrimary = sessionLocales[0] ?? null;
      if (sessionPrimary && sessionPrimary !== locale) {
        router.replace("/onboarding", { locale: sessionPrimary });
        return;
      }

      const preferred =
        settings?.preferred_locales?.[0] || settings?.preferred_locale || null;
      if (!sessionPrimary && preferred && preferred !== locale) {
        router.replace("/onboarding", { locale: preferred as AppLocale });
        return;
      }

      // First visit with no pick yet → default UI to English.
      if (!sessionPrimary && !preferred && locale !== "en") {
        router.replace("/onboarding", { locale: "en" });
        return;
      }

      setReady(true);
    })();
  }, [router, locale]);

  if (!ready) {
    return (
      <main className="min-h-dvh flex items-center justify-center bg-gray-50 dark:bg-black">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-blue-500" />
      </main>
    );
  }

  return (
    <>
      <TestPageLink />
      <OnboardingWizard />
    </>
  );
}
