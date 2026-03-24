export class KingdomError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KingdomError';
  }
}

export class BudgetOverflowError extends KingdomError {
  constructor(model: string, required: number, available: number) {
    super(
      `The treasury is empty! Model "${model}" demands ${required} tokens but only ${available} remain. The kingdom cannot afford this decree.`
    );
    this.name = 'BudgetOverflowError';
  }
}

export class LockConflictError extends KingdomError {
  constructor(filePath: string, owningJobId: string) {
    super(
      `The scroll "${filePath}" is sealed by another scribe (job ${owningJobId}). Patience — thy turn shall come.`
    );
    this.name = 'LockConflictError';
  }
}

export class StalledWorkerError extends KingdomError {
  constructor(jobId: string, lastHeartbeat: string) {
    super(
      `The worker for job ${jobId} hath fallen silent since ${lastHeartbeat}. The Sentinel declares them stalled.`
    );
    this.name = 'StalledWorkerError';
  }
}

export class HeresyDetectedError extends KingdomError {
  constructor(jobId: string, reason: string) {
    super(
      `Heresy detected in job ${jobId}! The edit violates the kingdom's laws: ${reason}. The change is hereby rejected.`
    );
    this.name = 'HeresyDetectedError';
  }
}

export class ConfigurationError extends KingdomError {
  constructor(message: string) {
    super(`The kingdom's scrolls of configuration are amiss: ${message}`);
    this.name = 'ConfigurationError';
  }
}

export class ProviderUnavailableError extends KingdomError {
  constructor(providerId: string) {
    super(
      `The oracle "${providerId}" is unreachable. The kingdom must seek counsel elsewhere.`
    );
    this.name = 'ProviderUnavailableError';
  }
}
