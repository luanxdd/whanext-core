# Changelog

## 0.19.19

### Provider
- Updated the official provider from `zapo-js@1.7.1` to `zapo-js@1.8.0`.
- Kept full received LID/PN addressing metadata when replying, reacting, editing, revoking, and pinning messages.
- Inherits Zapo 1.8.0 mailbox `fromMe` persistence fixes, group-status stanza attribute unwrapping, username support, expired-CDN media resend support, and mobile-primary WhatsApp Business support.

### Incoming message observability
- Added `message_unavailable` tracking with primary-device resend correlation and a bounded 30-second recovery window.
- Added `debug_decrypted_payload` correlation with `debug_unhandled_stanza` so decrypted-but-undecodable payloads are visible without logging plaintext bytes.
- Expanded `health().messaging` with `decryptedPayloads`, `unavailable`, `resendRequested`, `recovered`, `recoveryFailed`, `unavailableUnrecoverable`, `decodeFailures`, `unhandledStanzas`, `ignoredOffline`, `duplicates`, and `normalizationFailures`.
- Added typed `messageUnavailable`, `messageRecovered`, `messageRecoveryFailed`, `messageDecodeFailure`, and `messageDiscarded` application events.
- Recovery failures and decrypted-payload decode failures temporarily mark provider stability as `degraded`; expected unrecoverable placeholders such as consumed view-once messages are counted without automatically degrading the session.

### Safety
- Raw decrypted payload bytes from Zapo are never emitted through the WhaNext public events or written to logs.
- Existing `received`, `sent`, and `failed` counters keep their previous semantics; the new counters explain why an inbound stanza may not have become a public WhaNext `Message`.

## 0.19.18

### Stability
- Added bounded command queues for `strategy: 'queue'`: `maxQueue` defaults to 10 waiting executions and `queueTimeoutMs` defaults to 60 seconds. Set either option to `0` to disable that limit.
- Added `COMMAND_QUEUE_FULL` and `COMMAND_QUEUE_TIMEOUT` with typed `commandQueueFull` and `commandQueueTimeout` application events.
- Added explicit Zapo transport/query timeouts through `providerTimeouts.connectTimeoutMs` and `providerTimeouts.nodeQueryTimeoutMs`, defaulting to 15 seconds and 30 seconds.
- Stability event listeners are isolated from provider recovery work so consumer handler failures cannot turn a successful metadata recovery into a provider failure.

### Health
- Expanded `app.health()` without removing the existing fields. It now exposes `stability`, connection/reconnect state, messaging counters, crypto degradation counters, group metadata recovery counters, command queue metrics, and effective provider timeouts.
- Added `healthy`, `degraded`, `reconnecting`, and `offline` operational stability states. Transient crypto/group warnings move the provider to `degraded` for a bounded window and automatically return it to `healthy`.
- Added typed `healthChanged`, `connectionRecovered`, `groupMetadataRecovered`, and `cryptoDegraded` events.

### Performance
- Added `@zapo-js/native@0.1.0` as an optional dependency. Zapo automatically uses its X25519/XEdDSA accelerator when available and falls back to JavaScript when unavailable.
- Health reports the detected crypto backend as `napi`, `wasm`, `js`, or `unknown`; the published optional package is detected as WASM on supported Node runtimes while locally built N-API addons are reported only when they can actually be loaded.

### Compatibility
- Existing command concurrency declarations remain valid; the queue limits only affect commands that already use `strategy: 'queue'`.
- Custom providers are not required to implement `health()`; WhaNext supplies neutral health fallbacks when a provider does not expose runtime metrics.

## 0.19.17

### Reliability
- Group sends now self-heal when Zapo reports an acknowledged participant-hash mismatch: WhaNext invalidates only the affected group's metadata cache, fetches fresh server metadata, invalidates the public group snapshot, and rate-limits recovery to once per group per minute.
- Volatile Zapo `groupMetadata` and `deviceList` memory caches now expire after 3 minutes instead of the 5-minute default, reducing stale LID/device fan-out windows without disabling caching or forcing an IQ/usync on every send.
- Transient WhatsApp disconnects now retry indefinitely by default with the existing exponential backoff; applications that set `reconnect.maxAttempts` keep their explicit limit. Fatal/logout reasons still stop reconnection immediately.

### Performance
- The shared Zapo SQLite store now uses `WAL`, `synchronous=NORMAL`, and a 5-second `busy_timeout`, improving concurrent reads/writes for persisted Signal, sender-key, mailbox, and app-state data.
- The WhaNext mutation-snapshot SQLite database now uses the same WAL/NORMAL settings, reducing fsync contention on active bots.

