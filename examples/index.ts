import {
  Browser,
  create,
  defineCommand,
  defineCommandGroup,
  defineSubcommand,
  guards,
  option,
  type LogFormat,
  type LogLevel,
} from '@whanext/core';

const phone = process.env.PHONE;

if (!phone) {
  throw new Error('Defina PHONE com DDI e DDD antes de iniciar o exemplo.');
}

const prefix = process.env.PREFIX ?? '!';
const logLevel = parseLogLevel(process.env.LOG_LEVEL);
const logFormat = parseLogFormat(process.env.LOG_FORMAT);
const app = await create({
  phone,
  prefix,
  browser: Browser.Windows,
  auth: process.env.AUTH_PATH ?? './session',
  logger: {
    level: logLevel,
    format: logFormat,
  },
  mute: {
    enabled: true,
    database: process.env.DATABASE_PATH ?? './data/whanext.sqlite',
  },
});

app.commands.onError(async (ctx, error) => {
  if (error.code === 'COMMAND_COOLDOWN') {
    await ctx.reply('⏱️ Aguarde um pouco antes de usar esse comando novamente.');
    return;
  }

  await ctx.reply('⚠️ *Não foi possível concluir*');
});

app.commands.command(defineCommandGroup({
  name: 'grupo',
  aliases: ['group'],
  description: 'Gerencia configurações do grupo.',
  category: 'grupos',
  guards: [guards.group(), guards.userAdmin(), guards.botAdmin()],
  concurrency: { strategy: 'queue', scope: 'chat', max: 1 },
  subcommands: [
    defineSubcommand({
      name: 'abrir',
      aliases: ['open'],
      description: 'Abre o grupo.',
      async execute(ctx) {
        const result = await ctx.groups.open(ctx.chatId);
        await ctx.reply(result.changed ? '🔓 *Grupo aberto*' : '⚠️ O grupo já está aberto.');
      },
    }),
    defineSubcommand({
      name: 'fechar',
      aliases: ['close'],
      description: 'Fecha o grupo.',
      async execute(ctx) {
        const result = await ctx.groups.close(ctx.chatId);
        await ctx.reply(result.changed ? '🔒 *Grupo fechado*' : '⚠️ O grupo já está fechado.');
      },
    }),
    defineSubcommand({
      name: 'promover',
      aliases: ['promote'],
      description: 'Promove um membro.',
      options: {
        user: option.user({ description: 'Membro.', required: true }),
      },
      async execute(ctx) {
        const user = ctx.options.user('user');
        const result = await ctx.members.promote(ctx.chatId, user);
        await ctx.reply({
          text: result.changed
            ? `🛡️ *Usuário promovido*\n\n${user.mention} agora é administrador.`
            : `⚠️ ${user.mention} já é administrador.`,
          mentions: [user],
        });
      },
    }),
  ],
}));

