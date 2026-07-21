# Changelog

Todas as mudanças relevantes do projeto serão registradas neste arquivo.

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
