export const BROWSER_ERROR_CODES = [
  'INVALID_BROWSER_ACTION',
  'STALE_BROWSER_STATE',
  'ELEMENT_NOT_FOUND',
  'ELEMENT_NOT_INTERACTABLE',
  'NAVIGATION_BLOCKED',
  'BACKEND_MISMATCH',
  'USER_TAKEOVER',
  'USER_ABORTED',
  'TIMEOUT',
] as const;

export type BrowserErrorCode = (typeof BROWSER_ERROR_CODES)[number];
export type BrowserNextAction = 'observe' | 'stop' | 'ask_user' | 'retry_once' | 'restart';

export interface BrowserErrorDetails {
  readonly code: BrowserErrorCode;
  readonly message: string;
  readonly nextAction: BrowserNextAction;
  readonly retryable: boolean;
}

export class BrowserOperationError extends Error {
  readonly code: BrowserErrorCode;
  readonly nextAction: BrowserNextAction;
  readonly retryable: boolean;

  constructor(details: BrowserErrorDetails) {
    super(details.message);
    this.name = 'BrowserOperationError';
    this.code = details.code;
    this.nextAction = details.nextAction;
    this.retryable = details.retryable;
  }
}

export function browserErrorDetails(error: unknown): BrowserErrorDetails {
  if (error instanceof BrowserOperationError) {
    return {
      code: error.code,
      message: error.message,
      nextAction: error.nextAction,
      retryable: error.retryable,
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/STALE_BROWSER_STATE/i.test(message)) {
    return { code: 'STALE_BROWSER_STATE', message, nextAction: 'observe', retryable: true };
  }
  if (/ELEMENT_NOT_FOUND|not found|waiting for selector/i.test(message)) {
    return { code: 'ELEMENT_NOT_FOUND', message, nextAction: 'observe', retryable: true };
  }
  if (/ELEMENT_NOT_INTERACTABLE|not visible|not editable|not fillable/i.test(message)) {
    return { code: 'ELEMENT_NOT_INTERACTABLE', message, nextAction: 'observe', retryable: true };
  }
  if (/SSRF|NAVIGATION_BLOCKED|blocked.*navigation|only http/i.test(message)) {
    return { code: 'NAVIGATION_BLOCKED', message, nextAction: 'stop', retryable: false };
  }
  if (/BACKEND_MISMATCH|protocol|bridge.*missing/i.test(message)) {
    return { code: 'BACKEND_MISMATCH', message, nextAction: 'restart', retryable: false };
  }
  if (/USER_TAKEOVER/i.test(message)) {
    return { code: 'USER_TAKEOVER', message, nextAction: 'observe', retryable: true };
  }
  if (/abort/i.test(message)) {
    return { code: 'USER_ABORTED', message, nextAction: 'stop', retryable: false };
  }
  if (/timeout|timed out/i.test(message)) {
    return { code: 'TIMEOUT', message, nextAction: 'observe', retryable: true };
  }
  return {
    code: 'INVALID_BROWSER_ACTION',
    message,
    nextAction: 'stop',
    retryable: false,
  };
}

export function formatBrowserErrorForModel(details: BrowserErrorDetails): string {
  return `[${details.code}] ${details.message} Next action: ${details.nextAction}. Retryable: ${String(details.retryable)}.`;
}
