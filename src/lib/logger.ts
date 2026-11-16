// Structured logs for App Platform's runtime log viewer — SERVER-ONLY. One JSON object per line
// ({time, level, msg, ...fields}), never PII: callers pass a pathname, never a query string, and every string that
// reaches a line goes through redactSecrets anyway (the WooCommerce REST key can travel as a query param, lib/woo's fallback).
// Level from MOS_LOG_LEVEL at run time (debug | info | warn | error; default info).

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFields = Record<string, unknown> & { err?: unknown };
export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

interface ProcessLike {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  removeAllListeners(event: string): unknown;
}
/** Node's process, typed locally: the project carries no @types/node. Undefined outside Node. */
const nodeProcess = (globalThis as unknown as { process?: ProcessLike & { env?: Record<string, string | undefined> } }).process;

/** A run-time environment variable (process.env), e.g. MOS_LOG_LEVEL or MOS_HSTS — not baked in at build. */
export function runtimeEnv(name: string): string | undefined {
  return nodeProcess?.env?.[name];
}

// Query/form params whose value is a credential or a capability: the Woo REST key pair, order keys (`key=`, which
// opens an order receipt), password-reset keys, passwords and tokens. Matched as `name=value` after ? & or space.
const SECRET_PARAM = /([?&\s;](?:consumer_key|consumer_secret|key|api_key|password|pass|pwd|token|secret|auth)=)[^&#\s"'<>]*/gi;

/** `text` with the value of every secret-bearing `name=value` pair replaced by `[redacted]`. */
export function redactSecrets(text: string): string {
  return text.replace(SECRET_PARAM, '$1[redacted]');
}

function errText(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

/** A field value made safe for a log line: strings redacted, errors flattened to `Name: message` (no stack: a
 *  stack can carry request data, and the message is what the runtime log needs). */
function clean(value: unknown): unknown {
  if (typeof value === 'string') return redactSecrets(value);
  if (value instanceof Error) return redactSecrets(errText(value));
  return value;
}

export function createLogger(opts: { write?: (line: string) => void; level?: string; now?: () => number } = {}): Logger {
  const write = opts.write ?? ((line: string) => console.log(line));
  const min = LEVELS[(opts.level ?? 'info') as LogLevel] ?? LEVELS.info;
  const now = opts.now ?? Date.now;
  const emit = (level: LogLevel) => (msg: string, fields: LogFields = {}) => {
    if (LEVELS[level] < min) return;
    const entry: Record<string, unknown> = { time: new Date(now()).toISOString(), level, msg: redactSecrets(msg) };
    for (const [k, v] of Object.entries(fields)) if (v !== undefined) entry[k] = clean(v);
    write(JSON.stringify(entry));
  };
  return { debug: emit('debug'), info: emit('info'), warn: emit('warn'), error: emit('error') };
}

/** The process-wide logger. */
export const log: Logger = createLogger({ level: runtimeEnv('MOS_LOG_LEVEL') });

/** Log unhandled rejections as one redacted JSON line and keep serving (one stray promise must not take the shop
 *  down into a restart loop). Replaces the node adapter's own listener, which logs the raw request URL — query and
 *  order keys included — and the raw reason. Idempotent per `flags` object (default: globalThis). Uncaught
 *  exceptions keep Node's default (crash; App Platform restarts the container) after a log line, since the process
 *  state is unknown then. */
export function installProcessHandlers(
  logger: Logger = log,
  proc: ProcessLike | undefined = nodeProcess,
  flags: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
): void {
  if (!proc || flags.__mosProcessHandlers) return;
  flags.__mosProcessHandlers = true;
  proc.removeAllListeners('unhandledRejection');
  proc.on('unhandledRejection', (reason) => logger.error('unhandled rejection', { err: reason }));
  proc.on('uncaughtExceptionMonitor', (err) => logger.error('uncaught exception', { err }));
}
