import { messageChain } from "./locales";

type Messages = { [key: string]: string | Messages };

async function loadPack(code: string): Promise<Messages | null> {
  try {
    return (await import(`../messages/${code}.json`)).default as Messages;
  } catch {
    // No pack shipped for this locale yet: the fallback packs cover it.
    return null;
  }
}

/** Overlay `pack` onto `base`. Empty strings count as not translated yet. */
function overlay(base: Messages, pack: Messages): Messages {
  const merged: Messages = { ...base };
  for (const [key, value] of Object.entries(pack)) {
    const current = merged[key];
    if (typeof value === "string") {
      if (value !== "") merged[key] = value;
    } else if (value && typeof value === "object") {
      merged[key] = overlay(
        current && typeof current === "object" ? current : {},
        value
      );
    }
  }
  return merged;
}

/**
 * Messages for a locale: the base pack (ko), then the fallback pack (en),
 * then the locale's own pack, so untranslated keys still render.
 */
export async function loadMessages(locale: string): Promise<Messages> {
  let merged: Messages = {};
  for (const code of messageChain(locale)) {
    const pack = await loadPack(code);
    if (pack) merged = overlay(merged, pack);
  }
  return merged;
}
