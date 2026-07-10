"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import {
  InvitationMe,
  createInvitation,
  fetchInvitationMe,
  revokePendingInvitation,
  unlinkPartnership,
} from "@/lib/api";
import { translateError } from "@/lib/errors";

interface Props {
  onClose: () => void;
  onLinked?: () => void;
  onUnlinked?: () => void;
}

export default function InviteModal({ onClose, onLinked, onUnlinked }: Props) {
  const t = useTranslations("invite");
  const tErrors = useTranslations("errors");
  const [status, setStatus] = useState<InvitationMe | null>(null);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [manualUrl, setManualUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const me = await fetchInvitationMe();
      setStatus(me);
      if (me.pending_invite?.accept_url) {
        setManualUrl(me.pending_invite.accept_url);
      }
      if (me.partner) onLinked?.();
    } catch (err) {
      setError(translateError(err, tErrors, "fetchInvitationMe"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    setCopied(false);
    try {
      const created = await createInvitation(email.trim());
      if (created.email_sent) {
        setSuccess(t("sent"));
        setManualUrl(null);
      } else {
        setSuccess(t("sentManual"));
        setManualUrl(created.accept_url ?? null);
      }
      setEmail("");
      await load();
    } catch (err) {
      setError(translateError(err, tErrors, "createInvitation"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRevoke() {
    if (!window.confirm(t("revokeConfirm"))) return;
    setSubmitting(true);
    setError(null);
    try {
      await revokePendingInvitation();
      setSuccess(t("revoked"));
      setManualUrl(null);
      await load();
    } catch (err) {
      setError(translateError(err, tErrors, "revokePendingInvitation"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUnlink() {
    if (!window.confirm(t("unlinkConfirm"))) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      await unlinkPartnership();
      setSuccess(t("unlinked"));
      setManualUrl(null);
      setStatus({
        shared_group_id: null,
        partner: null,
        pending_invite: null,
      });
      onUnlinked?.();
    } catch (err) {
      setError(translateError(err, tErrors, "unlinkPartnership"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCopy() {
    if (!manualUrl) return;
    try {
      await navigator.clipboard.writeText(manualUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-t-2xl sm:rounded-2xl bg-white dark:bg-gray-900 shadow-xl p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h2 className="text-xl font-bold tracking-tight text-gray-900 dark:text-white truncate">
            {t("title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {loading ? (
          <div className="h-24 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
        ) : status?.partner ? (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {t("linked")}
            </p>
            <div className="flex items-center gap-3 rounded-xl bg-gray-50 dark:bg-gray-800/80 px-4 py-3">
              {status.partner.picture ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={status.partner.picture}
                  alt={status.partner.name}
                  className="h-8 w-8 rounded-full object-cover shrink-0"
                />
              ) : (
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 dark:bg-gray-700 shrink-0 text-sm font-medium text-gray-600 dark:text-gray-300">
                  {status.partner.name.slice(0, 1)}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                  {status.partner.name}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                  {status.partner.email}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleUnlink}
              disabled={submitting}
              className="w-full rounded-xl px-4 py-3 text-sm font-semibold text-red-500 bg-red-50 dark:bg-red-950/40 hover:bg-red-100 dark:hover:bg-red-950/60 disabled:opacity-50 transition-colors"
            >
              {t("unlink")}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {t("description")}
            </p>

            {status?.pending_invite && (
              <div className="rounded-xl bg-blue-50 dark:bg-blue-950/40 px-4 py-3 space-y-2">
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  {t("pending", { email: status.pending_invite.invitee_email })}
                </p>
                <button
                  type="button"
                  onClick={handleRevoke}
                  disabled={submitting}
                  className="text-sm font-medium text-red-500 hover:text-red-600 disabled:opacity-50"
                >
                  {t("revoke")}
                </button>
              </div>
            )}

            <form onSubmit={handleInvite} className="space-y-3">
              <label className="block">
                <span className="sr-only">{t("emailLabel")}</span>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("emailPlaceholder")}
                  className="w-full bg-gray-50 dark:bg-gray-900 border-0 rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-white"
                />
              </label>
              <button
                type="submit"
                disabled={submitting || !email.trim()}
                className="w-full bg-blue-500 hover:bg-blue-600 active:bg-blue-700 disabled:opacity-50 text-white font-semibold rounded-xl px-4 py-3 transition-colors"
              >
                {submitting ? t("sending") : t("send")}
              </button>
            </form>
          </div>
        )}

        {error && (
          <p className="mt-3 text-sm text-red-500 whitespace-pre-wrap">{error}</p>
        )}
        {success && (
          <p className="mt-3 text-sm text-blue-500">{success}</p>
        )}
        {manualUrl && (
          <div className="mt-3 space-y-2">
            <p className="text-xs break-all text-gray-500 dark:text-gray-400">
              {manualUrl}
            </p>
            <button
              type="button"
              onClick={handleCopy}
              className="text-sm font-medium text-blue-500 hover:text-blue-600"
            >
              {copied ? t("copied") : t("copyLink")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
