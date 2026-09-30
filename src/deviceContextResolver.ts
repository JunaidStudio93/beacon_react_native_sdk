import { DeviceContext } from './deviceContext';

/// Values the app can supply instead of letting the SDK resolve them.
/// Anything omitted, empty or blank falls back to the resolved value.
export interface DeviceContextOverrides {
  platform?: string;
  appVersion?: string;
  buildNumber?: string;
}

/// Every module here is required by a LITERAL name.
///
/// Metro, React Native's bundler, resolves `require()` calls statically at
/// build time. A variable module name cannot be resolved that way and always
/// throws at runtime, which is why the previous dynamic form silently produced
/// `platform: 'unknown'` and an empty `appVersion` on device.

interface ExpoConstants {
  expoConfig?: {
    version?: string | null;
    ios?: { buildNumber?: string | null } | null;
    android?: { versionCode?: number | null } | null;
  } | null;
  manifest?: { version?: string | null } | null;
  nativeAppVersion?: string | null;
  nativeBuildVersion?: string | null;
}

function expoConstants(): ExpoConstants | undefined {
  try {
    // expo-constants is a dependency of `expo` itself, so it is present in
    // every Expo app. This SDK already requires Expo SDK 51+.
    const mod = require('expo-constants') as { default?: ExpoConstants };
    return mod?.default;
  } catch (_) {
    return undefined;
  }
}

function resolvePlatform(): string {
  try {
    const rn = require('react-native') as { Platform?: { OS?: string } };
    return rn?.Platform?.OS ?? 'unknown';
  } catch (_) {
    return 'unknown';
  }
}

function resolveAppVersion(): string {
  const constants = expoConstants();
  return (
    constants?.expoConfig?.version ??
    constants?.nativeAppVersion ??
    constants?.manifest?.version ??
    ''
  );
}

function resolveBuildNumber(platform: string): string {
  const constants = expoConstants();
  if (!constants) return '';

  // iOS carries a string buildNumber, Android an integer versionCode.
  const fromConfig =
    platform === 'android'
      ? constants.expoConfig?.android?.versionCode
      : constants.expoConfig?.ios?.buildNumber;

  if (fromConfig !== null && fromConfig !== undefined) {
    return String(fromConfig);
  }

  return constants.nativeBuildVersion ?? '';
}

function provided(value?: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/// Resolves device/app context once at SDK init.
///
/// Values the app passed in [overrides] always win; the SDK only resolves
/// what the app left out.
export async function resolveDeviceContext(
  overrides: DeviceContextOverrides = {},
): Promise<DeviceContext> {
  const platform = provided(overrides.platform) ?? resolvePlatform();
  const appVersion = provided(overrides.appVersion) ?? resolveAppVersion();
  const buildNumber =
    provided(overrides.buildNumber) ?? resolveBuildNumber(platform);

  let timezone: string;
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch (_) {
    timezone = '';
  }

  return { platform, appVersion, buildNumber, timezone };
}
