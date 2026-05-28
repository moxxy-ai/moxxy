/**
 * Thin typed wrapper around @tauri-apps/api so the rest of the app never
 * imports the raw runtime. Tests stub THIS module via `vi.mock('@/lib/tauri')`
 * rather than the upstream package.
 */

import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export async function invoke<T = unknown>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  return tauriInvoke<T>(cmd, args);
}

export async function subscribe<T>(
  event: string,
  handler: (payload: T) => void,
): Promise<UnlistenFn> {
  return listen<T>(event, (e) => handler(e.payload));
}
