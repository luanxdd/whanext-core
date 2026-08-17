import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { Browser } from '@/auth/browser.js';
import { ZapoProvider } from '@/provider/zapo/zapo-provider.js';

const { mocks, MockClient } = vi.hoisted(() => {
  type Listener = (payload: any) => unknown;

  const mocks = {
    clients: [] as any[],
    storeOptions: [] as unknown[],
    sqliteOptions: [] as unknown[],
    stores: [] as any[],
    nextAuthEvent: 'pairing' as 'pairing' | 'qr',
  };

  class MockClient {
    readonly listeners = new Map<string, Listener[]>();
    readonly sent: Array<{ to: string; content: unknown; options?: unknown }> = [];
    readonly credentials: { meJid?: string; meLid?: string } = {};
    readonly auth = {
      requestPairingCode: vi.fn(async (_phone: string) => '12345678'),
    };
    readonly message = {
      send: vi.fn(async (to: string, content: unknown, options?: unknown) => {
        this.sent.push({ to, content, ...(options === undefined ? {} : { options }) });
        return { id: `sent-${this.sent.length}` };
      }),
      downloadBytes: vi.fn(async () => new Uint8Array([1, 2, 3])),
    };
    readonly group = {
      queryGroupMetadata: vi.fn(async () => ({
        jid: '123@g.us',
        subject: 'WhaNext',
        announce: false,
        addressingMode: 'lid',
        participants: [
          {
            jid: '100@lid',
            lid: '100@lid',
            phoneNumber: '5511000000000@s.whatsapp.net',
            isAdmin: true,
            isSuperAdmin: false,
          },
        ],
      })),
      setSetting: vi.fn(async () => undefined),
      queryInviteCode: vi.fn(async () => 'invite-code'),
      revokeInvite: vi.fn(async () => ({ code: 'rotated-code' })),
      removeParticipants: vi.fn(async (_group: string, jids: string[]) =>
        jids.map((jid) => ({ jid, status: 'ok' }))),
      promoteParticipants: vi.fn(async (_group: string, jids: string[]) =>
        jids.map((jid) => ({ jid, status: 'ok' }))),
      demoteParticipants: vi.fn(async (_group: string, jids: string[]) =>
        jids.map((jid) => ({ jid, status: 'ok' }))),
    };
    readonly presence = {
      sendChatstate: vi.fn(async () => undefined),
    };
    readonly lowlevel = {
      sendNode: vi.fn(async (_node: unknown) => undefined),
    };
    readonly options: unknown;
    readonly logger: unknown;

    constructor(options: unknown, logger: unknown) {
      this.options = options;
      this.logger = logger;
      mocks.clients.push(this);
    }

    on(event: string, listener: Listener): this {
      const listeners = this.listeners.get(event) ?? [];
      listeners.push(listener);
      this.listeners.set(event, listeners);
      return this;
    }

    emit(event: string, payload: unknown): void {
      for (const listener of this.listeners.get(event) ?? []) {
        void listener(payload);
      }
    }

    connect = vi.fn(async () => {
      if (mocks.nextAuthEvent === 'qr') {
        this.emit('auth_qr', { qr: 'mock-qr', ttlMs: 60_000 });
      } else {
        this.emit('auth_pairing_required', { forceManual: true });
      }
      await new Promise<void>(() => undefined);
    });

    disconnect = vi.fn(async () => {
      this.emit('connection', { status: 'close' });
    });

    getCredentials(): typeof this.credentials {
      return this.credentials;
    }
  }

  return { mocks, MockClient };
});

type MockClientInstance = InstanceType<typeof MockClient>;

vi.mock('zapo-js', () => ({
  WaClient: MockClient,
  createStore: vi.fn((options: unknown) => {
    mocks.storeOptions.push(options);
    const records = new Map<string, Map<string, any>>();
    const sessions = new Map<string, any>();
    const store = {
      options,
      session: vi.fn((sessionId: string) => {
        const existing = sessions.get(sessionId);
        if (existing) return existing;
        const messages = records.get(sessionId) ?? new Map<string, any>();
        records.set(sessionId, messages);
        const session = {
          messages: {
            upsert: vi.fn(async (record: any) => {
              messages.set(record.id, record);
            }),
            getById: vi.fn(async (id: string) => messages.get(id)),
            deleteById: vi.fn(async (id: string) => {
              messages.delete(id);
            }),
            clear: vi.fn(async () => messages.clear()),
            listByThread: vi.fn(async () => []),
            upsertBatch: vi.fn(async (items: any[]) => {
              for (const record of items) messages.set(record.id, record);
            }),
          },
          destroy: vi.fn(async () => undefined),
        };
        sessions.set(sessionId, session);
        return session;
      }),
      destroy: vi.fn(async () => undefined),
    };
    mocks.stores.push(store);
    return store;
  }),
  proto: {
    Message: {
      encode: vi.fn((message: unknown) => ({
        finish: () => new TextEncoder().encode(JSON.stringify(message)),
      })),
      decode: vi.fn((bytes: Uint8Array) => JSON.parse(new TextDecoder().decode(bytes))),
      ProtocolMessage: {
        Type: {
          REVOKE: 0,
          MESSAGE_EDIT: 14,
        },
      },
      ListMessage: {
        ListType: {
          SINGLE_SELECT: 1,
        },
      },
    },
  },
}));

vi.mock('@zapo-js/store-sqlite', () => ({
  createSqliteStore: vi.fn((options: unknown) => {
    mocks.sqliteOptions.push(options);
    return { kind: 'sqlite', options };
  }),
}));

