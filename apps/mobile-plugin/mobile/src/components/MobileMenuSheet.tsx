import { Link } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
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
      style={[
        styles.sheet,
        {
          opacity: progress,
          transform: [{ translateX }, { scale }],
        },
      ]}
    >
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <View style={styles.titleGroup}>
            <Text style={styles.title}>Moxxy</Text>
            <View style={styles.statusRow}>
              <View style={[styles.statusDot, connected ? styles.statusDotConnected : styles.statusDotWaiting]} />
              <Text style={styles.statusText}>{connected ? 'Connected' : 'Waiting'}</Text>
            </View>
          </View>
          <View style={styles.headerActions}>
            <Pressable accessibilityLabel="Search sessions" accessibilityRole="button" onPress={search.toggle} style={styles.iconButton}>
              <MobileIcon name="search" size={22} strokeWidth={2.35} color="#0f172a" />
            </Pressable>
            <View style={styles.mxBadge}>
              <Text style={styles.mxText}>MX</Text>
            </View>
          </View>
        </View>

        {search.open ? (
          <View style={styles.searchBox}>
            <TextInput
              value={search.query}
              onChangeText={search.setQuery}
              placeholder="Search sessions"
              placeholderTextColor="#94a3b8"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.searchInput}
            />
          </View>
        ) : null}

        <View style={styles.actionList}>
          {items.map((item) => (
            <MenuActionRow
              key={`${item.kind}-${item.label}`}
              item={item}
              onClose={onClose}
              onCommand={onCommand}
            />
          ))}
        </View>

        <View style={styles.projectsSection}>
          <View style={styles.projectsHeader}>
            <Text style={styles.projectsTitle}>Projects</Text>
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
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>No matching sessions</Text>
                <Text style={styles.emptySubtitle}>Try a title or workspace path.</Text>
              </View>
            ) : null}
          </View>
        </View>
      </ScrollView>

      <Pressable accessibilityLabel="Close mobile menu" style={styles.closeButton} onPress={onClose}>
        <MobileIcon name="edit" size={21} strokeWidth={2.35} color="#0f172a" />
        <Text style={styles.closeText}>Chat</Text>
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
    <View style={[styles.actionRow, item.disabled ? styles.actionRowDisabled : null]}>
      <View style={styles.actionIconBox}>
        <MobileIcon name={item.icon} size={22} strokeWidth={2.25} color={item.disabled ? '#94a3b8' : '#0f172a'} />
      </View>
      <View style={styles.actionTextBox}>
        <Text style={[styles.actionLabel, item.disabled ? styles.actionLabelDisabled : null]}>{item.label}</Text>
        {item.disabled && item.disabledReason ? (
          <Text style={styles.actionDisabledReason} numberOfLines={1}>
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
        <Pressable accessibilityLabel={item.label} accessibilityRole="button" onPress={onClose}>
          {content}
        </Pressable>
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
    <View style={styles.pill}>
      <Text style={styles.pillText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  actionDisabledReason: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  actionIconBox: {
    alignItems: 'center',
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  actionLabel: {
    color: '#0f172a',
    fontSize: 18,
    fontWeight: '700',
  },
  actionLabelDisabled: {
    color: '#64748b',
  },
  actionList: {
    gap: 4,
    marginTop: 30,
  },
  actionRow: {
    alignItems: 'center',
    borderRadius: 14,
    flexDirection: 'row',
    gap: 16,
    minHeight: 48,
    paddingVertical: 6,
  },
  actionRowDisabled: {
    opacity: 0.48,
  },
  actionTextBox: {
    flex: 1,
    minWidth: 0,
  },
  closeButton: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 999,
    bottom: 24,
    flexDirection: 'row',
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 20,
    position: 'absolute',
    right: 20,
    shadowColor: '#0f172a',
    shadowOffset: { height: 16, width: 0 },
    shadowOpacity: 0.16,
    shadowRadius: 28,
  },
  closeText: {
    color: '#0f172a',
    fontSize: 18,
    fontWeight: '900',
  },
  emptyCard: {
    backgroundColor: '#ffffff',
    borderColor: '#dfe4f0',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  emptySubtitle: {
    color: '#64748b',
    fontSize: 12,
    marginTop: 4,
  },
  emptyTitle: {
    color: '#0f172a',
    fontSize: 14,
    fontWeight: '700',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 16,
    justifyContent: 'space-between',
  },
  headerActions: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#dfe4f0',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    height: 48,
    paddingHorizontal: 12,
    shadowColor: '#0f172a',
    shadowOffset: { height: 10, width: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 22,
  },
  iconButton: {
    alignItems: 'center',
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  mxBadge: {
    alignItems: 'center',
    backgroundColor: '#db2777',
    borderRadius: 999,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  mxText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
  },
  pill: {
    backgroundColor: '#fce7f3',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  pillText: {
    color: '#be185d',
    fontSize: 11,
    fontWeight: '900',
  },
  projectsHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  projectsSection: {
    marginTop: 30,
  },
  projectsTitle: {
    color: '#64748b',
    fontSize: 17,
    fontWeight: '900',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 96,
    paddingHorizontal: 20,
    paddingTop: 18,
  },
  searchBox: {
    backgroundColor: '#ffffff',
    borderColor: '#dfe4f0',
    borderRadius: 999,
    borderWidth: 1,
    marginTop: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    shadowColor: '#0f172a',
    shadowOffset: { height: 10, width: 0 },
    shadowOpacity: 0.1,
    shadowRadius: 22,
  },
  searchInput: {
    color: '#0f172a',
    fontSize: 17,
    fontWeight: '600',
    minHeight: 40,
  },
  sheet: {
    backgroundColor: '#f1f2f9',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 50,
  },
  statusDot: {
    borderRadius: 999,
    height: 8,
    width: 8,
  },
  statusDotConnected: {
    backgroundColor: '#10b981',
  },
  statusDotWaiting: {
    backgroundColor: '#f59e0b',
  },
  statusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  statusText: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '700',
  },
  title: {
    color: '#0f172a',
    fontSize: 30,
    fontWeight: '900',
    lineHeight: 36,
  },
  titleGroup: {
    flex: 1,
    minWidth: 0,
  },
});
