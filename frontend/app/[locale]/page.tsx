"use client";

import { useEffect, useState } from "react";

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
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const u = await fetchCurrentUser();
        setUser(u);
        if (u) {
          const settings = await fetchUserSettings().catch(() => null);
          if (settings && !settings.onboarding_personal_completed) {
            // Default wizard copy to English until the user picks a language.
            router.replace("/onboarding", {
              locale: asAppLocale(settings.preferred_locale),
            });
            return;
          }
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

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
