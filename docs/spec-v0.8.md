# WhaNext — Especificação v0.8.0

## 1. Visão

WhaNext é um SDK TypeScript de alto nível para aplicações de WhatsApp. A API pública representa conceitos de domínio e não expõe sockets, eventos, chaves ou tipos específicos do provider.

Baileys é o provider inicial e substituível. Ele permanece restrito ao adaptador interno.

## 2. Objetivos

- Login, pairing code e reconexão sem lógica de socket no consumidor.
- Mensagens, usuários e identidades normalizados.
- Operações de grupos e membros idempotentes.
- Comandos declarativos com prefixo, autorização e argumentos tipados, com autoload opcional a partir de uma pasta.
- Cache de metadados transparente, limitado e com deduplicação de consultas concorrentes.
- Download de mídia normalizado, com renovação automática da URL quando suportada pelo provider.
- Mute persistente aplicado antes da lógica do bot.
- Chamadas de voz e vídeo normalizadas, com rejeição sem lógica de socket no consumidor.
- Logging estruturado sem vazamento de dados internos do provider.
- Health checks sem chamadas adicionais ao WhatsApp.
- Pacote verificável e publicável por CI.

## 3. Superfície pública

| Domínio | Responsabilidade | Métodos principais |
| --- | --- | --- |
| `app.message` | Mensagens e exclusão | `send`, `reply`, `edit`, `delete`, `text`, `react`, `unreact` |
| `app.media` | Mídias | `image`, `video`, `audio`, `sticker`, `download` |
| `app.group` | Estado e metadados | `open`, `close`, `invite`, `revokeInvite`, `pin`, `unpin`, `metadata` |
| `app.member` | Participantes | `remove`, `promote`, `demote` |
| `app.user` | Resolução de identidades | `resolve`, `from` |
| `app.mute` | Moderação persistente | `add`, `remove`, `get`, `isMuted`, `purgeExpired` |
| `app.chat` | Presença e chamadas | `typing`, `recording`, `stop`, `stopTyping`, `rejectCall` |
| `app.logger` | Logging público | `debug`, `info`, `warn`, `error`, `child`, `setLevel` |
| `app.router()` | Comandos | `command`, `dispatch` |
| `loadCommands()` | Autoload de comandos | função solta, não pertence ao `app` |
| `app.health()` | Saúde da aplicação | snapshot síncrono |
| `app.on` | Eventos | `message`, `connection`, `error`, `mute`, `call`, `groupParticipantsChanged` |

## 4. Criação

```ts
const app = await create({
  phone: process.env.PHONE,
  prefix: '!',
  browser: Browser.Windows,
  auth: './session',
  logger: {
    level: 'info',
    format: 'pretty',
  },
  mute: {
    enabled: true,
    database: './data/whanext.sqlite',
  },
});
```

O prefixo é removido antes da criação do `ArgsParser`. O logger é criado antes do provider para capturar todo o ciclo de conexão.

## 5. Logging

### 5.1 Tipos

```ts
type LogLevel =
  | 'debug'
  | 'info'
  | 'warn'
  | 'error'
  | 'silent';

type LogFormat = 'pretty' | 'json';

interface LogEntry {
  timestamp: string;
  level: Exclude<LogLevel, 'silent'>;
  scope: string;
  message: string;
  context: Readonly<Record<string, unknown>>;
}
```

O nível padrão é `info`. Prioridades crescem de `debug` até `error`; `silent` desativa todas as entradas.

### 5.2 Configuração

Forma curta:

```ts
const app = await create({ logger: 'silent' });
```

Forma completa:

```ts
const app = await create({
  logger: {
    level: 'debug',
    format: 'json',
    redact: ['apiKey'],
    writer(entry) {
      transport.write(entry);
    },
  },
});
```

Quando `writer` é informado, ele substitui a saída de console. O retorno pode ser síncrono ou uma `Promise`; rejeições e exceções nunca interrompem a aplicação.

### 5.3 Contexto

Antes do writer, o logger:

- converte `Error` em nome, mensagem e código opcional;
- converte `Date` para ISO;
- converte `bigint` para string;
- representa referências circulares sem lançar erro;
- aceita somente contexto serializável;
- protege chaves sensíveis em qualquer profundidade.

