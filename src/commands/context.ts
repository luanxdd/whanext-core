import type {
  CommandOptionSchema,
  ParsedCommandOptions,
} from '@/commands/options.js';
import type { ArgsParser } from '@/commands/args-parser.js';
import type { RegisteredCommand } from '@/commands/command.js';
import { WhaNextError } from '@/errors/error.js';
import type {
  Message,
  MessageContent,
  SentMessage,
} from '@/models/message.js';
import type { User } from '@/models/user.js';
import type { MuteService } from '@/mute/mute-service.js';
import type { ChatService } from '@/services/chat-service.js';
import type { GroupService } from '@/services/group-service.js';
import type { MediaService } from '@/services/media-service.js';
import type { MemberService } from '@/services/member-service.js';
import type { MessageService } from '@/services/message-service.js';
import type { UserService } from '@/services/user-service.js';

export interface CommandCatalogView {
  readonly prefix: string;
  readonly size: number;
  catalog(options?: { category?: string; includeHidden?: boolean }): readonly RegisteredCommand[];
  categories(): readonly string[];
  has(path: string): boolean;
  find(path: string): RegisteredCommand | undefined;
}

export interface CommandAccountContext {
  readonly id: string | undefined;
  readonly ids: readonly string[];
  isOwner(message: Pick<Message, 'keys' | 'senderIds'>): boolean;
}

export interface CommandRuntimeServices {
  account: CommandAccountContext;
  messages: MessageService;
  media: MediaService;
  groups: GroupService;
  members: MemberService;
  chats: ChatService;
  users: UserService;
  mute: MuteService;
}

export interface CommandChatContext {
  id: string;
  isGroup: boolean;
}

export interface CommandGroupContext {
  id: string;
  metadata(refresh?: boolean): ReturnType<GroupService['metadata']>;
  isUserAdmin(): Promise<boolean>;
  isBotAdmin(): Promise<boolean>;
}

export interface ReplyOptions {
  deleteAfterMs?: number;
}

export interface CommandContext<Schema extends CommandOptionSchema = CommandOptionSchema>
  extends Message {
  readonly message: Message;
  readonly user: User;
  readonly account: CommandAccountContext;
  readonly isOwner: boolean;
  readonly chat: CommandChatContext;
  readonly group: CommandGroupContext | undefined;
  readonly command: RegisteredCommand;
  readonly commands: CommandCatalogView;
  readonly prefix: string;
  readonly options: ParsedCommandOptions<Schema>;
  readonly args: ArgsParser;
  readonly locale: string | undefined;
  readonly signal: AbortSignal;
  readonly client: CommandRuntimeServices;
  readonly messages: MessageService;
  readonly mediaService: MediaService;
  readonly groups: GroupService;
  readonly members: MemberService;
  readonly chats: ChatService;
  readonly users: UserService;
  readonly muteService: MuteService;

  reply(content: string | MessageContent, options?: ReplyOptions): Promise<SentMessage>;
  defer(content?: string | MessageContent): Promise<DeferredReply>;
  edit(content: string): Promise<SentMessage>;
  react(emoji: string): Promise<SentMessage>;
  unreact(): Promise<SentMessage>;
  delete(): Promise<void>;
  deleteReply(options?: ReplyOptions): Promise<void>;
}

interface CreateCommandContextOptions<Schema extends CommandOptionSchema> {
  message: Message;
  command: RegisteredCommand;
  options: ParsedCommandOptions<Schema>;
  args: ArgsParser;
  services: CommandRuntimeServices;
  commands: CommandCatalogView;
  signal: AbortSignal;
  locale?: string;
}

class CommandContextImplementation<Schema extends CommandOptionSchema> {
  readonly message: Message;
  readonly user: User;
  readonly account: CommandAccountContext;
  readonly isOwner: boolean;
  readonly chat: CommandChatContext;
  readonly group: CommandGroupContext | undefined;
  readonly command: RegisteredCommand;
  readonly commands: CommandCatalogView;
  readonly prefix: string;
  readonly options: ParsedCommandOptions<Schema>;
  readonly args: ArgsParser;
  readonly locale: string | undefined;
  readonly signal: AbortSignal;
  readonly client: CommandRuntimeServices;
  readonly messages: MessageService;
  readonly mediaService: MediaService;
  readonly groups: GroupService;
  readonly members: MemberService;
  readonly chats: ChatService;
  readonly users: UserService;
  readonly muteService: MuteService;
  #lastReply: SentMessage | undefined;

