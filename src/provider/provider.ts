import type { CallEvent } from '@/models/call.js';
import type {
  GroupAccess,
  GroupSnapshot,
} from '@/models/group.js';
import type {
  Message,
  MessageContent,
  MessageKey,
  SentMessage,
} from '@/models/message.js';

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed';
export type PresenceState = 'typing' | 'recording' | 'paused';
export type ParticipantAction = 'remove' | 'promote' | 'demote';

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

export interface ProviderEvents {
  message: Message;
  connection: ConnectionUpdate;
  groupChanged: { groupId: string };
  call: CallEvent;
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
  sendMessage(chatId: string, content: MessageContent, replyTo?: MessageKey): Promise<SentMessage>;
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
