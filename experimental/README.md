# @whanext/core/experimental

Área de recursos experimentais do WhaNext Core. Tudo aqui é **opt-in** e não é exportado por `@whanext/core`.

## Por que separado?

Esses recursos usam superfícies de protocolo que podem mudar sem aviso entre versões do WhatsApp. A separação impede que experimentos aumentem a superfície da API estável.

## HTML rico

```ts
import { richHtml, sendExperimental } from '@whanext/core/experimental';

await sendExperimental(app.messages, chatId, richHtml({
  title: 'Mini app',
  html: '<main>Olá</main>',
  trustedSources: [],
}));
```

## Markdown

```ts
markdown({ markdown: '**Olá** do WhaNext' });
```

## Código

```ts
codeBlock({ language: 'ts', code: 'const ok = true;' });
```

## Tabela

```ts
table({
  title: 'Status',
  headers: ['Serviço', 'Estado'],
  rows: [['API', 'Online'], ['Bot', 'Online']],
});
```

## Links

```ts
links({
  markdown: 'Documentação: [WhaNext](IE_0)',
  links: [{ url: 'https://example.com', label: 'WhaNext' }],
});
```

## Sugestões

```ts
suggestions({ suggestions: ['Ajuda', 'Status', 'Menu'] });
```

## Unified Response

`unifiedResponse()` permite testar payloads próprios. Use apenas quando souber exatamente qual primitive/layout o cliente espera.

## Estabilidade

Nenhuma API deste entrypoint segue garantia de semver. Um helper experimental pode mudar ou ser removido quando o protocolo do WhatsApp mudar.

## Builder encadeável

```ts
import { RichResponseBuilder, sendExperimental } from '@whanext/core/experimental';

const content = new RichResponseBuilder()
  .markdown('**Status do Dyno**')
  .table({ headers: ['Métrica', 'Valor'], rows: [['Fila', 'Livre']] })
  .tip('Dados experimentais')
  .suggestions(['Atualizar', 'Detalhes'])
  .build({ text: 'Status' });

await sendExperimental(app.messages, chatId, content);
```
