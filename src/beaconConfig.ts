/// Runtime Beacon configuration and session state.
export class BeaconConfig {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly batchSize: number;
  readonly sessionToken: string;

  constructor(params: {
    apiKey: string;
    baseUrl: string;
    batchSize: number;
    sessionToken: string;
  }) {
    this.apiKey = params.apiKey;
    this.baseUrl = params.baseUrl;
    this.batchSize = params.batchSize;
    this.sessionToken = params.sessionToken;
  }

  get trackUrl(): string {
    const normalized = this.baseUrl.endsWith('/')
      ? this.baseUrl.slice(0, this.baseUrl.length - 1)
      : this.baseUrl;
    return `${normalized}/track`;
  }
}
