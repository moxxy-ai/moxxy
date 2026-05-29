import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { Icon } from '@/lib/Icon';
import { api } from '@/lib/api';
import { AgentPicker } from './AgentPicker';
import { CommandPalette } from './CommandPalette';
import { FILE_INSERT_EVENT, type FileInsertDetail } from '@/shell/WorkspaceFiles';

interface ComposerAttachment {
  readonly path: string;
  readonly name: string;
}

interface ComposerProps {
  readonly ready: boolean;
  readonly sending: boolean;
  readonly activeTurnId: string | null;
  readonly workspaceId: string;
  readonly onSend: (
    prompt: string,
    attachments?: ReadonlyArray<ComposerAttachment>,
  ) => void;
  readonly onAbort: () => void;
}

type VoiceState =
  | { kind: 'idle' }
  | { kind: 'recording'; recorder: MediaRecorder; chunks: Blob[] }
  | { kind: 'transcribing' }
  | { kind: 'unavailable'; reason: string };

/**
 * Composer rendered as a rounded white card flush against the chat
 * pane bottom.
 *
 *   Enter         submit
 *   Shift+Enter   newline
 *   ⌘↵ / Ctrl+↵   submit (kept for terminal muscle memory)
 *   Esc           clear draft
 *
 * Tooling chips: Attach (file picker → appends a file: reference to
 * the draft) and Voice (push-to-record with MediaRecorder, transcribed
 * via the runner's active transcriber — disabled if none is set).
 */
