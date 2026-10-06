"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";

import { institutionLabel } from "@/lib/banks";

/** Display name for a stored institution value in the current language. */
export function useInstitutionLabel(): (value: string) => string {
  const t = useTranslations("banks");
  return useCallback((value: string) => institutionLabel(value, t), [t]);
}
