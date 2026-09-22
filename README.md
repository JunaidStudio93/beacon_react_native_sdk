# Beacon React Native SDK

Event tracking SDK for React Native with SQLite-backed local batching.
Port of `beacon_flutter_sdk` — same API surface, same wire format.

## Features

- Initialize with an API key, base URL, and configurable batch size
- Persist events locally with SQLite until the batch limit
- Flush automatically when the batch size is reached
- Optional `immediate: true` to upload without waiting for the batch
- Manual `flush()` for app lifecycle (background / unmount)
- Auto-attaches platform, app version, and timezone
- Country is set server-side from the request IP (not by the SDK)

## Installation

```sh
npm install beacon-react-native-sdk expo-sqlite
```

`expo-sqlite` is the default store and works in both Expo and bare React
Native projects. To use a different engine (op-sqlite, nitro-sqlite, ...),
implement the `BeaconDatabase` interface and pass it to `initialize`.

App version is read from `expo-application` or `react-native-device-info` if
either is installed; otherwise it resolves to `''`. Timezone comes from the
built-in `Intl` API — no extra dependency.

## Getting started

```ts
import { Beacon } from 'beacon-react-native-sdk';

await Beacon.initialize({
  apiKey: 'bcn_live_sk_...',
  baseUrl: 'https://your-beacon-endpoint.example.com',
  batchSize: 10,
});
```

## Usage

```ts
await Beacon.instance.push({
  eventName: 'screen_view',
  funnel: 'onboarding',
  type: 'navigation',
  value: 'home',
  uid: user.uid,       // defaults to 'anonymous'
  email: user.email,   // defaults to 'anonymous'
});

// Bypass batching and send now (still persists first; clears on 202)
await Beacon.instance.push({
  eventName: 'purchase_completed',
  funnel: 'checkout',
  type: 'conversion',
  value: '99.00',
  uid: user.uid,
  email: user.email,
  immediate: true,
});

// Flush leftover events (e.g. on AppState background)
await Beacon.instance.flush();
```

Events are `POST`ed to `{baseUrl}/track` with header `x-api-key`.
A successful response is HTTP **202**; otherwise events stay in the local DB for the next flush.

## Differences from the Flutter SDK

Behaviour is identical. Only the platform plumbing differs:

| Flutter | React Native |
| --- | --- |
| Drift + `sqlite3` | `expo-sqlite` (hand-written SQL, no codegen) |
| `path_provider` | handled by `expo-sqlite` |
| `package_info_plus` | `expo-application` / `react-native-device-info` (optional) |
| `flutter_timezone` | `Intl.DateTimeFormat().resolvedOptions().timeZone` |
| `uuid` | `crypto.randomUUID()` with a pure-JS fallback |
| `http.Client` | global `fetch` |
| `BeaconDatabase.memory()` | `MemoryBeaconDatabase` |

Named arguments become a single options object, since JS has no named
parameters: `push({ eventName, funnel, type })`.

## Additional information

This package stores pending events in an on-device SQLite database
(`beacon_events.sqlite`). Call `flush()` from your app lifecycle if you need
pending events uploaded before the batch fills.
