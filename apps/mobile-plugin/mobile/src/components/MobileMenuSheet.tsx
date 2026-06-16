import { Link } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useMobileMenuSearch } from '../hooks/useMobileMenuSearch';
import type { MobileMenuItem, WorkspaceMenuSection, WorkspaceMenuSession } from '../navigation';
import { MobileIcon } from './MobileIcon';

interface MobileMenuSheetProps {
  readonly open: boolean;
  readonly items: ReadonlyArray<MobileMenuItem>;
  readonly connected: boolean;
  readonly sessionLabel: string;
  readonly modeLabel: string;
  readonly providerLabel: string;
  readonly autoApprove: boolean;
  readonly workspaceSections: ReadonlyArray<WorkspaceMenuSection>;
  readonly collapsedWorkspaceIds: ReadonlyArray<string>;
  readonly onSelectSession: (id: string) => void;
  readonly onNewSession: (workspaceId?: string) => void;
  readonly onCommand: (name: string, args?: string) => void;
  readonly onToggleWorkspace: (workspaceId: string) => void;
  readonly onClose: () => void;
}

export function MobileMenuSheet({
  open,
  items,
  connected,
  sessionLabel,
  modeLabel,
  providerLabel,
  autoApprove,
  workspaceSections,
  collapsedWorkspaceIds,
  onSelectSession,
  onNewSession,
  onCommand,
  onToggleWorkspace,
  onClose,
}: MobileMenuSheetProps) {
  const progress = useRef(new Animated.Value(open ? 1 : 0)).current;
  const [rendered, setRendered] = useState(open);
  const search = useMobileMenuSearch(workspaceSections);

  useEffect(() => {
    if (open) setRendered(true);
    Animated.timing(progress, {
      duration: open ? 240 : 160,
      toValue: open ? 1 : 0,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !open) setRendered(false);
    });
    if (!open) search.close();
  }, [open, progress]);

  if (!rendered) return null;
  const collapsedSet = new Set(search.query.trim().length > 0 ? [] : collapsedWorkspaceIds);

  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-28, 0],
  });
  const scale = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.985, 1],
  });

  return (
    <Animated.View
      className="absolute inset-0 z-50 bg-appBg"
      style={{
        backgroundColor: '#f1f2f9',
        bottom: 0,
        left: 0,
        opacity: progress,
        position: 'absolute',
        right: 0,
        top: 0,
        transform: [{ translateX }, { scale }],
        zIndex: 50,
      }}
    >
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 96, paddingHorizontal: 20, paddingTop: 18 }}>
        <View className="flex-row items-center justify-between gap-4">
          <View className="min-w-0 flex-1">
            <Text className="text-[30px] font-black leading-9 text-text">Moxxy</Text>
            <View className="mt-1.5 flex-row items-center gap-2">
              <View className={`h-2 w-2 rounded-pill ${connected ? 'bg-green' : 'bg-amber'}`} />
              <Text className="text-[12px] font-bold text-muted">{connected ? 'Connected' : 'Waiting'}</Text>
            </View>
          </View>
          <View
            className="h-12 flex-row items-center gap-3 rounded-pill border border-cardBorder bg-cardBg px-3 shadow-card"
            style={{ shadowOpacity: 0.12 }}
          >
            <Pressable accessibilityLabel="Search sessions" accessibilityRole="button" onPress={search.toggle}>
              <MobileIcon name="search" size={22} strokeWidth={2.35} color="#0f172a" />
            </Pressable>
            <View className="h-9 w-9 items-center justify-center rounded-pill bg-primary">
              <Text className="text-[13px] font-black text-white">MX</Text>
            </View>
          </View>
        </View>

        {search.open ? (
          <View className="mt-5 rounded-pill border border-cardBorder bg-cardBg px-4 py-2 shadow-card" style={{ shadowOpacity: 0.1 }}>
            <TextInput
              value={search.query}
              onChangeText={search.setQuery}
              placeholder="Search sessions"
              placeholderTextColor="#94a3b8"
              autoCapitalize="none"
              autoCorrect={false}
              className="min-h-10 text-[17px] font-semibold text-text"
            />
          </View>
        ) : null}

        <View className="mt-8 gap-1">
          {items.map((item) => (
            <MenuActionRow
              key={`${item.kind}-${item.label}`}
              item={item}
              onClose={onClose}
              onCommand={onCommand}
            />
          ))}
        </View>

        <View className="mt-8">
          <View className="mb-3 flex-row items-center justify-between">
            <Text className="text-[17px] font-black text-muted">Projects</Text>
            {autoApprove ? <Pill label="Bypass ON" /> : null}
          </View>
          <View>
            {search.filteredSections.map((section) => (
              <WorkspaceSection
                key={section.id}
                section={section}
                collapsed={collapsedSet.has(section.id)}
                onSelectSession={(sessionId) => {
                  onSelectSession(sessionId);
                  onClose();
                }}
                onNewSession={() => {
                  onNewSession(section.id);
                  onClose();
                }}
                onToggleCollapsed={() => onToggleWorkspace(section.id)}
              />
            ))}
            {search.filteredSections.length === 0 ? (
              <View className="rounded-block border border-cardBorder bg-cardBg px-4 py-4">
                <Text className="text-[14px] font-bold text-text">No matching sessions</Text>
                <Text className="mt-1 text-[12px] text-muted">Try a title or workspace path.</Text>
              </View>
            ) : null}
          </View>
        </View>
      </ScrollView>

      <Pressable
        accessibilityLabel="Close mobile menu"
        className="absolute bottom-6 right-5 min-h-12 flex-row items-center gap-3 rounded-pill bg-cardBg px-5 shadow-card"
        style={{ bottom: 24, minHeight: 52, position: 'absolute', right: 20, shadowOpacity: 0.16 }}
        onPress={onClose}
      >
        <MobileIcon name="edit" size={21} strokeWidth={2.35} color="#0f172a" />
        <Text className="text-[18px] font-black text-text">Chat</Text>
      </Pressable>
      <Pressable
        accessibilityLabel="New session from menu"
        className="absolute bottom-6 left-5 h-12 w-12 items-center justify-center rounded-pill border border-cardBorder bg-cardBg shadow-card"
        style={{ bottom: 24, left: 20, position: 'absolute', shadowOpacity: 0.14 }}
        onPress={() => {
          onNewSession();
          onClose();
        }}
      >
        <MobileIcon name="plus" size={22} strokeWidth={2.45} color="#db2777" />
      </Pressable>
    </Animated.View>
  );
}

