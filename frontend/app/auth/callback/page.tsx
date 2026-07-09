"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { setToken } from "@/lib/api";

function CallbackHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [message, setMessage] = useState("로그인 처리 중...");

  useEffect(() => {
    const token = searchParams.get("token");
    const error = searchParams.get("error");

    if (error) {
      setMessage("로그인에 실패했습니다. 다시 시도해 주세요.");
      const timer = setTimeout(() => router.replace("/"), 2000);
      return () => clearTimeout(timer);
    }

    if (token) {
      setToken(token);
      router.replace("/");
      return;
    }

    setMessage("잘못된 접근입니다.");
    const timer = setTimeout(() => router.replace("/"), 2000);
    return () => clearTimeout(timer);
  }, [router, searchParams]);

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
