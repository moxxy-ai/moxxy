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

/** What an update would bring to the runner (`@moxxy/cli`) and the `@moxxy`
 *  extensions installed in `~/.moxxy/plugins`. */
export interface ComponentUpdateCheck {
  /** Something is behind the latest release and can be updated. */
  available: boolean;
  /** The release they would move to. */
  version: string | null;
  runner: { current: string | null } | null;
  extensions: ReadonlyArray<{ name: string; current: string }>;
  /** Why nothing can be checked or updated (no npm, …). */
  error?: string;
}

/** How one "Update" reaches this machine: a JS bundle (`hot`) or the full
 *  installer. */
export type AppUpdateRoute = 'hot' | 'installer';
export type AppUpdateStepId = 'app' | 'installer' | 'restart';
export type AppUpdateStepStatus = 'pending' | 'running' | 'done' | 'failed';

export interface AppUpdateStep {
  id: AppUpdateStepId;
  status: AppUpdateStepStatus;
  /** Why the step failed. */
  error?: string;
}

/**
 * Everything one "Update" does before the restart, decided before anything is
 * installed and kept on disk so the launch after the restart can tell whether
 * it took effect. What the new app then sets up is {@link AppSetupState}.
 */
export interface AppUpdatePlan {
  id: string;
  createdAt: number;
  route: AppUpdateRoute;
  /** The app version the update ends at. */
  version: string;
  /** Where the installer can be downloaded by hand — offered only when the
   *  system refused to install it. Installer route only. */
  releaseUrl?: string;
  steps: ReadonlyArray<AppUpdateStep>;
}

export type AppUpdatePlanState = 'running' | 'restarting' | 'done' | 'failed';

/** Where a plan stands, read from its steps. */
export function appUpdatePlanState(plan: AppUpdatePlan): AppUpdatePlanState {
  if (plan.steps.some((step) => step.status === 'failed')) return 'failed';
  if (plan.steps.every((step) => step.status === 'done')) return 'done';
  const restart = plan.steps.find((step) => step.id === 'restart');
  return restart?.status === 'running' ? 'restarting' : 'running';
}

/** What a launch sets up before the first runner starts: `extensions` are the
 *  ones the installer carries, `components` the runner and extensions brought
 *  to the version this app was built with, `connections` the model
 *  connections and Computer Use the installer replaces with a backup. */
export type AppSetupStepId = 'extensions' | 'components' | 'connections';

export interface AppSetupStep {
  id: AppSetupStepId;
  status: AppUpdateStepStatus;
  /** Why the step failed; the previous version stays in use. */
  error?: string;
}

/**
 * The setup a launch does after an install or an update. Nobody is asked
 * anything: it runs, and `notes` says afterwards what a person may want to
 * know (a part that kept its previous version, where a replaced copy is).
 */
export interface AppSetupState {
  /** Null when this launch has nothing to set up. */
  reason: 'install' | 'update' | null;
  phase: 'pending' | 'running' | 'done';
  steps: ReadonlyArray<AppSetupStep>;
  notes: ReadonlyArray<string>;
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
