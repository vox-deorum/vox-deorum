/**
 * @module utils/telemetry/sqlite-helpers
 *
 * One place to open a better-sqlite3 database wrapped in Kysely, so the open ritual (pragmas for
 * read-write, `{ readonly: true }` for read-only, dialect wiring, optional plugins) lives here
 * instead of being copy-pasted — with drifting pragmas — across the telemetry, batch, telepathist,
 * and knowledge database layers.
 *
 * Both helpers return the Kysely instance AND the underlying better-sqlite3 handle: most callers
 * only need `db` (and can `db.destroy()` to close), but a few also run raw `sqlite.exec(...)`
 * (e.g. table creation) on the same connection.
 */

import Database from 'better-sqlite3';
import { Kysely, SqliteDialect, type KyselyPlugin } from 'kysely';

/** A better-sqlite3 database connection plus its Kysely wrapper over the same handle. */
export interface OpenedSqlite<T> {
  db: Kysely<T>;
  sqlite: InstanceType<typeof Database>;
}

export interface OpenSqliteOptions {
  /** Extra Kysely plugins to attach (e.g. `new ParseJSONResultsPlugin()`). */
  plugins?: KyselyPlugin[];
}

function wrap<T>(sqlite: InstanceType<typeof Database>, options?: OpenSqliteOptions): OpenedSqlite<T> {
  try {
    const db = new Kysely<T>({
      dialect: new SqliteDialect({ database: sqlite }),
      plugins: options?.plugins,
    });
    return { db, sqlite };
  } catch (error) {
    // Don't leak the OS handle if Kysely wiring throws.
    sqlite.close();
    throw error;
  }
}

/**
 * Open (or create) a read-write SQLite database wrapped in Kysely, with WAL journaling and
 * `synchronous = NORMAL` for safe concurrent access.
 */
export function openSqliteKysely<T>(dbPath: string, options?: OpenSqliteOptions): OpenedSqlite<T> {
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  return wrap<T>(sqlite, options);
}

/**
 * Open an existing SQLite database read-only, wrapped in Kysely. No pragmas are set (a read-only
 * connection never writes the journal). Throws if the file does not exist.
 */
export function openSqliteKyselyReadonly<T>(dbPath: string, options?: OpenSqliteOptions): OpenedSqlite<T> {
  const sqlite = new Database(dbPath, { readonly: true });
  return wrap<T>(sqlite, options);
}
