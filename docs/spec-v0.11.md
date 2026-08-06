# WhaNext v0.11 — Command Discovery

## Objetivo

Eliminar barrels (`index.ts`) e registros manuais em bots grandes, preservando o modelo tipado de `defineCommand`.

## API

```ts
await app.commands.load(new URL('./commands/', import.meta.url));
```

`CommandRouter.load()` delega ao loader oficial e retorna `LoadCommandsResult`. O loader aceita `string | URL`, percorre subdiretórios por padrão e reconhece JavaScript e TypeScript.

## CommandContext

Todo comando recebe:

- `ctx.prefix`: prefixo atual do router;
- `ctx.commands`: visão somente-leitura do catálogo, com `catalog`, `categories`, `find`, `has`, `size` e `prefix`.

Isso permite menus e help dinâmicos sem factory, singleton global ou import circular do app.

## Estrutura recomendada

```text
commands/
  admin/
    ban.ts
    mute.ts
  group/
    access.ts
  general/
    menu.ts
```

Cada arquivo exporta um `CommandDefinition`, vários definitions nomeados ou `defineCommands(...)`. Nenhum `index.ts` é necessário.
