"use client";

import { ChevronDown, ChevronUp, type LucideIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";

const FAB_EXPANDED_KEY = "pairpocket_fab_expanded";

interface Props {
  onCamera: () => void;
  onAdd: () => void;
  cameraLabel: string;
  addLabel: string;
  cameraBusy?: boolean;
  CameraIcon: LucideIcon;
  AddIcon: LucideIcon;
  cameraBusyIcon?: ReactNode;
}

/**
 * Desktop: always show camera + add.
 * Mobile: collapsible stack so FABs don't cover list amounts.
 */
export default function FloatingActionStack({
  onCamera,
  onAdd,
  cameraLabel,
  addLabel,
  cameraBusy = false,
  CameraIcon,
  AddIcon,
  cameraBusyIcon,
}: Props) {
  const t = useTranslations("common");
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(FAB_EXPANDED_KEY);
    // Default collapsed on mobile so content stays readable.
    if (stored === "true") setExpanded(true);
  }, []);

  function setExpandedPersist(next: boolean) {
    setExpanded(next);
    window.localStorage.setItem(FAB_EXPANDED_KEY, String(next));
  }

  const actionBtn =
    "flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lg transition-colors disabled:opacity-50";

  return (
    <div className="fixed bottom-[calc(6.5rem+env(safe-area-inset-bottom))] md:bottom-8 right-5 z-40 flex flex-col items-end gap-3">
      <div className="hidden md:flex flex-col gap-3">
        <button
          type="button"
          onClick={onCamera}
          disabled={cameraBusy}
          aria-label={cameraLabel}
          className={`${actionBtn} bg-indigo-500 hover:bg-indigo-600 active:bg-indigo-700`}
        >
          {cameraBusy && cameraBusyIcon ? (
            cameraBusyIcon
          ) : (
            <CameraIcon className="h-6 w-6" />
          )}
        </button>
        <button
          type="button"
          onClick={onAdd}
          aria-label={addLabel}
          className={`${actionBtn} bg-blue-500 hover:bg-blue-600 active:bg-blue-700`}
        >
          <AddIcon className="h-6 w-6" />
        </button>
      </div>

      <div className="md:hidden flex flex-col items-end gap-2">
        {expanded && (
          <>
            <button
              type="button"
              onClick={onCamera}
              disabled={cameraBusy}
              aria-label={cameraLabel}
              className={`${actionBtn} bg-indigo-500 hover:bg-indigo-600 active:bg-indigo-700`}
            >
              {cameraBusy && cameraBusyIcon ? (
                cameraBusyIcon
              ) : (
                <CameraIcon className="h-6 w-6" />
              )}
            </button>
            <button
              type="button"
              onClick={onAdd}
              aria-label={addLabel}
              className={`${actionBtn} bg-blue-500 hover:bg-blue-600 active:bg-blue-700`}
            >
              <AddIcon className="h-6 w-6" />
            </button>
            <button
              type="button"
              onClick={() => setExpandedPersist(false)}
              aria-label={t("collapseActions")}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-200 text-gray-700 dark:bg-gray-900 dark:text-gray-200 shadow-md border border-gray-300/80 dark:border-gray-700"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </>
        )}
        {!expanded && (
          <button
            type="button"
            onClick={() => setExpandedPersist(true)}
            aria-label={t("expandActions")}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-gray-200 text-gray-700 dark:bg-gray-900 dark:text-gray-200 shadow-lg border border-gray-300/80 dark:border-gray-700"
          >
            <ChevronUp className="h-5 w-5" />
          </button>
        )}
      </div>
    </div>
  );
}
