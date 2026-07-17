import type { WhatsAppProvider } from '@/provider/provider.js';

export class ChatService {
  readonly #provider: WhatsAppProvider;

  constructor(provider: WhatsAppProvider) {
    this.#provider = provider;
  }

  typing(chatId: string): Promise<void> {
    return this.#provider.setPresence(chatId, 'typing');
  }

  recording(chatId: string): Promise<void> {
    return this.#provider.setPresence(chatId, 'recording');
  }

  stop(chatId: string): Promise<void> {
    return this.#provider.setPresence(chatId, 'paused');
  }

  stopTyping(chatId: string): Promise<void> {
    return this.stop(chatId);
  }
}
