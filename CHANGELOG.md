## Unreleased

* A failing database no longer breaks the calling app. A failure to open, read
  or write the local queue is logged and swallowed inside `push()` and
  `flush()` — the same treatment network failures already had, and what the
  SDK's own documentation claimed. Because `initialize()` flushes whatever the
  last session left behind, this is also what let a device with unreadable
  storage fail initialization outright and come up with no analytics at all.

* A failed open is no longer cached. `SqliteBeaconDatabase` kept the rejected
  promise in its handle, so one bad moment — storage still locked just after
  boot, a migration cut short by the process dying — closed the queue for the
  life of the process, every later call awaiting the first failure. The next
  call now opens the database again.

* The `event_id` backfill is per row and best effort. A row that cannot be
  given an id is left as it is rather than failing the migration and taking
  the whole queue with it; it uploads with an empty id, which is where it
  would have been without the migration.

* The v1 -> v2 migration is now tested against real SQLite rather than an
  in-memory stand-in: a table created as 0.0.1 created it, migrated, reopened,
  and written to.

## 0.1.0

* Add a unique `eventId` (UUID v4) to every event. It is generated when the
  event is created, stored in the local queue alongside it, and sent as a
  top-level field on `/track`. An event that is re-sent — because the app was
  suspended before the `202` landed, so the row was never deleted — arrives
  with the id it was created with, letting the backend drop the duplicate.

  **Backend:** dedupe on `eventId`. An app that calls `push()` needs no
  change — the id is minted there. An app that supplies its own
  `BeaconDatabase` must store and return `eventId`: it is a new field on
  `PendingEvent`, and a row that comes back without one uploads with an empty
  id, which the backend stores as no id at all.

  The local `pending_events` table gains an `event_id` column, added by an
  automatic migration on first open. Rows already queued when a device
  upgrades are backfilled with fresh ids, so they carry an id but cannot be
  matched against a copy delivered before the upgrade — a one-time residual
  limited to whatever was in the queue at the moment of the upgrade.

* Add `Beacon.instance.identify(deviceId, email, uid)`: attaches a real email
  and uid to a device's anonymous event history. Apps send their device id in
  the `email` and `uid` fields while logged out; this call asks the backend
  (`POST /identify`) to rewrite that history onto the real identity once the
  user signs in. Flushes pending events first so none are stranded under the
  old identity. Failures are logged, not thrown.

  `uid` is required by the API on every tracked event, so apps must send the
  device id there too while logged out — an empty `uid` is rejected with
  `400 uid is required` and the event never reaches the panel.

* **Breaking (wire format):** device context is sent as `app_version` and
  `build_number` instead of `appVersion` / `buildNumber`. `platform` and
  `timezone` are unchanged.

* Add `buildNumber` to the device context, resolved from the Expo config
  (`ios.buildNumber` / `android.versionCode`).
* `initialize` now accepts `platform`, `appVersion` and `buildNumber`. A value
  the app supplies always wins; omitted or blank values fall back to the SDK's
  own lookup.

* Fix `platform` resolving to `unknown` and `appVersion` to `''` on device.
  The resolver used `require(variableName)`, which Metro cannot resolve
  statically, so both lookups threw at runtime and were swallowed. Both now
  use literal requires, and the app version comes from `expo-constants`.
* Add an `appVersion` option to `initialize` to override the resolved version.

* Add `Beacon.instance.refresh()`: uploads all pending events, then starts a
  new session. Events keep the token they were pushed under, so a failed
  upload does not strand them in the wrong session. Exposes
  `Beacon.instance.sessionToken`.

## 0.0.1

* Initial Beacon React Native SDK, ported from `beacon_flutter_sdk` 0.0.1:
  SQLite-backed batching, `push` / `flush`, and configurable `apiKey`,
  `baseUrl`, and `batchSize`.