Redactions padrão: `auth`, `pairingCode`, `password`, `phone`, `secret`, `session` e `token`. Variações compostas como `phoneNumber` e `accessToken` também são protegidas.

### 5.4 Escopos e nível dinâmico

```ts
const routerLogger = app.logger.child('router');
app.logger.setLevel('debug');
routerLogger.debug('Dispatch enabled');
```

Todos os filhos compartilham o mesmo estado de nível. Alterar o logger raiz afeta provider e escopos já existentes.

### 5.5 Fronteira do provider

O adaptador de logs do provider:

- mapeia `trace`, `debug` e `info` internos para `debug` público;
- preserva `warn` e `error`;
- descarta payloads internos;
- permite apenas `location`, `reason`, `status`, `statusCode` e `type` como contexto;
- não publica chaves criptográficas, nós de protocolo ou objetos crus.

## 6. Saúde

```ts
interface AppHealth {
  status: 'idle' | 'starting' | 'ready' | 'stopped';
  state: ConnectionState;
  ready: boolean;
  uptimeMs: number;
  timestamp: Date;
  muteEnabled: boolean;
  logLevel: LogLevel;
}
```

`app.health()` usa apenas estado local. Ele não abre sockets nem consulta o provider. `app.isReady` equivale ao estado conectado.

Mapeamento:

| Conexão | Saúde |
| --- | --- |
| `idle` | `idle` |
| `connecting` | `starting` |
| `reconnecting` | `starting` |
| `connected` | `ready` |
| `closed` | `stopped` |

## 7. Modelo de usuário

`User` reúne `id`, `identities`, `jid`, `lid`, `phoneNumber`, `phone`, `username`, `mentionId`, `mention`, `name` e `displayName`.

`message.sender` é sempre um `User`. `message.mentionedUsers` contém usuários mencionados e `message.quoted?.sender` representa o autor da mensagem respondida.

`app.user.resolve(message, args)` usa, em ordem:

1. primeira menção nativa;
2. autor da mensagem respondida;
3. próximo telefone consumido pelo parser.

Em grupos, o usuário é enriquecido pelo cache para unir JID, LID e número.

## 8. Mensagens

Mensagens públicas contêm chaves, texto, legenda, mídia, visualização única, reply, menções, remetente normalizado e identidades alternativas.

Conteúdo enviado aceita `MentionTarget = string | User`. O provider converte o alvo somente na fronteira interna.

`app.message.delete()` aceita `Message`, `SentMessage` ou `MessageKey`.

### 8.1 Reações

`app.message.react(message, emoji)` adiciona uma reação à mensagem selecionada. `app.message.unreact(message)` remove a reação da conta conectada. Ambos aceitam `Message`, `SentMessage` ou `MessageKey` e retornam a confirmação normalizada do envio.

### 8.2 Stickers

`app.media.sticker(chatId, { sticker })` envia um sticker estático ou animado. A fonte aceita `Uint8Array`, `{ url }` ou `{ path }`, no mesmo padrão das demais mídias. O conteúdo deve estar em WebP para ser aceito pelo WhatsApp.

### 8.3 Download de mídia

`app.media.download(message)` aceita uma `Message` recebida ou uma `MessageKey` e retorna:

```ts
interface DownloadedMedia {
  data: Buffer;
  kind: 'image' | 'video' | 'audio' | 'document' | 'sticker';
  mimetype?: string;
  fileName?: string;
}
```

O download usa a mensagem que permanece no cache interno do provider. Se a URL da mídia estiver expirada, o provider pode renová-la automaticamente. Caso a mensagem não esteja mais disponível no cache ou não contenha mídia, a operação lança `WhaNextError` com código `MEDIA_NOT_AVAILABLE` e `recoverable: true`.

## 9. Grupos e membros

Operações sensíveis ao estado retornam resultados discriminados:

```ts
type ChangeResult<State extends string> =
  | { ok: true; changed: true; state: State }
  | { ok: true; changed: false; state: State };
```

Estados incluem `already_open`, `already_closed`, `already_removed`, `already_admin`, `not_admin` e `not_in_group`.

Grupos possuem `addressingMode: 'lid' | 'pn'`. Mutações encontram participantes por todas as identidades conhecidas e só consideram status `200` como sucesso.

### 9.1 Alterações de participantes

