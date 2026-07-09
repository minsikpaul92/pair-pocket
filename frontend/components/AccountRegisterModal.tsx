"use client";

import { Check, ChevronDown, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  ACCOUNT_KIND_LABEL,
  Currency,
  FinancialAccount,
  FinancialAccountKind,
  NewFinancialAccount,
  TransactionType,
  createAccount,
} from "@/lib/api";
import { BANK_OPTIONS, bankLogoUrl } from "@/lib/banks";

interface Props {
  currency: Currency;
  preferredType: TransactionType;
  onClose: () => void;
  onCreated: (account: FinancialAccount) => void;
}

const KINDS: FinancialAccountKind[] = [
  "checking",
  "credit_card",
  "savings",
  "investment",
  "cash",
];

function BankIcon({
  name,
  color,
  domain,
}: {
  name: string;
  color: string;
  domain: string | null;
}) {
  const [failed, setFailed] = useState(false);
  const src = bankLogoUrl(domain);

  if (!src || failed) {
    return (
      <span
        className="flex h-6 w-6 items-center justify-center rounded-md text-[9px] font-bold text-white shrink-0"
        style={{ backgroundColor: color }}
        aria-hidden
      >
        {name.slice(0, 2).toUpperCase()}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={24}
      height={24}
      className="h-6 w-6 rounded-md object-contain bg-white shrink-0"
      onError={() => setFailed(true)}
    />
  );
}

export default function AccountRegisterModal({
  currency,
  preferredType,
  onClose,
  onCreated,
}: Props) {
  const [name, setName] = useState("");
  const [nickname, setNickname] = useState("");
  const [kind, setKind] = useState<FinancialAccountKind>(
    preferredType === "expense" ? "credit_card" : "checking"
  );
  const [openingBalance, setOpeningBalance] = useState("0");
  const [lastFour, setLastFour] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [institution, setInstitution] = useState("");
  const [bankOpen, setBankOpen] = useState(false);
  const [isDefault, setIsDefault] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bankRef = useRef<HTMLDivElement>(null);

  const selectedBank = BANK_OPTIONS.find((b) => b.id === institution);
  const isCreditCard = kind === "credit_card";

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (bankRef.current && !bankRef.current.contains(e.target as Node)) {
        setBankOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmed = name.trim();
    if (!trimmed) {
      setError("계좌/카드 이름을 입력해 주세요.");
      return;
    }

    const balance = Number(openingBalance);
    if (Number.isNaN(balance)) {
      setError("잔액을 올바르게 입력해 주세요.");
      return;
    }

    const nick = nickname.trim();
    const payload: NewFinancialAccount = {
      name: trimmed,
      nickname: nick || null,
      kind,
      currency,
      opening_balance: balance,
      institution: institution || null,
      last_four: isCreditCard ? lastFour.trim() || null : null,
      account_number: isCreditCard ? null : accountNumber.trim() || null,
      is_default_expense: preferredType === "expense" ? isDefault : false,
      is_default_income: preferredType === "income" ? isDefault : false,
    };

    setSubmitting(true);
    try {
      const created = await createAccount(payload);
      onCreated(created);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "등록 중 오류가 발생했습니다."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full sm:max-w-md bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-2xl shadow-xl p-5 max-h-[90dvh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold tracking-tight">카드/은행 등록</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {currency} ·{" "}
              {preferredType === "expense" ? "지출용" : "수입용"} 기본 설정 가능
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="text-gray-400 hover:text-gray-700 dark:hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
              이름
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={
                preferredType === "expense"
                  ? "예: TD Visa, 신한카드"
                  : "예: TD Chequing, 국민은행"
              }
              className="input-field"
              autoFocus
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
              닉네임
            </label>
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="예: 코스트코카드, 생활비통장"
              className="input-field"
            />
            <p className="mt-1 text-[10px] text-gray-400">
              거래 입력 시 이 닉네임이 표시됩니다
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
              유형
            </label>
            <div className="grid grid-cols-2 gap-2">
              {KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={`rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                    kind === k
                      ? "bg-blue-500 text-white"
                      : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300"
                  }`}
                >
                  {ACCOUNT_KIND_LABEL[k]}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
                현재 잔액
              </label>
              <input
                type="number"
                inputMode="decimal"
                value={openingBalance}
                onChange={(e) => setOpeningBalance(e.target.value)}
                className="input-field"
              />
              <p className="mt-1 text-[10px] text-gray-400">
                {isCreditCard ? "남은 카드 빚" : "통장 잔액"}
              </p>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
                {isCreditCard ? "끝 4자리" : "계좌번호"}
              </label>
              {isCreditCard ? (
                <input
                  value={lastFour}
                  onChange={(e) =>
                    setLastFour(e.target.value.replace(/\D/g, "").slice(0, 4))
                  }
                  placeholder="1234"
                  className="input-field"
                />
              ) : (
                <>
                  <input
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value)}
                    placeholder="선택 입력"
                    className="input-field"
                  />
                  <p className="mt-1 text-[10px] text-gray-400">선택 사항</p>
                </>
              )}
            </div>
          </div>

          <div ref={bankRef} className="relative">
            <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
              금융기관
            </label>
            <button
              type="button"
              onClick={() => setBankOpen((v) => !v)}
              className="w-full flex items-center justify-between input-field text-left"
            >
              <span className="flex items-center gap-2 min-w-0">
                {selectedBank ? (
                  <>
                    <BankIcon
                      name={selectedBank.name}
                      color={selectedBank.color}
                      domain={selectedBank.domain}
                    />
                    <span className="truncate">{selectedBank.name}</span>
                  </>
                ) : (
                  <span className="text-gray-400">은행 선택</span>
                )}
              </span>
              <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" />
            </button>
            {bankOpen && (
              <div className="absolute z-20 mt-2 w-full max-h-52 overflow-auto rounded-xl bg-white dark:bg-gray-800 shadow-lg ring-1 ring-black/5 dark:ring-white/10">
                <ul className="py-1">
                  {BANK_OPTIONS.map((bank) => (
                    <li key={bank.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setInstitution(bank.id);
                          setBankOpen(false);
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                      >
                        <BankIcon
                          name={bank.name}
                          color={bank.color}
                          domain={bank.domain}
                        />
                        <span className="flex-1 truncate">{bank.name}</span>
                        {institution === bank.id && (
                          <Check className="h-4 w-4 text-blue-500 shrink-0" />
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <label className="flex items-center gap-3 rounded-xl bg-gray-50 dark:bg-gray-800/60 px-4 py-3 cursor-pointer">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-500 focus:ring-blue-500"
            />
            <span className="text-sm">
              {preferredType === "expense" ? "지출" : "수입"} 기본{" "}
              {preferredType === "expense" ? "카드/계좌" : "입금 계좌"}로 설정
            </span>
          </label>

          {error && (
            <p className="text-sm text-red-500" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="btn-primary w-full disabled:opacity-50"
          >
            {submitting ? "등록 중…" : "등록"}
          </button>
        </form>
      </div>
    </div>
  );
}
