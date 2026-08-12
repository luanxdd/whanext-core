import type { Proto, WaIncomingMessageEvent } from 'zapo-js';
import { uniqueIdentities } from '@/models/identity.js';
import type {
  MediaKind,
  Message,
  MessageContentKind,
  MessageKey,
  MessageMedia,
  QuotedMessage,
} from '@/models/message.js';
import { User } from '@/models/user.js';

export interface ZapoMessageKeyLike {
  remoteJid?: string | null;
  remoteJidAlt?: string | null;
  id?: string | null;
  fromMe?: boolean | null;
  participant?: string | null;
  participantAlt?: string | null;
  senderUsername?: string | null;
}

interface EventLike {
  key: ZapoMessageKeyLike;
  message?: Proto.IMessage | null;
  timestampSeconds?: number | null;
  pushName?: string | null;
}

interface ContextInfoLike {
  stanzaId?: string | null;
  remoteJid?: string | null;
  participant?: string | null;
  quotedMessage?: Proto.IMessage | null;
  mentionedJid?: string[] | null;
}

interface LongLike {
  toNumber?: () => number;
  low?: number;
}

export function unwrapZapoMessageContent(
  input: Proto.IMessage | null | undefined,
): Proto.IMessage | undefined {
  if (!input) return undefined;

  const nested = input.ephemeralMessage?.message
    ?? input.viewOnceMessage?.message
    ?? input.viewOnceMessageV2?.message
    ?? input.deviceSentMessage?.message
    ?? input.documentWithCaptionMessage?.message;

  return nested ? unwrapZapoMessageContent(nested) : input;
}

export function isZapoViewOnceContent(
  input: Proto.IMessage | null | undefined,
): boolean {
  if (!input) return false;

  if (input.viewOnceMessage?.message || input.viewOnceMessageV2?.message) {
    return true;
  }

  return isZapoViewOnceContent(input.ephemeralMessage?.message);
}

export function extractQuotedZapoMessage(
  input: WaIncomingMessageEvent | EventLike,
): WaIncomingMessageEvent | undefined {
  const event = input as EventLike;
  const chatId = event.key.remoteJid;
  const content = unwrapZapoMessageContent(event.message);

  if (!chatId || !content) return undefined;

  const node = contentNode(content);
  const context = getContextInfo(node);

  if (!context?.stanzaId || !context.quotedMessage) return undefined;

  return {
    key: {
      id: context.stanzaId,
      remoteJid: context.remoteJid ?? chatId,
      fromMe: false,
      ...(context.participant ? { participant: context.participant } : {}),
    },
    message: context.quotedMessage,
  } as WaIncomingMessageEvent;
}

export function normalizeZapoMessage(
  input: WaIncomingMessageEvent | EventLike,
): Message | undefined {
  const event = input as EventLike;
  const chatId = event.key.remoteJid;
  const id = event.key.id;

  if (!chatId || !id || !event.message) {
    return undefined;
  }

  const content = unwrapZapoMessageContent(event.message);

  if (!content) {
    return undefined;
  }

  const { type, node } = contentNode(content);
  const context = getContextInfo(node);
  const isPrivateIncoming = !chatId.endsWith('@g.us') && event.key.fromMe !== true;
  const senderIds = uniqueIdentities([
    event.key.participant,
    event.key.participantAlt,
    event.key.senderUsername?.includes('@')
      ? event.key.senderUsername
      : undefined,
    isPrivateIncoming ? event.key.remoteJidAlt : undefined,
    isPrivateIncoming ? chatId : undefined,
  ]);
  const senderJid = senderIds.find((identity) =>
    identity.endsWith('@s.whatsapp.net') || identity.endsWith('@c.us'));
  const senderLid = senderIds.find((identity) => identity.endsWith('@lid'));
  const senderId = senderJid ?? senderLid ?? senderIds[0] ?? chatId;
  const sender = new User({
    id: senderId,
    identities: senderIds.length > 0 ? senderIds : [senderId],
    ...(event.pushName ? { name: event.pushName } : {}),
  });
  const mentionedIds = [...(context?.mentionedJid ?? [])];
  const mentionedUsers = mentionedIds.map((identity) => User.fromIdentities([identity]));
  const viewOnce = isZapoViewOnceContent(event.message);
  const media = getMedia(type, node, viewOnce);
  const contentKind = getContentKind(type);
  const text = getText(content);
  const caption = getCaption(content);
  const quoted = getQuoted(context, chatId);

  const message: Message = {
    id,
    jid: chatId,
    chatId,
    senderId,
    senderIds: senderIds.length > 0 ? senderIds : [senderId],
    sender,
    keys: normalizeZapoKey(event.key),
    mentions: mentionedIds,
    mentionedUsers,
    timestamp: toDate(event.timestampSeconds),
    isGroup: chatId.endsWith('@g.us'),
    isReply: quoted !== undefined,
    isViewOnce: media?.viewOnce ?? false,
    hasMedia: media !== undefined,
    contentKind,
  };

  if (senderJid !== undefined) message.senderJid = senderJid;
  if (senderLid !== undefined) {
    message.lid = senderLid;
    message.senderLid = senderLid;
  }
  if (text !== undefined) message.text = text;
  if (caption !== undefined) message.caption = caption;
  if (media !== undefined) message.media = media;
  if (quoted !== undefined) message.quoted = quoted;

  return message;
}

export function normalizeZapoKey(key: ZapoMessageKeyLike): MessageKey {
  const normalized: MessageKey = {
    id: key.id ?? '',
    chatId: key.remoteJid ?? '',
    fromMe: key.fromMe ?? false,
  };
  const participantId = key.participant ?? key.participantAlt;

  if (participantId !== null && participantId !== undefined) {
    normalized.participantId = participantId;
  }

  return normalized;
}

