import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { sx } from '../styles/tokens';
import { useTheme } from '@/theme/ThemeProvider';
import { useMobileMenuSearch } from '../hooks/useMobileMenuSearch';
import { useWorkspaceCollapse } from '../hooks/useWorkspaceCollapse';
import { buildWorkspaceSessionTreeState } from '../workspaceSessionTreeUi';
import type { WorkspaceMenuSection } from '../navigation';
import { Glass } from '@/ui/kit';
import { MobileIcon, type MobileIconName } from './MobileIcon';

interface ChatDrawerProps {
  readonly open: boolean;
  readonly connected: boolean;
  readonly workspaceSections: ReadonlyArray<WorkspaceMenuSection>;
  readonly onSelectSession: (id: string) => void;
  readonly onNewSession: (workspaceId?: string) => void;
  readonly onClose: () => void;
}

export function ChatDrawer({ open, connected, workspaceSections, onSelectSession, onNewSession, onClose }: ChatDrawerProps) {
  const { colors } = useTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const panelWidth = Math.min(370, Math.round(width * 0.9));
  const progress = useRef(new Animated.Value(open ? 1 : 0)).current;
  const [rendered, setRendered] = useState(open);
  const search = useMobileMenuSearch(workspaceSections);
  // Expand only the workspace that holds the active session; collapse the rest.
  const collapse = useWorkspaceCollapse(workspaceSections, 1);

  useEffect(() => {
    if (open) setRendered(true);
    Animated.timing(progress, { duration: open ? 220 : 160, toValue: open ? 1 : 0, useNativeDriver: true }).start(({ finished }) => {
      if (finished && !open) setRendered(false);
    });
    if (!open) search.close();
  }, [open, progress]);

  const searching = search.query.trim().length > 0;
  const collapsedIds = searching ? [] : collapse.collapsedWorkspaceIds;
  const tree = useMemo(
    () => buildWorkspaceSessionTreeState(search.filteredSections, collapsedIds),
    [search.filteredSections, collapsedIds],
  );

  if (!rendered) return null;
  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [-panelWidth - 24, 0] });

  const go = (path: '/apps' | '/account') => () => {
    onClose();
    router.push(path);
  };

  return (
    <View style={sx('absolute z-50', { bottom: 0, left: 0, right: 0, top: 0 })}>
      <Animated.View style={[sx('absolute', { bottom: 0, left: 0, right: 0, top: 0 }), { opacity: progress }]}>
        <Pressable accessibilityLabel="Close menu" accessibilityRole="button" onPress={onClose} style={sx('flex-1', { backgroundColor: colors.overlay })} />
      </Animated.View>

      <Animated.View style={[sx('absolute', { bottom: 0, left: 0, top: 0, width: panelWidth }), { transform: [{ translateX }] }]}>
        <Glass heavy intensity={80} style={sx('flex-1', { borderRightColor: colors.glassBorder, borderRightWidth: 1 })}>
          <SafeAreaView style={sx('flex-1')} edges={['top', 'bottom', 'left']}>
            <View style={sx('flex-row items-center justify-between px-3 pt-2', { gap: 8 })}>
              <Text style={sx('pl-1 text-[20px] font-black text-sidebarText')}>Chats</Text>
              <View style={sx('flex-row items-center', { gap: 2 })}>
                <DrawerIcon icon="search" color={search.open ? colors.primary : colors.sidebarText} accessibilityLabel="Search chats" onPress={search.toggle} />
                <DrawerIcon icon="x" color={colors.sidebarText} accessibilityLabel="Close menu" onPress={onClose} />
              </View>
            </View>

            {search.open ? (
              <View style={sx('mx-3 mt-2 flex-row items-center rounded-pill px-3', { backgroundColor: colors.inputSoft, borderColor: colors.glassBorder, borderWidth: 1, gap: 8, height: 44 })}>
                <MobileIcon name="search" size={18} strokeWidth={2.3} color={colors.sidebarTextDim} />
                <TextInput value={search.query} onChangeText={search.setQuery} placeholder="Search chats" placeholderTextColor={colors.sidebarTextDim} autoCapitalize="none" autoCorrect={false} autoFocus style={sx('flex-1 text-[15px] font-medium text-sidebarText', { paddingVertical: 0 })} />
              </View>
            ) : null}

            <ScrollView style={sx('flex-1')} contentContainerStyle={sx('px-3 pb-4 pt-3', { gap: 4 })} keyboardShouldPersistTaps="handled">
              <Pressable
                accessibilityLabel="New chat"
                accessibilityRole="button"
                onPress={() => { onNewSession(); onClose(); }}
                style={({ pressed }) => sx('mb-1 flex-row items-center rounded-card px-3', { backgroundColor: pressed ? colors.sidebarBgActive : colors.sidebarBgHover, gap: 12, minHeight: 48 })}
              >
                <View style={sx('items-center justify-center rounded-full', { backgroundColor: colors.primarySoft, height: 30, width: 30 })}>
                  <MobileIcon name="plus" size={18} strokeWidth={2.6} color={colors.primary} />
                </View>
                <Text style={sx('flex-1 text-[15px] font-bold text-sidebarText')}>New chat</Text>
              </Pressable>

              {tree.sections.length === 0 ? (
                <View style={sx('rounded-card px-3 py-4', { backgroundColor: colors.sidebarBgHover })}>
                  <Text style={sx('text-[13px] font-semibold text-sidebarTextDim')}>{searching ? 'No matching chats.' : 'No chats yet. Start a new one above.'}</Text>
                </View>
              ) : (
                tree.sections.map((section) => (
                  <View key={section.id} style={sx('mt-1')}>
                    <View style={sx('flex-row items-center rounded-card', { gap: 4 })}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={section.toggleAccessibilityLabel}
                        accessibilityState={{ expanded: section.expanded }}
                        onPress={() => collapse.toggleWorkspace(section.id)}
                        style={({ pressed }) => sx('flex-1 flex-row items-center rounded-card px-2', { backgroundColor: pressed ? colors.sidebarBgHover : 'transparent', gap: 8, minHeight: 44 })}
                      >
                        <MobileIcon name={section.expanded ? 'chevronDown' : 'chevronRight'} size={18} strokeWidth={2.6} color={section.expanded ? colors.primary : colors.sidebarTextDim} />
                        <Text style={sx('flex-1 text-[14px] font-bold text-sidebarText')} numberOfLines={1}>{section.title}</Text>
                        <Text style={sx('text-[12px] font-bold text-sidebarTextDim')}>{section.sessionCountLabel}</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`New chat in ${section.title}`}
                        hitSlop={6}
                        onPress={() => { onNewSession(section.id); onClose(); }}
                        style={sx('items-center justify-center rounded-full', { height: 34, width: 34 })}
                      >
                        <MobileIcon name="plus" size={17} strokeWidth={2.4} color={colors.sidebarTextDim} />
                      </Pressable>
                    </View>
                    {section.expanded ? (
                      <View>
                        {section.visibleSessions.map((s) => (
                          <Pressable
                            key={s.id}
                            accessibilityRole="button"
                            accessibilityLabel={s.accessibilityLabel}
                            onPress={() => { onSelectSession(s.id); onClose(); }}
                            style={({ pressed }) => sx('flex-row items-center rounded-card px-3', { backgroundColor: s.active ? colors.sidebarBgActive : pressed ? colors.sidebarBgHover : 'transparent', gap: 8, minHeight: 42, paddingLeft: 12 })}
                          >
                            <Text style={sx(`flex-1 text-[14px] ${s.active ? 'font-bold' : 'font-medium'} text-sidebarText`)} numberOfLines={1}>{s.title}</Text>
                            {s.statusLabel ? (
                              <View style={sx('rounded-pill px-2', { backgroundColor: colors.primarySoft, paddingVertical: 2 })}>
                                <Text style={sx('text-[10px] font-black text-primary')}>{s.statusLabel.toUpperCase()}</Text>
                              </View>
                            ) : null}
                          </Pressable>
                        ))}
                      </View>
                    ) : null}
                  </View>
                ))
              )}
            </ScrollView>

            <View style={sx('border-t px-3 pb-2 pt-2', { borderTopColor: colors.glassBorder, gap: 2 })}>
              <FooterRow icon="grid" label="Apps" onPress={go('/apps')} />
              <FooterRow icon="user" label="Account" onPress={go('/account')} />
            </View>
          </SafeAreaView>
        </Glass>
      </Animated.View>
    </View>
  );
}

function FooterRow({ icon, label, onPress }: { readonly icon: MobileIconName; readonly label: string; readonly onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => sx('flex-row items-center rounded-card px-3', { backgroundColor: pressed ? colors.sidebarBgHover : 'transparent', gap: 12, minHeight: 48 })}>
      <MobileIcon name={icon} size={20} strokeWidth={2.3} color={colors.sidebarText} />
      <Text style={sx('flex-1 text-[15px] font-semibold text-sidebarText')}>{label}</Text>
      <MobileIcon name="chevronRight" size={16} strokeWidth={2.4} color={colors.sidebarTextDim} />
    </Pressable>
  );
}

function DrawerIcon({ icon, color, accessibilityLabel, onPress }: { readonly icon: MobileIconName; readonly color: string; readonly accessibilityLabel: string; readonly onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} hitSlop={8} onPress={onPress} style={({ pressed }) => sx('h-11 w-11 items-center justify-center rounded-full', { backgroundColor: pressed ? colors.sidebarBgHover : 'transparent' })}>
      <MobileIcon name={icon} size={20} strokeWidth={2.4} color={color} />
    </Pressable>
  );
}
