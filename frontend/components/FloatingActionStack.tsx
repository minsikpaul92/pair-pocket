"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

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

/** Camera and add buttons in one row, bottom right, as small regular Liquid Glass controls. */
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
  return (
    <div className="fixed bottom-[calc(4.35rem+max(0.5rem,env(safe-area-inset-bottom)))] md:bottom-8 right-4 md:right-5 z-40 flex items-center gap-2 md:gap-3">
      <button
        type="button"
        onClick={onCamera}
        disabled={cameraBusy}
        aria-label={cameraLabel}
        className="glass-fab"
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
        data-tour="fab-add"
        className="glass-fab glass-fab-primary"
      >
        <AddIcon className="h-6 w-6" />
      </button>
    </div>
  );
}
