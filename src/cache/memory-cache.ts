import type { CacheStore } from '@/cache/cache-store.js';

interface CacheEntry {
  value: unknown;
  expiresAt?: number;
}

export class MemoryCache implements CacheStore {
  readonly #entries = new Map<string, CacheEntry>();
  readonly #maxEntries: number;

  constructor(options: { maxEntries?: number } = {}) {
    this.#maxEntries = Math.max(1, options.maxEntries ?? 1_000);
  }

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.#entries.get(key);

    if (!entry) {
      return undefined;
    }

    if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      this.#entries.delete(key);
      return undefined;
    }

    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    const entry: CacheEntry = { value };

    if (ttlMs !== undefined) {
      entry.expiresAt = Date.now() + ttlMs;
    }

    this.#entries.set(key, entry);

    while (this.#entries.size > this.#maxEntries) {
      const oldest = this.#entries.keys().next().value as string | undefined;
      if (oldest === undefined) return;
      this.#entries.delete(oldest);
    }
  }

  async delete(key: string): Promise<void> {
    this.#entries.delete(key);
  }

  async clear(): Promise<void> {
    this.#entries.clear();
  }
}