```ts
interface GroupParticipantsChanged {
  groupId: string;
  action: 'add' | 'remove' | 'promote' | 'demote' | 'modify';
  participantIds: string[];
  authorId?: string;
}
```

`app.on('groupParticipantsChanged', listener)` recebe alterações feitas por participantes ou administradores. O cache de metadados do grupo é invalidado antes da notificação pública. `authorId` só é incluído quando o WhatsApp o disponibiliza.

## 10. Mute

SQLite é o store padrão e usa WAL, `busy_timeout`, transações, tabela estrita e índices de expiração e identidade.

Stores externos implementam `MuteStore`. O serviço verifica a expiração independentemente do comportamento do banco injetado.

Estados: `muted`, `updated`, `already_muted`, `unmuted` e `already_unmuted`.

Para cada mensagem recebida:

1. ignora conversa privada e mensagem da própria conta;
2. procura o remetente por todas as identidades;
3. remove registros vencidos;
4. apaga a mensagem quando há mute ativo;
5. registra a moderação e emite `mute`;
6. encerra antes do evento `message` e do router.

## 11. Comandos

`ArgsParser` oferece `string`, `number`, `boolean`, `enum`, `user`, `duration`, `peek`, `skip` e `rest`.

`user()` retorna `User`. `duration()` converte `ms`, `s`, `m`, `h` e `d`; valores permanentes representam duração ilimitada.

Restrições: `onlyGroup`, `onlyPrivate`, `onlyAdmin` e `botMustBeAdmin`.

### 11.1 Autoload

`loadCommands(registrar, dirPath, options?)` é uma função solta, independente do `CommandRouter`. Ela não pertence à classe do router porque resolve um problema diferente do dele: descoberta de arquivos no disco, não roteamento de mensagens.

```ts
interface CommandRegistrar {
  command(definition: CommandDefinition): unknown;
}

interface LoadCommandsOptions {
  extensions?: readonly string[];
  recursive?: boolean;
}

interface LoadedCommand {
  name: string;
  filePath: string;
}

interface LoadCommandsResult {
  loaded: readonly string[];
  skipped: readonly string[];
  commands: readonly LoadedCommand[];
}
```

`registrar` aceita qualquer objeto com um método `command()`, incluindo `CommandRouter` e mocks de teste. Isso mantém `loadCommands` desacoplado do restante do app.

Por padrão, `loadCommands` varre `dirPath` recursivamente e importa somente arquivos `.js`, `.mjs` e `.cjs`. Arquivos `.ts` não entram no conjunto padrão: a função usa `import()` dinâmico, que depende de um loader de TypeScript já ativo no processo (`tsx`, `ts-node`, `--experimental-strip-types`); sem ele, o erro resultante é obscuro e não identificado como "TypeScript não suportado". A lib não assume que esse loader existe; o consumidor habilita `.ts` explicitamente via `options.extensions` quando aplicável.

Cada arquivo pode exportar um ou vários `CommandDefinition`. O loader percorre o export padrão e todos os exports nomeados, aceitando tanto comandos individuais quanto coleções de comandos. Valores auxiliares são ignorados, e referências repetidas ao mesmo objeto são registradas uma única vez.

Para módulos com múltiplos comandos, `defineCommands(...commands)` oferece a forma declarativa recomendada e preserva a inferência dos tipos específicos de cada item:

```ts
export default defineCommands(
  defineCommand({
    name: 'mute',
    description: 'Silencia um membro.',
    async execute(message, args) { /* ... */ },
  }),
  defineCommand({
    name: 'unmute',
    description: 'Remove o silêncio de um membro.',
    async execute(message, args) { /* ... */ },
  }),
);
```

Como alternativa, cada comando pode ser um export nomeado. Um arquivo que não exporta nenhum comando válido, ou que falha ao importar, lança `WhaNextError` com código `COMMAND_LOAD_FAILED`.

## 12. Cache

O cache padrão pertence à instância do app. Metadados possuem TTL, eventos de grupo invalidam entradas e mutações invalidam o grupo depois do sucesso. Um `CacheStore` externo pode implementar armazenamento distribuído.

`MemoryCache` usa LRU, remove entradas expiradas na leitura e mantém no máximo 1.000 entradas por padrão. Esse limite pode ser ajustado com `cache.memoryMaxEntries`.

