import type { WaIncomingMessageEvent } from 'zapo-js';
import {
  describe,
  expect,
  it,
} from 'vitest';
import { normalizeZapoMessage } from '@/provider/zapo/normalize-message.js';

function createMessage(message: Record<string, unknown>): WaIncomingMessageEvent {
  return {
    key: {
      id: 'message-id',
      remoteJid: '5511999999999@s.whatsapp.net',
      fromMe: false,
    },
    message,
    timestampSeconds: 1,
  } as unknown as WaIncomingMessageEvent;
}

describe('Zapo message content classification', () => {
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
    const message = normalizeZapoMessage(createMessage(payload));

    expect(message?.contentKind).toBe(expected);
  });

  it('resolves the phone number from remoteJidAlt in private LID chats', () => {
    const message = normalizeZapoMessage({
      key: {
        id: 'private-lid-message',
        remoteJid: '192758887264324@lid',
        remoteJidAlt: '5531995724651@s.whatsapp.net',
        fromMe: false,
      },
      message: {
        conversation: '×login',
      },
      timestampSeconds: 1,
    } as unknown as WaIncomingMessageEvent);

    expect(message).toBeDefined();
    expect(message?.senderId).toBe('5531995724651@s.whatsapp.net');
    expect(message?.senderIds).toEqual([
      '5531995724651@s.whatsapp.net',
      '192758887264324@lid',
    ]);
    expect(message?.sender.jid).toBe('5531995724651@s.whatsapp.net');
    expect(message?.sender.lid).toBe('192758887264324@lid');
    expect(message?.sender.phone).toBe('5531995724651');
  });

  it('uses participantAlt to preserve PN and LID identities in groups', () => {
    const message = normalizeZapoMessage({
      key: {
        id: 'group-lid-message',
        remoteJid: '120363000000000000@g.us',
        participant: '192758887264324@lid',
        participantAlt: '5531995724651@s.whatsapp.net',
        fromMe: false,
      },
      message: { conversation: 'oi' },
      timestampSeconds: 1,
    } as unknown as WaIncomingMessageEvent);

    expect(message?.senderId).toBe('5531995724651@s.whatsapp.net');
    expect(message?.senderIds).toEqual([
      '192758887264324@lid',
      '5531995724651@s.whatsapp.net',
    ]);
    expect(message?.senderLid).toBe('192758887264324@lid');
    expect(message?.senderJid).toBe('5531995724651@s.whatsapp.net');
  });

  it('does not treat remoteJidAlt as the sender of fromMe private messages', () => {
    const message = normalizeZapoMessage({
      key: {
        id: 'private-from-me',
        remoteJid: '192758887264324@lid',
        remoteJidAlt: '5531888888888@s.whatsapp.net',
        fromMe: true,
      },
      message: {
        conversation: 'mensagem enviada',
      },
      timestampSeconds: 1,
    } as unknown as WaIncomingMessageEvent);

    expect(message).toBeDefined();
    expect(message?.sender.phone).toBeUndefined();
    expect(message?.senderId).toBe('192758887264324@lid');
  });

  it('preserves view-once metadata from the Zapo wrapper', () => {
    const message = normalizeZapoMessage(createMessage({
      viewOnceMessageV2: {
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
    const message = normalizeZapoMessage(createMessage({
      extendedTextMessage: {
        text: 'kkkk',
        contextInfo: {
          stanzaId: 'view-once-id',
          participant: '5511888888888@s.whatsapp.net',
          quotedMessage: {
            viewOnceMessageV2: {
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
    const message = normalizeZapoMessage(createMessage({
      imageMessage: {
        mimetype: 'image/jpeg',
        caption: 'photo',
      },
    }));

    expect(message).toMatchObject({
      contentKind: 'image',
      hasMedia: true,
      caption: 'photo',
      media: {
        kind: 'image',
        mimetype: 'image/jpeg',
      },
    });
  });
});
