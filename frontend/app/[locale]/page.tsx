"use client";

import { useEffect, useState } from "react";

import { useLocale } from "next-intl";

import AppShell from "@/components/AppShell";
import LoginLanding from "@/components/LoginLanding";
import { useRouter } from "@/i18n/navigation";
import { locales, type AppLocale } from "@/i18n/locales";
import {
  CurrentUser,
  fetchCurrentUser,
  fetchUserSettings,
} from "@/lib/api";

function asAppLocale(value: string | null | undefined): AppLocale {
  if (value && (locales as readonly string[]).includes(value)) {
    return value as AppLocale;
  }
  return "en";
}

export default function Home() {
  const router = useRouter();
  const currentLocale = useLocale() as AppLocale;
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const u = await fetchCurrentUser();
        setUser(u);
        const storedLocal =
          typeof window !== "undefined"
            ? localStorage.getItem("pairpocket_user_locale")
            : null;

        if (u) {
          const settings = await fetchUserSettings().catch(() => null);
          if (settings && !settings.onboarding_personal_completed) {
            const targetLocale = asAppLocale(
              settings.preferred_locales?.[0] ||
                settings.preferred_locale ||
                storedLocal
            );
            router.replace("/onboarding", { locale: targetLocale });
            return;
          }
          if (settings && (settings.preferred_locale || settings.preferred_locales?.length)) {
            const prefLocale = asAppLocale(
              settings.preferred_locales?.[0] || settings.preferred_locale
            );
            if (typeof window !== "undefined") {
              localStorage.setItem("pairpocket_user_locale", prefLocale);
            }
            if (prefLocale !== currentLocale) {
              router.replace("/", { locale: prefLocale });
              return;
            }
          } else if (
            storedLocal &&
            (locales as readonly string[]).includes(storedLocal) &&
            storedLocal !== currentLocale
          ) {
            router.replace("/", { locale: storedLocal as AppLocale });
            return;
          }
        } else {
          if (
            storedLocal &&
            (locales as readonly string[]).includes(storedLocal) &&
            storedLocal !== currentLocale
          ) {
            router.replace("/", { locale: storedLocal as AppLocale });
            return;
          }
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [router, currentLocale]);

  if (loading) {
    return (
      <main className="min-h-dvh flex items-center justify-center bg-gray-50 dark:bg-black">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-blue-500" />
      </main>
    );
  }

  if (!user) {
    return <LoginLanding />;
  }

  return <AppShell user={user} onLogout={() => setUser(null)} />;
}
