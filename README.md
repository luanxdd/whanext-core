# WhaNext Core

SDK moderna e tipada para criar bots WhatsApp em TypeScript sobre o provider Zapo.

## Instalação

```bash
pnpm add @whanext/core
```

## API estável

O pacote principal contém apenas recursos considerados estáveis:

- comandos e subcomandos tipados;
- guards e concorrência por comando;
- grupos, participantes e convites;
- texto, imagem, vídeo, áudio, sticker, listas, botões e enquetes;
- download e repost de mídia;
- edição, exclusão e reações;
- mute persistente;
- multi-conta;
- cache em memória;
- eventos de mensagens, chamadas e estabilidade;
- diagnósticos de conexão, criptografia e recuperação de mensagens.

```ts
import { create, defineCommand } from '@whanext/core';

const app = create({ auth: './session' });

app.commands.register(defineCommand({
  name: 'ping',
  async run(ctx) {
    await ctx.reply({ text: 'pong' });
  },
}));

await app.start();
```

## Recursos experimentais

Recursos de protocolo ainda não considerados estáveis ficam fora do entrypoint principal:

```ts
import { richHtml, replyExperimental } from '@whanext/core/experimental';

await replyExperimental(
  ctx.messages,
  ctx.message,
  richHtml({
    title: 'Player',
    html: '<h1>Olá</h1>',
  }),
);
```

O módulo experimental atualmente inclui:

- `richHtml()` — HTML Rich Response;
- `markdown()` — Markdown Rich Response;
- `codeBlock()` — bloco de código;
- `table()` — tabela estruturada;
- `links()` — texto com links/fontes;
- `suggestions()` — sugestões de prompts;
- `unifiedResponse()` — payload Unified Response avançado;
- `encodeUnifiedResponse()` e `decodeUnifiedResponse()`;
- `sendExperimental()` e `replyExperimental()`.

Veja [`experimental/README.md`](./experimental/README.md).

> Recursos experimentais podem depender de estruturas internas do WhatsApp e podem deixar de funcionar após atualizações do cliente. Eles não fazem parte da garantia de compatibilidade da API estável.

## Requisitos

- Node.js 22.5 ou superior
- TypeScript recomendado

## Scripts

```bash
pnpm build
pnpm test
pnpm typecheck
pnpm check
```

## Licença

MIT.
