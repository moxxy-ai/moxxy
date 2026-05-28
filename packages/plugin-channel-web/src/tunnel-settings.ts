import { readFileSync } from 'node:fs';
import { moxxyPath, writeFileAtomic } from '@moxxy/sdk';

/**
 * Persisted, user/agent-changeable choice of tunnel provider for the web
 * surface — stored at `~/.moxxy/web.json`. Mirrors the providers.json pattern:
 * the agent's `web_set_tunnel` tool writes it; the web plugin's onInit applies
 * it on boot. Absent file → callers fall back to defaults.
 */
export interface WebSettings {
  /** Active tunnel provider name (e.g. 'cloudflared', 'ngrok', 'localhost'). */
  readonly tunnel?: string;
}

export function webSettingsPath(): string {
  return moxxyPath('web.json');
}

/** Normalize user-friendly aliases for "no tunnel" to the localhost provider. */
export function normalizeTunnelName(name: string): string {
  const n = name.trim().toLowerCase();
  if (n === 'none' || n === 'local' || n === 'off' || n === 'loopback') return 'localhost';
  return n;
}

export function readWebSettings(file = webSettingsPath()): WebSettings {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as WebSettings;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function readTunnelSetting(file = webSettingsPath()): string | undefined {
  const t = readWebSettings(file).tunnel;
  return typeof t === 'string' && t ? normalizeTunnelName(t) : undefined;
}

export async function writeTunnelSetting(name: string, file = webSettingsPath()): Promise<void> {
  const next: WebSettings = { ...readWebSettings(file), tunnel: normalizeTunnelName(name) };
  await writeFileAtomic(file, JSON.stringify(next, null, 2));
}
