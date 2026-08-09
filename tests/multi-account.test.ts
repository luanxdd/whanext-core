import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  createMulti,
  defineCommand,
  guards,
  User,
  type Message,
} from '@/index.js';
import { FakeProvider } from './fake-provider.js';

function message(text: string, fromMe: boolean): Message {
  const senderId = fromMe
    ? '5511888888888@s.whatsapp.net'
    : '5511777777777@s.whatsapp.net';

  return {
    id: `message-${Math.random()}`,
    jid: '123@g.us',
    chatId: '123@g.us',
    senderId,
    senderIds: [senderId],
    sender: User.fromIdentities([senderId]),
    keys: {
      id: `key-${Math.random()}`,
      chatId: '123@g.us',
      fromMe,
    },
    text,
    mentions: [],
    mentionedUsers: [],
    timestamp: new Date(),
    isGroup: true,
    isReply: false,
    isViewOnce: false,
    hasMedia: false,
  };
}

describe('multi-account', () => {
  it('connects multiple independent WhatsApp accounts in one instance', async () => {
    const primary = new FakeProvider();
    const secondary = new FakeProvider();
    const multi = await createMulti({
      prefix: '&',
      accounts: [
        { id: 'principal', phone: '5511999999999', provider: primary },
        { id: 'secundaria', phone: '5511888888888', provider: secondary },
      ],
    });
    const codes: Array<[string, string]> = [];

    await multi.login({
      onCode(accountId, code) {
        codes.push([accountId, code]);
      },
    });

    expect(multi.size).toBe(2);
    expect(multi.ids()).toEqual(['principal', 'secundaria']);
    expect(multi.isReady).toBe(true);
    expect(multi.health().map(({ accountId, ready }) => [accountId, ready])).toEqual([
      ['principal', true],
      ['secundaria', true],
    ]);
    expect(codes).toEqual([
      ['principal', '1234-5678'],
      ['secundaria', '1234-5678'],
    ]);
  });

  it('registers one command definition across all connected accounts', async () => {
    const primary = new FakeProvider();
    const secondary = new FakeProvider();
    const multi = await createMulti({
      prefix: '&',
      accounts: [
        { id: 'principal', provider: primary },
        { id: 'secundaria', provider: secondary },
      ],
    });
    const executed: Array<string | undefined> = [];

    multi.commands.command(defineCommand({
      name: 'painel',
      description: 'Comando do dono.',
      guards: [guards.owner()],
      execute(ctx) {
        executed.push(ctx.account.id);
      },
    }));

    await primary.events.emit('message', message('&painel', true));
    await secondary.events.emit('message', message('&painel', true));

    expect(executed).toEqual(['principal', 'secundaria']);
  });

  it('validates account ids and rejects duplicates', async () => {
    await expect(createMulti({
      accounts: [
        { id: 'principal', provider: new FakeProvider() },
        { id: 'principal', provider: new FakeProvider() },
      ],
    })).rejects.toMatchObject({ code: 'ARGUMENT_INVALID' });

    await expect(createMulti({
      accounts: [{ id: '../session', provider: new FakeProvider() }],
    })).rejects.toMatchObject({ code: 'ARGUMENT_INVALID' });
  });

  it('aggregates events with the account that emitted them', async () => {
    const primary = new FakeProvider();
    const secondary = new FakeProvider();
    const multi = await createMulti({
      accounts: [
        { id: 'principal', provider: primary },
        { id: 'secundaria', provider: secondary },
      ],
    });
    const received: Array<[string, string]> = [];
    multi.on('message', ({ accountId, payload }) => {
      received.push([accountId, payload.id]);
    });

    await secondary.events.emit('message', message('!ping', false));

    expect(received).toEqual([['secundaria', expect.any(String)]]);
  });

  it('disconnects every account even when managed through one instance', async () => {
    const primary = new FakeProvider();
    const secondary = new FakeProvider();
    const multi = await createMulti({
      accounts: [
        { id: 'principal', provider: primary },
        { id: 'secundaria', provider: secondary },
      ],
    });
    const closed = vi.fn();
    multi.get('principal')?.on('connection', ({ state }) => {
      if (state === 'closed') closed('principal');
    });
    multi.get('secundaria')?.on('connection', ({ state }) => {
      if (state === 'closed') closed('secundaria');
    });

    await multi.disconnect();

    expect(closed).toHaveBeenCalledTimes(2);
  });
});
