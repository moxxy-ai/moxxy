import { Link } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { mobileFlat, mobileInk, mobileSurface } from '../styles/tokens';
import { useMobileMenuSearch } from '../hooks/useMobileMenuSearch';
import type { MobileMenuItem, WorkspaceMenuSection } from '../navigation';
import { MobileIcon } from './MobileIcon';
import { WorkspaceSessionTree } from './WorkspaceSessionTree';
import { Appear, PressableScale, PulseDot } from './primitives/motion';

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
  const projectCount = search.filteredSections.length;

  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [-32, 0] });
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] });

  return (
    <Animated.View style={[styles.sheet, { opacity: progress, transform: [{ translateX }, { scale }] }]}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <View style={styles.titleGroup}>
            <Text style={styles.title}>Moxxy</Text>
            <View style={styles.statusPill}>
              <PulseDot color={connected ? '#16a34a' : '#d97706'} size={8} pulsing={connected} />
              <Text style={styles.statusText}>{connected ? 'Connected' : 'Waiting'}</Text>
            </View>
          </View>
          <PressableScale
            accessibilityLabel="Search sessions"
            accessibilityRole="button"
            accessibilityState={{ selected: search.open }}
            onPress={search.toggle}
            scaleTo={0.9}
            style={[styles.iconButton, search.open ? styles.iconButtonActive : null]}
          >
            <MobileIcon
              name="search"
              size={20}
              strokeWidth={2.4}
              color={search.open ? mobileSurface.accentStrong : mobileInk.muted}
            />
          </PressableScale>
        </View>

        {search.open ? (
          <Appear from="up" distance={8} style={styles.searchBox}>
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
          </Appear>
        ) : null}

        <View style={styles.actionList}>
          {items.map((item, index) => (
            <MenuActionRow
              key={`${item.kind}-${item.label}`}
              item={item}
              first={index === 0}
              onClose={onClose}
              onCommand={onCommand}
            />
          ))}
        </View>

        <View style={styles.projectsSection}>
          <View style={styles.projectsHeader}>
            <View style={styles.projectsHeaderLeft}>
              <Text style={styles.projectsTitle}>Projects</Text>
              {projectCount > 0 ? (
                <View style={styles.projectsCount}>
                  <Text style={styles.projectsCountText}>{projectCount}</Text>
                </View>
              ) : null}
            </View>
            {autoApprove ? <Pill label="Bypass ON" /> : null}
          </View>
          <View>
            {projectCount > 0 ? (
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
            {projectCount === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>No matching sessions</Text>
                <Text style={styles.emptySubtitle}>Try a title or workspace path.</Text>
              </View>
            ) : null}
          </View>
        </View>
      </ScrollView>

      <PressableScale accessibilityLabel="Close mobile menu" accessibilityRole="button" scaleTo={0.94} style={styles.closeButton} onPress={onClose}>
        <MobileIcon name="message" size={20} strokeWidth={2.4} color="#ffffff" />
        <Text style={styles.closeText}>Chat</Text>
      </PressableScale>
    </Animated.View>
  );
}

