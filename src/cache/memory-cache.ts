import type { CacheStore } from '@/cache/cache-store.js';

interface CacheEntry {
  value: unknown;
  expiresAt?: number;
}

export interface MemoryCacheStats {
  size: number;
  maxEntries: number;
  hits: number;
  misses: number;
  sets: number;
  evictions: number;
  expirations: number;
}

export class MemoryCache implements CacheStore {
  readonly #entries = new Map<string, CacheEntry>();
  readonly #maxEntries: number;
  #hits = 0;
  #misses = 0;
  #sets = 0;
  #evictions = 0;
  #expirations = 0;

  constructor(options: { maxEntries?: number } = {}) {
    this.#maxEntries = Math.max(1, options.maxEntries ?? 1_000);
  }

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.#entries.get(key);

    if (!entry) {
      this.#misses += 1;
      return undefined;
    }

    if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      this.#entries.delete(key);
      this.#misses += 1;
      this.#expirations += 1;
      return undefined;
    }

    this.#hits += 1;
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    const entry: CacheEntry = { value };

    if (ttlMs !== undefined) {
      entry.expiresAt = Date.now() + ttlMs;
    }

    this.#sets += 1;
    this.#entries.delete(key);
    this.#entries.set(key, entry);

    while (this.#entries.size > this.#maxEntries) {
      const oldest = this.#entries.keys().next().value as string | undefined;
      if (oldest === undefined) return;
      this.#entries.delete(oldest);
      this.#evictions += 1;
    }
  }

  async delete(key: string): Promise<void> {
    this.#entries.delete(key);
  }

  async clear(): Promise<void> {
    this.#entries.clear();
  }

  prune(now = Date.now()): number {
    let removed = 0;

    for (const [key, entry] of this.#entries) {
      if (entry.expiresAt !== undefined && entry.expiresAt <= now) {
        this.#entries.delete(key);
        removed += 1;
      }
    }

    this.#expirations += removed;
    return removed;
  }

  stats(): Readonly<MemoryCacheStats> {
    return {
      size: this.#entries.size,
      maxEntries: this.#maxEntries,
      hits: this.#hits,
      misses: this.#misses,
      sets: this.#sets,
      evictions: this.#evictions,
      expirations: this.#expirations,
    };
  }
}
