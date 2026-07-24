import {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  makeWASocket,
  proto,
  useMultiFileAuthState,
  type AnyMessageContent,
  type WACallEvent,
  type WAMessage,
  type WAMessageKey,
  type WASocket,
} from '@whiskeysockets/baileys';
import { Browser } from '@/auth/browser.js';
import { WhaNextError } from '@/errors/error.js';
import { Logger } from '@/logger/logger.js';
import type { CallEvent, CallStatus } from '@/models/call.js';
import type {
  GroupAccess,
  GroupParticipantsChanged,
  GroupSnapshot,
} from '@/models/group.js';
import type {
  MediaSource,
  DownloadedMedia,
  MentionTarget,
  MessageContent,
  MessageKey,
  SentMessage,
} from '@/models/message.js';
import {
  createBaileysLogger,
} from '@/provider/baileys/baileys-logger.js';
import {
  normalizeBaileysMessage,
  normalizeKey,
} from '@/provider/baileys/normalize-message.js';
import { TypedEventEmitter } from '@/provider/event-emitter.js';
import type {
  ParticipantAction,
  ParticipantUpdateResult,
  PresenceState,
  ProviderEvents,
  WhatsAppProvider,
} from '@/provider/provider.js';

export interface BaileysProviderOptions {
  auth: string;
  browser: Browser;
  logger?: Logger;
  messageCacheSize?: number;
  reconnect?: {
    enabled?: boolean;
    maxAttempts?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
  };
}

export class BaileysProvider implements WhatsAppProvider {
  readonly #options: BaileysProviderOptions;
  readonly #events = new TypedEventEmitter<ProviderEvents>();
  readonly #logger: Logger;
  readonly #messageStore = new Map<string, WAMessage>();
  readonly #messageCacheSize: number;
  #socket: WASocket | undefined;
  #saveCredentials: (() => Promise<void>) | undefined;
  #saveQueue: Promise<void> = Promise.resolve();
  #intentionalClose = false;
  #reconnectAttempt = 0;
  #reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  #registered = false;

