import { DeviceContext } from './deviceContext';

/// Optional native modules are loaded lazily so the SDK stays importable
/// (and testable) outside a React Native runtime.
function optionalRequire<T>(moduleName: string): T | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(moduleName) as T;
  } catch (_) {
    return undefined;
  }
}

function resolvePlatform(): string {
  const rn = optionalRequire<{ Platform?: { OS?: string } }>('react-native');
  return rn?.Platform?.OS ?? 'unknown';
}

async function resolveAppVersion(): Promise<string> {
  const expoApplication = optionalRequire<{ nativeApplicationVersion?: string }>(
    'expo-application',
  );
  if (expoApplication?.nativeApplicationVersion) {
    return expoApplication.nativeApplicationVersion;
  }

  const deviceInfo = optionalRequire<{ getVersion?: () => string }>(
    'react-native-device-info',
  );
  if (deviceInfo?.getVersion) {
    return deviceInfo.getVersion();
  }

  return '';
}

/// Resolves device/app context once at SDK init.
export async function resolveDeviceContext(): Promise<DeviceContext> {
  const platform = resolvePlatform();

  let appVersion: string;
  try {
    appVersion = await resolveAppVersion();
  } catch (_) {
    appVersion = '';
  }

  let timezone: string;
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch (_) {
    timezone = '';
  }

  return { platform, appVersion, timezone };
}
