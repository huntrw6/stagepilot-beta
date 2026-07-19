const SENSITIVE_KEY = /(?:access_token|refresh_token|id_token|token|authorization|code|verifier|secret|cookie)/i;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;

export function redactString(value: string): string {
  return value.replace(BEARER, "Bearer [REDACTED]");
}

export function redact(value: unknown): unknown {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SENSITIVE_KEY.test(key) ? "[REDACTED]" : redact(item),
      ]),
    );
  }
  return value;
}

export function sanitizedError(error: unknown): string {
  return redactString(error instanceof Error ? error.message : String(error));
}