vi.mock('@zapo-js/media-utils', () => ({
  createMediaProcessor: vi.fn(() => ({ kind: 'media-processor' })),
}));

function client(): MockClientInstance {
  const current = mocks.clients.at(-1);
  if (!current) throw new Error('Mock WaClient was not created.');
  return current;
}

async function connectedProvider(options: ConstructorParameters<typeof ZapoProvider>[0] = {
  auth: './session',
  browser: Browser.Windows,
}): Promise<{ provider: ZapoProvider; client: MockClientInstance }> {
  const provider = new ZapoProvider(options);
  await provider.connect();
  const current = client();
  current.emit('connection', { status: 'open', isNewLogin: false });
  await flushAsync();
  return { provider, client: current };
}

async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  mocks.clients.length = 0;
  mocks.storeOptions.length = 0;
  mocks.sqliteOptions.length = 0;
  mocks.stores.length = 0;
  mocks.nextAuthEvent = 'pairing';
  vi.clearAllMocks();
});

describe('ZapoProvider', () => {
  it('creates a persistent SQLite Zapo store with mailbox and full history sync', async () => {
    const provider = new ZapoProvider({
      auth: './accounts/main',
      browser: Browser.MacOS,
      sessionId: 'main',
    });

    await provider.connect();

    expect(mocks.sqliteOptions[0]).toMatchObject({
      path: expect.stringMatching(/accounts[\\/]state\.sqlite$/),
      driver: 'auto',
    });
    expect(mocks.storeOptions[0]).toMatchObject({
      providers: {
        auth: 'sqlite',
        signal: 'sqlite',
        preKey: 'sqlite',
        session: 'sqlite',
        identity: 'sqlite',
        senderKey: 'sqlite',
        appState: 'sqlite',
        privacyToken: 'sqlite',
        messages: 'sqlite',
        threads: 'sqlite',
        contacts: 'sqlite',
      },
      cacheProviders: {
        messageSecret: 'sqlite',
      },
    });
    expect(client().options).toMatchObject({
      sessionId: 'main',
      deviceBrowser: 'safari',
      deviceOsDisplayName: 'macOS',
      markOnlineOnConnect: false,
      history: { enabled: true, requireFullSync: true },
      addons: {
        autoDecrypt: true,
        persistAllSecrets: true,
      },
    });
    await provider.disconnect();
  });

  it('requests a pairing code only after the pairing challenge', async () => {
    const provider = new ZapoProvider({ auth: './session', browser: Browser.Windows });

    await provider.connect();
    const code = await provider.requestPairingCode('+55 (31) 99999-9999');

    expect(code).toBe('12345678');
    expect(client().auth.requestPairingCode).toHaveBeenCalledWith('5531999999999');
  });

  it('requests a pairing code when the QR flow becomes ready first', async () => {
    mocks.nextAuthEvent = 'qr';
    const provider = new ZapoProvider({ auth: './session', browser: Browser.Windows });

    await provider.connect();
    const code = await provider.requestPairingCode('+55 (31) 99999-9999');

    expect(code).toBe('12345678');
    expect(client().auth.requestPairingCode).toHaveBeenCalledWith('5531999999999');
  });

  it('keeps public account identities from Zapo credentials', async () => {
    const provider = new ZapoProvider({ auth: './session', browser: Browser.Windows });
    await provider.connect();
    client().credentials.meJid = '5531999999999@s.whatsapp.net';
    client().credentials.meLid = '100000000000001@lid';

    expect(provider.getCurrentUserIds()).toEqual([
      '5531999999999@s.whatsapp.net',
      '100000000000001@lid',
    ]);
  });

  it('sends text, reactions, edits, revokes and pins with Zapo message builders', async () => {
    const { provider, client: current } = await connectedProvider();
    const key = {
      id: 'message-1',
      chatId: '123@g.us',
      fromMe: true,
      participantId: '100@lid',
    };

    await provider.sendMessage('123@g.us', {
      text: 'oi',
      mentions: ['100@lid'],
    }, key);
    await provider.reactToMessage(key, '❤️');
    await provider.editMessage(key, 'novo texto');
    await provider.deleteMessage(key);
    await provider.setMessagePin('123@g.us', key, true);
    await provider.setMessagePin('123@g.us', key, false);

    expect(current.message.send).toHaveBeenNthCalledWith(
      1,
      '123@g.us',
      { type: 'text', text: 'oi' },
      {
        quote: {
          id: 'message-1',
          remoteJid: '123@g.us',
          fromMe: true,
          participant: '100@lid',
        },
        mentions: ['100@lid'],
      },
    );
    expect(current.message.send).toHaveBeenNthCalledWith(2, '123@g.us', {
      type: 'reaction',
      emoji: '❤️',
      target: expect.objectContaining({ id: 'message-1' }),
    });
    expect(current.message.send).toHaveBeenNthCalledWith(
      3,
      '123@g.us',
      'novo texto',
      { editKey: expect.objectContaining({ id: 'message-1' }) },
    );
    expect(current.message.send).toHaveBeenNthCalledWith(4, '123@g.us', {
      type: 'revoke',
      target: expect.objectContaining({ id: 'message-1' }),
    });
    expect(current.message.send).toHaveBeenNthCalledWith(5, '123@g.us', {
      type: 'pin',
      target: expect.objectContaining({ id: 'message-1' }),
      durationSecs: 604_800,
    });
    expect(current.message.send).toHaveBeenNthCalledWith(6, '123@g.us', {
      type: 'unpin',
      target: expect.objectContaining({ id: 'message-1' }),
    });
  });

  it('sends Native Flow copy, link and quick-reply buttons without exposing Zapo proto', async () => {
    const { provider, client: current } = await connectedProvider();

    await provider.sendMessage('5511999999999@s.whatsapp.net', {
      buttons: [
        { type: 'copy', label: 'Copiar', code: 'ABCD-1234' },
        { type: 'link', label: 'Abrir', url: 'https://example.com' },
        { type: 'reply', label: 'Executar', id: '&open' },
      ],
      title: 'Acesso',
      text: 'Escolha:',
      footer: 'WhaNext',
    });

    expect(current.message.send).toHaveBeenCalledWith(
      '5511999999999@s.whatsapp.net',
      expect.objectContaining({
        interactiveMessage: expect.objectContaining({
          body: { text: 'Escolha:' },
          footer: { text: 'WhaNext' },
          nativeFlowMessage: expect.objectContaining({
            buttons: [
              expect.objectContaining({ name: 'cta_copy' }),
              expect.objectContaining({ name: 'cta_url' }),
              expect.objectContaining({ name: 'quick_reply' }),
            ],
          }),
        }),
      }),
      {},
    );
  });

  it('sends list menus and typed polls through Zapo', async () => {
    const { provider, client: current } = await connectedProvider();

    await provider.sendMessage('123@g.us', {
      title: 'Administração',
      text: 'Escolha uma ação.',
      buttonText: 'Ver opções',
      footer: 'WhaNext',
      list: [
        {
          title: 'Grupo',
          rows: [
            { id: '&open', title: 'Abrir grupo' },
            { id: '&close', title: 'Fechar grupo', description: 'Somente admins' },
          ],
        },
      ],
    });
    await provider.sendMessage('123@g.us', {
      poll: 'Verdade ou desafio?',
      options: ['Verdade', 'Desafio'],
      selectableCount: 1,
      allowAddOption: false,
    });

    expect(current.message.send).toHaveBeenNthCalledWith(
      1,
      '123@g.us',
      expect.objectContaining({
        interactiveMessage: expect.objectContaining({
          header: expect.objectContaining({ title: 'Administração' }),
          body: { text: 'Escolha uma ação.' },
          footer: { text: 'WhaNext' },
          nativeFlowMessage: expect.objectContaining({
            buttons: [
              expect.objectContaining({
                name: 'single_select',
                buttonParamsJson: expect.stringContaining('"title":"Ver opções"'),
              }),
            ],
          }),
        }),
      }),
      {},
    );
    expect(current.message.send).toHaveBeenNthCalledWith(
      2,
      '123@g.us',
      {
        type: 'poll',
        name: 'Verdade ou desafio?',
        options: ['Verdade', 'Desafio'],
        selectableCount: 1,
        allowAddOption: false,
      },
      {},
    );
  });

  it('rejects invalid interactive payloads before sending them', async () => {
    const { provider } = await connectedProvider();

    await expect(provider.sendMessage('123@g.us', {
      text: 'Ações',
      buttons: [{ type: 'reply', label: 'Abrir', id: '' }],
    })).rejects.toMatchObject({ code: 'ARGUMENT_INVALID' });

    await expect(provider.sendMessage('123@g.us', {
      text: 'Menu',
      buttonText: 'Abrir',
      list: [{ rows: [
        { id: 'same', title: 'A' },
        { id: 'same', title: 'B' },
      ] }],
    })).rejects.toMatchObject({ code: 'ARGUMENT_INVALID' });

    await expect(provider.sendMessage('123@g.us', {
      poll: 'Escolha',
      options: ['A', 'B'],
      selectableCount: 3,
    })).rejects.toMatchObject({ code: 'ARGUMENT_INVALID' });
  });

  it('normalizes list and native-flow response ids for command routing', async () => {
    const { provider, client: current } = await connectedProvider();
    const received: any[] = [];
    provider.on('message', (message) => { received.push(message); });
    const now = Math.floor(Date.now() / 1_000);

    current.emit('message', {
      key: { id: 'list-response', remoteJid: '123@g.us', participant: '100@lid', fromMe: false },
      message: {
        listResponseMessage: {
          title: 'Abrir grupo',
          singleSelectReply: { selectedRowId: '&open' },
        },
      },
      timestampSeconds: now,
    });
    current.emit('message', {
      key: { id: 'native-list-response', remoteJid: '123@g.us', participant: '100@lid', fromMe: false },
      message: {
        interactiveResponseMessage: {
          nativeFlowResponseMessage: {
            name: 'single_select',
            paramsJson: JSON.stringify({ id: '&close', title: 'Fechar grupo' }),
          },
        },
      },
      timestampSeconds: now,
    });
    current.emit('message', {
      key: { id: 'button-response', remoteJid: '123@g.us', participant: '100@lid', fromMe: false },
      message: {
        interactiveResponseMessage: {
          nativeFlowResponseMessage: {
            name: 'quick_reply',
            paramsJson: JSON.stringify({ id: 'a', display_text: 'Abrir' }),
          },
        },
      },
      timestampSeconds: now,
    });
    await flushAsync();

    expect(received[0]?.interactive).toEqual({ kind: 'list', id: '&open', title: 'Abrir grupo' });
    expect(received[1]?.interactive).toEqual({ kind: 'list', id: '&close', title: 'Fechar grupo' });
    expect(received[2]?.interactive).toEqual({ kind: 'button', id: 'a', title: 'Abrir' });
  });

  it('normalizes incoming poll questions as text', async () => {
    const { provider, client: current } = await connectedProvider();
    const received: any[] = [];
    provider.on('message', (message) => { received.push(message); });
    const now = Math.floor(Date.now() / 1_000);

    current.emit('message', {
      key: { id: 'poll-1', remoteJid: '123@g.us', participant: '100@lid', fromMe: false },
      message: {
        pollCreationMessageV3: {
          name: 'Qual opção?',
          options: [{ optionName: 'A' }, { optionName: 'B' }],
          selectableOptionsCount: 1,
        },
      },
      timestampSeconds: now,
    });
    await flushAsync();

    expect(received[0]?.contentKind).toBe('poll');
    expect(received[0]?.text).toBe('Qual opção?');
  });

  it('downloads cached incoming media', async () => {
    const { provider, client: current } = await connectedProvider();
    const now = Math.floor(Date.now() / 1_000);

    current.emit('message', {
      key: {
        id: 'image-1',
        remoteJid: '5511999999999@s.whatsapp.net',
        fromMe: false,
      },
      message: {
        imageMessage: {
          mimetype: 'image/jpeg',
        },
      },
      timestampSeconds: now,
    });

    const media = await provider.downloadMedia({
      id: 'image-1',
      chatId: '5511999999999@s.whatsapp.net',
      fromMe: false,
    });

    expect(media.kind).toBe('image');
    expect(media.mimetype).toBe('image/jpeg');
    expect([...media.data]).toEqual([1, 2, 3]);
    expect(current.message.downloadBytes).toHaveBeenCalledOnce();
  });

  it('downloads ordinary quoted media from the raw quoted proto payload', async () => {
    const { provider, client: current } = await connectedProvider();
    const received: any[] = [];
    provider.on('message', (message) => {
      received.push(message);
    });
    const now = Math.floor(Date.now() / 1_000);

    current.emit('message', {
      key: {
        id: 'converter-command',
        remoteJid: '5511999999999@s.whatsapp.net',
        fromMe: false,
      },
      message: {
        extendedTextMessage: {
          text: '&toimg',
          contextInfo: {
            stanzaId: 'quoted-sticker',
            participant: '5511888888888@s.whatsapp.net',
            quotedMessage: {
              stickerMessage: {
                mimetype: 'image/webp',
                directPath: '/mock/sticker',
                mediaKey: new Uint8Array([9, 8, 7]),
              },
            },
          },
        },
      },
      timestampSeconds: now,
    });
    await flushAsync();

    const media = await provider.downloadMedia(received[0].quoted.key);

    expect(media).toMatchObject({
      kind: 'sticker',
      mimetype: 'image/webp',
    });
    expect(current.message.downloadBytes).toHaveBeenCalledWith(
      expect.objectContaining({
        stickerMessage: expect.any(Object),
      }),
    );
  });

  it('caches and downloads quoted view-once media wrapped in viewOnceMessageV2Extension', async () => {
    const { provider, client: current } = await connectedProvider();
    const received: any[] = [];
    provider.on('message', (message) => {
      received.push(message);
    });
    const now = Math.floor(Date.now() / 1_000);

    current.emit('message', {
      key: {
        id: 'fig-command',
        remoteJid: '5511999999999@s.whatsapp.net',
        fromMe: false,
      },
      message: {
        extendedTextMessage: {
          text: '&fig',
          contextInfo: {
            stanzaId: 'quoted-view-once',
            participant: '5511888888888@s.whatsapp.net',
            quotedMessage: {
              viewOnceMessageV2Extension: {
                message: {
                  imageMessage: { mimetype: 'image/jpeg' },
                },
              },
            },
          },
        },
      },
      timestampSeconds: now,
    });
    await flushAsync();

    expect(received[0]?.quoted).toMatchObject({
      hasMedia: true,
      isViewOnce: true,
      contentKind: 'image',
    });

    const media = await provider.downloadMedia(received[0].quoted.key);

    expect(media).toMatchObject({
      kind: 'image',
      mimetype: 'image/jpeg',
    });
    expect([...media.data]).toEqual([1, 2, 3]);
    expect(current.message.downloadBytes).toHaveBeenCalledWith(
      expect.objectContaining({
        imageMessage: expect.objectContaining({ mimetype: 'image/jpeg' }),
      }),
    );
  });

  it('does not publish message events received before the live connection opens', async () => {
    const provider = new ZapoProvider({
      auth: './session',
      browser: Browser.Windows,
    });
    const received: string[] = [];
    provider.on('message', (message) => {
      received.push(message.id);
    });

    await provider.connect();
    const current = client();
    current.emit('message', {
      key: { id: 'bootstrap-old', remoteJid: '5511@s.whatsapp.net', fromMe: false },
      message: { conversation: 'mensagem de sincronização' },
      timestampSeconds: Math.floor(Date.now() / 1_000),
    });
    await flushAsync();

    expect(received).toEqual([]);

    current.emit('connection', { status: 'open', isNewLogin: false });
    current.emit('message', {
      key: { id: 'live-new', remoteJid: '5511@s.whatsapp.net', fromMe: false },
      message: { conversation: 'mensagem ao vivo' },
      timestampSeconds: Math.floor(Date.now() / 1_000),
    });
    await flushAsync();

    expect(received).toEqual(['live-new']);
  });

  it('keeps ignored bootstrap messages cached for a later live revoke', async () => {
    const provider = new ZapoProvider({
      auth: './session',
      browser: Browser.Windows,
    });
    const deleted: Array<{ id: string; text: string | undefined }> = [];
    provider.on('messageDeleted', (event) => {
      deleted.push({ id: event.key.id, text: event.message?.text });
    });

    await provider.connect();
    const current = client();
    current.emit('message', {
      key: { id: 'bootstrap-target', remoteJid: '5511@s.whatsapp.net', fromMe: false },
      message: { conversation: 'guardada sem publicar' },
      timestampSeconds: Math.floor(Date.now() / 1_000) - 60,
    });
    current.emit('connection', { status: 'open', isNewLogin: false });
    current.emit('message_protocol', {
      key: { id: 'live-revoke', remoteJid: '5511@s.whatsapp.net', fromMe: false },
      message: {},
      timestampSeconds: Math.floor(Date.now() / 1_000),
      protocolMessage: {
        type: 0,
        key: { id: 'bootstrap-target', remoteJid: '5511@s.whatsapp.net', fromMe: false },
      },
    });
    await flushAsync();

    expect(deleted).toEqual([{ id: 'bootstrap-target', text: 'guardada sem publicar' }]);
  });

  it('publishes each Zapo message id only once per provider runtime', async () => {
    const { provider, client: current } = await connectedProvider();
    const received: string[] = [];
    provider.on('message', (message) => {
      received.push(message.id);
    });
    const event = {
      key: { id: 'same-id', remoteJid: '5511@s.whatsapp.net', fromMe: false },
      message: { conversation: 'uma vez' },
      timestampSeconds: Math.floor(Date.now() / 1_000),
    };

    current.emit('message', event);
    current.emit('message', event);
    current.emit('message', event);
    await flushAsync();

    expect(received).toEqual(['same-id']);
  });

  it('ignores messages queued before the current connection by default', async () => {
    const { provider, client: current } = await connectedProvider();
    const received: string[] = [];
    provider.on('message', (message) => {
      received.push(message.id);
    });
    const now = Math.floor(Date.now() / 1_000);

    current.emit('message', {
      key: { id: 'old', remoteJid: '5511@s.whatsapp.net', fromMe: false },
      message: { conversation: ';spot velha' },
      timestampSeconds: now,
      offline: true,
    });
    current.emit('message', {
      key: { id: 'new', remoteJid: '5511@s.whatsapp.net', fromMe: false },
      message: { conversation: ';spot nova' },
      timestampSeconds: now,
      offline: false,
    });
    await flushAsync();

    expect(received).toEqual(['new']);
  });

  it('can opt into processing the offline backlog', async () => {
    const { provider, client: current } = await connectedProvider({
      auth: './session',
      browser: Browser.Windows,
      processOfflineMessages: true,
    });
    const received: string[] = [];
    provider.on('message', (message) => {
      received.push(message.id);
    });

    current.emit('message', {
      key: { id: 'old', remoteJid: '5511@s.whatsapp.net', fromMe: false },
      message: { conversation: ';spot velha' },
      timestampSeconds: Math.floor(Date.now() / 1_000) - 120,
      offline: true,
    });
    await flushAsync();

    expect(received).toEqual(['old']);
  });

  it('translates protocol edit and revoke events and falls back to the outer remoteJid', async () => {
    const { provider, client: current } = await connectedProvider();
    const edits: string[] = [];
    const deletes: string[] = [];
    provider.on('messageEdited', (event) => {
      edits.push(event.message.text ?? '');
    });
    provider.on('messageDeleted', (event) => {
      deletes.push(event.key.id);
    });
    const now = Math.floor(Date.now() / 1_000);

    current.emit('message', {
      key: { id: 'target', remoteJid: '5511@s.whatsapp.net', fromMe: false },
      message: { conversation: 'antes' },
      timestampSeconds: now,
    });
    current.emit('message_protocol', {
      key: { id: 'edit-event', remoteJid: '5511@s.whatsapp.net', fromMe: false },
      message: {},
      timestampSeconds: now,
      protocolMessage: {
        type: 14,
        key: { id: 'target', fromMe: false },
        editedMessage: { conversation: 'depois' },
      },
    });
    current.emit('message_protocol', {
      key: { id: 'revoke-event', remoteJid: '5511@s.whatsapp.net', fromMe: false },
      message: {},
      timestampSeconds: now,
      protocolMessage: {
        type: 0,
        key: { id: 'target', fromMe: false },
      },
    });
    await flushAsync();

    expect(edits).toEqual(['depois']);
    expect(deletes).toEqual(['target']);
  });

  it('processes live protocol mutations even when Zapo marks the protocol envelope as offline', async () => {
    const { provider, client: current } = await connectedProvider();
    const edits: Array<{ previous?: string; current?: string }> = [];
    const deletes: Array<{ id: string; text?: string }> = [];
    provider.on('messageEdited', (event) => {
      edits.push({
        ...(event.previous?.text !== undefined ? { previous: event.previous.text } : {}),
        ...(event.message.text !== undefined ? { current: event.message.text } : {}),
      });
    });
    provider.on('messageDeleted', (event) => {
      deletes.push({
        id: event.key.id,
        ...(event.message?.text !== undefined ? { text: event.message.text } : {}),
      });
    });
    const now = Math.floor(Date.now() / 1_000);

    current.emit('message', {
      key: { id: 'live-target', remoteJid: '5511@s.whatsapp.net', fromMe: false },
      message: { conversation: 'original' },
      timestampSeconds: now,
    });
    current.emit('message_protocol', {
      key: { id: 'live-edit', remoteJid: '5511@s.whatsapp.net', fromMe: false },
      message: {},
      timestampSeconds: now,
      offline: true,
      protocolMessage: {
        type: 14,
        key: { id: 'live-target', fromMe: false },
        editedMessage: { conversation: 'editada' },
      },
    });
    current.emit('message_protocol', {
      key: { id: 'live-delete', remoteJid: '5511@s.whatsapp.net', fromMe: false },
      message: {},
      timestampSeconds: now,
      offline: true,
      protocolMessage: {
        type: 0,
        key: { id: 'live-target', fromMe: false },
      },
    });
    await flushAsync();

    expect(edits).toEqual([{ previous: 'original', current: 'editada' }]);
    expect(deletes).toEqual([{ id: 'live-target', text: 'editada' }]);
  });

  it('recognizes protocol mutations when they surface through the regular message payload', async () => {
    const { provider, client: current } = await connectedProvider();
    const edits: string[] = [];
    const deletes: string[] = [];
    provider.on('messageEdited', (event) => {
      edits.push(event.message.text ?? '');
    });
    provider.on('messageDeleted', (event) => {
      deletes.push(event.key.id);
    });
    const now = Math.floor(Date.now() / 1_000);

    current.emit('message', {
      key: { id: 'wrapped-target', remoteJid: '5511@s.whatsapp.net', fromMe: false },
      message: { conversation: 'antes' },
      timestampSeconds: now,
    });
    current.emit('message', {
      key: { id: 'wrapped-edit-event', remoteJid: '5511@s.whatsapp.net', fromMe: false },
      message: {
        protocolMessage: {
          type: 14,
          key: { id: 'wrapped-target', fromMe: false },
          editedMessage: {
            editedMessage: { message: { conversation: 'depois' } },
          },
        },
      },
      timestampSeconds: now,
    });
    current.emit('message', {
      key: { id: 'wrapped-revoke-event', remoteJid: '5511@s.whatsapp.net', fromMe: false },
      message: {
        protocolMessage: {
          type: 0,
          key: { id: 'wrapped-target', fromMe: false },
        },
      },
      timestampSeconds: now,
    });
    await flushAsync();

    expect(edits).toEqual(['depois']);
    expect(deletes).toEqual(['wrapped-target']);
  });

  it('accepts decrypted edit addons that carry a nested protocol message instead of message_edit kind', async () => {
    const { provider, client: current } = await connectedProvider();
    const edits: Array<{ previous?: string; current?: string }> = [];
    provider.on('messageEdited', (event) => {
      edits.push({
        ...(event.previous?.text !== undefined ? { previous: event.previous.text } : {}),
        ...(event.message.text !== undefined ? { current: event.message.text } : {}),
      });
    });
    const now = Math.floor(Date.now() / 1_000);

    current.emit('message', {
      key: { id: 'addon-target', remoteJid: '5511@s.whatsapp.net', fromMe: false },
      message: { conversation: 'antes' },
      timestampSeconds: now,
    });
    current.emit('message_addon', {
      key: { id: 'addon-edit-event', remoteJid: '5511@s.whatsapp.net', fromMe: false },
      decrypted: {
        protocolMessage: {
          type: 14,
          key: { id: 'addon-target', fromMe: false },
          editedMessage: { conversation: 'depois' },
        },
      },
      timestampSeconds: now,
    });
    await flushAsync();

    expect(edits).toEqual([{ previous: 'antes', current: 'depois' }]);
  });

  it('translates decrypted secret edit addons into messageEdited', async () => {
    const { provider, client: current } = await connectedProvider();
    const edits: Array<{ previous: string | undefined; current: string | undefined }> = [];
    provider.on('messageEdited', (event) => {
      edits.push({
        previous: event.previous?.text,
        current: event.message.text,
      });
    });
    const now = Math.floor(Date.now() / 1_000);

    current.emit('message', {
      key: { id: 'secret-target', remoteJid: '5511@s.whatsapp.net', fromMe: false },
      message: { conversation: 'antes secreto' },
      timestampSeconds: now,
    });
    current.emit('message_addon', {
      key: { id: 'secret-edit-event', remoteJid: '5511@s.whatsapp.net', fromMe: false },
      kind: 'message_edit',
      targetMessageId: 'secret-target',
      decrypted: { conversation: 'depois secreto' },
      raw: {},
    });
    current.emit('message_addon', {
      key: { id: 'secret-edit-event', remoteJid: '5511@s.whatsapp.net', fromMe: false },
      kind: 'message_edit',
      targetMessageId: 'secret-target',
      decrypted: { conversation: 'depois secreto' },
      raw: {},
    });
    await flushAsync();

    expect(edits).toEqual([{
      previous: 'antes secreto',
      current: 'depois secreto',
    }]);
  });

  it('treats a live edit addon as live even when its parent timestamp predates the connection', async () => {
    const { provider, client: current } = await connectedProvider();
    const edits: Array<{ previous?: string; current?: string }> = [];
    provider.on('messageEdited', (event) => {
      edits.push({
        ...(event.previous?.text !== undefined ? { previous: event.previous.text } : {}),
        ...(event.message.text !== undefined ? { current: event.message.text } : {}),
      });
    });
    const oldTimestamp = Math.floor(Date.now() / 1_000) - 120;

    current.emit('message', {
      key: { id: 'live-addon-target', remoteJid: '5511@s.whatsapp.net', fromMe: false },
      message: { conversation: 'antes ao vivo' },
      timestampSeconds: Math.floor(Date.now() / 1_000),
    });
    current.emit('message_addon', {
      key: { id: 'live-addon-edit', remoteJid: '5511@s.whatsapp.net', fromMe: false },
      kind: 'message_edit',
      targetMessageId: 'live-addon-target',
      decrypted: { conversation: 'depois ao vivo' },
      timestampSeconds: oldTimestamp,
      offline: false,
    });
    await flushAsync();

    expect(edits).toEqual([{ previous: 'antes ao vivo', current: 'depois ao vivo' }]);
  });

  it('keeps offline-resume edit addons ignored by default', async () => {
    const { provider, client: current } = await connectedProvider();
    const edits: string[] = [];
    provider.on('messageEdited', (event) => {
      edits.push(event.message.text ?? '');
    });

    current.emit('message_addon', {
      key: { id: 'offline-addon-edit', remoteJid: '5511@s.whatsapp.net', fromMe: false },
      kind: 'message_edit',
      targetMessageId: 'offline-addon-target',
      decrypted: { conversation: 'edição antiga' },
      timestampSeconds: Math.floor(Date.now() / 1_000) - 120,
      offline: true,
    });
    await flushAsync();

    expect(edits).toEqual([]);
  });

  it('caches outbound messages using the Zapo message_send event shape', async () => {
    const { provider, client: current } = await connectedProvider();

    current.emit('message_send', {
      to: '5511999999999@s.whatsapp.net',
      id: 'outbound-1',
      message: { conversation: 'mensagem enviada' },
    });

    const repost = await provider.repostMessage(
      {
        id: 'outbound-1',
        chatId: '5511999999999@s.whatsapp.net',
        fromMe: true,
      },
      '5511888888888@s.whatsapp.net',
    );

    expect(repost.chatId).toBe('5511888888888@s.whatsapp.net');
    expect(current.message.send).toHaveBeenCalledWith(
      '5511888888888@s.whatsapp.net',
      { conversation: 'mensagem enviada' },
      { forward: true },
    );
  });

  it('restores edit and delete targets from the persistent message archive after RAM eviction', async () => {
    const { provider, client: current } = await connectedProvider({
      auth: './session-archive',
      browser: Browser.Windows,
      messageCacheSize: 1,
    });
    const edits: Array<{ previous?: string; current?: string }> = [];
    const deletes: Array<{ id: string; text?: string }> = [];
    provider.on('messageEdited', (event) => {
      edits.push({
        ...(event.previous?.text ? { previous: event.previous.text } : {}),
        ...(event.message.text ? { current: event.message.text } : {}),
      });
    });
    provider.on('messageDeleted', (event) => {
      deletes.push({
        id: event.key.id,
        ...(event.message?.text ? { text: event.message.text } : {}),
      });
    });
    const now = Math.floor(Date.now() / 1_000);

    current.emit('message', {
      key: { id: 'persisted-target', remoteJid: '5511@s.whatsapp.net', fromMe: false },
      message: { conversation: 'original persistida' },
      timestampSeconds: now,
    });
    await flushAsync();
    current.emit('message', {
      key: { id: 'cache-evictor', remoteJid: '5511@s.whatsapp.net', fromMe: false },
      message: { conversation: 'outra mensagem' },
      timestampSeconds: now,
    });
    await flushAsync();

    current.emit('message_protocol', {
      key: { id: 'persisted-edit', remoteJid: '5511@s.whatsapp.net', fromMe: false },
      timestampSeconds: now,
      protocolMessage: {
        type: 14,
        key: { id: 'persisted-target', fromMe: false },
        editedMessage: { conversation: 'editada persistida' },
      },
    });
    await flushAsync();
    current.emit('message', {
      key: { id: 'second-evictor', remoteJid: '5511@s.whatsapp.net', fromMe: false },
      message: { conversation: 'mais uma' },
      timestampSeconds: now,
    });
    await flushAsync();
    current.emit('message_protocol', {
      key: { id: 'persisted-delete', remoteJid: '5511@s.whatsapp.net', fromMe: false },
      timestampSeconds: now,
      protocolMessage: {
        type: 0,
        key: { id: 'persisted-target', fromMe: false },
      },
    });
    await flushAsync();

    expect(edits).toEqual([{ previous: 'original persistida', current: 'editada persistida' }]);
    expect(deletes).toEqual([{ id: 'persisted-target', text: 'editada persistida' }]);
    await provider.disconnect();
  });

  it('stops a passkey-gated login immediately when no signer is configured', async () => {
    const provider = new ZapoProvider({ auth: './session-passkey', browser: Browser.Windows });
    const closed: any[] = [];
    provider.on('connection', (event) => {
      if (event.state === 'closed') closed.push(event);
    });

    await provider.connect();
    const current = client();
    current.emit('auth_passkey_required', { hasSigner: false });
    await flushAsync();

    expect(closed).toHaveLength(1);
    expect(closed[0].error).toMatchObject({ code: 'AUTH_PASSKEY_REQUIRED' });
    expect(current.disconnect).toHaveBeenCalledTimes(1);
  });

  it('does not retry fatal 401 authentication failures', async () => {
    const { provider, client: current } = await connectedProvider({
      auth: './session-401',
      browser: Browser.Windows,
      reconnect: { enabled: true, maxAttempts: 10, initialDelayMs: 1, maxDelayMs: 2 },
    });
    const states: string[] = [];
    const closedErrors: any[] = [];
    provider.on('connection', (event) => {
      states.push(event.state);
      if (event.state === 'closed') closedErrors.push(event.error);
    });

    current.emit('connection', {
      status: 'close',
      reason: 'failure_not_authorized',
      code: 401,
      isLogout: false,
    });
    await flushAsync();

    expect(states).toEqual(['closed']);
    expect(closedErrors[0]).toMatchObject({ code: 'AUTH_EXPIRED' });
    expect(mocks.stores.at(-1)?.destroy).toHaveBeenCalledTimes(1);
  });

  it('extracts a fatal 401 from the nested Boom error shape used by the WhatsApp transport', async () => {
    const { provider, client: current } = await connectedProvider({
      auth: './session-nested-401',
      browser: Browser.Windows,
      reconnect: { enabled: true, maxAttempts: 10, initialDelayMs: 1, maxDelayMs: 2 },
    });
    const states: string[] = [];
    const closedErrors: any[] = [];
    provider.on('connection', (event) => {
      states.push(event.state);
      if (event.state === 'closed') closedErrors.push(event.error);
    });

    const cause = Object.assign(new Error('Connection Failure'), {
      data: { reason: '401', location: 'frc' },
      isBoom: true,
      isServer: false,
      output: { statusCode: 401, payload: {}, headers: {} },
    });
    current.emit('connection', {
      status: 'close',
      reason: { recoverable: true, cause },
      isLogout: false,
    });
    await flushAsync();

    expect(states).toEqual(['closed']);
    expect(closedErrors[0]).toMatchObject({
      code: 'AUTH_EXPIRED',
      recoverable: false,
      context: { statusCode: 401 },
    });
    expect(mocks.stores.at(-1)?.destroy).toHaveBeenCalledTimes(1);
  });

  it('shares one Zapo store across sibling account sessions and releases it after the last disconnect', async () => {
    const first = new ZapoProvider({
      auth: './multi/one',
      browser: Browser.Windows,
      sessionId: 'one',
    });
    const second = new ZapoProvider({
      auth: './multi/two',
      browser: Browser.Windows,
      sessionId: 'two',
    });

    await first.connect();
    const firstClient = client();
    await second.connect();
    const secondClient = client();

    expect(mocks.storeOptions).toHaveLength(1);
    expect((firstClient.options as any).store).toBe((secondClient.options as any).store);
    expect((firstClient.options as any).sessionId).toBe('one');
    expect((secondClient.options as any).sessionId).toBe('two');

    const sharedStore = mocks.stores[0];
    await first.disconnect();
    expect(sharedStore.destroy).not.toHaveBeenCalled();
    await second.disconnect();
    expect(sharedStore.destroy).toHaveBeenCalledTimes(1);
  });

  it('maps group operations and participant updates', async () => {
    const { provider, client: current } = await connectedProvider();

    const group = await provider.getGroup('123@g.us');
    await provider.setGroupAccess('123@g.us', 'closed');
    expect(await provider.getGroupInviteCode('123@g.us')).toBe('invite-code');
    expect(await provider.revokeGroupInvite('123@g.us')).toBe('rotated-code');
    expect(await provider.updateParticipant('123@g.us', '100@lid', 'promote')).toEqual({
      success: true,
      status: '200',
      memberId: '100@lid',
    });

    expect(group).toMatchObject({
      id: '123@g.us',
      subject: 'WhaNext',
      access: 'open',
      addressingMode: 'lid',
      participants: [
        {
          id: '100@lid',
          lid: '100@lid',
          phoneNumber: '5511000000000@s.whatsapp.net',
          role: 'admin',
        },
      ],
    });
    expect(current.group.setSetting).toHaveBeenCalledWith('123@g.us', 'announcement', true);
    expect(current.group.promoteParticipants).toHaveBeenCalledWith('123@g.us', ['100@lid']);
  });

  it('maps the native Zapo call event and rejects without the VoIP plugin', async () => {
    const { provider, client: current } = await connectedProvider();
    const statuses: string[] = [];
    const from: string[] = [];
    provider.on('call', (call) => {
      statuses.push(call.status);
      from.push(call.from);
    });

    current.emit('call', {
      type: 'offer',
      callId: 'call-1',
      callCreatorJid: '123456789@lid',
      callerPnJid: '5511999999999@s.whatsapp.net',
      isVideo: false,
      groupJid: null,
    });
    current.emit('call', {
      type: 'accept',
      callId: 'call-1',
      callCreatorJid: '123456789@lid',
      callerPnJid: '5511999999999@s.whatsapp.net',
      isVideo: false,
    });
    current.emit('call', {
      type: 'terminate',
      callId: 'call-1',
      callCreatorJid: '123456789@lid',
      callerPnJid: '5511999999999@s.whatsapp.net',
      isVideo: false,
    });

    await provider.rejectCall('call-1', '5511999999999@s.whatsapp.net');
    await flushAsync();

    expect(statuses).toEqual(['offer', 'accept', 'reject']);
    expect(from).toEqual([
      '5511999999999@s.whatsapp.net',
      '5511999999999@s.whatsapp.net',
      '5511999999999@s.whatsapp.net',
    ]);
    expect(current.lowlevel.sendNode).toHaveBeenCalledWith({
      tag: 'call',
      attrs: {
        to: '123456789@lid',
      },
      content: [
        {
          tag: 'reject',
          attrs: {
            'call-id': 'call-1',
            'call-creator': '123456789@lid',
          },
        },
      ],
    });
  });

  it('maps group events without duplicating the public provider contract', async () => {
    const { provider, client: current } = await connectedProvider();
    const groupChanges: string[] = [];
    const participantChanges: string[] = [];
    provider.on('groupChanged', ({ groupId }) => {
      groupChanges.push(groupId);
    });
    provider.on('groupParticipantsChanged', (change) => {
      participantChanges.push(`${change.action}:${change.participantIds.join(',')}`);
    });

    current.emit('group', {
      groupJid: '123@g.us',
      action: 'promote',
      participants: [{
        jid: '100@lid',
        lidJid: '100@lid',
        phoneJid: '5511000000000@s.whatsapp.net',
      }],
      authorJid: '200@lid',
    });
    await flushAsync();

    expect(groupChanges).toEqual(['123@g.us']);
    expect(participantChanges).toEqual(['promote:100@lid']);
  });
});
