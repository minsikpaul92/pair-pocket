"use client";

import { FlaskConical } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { localeMeta } from "@/i18n/locales";
import {
  fetchTestAccounts,
  resetTestAccounts,
  signInTestAccount,
  type TestAccount,
} from "@/lib/api";
import { translateError } from "@/lib/errors";

type Notice = { kind: "error" | "info"; text: string };

/**
 * Sign-in with built-in test accounts. Renders nothing unless the API has test
 * login turned on, which only the staging deployment does.
 */
export default function TestLoginPanel() {
  const t = useTranslations("auth.testLogin");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const [accounts, setAccounts] = useState<TestAccount[] | null>(null);
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    let active = true;
    fetchTestAccounts().then((list) => {
      if (!active || !list?.length) return;
      setAccounts(list);
      setAccount(list[0].id);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!accounts) return null;

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const code = await signInTestAccount(account, password);
      window.location.assign(
        `/${locale}/auth/callback?code=${encodeURIComponent(code)}`
      );
    } catch (err) {
      setNotice({ kind: "error", text: translateError(err, tErrors) });
      setBusy(false);
    }
  }

  async function reset() {
    if (!window.confirm(t("resetConfirm"))) return;
    setBusy(true);
    setNotice(null);
    try {
      await resetTestAccounts(password);
      setNotice({ kind: "info", text: t("resetDone") });
    } catch (err) {
      setNotice({ kind: "error", text: translateError(err, tErrors) });
    } finally {
      setBusy(false);
    }
  }

  const field =
    "mt-1 w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100";

  return (
    <form
      onSubmit={signIn}
      className="mt-8 rounded-2xl border border-dashed border-amber-400 dark:border-amber-600 bg-amber-50/60 dark:bg-amber-950/30 p-4"
    >
      <div className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
        <FlaskConical className="h-4 w-4" />
        {t("title")}
      </div>
      <p className="mt-1 text-xs text-amber-800/80 dark:text-amber-300/80">
        {t("notice")}
      </p>

      <label className="mt-4 block text-xs font-medium text-gray-700 dark:text-gray-300">
        {t("account")}
        <select
          value={account}
          onChange={(event) => setAccount(event.target.value)}
          className={field}
        >
          {accounts.map((item) => (
            <option key={item.id} value={item.id}>
              {t("accountOption", {
                name: item.name,
                language: localeMeta(item.locale)?.native ?? item.locale,
              })}
            </option>
          ))}
        </select>
      </label>

      <label className="mt-3 block text-xs font-medium text-gray-700 dark:text-gray-300">
        {t("password")}
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className={field}
        />
      </label>

      {notice && (
        <p
          role={notice.kind === "error" ? "alert" : "status"}
          className={`mt-3 text-xs ${
            notice.kind === "error"
              ? "text-red-600 dark:text-red-400"
              : "text-green-700 dark:text-green-400"
          }`}
        >
          {notice.text}
        </p>
      )}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <button
          type="submit"
          disabled={busy || !password}
          className="flex-1 rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-amber-700 disabled:opacity-50"
        >
          {t("signIn")}
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={busy || !password}
          className="rounded-xl border border-amber-500 px-4 py-2.5 text-sm font-medium text-amber-800 dark:text-amber-300 transition-colors hover:bg-amber-100 dark:hover:bg-amber-900/40 disabled:opacity-50"
        >
          {t("reset")}
        </button>
      </div>
    </form>
  );
}
