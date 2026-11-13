/**
 * Unified onboarding. One declarative, per-step-gated flow (see
 * ONBOARDING_STEPS in ./flow) drives both cases over the shared step-flow
 * engine:
 *
 *   - First run (until `prefs.onboardingComplete`): one question, how to
 *     start (a plan, a free model, an API key), after the runtime and the
 *     CLI only when they are really missing. Connecting enters the app.
 *   - Recovery gate (a prerequisite went missing while the app runs): the
 *     same steps, but only the unmet ones apply and the flow auto-resolves
 *     + closes itself once satisfied.
 *
 * This module is the thin orchestrator: it assembles the gate context,
 * runs the step-flow engine, and dispatches to the per-step components in
 * ./steps. The Shell + step primitives live in ./chrome. Sign-in to a Moxxy
 * account is not part of onboarding: it lives in the sidebar profile pill.
 */

import { usePrefs } from '@moxxy/client-core';
import { useOnboarding, type UseOnboarding } from '@moxxy/client-core';
import { useStepFlow } from '@moxxy/client-core';
import type { ConnectionPhase } from '@moxxy/desktop-ipc-contract';

import { Shell } from './chrome';
import { ONBOARDING_STEPS, type OnboardingCtx } from './flow';
import { NodeStep } from './steps/NodeStep';
import { useRuntimeAutoInstall } from './useRuntimeAutoInstall';
import { useSetupNotice } from './useSetupNotice';
import { useFinishOnboarding } from './useFinishOnboarding';
import { CliStep } from './steps/CliStep';
import { StartStep } from './steps/StartStep';

interface Props {
  readonly phase?: ConnectionPhase;
  readonly notice?: string | null;
  readonly onComplete: () => void;
}

/**
 * Unified onboarding surface. Shown both on true first run (until
 * `prefs.onboardingComplete`) and as a recovery gate (CLI/provider/node
 * missing). One step list, gated per step — see {@link ONBOARDING_STEPS}.
 */
export function Onboarding({ phase, notice, onComplete }: Props): JSX.Element {
  const { prefs, loading: prefsLoading, update } = usePrefs();
  const ob = useOnboarding(phase);
  useRuntimeAutoInstall(ob);
  const setupStatus = useSetupNotice();
  const finish = useFinishOnboarding(update, onComplete);

  const ctx: OnboardingCtx = {
    full: !(prefs?.onboardingComplete ?? false),
    cliInstalled: ob.status?.cliInstalled ?? false,
    cliProbed: ob.status !== null,
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
    <Shell steps={flow.steps} currentIndex={flow.index} status={setupStatus}>
      {/* Until prefs answer, first run and recovery cannot be told apart. */}
      {prefsLoading ? null : renderStep(
        flow.currentId,
        flow.next,
        flow.isFirst ? null : flow.back,
        // A first run ends by remembering it is done; the recovery gate just closes.
        ctx.full ? finish : onComplete,
        ob,
        notice,
      )}
    </Shell>
  );
}

function renderStep(
  id: string | null,
  next: () => void,
  back: (() => void) | null,
  leave: () => void,
  ob: UseOnboarding,
  notice?: string | null,
): JSX.Element {
  const onBack = back ?? ((): void => undefined);
  switch (id) {
    case 'node':
      // Pass the SINGLE onboarding instance down — NodeStep must not mount its
      // own `useOnboarding()` (that doubled the probe IPCs + progress
      // subscription and diverged on phase changes).
      return <NodeStep onNext={next} onBack={onBack} ob={ob} />;
    case 'cli':
      return <CliStep onNext={next} onBack={onBack} />;
    case 'start':
      // Connected or skipped, the person leaves onboarding either way: a
      // recovery gate resolves from backend state and ignores the cursor.
      return <StartStep notice={notice} onDone={leave} onSkip={leave} />;
    default:
      return <></>;
  }
}
