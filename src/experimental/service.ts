import type { Message } from '@/models/message.js';
import type { MessageService } from '@/services/message-service.js';
import type { ExperimentalContent } from '@/experimental/types.js';

export async function sendExperimental(
  service: Pick<MessageService, 'send'>,
  chatId: string,
  content: ExperimentalContent,
): Promise<Awaited<ReturnType<MessageService['send']>>> {
  const send = service.send as unknown as (chatId: string, content: ExperimentalContent) => ReturnType<MessageService['send']>;
  return send.call(service, chatId, content);
}

export async function replyExperimental(
  service: Pick<MessageService, 'reply'>,
  message: Message,
  content: ExperimentalContent,
): Promise<Awaited<ReturnType<MessageService['reply']>>> {
  const reply = service.reply as unknown as (message: Message, content: ExperimentalContent) => ReturnType<MessageService['reply']>;
  return reply.call(service, message, content);
}
