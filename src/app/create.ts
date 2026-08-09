import { WhaNextApp } from '@/app/whanext-app.js';
import { Browser } from '@/auth/browser.js';
import type { CacheOptions } from '@/cache/cache-store.js';
import type { RouterOptions } from '@/commands/router.js';
import {
  Logger,
  type LoggerConfig,
} from '@/logger/logger.js';
import type { MuteOptions } from '@/mute/mute-store.js';
import { BaileysProvider } from '@/provider/baileys/baileys-provider.js';
import type { WhatsAppProvider } from '@/provider/provider.js';

export interface ReconnectOptions {
  enabled?: boolean;
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
}

export interface CreateOptions {
  phone?: string;
  browser?: Browser;
  auth?: string;
  prefix?: string;
  cache?: CacheOptions;
  logger?: LoggerConfig;
  mute?: MuteOptions;
  router?: Omit<RouterOptions, 'prefix'>;
  reconnect?: ReconnectOptions;
  messageCacheSize?: number;
  provider?: WhatsAppProvider;
  accountId?: string;
}

export async function create(options: CreateOptions = {}): Promise<WhaNextApp> {
  const logger = new Logger(options.logger);
  const provider = options.provider ?? new BaileysProvider({
    auth: options.auth ?? './session',
    browser: options.browser ?? Browser.Windows,
    logger: logger.child('provider'),
    ...(options.messageCacheSize !== undefined
      ? { messageCacheSize: options.messageCacheSize }
      : {}),
    groupMetadataCache: {
      ...(options.cache?.groupTtlMs !== undefined
        ? { ttlMs: options.cache.groupTtlMs }
        : {}),
      ...(options.cache?.memoryMaxEntries !== undefined
        ? { maxEntries: options.cache.memoryMaxEntries }
        : {}),
    },
    ...(options.reconnect ? { reconnect: options.reconnect } : {}),
  });

  return new WhaNextApp(provider, {
    ...(options.accountId ? { accountId: options.accountId } : {}),
    ...(options.phone ? { phone: options.phone } : {}),
    ...(options.prefix !== undefined ? { prefix: options.prefix } : {}),
    ...(options.cache ? { cache: options.cache } : {}),
    ...(options.logger ? { logger: options.logger } : {}),
    ...(options.mute ? { mute: options.mute } : {}),
    ...(options.router ? { router: options.router } : {}),
  }, logger);
}
