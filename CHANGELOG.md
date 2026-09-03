## 0.21.2

### Respostas experimentais
- Corrigido o identificador de Rich Responses: `response.id` volta a ser tratado como prefixo e cada envio recebe um `responseId` único com timestamp e UUID.
- Removido o override incorreto do stanza ID introduzido na 0.21.1; o Zapo volta a gerar o ID de transporte normalmente, como no fluxo Rich HTML funcional da série 0.20.x.
- `replyExperimental()` volta a preservar o contexto de resposta sem reutilizar identificadores fixos.

# Changelog

## 0.21.1

### Recursos experimentais
- Corrigido o envio de Rich Responses para reutilizar o `responseId` como ID real do stanza enviado pelo Zapo. O `botResponseId`, `unified.response_id` e o ID da mensagem agora permanecem correlacionados, como exigido pelo fluxo de Rich Response do WhatsApp.
- `replyExperimental()` continua selecionando o chat da mensagem original, mas Rich Responses deixam de receber contexto de quote, evitando que o wrapper experimental seja reescrito ou descartado silenciosamente pelo cliente.


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
