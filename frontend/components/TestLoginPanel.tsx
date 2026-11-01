"use client";

import { FlaskConical } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import InfoTip from "@/components/InfoTip";
import { localeMeta } from "@/i18n/locales";
import {
  fetchTestAccounts,
  resetTestAccounts,
  signInTestAccount,
  type TestAccount,
} from "@/lib/api";
import { translateError } from "@/lib/errors";

const PASSWORD_KEY = "pairpocket.testLoginPassword";
/** Accounts reset to "new user"; their next sign-in must not set them up again. */
const FRESH_KEY = "pairpocket.testLoginFresh";
/** Set after a test sign-in so other screens can link back to the test page. */
export const TEST_LOGIN_FLAG = "pairpocket.testLogin";

type Notice = { kind: "error" | "info"; text: string };
type ResetChoice = "couples" | "empty" | "selected";

function readFresh(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(FRESH_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStored(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable; the choice just isn't remembered */
  }
}

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
  const [resetOpen, setResetOpen] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    try {
      setPassword(window.localStorage.getItem(PASSWORD_KEY) ?? "");
    } catch {
      /* storage unavailable */
    }
  }, []);

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

  function needPassword(): boolean {
    if (password) return false;
    passwordRef.current?.focus();
    setNotice({ kind: "error", text: t("passwordFirst") });
    return true;
  }

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    if (needPassword()) return;
    setBusy(true);
    setNotice(null);
    try {
      const fresh = readFresh();
      const code = await signInTestAccount(
        account,
        password,
        !fresh.includes(account)
      );
      writeStored(PASSWORD_KEY, password);
      writeStored(TEST_LOGIN_FLAG, "1");
      writeStored(
        FRESH_KEY,
        JSON.stringify(fresh.filter((id) => id !== account))
      );
      window.location.assign(
        `/${locale}/auth/callback?code=${encodeURIComponent(code)}`
      );
    } catch (err) {
      setNotice({ kind: "error", text: translateError(err, tErrors) });
      setBusy(false);
    }
  }

  function openReset() {
    if (needPassword()) return;
    setResetOpen(true);
  }

  async function reset(choice: ResetChoice) {
    if (!accounts) return;
    setResetOpen(false);
    setBusy(true);
    setNotice(null);
    try {
      if (choice === "selected") {
        await resetTestAccounts(password, "empty", account);
        writeStored(
          FRESH_KEY,
          JSON.stringify([...new Set([...readFresh(), account])])
        );
      } else {
        await resetTestAccounts(password, choice);
        writeStored(
          FRESH_KEY,
          JSON.stringify(choice === "empty" ? accounts.map((a) => a.id) : [])
        );
      }
      setNotice({
        kind: "info",
        text: t(choice === "couples" ? "resetCouplesDone" : "resetDone"),
      });
    } catch (err) {
      setNotice({ kind: "error", text: translateError(err, tErrors) });
    } finally {
      setBusy(false);
    }
  }

  const name = accounts.find((item) => item.id === account)?.name ?? "";
  const field =
    "w-full rounded-2xl bg-gray-100 px-4 py-3.5 text-base text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900 dark:text-gray-100";
  const options: { choice: ResetChoice; title: string; hint: string }[] = [
    { choice: "couples", title: t("resetCouples"), hint: t("tipResetCouples") },
    { choice: "empty", title: t("reset"), hint: t("tipReset") },
    {
      choice: "selected",
      title: t("resetSelected", { name }),
      hint: t("tipResetSelected", { name }),
    },
  ];

  return (
    <form onSubmit={signIn}>
      <h1 className="text-4xl font-bold tracking-tight text-gray-900 dark:text-white">
        {t("title")}
      </h1>
      <p className="mt-3 text-base text-gray-700 dark:text-gray-300">
        {t("notice")}
      </p>

      <div className="mt-10 text-sm font-semibold text-gray-900 dark:text-white">
        {t("account")}
      </div>
      <div
        role="radiogroup"
        aria-label={t("account")}
        className="mt-2 grid grid-cols-2 gap-3"
      >
        {accounts.map((item, index) => {
          const language = localeMeta(item.locale)?.native ?? item.locale;
          const partner = accounts[index ^ 1]?.name ?? "";
          const active = item.id === account;
          return (
            <div key={item.id} className="relative">
              <button
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setAccount(item.id)}
                className={`flex w-full flex-col items-start gap-6 rounded-3xl p-4 text-left transition-colors duration-150 ${
                  active
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-900 hover:bg-gray-200 dark:bg-gray-900 dark:text-white dark:hover:bg-gray-800"
                }`}
              >
                <span
                  className={`flex h-10 w-10 items-center justify-center rounded-full text-lg font-bold ${
                    active
                      ? "bg-white text-blue-600"
                      : `text-white ${index < 2 ? "bg-blue-600" : "bg-emerald-600"}`
                  }`}
                >
                  {item.name.replace(/\D/g, "") || item.name.charAt(0)}
                </span>
                <span>
                  <span className="block text-lg font-semibold">{item.name}</span>
                  <span
                    className={`block text-sm ${
                      active ? "text-blue-100" : "text-gray-600 dark:text-gray-400"
                    }`}
                  >
                    {language}
                  </span>
                </span>
              </button>
              <InfoTip
                label={t("tipLabel")}
                className={`absolute right-3 top-3 ${active ? "[&_button]:text-blue-100" : ""}`}
              >
                {t("tipTester", { name: item.name, language, partner })}
              </InfoTip>
            </div>
          );
        })}
      </div>

      <div className="mt-8 flex items-center gap-1 text-sm font-semibold text-gray-900 dark:text-white">
        <label htmlFor="test-login-password">{t("password")}</label>
        <InfoTip label={t("tipLabel")}>{t("tipPassword")}</InfoTip>
      </div>
      <input
        id="test-login-password"
        ref={passwordRef}
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        className={`${field} mt-2`}
      />

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

      <button
        type="submit"
        disabled={busy}
        className="mt-4 w-full whitespace-nowrap rounded-2xl bg-blue-600 px-6 py-3.5 text-base font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-40"
      >
        {t("signIn")}
      </button>

      <button
        type="button"
        onClick={openReset}
        disabled={busy}
        className="mt-10 flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-2xl bg-gray-100 px-4 py-3 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 disabled:opacity-40 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
      >
        <FlaskConical className="h-4 w-4" aria-hidden />
        {t("resetButton")}
      </button>

      {resetOpen && (
        <div
          className="fixed inset-0 z-[90] flex items-end justify-center bg-black/50 p-4 backdrop-blur-sm sm:items-center"
          onClick={(event) => {
            if (event.target === event.currentTarget) setResetOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("resetTitle")}
            className="w-full max-w-sm space-y-3 rounded-3xl bg-white p-5 shadow-xl dark:bg-gray-900"
          >
            <h2 className="text-lg font-bold tracking-tight text-gray-900 dark:text-white">
              {t("resetTitle")}
            </h2>
            {options.map((option) => (
              <div
                key={option.choice}
                className="flex items-center gap-1 rounded-2xl bg-gray-100 pr-3 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700"
              >
                <button
                  type="button"
                  onClick={() => reset(option.choice)}
                  className="flex-1 rounded-2xl p-4 text-left text-base font-semibold text-gray-900 dark:text-white"
                >
                  {option.title}
                </button>
                <InfoTip label={t("tipLabel")}>{option.hint}</InfoTip>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setResetOpen(false)}
              className="w-full whitespace-nowrap rounded-2xl px-4 py-3 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              {t("cancel")}
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
