import type { CallEvent } from '@/models/call.js';
import type {
  GroupAccess,
  GroupParticipantsChanged,
  GroupSnapshot,
} from '@/models/group.js';
import type {
  Message,
  MessageContent,
  MessageDeleted,
  MessageEdited,
  MessageKey,
  DownloadedMedia,
  RepostMessageOptions,
  SentMessage,
} from '@/models/message.js';

export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'closed';

export type StabilityHealthStatus = 'healthy' | 'degraded' | 'reconnecting' | 'offline';
export type CryptoAccelerationBackend = 'napi' | 'wasm' | 'js' | 'unknown';

export type PresenceState =
  | 'typing'
  | 'recording'
  | 'paused';

export type ParticipantAction =
  | 'remove'
  | 'promote'
  | 'demote';

export interface ParticipantUpdateResult {
  success: boolean;
  status: string;
  memberId?: string;
}

export interface ConnectionUpdate {
  state: ConnectionState;
  attempt?: number;
  error?: Error;
}

export interface ProviderConnectionHealth {
  state: ConnectionState;
  uptimeMs: number;
  reconnects: number;
  reconnectAttempt: number;
  lastConnectedAt?: Date;
  lastDisconnectedAt?: Date;
}

export interface ProviderMessagingHealth {
  sent: number;
  received: number;
  failed: number;
  decryptedPayloads: number;
  unavailable: number;
  resendRequested: number;
  recovered: number;
  recoveryFailed: number;
  unavailableUnrecoverable: number;
  decodeFailures: number;
  unhandledStanzas: number;
  ignoredOffline: number;
  duplicates: number;
  normalizationFailures: number;
  lastIncomingAt?: Date;
  lastOutgoingAt?: Date;
}

export interface ProviderCryptoHealth {
  backend: CryptoAccelerationBackend;
  acceleration: boolean;
  decryptFailures: number;
  addonDecryptFailures: number;
  senderKeyMismatches: number;
}

export interface ProviderGroupHealth {
  phashMismatches: number;
  metadataRecoveries: number;
  metadataRecoveryFailures: number;
}

export interface ProviderTimeoutHealth {
  connectTimeoutMs: number;
  nodeQueryTimeoutMs: number;
}

export interface ProviderHealth {
  stability: StabilityHealthStatus;
  connection: ProviderConnectionHealth;
  messaging: ProviderMessagingHealth;
  crypto: ProviderCryptoHealth;
  groups: ProviderGroupHealth;
  timeouts: ProviderTimeoutHealth;
}

export interface GroupMetadataRecoveredEvent {
  groupId: string;
  recoveredAt: Date;
}

export type CryptoDegradationKind =
  | 'decrypt_failure'
  | 'addon_decrypt_failure'
  | 'sender_key_mismatch';

export interface CryptoDegradedEvent {
  kind: CryptoDegradationKind;
  occurredAt: Date;
  messageId?: string;
  chatId?: string;
  participantId?: string;
}

export interface MessageUnavailableEvent {
  kind: 'view_once' | 'hosted' | 'bot' | 'other';
  resendRequested: boolean;
  occurredAt: Date;
  messageId?: string;
  chatId?: string;
  participantId?: string;
}

export interface MessageRecoveredEvent {
  recoveredAt: Date;
  recoveryMs: number;
  messageId?: string;
  chatId?: string;
  participantId?: string;
}

export interface MessageRecoveryFailedEvent {
  failedAt: Date;
  waitedMs: number;
  messageId?: string;
  chatId?: string;
  participantId?: string;
}

export interface MessageDecodeFailureEvent {
  occurredAt: Date;
  reason: string;
  stanzaId?: string;
  chatId?: string;
  encType?: string;
}

export type MessageDiscardReason = 'offline' | 'duplicate' | 'normalization_failed';

export interface MessageDiscardedEvent {
  reason: MessageDiscardReason;
  occurredAt: Date;
  messageId?: string;
  chatId?: string;
}

export type ProviderStabilityEvent =
  | { type: 'groupMetadataRecovered'; payload: GroupMetadataRecoveredEvent }
  | { type: 'cryptoDegraded'; payload: CryptoDegradedEvent }
  | { type: 'messageUnavailable'; payload: MessageUnavailableEvent }
  | { type: 'messageRecovered'; payload: MessageRecoveredEvent }
  | { type: 'messageRecoveryFailed'; payload: MessageRecoveryFailedEvent }
  | { type: 'messageDecodeFailure'; payload: MessageDecodeFailureEvent }
  | { type: 'messageDiscarded'; payload: MessageDiscardedEvent }
  | { type: 'healthRefresh'; payload: { occurredAt: Date } };

export interface ProviderEvents {
  message: Message;
  messageDeleted: MessageDeleted;
  messageEdited: MessageEdited;
  connection: ConnectionUpdate;
  groupChanged: { groupId: string };
  groupParticipantsChanged: GroupParticipantsChanged;
  call: CallEvent;
  stability: ProviderStabilityEvent;
}

export type Unsubscribe = () => void;

export interface WhatsAppProvider {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getCurrentUserIds(): string[];
  requestPairingCode(phone: string): Promise<string>;
  on<Event extends keyof ProviderEvents>(
    event: Event,
    listener: (payload: ProviderEvents[Event]) => void | Promise<void>,
  ): Unsubscribe;
  health?(): ProviderHealth;
  sendMessage(chatId: string, content: MessageContent, replyTo?: MessageKey): Promise<SentMessage>;
  repostMessage(source: MessageKey, chatId: string, options?: RepostMessageOptions): Promise<SentMessage>;
  reactToMessage(key: MessageKey, emoji?: string): Promise<SentMessage>;
  downloadMedia(key: MessageKey): Promise<DownloadedMedia>;
  editMessage(key: MessageKey, content: string): Promise<SentMessage>;
  deleteMessage(key: MessageKey): Promise<void>;
  getGroup(groupId: string): Promise<GroupSnapshot>;
  setGroupAccess(groupId: string, access: GroupAccess): Promise<void>;
  getGroupInviteCode(groupId: string): Promise<string>;
  revokeGroupInvite(groupId: string): Promise<string>;
  setMessagePin(groupId: string, key: MessageKey, pinned: boolean): Promise<void>;
  updateParticipant(
    groupId: string,
    memberId: string,
    action: ParticipantAction,
  ): Promise<ParticipantUpdateResult>;
  setPresence(chatId: string, state: PresenceState): Promise<void>;
  rejectCall(callId: string, from: string): Promise<void>;
}
