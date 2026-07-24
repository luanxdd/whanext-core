import type {
  MentionTarget,
  Message,
  MessageContent,
  MessageKey,
  SentMessage,
  TextContent,
} from '@/models/message.js';
import type { WhatsAppProvider } from '@/provider/provider.js';

export class MessageService {
  readonly #provider: WhatsAppProvider;

  constructor(provider: WhatsAppProvider) {
    this.#provider = provider;
  }

  send(chatId: string, content: MessageContent): Promise<SentMessage> {
    return this.#provider.sendMessage(chatId, content);
  }

  reply(message: Message, content: MessageContent): Promise<SentMessage> {
    return this.#provider.sendMessage(message.chatId, content, message.keys);
  }

  edit(message: Message | SentMessage | MessageKey, text: string): Promise<SentMessage> {
    const key = 'keys' in message ? message.keys : message;
    return this.#provider.editMessage(key, text);
  }

  delete(message: Message | SentMessage | MessageKey): Promise<void> {
    const key = 'keys' in message ? message.keys : message;
    return this.#provider.deleteMessage(key);
  }

  react(message: Message | SentMessage | MessageKey, emoji: string): Promise<SentMessage> {
    const key = 'keys' in message ? message.keys : message;
    return this.#provider.reactToMessage(key, emoji);
  }

  unreact(message: Message | SentMessage | MessageKey): Promise<SentMessage> {
    const key = 'keys' in message ? message.keys : message;
    return this.#provider.reactToMessage(key);
  }

  text(chatId: string, text: string, mentions?: MentionTarget[]): Promise<SentMessage> {
    const content: TextContent = { text };

    if (mentions !== undefined) {
      content.mentions = mentions;
    }

    return this.send(chatId, content);
  }
}
