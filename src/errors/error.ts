export type WhaNextErrorCode =
  | 'AUTH_INVALID_PHONE'
  | 'AUTH_EXPIRED'
  | 'CONNECTION_CLOSED'
  | 'CONNECTION_FAILED'
  | 'GROUP_NOT_FOUND'
  | 'MEMBER_NOT_FOUND'
  | 'BOT_NOT_ADMIN'
  | 'MESSAGE_NOT_FOUND'
  | 'MEDIA_NOT_AVAILABLE'
  | 'MUTE_DISABLED'
  | 'STORAGE_ERROR'
  | 'ARGUMENT_MISSING'
  | 'ARGUMENT_INVALID'
  | 'COMMAND_NOT_ALLOWED'
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
  return new WhaNextError('UNKNOWN_ERROR', message, {
    cause: error,
    ...(context ? { context } : {}),
  });
}
