# Contribuindo com o WhaNext

Obrigado pelo interesse em melhorar o projeto.

## Ambiente

- Node.js 22.5 ou superior
- npm compatível com o `package-lock.json`

```bash
npm ci
npm run check
```

## Princípios da API

- Baileys permanece restrito ao provider interno.
- A API pública usa modelos e erros do WhaNext.
- Operações dependentes de estado retornam resultados tipados e idempotentes.
- JID, LID e PN são resolvidos pela biblioteca.
- Novos comportamentos possuem testes sem conexão real com o WhatsApp.
- Imports com vários nomes mantêm um nome por linha.
- Código-fonte não contém comentários explicando implementação óbvia.

## Pull requests

Abra uma issue antes de mudanças grandes na API. Pull requests devem ser pequenos, ter uma motivação clara e incluir documentação quando alterarem o uso público.

Antes de enviar:

```bash
npm run check
npm pack --dry-run
```

Não envie pastas de sessão, bancos locais, números telefônicos, pairing codes ou logs sem sanitização.
