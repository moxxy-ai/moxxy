import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { createSubagentSpawner, type Session } from '@moxxy/core';
import {
  asPluginId,
  moxxyPath,
  writeFileAtomic,
  type EmittedEvent,
  type WorkflowRunResult,
} from '@moxxy/sdk';
import {
  WORKFLOWS_PLUGIN_NAME,
  type WorkflowStore,
  defaultWorkflowRunStore,
  resumeWorkflowRun,
  runWorkflow,
} from '@moxxy/plugin-workflows';

export interface MiniLogger {
  info?(msg: string, meta?: Record<string, unknown>): void;
  warn?(msg: string, meta?: Record<string, unknown>): void;
  error?(msg: string, meta?: Record<string, unknown>): void;
}

const PLUGIN_ID = asPluginId(WORKFLOWS_PLUGIN_NAME);

export interface WorkflowRunNowInput {
  name: string;
  inputs?: Record<string, unknown>;
  trigger?: string;
  /**
   * The afterWorkflow causal chain that led to this run (oldest first).
   * Carried per-run — NOT shared state — so concurrent independent fires
   * can't poison each other; it rides the `workflow_completed` payload as
   * `triggerChain` and is what lets the subscription refuse cycles.
   */
  chain?: ReadonlyArray<string>;
}

export interface WorkflowRunner {
  runNow(input: WorkflowRunNowInput): Promise<WorkflowRunResult>;
  resumeNow(runId: string, reply: string): Promise<WorkflowRunResult>;
}

/**
 * Build the autonomous workflow runner: a subagent spawner + the DAG engine +
 * inbox delivery. `runNow` starts a run (guarding double-fires via an in-flight
 * set); `resumeNow` feeds an operator reply into a paused (`awaitInput`) run.
 */
