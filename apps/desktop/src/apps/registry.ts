import type { ComponentType } from 'react';
import type { IconName } from '@moxxy/desktop-ui';
import type { SendToSessionPayload } from '@moxxy/client-core';

export interface DesktopAppProps {
  /** Return to the Apps gallery. */
  readonly onExit: () => void;
  /** Hand a payload to the user's active session (review-in-composer): prefills
   *  the chat composer + switches to chat for the user to review and send.
   *  Present ONLY when the app declared `canSendToSession` — apps that didn't
   *  opt in never receive it, so the capability can't be used by accident. */
  readonly sendToSession?: (payload: SendToSessionPayload) => void;
}

/**
 * A desktop "app" — a self-contained mini-application shown in the Apps gallery.
 *
 * Registry-backed (mirrors the core swappable-block registries) so a new app is
 * one `registerDesktopApp` call and never touches navigation. Apps that need
 * local assets before use set `requiresInstall` + `installSummary`; the gallery
 * drives their `apps.status` / `apps.install` lifecycle (the main process owns
 * the actual download — see `@moxxy/desktop-host`).
 */
export interface DesktopAppDef {
  /** Stable slug — the sub-route key AND the install/asset id shared with main
   *  (`userData/moxxy-apps/<id>`). Must match `/^[a-z][a-z0-9-]*$/`. */
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly icon: IconName;
  /** Show the "Offline · on-device" badge on the card + in the app header. */
  readonly offline?: boolean;
  /** The app must be installed (assets downloaded) before it can be opened. */
  readonly requiresInstall?: boolean;
  /** One line describing what Install downloads (size, what it's for). */
  readonly installSummary?: string;
  /** Opt in to the "send to chat" capability: when set, the gallery passes a
   *  `sendToSession` to the component so it can push output into the active
   *  session's composer. Off by default — a capability the app must request. */
  readonly canSendToSession?: boolean;
  /** Full-pane component, rendered inside `<main className="col-main col-main--flat">`. */
  readonly Component: ComponentType<DesktopAppProps>;
}

const registry = new Map<string, DesktopAppDef>();

export function registerDesktopApp(def: DesktopAppDef): void {
  if (registry.has(def.id)) throw new Error(`duplicate desktop app: ${def.id}`);
  registry.set(def.id, def);
}

export function listDesktopApps(): readonly DesktopAppDef[] {
  return [...registry.values()];
}

export function getDesktopApp(id: string): DesktopAppDef | undefined {
  return registry.get(id);
}
