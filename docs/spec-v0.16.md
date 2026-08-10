# WhaNext Core v0.16 — Message Deletion Events

## Objetivo

Expor revogações de mensagens pela API pública sem exigir acesso direto ao Baileys.

## Evento público

```ts
app.on('messageDeleted', async (deletion) => {
  if (!deletion.message || deletion.deletedByMe) return;

  await app.message.repost(
    deletion.message,
    app.account.selfChatId,
  );
});
```

O payload é normalizado:

```ts
interface MessageDeleted {
  key: MessageKey;
  message?: Message;
  deletedByMe: boolean;
  deletedById?: string;
  deletedAt: Date;
}
```

`message` contém a mensagem original quando ela ainda está no cache recente. Quando a entrada não está mais disponível, o evento continua sendo emitido apenas com os metadados da revogação.

## Mídia

Enquanto a mensagem original permanecer no cache, as APIs existentes continuam válidas:

```ts
app.on('messageDeleted', async ({ message, deletedByMe }) => {
  if (!message || deletedByMe) return;

  if (message.hasMedia) {
    const media = await app.media.download(message);
  }
});
```

Também é possível republicar a mensagem estruturada com `app.message.repost()`, preservando o payload original suportado pelo provider.

## Multi-account

O evento é propagado automaticamente por `WhaNextMultiApp`:

```ts
multi.on('messageDeleted', async ({ accountId, app, payload }) => {
  if (!payload.message || payload.deletedByMe) return;

  await app.message.repost(payload.message, app.account.selfChatId);
});
```

## Provider Baileys

O provider observa `messages.update`. Atualizações cujo `message` é `null` são tratadas como revogação, de acordo com o evento produzido pelo Baileys para `ProtocolMessage.Type.REVOKE`. A busca da mensagem original usa o cache recente já existente, indexado por conversa e ID.