app.router()
  .command(
    defineCommand({
      name: 'ping',
      description: 'Testa envio, reply e edição.',

      async execute(message) {
        const startedAt = Date.now();
        const sent = await app.message.reply(message, { text: 'Calculando...' });
        await app.message.edit(sent, `Pong! ${Date.now() - startedAt}ms`);
      },
    }),
  )
  .command(
    defineCommand({
      name: 'status',
      description: 'Mostra a saúde atual da aplicação.',
      aliases: ['health'],

      async execute(message) {
        const health = app.health();
        const uptime = Math.floor(health.uptimeMs / 1_000);
        await app.message.reply(message, {
          text: [
            `Status: ${health.status}`,
            `Conectado: ${health.ready ? 'sim' : 'não'}`,
            `Uptime: ${uptime}s`,
          ].join('\n'),
        });
      },
    }),
  )
  .command(
    defineCommand({
      name: 'echo',
      description: 'Repete o texto recebido.',

      async execute(message, args) {
        const text = args.rest();
        await app.message.send(message.chatId, {
          text: text || `Uso: ${prefix}echo algum texto`,
        });
      },
    }),
  )
  .command(
    defineCommand({
      name: 'fechar',
      description: 'Fecha o grupo para mensagens de membros.',
      aliases: ['close'],
      onlyGroup: true,
      onlyAdmin: true,
      botMustBeAdmin: true,

      async execute(message) {
        const result = await app.group.close(message.chatId);
        await app.message.reply(message, {
          text: result.changed ? 'Grupo fechado.' : 'Este grupo já está fechado.',
        });
      },
    }),
  )
  .command(
    defineCommand({
      name: 'abrir',
      description: 'Abre o grupo para mensagens de membros.',
      aliases: ['open'],
      onlyGroup: true,
      onlyAdmin: true,
      botMustBeAdmin: true,

      async execute(message) {
        const result = await app.group.open(message.chatId);
        await app.message.reply(message, {
          text: result.changed ? 'Grupo aberto.' : 'Este grupo já está aberto.',
        });
      },
    }),
  )
  .command(
    defineCommand({
      name: 'banir',
      description: 'Remove um membro do grupo.',
      aliases: ['ban', 'remove'],
      onlyGroup: true,
      onlyAdmin: true,
      botMustBeAdmin: true,

      async execute(message, args) {
        const user = await app.user.resolve(message, args);
        const result = await app.member.remove(message.chatId, user);
        await app.message.reply(message, {
          text: result.changed ? 'Membro removido.' : 'Este membro já não está no grupo.',
        });
      },
    }),
  )
  .command(
    defineCommand({
      name: 'promover',
      description: 'Promove um membro a administrador.',
      aliases: ['promote'],
      onlyGroup: true,
      onlyAdmin: true,
      botMustBeAdmin: true,

      async execute(message, args) {
        const user = await app.user.resolve(message, args);
        const result = await app.member.promote(message.chatId, user);
        let text = 'Este membro já é administrador.';

        if (result.changed) {
          text = 'Membro promovido a administrador.';
        } else if (result.state === 'not_in_group') {
          text = 'Este usuário não está no grupo.';
        }

        await app.message.reply(message, {
          text,
        });
      },
    }),
  )
  .command(
    defineCommand({
      name: 'rebaixar',
      description: 'Remove o cargo de administrador.',
      aliases: ['demote'],
      onlyGroup: true,
      onlyAdmin: true,
      botMustBeAdmin: true,

      async execute(message, args) {
        const user = await app.user.resolve(message, args);
        const result = await app.member.demote(message.chatId, user);
        let text = 'Este membro não é administrador.';

        if (result.changed) {
          text = 'Cargo de administrador removido.';
        } else if (result.state === 'not_in_group') {
          text = 'Este usuário não está no grupo.';
        }

        await app.message.reply(message, {
          text,
        });
      },
    }),
  )
  .command(
    defineCommand({
      name: 'mencionar',
      description: 'Testa uma menção nativa.',
      aliases: ['mention'],

      async execute(message, args) {
        const user = await app.user.resolve(message, args);
        await app.message.reply(message, {
          text: `Olá, ${user.mention}!`,
          mentions: [user],
        });
      },
    }),
  )
  .command(
    defineCommand({
      name: 'apagar',
      description: 'Apaga a mensagem respondida.',
      aliases: ['delete'],
      onlyGroup: true,
      onlyAdmin: true,
      botMustBeAdmin: true,

      async execute(message) {
        if (!message.quoted) {
          await app.message.reply(message, {
            text: `Uso: responda uma mensagem com ${prefix}apagar`,
          });
          return;
        }

        await app.message.delete(message.quoted.key);
      },
    }),
  )
  .command(
    defineCommand({
      name: 'mutar',
      description: 'Silencia um membro por tempo determinado ou indefinido.',
      aliases: ['mute'],
      onlyGroup: true,
      onlyAdmin: true,
      botMustBeAdmin: true,

      async execute(message, args) {
        const user = await app.user.resolve(message, args);
        const durationMs = args.duration('tempo', { optional: true });
        const result = await app.mute.add(message.chatId, user, {
          ...(durationMs !== undefined ? { durationMs } : {}),
        });
        const alreadyMuted = result.state === 'already_muted';
        const expiration = result.record.expiresAt
          ? ` até ${result.record.expiresAt.toLocaleString('pt-BR')}`
          : ' sem data de expiração';
        await app.message.reply(message, {
          text: alreadyMuted
            ? `${user.mention} já estava mutado${expiration}.`
            : `${user.mention} foi mutado${expiration}.`,
          mentions: [user],
        });
      },
    }),
  )
  .command(
    defineCommand({
      name: 'desmutar',
      description: 'Remove o mute de um membro.',
      aliases: ['unmute'],
      onlyGroup: true,
      onlyAdmin: true,
      botMustBeAdmin: true,

      async execute(message, args) {
        const user = await app.user.resolve(message, args);
        const result = await app.mute.remove(message.chatId, user);
        await app.message.reply(message, {
          text: result.changed
            ? `${user.mention} foi desmutado.`
            : `${user.mention} não estava mutado.`,
          mentions: [user],
        });
      },
    }),
  );

app.on('call', async (call) => {
  if (call.status !== 'offer') {
    return;
  }

  await app.chat.rejectCall(call.id, call.from);
});

await app.login({
  onCode(code) {
    console.log(`Código de pareamento: ${code}`);
  },
});

const target = process.env.TARGET_JID;

if (target) {
  const sent = await app.message.send(target, { text: 'WhaNext conectado.' });
  await app.message.edit(sent, 'WhaNext conectado e edição funcionando.');
}

const commands = [
  'ping',
  'status',
  'echo',
  'fechar',
  'abrir',
  'banir',
  'promover',
  'rebaixar',
  'mencionar',
  'apagar',
  'mutar',
  'desmutar',
].map((command) => `${prefix}${command}`);

console.log(`Pronto. Teste ${commands.join(', ')}.`);

function parseLogLevel(value: string | undefined): LogLevel {
  const levels: LogLevel[] = [
    'debug',
    'info',
    'warn',
    'error',
    'silent',
  ];
  return levels.find((level) => level === value) ?? 'info';
}

function parseLogFormat(value: string | undefined): LogFormat {
  return value === 'json' ? 'json' : 'pretty';
}
