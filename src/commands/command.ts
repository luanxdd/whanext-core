import type { ArgsParser } from '@/commands/args-parser.js';
import type { CommandContext } from '@/commands/context.js';
import type { CommandGuard } from '@/commands/guards.js';
import type { CommandOptionSchema } from '@/commands/options.js';

export type CommandScope = 'global' | 'user' | 'chat' | 'user-chat' | 'user-group';
export type ConcurrencyStrategy = 'parallel' | 'reject' | 'queue' | 'replace';

export interface CommandCooldown {
  durationMs: number;
  scope?: CommandScope;
}

export interface CommandConcurrency {
  max?: number;
  scope?: CommandScope;
  strategy?: ConcurrencyStrategy;
}

export interface CommandLocalization {
  name?: string;
  aliases?: readonly string[];
  description?: string;
}

export type CommandMiddleware = (
  context: CommandContext,
  next: () => Promise<void>,
) => void | Promise<void>;

export interface CommandHooks {
  beforeExecute?: (context: CommandContext) => void | Promise<void>;
  afterExecute?: (context: CommandContext) => void | Promise<void>;
  onError?: (context: CommandContext, error: Error) => void | Promise<void>;
}

export interface CommandMetadata {
  name: string;
  description: string;
  aliases?: readonly string[];
  prefixless?: boolean | readonly string[];
  category?: string;
  usage?: string;
  examples?: readonly string[];
  hidden?: boolean;
  localizations?: Readonly<Record<string, CommandLocalization>>;
  guards?: readonly CommandGuard[];
  middleware?: readonly CommandMiddleware[];
  cooldown?: CommandCooldown;
  concurrency?: CommandConcurrency;
  hooks?: CommandHooks;
  onlyGroup?: boolean;
  onlyPrivate?: boolean;
  onlyAdmin?: boolean;
  botMustBeAdmin?: boolean;
  onlyOwner?: boolean;
}

export interface ExecutableCommandDefinition<
  Schema extends CommandOptionSchema = CommandOptionSchema,
> extends CommandMetadata {
  options?: Schema;
  execute(
    context: CommandContext<Schema>,
    args: ArgsParser,
  ): void | Promise<void>;
}

export interface CommandGroupDefinition extends CommandMetadata {
  subcommands: readonly CommandDefinition[];
}

export type CommandDefinition<Schema extends CommandOptionSchema = CommandOptionSchema> =
  | ExecutableCommandDefinition<Schema>
  | CommandGroupDefinition;

export interface RegisteredCommand {
  definition: ExecutableCommandDefinition;
  root: CommandDefinition;
  path: readonly string[];
  aliases: readonly string[];
  category: string;
}

export function defineCommand<const Schema extends CommandOptionSchema = CommandOptionSchema>(
  command: ExecutableCommandDefinition<Schema>,
): ExecutableCommandDefinition<Schema> {
  return command;
}

export function defineSubcommand<const Schema extends CommandOptionSchema = CommandOptionSchema>(
  command: ExecutableCommandDefinition<Schema>,
): ExecutableCommandDefinition<Schema> {
  return command;
}

export function defineCommandGroup<const Group extends CommandGroupDefinition>(group: Group): Group {
  return group;
}

export function defineCommands<const Commands extends readonly CommandDefinition[]>(
  ...commands: Commands
): Commands {
  return commands;
}

export function isCommandGroup(
  definition: CommandDefinition,
): definition is CommandGroupDefinition {
  return 'subcommands' in definition;
}
