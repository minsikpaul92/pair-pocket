export class ApiError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "ApiError";
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

type TranslateFn = (key: string, values?: Record<string, string | number>) => string;

export function translateError(
  err: unknown,
  t: TranslateFn,
  fallbackKey = "generic"
): string {
  if (isApiError(err)) {
    return t(err.code);
  }
  if (err instanceof Error && err.message.startsWith("errors.")) {
    const key = err.message.replace(/^errors\./, "");
    return t(key);
  }
  return t(fallbackKey);
}