### Safety
- Sender keys and Signal sessions are never globally reset during mismatch recovery. Zapo's normal retry-receipt/decryption recovery remains authoritative; WhaNext only refreshes stale group metadata.

## 0.19.16

### Fixed
- Remote media URLs are now streamed into Zapo instead of being fully materialized as `Uint8Array` in memory before upload. This removes the extra whole-file buffering step that could stall or intermittently fail larger MP3/audio sends.
- Remote media fetches now have a bounded 120-second transfer timeout and surface provider errors when the source cannot be opened or returns an empty body.
- Local paths and caller-provided byte arrays keep their existing behavior.

### Performance
- URL-backed audio/video/image uploads now follow Zapo's recommended streaming media path, keeping memory usage flat while Zapo stages, hashes, encrypts, and uploads the attachment.

## 0.19.15

### Added
- Added provider-safe payload classification through `message.protocolKinds` and `message.payloadKinds`, also available on quoted messages.
- Added `payment` to `MessageContentKind` for WhatsApp payment payloads and native-flow payment cards.
- Added Zapo 1.7.1 payment coverage for `sendPaymentMessage`, `requestPaymentMessage`, `paymentInviteMessage`, `cancelPaymentRequestMessage`, `declinePaymentRequestMessage`, `invoiceMessage`, `paymentReminderMessage`, `splitPaymentMessage`, and `splitPaymentUpdateMessage`.
- Added group-status wrapper coverage for `groupStatusMessage`, `groupStatusMessageV2`, `groupStatusMentionMessage`, and `groupMentionedMessage` while preserving the nested content classification.
- Added `catalog_message` classification for Zapo `productMessage` and `orderMessage` payloads.
- Added native-flow payment detection for the documented `payment_info` and `review_and_pay` flows.
- Added defensive `malformed_payload` and `native_flow_crash` signals for invalid or structurally unsafe native-flow JSON without exposing raw provider payloads to consumers.

### Compatibility
- Existing `contentKind` consumers remain compatible; the new protocol/payload arrays are optional.
- `groupStatus*` and `groupMentionedMessage` are unwrapped as Zapo `FutureProofMessage` containers so text/media inside them continues through the regular normalizer.

## 0.19.14

- Removed the temporary end-to-end AntiEdit diagnostic instrumentation after confirming the group-author identity fix in production.
- Normal edit handling remains quiet apart from the existing standard error and recovery logs.

## 0.19.13

- Group edits now preserve the original message author's participant identities instead of replacing them with identities carried by the edit-addon envelope.
- Archived mutation recovery now prefers the original stored participant and `fromMe` values over fallback mutation metadata.
- Fixed external edits being incorrectly classified as owner edits in multi-account/group sessions.

## 0.19.12

- Added end-to-end AntiEdit diagnostics for encrypted addons, protocol events, direct edit envelopes, normalization, previous-message recovery, and final `messageEdited` emission.
- Missing parent secrets during Zapo edit-addon decryption now surface as a dedicated `decrypt_failed_missing_parent_secret` warning.
- Diagnostics contain message identifiers and processing stages, but never message text or encrypted payload bytes.

## 0.19.11

- Direct `editedMessage` envelopes are now translated into `messageEdited` events instead of being emitted as ordinary messages.
- View-once detection now follows multi-device and transparent message wrappers before classifying received media.
- Added regression coverage for direct edit envelopes and device-sent view-once media.

## 0.19.10

- Fixed restored sessions incorrectly waiting for a pairing challenge after the WhatsApp connection was already open.
- Pairing-code requests now stop immediately when an existing authenticated session reconnects.

## 0.19.9

- Fixed live `message_addon` edits being discarded when Zapo reports the parent message timestamp instead of the mutation timestamp.
- Serialized decrypted edit addons through the same protocol-mutation queue used by `message_protocol`, preserving edit/revoke ordering.
- Offline-resume edit addons remain ignored by default unless `processOfflineMessages` is enabled.

## 0.19.8

