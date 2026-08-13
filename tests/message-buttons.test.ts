import { describe, expect, it } from 'vitest';

import { MessageService } from '@/services/message-service.js';
import { FakeProvider } from './fake-provider.js';

describe('interactive messages', () => {
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
        { type: 'reply' as const, label: 'Abrir grupo', id: '&open' },
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

  it('delegates list menus and polls to the provider', async () => {
    const provider = new FakeProvider();
    const service = new MessageService(provider);
    const list = {
      title: 'Menu',
      text: 'Escolha uma ação.',
      buttonText: 'Abrir menu',
      footer: 'WhaNext',
      list: [
        {
          title: 'Grupo',
          rows: [
            { id: '&open', title: 'Abrir grupo' },
            { id: '&close', title: 'Fechar grupo', description: 'Somente admins' },
          ],
        },
      ],
    };
    const poll = {
      poll: 'Qual opção?',
      options: ['A', 'B', 'C'],
      selectableCount: 1,
    };

    await service.list('123@g.us', list);
    await service.poll('123@g.us', poll);

    expect(provider.sent[0]).toEqual({ chatId: '123@g.us', content: list });
    expect(provider.sent[1]).toEqual({ chatId: '123@g.us', content: poll });
  });

});
