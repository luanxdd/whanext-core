import type { CacheStore } from '@/cache/cache-store.js';

interface CacheEntry {
  value: unknown;
  expiresAt?: number;
}

export class MemoryCache implements CacheStore {
  readonly #entries = new Map<string, CacheEntry>();

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.#entries.get(key);

    if (!entry) {
      return undefined;
    }

    if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      this.#entries.delete(key);
      return undefined;
    }

    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    const entry: CacheEntry = { value };

    if (ttlMs !== undefined) {
      entry.expiresAt = Date.now() + ttlMs;
    }

    this.#entries.set(key, entry);
  }

  async delete(key: string): Promise<void> {
    this.#entries.delete(key);
  }

  async clear(): Promise<void> {
    this.#entries.clear();
  }
}
