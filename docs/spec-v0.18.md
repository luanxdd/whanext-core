# WhaNext v0.18 — Zapo Provider

## Objetivo

Substituir o Baileys pelo Zapo no provider padrão sem alterar o contrato público consumido pelos bots.

## Provider

`ZapoProvider` implementa `WhatsAppProvider` e concentra autenticação, eventos, normalização, envio, mídia, grupos, presença e chamadas. Tipos do Zapo permanecem internos ao provider.

A autenticação usa SQLite. Desde a v0.19.6, contas irmãs em multi-account compartilham `<authRoot>/state.sqlite` e permanecem isoladas por `sessionId`; caminhos customizados de conta única continuam usando `<auth>/state.sqlite`.

## Compatibilidade pública

Continuam válidos:

- `create()` e `createMulti()`;
- `defineCommand()` e o router atual;
- `Message`, `QuotedMessage`, `SentMessage` e `MessageKey`;
- services de mensagens, mídia, grupos, membros, chat e conta;
- eventos `message`, `messageEdited`, `messageDeleted`, `call` e eventos de grupo;
- botões `copy` e `link`;
- providers customizados que implementam `WhatsAppProvider`.

## Eventos

O provider traduz os eventos do Zapo para o modelo já usado pelo WhaNext:

- `message` → `message`;
- `message_protocol` → `messageEdited` / `messageDeleted`;
- `group` → `groupChanged` / `groupParticipantsChanged`;
- `voip_call_*` → `call`;
- `connection` → estados de conexão do WhaNext.

## Mensagens offline

Por padrão, eventos marcados pelo Zapo como `offline` não são encaminhados ao router. O timestamp da conexão atual permanece como fallback defensivo. `processOfflineMessages: true` desativa essa barreira para aplicações que desejam consumir backlog.

## Store

Domínios de autenticação e Signal são persistidos no SQLite do Zapo. O archive completo de mensagens, threads e contatos permanece desligado. `messageSecret` também é persistido para manter o suporte do Zapo a addons criptografados após reinícios. Desde a v0.19.6, o WhaNext mantém em `whanext-messages.sqlite` apenas um snapshot compacto e limitado das mensagens recentes necessário para recuperar o conteúdo anterior de `messageEdited` e `messageDeleted`; as mutações públicas continuam sendo traduzidas do evento `message_protocol`.

## Sessões anteriores

Sessões multifile do Baileys não são lidas diretamente. A atualização deve usar novo pareamento ou a ferramenta oficial `wa-store-migrate` antes de iniciar a conta no provider Zapo.
