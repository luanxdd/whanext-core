import {
  describe,
  expect,
  it,
} from 'vitest';
import { create } from '@/index.js';
import { FakeProvider } from './fake-provider.js';

describe('group and member services', () => {
  it('avoids repeating a group state operation', async () => {
    const provider = new FakeProvider();
    const app = await create({ provider });

    expect(await app.group.close('123@g.us')).toEqual({ ok: true, changed: true, state: 'closed' });
    expect(await app.group.close('123@g.us')).toEqual({
      ok: true,
      changed: false,
      state: 'already_closed',
    });
    expect(provider.calls.setGroupAccess).toBe(1);
  });

  it('caches group metadata within the app instance', async () => {
    const provider = new FakeProvider();
    const app = await create({ provider });

    await app.group.metadata('123@g.us');
    await app.group.metadata('123@g.us');

    expect(provider.calls.getGroup).toBe(1);
  });

  it('coalesces simultaneous metadata requests for the same group', async () => {
    const provider = new FakeProvider();
    const app = await create({ provider });

    await Promise.all([
      app.group.metadata('123@g.us'),
      app.group.metadata('123@g.us'),
      app.group.metadata('123@g.us'),
    ]);

    expect(provider.calls.getGroup).toBe(1);
  });

  it('returns a typed state when a member is already an admin', async () => {
    const provider = new FakeProvider();
    const app = await create({ provider });

    const result = await app.member.promote('123@g.us', '5511999999999@s.whatsapp.net');

    expect(result).toEqual({ ok: true, changed: false, state: 'already_admin' });
    expect(provider.calls.updateParticipant).toBe(0);
  });

  it('uses the participant LID for mutations in LID groups', async () => {
    const provider = new FakeProvider();
    const app = await create({ provider });

    const result = await app.member.promote('123@g.us', '5511000000000@s.whatsapp.net');

    expect(result).toEqual({ ok: true, changed: true, state: 'promoted' });
    expect(provider.calls.participantIds).toEqual(['200000000000001@lid']);
  });

  it('throws when WhatsApp rejects a member mutation', async () => {
    const provider = new FakeProvider();
    provider.participantUpdateStatus = '403';
    const app = await create({ provider });

    await expect(app.member.promote('123@g.us', '5511000000000@s.whatsapp.net'))
      .rejects.toMatchObject({ code: 'PROVIDER_ERROR', context: { status: '403' } });
  });
});
