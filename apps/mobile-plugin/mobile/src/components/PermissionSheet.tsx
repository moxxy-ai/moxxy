import { AskSheet } from './AskSheet';

interface PermissionSheetProps {
  readonly permissions: ReadonlyArray<Record<string, unknown>>;
  readonly onDecision: (permissionId: string, mode: 'allow_once' | 'allow_session' | 'allow_always' | 'deny') => void;
}

export function PermissionSheet({ permissions, onDecision }: PermissionSheetProps) {
  return (
    <AskSheet
      asks={[]}
      permissions={permissions}
      onAskResponse={() => undefined}
      onPermissionDecision={onDecision}
    />
  );
}
