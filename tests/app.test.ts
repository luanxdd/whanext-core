import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  create,
  defineCommand,
  User,
  type Message,
} from '@/index.js';
import { FakeProvider } from './fake-provider.js';

const message: Message = {
  id: 'message-1',
  jid: '123@g.us',
  chatId: '123@g.us',
  senderId: '5511999999999@s.whatsapp.net',
  senderIds: ['5511999999999@s.whatsapp.net'],
  sender: User.fromIdentities(['5511999999999@s.whatsapp.net']),
  keys: { id: 'message-1', chatId: '123@g.us', fromMe: false },
  text: '!fechar',
  mentions: [],
  mentionedUsers: [],
  timestamp: new Date(),
  isGroup: true,
  isReply: false,
  isViewOnce: false,
  hasMedia: false,
};

describe('WhaNextApp', () => {
  it('delivers the pairing code and completes login', async () => {
    const provider = new FakeProvider();
    const app = await create({ provider, phone: '5511999999999' });
    const onCode = vi.fn();

    await app.login({ onCode });

    expect(onCode).toHaveBeenCalledWith('1234-5678');
    expect(app.state).toBe('connected');
  });

  it('does not leak an unhandled connection rejection when pairing fails', async () => {
    class PairingFailureProvider extends FakeProvider {
      override async connect(): Promise<void> {
        await this.events.emit('connection', { state: 'connecting' });
      }

      override async requestPairingCode(): Promise<string> {
        await this.events.emit('connection', {
          state: 'closed',
          error: new Error('connection closed'),
        });
        throw new Error('pairing failed');
      }
    }

    const provider = new PairingFailureProvider();
    const app = await create({ provider, phone: '5511999999999', logger: 'silent' });

    await expect(app.login()).rejects.toThrow('pairing failed');

    // Dá um turno ao microtask queue. Antes da correção, a Promise interna
    // que aguardava a conexão ficava rejeitada sem handler nesse caminho.
    await Promise.resolve();
  });

  it('provides a production health snapshot', async () => {
    const provider = new FakeProvider();
    const app = await create({ provider, logger: 'silent' });

    expect(app.health()).toMatchObject({
      status: 'idle',
      state: 'idle',
      ready: false,
      muteEnabled: false,
      logLevel: 'silent',
    });

    await app.login();

    expect(app.isReady).toBe(true);
    expect(app.health()).toMatchObject({
      status: 'ready',
      state: 'connected',
      ready: true,
    });
    expect(app.health().uptimeMs).toBeGreaterThanOrEqual(0);
  });

  it('dispatches normalized messages to registered commands', async () => {
    const provider = new FakeProvider();
    const app = await create({ provider });
    const execute = vi.fn();
    app.router().command(defineCommand({
      name: 'fechar',
      description: 'Fecha o grupo.',
      onlyGroup: true,
      onlyAdmin: true,
      execute,
    }));

    await provider.events.emit('message', message);

    expect(execute).toHaveBeenCalledOnce();
  });

  it('recognizes an administrator received through a device LID', async () => {
    const provider = new FakeProvider();
    const app = await create({ provider });
    const execute = vi.fn();
    app.router().command(defineCommand({
      name: 'abrir',
      description: 'Abre o grupo.',
      onlyGroup: true,
      onlyAdmin: true,
      execute,
    }));

    await provider.events.emit('message', {
      ...message,
      text: '!abrir',
      senderId: '100000000000001:5@lid',
      senderIds: ['100000000000001:5@lid'],
      sender: User.fromIdentities(['100000000000001:5@lid']),
    });

    expect(execute).toHaveBeenCalledOnce();
  });

  it('uses the prefix defined once during app creation', async () => {
    const provider = new FakeProvider();
    const app = await create({ provider, prefix: '#' });
    const execute = vi.fn();
    app.router().command(defineCommand({
      name: 'fechar',
      description: 'Fecha o grupo.',
      execute,
    }));

    await provider.events.emit('message', { ...message, text: '#fechar' });
    await provider.events.emit('message', { ...message, text: '!fechar' });

    expect(execute).toHaveBeenCalledOnce();
  });

  it('sends replies with the original message key', async () => {
    const provider = new FakeProvider();
    const app = await create({ provider });

    await app.message.reply(message, { text: 'Pronto.' });

    expect(provider.sent[0]).toMatchObject({ chatId: '123@g.us', replyTo: message.keys });
  });

  it('deletes a message through the normalized message API', async () => {
    const provider = new FakeProvider();
    const app = await create({ provider });

    await app.message.delete(message);

    expect(provider.deleted).toEqual([message.keys]);
  });

  it('downloads media through the normalized message API', async () => {
    const provider = new FakeProvider();
    const app = await create({ provider });

    const downloaded = await app.media.download({
      ...message,
      hasMedia: true,
      media: { kind: 'image', viewOnce: false },
    });

    expect(downloaded).toMatchObject({ kind: 'image', mimetype: 'image/jpeg' });
    expect(downloaded.data.toString()).toBe('media');
    expect(provider.downloadedMedia).toEqual([message.keys]);
  });

  it('downloads quoted media directly through the media API', async () => {
    const provider = new FakeProvider();
    const app = await create({ provider });
    const quoted = {
      key: {
        id: 'quoted-view-once',
        chatId: '123@g.us',
        fromMe: false,
        participantId: '5511888888888@s.whatsapp.net',
      },
      hasMedia: true,
      isViewOnce: true,
      contentKind: 'image' as const,
      media: {
        kind: 'image' as const,
        mimetype: 'image/jpeg',
        viewOnce: true,
      },
    };

    const downloaded = await app.media.download(quoted);

    expect(downloaded.kind).toBe('image');
    expect(provider.downloadedMedia).toEqual([quoted.key]);
  });

  it('sends stickers through the media API', async () => {
    const provider = new FakeProvider();
    const app = await create({ provider });
    const sticker = new Uint8Array([1, 2, 3]);

    await app.media.sticker('123@g.us', { sticker });

    expect(provider.sent).toEqual([
      { chatId: '123@g.us', content: { sticker } },
    ]);
  });

  it('adds and removes reactions through the normalized message API', async () => {
    const provider = new FakeProvider();
    const app = await create({ provider });

    await app.message.react(message, '👏🏻');
    await app.message.unreact(message);

    expect(provider.reactions).toEqual([
      { key: message.keys, emoji: '👏🏻' },
      { key: message.keys },
    ]);
  });

  it('emits detailed participant changes and invalidates group metadata', async () => {
    const provider = new FakeProvider();
    const app = await create({ provider });
    const onChange = vi.fn();
    app.on('groupParticipantsChanged', onChange);

    await app.group.metadata('123@g.us');
    await provider.events.emit('groupParticipantsChanged', {
      groupId: '123@g.us',
      action: 'add',
      participantIds: ['5511000000000@s.whatsapp.net'],
      authorId: '5511999999999@s.whatsapp.net',
    });
    await app.group.metadata('123@g.us');

    expect(onChange).toHaveBeenCalledWith({
      groupId: '123@g.us',
      action: 'add',
      participantIds: ['5511000000000@s.whatsapp.net'],
      authorId: '5511999999999@s.whatsapp.net',
    });
    expect(provider.calls.getGroup).toBe(2);
  });

  it('emits the call event received from the provider', async () => {
    const provider = new FakeProvider();
    const app = await create({ provider });
    const onCall = vi.fn();
    app.on('call', onCall);

    const call = {
      id: 'call-1',
      chatId: '5511999999999@s.whatsapp.net',
      from: '5511999999999@s.whatsapp.net',
      status: 'offer' as const,
      isVideo: false,
      isGroup: false,
      date: new Date(),
    };

    await provider.events.emit('call', call);

    expect(onCall).toHaveBeenCalledWith(call);
  });

  it('rejects a call through the chat API', async () => {
    const provider = new FakeProvider();
    const app = await create({ provider });

    await app.chat.rejectCall('call-1', '5511999999999@s.whatsapp.net');

    expect(provider.rejectedCalls).toEqual([
      { callId: 'call-1', from: '5511999999999@s.whatsapp.net' },
    ]);
  });

  it('blocks group mutations when the connected account is not an admin', async () => {
    const provider = new FakeProvider();
    provider.currentUserIds = ['5511000000000@s.whatsapp.net'];
    const app = await create({ provider });
    const execute = vi.fn();
    const onError = vi.fn();
    app.on('error', onError);
    app.router().command(defineCommand({
      name: 'fechar',
      description: 'Fecha o grupo.',
      onlyGroup: true,
      onlyAdmin: true,
      botMustBeAdmin: true,
      execute,
    }));

    await provider.events.emit('message', message);

    expect(execute).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'BOT_NOT_ADMIN' }));
  });
});
