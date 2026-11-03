"use client";

import { useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ExternalLink, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";

const AI_STUDIO_KEYS_URL = "https://aistudio.google.com/apikey";
const GEMINI_TERMS_URL = "https://ai.google.dev/gemini-api/terms";

// Screenshots of Google AI Studio (English UI), one per step, in public/gemini-guide.
const CARD_KEYS = ["card1", "card2", "card3", "card4", "card5", "card6", "card7"] as const;

/** Swipeable screenshot cards that walk through creating a key in AI Studio. */
function StepCards() {
  const t = useTranslations("geminiGuide");
  const [index, setIndex] = useState(0);
  const touchX = useRef<number | null>(null);
  const total = CARD_KEYS.length;
  const go = (step: number) => setIndex((i) => Math.min(total - 1, Math.max(0, i + step)));

  return (
    <div className="space-y-3">
      {index === 0 && (
        <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
          {t("stepsIntro")}
        </p>
      )}
      <a
        href={AI_STUDIO_KEYS_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-blue-500 hover:bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white"
      >
        {t("openStudio")}
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
      <div
        className="space-y-2"
        onTouchStart={(e) => {
          touchX.current = e.touches[0].clientX;
        }}
        onTouchEnd={(e) => {
          if (touchX.current === null) return;
          const dx = e.changedTouches[0].clientX - touchX.current;
          touchX.current = null;
          if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
        }}
      >
        <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/gemini-guide/step${index + 1}.webp`}
            alt={t("cardAlt", { current: index + 1 })}
            className="mx-auto block max-h-80 w-auto max-w-full object-contain"
          />
        </div>
        <p className="min-h-[2.5rem] text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
          <span className="mr-1.5 font-semibold text-blue-600 dark:text-blue-400 tabular-nums">
            {index + 1}.
          </span>
          {t(CARD_KEYS[index])}
        </p>
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => go(-1)}
            disabled={index === 0}
            className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
            {t("prev")}
          </button>
          <span className="whitespace-nowrap text-xs tabular-nums text-gray-500 dark:text-gray-400">
            {t("counter", { current: index + 1, total })}
          </span>
          <button
            type="button"
            onClick={() => go(1)}
            disabled={index === total - 1}
            className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40"
          >
            {t("next")}
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{t("screensNote")}</p>
      </div>
    </div>
  );
}

/**
 * Shared Gemini API key guide for onboarding and Settings: a folded notice on
 * what is sent to Google and what works without a key, and how to create one.
 */
export default function GeminiKeyGuide({ stepsOpen = false }: { stepsOpen?: boolean }) {
  const t = useTranslations("geminiGuide");

  return (
    <div className="space-y-2 break-keep">
      <details className="group rounded-xl bg-blue-50 dark:bg-blue-500/10">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-blue-700 dark:text-blue-300">
          <ShieldCheck className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">{t("noticeSummary")}</span>
          <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
        </summary>
        <div className="space-y-1.5 px-4 pb-3">
          <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
            {t("dataTiers")}
          </p>
          <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
            {t("optional")}
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
      </details>

      <details open={stepsOpen} className="group rounded-xl border border-gray-100 dark:border-gray-700">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-2.5">
          <span className="whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
            {t("stepsTitle")}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-gray-400 transition-transform group-open:rotate-180" />
        </summary>
        <div className="space-y-3 px-4 pb-4">
          <StepCards />
          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
            {t("freeTier")}
          </p>
        </div>
      </details>
    </div>
  );
}
