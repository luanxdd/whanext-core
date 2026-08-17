import { mkdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { createMediaProcessor } from '@zapo-js/media-utils';
import { createSqliteStore } from '@zapo-js/store-sqlite';
import {
  WaClient,
  createStore,
  proto,
  type Logger as ZapoLogger,
  type LogLevel as ZapoLogLevel,
  type Proto,
  type WaIncomingMessageEvent,
  type WaStore,
} from 'zapo-js';
import { Browser } from '@/auth/browser.js';
import { WhaNextError } from '@/errors/error.js';
import { Logger } from '@/logger/logger.js';
import type { CallEvent, CallStatus } from '@/models/call.js';
import type {
  GroupAccess,
  GroupParticipantAction,
  GroupParticipantsChanged,
  GroupSnapshot,
} from '@/models/group.js';
import { uniqueIdentities } from '@/models/identity.js';
import type {
  ButtonsContent,
  DownloadedMedia,
  ListContent,
  MediaSource,
  MentionTarget,
  MessageContent,
  MessageKey,
  PollContent,
  RepostMessageOptions,
  SentMessage,
} from '@/models/message.js';
import { TypedEventEmitter } from '@/provider/event-emitter.js';
import type {
  ParticipantAction,
  ParticipantUpdateResult,
  PresenceState,
  ProviderEvents,
  WhatsAppProvider,
} from '@/provider/provider.js';
import {
  extractQuotedZapoMessage,
  unwrapZapoMessageContent,
  normalizeZapoKey,
  normalizeZapoMessage,
  type ZapoMessageKeyLike,
} from '@/provider/zapo/normalize-message.js';

export interface ZapoProviderOptions {
  auth: string;
  browser: Browser;
  logger?: Logger;
  messageCacheSize?: number;
  sessionId?: string;
  processOfflineMessages?: boolean;
  reconnect?: {
    enabled?: boolean;
    maxAttempts?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
  };
}

interface SharedZapoStoreEntry {
  store: WaStore;
  snapshotDb: BetterSqliteDatabaseLike;
  snapshotUpsert: BetterSqliteStatementLike;
  snapshotGet: BetterSqliteStatementLike;
  snapshotPruneAge: BetterSqliteStatementLike;
  snapshotPruneOverflow: BetterSqliteStatementLike;
  snapshotClearSession: BetterSqliteStatementLike;
  refs: number;
  sessionRefs: Map<string, number>;
  migrationQueue: Promise<void>;
}

interface BetterSqliteStatementLike {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): unknown;
}

interface BetterSqliteDatabaseLike {
  exec(sql: string): void;
  prepare(sql: string): BetterSqliteStatementLike;
  close(): void;
}

interface BetterSqliteConstructorLike {
  new(path: string): BetterSqliteDatabaseLike;
}

interface SqliteTableRow {
  name?: unknown;
}

interface SqliteColumnRow {
  name?: unknown;
}

interface MessageSnapshotRow {
  chat_id?: unknown;
  participant_id?: unknown;
  from_me?: unknown;
  timestamp_seconds?: unknown;
  message_bytes?: unknown;
}

const require = createRequire(import.meta.url);
const sharedZapoStores = new Map<string, SharedZapoStoreEntry>();
const sharedZapoStorePromises = new Map<string, Promise<SharedZapoStoreEntry>>();
const fatalDisconnectReasons = new Set([
  'stream_error_replaced',
  'stream_error_device_removed',
  'stream_error_force_logout',
  'failure_not_authorized',
  'failure_banned',
  'failure_locked',
  'failure_client_too_old',
  'failure_bad_user_agent',
  'primary_identity_key_change',
]);
const fatalDisconnectCodes = new Set([401, 403, 405, 406, 409, 516]);
const sharedMediaProcessor = createMediaProcessor();
const messageSnapshotRetentionSeconds = 7 * 24 * 60 * 60;
const messageSnapshotMaxPerSession = 20_000;
const messageSnapshotPruneInterval = 256;

interface StoredZapoMessage {
  key: ZapoMessageKeyLike;
  message?: Proto.IMessage | null;
  timestampSeconds?: number | null;
  pushName?: string | null;
  offline?: boolean | null;
}

interface ZapoPublishResultLike {
  id?: string | null;
}

interface ZapoCredentialsLike {
  meJid?: string | null;
  meLid?: string | null;
}

interface ZapoProtocolEventLike extends StoredZapoMessage {
  protocolMessage?: {
    type?: number | null;
    key?: ZapoMessageKeyLike | null;
    editedMessage?: Proto.IMessage | null;
    timestampMs?: number | LongLike | null;
  } | null;
}

interface ZapoAddonEventLike {
  key: ZapoMessageKeyLike;
  kind?: string | null;
  targetMessageId?: string | null;
  decrypted?: unknown;
  raw?: Proto.IMessage | null;
  message?: Proto.IMessage | null;
  timestampSeconds?: number | null;
  offline?: boolean | null;
}

interface ZapoGroupEventParticipantLike {
  jid?: string | null;
  lidJid?: string | null;
  phoneJid?: string | null;
}

interface ZapoGroupEventLike {
  groupJid?: string | null;
  action?: string | null;
  authorJid?: string | null;
  participants?: readonly ZapoGroupEventParticipantLike[] | null;
}


interface ZapoCallEventLike {
  type?: string | null;
  callId?: string | null;
  callCreatorJid?: string | null;
  callerPnJid?: string | null;
  groupJid?: string | null;
  isVideo?: boolean | null;
  callerPushName?: string | null;
  timestampMs?: number | LongLike | null;
}

interface ZapoBinaryNodeLike {
  tag: string;
  attrs: Record<string, string>;
  content?: ZapoBinaryNodeLike[];
}

interface ZapoLowLevelLike {
  sendNode(node: ZapoBinaryNodeLike): Promise<void>;
}

interface ZapoGroupMetadataLike {
  jid?: string | null;
  id?: string | null;
  subject?: string | null;
  announce?: boolean | null;
  addressingMode?: string | null;
  participants?: readonly ZapoGroupParticipantLike[] | null;
}

interface ZapoGroupParticipantLike {
  jid?: string | null;
  id?: string | null;
  lid?: string | null;
  phoneNumber?: string | null;
  isAdmin?: boolean | null;
  isSuperAdmin?: boolean | null;
  admin?: string | null;
}

interface LongLike {
  toNumber?: () => number;
  low?: number;
}

type ZapoChatstateState = 'composing' | 'recording' | 'paused';

interface ZapoPresenceLike {
  sendChatstate(jid: string, value: { state: ZapoChatstateState }): Promise<void>;
}

export class ZapoProvider implements WhatsAppProvider {
  readonly #options: ZapoProviderOptions;
  readonly #events = new TypedEventEmitter<ProviderEvents>();
  readonly #logger: Logger;
  readonly #messageStore = new Map<string, StoredZapoMessage>();
  readonly #messageKeyStore = new WeakMap<MessageKey, StoredZapoMessage>();
  readonly #deliveredMessageStore = new Set<string>();
  readonly #handledProtocolStore = new Set<string>();
  readonly #callCreatorStore = new Map<string, string>();
  readonly #messageCacheSize: number;
  #protocolMutationQueue: Promise<void> = Promise.resolve();
  #client: WaClient | undefined;
  #storeEntry: SharedZapoStoreEntry | undefined;
  #storePath: string | undefined;
  #intentionalClose = false;
  #closedNotified = false;
  #reconnectAttempt = 0;
  #reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  #connectPromise: Promise<void> | undefined;
  #pairingRequired = false;
  #connected = false;
  #connectedAtSeconds = 0;
  #messageSnapshotsSincePrune = 0;
  #pairingReady: Promise<void> = Promise.resolve();
  #resolvePairingReady: (() => void) | undefined;

  constructor(options: ZapoProviderOptions) {
    this.#options = options;
    this.#logger = options.logger ?? new Logger('silent');
    this.#messageCacheSize = Math.max(1, options.messageCacheSize ?? 1_000);
  }

  on<Event extends keyof ProviderEvents>(
    event: Event,
    listener: (payload: ProviderEvents[Event]) => void | Promise<void>,
  ) {
    return this.#events.on(event, listener);
  }