  constructor(options: BaileysProviderOptions) {
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
    if (this.#socket) {
      return;
    }

    this.#intentionalClose = false;
    await this.#events.emit('connection', {
      state: this.#reconnectAttempt > 0 ? 'reconnecting' : 'connecting',
      attempt: this.#reconnectAttempt,
    });

    try {
      const { state, saveCreds } = await useMultiFileAuthState(this.#options.auth);
      this.#registered = state.creds.registered;
      this.#saveCredentials = saveCreds;
      const socket = makeWASocket({
        auth: state,
        browser: this.#browserDescription(),
        logger: createBaileysLogger(this.#logger.child('baileys')),
        markOnlineOnConnect: false,
        enableAutoSessionRecreation: true,
        enableRecentMessageCache: true,
        getMessage: async (key) => this.#messageStore.get(this.#messageStoreKey(key))?.message ?? undefined,
      });
      this.#socket = socket;
      this.#bind(socket);
    } catch (error) {
      this.#socket = undefined;
      throw new WhaNextError('CONNECTION_FAILED', 'Could not start the WhatsApp connection.', {
        cause: error,
        recoverable: true,
      });
    }
  }

  async disconnect(): Promise<void> {
    this.#intentionalClose = true;
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
    const socket = this.#socket;
    this.#socket = undefined;

    if (socket) {
      await socket.end(undefined);
    }

    await this.#events.emit('connection', { state: 'closed' });
  }

  getCurrentUserIds(): string[] {
    const user = this.#socket?.user;

    if (!user) {
      return [];
    }

    return [user.id, user.lid, user.phoneNumber]
      .filter((id): id is string => Boolean(id))
      .filter((id, index, ids) => ids.indexOf(id) === index);
  }

  async requestPairingCode(phone: string): Promise<string> {
    const normalized = phone.replace(/\D/g, '');

    if (normalized.length < 10) {
      throw new WhaNextError(
        'AUTH_INVALID_PHONE',
        'The phone number must include its country code.',
      );
    }

    if (this.#registered) {
      return '';
    }

    const socket = this.#requireSocket();

    try {
      await socket.waitForConnectionUpdate(async (update) => Boolean(update.qr), 60_000);

      if (socket !== this.#socket) {
        throw new WhaNextError(
          'CONNECTION_CLOSED',
          'The WhatsApp socket changed while preparing the pairing code.',
          {
            recoverable: true,
          },
        );
      }

      return await socket.requestPairingCode(normalized);
    } catch (error) {
      if (error instanceof WhaNextError) {
        throw error;
      }

      throw new WhaNextError(
        'CONNECTION_FAILED',
        'Could not request the pairing code after the authentication challenge.',
        {
          cause: error,
          context: { statusCode: this.#statusCode(error) },
          recoverable: this.#statusCode(error) === DisconnectReason.connectionClosed,
        },
      );
    }
  }

  async sendMessage(
    chatId: string,
    content: MessageContent,
    replyTo?: MessageKey,
  ): Promise<SentMessage> {
    const socket = this.#requireSocket();
    const options = replyTo
      ? {
          quoted: {
            key: this.#toWaKey(replyTo),
            message: { conversation: '' },
          } as WAMessage,
        }
      : undefined;
    const result = await socket.sendMessage(chatId, this.#toContent(content), options);
    return this.#sent(result);
  }

  async reactToMessage(key: MessageKey, emoji?: string): Promise<SentMessage> {
    const result = await this.#requireSocket().sendMessage(key.chatId, {
      react: {
        text: emoji ?? '',
        key: this.#toWaKey(key),
      },
    });
    return this.#sent(result);
  }

  async downloadMedia(key: MessageKey): Promise<DownloadedMedia> {
    const message = this.#messageStore.get(this.#messageStoreKey(key));

    if (!message?.message) {
      throw new WhaNextError(
        'MEDIA_NOT_AVAILABLE',
        'The media is unavailable. Download it from the received message event while it is cached.',
        { recoverable: true },
      );
    }

    const data = await downloadMediaMessage(message, 'buffer', {}, {
      reuploadRequest: (current) => this.#requireSocket().updateMediaMessage(current),
      logger: createBaileysLogger(this.#logger.child('media')),
    });
    const media = normalizeBaileysMessage(message)?.media;

    if (!media) {
      throw new WhaNextError('MEDIA_NOT_AVAILABLE', 'The selected message does not contain media.');
    }

    return {
      data,
      kind: media.kind,
      ...(media.mimetype ? { mimetype: media.mimetype } : {}),
      ...(media.fileName ? { fileName: media.fileName } : {}),
    };
  }

  async editMessage(key: MessageKey, content: string): Promise<SentMessage> {
    const result = await this.#requireSocket().sendMessage(key.chatId, {
      text: content,
      edit: this.#toWaKey(key),
    });
    return this.#sent(result);
  }

  async deleteMessage(key: MessageKey): Promise<void> {
    await this.#requireSocket().sendMessage(key.chatId, { delete: this.#toWaKey(key) });
  }

  async getGroup(groupId: string): Promise<GroupSnapshot> {
    const metadata = await this.#requireSocket().groupMetadata(groupId);
    return {
      id: metadata.id,
      subject: metadata.subject,
      access: metadata.announce ? 'closed' : 'open',
      addressingMode: metadata.addressingMode === 'lid' ? 'lid' : 'pn',
      fetchedAt: new Date(),
      participants: metadata.participants.map((participant) => ({
        id: participant.id,
        ...(participant.lid ? { lid: participant.lid } : {}),
        ...(participant.phoneNumber ? { phoneNumber: participant.phoneNumber } : {}),
        role: participant.admin === 'superadmin' || participant.isSuperAdmin
          ? 'owner'
          : participant.admin === 'admin' || participant.isAdmin
            ? 'admin'
            : 'member',
      })),
    };
  }

  async setGroupAccess(groupId: string, access: GroupAccess): Promise<void> {
    const setting = access === 'closed' ? 'announcement' : 'not_announcement';
    await this.#requireSocket().groupSettingUpdate(groupId, setting);
  }

  async getGroupInviteCode(groupId: string): Promise<string> {
    const code = await this.#requireSocket().groupInviteCode(groupId);
    if (!code) {
      throw new WhaNextError(
        'PROVIDER_ERROR',
        'WhatsApp did not return a group invite code.',
      );
    }
    return code;
  }

  async revokeGroupInvite(groupId: string): Promise<string> {
    const code = await this.#requireSocket().groupRevokeInvite(groupId);
    if (!code) {
      throw new WhaNextError(
        'PROVIDER_ERROR',
        'WhatsApp did not return a new group invite code.',
      );
    }
    return code;
  }

  async setMessagePin(groupId: string, key: MessageKey, pinned: boolean): Promise<void> {
    await this.#requireSocket().sendMessage(groupId, {
      pin: this.#toWaKey(key),
      type: pinned ? proto.PinInChat.Type.PIN_FOR_ALL : proto.PinInChat.Type.UNPIN_FOR_ALL,
      ...(pinned ? { time: 604800 as const } : {}),
    });
  }

  async updateParticipant(
    groupId: string,
    memberId: string,
    action: ParticipantAction,
  ): Promise<ParticipantUpdateResult> {
    const [result] = await this.#requireSocket()
      .groupParticipantsUpdate(groupId, [memberId], action);
    const status = result?.status ?? 'unknown';
    return {
      success: status === '200',
      status,
      ...(result?.jid ? { memberId: result.jid } : {}),
    };
  }

  async setPresence(chatId: string, state: PresenceState): Promise<void> {
    const socket = this.#requireSocket();
    const presence = state === 'typing'
      ? 'composing'
      : state === 'recording'
        ? 'recording'
        : 'paused';
    await socket.sendPresenceUpdate(presence, chatId);
  }

  async rejectCall(callId: string, from: string): Promise<void> {
    await this.#requireSocket().rejectCall(callId, from);
  }

  #bind(socket: WASocket): void {
    socket.ev.on('creds.update', (update) => {
      if (update.registered !== undefined) {
        this.#registered = update.registered;
      }

      this.#saveQueue = this.#saveQueue.then(() => this.#saveCredentials?.()).then(() => undefined);
    });

    socket.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const raw of messages) {
        if (raw.key.id && raw.message) this.#remember(raw);
        const message = normalizeBaileysMessage(raw);
        if (message) void this.#events.emit('message', message);
      }
    });

    socket.ev.on('groups.update', (groups) => {
      for (const group of groups) {
        if (group.id) void this.#events.emit('groupChanged', { groupId: group.id });
      }
    });

    socket.ev.on('group-participants.update', (update) => {
      const change = this.#groupParticipantsChanged(update);
      void this.#events.emit('groupParticipantsChanged', change);
      const { id } = update;
      void this.#events.emit('groupChanged', { groupId: id });
    });

    socket.ev.on('call', (calls) => {
      for (const call of calls) {
        void this.#events.emit('call', this.#normalizeCall(call));
      }
    });

    socket.ev.on('connection.update', (update) => {
      void this.#handleConnectionUpdate(socket, update.connection, update.lastDisconnect?.error);
    });
  }

  async #handleConnectionUpdate(
    socket: WASocket,
    connection?: 'open' | 'connecting' | 'close',
    error?: Error,
  ): Promise<void> {
    if (socket !== this.#socket || !connection) return;

    if (connection === 'open') {
      this.#reconnectAttempt = 0;
      await this.#events.emit('connection', { state: 'connected' });
      return;
    }

    if (connection === 'connecting') {
      await this.#events.emit('connection', {
        state: 'connecting',
        attempt: this.#reconnectAttempt,
      });
      return;
    }

    this.#socket = undefined;

    if (this.#intentionalClose || this.#isTerminal(error)) {
      await this.#events.emit('connection', { state: 'closed', ...(error ? { error } : {}) });
      return;
    }

    await this.#scheduleReconnect(error);
  }

  async #scheduleReconnect(error?: Error): Promise<void> {
    const options = this.#options.reconnect;
    const maxAttempts = options?.maxAttempts ?? 10;

    if (options?.enabled === false || this.#reconnectAttempt >= maxAttempts) {
      await this.#events.emit('connection', { state: 'closed', ...(error ? { error } : {}) });
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
    this.#reconnectTimer = setTimeout(
      () => void this.connect(),
      delay + Math.floor(Math.random() * 250),
    );
  }

  #browserDescription(): [string, string, string] {
    if (this.#options.browser === Browser.MacOS) return Browsers.macOS('Chrome');
    if (this.#options.browser === Browser.Ubuntu) return Browsers.ubuntu('Chrome');
    return Browsers.windows('Chrome');
  }

  #isTerminal(error?: Error): boolean {
    const statusCode = this.#statusCode(error);
    return statusCode === DisconnectReason.loggedOut
      || statusCode === DisconnectReason.badSession
      || statusCode === DisconnectReason.connectionReplaced;
  }

  #statusCode(error: unknown): number | undefined {
    return (error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
  }

  #requireSocket(): WASocket {
    if (!this.#socket) {
      throw new WhaNextError(
        'CONNECTION_CLOSED',
        'WhatsApp is not connected.',
        { recoverable: true },
      );
    }

    return this.#socket;
  }

  #toContent(content: MessageContent): AnyMessageContent {
    if ('text' in content) {
      return {
        text: content.text,
        ...(content.mentions
          ? { mentions: this.#mentions(content.mentions) }
          : {}),
      };
    }

    if ('image' in content) {
      return {
        image: this.#media(content.image),
        ...(content.caption !== undefined ? { caption: content.caption } : {}),
        ...(content.mentions
          ? { mentions: this.#mentions(content.mentions) }
          : {}),
        ...(content.viewOnce !== undefined
          ? { viewOnce: content.viewOnce }
          : {}),
      };
    }

    if ('video' in content) {
      return {
        video: this.#media(content.video),
        ...(content.caption !== undefined ? { caption: content.caption } : {}),
        ...(content.mentions
          ? { mentions: this.#mentions(content.mentions) }
          : {}),
        ...(content.viewOnce !== undefined
          ? { viewOnce: content.viewOnce }
          : {}),
        ...(content.gif !== undefined ? { gifPlayback: content.gif } : {}),
      };
    }

    return {
      audio: this.#media(content.audio),
      ...(content.mimetype ? { mimetype: content.mimetype } : {}),
      ...(content.voice !== undefined ? { ptt: content.voice } : {}),
    };
  }

  #media(source: MediaSource): Buffer | { url: string } {
    if (source instanceof Uint8Array) {
      return Buffer.from(source);
    }

    if ('url' in source) {
      return { url: source.url };
    }

    return { url: source.path };
  }

  #mentions(mentions: readonly MentionTarget[]): string[] {
    return mentions.map((mention) =>
      typeof mention === 'string' ? mention : mention.mentionId);
  }

  #toWaKey(key: MessageKey): WAMessageKey {
    return {
      id: key.id,
      remoteJid: key.chatId,
      fromMe: key.fromMe,
      ...(key.participantId ? { participant: key.participantId } : {}),
    };
  }

  #sent(message: WAMessage | undefined): SentMessage {
    if (!message?.key.id || !message.key.remoteJid) {
      throw new WhaNextError('PROVIDER_ERROR', 'WhatsApp did not confirm the sent message.');
    }

    if (message.message) this.#remember(message);
    return {
      id: message.key.id,
      chatId: message.key.remoteJid,
      keys: normalizeKey(message.key),
      timestamp: new Date(),
    };
  }

  #normalizeCall(call: WACallEvent): CallEvent {
    return {
      id: call.id,
      chatId: call.chatId,
      from: call.from,
      status: this.#callStatus(call.status),
      isVideo: Boolean(call.isVideo),
      isGroup: Boolean(call.isGroup),
      date: call.date ?? new Date(),
    };
  }

  #groupParticipantsChanged(change: {
    id: string;
    action: GroupParticipantsChanged['action'];
    participants: Array<{ id?: string | null }>;
    author?: string | null;
  }): GroupParticipantsChanged {
    const participantIds = change.participants
      .map((participant) => participant.id)
      .filter((id): id is string => Boolean(id));

    return {
      groupId: change.id,
      action: change.action,
      participantIds,
      ...(change.author ? { authorId: change.author } : {}),
    };
  }

  #callStatus(status: WACallEvent['status']): CallStatus {
    const known: readonly CallStatus[] = [
      'offer',
      'ringing',
      'preaccept',
      'timeout',
      'reject',
      'accept',
    ];
    return known.find((value) => value === status) ?? 'timeout';
  }

  #remember(message: WAMessage): void {
    const key = this.#messageStoreKey(message.key);
    this.#messageStore.delete(key);
    this.#messageStore.set(key, message);

    while (this.#messageStore.size > this.#messageCacheSize) {
      const oldest = this.#messageStore.keys().next().value as string | undefined;
      if (oldest) this.#messageStore.delete(oldest);
    }
  }

  #messageStoreKey(
    key: Pick<WAMessageKey, 'id' | 'remoteJid'> | MessageKey,
  ): string {
    const chatId = 'chatId' in key ? key.chatId : key.remoteJid;
    return `${chatId ?? ''}:${key.id ?? ''}`;
  }
}
