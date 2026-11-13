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
  /** The CLI check has answered; until then a first run does not offer to install it. */
  readonly cliProbed: boolean;
  readonly hasProvider: boolean;
  readonly nodeInstalled: boolean;
  readonly nodeProbed: boolean;
  readonly cliMissing: boolean;
}

/**
 * One declarative onboarding flow, gated per step. A first run asks one
 * question (`start`); the runtime and the CLI come first only when they are
 * really missing, which the installer normally rules out. The recovery gate
 * auto-resolves to whichever prerequisite is missing. Both are the same list
 * over the same {@link useStepFlow} engine.
 */
export const ONBOARDING_STEPS: ReadonlyArray<FlowStep<OnboardingCtx>> = [
  {
    id: 'node',
    label: 'Getting ready',
    applies: (c) => c.nodeProbed && !c.nodeInstalled,
    satisfied: (c) => c.nodeInstalled,
  },
  {
    id: 'cli',
    label: 'Set up Moxxy',
    applies: (c) => c.cliMissing || (c.full && c.cliProbed && !c.cliInstalled),
    satisfied: (c) => c.cliInstalled,
  },
  {
    id: 'start',
    label: 'Get started',
    applies: (c) => c.full || !c.hasProvider,
    satisfied: (c) => c.hasProvider,
  },
];
