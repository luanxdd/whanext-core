# WhaNext Core v0.13 — Message Repost API

## Goal

Expose a provider-agnostic way to repost a recently received WhatsApp message while preserving its original payload. This allows applications to reuse text, media and structured message types without downloading or rebuilding them.

## API

```ts
await app.message.repost(sourceMessageOrKey, destinationChatId, {
  mentions: users,
});
```

`mentions` are injected into the reposted payload through the provider. The repost is a new message and is not a reply to the source message.

## Cache behavior

The source must still be present in the provider's recent-message cache. If it has already been evicted, WhaNext throws a recoverable `MESSAGE_NOT_FOUND` error.

## Baileys provider

The Baileys implementation reuses the cached `WAMessage` through Baileys' forward/repost generation path, preserving structured payloads such as media, stickers, polls, locations, contacts and product/catalog messages. WhaNext does not download media during reposting.
