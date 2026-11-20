"use client";

import { useId, type CSSProperties, type Ref } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * "float": next to the target (640px and wider). "sheet-bottom": docked to the
 * bottom edge. "sheet-lifted": the same sheet raised above a low target; the
 * overlay sets its `bottom`.
 */
export type TourCardLayout = "float" | "sheet-bottom" | "sheet-lifted";

interface Props {
  title: string;
  body: string;
  stepIndex: number;
  total: number;
  /** The target was not found: offer "Skip this step" instead of Next. */
  missing: boolean;
  showNext: boolean;
  layout: TourCardLayout;
  style?: CSSProperties;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
  onExit: () => void;
  ref?: Ref<HTMLDivElement>;
}

const BUTTON =
  "inline-flex min-h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-xl px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500";
const QUIET =
  "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800";
const PRIMARY = "bg-blue-500 text-white hover:bg-blue-600 active:bg-blue-700";

/** The note shown next to the highlighted control. */
export default function TourCard({
  title,
  body,
  stepIndex,
  total,
  missing,
  showNext,
  layout,
  style,
  onNext,
  onBack,
  onSkip,
  onExit,
  ref,
}: Props) {
  const t = useTranslations("tutorial.common");
  const titleId = useId();
  const bodyId = useId();
  const isLast = stepIndex === total - 1;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      tabIndex={-1}
      style={style}
      className={cn(
        "pointer-events-auto fixed border border-gray-200 bg-white text-left shadow-2xl outline-none dark:border-gray-700 dark:bg-gray-900",
        layout === "float" && "w-[340px] max-w-[calc(100vw-24px)] rounded-2xl p-4",
        layout === "sheet-bottom" &&
          "inset-x-0 bottom-0 rounded-t-2xl px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]",
        layout === "sheet-lifted" && "inset-x-2 rounded-2xl px-4 pt-3 pb-4"
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 pt-1" aria-live="polite" aria-atomic="true">
          <p className="text-xs font-medium tabular-nums text-blue-600 dark:text-blue-400">
            {t("stepOf", { current: stepIndex + 1, total })}
          </p>
          <h2
            id={titleId}
            className="mt-1 text-base font-bold text-gray-900 dark:text-white"
          >
            {title}
          </h2>
          <p id={bodyId} className="mt-1 text-sm leading-relaxed text-gray-600 dark:text-gray-300">
            {body}
          </p>
          {missing && (
            <p className="mt-2 text-sm leading-relaxed text-amber-700 dark:text-amber-300">
              {t("notFound")}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onExit}
          aria-label={t("exit")}
          title={t("exit")}
          className="-mr-2 -mt-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {stepIndex > 0 && (
          <button type="button" onClick={onBack} className={cn(BUTTON, QUIET)}>
            {t("back")}
          </button>
        )}
        <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
          {missing ? (
            <button type="button" onClick={onSkip} className={cn(BUTTON, PRIMARY)}>
              {t("skipStep")}
            </button>
          ) : (
            <>
              <button type="button" onClick={onSkip} className={cn(BUTTON, QUIET)}>
                {t("skip")}
              </button>
              {showNext && (
                <button type="button" onClick={onNext} className={cn(BUTTON, PRIMARY)}>
                  {isLast ? t("done") : t("next")}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
