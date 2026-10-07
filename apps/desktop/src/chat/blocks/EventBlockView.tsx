import type { MoxxyEvent } from '@moxxy/sdk';
import { UserBlock } from './UserBlock';
import { TriggerBlock } from './TriggerBlock';
import { ActionRow } from './ActionRow';
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
        <TraceEntry kind="trigger">
          <TriggerBlock origin={event.origin} text={event.text} />
        </TraceEntry>
      ) : (
        <TraceEntry kind="commanded" meta={stamp(event.ts)}>
          <UserBlock
            text={event.text}
            attachments={event.attachments}
            onPreviewImage={onPreviewImage}
          />
        </TraceEntry>
      );
    case 'assistant_message':
      return (
        <TraceEntry
          kind="agent"
          meta={stamp(event.ts)}
          actions={<ActionRow text={event.content} />}
        >
          <AssistantBlock
            text={event.content}
            streaming={false}
            stopReason={event.stopReason}
          />
        </TraceEntry>
      );
    case 'reasoning_message':
      return (
        <TraceEntry kind="reasoning">
          <ReasoningBlock event={event} />
        </TraceEntry>
      );
    case 'error':
      return (
        <TraceEntry kind="error" label="Error" meta={stamp(event.ts)}>
          <SystemBlock text={event.message} tone="error" />
        </TraceEntry>
      );
    case 'abort':
      return (
        <TraceEntry kind="system" label="Stopped" meta={stamp(event.ts)}>
          <SystemBlock text={event.reason} tone="info" />
        </TraceEntry>
      );
    default:
      // skill_invoked is consumed into skill-scope; everything else is
      // bookkeeping the chat surface doesn't render.
      return null;
  }
}

/** When the entry happened, to the minute: a message is not a log line. */
function stamp(ts: number | undefined): string | undefined {
  if (ts === undefined) return undefined;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
}

function SystemBlock({
  text,
  tone,
}: {
  readonly text: string;
  readonly tone: 'info' | 'error';
}): JSX.Element {
  return (
    <div
      className="note"
      data-testid="block-system"
      data-tone={tone}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      {text}
    </div>
  );
}
