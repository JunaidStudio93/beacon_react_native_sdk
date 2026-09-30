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
