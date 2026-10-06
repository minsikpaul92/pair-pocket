export type ErrorParams = Record<string, string | number>;

/**
 * An error whose text lives in the message packs under `errors.<code>`.
 * Codes sent by the API are prefixed with `server.` (errors.server.<code>).
 */
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly params: ErrorParams = {}
  ) {
    super(code);
    this.name = "ApiError";
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

function readParams(value: unknown): ErrorParams {
  if (!value || typeof value !== "object") return {};
  const params: ErrorParams = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "string" || typeof raw === "number") params[key] = raw;
  }
  return params;
}

/**
 * Error for a failed API response body. The API sends
 * `{ detail, code, params }`; without a code the client-side fallback is used.
 */
export function apiErrorFromBody(body: unknown, fallbackCode: string): ApiError {
  if (body && typeof body === "object") {
    const { code, params } = body as { code?: unknown; params?: unknown };
    if (typeof code === "string" && code) {
      return new ApiError(`server.${code}`, readParams(params));
    }
  }
  return new ApiError(fallbackCode);
}

/** Same as apiErrorFromBody for an AI stream `{ event: "error", code, params }`. */
export function apiErrorFromEvent(event: unknown, fallbackCode: string): ApiError {
  return apiErrorFromBody(event, fallbackCode);
}

type TranslateFn = {
  (key: string, values?: ErrorParams): string;
  has?: (key: string) => boolean;
};

/** Params that name another message: `field` and `ledger` values are keys. */
const PARAM_NAMESPACES: Record<string, string> = {
  field: "fields",
  ledger: "ledgers",
};

function localizeParams(params: ErrorParams, t: TranslateFn): ErrorParams {
  const out: ErrorParams = { ...params };
  for (const [name, namespace] of Object.entries(PARAM_NAMESPACES)) {
    const value = params[name];
    if (typeof value !== "string") continue;
    const key = `${namespace}.${value}`;
    if (!t.has || t.has(key)) out[name] = t(key);
  }
  return out;
}

/** Translated text for a known error code, or null. */
function knownErrorText(err: unknown, t: TranslateFn): string | null {
  let code: string | null = null;
  let params: ErrorParams = {};
  if (isApiError(err)) {
    code = err.code;
    params = err.params;
  } else if (err instanceof Error && err.message.startsWith("errors.")) {
    code = err.message.replace(/^errors\./, "");
  }
  if (code && (!t.has || t.has(code))) {
    return t(code, localizeParams(params, t));
  }
  return null;
}

/**
 * User-facing text for any thrown value, translated with the `errors`
 * namespace. Raw `Error.message` text is never shown: it may be an internal
 * message in another language.
 */
export function translateError(
  err: unknown,
  t: TranslateFn,
  fallbackKey = "generic"
): string {
  return knownErrorText(err, t) ?? t(fallbackKey);
}

/** Like translateError, with fallback text already translated elsewhere. */
export function errorMessage(
  err: unknown,
  t: TranslateFn,
  fallbackText: string
): string {
  return knownErrorText(err, t) ?? fallbackText;
}
