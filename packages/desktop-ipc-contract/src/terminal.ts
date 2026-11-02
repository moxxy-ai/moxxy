/**
 * The person's own terminal tabs of a project, as the renderer sees them. The
 * app owns their shells (not a chat's runner), so every chat of the project
 * shows the same tabs; the agent's terminal is the runner's `terminal` surface.
 */
export interface TerminalTabInfo {
  readonly id: string;
  /** "Terminal 1", "Terminal 2", … in the order they were opened. */
  readonly title: string;
}

/** What a viewer attaching to a tab has missed, and whether it is a real terminal. */
export interface TerminalTabSnapshot {
  readonly data: string;
  /** `pipe` when no real PTY could start: typed keys then never reach a prompt. */
  readonly backend: 'pty' | 'pipe';
  readonly ptyError: string | null;
}
