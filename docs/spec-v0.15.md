# WhaNext Core v0.15 — Interactive Buttons

## Objetivo

Adicionar botões interativos à API pública sem expor tipos do Baileys ou detalhes do protocolo do WhatsApp.

Nesta versão, o suporte é intencionalmente limitado a duas ações:

- `copy`: copia um código/texto para a área de transferência.
- `link`: abre uma URL.

## API pública

```ts
export interface LinkButton {
  type: 'link';
  label: string;
  url: string;
}

export interface CopyCodeButton {
  type: 'copy';
  label: string;
  code: string;
}

export type MessageButton = LinkButton | CopyCodeButton;

export interface ButtonsContent {
  text: string;
  buttons: MessageButton[];
  title?: string;
  footer?: string;
  mentions?: MentionTarget[];
}
```

`ButtonsContent` faz parte de `MessageContent`, portanto funciona em todos os pontos que já recebem conteúdo de mensagem:

```ts
await app.message.send(chatId, content);
await app.message.reply(message, content);
await ctx.reply(content);
```

Também existe o atalho:

```ts
await app.message.buttons(chatId, content);
```

## Exemplo

```ts
await app.message.buttons(chatId, {
  title: 'Acesso',
  text: 'Escolha uma ação:',
  footer: 'WhaNext',
  buttons: [
    { type: 'copy', label: 'Copiar código', code: 'ABC-123' },
    { type: 'link', label: 'Abrir painel', url: 'https://example.com' },
  ],
});
```

## Provider Baileys

A camada pública permanece independente do Baileys. O provider oficial traduz os botões para uma `InteractiveMessage` com `NativeFlowMessage`:

- `copy` → `cta_copy`
- `link` → `cta_url`

O envio é feito por `generateWAMessageFromContent()` + `relayMessage()` para suportar o payload interativo de baixo nível. O provider também preserva contexto de reply e menções.

## Compatibilidade

A mudança é aditiva. Providers customizados continuam recebendo `MessageContent`, mas precisam implementar o novo membro `ButtonsContent` caso desejem enviar botões interativos.
