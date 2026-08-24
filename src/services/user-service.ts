import type { ArgsParser } from '@/commands/args-parser.js';
import type { Message } from '@/models/message.js';
import { User } from '@/models/user.js';
import type { WhatsAppProvider } from '@/provider/provider.js';
import type { GroupService } from '@/services/group-service.js';

export class UserService {
  readonly #group: GroupService;
  readonly #provider: WhatsAppProvider | undefined;

  constructor(group: GroupService, provider?: WhatsAppProvider) {
    this.#group = group;
    this.#provider = provider;
  }

  async resolve(message: Message, args: ArgsParser): Promise<User> {
    const mentioned = message.mentionedUsers[0];
    let user: User;

    if (mentioned) {
      if (args.peek()?.startsWith('@')) {
        args.skip();
      }

      user = mentioned;
    } else if (message.quoted?.sender) {
      user = message.quoted.sender;
    } else {
      user = args.user('membro');
    }

    return this.#group.resolveUser(message.chatId, user);
  }


  async profilePictureUrl(user: string | User): Promise<string | undefined> {
    const provider = this.#provider;
    if (!provider?.getProfilePictureUrl) return undefined;

    const target = typeof user === 'string' ? this.from(user) : user;
    const identities = [
      target.jid,
      target.phoneNumber,
      target.lid,
      target.id,
      ...target.identities,
    ].filter((identity, index, values): identity is string =>
      identity !== undefined && values.indexOf(identity) === index);

    for (const identity of identities) {
      try {
        const url = await provider.getProfilePictureUrl(identity);
        if (url) return url;
      } catch {
        // Profile photos are privacy-gated. Try another known identity, then fall back.
      }
    }

    return undefined;
  }

  from(identity: string): User {
    if (!identity.includes('@')) {
      return User.fromPhoneNumber(identity);
    }

    return User.fromIdentities([identity]);
  }
}
