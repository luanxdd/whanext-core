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
    readonly voip = {
      rejectCall: vi.fn(async () => undefined),
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
    return { options };
  }),
  proto: {
    Message: {
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

vi.mock('@zapo-js/voip', () => ({
  voipPlugin: vi.fn((options: unknown) => ({ kind: 'voip', options })),
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
  await Promise.resolve();
  return { provider, client: current };
}

beforeEach(() => {
  mocks.clients.length = 0;
  mocks.storeOptions.length = 0;
  mocks.sqliteOptions.length = 0;
  mocks.nextAuthEvent = 'pairing';
  vi.clearAllMocks();
});

describe('ZapoProvider', () => {
  it('creates a persistent SQLite Zapo store and disables history sync', async () => {
    const provider = new ZapoProvider({
      auth: './accounts/main',
      browser: Browser.MacOS,
      sessionId: 'main',
    });

    await provider.connect();

    expect(mocks.sqliteOptions[0]).toEqual({
      path: 'accounts/main/state.sqlite',
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
        messages: 'none',
        threads: 'none',
        contacts: 'none',
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
      history: { enabled: false },
      addons: {
        autoDecrypt: true,
        persistAllSecrets: true,
      },
    });
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
    await Promise.resolve();

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
    await Promise.resolve();

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
    await Promise.resolve();

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
        key: expect.objectContaining({ id: 'quoted-view-once' }),
        message: expect.objectContaining({
          viewOnceMessageV2Extension: expect.any(Object),
        }),
      }),
    );
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
    await Promise.resolve();

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
    await Promise.resolve();

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
    await Promise.resolve();

    expect(edits).toEqual(['depois']);
    expect(deletes).toEqual(['target']);
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

  it('maps Zapo VoIP events and rejects calls through the plugin', async () => {
    const { provider, client: current } = await connectedProvider();
    const statuses: string[] = [];
    provider.on('call', (call) => {
      statuses.push(call.status);
    });

    current.emit('voip_call_incoming', {
      callId: 'call-1',
      peerJid: '5511999999999@s.whatsapp.net',
      callerPn: '5511999999999@s.whatsapp.net',
      mediaType: 'audio',
      createdAt: new Date(),
      stateData: { state: 'incoming_ringing' },
    });
    current.emit('voip_call_state', {
      callId: 'call-1',
      peerJid: '5511999999999@s.whatsapp.net',
      mediaType: 'audio',
      stateData: { state: 'active' },
    });
    current.emit('voip_call_state', {
      callId: 'call-1',
      peerJid: '5511999999999@s.whatsapp.net',
      mediaType: 'audio',
      stateData: { state: 'ended', endReason: 'timeout' },
    });
    current.emit('voip_call_ended', {
      callId: 'call-1',
      peerJid: '5511999999999@s.whatsapp.net',
      mediaType: 'audio',
      stateData: { state: 'ended', endReason: 'timeout' },
    });
    await provider.rejectCall('call-1', '5511999999999@s.whatsapp.net');
    await Promise.resolve();

    expect(statuses).toEqual(['offer', 'accept', 'timeout']);
    expect(current.voip.rejectCall).toHaveBeenCalledWith('call-1');
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
    await Promise.resolve();

    expect(groupChanges).toEqual(['123@g.us']);
    expect(participantChanges).toEqual(['promote:100@lid']);
  });
});
