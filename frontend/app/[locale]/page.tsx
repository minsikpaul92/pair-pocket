"use client";

import { useEffect, useState } from "react";

import { useLocale, useTranslations } from "next-intl";

import AppShell from "@/components/AppShell";
import LoginLanding from "@/components/LoginLanding";
import { useRouter } from "@/i18n/navigation";
import { locales, type AppLocale } from "@/i18n/locales";
import {
  CurrentUser,
  SESSION_EXPIRED_EVENT,
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
  const t = useTranslations("auth");
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  // Server unreachable: offer a retry rather than the sign-in screen.
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const onExpired = () => setUser(null);
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        setLoadFailed(false);
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
      } catch {
        setLoadFailed(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [router, currentLocale, attempt]);

  if (loading) {
    return (
      <main className="min-h-dvh flex items-center justify-center bg-gray-50 dark:bg-black">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-blue-500" />
      </main>
    );
  }

  if (loadFailed) {
    return (
      <main className="min-h-dvh flex flex-col items-center justify-center gap-4 bg-gray-50 px-6 text-center dark:bg-black">
        <p className="max-w-sm text-base text-gray-700 dark:text-gray-300">
          {t("loadFailed")}
        </p>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            setAttempt((n) => n + 1);
          }}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          {t("retry")}
        </button>
      </main>
    );
  }

  if (!user) {
    return <LoginLanding />;
  }

  return <AppShell user={user} onLogout={() => setUser(null)} />;
}
