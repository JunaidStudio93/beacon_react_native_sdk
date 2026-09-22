# Beacon React Native SDK — Integration Guide

Everything needed to add Beacon event tracking to the app. Read the
**Prerequisites** first — one of them can block integration entirely.

---

## 1. Prerequisites

| Requirement | Why |
| --- | --- |
| **Expo SDK 51 or newer** | The SQLite store uses the async `expo-sqlite` API (`openDatabaseAsync` / `runAsync` / `getAllAsync`). That API replaced the old callback-and-transaction style in SDK 51. **On SDK 50 or older this SDK will not work** and the storage layer needs rewriting. |
| React Native 0.71+ | Declared peer dependency. |
| A Beacon API key and base URL | Ask the backend owner. Format: `bcn_live_sk_...` |

**Check your Expo version before starting:**

```sh
cat package.json | grep '"expo"'
```

If it reports SDK 50 or lower, stop and report back — do not start integrating.

---

## 2. Installation

Two packages. Both are required.

```sh
npm install git+https://github.com/JunaidStudio93/beacon_react_native_sdk.git
npx expo install expo-sqlite
```

Notes:

- **The repo name uses underscores, the package name uses hyphens.** Install
  from `beacon_react_native_sdk`, but import from `beacon-react-native-sdk`.
- To pin a version, append a tag or commit SHA:
  `...beacon_react_native_sdk.git#v0.0.1`
- Use `npx expo install` for `expo-sqlite` (not `npm install`) so the version
  matches your Expo SDK.
- The SDK is TypeScript and compiles itself on install via a `prepare` script.
  No extra build step.

### Rebuild the app after installing

`expo-sqlite` contains native code. A Metro reload will **not** pick it up.

- **Expo Go** — already bundles `expo-sqlite`, works immediately.
- **Dev build / bare** — `npx expo prebuild` then `npx expo run:ios` or
  `npx expo run:android`, or trigger a new EAS build.

Symptom of skipping this: a native module error on the first tracked event.

---

## 3. Initialize

Call once, as early as possible, before any event is tracked. Typically in
`App.tsx` or the root layout.

```ts
import { Beacon } from 'beacon-react-native-sdk';

await Beacon.initialize({
  apiKey: 'bcn_live_sk_...',
  baseUrl: 'https://your-beacon-endpoint.example.com',
  batchSize: 10,
});
```

In a React root:

```tsx
import { useEffect, useState } from 'react';
import { Beacon } from 'beacon-react-native-sdk';

export default function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    Beacon.initialize({
      apiKey: process.env.EXPO_PUBLIC_BEACON_API_KEY!,
      baseUrl: process.env.EXPO_PUBLIC_BEACON_BASE_URL!,
      batchSize: 10,
    })
      .catch((e) => console.warn('Beacon init failed', e))
      .finally(() => setReady(true));
  }, []);

  if (!ready) return null;
  return <RootNavigator />;
}
```

**Do not block app startup on this.** Initialization performs a network flush
of leftover events from the previous session. The `.finally()` above renders
the app whether or not Beacon came up. Analytics must never gate the UI.

### `initialize` options

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `apiKey` | `string` | — | Required. Sent as the `x-api-key` header. |
| `baseUrl` | `string` | — | Required. `/track` is appended. |
| `batchSize` | `number` | `10` | Flush threshold. Must be >= 1. |
| `fetchFn` | `typeof fetch` | global `fetch` | For tests. |
| `database` | `BeaconDatabase` | `SqliteBeaconDatabase` | For tests or a different SQLite engine. |
| `deviceContext` | `DeviceContext` | auto-resolved | For tests. |

Throws if `apiKey` or `baseUrl` is empty, or `batchSize < 1`.

---

## 4. Tracking events

```ts
await Beacon.instance.push({
  eventName: 'screen_view',
  funnel: 'onboarding',
  type: 'navigation',
  value: 'home',
  uid: user.id,       // omit for 'anonymous'
  email: user.email,  // omit for 'anonymous'
});
```

Send immediately instead of waiting for the batch to fill:

```ts
await Beacon.instance.push({
  eventName: 'purchase_completed',
  funnel: 'checkout',
  type: 'conversion',
  value: '99.00',
  uid: user.id,
  email: user.email,
  immediate: true,
});
```

Attach custom properties:

```ts
await Beacon.instance.push({
  eventName: 'filter_applied',
  funnel: 'search',
  type: 'interaction',
  properties: { category: 'shoes', resultCount: 42 },
});
```

### `push` options

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `eventName` | `string` | — | Required. Sanitized (see §7). |
| `funnel` | `string` | — | Required. Sanitized (see §7). |
| `type` | `string` | — | Required. Stored in `properties.type`. |
| `value` | `string \| null` | `''` | Truncated to 100 chars. |
| `uid` | `string` | `'anonymous'` | Not sanitized. |
| `email` | `string` | `'anonymous'` | Not sanitized. |
| `properties` | `object` | `{}` | Merged last — see the warning below. |
| `immediate` | `boolean` | `false` | Flush right away. |

> **Warning:** custom `properties` are merged **after** the SDK's own fields.
> Keys named `type`, `value`, `platform`, `appVersion` or `timezone` will
> silently overwrite the SDK values. Avoid those five names.

---

## 5. Flush on app background

Events below the batch threshold sit in local SQLite. Flush them when the app
goes to the background so they are not delayed until the next launch.

```ts
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { Beacon } from 'beacon-react-native-sdk';

useEffect(() => {
  const sub = AppState.addEventListener('change', (state) => {
    if (state === 'background' && Beacon.isInitialized) {
      Beacon.instance.flush().catch(() => {});
    }
  });
  return () => sub.remove();
}, []);
```

