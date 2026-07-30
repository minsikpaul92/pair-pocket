"use client";

import React, { useState, useEffect } from "react";
import {
  Key,
  RotateCcw,
  ShieldAlert,
  CheckCircle2,
  Loader2,
  Sparkles,
  LogOut,
  UserPlus,
  Settings,
  CalendarDays,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import LocaleToggle from "@/components/LocaleToggle";
import ThemeToggle from "@/components/ThemeToggle";
import DayPicker from "@/components/DayPicker";
import {
  fetchUserSettings,
  saveGeminiApiKey,
  setShareGeminiApiKey,
  updateLedgerStartDate,
  resetUserData,
  ResetScope,
  ResetAccountType,
  UserSettings,
  PartnerSummary,
} from "@/lib/api";
import { dayKey } from "@/lib/date";
import type { AppLocale } from "@/i18n/locales";

interface Props {
  onChanged: () => void;
  onInvite?: () => void;
  onLogout?: () => void;
  partner?: PartnerSummary | null;
}

const RESET_SCOPES: ResetScope[] = [
  "all",
  "ledger",
  "subscriptions",
  "stocks",
];

const RESET_ACCOUNT_TYPES: ResetAccountType[] = [
  "all",
  "personal",
  "shared",
];

/** Must match OnboardingWizard session keys. */
const ONBOARDING_STEP_KEY = "pairpocket_onboarding_step";
const ONBOARDING_LOCALES_KEY = "pairpocket_onboarding_locales";
const ONBOARDING_ACCOUNTS_KEY = "pairpocket_onboarding_accounts";
const ONBOARDING_SUBS_KEY = "pairpocket_onboarding_subs";
const ONBOARDING_HOLDINGS_KEY = "pairpocket_onboarding_holdings";

function clearOnboardingSession() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(ONBOARDING_STEP_KEY);
  sessionStorage.removeItem(ONBOARDING_LOCALES_KEY);
  sessionStorage.removeItem(ONBOARDING_ACCOUNTS_KEY);
  sessionStorage.removeItem(ONBOARDING_SUBS_KEY);
  sessionStorage.removeItem(ONBOARDING_HOLDINGS_KEY);
}