function MenuActionRow({
  item,
  first,
  onClose,
  onCommand,
}: {
  readonly item: MobileMenuItem;
  readonly first: boolean;
  readonly onClose: () => void;
  readonly onCommand: (name: string, args?: string) => void;
}) {
  const content = (
    <View style={[styles.actionRow, first ? null : styles.actionRowDivided, item.disabled ? styles.actionRowDisabled : null]}>
      <View style={[styles.actionTile, item.disabled ? styles.actionTileDisabled : null]}>
        <MobileIcon
          name={item.icon}
          size={20}
          strokeWidth={2.3}
          color={item.disabled ? mobileInk.faint : mobileSurface.accentStrong}
        />
      </View>
      <View style={styles.actionTextBox}>
        <Text style={[styles.actionLabel, item.disabled ? styles.actionLabelDisabled : null]}>{item.label}</Text>
        {item.disabled && item.disabledReason ? (
          <Text style={styles.actionDisabledReason} numberOfLines={1}>
            {item.disabledReason}
          </Text>
        ) : null}
      </View>
      {item.badge ? (
        <View style={styles.actionBadge}>
          <Text style={styles.actionBadgeText}>{item.badge}</Text>
        </View>
      ) : null}
      {!item.disabled ? (
        <View style={styles.actionChevron}>
          <MobileIcon name="chevronRight" size={18} strokeWidth={2.5} color={mobileInk.faint} />
        </View>
      ) : null}
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
        <PressableScale accessibilityLabel={item.label} accessibilityRole="button" scaleTo={0.98} onPress={onClose}>
          {content}
        </PressableScale>
      </Link>
    );
  }

  return (
    <PressableScale
      accessibilityLabel={item.label}
      accessibilityRole="button"
      scaleTo={0.98}
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
  actionBadge: {
    backgroundColor: mobileSurface.accentSoft,
    borderColor: mobileSurface.accentBorder,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  actionBadgeText: {
    color: mobileSurface.accentStrong,
    fontSize: 11,
    fontWeight: '800',
  },
  actionChevron: {
    alignItems: 'center',
    height: 24,
    justifyContent: 'center',
    width: 20,
  },
  actionDisabledReason: {
    color: mobileInk.soft,
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
  },
  actionLabel: {
    color: mobileInk.strong,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  actionLabelDisabled: {
    color: mobileInk.soft,
  },
  actionList: {
    backgroundColor: mobileSurface.card,
    borderColor: mobileSurface.border,
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 28,
    overflow: 'hidden',
  },
  actionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 14,
    minHeight: 60,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  actionRowDisabled: {
    opacity: 0.62,
  },
  actionRowDivided: {
    borderTopColor: mobileSurface.divider,
    borderTopWidth: 1,
  },
  actionTextBox: {
    flex: 1,
    minWidth: 0,
  },
  actionTile: {
    alignItems: 'center',
    backgroundColor: mobileSurface.accentSoft,
    borderColor: mobileSurface.accentBorder,
    borderRadius: 12,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  actionTileDisabled: {
    backgroundColor: mobileSurface.field,
    borderColor: mobileSurface.border,
  },
  closeButton: {
    alignItems: 'center',
    backgroundColor: mobileSurface.accent,
    borderRadius: 999,
    bottom: 24,
    flexDirection: 'row',
    gap: 10,
    minHeight: 54,
    paddingHorizontal: 22,
    position: 'absolute',
    right: 20,
    ...mobileFlat.floating,
  },
  closeText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '800',
  },
  emptyCard: {
    backgroundColor: mobileSurface.card,
    borderColor: mobileSurface.border,
    borderRadius: 18,
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
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 16,
    justifyContent: 'space-between',
  },
  iconButton: {
    alignItems: 'center',
    backgroundColor: mobileSurface.card,
    borderColor: mobileSurface.border,
    borderRadius: 999,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  iconButtonActive: {
    backgroundColor: mobileSurface.accentSoft,
    borderColor: mobileSurface.accentBorder,
  },
  pill: {
    backgroundColor: mobileSurface.accentSoft,
    borderColor: mobileSurface.accentBorder,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  pillText: {
    color: mobileSurface.accentStrong,
    fontSize: 11,
    fontWeight: '800',
  },
  projectsCount: {
    alignItems: 'center',
    backgroundColor: mobileSurface.accentSoft,
    borderColor: mobileSurface.accentBorder,
    borderRadius: 999,
    borderWidth: 1,
    minWidth: 24,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  projectsCountText: {
    color: mobileSurface.accentStrong,
    fontSize: 12,
    fontWeight: '800',
  },
  projectsHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  projectsHeaderLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  projectsSection: {
    marginTop: 30,
  },
  projectsTitle: {
    color: mobileInk.strong,
    fontSize: 19,
    fontWeight: '800',
    letterSpacing: -0.3,
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
    backgroundColor: mobileSurface.field,
    borderColor: mobileSurface.borderStrong,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  searchInput: {
    color: mobileInk.strong,
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    minHeight: 40,
  },
  sheet: {
    backgroundColor: mobileSurface.appBg,
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 50,
  },
  statusPill: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: mobileSurface.card,
    borderColor: mobileSurface.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  statusText: {
    color: mobileInk.muted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  title: {
    color: mobileInk.strong,
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: -0.7,
    lineHeight: 38,
  },
  titleGroup: {
    flex: 1,
    minWidth: 0,
  },
});
