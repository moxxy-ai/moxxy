import { Pressable, Text, View } from 'react-native';
import type { MobileWorkflow } from '../hooks/useWorkflows';
import { MobileIcon } from './MobileIcon';

interface WorkflowListProps {
  readonly workflows: ReadonlyArray<MobileWorkflow>;
  readonly onRefresh: () => void;
  readonly onRun: (name: string) => void;
  /** Open the visual builder for a workflow (or a blank one when null). */
  readonly onEdit?: (name: string | null) => void;
}

export function WorkflowList({ workflows, onRefresh, onRun, onEdit }: WorkflowListProps) {
  return (
    <View className="gap-3">
      {onEdit ? (
        <Pressable
          testID="mobile-new-workflow"
          className="min-h-12 flex-row items-center justify-center gap-2 rounded-card bg-primary"
          onPress={() => onEdit(null)}
        >
          <MobileIcon name="plus" size={18} strokeWidth={2.6} color="#ffffff" />
          <Text className="text-[13px] font-black text-white">New workflow</Text>
        </Pressable>
      ) : null}
      <Pressable
        className="min-h-12 flex-row items-center justify-center gap-2 rounded-card border border-cardBorder bg-cardBg"
        onPress={onRefresh}
      >
        <MobileIcon name="workflows" size={18} strokeWidth={2.35} color="#475569" />
        <Text className="text-[13px] font-bold text-muted">Refresh workflows</Text>
      </Pressable>

      {workflows.length === 0 ? (
        <View className="rounded-card border border-cardBorder bg-cardBg p-5 shadow-card" style={{ shadowOpacity: 0.08 }}>
          <Text className="text-[16px] font-black text-text">No workflows visible</Text>
          <Text className="mt-1 text-[13px] leading-5 text-muted">
            Start Moxxy with the workflows plugin enabled, then refresh this list.
          </Text>
        </View>
      ) : null}

      {workflows.map((workflow) => (
        <View
          key={workflow.name}
          className="rounded-card border border-cardBorder bg-cardBg p-4 shadow-card"
          style={{ shadowOpacity: 0.08 }}
        >
          <View className="flex-row items-start gap-3">
            <View className={`mt-1.5 h-2 w-2 rounded-pill ${workflow.enabled ? 'bg-green' : 'bg-cardBorderStrong'}`} />
            <View className="min-w-0 flex-1">
              <Text className="text-[16px] font-black leading-6 text-text">{workflow.name}</Text>
              {workflow.description ? (
                <Text className="mt-1 text-[13px] leading-5 text-muted">{workflow.description}</Text>
              ) : null}
              <View className="mt-3 flex-row flex-wrap gap-2">
                <Badge label={workflow.enabled ? 'Enabled' : 'Disabled'} tone={workflow.enabled ? 'green' : 'muted'} />
                {workflow.scope ? <Badge label={workflow.scope} tone="muted" /> : null}
                <Badge label={`${workflow.steps} steps`} tone="muted" />
                {workflow.triggers ? <Badge label={workflow.triggers} tone="muted" /> : null}
              </View>
            </View>
          </View>
          <View className="mt-4 flex-row gap-2">
            {onEdit ? (
              <Pressable
                testID={`mobile-edit-${workflow.name}`}
                className="min-h-11 flex-1 flex-row items-center justify-center gap-2 rounded-pill border border-purple px-4"
                onPress={() => onEdit(workflow.name)}
              >
                <MobileIcon name="edit" size={16} strokeWidth={2.4} color="#8b5cf6" />
                <Text className="text-[13px] font-black text-purple">Edit</Text>
              </Pressable>
            ) : null}
            <Pressable
              className="min-h-11 flex-1 flex-row items-center justify-center gap-2 rounded-pill bg-primary px-4"
              onPress={() => onRun(workflow.name)}
            >
              <MobileIcon name="send" size={17} strokeWidth={2.4} color="#ffffff" />
              <Text className="text-[13px] font-black text-white">Run</Text>
            </Pressable>
          </View>
        </View>
      ))}
    </View>
  );
}

function Badge({ label, tone }: { readonly label: string; readonly tone: 'green' | 'muted' }) {
  return (
    <View className={`rounded-pill px-3 py-1 ${tone === 'green' ? 'bg-green/10' : 'bg-appBg'}`}>
      <Text className={`text-[11px] font-black ${tone === 'green' ? 'text-green' : 'text-muted'}`}>{label}</Text>
    </View>
  );
}
