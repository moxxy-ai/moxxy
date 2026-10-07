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
    <div className="msg-actions">
      <ActBtn label={copied ? 'Copied!' : 'Copy'} active={copied} tone="good" onClick={() => void onCopy()}>
        <Icon name={copied ? 'check' : 'copy'} size={14} />
      </ActBtn>
      {isSpeechSupported() && (
        <ActBtn
          label={readAloud.active ? 'Stop' : 'Read aloud'}
          active={readAloud.active}
          tone="accent"
          onClick={readAloud.toggle}
        >
          <Icon name={readAloud.active ? 'stop' : 'speaker'} size={14} />
        </ActBtn>
      )}
      <ActBtn
        label="Good response"
        active={feedback === 'up'}
        tone="good"
        onClick={() => setFeedback((f) => (f === 'up' ? null : 'up'))}
      >
        <Icon name="thumbs-up" size={14} />
      </ActBtn>
      <ActBtn
        label="Bad response"
        active={feedback === 'down'}
        tone="bad"
        onClick={() => setFeedback((f) => (f === 'down' ? null : 'down'))}
      >
        <Icon name="thumbs-down" size={14} />
      </ActBtn>
      {readAloud.errorReason && (
        <span className="msg-actions__error" role="alert">
          TTS failed: {readAloud.errorReason}
        </span>
      )}
    </div>
  );
}

function ActBtn({
  label,
  active,
  tone,
  onClick,
  children,
}: {
  readonly label: string;
  readonly active: boolean;
  /** The hue the control takes while it is on. */
  readonly tone: 'good' | 'bad' | 'accent';
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      className="msg-actions__btn"
      data-tone={tone}
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
