import { Link } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useMobileMenuSearch } from '../hooks/useMobileMenuSearch';
import type { MobileMenuItem, WorkspaceMenuSection } from '../navigation';
import { MobileIcon } from './MobileIcon';
import { WorkspaceSessionTree } from './WorkspaceSessionTree';

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
            {search.filteredSections.length > 0 ? (
              <WorkspaceSessionTree
                sections={search.filteredSections}
                collapsedWorkspaceIds={[...collapsedSet]}
                variant="menu"
                onSelectSession={(sessionId) => {
                  onSelectSession(sessionId);
                  onClose();
                }}
                onNewSession={(workspaceId) => {
                  onNewSession(workspaceId);
                  onClose();
                }}
                onToggleWorkspace={onToggleWorkspace}
              />
            ) : null}
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
    </Animated.View>
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
    <View
      className="min-h-12 flex-row items-center gap-4 rounded-block"
      style={{ opacity: item.disabled ? 0.48 : 1, paddingVertical: 6 }}
    >
      <View className="h-9 w-9 items-center justify-center">
        <MobileIcon name={item.icon} size={22} strokeWidth={2.25} color={item.disabled ? '#94a3b8' : '#0f172a'} />
      </View>
      <View className="min-w-0 flex-1">
        <Text className={`text-[18px] font-bold ${item.disabled ? 'text-muted' : 'text-text'}`}>{item.label}</Text>
        {item.disabled && item.disabledReason ? (
          <Text className="mt-0.5 text-[12px] font-semibold text-muted" numberOfLines={1}>
            {item.disabledReason}
          </Text>
        ) : null}
      </View>
    </View>
  );

  if (item.disabled) {
    return (
      <Pressable
        accessibilityLabel={item.label}
        accessibilityRole="button"
        accessibilityState={{ disabled: true }}
        disabled
      >
        {content}
      </Pressable>
    );
  }

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