function contentNode(content: Proto.IMessage): {
  type: keyof Proto.IMessage | undefined;
  node: unknown;
} {
  const order: Array<keyof Proto.IMessage> = [
    'conversation',
    'extendedTextMessage',
    'imageMessage',
    'videoMessage',
    'audioMessage',
    'documentMessage',
    'stickerMessage',
    'locationMessage',
    'liveLocationMessage',
    'contactMessage',
    'contactsArrayMessage',
    'buttonsResponseMessage',
    'listResponseMessage',
    'templateButtonReplyMessage',
    'pollCreationMessage',
    'pollCreationMessageV2',
    'pollCreationMessageV3',
    'pollCreationMessageV5',
    'productMessage',
    'orderMessage',
    'interactiveResponseMessage',
  ];

  const type = order.find((key) => content[key] !== null && content[key] !== undefined);
  return { type, node: type ? content[type] : undefined };
}

function getContentKind(type: keyof Proto.IMessage | undefined): MessageContentKind {
  switch (String(type ?? '')) {
    case 'conversation':
    case 'extendedTextMessage':
    case 'buttonsResponseMessage':
    case 'listResponseMessage':
    case 'templateButtonReplyMessage':
    case 'interactiveResponseMessage':
      return 'text';
    case 'imageMessage':
      return 'image';
    case 'videoMessage':
      return 'video';
    case 'audioMessage':
      return 'audio';
    case 'documentMessage':
      return 'document';
    case 'stickerMessage':
      return 'sticker';
    case 'locationMessage':
    case 'liveLocationMessage':
      return 'location';
    case 'contactMessage':
    case 'contactsArrayMessage':
      return 'contact';
    case 'pollCreationMessage':
    case 'pollCreationMessageV2':
    case 'pollCreationMessageV3':
    case 'pollCreationMessageV5':
      return 'poll';
    case 'productMessage':
    case 'orderMessage':
      return 'catalog';
    default:
      return 'unknown';
  }
}

function getText(content: Proto.IMessage): string | undefined {
  return content.conversation
    ?? content.extendedTextMessage?.text
    ?? content.buttonsResponseMessage?.selectedDisplayText
    ?? content.listResponseMessage?.title
    ?? content.templateButtonReplyMessage?.selectedDisplayText
    ?? undefined;
}

function getCaption(content: Proto.IMessage): string | undefined {
  return content.imageMessage?.caption
    ?? content.videoMessage?.caption
    ?? content.documentMessage?.caption
    ?? undefined;
}

function getContextInfo(node: unknown): ContextInfoLike | undefined {
  if (typeof node !== 'object' || node === null || !('contextInfo' in node)) {
    return undefined;
  }

  return (node as { contextInfo?: ContextInfoLike | null }).contextInfo ?? undefined;
}

function getMedia(
  type: keyof Proto.IMessage | undefined,
  node: unknown,
  wrapperViewOnce: boolean,
): MessageMedia | undefined {
  const mapping: Partial<Record<keyof Proto.IMessage, MediaKind>> = {
    imageMessage: 'image',
    videoMessage: 'video',
    audioMessage: 'audio',
    documentMessage: 'document',
    stickerMessage: 'sticker',
  };
  const kind = type ? mapping[type] : undefined;

  if (!kind || typeof node !== 'object' || node === null) {
    return undefined;
  }

  const value = node as {
    mimetype?: string | null;
    fileName?: string | null;
    seconds?: number | LongLike | null;
    viewOnce?: boolean | null;
  };
  const media: MessageMedia = {
    kind,
    viewOnce: wrapperViewOnce || value.viewOnce === true,
  };

  if (value.mimetype) media.mimetype = value.mimetype;
  if (value.fileName) media.fileName = value.fileName;

  const seconds = toNumber(value.seconds);
  if (seconds !== undefined) media.seconds = seconds;

  return media;
}

function getQuoted(
  context: ContextInfoLike | undefined,
  chatId: string,
): QuotedMessage | undefined {
  if (!context?.stanzaId || !context.quotedMessage) return undefined;

  const content = unwrapZapoMessageContent(context.quotedMessage);
  if (!content) return undefined;

  const { type, node } = contentNode(content);
  const media = getMedia(type, node, isZapoViewOnceContent(context.quotedMessage));
  const senderId = context.participant ?? undefined;
  const quoted: QuotedMessage = {
    key: {
      id: context.stanzaId,
      chatId: context.remoteJid ?? chatId,
      fromMe: false,
      ...(senderId ? { participantId: senderId } : {}),
    },
    hasMedia: media !== undefined,
    isViewOnce: media?.viewOnce ?? false,
    contentKind: getContentKind(type),
  };
  const text = getText(content) ?? getCaption(content);

  if (text !== undefined) quoted.text = text;
  if (senderId !== undefined) {
    quoted.senderId = senderId;
    quoted.sender = User.fromIdentities([senderId]);
  }
  if (media !== undefined) quoted.media = media;

  return quoted;
}

function toDate(value: number | LongLike | null | undefined): Date {
  const seconds = toNumber(value) ?? Math.floor(Date.now() / 1000);
  return new Date(seconds * 1_000);
}

function toNumber(value: number | LongLike | null | undefined): number | undefined {
  if (typeof value === 'number') return value;
  if (value?.toNumber) return value.toNumber();
  if (typeof value?.low === 'number') return value.low;
  return undefined;
}
