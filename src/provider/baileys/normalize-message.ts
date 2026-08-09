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

function unwrapMessageContent(
  input: WAMessageContent | null | undefined,
): WAMessageContent | undefined {
  if (!input) return undefined;

  const normalized = normalizeMessageContent(input);
  const content = extractMessageContent(normalized);

  if (!content) return undefined;

  const nested = content.ephemeralMessage?.message
    ?? content.viewOnceMessage?.message
    ?? content.viewOnceMessageV2?.message
    ?? content.viewOnceMessageV2Extension?.message;

  return nested ? unwrapMessageContent(nested) : content;
}

function isViewOnceContent(
  input: WAMessageContent | null | undefined,
): boolean {
  if (!input) return false;

  if (
    input.viewOnceMessage?.message
    || input.viewOnceMessageV2?.message
    || input.viewOnceMessageV2Extension?.message
  ) {
    return true;
  }

  return isViewOnceContent(input.ephemeralMessage?.message);
}

export function extractQuotedBaileysMessage(input: WAMessage): WAMessage | undefined {
  const chatId = input.key.remoteJid;
  const content = unwrapMessageContent(input.message);

  if (!chatId || !content) return undefined;

  const type = getContentType(content);
  const node = type ? content[type] : undefined;
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
  };
}

export function normalizeBaileysMessage(input: WAMessage): Message | undefined {
  const chatId = input.key.remoteJid;
  const id = input.key.id;

  if (!chatId || !id || !input.message) {
    return undefined;
  }

  const content = unwrapMessageContent(input.message);

  if (!content) {
    return undefined;
  }

  const type = getContentType(content);
  const node = type ? content[type] : undefined;
  const context = getContextInfo(node);
  const isPrivateIncoming = !chatId.endsWith('@g.us') && input.key.fromMe !== true;
  const remoteJidAlt = (input.key as WAMessageKey & { remoteJidAlt?: string | null }).remoteJidAlt;
  const senderIds = uniqueIdentities([
    input.key.participant,
    input.key.participantAlt,
    input.key.participantUsername?.includes('@')
      ? input.key.participantUsername
      : undefined,
    isPrivateIncoming ? remoteJidAlt : undefined,
    isPrivateIncoming ? chatId : undefined,
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
  const viewOnce = Boolean(input.key.isViewOnce) || isViewOnceContent(input.message);
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
  const quotedIsViewOnce = isViewOnceContent(quoted);
  const content = unwrapMessageContent(quoted);
  const type = content ? getContentType(content) : undefined;
  const node = type && content ? content[type] : undefined;
  const media = getMedia(type, node, quotedIsViewOnce);
  const result: QuotedMessage = {
    key: {
      id: context.stanzaId,
      chatId: context.remoteJid ?? chatId,
      fromMe: false,
    },
    hasMedia: media !== undefined,
    isViewOnce: media?.viewOnce ?? quotedIsViewOnce,
  };

  if (content) {
    result.contentKind = getContentKind(type);
  }

  if (media) {
    result.media = media;
  }

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
