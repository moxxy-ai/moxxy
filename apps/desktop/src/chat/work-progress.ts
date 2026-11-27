import type { WorkNode } from '@moxxy/client-core';
import { buildCompactSummary, oneLine, truncate, type Block, type LiveToolCall, type ToolCallBlockData } from '@moxxy/chat-model';
import { contextualToolCaption, currentToolActivity } from './current-tool-activity';
import { statusOf } from './SkillGroupView';

/** A turn can interleave the agent's outer execute call, a browser action and a thought. */
export function workProgress(group: WorkNode, thinking: boolean): { label: string; failed: number } {
  let failed = 0;
  let label = '';
  let pending = '';
  let fallback = thinking ? 'Thinking…' : 'Getting started…';

  function tool(call: ToolCallBlockData | LiveToolCall): void {
    const status = statusOf(call.outcome);
    if (status === 'error') failed++;
    if (!group.active) return;
    const { name, input } = call.request;
    if (name === 'execute' || name === 'functions.exec') return;
    if (status === 'error') {
      label = call.outcome?.type === 'denied' ? 'Permission declined' : 'The last step failed';
    } else {
      const running = status === 'running';
      const caption = contextualToolCaption(name, input, !running);
      if (caption) label = caption;
      else if ('compact' in call) label = buildCompactSummary([call], running);
      else {
        const activity = currentToolActivity(name, input);
        label = running ? activity : `Last step · ${activity}`;
      }
      if (running) pending = label;
    }
  }

  function block(step: Block): void {
    switch (step.kind) {
      case 'event':
        if (step.event.type === 'reasoning_message') fallback = 'Thinking…';
        if (step.event.type === 'assistant_message' && step.event.stopReason === 'tool_use') {
          const comment = oneLine(step.event.content).trim();
          if (comment) label = truncate(comment, 96);
        }
        break;
      case 'tool-call':
        tool(step);
        break;
      case 'live-tools':
      case 'step-list':
        step.calls.forEach(tool);
        break;
      case 'skill-scope':
        fallback = `Using skill ${step.skillEvent.name}`;
        step.children.forEach(block);
        break;
      case 'subagent-group':
        step.agents.forEach(block);
        break;
      case 'subagent':
        if (step.error) failed++;
        label = step.completedAtMs === null ? 'Working with a helper…' : 'Helper finished';
        break;
    }
  }
  for (const node of group.nodes) {
    if (node.kind === 'thinking') fallback = 'Thinking…';
    else if (node.kind === 'tool-group') node.tools.forEach(tool);
    else if (node.kind === 'block') block(node.block);
  }
  return { label: pending || label || fallback, failed };
}
