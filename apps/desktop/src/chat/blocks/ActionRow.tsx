import { useEffect, useRef, useState } from 'react';
import { isSpeechSupported } from '@moxxy/client-platform-web';
import { useReadAloud } from '@moxxy/client-core';
import { Icon } from '@moxxy/desktop-ui';

export function ActionRow({ text }: { readonly text: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);
  const readAloud = useReadAloud(text);
  // Track the "Copied!" reset timer so it can be cleared on unmount — this
  // block lives in a virtualised list and is unmounted on scroll / workspace
  // switch, where a pending setTimeout would fire setState on a dead component.
  const copyTimer = useRef<number | undefined>(undefined);

  const onCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (copyTimer.current !== undefined) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* swallow; rare on Electron */
    }
  };

  // Cancel the copy-reset timer if this virtualised block unmounts. Read-aloud
  // teardown is owned by its reusable hook.
  useEffect(
    () => () => {
      if (copyTimer.current !== undefined) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, color: 'var(--color-text-dim)' }}>
        <ActBtn label={copied ? 'Copied!' : 'Copy'} active={copied} activeColor="var(--color-green)" onClick={() => void onCopy()}>
          <Icon name={copied ? 'check' : 'copy'} size={15} />
        </ActBtn>
        {isSpeechSupported() && (
          <ActBtn
            label={readAloud.active ? 'Stop' : 'Read aloud'}
            active={readAloud.active}
            activeColor="var(--color-primary)"
            onClick={readAloud.toggle}
          >
            <Icon name={readAloud.active ? 'stop' : 'speaker'} size={15} />
          </ActBtn>
        )}
        <span aria-hidden style={{ width: 1, height: 14, background: 'var(--color-card-border)', margin: '0 5px' }} />
        <ActBtn
          label="Good response"
          active={feedback === 'up'}
          activeColor="var(--color-green)"
          onClick={() => setFeedback((f) => (f === 'up' ? null : 'up'))}
        >
          <Icon name="thumbs-up" size={15} />
        </ActBtn>
        <ActBtn
          label="Bad response"
          active={feedback === 'down'}
          activeColor="var(--color-red)"
          onClick={() => setFeedback((f) => (f === 'down' ? null : 'down'))}
        >
          <Icon name="thumbs-down" size={15} />
        </ActBtn>
      </div>
      {readAloud.errorReason && (
        <p role="alert" style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--color-red)' }}>
          TTS failed: {readAloud.errorReason}
        </p>
      )}
    </div>
  );
}

function ActBtn({
  label,
  active,
  activeColor,
  onClick,
  children,
}: {
  readonly label: string;
  readonly active: boolean;
  readonly activeColor: string;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      className="btn-icon"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      style={{
        width: 28,
        height: 28,
        borderRadius: 'var(--radius-block)',
        color: active ? activeColor : 'var(--color-text-dim)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {children}
    </button>
  );
}