  async connect(): Promise<void> {
    this.#intentionalClose = false;
    this.#closedNotified = false;
    const client = await this.#ensureClient();

    if (this.#connected || this.#connectPromise) {
      return;
    }

    this.#preparePairingGate();
    await this.#events.emit('connection', {
      state: this.#reconnectAttempt > 0 ? 'reconnecting' : 'connecting',
      attempt: this.#reconnectAttempt,
    });
    this.#startConnect(client);
  }

  async disconnect(): Promise<void> {
    this.#intentionalClose = true;

    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = undefined;
    }

    const client = this.#client;
    this.#connectPromise = undefined;

    try {
      if (client) {
        await client.disconnect();
      } else {
        await this.#emitClosedOnce();
      }
    } finally {
      this.#connected = false;
      await this.#releaseStore();
    }
  }

  getCurrentUserIds(): string[] {
    const credentials = this.#client?.getCredentials() as ZapoCredentialsLike | null | undefined;
    return uniqueIdentities([
      credentials?.meJid,
      credentials?.meLid,
    ]);
  }

  async requestPairingCode(phone: string): Promise<string> {
    const normalized = phone.replace(/\D/g, '');

    if (normalized.length < 10) {
      throw new WhaNextError(
        'AUTH_INVALID_PHONE',
        'The phone number must include its country code.',
      );
    }

    const client = await this.#ensureClient();

    if (client.getCredentials()?.meJid) {
      return '';
    }

    if (!this.#connectPromise && !this.#connected) {
      await this.connect();
    }

    try {
      if (!this.#pairingRequired) {
        await this.#withTimeout(
          this.#pairingReady,
          60_000,
          'The WhatsApp pairing challenge was not received in time.',
        );
      }

      return await client.auth.requestPairingCode(normalized);
    } catch (error) {
      if (error instanceof WhaNextError) throw error;

      throw new WhaNextError(
        'CONNECTION_FAILED',
        'Could not request the pairing code after the authentication challenge.',
        { cause: error, recoverable: true },
      );
    }
  }

  async sendMessage(
    chatId: string,
    content: MessageContent,
    replyTo?: MessageKey,
  ): Promise<SentMessage> {
    if ('buttons' in content) {
      return this.#sendButtons(chatId, content, replyTo);
    }

    if ('list' in content) {
      return this.#sendList(chatId, content, replyTo);
    }

    const client = this.#requireClient();
    const { value, mentions, viewOnce } = await this.#toContent(content);
    const result = await client.message.send(chatId, value as never, {
      ...(replyTo ? { quote: this.#toZapoKey(replyTo) } : {}),
      ...(mentions.length > 0 ? { mentions } : {}),
      ...(viewOnce !== undefined ? { viewOnce } : {}),
    });

    return this.#sent(result, chatId);
  }

  async repostMessage(
    source: MessageKey,
    chatId: string,
    options: RepostMessageOptions = {},
  ): Promise<SentMessage> {
    const original = await this.#findStoredMessage(this.#toZapoKey(source));

    if (!original?.message) {
      throw new WhaNextError(
        'MESSAGE_NOT_FOUND',
        'The source message is no longer available in the recent-message cache.',
        {
          context: { messageId: source.id, chatId: source.chatId },
          recoverable: true,
        },
      );
    }

    const result = await this.#requireClient().message.send(
      chatId,
      original.message,
      {
        forward: true,
        ...(options.mentions && options.mentions.length > 0
          ? { mentions: this.#mentions(options.mentions) }
          : {}),
      },
    );

    return this.#sent(result, chatId);
  }

  async reactToMessage(key: MessageKey, emoji?: string): Promise<SentMessage> {
    const result = await this.#requireClient().message.send(key.chatId, {
      type: 'reaction',
      emoji: emoji ?? '',
      target: this.#toZapoKey(key),
    });

    return this.#sent(result, key.chatId);
  }

  async downloadMedia(key: MessageKey): Promise<DownloadedMedia> {
    const message = this.#messageKeyStore.get(key)
      ?? await this.#findStoredMessage(this.#toZapoKey(key));

    if (!message?.message) {
      throw new WhaNextError(
        'MEDIA_NOT_AVAILABLE',
        'The media is unavailable. Download it from the received message event while it is cached.',
        { recoverable: true },
      );
    }

    const normalized = normalizeZapoMessage(message);

    if (!normalized?.media) {
      throw new WhaNextError(
        'MEDIA_NOT_AVAILABLE',
        'The selected message does not contain media.',
      );
    }

    try {
      const mediaMessage = unwrapZapoMessageContent(message.message)
        ?? message.message;
      const bytes = await this.#requireClient().message.downloadBytes(mediaMessage);

      return {
        data: Buffer.from(bytes),
        kind: normalized.media.kind,
        ...(normalized.media.mimetype ? { mimetype: normalized.media.mimetype } : {}),
        ...(normalized.media.fileName ? { fileName: normalized.media.fileName } : {}),
      };
    } catch (error) {
      throw new WhaNextError(
        'MEDIA_NOT_AVAILABLE',
        'WhatsApp could not download the selected media.',
        { cause: error, recoverable: true },
      );
    }
  }

  async editMessage(key: MessageKey, content: string): Promise<SentMessage> {
    const result = await this.#requireClient().message.send(
      key.chatId,
      content,
      { editKey: this.#toZapoKey(key) },
    );

    return this.#sent(result, key.chatId);
  }

  async deleteMessage(key: MessageKey): Promise<void> {
    await this.#requireClient().message.send(key.chatId, {
      type: 'revoke',
      target: this.#toZapoKey(key),
    });
  }

  async getGroup(groupId: string): Promise<GroupSnapshot> {
    const metadata = await this.#requireClient().group.queryGroupMetadata(groupId) as ZapoGroupMetadataLike;
    const participants = [...(metadata.participants ?? [])];
    const addressingMode = metadata.addressingMode === 'lid'
      || participants.some((participant) =>
        (participant.jid ?? participant.id ?? '').endsWith('@lid'))
      ? 'lid'
      : 'pn';

    return {
      id: metadata.jid ?? metadata.id ?? groupId,
      subject: metadata.subject ?? '',
      access: metadata.announce ? 'closed' : 'open',
      addressingMode,
      fetchedAt: new Date(),
      participants: participants.map((participant) => {
        const id = participant.jid ?? participant.id ?? participant.lid ?? participant.phoneNumber ?? '';
        return {
          id,
          ...(participant.lid ? { lid: participant.lid } : {}),
          ...(participant.phoneNumber ? { phoneNumber: participant.phoneNumber } : {}),
          role: participant.isSuperAdmin || participant.admin === 'superadmin'
            ? 'owner'
            : participant.isAdmin || participant.admin === 'admin'
              ? 'admin'
              : 'member',
        };
      }),
    };
  }

  async setGroupAccess(groupId: string, access: GroupAccess): Promise<void> {
    await this.#requireClient().group.setSetting(
      groupId,
      'announcement',
      access === 'closed',
    );
  }

  async getGroupInviteCode(groupId: string): Promise<string> {
    const code = await this.#requireClient().group.queryInviteCode(groupId);

    if (!code) {
      throw new WhaNextError(
        'PROVIDER_ERROR',
        'WhatsApp did not return a group invite code.',
      );
    }

    return code;
  }

  async revokeGroupInvite(groupId: string): Promise<string> {
    const result = await this.#requireClient().group.revokeInvite(groupId);

    if (!result.code) {
      throw new WhaNextError(
        'PROVIDER_ERROR',
        'WhatsApp did not return a new group invite code.',
      );
    }

    return result.code;
  }

  async setMessagePin(
    groupId: string,
    key: MessageKey,
    pinned: boolean,
  ): Promise<void> {
    await this.#requireClient().message.send(groupId, pinned
      ? {
          type: 'pin',
          target: this.#toZapoKey(key),
          durationSecs: 604_800,
        }
      : {
          type: 'unpin',
          target: this.#toZapoKey(key),
        });
  }

  async updateParticipant(
    groupId: string,
    memberId: string,
    action: ParticipantAction,
  ): Promise<ParticipantUpdateResult> {
    const group = this.#requireClient().group;
    const results = action === 'remove'
      ? await group.removeParticipants(groupId, [memberId])
      : action === 'promote'
        ? await group.promoteParticipants(groupId, [memberId])
        : await group.demoteParticipants(groupId, [memberId]);
    const result = results[0];
    const success = result?.status === 'ok';
    const status = success ? '200' : String(result?.code ?? result?.status ?? 'unknown');

    return {
      success,
      status,
      ...(result?.jid ? { memberId: result.jid } : {}),
    };
  }

  async setPresence(chatId: string, state: PresenceState): Promise<void> {
    const value: ZapoChatstateState = state === 'typing'
      ? 'composing'
      : state === 'recording'
        ? 'recording'
        : 'paused';
    const presence = this.#requireClient().presence as unknown as ZapoPresenceLike;

    await presence.sendChatstate(chatId, { state: value });
  }

  async rejectCall(callId: string, from: string): Promise<void> {
    const client = this.#requireClient();
    const creator = this.#callCreatorStore.get(callId) ?? from;
    if (!creator) {
      throw new WhaNextError('ARGUMENT_INVALID', 'Call creator is required to reject a call.');
    }

    const lowlevel = client.lowlevel as unknown as ZapoLowLevelLike;
    await lowlevel.sendNode({
      tag: 'call',
      attrs: { to: creator },
      content: [
        {
          tag: 'reject',
          attrs: {
            'call-id': callId,
            'call-creator': creator,
          },
        },
      ],
    });
  }

  async #ensureClient(): Promise<WaClient> {
    if (this.#client) return this.#client;

    const authPath = resolve(this.#options.auth);
    const sessionId = this.#sessionId();
    const authPathExisted = await fileExists(authPath);
    const legacyStorePath = join(authPath, 'state.sqlite');
    const canShareByDirectory = sessionId !== 'default' && basename(authPath) === sessionId;
    const storePath = canShareByDirectory
      ? join(dirname(authPath), 'state.sqlite')
      : legacyStorePath;
    const resetSharedSession = canShareByDirectory
      && !authPathExisted
      && await fileExists(storePath);

    await mkdir(authPath, { recursive: true });
    const storeEntry = await acquireSharedZapoStore(
      storePath,
      sessionId,
      legacyStorePath,
      resetSharedSession,
      this.#logger,
    );
    const client = new WaClient({
      store: storeEntry.store,
      sessionId,
      markOnlineOnConnect: false,
      deviceBrowser: this.#deviceBrowser(),
      deviceOsDisplayName: this.#deviceOsDisplayName(),
      history: { enabled: true, requireFullSync: true },
      addons: {
        autoDecrypt: true,
        persistAllSecrets: true,
      },
      media: { processor: sharedMediaProcessor },
    }, new WhaNextZapoLogger(this.#logger));

    this.#storeEntry = storeEntry;
    this.#storePath = storePath;
    this.#client = client;
    this.#bind(client);
    return client;
  }

  #bind(client: WaClient): void {
    client.on('auth_pairing_required', () => {
      this.#markPairingReady();
    });

    client.on('auth_qr', () => {
      this.#markPairingReady();
    });

    client.on('auth_paired', () => {
      this.#pairingRequired = false;
    });

    client.on('auth_passkey_required', ({ hasSigner }) => {
      if (hasSigner) return;

      const error = new WhaNextError(
        'AUTH_PASSKEY_REQUIRED',
        'WhatsApp requires a passkey assertion to link this account, but no passkey signer is configured.',
        { recoverable: false },
      );
      void this.#stopTerminalConnection(client, error);
    });

    client.on('message', (event) => {
      const protocol = this.#protocolMessage(event as unknown as ZapoProtocolEventLike);
      if (protocol && this.#isMessageMutationProtocol(protocol.type)) {
        this.#enqueueProtocolEvent({
          ...(event as unknown as ZapoProtocolEventLike),
          protocolMessage: protocol,
        });
        return;
      }

      this.#handleMessage(event);
    });

    client.on('message_send', (event) => {
      if (!event.id || !event.message) return;

      this.#remember({
        key: {
          id: event.id,
          remoteJid: event.to,
          fromMe: true,
        },
        message: event.message,
        timestampSeconds: Math.floor(Date.now() / 1_000),
      });
    });

    client.on('message_protocol', (event) => {
      this.#enqueueProtocolEvent(event as unknown as ZapoProtocolEventLike);
    });

    client.on('message_addon', (event) => {
      this.#handleAddonEvent(event as unknown as ZapoAddonEventLike);
    });

    client.on('group', (event) => {
      this.#handleGroupEvent(event as unknown as ZapoGroupEventLike);
    });

    client.on('call', (event) => {
      const call = this.#normalizeCall(event as unknown as ZapoCallEventLike);
      if (call) void this.#events.emit('call', call);
    });

    client.on('connection', (event) => {
      void this.#handleConnectionEvent(client, event);
    });
  }

  #handleMessage(event: WaIncomingMessageEvent): void {
    const stored = event as unknown as StoredZapoMessage;

    if (stored.key?.id && stored.message) this.#remember(stored);

    const quoted = extractQuotedZapoMessage(event);
    if (quoted?.key.id && quoted.message) {
      this.#remember(quoted as unknown as StoredZapoMessage);
    }

    if (this.#isOfflineMessage(stored)) {
      this.#logger.debug('Ignored message queued before the current live connection.', {
        messageId: stored.key.id ?? undefined,
        chatId: stored.key.remoteJid ?? undefined,
        timestampSeconds: stored.timestampSeconds ?? undefined,
      });
      return;
    }

    const deliveryKey = this.#messageDeliveryKey(stored.key);
    if (stored.key.id && this.#deliveredMessageStore.has(deliveryKey)) {
      this.#logger.debug('Ignored duplicate Zapo message event.', {
        messageId: stored.key.id,
        chatId: stored.key.remoteJid ?? undefined,
      });
      return;
    }

    const message = normalizeZapoMessage(event);
    if (!message) return;

    if (stored.key.id) this.#rememberDeliveredMessage(deliveryKey);
    this.#messageKeyStore.set(message.keys, stored);
    if (message.quoted && quoted?.message) {
      this.#messageKeyStore.set(
        message.quoted.key,
        quoted as unknown as StoredZapoMessage,
      );
    }

    void this.#events.emit('message', message);
  }

  #handleAddonEvent(event: ZapoAddonEventLike): void {
    const decrypted = this.#addonRecord(event.decrypted);
    const protocol = this.#addonProtocolMessage(decrypted);
    const kind = event.kind ?? this.#stringField(decrypted, 'kind') ?? this.#stringField(decrypted, 'type');
    const isEdit = kind === 'message_edit'
      || protocol?.type === proto.Message.ProtocolMessage.Type.MESSAGE_EDIT;

    if (!isEdit) return;

    const targetMessageId = event.targetMessageId
      ?? this.#stringField(decrypted, 'targetMessageId')
      ?? this.#stringField(decrypted, 'targetMessageID')
      ?? protocol?.key?.id
      ?? undefined;
    if (!targetMessageId) return;

    const editedMessage = protocol?.editedMessage ?? this.#addonEditedMessage(event.decrypted);
    if (!editedMessage) return;

    const protocolKey = protocol?.key;
    const target: ZapoMessageKeyLike = {
      ...(protocolKey ?? {}),
      id: targetMessageId,
      ...(protocolKey?.remoteJid !== undefined
        ? { remoteJid: protocolKey.remoteJid }
        : event.key.remoteJid !== undefined
          ? { remoteJid: event.key.remoteJid }
          : {}),
      ...(protocolKey?.fromMe !== undefined
        ? { fromMe: protocolKey.fromMe }
        : event.key.fromMe !== undefined
          ? { fromMe: event.key.fromMe }
          : {}),
      ...(protocolKey?.participant !== undefined
        ? { participant: protocolKey.participant }
        : event.key.participant !== undefined
          ? { participant: event.key.participant }
          : {}),
      ...(protocolKey?.participantAlt !== undefined
        ? { participantAlt: protocolKey.participantAlt }
        : event.key.participantAlt !== undefined
          ? { participantAlt: event.key.participantAlt }
          : {}),
    };

    if (event.offline === true && this.#options.processOfflineMessages !== true) {
      this.#logger.debug('Ignored offline Zapo edit addon from before the current live connection.', {
        messageId: event.key.id ?? undefined,
        targetMessageId,
        chatId: target.remoteJid ?? event.key.remoteJid ?? undefined,
      });
      return;
    }

    const mutationTimestampSeconds = toSeconds(protocol?.timestampMs)
      ?? (event.offline === true ? toSeconds(event.timestampSeconds) : undefined)
      ?? Math.floor(Date.now() / 1_000);

    this.#enqueueProtocolEvent({
      key: event.key,
      timestampSeconds: mutationTimestampSeconds,
      protocolMessage: {
        type: proto.Message.ProtocolMessage.Type.MESSAGE_EDIT,
        key: target,
        editedMessage,
        ...(protocol?.timestampMs !== undefined ? { timestampMs: protocol.timestampMs } : {}),
      },
    });
  }

  #addonRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
  }

  #stringField(record: Record<string, unknown> | undefined, field: string): string | undefined {
    const value = record?.[field];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  #addonProtocolMessage(
    record: Record<string, unknown> | undefined,
  ): ZapoProtocolEventLike['protocolMessage'] | undefined {
    const direct = record?.protocolMessage;
    if (direct && typeof direct === 'object') {
      return direct as NonNullable<ZapoProtocolEventLike['protocolMessage']>;
    }

    const message = record?.message;
    if (message && typeof message === 'object') {
      const nested = (message as Record<string, unknown>).protocolMessage;
      if (nested && typeof nested === 'object') {
        return nested as NonNullable<ZapoProtocolEventLike['protocolMessage']>;
      }
    }

    return undefined;
  }

  #addonEditedMessage(value: unknown): Proto.IMessage | undefined {
    if (!value || typeof value !== 'object') return undefined;

    const record = value as Record<string, unknown>;
    const protocol = record.protocolMessage;
    if (protocol && typeof protocol === 'object') {
      const edited = (protocol as Record<string, unknown>).editedMessage;
      if (edited && typeof edited === 'object') return edited as Proto.IMessage;
    }

    const edited = record.editedMessage;
    if (edited && typeof edited === 'object') {
      const nested = (edited as Record<string, unknown>).message;
      return (nested && typeof nested === 'object' ? nested : edited) as Proto.IMessage;
    }

    const message = record.message;
    if (message && typeof message === 'object') {
      const messageRecord = message as Record<string, unknown>;
      const nestedEdited = messageRecord.editedMessage;
      if (nestedEdited && typeof nestedEdited === 'object') {
        const nested = (nestedEdited as Record<string, unknown>).message;
        if (nested && typeof nested === 'object') return nested as Proto.IMessage;
      }
      return message as Proto.IMessage;
    }

    return value as Proto.IMessage;
  }

  #protocolMessage(event: ZapoProtocolEventLike): ZapoProtocolEventLike['protocolMessage'] | undefined {
    if (event.protocolMessage) return event.protocolMessage;

    const content = unwrapZapoMessageContent(event.message);
    return content?.protocolMessage as ZapoProtocolEventLike['protocolMessage'];
  }

  #isMessageMutationProtocol(type: number | null | undefined): boolean {
    return type === proto.Message.ProtocolMessage.Type.REVOKE
      || type === proto.Message.ProtocolMessage.Type.MESSAGE_EDIT;
  }

  #shouldIgnoreProtocolEvent(event: ZapoProtocolEventLike): boolean {
    if (this.#options.processOfflineMessages === true) return false;
    if (!this.#connected) return true;
    if (!this.#connectedAtSeconds || event.timestampSeconds == null) return false;

    const timestamp = toSeconds(event.timestampSeconds);
    if (timestamp === undefined) return false;
    return timestamp < this.#connectedAtSeconds - 3;
  }

  #enqueueProtocolEvent(event: ZapoProtocolEventLike): void {
    this.#protocolMutationQueue = this.#protocolMutationQueue
      .then(() => this.#handleProtocolEvent(event))
      .catch((error) => {
        this.#logger.debug('Could not process a Zapo protocol mutation.', {
          error: error instanceof Error ? error : new Error(String(error)),
          messageId: event.key.id ?? undefined,
        });
      });
  }

  async #handleProtocolEvent(event: ZapoProtocolEventLike): Promise<void> {
    if (this.#shouldIgnoreProtocolEvent(event)) {
      this.#logger.debug('Ignored protocol mutation from before the current live connection.', {
        messageId: event.key.id ?? undefined,
        chatId: event.key.remoteJid ?? undefined,
        timestampSeconds: event.timestampSeconds ?? undefined,
      });
      return;
    }

    const protocol = this.#protocolMessage(event);
    if (!protocol || !this.#isMessageMutationProtocol(protocol.type)) return;

    const protocolKey = protocol.key;
    if (!protocolKey?.id) {
      this.#logger.debug('Ignored Zapo protocol mutation without a target message id.', {
        messageId: event.key.id ?? undefined,
        protocolType: protocol.type ?? undefined,
      });
      return;
    }

    const remoteJid = protocolKey.remoteJid ?? event.key.remoteJid;
    const participant = protocolKey.participant ?? event.key.participant;
    const participantAlt = protocolKey.participantAlt ?? event.key.participantAlt;
    const target: ZapoMessageKeyLike = {
      ...protocolKey,
      ...(remoteJid !== undefined ? { remoteJid } : {}),
      ...(participant !== undefined ? { participant } : {}),
      ...(participantAlt !== undefined ? { participantAlt } : {}),
    };

    const stored = await this.#findStoredMessage(target);
    if (!target.remoteJid && stored?.key.remoteJid) target.remoteJid = stored.key.remoteJid;
    if (!target.remoteJid) return;

    const type = protocol.type;
    const mutationKey = this.#protocolDeliveryKey(event, target, type);

    if (mutationKey && this.#handledProtocolStore.has(mutationKey)) {
      this.#logger.debug('Ignored duplicate Zapo protocol event.', {
        messageId: event.key.id ?? undefined,
        targetMessageId: target.id ?? undefined,
      });
      return;
    }

    if (type === proto.Message.ProtocolMessage.Type.REVOKE) {
      if (mutationKey) this.#rememberHandledProtocol(mutationKey);
      const previous = stored ? normalizeZapoMessage(stored) : undefined;
      const deletedByMe = event.key.fromMe === true;
      const deletedById = event.key.participant
        ?? event.key.participantAlt
        ?? (deletedByMe ? this.getCurrentUserIds()[0] : event.key.remoteJid ?? undefined);

      if (!previous) {
        this.#logger.debug('Zapo revoke target was not present in the recent message cache.', {
          targetMessageId: target.id ?? undefined,
          chatId: target.remoteJid ?? undefined,
        });
      }

      void this.#events.emit('messageDeleted', {
        key: previous?.keys ?? normalizeZapoKey(target),
        ...(previous ? { message: previous } : {}),
        deletedByMe,
        ...(deletedById ? { deletedById } : {}),
        deletedAt: new Date(),
      });
      return;
    }

    const editedContent = protocol.editedMessage
      ? this.#unwrapEditedContent(protocol.editedMessage)
      : undefined;
    if (!editedContent) return;

    const pushName = event.pushName ?? stored?.pushName;
    const edited: StoredZapoMessage = {
      ...(stored ?? {}),
      key: {
        ...(stored?.key ?? {}),
        ...target,
      },
      message: editedContent,
      timestampSeconds: toSeconds(protocol.timestampMs)
        ?? event.timestampSeconds
        ?? stored?.timestampSeconds
        ?? Math.floor(Date.now() / 1_000),
      ...(pushName !== undefined ? { pushName } : {}),
    };
    const message = normalizeZapoMessage(edited);

    if (!message) return;

    const previous = stored ? normalizeZapoMessage(stored) : undefined;
    if (mutationKey) this.#rememberHandledProtocol(mutationKey);
    this.#remember(edited);
    const editedByMe = event.key.fromMe === true;
    const editedById = event.key.participant
      ?? event.key.participantAlt
      ?? (editedByMe ? this.getCurrentUserIds()[0] : event.key.remoteJid ?? undefined);

    if (!previous) {
      this.#logger.debug('Zapo edit target was not present in the recent message cache.', {
        targetMessageId: target.id ?? undefined,
        chatId: target.remoteJid ?? undefined,
      });
    }

    void this.#events.emit('messageEdited', {
      key: message.keys,
      ...(previous ? { previous } : {}),
      message,
      editedByMe,
      ...(editedById ? { editedById } : {}),
      editedAt: message.timestamp,
    });
  }

  #unwrapEditedContent(message: Proto.IMessage): Proto.IMessage {
    const wrapper = (message as Proto.IMessage & {
      editedMessage?: { message?: Proto.IMessage | null } | null;
    }).editedMessage;
    return wrapper?.message ?? message;
  }

  #handleGroupEvent(event: ZapoGroupEventLike): void {
    const groupId = event.groupJid;
    if (!groupId) return;

    const action = this.#groupAction(event.action);
    const participantIds = this.#groupParticipantIds(event);

    if (action && participantIds.length > 0) {
      const authorId = event.authorJid;
      const change: GroupParticipantsChanged = {
        groupId,
        action,
        participantIds,
        ...(authorId ? { authorId } : {}),
      };
      void this.#events.emit('groupParticipantsChanged', change);
    }

    void this.#events.emit('groupChanged', { groupId });
  }

  async #handleConnectionEvent(
    client: WaClient,
    event: {
      status: 'open' | 'close';
      reason?: unknown;
      code?: number | null;
      isLogout?: boolean;
    },
  ): Promise<void> {
    if (client !== this.#client) return;

    if (event.status === 'open') {
      this.#connectPromise = undefined;
      this.#connected = true;
      this.#connectedAtSeconds = Math.floor(Date.now() / 1_000);
      this.#reconnectAttempt = 0;
      this.#closedNotified = false;
      await this.#events.emit('connection', { state: 'connected' });
      return;
    }

    this.#connectPromise = undefined;
    this.#connected = false;
    const details = disconnectDetails(event.reason, event.code);
    const error = connectionError(event.reason, details);

    if (
      this.#intentionalClose
      || event.isLogout === true
      || shouldStopAutomaticReconnect(details)
    ) {
      if (!this.#intentionalClose && shouldStopAutomaticReconnect(details)) {
        this.#logger.warn('WhatsApp closed the session with a non-retryable reason.', {
          ...(details.reason ? { reason: details.reason } : {}),
          ...(details.code !== undefined ? { code: details.code } : {}),
        });
      }
      await this.#emitClosedOnce(error);
      await this.#releaseStore();
      return;
    }

    await this.#scheduleReconnect(error, reconnectDelayOverride(details));
  }

  #startConnect(client: WaClient): void {
    const promise = client.connect();
    this.#connectPromise = promise;
    void promise.catch(async (error: unknown) => {
      if (this.#connectPromise !== promise) return;
      this.#connectPromise = undefined;

      if (this.#intentionalClose) return;

      const details = disconnectDetails(error);
      const normalized = connectionError(error, details)
        ?? (error instanceof Error ? error : new Error(String(error)));
      this.#logger.warn('WhatsApp connection attempt failed.', { error: normalized });

      if (shouldStopAutomaticReconnect(details)) {
        await this.#stopTerminalConnection(client, normalized);
        return;
      }

      await this.#scheduleReconnect(normalized, reconnectDelayOverride(details));
    });
  }

  async #stopTerminalConnection(client: WaClient, error: Error): Promise<void> {
    if (client !== this.#client) return;

    this.#intentionalClose = true;
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = undefined;
    }
    this.#connectPromise = undefined;
    this.#connected = false;
    await this.#emitClosedOnce(error);

    this.#client = undefined;
    try {
      await client.disconnect();
    } catch (disconnectError) {
      this.#logger.debug('Could not close a terminal Zapo connection cleanly.', {
        error: disconnectError instanceof Error
          ? disconnectError
          : new Error(String(disconnectError)),
      });
    } finally {
      await this.#releaseStore();
    }
  }

  async #emitClosedOnce(error?: Error): Promise<void> {
    if (this.#closedNotified) return;
    this.#closedNotified = true;
    await this.#events.emit('connection', {
      state: 'closed',
      ...(error ? { error } : {}),
    });
  }

  async #releaseStore(): Promise<void> {
    const entry = this.#storeEntry;
    const storePath = this.#storePath;
    const sessionId = this.#sessionId();
    this.#storeEntry = undefined;
    this.#storePath = undefined;
    this.#client = undefined;

    if (!entry || !storePath) return;
    await releaseSharedZapoStore(storePath, sessionId, entry, this.#logger);
  }

  #sessionId(): string {
    return this.#options.sessionId ?? 'default';
  }

  async #scheduleReconnect(
    error?: Error,
    delayOverrideMs?: number,
  ): Promise<void> {
    if (this.#reconnectTimer) return;

    const options = this.#options.reconnect;
    const maxAttempts = options?.maxAttempts ?? 10;

    if (options?.enabled === false || this.#reconnectAttempt >= maxAttempts) {
      await this.#emitClosedOnce(error);
      await this.#releaseStore();
      return;
    }

    this.#reconnectAttempt += 1;
    await this.#events.emit('connection', {
      state: 'reconnecting',
      attempt: this.#reconnectAttempt,
      ...(error ? { error } : {}),
    });

    const initial = options?.initialDelayMs ?? 1_000;
    const maximum = options?.maxDelayMs ?? 30_000;
    const exponential = Math.min(maximum, initial * 2 ** (this.#reconnectAttempt - 1));
    const delay = delayOverrideMs ?? exponential;
    const jitter = delay > 0 ? Math.floor(Math.random() * 250) : 0;
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = undefined;
      void this.connect();
    }, delay + jitter);
  }

  async #sendButtons(
    chatId: string,
    content: ButtonsContent,
    replyTo?: MessageKey,
  ): Promise<SentMessage> {
    this.#validateButtons(content);
    const mentions = content.mentions ? this.#mentions(content.mentions) : [];
    const raw: Proto.IMessage = {
      interactiveMessage: {
        ...(content.title !== undefined
          ? {
              header: {
                title: content.title,
                hasMediaAttachment: false,
              },
            }
          : {}),
        body: { text: content.text },
        ...(content.footer !== undefined ? { footer: { text: content.footer } } : {}),
        ...(mentions.length > 0 ? { contextInfo: { mentionedJid: mentions } } : {}),
        nativeFlowMessage: {
          buttons: content.buttons.map((button) => {
            if (button.type === 'copy') {
              return {
                name: 'cta_copy',
                buttonParamsJson: JSON.stringify({
                  display_text: button.label,
                  copy_code: button.code,
                }),
              };
            }

            if (button.type === 'reply') {
              return {
                name: 'quick_reply',
                buttonParamsJson: JSON.stringify({
                  display_text: button.label,
                  id: button.id,
                }),
              };
            }

            return {
              name: 'cta_url',
              buttonParamsJson: JSON.stringify({
                display_text: button.label,
                url: button.url,
                merchant_url: button.url,
              }),
            };
          }),
          messageParamsJson: '{}',
          messageVersion: 1,
        },
      },
    };
    const result = await this.#requireClient().message.send(chatId, raw, {
      ...(replyTo ? { quote: this.#toZapoKey(replyTo) } : {}),
      ...(mentions.length > 0 ? { mentions } : {}),
    });

    return this.#sent(result, chatId);
  }

  async #sendList(
    chatId: string,
    content: ListContent,
    replyTo?: MessageKey,
  ): Promise<SentMessage> {
    this.#validateList(content);
    const mentions = content.mentions ? this.#mentions(content.mentions) : [];
    const raw: Proto.IMessage = {
      interactiveMessage: {
        ...(content.title !== undefined
          ? {
              header: {
                title: content.title,
                hasMediaAttachment: false,
              },
            }
          : {}),
        body: { text: content.text },
        ...(content.footer !== undefined ? { footer: { text: content.footer } } : {}),
        ...(mentions.length > 0 ? { contextInfo: { mentionedJid: mentions } } : {}),
        nativeFlowMessage: {
          buttons: [
            {
              name: 'single_select',
              buttonParamsJson: JSON.stringify({
                title: content.buttonText,
                sections: content.list.map((section) => ({
                  ...(section.title !== undefined ? { title: section.title } : {}),
                  rows: section.rows.map((row) => ({
                    id: row.id,
                    title: row.title,
                    ...(row.description !== undefined ? { description: row.description } : {}),
                  })),
                })),
              }),
            },
          ],
          messageParamsJson: '{}',
          messageVersion: 1,
        },
      },
    };
    const result = await this.#requireClient().message.send(chatId, raw, {
      ...(replyTo ? { quote: this.#toZapoKey(replyTo) } : {}),
      ...(mentions.length > 0 ? { mentions } : {}),
    });

    return this.#sent(result, chatId);
  }

  async #toContent(content: MessageContent): Promise<{
    value: unknown;
    mentions: string[];
    viewOnce?: boolean;
  }> {
    if ('text' in content) {
      return {
        value: { type: 'text', text: content.text },
        mentions: content.mentions ? this.#mentions(content.mentions) : [],
      };
    }

    if ('poll' in content) {
      return {
        value: this.#pollContent(content),
        mentions: [],
      };
    }

    if ('image' in content) {
      return {
        value: {
          type: 'image',
          media: await this.#media(content.image),
          ...(content.caption !== undefined ? { caption: content.caption } : {}),
        },
        mentions: content.mentions ? this.#mentions(content.mentions) : [],
        ...(content.viewOnce !== undefined ? { viewOnce: content.viewOnce } : {}),
      };
    }

    if ('video' in content) {
      return {
        value: {
          type: 'video',
          media: await this.#media(content.video),
          ...(content.caption !== undefined ? { caption: content.caption } : {}),
          ...(content.gif !== undefined ? { gifPlayback: content.gif } : {}),
        },
        mentions: content.mentions ? this.#mentions(content.mentions) : [],
        ...(content.viewOnce !== undefined ? { viewOnce: content.viewOnce } : {}),
      };
    }

    if ('sticker' in content) {
      return {
        value: {
          type: 'sticker',
          media: await this.#media(content.sticker),
          mimetype: 'image/webp',
        },
        mentions: [],
      };
    }

    return {
      value: {
        type: 'audio',
        media: await this.#media(content.audio),
        ...(content.mimetype ? { mimetype: content.mimetype } : {}),
        ...(content.voice !== undefined ? { ptt: content.voice } : {}),
      },
      mentions: [],
    };
  }

  #validateButtons(content: ButtonsContent): void {
    if (!content.text.trim() || content.buttons.length === 0) {
      throw new WhaNextError(
        'ARGUMENT_INVALID',
        'Interactive buttons require body text and at least one button.',
      );
    }

    for (const button of content.buttons) {
      if (!button.label.trim()) {
        throw new WhaNextError('ARGUMENT_INVALID', 'Interactive button labels cannot be empty.');
      }
      if (button.type === 'reply' && !button.id.trim()) {
        throw new WhaNextError('ARGUMENT_INVALID', 'Reply button IDs cannot be empty.');
      }
      if (button.type === 'copy' && !button.code) {
        throw new WhaNextError('ARGUMENT_INVALID', 'Copy buttons require a non-empty code.');
      }
      if (button.type === 'link' && !button.url.trim()) {
        throw new WhaNextError('ARGUMENT_INVALID', 'Link buttons require a non-empty URL.');
      }
    }
  }

  #validateList(content: ListContent): void {
    if (!content.text.trim() || !content.buttonText.trim() || content.list.length === 0) {
      throw new WhaNextError(
        'ARGUMENT_INVALID',
        'List menus require body text, button text and at least one section.',
      );
    }

    let rowCount = 0;
    const ids = new Set<string>();
    for (const section of content.list) {
      for (const row of section.rows) {
        rowCount += 1;
        const id = row.id.trim();
        if (!id || !row.title.trim()) {
          throw new WhaNextError(
            'ARGUMENT_INVALID',
            'Every list row requires a non-empty id and title.',
          );
        }
        if (ids.has(id)) {
          throw new WhaNextError(
            'ARGUMENT_INVALID',
            `Duplicate list row id "${id}".`,
          );
        }
        ids.add(id);
      }
    }

    if (rowCount === 0) {
      throw new WhaNextError('ARGUMENT_INVALID', 'List menus require at least one row.');
    }
  }

  #pollContent(content: PollContent): unknown {
    const name = content.poll.trim();
    const options = content.options.map((option) => option.trim()).filter(Boolean);
    const selectableCount = content.selectableCount ?? 1;

    if (!name || options.length < 2) {
      throw new WhaNextError(
        'ARGUMENT_INVALID',
        'Polls require a question and at least two non-empty options.',
      );
    }

    if (!Number.isInteger(selectableCount) || selectableCount < 1 || selectableCount > options.length) {
      throw new WhaNextError(
        'ARGUMENT_INVALID',
        'selectableCount must be an integer between 1 and the number of poll options.',
        { context: { selectableCount, options: options.length } },
      );
    }

    return {
      type: 'poll',
      name,
      options,
      selectableCount,
      ...(content.allowAddOption !== undefined ? { allowAddOption: content.allowAddOption } : {}),
    };
  }

  async #media(source: MediaSource): Promise<string | Uint8Array> {
    if (source instanceof Uint8Array) return source;
    if ('path' in source) return source.path;

    const response = await fetch(source.url);

    if (!response.ok) {
      throw new WhaNextError(
        'PROVIDER_ERROR',
        'Could not download the remote media source.',
        {
          context: { status: response.status },
          recoverable: response.status >= 500,
        },
      );
    }

    return new Uint8Array(await response.arrayBuffer());
  }

  #mentions(mentions: readonly MentionTarget[]): string[] {
    return mentions.map((mention) =>
      typeof mention === 'string' ? mention : mention.mentionId);
  }

  #toZapoKey(key: MessageKey): {
    id: string;
    remoteJid: string;
    fromMe: boolean;
    participant?: string;
  } {
    return {
      id: key.id,
      remoteJid: key.chatId,
      fromMe: key.fromMe,
      ...(key.participantId ? { participant: key.participantId } : {}),
    };
  }

  #sent(result: ZapoPublishResultLike, chatId: string): SentMessage {
    if (!result.id) {
      throw new WhaNextError(
        'PROVIDER_ERROR',
        'WhatsApp did not confirm the sent message.',
      );
    }

    return {
      id: result.id,
      chatId,
      keys: {
        id: result.id,
        chatId,
        fromMe: true,
      },
      timestamp: new Date(),
    };
  }


  #normalizeCall(event: ZapoCallEventLike): CallEvent | undefined {
    const id = event.callId;
    const creator = event.callCreatorJid ?? undefined;
    const from = event.callerPnJid ?? creator;
    const chatId = event.groupJid ?? from;

    if (!id || !from || !chatId) return undefined;

    if (creator) {
      this.#callCreatorStore.delete(id);
      this.#callCreatorStore.set(id, creator);
      while (this.#callCreatorStore.size > 256) {
        const oldest = this.#callCreatorStore.keys().next().value as string | undefined;
        if (!oldest) break;
        this.#callCreatorStore.delete(oldest);
      }
    }

    const timestampMs = toNumber(event.timestampMs);
    return {
      id,
      chatId,
      from,
      status: this.#callStatus(event.type),
      isVideo: event.isVideo === true,
      isGroup: Boolean(event.groupJid),
      date: timestampMs && timestampMs > 0 ? new Date(timestampMs) : new Date(),
    };
  }

  #callStatus(status: string | null | undefined): CallStatus {
    switch (status?.toLowerCase()) {
      case 'offer':
        return 'offer';
      case 'ringing':
        return 'ringing';
      case 'preaccept':
        return 'preaccept';
      case 'accept':
        return 'accept';
      case 'reject':
      case 'terminate':
        return 'reject';
      default:
        return 'timeout';
    }
  }

  #groupAction(action: string | null | undefined): GroupParticipantAction | undefined {
    const value = action?.toLowerCase() ?? '';
    if (value.includes('promote')) return 'promote';
    if (value.includes('demote')) return 'demote';
    if (value.includes('remove') || value.includes('leave')) return 'remove';
    if (value.includes('add') || value.includes('join')) return 'add';
    if (value.includes('participant') || value.includes('modify')) return 'modify';
    return undefined;
  }

  #groupParticipantIds(event: ZapoGroupEventLike): string[] {
    return uniqueIdentities((event.participants ?? []).map((participant) =>
      participant.jid ?? participant.lidJid ?? participant.phoneJid));
  }

  async #findStoredMessage(key: ZapoMessageKeyLike): Promise<StoredZapoMessage | undefined> {
    const direct = this.#messageStore.get(this.#messageStoreKey(key));
    if (direct) return direct;
    if (!key.id) return undefined;

    for (const message of this.#messageStore.values()) {
      if (message.key.id === key.id && message.message) return message;
    }

    for (const message of this.#messageStore.values()) {
      const embeddedQuoted = extractQuotedZapoMessage(message as WaIncomingMessageEvent);
      if (!embeddedQuoted?.key.id || embeddedQuoted.key.id !== key.id || !embeddedQuoted.message) {
        continue;
      }

      const storedQuoted = embeddedQuoted as unknown as StoredZapoMessage;
      this.#remember(storedQuoted);
      return storedQuoted;
    }

    return this.#readArchivedMessage(key);
  }

  #remember(message: StoredZapoMessage): void {
    if (!message.key.id || !message.message) return;

    const key = this.#messageStoreKey(message.key);
    this.#messageStore.delete(key);
    this.#messageStore.set(key, message);
    void this.#archiveMessage(message);

    while (this.#messageStore.size > this.#messageCacheSize) {
      const oldest = this.#messageStore.keys().next().value as string | undefined;
      if (oldest) this.#messageStore.delete(oldest);
    }
  }

  async #archiveMessage(message: StoredZapoMessage): Promise<void> {
    const id = message.key.id;
    const chatId = message.key.remoteJid;
    const content = message.message;
    const entry = this.#storeEntry;
    if (!id || !chatId || !content || !entry) return;

    try {
      const participantId = message.key.participant ?? message.key.participantAlt ?? null;
      const timestampSeconds = toSeconds(message.timestampSeconds) ?? null;
      const messageBytes = Buffer.from(proto.Message.encode(content).finish());
      const storedAtSeconds = Math.floor(Date.now() / 1_000);
      const sessionId = this.#sessionId();
      entry.snapshotUpsert.run(
        sessionId,
        id,
        chatId,
        participantId,
        message.key.fromMe === true ? 1 : 0,
        timestampSeconds,
        messageBytes,
        storedAtSeconds,
      );

      this.#messageSnapshotsSincePrune += 1;
      if (this.#messageSnapshotsSincePrune >= messageSnapshotPruneInterval) {
        this.#messageSnapshotsSincePrune = 0;
        entry.snapshotPruneAge.run(
          sessionId,
          storedAtSeconds - messageSnapshotRetentionSeconds,
        );
        entry.snapshotPruneOverflow.run(
          sessionId,
          sessionId,
          messageSnapshotMaxPerSession,
        );
      }
    } catch (error) {
      this.#logger.debug('Could not archive a message snapshot for mutation recovery.', {
        error: error instanceof Error ? error : new Error(String(error)),
        messageId: id,
        chatId,
      });
    }
  }

  async #readArchivedMessage(key: ZapoMessageKeyLike): Promise<StoredZapoMessage | undefined> {
    const id = key.id;
    const entry = this.#storeEntry;
    if (!id || !entry) return undefined;

    try {
      const archived = entry.snapshotGet.get(
        this.#sessionId(),
        id,
      ) as MessageSnapshotRow | undefined;
      const messageBytes = bytesField(archived?.message_bytes);
      if (!archived || !messageBytes) return undefined;

      const archivedChatId = stringValue(archived.chat_id);
      const remoteJid = key.remoteJid ?? archivedChatId;
      if (!remoteJid) return undefined;
      const participant = key.participant
        ?? key.participantAlt
        ?? stringValue(archived.participant_id);
      const archivedFromMe = booleanValue(archived.from_me);
      const timestampSeconds = numberValue(archived.timestamp_seconds);
      const fromMe = key.fromMe ?? archivedFromMe;
      const restored: StoredZapoMessage = {
        key: {
          ...key,
          id,
          remoteJid,
          ...(fromMe !== undefined ? { fromMe } : {}),
          ...(participant ? { participant } : {}),
        },
        message: proto.Message.decode(messageBytes),
        ...(timestampSeconds !== undefined ? { timestampSeconds } : {}),
      };

      const cacheKey = this.#messageStoreKey(restored.key);
      this.#messageStore.delete(cacheKey);
      this.#messageStore.set(cacheKey, restored);
      return restored;
    } catch (error) {
      this.#logger.debug('Could not restore a message snapshot for mutation recovery.', {
        error: error instanceof Error ? error : new Error(String(error)),
        messageId: id,
      });
      return undefined;
    }
  }

  #messageStoreKey(key: ZapoMessageKeyLike): string {
    return `${key.remoteJid ?? ''}:${key.id ?? ''}:${key.participant ?? key.participantAlt ?? ''}`;
  }

  #messageDeliveryKey(key: ZapoMessageKeyLike): string {
    return `${key.remoteJid ?? ''}:${key.id ?? ''}`;
  }

  #protocolDeliveryKey(
    event: ZapoProtocolEventLike,
    target: ZapoMessageKeyLike,
    type: number | null | undefined,
  ): string | undefined {
    if (type == null || !event.key.id || !target.id) return undefined;
    return `${type}:${event.key.remoteJid ?? target.remoteJid ?? ''}:${event.key.id}:${target.id}`;
  }

  #rememberHandledProtocol(key: string): void {
    this.#handledProtocolStore.delete(key);
    this.#handledProtocolStore.add(key);

    while (this.#handledProtocolStore.size > this.#messageCacheSize) {
      const oldest = this.#handledProtocolStore.values().next().value as string | undefined;
      if (oldest) this.#handledProtocolStore.delete(oldest);
    }
  }

  #rememberDeliveredMessage(key: string): void {
    this.#deliveredMessageStore.delete(key);
    this.#deliveredMessageStore.add(key);

    while (this.#deliveredMessageStore.size > this.#messageCacheSize) {
      const oldest = this.#deliveredMessageStore.values().next().value as string | undefined;
      if (oldest) this.#deliveredMessageStore.delete(oldest);
    }
  }

  #isOfflineMessage(message: StoredZapoMessage): boolean {
    if (this.#options.processOfflineMessages === true) return false;
    if (message.offline === true) return true;

    if (!this.#connected) return true;

    if (!this.#connectedAtSeconds || message.timestampSeconds == null) return false;
    const timestamp = toSeconds(message.timestampSeconds);
    if (timestamp === undefined) return false;

    return timestamp < this.#connectedAtSeconds - 3;
  }

  #markPairingReady(): void {
    this.#pairingRequired = true;
    this.#resolvePairingReady?.();
    this.#resolvePairingReady = undefined;
  }

  #preparePairingGate(): void {
    this.#pairingRequired = false;
    this.#pairingReady = new Promise<void>((resolve) => {
      this.#resolvePairingReady = resolve;
    });
  }

  #deviceBrowser(): string {
    return this.#options.browser === Browser.MacOS ? 'safari' : 'chrome';
  }

  #deviceOsDisplayName(): string {
    if (this.#options.browser === Browser.MacOS) return 'macOS';
    if (this.#options.browser === Browser.Ubuntu) return 'Ubuntu';
    return 'Windows';
  }

  #requireClient(): WaClient {
    const client = this.#client;

    if (!client || !this.#connected) {
      throw new WhaNextError(
        'CONNECTION_CLOSED',
        'WhatsApp is not connected.',
        { recoverable: true },
      );
    }

    return client;
  }

  async #withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    message: string,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new WhaNextError(
              'CONNECTION_FAILED',
              message,
              { recoverable: true },
            ));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

