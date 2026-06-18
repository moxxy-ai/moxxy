import { readFileSync } from 'node:fs';
import { createMutex, z } from '@moxxy/sdk';
import { moxxyPath, writeFileAtomic } from '@moxxy/sdk/server';

/** Validates the on-disk web.json shape; a corrupt/foreign file is discarded. */
const webSettingsSchema = z.object({ tunnel: z.string().optional() });

/**
 * Per-instance mutex serializing the read-merge-write of `web.json`. The atomic
 * write prevents torn files, but two concurrent writes would otherwise both
 * read the same snapshot and the second would clobber the first's merge.
 * Mirrors provider-admin/store.ts.
 */
const writeMutex = createMutex();

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
    const parsed = webSettingsSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

export function readTunnelSetting(file = webSettingsPath()): string | undefined {
  const t = readWebSettings(file).tunnel;
  return typeof t === 'string' && t ? normalizeTunnelName(t) : undefined;
}

export async function writeTunnelSetting(name: string, file = webSettingsPath()): Promise<void> {
  await writeMutex.run(async () => {
    const next: WebSettings = { ...readWebSettings(file), tunnel: normalizeTunnelName(name) };
    await writeFileAtomic(file, JSON.stringify(next, null, 2));
  });
}
