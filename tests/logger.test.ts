import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  Logger,
  type LogEntry,
} from '@/index.js';

describe('Logger', () => {
  it('filters messages by level', () => {
    const entries: LogEntry[] = [];
    const logger = new Logger({
      level: 'warn',
      writer: (entry) => entries.push(entry),
    });

    logger.debug('debug');
    logger.info('info');
    logger.warn('warn');
    logger.error('error');

    expect(entries.map(({ level }) => level)).toEqual(['warn', 'error']);
  });

  it('supports silent mode and runtime level changes across child loggers', () => {
    const entries: LogEntry[] = [];
    const logger = new Logger({
      level: 'silent',
      writer: (entry) => entries.push(entry),
    });
    const child = logger.child('router');

    child.error('hidden');
    logger.setLevel('debug');
    child.debug('visible');

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      level: 'debug',
      scope: 'whanext:router',
      message: 'visible',
    });
  });

  it('redacts secrets and serializes errors and circular objects', () => {
    const entries: LogEntry[] = [];
    const logger = new Logger({
      level: 'debug',
      writer: (entry) => entries.push(entry),
    });
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    logger.error('failure', {
      phone: '5511999999999',
      nested: {
        accessToken: 'secret',
        phoneNumber: '5511888888888',
      },
      error: new Error('Unavailable'),
      circular,
    });

    expect(entries[0]?.context).toEqual({
      phone: '[REDACTED]',
      nested: {
        accessToken: '[REDACTED]',
        phoneNumber: '[REDACTED]',
      },
      error: { name: 'Error', message: 'Unavailable' },
      circular: { self: '[Circular]' },
    });
  });

  it('never lets a custom writer interrupt the application', () => {
    const logger = new Logger({
      writer() {
        throw new Error('Writer failed.');
      },
    });

    expect(() => logger.info('safe')).not.toThrow();
  });

  it('rejects invalid runtime configuration with a stable error', () => {
    expect(() => new Logger('verbose' as LogEntry['level']))
      .toThrow(expect.objectContaining({ code: 'ARGUMENT_INVALID' }));
  });
});
