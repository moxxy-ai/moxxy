export interface SessionCommandResult {
  readonly kind: 'text' | 'session-action' | 'noop' | 'error';
  readonly text?: string;
  readonly action?: 'new' | 'clear' | 'exit';
  readonly notice?: string;
  readonly message?: string;
}

export interface MobileActionResultDispatch {
  readonly type: 'action_result';
  readonly commandName: string;
  readonly argsLine: string;
  readonly tone: 'info' | 'notice' | 'error';
  readonly text: string;
}

export interface NormalizedSessionCommandResult {
  readonly sideEffect: 'clear' | 'new' | null;
  readonly dispatch: MobileActionResultDispatch | null;
}

export function normalizeSessionCommandResult(
  commandName: string,
  argsLine: string,
  result: SessionCommandResult,
): NormalizedSessionCommandResult {
  const sideEffect = result.kind === 'session-action' && isClearOrNew(result.action) ? result.action : null;
  const text =
    result.kind === 'text'
      ? result.text ?? ''
      : result.kind === 'error'
        ? result.message ?? 'command failed'
        : result.kind === 'session-action'
          ? result.notice ?? result.text ?? ''
          : '';
  const silent = result.kind === 'noop' || (result.kind === 'session-action' && !text.trim());
  if (silent) return { sideEffect, dispatch: null };
  return {
    sideEffect,
    dispatch: {
      type: 'action_result',
      commandName,
      argsLine,
      tone: result.kind === 'error' ? 'error' : result.kind === 'session-action' ? 'notice' : 'info',
      text,
    },
  };
}

function isClearOrNew(value: unknown): value is 'clear' | 'new' {
  return value === 'clear' || value === 'new';
}
