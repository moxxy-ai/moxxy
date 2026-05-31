import { useCallback, useEffect, useRef, useState } from 'react';
import {
  speak,
  cancelSpeech,
  isSpeechSupported,
  playAudioClip,
  toSpeakableText,
  type AudioClipHandle,
} from '@/lib/speech';
import { api } from '@/lib/api';
import { Icon } from '@moxxy/desktop-ui';

export function ActionRow({ text }: { readonly text: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);
  // Track the "Copied!" reset timer so it can be cleared on unmount — this
  // block lives in a virtualised list and is unmounted on scroll / workspace
  // switch, where a pending setTimeout would fire setState on a dead component.
  const copyTimer = useRef<number | undefined>(undefined);
  // Handle for an in-flight runner-synthesized audio clip (ElevenLabs etc.), so
  // we can stop it on toggle/unmount. `speakGen` invalidates a synthesize()
  // round-trip that resolves after the user has already stopped/restarted.
  const audioRef = useRef<AudioClipHandle | null>(null);
  const speakGen = useRef(0);

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

  // Stop whichever TTS path is playing (OS voice or a synthesized clip) and
  // invalidate any synthesize() request still in flight. Stable (refs only) so
  // the unmount effect can depend on it without re-running.
  const stopSpeech = useCallback((): void => {
    speakGen.current += 1;
    cancelSpeech();
    audioRef.current?.stop();
    audioRef.current = null;
  }, []);

  const onSpeak = (): void => {
    if (speaking) {
      stopSpeech();
      setSpeaking(false);
      return;
    }
    const gen = (speakGen.current += 1);
    setSpeaking(true);
    const done = (): void => {
      if (speakGen.current === gen) setSpeaking(false);
    };
    // Prefer the runner's active synthesizer (e.g. an ElevenLabs plugin); fall
    // back to the OS voice when none is active or the call fails.
    void (async () => {
      try {
        const clip = await api().invoke('session.synthesize', { text: toSpeakableText(text) });
        if (speakGen.current !== gen) return; // stopped/restarted while fetching
        if (clip) {
          audioRef.current = playAudioClip(clip.audioBase64, clip.mimeType, {
            onend: done,
            onerror: done,
          });
          return;
        }
      } catch {
        if (speakGen.current !== gen) return;
      }
      speak(text, { onend: done, onerror: done });
    })();
  };

  // Stop any in-flight speech AND cancel the copy-reset timer if this block
  // unmounts (workspace switch, clear, or scroll out of the virtualised window).
  useEffect(
    () => () => {
      stopSpeech();
      if (copyTimer.current !== undefined) window.clearTimeout(copyTimer.current);
    },
    [stopSpeech],
  );

  return (
    <div
      style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 2, color: 'var(--color-text-dim)' }}
    >
      <ActBtn label={copied ? 'Copied!' : 'Copy'} active={copied} activeColor="var(--color-green)" onClick={() => void onCopy()}>
        <Icon name={copied ? 'check' : 'copy'} size={15} />
      </ActBtn>
      {isSpeechSupported() && (
        <ActBtn
          label={speaking ? 'Stop' : 'Read aloud'}
          active={speaking}
          activeColor="var(--color-primary)"
          onClick={onSpeak}
        >
          <Icon name={speaking ? 'stop' : 'speaker'} size={15} />
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
        borderRadius: 8,
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
