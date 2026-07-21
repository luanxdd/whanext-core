import type { ArgsParser } from '@/commands/args-parser.js';
import type { Message } from '@/models/message.js';
import { User } from '@/models/user.js';
import type { GroupService } from '@/services/group-service.js';

export class UserService {
  readonly #group: GroupService;

  constructor(group: GroupService) {
    this.#group = group;
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

  from(identity: string): User {
    if (!identity.includes('@')) {
      return User.fromPhoneNumber(identity);
    }

    return User.fromIdentities([identity]);
  }
}
