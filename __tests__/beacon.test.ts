import { Beacon } from '../src/beacon';
import { MemoryBeaconDatabase } from '../src/db/beaconDatabase';
import { DeviceContext } from '../src/deviceContext';
import { sanitizeName, sanitizeValue } from '../src/sanitize';

const testContext: DeviceContext = {
  platform: 'test',
  appVersion: '1.0.0',
  buildNumber: '42',
  timezone: 'UTC',
};

interface CapturedRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

function mockClient(
  handler: (request: CapturedRequest) => number,
): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    const status = handler({
      url,
      headers: init.headers as Record<string, string>,
      body: init.body as string,
    });
    return { status } as Response;
  }) as unknown as typeof fetch;
}

describe('sanitizeName', () => {
  test('replaces invalid characters and truncates', () => {
    expect(sanitizeName('  hello-world!  ')).toBe('hello_world_');
    expect(sanitizeName('123bad')).toBe('e_123bad');
    expect(sanitizeName('a'.repeat(50))).toBe('a'.repeat(40));
  });

  test('prefixes empty result', () => {
    expect(sanitizeName('!!!')).toBe('e____');
  });
});

describe('sanitizeValue', () => {
  test('handles null empty and long values', () => {
    expect(sanitizeValue(null)).toBe('');
    expect(sanitizeValue('')).toBe('');
    expect(sanitizeValue('short')).toBe('short');
    expect(sanitizeValue('x'.repeat(150))).toBe('x'.repeat(100));
  });
});

describe('Beacon batching', () => {
  afterEach(async () => {
    if (Beacon.isInitialized) {
      await Beacon.instance.dispose();
    }
  });

  test('queues below batchSize without uploading', async () => {
    let postCount = 0;
    const fetchFn = mockClient(() => {
      postCount++;
      return 202;
    });

    await Beacon.initialize({
      apiKey: 'test_key',
      baseUrl: 'https://example.com',
      batchSize: 3,
      fetchFn,
      database: new MemoryBeaconDatabase(),
      deviceContext: testContext,
    });

    await Beacon.instance.push({
      eventName: 'one',
      funnel: 'funnel',
      type: 'click',
    });
    await Beacon.instance.push({
      eventName: 'two',
      funnel: 'funnel',
      type: 'click',
    });

    expect(postCount).toBe(0);
  });

  test('flushes when batchSize is reached and clears on 202', async () => {
    let postCount = 0;
    let sentEvents: unknown[] | undefined;
    const fetchFn = mockClient((request) => {
      postCount++;
      expect(request.headers['x-api-key']).toBe('test_key');
      expect(request.url.endsWith('/track')).toBe(true);
      const body = JSON.parse(request.body) as { events: unknown[] };
      sentEvents = body.events;
      return 202;
    });

    await Beacon.initialize({
      apiKey: 'test_key',
      baseUrl: 'https://example.com',
      batchSize: 2,
      fetchFn,
      database: new MemoryBeaconDatabase(),
      deviceContext: testContext,
    });

    await Beacon.instance.push({
      eventName: 'one',
      funnel: 'onboarding',
      type: 'nav',
      value: 'a',
      uid: 'u1',
      email: 'a@b.com',
    });
    expect(postCount).toBe(0);

    await Beacon.instance.push({
      eventName: 'two',
      funnel: 'onboarding',
      type: 'nav',
      value: 'b',
      uid: 'u1',
      email: 'a@b.com',
    });

    expect(postCount).toBe(1);
    expect(sentEvents).toHaveLength(2);

    // Queue should be empty; another push should not upload yet.
    await Beacon.instance.push({
      eventName: 'three',
      funnel: 'onboarding',
      type: 'nav',
    });
    expect(postCount).toBe(1);
  });

  test('immediate pushes without waiting for batch', async () => {
    let postCount = 0;
    const fetchFn = mockClient(() => {
      postCount++;
      return 202;
    });

    await Beacon.initialize({
      apiKey: 'test_key',
      baseUrl: 'https://example.com',
      batchSize: 10,
      fetchFn,
      database: new MemoryBeaconDatabase(),
      deviceContext: testContext,
    });

    await Beacon.instance.push({
      eventName: 'urgent',
      funnel: 'checkout',
      type: 'purchase',
      immediate: true,
    });

    expect(postCount).toBe(1);
  });

  test('keeps events when upload is not 202', async () => {
    let postCount = 0;
    const fetchFn = mockClient(() => {
      postCount++;
      return 500;
    });

    await Beacon.initialize({
      apiKey: 'test_key',
      baseUrl: 'https://example.com',
      batchSize: 1,
      fetchFn,
      database: new MemoryBeaconDatabase(),
      deviceContext: testContext,
    });

    await Beacon.instance.push({
      eventName: 'fail',
      funnel: 'funnel',
      type: 'error',
    });
    expect(postCount).toBe(1);

    // Still pending — flush again should retry.
    await Beacon.instance.flush();
    expect(postCount).toBe(2);
  });
});

