import { ArgsParser } from '@/commands/args-parser.js';
import type { CommandDefinition } from '@/commands/command.js';
import {
  WhaNextError,
  toWhaNextError,
} from '@/errors/error.js';
import type { Message } from '@/models/message.js';
import type { GroupService } from '@/services/group-service.js';

export interface RouterOptions {
  prefix?: string;
  onError?: (error: WhaNextError, message: Message) => void | Promise<void>;
}

export class CommandRouter {
  readonly #commands = new Map<string, CommandDefinition>();
  readonly #prefix: string;
  readonly #group: GroupService;
  readonly #onError?: RouterOptions['onError'];

  constructor(group: GroupService, options: RouterOptions = {}) {
    this.#group = group;
    this.#prefix = options.prefix ?? '!';
    this.#onError = options.onError;

    if (this.#prefix.length === 0 || /\s/.test(this.#prefix)) {
      throw new WhaNextError(
        'ARGUMENT_INVALID',
        'The command prefix cannot be empty or contain whitespace.',
        {
          context: { prefix: this.#prefix },
        },
      );
    }
  }

  command(definition: CommandDefinition): this {
    const names = [definition.name, ...(definition.aliases ?? [])];

    for (const name of names) {
      const normalized = name.toLowerCase();

      if (this.#commands.has(normalized)) {
        throw new WhaNextError(
          'ARGUMENT_INVALID',
          `The command "${normalized}" is already registered.`,
        );
      }

      this.#commands.set(normalized, definition);
    }

    return this;
  }

  async dispatch(message: Message): Promise<boolean> {
    const text = message.text?.trim();

    if (!text?.startsWith(this.#prefix)) {
      return false;
    }

    const tokens = tokenize(text.slice(this.#prefix.length));
    const name = tokens.shift()?.toLowerCase();

    if (!name) {
      return false;
    }

    const command = this.#commands.get(name);

    if (!command) {
      return false;
    }

    try {
      await this.#authorize(command, message);
      await command.execute(message, new ArgsParser(tokens));
      return true;
    } catch (error) {
      const normalized = toWhaNextError(error, { command: command.name, messageId: message.id });

      if (this.#onError) {
        await this.#onError(normalized, message);
        return true;
      }

      throw normalized;
    }
  }

  async #authorize(command: CommandDefinition, message: Message): Promise<void> {
    if (command.onlyGroup && !message.isGroup) {
      throw new WhaNextError('COMMAND_NOT_ALLOWED', 'This command can only be used in groups.');
    }

    if (command.onlyPrivate && message.isGroup) {
      throw new WhaNextError(
        'COMMAND_NOT_ALLOWED',
        'This command can only be used in private chats.',
      );
    }

    if (command.onlyAdmin && !(await this.#group.isAdmin(message.chatId, message.senderIds))) {
      throw new WhaNextError(
        'COMMAND_NOT_ALLOWED',
        'This command can only be used by group administrators.',
      );
    }

    if (command.botMustBeAdmin && !(await this.#group.isCurrentUserAdmin(message.chatId))) {
      throw new WhaNextError(
        'BOT_NOT_ADMIN',
        'The connected WhatsApp account must be a group administrator.',
      );
    }
  }
}

function tokenize(input: string): string[] {
  return input
    .match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)
    ?.map((token) => token.replace(/^(["'])(.*)\1$/, '$2'))
    ?? [];
}
