## Unreleased

* Add `Beacon.instance.refresh()`: uploads all pending events, then starts a
  new session. Events keep the token they were pushed under, so a failed
  upload does not strand them in the wrong session. Exposes
  `Beacon.instance.sessionToken`.

## 0.0.1

* Initial Beacon React Native SDK, ported from `beacon_flutter_sdk` 0.0.1:
  SQLite-backed batching, `push` / `flush`, and configurable `apiKey`,
  `baseUrl`, and `batchSize`.
