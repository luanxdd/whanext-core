# WhaNext — Especificação v0.2

## 1. Visão

WhaNext é um SDK TypeScript de alto nível para aplicações de WhatsApp. A API pública representa conceitos de domínio e não expõe sockets, eventos, chaves ou tipos específicos do provider.

Baileys é o provider inicial e substituível. Ele não faz parte do contrato consumido por bots.

## 2. Objetivos

- Login, pairing code e reconexão sem lógica de socket no consumidor.
- Mensagens, usuários e identidades normalizados.
- Operações de grupos e membros idempotentes.
- Comandos declarativos com prefixo, autorização e argumentos tipados.
- Cache de metadados transparente.
- Mute persistente aplicado antes da lógica do bot.
- SQLite pronto como padrão e stores externos injetáveis.
- Erros públicos centralizados e independentes do provider.

## 3. Superfície pública

| Domínio | Responsabilidade | Métodos principais |
| --- | --- | --- |
| `app.message` | Mensagens e exclusão | `send`, `reply`, `edit`, `delete`, `text` |
| `app.media` | Mídias | `image`, `video`, `audio` |
| `app.group` | Estado e metadados | `open`, `close`, `invite`, `revokeInvite`, `pin`, `unpin`, `metadata` |
| `app.member` | Participantes | `remove`, `promote`, `demote` |
| `app.user` | Resolução de identidades | `resolve`, `from` |
| `app.mute` | Moderação persistente | `add`, `remove`, `get`, `isMuted`, `purgeExpired` |
| `app.chat` | Presença | `typing`, `recording`, `stop`, `stopTyping` |
| `app.router()` | Comandos | `command`, `dispatch` |
| `app.on` | Eventos | `message`, `connection`, `error`, `mute` |

## 4. Criação

```ts
const app = await create({
  phone: process.env.PHONE,
  prefix: '!',
  browser: Browser.Windows,
  auth: './session',
  cache: {
    groupTtlMs: 300_000,
  },
  mute: {
    enabled: true,
    database: './data/whanext.sqlite',
  },
  reconnect: {
    enabled: true,
    maxAttempts: 10,
    initialDelayMs: 1_000,
    maxDelayMs: 30_000,
  },
});
```

O prefixo é configurado uma vez e removido antes da criação do `ArgsParser`.

## 5. Modelo de usuário

```ts
interface UserData {
  id: string;
  identities?: readonly string[];
  jid?: string;
  lid?: string;
  phoneNumber?: string;
  name?: string;
}
```

`User` oferece:

- `id`: identidade preferencial estável disponível.
- `identities`: JID, LID, número e variantes conhecidas.
- `jid`, `lid` e `phoneNumber`: identificadores estruturados.
- `phone`: número sem servidor ou sufixo de dispositivo.
- `username`: parte utilizável da identidade preferencial.
- `mentionId` e `mention`: dados prontos para menções.
- `name` e `displayName`: apresentação normalizada.
- `matches()`: comparação entre identidades equivalentes.
- `toJSON()`: representação persistível sem detalhes do provider.

`message.sender` é sempre um `User`. `message.mentionedUsers` contém usuários mencionados e `message.quoted?.sender` representa o autor da mensagem respondida.

`app.user.resolve(message, args)` usa, em ordem:

1. primeira menção nativa;
2. autor da mensagem respondida;
3. próximo telefone consumido pelo parser.

Em grupos, o usuário é enriquecido pelo cache de participantes para unir JID, LID e número antes de qualquer mutação.

## 6. Mensagens

```ts
interface Message {
  id: string;
  jid: string;
  lid?: string;
  chatId: string;
  senderId: string;
  senderIds: string[];
  senderJid?: string;
  senderLid?: string;
  sender: User;
  keys: MessageKey;
  text?: string;
  caption?: string;
  mentions: string[];
  mentionedUsers: User[];
  timestamp: Date;
  isGroup: boolean;
  isReply: boolean;
  isViewOnce: boolean;
  hasMedia: boolean;
  media?: MessageMedia;
  quoted?: QuotedMessage;
}
```

O normalizador remove envelopes internos, extrai texto, legenda, mídia, visualização única, menções, reply, nome e identidades alternativas.

Conteúdo enviado aceita `MentionTarget = string | User`. O provider converte o alvo para sua identidade nativa somente na fronteira interna.

`app.message.delete()` aceita mensagens recebidas, mensagens enviadas ou chaves normalizadas.

## 7. Grupos e membros

Operações sensíveis ao estado retornam resultados discriminados:

```ts
type ChangeResult<State extends string> =
  | { ok: true; changed: true; state: State }
  | { ok: true; changed: false; state: State };
```

