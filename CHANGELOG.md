# Changelog

Todas as mudanças relevantes do projeto serão registradas neste arquivo.

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
