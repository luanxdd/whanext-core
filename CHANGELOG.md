# Changelog

## 0.21.0

### Recursos experimentais
- Criado o entrypoint `@whanext/core/experimental`, isolado da API estável.
- Adicionado `richHtml()` para mini apps HTML em Rich Response.
- Adicionados builders experimentais para Markdown, blocos de código, tabelas, links/fontes, dicas e sugestões.
- Adicionado `RichResponseBuilder` para compor múltiplas seções em uma única resposta.
- Adicionado acesso avançado a Unified Response com encode/decode e payload bruto.
- Adicionados `sendExperimental()` e `replyExperimental()`.

### Organização
- Recursos de protocolo não estáveis agora ficam exclusivamente no módulo experimental.
- A API principal continua focada em comandos, grupos, mídia, moderação, cache, eventos e estabilidade.