export function buildWorkflowRunner(args: {
  session: Session;
  store: WorkflowStore;
  logger?: MiniLogger;
}): WorkflowRunner {
  const { session, store, logger } = args;
  const inFlight = new Set<string>();

  async function runNow(input: WorkflowRunNowInput): Promise<WorkflowRunResult> {
    const entry = await store.get(input.name);
    if (!entry) {
      return { ok: false, status: 'failed', steps: [], output: '', error: `no workflow named "${input.name}"` };
    }
    if (inFlight.has(input.name)) {
      return {
        ok: false,
        status: 'failed',
        steps: [],
        output: '',
        error: `workflow "${input.name}" is already running`,
      };
    }
    inFlight.add(input.name);
    try {
      const turnId = session.startTurn().turnId;
      const spawner = createSubagentSpawner({
        parentSession: session,
        parentTurnId: turnId,
        parentSignal: session.signal,
        parentModel: activeModel(session),
      });
      const result = await runWorkflow(
        entry.workflow,
        {
          spawner,
          tools: session.tools,
          lookup: {
            skill: (n) => session.skills.byName(n),
            workflow: (n) => store.lookup(n),
          },
          signal: session.signal,
          ...(input.inputs ? { inputs: input.inputs } : {}),
          trigger: input.trigger ?? 'auto',
          now: () => Date.now(),
          emit: (subtype, payload) =>
            void session.log.append({
              type: 'plugin_event',
              sessionId: session.id,
              turnId,
              source: 'plugin',
              pluginId: PLUGIN_ID,
              subtype,
              // Stamp the causal chain onto the completion event so the
              // afterWorkflow subscription can detect cycles/depth per-run.
              payload:
                subtype === 'workflow_completed' && input.chain && input.chain.length > 0
                  ? { ...(payload as Record<string, unknown>), triggerChain: [...input.chain] }
                  : payload,
            } as EmittedEvent),
          ...(logger ? { logger } : {}),
        },
        { executor: session.workflowExecutors.getActive() },
      );
      // A `paused` result is NOT terminal: the run is parked on an awaitInput
      // step waiting for an operator reply (resume). Delivering it to the inbox
      // would falsely present a half-done run as complete. Don't deliver, and
      // surface the paused status to the caller. (In practice awaitInput is
      // gated at validate/save time, so this is a defense-in-depth guard.)
      if (result.status === 'paused') {
        logger?.warn?.('workflows: run paused awaiting operator input; not delivering to inbox', {
          workflow: input.name,
          runId: result.runId,
        });
        return result;
      }
      await deliverToInbox(entry.workflow, result, logger);
      return result;
    } finally {
      inFlight.delete(input.name);
    }
  }

  /**
   * Resume a paused (`awaitInput`) run: feed the operator's reply into the
   * retained child session and drive the rest of the DAG. The retained child
   * lives in this runner process's registry (set when the run paused), so the
   * spawner's `continue` finds it. A run that COMPLETES (or fails) here IS
   * terminal — deliver it to the inbox just like a clean `runNow` (the paused
   * run was withheld earlier). If the resume itself pauses again (a workflow
   * with multiple awaitInput steps), it stays parked for the next reply.
   */
  async function resumeNow(runId: string, reply: string): Promise<WorkflowRunResult> {
    const checkpoint = await defaultWorkflowRunStore.load(runId);
    const turnId = session.startTurn().turnId;
    const spawner = createSubagentSpawner({
      parentSession: session,
      parentTurnId: turnId,
      parentSignal: session.signal,
      parentModel: activeModel(session),
    });
    const result = await resumeWorkflowRun(
      runId,
      reply,
      {
        spawner,
        tools: session.tools,
        lookup: {
          skill: (n) => session.skills.byName(n),
          workflow: (n) => store.lookup(n),
        },
        signal: session.signal,
        now: () => Date.now(),
        emit: (subtype, payload) =>
          void session.log.append({
            type: 'plugin_event',
            sessionId: session.id,
            turnId,
            source: 'plugin',
            pluginId: PLUGIN_ID,
            subtype,
            payload,
          } as EmittedEvent),
        ...(logger ? { logger } : {}),
      },
      defaultWorkflowRunStore,
    );
    // A still-paused result (a second awaitInput) is non-terminal — withhold it
    // exactly like runNow. A completed/failed result IS terminal: deliver it.
    if (result.status === 'paused') {
      logger?.warn?.('workflows: run paused again awaiting operator input; not delivering to inbox', {
        runId: result.runId,
      });
      return result;
    }
    // Resolve the workflow name from the checkpoint for inbox delivery metadata.
    if (checkpoint?.workflow) await deliverToInbox(checkpoint.workflow, result, logger);
    return result;
  }

  return { runNow, resumeNow };
}

/**
 * Model for trigger-spawned workflow children. Prefers the model the user's
 * conversation last actually ran on (`session.lastResolvedModel`, recorded by
 * runTurn) over the provider's first descriptor — the descriptor list often
 * leads with a model the user isn't using. Exported for tests. The 'default'
 * terminal fallback matches runTurn's own resolution.
 */
export function activeModel(session: Session): string {
  return session.lastResolvedModel ?? safeActiveProvider(session)?.models[0]?.id ?? 'default';
}

export function safeActiveProvider(session: Session): ReturnType<Session['providers']['getActive']> | null {
  try {
    return session.providers.getActive();
  } catch {
    return null;
  }
}

export async function deliverToInbox(
  workflow: import('@moxxy/sdk').Workflow,
  result: WorkflowRunResult,
  logger?: MiniLogger,
): Promise<void> {
  if (workflow.delivery && workflow.delivery.inbox === false) return;
  try {
    const dir = moxxyPath('inbox');
    await fsp.mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(dir, `${stamp}-${workflow.name}.md`);
    const header = [
      '---',
      `workflow: ${workflow.name}`,
      `firedAt: ${new Date().toISOString()}`,
      workflow.delivery?.channel ? `channel: ${workflow.delivery.channel}` : null,
      `outcome: ${result.ok ? 'ok' : 'error'}`,
      '---',
      '',
    ]
      .filter((l) => l !== null)
      .join('\n');
    const body = result.error ? `**error:** ${result.error}\n\n${result.output}` : result.output;
    await writeFileAtomic(file, header + body + '\n');
  } catch (err) {
    logger?.warn?.('workflows: inbox delivery failed', {
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
