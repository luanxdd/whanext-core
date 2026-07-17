import { WhaNextError } from '@/errors/error.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';
export type LogFormat = 'pretty' | 'json';
export type LogContext = Readonly<Record<string, unknown>>;

export interface LogEntry {
  timestamp: string;
  level: Exclude<LogLevel, 'silent'>;
  scope: string;
  message: string;
  context: LogContext;
}

export type LogWriter = (entry: LogEntry) => unknown;

export interface LoggerOptions {
  level?: LogLevel;
  format?: LogFormat;
  writer?: LogWriter;
  scope?: string;
  redact?: readonly string[];
}

export type LoggerConfig = LogLevel | LoggerOptions;

const priorities: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: Number.POSITIVE_INFINITY,
};

const defaultRedactions = [
  'auth',
  'pairingcode',
  'password',
  'phone',
  'secret',
  'session',
  'token',
];

interface LoggerState {
  level: LogLevel;
}

export class Logger {
  #state: LoggerState;
  readonly #scope: string;
  readonly #writer: LogWriter;
  readonly #redactions: Set<string>;

  constructor(config: LoggerConfig = 'info') {
    const options = typeof config === 'string' ? { level: config } : config;
    const level = options.level ?? 'info';
    assertLevel(level);

    if (options.writer !== undefined && typeof options.writer !== 'function') {
      throw new WhaNextError(
        'ARGUMENT_INVALID',
        'Logger writer must be a function.',
      );
    }

    if (options.format !== undefined && !['pretty', 'json'].includes(options.format)) {
      throw new WhaNextError(
        'ARGUMENT_INVALID',
        'Logger format must be "pretty" or "json".',
        { context: { format: options.format } },
      );
    }

    this.#state = { level };
    this.#scope = options.scope ?? 'whanext';
    this.#redactions = new Set(
      [...defaultRedactions, ...(options.redact ?? [])]
        .map((key) => key.toLowerCase()),
    );
    this.#writer = options.writer ?? consoleWriter(options.format ?? 'pretty');
  }

  get level(): LogLevel {
    return this.#state.level;
  }

  setLevel(level: LogLevel): this {
    assertLevel(level);
    this.#state.level = level;
    return this;
  }

  isEnabled(level: Exclude<LogLevel, 'silent'>): boolean {
    return priorities[level] >= priorities[this.#state.level];
  }

  child(scope: string): Logger {
    const childScope = this.#scope ? `${this.#scope}:${scope}` : scope;
    const child = new Logger({
      level: this.#state.level,
      scope: childScope,
      writer: this.#writer,
      redact: [...this.#redactions],
    });
    child.#state = this.#state;
    return child;
  }

  debug(message: string, context: LogContext = {}): void {
    this.#write('debug', message, context);
  }

  info(message: string, context: LogContext = {}): void {
    this.#write('info', message, context);
  }

  warn(message: string, context: LogContext = {}): void {
    this.#write('warn', message, context);
  }

  error(message: string, context: LogContext = {}): void {
    this.#write('error', message, context);
  }

  #write(
    level: Exclude<LogLevel, 'silent'>,
    message: string,
    context: LogContext,
  ): void {
    if (!this.isEnabled(level)) {
      return;
    }

    try {
      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level,
        scope: this.#scope,
        message,
        context: normalizeContext(context, this.#redactions),
      };
      const result = this.#writer(entry);

      if (result instanceof Promise) {
        void result.catch(() => undefined);
      }
    } catch {
      return;
    }
  }
}

function assertLevel(level: LogLevel): void {
  if (!(level in priorities)) {
    throw new WhaNextError(
      'ARGUMENT_INVALID',
      'Logger level must be debug, info, warn, error or silent.',
      { context: { level } },
    );
  }
}

function consoleWriter(format: LogFormat): LogWriter {
  return (entry) => {
    const method = entry.level === 'debug'
      ? console.debug
      : entry.level === 'info'
        ? console.info
        : entry.level === 'warn'
          ? console.warn
          : console.error;

    if (format === 'json') {
      method(JSON.stringify(entry));
      return;
    }

    const details = Object.keys(entry.context).length > 0
      ? ` ${JSON.stringify(entry.context)}`
      : '';
    method(
      `[${entry.timestamp}] ${entry.level.toUpperCase()} ${entry.scope} ${entry.message}${details}`,
    );
  };
}

function normalizeContext(
  context: LogContext,
  redactions: ReadonlySet<string>,
): LogContext {
  const seen = new WeakSet<object>();
  return Object.fromEntries(
    Object.entries(context).map(([key, value]) => [
      key,
      normalizeValue(value, key, redactions, seen),
    ]),
  );
}

function normalizeValue(
  value: unknown,
  key: string,
  redactions: ReadonlySet<string>,
  seen: WeakSet<object>,
): unknown {
  if (isRedactedKey(key, redactions)) {
    return '[REDACTED]';
  }

  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
    || value === undefined
  ) {
    return value;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      ...('code' in value ? { code: value.code } : {}),
    };
  }

  if (typeof value !== 'object') {
    return String(value);
  }

  if (seen.has(value)) {
    return '[Circular]';
  }

  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) =>
      normalizeValue(item, '', redactions, seen));
  }

  return Object.fromEntries(
    Object.entries(value).map(([nestedKey, nestedValue]) => [
      nestedKey,
      normalizeValue(nestedValue, nestedKey, redactions, seen),
    ]),
  );
}

function isRedactedKey(
  key: string,
  redactions: ReadonlySet<string>,
): boolean {
  const normalized = key.toLowerCase();
  return [...redactions].some((redaction) =>
    normalized === redaction
    || normalized.startsWith(redaction)
    || normalized.endsWith(redaction));
}