interface DisconnectDetails {
  reason?: string;
  code?: number;
}

function disconnectDetails(value: unknown, explicitCode?: number | null): DisconnectDetails {
  let code = typeof explicitCode === 'number' ? explicitCode : undefined;
  let reason: string | undefined;
  const queue: unknown[] = [value];
  const seen = new Set<object>();

  for (let depth = 0; queue.length > 0 && depth < 12; depth += 1) {
    const current = queue.shift();
    if (typeof current === 'string') {
      if (/^\d+$/.test(current)) {
        code ??= Number(current);
      } else {
        reason ??= current;
      }
      continue;
    }
    if (!current || typeof current !== 'object') continue;
    if (seen.has(current)) continue;
    seen.add(current);

    const record = current as Record<string, unknown>;
    const directCode = record.code;
    const statusCode = record.statusCode;
    if (typeof directCode === 'number') code ??= directCode;
    if (typeof statusCode === 'number') code ??= statusCode;

    const directReason = record.reason;
    const failureReason = record.failureReason;
    if (typeof directReason === 'string') {
      if (/^\d+$/.test(directReason)) code ??= Number(directReason);
      else reason ??= directReason;
    }
    if (typeof failureReason === 'string') reason ??= failureReason;

    const output = record.output;
    const data = record.data;
    if (output && typeof output === 'object') queue.push(output);
    if (data && typeof data === 'object') queue.push(data);
    if (record.cause !== undefined) queue.push(record.cause);
  }

  return {
    ...(reason ? { reason } : {}),
    ...(code !== undefined ? { code } : {}),
  };
}

