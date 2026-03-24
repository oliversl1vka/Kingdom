export class ProviderError extends Error {
  public readonly provider_id: string;
  public readonly statusCode: number;
  public readonly retryable: boolean;
  public readonly rateLimitRemaining?: number;

  constructor(message: string, providerId: string, statusCode: number, retryable: boolean, rateLimitRemaining?: number) {
    super(message);
    this.name = 'ProviderError';
    this.provider_id = providerId;
    this.statusCode = statusCode;
    this.retryable = retryable;
    this.rateLimitRemaining = rateLimitRemaining;
  }
}
