# WhaNext Core v0.14.3 — Robustez no pareamento

## Objetivo

Evitar rejeições assíncronas órfãs quando a solicitação de código de pareamento e o fechamento do socket acontecem praticamente ao mesmo tempo.

## Cenário corrigido

Durante `app.login()`, a WhaNext aguarda o estado `connected` enquanto solicita o código de pareamento. O WhatsApp pode encerrar o socket durante essa solicitação, por exemplo com um erro de autenticação.

Antes da v0.14.3, se `requestPairingCode()` falhasse primeiro, a Promise interna que aguardava a conexão também podia rejeitar logo depois sem ser observada pelo chamador, causando um `unhandledRejection` adicional no processo.

A v0.14.3 registra imediatamente um consumidor seguro para essa Promise. O erro principal de `app.login()` continua sendo propagado normalmente, mas não existe uma segunda rejeição órfã.

## Compatibilidade

Nenhuma assinatura pública foi alterada. `app.login()`, `LoginOptions` e os providers continuam com a mesma API da v0.14.2.

## Responsabilidade da aplicação

A biblioteca não remove automaticamente diretórios de autenticação persistidos. Aplicações que oferecem pareamento sob demanda devem descartar auth incompleta quando uma conta que nunca concluiu o login precisa iniciar um novo pareamento.
