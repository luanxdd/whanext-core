import { identitiesMatch, uniqueIdentities } from '@/models/identity.js';
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

  isOwner(message: Pick<Message, 'keys' | 'senderIds'>): boolean {
    if (message.keys.fromMe) {
      return true;
    }

    const currentIds = this.ids;
    return message.senderIds.some((senderId) =>
      currentIds.some((currentId) => identitiesMatch(senderId, currentId)));
  }
}
