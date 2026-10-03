/**
 * One line per thing that happened, as JSON, with nothing secret in it.
 *
 * Vercel keeps what the server prints. What it kept until now was a
 * scatter of console.error calls with whatever was to hand, which is
 * fine for reading one error and useless for asking "what happened to
 * bookings on Saturday". Every line from here has a name, a level and
 * fields, so the runtime log can be searched by event.
 *
 * Nothing secret goes through. Any field whose name suggests a key, a
 * token or a password is replaced before it is written, and so is any
 * value that looks like one, whatever it was called. The log is the one
 * place a secret can leak without anybody noticing, so this is the one
 * place that cannot be trusted to remember.
 */

export type LogLevel = "info" | "warn" | "error";

export interface LogFields {
  [key: string]: unknown;
}

const SECRET_KEY = /(secret|token|password|passwd|api[_-]?key|authorization|cookie|signature|private|credential|service[_-]?role)/i;
// Anything that looks like a key, wherever it sits in a string: a Stripe
// key, a webhook secret, a Resend key, an Anthropic key, an AWS id, a JWT,
// or a bearer token quoted in an error message.
const SECRET_VALUE =
  /(sk_(?:live|test)_[A-Za-z0-9]+|pk_live_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+|rk_live_[A-Za-z0-9]+|re_[A-Za-z0-9]{16,}|sk-ant-[A-Za-z0-9_-]+|AKIA[0-9A-Z]{12,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|Bearer\s+\S+)/g;
const MAX_STRING = 500;
const MAX_DEPTH = 4;

/** What a value looks like once it is safe to write down. */
export function redact(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === "string") {
    const scrubbed = value.replace(SECRET_VALUE, "[redacted]");
    return scrubbed.length > MAX_STRING ? `${scrubbed.slice(0, MAX_STRING)}…` : scrubbed;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return describeError(value);
  if (depth >= MAX_DEPTH) return "[deep]";
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY.test(key) ? "[redacted]" : redact(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

/** An error as fields: what it said, what it was, and where, without the secrets. */
export function describeError(err: unknown): { name: string; message: string; stack?: string; digest?: string } {
  if (err instanceof Error) {
    const digest = "digest" in err && typeof (err as { digest?: unknown }).digest === "string" ? (err as { digest: string }).digest : undefined;
    return {
      name: err.name,
      message: String(redact(err.message)),
      stack: err.stack ? String(redact(err.stack.split("\n").slice(0, 8).join("\n"))) : undefined,
      digest,
    };
  }
  return { name: "Error", message: String(redact(String(err))) };
}

/** An email address with the person taken out: j***@gmail.com. */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  return `${local.slice(0, 1)}***@${domain}`;
}

/** A phone with the middle taken out: +1443***1521. */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7) return "***";
  return `${phone.startsWith("+") ? "+" : ""}${digits.slice(0, 4)}***${digits.slice(-4)}`;
}

function write(level: LogLevel, event: string, fields: LogFields = {}) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...(redact(fields) as object) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/**
 * The logger. `log.error("booking.failed", err, { jobId })` and the like.
 *
 * Event names are dotted and stable: the thing, then what happened to it.
 * They are what somebody types into the log search, so a renamed event is
 * a search that finds nothing.
 */
export const log = {
  info: (event: string, fields?: LogFields) => write("info", event, fields),
  warn: (event: string, fields?: LogFields) => write("warn", event, fields),
  error: (event: string, err?: unknown, fields?: LogFields) =>
    write("error", event, err === undefined ? fields : { ...fields, error: describeError(err) }),
};

/** A stopwatch for the duration field. */
export function startTimer(): () => number {
  const began = Date.now();
  return () => Date.now() - began;
}