Consultas simultâneas de `app.group.metadata()` para o mesmo grupo compartilham a mesma requisição pendente, evitando chamadas duplicadas ao WhatsApp.

O provider também mantém até 1.000 mensagens por padrão para suporte a replies, recuperação interna e download de mídia. `messageCacheSize` ajusta esse limite na criação do app.

## 13. Presença

`app.chat.typing(chatId)`, `recording(chatId)` e `stopTyping(chatId)` correspondem, respectivamente, aos estados `composing`, `recording` com mídia de áudio e `paused` do protocolo. O envio é direto e não realiza assinatura de presença antes da atualização.

## 14. Erros

Erros públicos são `WhaNextError` com `code`, `context`, `recoverable` e causa opcional. Erros processados pelo app também produzem uma entrada estruturada no logger.

## 15. Chamadas

```ts
interface CallEvent {
  id: string;
  chatId: string;
  from: string;
  status: 'offer' | 'ringing' | 'preaccept' | 'timeout' | 'reject' | 'accept';
  isVideo: boolean;
  isGroup: boolean;
  date: Date;
}
```

O provider emite `call` para cada atualização de chamada recebida do WhatsApp, incluindo oferta, toque, pré-aceite, timeout, rejeição e aceite. O app apenas propaga o evento normalizado; nenhuma lógica de negócio (como rejeição automática) é aplicada pelo core.

Qualquer status retornado pelo Baileys fora desse conjunto conhecido é normalizado para `timeout`, garantindo que o tipo do provider nunca vaze para a API pública nem quebre o build ao evoluir.

`app.chat.rejectCall(callId, from)` delega ao provider a rejeição de uma chamada em andamento. `callId` e `from` correspondem a `call.id` e `call.from` do evento recebido. Rejeitar uma chamada que não está em `offer` é responsabilidade do provider subjacente e não é validado pelo core.

O evento não distingue chamadas perdidas de chamadas rejeitadas por outro dispositivo vinculado à mesma conta; ambas chegam como atualizações de `status` subsequentes ao `offer` inicial.

## 16. Publicação

O pacote contém somente build ESM, declarações, README, changelog, contribuição, segurança, licença e `package.json`.

CI executa:

- Node.js 22 e 24;
- instalação reproduzível com `npm ci`;
- build;
- typecheck;
- testes;
- inspeção do tarball npm.

Publicação ocorre por GitHub Release e usa trusted publishing OIDC, permissão `id-token: write`, runner hospedado e npm compatível. Nenhum token npm de longa duração é armazenado no workflow.

`repository.url` aponta para `github.com/luanxdd/whanext-core` e corresponde ao repositório que executa a publicação.

## 17. Critérios de aceite v0.8

- `app.media.sticker()` aceita as mesmas fontes de mídia públicas e envia o conteúdo como sticker pelo provider.
- Critérios de aceite da v0.7 permanecem válidos.

- `app.message.react()` e `unreact()` não expõem tipos nem objetos do provider.
- `groupParticipantsChanged` entrega uma alteração normalizada e invalida o cache do grupo antes de ser emitido.
- Critérios de aceite da v0.6 permanecem válidos.

- `app.media.download()` devolve bytes e metadados normalizados sem expor mensagens do provider.
- Download de mídia indisponível retorna `MEDIA_NOT_AVAILABLE` recuperável.
- O cache interno usa limite LRU e metadados de grupo agrupam consultas concorrentes.
- Presença envia apenas a atualização de estado necessária.
- Critérios de aceite da v0.5 permanecem válidos.

- `loadCommands()` registra todos os comandos exportados por padrão ou por nome, incluindo coleções e múltiplos comandos no mesmo arquivo.
- `defineCommands()` declara coleções de comandos com inferência de tipos e sem exigir um arquivo por comando.
- `loadCommands()` ignora arquivos `.ts` por padrão e os carrega apenas quando `options.extensions` inclui essa extensão.
- `loadCommands()` lança `WhaNextError` com código `COMMAND_LOAD_FAILED` para diretório inexistente, falha de importação ou arquivo sem export válido.
- `CommandRouter` permanece responsável apenas por registro e despacho; nenhuma lógica de sistema de arquivos foi adicionada a ele.
- Critérios de aceite da v0.4 permanecem válidos.
