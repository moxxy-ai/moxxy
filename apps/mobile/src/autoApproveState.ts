export interface AutoApproveStateInput {
  readonly upstream: boolean;
  readonly optimistic: boolean | null;
}

export function resolveAutoApproveState(input: AutoApproveStateInput): boolean {
  return input.optimistic ?? input.upstream;
}
