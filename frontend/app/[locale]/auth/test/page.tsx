import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";

import TestLoginPanel from "@/components/TestLoginPanel";

// Not linked from anywhere and kept out of search results. Open it by address.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type Props = { params: Promise<{ locale: string }> };

export default async function TestLoginPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <main className="min-h-dvh bg-gray-50 dark:bg-black">
      <div className="mx-auto max-w-md px-5 py-8">
        <TestLoginPanel />
      </div>
    </main>
  );
}
