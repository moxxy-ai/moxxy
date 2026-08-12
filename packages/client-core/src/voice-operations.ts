export type VoiceOperationKind =
  | 'web-search'
  | 'project-read'
  | 'editing'
  | 'verification'
  | 'command'
  | 'application'
  | 'delegation'
  | 'generic';

export interface VoiceActiveOperation {
  readonly callId: string;
  readonly kind: VoiceOperationKind;
  readonly ordinal: number;
}

function commandText(input: unknown): string {
  if (typeof input !== 'object' || input === null) return '';
  const command = (input as Record<string, unknown>).command;
  return typeof command === 'string' ? command.toLocaleLowerCase() : '';
}

/**
 * Maps a tool call to a presentation-safe category. Tool input is consulted
 * only to distinguish verification commands; it is never returned or copied
 * into the UI model.
 */
export function categorizeVoiceOperation(
  toolName: string,
  input?: unknown,
): VoiceOperationKind {
  const normalized = toolName.toLocaleLowerCase().replace(/[^a-z0-9]+/gu, '_');
  if (/(?:dispatch_agent|subagent|collaboration|delegate)/u.test(normalized)) return 'delegation';
  if (/(?:test|verify|check|lint|typecheck|build)/u.test(normalized)) return 'verification';
  if (/(?:write|edit|patch|replace|create_file|delete_file)/u.test(normalized)) return 'editing';
  if (/(?:^|_)web(?:_|$)|web_search|web_fetch|search_query|image_query/u.test(normalized)) return 'web-search';
  if (/^(?:read|grep|glob|find|list|recall|session_recall|memory_search)$/u.test(normalized)) {
    return 'project-read';
  }
  if (/(?:browser|computer|screenshot|click|navigate|view_image)/u.test(normalized)) {
    return 'application';
  }
  if (/(?:bash|exec|command|terminal|shell)/u.test(normalized)) {
    const command = commandText(input);
    if (/(?:^|\s)(?:test|vitest|jest|playwright|typecheck|lint|build|check:deps)(?:\s|$|:)/u.test(command)) {
      return 'verification';
    }
    if (/^\s*(?:rg|sed|ls|find|pwd|head|tail|wc|git\s+(?:status|diff|show|log|ls-tree))\b/u.test(command)) {
      return 'project-read';
    }
    return 'command';
  }
  return 'generic';
}
