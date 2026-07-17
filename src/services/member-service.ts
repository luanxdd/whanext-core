import { WhaNextError } from '@/errors/error.js';
import type {
  ChangeResult,
  GroupParticipant,
  GroupSnapshot,
  MemberActionState,
} from '@/models/group.js';
import { identitiesMatch } from '@/models/identity.js';
import type { User } from '@/models/user.js';
import type { WhatsAppProvider } from '@/provider/provider.js';
import type { GroupService } from '@/services/group-service.js';

export class MemberService {
  readonly #provider: WhatsAppProvider;
  readonly #group: GroupService;

  constructor(provider: WhatsAppProvider, group: GroupService) {
    this.#provider = provider;
    this.#group = group;
  }

  async remove(groupId: string, member: string | User): Promise<ChangeResult<MemberActionState>> {
    const { group, participant } = await this.#participant(groupId, member);

    if (!participant) {
      return { ok: true, changed: false, state: 'already_removed' };
    }

    await this.#update(groupId, this.#actionId(group, participant), 'remove');
    await this.#group.invalidate(groupId);
    return { ok: true, changed: true, state: 'removed' };
  }

  async promote(groupId: string, member: string | User): Promise<ChangeResult<MemberActionState>> {
    const { group, participant } = await this.#participant(groupId, member);

    if (!participant) {
      return { ok: true, changed: false, state: 'not_in_group' };
    }

    if (participant.role === 'admin' || participant.role === 'owner') {
      return { ok: true, changed: false, state: 'already_admin' };
    }

    await this.#update(groupId, this.#actionId(group, participant), 'promote');
    await this.#group.invalidate(groupId);
    return { ok: true, changed: true, state: 'promoted' };
  }

  async demote(groupId: string, member: string | User): Promise<ChangeResult<MemberActionState>> {
    const { group, participant } = await this.#participant(groupId, member);

    if (!participant) {
      return { ok: true, changed: false, state: 'not_in_group' };
    }

    if (participant.role === 'member') {
      return { ok: true, changed: false, state: 'not_admin' };
    }

    await this.#update(groupId, this.#actionId(group, participant), 'demote');
    await this.#group.invalidate(groupId);
    return { ok: true, changed: true, state: 'demoted' };
  }

  async #participant(groupId: string, member: string | User): Promise<{
    group: GroupSnapshot;
    participant: GroupParticipant | undefined;
  }> {
    const group = await this.#group.metadata(groupId);
    const memberIds = typeof member === 'string' ? [member] : member.identities;
    const participant = group.participants.find((item) =>
      [item.id, item.lid, item.phoneNumber]
        .filter((identity): identity is string => identity !== undefined)
        .some((identity) =>
          memberIds.some((memberId) => identitiesMatch(identity, memberId))));
    return { group, participant };
  }

  #actionId(group: GroupSnapshot, participant: GroupParticipant): string {
    if (group.addressingMode === 'lid') {
      return participant.lid
        ?? (participant.id.endsWith('@lid')
          ? participant.id
          : participant.phoneNumber ?? participant.id);
    }

    return participant.phoneNumber
      ?? (participant.id.endsWith('@s.whatsapp.net')
        ? participant.id
        : participant.lid ?? participant.id);
  }

  async #update(
    groupId: string,
    memberId: string,
    action: 'remove' | 'promote' | 'demote',
  ): Promise<void> {
    const result = await this.#provider.updateParticipant(groupId, memberId, action);

    if (!result.success) {
      throw new WhaNextError(
        'PROVIDER_ERROR',
        `WhatsApp rejected the member action with status ${result.status}.`,
        {
          context: { groupId, memberId, action, status: result.status },
          recoverable: true,
        },
      );
    }
  }
}