function shouldStopAutomaticReconnect(details: DisconnectDetails): boolean {
  if (details.reason === 'client_disconnected') return true;
  if (details.reason && fatalDisconnectReasons.has(details.reason)) return true;
  return details.code !== undefined && fatalDisconnectCodes.has(details.code);
}

function reconnectDelayOverride(details: DisconnectDetails): number | undefined {
  if (details.code === 515) return 0;
  if (details.code === 402) return 60_000;
  return undefined;
}

function connectionError(value: unknown, details: DisconnectDetails): Error | undefined {
  if (value === undefined && details.code === undefined && details.reason === undefined) {
    return undefined;
  }

  const authExpired = details.code === 401
    || details.code === 516
    || details.reason === 'failure_not_authorized'
    || details.reason === 'stream_error_device_removed'
    || details.reason === 'stream_error_force_logout'
    || details.reason === 'primary_identity_key_change';
  const cause = value instanceof Error
    ? value
    : details.code !== undefined
      ? {
          output: { statusCode: details.code },
          data: { reason: String(details.code) },
          ...(value !== undefined ? { cause: value } : {}),
        }
      : value;
  const message = authExpired
    ? 'WhatsApp authorization is no longer valid and the account must be paired again.'
    : details.code === 402
      ? 'WhatsApp temporarily refused this session. The next reconnect will use an extended backoff.'
      : 'WhatsApp closed the connection.';

  return new WhaNextError(
    authExpired ? 'AUTH_EXPIRED' : 'CONNECTION_FAILED',
    message,
    {
      ...(cause !== undefined ? { cause } : {}),
      context: {
        ...(details.reason ? { reason: details.reason } : {}),
        ...(details.code !== undefined ? { statusCode: details.code } : {}),
      },
      recoverable: details.code === 402
        || details.code === 500
        || details.code === 503
        || details.code === 515,
    },
  );
}

