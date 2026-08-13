# WhaNext v0.19

## Objetivo

A v0.19 amplia o sistema de comandos e mensagens interativas sem expor tipos específicos do Zapo à aplicação.

## Prefixos

`create()` e `createMulti()` aceitam `prefix: string | readonly string[]`. Um único `string` mantém o comportamento das versões anteriores. Com array, todos os valores são aceitos e o primeiro é considerado o prefixo principal.

O `CommandContext.prefix` contém o prefixo efetivamente usado na mensagem. `CommandCatalogView.prefixes` expõe a configuração completa. Prefixos sobrepostos são comparados do maior para o menor. `app.commands.setPrefixes()` substitui a configuração em runtime, permitindo ativar ou desativar multi-prefixo sem recriar a aplicação.

## Comandos prefixless

`CommandMetadata.prefixless` aceita:

- `false`/ausente: nenhum gatilho sem prefixo;
- `true`: nome, aliases e nomes localizados do comando raiz podem executar sem prefixo;
- `readonly string[]`: somente os nomes/aliases listados podem executar sem prefixo.

O modo prefixless é permitido somente em comandos/command groups raiz. Cada item do array deve corresponder ao nome ou alias já declarado no comando.

Exemplo:

```ts
defineCommand({
  name: 'open',
  aliases: ['abrir', 'a'],
  prefixless: ['a'],
  execute(ctx) { /* ... */ },
});
```

Com `prefix: ['&', '!']`, `&open`, `!abrir`, `&a` e `a` executam; `open` e `abrir` sem prefixo não executam.

## Respostas interativas

`Message.interactive` normaliza respostas de botões e listas:

```ts
interface InteractiveResponse {
  kind: 'button' | 'list';
  id: string;
  title?: string;
}
```

O router usa `interactive.id` antes do texto visível. Isso permite que uma row/button tenha ID `&open` ou um alias prefixless e reutilize o mesmo comando.

## Botões

`MessageButton` passa a incluir `QuickReplyButton`:

```ts
{ type: 'reply', label: 'Abrir', id: '&open' }
```

`copy` e `link` continuam compatíveis. O provider Zapo envia os botões através de `interactiveMessage` Native Flow.

## Listas

`ListContent` adiciona menus single-select:

```ts
{
  title: 'Menu',
  text: 'Escolha uma opção',
  buttonText: 'Abrir',
  list: [{
    title: 'Grupo',
    rows: [{ id: '&open', title: 'Abrir grupo' }],
  }],
}
```

Disponível via `app.message.list(chatId, content)`, `app.message.send()` e replies que aceitam `MessageContent`.

## Polls

`PollContent` e `app.message.poll()` usam o builder de poll do provider:

```ts
{
  poll: 'Qual opção?',
  options: ['A', 'B'],
  selectableCount: 1,
  allowAddOption: false,
}
```

A pergunta de polls recebidas é normalizada para `message.text`; `contentKind` permanece `poll`.

## Compatibilidade

A v0.19 é aditiva. `prefix: '&'`, botões `copy`/`link` e todos os contratos anteriores continuam válidos. Nenhum comando existente ganha execução sem prefixo automaticamente.
