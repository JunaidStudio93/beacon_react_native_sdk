/// The v1 -> v2 migration, run against real SQLite.
///
/// `expo-sqlite` is replaced by a thin adapter over `node:sqlite`, so the
/// migration executes the statements it would execute on a device instead of
/// being approximated by an in-memory stub. The adapter keeps one database per
/// file name and ignores `closeAsync`, which is what lets a test close the SDK
/// and open it again on the same rows — a relaunch.

const mockDatabases = new Map<string, unknown>();
const mockState = { failNextOpen: false };

jest.mock('expo-sqlite', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { DatabaseSync } = require('node:sqlite');
  return {
    openDatabaseAsync: async (name: string) => {
      if (mockState.failNextOpen) {
        mockState.failNextOpen = false;
        throw new Error('database is locked');
      }
      if (!mockDatabases.has(name)) {
        mockDatabases.set(name, new DatabaseSync(':memory:'));
      }
      const db = mockDatabases.get(name) as {
        exec: (sql: string) => void;
        prepare: (sql: string) => {
          all: (...p: unknown[]) => unknown[];
          get: (...p: unknown[]) => unknown;
          run: (...p: unknown[]) => { lastInsertRowid: number | bigint };
        };
      };
      return {
        execAsync: async (sql: string) => db.exec(sql),
        getAllAsync: async (sql: string, params: unknown[] = []) =>
          db.prepare(sql).all(...params),
        getFirstAsync: async (sql: string, params: unknown[] = []) =>
          db.prepare(sql).get(...params) ?? null,
        runAsync: async (sql: string, params: unknown[] = []) => ({
          lastInsertRowId: Number(db.prepare(sql).run(...params).lastInsertRowid),
        }),
        closeAsync: async () => {},
      };
    },
  };
});

import { SqliteBeaconDatabase } from '../src/db/beaconDatabase';

/// The table exactly as SDK 0.0.1 created it: no `event_id` at all.
const V1_SQL = `
CREATE TABLE pending_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_name TEXT NOT NULL,
  funnel TEXT NOT NULL,
  uid TEXT NOT NULL,
  email TEXT NOT NULL,
  session_token TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  properties_json TEXT NOT NULL
);`;

function seedV1(name: string, events: string[]): void {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { DatabaseSync } = require('node:sqlite');
  const raw = new DatabaseSync(':memory:');
  raw.exec(V1_SQL);
  for (const eventName of events) {
    raw
      .prepare(
        `INSERT INTO pending_events
          (event_name, funnel, uid, email, session_token, timestamp, properties_json)
         VALUES (?, 'shop', 'u1', 'a@b.c', 's1', '2026-11-20T10:00:00.000Z', '{}')`,
      )
      .run(eventName);
  }
  mockDatabases.set(name, raw);
}

beforeEach(() => {
  mockDatabases.clear();
  mockState.failNextOpen = false;
});

describe('v1 -> v2 migration', () => {
  it('adds event_id to a table that predates it and backfills what is queued', async () => {
    seedV1('m1.sqlite', ['app_backgrounded', 'checkout_started']);
    const db = new SqliteBeaconDatabase('m1.sqlite');

    const rows = await db.allPending();

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.eventName)).toEqual([
      'app_backgrounded',
      'checkout_started',
    ]);
    for (const row of rows) {
      expect(row.eventId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
    // Distinct ids: a backfill that gave every row the same one would
    // de-duplicate the whole queue down to a single event on arrival.
    expect(new Set(rows.map((r) => r.eventId)).size).toBe(2);
  });

  it('leaves a backfilled id alone on the next launch', async () => {
    seedV1('m2.sqlite', ['app_error']);

    const first = new SqliteBeaconDatabase('m2.sqlite');
    const before = (await first.allPending())[0].eventId;
    await first.close();

    const second = new SqliteBeaconDatabase('m2.sqlite');
    const after = (await second.allPending())[0].eventId;

    // Re-minting would break the point of the id: the backend would see the
    // resend of an event it already has as a new one.
    expect(after).toBe(before);
  });

  it('accepts new events on a migrated table', async () => {
    seedV1('m3.sqlite', ['app_opened']);
    const db = new SqliteBeaconDatabase('m3.sqlite');

    await db.insertEvent({
      eventId: 'fresh-event-id-0001',
      eventName: 'product_viewed',
      funnel: 'shop',
      uid: 'u1',
      email: 'a@b.c',
      sessionToken: 's1',
      timestamp: '2026-11-21T10:00:00.000Z',
      propertiesJson: '{}',
    });

    const rows = await db.allPending();
    expect(rows).toHaveLength(2);
    expect(rows[1].eventId).toBe('fresh-event-id-0001');
    expect(await db.pendingCount()).toBe(2);
  });

  it('does not cache a failed open', async () => {
    seedV1('m4.sqlite', ['app_opened']);
    const db = new SqliteBeaconDatabase('m4.sqlite');

    mockState.failNextOpen = true;
    await expect(db.pendingCount()).rejects.toThrow('database is locked');

    // The rejection must not be held: before this fix the promise stayed in
    // the handle and every later call awaited the same failure for the life
    // of the process.
    expect(await db.pendingCount()).toBe(1);
  });
});
