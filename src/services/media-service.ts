import type {
  AudioContent,
  DownloadedMedia,
  ImageContent,
  Message,
  MessageKey,
  SentMessage,
  VideoContent,
} from '@/models/message.js';
import type { WhatsAppProvider } from '@/provider/provider.js';

export class MediaService {
  readonly #provider: WhatsAppProvider;

  constructor(provider: WhatsAppProvider) {
    this.#provider = provider;
  }

  image(chatId: string, content: ImageContent): Promise<SentMessage> {
    return this.#provider.sendMessage(chatId, content);
  }

  video(chatId: string, content: VideoContent): Promise<SentMessage> {
    return this.#provider.sendMessage(chatId, content);
  }

  audio(chatId: string, content: AudioContent): Promise<SentMessage> {
    return this.#provider.sendMessage(chatId, content);
  }

  download(message: Message | MessageKey): Promise<DownloadedMedia> {
    const key = 'keys' in message ? message.keys : message;
    return this.#provider.downloadMedia(key);
  }
}
