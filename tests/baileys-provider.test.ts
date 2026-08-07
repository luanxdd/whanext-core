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
  const sendPresenceUpdate = vi.fn(async () => undefined);
  const presenceSubscribe = vi.fn(async () => undefined);
  const downloadMediaMessage = vi.fn(async () => Buffer.from('media-bytes'));
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
    sendPresenceUpdate,
    presenceSubscribe,
    downloadMediaMessage,
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
    updateMediaMessage: vi.fn(async (message: unknown) => message),
  };

  return {
    handlers,
    requestPairingCode,
    sendPresenceUpdate,
    presenceSubscribe,
    downloadMediaMessage,
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
  downloadMediaMessage: mocks.downloadMediaMessage,
  makeWASocket: (options: unknown) => {
    mocks.socketOptions.push(options);
    return mocks.socket;
  },
  proto: { PinInChat: { Type: { PIN_FOR_ALL: 1, UNPIN_FOR_ALL: 2 } } },
  useMultiFileAuthState: async () => ({
    state: { creds: { registered: false } },
    saveCreds: async () => undefined,
  }),
  extractMessageContent: (message: unknown) => message,
  getContentType: (message: Record<string, unknown>) => Object.keys(message)[0],
  normalizeMessageContent: (message: unknown) => message,
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

  it('feeds bounded group metadata cache into Baileys message sending', async () => {
    const provider = new BaileysProvider({ auth: './session', browser: Browser.Windows });
    await provider.connect();
    const options = mocks.socketOptions[0] as {
      cachedGroupMetadata(jid: string): Promise<unknown>;
    };

    const [first, second, third] = await Promise.all([
      options.cachedGroupMetadata('123@g.us'),
      options.cachedGroupMetadata('123@g.us'),
      options.cachedGroupMetadata('123@g.us'),
    ]);
    const fourth = await options.cachedGroupMetadata('123@g.us');

    expect(first).toBe(second);
    expect(second).toBe(third);
    expect(third).toBe(fourth);
    expect(mocks.socket.groupMetadata).toHaveBeenCalledOnce();
  });

  it('invalidates provider metadata when a group event arrives', async () => {
    const provider = new BaileysProvider({ auth: './session', browser: Browser.Windows });
    await provider.connect();
    const options = mocks.socketOptions[0] as {
      cachedGroupMetadata(jid: string): Promise<unknown>;
    };
    const emitGroups = mocks.handlers.get('groups.update') as
      | ((groups: Array<{ id: string }>) => void)
      | undefined;

    await options.cachedGroupMetadata('123@g.us');
    emitGroups?.([{ id: '123@g.us' }]);
    await options.cachedGroupMetadata('123@g.us');

    expect(mocks.socket.groupMetadata).toHaveBeenCalledTimes(2);
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

  it('sends chat presence directly without subscribing first', async () => {
    const provider = new BaileysProvider({ auth: './session', browser: Browser.Windows });
    await provider.connect();

    await provider.setPresence('5511999999999@s.whatsapp.net', 'typing');
    await provider.setPresence('5511999999999@s.whatsapp.net', 'recording');
    await provider.setPresence('5511999999999@s.whatsapp.net', 'paused');

    expect(mocks.presenceSubscribe).not.toHaveBeenCalled();
    expect(mocks.sendPresenceUpdate).toHaveBeenNthCalledWith(
      1,
      'composing',
      '5511999999999@s.whatsapp.net',
    );
    expect(mocks.sendPresenceUpdate).toHaveBeenNthCalledWith(
      2,
      'recording',
      '5511999999999@s.whatsapp.net',
    );
    expect(mocks.sendPresenceUpdate).toHaveBeenNthCalledWith(
      3,
      'paused',
      '5511999999999@s.whatsapp.net',
    );
  });

  it('downloads cached media without exposing Baileys messages', async () => {
    const provider = new BaileysProvider({ auth: './session', browser: Browser.Windows });
    await provider.connect();
    const emitMessages = mocks.handlers.get('messages.upsert') as
      | ((update: unknown) => void)
      | undefined;

    emitMessages?.({
      type: 'notify',
      messages: [{
        key: {
          id: 'media-1',
          remoteJid: '5511999999999@s.whatsapp.net',
          fromMe: false,
        },
        message: {
          imageMessage: {
            url: 'https://example.com/media',
            mimetype: 'image/jpeg',
          },
        },
      }],
    });

    const options = mocks.socketOptions[0] as {
      getMessage(key: { id: string; remoteJid: string }): Promise<unknown>;
    };

    expect(await options.getMessage({
      id: 'media-1',
      remoteJid: '5511999999999@s.whatsapp.net',
    })).toMatchObject({ imageMessage: { mimetype: 'image/jpeg' } });

    const media = await provider.downloadMedia({
      id: 'media-1',
      chatId: '5511999999999@s.whatsapp.net',
      fromMe: false,
    });

    expect(media).toMatchObject({ kind: 'image', mimetype: 'image/jpeg' });
    expect(media.data.toString()).toBe('media-bytes');
    expect(mocks.downloadMediaMessage).toHaveBeenCalledOnce();
  });

  it('downloads quoted view-once media from the payload carried by the reply', async () => {
    const provider = new BaileysProvider({ auth: './session', browser: Browser.Windows });
    await provider.connect();
    const emitMessages = mocks.handlers.get('messages.upsert') as
      | ((update: unknown) => void)
      | undefined;

    emitMessages?.({
      type: 'notify',
      messages: [{
        key: {
          id: 'command-1',
          remoteJid: '123@g.us',
          participant: '5511999999999@s.whatsapp.net',
          fromMe: false,
        },
        message: {
          extendedTextMessage: {
            text: '&fig',
            contextInfo: {
              stanzaId: 'view-once-1',
              participant: '5511888888888@s.whatsapp.net',
              quotedMessage: {
                viewOnceMessageV2Extension: {
                  message: {
                    imageMessage: {
                      url: 'https://example.com/view-once',
                      mimetype: 'image/jpeg',
                      viewOnce: true,
                    },
                  },
                },
              },
            },
          },
        },
      }],
    });

    const media = await provider.downloadMedia({
      id: 'view-once-1',
      chatId: '123@g.us',
      fromMe: false,
      participantId: '5511888888888@s.whatsapp.net',
    });

    expect(media).toMatchObject({ kind: 'image', mimetype: 'image/jpeg' });
    expect(media.data.toString()).toBe('media-bytes');
    expect(mocks.downloadMediaMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        key: expect.objectContaining({ id: 'view-once-1', remoteJid: '123@g.us' }),
        message: expect.objectContaining({ viewOnceMessageV2Extension: expect.any(Object) }),
      }),
      'buffer',
      {},
      expect.any(Object),
    );
  });

  it('normalizes participant changes received from the socket', async () => {
    const provider = new BaileysProvider({ auth: './session', browser: Browser.Windows });
    await provider.connect();
    const onChange = vi.fn();
    provider.on('groupParticipantsChanged', onChange);
    const emitChange = mocks.handlers.get('group-participants.update') as
      | ((change: unknown) => void)
      | undefined;

    emitChange?.({
      id: '123@g.us',
      action: 'promote',
      author: '5511999999999@s.whatsapp.net',
      participants: [{ id: '5511000000000@s.whatsapp.net' }],
    });

    expect(onChange).toHaveBeenCalledWith({
      groupId: '123@g.us',
      action: 'promote',
      participantIds: ['5511000000000@s.whatsapp.net'],
      authorId: '5511999999999@s.whatsapp.net',
    });
  });
});
