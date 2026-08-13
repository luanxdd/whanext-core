import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  create,
  defineCommand,
  defineCommandGroup,
  defineSubcommand,
  guards,
  option,
  User,
  type CommandContext,
  type Message,
} from '@/index.js';
import { FakeProvider } from './fake-provider.js';

function makeMessage(text: string, id = `message-${Math.random()}`): Message {
  return {
    id,
    jid: '123@g.us',
    chatId: '123@g.us',
    senderId: '5511999999999@s.whatsapp.net',
    senderIds: ['5511999999999@s.whatsapp.net'],
    sender: User.fromIdentities(['5511999999999@s.whatsapp.net']),
    keys: { id, chatId: '123@g.us', fromMe: false },
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

describe('modern commands', () => {
  it('allows owner-only commands only for the connected WhatsApp account', async () => {
    const provider = new FakeProvider();
    const app = await create({ provider });
    const execute = vi.fn();
    const errors: string[] = [];
    app.commands.onError((_ctx, error) => { errors.push(error.code); });
    app.commands.command(defineCommand({
      name: 'owner',
      description: 'Owner command.',
      guards: [guards.owner()],
      execute,
    }));

    await provider.events.emit('message', {
      ...makeMessage('!owner', 'owner-self'),
      senderId: '5511888888888@s.whatsapp.net',
      senderIds: ['5511888888888@s.whatsapp.net'],
      sender: User.fromIdentities(['5511888888888@s.whatsapp.net']),
      keys: { id: 'owner-self', chatId: '123@g.us', fromMe: true },
    });
    await provider.events.emit('message', {
      ...makeMessage('!owner', 'owner-other'),
      senderId: '5511777777777@s.whatsapp.net',
      senderIds: ['5511777777777@s.whatsapp.net'],
      sender: User.fromIdentities(['5511777777777@s.whatsapp.net']),
    });

    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]?.[0].isOwner).toBe(true);
    expect(errors).toEqual(['COMMAND_NOT_ALLOWED']);
  });

  it('keeps onlyOwner available for legacy command metadata', async () => {
    const provider = new FakeProvider();
    const app = await create({ provider });
    const execute = vi.fn();
    const errors: string[] = [];
    app.commands.onError((_ctx, error) => { errors.push(error.code); });
    app.commands.command(defineCommand({
      name: 'legacy-owner',
      description: 'Legacy owner command.',
      onlyOwner: true,
      execute,
    }));

    await provider.events.emit('message', {
      ...makeMessage('!legacy-owner', 'legacy-owner-self'),
      keys: { id: 'legacy-owner-self', chatId: '123@g.us', fromMe: true },
    });
    await provider.events.emit('message', {
      ...makeMessage('!legacy-owner', 'legacy-owner-other'),
      senderId: '5511777777777@s.whatsapp.net',
      senderIds: ['5511777777777@s.whatsapp.net'],
      sender: User.fromIdentities(['5511777777777@s.whatsapp.net']),
    });

    expect(execute).toHaveBeenCalledOnce();
    expect(errors).toEqual(['COMMAND_NOT_ALLOWED']);
  });

  it('recognizes the connected account identity as owner when fromMe is unavailable', async () => {
    const provider = new FakeProvider();
    const app = await create({ provider });
    const execute = vi.fn();
    app.commands.command(defineCommand({
      name: 'owner-identity',
      description: 'Owner command using the connected account identity.',
      guards: [guards.owner()],
      execute,
    }));

    await provider.events.emit('message', makeMessage('!owner-identity', 'owner-by-identity'));

    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]?.[0].isOwner).toBe(true);
  });


  it('exposes canonical identities for self-chat without preferring LID', async () => {
    const provider = new FakeProvider();
    provider.currentUserIds = [
      '192758887264324@lid',
      '5531995724651:12@s.whatsapp.net',
    ];
    const app = await create({ provider });

    expect(app.account.jid).toBe('5531995724651@s.whatsapp.net');
    expect(app.account.lid).toBe('192758887264324@lid');
    expect(app.account.phoneNumber).toBe('5531995724651');
    expect(app.account.selfChatId).toBe('5531995724651@s.whatsapp.net');
  });

  it('builds the self-chat PN JID when the provider exposes a plain phone number', async () => {
    const provider = new FakeProvider();
    provider.currentUserIds = [
      '192758887264324@lid',
      '5531995724651',
    ];
    const app = await create({ provider });

    expect(app.account.jid).toBe('5531995724651@s.whatsapp.net');
    expect(app.account.phoneNumber).toBe('5531995724651');
    expect(app.account.selfChatId).toBe('5531995724651@s.whatsapp.net');
  });

  it('provides a message-compatible context with typed options and response helpers', async () => {
    const provider = new FakeProvider();
    const app = await create({ provider, prefix: '&' });
    const target = User.fromPhoneNumber('5511000000000');

    app.commands.command(defineCommand({
      name: 'ban',
      aliases: ['banir'],
      description: 'Remove um membro.',
      guards: [guards.group(), guards.userAdmin(), guards.botAdmin()],
      options: {
        user: option.user({ description: 'Usuário.', required: true }),
        reason: option.string({ description: 'Motivo.', rest: true }),
      },
      async execute(ctx) {
        const user = ctx.options.user('user');
        const reason = ctx.options.string('reason') ?? 'Não informado';
        expect(user).toBeInstanceOf(User);
        expect(ctx.id).toBe(ctx.message.id);
        expect(ctx.user).toBe(ctx.sender);
        expect(await ctx.group?.isUserAdmin()).toBe(true);

        const deferred = await ctx.defer();
        await deferred.edit(`Ban: ${user.mention} • ${reason}`);
        await ctx.react('🔨');
      },
    }));

    await provider.events.emit('message', {
      ...makeMessage('&ban @5511000000000 spam contínuo'),
      mentions: [target.mentionId],
      mentionedUsers: [target],
    });

    expect(provider.sent[0]?.content).toEqual({ text: '⏳ _Processando..._' });
    expect(provider.edited[0]?.text).toBe('Ban: @5511000000000 • spam contínuo');
    expect(provider.reactions[0]?.emoji).toBe('🔨');
  });

  it('exposes the command catalog and prefix inside command context', async () => {
    const provider = new FakeProvider();
    const app = await create({ provider, prefix: '&' });

    app.commands.command(defineCommand({
      name: 'menu',
      description: 'Menu.',
      async execute(ctx) {
        expect(ctx.prefix).toBe('&');
        expect(ctx.commands.prefix).toBe('&');
        expect(ctx.commands.has('menu')).toBe(true);
        expect(ctx.commands.catalog().map((entry) => entry.path.join(' '))).toContain('menu');
      },
    }));

    await provider.events.emit('message', makeMessage('&menu'));
  });


  it('supports multiple prefixes and opt-in prefixless aliases', async () => {
    const provider = new FakeProvider();
    const app = await create({ provider, prefix: ['&', '!', '.'] });
    const prefixes: string[] = [];

    app.commands.command(defineCommand({
      name: 'open',
      aliases: ['abrir', 'a'],
      prefixless: ['a'],
      description: 'Abre o grupo.',
      execute(ctx) {
        prefixes.push(ctx.prefix);
        expect(ctx.commands.prefix).toBe('&');
        expect(ctx.commands.prefixes).toEqual(['&', '!', '.']);
      },
    }));

    await provider.events.emit('message', makeMessage('&open', 'multi-1'));
    await provider.events.emit('message', makeMessage('!abrir', 'multi-2'));
    await provider.events.emit('message', makeMessage('.a', 'multi-3'));
    await provider.events.emit('message', makeMessage('a', 'prefixless-1'));
    await provider.events.emit('message', makeMessage('open', 'prefixless-blocked-1'));
    await provider.events.emit('message', makeMessage('abrir', 'prefixless-blocked-2'));

    expect(prefixes).toEqual(['&', '!', '.', '']);
  });

  it('can activate or replace multiple prefixes at runtime', async () => {
    const provider = new FakeProvider();
    const app = await create({ provider, prefix: '&' });
    const prefixes: string[] = [];

    app.commands.command(defineCommand({
      name: 'ping',
      description: 'Ping.',
      execute(ctx) {
        prefixes.push(ctx.prefix);
      },
    }));

    await provider.events.emit('message', makeMessage('!ping', 'before-runtime-prefix'));
    app.commands.setPrefixes(['&', '!']);
    await provider.events.emit('message', makeMessage('!ping', 'after-runtime-prefix'));
    app.commands.setPrefixes('&');
    await provider.events.emit('message', makeMessage('!ping', 'disabled-runtime-prefix'));
    await provider.events.emit('message', makeMessage('&ping', 'primary-runtime-prefix'));

    expect(prefixes).toEqual(['!', '&']);
    expect(app.commands.prefix).toBe('&');
    expect(app.commands.prefixes).toEqual(['&']);
  });

  it('prefers the longest configured prefix when prefixes overlap', async () => {
    const provider = new FakeProvider();
    const app = await create({ provider, prefix: ['!', '!!'] });
    const prefixes: string[] = [];

    app.commands.command(defineCommand({
      name: 'ping',
      description: 'Ping.',
      execute(ctx) {
        prefixes.push(ctx.prefix);
      },
    }));

    await provider.events.emit('message', makeMessage('!!ping', 'long-prefix'));
    await provider.events.emit('message', makeMessage('!ping', 'short-prefix'));

    expect(prefixes).toEqual(['!!', '!']);
  });

  it('routes interactive response ids through the same command router', async () => {
    const provider = new FakeProvider();
    const app = await create({ provider, prefix: '&' });
    const execute = vi.fn();

    app.commands.command(defineCommand({
      name: 'open',
      aliases: ['a'],
      prefixless: ['a'],
      description: 'Abre o grupo.',
      execute,
    }));

    await provider.events.emit('message', {
      ...makeMessage('Abrir grupo', 'interactive-command'),
      interactive: { kind: 'list', id: '&open', title: 'Abrir grupo' },
    });
    await provider.events.emit('message', {
      ...makeMessage('Abrir', 'interactive-prefixless'),
      interactive: { kind: 'button', id: 'a', title: 'Abrir' },
    });

    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('dispatches command groups, subcommands and Portuguese/English aliases', async () => {
    const provider = new FakeProvider();
    const app = await create({ provider, prefix: '&' });
    const close = vi.fn();

    app.commands.command(defineCommandGroup({
      name: 'grupo',
      aliases: ['group'],
      description: 'Gerencia o grupo.',
      category: 'grupos',
      guards: [guards.group()],
      subcommands: [
        defineSubcommand({
          name: 'fechar',
          aliases: ['close'],
          description: 'Fecha o grupo.',
          execute: close,
        }),
      ],
    }));

    await provider.events.emit('message', makeMessage('&grupo fechar'));
    await provider.events.emit('message', makeMessage('&group close'));

    expect(close).toHaveBeenCalledTimes(2);
    expect(close.mock.calls[0]?.[0].command.path).toEqual(['grupo', 'fechar']);
  });

  it('runs global and command middleware with hooks in deterministic order', async () => {
    const provider = new FakeProvider();
    const app = await create({ provider });
    const order: string[] = [];

    app.commands.use(async (_ctx, next) => {
      order.push('global:before');
      await next();
      order.push('global:after');
    });
    app.commands.command(defineCommand({
      name: 'ping',
      description: 'Ping.',
      hooks: {
        beforeExecute: () => { order.push('hook:before'); },
        afterExecute: () => { order.push('hook:after'); },
      },
      middleware: [async (_ctx, next) => {
        order.push('command:before');
        await next();
        order.push('command:after');
      }],
      execute() {
        order.push('execute');
      },
    }));

    await provider.events.emit('message', makeMessage('!ping'));

    expect(order).toEqual([
      'hook:before',
      'global:before',
      'command:before',
      'execute',
      'command:after',
      'global:after',
      'hook:after',
    ]);
  });

  it('handles cooldown errors centrally without executing twice', async () => {
    const provider = new FakeProvider();
    const app = await create({ provider });
    const execute = vi.fn();
    const errors: string[] = [];
    app.commands.onError(async (ctx, error) => {
      errors.push(error.code);
      await ctx.reply(`⚠️ ${error.code}`);
    });
    app.commands.command(defineCommand({
      name: 'daily',
      description: 'Teste de cooldown.',
      cooldown: { durationMs: 10_000, scope: 'user-chat' },
      execute,
    }));

    await provider.events.emit('message', makeMessage('!daily', 'daily-1'));
    await provider.events.emit('message', makeMessage('!daily', 'daily-2'));

    expect(execute).toHaveBeenCalledOnce();
    expect(errors).toEqual(['COMMAND_COOLDOWN']);
    expect(provider.sent.at(-1)?.content).toEqual({ text: '⚠️ COMMAND_COOLDOWN' });
  });

  it('rejects concurrent executions with the configured scope', async () => {
    const provider = new FakeProvider();
    const app = await create({ provider });
    let release: () => void = () => undefined;
    const blocker = new Promise<void>((resolve) => { release = resolve; });
    const started = vi.fn();
    const errors: string[] = [];
    app.commands.onError((_ctx, error) => { errors.push(error.code); });
    app.commands.command(defineCommand({
      name: 'sync',
      description: 'Teste de concorrência.',
      concurrency: { strategy: 'reject', scope: 'chat', max: 1 },
      async execute() {
        started();
        await blocker;
      },
    }));

    const first = app.commands.dispatch(makeMessage('!sync', 'sync-1'));
    await vi.waitFor(() => expect(started).toHaveBeenCalledOnce());
    await app.commands.dispatch(makeMessage('!sync', 'sync-2'));
    release();
    await first;

    expect(started).toHaveBeenCalledOnce();
    expect(errors).toEqual(['COMMAND_BUSY']);
  });

  it('queues executions independently per chat', async () => {
    const provider = new FakeProvider();
    const app = await create({ provider });
    let release: () => void = () => undefined;
    const blocker = new Promise<void>((resolve) => { release = resolve; });
    const order: string[] = [];
    let calls = 0;
    app.commands.command(defineCommand({
      name: 'queue',
      description: 'Queue test.',
      concurrency: { strategy: 'queue', scope: 'chat', max: 1 },
      async execute(ctx) {
        calls += 1;
        order.push(`start:${ctx.id}`);
        if (calls === 1) await blocker;
        order.push(`end:${ctx.id}`);
      },
    }));

    const first = app.commands.dispatch(makeMessage('!queue', 'queue-1'));
    await vi.waitFor(() => expect(order).toEqual(['start:queue-1']));
    const second = app.commands.dispatch(makeMessage('!queue', 'queue-2'));
    await Promise.resolve();
    expect(order).toEqual(['start:queue-1']);
    release();
    await Promise.all([first, second]);

    expect(order).toEqual([
      'start:queue-1',
      'end:queue-1',
      'start:queue-2',
      'end:queue-2',
    ]);
  });

  it('aborts the previous signal with the replace strategy', async () => {
    const provider = new FakeProvider();
    const app = await create({ provider });
    const signals: AbortSignal[] = [];
    let started = 0;
    app.commands.command(defineCommand({
      name: 'replace',
      description: 'Replace test.',
      concurrency: { strategy: 'replace', scope: 'chat' },
      async execute(ctx) {
        signals.push(ctx.signal);
        started += 1;
        if (started === 1) {
          await new Promise<void>((resolve) => {
            ctx.signal.addEventListener('abort', () => resolve(), { once: true });
          });
        }
      },
    }));

    const first = app.commands.dispatch(makeMessage('!replace', 'replace-1'));
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    const second = app.commands.dispatch(makeMessage('!replace', 'replace-2'));
    await Promise.all([first, second]);

    expect(signals).toHaveLength(2);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
  });

  it('routes invalid subcommands through the central error handler', async () => {
    const provider = new FakeProvider();
    const app = await create({ provider });
    const errors: string[] = [];
    app.commands.onError((_ctx, error) => { errors.push(error.code); });
    app.commands.command(defineCommandGroup({
      name: 'group',
      description: 'Group.',
      subcommands: [defineSubcommand({
        name: 'open',
        description: 'Open.',
        execute: () => undefined,
      })],
    }));

    await provider.events.emit('message', makeMessage('!group unknown'));
    expect(errors).toEqual(['ARGUMENT_INVALID']);
  });

  it('builds a catalog and help response from command metadata', async () => {
    const provider = new FakeProvider();
    const app = await create({ provider, prefix: '&' });

    app.commands.command(defineCommand({
      name: 'ping',
      description: 'Mostra a latência.',
      category: 'utilidades',
      execute: () => undefined,
    }));
    app.commands.command(defineCommand({
      name: 'interno',
      description: 'Oculto.',
      category: 'utilidades',
      hidden: true,
      execute: () => undefined,
    }));
    app.commands.command(defineCommand({
      name: 'menu',
      description: 'Exibe os comandos.',
      async execute(ctx) {
        await app.commands.help(ctx, { category: 'utilidades' });
      },
    }));

    await provider.events.emit('message', makeMessage('&menu'));

    expect(app.commands.categories()).toEqual(['general', 'utilidades']);
    expect(app.commands.catalog({ category: 'utilidades' })).toHaveLength(1);
    expect(provider.sent[0]?.content).toEqual({
      text: '📚 *utilidades*\n\n• *&ping*\n  Mostra a latência.',
    });
  });

  it('supports localized command names without duplicating definitions', async () => {
    const provider = new FakeProvider();
    const app = await create({ provider });
    const locales: Array<string | undefined> = [];

    app.commands.command(defineCommand({
      name: 'info',
      description: 'Information.',
      localizations: {
        'pt-BR': { name: 'informações', aliases: ['informacoes'] },
      },
      execute(ctx) {
        locales.push(ctx.locale);
      },
    }));

    await provider.events.emit('message', makeMessage('!info'));
    await provider.events.emit('message', makeMessage('!informacoes'));

    expect(locales).toEqual([undefined, 'pt-BR']);
  });

  it('keeps legacy message and ArgsParser commands working', async () => {
    const provider = new FakeProvider();
    const app = await create({ provider });
    const values: string[] = [];

    app.commands.command(defineCommand({
      name: 'echo',
      description: 'Legacy echo.',
      execute(message, args) {
        values.push(message.chatId, args.rest());
      },
    }));

    await provider.events.emit('message', makeMessage('!echo olá mundo'));
    expect(values).toEqual(['123@g.us', 'olá mundo']);
  });
});
