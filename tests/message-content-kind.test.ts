import type { WAMessage } from '@whiskeysockets/baileys';
import {
  describe,
  expect,
  it,
} from 'vitest';
import { normalizeBaileysMessage } from '@/provider/baileys/normalize-message.js';

function createMessage(message: Record<string, unknown>): WAMessage {
  return {
    key: {
      id: 'message-id',
      remoteJid: '5511999999999@s.whatsapp.net',
      fromMe: false,
    },
    message,
    messageTimestamp: 1,
  } as unknown as WAMessage;
}

describe('Baileys message content classification', () => {
  it.each([
    [{ conversation: 'hello' }, 'text'],
    [{ extendedTextMessage: { text: 'hello' } }, 'text'],
    [{ imageMessage: { mimetype: 'image/jpeg' } }, 'image'],
    [{ videoMessage: { mimetype: 'video/mp4' } }, 'video'],
    [{ audioMessage: { mimetype: 'audio/ogg' } }, 'audio'],
    [{ documentMessage: { mimetype: 'application/pdf' } }, 'document'],
    [{ stickerMessage: { mimetype: 'image/webp' } }, 'sticker'],
    [{ locationMessage: { degreesLatitude: -23.5, degreesLongitude: -46.6 } }, 'location'],
    [{ liveLocationMessage: { degreesLatitude: -23.5, degreesLongitude: -46.6 } }, 'location'],
    [{ contactMessage: { displayName: 'Lili', vcard: 'BEGIN:VCARD' } }, 'contact'],
    [{ contactsArrayMessage: { displayName: 'Equipe', contacts: [] } }, 'contact'],
    [{ pollCreationMessage: { name: 'Escolha', options: [] } }, 'poll'],
    [{ productMessage: { product: {} } }, 'catalog'],
    [{ orderMessage: {} }, 'catalog'],
    [{ reactionMessage: { text: '👍' } }, 'unknown'],
  ] as const)('%j -> %s', (payload, expected) => {
    const message = normalizeBaileysMessage(createMessage(payload));

    expect(message?.contentKind).toBe(expected);
  });

  it('keeps media metadata independent from content classification', () => {
    const message = normalizeBaileysMessage(createMessage({
      imageMessage: {
        mimetype: 'image/jpeg',
        caption: 'photo',
      },
    }));

    expect(message).toMatchObject({
      contentKind: 'image',
      hasMedia: true,
      media: {
        kind: 'image',
        mimetype: 'image/jpeg',
      },
    });
  });
});
