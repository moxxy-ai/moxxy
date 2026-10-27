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
  /** A provider the runner moved the config off at startup (the retired
   *  ChatGPT sign-in → the Codex agent), not yet shown to the person. */
  providerMigration: { from: string; to: string } | null;
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
