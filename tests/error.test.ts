import { describe, expect, it } from 'vitest';
import { toWhaNextError, WhaNextError } from '@/errors/error.js';

describe('toWhaNextError', () => {
  it('classifies WhatsApp negative publish ack 463 as a reach-out lock', () => {
    const raw = new Error(
      'negative publish ack: tag=ack id=3EB0123 class=message error=463',
    );

    const error = toWhaNextError(raw, { command: 'login' });

    expect(error).toBeInstanceOf(WhaNextError);
    expect(error.code).toBe('MESSAGE_REACHOUT_LOCKED');
    expect(error.recoverable).toBe(false);
    expect(error.context).toEqual({ command: 'login', ackCode: 463 });
    expect(error.cause).toBe(raw);
  });

  it('classifies a nested negative publish ack 463', () => {
    const raw = new Error('send failed', {
      cause: new Error(
        'negative publish ack: tag=ack id=3EB0456 class=message error=463',
      ),
    });

    expect(toWhaNextError(raw).code).toBe('MESSAGE_REACHOUT_LOCKED');
  });
});
