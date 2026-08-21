import { ArgsParser } from '@/commands/args-parser.js';
import {
  type CommandDefinition,
  type CommandHooks,
  type CommandMiddleware,
  type CommandScope,
  type ExecutableCommandDefinition,
  isCommandGroup,
  type RegisteredCommand,
} from '@/commands/command.js';
import {
  CommandConcurrencyController,
  type CommandConcurrencyHealth,
  type CommandQueueFullEvent,
  type CommandQueueTimeoutEvent,
} from '@/commands/concurrency.js';
import {
  createCommandContext,
  type CommandContext,
  type CommandRuntimeServices,
} from '@/commands/context.js';
import { loadCommands, type LoadCommandsOptions, type LoadCommandsResult } from '@/commands/load-commands.js';
import type { CommandGuard, GuardResult } from '@/commands/guards.js';
import {
  ParsedCommandOptions,
  parseCommandOptions,
} from '@/commands/options.js';
import {
  WhaNextError,
  toWhaNextError,
} from '@/errors/error.js';
import type { Message, SentMessage } from '@/models/message.js';
import { TypedEventEmitter } from '@/provider/event-emitter.js';
import type { GroupService } from '@/services/group-service.js';
import { UserService } from '@/services/user-service.js';

export interface RouterOptions {
  prefix?: string | readonly string[];
  onError?: (error: WhaNextError, message: Message) => void | Promise<void>;
  onCommandError?: CommandErrorHandler;
  beforeExecute?: (context: CommandContext) => void | Promise<void>;
  afterExecute?: (context: CommandContext) => void | Promise<void>;
}

export interface CommandCatalogOptions {
  category?: string;
  includeHidden?: boolean;
}

export interface CommandHelpOptions extends CommandCatalogOptions {
  title?: string;
}

export type CommandErrorHandler = (
  context: CommandContext,
  error: WhaNextError,
) => void | Promise<void>;

export interface CommandRouterEvents {
  commandQueueTimeout: CommandQueueTimeoutEvent;
  commandQueueFull: CommandQueueFullEvent;
}

interface ResolvedCommand {
  registered: RegisteredCommand;
  layers: readonly CommandDefinition[];
  tokens: readonly string[];
  locale?: string;
}

interface RegisteredRoot {
  definition: CommandDefinition;
  locale?: string;
}

export class CommandRouter {
  readonly #roots = new Map<string, RegisteredRoot>();
  readonly #prefixlessRoots = new Map<string, RegisteredRoot>();
  readonly #definitions = new Set<CommandDefinition>();
  #prefix = '!';
  #prefixes: readonly string[] = ['!'];
  #matchingPrefixes: readonly string[] = ['!'];
  readonly #services: CommandRuntimeServices;
  readonly #legacyOnError?: RouterOptions['onError'];
  readonly #globalMiddleware: CommandMiddleware[] = [];
  readonly #errorHandlers: CommandErrorHandler[] = [];
  readonly #cooldowns = new Map<string, number>();
  readonly #events = new TypedEventEmitter<CommandRouterEvents>();
  readonly #concurrency: CommandConcurrencyController;
  readonly #beforeExecute?: RouterOptions['beforeExecute'];
  readonly #afterExecute?: RouterOptions['afterExecute'];
  #cooldownOperations = 0;

