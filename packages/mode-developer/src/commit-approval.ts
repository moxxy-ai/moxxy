import type { ApprovalOption, ModeContext } from '@moxxy/sdk';

import { renderDiffBody, type ChangedFilesResult } from './diff-preview.js';

export type CommitGateOutcome =
  | { kind: 'approve'; message: string }
  | { kind: 'edit'; message: string }
  | { kind: 'skip' }
  | { kind: 'cancel' };

/**
 * Show the commit approval gate with the proposed message plus a fenced
 * unified diff body. Returns the user's decision (possibly with an edited
 * message). Headless contexts auto-skip — the suggested message has
 * already been surfaced as an assistant_message in that case.
 */
export async function runCommitApprovalGate(
  ctx: ModeContext,
  message: string,
  diff: ChangedFilesResult,
): Promise<CommitGateOutcome> {
  if (!ctx.approval) return { kind: 'skip' };

  const diffBody = renderDiffBody(diff);
  const body = `Proposed commit message:\n  ${message.split('\n').join('\n  ')}\n\n${diffBody}`;

  const options: ApprovalOption[] = [
    {
      id: 'approve',
      label: 'Commit',
      hotkey: 'a',
      description: 'Run git add -A + git commit with the message above.',
    },
    {
      id: 'edit',
      label: 'Edit message and commit',
      hotkey: 'e',
      requestsText: true,
      textPrompt: 'New commit message (subject, then blank line, then body):',
      description: 'Replace the suggested message before committing.',
    },
    {
      id: 'skip',
      label: 'Skip commit',
      hotkey: 's',
      description: 'Leave changes uncommitted; end the turn.',
    },
    {
      id: 'cancel',
      label: 'Cancel turn',
      hotkey: 'c',
      danger: true,
    },
  ];

  const decision = await ctx.approval.confirm({
    title: 'Suggested commit — review before committing',
    body,
    kind: 'developer.commit',
    defaultOptionId: 'approve',
    options,
  });

  if (decision.optionId === 'cancel') return { kind: 'cancel' };
  if (decision.optionId === 'skip') return { kind: 'skip' };
  if (decision.optionId === 'edit') {
    const edited = (decision.text ?? '').trim();
    return { kind: 'edit', message: edited.length > 0 ? edited : message };
  }
  return { kind: 'approve', message };
}