async function acquireSharedZapoStore(
  storePath: string,
  sessionId: string,
  legacyStorePath: string,
  resetSession: boolean,
  logger: Logger,
): Promise<SharedZapoStoreEntry> {
  if (storePath === legacyStorePath) {
    const entry = createZapoStoreEntry(storePath);
    entry.refs = 1;
    entry.sessionRefs.set(sessionId, 1);
    return entry;
  }

  let pending = sharedZapoStorePromises.get(storePath);

  if (!pending) {
    pending = (async () => {
      await mkdir(dirname(storePath), { recursive: true });
      const entry = createZapoStoreEntry(storePath);
      sharedZapoStores.set(storePath, entry);
      return entry;
    })();
    sharedZapoStorePromises.set(storePath, pending);
  }

  let entry: SharedZapoStoreEntry;
  try {
    entry = await pending;
  } catch (error) {
    if (sharedZapoStorePromises.get(storePath) === pending) {
      sharedZapoStorePromises.delete(storePath);
    }
    throw error;
  }

  entry.refs += 1;
  entry.sessionRefs.set(sessionId, (entry.sessionRefs.get(sessionId) ?? 0) + 1);

  if (resetSession || await fileExists(legacyStorePath)) {
    entry.migrationQueue = entry.migrationQueue.then(async () => {
      if (resetSession) {
        clearZapoSessionData(storePath, sessionId);
        entry.snapshotClearSession.run(sessionId);
      }
      if (await fileExists(legacyStorePath)) {
        await migrateLegacyZapoStore(storePath, legacyStorePath, sessionId, logger);
      }
    });
    await entry.migrationQueue;
  }

  return entry;
}