### Fixed
- The Zapo mailbox (`messages`, `threads`, and `contacts`) is now persisted in the shared SQLite store and full history sync is enabled. This lets Zapo retain parent message secrets required to decrypt `secretEncryptedMessage` edit addons after restart/offline resume.
- History sync now hydrates the trusted-contact/privacy-token state used by Zapo when preparing outgoing messages, including history-derived token metadata and NCT salt that can be required for `tctoken`/`cstoken` generation. Historical/bootstrap messages are still filtered by WhaNext and do not become live command events unless `processOfflineMessages` is explicitly enabled.
- WhatsApp negative publish ACK `463` is normalized as `MESSAGE_REACHOUT_LOCKED` with `ackCode: 463` instead of surfacing as `UNKNOWN_ERROR`, allowing consumers to avoid retry/error-reply loops while the account is reach-out time-locked.

### Compatibility
- Public message/edit/delete event shapes are unchanged.
- Existing shared multi-account stores are reused in place; the mailbox domains are created inside the same `state.sqlite` and remain isolated by `sessionId`.
- The first connection after this update may perform a larger history sync because mailbox persistence is now enabled deliberately.

## 0.19.7

### Fixed
- Zapo edit/revoke protocol mutations are now processed sequentially in arrival order. Back-to-back `MESSAGE_EDIT` -> `REVOKE` events can no longer race and make `messageDeleted.message` expose the pre-edit snapshot.
- Protocol mutations discovered through the regular `message` event use the same ordered queue as native `message_protocol` events, preserving consistent AntiEdit/AntiDelete behavior across both Zapo delivery shapes.

## 0.19.6

### Fixed
- Multi-account Zapo sessions now share a single SQLite store per sibling auth root and stay isolated by stable `sessionId`, matching Zapo's multi-session model.
- Existing per-account `state.sqlite` sessions are migrated into the shared store on first use; removing one account auth directory resets only that account instead of affecting sibling sessions.
- Zapo session/store handles are released on disconnect and terminal connection failures, preventing failed/restarted accounts from leaving stale SQLite resources behind.
- Fatal disconnects such as `401`/`516` stop the reconnect loop and surface `AUTH_EXPIRED`; routine `515` reconnects immediately and `402` uses an extended backoff.
- Passkey-gated linking now fails fast with `AUTH_PASSKEY_REQUIRED` when Zapo reports `auth_passkey_required` without a signer, instead of hanging until the login timeout.
- `messageDeleted` and `messageEdited` can restore the previous message from a bounded persistent snapshot archive in `whanext-messages.sqlite` when the in-memory cache no longer contains it, including after cache eviction or a process restart.
- Persistent mutation snapshots are isolated per `sessionId`, retained for up to 7 days, and capped at 20,000 messages per session to avoid unbounded storage growth.

### Compatibility
- Public `messageDeleted` / `messageEdited` event shapes are unchanged.
- Existing single-account custom auth paths keep their previous per-directory SQLite layout.
- `messages` remains disabled in the Zapo mailbox store; WhaNext persists only the compact message snapshot needed for edit/delete recovery in its own SQLite file.

## 0.19.5

### Fixed
- Zapo protocol mutations (`MESSAGE_EDIT` and `REVOKE`) no longer trust the undocumented `offline` envelope flag after the live connection is open; stale mutations are filtered by connection time instead.
- Protocol edits/revokes are recognized both from `message_protocol` and from a raw `message.protocolMessage` fallback, with existing deduplication preventing double delivery.
- Edited-message wrappers are unwrapped before normalization, preserving the previous/current payload expected by `messageEdited`.
- Decrypted `message_addon` edits now accept both the typed `message_edit` form and nested `protocolMessage` forms.
- Protocol target lookup remains ID-first so PN/LID/participant addressing differences do not prevent recovering the cached original.


## 0.19.4
### Corrigido
- Chamadas no provider Zapo agora usam o evento nativo `call`, sem depender do plugin completo de VoIP.
- `rejectCall()` envia diretamente a sinalização mínima `<call><reject/></call>` pelo `client.lowlevel.sendNode()`, preservando `callId` e `callCreatorJid`.
- Removidas as dependências `@zapo-js/voip`, `@roamhq/wrtc` e `libmlow-wasm` do WhaNext Core; detectar/rejeitar chamadas não exige WebRTC nem binário nativo.
- O `callCreatorJid` técnico é mantido em cache limitado para que a rejeição use o endereço de protocolo correto mesmo quando o evento público expõe o `callerPnJid`.

### Compatibilidade
- A API pública permanece igual: `app.on('call')`, `CallEvent` e `rejectCall(callId, from)` não mudam para consumidores.
- O suporte completo a aceitar/realizar chamadas VoIP não faz parte da API pública do WhaNext.

