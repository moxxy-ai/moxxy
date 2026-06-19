/**
 * Subagent <-> parent log bridge. Wraps child `MoxxyEvent`s into
 * `plugin_event` envelopes on the parent log so the TUI / exporters can
 * render live progress, and emits the start/completed bookend envelopes.
 */

import type {
  MoxxyEvent,
  SessionId,
  StopReason,
  SubagentSpec,
  TurnId,
} from '@moxxy/sdk';
import { asPluginId } from '@moxxy/sdk';
import type { SessionRuntime } from '../session-runtime.js';

export const SUBAGENT_PLUGIN_ID = asPluginId('@moxxy/subagents');

export async function emitSubagentStart(
  parentSession: SessionRuntime,
  parentTurnId: TurnId,
  label: string,
  childSessionId: SessionId,
  spec: SubagentSpec,
  mode: string,
): Promise<void> {
  await parentSession.log.append({
    type: 'plugin_event',
    sessionId: parentSession.id,
    turnId: parentTurnId,
    source: 'plugin',
    pluginId: SUBAGENT_PLUGIN_ID,
    subtype: 'subagent_started',
    payload: {
      label,
      childSessionId: String(childSessionId),
      prompt: spec.prompt,
      mode,
      agentType: spec.agentType ?? 'default',
      ...(spec.model ? { model: spec.model } : {}),
    },
  });
}

export async function emitSubagentCompleted(
  parentSession: SessionRuntime,
  parentTurnId: TurnId,
  label: string,
  childSessionId: SessionId,
  text: string,
  stopReason: StopReason,
  errorMessage: string | null,
  agentType: string,
  tokensUsed: number,
): Promise<void> {
  await parentSession.log.append({
    type: 'plugin_event',
    sessionId: parentSession.id,
    turnId: parentTurnId,
    source: 'plugin',
    pluginId: SUBAGENT_PLUGIN_ID,
    subtype: 'subagent_completed',
    payload: {
      label,
      childSessionId: String(childSessionId),
      text,
      stopReason,
      agentType,
      tokensUsed,
      ...(errorMessage ? { error: errorMessage } : {}),
    },
  });
}

export async function emitSubagentWarning(
  parentSession: SessionRuntime,
  parentTurnId: TurnId,
  label: string,
  childSessionId: SessionId,
  message: string,
): Promise<void> {
  await parentSession.log.append({
    type: 'plugin_event',
    sessionId: parentSession.id,
    turnId: parentTurnId,
    source: 'plugin',
    pluginId: SUBAGENT_PLUGIN_ID,
    subtype: 'subagent_warning',
    payload: {
      label,
      childSessionId: String(childSessionId),
      message,
    },
  });
}

/**
 * Map each interesting child event to a parent `plugin_event` so the TUI
 * can render the subagent's progress in real time. Noisy / book-keeping
 * events (mode_iteration, provider_request, provider_response,
 * assistant_message — covered by the explicit `subagent_completed`) are
 * filtered out to keep the parent log lean.
 */
export async function streamChildEventToParent(
  parentSession: SessionRuntime,
  parentTurnId: TurnId,
  label: string,
  childSessionId: SessionId,
  childEvt: MoxxyEvent,
): Promise<void> {
  const mapped = mapChildEvent(label, childSessionId, childEvt);
  if (!mapped) return;
  try {
    await parentSession.log.append({
      type: 'plugin_event',
      sessionId: parentSession.id,
      turnId: parentTurnId,
      source: 'plugin',
      pluginId: SUBAGENT_PLUGIN_ID,
      subtype: mapped.subtype,
      payload: mapped.payload,
    });
  } catch (err) {
    // Forwarding a child progress event is best-effort: a parent-log append
    // failure must not abort the subagent run. EventLog.append already swallows
    // listener errors, so this rejection would otherwise vanish with zero
    // trace (the surface just stops updating); surface it so a chronic
    // forwarding failure during a long subagent run is at least diagnosable.
    process.stderr.write(
      `moxxy: dropped subagent progress event (${mapped.subtype}) — parent log append failed: ` +
        `${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
}

/** Max chars of a forwarded child tool output/error mirrored onto the parent log. */
const MAX_FORWARD_CHARS = 16 * 1024;

/**
 * Bound an arbitrary child tool result before mirroring it onto the parent log.
 * Strings are truncated with an elision marker; other values pass through when
 * their serialized length is small and are replaced with a marker when not (we
 * avoid re-parsing — the full payload still lives in the child log).
 */
function truncateForward(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.length > MAX_FORWARD_CHARS
      ? `${value.slice(0, MAX_FORWARD_CHARS)}… [${value.length - MAX_FORWARD_CHARS} more chars elided]`
      : value;
  }
  if (value === null || value === undefined || typeof value !== 'object') return value;
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return '[unserializable subagent output elided]';
  }
  if (serialized.length <= MAX_FORWARD_CHARS) return value;
  return `${serialized.slice(0, MAX_FORWARD_CHARS)}… [${serialized.length - MAX_FORWARD_CHARS} more chars elided]`;
}

function mapChildEvent(
  label: string,
  childSessionId: SessionId,
  childEvt: MoxxyEvent,
): { subtype: string; payload: Record<string, unknown> } | null {
  const payload: Record<string, unknown> = {
    label,
    childSessionId: String(childSessionId),
  };
  switch (childEvt.type) {
    case 'assistant_chunk':
      payload.delta = childEvt.delta;
      return { subtype: 'subagent_chunk', payload };
    case 'tool_call_requested':
      payload.name = childEvt.name;
      payload.input = childEvt.input;
      payload.callId = String(childEvt.callId);
      return { subtype: 'subagent_tool_call', payload };
    case 'tool_result':
      payload.callId = String(childEvt.callId);
      payload.ok = childEvt.ok;
      // Child tool outputs are `unknown` and unbounded (a child Read/Bash can
      // return multi-MB blobs). Forwarding them verbatim copies the full payload
      // into the in-memory parent log too — doubling memory/persistence cost and
      // multiplying it under deep nesting. The TUI only needs a preview, so cap it.
      if (childEvt.ok) payload.output = truncateForward(childEvt.output);
      else payload.error = truncateForward(childEvt.error);
      return { subtype: 'subagent_tool_result', payload };
    case 'error':
      payload.kind = childEvt.kind;
      payload.message = childEvt.message;
      return { subtype: 'subagent_error', payload };
    case 'abort':
      payload.reason = childEvt.reason;
      return { subtype: 'subagent_abort', payload };
    case 'plugin_event':
      return mapNestedPluginEvent(label, payload, childEvt);
    default:
      return null;
  }
}

function mapNestedPluginEvent(
  label: string,
  payload: Record<string, unknown>,
  childEvt: Extract<MoxxyEvent, { type: 'plugin_event' }>,
): { subtype: string; payload: Record<string, unknown> } | null {
  // Bubble nested subagent events too, so a grand-child's progress
  // surfaces all the way up. We strip the nested label-prefix to
  // keep things compact; payload retains the chain via the embedded
  // childSessionId.
  const nestedSubtype = childEvt.subtype;
  if (typeof nestedSubtype !== 'string' || !nestedSubtype.startsWith('subagent_')) return null;
  const nestedPayload = childEvt.payload;
  if (nestedPayload && typeof nestedPayload === 'object') {
    for (const [k, v] of Object.entries(nestedPayload as Record<string, unknown>)) {
      if (k !== 'label' && k !== 'childSessionId') payload[k] = v;
    }
    // Preserve the chain via a `via` field naming the immediate parent label.
    payload.via = label;
  }
  return { subtype: nestedSubtype, payload };
}