  constructor(services: CommandRuntimeServices, options?: RouterOptions);
  constructor(group: GroupService, options?: RouterOptions);
  constructor(
    servicesOrGroup: CommandRuntimeServices | GroupService,
    options: RouterOptions = {},
  ) {
    this.#concurrency = new CommandConcurrencyController((event) => {
      if (event.type === 'commandQueueTimeout') {
        void this.#events.emit('commandQueueTimeout', event.payload).catch(() => undefined);
      } else {
        void this.#events.emit('commandQueueFull', event.payload).catch(() => undefined);
      }
    });
    this.#services = isRuntimeServices(servicesOrGroup)
      ? servicesOrGroup
      : createLegacyServices(servicesOrGroup);
    this.setPrefixes(options.prefix ?? '!');
    this.#legacyOnError = options.onError;
    this.#beforeExecute = options.beforeExecute;
    this.#afterExecute = options.afterExecute;
    if (options.onCommandError) this.#errorHandlers.push(options.onCommandError);
  }

  get prefix(): string {
    return this.#prefix;
  }

  get prefixes(): readonly string[] {
    return this.#prefixes;
  }

  setPrefixes(prefixes: string | readonly string[]): this {
    const normalized = normalizePrefixes(prefixes);
    this.#prefixes = normalized;
    this.#matchingPrefixes = [...normalized].sort((left, right) => right.length - left.length);
    this.#prefix = normalized[0]!;
    return this;
  }

  get size(): number {
    return this.catalog({ includeHidden: true }).length;
  }

  health(): CommandConcurrencyHealth {
    return this.#concurrency.health();
  }

  on<Event extends keyof CommandRouterEvents>(
    event: Event,
    listener: (payload: CommandRouterEvents[Event]) => void | Promise<void>,
  ): () => void {
    return this.#events.on(event, listener);
  }

  command(definition: CommandDefinition): this {
    this.#validateTree(definition, []);

    for (const name of commandNames(definition)) {
      const normalized = name.value.toLowerCase();

      if (this.#roots.has(normalized)) {
        throw new WhaNextError(
          'ARGUMENT_INVALID',
          `The command "${normalized}" is already registered.`,
        );
      }

      this.#roots.set(normalized, {
        definition,
        ...(name.locale ? { locale: name.locale } : {}),
      });
    }

    for (const name of prefixlessCommandNames(definition)) {
      const normalized = name.value.toLowerCase();

      if (this.#prefixlessRoots.has(normalized)) {
        throw new WhaNextError(
          'ARGUMENT_INVALID',
          `The prefixless command trigger "${normalized}" is already registered.`,
        );
      }

      this.#prefixlessRoots.set(normalized, {
        definition,
        ...(name.locale ? { locale: name.locale } : {}),
      });
    }

    this.#definitions.add(definition);
    return this;
  }

  load(dirPath: string | URL, options: LoadCommandsOptions = {}): Promise<LoadCommandsResult> {
    return loadCommands(this, dirPath, options);
  }

  use(middleware: CommandMiddleware): this {
    this.#globalMiddleware.push(middleware);
    return this;
  }

  onError(handler: CommandErrorHandler): () => void {
    this.#errorHandlers.push(handler);
    return () => {
      const index = this.#errorHandlers.indexOf(handler);
      if (index >= 0) this.#errorHandlers.splice(index, 1);
    };
  }

  catalog(options: CommandCatalogOptions = {}): readonly RegisteredCommand[] {
    const commands = [...this.#definitions].flatMap((definition) =>
      flattenCommands(definition));
    return commands.filter((command) => (
      (options.includeHidden || !command.definition.hidden)
      && (!options.category || command.category === options.category)
    ));
  }

  categories(): readonly string[] {
    return [...new Set(this.catalog().map((command) => command.category))].sort();
  }

  has(path: string): boolean {
    return this.find(path) !== undefined;
  }

  values(): readonly RegisteredCommand[] {
    return this.catalog({ includeHidden: true });
  }

  find(path: string): RegisteredCommand | undefined {
    const normalized = path.trim().toLowerCase().split(/\s+/);
    return this.catalog({ includeHidden: true }).find((command) =>
      command.path.join(' ').toLowerCase() === normalized.join(' ')
      || command.aliases.some((alias) => alias.toLowerCase() === normalized.at(-1)));
  }

  async help(
    context: CommandContext,
    options: CommandHelpOptions = {},
  ): Promise<SentMessage> {
    const commands = this.catalog(options);
    const title = options.title ?? (options.category
      ? `📚 *${options.category}*`
      : '📚 *Comandos*');
    const lines = commands.map((command) => {
      const usage = command.definition.usage
        ?? `${this.#prefix}${command.path.join(' ')}${formatOptions(command.definition)}`;
      const description = context.locale
        ? command.definition.localizations?.[context.locale]?.description
          ?? command.definition.description
        : command.definition.description;
      return `• *${usage}*\n  ${description}`;
    });
    const text = lines.length > 0
      ? `${title}\n\n${lines.join('\n\n')}`
      : `${title}\n\n_Nenhum comando disponível._`;
    return context.reply(text);
  }

  async dispatch(message: Message): Promise<boolean> {
    const text = (message.interactive?.id ?? message.text)?.trim();
    if (!text) return false;

    const matchedPrefix = this.#matchPrefix(text);
    const tokens = tokenize(matchedPrefix === undefined ? text : text.slice(matchedPrefix.length));
    const rootName = tokens.shift()?.toLowerCase();
    if (!rootName) return false;

    const root = matchedPrefix === undefined
      ? this.#prefixlessRoots.get(rootName)
      : this.#roots.get(rootName);
    if (!root) return false;
    const invocationPrefix = matchedPrefix ?? '';

    let resolved: ResolvedCommand;

    try {
      resolved = this.#resolve(root, tokens);
    } catch (error) {
      const normalized = toWhaNextError(error, { command: root.definition.name, messageId: message.id });
      const fallbackDefinition: ExecutableCommandDefinition = {
        ...root.definition,
        execute: () => undefined,
      };
      const context = createCommandContext({
        message,
        command: {
          definition: fallbackDefinition,
          root: root.definition,
          path: [root.definition.name],
          aliases: root.definition.aliases ?? [],
          category: root.definition.category ?? 'general',
        },
        options: new ParsedCommandOptions({}),
        args: new ArgsParser(tokens),
        services: this.#services,
        commands: this,
        prefix: invocationPrefix,
        signal: new AbortController().signal,
        ...(root.locale ? { locale: root.locale } : {}),
      });
      if (root.definition.hooks?.onError) {
        await root.definition.hooks.onError(context, normalized);
        return true;
      }
      if (this.#errorHandlers.length > 0) {
        for (const handler of this.#errorHandlers) await handler(context, normalized);
        return true;
      }
      if (this.#legacyOnError) {
        await this.#legacyOnError(normalized, message);
        return true;
      }
      throw normalized;
    }

    const legacyArgs = new ArgsParser(resolved.tokens);
    let context: CommandContext | undefined;

    try {
      const parsedOptions = await parseCommandOptions(
        resolved.registered.definition.options,
        resolved.tokens,
        message,
        this.#services.users,
      );
      const concurrency = [...resolved.layers]
        .reverse()
        .find((layer) => layer.concurrency)?.concurrency;
      const concurrencyKey = this.#executionKey(
        resolved,
        message,
        concurrency?.scope ?? 'user-chat',
      );

      await this.#concurrency.run(
        concurrencyKey,
        concurrency,
        async (signal) => {
          context = createCommandContext({
            message,
            command: resolved.registered,
            options: parsedOptions,
            args: legacyArgs,
            services: this.#services,
            commands: this,
            prefix: invocationPrefix,
            signal,
            ...(resolved.locale ? { locale: resolved.locale } : {}),
          });

          await this.#authorize(resolved.layers, context);
          this.#consumeCooldown(resolved, context);
          await this.#execute(resolved, context);
        },
        {
          command: resolved.registered.path.join(' '),
          messageId: message.id,
          chatId: message.chatId,
          userId: message.sender.id,
        },
      );
      return true;
    } catch (error) {
      const normalized = toWhaNextError(error, {
        command: resolved.registered.path.join(' '),
        messageId: message.id,
      });
      context ??= createCommandContext({
        message,
        command: resolved.registered,
        options: new ParsedCommandOptions({}),
        args: legacyArgs,
        services: this.#services,
        commands: this,
        prefix: invocationPrefix,
        signal: new AbortController().signal,
        ...(resolved.locale ? { locale: resolved.locale } : {}),
      });

      if (await this.#handleError(resolved, context, normalized)) return true;
      throw normalized;
    }
  }

  #matchPrefix(text: string): string | undefined {
    return this.#matchingPrefixes.find((prefix) => text.startsWith(prefix));
  }

  #resolve(root: RegisteredRoot, inputTokens: readonly string[]): ResolvedCommand {
    const tokens = [...inputTokens];
    const layers: CommandDefinition[] = [root.definition];
    let current = root.definition;
    let locale = root.locale;

    while (isCommandGroup(current)) {
      const name = tokens.shift()?.toLowerCase();
      if (!name) {
        throw new WhaNextError('ARGUMENT_MISSING', `Choose a subcommand for "${current.name}".`, {
          context: { command: current.name },
        });
      }

      const found = findChild(current.subcommands, name);
      if (!found) {
        throw new WhaNextError('ARGUMENT_INVALID', `The subcommand "${name}" does not exist.`, {
          context: { command: current.name, subcommand: name },
        });
      }

      current = found.definition;
      locale ??= found.locale;
      layers.push(current);
    }

    const path = layers.map((definition) => definition.name);
    return {
      registered: {
        definition: current,
        root: root.definition,
        path,
        aliases: current.aliases ?? [],
        category: current.category ?? root.definition.category ?? 'general',
      },
      layers,
      tokens,
      ...(locale ? { locale } : {}),
    };
  }

  async #authorize(layers: readonly CommandDefinition[], context: CommandContext): Promise<void> {
    for (const command of layers) {
      await this.#authorizeLegacy(command, context);
      for (const guard of command.guards ?? []) await runGuard(guard, context);
    }
  }

  async #authorizeLegacy(command: CommandDefinition, context: CommandContext): Promise<void> {
    if (command.onlyOwner && !context.isOwner) {
      throw new WhaNextError(
        'COMMAND_NOT_ALLOWED',
        'This command can only be used by the connected WhatsApp account.',
      );
    }
    if (command.onlyGroup && !context.isGroup) {
      throw new WhaNextError('COMMAND_NOT_ALLOWED', 'This command can only be used in groups.');
    }
    if (command.onlyPrivate && context.isGroup) {
      throw new WhaNextError('COMMAND_NOT_ALLOWED', 'This command can only be used in private chats.');
    }
    if (command.onlyAdmin && !(await this.#services.groups.isAdmin(context.chatId, context.senderIds))) {
      throw new WhaNextError('COMMAND_NOT_ALLOWED', 'This command can only be used by group administrators.');
    }
    if (command.botMustBeAdmin && !(await this.#services.groups.isCurrentUserAdmin(context.chatId))) {
      throw new WhaNextError('BOT_NOT_ADMIN', 'The connected WhatsApp account must be a group administrator.');
    }
  }

  async #execute(resolved: ResolvedCommand, context: CommandContext): Promise<void> {
    const hooks = resolved.layers.map((layer) => layer.hooks).filter(Boolean) as CommandHooks[];
    if (this.#beforeExecute) await this.#beforeExecute(context);
    for (const hook of hooks) await hook.beforeExecute?.(context);

    const middleware = [
      ...this.#globalMiddleware,
      ...resolved.layers.flatMap((layer) => layer.middleware ?? []),
    ];
    await composeMiddleware(middleware, context, async () => {
      await resolved.registered.definition.execute(context, context.args);
    });

    for (const hook of [...hooks].reverse()) await hook.afterExecute?.(context);
    if (this.#afterExecute) await this.#afterExecute(context);
  }

  #consumeCooldown(resolved: ResolvedCommand, context: CommandContext): void {
    const config = [...resolved.layers].reverse().find((layer) => layer.cooldown)?.cooldown;
    if (!config || config.durationMs <= 0) return;

    const key = this.#executionKey(resolved, context, config.scope ?? 'user');
    const now = Date.now();
    this.#cooldownOperations += 1;
    if (this.#cooldownOperations % 256 === 0) this.#pruneCooldowns(now);
    const expiresAt = this.#cooldowns.get(key) ?? 0;

    if (expiresAt > now) {
      throw new WhaNextError('COMMAND_COOLDOWN', 'This command is on cooldown.', {
        context: { retryAfterMs: expiresAt - now, key },
        recoverable: true,
      });
    }

    this.#cooldowns.set(key, now + config.durationMs);
  }

  #pruneCooldowns(now: number): void {
    for (const [key, expiresAt] of this.#cooldowns) {
      if (expiresAt <= now) this.#cooldowns.delete(key);
    }
  }

  #executionKey(
    resolved: ResolvedCommand,
    message: Pick<Message, 'chatId' | 'senderId' | 'isGroup'>,
    scope: CommandScope,
  ): string {
    const command = resolved.registered.path.join('/').toLowerCase();
    if (scope === 'global') return command;
    if (scope === 'user') return `${command}:user:${message.senderId}`;
    if (scope === 'chat') return `${command}:chat:${message.chatId}`;
    return `${command}:user-chat:${message.senderId}:${message.chatId}`;
  }

  async #handleError(
    resolved: ResolvedCommand,
    context: CommandContext,
    error: WhaNextError,
  ): Promise<boolean> {
    for (const layer of [...resolved.layers].reverse()) {
      if (layer.hooks?.onError) {
        await layer.hooks.onError(context, error);
        return true;
      }
    }

    if (this.#errorHandlers.length > 0) {
      for (const handler of this.#errorHandlers) await handler(context, error);
      return true;
    }

    if (this.#legacyOnError) {
      await this.#legacyOnError(error, context.message);
      return true;
    }

    return false;
  }

  #validateTree(definition: CommandDefinition, parents: readonly string[]): void {
    if (!definition.name.trim() || /\s/.test(definition.name)) {
      throw new WhaNextError('ARGUMENT_INVALID', 'Command names cannot be empty or contain whitespace.', {
        context: { name: definition.name },
      });
    }

    for (const name of commandNames(definition)) {
      if (!name.value.trim() || /\s/.test(name.value)) {
        throw new WhaNextError(
          'ARGUMENT_INVALID',
          'Command names and aliases cannot be empty or contain whitespace.',
          { context: { name: name.value } },
        );
      }
    }

    if (definition.prefixless && parents.length > 0) {
      throw new WhaNextError(
        'ARGUMENT_INVALID',
        'Prefixless triggers are only supported on root commands and command groups.',
        { context: { command: definition.name } },
      );
    }

    if (Array.isArray(definition.prefixless)) {
      const available = new Set(commandNames(definition).map((name) => name.value.toLowerCase()));
      for (const trigger of definition.prefixless) {
        const normalized = trigger.trim().toLowerCase();
        if (!normalized || /\s/.test(trigger) || !available.has(normalized)) {
          throw new WhaNextError(
            'ARGUMENT_INVALID',
            'Every prefixless trigger must match the command name or one of its aliases.',
            { context: { command: definition.name, trigger } },
          );
        }
      }
    }

    if (!isCommandGroup(definition)) return;
    if (definition.subcommands.length === 0) {
      throw new WhaNextError('ARGUMENT_INVALID', `The command group "${definition.name}" is empty.`);
    }

    const names = new Set<string>();
    for (const child of definition.subcommands) {
      for (const name of commandNames(child)) {
        const normalized = name.value.toLowerCase();
        if (names.has(normalized)) {
          throw new WhaNextError('ARGUMENT_INVALID', `Duplicate subcommand "${normalized}".`, {
            context: { path: [...parents, definition.name].join(' ') },
          });
        }
        names.add(normalized);
      }
      this.#validateTree(child, [...parents, definition.name]);
    }
  }
}

