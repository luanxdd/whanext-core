import type { User } from '@/models/user.js';

export interface MessageKey {
  id: string;
  chatId: string;
  fromMe: boolean;
  participantId?: string;
}

export type MediaKind = 'image' | 'video' | 'audio' | 'document' | 'sticker';

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
  media?: MessageMedia;
  quoted?: QuotedMessage;
}

export interface SentMessage {
  id: string;
  chatId: string;
  keys: MessageKey;
  timestamp: Date;
}

export type MediaSource = Uint8Array | { url: string } | { path: string };
export type MentionTarget = string | User;

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

export type MessageContent = TextContent | ImageContent | VideoContent | AudioContent;
