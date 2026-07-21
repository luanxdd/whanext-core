import type { CacheOptions } from '@/cache/cache-store.js';
import { MemoryCache } from '@/cache/memory-cache.js';
import {
  CommandRouter,
  type RouterOptions,
} from '@/commands/router.js';
import {
  WhaNextError,
  toWhaNextError,
} from '@/errors/error.js';
import {
  Logger,
  type LogLevel,
  type LoggerConfig,
} from '@/logger/logger.js';
import type { CallEvent } from '@/models/call.js';
import type { Message } from '@/models/message.js';
import type { MuteOptions } from '@/mute/mute-store.js';
import {
  MuteService,
  type MuteEnforcement,
} from '@/mute/mute-service.js';
import { SqliteMuteStore } from '@/mute/sqlite-mute-store.js';
import { TypedEventEmitter } from '@/provider/event-emitter.js';
import type {
  ConnectionUpdate,
  WhatsAppProvider,
} from '@/provider/provider.js';
import { ChatService } from '@/services/chat-service.js';
import { GroupService } from '@/services/group-service.js';
import { MediaService } from '@/services/media-service.js';
import { MemberService } from '@/services/member-service.js';
import { MessageService } from '@/services/message-service.js';
import { UserService } from '@/services/user-service.js';

export interface AppEvents {
  message: Message;
  connection: ConnectionUpdate;
  error: WhaNextError;
  mute: MuteEnforcement;
  call: CallEvent;
}

export interface LoginOptions {
  onCode?: (code: string) => void | Promise<void>;
  timeoutMs?: number;
}

export type AppHealthStatus = 'idle' | 'starting' | 'ready' | 'stopped';

export interface AppHealth {
  status: AppHealthStatus;
  state: ConnectionUpdate['state'];
  ready: boolean;
  uptimeMs: number;
  timestamp: Date;
  muteEnabled: boolean;
  logLevel: LogLevel;
}

export interface WhaNextAppOptions {
  phone?: string;
  prefix?: string;
  cache?: CacheOptions;
  logger?: LoggerConfig;
  mute?: MuteOptions;
  router?: Omit<RouterOptions, 'prefix'>;
}

export class WhaNextApp {
  readonly message: MessageService;
  readonly media: MediaService;
  readonly group: GroupService;
  readonly member: MemberService;
  readonly chat: ChatService;
  readonly user: UserService;
  readonly mute: MuteService;
  readonly logger: Logger;
  readonly #provider: WhatsAppProvider;
  readonly #phone: string | undefined;
  readonly #events = new TypedEventEmitter<AppEvents>();
  readonly #router: CommandRouter;
  readonly #startedAt = Date.now();
  #state: ConnectionUpdate['state'] = 'idle';

