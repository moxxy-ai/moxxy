import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ScrollView, Text, View } from 'react-native';
import {
  Button,
  Card,
  DetailHeader,
  EmptyState,
  IconBadge,
  IconButton,
  Pill,
} from '@/ui/kit';
import { useGatewayStore } from '@/hooks/useGatewayStore';
import { useTheme } from '@/theme/ThemeProvider';
import { sx } from '@/styles/tokens';

export default function WorkflowsScreen() {
  const { colors } = useTheme();
  const { workflows, sessionLoading } = useGatewayStore();
  const router = useRouter();

  useEffect(() => {
    if (sessionLoading) return;
    workflows.refresh();
  }, [sessionLoading, workflows.refresh]);

  return (
    <View style={[sx('flex-1'), { backgroundColor: colors.appBg }]}>
      <DetailHeader
        title="Workflows"
        subtitle={`${workflows.workflows.length} available`}
        onBack={() => router.back()}
        right={
          <IconButton
            icon="refresh"
            variant="ghost"
            accessibilityLabel="Refresh"
            onPress={() => workflows.refresh()}
          />
        }
      />
      <ScrollView
        style={sx('flex-1')}
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
      >
        {workflows.workflows.length === 0 ? (
          <EmptyState
            icon="workflows"
            title="No workflows"
            body="Workflows defined on your desktop will show up here."
          />
        ) : (
          workflows.workflows.map((workflow) => (
            <Card key={workflow.name}>
              <View style={sx('flex-row items-center', { gap: 12 })}>
                <IconBadge icon="workflows" tone="brand" />
                <Text
                  style={sx('flex-1 text-[16px] font-black text-text', { minWidth: 0 })}
                  numberOfLines={1}
                >
                  {workflow.name}
                </Text>
                <Pill
                  label={workflow.enabled ? 'Enabled' : 'Disabled'}
                  tone={workflow.enabled ? 'success' : 'neutral'}
                />
              </View>

              {workflow.description ? (
                <Text style={sx('mt-3 text-[14px] font-medium text-muted', { lineHeight: 20 })}>
                  {workflow.description}
                </Text>
              ) : null}

              <View style={sx('mt-3 flex-row items-center', { gap: 12 })}>
                <Text style={sx('text-[12px] font-semibold text-dim')}>
                  {`${workflow.steps} steps`}
                </Text>
                {workflow.triggers ? (
                  <Text
                    style={sx('flex-1 text-[12px] font-medium text-dim', { minWidth: 0 })}
                    numberOfLines={1}
                  >
                    {workflow.triggers}
                  </Text>
                ) : null}
              </View>

              <View style={sx('mt-4')}>
                <Button
                  size="md"
                  label="Run"
                  icon="play"
                  disabled={!workflow.enabled}
                  onPress={() => workflows.run(workflow.name)}
                />
              </View>
            </Card>
          ))
        )}
      </ScrollView>
    </View>
  );
}
