import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  dirname,
  resolve,
} from 'node:path';
import type { DatabaseSync as NodeDatabaseSync } from 'node:sqlite';
import { WhaNextError } from '@/errors/error.js';
import { normalizeIdentity } from '@/models/identity.js';
import type {
  MuteStore,
  StoredMute,
} from '@/mute/mute-store.js';

interface MuteRow {
  mute_key: string;
  group_id: string;
  user_json: string;
  created_at: number;
  expires_at: number | null;
}

export class SqliteMuteStore implements MuteStore {
  readonly #database: NodeDatabaseSync;

  constructor(path = './data/whanext.sqlite') {
    const databasePath = path === ':memory:' ? path : resolve(path);

    if (databasePath !== ':memory:') {
      mkdirSync(dirname(databasePath), { recursive: true });
    }

    let database: NodeDatabaseSync | undefined;

    try {
      const require = createRequire(import.meta.url);
      const sqlite = require('node:sqlite') as typeof import('node:sqlite');
      database = new sqlite.DatabaseSync(databasePath);
      database.exec('PRAGMA journal_mode = WAL');
      database.exec('PRAGMA busy_timeout = 5000');
      database.exec(`
        CREATE TABLE IF NOT EXISTS whanext_mutes (
          group_id TEXT NOT NULL,
          identity TEXT NOT NULL,
          mute_key TEXT NOT NULL,
          user_json TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          expires_at INTEGER,
          PRIMARY KEY (group_id, identity)
        ) STRICT;
        CREATE INDEX IF NOT EXISTS whanext_mutes_expiration
          ON whanext_mutes (expires_at);
        CREATE INDEX IF NOT EXISTS whanext_mutes_key
          ON whanext_mutes (group_id, mute_key);
      `);
    } catch (error) {
      database?.close();
      throw new WhaNextError(
        'STORAGE_ERROR',
        'Could not initialize the SQLite mute store.',
        {
          cause: error,
          context: { database: databasePath },
        },
      );
    }

    this.#database = database;
  }

  upsert(mute: StoredMute): void {
    const identities = this.#identities(mute.identities);
    const existingKeys = this.#matchingKeys(mute.groupId, identities);

    this.#transaction(() => {
      for (const key of existingKeys) {
        this.#database.prepare(
          'DELETE FROM whanext_mutes WHERE group_id = ? AND mute_key = ?',
        ).run(mute.groupId, key);
      }

      const insert = this.#database.prepare(`
        INSERT OR REPLACE INTO whanext_mutes (
          group_id,
          identity,
          mute_key,
          user_json,
          created_at,
          expires_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);

      for (const identity of identities) {
        insert.run(
          mute.groupId,
          identity,
          mute.key,
          JSON.stringify(mute.user),
          mute.createdAt,
          mute.expiresAt,
        );
      }
    });
  }

  find(groupId: string, identities: readonly string[]): StoredMute | undefined {
    const normalized = this.#identities(identities);

    if (normalized.length === 0) {
      return undefined;
    }

    const placeholders = normalized.map(() => '?').join(', ');
    const row = this.#database.prepare(`
      SELECT mute_key, group_id, user_json, created_at, expires_at
      FROM whanext_mutes
      WHERE group_id = ? AND identity IN (${placeholders})
      LIMIT 1
    `).get(groupId, ...normalized) as unknown as MuteRow | undefined;

    if (!row) {
      return undefined;
    }

    if (row.expires_at !== null && row.expires_at <= Date.now()) {
      this.#database.prepare(
        'DELETE FROM whanext_mutes WHERE group_id = ? AND mute_key = ?',
      ).run(groupId, row.mute_key);
      return undefined;
    }

    const identityRows = this.#database.prepare(`
      SELECT identity
      FROM whanext_mutes
      WHERE group_id = ? AND mute_key = ?
    `).all(groupId, row.mute_key) as unknown as Array<{ identity: string }>;

    return {
      key: row.mute_key,
      groupId: row.group_id,
      user: JSON.parse(row.user_json) as StoredMute['user'],
      identities: identityRows.map(({ identity }) => identity),
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  }

  delete(groupId: string, identities: readonly string[]): boolean {
    const keys = this.#matchingKeys(groupId, this.#identities(identities));

    if (keys.length === 0) {
      return false;
    }

    this.#transaction(() => {
      const statement = this.#database.prepare(
        'DELETE FROM whanext_mutes WHERE group_id = ? AND mute_key = ?',
      );

      for (const key of keys) {
        statement.run(groupId, key);
      }
    });
    return true;
  }

  purgeExpired(now: number): number {
    const result = this.#database.prepare(`
      DELETE FROM whanext_mutes
      WHERE expires_at IS NOT NULL AND expires_at <= ?
    `).run(now);
    return Number(result.changes);
  }

  close(): void {
    this.#database.close();
  }

  #matchingKeys(groupId: string, identities: readonly string[]): string[] {
    if (identities.length === 0) {
      return [];
    }

    const placeholders = identities.map(() => '?').join(', ');
    const rows = this.#database.prepare(`
      SELECT DISTINCT mute_key
      FROM whanext_mutes
      WHERE group_id = ? AND identity IN (${placeholders})
    `).all(groupId, ...identities) as unknown as Array<{ mute_key: string }>;
    return rows.map(({ mute_key }) => mute_key);
  }

  #identities(identities: readonly string[]): string[] {
    return [...new Set(identities.map(normalizeIdentity).filter(Boolean))];
  }

  #transaction(operation: () => void): void {
    this.#database.exec('BEGIN IMMEDIATE');

    try {
      operation();
      this.#database.exec('COMMIT');
    } catch (error) {
      this.#database.exec('ROLLBACK');
      throw error;
    }
  }
}