## 0.19.3
### Corrigido
- Carregamento lazy do plugin VoIP do Zapo para evitar importar o runtime WebRTC em consumidores e testes que não inicializam o provider.
- Ajustes de tipagem dos testes com `exactOptionalPropertyTypes`.
- Provider Zapo agora usa `@zapo-js/voip` como único caminho de chamadas: eventos `voip_*` e `client.voip.rejectCall()`, sem fallback silencioso.
- `messageEdited` também reconhece edições criptografadas descriptografadas pelo Zapo em `message_addon`, além de `message_protocol`.
- `messageDeleted` e `messageEdited` ignoram protocolo de backlog durante bootstrap quando `processOfflineMessages` está desativado.
- Mensagens recebidas antes de `connection: open` deixam de ser publicadas como mensagens ao vivo; ainda entram no cache limitado para permitir recuperação posterior.
- Eventos `message` duplicados no mesmo runtime são descartados antes de chegar aos consumidores, evitando downloads repetidos de mídia/ViewOnce.

### Compatibilidade
- Mudança corretiva e aditiva; a API pública de `CallEvent`, `messageDeleted` e `messageEdited` permanece inalterada.

## 0.19.2

- Corrigido o download real de mídias citadas no provider Zapo: `downloadMedia()` agora entrega o `Proto.IMessage` bruto diretamente ao `downloadBytes()`, como suportado pela API do Zapo.
- Envelopes `viewOnceMessage`, `viewOnceMessageV2` e `viewOnceMessageV2Extension` são desembrulhados antes do download, evitando falhas ao responder imagens/vídeos de visualização única.
- A correção cobre replies comuns de imagem, vídeo, áudio e sticker, além de view-once.


## 0.19.1

- Corrige menus de lista no provider Zapo usando `interactiveMessage` Native Flow com `single_select` em vez do `listMessage` legado.
- Respostas de `single_select` agora são normalizadas explicitamente como `message.interactive.kind = "list"`.


## 0.19.0

### Comandos

- `prefix` passa a aceitar um prefixo único ou uma lista, como `['&', '!', '.']`; o primeiro continua sendo o prefixo principal usado por menus/help.
- Novo `prefixless` por comando para liberar somente gatilhos explicitamente escolhidos sem prefixo, como `prefixless: ['a']`.
- `ctx.prefix` agora representa o prefixo que realmente acionou a execução e fica vazio (`''`) em execuções prefixless.
- `ctx.commands.prefixes` expõe todos os prefixos configurados.
- Novo `app.commands.setPrefixes()` permite ativar, trocar ou desativar o modo multi-prefixo em runtime sem recriar a aplicação.
- IDs de respostas de botões/listas são encaminhados ao mesmo router de comandos, permitindo rows como `&open` ou aliases prefixless como `a`.

### Interativos

- Novo envio de enquetes com `PollContent` e `app.message.poll()`.
- Novo menu de lista single-select com `ListContent`, seções/rows e `app.message.list()`.
- Botões Native Flow ganham o tipo `reply`, com ID de resposta, além de `copy` e `link`.
- Mensagens recebidas passam a expor `message.interactive` com `kind`, `id` e título visível quando disponível.
- Polls recebidas preservam a pergunta em `message.text` e continuam classificadas como `contentKind: 'poll'`.

### Correções

- Corrigida a extração do `contextInfo.quotedMessage`: `extractQuotedZapoMessage()` agora usa o nó real retornado por `contentNode()` em vez do wrapper `{ type, node }`.
- Quoted messages são armazenadas como mensagens completas no mesmo cache recente do provider, preservando download de mídia e repost.
- `downloadMedia()` também mantém associação direta com as `MessageKey` emitidas no evento, com fallback por chave/ID para objetos reconstruídos.
- A correção cobre especialmente respostas a mídias `viewOnceMessageV2Extension`, como `&fig` sobre uma imagem/vídeo de visualização única.

### Compatibilidade

- Configurações existentes com `prefix: '&'` continuam funcionando sem alteração.
- Nenhum comando se torna prefixless automaticamente; o recurso é opt-in por definição.
- A API anterior de botões `copy`/`link` permanece compatível.

## 0.18.2

- Corrigida a normalização de mídias de visualização única recebidas no envelope `viewOnceMessageV2Extension` do protocolo do WhatsApp.
- Replies para imagens e vídeos de visualização única agora expõem corretamente `quoted.hasMedia`, `quoted.isViewOnce`, `quoted.contentKind` e `quoted.media`.
- O cache de quoted media preserva esse envelope para que `MediaService.download()` consiga recuperar a mídia ao responder comandos como `&fig`.

