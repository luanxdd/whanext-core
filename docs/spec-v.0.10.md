# Comandos modernos — v0.10

## Arquitetura

`app.commands` é o registry e executor central. `app.router()` permanece como alias compatível. O fluxo de execução é:

1. resolução do comando, alias, localização e subcomando;
2. parsing declarativo das options;
3. aquisição do controle de concorrência;
4. restrições legadas e guards;
5. cooldown;
6. hooks `beforeExecute`;
7. middleware global e local;
8. `execute(ctx)`;
9. hooks `afterExecute`;
10. handler de erro do comando ou do registry.

Comandos sem permissões não consultam metadados de grupo. Um `ping`, por exemplo, segue diretamente para a execução.

## CommandContext

O contexto estende estruturalmente `Message`, então `ctx.id`, `ctx.chatId`, `ctx.sender` e todos os campos anteriores continuam disponíveis.

| Campo | Conteúdo |
| --- | --- |
| `ctx.message` | mensagem normalizada original |
| `ctx.user` | usuário que executou o comando |
| `ctx.chat` | id e tipo do chat |
| `ctx.group` | helpers do grupo, quando aplicável |
| `ctx.command` | definição registrada, path, aliases e categoria |
| `ctx.options` | options declarativas já validadas |
| `ctx.args` | `ArgsParser` legado |
| `ctx.signal` | cancelamento da estratégia `replace` |
| `ctx.client` | conjunto de services da aplicação |
| `ctx.groups`, `members`, `users` | services de domínio |
| `ctx.messages`, `mediaService`, `chats` | mensagens, mídia e presença |

Helpers de resposta:

```ts
await ctx.reply('Pronto.');
await ctx.reply({ text: 'Olá!', mentions: [ctx.user] });
await ctx.reply('Mensagem temporária.', { deleteAfterMs: 5_000 });

const deferred = await ctx.defer();
await deferred.edit('Concluído!');

await ctx.edit('Edita a última resposta.');
await ctx.react('✅');
await ctx.unreact();
await ctx.delete();
await ctx.deleteReply();
```

## Options

As options são consumidas na ordem em que aparecem no objeto:

```ts
options: {
  member: option.user({ description: 'Membro.', required: true }),
  duration: option.duration({ description: 'Duração.' }),
  reason: option.string({ description: 'Motivo.', rest: true }),
}
```

Builders disponíveis:

- `option.string()` com `rest`, `minLength` e `maxLength`;
- `option.number()` com `min` e `max`;
- `option.boolean()`;
- `option.enum(values, definition)`;
- `option.user()`, resolvendo menção, reply, PN e LID;
- `option.duration()` com as durações aceitas pelo `ArgsParser`.

Options com `required: true` são inferidas sem `undefined`. As demais permanecem opcionais.

## Guards

```ts
guards: [
  guards.group(),
  guards.userAdmin(),
  guards.botAdmin(),
]
```

Também existem `guards.private()`, `guards.botEnabled(check)` e `guards.custom(handler)`.

Um guard customizado pode retornar `true`, `false` ou um resultado detalhado:

```ts
guards.custom(async (ctx) => ({
  allowed: await permissions.canModerate(ctx.user),
  code: 'COMMAND_NOT_ALLOWED',
  message: 'Você não possui esse cargo.',
}));
```

## Middleware e hooks

Middleware segue o padrão onion utilizado por frameworks modernos:

```ts
app.commands.use(async (ctx, next) => {
  await audit.before(ctx);
  await next();
  await audit.after(ctx);
});
```

Cada definição aceita `middleware` e:

```ts
hooks: {
  beforeExecute(ctx) {},
  afterExecute(ctx) {},
  async onError(ctx, error) {
    await ctx.reply('Falha tratada pelo comando.');
  },
}
```

## Cooldown

```ts
cooldown: {
  durationMs: 5_000,
  scope: 'user-chat',
}
```

Escopos: `global`, `user`, `chat`, `user-chat` e `user-group`. Entradas expiradas são removidas periodicamente para evitar crescimento ilimitado.

## Concorrência

```ts
concurrency: {
  scope: 'chat',
  max: 1,
  strategy: 'queue',
}
```

| Estratégia | Comportamento |
| --- | --- |
| `parallel` | executa imediatamente |
| `reject` | retorna `COMMAND_BUSY` quando o limite está ocupado |
| `queue` | aguarda uma vaga sem bloquear outros chats |
| `replace` | aborta o `ctx.signal` das execuções anteriores e inicia a nova |

Uma tarefa substituída precisa observar `ctx.signal` ao chamar APIs canceláveis.

## Catálogo e help

Metadados como `category`, `usage`, `examples`, `hidden` e `localizations` alimentam automaticamente o catálogo:

```ts
app.commands.catalog({ category: 'moderação' });
app.commands.categories();
app.commands.find('grupo fechar');
app.commands.has('ping');
app.commands.values();
```

```ts
await app.commands.help(ctx, {
  category: 'moderação',
  title: '👮 *Moderação*',
});
```

`hidden: true` remove o comando do help padrão, mas não impede sua execução.

## Localizações

```ts
localizations: {
  'pt-BR': {
    name: 'informações',
    aliases: ['info'],
    description: 'Exibe informações.',
  },
}
```

Quando uma localização é usada para resolver o comando, `ctx.locale` recebe sua chave.

## Compatibilidade

As quatro restrições antigas permanecem disponíveis e são executadas antes dos guards:

- `onlyGroup`;
- `onlyPrivate`;
- `onlyAdmin`;
- `botMustBeAdmin`.

O formato abaixo não precisa ser migrado imediatamente:

```ts
defineCommand({
  name: 'echo',
  description: 'Repete um texto.',
  execute(message, args) {
    console.log(message.chatId, args.rest());
  },
});
```