function WorkspaceSection({
  section,
  collapsed,
  onSelectSession,
  onNewSession,
  onToggleCollapsed,
}: {
  readonly section: WorkspaceMenuSection;
  readonly collapsed: boolean;
  readonly onSelectSession: (sessionId: string) => void;
  readonly onNewSession: () => void;
  readonly onToggleCollapsed: () => void;
}) {
  return (
    <View className="mb-5">
      <View className="mb-1 flex-row items-center gap-3">
        <Pressable
          accessibilityLabel={`${collapsed ? 'Expand' : 'Collapse'} workspace ${section.title}`}
          accessibilityRole="button"
          className="min-w-0 flex-1 flex-row items-center gap-3 rounded-block"
          style={{ paddingVertical: 4 }}
          onPress={onToggleCollapsed}
        >
          <View className="h-8 w-8 items-center justify-center">
            <MobileIcon name="folder" size={21} strokeWidth={2.15} color={section.active ? '#db2777' : '#64748b'} />
          </View>
          <View className="min-w-0 flex-1">
            <Text className={`text-[17px] font-bold ${section.active ? 'text-text' : 'text-muted'}`} numberOfLines={1}>
              {section.title}
            </Text>
          </View>
          <View className="rounded-pill bg-cardBorder px-2 py-0.5">
            <Text className="text-[10px] font-black text-muted">{section.sessions.length}</Text>
          </View>
          <View style={{ transform: [{ rotate: collapsed ? '-90deg' : '0deg' }] }}>
            <MobileIcon name="chevronDown" size={16} strokeWidth={2.45} color="#64748b" />
          </View>
        </Pressable>
        <Pressable
          accessibilityLabel={`New session in ${section.title}`}
          accessibilityRole="button"
          className="h-9 w-9 items-center justify-center rounded-pill"
          onPress={onNewSession}
        >
          <MobileIcon name="plus" size={18} strokeWidth={2.4} color="#db2777" />
        </Pressable>
      </View>
      {collapsed ? (
        <Pressable
          accessibilityLabel={`Expand workspace ${section.title}`}
          accessibilityRole="button"
          className="ml-11 rounded-block px-3 py-2"
          style={{ backgroundColor: section.active ? '#ffffff' : 'rgba(255,255,255,0.5)' }}
          onPress={onToggleCollapsed}
        >
          <Text className="text-[12px] font-bold text-muted">
            {section.sessions.length} {section.sessions.length === 1 ? 'session' : 'sessions'} hidden
          </Text>
        </Pressable>
      ) : (
        <View className="gap-0.5 pl-11">
          {section.sessions.map((session) => (
            <WorkspaceSessionRow key={session.id} session={session} onPress={() => onSelectSession(session.id)} />
          ))}
        </View>
      )}
    </View>
  );
}