async function runGuard(guard: CommandGuard, context: CommandContext): Promise<void> {
  const result = await guard(context);
  if (result === undefined || result === true) return;

  const normalized: GuardResult = result === false ? { allowed: false } : result;
  if (normalized.allowed) return;
  throw new WhaNextError(
    normalized.code ?? 'COMMAND_NOT_ALLOWED',
    normalized.message ?? 'This command is not allowed in the current context.',
  );
}

async function composeMiddleware(
  middleware: readonly CommandMiddleware[],
  context: CommandContext,
  execute: () => Promise<void>,
): Promise<void> {
  let index = -1;
  const dispatch = async (position: number): Promise<void> => {
    if (position <= index) throw new Error('next() was called more than once.');
    index = position;
    const current = middleware[position];
    if (!current) return execute();
    await current(context, () => dispatch(position + 1));
  };
  await dispatch(0);
}

function normalizePrefixes(input: string | readonly string[]): readonly string[] {
  const values = typeof input === 'string' ? [input] : [...input];
  const prefixes = [...new Set(values)];

  if (prefixes.length === 0) {
    throw new WhaNextError('ARGUMENT_INVALID', 'At least one command prefix is required.');
  }

  for (const prefix of prefixes) {
    if (prefix.length === 0 || /\s/.test(prefix)) {
      throw new WhaNextError(
        'ARGUMENT_INVALID',
        'Command prefixes cannot be empty or contain whitespace.',
        { context: { prefix } },
      );
    }
  }

  return prefixes;
}

