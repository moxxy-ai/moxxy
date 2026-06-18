/**
 * In-session boot probe for a hot-updated app bundle.
 *
 * Extracted from `index.ts`. Confirms a hot-updated bundle reached a healthy
 * render, else poisons it and relaunches onto the previous-good bundle (or the
 * floor). Health is judged from the MAIN process by inspecting the renderer DOM
 * (React replaces the static `#splash-fallback` inside `#root` on mount) — NOT
 * by the renderer's `app.appBooted` IPC heartbeat, which proved unreliable in
 * packaged builds and poisoned healthy updates. The IPC heartbeat
 * (`confirmed.json`) is kept only as a fast path.
 *
 * No-op on the bundled floor (no override version), so there's no relaunch loop.
 * The cross-launch `recoverFromFailedBoot` (bootstrap.ts) is the belt to this
 * braces. The persistence + relaunch deps are injected so the state machine can
 * be unit-tested with a fake `webContents`.
 */
import type { BrowserWindow } from 'electron';
import type { BootLogEntry, BootLogPhase } from '@moxxy/desktop-host/app-update';

/** How long a hot-updated bundle has to prove a healthy render before the probe
 *  assumes it white-screened and reverts to the floor. Generous so a slow cold
 *  start / Clerk network round-trip can't false-trip it. */
const BOOT_PROBE_TIMEOUT_MS = 15_000;
/** How often the probe polls the renderer DOM for a healthy mount. */
const BOOT_PROBE_POLL_MS = 1_500;

export interface BootProbeDeps {
  /** Active hot-update bundle version, or undefined when running the floor. */
  readonly version: string | undefined;
  readonly userData: string;
  /** Shell identity stamped onto every boot-log entry. */
  readonly shell: { electron: string; nodeAbi: string };
  readonly readConfirmed: (userData: string) => string | null;
  readonly markConfirmed: (userData: string, version: string) => void;
  readonly markBad: (userData: string, version: string) => void;
  readonly appendBootLog: (
    userData: string,
    entry: Partial<BootLogEntry> & { phase: BootLogPhase },
  ) => void;
  readonly relaunch: () => void;
  readonly quit: () => void;
}

/** JS that returns true once React has taken over `#root` (it replaces the
 *  static `#splash-fallback` on mount). Defensive: never throws into the probe. */
const REACT_MOUNTED_JS =
  "(()=>{try{return !!document.getElementById('root')" +
  " && !document.getElementById('splash-fallback')" +
  " && document.getElementById('root').childElementCount>0;}catch(e){return false;}})()";

export function armBootProbe(window: BrowserWindow, deps: BootProbeDeps): void {
  const { version, userData, shell } = deps;
  if (!version) return; // running the floor — nothing to probe

  window.webContents.once('did-finish-load', () => {
    const deadline = Date.now() + BOOT_PROBE_TIMEOUT_MS;

    const reactMounted = async (): Promise<boolean> =>
      window.webContents.executeJavaScript(REACT_MOUNTED_JS, true).catch(() => false);

    const tick = async (): Promise<void> => {
      if (window.isDestroyed()) return;
      // Fast path: the renderer's heartbeat already confirmed it.
      if (deps.readConfirmed(userData) === version) return;

      if (await reactMounted()) {
        // The bundle rendered — confirm from the main process, independent of the
        // (flaky) renderer heartbeat that was poisoning healthy updates.
        try {
          deps.markConfirmed(userData, version);
        } catch {
          /* best effort */
        }
        deps.appendBootLog(userData, { phase: 'confirm', picked: version, reason: 'main-side-dom', ...shell });
        return;
      }

      if (window.isDestroyed() || deps.readConfirmed(userData) === version) return;
      if (Date.now() < deadline) {
        setTimeout(() => void tick(), BOOT_PROBE_POLL_MS);
        return;
      }

      // Never rendered within the window — treat as a real white-screen.
      console.error(
        `[moxxy] boot-probe: bundle ${version} never rendered within ` +
          `${BOOT_PROBE_TIMEOUT_MS}ms; reverting to the previous bundle`,
      );
      deps.appendBootLog(userData, { phase: 'probe', picked: version, reason: 'no-render-within-timeout', ...shell });
      try {
        deps.markBad(userData, version);
      } catch {
        /* best effort */
      }
      deps.relaunch();
      deps.quit();
    };

    void tick();
  });
}