## 0.18.1

### Fixed

- Corrige a geração de código de pareamento no Zapo quando o servidor disponibiliza primeiro o fluxo QR (`auth_qr`) em vez de emitir `auth_pairing_required`.
- O provider agora considera tanto `auth_pairing_required` quanto `auth_qr` como sinais válidos de que `client.auth.requestPairingCode()` pode ser chamado.

## 0.18.0

### Provider Zapo

- O provider padrão foi migrado do Baileys para `zapo-js`, mantendo o contrato público `WhatsAppProvider`.
- Autenticação e chaves Signal passam a usar store SQLite persistente em `<auth>/state.sqlite`.
- Mensagens, replies, menções, mídia, view-once, reações, edição, revogação, pin, presença e grupos foram portados para as APIs do Zapo.
- Eventos `message_protocol`, `group`, `connection` e `voip_call_*` são normalizados para os eventos públicos já existentes do WhaNext.
- Chamadas continuam suportando rejeição pelo plugin oficial `@zapo-js/voip`.
- Mensagens do backlog marcadas pelo Zapo como `offline` são ignoradas por padrão; `processOfflineMessages: true` restaura o processamento deliberado do backlog.
- O cache recente passa a observar também `message_send`, permitindo reenvio de mensagens emitidas pela própria sessão.
- O carregamento do plugin `@zapo-js/voip` passa a ser dinâmico, evitando que uma instalação sem binário `wrtc` funcional derrube recursos que não usam chamadas.
- A tipagem de eventos VoIP deixa de perder a extensão de plugin do `WaClient`; `rejectCall` e `voip_call_*` passam por uma ponte tipada local.
- `recording` é preservado no chatstate conforme a API documentada do Zapo, com adaptação local para a declaração de tipos publicada.
- O mock do provider Zapo usa `vi.hoisted`, eliminando o acesso a `MockClient` antes da inicialização.

### Migração

- Adicionado `MIGRATING_TO_ZAPO.md` com orientação para novo pareamento ou conversão das sessões multifile antigas.
- A versão do pacote passa para `0.18.0`.

## 0.17.1

### Fixed

- Compatibilidade com o novo formato criptografado de edições do WhatsApp (`secretEncryptedMessage`).
- O provider interpreta `targetMessageKey.fromMe` pela perspectiva do editor, deriva a chave com `messageSecret` e descriptografa edições com AES-256-GCM.
- Edições em conversas privadas preservam a chave local da mensagem original após a descriptografia.
- Edições consecutivas preservam o `messageSecret` no cache para que a versão anterior continue disponível.
- `messageEdited` continua com a mesma API pública da 0.17.0.

## 0.17.0

### Adicionado

- Novo evento público `messageEdited` em `app.on()` e `multi.on()`.
- Novo tipo `MessageEdited`, com versão anterior quando ainda estiver no cache, versão atual, identidade responsável e horário da edição.
- O provider Baileys passa a interpretar atualizações `editedMessage` recebidas em `messages.update`.
- O cache recente é atualizado após cada edição, permitindo acompanhar múltiplas alterações da mesma mensagem em sequência.

### Compatibilidade

- A mudança é aditiva para consumidores da API pública.
- Providers customizados passam a incluir `messageEdited` em `ProviderEvents`.
- Quando a versão anterior já saiu do cache, o evento continua sendo emitido sem o campo `previous`.


## 0.16.0

### Adicionado

- Novo evento público `messageDeleted` em `app.on()` e `multi.on()`.
- Novo tipo `MessageDeleted`, com chave da mensagem, payload original quando disponível, autor da revogação e horário da exclusão.
- O provider Baileys passa a observar `messages.update` e reconhecer revogações sem expor tipos do Baileys à aplicação.
- Mensagens revogadas permanecem no cache recente, permitindo `app.message.repost()` e `app.media.download()` enquanto a entrada estiver disponível.

### Compatibilidade

- A mudança é aditiva para consumidores da API pública.
- Providers customizados passam a incluir `messageDeleted` em `ProviderEvents`.
- Quando a mensagem original já saiu do cache, o evento continua sendo emitido sem o campo `message`.

## 0.15.0

### Adicionado

