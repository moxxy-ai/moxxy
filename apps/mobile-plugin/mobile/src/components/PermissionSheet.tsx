import { AskSheet } from './AskSheet';
import type { PermissionResponseMode } from '../permissionResponse';

interface PermissionSheetProps {
  readonly permissions: ReadonlyArray<Record<string, unknown>>;
  readonly onDecision: (permissionId: string, mode: PermissionResponseMode) => void;
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