export function Composer({
  ready,
  sending,
  activeTurnId,
  workspaceId,
  onSend,
  onAbort,
}: ComposerProps): JSX.Element {
  const [draft, setDraft] = useState('');
  const [voice, setVoice] = useState<VoiceState>({ kind: 'idle' });
  const [hasTranscriber, setHasTranscriber] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  /** Files the user picked from the rail or the native picker. Each
   *  one ships as a UserPromptAttachment with kind: 'file' + content:
   *  absolute path so the agent's read_file / cat tools find it. */
  const [attachments, setAttachments] = useState<ReadonlyArray<ComposerAttachment>>([]);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const addAttachment = (att: ComposerAttachment): void => {
    setAttachments((cur) => (cur.some((a) => a.path === att.path) ? cur : [...cur, att]));
  };
  const removeAttachment = (path: string): void => {
    setAttachments((cur) => cur.filter((a) => a.path !== path));
  };
  const inFlight = activeTurnId !== null || sending;
  const canSubmit =
    ready && !inFlight && (draft.trim().length > 0 || attachments.length > 0);

  // The context rail's file tree fires a CustomEvent when the user
  // clicks a file. We treat it as an attachment, not text — the
  // absolute path is what the agent needs, the chip in the input
  // is what the user wants to see.
  useEffect(() => {
    const handler = (ev: Event): void => {
      const detail = (ev as CustomEvent<FileInsertDetail>).detail;
      if (!detail?.absPath) return;
      addAttachment({ path: detail.absPath, name: detail.name });
      window.setTimeout(() => taRef.current?.focus(), 0);
    };
    window.addEventListener(FILE_INSERT_EVENT, handler);
    return () => window.removeEventListener(FILE_INSERT_EVENT, handler);
  }, []);

  // Probe transcriber availability when the connection comes up.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void api()
      .invoke('session.hasTranscriber')
      .then((has) => {
        if (!cancelled) setHasTranscriber(has);
      })
      .catch(() => {
        if (!cancelled) setHasTranscriber(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ready]);

  const submit = useCallback(() => {
    if (!canSubmit) return;
    onSend(draft, attachments.length > 0 ? attachments : undefined);
    setDraft('');
    setAttachments([]);
  }, [canSubmit, draft, attachments, onSend]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    // Enter alone submits; Shift+Enter inserts a newline (the browser
    // default). ⌘↵ / Ctrl+↵ also submit so terminal-muscle-memory
    // users aren't surprised.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setDraft('');
    }
  };

  const onAttach = useCallback(async () => {
    try {
      const path = await api().invoke('session.pickAttachment');
      if (!path) return;
      const name = path.split('/').pop() ?? path;
      addAttachment({ path, name });
      taRef.current?.focus();
    } catch {
      /* noop — file picker errors are non-fatal */
    }
  }, []);

  const onVoiceToggle = useCallback(async () => {
    if (voice.kind === 'recording') {
      voice.recorder.stop();
      return;
    }
    if (voice.kind !== 'idle') return;
    if (!hasTranscriber) {
      setVoice({
        kind: 'unavailable',
        reason: 'No transcriber configured on the runner.',
      });
      setTimeout(() => setVoice({ kind: 'idle' }), 2500);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );
      const chunks: Blob[] = [];
      recorder.addEventListener('dataavailable', (ev) => {
        if (ev.data.size > 0) chunks.push(ev.data);
      });
      recorder.addEventListener('stop', () => {
        stream.getTracks().forEach((t) => t.stop());
        void finalizeRecording(chunks, recorder.mimeType, setVoice, setDraft);
      });
      recorder.start();
      setVoice({ kind: 'recording', recorder, chunks });
    } catch (e) {
      setVoice({
        kind: 'unavailable',
        reason: e instanceof Error ? e.message : 'mic unavailable',
      });
      setTimeout(() => setVoice({ kind: 'idle' }), 2500);
    }
  }, [hasTranscriber, voice]);

  return (
    <form
      data-testid="composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      style={{
        margin: '12px 18px 4px',
        padding: '12px 14px',
        background: 'var(--color-card-bg)',
        border: '1px solid var(--color-card-border)',
        borderRadius: 16,
        boxShadow: 'var(--color-card-shadow)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      {attachments.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            paddingBottom: 4,
          }}
        >
          {attachments.map((a) => (
            <AttachmentChip
              key={a.path}
              name={a.name}
              path={a.path}
              onRemove={() => removeAttachment(a.path)}
            />
          ))}
        </div>
      )}
      <textarea
        ref={taRef}
        data-testid="composer-input"
        aria-label="prompt"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={
          attachments.length > 0
            ? 'Ask about the attached file…'
            : ready
              ? 'Send a message to the agent…'
              : 'Waiting for runner…'
        }
        disabled={!ready || inFlight}
        rows={Math.min(8, Math.max(1, draft.split('\n').length))}
        style={{
          width: '100%',
          resize: 'none',
          padding: '4px 6px 6px',
          fontSize: 14.5,
          lineHeight: 1.55,
          color: 'var(--color-text)',
          background: 'transparent',
          border: 'none',
          fontFamily: 'inherit',
          outline: 'none',
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <AgentPicker workspaceId={workspaceId} disabled={!ready || inFlight} />
        <ToolChip label="Actions" onClick={() => setActionsOpen(true)}>
          <Icon name="spark" size={14} />
          <span>Actions</span>
        </ToolChip>
        <ToolChip label="Attach file" onClick={() => void onAttach()}>
          <Icon name="attach" size={16} />
          <span>Attach</span>
        </ToolChip>
        <ToolChip
          label={voice.kind === 'recording' ? 'Stop recording' : 'Voice input'}
          onClick={() => void onVoiceToggle()}
          tone={
            voice.kind === 'recording'
              ? 'recording'
              : voice.kind === 'transcribing'
                ? 'busy'
                : 'idle'
          }
        >
          <Icon name="mic" size={16} />
          <span>
            {voice.kind === 'recording'
              ? 'Listening…'
              : voice.kind === 'transcribing'
                ? 'Transcribing…'
                : 'Voice'}
          </span>
        </ToolChip>
        <span style={{ flex: 1 }} />
        {inFlight ? (
          <button
            type="button"
            className="btn-cta"
            data-testid="composer-abort"
            onClick={onAbort}
            style={sendBtn('var(--color-red)', true)}
            aria-label="Abort"
          >
            <Icon name="stop" size={16} />
          </button>
        ) : (
          <button
            type="submit"
            className="btn-cta"
            data-testid="composer-send"
            disabled={!canSubmit}
            style={sendBtn('var(--color-send)', canSubmit)}
            aria-label="Send"
          >
            <Icon name="send" size={16} />
          </button>
        )}
      </div>
      {voice.kind === 'unavailable' && (
        <p
          role="status"
          style={{
            margin: 0,
            textAlign: 'center',
            fontSize: 11,
            color: 'var(--color-red)',
          }}
        >
          {voice.reason}
        </p>
      )}
      {actionsOpen && (
        <CommandPalette
          workspaceId={workspaceId}
          onClose={() => setActionsOpen(false)}
        />
      )}
    </form>
  );
}

