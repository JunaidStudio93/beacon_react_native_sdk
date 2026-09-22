import { Beacon } from '../src/beacon';
import { MemoryBeaconDatabase } from '../src/db/beaconDatabase';
import { DeviceContext } from '../src/deviceContext';
import { sanitizeName, sanitizeValue } from '../src/sanitize';

const testContext: DeviceContext = {
  platform: 'test',
  appVersion: '1.0.0',
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
