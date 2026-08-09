# WhaNext Core v0.14 — Múltiplas contas e comandos do dono

## Objetivo

Adicionar dois recursos sem alterar o fluxo existente de uma única conta:

1. comandos que somente a própria conta conectada pode executar;
2. várias contas de WhatsApp independentes dentro da mesma instância de processo.

A implementação mantém o provider isolado por conta e não compartilha uma sessão ativa entre sockets.

## Comandos exclusivos do dono

O contexto moderno expõe `ctx.isOwner` e `ctx.account`.

```ts
app.commands.command(defineCommand({
  name: 'interno',
  description: 'Executa uma ação exclusiva da conta conectada.',
  guards: [guards.owner()],

  async execute(ctx) {
    await ctx.reply('Autorizado.');
  },
}));
```

Também existe compatibilidade com metadados legados:

```ts
defineCommand({
  name: 'interno',
  description: 'Executa uma ação exclusiva da conta conectada.',
  onlyOwner: true,
  execute(message) {
    // ...
  },
});
```

A decisão não depende de um telefone configurado manualmente. Mensagens marcadas pelo provider como enviadas pela própria conta são reconhecidas diretamente; as identidades atuais da sessão são usadas como fallback normalizado.

## Serviço da conta

Cada `WhaNextApp` possui `app.account`:

```ts
app.account.id;
app.account.ids;
app.account.isOwner(message);
```

`id` é opcional em uma aplicação criada com `create()`. Em `createMulti()`, ele corresponde ao identificador definido em `accounts`.

## Multi-account

`createMulti()` cria uma `WhaNextMultiApp` contendo várias aplicações independentes.

```ts
const multi = await createMulti({
  prefix: ';',
  authRoot: './sessions',
  accounts: [
    { id: 'principal', phone: process.env.PHONE_1 },
    { id: 'secundaria', phone: process.env.PHONE_2 },
    { id: 'terceira', phone: process.env.PHONE_3 },
  ],
});

await multi.login({
  onCode(accountId, code) {
    console.log(accountId, code);
  },
});
```

Sem `auth` explícito, as sessões são separadas automaticamente:

```text
./sessions/principal
./sessions/secundaria
./sessions/terceira
```

IDs aceitam letras minúsculas, números, `_` e `-`. Diretórios de autenticação duplicados são recusados para contas que usam o provider padrão.

## Comandos compartilhados

O facade `multi.commands` replica a configuração para todas as aplicações gerenciadas:

```ts
multi.commands.command(command);
multi.commands.use(middleware);
multi.commands.onError(handler);
await multi.commands.load(new URL('./commands/', import.meta.url));
```

Cada execução continua usando o router da conta que recebeu a mensagem. Assim, cooldown, concorrência, serviços e guards permanecem isolados por conta.

Dentro do comando:

```ts
async execute(ctx) {
  console.log(ctx.account.id);
}
```

## Operação da instância

A API conjunta oferece:

```ts
multi.size;
multi.isReady;
multi.ids();
multi.has('principal');
multi.get('principal');
multi.values();
multi.health();
multi.on('message', ({ accountId, payload }) => {
  console.log(accountId, payload.id);
});
await multi.login();
await multi.disconnect();
```

`multi.get(id)` retorna o `WhaNextApp` daquela conta, permitindo usar normalmente `message`, `media`, `group`, `member`, `chat`, `user`, `mute`, `commands` e eventos.

## Isolamento de estado

Cada conta possui seu próprio provider, socket, auth state, reconexão, cache em memória e identidade conectada.

Quando o mute é habilitado sem `store` ou `database` explícito, o multi-account usa um banco separado por conta:

```text
./data/whanext-principal.sqlite
./data/whanext-secundaria.sqlite
```

Se a aplicação fornecer um `MuteStore`, banco ou `CacheStore` compartilhado explicitamente, o gerenciamento desse armazenamento continua sob responsabilidade da aplicação.

## Compatibilidade

`create()` permanece inalterado para aplicações de uma conta. Guards, comandos legados, services e providers customizados continuam compatíveis.
