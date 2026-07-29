"use client";

import { useEffect, useState } from "react";
import { useLocale } from "next-intl";

import OnboardingWizard from "@/components/OnboardingWizard";
import { useRouter } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/locales";
import { fetchCurrentUser, fetchUserSettings } from "@/lib/api";

export default function OnboardingPage() {
  const router = useRouter();
  const locale = useLocale() as AppLocale;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const user = await fetchCurrentUser();
      if (!user) {
        router.replace("/");
        return;
      }
      const settings = await fetchUserSettings().catch(() => null);
      if (settings?.onboarding_personal_completed) {
        router.replace("/");
        return;
      }

      // Only sync a *saved* preferred locale. Do not force English here —
      // that fought LanguagePicker and snapped the UI back to EN.
      const preferred = settings?.preferred_locale;
      if (preferred && preferred !== locale) {
        router.replace("/onboarding", { locale: preferred as AppLocale });
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

  return <OnboardingWizard />;
}
