import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  create,
  defineCommand,
  User,
  type Message,
  type MuteStore,
  type StoredMute,
} from '@/index.js';
import { FakeProvider } from './fake-provider.js';

class MemoryMuteStore implements MuteStore {
  readonly records: StoredMute[] = [];

  upsert(mute: StoredMute): void {
    this.delete(mute.groupId, mute.identities);
    this.records.push(structuredClone(mute));
  }

  find(groupId: string, identities: readonly string[]): StoredMute | undefined {
    return this.records.find((record) =>
      record.groupId === groupId && this.matches(record, identities));
  }

  delete(groupId: string, identities: readonly string[]): boolean {
    const index = this.records.findIndex((record) =>
      record.groupId === groupId && this.matches(record, identities));

    if (index === -1) {
      return false;
    }

    this.records.splice(index, 1);
    return true;
  }

  purgeExpired(now: number): number {
    const active = this.records.filter((record) =>
      record.expiresAt === null || record.expiresAt > now);
    const removed = this.records.length - active.length;
    this.records.splice(0, this.records.length, ...active);
    return removed;
  }

  private matches(record: StoredMute, identities: readonly string[]): boolean {
    return identities.some((identity) => new User(record.user).matches(identity));
  }
}

const groupId = '123@g.us';
const phoneId = '5511000000000@s.whatsapp.net';
const lid = '200000000000001@lid';

function incoming(text = '!ping'): Message {
  const sender = new User({
    id: lid,
    identities: [lid, phoneId],
    jid: phoneId,
    lid,
    phoneNumber: phoneId,
    name: 'Membro',
  });

  return {
    id: `message-${text}`,
    jid: groupId,
    chatId: groupId,
    senderId: sender.id,
    senderIds: sender.identities,
    senderJid: phoneId,
    senderLid: lid,
    sender,
    keys: {
      id: `message-${text}`,
      chatId: groupId,
      fromMe: false,
      participantId: lid,
    },
    text,
    mentions: [],
    mentionedUsers: [],
    timestamp: new Date(),
    isGroup: true,
    isReply: false,
    isViewOnce: false,
    hasMedia: false,
  };
}

describe('native mute', () => {
  it('persists indefinite mutes in the built-in SQLite store', async () => {
    const provider = new FakeProvider();
    const app = await create({
      provider,
      mute: {
        enabled: true,
        database: ':memory:',
      },
    });
    const user = new User({
      id: lid,
      identities: [lid, phoneId],
      jid: phoneId,
      lid,
      phoneNumber: phoneId,
    });

    const first = await app.mute.add(groupId, user);
    const repeated = await app.mute.add(groupId, user);

    expect(first).toMatchObject({ changed: true, state: 'muted' });
    expect(repeated).toMatchObject({ changed: false, state: 'already_muted' });
    expect(await app.mute.isMuted(groupId, user)).toBe(true);
    expect((await app.mute.get(groupId, user))?.expiresAt).toBeNull();

    await app.disconnect();
  });

  it('deletes muted messages before they reach commands', async () => {
    const provider = new FakeProvider();
    const store = new MemoryMuteStore();
    const app = await create({ provider, mute: { store } });
    const execute = vi.fn();
    const onMute = vi.fn();
    const message = incoming();
    app.on('mute', onMute);
    app.router().command(defineCommand({
      name: 'ping',
      description: 'Test command.',
      execute,
    }));

    await app.mute.add(groupId, message.sender, { durationMs: 60_000 });
    await provider.events.emit('message', message);

    expect(provider.deleted).toEqual([message.keys]);
    expect(onMute).toHaveBeenCalledWith(expect.objectContaining({ message }));
    expect(execute).not.toHaveBeenCalled();
  });

  it('lets messages through after unmute or expiration', async () => {
    const provider = new FakeProvider();
    const store = new MemoryMuteStore();
    const app = await create({ provider, mute: { store } });
    const execute = vi.fn();
    const message = incoming();
    app.router().command(defineCommand({
      name: 'ping',
      description: 'Test command.',
      execute,
    }));

    await app.mute.add(groupId, message.sender);
    await app.mute.remove(groupId, message.sender);
    await provider.events.emit('message', message);
    expect(execute).toHaveBeenCalledOnce();

    await app.mute.add(groupId, message.sender, { durationMs: 60_000 });
    const stored = store.records[0];

    if (stored) {
      stored.expiresAt = Date.now() - 1;
    }

    await provider.events.emit('message', {
      ...message,
      id: 'message-expired',
      keys: {
        ...message.keys,
        id: 'message-expired',
      },
    });

    expect(execute).toHaveBeenCalledTimes(2);
    expect(store.records).toHaveLength(0);
  });

  it('normalizes errors from custom stores', async () => {
    const provider = new FakeProvider();
    const store: MuteStore = {
      upsert() {},
      find() {
        throw new Error('Database unavailable.');
      },
      delete() {
        return false;
      },
      purgeExpired() {
        return 0;
      },
    };
    const app = await create({ provider, mute: { store } });
    const user = User.fromIdentities([phoneId]);

    await expect(app.mute.add(groupId, user)).rejects.toMatchObject({
      code: 'STORAGE_ERROR',
      context: {
        action: 'find',
        groupId,
      },
      recoverable: true,
    });
  });
});
