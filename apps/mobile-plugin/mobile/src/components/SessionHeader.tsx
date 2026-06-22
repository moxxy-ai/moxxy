import { sx } from '../styles/tokens';
import { Text, View } from 'react-native';
import { textOf } from '@/utils/record';

interface SessionHeaderProps {
  readonly connected: boolean;
  readonly session: Record<string, unknown> | null;
  readonly agents: ReadonlyArray<Record<string, unknown>>;
  readonly activeMode?: string | null;
  readonly activeProvider?: string | null;
}

export function SessionHeader({
  connected,
  session,
  agents,
  activeMode,
  activeProvider,
}: SessionHeaderProps) {
  return (
    <View style={sx('rounded-card border border-cardBorder bg-cardBg p-4 shadow-card')}>
      <View style={sx('flex-row items-center gap-2')}>
        <View style={sx(`h-2.5 w-2.5 rounded-pill ${connected ? 'bg-green' : 'bg-amber'}`)} />
        <Text style={sx('text-[13px] font-bold text-muted')}>{connected ? 'Connected' : 'Waiting for gateway'}</Text>
      </View>
      <Text style={sx('mt-2 text-[17px] font-bold text-text')}>
        {textOf(session?.id, 'No active session')}
      </Text>
      <View style={sx('mt-3 flex-row flex-wrap gap-2')}>
        <Pill label={activeProvider ?? 'Provider'} />
        <Pill label={activeMode ?? 'Mode'} />
        <Pill label={`${agents.length} agent${agents.length === 1 ? '' : 's'}`} />
      </View>
    </View>
  );
}

function Pill({ label }: { readonly label: string }) {
  return (
    <View style={sx('rounded-pill bg-primarySoft px-3 py-1')}>
      <Text style={sx('text-[11px] font-bold text-primaryStrong')}>{label}</Text>
    </View>
  );
}
