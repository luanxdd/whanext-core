# WhaNext

[![npm](https://img.shields.io/npm/v/%40whanext%2Fcore.svg)](https://www.npmjs.com/package/@whanext/core)
[![CI](https://github.com/luanxdd/whanext-core/actions/workflows/ci.yml/badge.svg)](https://github.com/luanxdd/whanext-core/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/node/v/%40whanext%2Fcore.svg)](https://www.npmjs.com/package/@whanext/core)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-3178c6.svg)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

SDK de alto nível para construir aplicações de WhatsApp com TypeScript. O WhaNext organiza conexão, mensagens, mídias, usuários, grupos, comandos, cache, moderação e logs em uma API única; os detalhes do provider permanecem internos.

```ts
import {
  Browser,
  create,
} from '@whanext/core';

const app = await create({
  phone: process.env.PHONE,
  browser: Browser.Windows,
  auth: './session',
  prefix: '!',
  logger: 'info',
});

await app.login({
  onCode(code) {
    console.log('Código de pareamento:', code);
  },
});
```

## Por que WhaNext?

- API pública sem objetos ou tipos crus do Baileys.
- Login por pairing code, sessão persistente e reconexão automática.
- Uma ou várias contas independentes no mesmo processo com `createMulti()`.
- Prefixo global e comandos declarativos com argumentos tipados.
- Comandos exclusivos da conta conectada com `guards.owner()` ou `onlyOwner`.
- Usuários normalizados entre JID, LID e PN.
- Mensagens, replies, edição, exclusão, menções, mídias e download normalizado.
- Operações de grupos e membros com resultados idempotentes.
- Cache de metadados transparente e substituível.
- Mute permanente ou temporário com SQLite ou banco próprio.
- Logging estruturado, sanitizado e configurável.
- TypeScript estrito, testes unitários e declarações ESM.

## Requisitos

- Node.js 22.5 ou superior
- Projeto ESM

## Instalação

```bash
npm install @whanext/core
```

## Início rápido

```ts
import {
  Browser,
  create,
  defineCommand,
} from '@whanext/core';

const app = await create({
  phone: process.env.PHONE,
  browser: Browser.Windows,
  auth: './session',
  prefix: '#',
  logger: {
    level: 'info',
    format: 'pretty',
  },
  mute: {
    enabled: true,
    database: './data/whanext.sqlite',
  },
});

app.router().command(
  defineCommand({
    name: 'ping',
    description: 'Verifica se o bot está respondendo.',

    async execute(message) {
      const sent = await app.message.reply(message, {
        text: 'Calculando...',
      });

      await app.message.edit(sent, 'Pong!');
    },
  }),
);

await app.login({
  onCode(code) {
    console.log('Código de pareamento:', code);
  },
});
```

O prefixo é definido uma vez. O router identifica o comando, remove o prefixo e cria o `ArgsParser` automaticamente.

## Múltiplas contas

Para manter duas, três ou mais contas de WhatsApp no mesmo processo, use `createMulti()`. Cada conta possui conexão, sessão, cache, reconexão e identidade próprios. A instância conjunta apenas coordena essas aplicações independentes.

```ts
import {
  Browser,
  createMulti,
  defineCommand,
  guards,
} from '@whanext/core';

const multi = await createMulti({
  prefix: ';',
  browser: Browser.Windows,
  authRoot: './sessions',
  logger: 'info',
  accounts: [
    { id: 'principal', phone: process.env.PHONE_1 },
    { id: 'secundaria', phone: process.env.PHONE_2 },
    { id: 'terceira', phone: process.env.PHONE_3 },
  ],
});

multi.commands.command(defineCommand({
  name: 'painel',
  description: 'Exibe um painel exclusivo do dono.',
  guards: [guards.owner()],
  async execute(ctx) {
    await ctx.reply(`Conta: ${ctx.account.id}`);
  },
}));

await multi.login({
  onCode(accountId, code) {
    console.log(`[${accountId}] Código de pareamento:`, code);
  },
});
```

Quando `auth` não é informado na conta, o WhaNext cria automaticamente caminhos separados como `./sessions/principal`, `./sessions/secundaria` e `./sessions/terceira`. O mesmo diretório de sessão não pode ser usado por duas contas do provider padrão.

Uma conta específica continua sendo um `WhaNextApp` completo:

```ts
const principal = multi.get('principal');

if (principal?.isReady) {
  await principal.message.send('5511999999999@s.whatsapp.net', {
    text: 'Olá pela conta principal.',
  });
}
```

`multi.commands.command()`, `use()`, `onError()` e `load()` aplicam a mesma configuração de comandos a todas as contas. Dentro de um comando, `ctx.account.id` informa qual conta recebeu e executou aquela interação. Eventos também podem ser observados em conjunto com `multi.on()`.

## Logging

O nível padrão é `info`. Estão disponíveis `debug`, `info`, `warn`, `error` e `silent`.

```ts
const app = await create({
  logger: 'silent',
});
```

Para desenvolvimento:

```ts
const app = await create({
  logger: {
    level: 'debug',
    format: 'pretty',
  },
});
```

Para produção e coleta centralizada:

```ts
const app = await create({
  logger: {
    level: 'info',
    format: 'json',
  },
});
```

Um writer próprio recebe entradas normalizadas:

```ts
const app = await create({
  logger: {
    level: 'debug',

    writer(entry) {
      observability.write(entry);
    },
  },
});
```

```ts
interface LogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  scope: string;
  message: string;
  context: Readonly<Record<string, unknown>>;
}
```

O logger:

- filtra antes de construir a saída;
- propaga alterações de nível para escopos internos;
- converte `Error`, `Date`, `bigint` e referências circulares;
- protege `auth`, `pairingCode`, `password`, `phone`, `secret`, `session` e `token`;
- nunca deixa uma falha do writer interromper a aplicação;
- transforma logs internos do provider em mensagens sanitizadas;
- mantém detalhes internos do provider em `debug`.

O nível pode ser alterado em execução:

```ts
app.logger.setLevel('debug');
app.logger.info('Configuração atualizada', {
  feature: 'moderation',
});
```

Chaves adicionais podem ser protegidas:

```ts
const app = await create({
  logger: {
    level: 'info',
    redact: ['apiKey', 'customerId'],
  },
});
```

## Health checks

`app.health()` entrega um snapshot sem consultar o WhatsApp novamente:

```ts
const health = app.health();

console.log(health.status);
console.log(health.ready);
console.log(health.state);
console.log(health.uptimeMs);
console.log(health.muteEnabled);
console.log(health.logLevel);
```

Estados possíveis: `idle`, `starting`, `ready` e `stopped`.

```ts
server.get('/health', async () => app.health());
```

Para uma verificação simples:

```ts
if (app.isReady) {
  console.log('Aplicação pronta.');
}
```

## Usuários

Toda mensagem possui `message.sender: User`. Menções ficam em `message.mentionedUsers`, e o remetente de um reply em `message.quoted?.sender`.

O provider Baileys também classifica o payload em `message.contentKind`, sem exigir acesso aos tipos internos do Baileys ou download da mídia:

```ts
app.on('message', async (message) => {
  if (message.contentKind === 'location') {
    console.log('Localização recebida');
  }

  if (message.contentKind === 'poll') {
    console.log('Enquete recebida');
  }
});
```

Os valores disponíveis são `text`, `image`, `video`, `audio`, `document`, `sticker`, `location`, `contact`, `poll`, `catalog` e `unknown`. Para mídia baixável, continue usando `message.media.kind`.

```ts
app.on('message', async (message) => {
  console.log(message.sender.id);
  console.log(message.sender.jid);
  console.log(message.sender.lid);
  console.log(message.sender.phone);
  console.log(message.sender.name);
  console.log(message.sender.displayName);
  console.log(message.sender.mention);
  console.log(message.sender.identities);
});
```

Dentro de comandos, o resolver aceita menção, reply ou número com DDI:

```ts
async execute(message, args) {
  const user = await app.user.resolve(message, args);

  await app.message.reply(message, {
    text: `Olá, ${user.mention}!`,
    mentions: [user],
  });
}
```

O consumidor não precisa cortar servidores, remover sufixos de dispositivo ou comparar manualmente JID e LID.

## Mensagens

```ts
const sent = await app.message.send(chatId, {
  text: 'Mensagem sem reply.',
});

await app.message.reply(message, {
  text: 'Mensagem respondida.',
});

await app.message.edit(sent, 'Texto atualizado.');
await app.message.delete(sent);

await app.message.react(sent, '👏🏻');
await app.message.unreact(sent);
```

`delete()` aceita `Message`, `SentMessage` ou `MessageKey`.

`react()` aceita os mesmos tipos e adiciona uma reação à mensagem. `unreact()` remove a reação da conta conectada.

## Mídias

```ts
await app.media.image(chatId, {
  image: { path: './photo.jpg' },
  caption: `Olá, ${user.mention}!`,
  mentions: [user],
});

await app.media.video(chatId, {
  video: { url: 'https://example.com/video.mp4' },
  caption: 'Novo vídeo',
});

await app.media.audio(chatId, {
  audio: bytes,
  mimetype: 'audio/ogg; codecs=opus',
  voice: true,
});

await app.media.sticker(chatId, {
  sticker: { path: './sticker.webp' },
});

const downloaded = await app.media.download(message);

await writeFile(`./downloads/${downloaded.fileName ?? message.id}`, downloaded.data);
```

`download()` aceita a `Message` recebida ou a sua `MessageKey` e devolve o buffer junto dos metadados normalizados. A mídia deve ser baixada enquanto a mensagem ainda está no cache da instância; o provider tenta renovar a URL de mídia automaticamente quando necessário.

Stickers aceitam `Uint8Array`, URL ou caminho local e devem estar em WebP, inclusive para animações. Texto, imagem e vídeo aceitam `User` diretamente em `mentions`.

## Grupos e membros

```ts
await app.group.open(groupId);
await app.group.close(groupId);
await app.group.invite(groupId);
await app.group.revokeInvite(groupId);
await app.group.pin(groupId, message.keys);
await app.group.unpin(groupId, message.keys);

await app.member.remove(groupId, user);
await app.member.promote(groupId, user);
await app.member.demote(groupId, user);
```

Estados como `already_open`, `already_admin`, `not_admin`, `not_in_group` e `already_removed` evitam mutações redundantes. A biblioteca escolhe automaticamente a identidade correta para grupos LID ou PN e só retorna sucesso depois da confirmação do WhatsApp.

Mudanças feitas por outros participantes podem ser acompanhadas sem lidar com o provider:

```ts
app.on('groupParticipantsChanged', async (change) => {
  console.log(change.groupId);
  console.log(change.action);
  console.log(change.participantIds);
  console.log(change.authorId);
});
```

`action` pode ser `add`, `remove`, `promote`, `demote` ou `modify`. O cache de metadados do grupo é invalidado antes desse evento ser emitido.

## Mute nativo

Quando habilitado, o mute é aplicado antes dos eventos públicos e do router. Mensagens de um usuário mutado são apagadas automaticamente.

```ts
const user = await app.user.resolve(message, args);
const durationMs = args.duration('tempo', {
  optional: true,
});

const result = await app.mute.add(message.chatId, user, {
  ...(durationMs !== undefined ? { durationMs } : {}),
});
```

Sem duração, o mute é permanente. O parser aceita `30s`, `5m`, `2h`, `7d`, `sempre`, `permanente` e `indefinido`.

```ts
await app.mute.isMuted(groupId, user);
await app.mute.get(groupId, user);
await app.mute.remove(groupId, user);
await app.mute.purgeExpired();
```

Resultados distinguem `muted`, `updated`, `already_muted`, `unmuted` e `already_unmuted`.

O store padrão é SQLite com WAL, transações, espera controlada e índices de identidade e expiração:

```ts
const app = await create({
  mute: {
    enabled: true,
    database: './data/whanext.sqlite',
  },
});
```

Um banco próprio pode implementar `MuteStore`:

```ts
import type {
  MuteStore,
  StoredMute,
} from '@whanext/core';

const store: MuteStore = {
  async upsert(mute: StoredMute) {},

  async find(groupId, identities) {
    return undefined;
  },

  async delete(groupId, identities) {
    return false;
  },

  async purgeExpired(now) {
    return 0;
  },
};

const app = await create({
  mute: { store },
});
```

## Comandos

O sistema moderno usa um contexto semelhante às interactions do Discord. `ctx` contém a mensagem normalizada, usuário, chat, grupo, services, options, sinal de cancelamento e helpers de resposta.

```ts
import {
  defineCommand,
  guards,
  option,
} from '@whanext/core';

app.commands.command(
  defineCommand({
    name: 'ban',
    aliases: ['banir'],
    description: 'Remove um membro do grupo.',
    category: 'moderação',

    guards: [
      guards.group(),
      guards.userAdmin(),
      guards.botAdmin(),
    ],

    options: {
      user: option.user({
        description: 'Usuário que será removido.',
        required: true,
      }),
      reason: option.string({
        description: 'Motivo da remoção.',
        rest: true,
      }),
    },

    cooldown: {
      durationMs: 5_000,
      scope: 'user-chat',
    },

    concurrency: {
      scope: 'chat',
      max: 1,
      strategy: 'queue',
    },

    async execute(ctx) {
      const user = ctx.options.user('user');
      const reason = ctx.options.string('reason') ?? 'Não informado';
      const deferred = await ctx.defer('⏳ _Processando banimento..._');
      const result = await ctx.members.remove(ctx.chatId, user);

      await deferred.edit(
        result.changed
          ? `🔨 *Usuário banido*\n\n${user.mention} foi removido.\n• *Motivo:* ${reason}`
          : `⚠️ O usuário não está mais no grupo.`,
      );
    },
  }),
);
```

### Comandos exclusivos do dono

O dono é a própria conta conectada naquela aplicação. Não é necessário salvar número, JID ou LID manualmente. O provider usa a marca de mensagem enviada pela própria conta e, quando necessário, compara as identidades normalizadas da sessão.

```ts
app.commands.command(defineCommand({
  name: 'chay',
  description: 'Comando privado da conta conectada.',
  guards: [guards.owner()],

  async execute(ctx) {
    await ctx.reply('💣 *Comando autorizado*');
  },
}));
```

No contexto moderno também é possível consultar a informação diretamente:

```ts
if (ctx.isOwner) {
  console.log(ctx.account.ids);
}
```

Na API legada, use `onlyOwner: true`:

```ts
app.router().command(defineCommand({
  name: 'interno',
  description: 'Comando exclusivo do dono.',
  onlyOwner: true,
  execute(message) {
    return app.message.reply(message, { text: 'Autorizado.' });
  },
}));
```

Em uma instância criada com `createMulti()`, o dono é resolvido separadamente para cada conta. Uma mensagem enviada pela conta `principal` não passa automaticamente como dona da conta `secundaria`.

### Subcomandos

```ts
import {
  defineCommandGroup,
  defineSubcommand,
  guards,
} from '@whanext/core';

app.commands.command(defineCommandGroup({
  name: 'grupo',
  aliases: ['group'],
  description: 'Gerencia o grupo.',
  category: 'grupos',
  guards: [guards.group(), guards.userAdmin(), guards.botAdmin()],

  subcommands: [
    defineSubcommand({
      name: 'abrir',
      aliases: ['open'],
      description: 'Abre o grupo.',
      async execute(ctx) {
        await ctx.groups.open(ctx.chatId);
        await ctx.reply('🔓 *Grupo aberto*');
      },
    }),
    defineSubcommand({
      name: 'fechar',
      aliases: ['close'],
      description: 'Fecha o grupo.',
      async execute(ctx) {
        await ctx.groups.close(ctx.chatId);
        await ctx.reply('🔒 *Grupo fechado*');
      },
    }),
  ],
}));
```

Isso aceita `&grupo abrir`, `&group open`, `&grupo fechar` e `&group close` sem duplicar lógica.

### Middleware e erros

```ts
app.commands.use(async (ctx, next) => {
  const startedAt = performance.now();
  await next();
  app.logger.debug('Command completed', {
    command: ctx.command.path.join(' '),
    durationMs: performance.now() - startedAt,
  });
});

app.commands.onError(async (ctx, error) => {
  if (error.code === 'COMMAND_COOLDOWN') {
    await ctx.reply('⏱️ Aguarde um pouco antes de usar novamente.');
    return;
  }

  await ctx.reply('⚠️ *Não foi possível concluir*');
});
```

`app.commands.catalog()`, `categories()`, `find()`, `has()` e `values()` expõem a coleção registrada. `app.commands.help(ctx, { category: 'moderação' })` gera a ajuda usando descrição, usage, opções e visibilidade dos comandos.

Detalhes completos estão em [Comandos modernos](./docs/commands-v0.10.md).

### API legada

Comandos existentes continuam válidos:

```ts
app.router().command(
  defineCommand({
    name: 'promover',
    aliases: ['promote'],
    description: 'Promove um membro.',
    onlyGroup: true,
    onlyAdmin: true,
    botMustBeAdmin: true,

    async execute(message, args) {
      const user = await app.user.resolve(message, args);
      const result = await app.member.promote(message.chatId, user);

      await app.message.reply(message, {
        text: result.changed
          ? `${user.mention} foi promovido.`
          : `${user.mention} já é administrador.`,
        mentions: [user],
      });
    },
  }),
);
```

Restrições disponíveis:

- `onlyGroup`
- `onlyPrivate`
- `onlyAdmin`
- `botMustBeAdmin`
- `onlyOwner`

`ArgsParser` possui `string`, `number`, `boolean`, `enum`, `user`, `duration`, `peek`, `skip` e `rest`. `args.user()` retorna `User`, nunca uma string crua.

### Descoberta automática de comandos

A forma recomendada agora é deixar cada arquivo de comando autossuficiente e pedir ao próprio router para descobrir a árvore inteira. Não é necessário manter `index.ts` por pasta nem um arquivo central de imports:

```ts
const app = await create({ prefix: '&' });

await app.commands.load(new URL('./commands/', import.meta.url));
```

O mesmo código funciona em desenvolvimento TypeScript (com um runtime/loader como `tsx`) e depois do build: o loader reconhece `.ts`, `.mts`, `.cts`, `.js`, `.mjs` e `.cjs` por padrão. O diretório é percorrido recursivamente.

```text
src/commands/
├── admin/
│   ├── ban.ts
│   ├── mute.ts
│   └── warn.ts
├── group/
│   ├── access.ts
│   └── pin.ts
└── general/
    ├── menu.ts
    └── profile.ts
```

Um arquivo pode exportar um comando:

```ts
export default defineCommand({
  name: 'ping',
  description: 'Responde pong.',
  async execute(ctx) {
    await ctx.reply('pong');
  },
});
```

Ou vários comandos relacionados no mesmo módulo:

```ts
export const mute = defineCommand({ /* ... */ });
export const unmute = defineCommand({ /* ... */ });
```

Também é possível exportar uma coleção com `defineCommands(...)`. Exports auxiliares são ignorados quando o módulo contém pelo menos um comando válido, e o mesmo objeto não é registrado duas vezes.

Para menus dinâmicos, `CommandContext` expõe uma visão somente-leitura do catálogo e o prefixo atual:

```ts
export default defineCommand({
  name: 'menu',
  description: 'Mostra os comandos.',
  async execute(ctx) {
    const commands = ctx.commands.catalog({ category: 'administração' });
    const lines = commands.map((command) =>
      `${ctx.prefix}${command.path.join(' ')} — ${command.definition.description}`,
    );

    await ctx.reply(lines.join('\n'));
  },
});
```

`ctx.commands` fornece `catalog()`, `categories()`, `find()`, `has()`, `size` e `prefix`; ele não expõe detalhes internos do provider.

Se for necessário controlar extensões ou recursão:

```ts
await app.commands.load(new URL('./commands/', import.meta.url), {
  recursive: true,
  extensions: ['.ts'],
});
```

`loadCommands(registrar, directory, options)` continua disponível como API de baixo nível para registradores customizados. O retorno contém arquivos carregados/ignorados e os comandos descobertos.

## Cache externo

```ts
const app = await create({
  cache: {
    store: myRedisStore,
    groupTtlMs: 300_000,
    memoryMaxEntries: 1_000,
  },
});
```

O cache padrão vive na instância do app, usa LRU limitado e elimina entradas expiradas durante as leituras. Consultas simultâneas dos mesmos metadados são agrupadas em uma única chamada ao WhatsApp. Eventos e mutações de grupo invalidam automaticamente entradas relacionadas.

Os mesmos metadados também alimentam internamente o `cachedGroupMetadata` do Baileys. Em grupos já aquecidos, isso remove a consulta de metadados do caminho de envio; mensagens continuam aguardando somente criptografia, upload quando houver mídia e confirmação da rede.

Para observar um `MemoryCache` criado diretamente:

```ts
import { MemoryCache } from '@whanext/core';

const cache = new MemoryCache({ maxEntries: 5_000 });

console.log(cache.stats());
cache.prune();
```

`stats()` informa `size`, `maxEntries`, `hits`, `misses`, `sets`, `evictions` e `expirations`.

Para uma única instância, o cache padrão é suficiente mesmo com muitos grupos, desde que `memoryMaxEntries` seja dimensionado. Em várias instâncias/processos, use um `CacheStore` distribuído para o cache público; cada conexão mantém ainda um L1 local limitado para o caminho criptográfico do Baileys. Não compartilhe uma mesma sessão ativa entre processos.

O cache interno de mensagens mantém até 1.000 mensagens por padrão para replies, reenvios do provider e downloads de mídia. Ajuste quando necessário:

```ts
const app = await create({ messageCacheSize: 2_000 });
```

Não há delay artificial no envio. Presença é enviada diretamente e previews de alta qualidade permanecem desativados no provider; mídias ainda dependem do tempo de leitura, criptografia e upload ao WhatsApp.

Para limites, dimensionamento e decisões de produção, consulte [Desempenho e escala](./docs/performance-and-scale.md).

## Presença

```ts
await app.chat.typing(chatId);
await app.chat.recording(chatId);
await app.chat.stopTyping(chatId);
```

`typing()` envia `composing`, `recording()` envia `recording` com mídia de áudio e `stopTyping()` envia `paused`, conforme o protocolo do WhatsApp. Nenhuma assinatura de presença desnecessária é feita antes do envio.

## Chamadas

```ts
app.on('call', async (call) => {
  if (call.status !== 'offer') {
    return;
  }

  await app.chat.rejectCall(call.id, call.from);
});
```

`call.status` reflete o ciclo da chamada (`offer`, `ringing`, `preaccept`, `timeout`, `reject`, `accept`). `call.isVideo` e `call.isGroup` indicam o tipo. Somente chamadas em `offer` podem ser rejeitadas.

## Erros

```ts
app.on('error', (error) => {
  console.error(error.code);
  console.error(error.context);
  console.error(error.recoverable);
});
```

Todos os erros públicos usam `WhaNextError` e códigos estáveis. O logger registra erros normalizados sem exigir conhecimento do provider.

## API

| Domínio | Responsabilidade |
| --- | --- |
| `app.message` | Envio, reply, edição, exclusão, texto e reações |
| `app.media` | Envio, download e stickers |
| `app.group` | Estado, convite, pin e metadados |
| `app.member` | Remoção, promoção e rebaixamento |
| `app.user` | Criação e resolução de usuários |
| `app.mute` | Mute, desmute, consulta e expiração |
| `app.chat` | Indicadores de presença e rejeição de chamadas |
| `app.logger` | Logging e nível em execução |
| `app.router()` | Registro e despacho de comandos |
| `loadCommands()` | Autoload de comandos a partir de uma pasta |
| `app.health()` | Snapshot de saúde da aplicação |
| `app.on('groupParticipantsChanged')` | Alterações de participantes em grupos |

## Exemplo executável

```bash
cp .env.example .env
npm ci
npm run build
npm run example
```

`examples/index.ts` cobre conexão, logging, health check, envio, reply, edição, exclusão, menções, grupos, membros, mute, desmute e rejeição automática de chamadas.

## Desenvolvimento

```bash
npm ci
npm run check
npm pack --dry-run
```

## Publicação

O repositório inclui:

- CI em Node.js 22 e 24;
- inspeção do pacote npm;
- publicação ao criar uma GitHub Release;
- trusted publishing por OIDC;
- provenance automática do npm;
- templates de bug, feature e pull request;
- política de segurança e guia de contribuição.

O `package.json` está vinculado ao repositório `luanxdd/whanext-core`, como exigido pelo npm para trusted publishing e provenance.

Depois da primeira publicação do pacote, configure no npm o trusted publisher apontando para `publish.yml` e para o environment `npm` do GitHub. O workflow não armazena um token npm de longa duração.

## Segurança

Consulte [SECURITY.md](./SECURITY.md) antes de reportar uma vulnerabilidade. Nunca publique sessão, pairing code, telefone, token, banco local ou logs não sanitizados.

## Contribuindo

Consulte [CONTRIBUTING.md](./CONTRIBUTING.md). Mudanças na API pública devem manter o provider isolado, incluir testes e atualizar a documentação correspondente.

## Licença

MIT. Consulte [LICENSE](./LICENSE).

## Aviso

WhaNext não é afiliado, autorizado ou mantido pelo WhatsApp ou pela Meta. O provider padrão usa uma integração não oficial; quem utiliza o projeto é responsável pelos termos aplicáveis e pelos riscos de bloqueio da conta.


### Reposting received messages

WhaNext can repost a recently received message while preserving its original WhatsApp payload:

```ts
await app.message.repost(message.quoted!.key, message.chatId, {
  mentions: users,
});
```

The source message must still be present in the provider recent-message cache. This avoids downloading and reconstructing media or structured messages.
