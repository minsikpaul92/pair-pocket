"use client";

import React, { useState, useEffect } from "react";
import {
  Key,
  RotateCcw,
  ShieldAlert,
  CheckCircle2,
  Loader2,
  Sparkles,
  Languages,
} from "lucide-react";
import { useTranslations } from "next-intl";

import {
  fetchUserSettings,
  saveGeminiApiKey,
  resetUserData,
  UserSettings,
} from "@/lib/api";

interface Props {
  onChanged: () => void;
}

export default function SettingsView({ onChanged }: Props) {
  const t = useTranslations("settingsPage");

  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    try {
      setLoading(true);
      const s = await fetchUserSettings();
      setSettings(s);
      setErrorMsg(null);
    } catch (err) {
      console.error(err);
      setErrorMsg(t("loadError"));
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveKey(e: React.FormEvent) {
    e.preventDefault();
    if (!apiKey.trim()) return;
    try {
      setSavingKey(true);
      setErrorMsg(null);
      setSuccessMsg(null);
      const updated = await saveGeminiApiKey(apiKey.trim());
      setSettings(updated);
      setApiKey("");
      setSuccessMsg(t("saveSuccess"));
      onChanged();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t("saveError");
      setErrorMsg(message || t("saveError"));
    } finally {
      setSavingKey(false);
    }
  }

  async function handleResetData() {
    if (!window.confirm(t("resetConfirm"))) return;

    try {
      setResetting(true);
      setErrorMsg(null);
      setSuccessMsg(null);
      await resetUserData();
      setSuccessMsg(t("resetSuccess"));
      onChanged();
      await loadSettings();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t("resetError");
      setErrorMsg(message || t("resetError"));
    } finally {
      setResetting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {successMsg && (
        <div className="flex items-center gap-2 rounded-xl bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800/50 p-4 text-sm text-green-700 dark:text-green-400">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="flex items-center gap-2 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 p-4 text-sm text-red-700 dark:text-red-400">
          <ShieldAlert className="h-5 w-5 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <section className="card-inset p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 pb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-blue-500" />
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">
              {t("geminiTitle")}
            </h2>
          </div>
          {settings?.has_gemini_key ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-green-50 dark:bg-green-900/30 px-2.5 py-0.5 text-xs font-semibold text-green-700 dark:text-green-400 border border-green-200/50 dark:border-green-800/50">
              <CheckCircle2 className="h-3.5 w-3.5" /> {t("connected")}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-yellow-50 dark:bg-yellow-900/30 px-2.5 py-0.5 text-xs font-semibold text-yellow-700 dark:text-yellow-400 border border-yellow-200/50 dark:border-yellow-800/50">
              {t("notConnected")}
            </span>
          )}
        </div>

        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
          {t("geminiDescription")}
        </p>

        <form onSubmit={handleSaveKey} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
              {t("apiKeyLabel")}
            </label>
            <div className="relative">
              <Key className="absolute left-3 top-2.5 h-4.5 w-4.5 text-gray-400" />
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={
                  settings?.has_gemini_key
                    ? "••••••••••••••••••••••••••••"
                    : t("apiKeyPlaceholder")
                }
                className="w-full rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 py-2.5 pl-10 pr-3.5 text-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none dark:text-white"
                required
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={savingKey || !apiKey.trim()}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-blue-500 hover:bg-blue-600 active:bg-blue-700 disabled:bg-gray-200 dark:disabled:bg-gray-800 disabled:text-gray-400 font-semibold text-white py-2.5 text-sm transition-all duration-200 shadow-sm"
          >
            {savingKey ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("saving")}
              </>
            ) : (
              t("saveKey")
            )}
          </button>
        </form>
      </section>

      <section className="card-inset p-5 space-y-3">
        <div className="flex items-center gap-2 border-b border-gray-100 dark:border-gray-800 pb-3">
          <Languages className="h-5 w-5 text-indigo-500" />
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">
            {t("i18nTitle")}
          </h2>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
          {t("i18nDescription")}
        </p>
      </section>

      <section className="card-inset p-5 space-y-4 border border-red-200/50 dark:border-red-950/30">
        <div className="flex items-center gap-2 border-b border-gray-100 dark:border-gray-800 pb-3">
          <RotateCcw className="h-5 w-5 text-red-500" />
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">
            {t("resetTitle")}
          </h2>
        </div>

        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
          {t("resetDescription")}
        </p>

        <button
          type="button"
          onClick={handleResetData}
          disabled={resetting}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-red-50 hover:bg-red-100 active:bg-red-200 dark:bg-red-950/20 dark:hover:bg-red-900/30 dark:active:bg-red-900/40 text-red-600 dark:text-red-400 font-semibold py-2.5 text-sm transition-all duration-200 border border-red-200 dark:border-red-900/30"
        >
          {resetting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin text-red-500" />
              {t("resetting")}
            </>
          ) : (
            t("resetButton")
          )}
        </button>
      </section>
    </div>
  );
}