function prefixlessCommandNames(
  definition: CommandDefinition,
): Array<{ value: string; locale?: string }> {
  if (!definition.prefixless) return [];

  const names = commandNames(definition);
  if (definition.prefixless === true) return names;

  const enabled = new Set(definition.prefixless.map((name) => name.toLowerCase()));
  return names.filter((name) => enabled.has(name.value.toLowerCase()));
}

function commandNames(definition: CommandDefinition): Array<{ value: string; locale?: string }> {
  const names: Array<{ value: string; locale?: string }> = [
    definition.name,
    ...(definition.aliases ?? []),
  ].map((value) => ({ value }));
  for (const [locale, localization] of Object.entries(definition.localizations ?? {})) {
    if (localization.name) names.push({ value: localization.name, locale });
    for (const alias of localization.aliases ?? []) names.push({ value: alias, locale });
  }
  return names;
}

function findChild(
  definitions: readonly CommandDefinition[],
  name: string,
): { definition: CommandDefinition; locale?: string } | undefined {
  for (const definition of definitions) {
    const found = commandNames(definition).find((candidate) => candidate.value.toLowerCase() === name);
    if (found) return { definition, ...(found.locale ? { locale: found.locale } : {}) };
  }
  return undefined;
}

function flattenCommands(
  root: CommandDefinition,
  parents: readonly CommandDefinition[] = [],
): RegisteredCommand[] {
  if (isCommandGroup(root)) {
    return root.subcommands.flatMap((child) => flattenCommands(child, [...parents, root]));
  }

  const pathDefinitions = [...parents, root];
  return [{
    definition: root,
    root: pathDefinitions[0] ?? root,
    path: pathDefinitions.map((definition) => definition.name),
    aliases: root.aliases ?? [],
    category: root.category
      ?? [...parents].reverse().find((parent) => parent.category)?.category
      ?? 'general',
  }];
}

