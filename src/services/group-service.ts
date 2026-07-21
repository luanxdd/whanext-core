import type { CacheStore } from '@/cache/cache-store.js';
import type {
  ChangeResult,
  GroupAccess,
  GroupSnapshot,
  InviteResult,
} from '@/models/group.js';
import { identitiesMatch } from '@/models/identity.js';
import type { MessageKey } from '@/models/message.js';
import { User } from '@/models/user.js';
import type { WhatsAppProvider } from '@/provider/provider.js';

export class GroupService {
  readonly #provider: WhatsAppProvider;
  readonly #cache: CacheStore;
  readonly #ttlMs: number;

  constructor(provider: WhatsAppProvider, cache: CacheStore, ttlMs = 300_000) {
    this.#provider = provider;
    this.#cache = cache;
    this.#ttlMs = ttlMs;
  }

  async open(groupId: string): Promise<ChangeResult<'open' | 'already_open'>> {
    const group = await this.metadata(groupId);

    if (group.access === 'open') {
      return { ok: true, changed: false, state: 'already_open' };
    }

    await this.#provider.setGroupAccess(groupId, 'open');
    await this.invalidate(groupId);
    return { ok: true, changed: true, state: 'open' };
  }

  async close(groupId: string): Promise<ChangeResult<'closed' | 'already_closed'>> {
    const group = await this.metadata(groupId);

    if (group.access === 'closed') {
      return { ok: true, changed: false, state: 'already_closed' };
    }

    await this.#provider.setGroupAccess(groupId, 'closed');
    await this.invalidate(groupId);
    return { ok: true, changed: true, state: 'closed' };
  }

  async invite(groupId: string): Promise<InviteResult> {
    const code = await this.#provider.getGroupInviteCode(groupId);
    return { ok: true, code, url: `https://chat.whatsapp.com/${code}` };
  }

  async revokeInvite(groupId: string): Promise<InviteResult> {
    const code = await this.#provider.revokeGroupInvite(groupId);
    return { ok: true, code, url: `https://chat.whatsapp.com/${code}` };
  }

  async pin(groupId: string, key: MessageKey): Promise<ChangeResult<'pinned'>> {
    await this.#provider.setMessagePin(groupId, key, true);
    return { ok: true, changed: true, state: 'pinned' };
  }

  async unpin(groupId: string, key: MessageKey): Promise<ChangeResult<'unpinned'>> {
    await this.#provider.setMessagePin(groupId, key, false);
    return { ok: true, changed: true, state: 'unpinned' };
  }

  async metadata(groupId: string, refresh = false): Promise<GroupSnapshot> {
    const key = this.#key(groupId);

    if (!refresh) {
      const cached = await this.#cache.get<GroupSnapshot>(key);

      if (cached) {
        return cached;
      }
    }

    const group = await this.#provider.getGroup(groupId);
    await this.#cache.set(key, group, this.#ttlMs);
    return group;
  }

  async isAdmin(
    groupId: string,
    memberIds: string | readonly string[],
  ): Promise<boolean> {
    if (!groupId.endsWith('@g.us')) {
      return false;
    }

    const group = await this.metadata(groupId);
    const identities = typeof memberIds === 'string' ? [memberIds] : memberIds;
    const participant = group.participants.find((item) =>
      this.#matchesParticipant(item, identities));
    return participant?.role === 'admin' || participant?.role === 'owner';
  }

  async isCurrentUserAdmin(groupId: string): Promise<boolean> {
    const ids = this.#provider.getCurrentUserIds();

    if (ids.length === 0 || !groupId.endsWith('@g.us')) {
      return false;
    }

    const group = await this.metadata(groupId);
    return group.participants.some((participant) =>
      this.#matchesParticipant(participant, ids)
      && (participant.role === 'admin' || participant.role === 'owner'));
  }

  async resolveUser(groupId: string, user: User): Promise<User> {
    if (!groupId.endsWith('@g.us')) {
      return user;
    }

    const group = await this.metadata(groupId);
    const participant = group.participants.find((item) =>
      this.#matchesParticipant(item, user.identities));

    if (!participant) {
      return user;
    }

    return new User({
      id: participant.id,
      identities: [
        participant.id,
        ...(participant.lid ? [participant.lid] : []),
        ...(participant.phoneNumber ? [participant.phoneNumber] : []),
      ],
      ...(participant.lid ? { lid: participant.lid } : {}),
      ...(participant.phoneNumber ? {
        jid: participant.phoneNumber,
        phoneNumber: participant.phoneNumber,
      } : {}),
      ...(user.name ? { name: user.name } : {}),
    });
  }

  invalidate(groupId: string): Promise<void> {
    return this.#cache.delete(this.#key(groupId));
  }

  #key(groupId: string): string {
    return `group:${groupId}`;
  }

  #matchesParticipant(
    participant: GroupSnapshot['participants'][number],
    identities: readonly string[],
  ): boolean {
    const participantIds = [participant.id, participant.lid, participant.phoneNumber]
      .filter((identity): identity is string => identity !== undefined);
    return identities.some((identity) =>
      participantIds.some((participantId) =>
        identitiesMatch(identity, participantId)));
  }
}
