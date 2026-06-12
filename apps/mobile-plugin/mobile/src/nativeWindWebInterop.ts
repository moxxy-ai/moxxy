import { Platform } from 'react-native';
import { cssInterop, remapProps } from 'react-native-css-interop';

declare const require: (id: string) => unknown;

type InteropComponent = Parameters<typeof cssInterop>[0];
type InteropMapping = Parameters<typeof cssInterop>[1];
type WebExportLoader = () => unknown;

const classNameToStyle = { className: 'style' } satisfies InteropMapping;

function loadWebExport(loader: WebExportLoader): InteropComponent | null {
  try {
    const mod = loader() as { default?: unknown };
    return (mod.default ?? mod) as InteropComponent;
  } catch {
    return null;
  }
}

function registerCssInterop(loader: WebExportLoader, mapping: InteropMapping = classNameToStyle) {
  const component = loadWebExport(loader);
  if (component) cssInterop(component, mapping);
}

function registerRemappedProps(loader: WebExportLoader, mapping: InteropMapping) {
  const component = loadWebExport(loader);
  if (component) remapProps(component, mapping);
}

function registerAnimatedView() {
  const animated = loadWebExport(() => require('react-native-web/dist/exports/Animated')) as
    | ({ View?: InteropComponent } & InteropComponent)
    | null;
  if (animated?.View) cssInterop(animated.View, classNameToStyle);
}

if (Platform.OS === 'web') {
  registerCssInterop(() => require('react-native-web/dist/exports/Image'));
  registerCssInterop(() => require('react-native-web/dist/exports/Pressable'));
  registerCssInterop(() => require('react-native-web/dist/exports/Switch'));
  registerCssInterop(() => require('react-native-web/dist/exports/Text'));
  registerCssInterop(() => require('react-native-web/dist/exports/TouchableHighlight'));
  registerCssInterop(() => require('react-native-web/dist/exports/TouchableOpacity'));
  registerCssInterop(() => require('react-native-web/dist/exports/TouchableWithoutFeedback'));
  registerCssInterop(() => require('react-native-web/dist/exports/View'));
  registerCssInterop(() => require('react-native-web/dist/exports/ActivityIndicator'), {
    className: { target: 'style', nativeStyleToProp: { color: true } },
  });
  registerCssInterop(() => require('react-native-web/dist/exports/ScrollView'), {
    className: 'style',
    contentContainerClassName: 'contentContainerStyle',
  });
  registerCssInterop(() => require('react-native-web/dist/exports/TextInput'), {
    className: { target: 'style', nativeStyleToProp: { textAlign: true } },
  });
  registerRemappedProps(() => require('react-native-web/dist/exports/KeyboardAvoidingView'), {
    className: 'style',
    contentContainerClassName: 'contentContainerStyle',
  });
  registerAnimatedView();
}
