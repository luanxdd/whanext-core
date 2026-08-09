# WhaNext Core v0.14.2 — Identidade PN/LID em conversas privadas

## Objetivo

Preservar corretamente a identidade telefônica do remetente quando o WhatsApp entrega uma conversa privada usando LID como endereço principal e PN JID como identidade alternativa.

## Mensagens privadas

No modo LID, o Baileys pode entregar uma mensagem recebida com uma chave equivalente a:

```text
remoteJid:    192758887264324@lid
remoteJidAlt: 5531995724651@s.whatsapp.net
fromMe:       false
```

A WhaNext combina essas duas identidades no remetente normalizado:

```ts
message.sender.lid;
message.sender.jid;
message.sender.phone;
message.sender.identities;
```

Exemplo de resultado:

```ts
message.sender.lid;
// 192758887264324@lid

message.sender.jid;
// 5531995724651@s.whatsapp.net

message.sender.phone;
// 5531995724651
```

Em comandos, o mesmo valor fica disponível diretamente:

```ts
app.commands.command(defineCommand({
  name: 'login',

  async execute(ctx) {
    console.log(ctx.user.phone);
  },
}));
```

## Regras de normalização

`remoteJidAlt` é considerado como identidade do remetente apenas em mensagens privadas recebidas (`fromMe !== true`).

Mensagens enviadas pela própria conta não tratam o destinatário alternativo como remetente. Mensagens de grupo continuam usando `participant`, `participantAlt` e as demais identidades de participante.

## Compatibilidade

Nenhuma API pública foi removida. Aplicações que já utilizam `ctx.user.phone`, `message.sender.jid`, `message.sender.lid` ou `message.senderIds` apenas passam a receber dados mais completos em conversas privadas LID.
