export type PermissionAction = 'allow_once' | 'allow_session' | 'allow_always' | 'deny';
export type PermissionResponseMode = 'allow' | 'allow_session' | 'allow_always' | 'deny';

export type PermissionResponse = Record<string, unknown> & {
  readonly mode: PermissionResponseMode;
};

export function permissionResponseForAction(action: PermissionAction): PermissionResponse {
  return {
    mode: action === 'allow_once' ? 'allow' : action,
  };
}
