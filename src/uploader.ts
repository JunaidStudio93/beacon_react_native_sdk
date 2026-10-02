import { BeaconConfig } from './beaconConfig';
import { BeaconEvent, eventToJson } from './eventModel';

/// Posts batched events to the Beacon track endpoint.
export class BeaconUploader {
  private readonly config: BeaconConfig;
  private readonly fetchFn: typeof fetch;

  constructor(params: { config: BeaconConfig; fetchFn?: typeof fetch }) {
    this.config = params.config;
    this.fetchFn = params.fetchFn ?? fetch;
  }

  /// Returns `true` when the server accepts the batch (HTTP 202).
  async upload(events: BeaconEvent[]): Promise<boolean> {
    if (events.length === 0) return true;

    const response = await this.fetchFn(this.config.trackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
      },
      body: JSON.stringify({
        events: events.map(eventToJson),
      }),
    });

    return response.status === 202;
  }

  /// Asks the API to rewrite a device's anonymous history onto a real email.
  /// Returns `true` when the server accepts the request (HTTP 202).
  ///
  /// 202 means the backfill job was submitted, not that it has finished — the
  /// rewrite completes inside BigQuery a few seconds later.
  async identify(deviceId: string, email: string): Promise<boolean> {
    const response = await this.fetchFn(this.config.identifyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
      },
      body: JSON.stringify({ deviceId, email }),
    });

    return response.status === 202;
  }
}
