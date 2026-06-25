// ---------- Onboarding -----------------------------------------------------

/**
 * Provider-key + config state. The renderer flips to the init
 * wizard whenever `needsSetup` is true after a successful connect.
 */
export interface OnboardingStatus {
  cliInstalled: boolean;
  cliPath: string | null;
  hasProvider: boolean;
  /** Active provider (`plugins.provider.default`) from `~/.moxxy/config.yaml`. */
  activeProvider: string | null;
}

/**
 * Node.js detection snapshot — drives the first onboarding step
 * (we can't install or run moxxy without Node).
 */
export interface NodeProbe {
  installed: boolean;
  version: string | null;
  bin: string | null;
}
