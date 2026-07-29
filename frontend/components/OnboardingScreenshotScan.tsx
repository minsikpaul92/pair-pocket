"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, ImagePlus, Play, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  OnboardingParseStep,
  OnboardingParseResult,
  parseOnboardingScreenshots,
} from "@/lib/api";

const MAX_IMAGES = 15;
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.82;

async function resizeImageFile(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  if (scale >= 1 && file.size < 1_200_000) {
    bitmap.close();
    return file;
  }

  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return file;
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
  );
  if (!blob) return file;
  const base = file.name.replace(/\.[^.]+$/, "") || "screenshot";
  return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
}

type QueuedImage = {
  id: string;
  file: File;
  previewUrl: string;
};

interface Props {
  step: OnboardingParseStep;
  hasApiKey: boolean;
  disabled?: boolean;
  onParsed: (result: OnboardingParseResult) => void;
}

export default function OnboardingScreenshotScan({
  step,
  hasApiKey,
  disabled,
  onParsed,
}: Props) {
  const t = useTranslations("onboarding");
  const tImport = useTranslations("import");
  const inputRef = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<QueuedImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      queue.forEach((q) => URL.revokeObjectURL(q.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function formatResumeAtEastern(iso?: string | null): string {
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      return new Intl.DateTimeFormat("ko-KR", {
        timeZone: "America/Toronto",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(d);
    } catch {
      return iso;
    }
  }

  function clearQueue() {
    setQueue((prev) => {
      prev.forEach((q) => URL.revokeObjectURL(q.previewUrl));
      return [];
    });
  }

  function addFiles(fileList: FileList | File[] | null) {
    if (!fileList) return;
    setError(null);

    const list = Array.from(fileList as FileList | File[]);
    const images = list.filter((f) => f.type.startsWith("image/"));
    if (!images.length) {
      setError(t("aiNeedImages"));
      return;
    }

    setQueue((prev) => {
      const room = MAX_IMAGES - prev.length;
      if (room <= 0) {
        setError(t("aiMaxImages", { max: MAX_IMAGES }));
        return prev;
      }
      const accepted = images.slice(0, room);
      if (images.length > room) {
        setError(t("aiMaxImages", { max: MAX_IMAGES }));
      }
      const next = accepted.map((file) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        previewUrl: URL.createObjectURL(file),
      }));
      return [...prev, ...next];
    });

    if (inputRef.current) inputRef.current.value = "";
  }

  function removeQueued(id: string) {
    setQueue((prev) => {
      const target = prev.find((q) => q.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((q) => q.id !== id);
    });
    setError(null);
  }

  async function startAnalysis() {
    if (busy || disabled || queue.length === 0) return;
    setError(null);

    if (!hasApiKey) {
      setError(t("aiNeedKey"));
      return;
    }

    const files = queue.map((q) => q.file);
    setBusy(true);
    setStatus(t("aiResizing", { count: files.length }));
    try {
      const resized: File[] = [];
      for (const file of files) {
        resized.push(await resizeImageFile(file));
      }
      setStatus(t("aiScanning", { count: resized.length }));
      const result = await parseOnboardingScreenshots(step, resized, (ev) => {
        if (ev.event === "trying" && ev.model) {
          setStatus(
            t("aiScanningModel", {
              count: ev.count ?? resized.length,
              model: ev.model,
            })
          );
        } else if (ev.event === "quota_fallback") {
          const resumeAt = formatResumeAtEastern(ev.resume_at);
          setStatus(
            tImport("statusQuotaFallback", {
              model: ev.model || "gemini-3.6-flash",
              fallback: ev.fallback_model || "gemini-3.5-flash-lite",
              resumeAt,
            })
          );
        } else if (ev.event === "scanning") {
          setStatus(t("aiScanning", { count: ev.count ?? resized.length }));
        }
      });
      const modelLabel = result.models_used?.length
        ? [...new Set(result.models_used)].join(", ")
        : null;
      const humanNotes = (result.notes || []).filter(
        (n) => !/free-tier|quota\/rate|using gemini/i.test(n)
      );
      if (humanNotes.length) {
        setStatus(humanNotes[humanNotes.length - 1]);
      } else if (modelLabel) {
        setStatus(
          t("aiDoneModel", {
            count: result.image_count ?? resized.length,
            model: modelLabel,
          })
        );
      } else {
        setStatus(t("aiDone", { count: result.image_count ?? resized.length }));
      }
      onParsed(result);
      clearQueue();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t("aiError");
      setError(message);
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  const atMax = queue.length >= MAX_IMAGES;
  const canPick = !busy && !disabled && !atMax;
  const dragDepth = useRef(0);

  return (
    <div
      onDragEnter={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!canPick) return;
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        e.stopPropagation();
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        dragDepth.current = 0;
        setDragging(false);
        if (!canPick) return;
        addFiles(e.dataTransfer.files);
      }}
      className={`relative rounded-2xl border-2 border-dashed p-4 space-y-3 transition-all duration-150 ${
        dragging
          ? "border-blue-500 bg-blue-100 dark:bg-blue-900/40 ring-2 ring-blue-500/30 scale-[1.01]"
          : "border-gray-300 dark:border-gray-600 bg-white/60 dark:bg-gray-800/60"
      }`}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-blue-500/10 dark:bg-blue-400/10">
          <span className="rounded-full bg-blue-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm">
            {t("aiDropActive")}
          </span>
        </div>
      )}
      <div className="flex items-start gap-2">
        <Camera className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold text-gray-900 dark:text-white">
            {t("aiTitle")}
          </p>
          <p className="text-xs text-gray-600 dark:text-gray-400">{t("aiHelp")}</p>
          <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">
            {t("aiQueueCount", { count: queue.length, max: MAX_IMAGES })}
          </p>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => addFiles(e.target.files)}
      />

      {queue.length > 0 && (
        <ul className="grid grid-cols-4 gap-2">
          {queue.map((q) => (
            <li key={q.id} className="relative aspect-square">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={q.previewUrl}
                alt=""
                className="h-full w-full rounded-lg object-cover border border-gray-200 dark:border-gray-700"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => removeQueued(q.id)}
                className="absolute -top-1.5 -right-1.5 rounded-full bg-gray-900/80 text-white p-0.5 disabled:opacity-50"
                aria-label={t("remove")}
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={!canPick}
          onClick={() => inputRef.current?.click()}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-60 px-3 py-2.5 text-sm font-medium text-gray-800 dark:text-gray-100"
        >
          <ImagePlus className="h-4 w-4" />
          {atMax ? t("aiQueueFull") : t("aiPick")}
        </button>
        <button
          type="button"
          disabled={busy || disabled || queue.length === 0}
          onClick={() => void startAnalysis()}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-500 hover:bg-blue-600 disabled:opacity-60 px-3 py-2.5 text-sm font-semibold text-white"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          {busy ? t("aiWorking") : t("aiStart")}
        </button>
      </div>

      {queue.length > 0 && !busy && (
        <button
          type="button"
          onClick={clearQueue}
          className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-red-500"
        >
          <Trash2 className="h-3 w-3" />
          {t("aiClearQueue")}
        </button>
      )}

      {status && (
        <p className="text-xs text-blue-600 dark:text-blue-400">{status}</p>
      )}
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
