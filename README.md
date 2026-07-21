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
- Prefixo global e comandos declarativos com argumentos tipados.
- Usuários normalizados entre JID, LID e PN.
- Mensagens, replies, edição, exclusão, menções e mídias.
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
```

`delete()` aceita `Message`, `SentMessage` ou `MessageKey`.

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
```

Texto, imagem e vídeo aceitam `User` diretamente em `mentions`.

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

`ArgsParser` possui `string`, `number`, `boolean`, `enum`, `user`, `duration`, `peek`, `skip` e `rest`. `args.user()` retorna `User`, nunca uma string crua.

## Cache externo

```ts
const app = await create({
  cache: {
    store: myRedisStore,
    groupTtlMs: 300_000,
  },
});
```

O cache padrão vive na instância do app. Eventos e mutações de grupo invalidam automaticamente entradas relacionadas.

## Presença

```ts
await app.chat.typing(chatId);
await app.chat.recording(chatId);
await app.chat.stopTyping(chatId);
```

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
| `app.message` | Envio, reply, edição, exclusão e texto |
| `app.media` | Imagem, vídeo e áudio |
| `app.group` | Estado, convite, pin e metadados |
| `app.member` | Remoção, promoção e rebaixamento |
| `app.user` | Criação e resolução de usuários |
| `app.mute` | Mute, desmute, consulta e expiração |
| `app.chat` | Indicadores de presença e rejeição de chamadas |
| `app.logger` | Logging e nível em execução |
| `app.router()` | Registro e despacho de comandos |
| `app.health()` | Snapshot de saúde da aplicação |

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
