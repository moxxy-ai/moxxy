import { textOf } from './utils/record';

export interface SessionRowAccessibility {
  readonly accessibilityLabel: string;
  readonly accessibilityRole: 'button';
}

export function buildSessionRowAccessibility(session: Record<string, unknown>): SessionRowAccessibility {
  const title = textOf(session.firstPrompt, textOf(session.name, textOf(session.label, 'Workspace')));
  return {
    accessibilityLabel: `Open session ${title}`,
    accessibilityRole: 'button',
  };
}
