import { WhaNextError } from '@/errors/error.js';
import { normalizeIdentity } from '@/models/identity.js';
import type { Message } from '@/models/message.js';
import { User } from '@/models/user.js';
import type {
  MuteStore,
  StoredMute,
} from '@/mute/mute-store.js';
import type { WhatsAppProvider } from '@/provider/provider.js';

export interface AddMuteOptions {
  durationMs?: number;
}

export interface MuteRecord {
  groupId: string;
  user: User;
  createdAt: Date;
  expiresAt: Date | null;
}

export type AddMuteResult =
  | {
      ok: true;
      changed: true;
      state: 'muted' | 'updated';
      record: MuteRecord;
    }
  | {
      ok: true;
      changed: false;
      state: 'already_muted';
      record: MuteRecord;
    };

export type RemoveMuteResult =
  | {
      ok: true;
      changed: true;
      state: 'unmuted';
    }
  | {
      ok: true;
      changed: false;
      state: 'already_unmuted';
    };

export type MuteChangeResult = AddMuteResult | RemoveMuteResult;

export interface MuteEnforcement {
  message: Message;
  record: MuteRecord;
}

export class MuteService {
  readonly #provider: WhatsAppProvider;
  readonly #store: MuteStore | undefined;

  constructor(provider: WhatsAppProvider, store?: MuteStore) {
    this.#provider = provider;
    this.#store = store;
  }

  get enabled(): boolean {
    return this.#store !== undefined;
  }

  async add(
    groupId: string,
    user: User,
    options: AddMuteOptions = {},
  ): Promise<AddMuteResult> {
    const store = this.#requireStore();
    const now = Date.now();

    if (options.durationMs !== undefined && options.durationMs <= 0) {
      throw new WhaNextError('ARGUMENT_INVALID', 'Mute duration must be greater than zero.');
    }

    const current = await this.#findActive(groupId, user.identities);

    if (current && current.expiresAt === null && options.durationMs === undefined) {
      return {
        ok: true,
        changed: false,
        state: 'already_muted',
        record: this.#record(current),
      };
    }

    const stored: StoredMute = {
      key: normalizeIdentity(user.id),
      groupId,
      user: user.toJSON(),
      identities: user.identities,
      createdAt: now,
      expiresAt: options.durationMs === undefined ? null : now + options.durationMs,
    };
    await this.#storage(
      'upsert',
      () => store.upsert(stored),
      { groupId, userId: user.id },
    );
    return {
      ok: true,
      changed: true,
      state: current ? 'updated' : 'muted',
      record: this.#record(stored),
    };
  }

  async remove(groupId: string, user: User): Promise<RemoveMuteResult> {
    const store = this.#requireStore();
    const changed = await this.#storage(
      'delete',
      () => store.delete(groupId, user.identities),
      { groupId, userId: user.id },
    );

    if (changed) {
      return {
        ok: true,
        changed: true,
        state: 'unmuted',
      };
    }

    return {
      ok: true,
      changed: false,
      state: 'already_unmuted',
    };
  }

  async get(groupId: string, user: User): Promise<MuteRecord | undefined> {
    this.#requireStore();
    const stored = await this.#findActive(groupId, user.identities);
    return stored ? this.#record(stored) : undefined;
  }

  async isMuted(groupId: string, user: User): Promise<boolean> {
    return (await this.get(groupId, user)) !== undefined;
  }

  async enforce(message: Message): Promise<MuteEnforcement | undefined> {
    if (!this.#store || !message.isGroup || message.keys.fromMe) {
      return undefined;
    }

    const stored = await this.#findActive(message.chatId, message.sender.identities);

    if (!stored) {
      return undefined;
    }

    try {
      await this.#provider.deleteMessage(message.keys);
    } catch (error) {
      throw new WhaNextError(
        'PROVIDER_ERROR',
        'Could not delete a message sent by a muted member.',
        {
          cause: error,
          context: {
            groupId: message.chatId,
            messageId: message.id,
            userId: message.sender.id,
          },
          recoverable: true,
        },
      );
    }

    return {
      message,
      record: this.#record(stored),
    };
  }

  async purgeExpired(): Promise<number> {
    const store = this.#requireStore();
    return this.#storage(
      'purge',
      () => store.purgeExpired(Date.now()),
    );
  }

  async close(): Promise<void> {
    if (this.#store?.close) {
      await this.#storage('close', () => this.#store?.close?.());
    }
  }

  #record(stored: StoredMute): MuteRecord {
    return {
      groupId: stored.groupId,
      user: new User(stored.user),
      createdAt: new Date(stored.createdAt),
      expiresAt: stored.expiresAt === null ? null : new Date(stored.expiresAt),
    };
  }

  async #findActive(
    groupId: string,
    identities: readonly string[],
  ): Promise<StoredMute | undefined> {
    const stored = await this.#storage(
      'find',
      () => this.#store?.find(groupId, identities),
      { groupId },
    );

    if (!stored) {
      return undefined;
    }

    if (stored.expiresAt !== null && stored.expiresAt <= Date.now()) {
      await this.#storage(
        'delete_expired',
        () => this.#store?.delete(groupId, stored.identities),
        { groupId },
      );
      return undefined;
    }

    return stored;
  }

  #requireStore(): MuteStore {
    if (!this.#store) {
      throw new WhaNextError(
        'MUTE_DISABLED',
        'Mute is disabled. Enable it in create({ mute: { enabled: true } }).',
      );
    }

    return this.#store;
  }

  async #storage<Result>(
    action: string,
    operation: () => Result | Promise<Result>,
    context: Readonly<Record<string, unknown>> = {},
  ): Promise<Result> {
    try {
      return await operation();
    } catch (error) {
      throw new WhaNextError(
        'STORAGE_ERROR',
        `Mute storage operation "${action}" failed.`,
        {
          cause: error,
          context: { action, ...context },
          recoverable: true,
        },
      );
    }
  }
}
