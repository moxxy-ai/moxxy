import { Link, usePathname } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { mobileInk, mobileSurface } from '../styles/tokens';
import { buildBottomTabs } from '../navigation';
import { MobileIcon } from './MobileIcon';

export function BottomNav({ pendingActions = 0 }: { readonly pendingActions?: number }) {
  const pathname = usePathname();
  const items = buildBottomTabs(pendingActions);
  return (
    <View style={styles.bar}>
      <View style={styles.row}>
        {items.map((item) => {
          const active = pathname === item.href || (pathname === '/' && item.href === '/chat');
          return (
            <Link key={item.href} href={item.href} asChild>
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                style={[styles.tab, active ? styles.tabActive : null]}
              >
                <View style={[styles.iconWrap, active ? styles.iconWrapActive : null]}>
                  <MobileIcon
                    name={item.icon}
                    size={18}
                    strokeWidth={2.4}
                    color={active ? mobileSurface.accentStrong : mobileInk.soft}
                  />
                </View>
                <Text style={[styles.label, active ? styles.labelActive : null]}>{item.label}</Text>
                {item.badge ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{item.badge}</Text>
                  </View>
                ) : null}
              </Pressable>
            </Link>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    backgroundColor: '#ef4444',
    borderRadius: 999,
    minWidth: 18,
    paddingHorizontal: 5,
    paddingVertical: 1,
    position: 'absolute',
    right: 6,
    top: 4,
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '800',
  },
  bar: {
    backgroundColor: mobileSurface.card,
    borderTopColor: mobileSurface.border,
    borderTopWidth: 1,
    paddingBottom: 12,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  iconWrap: {
    alignItems: 'center',
    borderRadius: 999,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  iconWrapActive: {
    backgroundColor: mobileSurface.accentSoft,
  },
  label: {
    color: mobileInk.soft,
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
  },
  labelActive: {
    color: mobileSurface.accentStrong,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  tab: {
    alignItems: 'center',
    borderRadius: 14,
    flex: 1,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: 4,
    position: 'relative',
  },
  tabActive: {},
});
