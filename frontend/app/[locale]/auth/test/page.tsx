import { Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";

import LocaleToggle from "@/components/LocaleToggle";
import TestLoginPanel from "@/components/TestLoginPanel";

// Not linked from anywhere and kept out of search results. Open it by address.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type Props = { params: Promise<{ locale: string }> };

export default async function TestLoginPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const tCommon = await getTranslations("common");

  return (
    <main className="min-h-dvh bg-white dark:bg-black">
      <div className="mx-auto max-w-md px-5 pb-16 pt-[max(env(safe-area-inset-top),1.5rem)]">
        <header className="flex items-center gap-2 pb-12">
          <Link href={`/${locale}`} className="flex items-center gap-2">
            <Wallet className="h-6 w-6 text-blue-500" />
            <span className="text-lg font-semibold tracking-tight text-gray-900 dark:text-white">
              {tCommon("appName")}
            </span>
          </Link>
          <div className="ml-auto">
            <LocaleToggle forceVisible />
          </div>
        </header>
        <TestLoginPanel />
      </div>
    </main>
  );
}
