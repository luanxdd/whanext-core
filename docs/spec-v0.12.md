# WhaNext v0.12 — Message Content Classification

## Objetivo

Permitir que bots identifiquem o tipo lógico de uma mensagem recebida sem acessar estruturas internas do Baileys e sem baixar mídia.

## API

Mensagens normalizadas pelo `BaileysProvider` agora recebem `contentKind`:

```ts
app.on('message', async (message) => {
  switch (message.contentKind) {
    case 'location':
      // localização ou localização ao vivo
      break;
    case 'contact':
      // contato único ou lista de contatos
      break;
    case 'poll':
      // criação de enquete
      break;
    case 'catalog':
      // produto ou pedido de catálogo
      break;
  }
});
```

Valores públicos:

```ts
type MessageContentKind =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'sticker'
  | 'location'
  | 'contact'
  | 'poll'
  | 'catalog'
  | 'unknown';
```

## Mídia

`contentKind` não substitui `message.media`. Para imagens, vídeos, áudios, documentos e stickers, `message.media.kind` continua contendo os metadados usados por `app.media.download()`.

A classificação não baixa bytes de mídia e pode ser usada em filtros, firewall e roteamento de eventos.

## Compatibilidade

`Message.contentKind` é opcional no contrato público para que providers customizados existentes continuem compilando. O provider Baileys oficial sempre define o campo.
