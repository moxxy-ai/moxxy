import { defineChannel, definePlugin, defineTool, z, type Plugin, type TunnelProviderDef } from '@moxxy/sdk';
import { WebChannel, type WebSurfaceControls } from './channel.js';
import { cloudflaredTunnel } from './cloudflared.js';
import { ngrokTunnel } from './ngrok.js';
import { normalizeTunnelName, readTunnelSetting, writeTunnelSetting } from './tunnel-settings.js';

export { WebChannel, type WebChannelOptions, type WebStartOpts, type WebSurfaceControls } from './channel.js';
export { EventProjector } from './projector.js';
export { cloudflaredTunnel } from './cloudflared.js';
export { ngrokTunnel } from './ngrok.js';
export { readTunnelSetting, writeTunnelSetting, normalizeTunnelName } from './tunnel-settings.js';
export { actionPrompt, type ServerFrame, type ClientFrame } from './protocol.js';

/** Live access to the session's tunnel registry (injected by the CLI builder). */
export interface TunnelControls {
  list(): string[];
  active(): string | null;
  setActive(name: string): void;
  isAvailable(name: string): Promise<boolean>;
}

export interface BuildWebChannelOptions {
  readonly getTunnel?: () => TunnelProviderDef | null;
  readonly publishSurface?: (surface: { url: string; nextViewId: () => string } | null) => void;
  readonly publishControls?: (controls: WebSurfaceControls | null) => void;
  /** Read the live surface controls (for live tunnel switching from the tool). */
  readonly getControls?: () => WebSurfaceControls | null;
  /** Live tunnel registry access for the web_set_tunnel / web_tunnel_status tools. */
  readonly tunnels?: TunnelControls;
  /** Static default tunnel (from config.channels.web.tunnel) when no persisted setting. */
  readonly defaultTunnel?: string;
  /** Override the persisted settings file path (tests). Defaults to ~/.moxxy/web.json. */
  readonly settingsFile?: string;
}

/**
 * Build the web channel plugin. The CLI passes closures over the concrete
 * Session (mirroring the Telegram plugin's vault injection). Contributes:
 *  - the `web` channel (surface + action round-trip),
 *  - the cloudflared + ngrok tunnel providers (registered; `localhost` is the
 *    core-seeded default),
 *  - `web_set_tunnel` / `web_tunnel_status` tools so the user/agent can switch
 *    the tunnel at runtime — persisted to ~/.moxxy/web.json,
 *  - an onInit hook that applies the persisted (or configured) tunnel on boot.
 */
export function buildWebChannelPlugin(opts: BuildWebChannelOptions = {}): Plugin {
  const def = defineChannel({
    name: 'web',
    description:
      'Browser surface that renders agent-authored view-spec UIs over a WebSocket and routes form/button actions back into the session. Exposes itself via a tunnel (cloudflared/ngrok) so users on other channels can open it.',
    create: (deps) => {
      const o = deps.options ?? {};
      return new WebChannel({
        ...(typeof o.port === 'number' ? { port: o.port } : {}),
        ...(typeof o.host === 'string' ? { host: o.host } : {}),
        ...(typeof o.authToken === 'string'
          ? { authToken: o.authToken }
          : process.env.MOXXY_WEB_TOKEN
            ? { authToken: process.env.MOXXY_WEB_TOKEN }
            : {}),
        ...(Array.isArray(o.allowedTools) ? { allowedTools: o.allowedTools as string[] } : {}),
        ...(opts.getTunnel ? { getTunnel: opts.getTunnel } : {}),
        ...(opts.publishSurface ? { publishSurface: opts.publishSurface } : {}),
        ...(opts.publishControls ? { publishControls: opts.publishControls } : {}),
        logger: deps.logger as never,
      });
    },
  });

  const tunnels = opts.tunnels;
  const tools = tunnels
    ? [
        defineTool({
          name: 'web_set_tunnel',
          description:
            'Choose how the web app surface is exposed: "cloudflared" or "ngrok" (public URL for remote channels like Telegram) or "none"/"localhost" (loopback only). Persisted to ~/.moxxy/web.json and applied immediately if a surface is live. Use when the user asks to change or disable the tunnel.',
          inputSchema: z.object({ provider: z.string().min(1) }),
          permission: { action: 'prompt' },
          handler: async ({ provider }) => {
            const name = normalizeTunnelName(provider);
            if (!tunnels.list().includes(name)) {
              return { ok: false, error: `unknown tunnel "${provider}"`, available: ['none', ...tunnels.list()] };
            }
            const available = await tunnels.isAvailable(name);
            if (!available) {
              const hint = name === 'cloudflared' ? 'install: brew install cloudflared' : 'install ngrok + run `ngrok config add-authtoken …`';
              return { ok: false, error: `${name} is not available`, hint };
            }
            tunnels.setActive(name);
            await writeTunnelSetting(name, opts.settingsFile);
            const url = (await opts.getControls?.()?.retunnel()) ?? null;
            return { ok: true, active: name, ...(url ? { url } : { note: 'applies when the web surface (re)starts' }) };
          },
        }),
        defineTool({
          name: 'web_tunnel_status',
          description: 'Report the active web tunnel provider and the available options.',
          inputSchema: z.object({}),
          handler: () => ({ active: tunnels.active(), available: ['none', ...tunnels.list()] }),
        }),
      ]
    : [];

  return definePlugin({
    name: '@moxxy/plugin-channel-web',
    version: '0.0.0',
    channels: [def],
    tunnelProviders: [cloudflaredTunnel, ngrokTunnel],
    tools,
    hooks: tunnels
      ? {
          onInit: () => {
            // Apply the persisted choice (or the configured default) on boot.
            const chosen = readTunnelSetting(opts.settingsFile) ?? (opts.defaultTunnel ? normalizeTunnelName(opts.defaultTunnel) : undefined);
            if (chosen && tunnels.list().includes(chosen)) {
              try {
                tunnels.setActive(chosen);
              } catch {
                /* keep the seeded default */
              }
            }
          },
        }
      : {},
  });
}

/** Default instance for plugin discovery (no session wiring). The CLI uses the builder. */
export const webChannelPlugin: Plugin = buildWebChannelPlugin();

export default webChannelPlugin;
