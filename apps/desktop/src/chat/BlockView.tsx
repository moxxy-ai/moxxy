import { useState } from 'react';
import type { MoxxyEvent } from '@moxxy/sdk';
import {
  oneLine,
  summarizeArgs,
  type Block as FoldedBlock,
  type ToolCallBlockData,
} from '@moxxy/chat-model';
import { Icon } from '@/lib/Icon';
import { MarkdownBody } from './MarkdownBody';
import { SkillGroupView } from './SkillGroupView';

/**
 * One transcript block, rendered from the shared @moxxy/chat-model fold.
 *
 *   - event(user_prompt)      → right-aligned periwinkle bubble.
 *   - event(assistant_message)→ avatar + name + markdown + copy action.
 *   - event(error/abort)      → centered system note.
 *   - tool-call               → mono summary with status-coloured bar.
 *   - skill-scope             → SkillGroupView (banner + nested children).
 *   - subagent                → one-line agent row.
 *   - live-tools              → each call rendered as a tool row.
 *
 * The in-flight streaming assistant text is NOT a block — Transcript
 * renders it via {@link StreamingAssistant} at the tail.
 */
export function BlockView({ block }: { readonly block: FoldedBlock }): JSX.Element | null {
  switch (block.kind) {
    case 'event':
      return <EventBlockView event={block.event} />;
    case 'tool-call':
      return (
        <ToolBlock
          name={block.request.name}
          input={block.request.input}
          outcome={block.outcome}
        />
      );
    case 'skill-scope':
      return <SkillGroupView scope={block} />;
    case 'subagent':
      return <SubagentView block={block} />;
    case 'live-tools':
      return (
        <>
          {block.calls.map((c) => (
            <ToolBlock
              key={c.id}
              name={c.request.name}
              input={c.request.input}
              outcome={c.outcome}
            />
          ))}
        </>
      );
  }
}

function EventBlockView({ event }: { readonly event: MoxxyEvent }): JSX.Element | null {
  switch (event.type) {
    case 'user_prompt':
      return (
        <UserBlock
          text={event.text}
          attachments={event.attachments?.map((a) => a.name ?? a.kind)}
        />
      );
    case 'assistant_message':
      return <AssistantBlock text={event.content} streaming={false} stopReason={event.stopReason} />;
    case 'error':
      return <SystemBlock text={event.message} tone="error" />;
    case 'abort':
      return <SystemBlock text={`aborted: ${event.reason}`} tone="info" />;
    default:
      // skill_invoked is consumed into skill-scope; everything else is
      // bookkeeping the chat surface doesn't render.
      return null;
  }
}

/** Live assistant text while chunks are still arriving — rendered by
 *  Transcript from the store's separate `streamingText`, not a block. */
export function StreamingAssistant({ text }: { readonly text: string }): JSX.Element {
  return <AssistantBlock text={text} streaming />;
}

function UserBlock({
  text,
  attachments,
}: {
  readonly text: string;
  readonly attachments?: ReadonlyArray<string>;
}): JSX.Element {
  const hasAttachments = (attachments?.length ?? 0) > 0;
  return (
    <div
      data-testid="block-user"
      style={{
        alignSelf: 'flex-end',
        maxWidth: '78%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 6,
      }}
    >
      {hasAttachments && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'flex-end' }}>
          {attachments!.map((name, i) => (
            <span
              key={`${name}-${i}`}
              title={name}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                background: '#fff',
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
                  maxWidth: 220,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                @{name}
              </span>
            </span>
          ))}
        </div>
      )}
      {(text.length > 0 || !hasAttachments) && (
        <div
          style={{
            padding: '12px 16px',
            background: 'var(--grad-user)',
            color: '#fff',
            borderRadius: '16px 16px 4px 16px',
            whiteSpace: 'pre-wrap',
            lineHeight: 1.55,
            fontSize: 14.5,
            boxShadow: '0 6px 18px -10px rgba(236, 72, 153, 0.55)',
          }}
        >
          {text}
        </div>
      )}
    </div>
  );
}

function AssistantBlock({
  text,
  streaming,
  stopReason,
}: {
  readonly text: string;
  readonly streaming: boolean;
  readonly stopReason?: string;
}): JSX.Element {
  return (
    <div
      data-testid="block-assistant"
      data-streaming={streaming}
      style={{ alignSelf: 'stretch', display: 'flex', gap: 12, maxWidth: '92%' }}
    >
      <Avatar />
      <div style={{ flex: 1, minWidth: 0 }}>
        <AssistantHeader streaming={streaming} />
        <div style={{ marginTop: 6 }}>
          <MarkdownBody text={text} streaming={streaming} />
        </div>
        {stopReason && stopReason !== 'end_turn' && (
          <div
            className="mono"
            style={{
              marginTop: 6,
              fontSize: 10.5,
              color: 'var(--color-text-dim)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            stop: {stopReason.replace(/_/g, ' ')}
          </div>
        )}
        {!streaming && <ActionRow text={text} />}
      </div>
    </div>
  );
}

function Avatar(): JSX.Element {
  return (
    <span
      aria-hidden
      style={{
        width: 34,
        height: 34,
        borderRadius: 10,
        background: 'var(--color-primary-soft)',
        color: 'var(--color-primary-strong)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <Icon name="agent" size={18} />
    </span>
  );
}

function AssistantHeader({ streaming }: { readonly streaming: boolean }): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontWeight: 600, fontSize: 13.5 }}>Assistant</span>
      {streaming && (
        <span
          className="mono"
          style={{
            fontSize: 11,
            color: 'var(--color-primary)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span
            aria-hidden
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--color-primary)',
              animation: 'moxxy-pulse 1.2s ease-in-out infinite',
            }}
          />
          typing…
        </span>
      )}
    </div>
  );
}

