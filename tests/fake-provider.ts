import type {
  GroupAccess,
  GroupSnapshot,
} from '@/models/group.js';
import type {
  MessageContent,
  MessageKey,
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

export class FakeProvider implements WhatsAppProvider {
  readonly events = new TypedEventEmitter<ProviderEvents>();
  readonly sent: Array<{ chatId: string; content: MessageContent; replyTo?: MessageKey }> = [];
  readonly deleted: MessageKey[] = [];
  readonly calls = {
    getGroup: 0,
    setGroupAccess: 0,
    updateParticipant: 0,
    participantIds: [] as string[],
  };
  currentUserIds = ['5511999999999@s.whatsapp.net'];
  participantUpdateStatus = '200';
  group: GroupSnapshot = {
    id: '123@g.us',
    subject: 'WhaNext',
    access: 'open',
    addressingMode: 'lid',
    fetchedAt: new Date(),
    participants: [
      { id: '200000000000001@lid', phoneNumber: '5511000000000@s.whatsapp.net', role: 'member' },
      { id: '100000000000001@lid', phoneNumber: '5511999999999@s.whatsapp.net', role: 'admin' },
    ],
  };

  async connect(): Promise<void> {
    await this.events.emit('connection', { state: 'connected' });
  }

  async disconnect(): Promise<void> {
    await this.events.emit('connection', { state: 'closed' });
  }

  getCurrentUserIds(): string[] {
    return this.currentUserIds;
  }

  async requestPairingCode(): Promise<string> {
    return '1234-5678';
  }

  on<Event extends keyof ProviderEvents>(
    event: Event,
    listener: (payload: ProviderEvents[Event]) => void | Promise<void>,
  ) {
    return this.events.on(event, listener);
  }

  async sendMessage(
    chatId: string,
    content: MessageContent,
    replyTo?: MessageKey,
  ): Promise<SentMessage> {
    this.sent.push({ chatId, content, ...(replyTo ? { replyTo } : {}) });
    return {
      id: `sent-${this.sent.length}`,
      chatId,
      keys: { id: `sent-${this.sent.length}`, chatId, fromMe: true },
      timestamp: new Date(),
    };
  }

  async editMessage(key: MessageKey): Promise<SentMessage> {
    return { id: key.id, chatId: key.chatId, keys: key, timestamp: new Date() };
  }

  async deleteMessage(key: MessageKey): Promise<void> {
    this.deleted.push(key);
  }

  async getGroup(): Promise<GroupSnapshot> {
    this.calls.getGroup += 1;
    return structuredClone(this.group);
  }

  async setGroupAccess(_groupId: string, access: GroupAccess): Promise<void> {
    this.calls.setGroupAccess += 1;
    this.group.access = access;
  }

  async getGroupInviteCode(): Promise<string> {
    return 'invite-code';
  }

  async revokeGroupInvite(): Promise<string> {
    return 'new-invite-code';
  }

  async setMessagePin(): Promise<void> {}

  async updateParticipant(
    _groupId: string,
    memberId: string,
    action: ParticipantAction,
  ): Promise<ParticipantUpdateResult> {
    this.calls.updateParticipant += 1;
    this.calls.participantIds.push(memberId);

    if (this.participantUpdateStatus !== '200') {
      return { success: false, status: this.participantUpdateStatus, memberId };
    }

    const participant = this.group.participants.find((item) =>
      item.id === memberId || item.lid === memberId || item.phoneNumber === memberId);

    if (action === 'remove') {
      this.group.participants = this.group.participants.filter((item) => item.id !== memberId);
    } else if (participant) {
      participant.role = action === 'promote' ? 'admin' : 'member';
    }

    return { success: true, status: '200', memberId };
  }

  async setPresence(_chatId: string, _state: PresenceState): Promise<void> {}
}