function createZapoStoreEntry(storePath: string): SharedZapoStoreEntry {
  const store = createStore({
    backends: {
      sqlite: createSqliteStore({
        path: storePath,
        driver: 'auto',
      }),
    },
    providers: {
      auth: 'sqlite',
      signal: 'sqlite',
      preKey: 'sqlite',
      session: 'sqlite',
      identity: 'sqlite',
      senderKey: 'sqlite',
      appState: 'sqlite',
      privacyToken: 'sqlite',
      messages: 'sqlite',
      threads: 'sqlite',
      contacts: 'sqlite',
    },
    cacheProviders: {
      messageSecret: 'sqlite',
    },
  });

  const Database = require('better-sqlite3') as BetterSqliteConstructorLike;
  const snapshotDb = new Database(messageSnapshotStorePath(storePath));
  snapshotDb.exec(`
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS whanext_message_snapshots (
      session_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      participant_id TEXT,
      from_me INTEGER NOT NULL,
      timestamp_seconds INTEGER,
      message_bytes BLOB NOT NULL,
      stored_at_seconds INTEGER NOT NULL,
      PRIMARY KEY (session_id, message_id)
    );
    CREATE INDEX IF NOT EXISTS idx_whanext_message_snapshots_chat
      ON whanext_message_snapshots (session_id, chat_id);
  `);

  const snapshotColumns = snapshotDb.prepare(
    'PRAGMA table_info(whanext_message_snapshots)',
  ).all()
    .map((column) => stringField(column as SqliteColumnRow, 'name'))
    .filter((name): name is string => name !== undefined);
  if (!snapshotColumns.includes('stored_at_seconds')) {
    snapshotDb.exec(
      'ALTER TABLE whanext_message_snapshots ADD COLUMN stored_at_seconds INTEGER NOT NULL DEFAULT 0',
    );
  }
  snapshotDb.exec(`
    CREATE INDEX IF NOT EXISTS idx_whanext_message_snapshots_retention
      ON whanext_message_snapshots (session_id, stored_at_seconds);
  `);

  return {
    store,
    snapshotDb,
    snapshotUpsert: snapshotDb.prepare(`
      INSERT INTO whanext_message_snapshots (
        session_id, message_id, chat_id, participant_id, from_me,
        timestamp_seconds, message_bytes, stored_at_seconds
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, message_id) DO UPDATE SET
        chat_id = excluded.chat_id,
        participant_id = excluded.participant_id,
        from_me = excluded.from_me,
        timestamp_seconds = excluded.timestamp_seconds,
        message_bytes = excluded.message_bytes,
        stored_at_seconds = excluded.stored_at_seconds
    `),
    snapshotGet: snapshotDb.prepare(`
      SELECT chat_id, participant_id, from_me, timestamp_seconds, message_bytes
      FROM whanext_message_snapshots
      WHERE session_id = ? AND message_id = ?
      LIMIT 1
    `),
    snapshotPruneAge: snapshotDb.prepare(`
      DELETE FROM whanext_message_snapshots
      WHERE session_id = ? AND stored_at_seconds < ?
    `),
    snapshotPruneOverflow: snapshotDb.prepare(`
      DELETE FROM whanext_message_snapshots
      WHERE session_id = ?
        AND message_id IN (
          SELECT message_id
          FROM whanext_message_snapshots
          WHERE session_id = ?
          ORDER BY stored_at_seconds DESC
          LIMIT -1 OFFSET ?
        )
    `),
    snapshotClearSession: snapshotDb.prepare(`
      DELETE FROM whanext_message_snapshots
      WHERE session_id = ?
    `),
    refs: 0,
    sessionRefs: new Map<string, number>(),
    migrationQueue: Promise.resolve(),
  };
}

