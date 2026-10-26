import { AGENT_CONNECTION_PLUGIN_ID } from './agent-step.js';
import type { MoxxyEvent } from './events.js';
import type { ModelDescriptor } from './provider.js';

/**
 * Where an agent connection records the context window its agent reports for a model
 * (Codex's `modelContextWindow`, Claude's `modelUsage.contextWindow`), under
 * `AGENT_CONNECTION_PLUGIN_ID`. It replaces the starting window from the model list,
 * so every surface shows the window the agent really runs with.
 */
export const AGENT_CONTEXT_WINDOW_SUBTYPE = 'context_window';

export interface RecordedContextWindow {
  readonly provider: string;
  readonly model: string;
  readonly tokens: number;
}

export function isContextWindowSize(tokens: unknown): tokens is number {
  return typeof tokens === 'number' && Number.isSafeInteger(tokens) && tokens > 0;
}

/** The window an event records, or undefined when it records something else. */
export function contextWindowOfEvent(event: MoxxyEvent): RecordedContextWindow | undefined {
  if (event.type !== 'plugin_event' || event.pluginId !== AGENT_CONNECTION_PLUGIN_ID || event.subtype !== AGENT_CONTEXT_WINDOW_SUBTYPE) return undefined;
  const payload = event.payload as Partial<RecordedContextWindow> | null;
  if (!payload || typeof payload.provider !== 'string' || typeof payload.model !== 'string' || !isContextWindowSize(payload.tokens)) return undefined;
  return { provider: payload.provider, model: payload.model, tokens: payload.tokens };
}

/** The last window recorded for each model of the provider. */
export function recordedContextWindows(events: ReadonlyArray<MoxxyEvent>, provider: string): ReadonlyMap<string, number> {
  const windows = new Map<string, number>();
  for (const event of events) {
    const recorded = contextWindowOfEvent(event);
    if (recorded && recorded.provider === provider) windows.set(recorded.model, recorded.tokens);
  }
  return windows;
}

/** The models with the windows the agent reported in place of their starting ones. */
export function withRecordedContextWindows(
  models: ReadonlyArray<ModelDescriptor>,
  windows: ReadonlyMap<string, number>,
): ReadonlyArray<ModelDescriptor> {
  if (windows.size === 0) return models;
  return models.map((model) => {
    const tokens = windows.get(model.id);
    return tokens === undefined || tokens === model.contextWindow ? model : { ...model, contextWindow: tokens };
  });
}