---

## 6. How it behaves

1. Every `push()` **writes to local SQLite first**, then decides whether to
   upload. Nothing is lost to a crash mid-request.
2. After each insert the SDK counts pending rows. At `>= batchSize` it uploads.
3. Upload is `POST {baseUrl}/track`.
4. **Only HTTP 202 clears events.** Any other status, or a network error, keeps
   them queued for the next attempt.
5. Rows are deleted by id, so events tracked during an in-flight upload survive.
6. Events persist across app restarts. `initialize()` flushes leftovers.
7. Uploads are serialized by an internal lock; concurrent `push`/`flush` calls
   cannot double-send.

### Wire format

```http
POST {baseUrl}/track
Content-Type: application/json
x-api-key: {apiKey}
```

```json
{
  "events": [
    {
      "eventName": "screen_view",
      "uid": "u_123",
      "funnel": "onboarding",
      "sessionToken": "76e08819-c81a-4eb0-9d42-90205be4496e",
      "timestamp": "2026-09-22T08:42:04.000Z",
      "email": "a@b.com",
      "properties": {
        "type": "navigation",
        "value": "home",
        "platform": "ios",
        "appVersion": "1.2.3",
        "timezone": "Asia/Karachi"
      }
    }
  ]
}
```

- `sessionToken` is a UUID v4 generated once per `initialize()` call.
- `timestamp` is UTC ISO 8601.
- `properties.country` is **not** sent — the backend derives it from the
  request IP.

---

## 7. Sanitization rules

Applied automatically to `eventName` and `funnel`:

- Trimmed, then every character outside `[a-zA-Z0-9_]` becomes `_`
- If the result is empty or does not start with a letter, `e_` is prefixed
- Truncated to 40 characters

`value` is truncated to 100 characters; `null`/empty become `''`.

| Input | Output |
| --- | --- |
| `"  hello-world!  "` | `hello_world_` |
| `"123bad"` | `e_123bad` |
| `"!!!"` | `e____` |
| `"sign-up!"` | `sign_up_` |

`uid` and `email` are **not** sanitized and are sent as provided.

---

## 8. Verification checklist

Work through this on first integration:

- [ ] App builds and launches with the SDK installed
- [ ] `Beacon.initialize()` resolves without throwing
- [ ] Fire `batchSize` events → exactly one `POST /track` in the network log
- [ ] Request carries the `x-api-key` header and hits `{baseUrl}/track`
- [ ] Server responds **202**
- [ ] Fire one event with `immediate: true` → uploads right away
- [ ] Kill the app with events pending, relaunch → they upload on init
- [ ] Airplane mode → events queue, no crash; reconnect → they upload
- [ ] `properties` shows correct `platform`, `appVersion`, `timezone`

The offline test matters most — that is the path with the least coverage.

---

## 9. Known limitations

Carried over deliberately from the Flutter SDK so both stay identical. Not
bugs introduced in this port, but they will be hit in production:

1. **A flush uploads the entire queue, not one batch.** After a long offline
   period this can produce a very large request body, which a server may
   reject — leaving the queue stuck, since the retry is equally large.
2. **Non-retryable errors retry forever.** A 400 or 401 is treated exactly
   like a 503. One malformed event can block the queue permanently.
3. **No request timeout.** A stalled connection hangs the `push()` call.
   Never `await` a push on a render-blocking path.
4. **No queue size cap or TTL.** If the endpoint is down for a long time, the
   local database grows unbounded.
5. **Once the queue is behind, every push attempts a network request** — the
   batch threshold stays exceeded, so there is one upload attempt per event.

Mitigation until these are addressed: fire-and-forget your pushes
(`void Beacon.instance.push({...})` or `.catch(() => {})`) rather than
awaiting them in UI code.

---

## 10. Using a different SQLite engine

`expo-sqlite` is the default, not a hard requirement. Implement the
`BeaconDatabase` interface and pass it to `initialize`:

```ts
import type { BeaconDatabase } from 'beacon-react-native-sdk';

class OpSqliteBeaconDatabase implements BeaconDatabase {
  insertEvent(entry) { /* ... */ }
  pendingCount()     { /* ... */ }
  allPending()       { /* ... */ }
  deleteByIds(ids)   { /* ... */ }
  close()            { /* ... */ }
}

await Beacon.initialize({ apiKey, baseUrl, database: new OpSqliteBeaconDatabase() });
```

The published type definitions carry no reference to `expo-sqlite`, so it does
not need to be installed in that case.

---

## 11. Troubleshooting

| Symptom | Cause |
| --- | --- |
| `Cannot find module 'expo-sqlite'` | Not installed, or the app was not rebuilt after installing it. |
| Native module error on first `push()` | `expo-sqlite` installed but the app was not rebuilt. |
| `Beacon has not been initialized` | `push()` ran before `initialize()` resolved. |
| Events never upload | Server is not returning exactly **202**. Anything else keeps them queued. |
| `appVersion` is `''` | `expo-application` is not installed. Optional; add it if the field is needed. |
| Import fails | Package name is hyphenated: `beacon-react-native-sdk`. |

---

## 12. Status

- Ported from `beacon_flutter_sdk` 0.0.1; identical API surface and wire format
- Type-checked against `expo-sqlite` 57.0.3
- 7/7 unit tests passing; git-install path verified end to end
- **Not yet run on a physical device or simulator.** The first real `push()`
  is the outstanding verification — see §8.
