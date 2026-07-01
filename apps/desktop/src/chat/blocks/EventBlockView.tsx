import type { MoxxyEvent } from '@moxxy/sdk';
import { UserBlock } from './UserBlock';
import { TriggerBlock } from './TriggerBlock';
import { AssistantBlock } from './AssistantBlock';
import { ReasoningBlock } from './ReasoningBlock';
import type { ImagePreviewItem } from '../image-preview/types';

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
        <TriggerBlock origin={event.origin} text={event.text} />
      ) : (
        <UserBlock
          text={event.text}
          attachments={event.attachments}
          onPreviewImage={onPreviewImage}
        />
      );
    case 'assistant_message':
      return <AssistantBlock text={event.content} streaming={false} stopReason={event.stopReason} />;
    case 'reasoning_message':
      return <ReasoningBlock event={event} />;
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
