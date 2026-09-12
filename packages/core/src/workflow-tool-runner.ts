import { randomUUID } from 'node:crypto';
import {
  asToolCallId,
  dispatchToolCall,
  type SubagentSpawner,
  type TurnId,
  type WorkflowToolRunner,
} from '@moxxy/sdk';
import type { SessionRuntime } from './session-runtime.js';

/** Deterministic workflow steps use the same gate as model-issued tool calls. */
export function createWorkflowToolRunner(
  session: SessionRuntime,
  turnId: TurnId,
  subagents?: SubagentSpawner,
): WorkflowToolRunner {
  return {
    get: (name) => session.tools.get(name),
    async execute(name, input, signal) {
      signal.throwIfAborted();
      const id = randomUUID();
      await session.log.append({
        type: 'tool_call_requested',
        sessionId: session.id,
        turnId,
        source: 'system',
        callId: asToolCallId(id),
        name,
        input,
      });
      let output: unknown;
      let error: string | undefined;
      let received = false;
      const app = session.appContext();
      for await (const event of dispatchToolCall(
        {
          sessionId: session.id,
          turnId,
          cwd: app.cwd,
          env: app.env,
          services: app.services,
          log: session.log,
          hooks: session.dispatcher,
          permissions: session.resolver,
          tools: session.tools,
          signal,
          subagents,
          emit: (event) => session.log.append(event),
        },
        { id, name, input },
        0,
      )) {
        if (event.type !== 'tool_result' || event.callId !== id) continue;
        received = true;
        if (event.ok) output = event.output;
        else error = event.error?.message ?? 'Workflow tool failed';
      }
      if (!received) throw new Error('Workflow tool outcome is unknown; action not retried');
      if (error) throw new Error(error);
      return output;
    },
  };
}
