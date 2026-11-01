"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { localeMeta } from "@/i18n/locales";
import {
  fetchTestAccounts,
  resetTestAccounts,
  signInTestAccount,
  type TestAccount,
  type TestResetPreset,
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
    await signInAs(account);
  }

  async function signInAs(accountId: string) {
    setBusy(true);
    setNotice(null);
    try {
      const code = await signInTestAccount(accountId, password);
      window.location.assign(
        `/${locale}/auth/callback?code=${encodeURIComponent(code)}`
      );
    } catch (err) {
      setNotice({ kind: "error", text: translateError(err, tErrors) });
      setBusy(false);
    }
  }

  async function reset(preset: TestResetPreset) {
    if (!window.confirm(t("resetConfirm"))) return;
    setBusy(true);
    setNotice(null);
    try {
      await resetTestAccounts(password, preset);
      setNotice({
        kind: "info",
        text: t(preset === "couples" ? "resetCouplesDone" : "resetDone"),
      });
    } catch (err) {
      setNotice({ kind: "error", text: translateError(err, tErrors) });
    } finally {
      setBusy(false);
    }
  }

  const field =
    "w-full rounded-2xl bg-gray-100 px-4 py-3.5 text-base text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900 dark:text-gray-100";
  const quiet =
    "flex-1 rounded-2xl bg-gray-100 px-4 py-3 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 active:bg-gray-300 disabled:opacity-40 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800";

  return (
    <form onSubmit={signIn}>
      <h1 className="text-4xl font-bold tracking-tight text-gray-900 dark:text-white">
        {t("title")}
      </h1>
      <p className="mt-3 text-base text-gray-700 dark:text-gray-300">
        {t("notice")}
      </p>

      <label className="mt-10 block text-sm font-semibold text-gray-900 dark:text-white">
        {t("password")}
        <input
          type="password"
          autoComplete="current-password"
          required
          autoFocus
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className={`${field} mt-2`}
        />
      </label>

      {notice && (
        <p
          role={notice.kind === "error" ? "alert" : "status"}
          className={`mt-4 text-sm ${
            notice.kind === "error"
              ? "text-red-600 dark:text-red-400"
              : "text-green-700 dark:text-green-400"
          }`}
        >
          {notice.text}
        </p>
      )}

      <div className="mt-6 grid grid-cols-2 gap-3">
        {accounts.map((item, index) => (
          <button
            key={item.id}
            type="button"
            onClick={() => signInAs(item.id)}
            disabled={busy || !password}
            className="flex flex-col items-start gap-6 rounded-3xl bg-gray-100 p-4 text-left transition-transform duration-150 hover:bg-gray-200 active:scale-[0.97] disabled:opacity-40 dark:bg-gray-900 dark:hover:bg-gray-800"
          >
            <span
              className={`flex h-10 w-10 items-center justify-center rounded-full text-lg font-bold text-white ${
                index < 2 ? "bg-blue-600" : "bg-emerald-600"
              }`}
            >
              {item.name.replace(/\D/g, "") || item.name.charAt(0)}
            </span>
            <span>
              <span className="block text-lg font-semibold text-gray-900 dark:text-white">
                {item.name}
              </span>
              <span className="block text-sm text-gray-600 dark:text-gray-400">
                {localeMeta(item.locale)?.native ?? item.locale}
              </span>
            </span>
          </button>
        ))}
      </div>

      <div className="mt-6 flex flex-col gap-2 sm:flex-row">
        <select
          aria-label={t("account")}
          value={account}
          onChange={(event) => setAccount(event.target.value)}
          className={`${field} flex-1`}
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
        <button
          type="submit"
          disabled={busy || !password}
          className="whitespace-nowrap rounded-2xl bg-blue-600 px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-40"
        >
          {t("signIn")}
        </button>
      </div>

      <div className="mt-12 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={() => reset("couples")}
          disabled={busy || !password}
          className={quiet}
        >
          {t("resetCouples")}
        </button>
        <button
          type="button"
          onClick={() => reset("empty")}
          disabled={busy || !password}
          className={quiet}
        >
          {t("reset")}
        </button>
      </div>
    </form>
  );
}
