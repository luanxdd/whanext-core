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
  const generateWAMessageFromContent = vi.fn((jid: string, message: unknown) => ({
    key: {
      id: 'interactive-message-id',
      remoteJid: jid,
      fromMe: true,
    },
    message,
  }));
  const relayMessage = vi.fn(async () => 'interactive-message-id');
  const socket = {
    user: { id: '5511999999999:1@s.whatsapp.net' },
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
    relayMessage,
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
    generateWAMessageFromContent,
    relayMessage,
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
  generateWAMessageFromContent: mocks.generateWAMessageFromContent,
  isJidGroup: (jid: string) => jid.endsWith('@g.us'),
  makeWASocket: (options: unknown) => {
    mocks.socketOptions.push(options);
    return mocks.socket;
  },
  proto: {
    Message: {
      InteractiveMessage: {
        create: (value: unknown) => value,
      },
    },
    PinInChat: { Type: { PIN_FOR_ALL: 1, UNPIN_FOR_ALL: 2 } },
  },
  useMultiFileAuthState: async () => ({
    state: { creds: { registered: false } },
    saveCreds: async () => undefined,
  }),
  extractMessageContent: (message: unknown) => message,
  getContentType: (message: Record<string, unknown>) => Object.keys(message)[0],
  normalizeMessageContent: (message: unknown) => {
    let current = message as Record<string, any> | undefined;

    for (let index = 0; index < 5; index += 1) {
      const nested = current?.editedMessage?.message
        ?? current?.ephemeralMessage?.message
        ?? current?.viewOnceMessage?.message
        ?? current?.viewOnceMessageV2?.message
        ?? current?.viewOnceMessageV2Extension?.message;

      if (!nested) break;
      current = nested;
    }

    return current;
  },
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

  it('sends copy and link buttons through a native flow interactive message', async () => {
    const provider = new BaileysProvider({ auth: './session', browser: Browser.Windows });
    await provider.connect();

    const sent = await provider.sendMessage('123@g.us', {
      title: 'Acesso',
      text: 'Escolha uma ação.',
      footer: 'WhaNext',
      buttons: [
        { type: 'copy', label: 'Copiar código', code: 'ABC-123' },
        { type: 'link', label: 'Abrir painel', url: 'https://example.com' },
      ],
    });

    expect(mocks.generateWAMessageFromContent).toHaveBeenCalledWith(
      '123@g.us',
      {
        interactiveMessage: {
          header: { title: 'Acesso', hasMediaAttachment: false },
          body: { text: 'Escolha uma ação.' },
          footer: { text: 'WhaNext' },
          nativeFlowMessage: {
            buttons: [
              {
                name: 'cta_copy',
                buttonParamsJson: JSON.stringify({
                  display_text: 'Copiar código',
                  copy_code: 'ABC-123',
                }),
              },
              {
                name: 'cta_url',
                buttonParamsJson: JSON.stringify({
                  display_text: 'Abrir painel',
                  url: 'https://example.com',
                  merchant_url: 'https://example.com',
                }),
              },
            ],
            messageParamsJson: '{}',
            messageVersion: 1,
          },
        },
      },
      { userJid: '5511999999999:1@s.whatsapp.net' },
    );
    expect(mocks.relayMessage).toHaveBeenCalledWith(
      '123@g.us',
      expect.objectContaining({ interactiveMessage: expect.any(Object) }),
      {
        messageId: 'interactive-message-id',
        additionalNodes: [
          {
            tag: 'biz',
            attrs: {
              actual_actors: '2',
              host_storage: '2',
              privacy_mode_ts: expect.any(String),
            },
            content: [
              {
                tag: 'interactive',
                attrs: { type: 'native_flow', v: '1' },
                content: [
                  {
                    tag: 'native_flow',
                    attrs: { v: '9', name: 'mixed' },
                  },
                ],
              },
              {
                tag: 'quality_control',
                attrs: { source_type: 'third_party' },
              },
            ],
          },
        ],
      },
    );
    expect(sent.id).toBe('interactive-message-id');
  });

  it('keeps reply context when sending buttons', async () => {
    const provider = new BaileysProvider({ auth: './session', browser: Browser.Windows });
    await provider.connect();

    await provider.sendMessage(
      '123@g.us',
      {
        text: 'Copie abaixo.',
        buttons: [{ type: 'copy', label: 'Copiar', code: '123456' }],
      },
      {
        id: 'quoted-id',
        chatId: '123@g.us',
        fromMe: false,
        participantId: '200000000000001@lid',
      },
    );

    expect(mocks.generateWAMessageFromContent).toHaveBeenLastCalledWith(
      '123@g.us',
      expect.any(Object),
      {
        userJid: '5511999999999:1@s.whatsapp.net',
        quoted: {
          key: {
            id: 'quoted-id',
            remoteJid: '123@g.us',
            fromMe: false,
            participant: '200000000000001@lid',
          },
          message: { conversation: '' },
        },
      },
    );
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

  it('emits deleted messages with the original cached payload', async () => {
    const provider = new BaileysProvider({ auth: './session', browser: Browser.Windows });
    await provider.connect();
    const onDeleted = vi.fn();
    provider.on('messageDeleted', onDeleted);
    const emitMessages = mocks.handlers.get('messages.upsert') as
      | ((update: unknown) => void)
      | undefined;
    const emitUpdates = mocks.handlers.get('messages.update') as
      | ((updates: unknown[]) => void)
      | undefined;

    emitMessages?.({
      type: 'notify',
      messages: [{
        key: {
          id: 'deleted-1',
          remoteJid: '123@g.us',
          participant: '200000000000001@lid',
          fromMe: false,
        },
        pushName: 'Luan',
        messageTimestamp: 1_700_000_000,
        message: { conversation: 'mensagem original' },
      }],
    });

    emitUpdates?.([{
      key: {
        id: 'deleted-1',
        remoteJid: '123@g.us',
        participant: '200000000000001@lid',
        fromMe: false,
      },
      update: {
        message: null,
        key: {
          id: 'revoke-1',
          remoteJid: '123@g.us',
          participant: '200000000000001@lid',
          fromMe: false,
        },
      },
    }]);

    expect(onDeleted).toHaveBeenCalledOnce();
    expect(onDeleted).toHaveBeenCalledWith(expect.objectContaining({
      key: {
        id: 'deleted-1',
        chatId: '123@g.us',
        fromMe: false,
        participantId: '200000000000001@lid',
      },
      deletedByMe: false,
      deletedById: '200000000000001@lid',
      deletedAt: expect.any(Date),
      message: expect.objectContaining({
        id: 'deleted-1',
        chatId: '123@g.us',
        text: 'mensagem original',
        senderId: '200000000000001@lid',
      }),
    }));
  });

  it('emits deletion metadata even when the original message is no longer cached', async () => {
    const provider = new BaileysProvider({ auth: './session', browser: Browser.Windows });
    await provider.connect();
    const onDeleted = vi.fn();
    provider.on('messageDeleted', onDeleted);
    const emitUpdates = mocks.handlers.get('messages.update') as
      | ((updates: unknown[]) => void)
      | undefined;

    emitUpdates?.([{
      key: {
        id: 'missing-1',
        remoteJid: '5511888888888@s.whatsapp.net',
        fromMe: false,
      },
      update: {
        message: null,
        key: {
          id: 'revoke-2',
          remoteJid: '5511888888888@s.whatsapp.net',
          fromMe: false,
        },
      },
    }]);

    expect(onDeleted).toHaveBeenCalledWith(expect.objectContaining({
      key: {
        id: 'missing-1',
        chatId: '5511888888888@s.whatsapp.net',
        fromMe: false,
      },
      deletedByMe: false,
      deletedById: '5511888888888@s.whatsapp.net',
      deletedAt: expect.any(Date),
    }));
    expect(onDeleted.mock.calls[0]?.[0]).not.toHaveProperty('message');
  });

  it('emits edited messages with the previous cached version', async () => {
    const provider = new BaileysProvider({ auth: './session', browser: Browser.Windows });
    await provider.connect();
    const onEdited = vi.fn();
    provider.on('messageEdited', onEdited);
    const emitMessages = mocks.handlers.get('messages.upsert') as
      | ((update: unknown) => void)
      | undefined;
    const emitUpdates = mocks.handlers.get('messages.update') as
      | ((updates: unknown[]) => void)
      | undefined;

    emitMessages?.({
      type: 'notify',
      messages: [{
        key: {
          id: 'edited-1',
          remoteJid: '123@g.us',
          participant: '200000000000001@lid',
          fromMe: false,
        },
        pushName: 'Luan',
        messageTimestamp: 1_700_000_000,
        message: { conversation: 'antes' },
      }],
    });

    emitUpdates?.([{
      key: {
        id: 'edited-1',
        remoteJid: '123@g.us',
        participant: '200000000000001@lid',
        fromMe: false,
      },
      update: {
        message: {
          editedMessage: {
            message: { conversation: 'depois' },
          },
        },
        messageTimestamp: 1_700_000_100,
      },
    }]);

    expect(onEdited).toHaveBeenCalledOnce();
    expect(onEdited).toHaveBeenCalledWith(expect.objectContaining({
      key: {
        id: 'edited-1',
        chatId: '123@g.us',
        fromMe: false,
        participantId: '200000000000001@lid',
      },
      editedByMe: false,
      editedById: '200000000000001@lid',
      editedAt: new Date(1_700_000_100 * 1_000),
      previous: expect.objectContaining({
        text: 'antes',
      }),
      message: expect.objectContaining({
        id: 'edited-1',
        text: 'depois',
        senderId: '200000000000001@lid',
      }),
    }));
  });

  it('keeps the latest edited version in the recent-message cache', async () => {
    const provider = new BaileysProvider({ auth: './session', browser: Browser.Windows });
    await provider.connect();
    const onEdited = vi.fn();
    provider.on('messageEdited', onEdited);
    const emitMessages = mocks.handlers.get('messages.upsert') as
      | ((update: unknown) => void)
      | undefined;
    const emitUpdates = mocks.handlers.get('messages.update') as
      | ((updates: unknown[]) => void)
      | undefined;

    emitMessages?.({
      type: 'notify',
      messages: [{
        key: {
          id: 'edited-chain',
          remoteJid: '5511888888888@s.whatsapp.net',
          fromMe: false,
        },
        messageTimestamp: 1_700_000_000,
        message: { conversation: 'primeira' },
      }],
    });

    emitUpdates?.([{
      key: {
        id: 'edited-chain',
        remoteJid: '5511888888888@s.whatsapp.net',
        fromMe: false,
      },
      update: {
        message: { editedMessage: { message: { conversation: 'segunda' } } },
        messageTimestamp: 1_700_000_100,
      },
    }]);

    emitUpdates?.([{
      key: {
        id: 'edited-chain',
        remoteJid: '5511888888888@s.whatsapp.net',
        fromMe: false,
      },
      update: {
        message: { editedMessage: { message: { conversation: 'terceira' } } },
        messageTimestamp: 1_700_000_200,
      },
    }]);

    expect(onEdited).toHaveBeenCalledTimes(2);
    expect(onEdited.mock.calls[1]?.[0]).toMatchObject({
      previous: { text: 'segunda' },
      message: { text: 'terceira' },
    });
  });

  it('emits edited content even when the previous version is no longer cached', async () => {
    const provider = new BaileysProvider({ auth: './session', browser: Browser.Windows });
    await provider.connect();
    const onEdited = vi.fn();
    provider.on('messageEdited', onEdited);
    const emitUpdates = mocks.handlers.get('messages.update') as
      | ((updates: unknown[]) => void)
      | undefined;

    emitUpdates?.([{
      key: {
        id: 'edited-missing',
        remoteJid: '5511888888888@s.whatsapp.net',
        fromMe: false,
      },
      update: {
        message: { editedMessage: { message: { conversation: 'nova versão' } } },
        messageTimestamp: 1_700_000_300,
      },
    }]);

    expect(onEdited).toHaveBeenCalledWith(expect.objectContaining({
      editedByMe: false,
      editedById: '5511888888888@s.whatsapp.net',
      message: expect.objectContaining({
        id: 'edited-missing',
        text: 'nova versão',
      }),
    }));
    expect(onEdited.mock.calls[0]?.[0]).not.toHaveProperty('previous');
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
