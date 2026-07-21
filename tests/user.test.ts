import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  ArgsParser,
  create,
  User,
  type Message,
} from '@/index.js';
import { FakeProvider } from './fake-provider.js';

describe('User', () => {
  it('exposes normalized presentation data without string parsing', () => {
    const user = new User({
      id: '200000000000001@lid',
      identities: [
        '200000000000001@lid',
        '5511000000000@s.whatsapp.net',
      ],
      jid: '5511000000000@s.whatsapp.net',
      lid: '200000000000001@lid',
      phoneNumber: '5511000000000@s.whatsapp.net',
      name: 'João',
    });

    expect(user.mention).toBe('@5511000000000');
    expect(user.phone).toBe('5511000000000');
    expect(user.username).toBe('5511000000000');
    expect(user.displayName).toBe('João');
  });

  it('resolves mentions to every identity known by the group', async () => {
    const provider = new FakeProvider();
    const app = await create({ provider });
    const mentioned = User.fromIdentities(['200000000000001@lid']);
    const message = {
      chatId: '123@g.us',
      mentionedUsers: [mentioned],
    } as Message;
    const args = new ArgsParser(['@200000000000001']);

    const user = await app.user.resolve(message, args);

    expect(user.jid).toBe('5511000000000@s.whatsapp.net');
    expect(user.lid).toBe('200000000000001@lid');
    expect(user.mention).toBe('@5511000000000');
    expect(user.identities).toEqual(expect.arrayContaining([
      '200000000000001@lid',
      '5511000000000@s.whatsapp.net',
    ]));
    expect(args.remaining).toBe(0);
  });

  it('creates a mentionable user from a plain phone number', async () => {
    const provider = new FakeProvider();
    const app = await create({ provider });
    const user = app.user.from('+55 (11) 0000-0000');

    expect(user.jid).toBe('551100000000@s.whatsapp.net');
    expect(user.mention).toBe('@551100000000');
  });
});
