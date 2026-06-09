import Svg, { Circle, Line, Path, Polyline } from 'react-native-svg';
import type { BottomTabItem, QuickActionItem } from '../navigation';

export type MobileIconName =
  | BottomTabItem['icon']
  | QuickActionItem['icon']
  | 'menu'
  | 'folder'
  | 'workflows'
  | 'gateway'
  | 'search'
  | 'chevronDown'
  | 'more'
  | 'edit'
  | 'mic'
  | 'send'
  | 'stop'
  | 'x'
  | 'camera'
  | 'wifi'
  | 'wifiOff';

interface MobileIconProps {
  readonly name: MobileIconName;
  readonly color: string;
  readonly size?: number;
  readonly strokeWidth?: number;
}

export function MobileIcon({ name, color, size = 20, strokeWidth = 2.35 }: MobileIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <IconPaths name={name} color={color} strokeWidth={strokeWidth} />
    </Svg>
  );
}

function sharedProps(color: string, strokeWidth: number) {
  return {
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
}

function IconPaths({ name, color, strokeWidth }: Required<Pick<MobileIconProps, 'name' | 'color' | 'strokeWidth'>>) {
  const props = sharedProps(color, strokeWidth);
  switch (name) {
    case 'message':
      return <Path {...props} d="M3 16.3c.2.8.1 1.4-.2 2.1L2 21l2.8-.8c.7-.2 1.3-.1 2 .2A10 10 0 1 0 3 16.3Z" />;
    case 'sessions':
      return (
        <>
          <Path {...props} d="m7 8 5-3 5 3-5 3-5-3Z" />
          <Path {...props} d="m7 12 5 3 5-3" />
          <Path {...props} d="m7 16 5 3 5-3" />
        </>
      );
    case 'folder':
      return (
        <>
          <Path {...props} d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-14a2 2 0 0 1-2-2v-10Z" />
          <Path {...props} d="M3.5 10h18" />
        </>
      );
    case 'actions':
      return (
        <>
          <Circle {...props} cx="12" cy="12" r="9" />
          <Path {...props} d="m8.5 12.2 2.4 2.4 5-5.4" />
        </>
      );
    case 'goals':
      return (
        <>
          <Path {...props} d="M5 21V4" />
          <Path {...props} d="M5 5h11l-2 4 2 4H5" />
        </>
      );
    case 'settings':
      return (
        <>
          <Circle {...props} cx="12" cy="12" r="3" />
          <Path {...props} d="M12 2v3" />
          <Path {...props} d="M12 19v3" />
          <Path {...props} d="M4.9 4.9 7 7" />
          <Path {...props} d="m17 17 2.1 2.1" />
          <Path {...props} d="M2 12h3" />
          <Path {...props} d="M19 12h3" />
          <Path {...props} d="m4.9 19.1 2.1-2.1" />
          <Path {...props} d="m17 7 2.1-2.1" />
        </>
      );
    case 'workflows':
      return (
        <>
          <Path {...props} d="M5 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
          <Path {...props} d="M19 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
          <Path {...props} d="M5 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
          <Path {...props} d="M7 5h4a4 4 0 0 1 4 4v1" />
          <Path {...props} d="M17 12h-4a4 4 0 0 0-4 4v1" />
        </>
      );
    case 'gateway':
      return (
        <>
          <Path {...props} d="M4 17.5V7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10.5" />
          <Path {...props} d="M8 21h8" />
          <Path {...props} d="M12 17v4" />
          <Path {...props} d="M8 10.5a6 6 0 0 1 8 0" />
          <Path {...props} d="M10.5 13a2.5 2.5 0 0 1 3 0" />
        </>
      );
    case 'search':
      return (
        <>
          <Circle {...props} cx="10.5" cy="10.5" r="6.5" />
          <Line {...props} x1="16" y1="16" x2="21" y2="21" />
        </>
      );
    case 'chevronDown':
      return <Path {...props} d="m6 9 6 6 6-6" />;
    case 'menu':
      return (
        <>
          <Line {...props} x1="5" y1="7" x2="19" y2="7" />
          <Line {...props} x1="5" y1="12" x2="19" y2="12" />
          <Line {...props} x1="5" y1="17" x2="15" y2="17" />
        </>
      );
    case 'more':
      return (
        <>
          <Circle {...props} cx="6" cy="12" r="1" />
          <Circle {...props} cx="12" cy="12" r="1" />
          <Circle {...props} cx="18" cy="12" r="1" />
        </>
      );
    case 'edit':
      return (
        <>
          <Path {...props} d="M12 20h9" />
          <Path {...props} d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5Z" />
        </>
      );
    case 'plus':
      return (
        <>
          <Line {...props} x1="12" y1="5" x2="12" y2="19" />
          <Line {...props} x1="5" y1="12" x2="19" y2="12" />
        </>
      );
    case 'bolt':
      return <Path {...props} d="M13 2 5 14h7l-1 8 8-12h-7l1-8Z" />;
    case 'mic':
      return (
        <>
          <Path {...props} d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Z" />
          <Path {...props} d="M6 10.5a6 6 0 0 0 12 0" />
          <Path {...props} d="M12 17v4" />
          <Path {...props} d="M9 21h6" />
        </>
      );
    case 'send':
      return (
        <>
          <Path {...props} d="m4 12 16-7-7 16-2-7-7-2Z" />
          <Path {...props} d="m11 14 4-4" />
        </>
      );
    case 'stop':
      return <Path {...props} d="M8 8h8v8H8z" />;
    case 'x':
      return (
        <>
          <Line {...props} x1="7" y1="7" x2="17" y2="17" />
          <Line {...props} x1="17" y1="7" x2="7" y2="17" />
        </>
      );
    case 'camera':
      return (
        <>
          <Path {...props} d="M7 7h1.8L10 5h4l1.2 2H17a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-7a3 3 0 0 1 3-3Z" />
          <Circle {...props} cx="12" cy="13" r="3.2" />
        </>
      );
    case 'wifi':
      return (
        <>
          <Path {...props} d="M5 12.5a10 10 0 0 1 14 0" />
          <Path {...props} d="M8.5 16a5 5 0 0 1 7 0" />
          <Circle {...props} cx="12" cy="19.5" r="0.8" />
        </>
      );
    case 'wifiOff':
      return (
        <>
          <Line {...props} x1="3" y1="3" x2="21" y2="21" />
          <Path {...props} d="M8.5 16a5 5 0 0 1 6.2-.7" />
          <Path {...props} d="M5 12.5a10 10 0 0 1 7.5-2.8" />
          <Polyline {...props} points="12 19.5 12.01 19.5" />
        </>
      );
  }
}