function ActionRow({ text }: { readonly text: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const onCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* swallow; rare on Electron */
    }
  };
  return (
    <div
      style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-text-dim)' }}
    >
      <button
        type="button"
        className="btn-icon"
        aria-label={copied ? 'Copied!' : 'Copy'}
        onClick={() => void onCopy()}
        style={{
          width: 28,
          height: 28,
          borderRadius: 8,
          color: copied ? 'var(--color-green)' : 'var(--color-text-dim)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={copied ? 'check' : 'copy'} size={15} />
      </button>
    </div>
  );
}

function ToolBlock({
  name,
  input,
  outcome,
}: {
  readonly name: string;
  readonly input: unknown;
  readonly outcome: ToolCallBlockData['outcome'];
}): JSX.Element {
  const status: 'running' | 'ok' | 'error' =
    outcome === null
      ? 'running'
      : outcome.type === 'denied'
        ? 'error'
        : outcome.ok
          ? 'ok'
          : 'error';
  const accent =
    status === 'error'
      ? 'var(--color-red)'
      : status === 'ok'
        ? 'var(--color-green)'
        : 'var(--color-primary)';
  const summary = summarizeArgs(input);
  const output = outcome && outcome.type === 'tool_result' ? outcome.output : undefined;
  const error =
    outcome === null
      ? undefined
      : outcome.type === 'denied'
        ? outcome.reason
        : outcome.error?.message;
  return (
    <details
      data-testid="block-tool"
      data-status={status}
      className="mono"
      style={{
        alignSelf: 'flex-start',
        maxWidth: '92%',
        marginLeft: 46,
        fontSize: 12,
        color: 'var(--color-text-dim)',
        borderLeft: `2px solid ${accent}`,
        paddingLeft: 10,
      }}
    >
      <summary style={{ cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'baseline' }}>
        <span style={{ color: accent, fontWeight: 600 }}>[{status}]</span>
        <span style={{ color: 'var(--color-text-muted)' }}>{name}</span>
        {summary && (
          <span
            style={{
              opacity: 0.7,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: 420,
            }}
          >
            {oneLine(summary)}
          </span>
        )}
      </summary>
      <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <pre style={preStyle}>{pretty(input)}</pre>
        {output !== undefined && <pre style={preStyle}>{pretty(output)}</pre>}
        {error && <pre style={{ ...preStyle, color: 'var(--color-red)' }}>{error}</pre>}
      </div>
    </details>
  );
}

function SubagentView({
  block,
}: {
  readonly block: Extract<FoldedBlock, { kind: 'subagent' }>;
}): JSX.Element {
  const running = block.completedAtMs === null && block.error === null;
  const accent = block.error
    ? 'var(--color-red)'
    : running
      ? 'var(--color-primary)'
      : 'var(--color-green)';
  return (
    <div
      data-testid="block-subagent"
      className="mono"
      style={{
        alignSelf: 'flex-start',
        marginLeft: 46,
        fontSize: 12,
        color: 'var(--color-text-dim)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <span style={{ color: accent }}>◆</span>
      <span style={{ color: 'var(--color-text-muted)' }}>agent {block.label}</span>
      <span>· {running ? 'running' : block.error ? 'failed' : 'done'}</span>
      <span>· {block.toolCallCount} tool calls</span>
      {block.error && <span style={{ color: 'var(--color-red)' }}>· {oneLine(block.error)}</span>}
    </div>
  );
}

function SystemBlock({
  text,
  tone,
}: {
  readonly text: string;
  readonly tone: 'info' | 'error';
}): JSX.Element {
  const color = tone === 'error' ? 'var(--color-red)' : 'var(--color-text-dim)';
  return (
    <div
      data-testid="block-system"
      role={tone === 'error' ? 'alert' : 'status'}
      className="mono"
      style={{
        alignSelf: 'center',
        fontSize: 11,
        padding: '4px 10px',
        color,
        textTransform: 'lowercase',
        letterSpacing: '0.04em',
        opacity: 0.85,
      }}
    >
      — {text} —
    </div>
  );
}

const preStyle: React.CSSProperties = {
  margin: 0,
  padding: '8px 10px',
  background: '#f6f7fc',
  border: '1px solid var(--color-card-border)',
  borderRadius: 6,
  fontSize: 11,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  maxHeight: 280,
  overflow: 'auto',
};

/** Pretty 2-space JSON for the expanded tool body (distinct from
 *  chat-model's single-line `stringify`, which feeds summaries). */
function pretty(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
