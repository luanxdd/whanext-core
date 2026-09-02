# WhaNext v0.20

## Objetivo

A v0.20 adiciona mensagens Canvas baseadas em A2UI v0.9 sem expor tipos do Zapo ou do protobuf para a aplicação.

## API

`A2UICanvas` cria uma árvore tipada de componentes. Os métodos retornam o ID do componente, usado pelos containers:

```ts
const canvas = new A2UICanvas();
const title = canvas.text('Player', { variant: 'h1' });
const audio = canvas.audio('https://cdn.example.com/song.m4a');
canvas.root([canvas.card(canvas.column([title, audio]))]);
```

O envio pode ser feito por qualquer API que aceite `MessageContent`:

```ts
await app.message.canvas(chatId, { canvas, fallback: 'Player' });
await app.message.send(chatId, { canvas, fallback: 'Player' });
await ctx.reply({ canvas, fallback: 'Player' });
```

## Componentes

O builder inicial inclui:

- `text()`;
- `image()`;
- `audio()`;
- `video()`;
- `button()`;
- `card()`;
- `row()`;
- `column()`;
- `list()`;
- `divider()`.

O payload usa o catálogo básico A2UI v0.9. Tema, catalog ID, surface ID e envio do data model podem ser configurados no construtor.

## Player musical

`musicPlayer()` monta capa, metadados, `AudioPlayer` e letra. `lyrics` aceita texto pronto ou linhas `{ timeMs, text }`.

O helper não simula sincronização. Timestamps são apresentados na letra, mas acompanhamento automático e scroll dependem do renderer A2UI disponibilizado pelo WhatsApp.

## Transporte

O provider serializa o resultado em `interactiveMessage.bloksWidget` com `type: "im_a2ui"`, inclui um `messageSecret` aleatório de 32 bytes e adiciona o Native Flow auxiliar necessário para o companion node gerado pelo Zapo.

## Validação

- IDs vazios ou repetidos são recusados.
- Referências para componentes inexistentes são recusadas.
- Mídia remota aceita apenas HTTP e HTTPS.
- Cada canvas aceita até 200 componentes.
- O JSON final aceita até 256 KiB.
- `fallback` é obrigatório e não pode ser vazio.

## Compatibilidade

A mudança é aditiva. Mensagens de texto, mídia, botões, listas e enquetes mantêm os contratos anteriores. O fallback permanece dentro do `bloksWidget` para clientes que não renderizam a superfície.
