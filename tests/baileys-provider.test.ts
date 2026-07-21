import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (payload: never) => void>();
  const socketOptions: unknown[] = [];
  const waitForConnectionUpdate = vi.fn(async () => undefined);
  const requestPairingCode = vi.fn(async () => '1234-5678');
  const socket = {
    ev: {
      on: vi.fn((event: string, listener: (payload: never) => void) => {
        handlers.set(event, listener);
      }),
    },
    end: vi.fn(async () => undefined),
    rejectCall: vi.fn(async () => undefined),
    waitForConnectionUpdate,
    requestPairingCode,
    groupMetadata: vi.fn(async () => ({
      id: '123@g.us',
      subject: 'WhaNext',
      announce: false,
      addressingMode: 'lid',
      participants: [{
        id: '200000000000001@lid',
        phoneNumber: '5511000000000@s.whatsapp.net',
        isAdmin: true,
        admin: null,
      }],
    })),
  };

  return {
    handlers,
    requestPairingCode,
    socket,
    socketOptions,
    waitForConnectionUpdate,
  };
});

vi.mock('@whiskeysockets/baileys', () => ({
  Browsers: {
    windows: () => ['Windows', 'Chrome', '1'],
    macOS: () => ['Mac OS', 'Chrome', '1'],
    ubuntu: () => ['Ubuntu', 'Chrome', '1'],
  },
  DisconnectReason: {
    connectionClosed: 428,
    connectionReplaced: 440,
    loggedOut: 401,
    badSession: 500,
  },
  makeWASocket: (options: unknown) => {
    mocks.socketOptions.push(options);
    return mocks.socket;
  },
  proto: { PinInChat: { Type: { PIN_FOR_ALL: 1, UNPIN_FOR_ALL: 2 } } },
  useMultiFileAuthState: async () => ({
    state: { creds: { registered: false } },
    saveCreds: async () => undefined,
  }),
  extractMessageContent: vi.fn(),
  getContentType: vi.fn(),
  normalizeMessageContent: vi.fn(),
}));

import { Browser } from '@/auth/browser.js';
import {
  Logger,
  type LogEntry,
} from '@/logger/logger.js';
import { BaileysProvider } from '@/provider/baileys/baileys-provider.js';

describe('BaileysProvider pairing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handlers.clear();
    mocks.socketOptions.length = 0;
  });

  it('waits for the authentication challenge before requesting a pairing code', async () => {
    const provider = new BaileysProvider({ auth: './session', browser: Browser.Windows });
    await provider.connect();

    const code = await provider.requestPairingCode('5511999999999');

    expect(code).toBe('1234-5678');
    expect(mocks.waitForConnectionUpdate).toHaveBeenCalledOnce();
    expect(mocks.requestPairingCode).toHaveBeenCalledOnce();
    expect(mocks.waitForConnectionUpdate.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.requestPairingCode.mock.invocationCallOrder[0] ?? 0);
  });

  it('does not mark partial credentials as a registered session', async () => {
    const provider = new BaileysProvider({ auth: './session', browser: Browser.Windows });
    await provider.connect();
    const updateCredentials = mocks.handlers.get('creds.update') as
      | ((update: { registered?: boolean }) => void)
      | undefined;

    updateCredentials?.({ registered: false });
    const code = await provider.requestPairingCode('5511999999999');

    expect(code).toBe('1234-5678');
    expect(mocks.requestPairingCode).toHaveBeenCalledOnce();
  });

  it('maps LID addressing and boolean admin metadata', async () => {
    const provider = new BaileysProvider({ auth: './session', browser: Browser.Windows });
    await provider.connect();

    const group = await provider.getGroup('123@g.us');

    expect(group.addressingMode).toBe('lid');
    expect(group.participants[0]).toMatchObject({
      id: '200000000000001@lid',
      phoneNumber: '5511000000000@s.whatsapp.net',
      role: 'admin',
    });
  });

  it('routes sanitized provider logs through the public logger', async () => {
    const entries: LogEntry[] = [];
    const logger = new Logger({
      level: 'debug',
      writer: (entry) => entries.push(entry),
    });
    const provider = new BaileysProvider({
      auth: './session',
      browser: Browser.Windows,
      logger: logger.child('provider'),
    });
    await provider.connect();
    const options = mocks.socketOptions[0] as {
      logger: {
        child(context: Record<string, unknown>): {
          info(value: unknown, message?: string): void;
        };
      };
    };

    options.logger.child({ class: 'socket' }).info({
      helloMsg: { ephemeral: 'private-value' },
      statusCode: 200,
    }, 'Provider connected');

    expect(entries[0]).toMatchObject({
      level: 'debug',
      message: 'Provider connected',
      context: { statusCode: 200 },
    });
    expect(JSON.stringify(entries[0])).not.toContain('private-value');
  });

  it('normalizes and emits call events received from the socket', async () => {
    const provider = new BaileysProvider({ auth: './session', browser: Browser.Windows });
    await provider.connect();
    const onCall = vi.fn();
    provider.on('call', onCall);

    const emitCall = mocks.handlers.get('call') as
      | ((calls: unknown[]) => void)
      | undefined;
    const date = new Date('2026-01-01T00:00:00.000Z');

    emitCall?.([{
      id: 'call-1',
      chatId: '5511999999999@s.whatsapp.net',
      from: '5511999999999@s.whatsapp.net',
      status: 'offer',
      isVideo: false,
      isGroup: false,
      date,
    }]);

    expect(onCall).toHaveBeenCalledWith({
      id: 'call-1',
      chatId: '5511999999999@s.whatsapp.net',
      from: '5511999999999@s.whatsapp.net',
      status: 'offer',
      isVideo: false,
      isGroup: false,
      date,
    });
  });

  it('normalizes an unknown call status to timeout', async () => {
    const provider = new BaileysProvider({ auth: './session', browser: Browser.Windows });
    await provider.connect();
    const onCall = vi.fn();
    provider.on('call', onCall);

    const emitCall = mocks.handlers.get('call') as
      | ((calls: unknown[]) => void)
      | undefined;

    emitCall?.([{
      id: 'call-2',
      chatId: '5511999999999@s.whatsapp.net',
      from: '5511999999999@s.whatsapp.net',
      status: 'terminate',
      isVideo: false,
      isGroup: false,
      date: new Date(),
    }]);

    expect(onCall).toHaveBeenCalledWith(expect.objectContaining({ status: 'timeout' }));
  });

  it('delegates rejectCall to the underlying socket', async () => {
    const provider = new BaileysProvider({ auth: './session', browser: Browser.Windows });
    await provider.connect();

    await provider.rejectCall('call-1', '5511999999999@s.whatsapp.net');

    expect(mocks.socket.rejectCall).toHaveBeenCalledWith(
      'call-1',
      '5511999999999@s.whatsapp.net',
    );
  });
});