function formatOptions(definition: ExecutableCommandDefinition): string {
  return Object.entries(definition.options ?? {}).map(([name, option]) =>
    option.required ? ` <${name}>` : ` [${name}]`).join('');
}

function tokenize(input: string): string[] {
  return input
    .match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)
    ?.map((token) => token.replace(/^(["'])(.*)\1$/, '$2'))
    ?? [];
}

function isRuntimeServices(value: CommandRuntimeServices | GroupService): value is CommandRuntimeServices {
  return 'groups' in value && 'messages' in value;
}

function createLegacyServices(group: GroupService): CommandRuntimeServices {
  const unavailable = new Proxy({}, {
    get() {
      return () => {
        throw new WhaNextError(
          'PROVIDER_ERROR',
          'This CommandRouter was created without the full application services.',
        );
      };
    },
  });
  return {
    account: {
      id: undefined,
      get ids() {
        return [];
      },
      isOwner(message) {
        return message.keys.fromMe;
      },
    },
    groups: group,
    users: new UserService(group),
    messages: unavailable as CommandRuntimeServices['messages'],
    media: unavailable as CommandRuntimeServices['media'],
    members: unavailable as CommandRuntimeServices['members'],
    chats: unavailable as CommandRuntimeServices['chats'],
    mute: unavailable as CommandRuntimeServices['mute'],
  };
}
