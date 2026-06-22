/**
 * The fixed loopback HTTPS ports the packaged renderer is served from at
 * `https://desktop.moxxy.ai:<port>`. This is the SINGLE source of truth shared
 * by both sides of the loopback boundary:
 *
 *   - the Electron main process (electron/main/index.ts) — picks the first free
 *     port for the loopback server, allow-lists these origins for navigation,
 *     and scope-trusts the self-signed cert to exactly these ports; and
 *   - the renderer (src/main.tsx) — derives the Clerk `allowedRedirectOrigins`
 *     regex from the same list.
 *
 * They are also exact-match allow-listed in the Clerk dashboard (origins
 * include the port), so the two ends drifting would silently strand OAuth on
 * the hosted Account Portal. Hoisting the list here makes that drift impossible.
 *
 * Pure data + a string helper, no runtime imports — safe to pull into both the
 * Node main bundle AND the browser renderer bundle.
 */
export const LOOPBACK_PORTS = [51789, 51790, 51791, 51792] as const;

/** Regex-alternation of the ports (e.g. `"51789|51790|51791|51792"`), the form
 *  both the navigation allow-list and the renderer's redirect-origin regex
 *  embed inside a larger pattern. */
export const LOOPBACK_PORTS_ALT = LOOPBACK_PORTS.join('|');
