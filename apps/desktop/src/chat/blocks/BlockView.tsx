import type { Block as FoldedBlock } from '@moxxy/chat-model';
import { SkillGroupView } from '../SkillGroupView';
import { EventBlockView } from './EventBlockView';
import { ToolBlock } from './ToolBlock';
import { SubagentView } from './SubagentView';
import { SubagentGroupView } from './SubagentGroupView';
import { CollaborationCard } from './CollaborationCard';
import type { ImagePreviewItem } from '../image-preview/types';
import { LiveToolGroupView } from '../ToolGroupView';
import { TraceEntry } from '../trace/TraceEntry';

/**
 * One transcript block, rendered from the shared @moxxy/chat-model fold.
 *
 * Every kind is wrapped in a {@link TraceEntry}, so they all hang off the same
 * timeline and the gutter glyph — not a per-block avatar or card — is what says
 * which kind it is:
 *
 *   - event(user_prompt)      → commanded line (or a trigger marker).
 *   - event(assistant_message)→ prose, in the serif voice.
 *   - event(reasoning)        → folded, dim.
 *   - event(error/abort)      → system note.
 *   - tool-call               → one dense row.
 *   - skill-scope             → SkillGroupView (banner + nested children).
 *   - subagent / -group       → agent row, or a collapsible tree of siblings.
 *   - live-tools              → each in-flight call as a row.
 *
 * The in-flight streaming assistant text is NOT a block — Transcript
 * renders it via {@link StreamingAssistant} at the tail.
 */
export function BlockView({
  block,
  step,
  onPreviewImage,
}: {
  readonly block: FoldedBlock;
  /** 1-based ordinal within the turn, for the blocks that ARE steps. */
  readonly step?: number;
  readonly onPreviewImage?: (image: ImagePreviewItem) => void;
}): JSX.Element | null {
  switch (block.kind) {
    case 'event':
      return <EventBlockView event={block.event} onPreviewImage={onPreviewImage} />;
    case 'tool-call':
      // No kicker: the row already leads with the tool's name, and a "TOOL"
      // label above it would just be a second word for the same fact.
      return (
        <TraceEntry kind="tool">
          <ToolBlock
            name={block.request.name}
            input={block.request.input}
            outcome={block.outcome}
          />
        </TraceEntry>
      );
    case 'skill-scope':
      return (
        <TraceEntry kind="tool">
          <SkillGroupView scope={block} step={step} />
        </TraceEntry>
      );
    case 'subagent':
      return (
        <TraceEntry kind="subagent">
          <SubagentView block={block} />
        </TraceEntry>
      );
    case 'subagent-group':
      return (
        <TraceEntry kind="subagent">
          <SubagentGroupView block={block} />
        </TraceEntry>
      );
    case 'live-tools':
      return (
        <TraceEntry kind="tool">
          <LiveToolGroupView block={block} step={step} />
        </TraceEntry>
      );
    case 'collab':
      return (
        <TraceEntry kind="subagent" label="collaboration">
          <CollaborationCard block={block} />
        </TraceEntry>
      );
    default: {
      // Exhaustiveness guard: a new Block kind in @moxxy/chat-model must be
      // handled here or this becomes a compile error rather than rendering blank.
      const _exhaustive: never = block;
      return null;
    }
  }
}
