/// Device/app context resolved once at init and attached to every event.
///
/// Country is intentionally omitted; the Beacon backend sets
/// `properties.country` from the request IP on `/track`.
export interface DeviceContext {
  readonly platform: string;
  readonly appVersion: string;
  readonly timezone: string;
}

export function deviceContextToMap(
  context: DeviceContext,
): Record<string, unknown> {
  return {
    platform: context.platform,
    appVersion: context.appVersion,
    timezone: context.timezone,
  };
}
