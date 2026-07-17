import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  ArgsParser,
  WhaNextError,
} from '@/index.js';

describe('ArgsParser', () => {
  it('consumes and converts positional arguments', () => {
    const args = new ArgsParser([
      '42',
      'on',
      'admin',
      '5m',
      '@5511999999999',
      'motivo',
      'completo',
    ]);

    expect(args.number('amount')).toBe(42);
    expect(args.boolean('enabled')).toBe(true);
    expect(args.enum(['admin', 'member'] as const, 'role')).toBe('admin');
    expect(args.duration()).toBe(300_000);
    expect(args.user().mentionId).toBe('5511999999999@s.whatsapp.net');
    expect(args.rest()).toBe('motivo completo');
    expect(args.remaining).toBe(0);
  });

  it('returns undefined for optional missing arguments', () => {
    const args = new ArgsParser([]);
    expect(args.string('reason', { optional: true })).toBeUndefined();
  });

  it('accepts an explicit indefinite duration', () => {
    const args = new ArgsParser(['sempre', 'permanente']);

    expect(args.duration()).toBeUndefined();
    expect(args.duration()).toBeUndefined();
    expect(args.remaining).toBe(0);
  });

  it('throws a stable error for invalid values', () => {
    const args = new ArgsParser(['abc']);

    try {
      args.number('amount');
    } catch (error) {
      expect(error).toBeInstanceOf(WhaNextError);
      expect(error).toMatchObject({ code: 'ARGUMENT_INVALID' });
    }
  });
});
