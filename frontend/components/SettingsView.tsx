"use client";

import React, { useState, useEffect } from "react";
import { Key, RotateCcw, ShieldAlert, CheckCircle2, Loader2, Sparkles, Languages } from "lucide-react";
import { fetchUserSettings, saveGeminiApiKey, resetUserData, UserSettings } from "@/lib/api";
import { useTranslations } from "next-intl";

interface Props {
  onChanged: () => void;
}

export default function SettingsView({ onChanged }: Props) {
  const tCommon = useTranslations("common");
  
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
      setErrorMsg("설정을 불러오는 데 실패했습니다.");
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
      setSuccessMsg("Gemini API Key가 성공적으로 저장되었습니다!");
      onChanged();
    } catch (err: any) {
      setErrorMsg(err.message || "API Key 저장 중 오류가 발생했습니다.");
    } finally {
      setSavingKey(false);
    }
  }

  async function handleResetData() {
    const confirmMessage = 
      "⚠️ 경고: 정말 모든 거래 내역, 주식 보유 현황, 금융 계좌 및 구독 목록을 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없으며 모든 데이터가 초기화됩니다.";
    if (!window.confirm(confirmMessage)) return;

    try {
      setResetting(true);
      setErrorMsg(null);
      setSuccessMsg(null);
      await resetUserData();
      setSuccessMsg("모든 데이터가 성공적으로 초기화되었습니다.");
      onChanged();
      // Reload settings to reflect reset states if any
      await loadSettings();
    } catch (err: any) {
      setErrorMsg(err.message || "데이터 초기화 중 오류가 발생했습니다.");
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
      {/* Alert Banner */}
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

      {/* Gemini AI Settings Card */}
      <section className="card-inset p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 pb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-blue-500" />
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">
              Gemini AI 설정
            </h2>
          </div>
          {settings?.has_gemini_key ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-green-50 dark:bg-green-900/30 px-2.5 py-0.5 text-xs font-semibold text-green-700 dark:text-green-400 border border-green-200/50 dark:border-green-800/50">
              <CheckCircle2 className="h-3.5 w-3.5" /> 연동됨
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-yellow-50 dark:bg-yellow-900/30 px-2.5 py-0.5 text-xs font-semibold text-yellow-700 dark:text-yellow-400 border border-yellow-200/50 dark:border-yellow-800/50">
              미연동
            </span>
          )}
        </div>

        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
          개인 발급받은 Google Gemini API Key를 연동하여 영수증 이미지 OCR 자동 파싱 및 PDF 명세서 분석 기능, 그리고 다국어 AI 번역 기능을 비용 걱정 없이 무료로 사용할 수 있습니다.
        </p>

        <form onSubmit={handleSaveKey} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
              Gemini API Key
            </label>
            <div className="relative">
              <Key className="absolute left-3 top-2.5 h-4.5 w-4.5 text-gray-400" />
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={settings?.has_gemini_key ? "••••••••••••••••••••••••••••" : "AI API Key 입력"}
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
                저장 중...
              </>
            ) : (
              "API Key 저장"
            )}
          </button>
        </form>
      </section>

      {/* Dynamic Languages AI Translation Info Card */}
      <section className="card-inset p-5 space-y-3">
        <div className="flex items-center gap-2 border-b border-gray-100 dark:border-gray-800 pb-3">
          <Languages className="h-5 w-5 text-indigo-500" />
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">
            AI 다국어 자동 번역 지원
          </h2>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
          Gemini API Key가 연동되어 있으면 기본 한글/영어 이외에 **중국어, 일본어, 베트남어, 프랑스어** 등 원하는 언어를 선택할 때 기존 언어팩을 기반으로 Gemini가 전체 번역본을 자동 생성하여 브라우저에 바로 캐싱해 줍니다.
        </p>
      </section>

      {/* Data Reset Card */}
      <section className="card-inset p-5 space-y-4 border border-red-200/50 dark:border-red-950/30">
        <div className="flex items-center gap-2 border-b border-gray-100 dark:border-gray-800 pb-3">
          <RotateCcw className="h-5 w-5 text-red-500" />
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">
            테스트 데이터 초기화
          </h2>
        </div>
        
        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
          모든 거래 내역, 주식 보유 정보, 추가된 금융 계좌 및 정기 구독 정보가 데이터베이스에서 영구히 삭제됩니다. 로그인 계정 상태와 사용자 정의 카테고리/API Key 설정은 보존되어 편리하게 처음부터 다시 테스트를 시작할 수 있습니다.
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
              데이터 초기화 중...
            </>
          ) : (
            "모든 가계부 데이터 초기화"
          )}
        </button>
      </section>
    </div>
  );
}
