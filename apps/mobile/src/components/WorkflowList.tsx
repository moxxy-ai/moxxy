import { sx } from '../styles/tokens';
import { Pressable, Text, View } from 'react-native';
import type { MobileWorkflow } from '../hooks/useWorkflows';
import { MobileIcon } from './MobileIcon';

interface WorkflowListProps {
  readonly workflows: ReadonlyArray<MobileWorkflow>;
  readonly onRefresh: () => void;
  readonly onRun: (name: string) => void;
}

export function WorkflowList({ workflows, onRefresh, onRun }: WorkflowListProps) {
  return (
    <View style={sx('gap-3')}>
      <Pressable
        style={sx('min-h-12 flex-row items-center justify-center gap-2 rounded-card border border-cardBorder bg-cardBg')}
        onPress={onRefresh}
      >
        <MobileIcon name="workflows" size={18} strokeWidth={2.35} color="#475569" />
        <Text style={sx('text-[13px] font-bold text-muted')}>Refresh workflows</Text>
      </Pressable>

      {workflows.length === 0 ? (
        <View style={sx('rounded-card border border-cardBorder bg-cardBg p-5 shadow-card', { shadowOpacity: 0.08 })}>
          <Text style={sx('text-[16px] font-black text-text')}>No workflows visible</Text>
          <Text style={sx('mt-1 text-[13px] leading-5 text-muted')}>
            Start Moxxy with the workflows plugin enabled, then refresh this list.
          </Text>
        </View>
      ) : null}

      {workflows.map((workflow) => (
        <View
          key={workflow.name}
          style={sx('rounded-card border border-cardBorder bg-cardBg p-4 shadow-card', { shadowOpacity: 0.08 })}
        >
          <View style={sx('flex-row items-start gap-3')}>
            <View style={sx(`mt-1.5 h-2 w-2 rounded-pill ${workflow.enabled ? 'bg-green' : 'bg-cardBorderStrong'}`)} />
            <View style={sx('min-w-0 flex-1')}>
              <Text style={sx('text-[16px] font-black leading-6 text-text')}>{workflow.name}</Text>
              {workflow.description ? (
                <Text style={sx('mt-1 text-[13px] leading-5 text-muted')}>{workflow.description}</Text>
              ) : null}
              <View style={sx('mt-3 flex-row flex-wrap gap-2')}>
                <Badge label={workflow.enabled ? 'Enabled' : 'Disabled'} tone={workflow.enabled ? 'green' : 'muted'} />
                {workflow.scope ? <Badge label={workflow.scope} tone="muted" /> : null}
                <Badge label={`${workflow.steps} steps`} tone="muted" />
                {workflow.triggers ? <Badge label={workflow.triggers} tone="muted" /> : null}
              </View>
            </View>
          </View>
          <Pressable
            style={sx('mt-4 min-h-11 flex-row items-center justify-center gap-2 rounded-pill bg-primary px-4')}
            onPress={() => onRun(workflow.name)}
          >
            <MobileIcon name="send" size={17} strokeWidth={2.4} color="#ffffff" />
            <Text style={sx('text-[13px] font-black text-white')}>Run workflow</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

function Badge({ label, tone }: { readonly label: string; readonly tone: 'green' | 'muted' }) {
  return (
    <View style={sx(`rounded-pill px-3 py-1 ${tone === 'green' ? 'bg-green/10' : 'bg-appBg'}`)}>
      <Text style={sx(`text-[11px] font-black ${tone === 'green' ? 'text-green' : 'text-muted'}`)}>{label}</Text>
    </View>
  );
}
