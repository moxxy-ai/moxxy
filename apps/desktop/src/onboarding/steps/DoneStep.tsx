/**
 * The closing step — marks `onboardingComplete` in prefs and hands control
 * back to the app. First-run only.
 */

import { MoxxyMark } from '@/components/MoxxyMark';
import { usePrefs } from '@moxxy/client-core';
import { Icon } from '@moxxy/desktop-ui';
import { PrimaryButton } from '../chrome';

export function DoneStep({ onComplete }: { readonly onComplete: () => void }): JSX.Element {
  const { update } = usePrefs();
  const onFinish = (): void => {
    // Start the durable write first, but do not hold the last screen on the IPC
    // round-trip. App owns an optimistic session flag specifically so clicking
    // the final CTA enters the workspace immediately; persistence can finish
    // after this component unmounts and will gate the next launch.
    const persisted = update({ onboardingComplete: true });
    onComplete();
    void persisted.catch((error: unknown) => {
      console.error('[onboarding] could not persist completion', error);
    });
  };
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: 18,
      }}
    >
      <MoxxyMark size={200} />
      <div>
        <h2 style={{ margin: 0, fontSize: 'var(--type-display)', fontWeight: 700 }}>You&rsquo;re all set!</h2>
        <p
          style={{
            margin: '8px 0 0',
            color: 'var(--color-text-muted)',
            fontSize: 'var(--type-ui)',
            lineHeight: 1.6,
          }}
        >
          Open your workspaces, send your first message, and tell me what we&rsquo;re building today.
        </p>
      </div>
      <PrimaryButton onClick={onFinish}>
        Open my workspaces <Icon name="chevron-right" size={14} />
      </PrimaryButton>
    </div>
  );
}
