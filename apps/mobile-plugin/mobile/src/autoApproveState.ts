export interface AutoApproveStateInput {
  readonly upstream: boolean;
  readonly optimistic: boolean | null;
}

export const AUTO_APPROVE_OPTIMISTIC_TIMEOUT_MS = 2_500;

export function resolveAutoApproveState(input: AutoApproveStateInput): boolean {
  return input.optimistic ?? input.upstream;
}

export function shouldRollbackAutoApproveOptimistic(input: {
  readonly optimistic: boolean | null;
  readonly optimisticStartedAtMs: number | null;
  readonly nowMs: number;
}): boolean {
  if (input.optimistic === null || input.optimisticStartedAtMs === null) return false;
  return input.nowMs - input.optimisticStartedAtMs >= AUTO_APPROVE_OPTIMISTIC_TIMEOUT_MS;
}
