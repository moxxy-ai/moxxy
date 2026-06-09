/**
 * The declarative onboarding flow — the gate context the steps are
 * evaluated against ({@link OnboardingCtx}) and the single per-step-gated
 * step list ({@link ONBOARDING_STEPS}) that drives both the first-run
 * linear walk and the recovery gate over the shared step-flow engine.
 * Pure data + types; no React.
 */

import type { FlowStep } from '@moxxy/client-core';

/**
 * Gate context the onboarding steps are evaluated against. `full` is the
 * first-run case (nothing set up yet); otherwise we're a recovery gate
 * (the app is running but a prerequisite — CLI / provider / node — went
 * missing), and only the unmet steps apply.
 */
export interface OnboardingCtx {
  readonly full: boolean;
  readonly cliInstalled: boolean;
  readonly hasProvider: boolean;
  readonly nodeInstalled: boolean;
  readonly nodeProbed: boolean;
  readonly cliMissing: boolean;
}

/**
 * One declarative onboarding flow, gated per step. First-run walks every
 * step linearly; the recovery gate auto-resolves to whichever prerequisite
 * is missing. Both are the same list with different `applies`/`satisfied`
 * predicates over the same {@link useStepFlow} engine.
 */
export const ONBOARDING_STEPS: ReadonlyArray<FlowStep<OnboardingCtx>> = [
  { id: 'welcome', label: 'Welcome', applies: (c) => c.full },
  // Sign-in is no longer an onboarding step — it lives in the sidebar
  // profile pill (Clerk's own modal via clerk.openSignIn()), so first
  // run no longer blocks on auth.
  {
    id: 'node',
    label: 'Install Node',
    applies: (c) => c.nodeProbed && !c.nodeInstalled,
    satisfied: (c) => c.nodeInstalled,
  },
  {
    id: 'cli',
    label: 'Install moxxy',
    applies: (c) => c.full || c.cliMissing,
    satisfied: (c) => c.cliInstalled,
  },
  {
    id: 'provider',
    label: 'Pick a provider',
    applies: (c) => c.full || !c.hasProvider,
    satisfied: (c) => c.hasProvider,
  },
  { id: 'workspace', label: 'First workspace', applies: (c) => c.full },
  { id: 'done', label: "You're set", applies: (c) => c.full },
];
