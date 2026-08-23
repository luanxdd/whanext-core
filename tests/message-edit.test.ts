import { describe, expect, it } from 'vitest';

import { MessageService } from '@/services/message-service.js';
import { FakeProvider } from './fake-provider.js';

describe('MessageService.edit', () => {
  it('forwards an optional outgoing stanza id override to the provider', async () => {
    const provider = new FakeProvider();
    const service = new MessageService(provider);
    const key = { id: 'temporary-message', chatId: '123@g.us', fromMe: true };

    await service.edit(key, '', { id: 'payment-message' });

    expect(provider.edited).toEqual([
      {
        key,
        text: '',
        options: { id: 'payment-message' },
      },
    ]);
  });
});