- Suporte de alto nível a mensagens com botões interativos Native Flow.
- Botão `copy` para copiar códigos/textos usando `cta_copy`.
- Botão `link` para abrir URLs usando `cta_url`.
- Novo `ButtonsContent` no `MessageContent`, com `title`, `text`, `footer`, `mentions` e uma lista tipada de botões.
- Novo atalho `app.message.buttons(chatId, content)`; `ctx.reply({...})` e `app.message.reply(...)` também aceitam o novo conteúdo automaticamente.
- Exportação pública dos tipos `ButtonsContent`, `MessageButton`, `CopyCodeButton` e `LinkButton`.

### Provider Baileys

- Mensagens interativas são geradas como `InteractiveMessage`/`NativeFlowMessage` e enviadas por `relayMessage`, sem expor protobufs ao consumidor.
- Replies e menções são preservados no envio de botões.
- O relay inclui os nós de compatibilidade necessários para Native Flow em chats privados e grupos.

### Compatibilidade

- Nenhum contrato existente foi removido. Texto, mídia, reações, edição, delete e repost continuam usando as APIs anteriores.

## 0.14.3

- Corrige uma rejeição órfã durante o login quando a solicitação de código de pareamento falha ao mesmo tempo em que o socket é fechado.
- Mantém o erro principal de autenticação sem gerar `unhandledRejection` paralelo no processo.

## 0.14.2

### Corrigido

- Mensagens privadas recebidas agora combinam `remoteJid` e `remoteJidAlt` nas identidades normalizadas do remetente, preservando PN JID e LID quando o WhatsApp fornece ambos.
- `message.sender`, `message.senderIds` e `ctx.user.phone` passam a expor corretamente o número do remetente em chats privados LID sem exigir tratamento de Baileys na aplicação.
- A identidade alternativa só é usada para mensagens recebidas em chats privados; mensagens de grupo e mensagens `fromMe` mantêm o comportamento anterior.

### Compatibilidade

- Nenhuma API pública foi removida ou alterada. Aplicações que já usam `ctx.user.phone` passam apenas a receber o número em mais casos.

## 0.14.1

### Corrigido

- A normalização agora preserva corretamente o envelope de visualização única (`viewOnceMessage`, `viewOnceMessageV2` e `viewOnceMessageV2Extension`) antes de desembrulhar a mídia.
- `message.isViewOnce` passa a ser verdadeiro mesmo quando o Baileys representa a visualização única apenas pelo wrapper externo.
- Mensagens citadas agora expõem `quoted.isViewOnce`, `quoted.contentKind` e `quoted.media`, permitindo distinguir mídia normal de visualização única sem heurísticas na aplicação.
- `app.media.download()` aceita diretamente uma `QuotedMessage`, permitindo `app.media.download(message.quoted)` quando houver mídia citada.
- `app.account.jid`, `app.account.lid`, `app.account.phoneNumber` e `app.account.selfChatId` expõem identidades canônicas da própria conta. `selfChatId` prioriza PN JID sem sufixo de dispositivo antes de usar LID.

### Compatibilidade

- Os novos campos de `QuotedMessage` são opcionais no contrato público para não quebrar providers customizados ou objetos criados manualmente. O provider Baileys oficial os preenche nas mensagens normalizadas.
- `app.media.download(message)` e `app.media.download(message.keys)` continuam funcionando sem alteração.

## 0.14.0

### Adicionado

- `guards.owner()` para restringir comandos à própria conta conectada ao WhatsApp.
- `onlyOwner: true` para manter o mesmo recurso disponível na API legada de comandos.
- `ctx.isOwner` e `ctx.account` no contexto moderno; em multi-account, `ctx.account.id` identifica qual conta executou o comando.
- `app.account` com os identificadores atuais da conta e `isOwner(message)` sem exigir JID, LID ou número manual.
- `createMulti()` e `WhaNextMultiApp` para manter várias contas independentes no mesmo processo.
- `multi.commands` para registrar comandos, middleware, handlers de erro e autoload em todas as contas da instância.
- `multi.login()`, `multi.disconnect()`, `multi.health()`, `multi.get()`, `multi.ids()` e `multi.isReady` para operar as contas em conjunto.
- `multi.on()` para observar eventos de todas as contas com `accountId`, aplicação e payload de origem.
- Sessões automáticas isoladas em `./sessions/<id>` quando `auth` não é informado.
- Banco de mute automático separado por conta (`./data/whanext-<id>.sqlite`) quando o mute é habilitado sem banco/store explícito.

### Segurança e compatibilidade

