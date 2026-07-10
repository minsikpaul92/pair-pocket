"use client";

import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { useRouter } from "@/i18n/navigation";
import {
  acceptInvitation,
  fetchCurrentUser,
  getToken,
  loginUrl,
} from "@/lib/api";
import { translateError } from "@/lib/errors";

const PENDING_INVITE_KEY = "pairpocket_pending_invite";

export default function InviteAcceptPage() {
  const t = useTranslations("invite");
  const tErrors = useTranslations("errors");
  const tAuth = useTranslations("auth");
  const router = useRouter();
  const params = useParams();
  const token = typeof params.token === "string" ? params.token : "";

  const [message, setMessage] = useState(t("accepting"));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError(t("invalidToken"));
      return;
    }

    let cancelled = false;

    async function run() {
      const authToken = getToken();
      if (!authToken) {
        sessionStorage.setItem(PENDING_INVITE_KEY, token);
        window.location.href = loginUrl;
        return;
      }

      const user = await fetchCurrentUser();
      if (!user) {
        sessionStorage.setItem(PENDING_INVITE_KEY, token);
        window.location.href = loginUrl;
        return;
      }

      try {
        await acceptInvitation(token);
        sessionStorage.removeItem(PENDING_INVITE_KEY);
        if (!cancelled) {
          setMessage(t("acceptSuccess"));
          setTimeout(() => router.replace("/"), 1500);
        }
      } catch (err) {
        if (!cancelled) {
          setError(translateError(err, tErrors, "acceptInvitation"));
          setMessage("");
        }
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [token, router, t, tErrors]);

  return (
    <main className="min-h-dvh flex items-center justify-center bg-gray-50 dark:bg-black px-4">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 shadow-sm p-6 text-center space-y-3">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
          {t("acceptTitle")}
        </h1>
        {message && (
          <p className="text-base text-gray-700 dark:text-gray-300">{message}</p>
        )}
        {error && (
          <div className="space-y-3">
            <p className="text-sm text-red-500 whitespace-pre-wrap">{error}</p>
            <button
              type="button"
              onClick={() => router.replace("/")}
              className="bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-xl px-4 py-3 transition-colors"
            >
              {tAuth("tagline")}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
