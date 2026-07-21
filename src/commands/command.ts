import type { ArgsParser } from '@/commands/args-parser.js';
import type { Message } from '@/models/message.js';

export interface CommandDefinition {
  name: string;
  description: string;
  aliases?: readonly string[];
  onlyGroup?: boolean;
  onlyPrivate?: boolean;
  onlyAdmin?: boolean;
  botMustBeAdmin?: boolean;
  execute(message: Message, args: ArgsParser): void | Promise<void>;
}

export function defineCommand<const Command extends CommandDefinition>(command: Command): Command {
  return command;
}
