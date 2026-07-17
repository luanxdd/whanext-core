# Changelog

Todas as mudanças relevantes do projeto serão registradas neste arquivo.

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
