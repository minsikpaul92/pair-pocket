const KEY = "pairpocket_user_locale";

/** Remembers the language on this device. The cookie lets next.config.js redirect to it. */
export function rememberUserLocale(code: string) {
  try {
    window.localStorage.setItem(KEY, code);
  } catch {}
  try {
    document.cookie = `${KEY}=${encodeURIComponent(code)}; Path=/; Max-Age=31536000; SameSite=Lax`;
  } catch {}
}