- IDs de contas multi-account são validados para impedir caminhos de sessão inseguros.
- Diretórios `auth` duplicados são rejeitados entre contas que usam o provider padrão.
- `create()` e toda a API de uma única conta continuam compatíveis.
- Cada conta mantém provider, socket, sessão, cache, reconexão e identidade próprios; nenhuma sessão ativa é compartilhada entre contas.

## 0.13.1

- Corrigido download de mídias para mensagens visualização única citadas, através do cache do payload citado carregado em `contextInfo`.
- Adicionado desempacotamento explícito para envelopes de mensagens efêmeras e de visualização única, incluindo `viewOnceMessageV2Extension`.

## 0.13.0

- Adicionado `MessageService.repost()` para republicar qualquer mensagem do WhatsApp recebida recentemente, sem criar uma resposta.
- Adicionado suporte a `repostMessage()` em nível de provedor, com injeção de menções.
- As republicações preservam o payload estruturado original, permitindo que textos, mídias, figurinhas, enquetes, localizações, contatos e mensagens de catálogo sejam reutilizados através da API de alto nível.


## 0.12.0 - Message content classification

### Adicionado

- `Message.contentKind` para classificar o payload recebido sem expor tipos do Baileys.
- Novo tipo público `MessageContentKind`.
- Classificação nativa para texto, imagem, vídeo, áudio, documento, sticker, localização, contato, enquete e catálogo/produto.
- `unknown` como fallback para formatos ainda não normalizados pela biblioteca.

### Compatibilidade

- `contentKind` é opcional no contrato público para manter compatibilidade com providers customizados e objetos `Message` criados por aplicações existentes.
- O `BaileysProvider` oficial sempre preenche `contentKind` nas mensagens recebidas.
- `message.media.kind` continua sendo a API indicada para mídia baixável; `contentKind` complementa essa API com tipos não-mídia.

## 0.11.0 - Command discovery

- `CommandRouter.load()` carrega diretórios de comandos diretamente pelo router.
- `loadCommands()` agora aceita `URL` além de caminhos em string.
- Autoload reconhece `.ts`, `.mts` e `.cts` por padrão, além de JavaScript.
- `CommandContext` agora expõe `ctx.commands` (catálogo somente-leitura) e `ctx.prefix`.
- Menus e comandos de ajuda podem consultar o catálogo sem factory ou referência global ao app.
- Mantém compatibilidade com `defineCommand`, `defineCommands`, `defineSubcommand` e `defineCommandGroup`.

Todas as mudanças relevantes do projeto serão registradas neste arquivo.

## 0.10.0

### Adicionado

- `CommandContext`, uma interação enriquecida que continua compatível com o modelo `Message` legado.
- `ctx.reply()`, `ctx.defer()`, `ctx.edit()`, `ctx.react()`, `ctx.unreact()`, `ctx.delete()` e respostas com exclusão programada.
- `option.string`, `number`, `boolean`, `enum`, `user` e `duration`, com inferência de tipos, obrigatoriedade e validações.
- `defineCommandGroup()` e `defineSubcommand()` para comandos como `&grupo abrir` e `&grupo fechar`.
- Guards reutilizáveis para grupo, privado, admin, bot admin e regras customizadas.
- Middleware global e por comando, além de hooks `beforeExecute`, `afterExecute` e `onError`.
- Cooldown por usuário, chat, usuário+chat ou global, com limpeza automática de entradas expiradas.
- Controle de concorrência com estratégias `parallel`, `reject`, `queue` e `replace`.
- `app.commands`, catálogo consultável, categorias, busca e help gerado por metadados.
- Localizações de nome, aliases e descrição sem duplicar definições.
- Códigos de erro `COMMAND_COOLDOWN` e `COMMAND_BUSY`.

### Compatibilidade

- `app.router()` continua retornando o mesmo router disponível em `app.commands`.
- `onlyGroup`, `onlyPrivate`, `onlyAdmin` e `botMustBeAdmin` continuam suportados.
- Comandos legados com `execute(message, args)` continuam funcionando sem alteração.
- `loadCommands()` agora também reconhece grupos de comandos.

## 0.9.0

### Alterado

- Baileys atualizado de `7.0.0-rc13` para `7.0.0-rc14`.
- O provider agora fornece `cachedGroupMetadata` ao Baileys, evitando consultas redundantes ao WhatsApp no fan-out de mensagens em grupos.
- O cache interno usado pelo envio possui TTL, LRU limitado, deduplicação de buscas concorrentes e proteção contra a reinserção de resultados invalidados durante uma busca.
- `MemoryCache` agora promove corretamente chaves sobrescritas na ordem LRU.