function WorkspaceSessionRow({
  session,
  onPress,
}: {
  readonly session: WorkspaceMenuSession;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={`Open session ${session.title}`}
      accessibilityRole="button"
      className="min-h-11 rounded-block"
      style={{
        backgroundColor: session.active ? '#ffffff' : 'transparent',
        borderColor: session.active ? '#e3e5f0' : 'transparent',
        borderWidth: session.active ? 1 : 0,
        paddingHorizontal: session.active ? 12 : 0,
        paddingVertical: 7,
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: session.active ? 0.08 : 0,
        shadowRadius: 10,
      }}
      onPress={onPress}
    >
      <View className="flex-row items-center gap-3">
        <Text
          className={`min-w-0 flex-1 text-[16px] leading-6 ${session.active ? 'font-bold text-text' : 'font-semibold text-text'}`}
          numberOfLines={1}
        >
          {session.title}
        </Text>
        {session.shortcutLabel ? (
          <View className="rounded-pill bg-cardBorder px-2 py-0.5">
            <Text className="text-[11px] font-bold text-muted">{session.shortcutLabel}</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function MenuActionRow({
  item,
  onClose,
  onCommand,
}: {
  readonly item: MobileMenuItem;
  readonly onClose: () => void;
  readonly onCommand: (name: string, args?: string) => void;
}) {
  const content = (
    <View className="min-h-12 flex-row items-center gap-4 rounded-block" style={{ paddingVertical: 6 }}>
      <View className="h-9 w-9 items-center justify-center">
        <MobileIcon name={item.icon} size={22} strokeWidth={2.25} color="#0f172a" />
      </View>
      <Text className="flex-1 text-[18px] font-bold text-text">{item.label}</Text>
    </View>
  );

  if (item.kind === 'link' && item.href) {
    return (
      <Link href={item.href} asChild>
        <Pressable accessibilityLabel={item.label} accessibilityRole="button" onPress={onClose}>{content}</Pressable>
      </Link>
    );
  }

  return (
    <Pressable
      accessibilityLabel={item.label}
      accessibilityRole="button"
      onPress={() => {
        if (item.command) onCommand(item.command, item.commandArgs);
        onClose();
      }}
    >
      {content}
    </Pressable>
  );
}

function Pill({ label }: { readonly label: string }) {
  return (
    <View className="rounded-pill bg-primarySoft px-3 py-1">
      <Text className="text-[11px] font-black text-primaryStrong">{label}</Text>
    </View>
  );
}
