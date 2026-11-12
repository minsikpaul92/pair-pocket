"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { acceptTerms, signOut } from "@/lib/api";
import { translateError } from "@/lib/errors";

interface Props {
  onAccepted: () => void;
  onSignedOut: () => void;
}

/** Shown after sign-in until the user agrees to the current terms. */
export default function TermsConsent({ onAccepted, onSignedOut }: Props) {
  const t = useTranslations("auth.consent");
  const tErrors = useTranslations("errors");
  const [agreed, setAgreed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await acceptTerms();
      onAccepted();
    } catch (err) {
      setError(translateError(err, tErrors));
      setSaving(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-gray-50 px-5 dark:bg-black">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm dark:bg-gray-900">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
          {t("title")}
        </h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{t("body")}</p>
        <label className="mt-5 flex items-start gap-3 text-sm text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0"
          />
          <span>
            {t.rich("label", {
              terms: (chunks) => (
                <Link href="/terms" target="_blank" className="underline">
                  {chunks}
                </Link>
              ),
              privacy: (chunks) => (
                <Link href="/privacy" target="_blank" className="underline">
                  {chunks}
                </Link>
              ),
            })}
          </span>
        </label>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => void signOut().finally(onSignedOut)}
            className="whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {t("signOut")}
          </button>
          <button
            type="button"
            disabled={!agreed || saving}
            onClick={() => void submit()}
            className="whitespace-nowrap rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
          >
            {t("continue")}
          </button>
        </div>
      </div>
    </main>
  );
}
