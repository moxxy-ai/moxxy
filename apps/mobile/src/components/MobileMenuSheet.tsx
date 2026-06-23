import { Link } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { mobileInk } from '../styles/tokens';
import { useMobileMenuSearch } from '../hooks/useMobileMenuSearch';
import type { MobileMenuItem, WorkspaceMenuSection } from '../navigation';
import { MobileIcon } from './MobileIcon';
import { WorkspaceSessionTree } from './WorkspaceSessionTree';
import { Gradient } from './primitives/Gradient';
import { PressableScale, PulseDot } from './primitives/motion';

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
      duration: open ? 260 : 170,
      toValue: open ? 1 : 0,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !open) setRendered(false);
    });
    if (!open) search.close();
  }, [open, progress]);

  if (!rendered) return null;
  const collapsedSet = new Set(search.query.trim().length > 0 ? [] : collapsedWorkspaceIds);

  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [-32, 0] });
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] });

  return (
    <Animated.View style={[styles.sheet, { opacity: progress, transform: [{ translateX }, { scale }] }]}>
      <Gradient
        pointerEventsNone
        direction="diagonal"
        stops={[
          { offset: 0, color: '#fdeaf4' },
          { offset: 0.55, color: '#f1f2f9' },
          { offset: 1, color: '#eaf6fb' },
        ]}
        style={StyleSheet.absoluteFill}
      />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <View style={styles.titleGroup}>
            <Text style={styles.title}>Moxxy</Text>
            <View style={styles.statusRow}>
              <PulseDot color={connected ? '#10b981' : '#f59e0b'} size={8} pulsing={connected} />
              <Text style={styles.statusText}>{connected ? 'Connected' : 'Waiting'}</Text>
            </View>
          </View>
          <View style={styles.headerActions}>
            <PressableScale accessibilityLabel="Search sessions" accessibilityRole="button" onPress={search.toggle} scaleTo={0.9} style={styles.iconButton}>
              <MobileIcon name="search" size={22} strokeWidth={2.35} color={mobileInk.strong} />
            </PressableScale>
            <Gradient preset="cta" radius={999} style={styles.mxBadge}>
              <Text style={styles.mxText}>MX</Text>
            </Gradient>
          </View>
        </View>

        {search.open ? (
          <View style={styles.searchBox}>
            <MobileIcon name="search" size={17} strokeWidth={2.4} color={mobileInk.faint} />
            <TextInput
              value={search.query}
              onChangeText={search.setQuery}
              placeholder="Search sessions"
              placeholderTextColor={mobileInk.faint}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.searchInput}
            />
          </View>
        ) : null}

        <View style={styles.actionList}>
          {items.map((item) => (
            <MenuActionRow key={`${item.kind}-${item.label}`} item={item} onClose={onClose} onCommand={onCommand} />
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

      <PressableScale accessibilityLabel="Close mobile menu" accessibilityRole="button" scaleTo={0.94} style={styles.closeButton} onPress={onClose}>
        <Gradient preset="cta" radius={999} style={StyleSheet.absoluteFill} />
        <MobileIcon name="message" size={20} strokeWidth={2.4} color="#ffffff" />
        <Text style={styles.closeText}>Chat</Text>
      </PressableScale>
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
        <MobileIcon name={item.icon} size={21} strokeWidth={2.25} color={item.disabled ? mobileInk.faint : mobileInk.strong} />
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
      <PressableScale accessibilityLabel={item.label} accessibilityRole="button" accessibilityState={{ disabled: true }} disabled>
        {content}
      </PressableScale>
    );
  }

  if (item.kind === 'link' && item.href) {
    return (
      <Link href={item.href} asChild>
        <PressableScale accessibilityLabel={item.label} accessibilityRole="button" onPress={onClose}>
          {content}
        </PressableScale>
      </Link>
    );
  }

  return (
    <PressableScale
      accessibilityLabel={item.label}
      accessibilityRole="button"
      onPress={() => {
        if (item.command) onCommand(item.command, item.commandArgs);
        onClose();
      }}
    >
      {content}
    </PressableScale>
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
    color: mobileInk.soft,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  actionIconBox: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.7)',
    borderColor: 'rgba(226,228,240,0.8)',
    borderRadius: 12,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  actionLabel: {
    color: mobileInk.strong,
    fontSize: 17,
    fontWeight: '700',
  },
  actionLabelDisabled: {
    color: mobileInk.soft,
  },
  actionList: {
    gap: 6,
    marginTop: 30,
  },
  actionRow: {
    alignItems: 'center',
    borderRadius: 16,
    flexDirection: 'row',
    gap: 14,
    minHeight: 52,
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
    borderRadius: 999,
    bottom: 24,
    flexDirection: 'row',
    gap: 10,
    minHeight: 54,
    paddingHorizontal: 22,
    position: 'absolute',
    right: 20,
    shadowColor: '#db2777',
    shadowOffset: { height: 12, width: 0 },
    shadowOpacity: 0.32,
    shadowRadius: 22,
  },
  closeText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '900',
  },
  emptyCard: {
    backgroundColor: 'rgba(255,255,255,0.8)',
    borderColor: 'rgba(226,228,240,0.8)',
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  emptySubtitle: {
    color: mobileInk.soft,
    fontSize: 12,
    marginTop: 4,
  },
  emptyTitle: {
    color: mobileInk.strong,
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
    backgroundColor: 'rgba(255,255,255,0.78)',
    borderColor: 'rgba(255,255,255,0.7)',
    borderRadius: 999,
    borderTopColor: 'rgba(255,255,255,0.95)',
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    height: 48,
    paddingLeft: 14,
    paddingRight: 8,
    shadowColor: '#1e2540',
    shadowOffset: { height: 8, width: 0 },
    shadowOpacity: 0.1,
    shadowRadius: 18,
  },
  iconButton: {
    alignItems: 'center',
    height: 36,
    justifyContent: 'center',
    width: 28,
  },
  mxBadge: {
    alignItems: 'center',
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
    color: mobileInk.muted,
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
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderColor: 'rgba(226,228,240,0.9)',
    borderRadius: 999,
    borderTopColor: 'rgba(255,255,255,0.95)',
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginTop: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    shadowColor: '#1e2540',
    shadowOffset: { height: 8, width: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
  },
  searchInput: {
    color: mobileInk.strong,
    flex: 1,
    fontSize: 16,
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
  statusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  statusText: {
    color: mobileInk.soft,
    fontSize: 12,
    fontWeight: '700',
  },
  title: {
    color: mobileInk.strong,
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: -0.5,
    lineHeight: 36,
  },
  titleGroup: {
    flex: 1,
    minWidth: 0,
  },
});
