// ---------- App / dashboard self-update ------------------------------------

/** The app bundle ("dashboard") the desktop is currently running. */
export interface AppUpdateInfo {
  /** Running bundle version. */
  version: string;
  /** Whether it's the one baked into the .app or a hot-updated override. */
  source: 'bundled' | 'updated';
  /** True when this build has a signing key baked in (self-update enabled). */
  channelConfigured: boolean;
}

/** Result of checking the published manifest for a newer dashboard. */
export interface AppUpdateCheck {
  /** A newer, signature-valid bundle is published. */
  available: boolean;
  currentVersion: string;
  latestVersion: string | null;
  /** False ⇒ the update needs a newer shell (a Tier-2 / installer update). */
  compatible: boolean;
  /** True ⇒ the published bundle's runner protocol outruns the CLI this
   *  install can spawn: a hot-update would be staged but refused at every boot
   *  (`runner-protocol-skew`), so the update needs the full app installer. */
  requiresFullUpdate?: boolean;
  notes?: string;
  releaseUrl?: string;
  /** Set when the check itself failed (offline, not configured, …). */
  error?: string;
}

/** Streamed progress while a dashboard update downloads + installs.
 *  `install` is the Tier-2 (`app.updateShell`) installer phase. */
export interface AppUpdateProgress {
  phase: 'download' | 'verify' | 'extract' | 'activate' | 'install';
  received?: number;
  total?: number;
  message?: string;
}

/** One recorded boot/update decision (mirrors `BootLogEntry` in
 *  `@moxxy/desktop-host/app-update`). The renderer only ever displays these. */
export interface AppBootLogEntry {
  ts: number;
  phase: 'boot' | 'recover' | 'probe' | 'confirm' | 'load-error';
  picked?: string;
  reason?: string;
  recoveredTo?: string;
  error?: string;
  electron?: string;
  abi?: string;
}

/** Self-update troubleshooting snapshot: the on-disk pointer state plus the
 *  recent boot-decision log, so a "downloaded but reverted" report is legible
 *  (the Updates → Diagnostics panel renders + copies this). */
export interface AppUpdateDiagnostics {
  /** Bundle version the running process loaded (override or floor). */
  running: string;
  /** `active.json` pointer — the version the bootstrap intends to load next. */
  active: string | null;
  /** Last version that confirmed a healthy render. */
  confirmed: string | null;
  /** Versions poisoned by a failed/unconfirmed boot. */
  bad: string[];
  /** Bundle version dirs currently present under `<userData>/app/`. */
  staged: string[];
  /** Most-recent-last boot-decision entries. */
  log: AppBootLogEntry[];
}
