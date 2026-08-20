import type { WaIncomingMessageEvent } from 'zapo-js';
import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  extractQuotedZapoMessage,
  normalizeZapoMessage,
} from '@/provider/zapo/normalize-message.js';

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

  it('extracts raw quoted messages for media caching', () => {
    const raw = createMessage({
      extendedTextMessage: {
        text: '&fig',
        contextInfo: {
          stanzaId: 'quoted-cache-id',
          participant: '5511888888888@s.whatsapp.net',
          quotedMessage: {
            viewOnceMessageV2Extension: {
              message: {
                imageMessage: { mimetype: 'image/jpeg' },
              },
            },
          },
        },
      },
    });

    expect(extractQuotedZapoMessage(raw)).toMatchObject({
      key: {
        id: 'quoted-cache-id',
        remoteJid: '5511999999999@s.whatsapp.net',
        participant: '5511888888888@s.whatsapp.net',
      },
      message: {
        viewOnceMessageV2Extension: expect.any(Object),
      },
    });
  });

  it('supports viewOnceMessageV2Extension on quoted media', () => {
    const message = normalizeZapoMessage(createMessage({
      extendedTextMessage: {
        text: '&fig',
        contextInfo: {
          stanzaId: 'view-once-extension-id',
          participant: '5511888888888@s.whatsapp.net',
          quotedMessage: {
            viewOnceMessageV2Extension: {
              message: {
                imageMessage: {
                  mimetype: 'image/jpeg',
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
      contentKind: 'image',
      media: {
        kind: 'image',
        mimetype: 'image/jpeg',
        viewOnce: true,
      },
      key: {
        id: 'view-once-extension-id',
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

  it.each([
    'sendPaymentMessage',
    'requestPaymentMessage',
    'paymentInviteMessage',
    'cancelPaymentRequestMessage',
    'declinePaymentRequestMessage',
    'invoiceMessage',
    'paymentReminderMessage',
    'splitPaymentMessage',
    'splitPaymentUpdateMessage',
  ] as const)('exposes %s as a payment payload', (protocolKind) => {
    const message = normalizeZapoMessage(createMessage({
      [protocolKind]: {},
    }));

    expect(message).toMatchObject({
      contentKind: 'payment',
      protocolKinds: [protocolKind],
      payloadKinds: ['payment_payload'],
    });
  });

  it.each([
    'groupStatusMessage',
    'groupStatusMessageV2',
    'groupStatusMentionMessage',
    'groupMentionedMessage',
  ] as const)('unwraps %s and preserves the protocol signal', (protocolKind) => {
    const message = normalizeZapoMessage(createMessage({
      [protocolKind]: {
        message: {
          conversation: 'status do grupo',
        },
      },
    }));

    expect(message).toMatchObject({
      contentKind: 'text',
      text: 'status do grupo',
      protocolKinds: [protocolKind],
      payloadKinds: ['group_status_payload'],
    });
  });

  it('preserves nested group status and payment signals together', () => {
    const message = normalizeZapoMessage(createMessage({
      groupStatusMessageV2: {
        message: {
          requestPaymentMessage: {
            currencyCodeIso4217: 'BRL',
            amount1000: 1000,
          },
        },
      },
    }));

    expect(message?.contentKind).toBe('payment');
    expect(message?.protocolKinds).toEqual([
      'groupStatusMessageV2',
      'requestPaymentMessage',
    ]);
    expect(message?.payloadKinds).toEqual([
      'group_status_payload',
      'payment_payload',
    ]);
  });

  it.each([
    'productMessage',
    'orderMessage',
  ] as const)('exposes %s as catalog_message', (protocolKind) => {
    const message = normalizeZapoMessage(createMessage({
      [protocolKind]: {},
    }));

    expect(message?.protocolKinds).toEqual([protocolKind]);
    expect(message?.payloadKinds).toEqual(['catalog_message']);
    expect(message?.contentKind).toBe('catalog');
  });

  it.each([
    'payment_info',
    'review_and_pay',
  ] as const)('detects embedded native-flow payment card %s', (name) => {
    const message = normalizeZapoMessage(createMessage({
      interactiveMessage: {
        body: { text: 'Pagamento' },
        nativeFlowMessage: {
          messageVersion: 1,
          buttons: [{
            name,
            buttonParamsJson: JSON.stringify({
              currency: 'BRL',
              reference_id: 'PAY-1',
            }),
          }],
        },
      },
    }));

    expect(message).toMatchObject({
      contentKind: 'payment',
      text: 'Pagamento',
      payloadKinds: ['payment_info_embedded'],
    });
  });

  it('exposes payment classification on quoted messages', () => {
    const message = normalizeZapoMessage(createMessage({
      extendedTextMessage: {
        text: 'reply',
        contextInfo: {
          stanzaId: 'quoted-payment-id',
          participant: '5511888888888@s.whatsapp.net',
          quotedMessage: {
            requestPaymentMessage: {
              currencyCodeIso4217: 'BRL',
              amount1000: 5000,
            },
          },
        },
      },
    }));

    expect(message?.quoted).toMatchObject({
      contentKind: 'payment',
      protocolKinds: ['requestPaymentMessage'],
      payloadKinds: ['payment_payload'],
    });
  });

  it('marks malformed native-flow JSON without throwing', () => {
    const message = normalizeZapoMessage(createMessage({
      interactiveResponseMessage: {
        nativeFlowResponseMessage: {
          name: 'quick_reply',
          paramsJson: '{not-json',
        },
      },
    }));

    expect(message?.contentKind).toBe('text');
    expect(message?.payloadKinds).toEqual(['malformed_payload']);
  });

  it('marks oversized native-flow JSON as a crash-risk malformed payload', () => {
    const message = normalizeZapoMessage(createMessage({
      interactiveResponseMessage: {
        nativeFlowResponseMessage: {
          name: 'quick_reply',
          paramsJson: JSON.stringify({ data: 'x'.repeat(128 * 1024) }),
        },
      },
    }));

    expect(message?.payloadKinds).toEqual([
      'native_flow_crash',
      'malformed_payload',
    ]);
  });

  it('marks an empty group status future-proof wrapper as malformed', () => {
    const message = normalizeZapoMessage(createMessage({
      groupStatusMessage: {},
    }));

    expect(message).toMatchObject({
      contentKind: 'unknown',
      protocolKinds: ['groupStatusMessage'],
      payloadKinds: ['group_status_payload', 'malformed_payload'],
    });
  });

});