function pickMimeType(): string | undefined {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  if (typeof MediaRecorder === 'undefined') return undefined;
  return candidates.find((m) => MediaRecorder.isTypeSupported(m));
}

async function finalizeRecording(
  chunks: ReadonlyArray<Blob>,
  mimeType: string,
  setVoice: (v: VoiceState) => void,
  setDraft: (mutator: (draft: string) => string) => void,
): Promise<void> {
  setVoice({ kind: 'transcribing' });
  try {
    const blob = new Blob([...chunks], { type: mimeType });
    const buf = await blob.arrayBuffer();
    const audioBase64 = arrayBufferToBase64(buf);
    const text = await api().invoke('session.transcribe', {
      audioBase64,
      mimeType,
    });
    if (text?.trim()) {
      setDraft((d) => (d ? `${d.trimEnd()} ${text.trim()}` : text.trim()));
    }
    setVoice({ kind: 'idle' });
  } catch (e) {
    setVoice({
      kind: 'unavailable',
      reason: e instanceof Error ? e.message : 'transcription failed',
    });
    setTimeout(() => setVoice({ kind: 'idle' }), 2500);
  }
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function ToolChip({
  children,
  label,
  onClick,
  tone = 'idle',
}: {
  readonly children: React.ReactNode;
  readonly label: string;
  readonly onClick?: () => void;
  readonly tone?: 'idle' | 'recording' | 'busy';
}): JSX.Element {
  /** Hover effect is provided by the global .btn-chip class — adds
   *  a subtle bg + border darken on hover. */
  const palette =
    tone === 'recording'
      ? { bg: '#fee2e2', color: '#dc2626', border: '#fecaca' }
      : tone === 'busy'
        ? { bg: 'var(--color-primary-soft)', color: 'var(--color-primary-strong)', border: 'var(--color-primary-soft)' }
        : { bg: '#fff', color: 'var(--color-text-muted)', border: 'var(--color-card-border)' };
  return (
    <button
      type="button"
      className="btn-chip"
      aria-label={label}
      onClick={onClick}
      style={{
        padding: '6px 10px',
        fontSize: 12.5,
        color: palette.color,
        border: `1px solid ${palette.border}`,
        borderRadius: 10,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        background: palette.bg,
      }}
    >
      {children}
    </button>
  );
}

/**
 * Pill rendered above the textarea for each attached file. Shows the
 * basename and a tiny × to drop it. The full absolute path lives on
 * the title= attr so a hover reveals where on disk the agent will
 * read it from.
 */
function AttachmentChip({
  name,
  path,
  onRemove,
}: {
  readonly name: string;
  readonly path: string;
  readonly onRemove: () => void;
}): JSX.Element {
  return (
    <span
      title={path}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 4px 4px 10px',
        background: 'var(--color-primary-soft)',
        border: '1px solid var(--color-primary)',
        borderRadius: 999,
        fontSize: 12,
        color: 'var(--color-primary-strong)',
        fontWeight: 600,
        maxWidth: 280,
      }}
    >
      <Icon name="attach" size={12} />
      <span
        className="mono"
        style={{
          maxWidth: 200,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        @{name}
      </span>
      <button
        type="button"
        aria-label={`Remove ${name}`}
        onClick={onRemove}
        style={{
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: 'rgba(236, 72, 153, 0.18)',
          color: 'var(--color-primary-strong)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name="x" size={11} />
      </button>
    </span>
  );
}

function sendBtn(bg: string, enabled: boolean): React.CSSProperties {
  return {
    width: 38,
    height: 38,
    borderRadius: 12,
    background: bg,
    color: '#fff',
    fontSize: 14,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: enabled ? 1 : 0.45,
    boxShadow: enabled ? '0 8px 20px -10px rgba(236, 72, 153, 0.55)' : 'none',
  };
}