describe('app-supplied device context', () => {
  afterEach(async () => {
    if (Beacon.isInitialized) {
      await Beacon.instance.dispose();
    }
  });

  test('app values win over what the SDK resolves', async () => {
    let body: { events: { properties: Record<string, unknown> }[] } | undefined;
    const fetchFn = mockClient((request) => {
      body = JSON.parse(request.body);
      return 202;
    });

    await Beacon.initialize({
      apiKey: 'test_key',
      baseUrl: 'https://example.com',
      batchSize: 1,
      fetchFn,
      database: new MemoryBeaconDatabase(),
      platform: 'ios',
      appVersion: '2.5.1',
      buildNumber: '318',
    });

    await Beacon.instance.push({ eventName: 'e', funnel: 'f', type: 't' });

    const props = body!.events[0].properties;
    expect(props.platform).toBe('ios');
    expect(props.app_version).toBe('2.5.1');
    expect(props.build_number).toBe('318');
  });

  test('blank app values fall back to the resolved ones', async () => {
    let body: { events: { properties: Record<string, unknown> }[] } | undefined;
    const fetchFn = mockClient((request) => {
      body = JSON.parse(request.body);
      return 202;
    });

    await Beacon.initialize({
      apiKey: 'test_key',
      baseUrl: 'https://example.com',
      batchSize: 1,
      fetchFn,
      database: new MemoryBeaconDatabase(),
      platform: '   ',
      appVersion: '',
    });

    await Beacon.instance.push({ eventName: 'e', funnel: 'f', type: 't' });

    // Outside a React Native runtime these resolve to their fallbacks,
    // which proves the blank overrides were ignored rather than sent.
    expect(body!.events[0].properties.platform).toBe('unknown');
    expect(body!.events[0].properties.app_version).toBe('');
  });
});

describe('Beacon refresh', () => {
  afterEach(async () => {
    if (Beacon.isInitialized) {
      await Beacon.instance.dispose();
    }
  });

  test('uploads pending events and starts a new session', async () => {
    let postCount = 0;
    const batches: unknown[][] = [];
    const fetchFn = mockClient((request) => {
      postCount++;
      batches.push((JSON.parse(request.body) as { events: unknown[] }).events);
      return 202;
    });

    await Beacon.initialize({
      apiKey: 'test_key',
      baseUrl: 'https://example.com',
      batchSize: 100, // high, so only refresh triggers the upload
      fetchFn,
      database: new MemoryBeaconDatabase(),
      deviceContext: testContext,
    });

    const firstSession = Beacon.instance.sessionToken;

    await Beacon.instance.push({ eventName: 'one', funnel: 'f', type: 't' });
    await Beacon.instance.push({ eventName: 'two', funnel: 'f', type: 't' });
    expect(postCount).toBe(0);

    await Beacon.instance.refresh();

    // Everything pending went up, under the session it was pushed in.
    expect(postCount).toBe(1);
    expect(batches[0]).toHaveLength(2);
    for (const event of batches[0] as { sessionToken: string }[]) {
      expect(event.sessionToken).toBe(firstSession);
    }

    // A new session token is now in effect.
    const secondSession = Beacon.instance.sessionToken;
    expect(secondSession).not.toBe(firstSession);
    expect(secondSession).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    // Events pushed after refresh carry the new token.
    await Beacon.instance.push({ eventName: 'three', funnel: 'f', type: 't' });
    await Beacon.instance.flush();
    expect(postCount).toBe(2);
    expect((batches[1] as { sessionToken: string }[])[0].sessionToken).toBe(
      secondSession,
    );
  });

  test('starts the new session even when the upload fails', async () => {
    const statuses = [500, 202];
    const batches: unknown[][] = [];
    const fetchFn = mockClient((request) => {
      batches.push((JSON.parse(request.body) as { events: unknown[] }).events);
      return statuses.shift() ?? 202;
    });

    await Beacon.initialize({
      apiKey: 'test_key',
      baseUrl: 'https://example.com',
      batchSize: 100,
      fetchFn,
      database: new MemoryBeaconDatabase(),
      deviceContext: testContext,
    });

    const firstSession = Beacon.instance.sessionToken;
    await Beacon.instance.push({ eventName: 'stranded', funnel: 'f', type: 't' });

    await Beacon.instance.refresh();

    const secondSession = Beacon.instance.sessionToken;
    expect(secondSession).not.toBe(firstSession);

    // The undelivered event stayed queued and still belongs to session one.
    await Beacon.instance.push({ eventName: 'fresh', funnel: 'f', type: 't' });
    await Beacon.instance.flush();

    const retried = batches[1] as { eventName: string; sessionToken: string }[];
    expect(retried).toHaveLength(2);
    expect(retried[0].sessionToken).toBe(firstSession);
    expect(retried[1].sessionToken).toBe(secondSession);
  });
});

