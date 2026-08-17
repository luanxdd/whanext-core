# Migrando do Baileys para Zapo

A v0.18 troca o provider padrão do WhaNext para Zapo. A API pública de comandos, services, mensagens, grupos e multi-account permanece a mesma, mas o formato da sessão muda.

## Sessões

O WhaNext v0.17 e anteriores usava o auth multifile do Baileys, normalmente com `creds.json` e vários arquivos de chaves. O Zapo usa um store persistente e, no provider padrão do WhaNext, esse store fica em:

```text
<auth>/state.sqlite
```

Não apague a pasta antiga antes de confirmar que a nova sessão conecta normalmente.

## Opção 1: parear novamente

É o caminho mais simples para uma conta isolada:

1. Faça backup da pasta de auth atual.
2. Use um diretório limpo para a primeira execução da v0.18.
3. Inicie o bot e gere um novo pairing code.
4. Depois de validar mensagens, grupos, mídia e reconexão, arquive a sessão antiga.

## Opção 2: converter a sessão existente

O projeto Zapo fornece o pacote `wa-store-migrate`, que converte o snapshot de autenticação do Baileys para o formato de store do Zapo sem exigir um novo pareamento.

Instale temporariamente no ambiente de migração:

```bash
npm install wa-store-migrate
```

A conversão oficial lê `{ creds, keys }` do auth multifile, chama `migrate({ from: 'baileys', to: 'zapo', data })` e grava o resultado em um store Zapo novo. Consulte o guia oficial **Migrating from Baileys** do Zapo para usar o exemplo atualizado da versão que estiver instalada.

No WhaNext, o `sessionId` precisa ser estável:

- `default` em `create()` quando `accountId` não é informado;
- o `id` da conta em `createMulti()`.

Em uma conta única com caminho `auth` customizado, o destino continua sendo `<auth>/state.sqlite`. Em multi-account, uma conversão antiga gravada em `<authRoot>/<id>/state.sqlite` é detectada e consolidada automaticamente no store compartilhado `<authRoot>/state.sqlite` na primeira inicialização da v0.19.6. Converta cada conta separadamente; o provider faz a consolidação sem misturar os `sessionId`s.

## Mensagens recebidas após reconexão

O Zapo possui um fluxo explícito de mensagens offline após a conexão. O WhaNext v0.18 protege o router por padrão: eventos que o Zapo marca como `offline` não são encaminhados como mensagens novas. O timestamp da conexão atual também é usado como fallback defensivo quando essa marca não estiver disponível.

Se sua aplicação precisa processar deliberadamente o backlog recebido depois de ficar offline, habilite:

```ts
const app = await create({
  processOfflineMessages: true,
});
```

## Mídia

O provider usa `@zapo-js/media-utils`. Para processamento completo de imagem, vídeo, áudio e voice note, mantenha `ffmpeg` e `ffprobe` disponíveis no `PATH` do processo.

## Chamadas

A partir da v0.19.4, `app.on('call')` usa o evento `call` nativo do Zapo e `rejectCall()` envia somente a sinalização de rejeição pelo `client.lowlevel`. O WhaNext não carrega o stack completo de VoIP/WebRTC para detectar ou rejeitar chamadas.

## Checklist de atualização

- faça backup do auth antigo;
- instale as dependências da v0.18;
- converta a sessão ou pareie novamente;
- valide uma mensagem privada e uma mensagem de grupo;
- valide LID/PN, reply e menções;
- valide download de imagem/vídeo e view-once;
- valide edit/delete se o bot usa anti-edit/anti-delete;
- valide chamada recebida se o bot usa anti-call;
- derrube e reconecte o processo e confirme que comandos antigos não são executados.
