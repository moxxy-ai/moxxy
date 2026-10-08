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
 *   - event(user_prompt)       the person's bubble (or a trigger note).
 *   - event(assistant_message) the agent's bubble.
 *   - event(reasoning)         folded, quiet.
 *   - event(error/abort)       a note.
 *   - tool-call                one quiet row.
 *   - skill-scope              SkillGroupView (banner + nested children).
 *   - subagent / -group        an agent row, or a foldable tree of siblings.
 *   - live-tools               each in-flight call as a row.
 *
 * The in-flight streaming assistant text is NOT a block: Transcript renders it
 * via {@link StreamingAssistant} at the tail.
 */
export function BlockView({
  block,
  onPreviewImage,
}: {
  readonly block: FoldedBlock;
  readonly onPreviewImage?: (image: ImagePreviewItem) => void;
}): JSX.Element | null {
  switch (block.kind) {
    case 'event':
      return <EventBlockView event={block.event} onPreviewImage={onPreviewImage} />;
    case 'tool-call':
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
          <SkillGroupView scope={block} />
        </TraceEntry>
      );
    // These three draw their own entry, so they are not wrapped in a second one.
    case 'subagent':
      return <SubagentView block={block} />;
    case 'subagent-group':
      return <SubagentGroupView block={block} />;
    case 'live-tools':
      return (
        <TraceEntry kind="tool">
          <LiveToolGroupView block={block} />
        </TraceEntry>
      );
    case 'collab':
      return <CollaborationCard block={block} />;
    default: {
      // Exhaustiveness guard: a new Block kind in @moxxy/chat-model must be
      // handled here or this becomes a compile error rather than rendering blank.
      const _exhaustive: never = block;
      return null;
    }
  }
}
