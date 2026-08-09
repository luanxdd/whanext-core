import {
  identitiesMatch,
  identityPhoneNumber,
  normalizeIdentity,
  uniqueIdentities,
} from '@/models/identity.js';
import type { Message } from '@/models/message.js';
import type { WhatsAppProvider } from '@/provider/provider.js';

export class AccountService {
  readonly id: string | undefined;
  readonly #provider: WhatsAppProvider;

  constructor(provider: WhatsAppProvider, id?: string) {
    this.#provider = provider;
    this.id = id;
  }

  get ids(): readonly string[] {
    return uniqueIdentities(this.#provider.getCurrentUserIds());
  }

  get jid(): string | undefined {
    const identity = this.ids.find((candidate) =>
      candidate.endsWith('@s.whatsapp.net') || candidate.endsWith('@c.us'));

    if (identity) {
      return normalizeIdentity(identity);
    }

    const phone = this.ids
      .map((candidate) => identityPhoneNumber(candidate))
      .find((candidate): candidate is string => candidate !== undefined);

    return phone ? `${phone}@s.whatsapp.net` : undefined;
  }

  get lid(): string | undefined {
    const identity = this.ids.find((candidate) => candidate.endsWith('@lid'));
    return identity ? normalizeIdentity(identity) : undefined;
  }

  get phoneNumber(): string | undefined {
    const jid = this.jid;
    return jid ? identityPhoneNumber(jid) : undefined;
  }

  get selfChatId(): string | undefined {
    return this.jid ?? this.lid ?? this.ids[0];
  }

  isOwner(message: Pick<Message, 'keys' | 'senderIds'>): boolean {
    if (message.keys.fromMe) {
      return true;
    }

    const currentIds = this.ids;
    return message.senderIds.some((senderId) =>
      currentIds.some((currentId) => identitiesMatch(senderId, currentId)));
  }
}
