import { useState } from 'react';
import { isSpeechSupported } from '@moxxy/client-platform-web';
import { useReadAloud } from '@moxxy/client-core';
import { Icon } from '@moxxy/desktop-ui';
import { useCopy } from '@/lib/useCopy';

export function ActionRow({ text }: { readonly text: string }): JSX.Element {
  const { copied, copy } = useCopy();
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);
  const readAloud = useReadAloud(text);

  return (
    <div className="msg-actions">
      <ActBtn label={copied ? 'Copied!' : 'Copy'} active={copied} tone="good" onClick={() => void copy(text)}>
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
