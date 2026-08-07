import { describe, expect, it } from 'vitest';

import { MessageService } from '@/services/message-service.js';
import { User } from '@/models/user.js';
import { FakeProvider } from './fake-provider.js';

describe('MessageService.repost', () => {
  it('delegates the original key, destination chat and mentions to the provider', async () => {
    const provider = new FakeProvider();
    const service = new MessageService(provider);
    const source = { id: 'source-1', chatId: '123@g.us', fromMe: false };
    const users = [User.fromPhoneNumber('5511999999999')];

    const sent = await service.repost(source, '123@g.us', { mentions: users });

    expect(sent.chatId).toBe('123@g.us');
    expect(provider.reposted).toHaveLength(1);
    expect(provider.reposted[0]?.source).toEqual(source);
    expect(provider.reposted[0]?.options.mentions).toEqual(users);
  });
});
