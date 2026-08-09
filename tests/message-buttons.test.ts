import { describe, expect, it } from 'vitest';

import { MessageService } from '@/services/message-service.js';
import { FakeProvider } from './fake-provider.js';

describe('MessageService.buttons', () => {
  it('delegates typed copy and link buttons to the provider', async () => {
    const provider = new FakeProvider();
    const service = new MessageService(provider);
    const content = {
      title: 'Acesso',
      text: 'Escolha uma ação.',
      footer: 'WhaNext',
      buttons: [
        { type: 'copy' as const, label: 'Copiar código', code: 'ABC-123' },
        { type: 'link' as const, label: 'Abrir painel', url: 'https://example.com' },
      ],
    };

    const sent = await service.buttons('123@g.us', content);

    expect(sent.chatId).toBe('123@g.us');
    expect(provider.sent).toEqual([
      {
        chatId: '123@g.us',
        content,
      },
    ]);
  });
});
