/**
 * Unified onboarding. One declarative, per-step-gated flow (see
 * ONBOARDING_STEPS in ./flow) drives both cases over the shared step-flow
 * engine:
 *
 *   - First run (until `prefs.onboardingComplete`): a linear walk through
 *     welcome → (node) → CLI → provider → workspace → done.
 *   - Recovery gate (a prerequisite went missing while the app runs): the
 *     same steps, but only the unmet ones apply and the flow auto-resolves
 *     + closes itself once satisfied.
 *
 * This module is the thin orchestrator: it assembles the gate context,
 * runs the step-flow engine, and dispatches to the per-step components in
 * ./steps. The Shell + step primitives live in ./chrome. Sign-in is no
 * longer part of onboarding — it lives in the sidebar profile pill (Clerk's
 * own modal), so first run never blocks on auth.
 */

import { usePrefs } from '@/lib/usePrefs';
import { useOnboarding } from '@/lib/useOnboarding';
import { useStepFlow } from '@/lib/step-flow';
import type { ConnectionPhase } from '@moxxy/desktop-ipc-contract';

import { Shell } from './chrome';
import { ONBOARDING_STEPS, type OnboardingCtx } from './flow';
import { WelcomeStep } from './steps/WelcomeStep';
import { NodeStep } from './steps/NodeStep';
import { CliStep } from './steps/CliStep';
import { ProviderStep } from './steps/ProviderStep';
import { WorkspaceStep } from './steps/WorkspaceStep';
import { DoneStep } from './steps/DoneStep';

interface Props {
  readonly phase?: ConnectionPhase;
  readonly onComplete: () => void;
}

/**
 * Unified onboarding surface. Shown both on true first run (until
 * `prefs.onboardingComplete`) and as a recovery gate (CLI/provider/node
 * missing). One step list, gated per step — see {@link ONBOARDING_STEPS}.
 */
export function Onboarding({ phase, onComplete }: Props): JSX.Element {
  const { prefs } = usePrefs();
  const ob = useOnboarding(phase);

  const ctx: OnboardingCtx = {
    full: !(prefs?.onboardingComplete ?? false),
    cliInstalled: ob.status?.cliInstalled ?? false,
    hasProvider: ob.status?.hasProvider ?? false,
    nodeInstalled: ob.node?.installed ?? false,
    nodeProbed: ob.node !== null,
    cliMissing: phase?.phase === 'cli-missing',
  };
  // First run = a linear walk; a recovery gate auto-resolves to the
  // unmet prerequisite and closes itself once satisfied.
  const flow = useStepFlow(ONBOARDING_STEPS, ctx, {
    mode: ctx.full ? 'linear' : 'auto',
    onComplete,
  });

  return (
    <Shell steps={flow.steps} currentIndex={flow.index}>
      {renderStep(flow.currentId, flow.next, flow.isFirst ? null : flow.back, onComplete)}
    </Shell>
  );
}

function renderStep(
  id: string | null,
  next: () => void,
  back: (() => void) | null,
  onComplete: () => void,
): JSX.Element {
  const onBack = back ?? ((): void => undefined);
  switch (id) {
    case 'welcome':
      return <WelcomeStep onNext={next} />;
    case 'node':
      return <NodeStep onNext={next} onBack={onBack} />;
    case 'cli':
      return <CliStep onNext={next} onBack={onBack} />;
    case 'provider':
      return <ProviderStep onNext={next} onBack={onBack} />;
    case 'workspace':
      return <WorkspaceStep onNext={next} onBack={onBack} />;
    case 'done':
      return <DoneStep onComplete={onComplete} />;
    default:
      return <></>;
  }
}
