export type WhaNextErrorCode =
  | 'AUTH_INVALID_PHONE'
  | 'AUTH_EXPIRED'
  | 'AUTH_PASSKEY_REQUIRED'
  | 'CONNECTION_CLOSED'
  | 'CONNECTION_FAILED'
  | 'GROUP_NOT_FOUND'
  | 'MEMBER_NOT_FOUND'
  | 'BOT_NOT_ADMIN'
  | 'MESSAGE_NOT_FOUND'
  | 'MEDIA_NOT_AVAILABLE'
  | 'MESSAGE_REACHOUT_LOCKED'
  | 'MUTE_DISABLED'
  | 'STORAGE_ERROR'
  | 'ARGUMENT_MISSING'
  | 'ARGUMENT_INVALID'
  | 'COMMAND_NOT_ALLOWED'
  | 'COMMAND_COOLDOWN'
  | 'COMMAND_BUSY'
  | 'COMMAND_LOAD_FAILED'
  | 'PROVIDER_ERROR'
  | 'UNKNOWN_ERROR';

export interface WhaNextErrorOptions {
  cause?: unknown;
  context?: Readonly<Record<string, unknown>>;
  recoverable?: boolean;
}

export class WhaNextError extends Error {
  readonly code: WhaNextErrorCode;
  readonly context: Readonly<Record<string, unknown>>;
  readonly recoverable: boolean;

  constructor(
    code: WhaNextErrorCode,
    message: string,
    options: WhaNextErrorOptions = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'WhaNextError';
    this.code = code;
    this.context = options.context ?? {};
    this.recoverable = options.recoverable ?? false;
  }
}

export function toWhaNextError(
  error: unknown,
  context?: Readonly<Record<string, unknown>>,
): WhaNextError {
  if (error instanceof WhaNextError) {
    return error;
  }

  const message = error instanceof Error ? error.message : 'An unknown error occurred.';

  if (isReachoutTimelockError(error)) {
    return new WhaNextError(
      'MESSAGE_REACHOUT_LOCKED',
      'WhatsApp rejected the outgoing message (ack 463: reach-out time-lock).',
      {
        cause: error,
        context: {
          ...(context ?? {}),
          ackCode: 463,
        },
        recoverable: false,
      },
    );
  }

  return new WhaNextError('UNKNOWN_ERROR', message, {
    cause: error,
    ...(context ? { context } : {}),
  });
}

function isReachoutTimelockError(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;

  for (let depth = 0; depth < 8 && current !== undefined && current !== null; depth += 1) {
    if (seen.has(current)) return false;
    seen.add(current);

    const message = current instanceof Error
      ? current.message
      : typeof current === 'string'
        ? current
        : undefined;

    if (message && /negative publish ack:.*\berror=463\b/i.test(message)) {
      return true;
    }

    if (typeof current !== 'object') return false;
    current = Reflect.get(current, 'cause');
  }

  return false;
}
