import type { MoxxyEvent, ToolResultContextPolicy } from './events.js';

export const IMAGE_TOOL_RESULT_ESTIMATED_TOKENS = 1_024;
const IMAGE_TOOL_RESULT_ESTIMATED_CHARS = IMAGE_TOOL_RESULT_ESTIMATED_TOKENS * 4;

export interface ImageToolResult {
  readonly mediaType: string;
  readonly data: string;
  readonly forModel: string;
}

export function imageToolResult(output: unknown): ImageToolResult | null {
  if (typeof output !== 'object' || output === null) return null;
  const value = output as {
    type?: unknown;
    mediaType?: unknown;
    base64?: unknown;
    data?: unknown;
    forModel?: unknown;
  };
  if (typeof value.mediaType !== 'string') return null;
  const data =
    typeof value.base64 === 'string'
      ? value.base64
      : value.type === 'image' && typeof value.data === 'string'
        ? value.data
        : null;
  if (data === null) return null;
  const forModel =
    typeof value.forModel === 'string' && value.forModel.trim().length > 0
      ? value.forModel.slice(0, 32_000)
      : '[image returned by tool — see attached image]';
  return { mediaType: value.mediaType, data, forModel };
}

export function imageToolResultChars(output: unknown): number | null {
  const image = imageToolResult(output);
  if (image === null) return null;
  return image.forModel.length + IMAGE_TOOL_RESULT_ESTIMATED_CHARS;
}

export function validToolResultContextPolicy(
  policy: ToolResultContextPolicy | undefined,
): ToolResultContextPolicy | null {
  if (policy?.mode !== 'replace_previous') return null;
  const key = policy.key.trim();
  if (key.length === 0 || key.length > 256) return null;
  return { mode: 'replace_previous', key };
}

export function latestToolResultContextSeq(
  events: ReadonlyArray<MoxxyEvent>,
): ReadonlyMap<string, number> {
  const latest = new Map<string, number>();
  for (const event of events) {
    if (event.type !== 'tool_result' || !event.ok || event.error) continue;
    const policy = validToolResultContextPolicy(event.contextPolicy);
    if (policy !== null) latest.set(policy.key, event.seq);
  }
  return latest;
}

export function supersededToolResultStub(key: string): string {
  return `[state superseded by a newer observation for "${key}"]`;
}

export function supersededToolResult(
  event: Extract<MoxxyEvent, { type: 'tool_result' }>,
  latest: ReadonlyMap<string, number>,
): string | null {
  if (!event.ok || event.error) return null;
  const policy = validToolResultContextPolicy(event.contextPolicy);
  if (policy === null) return null;
  const latestSeq = latest.get(policy.key);
  return latestSeq !== undefined && event.seq < latestSeq
    ? supersededToolResultStub(policy.key)
    : null;
}
