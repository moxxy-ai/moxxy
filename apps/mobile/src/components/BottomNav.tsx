import { sx } from '../styles/tokens';
import { Link, usePathname } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { buildBottomTabs } from '../navigation';
import { MobileIcon } from './MobileIcon';

export function BottomNav({ pendingActions = 0 }: { readonly pendingActions?: number }) {
  const pathname = usePathname();
  const items = buildBottomTabs(pendingActions);
  return (
    <View style={sx('border-t border-cardBorder bg-cardBg/95 px-4 pb-3 pt-2')}>
      <View style={sx('flex-row items-center justify-between rounded-card border border-cardBorder bg-cardBg px-1.5 py-1.5 shadow-card')}>
      {items.map((item) => {
        const active = pathname === item.href || (pathname === '/' && item.href === '/chat');
        return (
          <Link key={item.href} href={item.href} asChild>
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              style={sx(`relative min-h-14 flex-1 items-center justify-center rounded-card px-1 ${
                active ? 'bg-primarySoft' : 'bg-transparent'
              }`)}
            >
              <View style={sx(`h-7 w-7 items-center justify-center rounded-pill ${active ? 'bg-cardBg' : 'bg-transparent'}`)}>
                <MobileIcon name={item.icon} size={18} strokeWidth={2.4} color={active ? '#db2777' : '#64748b'} />
              </View>
              <Text style={sx(`mt-0.5 text-[10px] font-bold ${active ? 'text-primaryStrong' : 'text-muted'}`)}>
                {item.label}
              </Text>
              {item.badge ? (
                <View style={sx('absolute right-2 top-1 min-w-5 items-center rounded-pill bg-red px-1.5 py-0.5')}>
                  <Text style={sx('text-[10px] font-black text-white')}>{item.badge}</Text>
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