Estados sem alteração incluem `already_open`, `already_closed`, `already_removed`, `already_admin`, `not_admin` e `not_in_group`.

Grupos possuem `addressingMode: 'lid' | 'pn'`. Mutações localizam o participante por todas as identidades conhecidas e enviam a identidade correspondente ao modo de endereçamento. Apenas status `200` é considerado sucesso.

## 8. Mute

### 8.1 Configuração padrão

```ts
const app = await create({
  mute: {
    enabled: true,
    database: './data/whanext.sqlite',
  },
});
```

SQLite é o store padrão. A implementação usa:

- journal em modo WAL;
- `busy_timeout` de cinco segundos;
- transações para substituição de identidades;
- tabela `STRICT`;
- índices de expiração e chave do mute;
- uma linha por identidade para pesquisa direta;
- criação automática da pasta do banco.

Cada registro persiste o grupo, o usuário normalizado, todas as identidades, criação e expiração.

### 8.2 Store externo

```ts
interface MuteStore {
  upsert(mute: StoredMute): void | Promise<void>;
  find(
    groupId: string,
    identities: readonly string[],
  ): StoredMute | undefined | Promise<StoredMute | undefined>;
  delete(
    groupId: string,
    identities: readonly string[],
  ): boolean | Promise<boolean>;
  purgeExpired(now: number): number | Promise<number>;
  close?(): void | Promise<void>;
}
```

O serviço verifica expiração independentemente do comportamento do store externo.

### 8.3 Estados

| Ação | Estado |
| --- | --- |
| Primeiro mute | `muted` |
| Alteração de duração | `updated` |
| Mute permanente repetido | `already_muted` |
| Desmute | `unmuted` |
| Desmute inexistente | `already_unmuted` |

Sem `durationMs`, o mute não expira. Durações menores ou iguais a zero são rejeitadas.

### 8.4 Execução

Para cada mensagem recebida:

1. ignora conversa privada e mensagem da própria conta;
2. procura o remetente por todas as identidades;
3. remove registros vencidos;
4. apaga a mensagem quando há mute ativo;
5. emite `mute` e encerra o processamento;
6. entrega mensagens não mutadas ao evento `message` e ao router.

Falhas de exclusão produzem `PROVIDER_ERROR` recuperável e impedem que a mensagem siga para comandos.

## 9. Comandos e argumentos

`ArgsParser` consome argumentos posicionais e possui:

- `string`
- `number`
- `boolean`
- `enum`
- `user`
- `duration`
- `peek`
- `skip`
- `rest`

`user()` retorna `User`. `duration()` converte `ms`, `s`, `m`, `h` e `d`; `sempre`, `permanente`, `indefinido`, `forever` e `permanent` representam duração ilimitada.

Restrições declarativas: `onlyGroup`, `onlyPrivate`, `onlyAdmin` e `botMustBeAdmin`.

## 10. Cache

O cache padrão pertence à instância do app. Metadados possuem TTL, eventos de grupo invalidam entradas e mutações invalidam o grupo depois do sucesso. Um `CacheStore` externo pode ser usado para Redis ou outra infraestrutura distribuída.

## 11. Erros

Erros públicos são `WhaNextError` com `code`, `context`, `recoverable` e causa opcional. `MUTE_DISABLED`, `BOT_NOT_ADMIN`, `COMMAND_NOT_ALLOWED`, `ARGUMENT_INVALID`, `PROVIDER_ERROR` e códigos de conexão são estáveis e não dependem do provider.

## 12. Fronteira do provider

- Apenas o adaptador importa Baileys.
- Serviços dependem de `WhatsAppProvider`.
- Eventos são normalizados antes de chegar ao app.
- Conteúdo público não contém tipos do Baileys.
- Providers falsos validam contratos sem conexão real.

## 13. Estrutura

```text
src
├── app
├── auth
├── cache
├── commands
├── errors
├── models
├── mute
├── provider
│   └── baileys
└── services
```

Imports internos usam `@/`. Imports com múltiplos nomes mantêm um item por linha.

## 14. Critérios de aceite v0.2

- Typecheck estrito sem erros.
- Build ESM e declarações TypeScript.
- API pública sem tipos do Baileys.
- `User` disponível no remetente, menções, replies e parser.
- Resolução transparente entre JID, LID e PN.
- Menções aceitam `User`.
- Mute permanente e temporário persistido em SQLite.
- Store de mute substituível.
- Mensagens mutadas apagadas antes do router.
- Expiração e desmute cobertos por testes.
- Operações repetidas retornam estados idempotentes.
- Exemplo executável cobre os fluxos públicos principais.
