"use client";

import { useEffect, useState } from "react";

import LanguagePicker from "@/components/LanguagePicker";
import {
  fetchUserSettings,
  preferredLocalesList,
} from "@/lib/api";

interface Props {
  className?: string;
  /**
   * Always show (e.g. login landing before the user has preferences).
   * Logged-in chrome should omit this and rely on preferred_locales.
   */
  forceVisible?: boolean;
  /**
   * When the parent already loaded settings, pass locales to skip a fetch.
   * `null` = still loading (hide). `undefined` = fetch inside this component.
   */
  preferredLocales?: string[] | null;
}

/** Compact KO/EN toggle — hidden unless the user selected 2 languages. */
export default function LocaleToggle({
  className = "",
  forceVisible = false,
  preferredLocales,
}: Props) {
  const [locales, setLocales] = useState<string[] | null>(() =>
    preferredLocales !== undefined ? preferredLocales : null
  );

  useEffect(() => {
    if (forceVisible) return;
    if (preferredLocales !== undefined) {
      setLocales(preferredLocales);
      return;
    }
    let active = true;
    fetchUserSettings()
      .then((s) => {
        if (active) setLocales(preferredLocalesList(s));
      })
      .catch(() => {
        if (active) setLocales([]);
      });
    return () => {
      active = false;
    };
  }, [forceVisible, preferredLocales]);

  if (forceVisible) {
    return <LanguagePicker variant="toggle" className={className} />;
  }
  if (locales === null || locales.length < 2) {
    return null;
  }
  return <LanguagePicker variant="toggle" className={className} />;
}