  constructor(
    provider: WhatsAppProvider,
    options: WhaNextAppOptions = {},
    logger = new Logger(options.logger),
  ) {
    this.#provider = provider;
    this.#phone = options.phone;
    this.logger = logger;
    const cache = options.cache?.store ?? new MemoryCache();
    this.group = new GroupService(provider, cache, options.cache?.groupTtlMs);
    this.member = new MemberService(provider, this.group);
    this.message = new MessageService(provider);
    this.media = new MediaService(provider);
    this.chat = new ChatService(provider);
    this.user = new UserService(this.group);
    const muteEnabled = options.mute?.enabled === true || options.mute?.store !== undefined;
    const muteStore = muteEnabled
      ? options.mute?.store ?? new SqliteMuteStore(options.mute?.database)
      : undefined;
    this.mute = new MuteService(provider, muteStore);
    this.#router = new CommandRouter(this.group, {
      ...options.router,
      ...(options.prefix !== undefined ? { prefix: options.prefix } : {}),
    });
    this.#bind();
    this.logger.debug('Application initialized', {
      muteEnabled: this.mute.enabled,
      prefix: options.prefix ?? '!',
    });
  }

  get state(): ConnectionUpdate['state'] {
    return this.#state;
  }

  get isReady(): boolean {
    return this.#state === 'connected';
  }

  health(): AppHealth {
    return {
      status: this.#healthStatus(),
      state: this.#state,
      ready: this.isReady,
      uptimeMs: Date.now() - this.#startedAt,
      timestamp: new Date(),
      muteEnabled: this.mute.enabled,
      logLevel: this.logger.level,
    };
  }

  router(): CommandRouter {
    return this.#router;
  }

  on<Event extends keyof AppEvents>(
    event: Event,
    listener: (payload: AppEvents[Event]) => void | Promise<void>,
  ) {
    return this.#events.on(event, listener);
  }

  async login(options: LoginOptions = {}): Promise<void> {
    if (this.#state === 'connected') {
      return;
    }

    this.logger.info('Login started');

    let unsubscribe: () => void = () => undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const connected = new Promise<void>((resolve, reject) => {
      unsubscribe = this.#provider.on('connection', (update) => {
        if (update.state === 'connected') resolve();
        if (update.state === 'closed') {
          reject(
            new WhaNextError(
              'CONNECTION_FAILED',
              'WhatsApp closed the connection before login completed.',
              {
                cause: update.error,
                recoverable: true,
              },
            ),
          );
        }
      });

      timer = setTimeout(() => {
        reject(
          new WhaNextError(
            'CONNECTION_FAILED',
            'WhatsApp login timed out.',
            { recoverable: true },
          ),
        );
      }, options.timeoutMs ?? 300_000);
    });

    try {
      await this.#provider.connect();

      if (this.#phone) {
        const code = await this.#provider.requestPairingCode(this.#phone);

        if (code) {
          this.logger.info('Pairing code generated');

          if (options.onCode) {
            await options.onCode(code);
          }
        }
      }

      await connected;
    } finally {
      unsubscribe();
      if (timer) clearTimeout(timer);
    }
  }

  async disconnect(): Promise<void> {
    this.logger.info('Disconnecting application');

    try {
      await this.#provider.disconnect();
    } finally {
      await this.mute.close();
    }
  }

  #bind(): void {
    this.#provider.on('connection', async (update) => {
      this.#state = update.state;
      this.#logConnection(update);
      await this.#events.emit('connection', update);
    });

    this.#provider.on('groupChanged', ({ groupId }) => this.group.invalidate(groupId));

    this.#provider.on('call', async (call) => {
      this.logger.debug('Call received', {
        callId: call.id,
        from: call.from,
        status: call.status,
      });
      await this.#events.emit('call', call);
    });

    this.#provider.on('message', async (message) => {
      try {
        const enforcement = await this.mute.enforce(message);

        if (enforcement) {
          this.logger.info('Muted message deleted', {
            groupId: message.chatId,
            messageId: message.id,
            userId: message.sender.id,
          });
          await this.#events.emit('mute', enforcement);
          return;
        }
      } catch (error) {
        await this.#reportError(error, { messageId: message.id });
        return;
      }

      try {
        this.logger.debug('Message received', {
          chatId: message.chatId,
          messageId: message.id,
          senderId: message.sender.id,
        });
        await this.#events.emit('message', message);
        const dispatched = await this.#router.dispatch(message);

        if (dispatched) {
          this.logger.debug('Command dispatched', {
            chatId: message.chatId,
            messageId: message.id,
          });
        }
      } catch (error) {
        await this.#reportError(error, { messageId: message.id });
      }
    });
  }

  #healthStatus(): AppHealthStatus {
    if (this.#state === 'connected') {
      return 'ready';
    }

    if (this.#state === 'closed') {
      return 'stopped';
    }

    if (this.#state === 'connecting' || this.#state === 'reconnecting') {
      return 'starting';
    }

    return 'idle';
  }

  #logConnection(update: ConnectionUpdate): void {
    const context = {
      ...(update.attempt !== undefined ? { attempt: update.attempt } : {}),
      ...(update.error ? { error: update.error } : {}),
    };

    if (update.state === 'connected') {
      this.logger.info('WhatsApp connected');
    } else if (update.state === 'reconnecting') {
      this.logger.warn('WhatsApp reconnecting', context);
    } else if (update.state === 'closed' && update.error) {
      this.logger.warn('WhatsApp connection closed', context);
    } else if (update.state === 'closed') {
      this.logger.info('WhatsApp connection closed');
    } else {
      this.logger.debug('WhatsApp connecting', context);
    }
  }

  async #reportError(
    error: unknown,
    context: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    const normalized = toWhaNextError(error, context);
    this.logger.error(normalized.message, {
      code: normalized.code,
      ...normalized.context,
    });
    await this.#events.emit('error', normalized);
  }
}
