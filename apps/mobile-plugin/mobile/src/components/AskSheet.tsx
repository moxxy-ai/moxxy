import { ScrollView, Text, View } from 'react-native';
import { recordId, textOf } from '@/utils/record';
import type { PermissionResponseMode } from '../permissionResponse';
import { ApprovalCard } from './ApprovalCard';
import { PermissionCard } from './PermissionCard';

interface AskSheetProps {
  readonly asks: ReadonlyArray<Record<string, unknown>>;
  readonly permissions: ReadonlyArray<Record<string, unknown>>;
  readonly maxHeight?: number;
  readonly onAskResponse: (requestId: string, response: Record<string, unknown>) => void;
  readonly onPermissionDecision: (permissionId: string, mode: PermissionResponseMode) => void;
}

export function AskSheet(props: AskSheetProps) {
  const total = props.asks.length + props.permissions.length;
  if (total === 0) {
    return (
      <View className="mt-8 items-center rounded-card border border-cardBorder bg-cardBg px-5 py-8">
        <Text className="text-center text-[16px] font-bold text-text">No pending actions</Text>
        <Text className="mt-1 text-center text-[13px] text-muted">Approvals and permissions will appear here.</Text>
      </View>
    );
  }

  const firstAsk = props.asks[0];
  const firstPermission = firstAsk ? null : props.permissions[0];
  const extraCount = total - 1;

  return (
    <ScrollView
      className="gap-2"
      keyboardShouldPersistTaps="handled"
      style={{ maxHeight: props.maxHeight }}
      contentContainerStyle={{ gap: 8 }}
    >
      {extraCount > 0 ? (
        <View className="self-start rounded-pill bg-cardBg px-3 py-1.5">
          <Text className="text-[11px] font-bold text-muted">+{extraCount} more pending</Text>
        </View>
      ) : null}
      {firstAsk ? (
        (() => {
          const requestId = textOf(firstAsk.requestId, 'ask-0');
          const kind = textOf(firstAsk.kind, 'permission');
          return kind === 'approval' ? (
          <ApprovalCard
            key={requestId}
            ask={firstAsk}
            onRespond={(response) => props.onAskResponse(requestId, response)}
          />
        ) : (
          <PermissionCard
            key={requestId}
            ask={firstAsk}
            onRespond={(response) => props.onAskResponse(requestId, response)}
          />
        );
        })()
      ) : null}
      {firstPermission ? (
        (() => {
          const id = recordId(firstPermission, 'permission-0');
          return (
          <PermissionCard
            key={id}
            ask={firstPermission}
            onRespond={(response) =>
              props.onPermissionDecision(id, textOf(response.mode, 'deny') as PermissionResponseMode)
            }
          />
          );
        })()
      ) : null}
    </ScrollView>
  );
}