### Adicionado

- `MemoryCache.stats()` para observar hits, misses, sets, evictions e expirations.
- `MemoryCache.prune()` para remover entradas expiradas de forma explícita.

### Compatibilidade

- Nenhuma alteração é necessária nos comandos ou na API pública existente.
- Sessões criadas pela v0.8 continuam compatíveis; o auth state multifile do Baileys 7 já persiste as chaves de LID, device list e TC token exigidas pela migração.

## 0.8.0

### Adicionado

- `app.media.sticker(chatId, { sticker })` para enviar stickers WebP estáticos ou animados a partir de bytes, URL ou arquivo local.

## 0.7.0

### Adicionado

- `app.message.react(message, emoji)` e `app.message.unreact(message)` para adicionar e remover reações sem expor tipos do provider.
- Evento `groupParticipantsChanged`, com grupo, ação, participantes afetados e autor quando informado pelo WhatsApp.

### Alterado

- Alterações de participantes continuam invalidando automaticamente o cache de metadados do grupo antes da emissão do evento público.

## 0.6.0

### Adicionado

- `app.media.download(message)` para baixar imagens, vídeos, áudios, documentos e stickers recebidos como um `Buffer` com metadados normalizados.
- Renovação automática da URL de mídia quando o link original expira.
- Configurações `cache.memoryMaxEntries` e `messageCacheSize` para limitar a memória usada pelos caches internos.

### Alterado

- O cache em memória agora usa LRU e agrupa buscas simultâneas dos metadados do mesmo grupo em uma única consulta ao WhatsApp.
- O cache de mensagens usa a chave completa da conversa, evitando colisões entre mensagens de chats distintos, e mantém até 1.000 entradas por padrão.
- Envio de presença deixou de fazer uma assinatura remota antes de cada atualização, reduzindo uma ida extra à rede para `typing`, `recording` e `paused`.

## 0.5.1

### Adicionado

- `defineCommands(...commands)` para declarar vários comandos no mesmo módulo com inferência completa de tipos.
- `LoadCommandsResult.commands`, com o nome e o arquivo de origem de cada comando registrado.

### Alterado

- `loadCommands()` agora descobre todos os comandos exportados por um arquivo, incluindo vários exports nomeados e coleções exportadas por padrão.
- Exports auxiliares são ignorados quando o módulo possui comandos válidos.
- O mesmo objeto de comando não é registrado duas vezes quando aparece em mais de um export.
- A ordem de descoberta dos arquivos agora é determinística.

### Corrigido

- Corrigido o autoload que registrava apenas o primeiro comando de arquivos como `mute/unmute`.

## 0.5.0

### Adicionado

- `loadCommands(registrar, dirPath, options?)` para registrar comandos automaticamente a partir de uma pasta e suas subpastas, sem importação manual arquivo por arquivo.
- Código de erro `COMMAND_LOAD_FAILED` para falhas de leitura de diretório, importação ou export inválido em `loadCommands`.

## 0.4.0

### Adicionado

- Evento `call` em `app.on()`, emitido a cada atualização de chamada (`offer`, `ringing`, `preaccept`, `timeout`, `reject`, `accept`).
- Modelo `CallEvent` normalizado, exportado pelo pacote. Status desconhecidos vindos do provider são normalizados para `timeout`.
- `app.chat.rejectCall(callId, from)` para rejeitar chamadas de voz e vídeo.
- Suporte ao evento `call` do Baileys no `BaileysProvider`.

## 0.3.0

### Adicionado

- Logger estruturado com níveis `debug`, `info`, `warn`, `error` e `silent`.
- Formatos de console `pretty` e `json`.
- Writer customizado, escopos filhos e redaction de dados sensíveis.
- Adaptação sanitizada dos logs internos do provider.
- `app.health()` e `app.isReady` para monitoramento.
- Workflows de CI e publicação npm com trusted publishing.
- Templates de issues, pull requests, segurança e contribuição.

### Alterado

- README reorganizado para GitHub e npm.
- Metadados do pacote preparados para publicação.

## 0.2.0

### Adicionado

- Modelo `User` com JID, LID, telefone, nome e menção.
- Resolução de usuários por menção, reply ou número.
- Mute permanente ou temporário com SQLite e store customizável.
- Exclusão automática de mensagens de usuários mutados.

## 0.1.0

### Adicionado

- Fundação da API, provider, conexão, comandos, grupos, membros, cache e mensagens.
