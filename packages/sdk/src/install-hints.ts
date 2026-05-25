/**
 * Generic "how does the user install <thing> on their OS" helper, used by
 * plugins that depend on a native binary they can't bundle themselves.
 * Voice input wants ffmpeg; a transcription plugin might want
 * `sox`/`opus-tools`; a doc-rendering plugin might want `pandoc`. Each
 * caller passes either a single package name (when it's the same across
 * platforms — the common case for widely-packaged tools) or a per-
 * platform map for tools whose package name differs.
 *
 * The helper is informational. We never auto-run a system installer
 * here: package managers prompt for sudo/UAC, and that doesn't fit a
 * TUI cleanly. Callers render the returned command in their UI and the
 * user runs it themselves.
 */
export interface InstallTarget {
  /** Canonical package name. Used when `perPlatform` has no entry for the active OS. */
  readonly name: string;
  /** Override the package name on specific platforms (e.g. `winget` IDs). */
  readonly perPlatform?: Partial<Record<NodeJS.Platform, string>>;
}

export interface InstallHint {
  readonly command: string;
  readonly manager: string;
}

export function getInstallHint(
  target: string | InstallTarget,
  platform: NodeJS.Platform = process.platform,
): InstallHint {
  const spec: InstallTarget = typeof target === 'string' ? { name: target } : target;
  const pkg = spec.perPlatform?.[platform] ?? spec.name;
  if (platform === 'darwin') {
    return { command: `brew install ${pkg}`, manager: 'Homebrew' };
  }
  if (platform === 'win32') {
    return { command: `winget install ${pkg}`, manager: 'winget' };
  }
  if (platform === 'linux') {
    return { command: `sudo apt install ${pkg}`, manager: 'apt' };
  }
  return { command: `install ${pkg} via your platform's package manager`, manager: 'manual' };
}
