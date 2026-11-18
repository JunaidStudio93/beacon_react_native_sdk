import type { SQLiteDatabase } from 'expo-sqlite';
import { uuidV4 } from '../uuid';

/// A pending row as stored locally, mirroring the Drift `PendingEvents` table.
export interface PendingEvent {
  readonly id: number;
  /// Stable identifier for the event itself, assigned when it was created.
  /// Unlike [id] (a local row number) this survives a resend, which is what
  /// lets the backend recognize a duplicate upload.
  readonly eventId: string;
  readonly eventName: string;
  readonly funnel: string;
  readonly uid: string;
  readonly email: string;
  readonly sessionToken: string;
  readonly timestamp: string;
  readonly propertiesJson: string;
}

export type PendingEventInsert = Omit<PendingEvent, 'id'>;

/// Storage contract for the pending-event queue. Injectable so apps can swap
/// the SQLite backend (expo-sqlite, op-sqlite, ...) and tests can go in-memory.
export interface BeaconDatabase {
  insertEvent(entry: PendingEventInsert): Promise<number>;
  pendingCount(): Promise<number>;
  allPending(): Promise<PendingEvent[]>;
  deleteByIds(ids: number[]): Promise<void>;
  close(): Promise<void>;
}

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS pending_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL DEFAULT '',
  event_name TEXT NOT NULL,
  funnel TEXT NOT NULL,
  uid TEXT NOT NULL,
  email TEXT NOT NULL,
  session_token TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  properties_json TEXT NOT NULL
);`;

interface SqliteRow {
  id: number;
  event_id: string;
  event_name: string;
  funnel: string;
  uid: string;
  email: string;
  session_token: string;
  timestamp: string;
  properties_json: string;
}

/// Default on-device store, backed by `expo-sqlite`. The database is opened
/// lazily on first use, mirroring Drift's `LazyDatabase`.
///
/// `expo-sqlite` is imported lazily: the type-only import is erased at compile
/// time and the module is `require`d on first use, so this file stays
/// importable (and testable) without the native module present.
export class SqliteBeaconDatabase implements BeaconDatabase {
  private readonly fileName: string;
  private handle?: Promise<SQLiteDatabase>;

  constructor(fileName = 'beacon_events.sqlite') {
    this.fileName = fileName;
  }

  private open(): Promise<SQLiteDatabase> {
    if (!this.handle) {
      this.handle = (async () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const sqlite = require('expo-sqlite') as typeof import('expo-sqlite');
        const db = await sqlite.openDatabaseAsync(this.fileName);
        await db.execAsync(CREATE_TABLE_SQL);
        await SqliteBeaconDatabase.migrate(db);
        return db;
      })();
    }
    return this.handle;
  }

  /// Brings a table created by an older SDK version up to date.
  ///
  /// Installs that upgrade mid-queue have rows with no `event_id`. They get
  /// one here so every row the SDK uploads carries an id, but a backfilled id
  /// is newly minted on this launch: if such a row was already delivered
  /// before the upgrade, the backend has no matching id to dedupe against.
  /// That residual is limited to the events queued across the one upgrade.
  private static async migrate(db: SQLiteDatabase): Promise<void> {
    const columns = await db.getAllAsync<{ name: string }>(
      'PRAGMA table_info(pending_events)',
    );
    const hasEventId = columns.some((column) => column.name === 'event_id');

    if (!hasEventId) {
      await db.execAsync(
        "ALTER TABLE pending_events ADD COLUMN event_id TEXT NOT NULL DEFAULT ''",
      );
    }

    const missing = await db.getAllAsync<{ id: number }>(
      "SELECT id FROM pending_events WHERE event_id = '' OR event_id IS NULL",
    );
    for (const row of missing) {
      await db.runAsync('UPDATE pending_events SET event_id = ? WHERE id = ?', [
        uuidV4(),
        row.id,
      ]);
    }
  }

  async insertEvent(entry: PendingEventInsert): Promise<number> {
    const db = await this.open();
    const result = await db.runAsync(
      `INSERT INTO pending_events
        (event_id, event_name, funnel, uid, email, session_token, timestamp, properties_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.eventId,
        entry.eventName,
        entry.funnel,
        entry.uid,
        entry.email,
        entry.sessionToken,
        entry.timestamp,
        entry.propertiesJson,
      ],
    );
    return result.lastInsertRowId;
  }

  async pendingCount(): Promise<number> {
    const db = await this.open();
    const row = await db.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM pending_events',
    );
    return row?.count ?? 0;
  }

  async allPending(): Promise<PendingEvent[]> {
    const db = await this.open();
    const rows = await db.getAllAsync<SqliteRow>(
      'SELECT * FROM pending_events ORDER BY id ASC',
    );
    return rows.map((row) => ({
      id: row.id,
      eventId: row.event_id,
      eventName: row.event_name,
      funnel: row.funnel,
      uid: row.uid,
      email: row.email,
      sessionToken: row.session_token,
      timestamp: row.timestamp,
      propertiesJson: row.properties_json,
    }));
  }

  async deleteByIds(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    const db = await this.open();
    const placeholders = ids.map(() => '?').join(', ');
    await db.runAsync(
      `DELETE FROM pending_events WHERE id IN (${placeholders})`,
      ids,
    );
  }

  async close(): Promise<void> {
    if (!this.handle) return;
    const db = await this.handle;
    this.handle = undefined;
    await db.closeAsync();
  }
}

/// In-memory database for tests.
export class MemoryBeaconDatabase implements BeaconDatabase {
  private rows: PendingEvent[] = [];
  private nextId = 1;

  async insertEvent(entry: PendingEventInsert): Promise<number> {
    const id = this.nextId++;
    this.rows.push({ id, ...entry });
    return id;
  }

  async pendingCount(): Promise<number> {
    return this.rows.length;
  }

  async allPending(): Promise<PendingEvent[]> {
    return [...this.rows].sort((a, b) => a.id - b.id);
  }

  async deleteByIds(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    const removed = new Set(ids);
    this.rows = this.rows.filter((row) => !removed.has(row.id));
  }

  async close(): Promise<void> {
    this.rows = [];
  }
}
