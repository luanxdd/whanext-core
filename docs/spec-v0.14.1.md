# WhaNext Core v0.14.1 — ViewOnce citado e identidade própria

## Objetivo

Corrigir a normalização de mensagens de visualização única e tornar o envio para a própria conta previsível entre PN JID, device JID e LID.

## Visualização única

O provider Baileys identifica os envelopes `viewOnceMessage`, `viewOnceMessageV2` e `viewOnceMessageV2Extension` antes de desembrulhar o conteúdo.

Uma mensagem recebida diretamente expõe:

```ts
message.isViewOnce;
message.media?.viewOnce;
```

Ao responder uma mídia de visualização única, a citação expõe:

```ts
message.quoted?.isViewOnce;
message.quoted?.contentKind;
message.quoted?.media;
```

Exemplo:

```ts
if (message.quoted?.isViewOnce && message.quoted.hasMedia) {
  const downloaded = await app.media.download(message.quoted);
  console.log(downloaded.kind);
}
```

O download continua usando a mensagem bruta preservada no cache recente do provider. O conteúdo não é mantido permanentemente pela biblioteca.

## Identidade da própria conta

`app.account` agora expõe:

```ts
app.account.ids;
app.account.jid;
app.account.lid;
app.account.phoneNumber;
app.account.selfChatId;
```

`jid` é normalizado para remover sufixos de dispositivo, por exemplo:

```text
5531995724651:12@s.whatsapp.net
→ 5531995724651@s.whatsapp.net
```

`selfChatId` prioriza o PN JID canônico. Se ele não estiver disponível, utiliza o LID e, por último, a primeira identidade informada pelo provider.

## Compatibilidade

Os campos novos em `QuotedMessage` são opcionais na interface pública, preservando providers customizados existentes. O `BaileysProvider` oficial os preenche automaticamente.
