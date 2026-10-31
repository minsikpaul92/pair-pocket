"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, useEffect, useState } from "react";

import { useRouter } from "@/i18n/navigation";
import { completeSignIn, setToken } from "@/lib/api";

// The code is single-use; re-running the effect (Strict Mode) must not spend it twice.
const redemptions = new Map<string, Promise<boolean>>();

function redeemOnce(code: string): Promise<boolean> {
  let redemption = redemptions.get(code);
  if (!redemption) {
    redemption = completeSignIn(code).catch(() => false);
    redemptions.set(code, redemption);
  }
  return redemption;
}

function CallbackHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations("auth");
  const [message, setMessage] = useState(t("processing"));

  useEffect(() => {
    const code = searchParams.get("code");
    // Legacy: an API deployed before renewable sessions sends the token itself.
    const token = searchParams.get("token");
    const error = searchParams.get("error");

    function continueIntoApp() {
      const pendingInvite =
        typeof window !== "undefined"
          ? window.sessionStorage.getItem("pairpocket_pending_invite")
          : null;
      router.replace(pendingInvite ? `/invite/${pendingInvite}` : "/");
    }

    if (error) {
      setMessage(
        error === "oauth_not_configured" ? t("oauthNotConfigured") : t("failed")
      );
      const timer = setTimeout(() => router.replace("/"), 2500);
      return () => clearTimeout(timer);
    }

    if (code) {
      let cancelled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      redeemOnce(code).then((ok) => {
        if (cancelled) return;
        if (ok) {
          continueIntoApp();
          return;
        }
        setMessage(t("failed"));
        timer = setTimeout(() => router.replace("/"), 2500);
      });
      return () => {
        cancelled = true;
        clearTimeout(timer);
      };
    }

    if (token) {
      setToken(token);
      continueIntoApp();
      return;
    }

    setMessage(t("invalidAccess"));
    const timer = setTimeout(() => router.replace("/"), 2000);
    return () => clearTimeout(timer);
  }, [router, searchParams, t]);

  return (
    <p className="text-base text-gray-700 dark:text-gray-300">{message}</p>
  );
}

export default function AuthCallbackPage() {
  return (
    <main className="min-h-dvh flex items-center justify-center bg-gray-50 dark:bg-black">
      <Suspense fallback={null}>
        <CallbackHandler />
      </Suspense>
    </main>
  );
}
