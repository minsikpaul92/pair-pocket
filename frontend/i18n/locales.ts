export const locales = [
  "ko",
  "en",
  "fr",
  "zh-Hans",
  "zh-Hant",
  "ja",
  "es",
  "vi",
  "fil",
  "pa",
] as const;

export type AppLocale = (typeof locales)[number];

/** Locales with full static message packs shipped in MVP. */
export const FULL_MESSAGE_LOCALES = ["ko", "en"] as const;

export type LocaleMeta = {
  code: AppLocale;
  label: string;
  native: string;
  beta: boolean;
};

export const LOCALE_OPTIONS: LocaleMeta[] = [
  { code: "en", label: "English", native: "English", beta: false },
  { code: "ko", label: "한국어", native: "한국어", beta: false },
  { code: "fr", label: "Français", native: "Français", beta: true },
  {
    code: "zh-Hans",
    label: "中文 (Mandarin)",
    native: "普通话",
    beta: true,
  },
  {
    code: "zh-Hant",
    label: "中文 (Cantonese)",
    native: "粤语",
    beta: true,
  },
  { code: "ja", label: "日本語", native: "日本語", beta: true },
  { code: "es", label: "Español", native: "Español", beta: true },
  { code: "vi", label: "Tiếng Việt", native: "Tiếng Việt", beta: true },
  { code: "fil", label: "Filipino", native: "Filipino", beta: true },
  { code: "pa", label: "Punjabi", native: "ਪੰਜਾਬੀ", beta: true },
];

export function isBetaLocale(locale: string): boolean {
  const meta = LOCALE_OPTIONS.find((item) => item.code === locale);
  return meta?.beta ?? true;
}

export function messagePackLocale(locale: string): "ko" | "en" {
  if (locale === "ko") return "ko";
  return "en";
}
