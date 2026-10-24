import { accountLimitText } from '@moxxy/chat-model';
import {
  accountLimitOfEvent,
  agentComputerUseOf,
  isStepListDisplay,
  isToolDisplayResult,
  stepListProgress,
  toolImagesOf,
  type AgentComputerUse,
  type FileDiffDisplay,
  type MoxxyEvent,
  type ProviderInfo,
  type StepListDisplay,
  type StepStatus,
  type ToolImage,
} from '@moxxy/sdk';

/**
 * What a messaging channel shows of an agent's work beyond its tool lines, read
 * from one turn's events the way the desktop and the terminal read them: the
 * agent's list of steps as it now stands (one list per turn, however many calls
 * changed it), the images tools returned (each kept once), and whether the agent
 * of an agent connection is using the person's computer.
 */
export class TurnAgentWork {
  private steps: StepListDisplay | null = null;
  private readonly stepCalls = new Set<string>();
  private imageList: ToolImage[] = [];
  private computer: AgentComputerUse | null = null;

  accept(event: MoxxyEvent): void {
    if (event.type === 'tool_call_requested') {
      // Moxxy's own computer tools have their own controls; only an agent's count.
      if (event.executedBy !== 'provider') return;
      const use = agentComputerUseOf(event.name, event.input);
      if (use) this.computer = use.app ? use : (this.computer ?? use);
      return;
    }
    if (event.type !== 'tool_result' || !event.ok) return;
    const output = event.output;
    if (isToolDisplayResult(output) && isStepListDisplay(output.display)) {
      this.steps = output.display;
      this.stepCalls.add(String(event.callId));
      return;
    }
    const found = toolImagesOf(output);
    if (!found) return;
    for (const image of found.images) {
      if (!this.imageList.some((seen) => seen.base64 === image.base64)) this.imageList.push(image);
    }
  }

  /** The turn's list of steps as the last call left it, or null. */
  get stepList(): StepListDisplay | null {
    return this.steps;
  }

  /** Whether a call's result was a list of steps (it shows in the list, not as a tool line). */
  isStepListCall(callId: string): boolean {
    return this.stepCalls.has(callId);
  }

  /** The images tools returned this turn, in order, each once. */
  get images(): ReadonlyArray<ToolImage> {
    return this.imageList;
  }

  /** The agent's use of the person's computer this turn and the last app it named, or null. */
  get computerUse(): AgentComputerUse | null {
    return this.computer;
  }

  reset(): void {
    this.steps = null;
    this.stepCalls.clear();
    this.imageList = [];
    this.computer = null;
  }
}

/** A step's state as a mark that reads without color, as the terminal draws it. */
export const STEP_MARKS: Readonly<Record<StepStatus, string>> = {
  completed: '✓',
  in_progress: '●',
  pending: '○',
  cancelled: '✗',
};

/** The heading of an agent's list of steps: "Steps · 1 of 3 done". */
export function stepListHeading(list: StepListDisplay): string {
  const { done, total } = stepListProgress(list);
  return `Steps · ${done} of ${total} done`;
}

/** "Codex is using your computer · Arc", or "The agent is using your computer" when unnamed. */
export function agentComputerText(use: AgentComputerUse, agentName: string | undefined): string {
  return `${agentName ?? 'The agent'} is using your computer${use.app ? ` · ${use.app}` : ''}`;
}

/** The name of the agent of the session's active agent connection ("Codex"), else undefined. */
export function activeAgentName(info: {
  readonly activeProvider?: string | null;
  readonly providers: ReadonlyArray<Pick<ProviderInfo, 'name' | 'agentName'>>;
}): string | undefined {
  return info.providers.find((p) => p.name === info.activeProvider)?.agentName;
}

/** "1 image came back", "3 images came back". */
export function imagesLine(count: number): string {
  return `${count} image${count === 1 ? '' : 's'} came back`;
}

/**
 * A file diff as a classic unified-diff body: an `@@ -a,b +c,d @@` header per
 * hunk, then each line marked ` `/`+`/`-`, hunks separated by a blank line.
 * Every body line starts with its mark, so none can close a fence around it.
 */
export function unifiedDiffText(d: FileDiffDisplay): string {
  return d.hunks
    .map((hunk) =>
      [
        `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
        ...hunk.lines.map((line) => `${line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}${line.text}`),
      ].join('\n'),
    )
    .join('\n\n');
}

/** "Codex's weekly limit is used up · resets at 18:00" for an event recording a used-up account limit, else undefined. */
export function usedUpLimitText(event: MoxxyEvent): string | undefined {
  const limit = accountLimitOfEvent(event);
  return limit && limit.limit.state === 'reached' ? accountLimitText(limit, event.ts ?? Date.now()) : undefined;
}
