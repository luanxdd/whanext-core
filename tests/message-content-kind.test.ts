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


  it('preserves view-once metadata from the Baileys wrapper', () => {
    const message = normalizeBaileysMessage(createMessage({
      viewOnceMessageV2Extension: {
        message: {
          imageMessage: {
            mimetype: 'image/jpeg',
          },
        },
      },
    }));

    expect(message).toMatchObject({
      contentKind: 'image',
      hasMedia: true,
      isViewOnce: true,
      media: {
        kind: 'image',
        mimetype: 'image/jpeg',
        viewOnce: true,
      },
    });
  });

  it('exposes view-once metadata on quoted media', () => {
    const message = normalizeBaileysMessage(createMessage({
      extendedTextMessage: {
        text: 'kkkk',
        contextInfo: {
          stanzaId: 'view-once-id',
          participant: '5511888888888@s.whatsapp.net',
          quotedMessage: {
            viewOnceMessageV2Extension: {
              message: {
                videoMessage: {
                  mimetype: 'video/mp4',
                  seconds: 7,
                },
              },
            },
          },
        },
      },
    }));

    expect(message?.quoted).toMatchObject({
      hasMedia: true,
      isViewOnce: true,
      contentKind: 'video',
      media: {
        kind: 'video',
        mimetype: 'video/mp4',
        seconds: 7,
        viewOnce: true,
      },
      key: {
        id: 'view-once-id',
        chatId: '5511999999999@s.whatsapp.net',
        participantId: '5511888888888@s.whatsapp.net',
      },
    });
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
