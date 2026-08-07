import {
  extractMessageContent,
  getContentType,
  normalizeMessageContent,
  type WAMessage,
  type WAMessageContent,
  type WAMessageKey,
  type proto,
} from '@whiskeysockets/baileys';
import { uniqueIdentities } from '@/models/identity.js';
import type {
  MediaKind,
  MessageContentKind,
  Message,
  MessageKey,
  MessageMedia,
  QuotedMessage,
} from '@/models/message.js';
import { User } from '@/models/user.js';

export function normalizeBaileysMessage(input: WAMessage): Message | undefined {
  const chatId = input.key.remoteJid;
  const id = input.key.id;

  if (!chatId || !id || !input.message) {
    return undefined;
  }

  const normalized = normalizeMessageContent(input.message);
  const content = extractMessageContent(normalized);

  if (!content) {
    return undefined;
  }

  const type = getContentType(content);
  const node = type ? content[type] : undefined;
  const context = getContextInfo(node);
  const senderIds = uniqueIdentities([
    input.key.participant,
    input.key.participantAlt,
    input.key.participantUsername?.includes('@')
      ? input.key.participantUsername
      : undefined,
  ]);
  const senderJid = senderIds.find((identity) =>
    identity.endsWith('@s.whatsapp.net') || identity.endsWith('@c.us'));
  const senderLid = senderIds.find((identity) => identity.endsWith('@lid'));
  const senderId = senderJid ?? senderLid ?? senderIds[0] ?? chatId;
  const sender = new User({
    id: senderId,
    identities: senderIds.length > 0 ? senderIds : [senderId],
    ...(input.pushName ? { name: input.pushName } : {}),
  });
  const mentionedUsers = (context?.mentionedJid ?? []).map((identity) =>
    User.fromIdentities([identity]));
  const media = getMedia(type, node, Boolean(input.key.isViewOnce));
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
    keys: normalizeKey(input.key),
    mentions: [...(context?.mentionedJid ?? [])],
    mentionedUsers,
    timestamp: toDate(input.messageTimestamp),
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

function getContentKind(
  type: keyof WAMessageContent | undefined,
): MessageContentKind {
  switch (String(type ?? '')) {
    case 'conversation':
    case 'extendedTextMessage':
    case 'buttonsResponseMessage':
    case 'listResponseMessage':
    case 'templateButtonReplyMessage':
      return 'text';
    case 'imageMessage':
      return 'image';
    case 'videoMessage':
      return 'video';
    case 'audioMessage':
      return 'audio';
    case 'documentMessage':
    case 'documentWithCaptionMessage':
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
      return 'poll';
    case 'productMessage':
    case 'orderMessage':
      return 'catalog';
    default:
      return 'unknown';
  }
}

export function normalizeKey(key: WAMessageKey): MessageKey {
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

function getText(content: WAMessageContent): string | undefined {
  return content.conversation
    ?? content.extendedTextMessage?.text
    ?? content.buttonsResponseMessage?.selectedDisplayText
    ?? content.listResponseMessage?.title
    ?? undefined;
}

function getCaption(content: WAMessageContent): string | undefined {
  return content.imageMessage?.caption
    ?? content.videoMessage?.caption
    ?? content.documentMessage?.caption
    ?? undefined;
}

function getContextInfo(node: unknown): proto.IContextInfo | undefined {
  if (typeof node !== 'object' || node === null || !('contextInfo' in node)) {
    return undefined;
  }

  return (node as { contextInfo?: proto.IContextInfo }).contextInfo;
}

function getMedia(
  type: keyof WAMessageContent | undefined,
  node: unknown,
  keyViewOnce: boolean,
): MessageMedia | undefined {
  const mapping: Partial<Record<keyof WAMessageContent, MediaKind>> = {
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
    viewOnce: keyViewOnce || value.viewOnce === true,
  };
  if (value.mimetype) media.mimetype = value.mimetype;
  if (value.fileName) media.fileName = value.fileName;
  if (value.seconds !== undefined && value.seconds !== null) media.seconds = Number(value.seconds);
  return media;
}

function getQuoted(
  context: proto.IContextInfo | undefined,
  chatId: string,
): QuotedMessage | undefined {
  if (!context?.stanzaId) {
    return undefined;
  }

  const quoted = context.quotedMessage;
  const normalized = normalizeMessageContent(quoted);
  const content = extractMessageContent(normalized);
  const result: QuotedMessage = {
    key: {
      id: context.stanzaId,
      chatId: context.remoteJid ?? chatId,
      fromMe: false,
    },
    hasMedia: Boolean(
      content
      && getMedia(
        getContentType(content),
        content[getContentType(content) ?? 'conversation'],
        false,
      ),
    ),
  };

  if (context.participant) {
    result.senderId = context.participant;
    result.sender = User.fromIdentities([context.participant]);
    result.key.participantId = context.participant;
  }

  if (content) {
    const text = getText(content) ?? getCaption(content);
    if (text !== undefined) result.text = text;
  }

  return result;
}

interface LongLike {
  toString(): string;
}

function toDate(value: number | LongLike | null | undefined): Date {
  const seconds = value === null || value === undefined ? Date.now() / 1_000 : Number(value);
  return new Date(seconds * 1_000);
}
