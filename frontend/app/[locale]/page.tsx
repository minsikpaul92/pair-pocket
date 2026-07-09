"use client";

import { useEffect, useState } from "react";

import AppShell from "@/components/AppShell";
import LoginLanding from "@/components/LoginLanding";
import { CurrentUser, fetchCurrentUser } from "@/lib/api";

export default function Home() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCurrentUser()
      .then(setUser)
      .finally(() => setLoading(false));
  }, []);

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