  constructor(options: CreateCommandContextOptions<Schema>) {
    this.message = options.message;
    this.user = options.message.sender;
    this.account = options.services.account;
    this.isOwner = this.account.isOwner(options.message);
    this.chat = { id: options.message.chatId, isGroup: options.message.isGroup };
    this.command = options.command;
    this.commands = options.commands;
    this.prefix = options.commands.prefix;
    this.options = options.options;
    this.args = options.args;
    this.locale = options.locale;
    this.signal = options.signal;
    this.client = options.services;
    this.messages = options.services.messages;
    this.mediaService = options.services.media;
    this.groups = options.services.groups;
    this.members = options.services.members;
    this.chats = options.services.chats;
    this.users = options.services.users;
    this.muteService = options.services.mute;
    this.group = options.message.isGroup
      ? this.#createGroupContext(options.message)
      : undefined;
    Object.assign(this, options.message);
  }

  async reply(content: string | MessageContent, options: ReplyOptions = {}): Promise<SentMessage> {
    const sent = await this.messages.reply(this.message, normalizeContent(content));
    this.#lastReply = sent;
    this.#scheduleDeletion(sent, options.deleteAfterMs);
    return sent;
  }

  async defer(
    content: string | MessageContent = '⏳ _Processando..._',
  ): Promise<DeferredReply> {
    const sent = await this.reply(content);
    return new DeferredReply(this.messages, sent, (message) => {
      this.#lastReply = message;
    });
  }

  async edit(content: string): Promise<SentMessage> {
    if (!this.#lastReply) {
      throw new WhaNextError(
        'MESSAGE_NOT_FOUND',
        'There is no command reply to edit. Call reply() or defer() first.',
      );
    }

    const edited = await this.messages.edit(this.#lastReply, content);
    this.#lastReply = edited;
    return edited;
  }

  react(emoji: string): Promise<SentMessage> {
    return this.messages.react(this.message, emoji);
  }

  unreact(): Promise<SentMessage> {
    return this.messages.unreact(this.message);
  }

  delete(): Promise<void> {
    return this.messages.delete(this.message);
  }

  async deleteReply(options: ReplyOptions = {}): Promise<void> {
    if (!this.#lastReply) return;

    if (options.deleteAfterMs !== undefined && options.deleteAfterMs > 0) {
      this.#scheduleDeletion(this.#lastReply, options.deleteAfterMs);
      return;
    }

    await this.messages.delete(this.#lastReply);
    this.#lastReply = undefined;
  }

  #createGroupContext(message: Message): CommandGroupContext {
    return {
      id: message.chatId,
      metadata: (refresh) => this.groups.metadata(message.chatId, refresh),
      isUserAdmin: () => this.groups.isAdmin(message.chatId, message.senderIds),
      isBotAdmin: () => this.groups.isCurrentUserAdmin(message.chatId),
    };
  }

  #scheduleDeletion(message: SentMessage, delayMs?: number): void {
    if (delayMs === undefined || delayMs <= 0) return;

    const timer = setTimeout(() => {
      void this.messages.delete(message).catch(() => undefined);
    }, delayMs);
    timer.unref?.();
  }
}

export class DeferredReply {
  readonly #messages: MessageService;
  #message: SentMessage;
  readonly #onEdit: (message: SentMessage) => void;

  constructor(
    messages: MessageService,
    message: SentMessage,
    onEdit: (message: SentMessage) => void,
  ) {
    this.#messages = messages;
    this.#message = message;
    this.#onEdit = onEdit;
  }

  async edit(content: string): Promise<SentMessage> {
    this.#message = await this.#messages.edit(this.#message, content);
    this.#onEdit(this.#message);
    return this.#message;
  }

  delete(): Promise<void> {
    return this.#messages.delete(this.#message);
  }
}

export function createCommandContext<Schema extends CommandOptionSchema>(
  options: CreateCommandContextOptions<Schema>,
): CommandContext<Schema> {
  return new CommandContextImplementation(options) as unknown as CommandContext<Schema>;
}

function normalizeContent(content: string | MessageContent): MessageContent {
  return typeof content === 'string' ? { text: content } : content;
}