function messageSnapshotStorePath(storePath: string): string {
  return join(dirname(storePath), 'whanext-messages.sqlite');
}

async function releaseSharedZapoStore(
  storePath: string,
  sessionId: string,
  entry: SharedZapoStoreEntry,
  logger: Logger,
): Promise<void> {
  const currentSessionRefs = entry.sessionRefs.get(sessionId) ?? 0;
  if (currentSessionRefs <= 1) {
    entry.sessionRefs.delete(sessionId);
    try {
      await entry.store.session(sessionId).destroy();
    } catch (error) {
      logger.warn('Could not release the Zapo session store cleanly.', {
        error: error instanceof Error ? error : new Error(String(error)),
        sessionId,
      });
    }
  } else {
    entry.sessionRefs.set(sessionId, currentSessionRefs - 1);
  }

  entry.refs = Math.max(0, entry.refs - 1);
  if (entry.refs > 0) return;

  if (sharedZapoStores.get(storePath) === entry) {
    sharedZapoStores.delete(storePath);
    sharedZapoStorePromises.delete(storePath);
  }

  try {
    await entry.store.destroy();
  } catch (error) {
    logger.warn('Could not close the shared Zapo store cleanly.', {
      error: error instanceof Error ? error : new Error(String(error)),
      storePath,
    });
  } finally {
    try {
      entry.snapshotDb.close();
    } catch (error) {
      logger.debug('Could not close the WhaNext message snapshot database cleanly.', {
        error: error instanceof Error ? error : new Error(String(error)),
        storePath,
      });
    }
  }
}

