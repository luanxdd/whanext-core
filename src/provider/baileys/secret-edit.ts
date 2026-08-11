import { createDecipheriv, hkdfSync } from 'node:crypto';
import {
  jidNormalizedUser,
  normalizeMessageContent,
  proto,
  type WAMessage,
  type WAMessageKey,
} from '@whiskeysockets/baileys';

export interface DecryptedSecretEdit {
  message: proto.IMessage;
  timestamp?: number;
}

export function isSecretEncryptedEdit(message: WAMessage): boolean {
  const content = normalizeMessageContent(message.message);
  return content?.secretEncryptedMessage?.secretEncType
    === proto.Message.SecretEncryptedMessage.SecretEncType.MESSAGE_EDIT;
}

export function secretEditTargetKey(message: WAMessage): WAMessageKey | undefined {
  const content = normalizeMessageContent(message.message);
  const secret = content?.secretEncryptedMessage;

  if (
    secret?.secretEncType
      !== proto.Message.SecretEncryptedMessage.SecretEncType.MESSAGE_EDIT
    || !secret.targetMessageKey?.id
  ) {
    return undefined;
  }

  return secret.targetMessageKey as WAMessageKey;
}

export function decryptSecretEncryptedEdit(
  envelope: WAMessage,
  original: WAMessage,
  meId?: string,
  meLid?: string,
): DecryptedSecretEdit | undefined {
  const content = normalizeMessageContent(envelope.message);
  const secret = content?.secretEncryptedMessage;
  const targetKey = secret?.targetMessageKey as WAMessageKey | undefined;

  if (
    secret?.secretEncType
      !== proto.Message.SecretEncryptedMessage.SecretEncType.MESSAGE_EDIT
    || !targetKey?.id
    || !secret.encPayload?.length
    || secret.encIv?.length !== 12
  ) {
    return undefined;
  }

  const messageSecret = findMessageSecret(original.message);

  if (messageSecret?.length !== 32) {
    return undefined;
  }

  const editorCandidates = envelope.key.fromMe
    ? uniqueUserJids([meId, meLid])
    : uniqueUserJids([
        envelope.key.participant,
        envelope.key.participantAlt,
        envelope.key.remoteJid,
        envelope.key.remoteJidAlt,
      ]);

  const originalSenderCandidates = targetKey.fromMe
    ? editorCandidates
    : isUserJid(envelope.key.remoteJid)
      ? uniqueUserJids([
          targetKey.remoteJid,
          targetKey.remoteJidAlt,
          original.key.remoteJid,
          original.key.remoteJidAlt,
        ])
      : uniqueUserJids([
          targetKey.participant,
          targetKey.participantAlt,
          original.key.participant,
          original.key.participantAlt,
        ]);

  const fallbackOriginalCandidates = original.key.fromMe
    ? uniqueUserJids([meId, meLid])
    : uniqueUserJids([
        original.key.participant,
        original.key.participantAlt,
        original.key.remoteJid,
        original.key.remoteJidAlt,
      ]);

  const senders = uniqueUserJids([
    ...originalSenderCandidates,
    ...fallbackOriginalCandidates,
  ]);

  if (!editorCandidates.length || !senders.length) {
    return undefined;
  }

  let decoded: proto.Message | undefined;

  for (const originalSender of senders) {
    for (const editor of editorCandidates) {
      try {
        decoded = decryptPayload(
          targetKey.id,
          originalSender,
          editor,
          messageSecret,
          secret.encIv,
          secret.encPayload,
        );
        break;
      } catch {
        continue;
      }
    }

    if (decoded) {
      break;
    }
  }

  const protocol = decoded?.protocolMessage;

  if (
    protocol?.type !== proto.Message.ProtocolMessage.Type.MESSAGE_EDIT
    || !protocol.editedMessage
    || (protocol.key?.id && protocol.key.id !== targetKey.id)
  ) {
    return undefined;
  }

  const edited = protocol.editedMessage;

  if (!edited.messageContextInfo?.messageSecret?.length) {
    edited.messageContextInfo = {
      ...edited.messageContextInfo,
      messageSecret,
    };
  }

  return {
    message: edited,
    ...(protocol.timestampMs
      ? { timestamp: Math.floor(numberValue(protocol.timestampMs) / 1_000) }
      : {}),
  };
}

function decryptPayload(
  messageId: string,
  originalSender: string,
  editor: string,
  messageSecret: Uint8Array,
  iv: Uint8Array,
  payload: Uint8Array,
): proto.Message {
  const info = Buffer.concat([
    Buffer.from(messageId, 'utf8'),
    Buffer.from(originalSender, 'utf8'),
    Buffer.from(editor, 'utf8'),
    Buffer.from('Message Edit', 'utf8'),
  ]);
  const key = Buffer.from(hkdfSync(
    'sha256',
    Buffer.from(messageSecret),
    Buffer.alloc(32),
    info,
    32,
  ));
  const encrypted = Buffer.from(payload);

  if (encrypted.length <= 16) {
    throw new Error('INVALID_EDIT_PAYLOAD');
  }

  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv));
  decipher.setAAD(Buffer.alloc(0));
  decipher.setAuthTag(encrypted.subarray(encrypted.length - 16));

  return proto.Message.decode(Buffer.concat([
    decipher.update(encrypted.subarray(0, encrypted.length - 16)),
    decipher.final(),
  ]));
}

function findMessageSecret(message: proto.IMessage | null | undefined): Uint8Array | undefined {
  if (!message) {
    return undefined;
  }

  const direct = message.messageContextInfo?.messageSecret;

  if (direct?.length) {
    return direct;
  }

  const normalized = normalizeMessageContent(message);
  const normalizedSecret = normalized?.messageContextInfo?.messageSecret;

  if (normalizedSecret?.length) {
    return normalizedSecret;
  }

  const deviceSecret = message.deviceSentMessage?.message?.messageContextInfo?.messageSecret;

  if (deviceSecret?.length) {
    return deviceSecret;
  }

  return undefined;
}

function uniqueUserJids(values: Array<string | null | undefined>): string[] {
  return [...new Set(
    values
      .map(normalizeUserJid)
      .filter((value): value is string => value !== undefined),
  )];
}

function normalizeUserJid(value: string | null | undefined): string | undefined {
  if (!isUserJid(value)) {
    return undefined;
  }

  return jidNormalizedUser(value);
}

function isUserJid(value: string | null | undefined): value is string {
  if (!value) {
    return false;
  }

  const normalized = jidNormalizedUser(value);
  return normalized.endsWith('@s.whatsapp.net')
    || normalized.endsWith('@lid')
    || normalized.endsWith('@hosted')
    || normalized.endsWith('@hosted.lid');
}

function numberValue(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'bigint') {
    return Number(value);
  }

  if (value && typeof value === 'object' && 'toString' in value) {
    return Number(String(value));
  }

  return Number(value);
}
