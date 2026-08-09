import type { CommandContext } from '@/commands/context.js';
import type { WhaNextErrorCode } from '@/errors/error.js';

export interface GuardResult {
  allowed: boolean;
  code?: WhaNextErrorCode;
  message?: string;
}

export type CommandGuard = (
  context: CommandContext,
) => boolean | void | GuardResult | Promise<boolean | void | GuardResult>;

export const guards = {
  owner(): CommandGuard {
    return (context) => context.isOwner || ({
      allowed: false,
      code: 'COMMAND_NOT_ALLOWED',
      message: 'This command can only be used by the connected WhatsApp account.',
    });
  },

  group(): CommandGuard {
    return (context) => context.isGroup || ({
      allowed: false,
      code: 'COMMAND_NOT_ALLOWED',
      message: 'This command can only be used in groups.',
    });
  },

  private(): CommandGuard {
    return (context) => !context.isGroup || ({
      allowed: false,
      code: 'COMMAND_NOT_ALLOWED',
      message: 'This command can only be used in private chats.',
    });
  },

  userAdmin(): CommandGuard {
    return async (context) => (
      context.isGroup
      && await context.groups.isAdmin(context.chatId, context.senderIds)
    ) || ({
      allowed: false,
      code: 'COMMAND_NOT_ALLOWED',
      message: 'This command can only be used by group administrators.',
    });
  },

  botAdmin(): CommandGuard {
    return async (context) => (
      context.isGroup
      && await context.groups.isCurrentUserAdmin(context.chatId)
    ) || ({
      allowed: false,
      code: 'BOT_NOT_ADMIN',
      message: 'The connected WhatsApp account must be a group administrator.',
    });
  },

  botEnabled(
    check: (context: CommandContext) => boolean | Promise<boolean>,
  ): CommandGuard {
    return async (context) => await check(context) || ({
      allowed: false,
      code: 'COMMAND_NOT_ALLOWED',
      message: 'Commands are disabled in this chat.',
    });
  },

  custom(guard: CommandGuard): CommandGuard {
    return guard;
  },
};
