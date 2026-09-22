import { BeaconConfig } from './beaconConfig';
import { BeaconDatabase, SqliteBeaconDatabase } from './db/beaconDatabase';
import { DeviceContext, deviceContextToMap } from './deviceContext';
import { resolveDeviceContext } from './deviceContextResolver';
import { BeaconEvent, eventFromStored } from './eventModel';
import { sanitizeName, sanitizeValue } from './sanitize';
import { BeaconUploader } from './uploader';
import { uuidV4 } from './uuid';

export interface BeaconInitializeOptions {
  apiKey: string;
  baseUrl: string;
  batchSize?: number;
  fetchFn?: typeof fetch;
  database?: BeaconDatabase;
  deviceContext?: DeviceContext;
}

export interface BeaconPushOptions {
  eventName: string;
  funnel: string;
  type: string;
  value?: string | null;
  uid?: string;
  email?: string;
  properties?: Record<string, unknown>;
  immediate?: boolean;
}

/// Beacon event tracking SDK facade.
export class Beacon {
  private static _instance: Beacon | null = null;

  private readonly config: BeaconConfig;
  private readonly database: BeaconDatabase;
  private readonly deviceContext: DeviceContext;
  private readonly uploader: BeaconUploader;

  /// Mutex so concurrent push/flush calls do not double-send the same rows.
  private flushLock: Promise<void> = Promise.resolve();

  private constructor(params: {
    config: BeaconConfig;
    database: BeaconDatabase;
    deviceContext: DeviceContext;
    uploader: BeaconUploader;
  }) {
    this.config = params.config;
    this.database = params.database;
    this.deviceContext = params.deviceContext;
    this.uploader = params.uploader;
  }

  /// Returns the initialized singleton. Throws if [initialize] was not called.
  static get instance(): Beacon {
    const current = Beacon._instance;
    if (current === null) {
      throw new Error(
        'Beacon has not been initialized. Call Beacon.initialize() first.',
      );
    }
    return current;
  }

  /// Whether [initialize] has completed successfully.
  static get isInitialized(): boolean {
    return Beacon._instance !== null;
  }

  /// Initializes the SDK. Safe to call once per process; subsequent calls
  /// replace the previous instance after closing its database.
  static async initialize(options: BeaconInitializeOptions): Promise<Beacon> {
    const { apiKey, baseUrl, batchSize = 10 } = options;

    if (apiKey.trim().length === 0) {
      throw new Error('apiKey must not be empty');
    }
    if (baseUrl.trim().length === 0) {
      throw new Error('baseUrl must not be empty');
    }
    if (batchSize < 1) {
      throw new Error('batchSize must be >= 1');
    }

    const previous = Beacon._instance;
    if (previous !== null) {
      await previous.database.close();
      Beacon._instance = null;
    }

    const config = new BeaconConfig({
      apiKey,
      baseUrl: baseUrl.trim(),
      batchSize,
      sessionToken: uuidV4(),
    });

    const db = options.database ?? new SqliteBeaconDatabase();
    const context = options.deviceContext ?? (await resolveDeviceContext());
    const uploader = new BeaconUploader({ config, fetchFn: options.fetchFn });

    const beacon = new Beacon({
      config,
      database: db,
      deviceContext: context,
      uploader,
    });
    Beacon._instance = beacon;

    // Flush any leftover events from a previous session.
    await beacon.flush();

    return beacon;
  }

  /// Queues an event. When [immediate] is true, or the pending count reaches
  /// [BeaconConfig.batchSize], flushes the queue to the API.
  async push(options: BeaconPushOptions): Promise<void> {
    const {
      eventName,
      funnel,
      type,
      value,
      uid = 'anonymous',
      email = 'anonymous',
      properties,
      immediate = false,
    } = options;

    const props: Record<string, unknown> = {
      type,
      value: sanitizeValue(value),
      ...deviceContextToMap(this.deviceContext),
      ...(properties ?? {}),
    };

    await this.database.insertEvent({
      eventName: sanitizeName(eventName),
      funnel: sanitizeName(funnel),
      uid,
      email,
      sessionToken: this.config.sessionToken,
      timestamp: new Date().toISOString(),
      propertiesJson: JSON.stringify(props),
    });

    if (immediate) {
      await this.flush();
      return;
    }

    const count = await this.database.pendingCount();
    if (count >= this.config.batchSize) {
      await this.flush();
    }
  }

  /// Uploads all pending events. On HTTP 202, deletes only the sent rows.
  flush(): Promise<void> {
    const previous = this.flushLock;
    const current = previous.then(() => this.flushInternal());
    this.flushLock = current.catch(() => {});
    return current;
  }

  private async flushInternal(): Promise<void> {
    const rows = await this.database.allPending();
    if (rows.length === 0) return;

    const events: BeaconEvent[] = rows.map((row) =>
      eventFromStored({
        eventName: row.eventName,
        uid: row.uid,
        funnel: row.funnel,
        sessionToken: row.sessionToken,
        timestamp: row.timestamp,
        email: row.email,
        propertiesJson: row.propertiesJson,
      }),
    );

    try {
      const accepted = await this.uploader.upload(events);
      if (accepted) {
        await this.database.deleteByIds(rows.map((r) => r.id));
      } else {
        console.warn('Beacon: upload rejected (non-202); events kept for retry');
      }
    } catch (e) {
      console.warn('Beacon: upload failed; events kept for retry', e);
    }
  }

  /// Closes the local database. Useful in tests.
  async dispose(): Promise<void> {
    await this.database.close();
    if (Beacon._instance === this) {
      Beacon._instance = null;
    }
  }
}
