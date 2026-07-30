import type { MoxxyEvent } from '@moxxy/sdk';
import { UserBlock } from './UserBlock';
import { TriggerBlock } from './TriggerBlock';
import { AssistantBlock } from './AssistantBlock';
import { ReasoningBlock } from './ReasoningBlock';
import type { ImagePreviewItem } from '../image-preview/types';
import { TraceEntry } from '../trace/TraceEntry';

export function EventBlockView({
  event,
  onPreviewImage,
}: {
  readonly event: MoxxyEvent;
  readonly onPreviewImage?: (image: ImagePreviewItem) => void;
}): JSX.Element | null {
  switch (event.type) {
    case 'user_prompt':
      // A machine-initiated turn (fired webhook/schedule/workflow) renders as a
      // compact, expandable trigger marker instead of the raw synthesized prompt.
      return event.origin ? (
        <TraceEntry kind="trigger" label="triggered" meta={stamp(event.ts)}>
          <TriggerBlock origin={event.origin} text={event.text} />
        </TraceEntry>
      ) : (
        <TraceEntry kind="commanded" label="commanded" meta={stamp(event.ts)}>
          <UserBlock
            text={event.text}
            attachments={event.attachments}
            onPreviewImage={onPreviewImage}
          />
        </TraceEntry>
      );
    case 'assistant_message':
      return (
        <TraceEntry kind="agent" label="moxxy" meta={stamp(event.ts)}>
          <AssistantBlock
            text={event.content}
            streaming={false}
            stopReason={event.stopReason}
          />
        </TraceEntry>
      );
    case 'reasoning_message':
      return (
        <TraceEntry kind="reasoning" label="reasoning" meta={stamp(event.ts)}>
          <ReasoningBlock event={event} />
        </TraceEntry>
      );
    case 'error':
      return (
        <TraceEntry kind="error" label="error" meta={stamp(event.ts)}>
          <SystemBlock text={event.message} tone="error" />
        </TraceEntry>
      );
    case 'abort':
      return (
        <TraceEntry kind="system" label="aborted" meta={stamp(event.ts)}>
          <SystemBlock text={event.reason} tone="info" />
        </TraceEntry>
      );
    default:
      // skill_invoked is consumed into skill-scope; everything else is
      // bookkeeping the chat surface doesn't render.
      return null;
  }
}

/** Wall-clock for the entry's kicker. A run is a sequence of events in time and
 *  the transcript never said when any of them happened; `ts` is already on every
 *  event, so this was information the surface was throwing away. */
function stamp(ts: number | undefined): string | undefined {
  if (ts === undefined) return undefined;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
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
        fontSize: 'var(--type-meta)',
        color,
        letterSpacing: '0.02em',
      }}
    >
      {text}
    </div>
  );
}
