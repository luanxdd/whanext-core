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
 * contacts, polls and catalog/product messages without leaking provider-specific protocol types.
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
  | 'payment'
  | 'unknown';

export type MessageProtocolKind =
  | 'groupStatusMessage'
  | 'groupStatusMessageV2'
  | 'groupStatusMentionMessage'
  | 'groupMentionedMessage'
  | 'productMessage'
  | 'orderMessage'
  | 'sendPaymentMessage'
  | 'requestPaymentMessage'
  | 'paymentInviteMessage'
  | 'cancelPaymentRequestMessage'
  | 'declinePaymentRequestMessage'
  | 'invoiceMessage'
  | 'paymentReminderMessage'
  | 'splitPaymentMessage'
  | 'splitPaymentUpdateMessage';

export type MessagePayloadKind =
  | 'catalog_message'
  | 'payment_payload'
  | 'group_status_payload'
  | 'payment_info_embedded'
  | 'native_flow_crash'
  | 'malformed_payload';

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
  isViewOnce?: boolean;
  contentKind?: MessageContentKind;
  protocolKinds?: MessageProtocolKind[];
  payloadKinds?: MessagePayloadKind[];
  media?: MessageMedia;
}

export type InteractiveResponseKind = 'button' | 'list';

export interface InteractiveResponse {
  kind: InteractiveResponseKind;
  id: string;
  title?: string;
}

export interface MessageDeleted {
  key: MessageKey;
  message?: Message;
  deletedByMe: boolean;
  deletedById?: string;
  deletedAt: Date;
}

export interface MessageEdited {
  key: MessageKey;
  previous?: Message;
  message: Message;
  editedByMe: boolean;
  editedById?: string;
  editedAt: Date;
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
  protocolKinds?: MessageProtocolKind[];
  payloadKinds?: MessagePayloadKind[];
  media?: MessageMedia;
  quoted?: QuotedMessage;
  interactive?: InteractiveResponse;
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

export interface LinkButton {
  type: 'link';
  label: string;
  url: string;
}

export interface CopyCodeButton {
  type: 'copy';
  label: string;
  code: string;
}

export interface QuickReplyButton {
  type: 'reply';
  label: string;
  id: string;
}

export type MessageButton =
  | LinkButton
  | CopyCodeButton
  | QuickReplyButton;

export interface ButtonsContent {
  text: string;
  buttons: MessageButton[];
  title?: string;
  footer?: string;
  mentions?: MentionTarget[];
}

export interface ListRow {
  id: string;
  title: string;
  description?: string;
}

export interface ListSection {
  title?: string;
  rows: readonly ListRow[];
}

export interface ListContent {
  list: readonly ListSection[];
  text: string;
  buttonText: string;
  title?: string;
  footer?: string;
  mentions?: MentionTarget[];
}

export interface PollContent {
  poll: string;
  options: readonly string[];
  selectableCount?: number;
  allowAddOption?: boolean;
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
  | ButtonsContent
  | ListContent
  | PollContent
  | ImageContent 
  | VideoContent 
  | AudioContent
  | StickerContent;
