# Changelog

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
