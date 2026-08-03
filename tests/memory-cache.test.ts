import {
  describe,
  expect,
  it,
} from 'vitest';
import { MemoryCache } from '@/cache/memory-cache.js';

describe('MemoryCache', () => {
  it('promotes an updated entry before applying LRU eviction', async () => {
    const cache = new MemoryCache({ maxEntries: 2 });

    await cache.set('a', 1);
    await cache.set('b', 2);
    await cache.set('a', 3);
    await cache.set('c', 4);

    expect(await cache.get('a')).toBe(3);
    expect(await cache.get('b')).toBeUndefined();
    expect(await cache.get('c')).toBe(4);
  });

  it('reports hits, misses, expirations and evictions', async () => {
    const cache = new MemoryCache({ maxEntries: 1 });

    await cache.set('expired', true, 0);
    expect(await cache.get('expired')).toBeUndefined();
    await cache.set('first', 1);
    expect(await cache.get('first')).toBe(1);
    await cache.set('second', 2);
    expect(await cache.get('missing')).toBeUndefined();

    expect(cache.stats()).toEqual({
      size: 1,
      maxEntries: 1,
      hits: 1,
      misses: 2,
      sets: 3,
      evictions: 1,
      expirations: 1,
    });
  });

  it('prunes expired entries without scanning on every read', async () => {
    const cache = new MemoryCache();
    await cache.set('expired', true, 0);
    await cache.set('alive', true, 10_000);

    expect(cache.prune()).toBe(1);
    expect(cache.stats().size).toBe(1);
  });
});
