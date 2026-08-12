import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createMediaProcessor } from '@zapo-js/media-utils';
import { createSqliteStore } from '@zapo-js/store-sqlite';
import type { voipPlugin as ZapoVoipPluginFactory } from '@zapo-js/voip';
import {
  WaClient,
  createStore,
  proto,
  type Logger as ZapoLogger,
  type LogLevel as ZapoLogLevel,
  type Proto,
  type WaIncomingMessageEvent,
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
  MediaSource,
  MentionTarget,
  MessageContent,
  MessageKey,
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


interface ZapoVoipCallLike {
  callId?: string | null;
  peerJid?: string | null;
  callCreator?: string | null;
  callerPn?: string | null;
  groupJid?: string | null;
  mediaType?: string | null;
  createdAt?: Date | null;
  stateData?: {
    state?: string | null;
    endReason?: string | null;
  } | null;
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

type ZapoVoipPlugin = ReturnType<typeof ZapoVoipPluginFactory>;
type ZapoChatstateState = 'composing' | 'recording' | 'paused';

interface ZapoPresenceLike {
  sendChatstate(jid: string, value: { state: ZapoChatstateState }): Promise<void>;
}

interface ZapoVoipCoordinatorLike {
  rejectCall(callId: string): Promise<void>;
}

interface ZapoVoipEventClient {
  on(
    event: 'voip_call_incoming' | 'voip_call_state' | 'voip_call_ended',
    listener: (event: ZapoVoipCallLike) => void,
  ): unknown;
}

export class ZapoProvider implements WhatsAppProvider {
  readonly #options: ZapoProviderOptions;
  readonly #events = new TypedEventEmitter<ProviderEvents>();
  readonly #logger: Logger;
  readonly #messageStore = new Map<string, StoredZapoMessage>();
  readonly #messageCacheSize: number;
  #client: WaClient | undefined;
  #voip: ZapoVoipCoordinatorLike | undefined;
  #intentionalClose = false;
  #reconnectAttempt = 0;
  #reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  #connectPromise: Promise<void> | undefined;
  #pairingRequired = false;
  #connected = false;
  #connectedAtSeconds = 0;
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

    if (client) {
      await client.disconnect();
    } else {
      await this.#events.emit('connection', { state: 'closed' });
    }

    this.#connected = false;
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
    const original = this.#findStoredMessage(this.#toZapoKey(source));

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
    const message = this.#findStoredMessage(this.#toZapoKey(key));

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
      const bytes = await this.#requireClient().message.downloadBytes(
        message as WaIncomingMessageEvent,
      );

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

  async rejectCall(callId: string, _from: string): Promise<void> {
    this.#requireClient();

    if (!this.#voip) {
      throw new WhaNextError(
        'PROVIDER_ERROR',
        'WhatsApp call support is unavailable because the Zapo VoIP plugin could not be loaded.',
        { recoverable: true },
      );
    }

    await this.#voip.rejectCall(callId);
  }

  async #ensureClient(): Promise<WaClient> {
    if (this.#client) return this.#client;

    await mkdir(this.#options.auth, { recursive: true });
    const store = createStore({
      backends: {
        sqlite: createSqliteStore({
          path: join(this.#options.auth, 'state.sqlite'),
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
        messages: 'none',
        threads: 'none',
        contacts: 'none',
      },
      cacheProviders: {
        messageSecret: 'sqlite',
      },
    });
    const plugins: ZapoVoipPlugin[] = [];

    try {
      const { voipPlugin } = await import('@zapo-js/voip');
      plugins.push(voipPlugin({ logLevel: 'warn' }));
    } catch (error) {
      this.#logger.warn('Zapo VoIP support is unavailable; call events and rejection are disabled.', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const client = new WaClient({
      store,
      sessionId: this.#options.sessionId ?? 'default',
      markOnlineOnConnect: false,
      deviceBrowser: this.#deviceBrowser(),
      deviceOsDisplayName: this.#deviceOsDisplayName(),
      history: { enabled: false },
      addons: {
        autoDecrypt: true,
        persistAllSecrets: true,
      },
      media: { processor: createMediaProcessor() },
      plugins,
    }, new WhaNextZapoLogger(this.#logger));

    this.#client = client;
    this.#voip = (client as unknown as { voip?: ZapoVoipCoordinatorLike }).voip;
    this.#bind(client);
    return client;
  }

  #bind(client: WaClient): void {
    client.on('auth_pairing_required', () => {
      this.#pairingRequired = true;
      this.#resolvePairingReady?.();
      this.#resolvePairingReady = undefined;
    });

    client.on('auth_paired', () => {
      this.#pairingRequired = false;
    });

    client.on('message', (event) => {
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
      this.#handleProtocolEvent(event as unknown as ZapoProtocolEventLike);
    });

    client.on('group', (event) => {
      this.#handleGroupEvent(event as unknown as ZapoGroupEventLike);
    });

    if (this.#voip) {
      const voipClient = client as unknown as ZapoVoipEventClient;

      voipClient.on('voip_call_incoming', (event) => {
        const call = this.#normalizeVoipCall(event, 'offer');
        if (call) void this.#events.emit('call', call);
      });

      voipClient.on('voip_call_state', (event) => {
        if (event.stateData?.state === 'ended') return;

        const call = this.#normalizeVoipCall(event);
        if (call && call.status !== 'offer') void this.#events.emit('call', call);
      });

      voipClient.on('voip_call_ended', (event) => {
        const call = this.#normalizeVoipCall(
          event,
          this.#callEndStatus(event.stateData?.endReason),
        );
        if (call) void this.#events.emit('call', call);
      });
    }

    client.on('connection', (event) => {
      void this.#handleConnectionEvent(client, event);
    });
  }

  #handleMessage(event: WaIncomingMessageEvent): void {
    const stored = event as unknown as StoredZapoMessage;

    if (this.#isOfflineMessage(stored)) {
      this.#logger.debug('Ignored message queued before the current connection.', {
        messageId: stored.key.id ?? undefined,
        chatId: stored.key.remoteJid ?? undefined,
        timestampSeconds: stored.timestampSeconds ?? undefined,
      });
      return;
    }

    if (stored.key?.id && stored.message) this.#remember(stored);

    const quoted = extractQuotedZapoMessage(event);
    if (quoted) {
      const quotedStored = quoted as unknown as StoredZapoMessage;
      if (quotedStored.key?.id && quotedStored.message) this.#remember(quotedStored);
    }

    const message = normalizeZapoMessage(event);
    if (message) void this.#events.emit('message', message);
  }

  #handleProtocolEvent(event: ZapoProtocolEventLike): void {
    const protocol = event.protocolMessage
      ?? (event.message?.protocolMessage as ZapoProtocolEventLike['protocolMessage']);
    if (!protocol) return;

    const protocolKey = protocol.key;
    if (!protocolKey?.id) return;

    const remoteJid = protocolKey.remoteJid ?? event.key.remoteJid;
    const participant = protocolKey.participant ?? event.key.participant;
    const participantAlt = protocolKey.participantAlt ?? event.key.participantAlt;
    const target: ZapoMessageKeyLike = {
      ...protocolKey,
      ...(remoteJid !== undefined ? { remoteJid } : {}),
      ...(participant !== undefined ? { participant } : {}),
      ...(participantAlt !== undefined ? { participantAlt } : {}),
    };

    if (!target.remoteJid) return;

    const stored = this.#findStoredMessage(target);
    const type = protocol?.type;

    if (type === proto.Message.ProtocolMessage.Type.REVOKE) {
      const previous = stored ? normalizeZapoMessage(stored) : undefined;
      const deletedByMe = event.key.fromMe === true;
      const deletedById = event.key.participant
        ?? event.key.participantAlt
        ?? (deletedByMe ? this.getCurrentUserIds()[0] : event.key.remoteJid ?? undefined);

      void this.#events.emit('messageDeleted', {
        key: previous?.keys ?? normalizeZapoKey(target),
        ...(previous ? { message: previous } : {}),
        deletedByMe,
        ...(deletedById ? { deletedById } : {}),
        deletedAt: new Date(),
      });
      return;
    }

    if (type !== proto.Message.ProtocolMessage.Type.MESSAGE_EDIT || !protocol.editedMessage) {
      return;
    }

    const pushName = event.pushName ?? stored?.pushName;
    const edited: StoredZapoMessage = {
      ...(stored ?? {}),
      key: {
        ...(stored?.key ?? {}),
        ...target,
      },
      message: protocol.editedMessage,
      timestampSeconds: toSeconds(protocol.timestampMs)
        ?? event.timestampSeconds
        ?? stored?.timestampSeconds
        ?? Math.floor(Date.now() / 1_000),
      ...(pushName !== undefined ? { pushName } : {}),
    };
    const message = normalizeZapoMessage(edited);

    if (!message) return;

    const previous = stored ? normalizeZapoMessage(stored) : undefined;
    this.#remember(edited);
    const editedByMe = event.key.fromMe === true;
    const editedById = event.key.participant
      ?? event.key.participantAlt
      ?? (editedByMe ? this.getCurrentUserIds()[0] : event.key.remoteJid ?? undefined);

    void this.#events.emit('messageEdited', {
      key: message.keys,
      ...(previous ? { previous } : {}),
      message,
      editedByMe,
      ...(editedById ? { editedById } : {}),
      editedAt: message.timestamp,
    });
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
    event: { status: 'open' | 'close'; reason?: unknown; isLogout?: boolean },
  ): Promise<void> {
    if (client !== this.#client) return;

    if (event.status === 'open') {
      this.#connectPromise = undefined;
      this.#connected = true;
      this.#connectedAtSeconds = Math.floor(Date.now() / 1_000);
      this.#reconnectAttempt = 0;
      await this.#events.emit('connection', { state: 'connected' });
      return;
    }

    this.#connectPromise = undefined;
    this.#connected = false;
    const error = event.reason instanceof Error
      ? event.reason
      : event.reason
        ? new Error(String(event.reason))
        : undefined;

    if (this.#intentionalClose || event.isLogout) {
      await this.#events.emit('connection', {
        state: 'closed',
        ...(error ? { error } : {}),
      });
      return;
    }

    await this.#scheduleReconnect(error);
  }

  #startConnect(client: WaClient): void {
    const promise = client.connect();
    this.#connectPromise = promise;
    void promise.catch(async (error: unknown) => {
      if (this.#connectPromise !== promise) return;
      this.#connectPromise = undefined;

      if (this.#intentionalClose) return;

      const normalized = error instanceof Error ? error : new Error(String(error));
      this.#logger.warn('WhatsApp connection attempt failed.', { error: normalized });
      await this.#scheduleReconnect(normalized);
    });
  }

  async #scheduleReconnect(error?: Error): Promise<void> {
    if (this.#reconnectTimer) return;

    const options = this.#options.reconnect;
    const maxAttempts = options?.maxAttempts ?? 10;

    if (options?.enabled === false || this.#reconnectAttempt >= maxAttempts) {
      await this.#events.emit('connection', {
        state: 'closed',
        ...(error ? { error } : {}),
      });
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
    const delay = Math.min(maximum, initial * 2 ** (this.#reconnectAttempt - 1));
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = undefined;
      void this.connect();
    }, delay + Math.floor(Math.random() * 250));
  }

  async #sendButtons(
    chatId: string,
    content: ButtonsContent,
    replyTo?: MessageKey,
  ): Promise<SentMessage> {
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
          buttons: content.buttons.map((button) => button.type === 'copy'
            ? {
                name: 'cta_copy',
                buttonParamsJson: JSON.stringify({
                  display_text: button.label,
                  copy_code: button.code,
                }),
              }
            : {
                name: 'cta_url',
                buttonParamsJson: JSON.stringify({
                  display_text: button.label,
                  url: button.url,
                  merchant_url: button.url,
                }),
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


  #normalizeVoipCall(
    event: ZapoVoipCallLike,
    forcedStatus?: CallStatus,
  ): CallEvent | undefined {
    const id = event.callId;
    const from = event.callerPn ?? event.peerJid ?? event.callCreator;
    const chatId = event.groupJid ?? event.peerJid ?? from;

    if (!id || !from || !chatId) return undefined;

    return {
      id,
      chatId,
      from,
      status: forcedStatus ?? this.#callStatus(event.stateData?.state),
      isVideo: event.mediaType === 'video',
      isGroup: Boolean(event.groupJid),
      date: event.createdAt ?? new Date(),
    };
  }

  #callStatus(status: string | null | undefined): CallStatus {
    switch (status?.toLowerCase()) {
      case 'offer':
      case 'initiating':
        return 'offer';
      case 'ringing':
      case 'incoming_ringing':
        return 'ringing';
      case 'preaccept':
      case 'connecting':
        return 'preaccept';
      case 'accept':
      case 'accepted':
      case 'active':
        return 'accept';
      case 'reject':
      case 'rejected':
      case 'terminate':
      case 'terminated':
      case 'ended':
        return 'reject';
      default:
        return 'timeout';
    }
  }

  #callEndStatus(reason: string | null | undefined): CallStatus {
    return reason?.toLowerCase() === 'timeout' ? 'timeout' : 'reject';
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

  #findStoredMessage(key: ZapoMessageKeyLike): StoredZapoMessage | undefined {
    const direct = this.#messageStore.get(this.#messageStoreKey(key));
    if (direct) return direct;
    if (!key.id) return undefined;

    for (const message of this.#messageStore.values()) {
      if (message.key.id === key.id) return message;
    }

    return undefined;
  }

  #remember(message: StoredZapoMessage): void {
    const key = this.#messageStoreKey(message.key);
    this.#messageStore.delete(key);
    this.#messageStore.set(key, message);

    while (this.#messageStore.size > this.#messageCacheSize) {
      const oldest = this.#messageStore.keys().next().value as string | undefined;
      if (oldest) this.#messageStore.delete(oldest);
    }
  }

  #messageStoreKey(key: ZapoMessageKeyLike): string {
    return `${key.remoteJid ?? ''}:${key.id ?? ''}:${key.participant ?? key.participantAlt ?? ''}`;
  }

  #isOfflineMessage(message: StoredZapoMessage): boolean {
    if (this.#options.processOfflineMessages === true) return false;
    if (message.offline === true) return true;
    if (!this.#connectedAtSeconds || message.timestampSeconds == null) return false;

    const timestamp = toSeconds(message.timestampSeconds);
    if (timestamp === undefined) return false;

    return timestamp < this.#connectedAtSeconds - 3;
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

function toSeconds(value: number | LongLike | null | undefined): number | undefined {
  const raw = typeof value === 'number'
    ? value
    : value?.toNumber
      ? value.toNumber()
      : value?.low;

  if (raw === undefined) return undefined;
  return raw > 10_000_000_000 ? Math.floor(raw / 1_000) : raw;
}
