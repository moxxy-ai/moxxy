/**
 * Wire the shared client layer to React Native: a WebSocket transport pointed at
 * the desktop host's bridge, and (for this PoC) no platform capabilities — voice
 * capture, TTS, the legacy KV migration, and the event bus all degrade to
 * no-ops, exactly as the optional capability design intends. A real mobile build
 * would register Expo-backed implementations here instead.
 */

import { configureTransport } from '@moxxy/client-core/transport';
import { configurePlatform } from '@moxxy/client-core/platform';
import { makeWsApi } from '@moxxy/client-transport-ws';

export function bootMobile(url: string, token?: string): void {
  configureTransport(makeWsApi({ url, ...(token ? { token } : {}) }));
  configurePlatform({});
}