function clearZapoSessionData(
  storePath: string,
  sessionId: string,
): void {
  let db: BetterSqliteDatabaseLike | undefined;

  try {
    const Database = require('better-sqlite3') as BetterSqliteConstructorLike;
    db = new Database(storePath);
    const tables = db.prepare(
      "SELECT name FROM main.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    ).all();

    db.exec('BEGIN IMMEDIATE');
    try {
      for (const row of tables) {
        const table = stringField(row as SqliteTableRow, 'name');
        if (!table || table === 'wa_migrations' || table === 'whanext_core_migrations') {
          continue;
        }

        const quoted = sqliteIdentifier(table);
        const columns = db.prepare(`PRAGMA main.table_info(${quoted})`).all()
          .map((column) => stringField(column as SqliteColumnRow, 'name'))
          .filter((name): name is string => name !== undefined);
        if (!columns.includes('session_id')) continue;

        db.prepare(`DELETE FROM main.${quoted} WHERE session_id = ?`).run(sessionId);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db?.close();
  }
}

async function migrateLegacyZapoStore(
  storePath: string,
  legacyStorePath: string,
  sessionId: string,
  logger: Logger,
): Promise<void> {
  let db: BetterSqliteDatabaseLike | undefined;

  try {
    const Database = require('better-sqlite3') as BetterSqliteConstructorLike;
    db = new Database(storePath);
    db.exec(`ATTACH DATABASE ${sqliteString(legacyStorePath)} AS legacy`);
    db.exec(`
      CREATE TABLE IF NOT EXISTS whanext_core_migrations (
        migration_key TEXT PRIMARY KEY,
        migrated_at INTEGER NOT NULL
      )
    `);

    const migrationKey = `shared-store:${resolve(legacyStorePath)}:${sessionId}`;
    const migrated = db.prepare(
      'SELECT migration_key FROM whanext_core_migrations WHERE migration_key = ?',
    ).get(migrationKey);
    if (migrated) return;

    const mainTables = new Set(
      db.prepare("SELECT name FROM main.sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => stringField(row as SqliteTableRow, 'name'))
        .filter((name): name is string => name !== undefined),
    );
    const legacyTables = db.prepare(
      "SELECT name FROM legacy.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    ).all();

    db.exec('BEGIN IMMEDIATE');
    try {
      for (const row of legacyTables) {
        const table = stringField(row as SqliteTableRow, 'name');
        if (!table || !mainTables.has(table) || table === 'wa_migrations' || table === 'whanext_core_migrations') {
          continue;
        }

        const quoted = sqliteIdentifier(table);
        const mainColumns = db.prepare(`PRAGMA main.table_info(${quoted})`).all()
          .map((column) => stringField(column as SqliteColumnRow, 'name'))
          .filter((name): name is string => name !== undefined);
        const legacyColumns = new Set(
          db.prepare(`PRAGMA legacy.table_info(${quoted})`).all()
            .map((column) => stringField(column as SqliteColumnRow, 'name'))
            .filter((name): name is string => name !== undefined),
        );
        const columns = mainColumns.filter((column) => legacyColumns.has(column));
        if (!columns.includes('session_id') || columns.length === 0) continue;

        const selected = columns.map(sqliteIdentifier).join(', ');
        db.prepare(
          `INSERT OR REPLACE INTO main.${quoted} (${selected}) SELECT ${selected} FROM legacy.${quoted} WHERE session_id = ?`,
        ).run(sessionId);
      }

      db.prepare(
        'INSERT OR REPLACE INTO whanext_core_migrations (migration_key, migrated_at) VALUES (?, ?)',
      ).run(migrationKey, Date.now());
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } catch (error) {
    logger.warn('Could not migrate the legacy per-account Zapo store; keeping the shared store active.', {
      error: error instanceof Error ? error : new Error(String(error)),
      sessionId,
      legacyStorePath,
      storePath,
    });
  } finally {
    if (db) {
      try {
        db.exec('DETACH DATABASE legacy');
      } catch {}
      db.close();
    }
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function sqliteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function sqliteString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function stringField(record: SqliteTableRow | SqliteColumnRow, field: 'name'): string | undefined {
  const value = record[field];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  return undefined;
}

function bytesField(value: unknown): Uint8Array | undefined {
  if (value instanceof Uint8Array) return value;
  return undefined;
}


class WhaNextZapoLogger implements ZapoLogger {
  readonly level: ZapoLogLevel;
  readonly #logger: Logger;
  readonly #context: Readonly<Record<string, unknown>>;

  constructor(
    logger: Logger,
    context: Readonly<Record<string, unknown>> = {},
  ) {
    this.#logger = logger;
    this.#context = context;
    this.level = logger.level === 'debug'
      ? 'debug'
      : logger.level === 'warn'
        ? 'warn'
        : logger.level === 'error' || logger.level === 'silent'
          ? 'error'
          : 'info';
  }

  trace(message: string, context?: Readonly<Record<string, unknown>>): void {
    this.#logger.debug(message, this.#merge(context));
  }

  debug(message: string, context?: Readonly<Record<string, unknown>>): void {
    this.#logger.debug(message, this.#merge(context));
  }

  info(message: string, context?: Readonly<Record<string, unknown>>): void {
    this.#logger.info(message, this.#merge(context));
  }

  warn(message: string, context?: Readonly<Record<string, unknown>>): void {
    this.#logger.warn(message, this.#merge(context));
  }

  error(message: string, context?: Readonly<Record<string, unknown>>): void {
    this.#logger.error(message, this.#merge(context));
  }

  child(bindings: Readonly<Record<string, unknown>>): ZapoLogger {
    return new WhaNextZapoLogger(this.#logger, {
      ...this.#context,
      ...bindings,
    });
  }

  #merge(
    context?: Readonly<Record<string, unknown>>,
  ): Readonly<Record<string, unknown>> {
    return context
      ? { ...this.#context, ...context }
      : this.#context;
  }
}

function toNumber(value: number | LongLike | null | undefined): number | undefined {
  if (typeof value === 'number') return value;
  if (value?.toNumber) return value.toNumber();
  if (typeof value?.low === 'number') return value.low;
  return undefined;
}

function toSeconds(value: number | LongLike | null | undefined): number | undefined {
  const raw = typeof value === 'number'
    ? value
    : value?.toNumber
      ? value.toNumber()
      : value?.low;

  if (raw === undefined) return undefined;
  return raw > 10_000_000_000 ? Math.floor(raw / 1_000) : raw;
}
