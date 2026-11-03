"use client";

import { ChevronDown, ExternalLink, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";

const AI_STUDIO_KEYS_URL = "https://aistudio.google.com/apikey";
const GEMINI_TERMS_URL = "https://ai.google.dev/gemini-api/terms";

const STEP_KEYS = ["step1", "step2", "step3", "step4", "step5"] as const;

/**
 * Shared Gemini API key guide for onboarding and Settings: what is sent to
 * Google, what works without a key, and how to create one.
 */
export default function GeminiKeyGuide({ stepsOpen = false }: { stepsOpen?: boolean }) {
  const t = useTranslations("geminiGuide");

  return (
    <div className="space-y-3 break-keep">
      <div className="rounded-xl bg-blue-50 dark:bg-blue-500/10 px-4 py-3 space-y-1.5">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-blue-700 dark:text-blue-300">
          <ShieldCheck className="h-4 w-4 shrink-0" />
          {t("dataTitle")}
        </p>
        <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
          {t("dataSent")}
        </p>
        <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
          {t("dataTiers")}
        </p>
        <a
          href={GEMINI_TERMS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
        >
          {t("termsLink")}
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
        {t("optional")}
      </p>

      <details open={stepsOpen} className="group rounded-xl border border-gray-100 dark:border-gray-700">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-2.5">
          <span className="whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
            {t("stepsTitle")}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-gray-400 transition-transform group-open:rotate-180" />
        </summary>
        <div className="space-y-3 px-4 pb-4">
          <ol className="list-decimal space-y-2 pl-5 text-sm text-gray-600 dark:text-gray-400 marker:text-gray-400">
            {STEP_KEYS.map((key) => (
              <li key={key} className="pl-1 leading-relaxed">
                {t(key)}
              </li>
            ))}
          </ol>
          <a
            href={AI_STUDIO_KEYS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-blue-500 hover:bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white"
          >
            {t("openStudio")}
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
            {t("freeTier")}
          </p>
        </div>
      </details>
    </div>
  );
}
