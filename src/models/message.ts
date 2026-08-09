import type { User } from '@/models/user.js';

export interface MessageKey {
  id: string;
  chatId: string;
  fromMe: boolean;
  participantId?: string;
}

export type MediaKind = 
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'sticker';

/**
 * High-level classification of the received WhatsApp message payload.
 *
 * `media.kind` remains the source of truth for downloadable media.
 * `contentKind` additionally exposes non-media payloads such as locations,
 * contacts, polls and catalog/product messages without leaking Baileys types.
 */
export type MessageContentKind =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'sticker'
  | 'location'
  | 'contact'
  | 'poll'
  | 'catalog'
  | 'unknown';

export interface MessageMedia {
  kind: MediaKind;
  mimetype?: string;
  fileName?: string;
  seconds?: number;
  viewOnce: boolean;
}

export interface QuotedMessage {
  key: MessageKey;
  text?: string;
  senderId?: string;
  sender?: User;
  hasMedia: boolean;
}

export interface Message {
  id: string;
  jid: string;
  lid?: string;
  chatId: string;
  senderId: string;
  senderIds: string[];
  senderJid?: string;
  senderLid?: string;
  sender: User;
  keys: MessageKey;
  text?: string;
  caption?: string;
  mentions: string[];
  mentionedUsers: User[];
  timestamp: Date;
  isGroup: boolean;
  isReply: boolean;
  isViewOnce: boolean;
  hasMedia: boolean;
  contentKind?: MessageContentKind;
  media?: MessageMedia;
  quoted?: QuotedMessage;
}

export interface SentMessage {
  id: string;
  chatId: string;
  keys: MessageKey;
  timestamp: Date;
}

export interface DownloadedMedia {
  data: Buffer;
  kind: MediaKind;
  mimetype?: string;
  fileName?: string;
}

export type MediaSource = 
  | Uint8Array 
  | { url: string } 
  | { path: string };

export type MentionTarget = 
  | string 
  | User;

export interface RepostMessageOptions {
  mentions?: readonly MentionTarget[];
}

export interface TextContent {
  text: string;
  mentions?: MentionTarget[];
}

export interface ImageContent {
  image: MediaSource;
  caption?: string;
  mentions?: MentionTarget[];
  viewOnce?: boolean;
}

export interface VideoContent {
  video: MediaSource;
  caption?: string;
  mentions?: MentionTarget[];
  viewOnce?: boolean;
  gif?: boolean;
}

export interface AudioContent {
  audio: MediaSource;
  mimetype?: string;
  voice?: boolean;
}

export interface StickerContent {
  sticker: MediaSource;
}

export type MessageContent = 
  | TextContent 
  | ImageContent 
  | VideoContent 
  | AudioContent
  | StickerContent;
