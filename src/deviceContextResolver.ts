import { DeviceContext } from './deviceContext';

/// Every module here is required by a LITERAL name.
///
/// Metro, React Native's bundler, resolves `require()` calls statically at
/// build time. `require(someVariable)` cannot be resolved that way and always
/// throws at runtime, which is why the previous dynamic form silently produced
/// `platform: 'unknown'` and an empty `appVersion` on device.

function resolvePlatform(): string {
  try {
    const rn = require('react-native') as { Platform?: { OS?: string } };
    return rn?.Platform?.OS ?? 'unknown';
  } catch (_) {
    return 'unknown';
  }
}

function resolveAppVersion(): string {
  try {
    // expo-constants is a dependency of `expo` itself, so it is present in
    // every Expo app. This SDK already requires Expo SDK 51+.
    const mod = require('expo-constants') as {
      default?: {
        expoConfig?: { version?: string | null } | null;
        manifest?: { version?: string | null } | null;
        nativeAppVersion?: string | null;
      };
    };
    const constants = mod?.default;
    return (
      constants?.expoConfig?.version ??
      constants?.nativeAppVersion ??
      constants?.manifest?.version ??
      ''
    );
  } catch (_) {
    return '';
  }
}

/// Resolves device/app context once at SDK init.
///
/// [appVersionOverride] wins when given, for apps that keep their version
/// somewhere other than the Expo config.
export async function resolveDeviceContext(
  appVersionOverride?: string,
): Promise<DeviceContext> {
  const platform = resolvePlatform();
  const appVersion = appVersionOverride ?? resolveAppVersion();

  let timezone: string;
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch (_) {
    timezone = '';
  }

  return { platform, appVersion, timezone };
}