function parseISODate(value: string | null | undefined): Date {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export default function SettingsView({
  onChanged,
  onInvite,
  onLogout,
  partner = null,
}: Props) {
  const t = useTranslations("settingsPage");
  const tCommon = useTranslations("common");
  const tNav = useTranslations("nav");
  const locale = useLocale() as AppLocale;

  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState(false);
  const [sharingKey, setSharingKey] = useState(false);
  const [savingStartDate, setSavingStartDate] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetStep, setResetStep] = useState<1 | 2>(1);
  const [resetScope, setResetScope] = useState<ResetScope>("all");
  const [resetAccountType, setResetAccountType] =
    useState<ResetAccountType>("personal");
  const [resetConfirmText, setResetConfirmText] = useState("");
  const [shareBlockedMsg, setShareBlockedMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const resetPhrase = "Delete";
  const canConfirmReset = resetConfirmText === resetPhrase;
  const hasPartner = Boolean(partner);
  const connected =
    Boolean(settings?.has_gemini_key) ||
    Boolean(settings?.has_effective_gemini_key);

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

  async function handleToggleShare() {
    if (!settings || sharingKey) return;
    const turningOn = !settings.share_gemini_api_key;
    if (turningOn && !settings.partner_has_gemini_key) {
      setShareBlockedMsg(t("shareKeyBlocked"));
      window.setTimeout(() => setShareBlockedMsg(null), 3500);
      return;
    }
    try {
      setSharingKey(true);
      setShareBlockedMsg(null);
      setErrorMsg(null);
      setSuccessMsg(null);
      const updated = await setShareGeminiApiKey(turningOn);
      setSettings(updated);
      setSuccessMsg(t("shareKeySuccess"));
      onChanged();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t("shareKeyError");
      setErrorMsg(message || t("shareKeyError"));
    } finally {
      setSharingKey(false);
    }
  }

  async function handleStartDateChange(
    next: Date,
    kind: "personal" | "shared"
  ) {
    const iso = dayKey(next);
    const current =
      kind === "shared"
        ? settings?.shared_ledger_start_date
        : settings?.ledger_start_date;
    if (iso === current) return;
    try {
      setSavingStartDate(true);
      setErrorMsg(null);
      setSuccessMsg(null);
      const updated = await updateLedgerStartDate(iso, kind);
      setSettings(updated);
      setSuccessMsg(t("startDateSaveSuccess"));
      onChanged();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : t("startDateSaveError");
      setErrorMsg(message || t("startDateSaveError"));
    } finally {
      setSavingStartDate(false);
    }
  }

  function openResetModal() {
    setResetConfirmText("");
    setResetScope("all");
    setResetAccountType(hasPartner ? "personal" : "all");
    setResetStep(1);
    setShowResetModal(true);
  }

  function closeResetModal() {
    if (resetting) return;
    setShowResetModal(false);
    setResetConfirmText("");
    setResetStep(1);
  }

  function goToResetConfirmStep() {
    setResetConfirmText("");
    setResetStep(2);
  }

  function successMessageForScope(scope: ResetScope): string {
    switch (scope) {
      case "ledger":
        return t("resetSuccessLedger");
      case "subscriptions":
        return t("resetSuccessSubscriptions");
      case "stocks":
        return t("resetSuccessStocks");
      default:
        return t("resetSuccessAll");
    }
  }

  function scopeLabel(scope: ResetScope): string {
    switch (scope) {
      case "ledger":
        return t("resetScopeLedger");
      case "subscriptions":
        return t("resetScopeSubscriptions");
      case "stocks":
        return t("resetScopeStocks");
      default:
        return t("resetScopeAll");
    }
  }

  function accountTypeLabel(type: ResetAccountType): string {
    switch (type) {
      case "personal":
        return t("resetAccountTypePersonal");
      case "shared":
        return t("resetAccountTypeShared");
      default:
        return t("resetAccountTypeAll");
    }
  }

  async function handleConfirmReset() {
    if (!canConfirmReset || resetting) return;
    const accountType = hasPartner ? resetAccountType : "all";

    try {
      setResetting(true);
      setErrorMsg(null);
      setSuccessMsg(null);
      await resetUserData(resetScope, accountType);
      setShowResetModal(false);
      setResetConfirmText("");

      if (resetScope === "all" && accountType === "all") {
        clearOnboardingSession();
        // Hard navigation so AppShell unmounts and onboarding starts at step 0.
        window.location.assign(`/${locale}/onboarding`);
        return;
      }

      setSuccessMsg(successMessageForScope(resetScope));
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

      {/* Mobile-only: controls removed from the compact top bar */}
      <section className="card-inset p-5 space-y-1 md:hidden">
        <div className="flex items-center gap-2 border-b border-gray-100 dark:border-gray-800 pb-3 mb-1">
          <Settings className="h-5 w-5 text-blue-500" />
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">
            {t("preferencesTitle")}
          </h2>
        </div>

        <div className="flex items-center justify-between gap-3 py-3">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">
            {t("languageLabel")}
          </span>
          <LocaleToggle />
        </div>
        <div className="flex items-center justify-between gap-3 py-3 border-t border-gray-100 dark:border-gray-800">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">
            {t("themeLabel")}
          </span>
          <ThemeToggle />
        </div>

        {(onInvite || onLogout) && (
          <div className="border-t border-gray-100 dark:border-gray-800 pt-1 mt-1">
            <p className="pt-2 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
              {t("accountSection")}
            </p>
            {onInvite && (
              <button
                type="button"
                onClick={onInvite}
                className="w-full flex items-center gap-3 rounded-xl py-3 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors"
              >
                {partner ? (
                  partner.picture ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={partner.picture}
                      alt={partner.name}
                      className="h-8 w-8 rounded-full object-cover shrink-0 ring-2 ring-white dark:ring-gray-900"
                    />
                  ) : (
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs font-bold shrink-0">
                      {(partner.name || "?").slice(0, 1)}
                    </span>
                  )
                ) : (
                  <UserPlus className="h-5 w-5 text-blue-500 shrink-0" />
                )}
                <span className="truncate">
                  {partner ? t("invitePartnerDone") : t("invitePartner")}
                </span>
              </button>
            )}
            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                className="w-full flex items-center gap-3 rounded-xl py-3 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
              >
                <LogOut className="h-5 w-5 shrink-0" />
                <span className="truncate">{tNav("logout")}</span>
              </button>
            )}
          </div>
        )}
      </section>

      <section className="card-inset p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 pb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-blue-500" />
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">
              {t("geminiTitle")}
            </h2>
          </div>
          {connected ? (
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

        {settings?.using_partner_key && (
          <p className="text-xs font-medium text-blue-600 dark:text-blue-400">
            {t("usingPartnerKey")}
          </p>
        )}
        {settings?.partner_using_my_key && (
          <p className="text-xs font-medium text-blue-600 dark:text-blue-400">
            {t("partnerUsingMyKey")}
          </p>
        )}

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

        {hasPartner && settings?.has_gemini_key && (
          <div className="space-y-2 border-t border-gray-100 dark:border-gray-800 pt-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate">
                  {t("shareKey")}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                  {t("shareKeyHelp")}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={Boolean(settings.share_gemini_api_key)}
                aria-label={t("shareKey")}
                onClick={handleToggleShare}
                disabled={sharingKey}
                className={`relative h-7 w-12 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-60 ${
                  settings.share_gemini_api_key
                    ? "bg-blue-500"
                    : "bg-gray-200 dark:bg-gray-700"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-white shadow-sm transition-transform ${
                    settings.share_gemini_api_key
                      ? "translate-x-5"
                      : "translate-x-0"
                  }`}
                >
                  {sharingKey && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
                  )}
                </span>
              </button>
            </div>
            {shareBlockedMsg && (
              <p className="text-xs text-amber-600 dark:text-amber-400 leading-relaxed">
                {shareBlockedMsg}
              </p>
            )}
          </div>
        )}
      </section>

      <section className="card-inset p-5 space-y-3">
        <div className="flex items-center gap-2 border-b border-gray-100 dark:border-gray-800 pb-3">
          <CalendarDays className="h-5 w-5 text-blue-500" />
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">
            {hasPartner ? t("personalStartDateTitle") : t("startDateTitle")}
          </h2>
          {savingStartDate && (
            <Loader2 className="ml-auto h-4 w-4 animate-spin text-blue-500" />
          )}
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
          {hasPartner ? t("personalStartDateHelp") : t("startDateHelp")}
        </p>
        <DayPicker
          value={parseISODate(settings?.ledger_start_date)}
          onChange={(next) => handleStartDateChange(next, "personal")}
          locale={locale}
          disabled={savingStartDate}
        />
      </section>

      {hasPartner && (
        <section className="card-inset p-5 space-y-3">
          <div className="flex items-center gap-2 border-b border-gray-100 dark:border-gray-800 pb-3">
            <CalendarDays className="h-5 w-5 text-blue-500" />
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">
              {t("sharedStartDateTitle")}
            </h2>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
            {t("sharedStartDateHelp")}
          </p>
          <DayPicker
            value={parseISODate(
              settings?.shared_ledger_start_date || settings?.ledger_start_date
            )}
            onChange={(next) => handleStartDateChange(next, "shared")}
            locale={locale}
            disabled={savingStartDate}
          />
        </section>
      )}

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
          onClick={openResetModal}
          disabled={resetting}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-red-50 hover:bg-red-100 active:bg-red-200 dark:bg-red-950/20 dark:hover:bg-red-900/30 dark:active:bg-red-900/40 text-red-600 dark:text-red-400 font-semibold py-2.5 text-sm transition-all duration-200 border border-red-200 dark:border-red-900/30"
        >
          {t("resetButton")}
        </button>
      </section>

      {showResetModal && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={closeResetModal}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-data-title"
            className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 shadow-xl p-5 space-y-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {resetStep === 1 ? (
              <>
                <div className="flex items-start gap-3">
                  <div className="rounded-xl bg-red-50 dark:bg-red-950/40 p-2">
                    <ShieldAlert className="h-5 w-5 text-red-500" />
                  </div>
                  <div className="min-w-0 space-y-1">
                    <h3
                      id="reset-data-title"
                      className="text-base font-semibold text-gray-900 dark:text-white"
                    >
                      {t("resetModalTitle")}
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                      {t("resetModalBody")}
                    </p>
                  </div>
                </div>

                {hasPartner && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-gray-600 dark:text-gray-400">
                      {t("resetAccountTypeLabel")}
                    </p>
                    <div className="flex rounded-xl bg-gray-100 dark:bg-gray-800 p-1">
                      {RESET_ACCOUNT_TYPES.map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => setResetAccountType(type)}
                          className={`flex-1 rounded-lg px-2 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
                            resetAccountType === type
                              ? "bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-white"
                              : "text-gray-500 dark:text-gray-400"
                          }`}
                        >
                          {accountTypeLabel(type)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <fieldset className="space-y-2">
                  <legend className="text-xs font-medium text-gray-600 dark:text-gray-400">
                    {t("resetScopeLabel")}
                  </legend>
                  <div className="space-y-1.5">
                    {RESET_SCOPES.map((scope) => (
                      <button
                        key={scope}
                        type="button"
                        onClick={() => setResetScope(scope)}
                        className={`w-full text-left rounded-xl border px-3 py-2.5 transition-colors ${
                          resetScope === scope
                            ? "border-red-300 dark:border-red-800 bg-red-50/60 dark:bg-red-950/20"
                            : "border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                        }`}
                      >
                        <span className="text-sm text-gray-800 dark:text-gray-200 leading-snug break-words">
                          {scopeLabel(scope)}
                        </span>
                      </button>
                    ))}
                  </div>
                </fieldset>

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={closeResetModal}
                    disabled={resetting}
                    className="flex-1 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-60 py-2.5 text-sm font-semibold text-gray-700 dark:text-gray-200"
                  >
                    {tCommon("close")}
                  </button>
                  <button
                    type="button"
                    onClick={goToResetConfirmStep}
                    className="flex-1 rounded-xl bg-red-500 hover:bg-red-600 active:bg-red-700 text-white font-semibold py-2.5 text-sm transition-colors"
                  >
                    {t("resetConfirmButton")}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-start gap-3">
                  <div className="rounded-xl bg-red-50 dark:bg-red-950/40 p-2">
                    <ShieldAlert className="h-5 w-5 text-red-500" />
                  </div>
                  <div className="min-w-0 space-y-1">
                    <h3
                      id="reset-data-title"
                      className="text-base font-semibold text-gray-900 dark:text-white"
                    >
                      {t("resetConfirmStepTitle")}
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                      {t("resetConfirmStepBody", {
                        account: hasPartner
                          ? accountTypeLabel(resetAccountType)
                          : t("resetAccountTypeAll"),
                        scope: scopeLabel(resetScope),
                      })}
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="reset-confirm-input"
                    className="block text-xs font-medium text-gray-600 dark:text-gray-400"
                  >
                    {t("resetTypePrompt", { phrase: resetPhrase })}
                  </label>
                  <input
                    id="reset-confirm-input"
                    type="text"
                    autoComplete="off"
                    autoFocus
                    value={resetConfirmText}
                    onChange={(e) => setResetConfirmText(e.target.value)}
                    placeholder={resetPhrase}
                    className="w-full rounded-xl border-0 bg-gray-50 dark:bg-gray-800 px-4 py-3 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setResetConfirmText("");
                      setResetStep(1);
                    }}
                    disabled={resetting}
                    className="flex-1 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-60 py-2.5 text-sm font-semibold text-gray-700 dark:text-gray-200"
                  >
                    {t("resetBack")}
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmReset}
                    disabled={!canConfirmReset || resetting}
                    className="flex-1 rounded-xl bg-red-500 hover:bg-red-600 active:bg-red-700 disabled:bg-gray-200 dark:disabled:bg-gray-800 disabled:text-gray-400 text-white font-semibold py-2.5 text-sm transition-colors inline-flex items-center justify-center gap-2"
                  >
                    {resetting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t("resetting")}
                      </>
                    ) : (
                      t("resetConfirmButton")
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
