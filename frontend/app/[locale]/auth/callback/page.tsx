"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, useEffect, useState } from "react";

import { useRouter } from "@/i18n/navigation";
import { setToken } from "@/lib/api";

function CallbackHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations("auth");
  const [message, setMessage] = useState(t("processing"));

  useEffect(() => {
    const token = searchParams.get("token");
    const error = searchParams.get("error");

    if (error) {
      setMessage(t("failed"));
      const timer = setTimeout(() => router.replace("/"), 2000);
      return () => clearTimeout(timer);
    }

    if (token) {
      setToken(token);
      router.replace("/");
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
