/**
 * "Generate skill with AI" modal — a thin wrapper over the shared
 * AgentTaskModal (hidden background runner turn + streamed preview). On
 * confirm the draft is handed to the Create modal via `onUseGenerated` so the
 * user can tweak the filename and body before persisting.
 */

import { AgentTaskModal } from '../shared/AgentTaskModal';
import { SKILL_PROMPT_TEMPLATE } from './skill-prompt';

export function GenerateSkillModal({
  onCancel,
  onUseGenerated,
}: {
  readonly onCancel: () => void;
  readonly onUseGenerated: (content: string) => void;
}): JSX.Element {
  return (
    <AgentTaskModal
      title="Generate skill with AI"
      label="Describe the skill"
      placeholder="e.g. A skill that summarises long URLs by fetching them, extracting the headline and key bullets, and citing each source link."
      hint="Generated privately — it stays here in the editor and never shows in the chat."
      buildPrompt={SKILL_PROMPT_TEMPLATE}
      doneLabel="Use this skill"
      onClose={onCancel}
      onUseOutput={onUseGenerated}
    />
  );
}
