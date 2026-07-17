import type { UserData } from '@/models/user.js';

export interface StoredMute {
  key: string;
  groupId: string;
  user: UserData;
  identities: string[];
  createdAt: number;
  expiresAt: number | null;
}

export interface MuteStore {
  upsert(mute: StoredMute): void | Promise<void>;
  find(
    groupId: string,
    identities: readonly string[],
  ): StoredMute | undefined | Promise<StoredMute | undefined>;
  delete(groupId: string, identities: readonly string[]): boolean | Promise<boolean>;
  purgeExpired(now: number): number | Promise<number>;
  close?(): void | Promise<void>;
}

export interface MuteOptions {
  enabled?: boolean;
  store?: MuteStore;
  database?: string;
}
