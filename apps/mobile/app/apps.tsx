import { Card, DetailHeader, IconBadge, Pill } from '@/ui/kit';
import { MobileIcon, type MobileIconName } from '@/components/MobileIcon';
import { useGatewayStore } from '@/hooks/useGatewayStore';
import { useTheme } from '@/theme/ThemeProvider';
import { sx } from '@/styles/tokens';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

type Tone = 'neutral' | 'brand' | 'success' | 'warn' | 'danger' | 'info';

interface AppEntry {
  readonly key: string;
  readonly title: string;
  readonly description: string;
  readonly icon: MobileIconName;
  readonly tone: Tone;
  readonly count: number;
  readonly route: '/workflows' | '/scheduler';
}

export default function AppsScreen() {
  const { colors } = useTheme();
  const { workflows, scheduler, sessionLoading } = useGatewayStore();
  const router = useRouter();

  useEffect(() => {
    if (sessionLoading) return;
    workflows.refresh();
    scheduler.refresh();
  }, [sessionLoading]);

  const apps: ReadonlyArray<AppEntry> = [
    { key: 'workflows', title: 'Workflows', description: 'Run multi-step agent workflows', icon: 'workflows', tone: 'brand', count: workflows.workflows.length, route: '/workflows' },
    { key: 'schedules', title: 'Schedules', description: 'Cron & one-off scheduled runs', icon: 'scheduler', tone: 'info', count: scheduler.schedules.length, route: '/scheduler' },
  ];

  return (
    <View style={sx('flex-1', { backgroundColor: colors.appBg })}>
      <DetailHeader title="Apps" subtitle="Automations and tools" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ gap: 12, padding: 16, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
        {apps.map((app) => (
          <Pressable key={app.key} accessibilityRole="button" accessibilityLabel={app.title} onPress={() => router.push(app.route)}>
            {({ pressed }) => (
              <Card padded={false} style={pressed ? { backgroundColor: colors.inputSoft } : null}>
                <View style={sx('flex-row items-center px-4', { gap: 14, minHeight: 76 })}>
                  <IconBadge icon={app.icon} tone={app.tone} size={44} />
                  <View style={sx('flex-1', { minWidth: 0 })}>
                    <Text style={sx('text-[16px] font-bold text-text')} numberOfLines={1}>{app.title}</Text>
                    <Text style={sx('mt-0.5 text-[13px] font-medium text-dim')} numberOfLines={1}>{app.description}</Text>
                  </View>
                  <Pill label={String(app.count)} tone={app.tone} />
                  <MobileIcon name="chevronRight" size={18} strokeWidth={2.4} color={colors.textDim} />
                </View>
              </Card>
            )}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
