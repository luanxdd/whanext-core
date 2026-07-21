import {
  identityPhoneNumber,
  identityUsername,
  identitiesMatch,
  uniqueIdentities,
} from '@/models/identity.js';

export interface UserData {
  id: string;
  identities?: readonly string[];
  jid?: string;
  lid?: string;
  phoneNumber?: string;
  name?: string;
}

export class User {
  readonly id: string;
  readonly identities: string[];
  readonly jid: string | undefined;
  readonly lid: string | undefined;
  readonly phoneNumber: string | undefined;
  readonly name: string | undefined;

  constructor(data: UserData) {
    const identities = uniqueIdentities([
      data.id,
      data.jid,
      data.lid,
      data.phoneNumber,
      ...(data.identities ?? []),
    ]);

    this.jid = data.jid ?? identities.find((identity) =>
      identity.endsWith('@s.whatsapp.net') || identity.endsWith('@c.us'));
    this.lid = data.lid ?? identities.find((identity) => identity.endsWith('@lid'));
    this.phoneNumber = data.phoneNumber ?? this.jid;
    this.name = data.name;
    this.id = this.jid ?? this.phoneNumber ?? this.lid ?? data.id;
    this.identities = identities;
  }

  get mentionId(): string {
    return this.jid ?? this.phoneNumber ?? this.lid ?? this.id;
  }

  get mention(): string {
    return `@${this.username}`;
  }

  get phone(): string | undefined {
    return this.phoneNumber ? identityPhoneNumber(this.phoneNumber) : undefined;
  }

  get username(): string {
    return identityUsername(this.mentionId);
  }

  get displayName(): string {
    return this.name ?? this.mention;
  }

  matches(identity: string | User): boolean {
    const candidates = typeof identity === 'string' ? [identity] : identity.identities;
    return this.identities.some((ownIdentity) =>
      candidates.some((candidate) => identitiesMatch(ownIdentity, candidate)));
  }

  toJSON(): UserData {
    return {
      id: this.id,
      identities: this.identities,
      ...(this.jid ? { jid: this.jid } : {}),
      ...(this.lid ? { lid: this.lid } : {}),
      ...(this.phoneNumber ? { phoneNumber: this.phoneNumber } : {}),
      ...(this.name ? { name: this.name } : {}),
    };
  }

  static fromIdentities(identities: readonly string[]): User {
    const [id] = identities;

    if (!id) {
      throw new TypeError('A user requires at least one identity.');
    }

    return new User({ id, identities });
  }

  static fromPhoneNumber(phoneNumber: string): User {
    const normalized = phoneNumber.replace(/\D/g, '');

    if (normalized.length < 8) {
      throw new TypeError('A user phone number must include country and area codes.');
    }

    return User.fromIdentities([`${normalized}@s.whatsapp.net`]);
  }
}