describe('Beacon identify', () => {
  afterEach(async () => {
    if (Beacon.isInitialized) {
      await Beacon.instance.dispose();
    }
  });

  async function init(fetchFn: typeof fetch, db = new MemoryBeaconDatabase()) {
    await Beacon.initialize({
      apiKey: 'test_key',
      baseUrl: 'https://example.com',
      batchSize: 100, // high, so nothing auto-flushes mid-test
      fetchFn,
      database: db,
      deviceContext: testContext,
    });
    return db;
  }

  test('posts deviceId, email and uid to /identify with the api key', async () => {
    const calls: CapturedRequest[] = [];
    const fetchFn = mockClient((request) => {
      calls.push(request);
      return 202;
    });

    await init(fetchFn);
    await Beacon.instance.identify('device_abc', 'user@example.com', 'uid_123');

    const identifyCalls = calls.filter((c) => c.url.endsWith('/identify'));
    expect(identifyCalls).toHaveLength(1);
    expect(identifyCalls[0].headers['x-api-key']).toBe('test_key');
    expect(JSON.parse(identifyCalls[0].body)).toEqual({
      deviceId: 'device_abc',
      email: 'user@example.com',
      uid: 'uid_123',
    });
  });

  test('uploads queued events before asking for the rewrite', async () => {
    const order: string[] = [];
    const fetchFn = mockClient((request) => {
      order.push(request.url.endsWith('/identify') ? 'identify' : 'track');
      return 202;
    });

    const db = await init(fetchFn);
    await Beacon.instance.push({
      eventName: 'anon_view',
      funnel: 'onboarding',
      type: 'nav',
      email: 'device_abc',
    });

    // Still queued — batchSize is 100.
    expect(await db.pendingCount()).toBe(1);

    await Beacon.instance.identify('device_abc', 'user@example.com', 'uid_123');

    // The queued event must reach the server BEFORE the rewrite runs,
    // otherwise it lands after the UPDATE and keeps the device id forever.
    expect(order).toEqual(['track', 'identify']);
    expect(await db.pendingCount()).toBe(0);
  });

  test('trims both arguments', async () => {
    const calls: CapturedRequest[] = [];
    const fetchFn = mockClient((request) => {
      calls.push(request);
      return 202;
    });

    await init(fetchFn);
    await Beacon.instance.identify('  device_abc  ', '  user@example.com  ', '  uid_123  ');

    const body = JSON.parse(
      calls.filter((c) => c.url.endsWith('/identify'))[0].body,
    );
    expect(body).toEqual({
      deviceId: 'device_abc',
      email: 'user@example.com',
      uid: 'uid_123',
    });
  });

  test('rejects empty arguments', async () => {
    await init(mockClient(() => 202));

    expect(() => Beacon.instance.identify('   ', 'user@example.com', 'uid_123')).toThrow(
      'deviceId must not be empty',
    );
    expect(() => Beacon.instance.identify('device_abc', '  ', 'uid_123')).toThrow(
      'email must not be empty',
    );
    expect(() =>
      Beacon.instance.identify('device_abc', 'user@example.com', '  '),
    ).toThrow('uid must not be empty');
  });

  test('does not throw when the server rejects or the network fails', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await init(mockClient((request) => (request.url.endsWith('/identify') ? 500 : 202)));
    await expect(
      Beacon.instance.identify('device_abc', 'user@example.com', 'uid_123'),
    ).resolves.toBeUndefined();
    await Beacon.instance.dispose();

    const exploding = (async (url: string) => {
      if (String(url).endsWith('/identify')) throw new Error('offline');
      return { status: 202 } as Response;
    }) as unknown as typeof fetch;

    await init(exploding);
    await expect(
      Beacon.instance.identify('device_abc', 'user@example.com', 'uid_123'),
    ).resolves.toBeUndefined();

    warn.mockRestore();
  });

  test('a failed flush does not stop the rewrite request', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const order: string[] = [];
    const fetchFn = mockClient((request) => {
      const kind = request.url.endsWith('/identify') ? 'identify' : 'track';
      order.push(kind);
      return kind === 'track' ? 500 : 202;
    });

    const db = await init(fetchFn);
    await Beacon.instance.push({
      eventName: 'anon_view',
      funnel: 'onboarding',
      type: 'nav',
      email: 'device_abc',
    });

    await Beacon.instance.identify('device_abc', 'user@example.com', 'uid_123');

    expect(order).toEqual(['track', 'identify']);
    // Upload failed, so the event is kept for the next flush — but it now
    // uploads after the rewrite and keeps the device id. Known gap.
    expect(await db.pendingCount()).toBe(1);

    warn.mockRestore();
  });
});
