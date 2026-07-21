import type {
  LogContext,
  Logger,
} from '@/logger/logger.js';

interface ProviderLogger {
  level: string;
  child(context: Record<string, unknown>): ProviderLogger;
  trace(value: unknown, message?: string): void;
  debug(value: unknown, message?: string): void;
  info(value: unknown, message?: string): void;
  warn(value: unknown, message?: string): void;
  error(value: unknown, message?: string): void;
}

export function createBaileysLogger(logger: Logger): ProviderLogger {
  return {
    level: logger.level,

    child(context) {
      const name = typeof context.class === 'string'
        ? context.class
        : 'internal';
      return createBaileysLogger(logger.child(name));
    },

    trace(value, message) {
      logger.debug(resolveMessage(value, message, 'Provider trace'), safeContext(value));
    },

    debug(value, message) {
      logger.debug(resolveMessage(value, message, 'Provider debug'), safeContext(value));
    },

    info(value, message) {
      logger.debug(resolveMessage(value, message, 'Provider info'), safeContext(value));
    },

    warn(value, message) {
      logger.warn(resolveMessage(value, message, 'Provider warning'), safeContext(value));
    },

    error(value, message) {
      logger.error(resolveMessage(value, message, 'Provider error'), safeContext(value));
    },
  };
}

function resolveMessage(
  value: unknown,
  message: string | undefined,
  fallback: string,
): string {
  if (message) {
    return message;
  }

  return typeof value === 'string' ? value : fallback;
}

function safeContext(value: unknown): LogContext {
  if (value instanceof Error) {
    return { error: value };
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }

  const source = value as Record<string, unknown>;
  const allowed = [
    'location',
    'reason',
    'status',
    'statusCode',
    'type',
  ];

  return Object.fromEntries(
    allowed
      .filter((key) => source[key] !== undefined)
      .map((key) => [key, source[key]]),
  );
}
